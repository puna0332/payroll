/**
 * Sync Routes — Manual trigger endpoints cho sync operations
 * Dùng để trigger sync thủ công từ frontend hoặc debug
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../shared/db/prisma.js';
import { env } from '../config/env.js';

const router = Router();

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') {
    throw new Error(`Route param ${name} is required`);
  }
  return value;
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function syncTypeFromBody(type: unknown): 'attendance' | 'payslips' | 'ot' | 'leave' | 'all' {
  return ['attendance', 'payslips', 'ot', 'leave', 'all'].includes(String(type))
    ? String(type) as 'attendance' | 'payslips' | 'ot' | 'leave' | 'all'
    : 'all';
}

/**
 * POST /api/sync/employees
 * Trigger employee sync from Lark Base
 */
router.post('/employees', async (_req: Request, res: Response) => {
  try {
    if (!env.LARK_APP_ID) {
      return res.status(503).json({ error: 'Lark credentials not configured' });
    }

    const { syncEmployeesFromLark } = await import('../modules/sync/sync-employees.js');
    const { createLarkClients } = await import('../shared/lark/index.js');
    const { base } = createLarkClients();

    const result = await syncEmployeesFromLark(prisma, base);
    return res.json({ success: true, data: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Sync] Employee sync error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/sync/employees/outbound
 * Push employee master data from database to the dedicated HR Lark Base
 */
router.post('/employees/outbound', async (_req: Request, res: Response) => {
  try {
    if (!env.LARK_APP_ID || (!env.LARK_HR_APP_TOKEN && !env.LARK_APP_TOKEN)) {
      return res.status(503).json({ error: 'Lark credentials or HR Base token not configured' });
    }

    const { syncEmployeesToHrBase } = await import('../modules/sync/sync-employees-outbound.js');
    const { LarkBaseClient } = await import('../shared/lark/base.js');
    const { getLarkHrConfig } = await import('../shared/lark/config.js');

    const hrBase = new LarkBaseClient(getLarkHrConfig());
    const result = await syncEmployeesToHrBase(prisma, hrBase);
    return res.json({ success: true, data: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Sync] Employee outbound sync error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/sync/employees-admin
 * Trigger employee sync from Lark Admin Contacts API (trực tiếp)
 * Fetches departments + users → upserts to database
 */
router.post('/employees-admin', async (_req: Request, res: Response) => {
  try {
    if (!env.LARK_APP_ID) {
      return res.status(503).json({ error: 'Lark credentials not configured' });
    }

    const { syncEmployeesFromAdmin } = await import('../modules/sync/sync-employees-admin.js');
    const { LarkAdminClient } = await import('../shared/lark/admin.js');
    const { getLarkConfig } = await import('../shared/lark/config.js');

    const config = getLarkConfig();
    const adminClient = new LarkAdminClient(config);

    const result = await syncEmployeesFromAdmin(prisma, adminClient);

    const { syncEmployeesToHrBase } = await import('../modules/sync/sync-employees-outbound.js');
    const { LarkBaseClient } = await import('../shared/lark/base.js');
    const { getLarkHrConfig } = await import('../shared/lark/config.js');
    const hrBase = new LarkBaseClient(getLarkHrConfig());
    const hrBaseResult = await syncEmployeesToHrBase(prisma, hrBase);

    return res.json({ success: true, data: { admin: result, hrBase: hrBaseResult } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Sync] Admin employee sync error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/sync/employees-admin/preview
 * Preview sync — fetch from Lark Admin without writing to DB
 * Returns departments + employees as JSON for inspection
 */
router.get('/employees-admin/preview', async (_req: Request, res: Response) => {
  try {
    if (!env.LARK_APP_ID) {
      return res.status(503).json({ error: 'Lark credentials not configured' });
    }

    const { LarkAdminClient } = await import('../shared/lark/admin.js');
    const { getLarkConfig } = await import('../shared/lark/config.js');

    const config = getLarkConfig();
    const adminClient = new LarkAdminClient(config);

    const { departments, users } = await adminClient.fetchAll();

    return res.json({
      success: true,
      data: {
        departments: departments.map(d => ({
          id: d.open_department_id,
          name: d.name,
          parentId: d.parent_department_id,
          memberCount: d.member_count || 0,
        })),
        employees: users.map(u => ({
          openId: u.open_id,
          userId: u.user_id,
          name: u.name,
          email: u.email || u.enterprise_email,
          mobile: u.mobile,
          gender: u.gender,
          employeeNo: u.employee_no,
          employeeType: u.employee_type,
          jobTitle: u.job_title,
          joinTime: u.join_time,
          isActivated: u.status?.is_activated,
          isResigned: u.status?.is_resigned,
          departmentIds: u.department_ids,
          avatarUrl: u.avatar?.avatar_240 || u.avatar?.avatar_origin,
        })),
        summary: {
          totalDepartments: departments.length,
          totalEmployees: users.length,
          active: users.filter(u => u.status?.is_activated && !u.status?.is_resigned).length,
          resigned: users.filter(u => u.status?.is_resigned).length,
        },
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Sync] Admin preview error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/sync/attendance
 * Trigger attendance sync for specific date range
 */
router.post('/attendance', async (req: Request, res: Response) => {
  try {
    if (!env.LARK_APP_ID) {
      return res.status(503).json({ error: 'Lark credentials not configured' });
    }

    const { startDate, endDate } = req.body ?? {};
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const syncStartDate = startDate || toYmd(defaultStart);
    const syncEndDate = endDate || toYmd(now);

    const { syncAttendanceFromLark } = await import('../modules/sync/sync-attendance.js');
    const { createLarkClients } = await import('../shared/lark/index.js');
    const { attendance } = createLarkClients();

    const result = await syncAttendanceFromLark(attendance, { startDate: syncStartDate, endDate: syncEndDate });
    return res.json({ success: true, data: { range: { startDate: syncStartDate, endDate: syncEndDate }, result } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Sync] Attendance sync error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/sync/approvals
 * Trigger approval sync for specific time range
 */
router.post('/approvals', async (req: Request, res: Response) => {
  try {
    if (!env.LARK_APP_ID) {
      return res.status(503).json({ error: 'Lark credentials not configured' });
    }

    const { startTime, endTime } = req.body;
    const now = Date.now();

    const { syncApprovalsFromLark } = await import('../modules/sync/sync-approvals.js');
    const { createLarkClients } = await import('../shared/lark/index.js');
    const { approval } = createLarkClients();

    const result = await syncApprovalsFromLark(approval, {
      startTime: startTime ?? now - 30 * 24 * 60 * 60 * 1000, // Default: last 30 days to catch late approvals
      endTime: endTime ?? now,
    });
    return res.json({ success: true, data: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Sync] Approval sync error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/sync/approvals/pending
 * Trigger sync of all PENDING approvals in the database
 */
router.post('/approvals/pending', async (_req: Request, res: Response) => {
  try {
    if (!env.LARK_APP_ID) {
      return res.status(503).json({ error: 'Lark credentials not configured' });
    }

    const { syncPendingApprovalsFromLark } = await import('../modules/sync/sync-approvals.js');
    const { createLarkClients } = await import('../shared/lark/index.js');
    const { approval } = createLarkClients();

    const result = await syncPendingApprovalsFromLark(approval);
    return res.json({ success: true, data: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Sync] Pending approvals sync error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/sync/outbound
 * Push latest payroll period to Lark Base when Settings does not provide a periodId
 */
router.post('/outbound', async (req: Request, res: Response) => {
  try {
    if (!env.LARK_APP_ID) {
      return res.status(503).json({ error: 'Lark credentials not configured' });
    }

    const { periodId, type } = req.body ?? {};
    const period = periodId
      ? await prisma.payrollPeriod.findUnique({ where: { id: String(periodId) } })
      : await prisma.payrollPeriod.findFirst({ orderBy: { monthKey: 'desc' } });

    if (!period) return res.status(404).json({ error: 'Không tìm thấy kỳ lương để đẩy về Lark' });

    const syncType = syncTypeFromBody(type);
    const { createLarkClients } = await import('../shared/lark/index.js');
    const { base } = createLarkClients();

    const job = await prisma.syncJob.create({
      data: {
        jobType: `OUTBOUND_LARK_${String(syncType).toUpperCase()}`,
        direction: 'OUTBOUND',
        status: 'RUNNING',
        metadata: { periodId: period.id, syncType, triggeredFrom: 'settings' },
      },
    });

    const { syncPeriodToLark } = await import('../modules/sync/sync-outbound.js');
    const results = await syncPeriodToLark(base, period.id, syncType);
    const totals = Object.values(results).reduce(
      (acc, item) => ({
        synced: acc.synced + item.synced,
        created: acc.created + item.created,
        updated: acc.updated + item.updated,
        failed: acc.failed + item.errors,
      }),
      { synced: 0, created: 0, updated: 0, failed: 0 },
    );

    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: totals.failed > 0 ? 'FAILED' : 'COMPLETED',
        finishedAt: new Date(),
        recordsProcessed: totals.synced + totals.failed,
        recordsCreated: totals.created,
        recordsUpdated: totals.updated,
        recordsFailed: totals.failed,
        metadata: { periodId: period.id, syncType, results, triggeredFrom: 'settings' },
      },
    });

    return res.json({ success: true, data: { periodId: period.id, monthKey: period.monthKey, results } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Sync] Outbound sync error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/sync/outbound/:periodId
 * Push calculated data to Lark Base
 */
router.post('/outbound/:periodId', async (req: Request, res: Response) => {
  try {
    if (!env.LARK_APP_ID) {
      return res.status(503).json({ error: 'Lark credentials not configured' });
    }

    const periodId = routeParam(req, 'periodId');
    const { type } = req.body ?? {}; // 'attendance' | 'payslips' | 'ot' | 'leave' | 'all'
    const syncType = syncTypeFromBody(type);

    const { createLarkClients } = await import('../shared/lark/index.js');
    const { base } = createLarkClients();

    const job = await prisma.syncJob.create({
      data: {
        jobType: `OUTBOUND_LARK_${String(syncType).toUpperCase()}`,
        direction: 'OUTBOUND',
        status: 'RUNNING',
        metadata: { periodId, syncType },
      },
    });

    const { syncPeriodToLark } = await import('../modules/sync/sync-outbound.js');
    const results = await syncPeriodToLark(base, periodId, syncType);
    const totals = Object.values(results).reduce(
      (acc, item) => ({
        synced: acc.synced + item.synced,
        created: acc.created + item.created,
        updated: acc.updated + item.updated,
        failed: acc.failed + item.errors,
      }),
      { synced: 0, created: 0, updated: 0, failed: 0 },
    );

    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: totals.failed > 0 ? 'FAILED' : 'COMPLETED',
        finishedAt: new Date(),
        recordsProcessed: totals.synced + totals.failed,
        recordsCreated: totals.created,
        recordsUpdated: totals.updated,
        recordsFailed: totals.failed,
        metadata: { periodId, syncType, results },
      },
    });

    return res.json({ success: true, data: results });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Sync] Outbound sync error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/sync/jobs
 * List recent sync job history
 */
router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const jobs = await prisma.syncJob.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return res.json({ data: jobs });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/sync/policies
 * Sync salary/tax/insurance policies from Lark Base tables → database
 */
router.post('/policies', async (_req: Request, res: Response) => {
  try {
    if (!env.LARK_APP_ID || !env.LARK_APP_TOKEN) {
      return res.status(503).json({ error: 'Lark credentials or APP_TOKEN not configured' });
    }

    const { getLarkConfig } = await import('../shared/lark/config.js');
    const config = getLarkConfig();
    const BASE_API = 'https://open.larksuite.com/open-apis';
    const APP_TOKEN = env.LARK_APP_TOKEN;

    // Get token
    const tokenRes = await fetch(`${BASE_API}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
    });
    const tokenData = await tokenRes.json() as any;
    const token = tokenData.tenant_access_token;

    const TABLES = { SALARY: 'tblRTOr2MmfemvO7', TAX: 'tblR2p8W8fbxZ6yF', INSURANCE: 'tblkKgPs4299uRUU' };

    async function fetchAll(tableId: string) {
      const records: any[] = [];
      let pageToken: string | undefined;
      while (true) {
        const url = new URL(`${BASE_API}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
        url.searchParams.set('page_size', '100');
        if (pageToken) url.searchParams.set('page_token', pageToken);
        const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json() as any;
        if (d.code !== 0) break;
        records.push(...(d.data?.items || []));
        if (!d.data?.has_more) break;
        pageToken = d.data.page_token;
      }
      return records;
    }

    function getNum(fields: any, key: string): number {
      const v = fields[key];
      if (v === null || v === undefined || v === '') return 0;
      const n = parseFloat(String(v).replace(/,/g, ''));
      return isNaN(n) ? 0 : n;
    }
    function getVal(fields: any, key: string): string | null {
      const v = fields[key];
      if (!v) return null;
      if (Array.isArray(v)) return v.map((x: any) => x?.text || x?.name || String(x)).join(', ');
      if (typeof v === 'object') return (v as any).text || (v as any).name || null;
      return String(v);
    }

    const periodKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const stats = { salary: { created: 0, updated: 0 }, tax: { created: 0, updated: 0 }, insurance: { created: 0, updated: 0 } };

    // Salary
    const salaryRecs = await fetchAll(TABLES.SALARY);
    for (const rec of salaryRecs) {
      const f = rec.fields;
      const userId = getVal(f, 'Mã số nhân viên') || getVal(f, 'Mã số Nhân viên');
      if (!userId) continue;
      const emp = await prisma.employee.findUnique({ where: { userId } });
      if (!emp) continue;
      const data = {
        periodKey, isCurrent: f['Là chính sách hiện tại'] === true || getVal(f, 'Trạng thái record chính sách') === 'Đang áp dụng',
        offerSalary: getNum(f, 'Lương offer'), ratio: getNum(f, 'Tỷ lệ') || 1, baseSalary: getNum(f, 'Lương'),
        rankAllowance: getNum(f, 'Phụ cấp cấp bậc'), bpqlAllowance: getNum(f, 'Phụ cấp BPQL'),
        salesAllowance: getNum(f, 'Phụ cấp kinh doanh'), technicalAllowance: getNum(f, 'Phụ cấp kỹ thuật'),
        languageAllowance: getNum(f, 'Phụ cấp ngoại ngữ'), housingAllowance: getNum(f, 'Phụ cấp nhà ở'),
        transportAllowance: getNum(f, 'Phụ cấp đi lại'), mealAllowance: getNum(f, 'Phụ cấp ăn uống'),
        phoneAllowance: getNum(f, 'Phụ cấp điện thoại'), attendanceAllowance: getNum(f, 'Phụ cấp chuyên cần'),
        dailyRate: getNum(f, 'Lương theo ngày'), hourlyRate: getNum(f, 'Lương theo giờ'), larkRecordId: rec.record_id,
      };
      try {
        const ex = await prisma.salaryPolicy.findUnique({ where: { employeeId_periodKey: { employeeId: emp.id, periodKey } } });
        if (ex) { await prisma.salaryPolicy.update({ where: { id: ex.id }, data }); stats.salary.updated++; }
        else { await prisma.salaryPolicy.create({ data: { employeeId: emp.id, ...data } }); stats.salary.created++; }
      } catch { /* skip */ }
    }

    // Tax
    const taxRecs = await fetchAll(TABLES.TAX);
    for (const rec of taxRecs) {
      const f = rec.fields;
      const userId = getVal(f, 'Mã số nhân viên') || getVal(f, 'Mã số Nhân viên');
      if (!userId) continue;
      const emp = await prisma.employee.findUnique({ where: { userId } });
      if (!emp) continue;
      const data = {
        periodKey, isCurrent: f['Là chính sách hiện tại'] === true,
        personalDeduction: getNum(f, 'Giảm trừ bản thân') || 15500000,
        dependents: Math.round(getNum(f, 'Số người phụ thuộc')),
        dependentDeduction: getNum(f, 'Giảm trừ người phụ thuộc'),
        taxCode: getVal(f, 'Mã số thuế'), larkRecordId: rec.record_id,
      };
      try {
        const ex = await prisma.taxPolicy.findUnique({ where: { employeeId_periodKey: { employeeId: emp.id, periodKey } } });
        if (ex) { await prisma.taxPolicy.update({ where: { id: ex.id }, data }); stats.tax.updated++; }
        else { await prisma.taxPolicy.create({ data: { employeeId: emp.id, ...data } }); stats.tax.created++; }
      } catch { /* skip */ }
    }

    // Insurance
    const insRecs = await fetchAll(TABLES.INSURANCE);
    for (const rec of insRecs) {
      const f = rec.fields;
      const userId = getVal(f, 'Mã số nhân viên') || getVal(f, 'Mã số Nhân viên');
      if (!userId) continue;
      const emp = await prisma.employee.findUnique({ where: { userId } });
      if (!emp) continue;
      const data = {
        periodKey, isCurrent: f['Là chính sách hiện tại'] === true,
        insuranceBasis: getNum(f, 'Lương offer dùng tính BH') || getNum(f, 'Lương offer snapshot'),
        bhxhEmployee: getNum(f, 'BHXH NLĐ snapshot') || getNum(f, 'BHXH (8%)'),
        bhytEmployee: getNum(f, 'BHYT NLĐ snapshot') || getNum(f, 'BHYT (1.5%)'),
        bhtnEmployee: getNum(f, 'BHTN NLĐ snapshot') || getNum(f, 'BHTN (1%)'),
        totalEmployee: getNum(f, 'Tổng BH NLĐ snapshot'),
        bhxhEmployer: getNum(f, 'BHXH DN snapshot') || getNum(f, 'BHXH (17.5%)'),
        bhytEmployer: getNum(f, 'BHYT DN snapshot') || getNum(f, 'BHYT DN (3%)'),
        bhtnEmployer: getNum(f, 'BHTN DN snapshot') || getNum(f, 'BHTN DN (1%)'),
        totalEmployer: getNum(f, 'Tổng BH DN snapshot'),
        grandTotal: getNum(f, 'Tổng chi phí BH snapshot'), larkRecordId: rec.record_id,
      };
      try {
        const ex = await prisma.insurancePolicy.findUnique({ where: { employeeId_periodKey: { employeeId: emp.id, periodKey } } });
        if (ex) { await prisma.insurancePolicy.update({ where: { id: ex.id }, data }); stats.insurance.updated++; }
        else { await prisma.insurancePolicy.create({ data: { employeeId: emp.id, ...data } }); stats.insurance.created++; }
      } catch { /* skip */ }
    }

    await prisma.syncJob.create({
      data: {
        jobType: 'POLICIES_BASE', direction: 'INBOUND', status: 'COMPLETED',
        finishedAt: new Date(),
        recordsProcessed: salaryRecs.length + taxRecs.length + insRecs.length,
        recordsCreated: stats.salary.created + stats.tax.created + stats.insurance.created,
        recordsUpdated: stats.salary.updated + stats.tax.updated + stats.insurance.updated,
        metadata: { stats, periodKey },
      },
    });

    return res.json({ success: true, data: { periodKey, stats } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Sync] Policies sync error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/sync/status
 * Get latest sync status for each job type
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const jobTypes = ['EMPLOYEES_ADMIN', 'ATTENDANCE_SYNC', 'APPROVAL_SYNC', 'POLICIES_BASE', 'OUTBOUND_ATTENDANCE'];
    const statuses: Record<string, string | null> = {};

    for (const jt of jobTypes) {
      const job = await prisma.syncJob.findFirst({
        where: { jobType: jt, status: 'COMPLETED' },
        orderBy: { startedAt: 'desc' },
        select: { finishedAt: true },
      });
      statuses[jt] = job?.finishedAt?.toISOString() || null;
    }

    return res.json({
      lastEmployeeSync: statuses['EMPLOYEES_ADMIN'],
      lastAttendanceSync: statuses['ATTENDANCE_SYNC'],
      lastApprovalSync: statuses['APPROVAL_SYNC'],
      lastPoliciesSync: statuses['POLICIES_BASE'],
      lastOutboundSync: statuses['OUTBOUND_ATTENDANCE'],
    });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
