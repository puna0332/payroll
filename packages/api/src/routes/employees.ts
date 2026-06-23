/**
 * Employee Routes — CRUD & query endpoints
 * Frontend gọi duy nhất từ đây — data từ database
 */

import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../shared/db/prisma.js';
import { belongsToPeriodByJoinDate } from '../shared/utils/employment-period.js';
import { env } from '../config/env.js';

const router = Router();

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizePolicyPeriodKey(value: unknown): string {
  const raw = typeof value === 'string' && value.trim()
    ? value.trim()
    : new Date().toISOString().slice(0, 7);
  return raw.length === 6 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw.slice(0, 7);
}

function periodKeyToMonthKey(periodKey: string): string {
  return periodKey.replace('-', '').slice(0, 6);
}

function monthKeyToPolicyPeriodKey(monthKey: string): string {
  return `${monthKey.slice(0, 4)}-${monthKey.slice(4, 6)}`;
}

async function resolveEditablePolicyPeriodKey(requestedValue: unknown): Promise<string> {
  const requestedPeriodKey = normalizePolicyPeriodKey(requestedValue);
  const requestedMonthKey = periodKeyToMonthKey(requestedPeriodKey);
  const requestedPeriod = await prisma.payrollPeriod.findUnique({
    where: { monthKey: requestedMonthKey },
    select: { monthKey: true, status: true },
  });

  if (!requestedPeriod || requestedPeriod.status === 'OPEN') {
    return requestedPeriodKey;
  }

  const latestOpenPeriod = await prisma.payrollPeriod.findFirst({
    where: { status: 'OPEN' },
    orderBy: { monthKey: 'desc' },
    select: { monthKey: true },
  });

  return latestOpenPeriod ? monthKeyToPolicyPeriodKey(latestOpenPeriod.monthKey) : requestedPeriodKey;
}

function normalizeDateKey(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

async function syncEmployeeToHrBase(employeeId: string): Promise<{
  status: 'ok' | 'skipped' | 'error';
  data?: unknown;
  message?: string;
}> {
  if (!env.LARK_APP_ID || (!env.LARK_HR_APP_TOKEN && !env.LARK_APP_TOKEN)) {
    return { status: 'skipped', message: 'HR Base sync is not configured' };
  }

  try {
    const { syncEmployeesToHrBase } = await import('../modules/sync/sync-employees-outbound.js');
    const { LarkBaseClient } = await import('../shared/lark/base.js');
    const { getLarkHrConfig } = await import('../shared/lark/config.js');
    const hrBase = new LarkBaseClient(getLarkHrConfig());
    const result = await syncEmployeesToHrBase(prisma, hrBase, { employeeIds: [employeeId] });
    if (result.errors > 0) {
      return { status: 'error', data: result, message: 'HR Base sync completed with errors' };
    }
    return { status: 'ok', data: result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Route:Employee] HR Base sync failed for ${employeeId}:`, message);
    return { status: 'error', message };
  }
}

type SalaryManualOverrideClearResult = {
  changed: boolean;
  removedKeys: string[];
};

function clearSalaryFieldsFromFullBreakdown(fullBreakdown: unknown): {
  changed: boolean;
  removedKeys: string[];
  nextFullBreakdown: Record<string, unknown>;
} {
  if (!isRecord(fullBreakdown) || !isRecord(fullBreakdown.manualOverrides)) {
    return { changed: false, removedKeys: [], nextFullBreakdown: isRecord(fullBreakdown) ? { ...fullBreakdown } : {} };
  }

  const manualOverrides = { ...fullBreakdown.manualOverrides };
  const removedKeys: string[] = [];

  if ('baseSalary' in manualOverrides) {
    delete manualOverrides.baseSalary;
    removedKeys.push('baseSalary');
  }

  if ('allowances' in manualOverrides) {
    delete manualOverrides.allowances;
    removedKeys.push('allowances');
  }

  if (removedKeys.length === 0) {
    return { changed: false, removedKeys, nextFullBreakdown: { ...fullBreakdown } };
  }

  const nextFullBreakdown = { ...fullBreakdown };
  if (Object.keys(manualOverrides).length > 0) {
    nextFullBreakdown.manualOverrides = manualOverrides;
  } else {
    delete nextFullBreakdown.manualOverrides;
  }

  return { changed: true, removedKeys, nextFullBreakdown };
}

async function clearSalaryManualOverrides(employeeId: string, periodId: string): Promise<SalaryManualOverrideClearResult> {
  const payslip = await prisma.payslip.findUnique({
    where: { employeeId_periodId: { employeeId, periodId } },
    select: { fullBreakdown: true },
  });

  const cleared = clearSalaryFieldsFromFullBreakdown(payslip?.fullBreakdown);
  if (!payslip || !cleared.changed) {
    return { changed: false, removedKeys: [] };
  }

  await prisma.payslip.update({
    where: { employeeId_periodId: { employeeId, periodId } },
    data: {
      fullBreakdown: cleared.nextFullBreakdown as Prisma.InputJsonValue,
    },
  });

  return { changed: true, removedKeys: cleared.removedKeys };
}

async function recalculateEmployeePayslip(
  employeeId: string,
  periodKey: string,
  options: { clearSalaryOverrides?: boolean } = {},
) {
  const monthKey = periodKeyToMonthKey(periodKey);
  const period = await prisma.payrollPeriod.findFirst({
    where: { monthKey },
    orderBy: { periodEnd: 'desc' },
  });

  if (!period) {
    return { status: 'skipped' as const, reason: `Không tìm thấy kỳ lương ${monthKey}` };
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { joinDate: true },
  });

  if (employee && !belongsToPeriodByJoinDate(period.periodEnd, employee.joinDate)) {
    await prisma.$transaction([
      prisma.payslip.deleteMany({ where: { employeeId, periodId: period.id } }),
      prisma.monthlyAttendance.deleteMany({ where: { employeeId, periodId: period.id } }),
    ]);
    return { status: 'skipped' as const, reason: 'Kỳ lương trước ngày vào công ty', periodId: period.id };
  }

  const attendance = await prisma.monthlyAttendance.findUnique({
    where: { employeeId_periodId: { employeeId, periodId: period.id } },
    select: { id: true },
  });

  if (!attendance) {
    return { status: 'skipped' as const, reason: 'Nhân sự chưa có bảng công tháng này', periodId: period.id };
  }

  const clearedManualOverrides = options.clearSalaryOverrides
    ? await clearSalaryManualOverrides(employeeId, period.id)
    : { changed: false, removedKeys: [] };

  const { calculatePayslip } = await import('../modules/payroll/payslip-calculator.js');
  const result = await calculatePayslip(employeeId, period.id, prisma);

  let sheetSync: { status: 'skipped' | 'ok' | 'error'; message?: string; url?: string } = { status: 'skipped' };
  if (period.larkSheetToken) {
    try {
      const { exportPayrollSheetToLark } = await import('../modules/payroll/export-payroll-sheet.js');
      const syncResult = await exportPayrollSheetToLark(period.id);
      sheetSync = { status: 'ok', url: syncResult.url };
    } catch (syncError: unknown) {
      const message = syncError instanceof Error ? syncError.message : String(syncError);
      console.warn('[Route:Employee] Payroll sheet sync after policy update failed:', message);
      sheetSync = { status: 'error', message };
    }
  }

  return { status: 'ok' as const, periodId: period.id, monthKey, result, sheetSync, clearedManualOverrides };
}

async function recalculateOpenEmployeePayslips(employeeId: string): Promise<{ processed: number; errors: number }> {
  const periods = await prisma.payrollPeriod.findMany({
    where: {
      status: 'OPEN',
      monthlyAttendances: { some: { employeeId } },
    },
    select: { id: true, monthKey: true, periodEnd: true },
    orderBy: { monthKey: 'desc' },
  });

  if (periods.length === 0) return { processed: 0, errors: 0 };

  const { calculatePayslip } = await import('../modules/payroll/payslip-calculator.js');
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { joinDate: true },
  });
  let processed = 0;
  let errors = 0;

  for (const period of periods) {
    try {
      if (employee && !belongsToPeriodByJoinDate(period.periodEnd, employee.joinDate)) {
        await prisma.$transaction([
          prisma.payslip.deleteMany({ where: { employeeId, periodId: period.id } }),
          prisma.monthlyAttendance.deleteMany({ where: { employeeId, periodId: period.id } }),
        ]);
        continue;
      }

      await calculatePayslip(employeeId, period.id, prisma);
      processed++;
    } catch (error: unknown) {
      errors++;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Route:Employee] Recalculate open payslip failed for ${employeeId}/${period.monthKey}:`, message);
    }
  }

  return { processed, errors };
}

/**
 * GET /api/employees
 * Lấy danh sách nhân viên từ database
 * Query params: status, department, search
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, department, search } = req.query;

    const where: Record<string, unknown> = {};

    if (status && typeof status === 'string') {
      where.status = status;
    }

    if (department && typeof department === 'string') {
      where.department = department;
    }

    if (search && typeof search === 'string') {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { userId: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const employees = await prisma.employee.findMany({
      where,
      orderBy: { fullName: 'asc' },
    });

    return res.json(employees);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Employee] List error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/employees/stats
 * Thống kê nhanh — dùng cho Dashboard
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [total, active, departments] = await Promise.all([
      prisma.employee.count(),
      prisma.employee.count({ where: { status: 'ACTIVE' } }),
      prisma.employee.groupBy({
        by: ['department'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
    ]);

    // Latest employee
    const newest = await prisma.employee.findFirst({
      orderBy: { joinDate: 'desc' },
      where: { joinDate: { not: null } },
      select: { fullName: true, joinDate: true, department: true },
    });

    return res.json({
      total,
      active,
      inactive: total - active,
      departments: departments.map(d => ({
        name: d.department,
        count: d._count.id,
      })),
      newest: newest ? {
        name: newest.fullName,
        joinDate: newest.joinDate,
        department: newest.department,
      } : null,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/employees/:id/attendance
 * Lấy danh sách chấm công tháng — include PayrollPeriod
 */
router.get('/:id/attendance', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return res.status(404).json({ error: 'Nhân viên không tồn tại' });

    const attendances = await prisma.monthlyAttendance.findMany({
      where: { employeeId: id },
      include: {
        period: {
          select: { label: true, monthKey: true, status: true, periodEnd: true },
        },
      },
      orderBy: { period: { monthKey: 'desc' } },
    });

    return res.json(attendances.filter((item) => belongsToPeriodByJoinDate(item.period.periodEnd, employee.joinDate)));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Employee] Attendance error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/employees/:id/payslips
 * Lấy danh sách phiếu lương — include PayrollPeriod
 */
router.get('/:id/payslips', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return res.status(404).json({ error: 'Nhân viên không tồn tại' });

    const payslips = await prisma.payslip.findMany({
      where: { employeeId: id },
      include: {
        period: {
          select: { label: true, monthKey: true, status: true, periodEnd: true },
        },
      },
      orderBy: { period: { monthKey: 'desc' } },
    });

    return res.json(payslips.filter((item) => belongsToPeriodByJoinDate(item.period.periodEnd, employee.joinDate)));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Employee] Payslips error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/employees/:id/leave-balance
 * Lấy số dư phép của nhân viên — ordered by monthKey DESC
 */
router.get('/:id/leave-balance', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return res.status(404).json({ error: 'Nhân viên không tồn tại' });

    const leaveBalances = await prisma.leaveBalance.findMany({
      where: { employeeId: id },
      orderBy: { monthKey: 'desc' },
    });

    return res.json(leaveBalances);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Employee] Leave-balance error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/employees/:id/full
 * Lấy toàn bộ dữ liệu nhân viên + tất cả relations
 */
router.get('/:id/full', async (req: Request, res: Response) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id as string },
      include: {
        salaryPolicies: { where: { isCurrent: true }, orderBy: [{ periodKey: 'desc' }, { createdAt: 'desc' }], take: 1 },
        insurancePolicies: { where: { isCurrent: true }, orderBy: [{ periodKey: 'desc' }, { createdAt: 'desc' }], take: 1 },
        taxPolicies: { where: { isCurrent: true }, orderBy: [{ periodKey: 'desc' }, { createdAt: 'desc' }], take: 1 },
        monthlyAttendances: {
          include: {
            period: { select: { id: true, label: true, monthKey: true, status: true, periodStart: true, periodEnd: true } },
          },
          orderBy: { period: { monthKey: 'desc' } },
          take: 12,
        },
        payslips: {
          include: {
            period: { select: { id: true, label: true, monthKey: true, status: true, periodStart: true, periodEnd: true } },
          },
          orderBy: { period: { monthKey: 'desc' } },
          take: 12,
        },
        otMonthlies: {
          include: {
            period: { select: { id: true, label: true, monthKey: true, status: true, periodStart: true, periodEnd: true } },
          },
          orderBy: { period: { monthKey: 'desc' } },
          take: 12,
        },
        leaveBalances: { orderBy: { monthKey: 'desc' }, take: 12 },
      },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Nhân viên không tồn tại' });
    }

    return res.json({
      ...employee,
      monthlyAttendances: employee.monthlyAttendances.filter((item) => belongsToPeriodByJoinDate(item.period.periodEnd, employee.joinDate)),
      payslips: employee.payslips.filter((item) => belongsToPeriodByJoinDate(item.period.periodEnd, employee.joinDate)),
      otMonthlies: employee.otMonthlies.filter((item) => belongsToPeriodByJoinDate(item.period.periodEnd, employee.joinDate)),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Route:Employee] Full profile error:', msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/employees/:id/history
 * Lịch sử chỉnh sửa nhân viên (audit log) — paginated
 * Query params: page (default 1), limit (default 20)
 * Trả về tất cả bảng liên quan (employees, salary, insurance, tax...)
 */
router.get('/:id/history', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const where = { recordId: req.params.id as string };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { changedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    // BigInt id → string for JSON serialization
    const serialized = logs.map(l => ({ ...l, id: l.id.toString() }));
    return res.json({
      data: serialized,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/employees/:id
 * Lấy chi tiết 1 nhân viên + policies hiện tại
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id as string },
      include: {
        salaryPolicies: { where: { isCurrent: true }, orderBy: [{ periodKey: 'desc' }, { createdAt: 'desc' }], take: 1 },
        insurancePolicies: { where: { isCurrent: true }, orderBy: [{ periodKey: 'desc' }, { createdAt: 'desc' }], take: 1 },
        taxPolicies: { where: { isCurrent: true }, orderBy: [{ periodKey: 'desc' }, { createdAt: 'desc' }], take: 1 },
      },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Nhân viên không tồn tại' });
    }

    return res.json(employee);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: msg });
  }
});

/**
 * PUT /api/employees/:id
 * Cập nhật thông tin cơ bản nhân viên (inline edit) + audit log
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return res.status(404).json({ error: 'Nhân viên không tồn tại' });

    const allowedFields = [
      'fullName', 'position', 'department', 'email', 'mobile',
      'employmentType', 'scheduleType', 'status', 'larkMetadata',
    ];

    if (req.body.employmentType === 'P') {
      const metadata = req.body.larkMetadata && typeof req.body.larkMetadata === 'object'
        ? req.body.larkMetadata as Record<string, unknown>
        : {};
      const probationStart = normalizeDateKey(metadata.probationStart);
      const probationEnd = normalizeDateKey(metadata.probationEnd);
      if (!probationStart || !probationEnd) {
        return res.status(400).json({ error: 'Nhân sự thử việc cần có đủ thời gian thử việc từ ngày/đến ngày.' });
      }
      if (probationEnd < probationStart) {
        return res.status(400).json({ error: 'Ngày kết thúc thử việc không được trước ngày bắt đầu.' });
      }
    }

    const data: Record<string, unknown> = {};
    const oldData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined && req.body[field] !== (employee as Record<string, unknown>)[field]) {
        data[field] = req.body[field];
        oldData[field] = (employee as Record<string, unknown>)[field];
      }
    }

    if (Object.keys(data).length === 0) {
      return res.json({ success: true, data: employee, changed: 0 });
    }

    const [updated] = await prisma.$transaction([
      prisma.employee.update({ where: { id }, data }),
      prisma.auditLog.create({
        data: {
          tableName: 'employees',
          recordId: id,
          action: 'UPDATE',
          oldData: oldData as any,
          newData: data as any,
          changedBy: 'admin',
        },
      }),
    ]);

    const shouldRecalculatePayroll = 'employmentType' in data || 'larkMetadata' in data;
    const payrollRecalculation = shouldRecalculatePayroll
      ? await recalculateOpenEmployeePayslips(id)
      : { processed: 0, errors: 0 };
    const hrBaseSync = await syncEmployeeToHrBase(id);

    return res.json({
      success: true,
      data: updated,
      changed: Object.keys(data).length,
      payrollRecalculation,
      hrBaseSync,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: msg });
  }
});


/**
 * PUT /api/employees/:id/salary
 * Cập nhật / tạo salary policy cho nhân viên
 */
router.put('/:id/salary', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return res.status(404).json({ error: 'Nhân viên không tồn tại' });

    const periodKey = await resolveEditablePolicyPeriodKey(req.body.periodKey);
    const previous = await prisma.salaryPolicy.findFirst({
      where: { employeeId: id, isCurrent: true },
      orderBy: { createdAt: 'desc' },
    });
    const data = {
      periodKey,
      isCurrent: true,
      offerSalary: toNumber(req.body.offerSalary),
      ratio: toNumber(req.body.ratio, 1),
      baseSalary: toNumber(req.body.baseSalary),
      rankAllowance: toNumber(req.body.rankAllowance),
      bpqlAllowance: 0,
      salesAllowance: 0,
      technicalAllowance: toNumber(req.body.technicalAllowance),
      languageAllowance: toNumber(req.body.languageAllowance),
      housingAllowance: toNumber(req.body.housingAllowance),
      transportAllowance: toNumber(req.body.transportAllowance),
      mealAllowance: toNumber(req.body.mealAllowance),
      phoneAllowance: toNumber(req.body.phoneAllowance),
      attendanceAllowance: toNumber(req.body.attendanceAllowance),
      dailyRate: toNumber(req.body.dailyRate),
      hourlyRate: toNumber(req.body.hourlyRate),
    };

    const salary = await prisma.salaryPolicy.upsert({
      where: { employeeId_periodKey: { employeeId: id, periodKey } },
      create: {
        employeeId: id,
        ...data,
      },
      update: data,
    });

    const recalc = await recalculateEmployeePayslip(id, periodKey, { clearSalaryOverrides: true });

    await prisma.auditLog.create({
      data: {
        tableName: 'salary_policies',
        recordId: id,
        action: 'UPDATE',
        oldData: previous ? (previous as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        newData: data as unknown as Prisma.InputJsonValue,
        changedBy: 'C&B',
      },
    });

    return res.json({ success: true, data: salary, recalc });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * PUT /api/employees/:id/insurance
 * Cập nhật / tạo insurance policy cho nhân viên
 */
router.put('/:id/insurance', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return res.status(404).json({ error: 'Nhân viên không tồn tại' });

    const periodKey = await resolveEditablePolicyPeriodKey(req.body.periodKey);
    const previous = await prisma.insurancePolicy.findFirst({
      where: { employeeId: id, isCurrent: true },
      orderBy: { createdAt: 'desc' },
    });
    const data = {
      periodKey,
      isCurrent: true,
      insuranceBasis: toNumber(req.body.insuranceBasis),
      bhxhEmployee: toNumber(req.body.bhxhEmployee),
      bhytEmployee: toNumber(req.body.bhytEmployee),
      bhtnEmployee: toNumber(req.body.bhtnEmployee),
      totalEmployee: toNumber(req.body.totalEmployee),
      bhxhEmployer: toNumber(req.body.bhxhEmployer),
      bhytEmployer: toNumber(req.body.bhytEmployer),
      bhtnEmployer: toNumber(req.body.bhtnEmployer),
      totalEmployer: toNumber(req.body.totalEmployer),
      grandTotal: toNumber(req.body.grandTotal),
    };

    const insurance = await prisma.insurancePolicy.upsert({
      where: { employeeId_periodKey: { employeeId: id, periodKey } },
      create: {
        employeeId: id,
        ...data,
      },
      update: data,
    });

    const recalc = await recalculateEmployeePayslip(id, periodKey);

    await prisma.auditLog.create({
      data: {
        tableName: 'insurance_policies',
        recordId: id,
        action: 'UPDATE',
        oldData: previous ? (previous as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        newData: data as unknown as Prisma.InputJsonValue,
        changedBy: 'C&B',
      },
    });

    return res.json({ success: true, data: insurance, recalc });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * PUT /api/employees/:id/tax
 * Cập nhật / tạo tax policy cho nhân viên
 */
router.put('/:id/tax', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return res.status(404).json({ error: 'Nhân viên không tồn tại' });

    const periodKey = await resolveEditablePolicyPeriodKey(req.body.periodKey);
    const previous = await prisma.taxPolicy.findFirst({
      where: { employeeId: id, isCurrent: true },
      orderBy: { createdAt: 'desc' },
    });
    const dependents = Math.max(0, Math.trunc(toNumber(req.body.dependents)));
    const data = {
      periodKey,
      isCurrent: true,
      personalDeduction: toNumber(req.body.personalDeduction, 11_000_000),
      dependents,
      dependentDeduction: toNumber(req.body.dependentDeduction),
      taxCode: typeof req.body.taxCode === 'string' && req.body.taxCode.trim() ? req.body.taxCode.trim() : null,
    };

    const tax = await prisma.taxPolicy.upsert({
      where: { employeeId_periodKey: { employeeId: id, periodKey } },
      create: {
        employeeId: id,
        ...data,
      },
      update: data,
    });

    const recalc = await recalculateEmployeePayslip(id, periodKey);

    await prisma.auditLog.create({
      data: {
        tableName: 'tax_policies',
        recordId: id,
        action: 'UPDATE',
        oldData: previous ? (previous as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        newData: data as unknown as Prisma.InputJsonValue,
        changedBy: 'C&B',
      },
    });

    return res.json({ success: true, data: tax, recalc });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
