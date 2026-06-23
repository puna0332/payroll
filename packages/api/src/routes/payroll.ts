/**
 * Payroll Routes — Payslip listing, calculation, close process
 * Quản lý tính lương, chốt công, và xem phiếu lương
 */

import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../shared/db/prisma.js';
import { Decimal } from '@prisma/client/runtime/library';
import { exportOtSheetToLark } from '../modules/payroll/export-ot-sheet.js';
import { exportPayrollSheetToLark } from '../modules/payroll/export-payroll-sheet.js';
import { buildPayslipHtml, generatePayslipPdf, payslipPdfFileName, type PayslipHrNoteAttachment } from '../modules/payroll/payslip-pdf.js';
import { updateAllLeaveBalances } from '../modules/leave/balance.js';
import { LarkBaseClient } from '../shared/lark/base.js';
import { getLarkConfig, TABLE_IDS } from '../shared/lark/config.js';
import type { LarkFieldValue, LarkRecordFields } from '../shared/lark/types.js';
import { belongsToPeriodByJoinDate } from '../shared/utils/employment-period.js';


const MODULE = '[Routes:Payroll]';
const router = Router();

type TimesheetGroupKey = 'expats' | 'indirect' | 'equipment' | 'other';

const TIMESHEET_EMPLOYEE_ORDER = [
  'ASV001',
  'ASV013',
  'ASV002',
  'ASV003',
  'ASV010',
  'ASV011',
  'ASV014',
  'ASV022',
  'ASV024',
  'ASV005',
  'ASV008',
  'ASV016',
  'ASV017',
  'ASV018',
  'ASV023',
] as const;

const TIMESHEET_EMPLOYEE_NAME_OVERRIDES: Record<string, string> = {
  ASV001: 'TANAKA KIIICHIRO',
  ASV013: 'HOSHIHARA SHINICHI',
  ASV002: 'TRAN HOANG BAO TRAN',
  ASV003: 'NGUYEN NGOC TRAM',
  ASV010: 'Nguyễn Văn Hải',
  ASV011: 'Nguyễn Văn Cảnh',
  ASV014: 'Nguyễn Thị Thu Trang',
  ASV022: 'Văn Hậu',
  ASV024: 'Dương Văn Sử',
  ASV005: 'NGUYEN XUAN TAI',
  ASV008: 'Nguyễn Đức Huân',
  ASV016: 'Lê Ngọc Khánh',
  ASV017: 'Hà Minh Châu',
  ASV018: 'Phan Anh Hùng',
  ASV023: 'Vũ Thị Thanh Ngọc',
};

const TIMESHEET_GROUP_BY_CODE: Record<string, TimesheetGroupKey> = {
  ASV001: 'expats',
  ASV013: 'expats',
  ASV002: 'indirect',
  ASV003: 'indirect',
  ASV010: 'indirect',
  ASV011: 'indirect',
  ASV014: 'indirect',
  ASV022: 'indirect',
  ASV024: 'indirect',
  ASV005: 'equipment',
  ASV008: 'equipment',
  ASV016: 'equipment',
  ASV017: 'equipment',
  ASV018: 'equipment',
  ASV023: 'equipment',
};

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') {
    throw new Error(`Route param ${name} is required`);
  }
  return value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Decimal) return value.toNumber();
  if (typeof value === 'object' && 'toNumber' in value && typeof (value as Record<string, unknown>).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function avatarFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const meta = metadata as Record<string, unknown>;
  return typeof meta.avatarUrl === 'string' ? meta.avatarUrl : null;
}

function normalizeStaffCode(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const match = value.trim().match(/^ASV0*(\d+)$/i);
    if (!match) continue;
    return `ASV${match[1].padStart(3, '0')}`;
  }
  return null;
}

function resolveTimesheetGroup(staffCode: string | null, department: unknown): TimesheetGroupKey | null {
  if (staffCode && TIMESHEET_GROUP_BY_CODE[staffCode]) return TIMESHEET_GROUP_BY_CODE[staffCode];
  if (typeof department !== 'string') return staffCode ? 'other' : null;

  const dept = department.trim().toLowerCase();
  if (!dept) return staffCode ? 'other' : null;
  if (dept === 'bod' || dept.includes('ban giám đốc')) return 'expats';
  if (dept.includes('ttvt') || dept.includes('機材') || dept.includes('kho') || dept.includes('thiết bị')) return 'equipment';
  if (dept.includes('bpql') || dept.includes('pkd') || dept.includes('管理') || dept.includes('営業')) return 'indirect';
  return staffCode ? 'other' : null;
}

function resolveTimesheetSortIndex(staffCode: string | null, fullName: string | null | undefined): number {
  if (staffCode) {
    const fixedIndex = TIMESHEET_EMPLOYEE_ORDER.indexOf(staffCode as typeof TIMESHEET_EMPLOYEE_ORDER[number]);
    if (fixedIndex >= 0) return fixedIndex;

    const numericMatch = staffCode.match(/\d+/);
    if (numericMatch) return TIMESHEET_EMPLOYEE_ORDER.length + Number(numericMatch[0]) / 1000;
  }

  const nameRank = (fullName ?? '').trim().toLowerCase().charCodeAt(0) || 999;
  return TIMESHEET_EMPLOYEE_ORDER.length + 100 + nameRank / 1000;
}

function normalizeBucketBreakdown(value: unknown): Record<string, { hours: number; amount: number }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, { hours: number; amount: number }>>((acc, [bucket, detail]) => {
    if (!detail || typeof detail !== 'object') return acc;
    const raw = detail as Record<string, unknown>;
    acc[bucket] = {
      hours: toNumber(raw.hours),
      amount: toNumber(raw.amount),
    };
    return acc;
  }, {});
}

function larkText(value: LarkFieldValue | undefined): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => larkText(item)).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const text = value.text;
    return typeof text === 'string' ? text : '';
  }
  return '';
}

function larkBool(value: LarkFieldValue | undefined): boolean {
  return typeof value === 'boolean' ? value : false;
}

function larkNumber(value: LarkFieldValue | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  return 0;
}

function larkAttachment(value: LarkFieldValue | undefined): Array<{ name: string; url: string; fileToken: string | null; type: string | null; size: number | null }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : 'Phiếu lương PDF',
      url: typeof item.tmp_url === 'string' ? item.tmp_url : typeof item.url === 'string' ? item.url : '',
      fileToken: typeof item.file_token === 'string' ? item.file_token : null,
      type: typeof item.type === 'string' ? item.type : null,
      size: typeof item.size === 'number' ? item.size : null,
    }))
    .filter((item) => item.url);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanEditableNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} phải là số hợp lệ`);
  }
  if (field !== 'afterTaxAdjustment' && parsed < 0) {
    throw new Error(`${field} không được nhỏ hơn 0`);
  }
  return parsed;
}

function deepCloneRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? JSON.parse(JSON.stringify(value)) as Record<string, unknown> : {};
}

function readManualOverrides(fullBreakdown: unknown): Record<string, unknown> {
  if (!isRecord(fullBreakdown) || !isRecord(fullBreakdown.manualOverrides)) return {};
  return deepCloneRecord(fullBreakdown.manualOverrides);
}

function readManualEditLogs(fullBreakdown: unknown): unknown[] {
  if (!isRecord(fullBreakdown) || !Array.isArray(fullBreakdown.manualEditLogs)) return [];
  return [...fullBreakdown.manualEditLogs];
}

function readPayrollSegments(fullBreakdown: unknown): Record<string, unknown>[] {
  if (!isRecord(fullBreakdown) || !Array.isArray(fullBreakdown.payrollSegments)) return [];
  return fullBreakdown.payrollSegments.filter(isRecord);
}

function validatePayslipHrAttachments(value: unknown): PayslipHrNoteAttachment[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error('attachments phải là mảng');
  }
  if (value.length > 4) {
    throw new Error('Mỗi phiếu lương chỉ hỗ trợ tối đa 4 ảnh ghi chú HR');
  }

  return value.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new Error(`Ảnh ghi chú HR #${index + 1} không hợp lệ`);
    }
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 160) : `Ảnh ghi chú HR ${index + 1}`;
    const type = typeof raw.type === 'string' ? raw.type : '';
    const dataUrl = typeof raw.dataUrl === 'string' ? raw.dataUrl : '';
    const size = typeof raw.size === 'number' && Number.isFinite(raw.size) ? raw.size : undefined;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) {
      throw new Error(`Ảnh ${name} phải là PNG, JPG hoặc WEBP`);
    }
    if (!dataUrl.startsWith(`data:${type};base64,`)) {
      throw new Error(`Ảnh ${name} thiếu data URL hợp lệ`);
    }
    if ((size ?? 0) > 2_500_000 || dataUrl.length > 3_800_000) {
      throw new Error(`Ảnh ${name} vượt quá 2.5MB`);
    }
    return {
      id: typeof raw.id === 'string' ? raw.id : `${Date.now()}-${index}`,
      name,
      type,
      size,
      dataUrl,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    };
  });
}

function segmentValue(segment: Record<string, unknown>, field: string, fallback: unknown): unknown {
  return field in segment ? segment[field] : fallback;
}

function applyPayrollOverridePayload(
  current: Record<string, unknown>,
  payload: Record<string, unknown>,
): { next: Record<string, unknown>; changes: Record<string, { oldValue: unknown; newValue: unknown }> } {
  const next = deepCloneRecord(current);
  const changes: Record<string, { oldValue: unknown; newValue: unknown }> = {};
  const simpleFields = ['standardDays', 'actualDays', 'baseSalary', 'otTotalAmount', 'afterTaxAdjustment'];
  const allowanceFields = ['rank', 'technical', 'language', 'housing', 'transport', 'meal', 'phone', 'attendance'];
  const otHourFields = ['weekday', 'weekdayNight', 'weekend', 'holiday', 'untilNight', 'nightNormal', 'nightWeekend'];

  for (const field of simpleFields) {
    if (!(field in payload)) continue;
    const oldValue = next[field] ?? null;
    const newValue = cleanEditableNumber(payload[field], field);
    if (newValue === null) {
      delete next[field];
    } else {
      next[field] = newValue;
    }
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes[field] = { oldValue, newValue };
    }
  }

  if ('allowances' in payload) {
    if (payload.allowances !== null && !isRecord(payload.allowances)) {
      throw new Error('allowances phải là object');
    }
    const currentAllowances = isRecord(next.allowances) ? deepCloneRecord(next.allowances) : {};
    const incomingAllowances = isRecord(payload.allowances) ? payload.allowances : {};

    for (const field of allowanceFields) {
      if (!(field in incomingAllowances)) continue;
      const path = `allowances.${field}`;
      const oldValue = currentAllowances[field] ?? null;
      const newValue = cleanEditableNumber(incomingAllowances[field], path);
      if (newValue === null) {
        delete currentAllowances[field];
      } else {
        currentAllowances[field] = newValue;
      }
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes[path] = { oldValue, newValue };
      }
    }

    if (Object.keys(currentAllowances).length > 0) {
      next.allowances = currentAllowances;
    } else {
      delete next.allowances;
    }
  }

  if ('otHours' in payload) {
    if (payload.otHours !== null && !isRecord(payload.otHours)) {
      throw new Error('otHours phải là object');
    }
    const currentOtHours = isRecord(next.otHours) ? deepCloneRecord(next.otHours) : {};
    const incomingOtHours = isRecord(payload.otHours) ? payload.otHours : {};

    for (const field of otHourFields) {
      if (!(field in incomingOtHours)) continue;
      const path = `otHours.${field}`;
      const oldValue = currentOtHours[field] ?? null;
      const newValue = cleanEditableNumber(incomingOtHours[field], path);
      if (newValue === null) {
        delete currentOtHours[field];
      } else {
        currentOtHours[field] = newValue;
      }
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes[path] = { oldValue, newValue };
      }
    }

    if (Object.keys(currentOtHours).length > 0) {
      next.otHours = currentOtHours;
    } else {
      delete next.otHours;
    }
  }

  return { next, changes };
}

// ─── GET /api/payroll — List payslips for a period ──────────

/**
 * GET /api/payroll?periodId=xxx
 * Danh sách phiếu lương theo kỳ — include employee + attendance + taxPolicy + leaveBalance
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { periodId } = req.query;

    if (!periodId || typeof periodId !== 'string') {
      return res.status(400).json({
        status: 'error',
        message: 'periodId query param là bắt buộc',
      });
    }

    // Fetch period info to compute monthKey for leave balance lookup
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { monthKey: true, periodEnd: true },
    });
    const monthKey = period?.monthKey ?? null;

    const payslips = await prisma.payslip.findMany({
      where: { periodId },
      include: { employee: true },
    });

    if (payslips.length === 0) {
      return res.json({ status: 'ok', data: [] });
    }

    const employeeIds = payslips.map((p) => p.employeeId);

    // Fetch supplemental data in parallel
    const [attendances, taxPolicies, leaveBalances] = await Promise.all([
      prisma.monthlyAttendance.findMany({
        where: { periodId, employeeId: { in: employeeIds } },
      }),
      prisma.taxPolicy.findMany({
        where: { employeeId: { in: employeeIds }, isCurrent: true },
        orderBy: { createdAt: 'desc' },
      }),
      monthKey
        ? prisma.leaveBalance.findMany({
            where: { employeeId: { in: employeeIds }, monthKey },
          })
        : Promise.resolve([] as Awaited<ReturnType<typeof prisma.leaveBalance.findMany>>),
    ]);

    // Build lookup maps
    const attMap = Object.fromEntries(attendances.map((a) => [a.employeeId, a]));
    const tpMap: Record<string, (typeof taxPolicies)[0]> = {};
    for (const tp of taxPolicies) {
      if (!tpMap[tp.employeeId]) tpMap[tp.employeeId] = tp;
    }
    const lbMap = Object.fromEntries(leaveBalances.map((lb) => [lb.employeeId, lb]));

    // Merge supplemental data into each payslip and align order/identity with Attendance + Timesheet.
    const enriched = payslips.flatMap<Record<string, unknown>>((p) => {
      if (period && p.employee && !belongsToPeriodByJoinDate(period.periodEnd, p.employee.joinDate)) {
        return [];
      }

      const att = attMap[p.employeeId];
      const tp = tpMap[p.employeeId];
      const lb = lbMap[p.employeeId];
      const metadata = p.employee?.larkMetadata as Record<string, unknown> | null | undefined;
      const staffCode = normalizeStaffCode(
        p.employee?.employeeCode,
        metadata?.employeeNo,
        p.employee?.userId,
      );
      const sortIndex = resolveTimesheetSortIndex(staffCode, p.employee?.fullName);
      const groupKey = resolveTimesheetGroup(staffCode, p.employee?.department);

      if (!groupKey) {
        return [];
      }

      const displayName = (staffCode ? TIMESHEET_EMPLOYEE_NAME_OVERRIDES[staffCode] : undefined) ?? p.employee?.fullName ?? 'Chưa gán nhân viên';

      const baseRow = {
        ...p,
        employee: p.employee
          ? {
              ...p.employee,
              employeeCode: staffCode ?? p.employee.employeeCode,
              fullName: displayName,
              originalFullName: p.employee.fullName,
              position: p.employee.position === 'N/A' ? null : p.employee.position,
              staffClassify: typeof metadata?.staffClassify === 'string'
                ? metadata.staffClassify
                : p.employee.employmentType,
              groupKey,
              sortIndex,
              avatarUrl: avatarFromMetadata(p.employee.larkMetadata),
            }
          : null,
        attendance: att
          ? {
            workHours: Number(att.workHours ?? 0),
            absentDays: Number(att.absentDays ?? 0),
            lateHoursBeforeLeave: Number(att.lateHoursBeforeLeave ?? 0),
            earlyHoursBeforeLeave: Number(att.earlyHoursBeforeLeave ?? 0),
            lateEarlyLeaveDeductedHours: Number(att.lateEarlyLeaveDeductedHours ?? 0),
            lateHours: Number(att.lateHours ?? 0),
            earlyHours: Number(att.earlyHours ?? 0),
              annualLeaveHours: Number(att.annualLeaveHours ?? 0),
              benefitLeaveHours: Number(att.benefitLeaveHours ?? 0),
              compLeaveHours: Number(att.compLeaveHours ?? 0),
            }
          : null,
        taxPolicyInfo: tp
          ? {
              dependents: tp.dependents,
              personalDeduction: Number(tp.personalDeduction ?? 15_500_000),
              dependentDeduction: Number(tp.dependentDeduction ?? 0),
            }
          : null,
        leaveBalance: lb
          ? {
              opening: Number(lb.opening ?? 0),
              accrued: Number(lb.accrued ?? 0),
              used: Number(lb.used ?? 0),
              lateEarlyUsed: Number(lb.lateEarlyUsed ?? 0),
              closing: Number(lb.closing ?? 0),
            }
          : null,
      };
      const segments = readPayrollSegments(p.fullBreakdown);
      if (segments.length === 0) return [baseRow];

      return segments.map((segment, segmentIndex) => {
        const segmentMeta = isRecord(segment.fullBreakdown) && isRecord(segment.fullBreakdown.payrollSegment)
          ? segment.fullBreakdown.payrollSegment
          : segment;
        const label = typeof segment.label === 'string' ? segment.label : `Tách dòng ${segmentIndex + 1}`;
        const segmentFullBreakdown = isRecord(segment.fullBreakdown)
          ? {
              ...segment.fullBreakdown,
              manualOverrides: {},
              manualEditLogs: [],
            }
          : baseRow.fullBreakdown;
        return {
          ...baseRow,
          id: `${p.id}:${String(segment.key ?? segmentIndex)}`,
          standardDays: segmentValue(segment, 'standardDays', p.standardDays),
          actualDays: segmentValue(segment, 'actualDays', p.actualDays),
          workRatio: segmentValue(segment, 'workRatio', p.workRatio),
          baseSalary: segmentValue(segment, 'baseSalary', p.baseSalary),
          actualSalary: segmentValue(segment, 'actualSalary', p.actualSalary),
          allowancesTotal: segmentValue(segment, 'allowancesTotal', p.allowancesTotal),
          otTotalHours: segmentValue(segment, 'otTotalHours', p.otTotalHours),
          otTotalAmount: segmentValue(segment, 'otTotalAmount', p.otTotalAmount),
          otBucketBreakdown: segmentValue(segment, 'otBucketBreakdown', p.otBucketBreakdown),
          lateDeduction: segmentValue(segment, 'lateDeduction', p.lateDeduction),
          grossIncome: segmentValue(segment, 'grossIncome', p.grossIncome),
          insuranceEmployee: segmentValue(segment, 'insuranceEmployee', p.insuranceEmployee),
          insuranceEmployer: segmentValue(segment, 'insuranceEmployer', p.insuranceEmployer),
          taxExempt: segmentValue(segment, 'taxExempt', p.taxExempt),
          taxableIncome: segmentValue(segment, 'taxableIncome', p.taxableIncome),
          pitAmount: segmentValue(segment, 'pitAmount', p.pitAmount),
          afterTaxAdjustment: segmentValue(segment, 'afterTaxAdjustment', p.afterTaxAdjustment),
          unionFee: segmentValue(segment, 'unionFee', p.unionFee),
          netSalary: segmentValue(segment, 'netSalary', p.netSalary),
          fullBreakdown: segmentFullBreakdown,
          employee: baseRow.employee
            ? {
                ...baseRow.employee,
                fullName: `${displayName} (${label})`,
                employmentType: typeof segment.employmentType === 'string' ? segment.employmentType : baseRow.employee.employmentType,
                staffClassify: typeof segment.staffClassify === 'string' ? segment.staffClassify : baseRow.employee.staffClassify,
                sortIndex: sortIndex + ((segmentIndex + 1) / 10),
                payrollSegment: {
                  ...segmentMeta,
                  label,
                  virtual: true,
                },
              }
            : null,
        };
      });
    }).sort((a, b) => {
      const aEmployee = isRecord(a.employee) ? a.employee : {};
      const bEmployee = isRecord(b.employee) ? b.employee : {};
      const aIndex = toNumber(aEmployee.sortIndex ?? 999);
      const bIndex = toNumber(bEmployee.sortIndex ?? 999);
      return aIndex - bIndex;
    });

    return res.json({ status: 'ok', data: enriched });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} List payslips error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── GET /api/payroll/summary — Payroll summary ────────────

/**
 * GET /api/payroll/summary?periodId=xxx
 * Tổng hợp bảng lương — totals + by department
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { periodId } = req.query;

    if (!periodId || typeof periodId !== 'string') {
      return res.status(400).json({
        status: 'error',
        message: 'periodId query param là bắt buộc',
      });
    }

    const period = await prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { periodEnd: true },
    });

    const payslips = await prisma.payslip.findMany({
      where: { periodId },
      include: {
        employee: {
          select: {
            userId: true,
            employeeCode: true,
            department: true,
            fullName: true,
            joinDate: true,
            larkMetadata: true,
          },
        },
      },
    });

    // Tổng hợp toàn bộ
    let totalGross = 0;
    let totalInsurance = 0;
    let totalPIT = 0;
    let totalNet = 0;
    let totalEmployees = 0;

    // Phân theo phòng ban
    const deptMap = new Map<string, {
      count: number;
      gross: number;
      insurance: number;
      pit: number;
      net: number;
    }>();

    for (const ps of payslips) {
      if (period && ps.employee && !belongsToPeriodByJoinDate(period.periodEnd, ps.employee.joinDate)) {
        continue;
      }

      const metadata = ps.employee?.larkMetadata as Record<string, unknown> | null | undefined;
      const staffCode = normalizeStaffCode(
        ps.employee?.employeeCode,
        metadata?.employeeNo,
        ps.employee?.userId,
      );
      if (!resolveTimesheetGroup(staffCode, ps.employee?.department)) continue;

      totalEmployees++;
      const gross = Number(ps.grossIncome ?? 0);
      const insurance = Number(ps.insuranceEmployee ?? 0);
      const pit = Number(ps.pitAmount ?? 0);
      const net = Number(ps.netSalary ?? 0);

      totalGross += gross;
      totalInsurance += insurance;
      totalPIT += pit;
      totalNet += net;

      const dept = ps.employee?.department || 'Chưa phân bổ';
      const existing = deptMap.get(dept) || { count: 0, gross: 0, insurance: 0, pit: 0, net: 0 };
      existing.count++;
      existing.gross += gross;
      existing.insurance += insurance;
      existing.pit += pit;
      existing.net += net;
      deptMap.set(dept, existing);
    }

    const byDepartment = Array.from(deptMap.entries()).map(([name, data]) => ({
      department: name,
      ...data,
    }));

    return res.json({
      status: 'ok',
      data: {
        totalEmployees,
        totalGross,
        totalInsurance,
        totalPIT,
        totalNet,
        byDepartment,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Summary error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── GET /api/payroll/payslip-base — Lark clean payslip records ─
/**
 * GET /api/payroll/payslip-base?periodId=xxx
 * Đọc schema + trạng thái/PDF từ Lark Base "Phiếu lương chuẩn" để tab Phiếu lương bám đúng field nghiệp vụ.
 */
router.get('/payslip-base', async (req: Request, res: Response) => {
  try {
    const { periodId } = req.query;
    if (!periodId || typeof periodId !== 'string') {
      return res.status(400).json({ status: 'error', message: 'periodId query param là bắt buộc' });
    }

    const period = await prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, monthKey: true, label: true },
    });
    if (!period) {
      return res.status(404).json({ status: 'error', message: 'Kỳ lương không tồn tại' });
    }

    const larkBase = new LarkBaseClient(getLarkConfig());
    const sourcePrefix = `PAYSLIP-${period.monthKey}-`;
    const [fields, records] = await Promise.all([
      larkBase.listAllFields(TABLE_IDS.PAYSLIP_CLEAN),
      larkBase.searchRecords(TABLE_IDS.PAYSLIP_CLEAN, {
        conjunction: 'and',
        conditions: [{ field_name: 'Mã nguồn đồng bộ', operator: 'contains', value: [sourcePrefix] }],
      }),
    ]);

    const data = records.map((record) => {
      const fieldsMap = record.fields as LarkRecordFields;
      return {
        recordId: record.record_id,
        sourceId: larkText(fieldsMap['Mã nguồn đồng bộ']),
        employeeCode: normalizeStaffCode(larkText(fieldsMap['Mã số Nhân viên'])) ?? larkText(fieldsMap['Mã số Nhân viên']),
        employeeName: larkText(fieldsMap['Họ và tên']),
        periodLabel: larkText(fieldsMap['Kỳ lương']) || larkText(fieldsMap['Tháng tính lương']),
        payrollWindow: larkText(fieldsMap['Kỳ công hiển thị']),
        status: larkText(fieldsMap['Trạng thái phiếu lương']) || 'Chưa tạo',
        confirmationStatus: larkText(fieldsMap['Nhân sự xác nhận']) || 'Chưa gửi',
        sendPdf: larkBool(fieldsMap['Gửi phiếu lương PDF']),
        sendMail: larkBool(fieldsMap['Gửi phiếu lương qua mail']),
        pdfAttachments: larkAttachment(fieldsMap['Phiếu lương PDF']),
        hrNote: larkText(fieldsMap['Ghi chú HR']),
        leaveStatus: larkText(fieldsMap['Trạng thái tồn phép']),
        larkNumbers: {
          standardDays: larkNumber(fieldsMap['Số ngày chuẩn/tháng']),
          actualDays: larkNumber(fieldsMap['Số ngày làm việc thực tế/tháng']),
          otHours: larkNumber(fieldsMap['Tổng giờ OT']),
          gross: larkNumber(fieldsMap['Tổng thu nhập trước thuế, bảo hiểm']) || larkNumber(fieldsMap['Tổng thu nhập (trước thuế)']),
          insuranceEmployee: larkNumber(fieldsMap['Tổng cộng BH NLĐ']),
          pit: larkNumber(fieldsMap['Thuế TNCN']),
          net: larkNumber(fieldsMap['Lương thực nhận']),
        },
        explanations: {
          period: larkText(fieldsMap['Diễn giải kỳ công']),
          payroll: larkText(fieldsMap['Diễn giải tính lương']),
          ot: larkText(fieldsMap['Diễn giải OT']),
          leave: larkText(fieldsMap['Diễn giải tồn phép']),
          deduction: larkText(fieldsMap['Diễn giải khấu trừ & thực nhận']),
        },
      };
    });

    return res.json({
      status: 'ok',
      data,
      meta: {
        tableId: TABLE_IDS.PAYSLIP_CLEAN,
        sourcePrefix,
        fieldCount: fields.length,
        fields: fields.map((field) => ({
          id: field.field_id,
          name: field.field_name,
          type: field.type,
          uiType: field.ui_type,
          isPrimary: field.is_primary ?? false,
          isHidden: field.is_hidden ?? false,
        })),
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Payslip Base error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

async function getPayslipPdfContext(rawPayslipId: string) {
  const payslipId = rawPayslipId.split(':')[0] ?? rawPayslipId;
  if (!isUuid(payslipId)) {
    throw new Error('payslipId không hợp lệ');
  }

  const payslip = await prisma.payslip.findUnique({
    where: { id: payslipId },
    include: { employee: true, period: true },
  });
  if (!payslip) {
    return null;
  }

  const [attendance, leaveBalance, taxPolicy] = await Promise.all([
    prisma.monthlyAttendance.findUnique({
      where: { employeeId_periodId: { employeeId: payslip.employeeId, periodId: payslip.periodId } },
    }),
    prisma.leaveBalance.findUnique({
      where: { employeeId_monthKey: { employeeId: payslip.employeeId, monthKey: payslip.period.monthKey } },
    }),
    prisma.taxPolicy.findFirst({
      where: { employeeId: payslip.employeeId },
      orderBy: [{ isCurrent: 'desc' }, { periodKey: 'desc' }],
    }),
  ]);

  return { payslip, attendance, leaveBalance, taxPolicy };
}

// ─── PATCH /api/payroll/:payslipId/hr-note — Save HR note for PDF ─
router.patch('/:payslipId/hr-note', async (req: Request, res: Response) => {
  try {
    const payslipId = routeParam(req, 'payslipId');
    if (!isUuid(payslipId)) {
      return res.status(400).json({ status: 'error', message: 'payslipId không hợp lệ' });
    }
    const payslip = await prisma.payslip.findUnique({ where: { id: payslipId } });
    if (!payslip) {
      return res.status(404).json({ status: 'error', message: 'Phiếu lương không tồn tại' });
    }

    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 5000) : '';
    const attachments = validatePayslipHrAttachments(req.body?.attachments);
    const changedBy = typeof req.body?.changedBy === 'string' && req.body.changedBy.trim()
      ? req.body.changedBy.trim()
      : 'HR';
    const oldFullBreakdown = deepCloneRecord(payslip.fullBreakdown);
    const oldNote = isRecord(oldFullBreakdown.payslipHrNote) ? oldFullBreakdown.payslipHrNote : {};
    const payslipHrNote = {
      text,
      attachments,
      updatedAt: new Date().toISOString(),
      updatedBy: changedBy,
    };
    const nextFullBreakdown = {
      ...oldFullBreakdown,
      payslipHrNote,
    };

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.payslip.update({
        where: { id: payslipId },
        data: { fullBreakdown: nextFullBreakdown as Prisma.InputJsonValue },
      });
      await tx.auditLog.create({
        data: {
          tableName: 'payslips',
          recordId: payslipId,
          action: 'UPDATE',
          oldData: { payslipHrNote: oldNote } as Prisma.InputJsonValue,
          newData: { payslipHrNote: { text, attachmentCount: attachments.length } } as Prisma.InputJsonValue,
          changedBy,
        },
      });
      return next;
    });

    return res.json({ status: 'ok', data: updated, payslipHrNote });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Payslip HR note error:`, msg);
    return res.status(400).json({ status: 'error', message: msg });
  }
});

// ─── GET /api/payroll/payslip-preview/:payslipId — Preview PDF HTML ─
router.get('/payslip-preview/:payslipId', async (req: Request, res: Response) => {
  try {
    const context = await getPayslipPdfContext(routeParam(req, 'payslipId'));
    if (!context) {
      return res.status(404).json({ status: 'error', message: 'Phiếu lương không tồn tại' });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(buildPayslipHtml(context));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Payslip preview error:`, msg);
    return res.status(400).json({ status: 'error', message: msg });
  }
});

// ─── POST /api/payroll/payslip-pdf/:payslipId — Generate PDF ─
/**
 * POST /api/payroll/payslip-pdf/:payslipId
 * Tạo PDF phiếu lương qua automation webhook hoặc Stirling-PDF.
 */
router.post('/payslip-pdf/:payslipId', async (req: Request, res: Response) => {
  try {
    const context = await getPayslipPdfContext(routeParam(req, 'payslipId'));
    if (!context) {
      return res.status(404).json({ status: 'error', message: 'Phiếu lương không tồn tại' });
    }

    const pdf = await generatePayslipPdf(context);
    if ('url' in pdf) {
      return res.json({ status: 'ok', data: pdf });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${payslipPdfFileName(context.payslip)}"`);
    return res.send(pdf);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Payslip PDF error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── GET /api/payroll/timesheet — Employee self-check summary ─

/**
 * GET /api/payroll/timesheet?periodId=xxx
 * Tổng hợp công, phép, OT theo nhân sự trong kỳ để nhân sự tự kiểm tra công ca.
 */
router.get('/timesheet', async (req: Request, res: Response) => {
  try {
    const { periodId } = req.query;

    if (!periodId || typeof periodId !== 'string') {
      return res.status(400).json({
        status: 'error',
        message: 'periodId query param là bắt buộc',
      });
    }

    const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      return res.status(404).json({
        status: 'error',
        message: 'Kỳ lương không tồn tại',
      });
    }

    const [employees, monthlyAttendances, leaveBalances, otMonthlies] = await Promise.all([
      prisma.employee.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          userId: true,
          employeeCode: true,
          fullName: true,
          department: true,
          position: true,
          employmentType: true,
          scheduleType: true,
          joinDate: true,
          larkMetadata: true,
        },
        orderBy: { fullName: 'asc' },
      }),
      prisma.monthlyAttendance.findMany({
        where: { periodId },
      }),
      prisma.leaveBalance.findMany({
        where: { monthKey: period.monthKey },
      }),
      prisma.otMonthly.findMany({
        where: { periodId },
      }),
    ]);

    const attendanceByEmployee = new Map(monthlyAttendances.map((item) => [item.employeeId, item]));
    const leaveByEmployee = new Map(leaveBalances.map((item) => [item.employeeId, item]));
    const otByEmployee = new Map(otMonthlies.map((item) => [item.employeeId, item]));

    const orderedEmployees = employees
      .filter((employee) => belongsToPeriodByJoinDate(period.periodEnd, employee.joinDate))
      .map((employee) => {
        const metadata = employee.larkMetadata as Record<string, unknown> | null;
        const staffCode = normalizeStaffCode(employee.employeeCode, metadata?.employeeNo, employee.userId);
        const sortIndex = resolveTimesheetSortIndex(staffCode, employee.fullName);
        const groupKey = resolveTimesheetGroup(staffCode, employee.department);

        return {
          employee,
          staffCode,
          sortIndex,
          groupKey,
        };
      })
      .filter((item) => item.groupKey)
      .sort((a, b) => a.sortIndex - b.sortIndex || a.employee.fullName.localeCompare(b.employee.fullName, 'vi'));

    const data = orderedEmployees.map(({ employee, staffCode, sortIndex, groupKey }) => {
      const attendance = attendanceByEmployee.get(employee.id);
      const leave = leaveByEmployee.get(employee.id);
      const ot = otByEmployee.get(employee.id);
      const otBucketBreakdown = normalizeBucketBreakdown(ot?.bucketBreakdown);
      const displayName = staffCode ? (TIMESHEET_EMPLOYEE_NAME_OVERRIDES[staffCode] ?? employee.fullName) : employee.fullName;

      return {
        id: attendance?.id ?? `${employee.id}-${period.id}`,
        employeeId: employee.id,
        employee: {
          id: employee.id,
          employeeCode: staffCode ?? employee.employeeCode,
          fullName: displayName,
          originalFullName: employee.fullName,
          department: employee.department,
          position: employee.position,
          employmentType: employee.employmentType,
          scheduleType: employee.scheduleType,
          joinDate: employee.joinDate,
          groupKey,
          sortIndex,
          avatarUrl: avatarFromMetadata(employee.larkMetadata),
        },
        period: {
          id: period.id,
          monthKey: period.monthKey,
          label: period.label,
          periodStart: period.periodStart.toISOString(),
          periodEnd: period.periodEnd.toISOString(),
          status: period.status,
        },
        attendance: {
          standardDays: toNumber(attendance?.standardDays),
          rawActualDays: toNumber(attendance?.rawActualDays),
          paidCreditHours: toNumber(attendance?.paidCreditHours),
          unpaidHours: toNumber(attendance?.unpaidHours),
          actualDays: toNumber(attendance?.actualDays),
          absentDays: toNumber(attendance?.absentDays),
          workHours: toNumber(attendance?.workHours),
          lateHoursBeforeLeave: toNumber(attendance?.lateHoursBeforeLeave),
          earlyHoursBeforeLeave: toNumber(attendance?.earlyHoursBeforeLeave),
          lateEarlyLeaveDeductedHours: toNumber(attendance?.lateEarlyLeaveDeductedHours),
          lateHours: toNumber(attendance?.lateHours),
          earlyHours: toNumber(attendance?.earlyHours),
          annualLeaveHours: toNumber(attendance?.annualLeaveHours),
          benefitLeaveHours: toNumber(attendance?.benefitLeaveHours),
          remoteHours: toNumber(attendance?.remoteHours),
          compLeaveHours: toNumber(attendance?.compLeaveHours),
          correctionHours: toNumber(attendance?.correctionHours),
        },
        leaveBalance: leave ? {
          opening: toNumber(leave.opening),
          accrued: toNumber(leave.accrued),
          used: toNumber(leave.used),
          lateEarlyUsed: toNumber(leave.lateEarlyUsed),
          adjustment: toNumber(leave.adjustment),
          seniorityBonus: toNumber(leave.seniorityBonus),
          closing: toNumber(leave.closing),
        } : null,
        ot: {
          totalHours: toNumber(ot?.totalHours),
          totalAmount: toNumber(ot?.totalAmount),
          bucketBreakdown: otBucketBreakdown,
          overDailyDates: Array.isArray(ot?.overDailyDates) ? ot.overDailyDates : [],
          overMonthlyLimit: ot?.overMonthlyLimit ?? false,
        },
        approvedOt: {
          totalHours: toNumber(ot?.totalHours),
          bucketBreakdown: Object.fromEntries(
            Object.entries(otBucketBreakdown).map(([bucket, value]) => [bucket, value.hours]),
          ),
        },
      };
    });

    const totals = data.reduce(
      (acc, row) => {
        acc.standardDays = Math.max(acc.standardDays, row.attendance.standardDays);
        acc.actualDays += row.attendance.actualDays;
        acc.workHours += row.attendance.workHours;
        acc.lateHours += row.attendance.lateHours;
        acc.earlyHours += row.attendance.earlyHours;
        acc.lateHoursBeforeLeave += row.attendance.lateHoursBeforeLeave;
        acc.earlyHoursBeforeLeave += row.attendance.earlyHoursBeforeLeave;
        acc.lateEarlyLeaveDeductedHours += row.attendance.lateEarlyLeaveDeductedHours;
        acc.leaveUsed += row.leaveBalance?.used ?? 0;
        acc.absentDays += row.attendance.absentDays;
        acc.otHours += row.ot.totalHours;
        return acc;
      },
      {
        standardDays: 0,
        actualDays: 0,
        workHours: 0,
        lateHours: 0,
        earlyHours: 0,
        lateHoursBeforeLeave: 0,
        earlyHoursBeforeLeave: 0,
        lateEarlyLeaveDeductedHours: 0,
        leaveUsed: 0,
        absentDays: 0,
        otHours: 0,
      },
    );

    return res.json({
      status: 'ok',
      data,
      period: {
        id: period.id,
        monthKey: period.monthKey,
        label: period.label,
        periodStart: period.periodStart.toISOString(),
        periodEnd: period.periodEnd.toISOString(),
        status: period.status,
      },
      totals,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Timesheet error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── POST /api/payroll/calculate/:periodId — Batch calc ────

/**
 * POST /api/payroll/calculate/:periodId
 * Tính lương hàng loạt cho tất cả nhân viên trong kỳ
 */
router.post('/calculate/:periodId', async (req: Request, res: Response) => {
  try {
    const periodId = routeParam(req, 'periodId');

    // Validate period exists
    const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      return res.status(404).json({
        status: 'error',
        message: 'Kỳ lương không tồn tại',
      });
    }

    await updateAllLeaveBalances(period.monthKey, prisma);

    // Dynamic import để tránh circular dependency
    const { calculateAllPayslips } = await import('../modules/payroll/payslip-calculator.js');
    const result = await calculateAllPayslips(periodId, prisma);

    console.log(`${MODULE} Batch calculate complete: ${result.processed} processed, ${result.errors} errors`);

    return res.json({ status: 'ok', data: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Calculate error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── POST /api/payroll/sync-attendance/:periodId — Rebuild attendance/payroll ───

/**
 * POST /api/payroll/sync-attendance/:periodId
 * Đồng bộ lại bảng tính công trong payroll từ dữ liệu chấm công/đơn đã duyệt
 * của kỳ được chọn, rồi tính lại OT và phiếu lương. Dùng được cả khi kỳ đã CLOSED.
 */
router.post('/sync-attendance/:periodId', async (req: Request, res: Response) => {
  try {
    const periodId = routeParam(req, 'periodId');

    const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      return res.status(404).json({
        status: 'error',
        message: 'Kỳ lương không tồn tại',
      });
    }

    const [
      { calculateMonthlyAttendance },
      { rebuildOtDetailsFromApprovals, aggregateOtMonthlyBatch },
      { calculatePayslip },
    ] = await Promise.all([
      import('../modules/attendance/rollup.js'),
      import('../modules/ot/ot-ledger.js'),
      import('../modules/payroll/payslip-calculator.js'),
    ]);

    const periodEmployees = await prisma.employee.findMany({
      where: {
        OR: [
          { status: 'ACTIVE' },
          { payslips: { some: { periodId } } },
        ],
      },
      select: { id: true, fullName: true, joinDate: true },
      orderBy: { fullName: 'asc' },
    });

    const eligibleEmployees: typeof periodEmployees = [];
    let skippedBeforeJoinDate = 0;
    for (const employee of periodEmployees) {
      if (belongsToPeriodByJoinDate(period.periodEnd, employee.joinDate)) {
        eligibleEmployees.push(employee);
        continue;
      }

      await prisma.$transaction([
        prisma.payslip.deleteMany({ where: { employeeId: employee.id, periodId } }),
        prisma.monthlyAttendance.deleteMany({ where: { employeeId: employee.id, periodId } }),
      ]);
      skippedBeforeJoinDate++;
    }

    const attendance = { processed: 0, errors: 0 };
    for (const employee of eligibleEmployees) {
      try {
        const result = await calculateMonthlyAttendance(employee.id, periodId, prisma);
        await prisma.monthlyAttendance.upsert({
          where: {
            employeeId_periodId: { employeeId: employee.id, periodId },
          },
          create: {
            employeeId: employee.id,
            periodId,
            standardDays: result.standardDays,
            rawActualDays: result.rawActualDays,
            paidCreditHours: result.paidCreditHours,
            unpaidHours: result.unpaidHours,
            actualDays: result.actualDays,
            absentDays: result.absentDays,
            workHours: result.workHours,
            lateHoursBeforeLeave: result.lateHoursBeforeLeave,
            earlyHoursBeforeLeave: result.earlyHoursBeforeLeave,
            lateEarlyLeaveDeductedHours: result.lateEarlyLeaveDeductedHours,
            lateHours: result.lateHours,
            earlyHours: result.earlyHours,
            annualLeaveHours: result.annualLeaveHours,
            benefitLeaveHours: result.benefitLeaveHours,
            remoteHours: result.remoteHours,
            compLeaveHours: result.compLeaveHours,
            correctionHours: result.correctionHours,
            calculatedAt: new Date(),
          },
          update: {
            standardDays: result.standardDays,
            rawActualDays: result.rawActualDays,
            paidCreditHours: result.paidCreditHours,
            unpaidHours: result.unpaidHours,
            actualDays: result.actualDays,
            absentDays: result.absentDays,
            workHours: result.workHours,
            lateHoursBeforeLeave: result.lateHoursBeforeLeave,
            earlyHoursBeforeLeave: result.earlyHoursBeforeLeave,
            lateEarlyLeaveDeductedHours: result.lateEarlyLeaveDeductedHours,
            lateHours: result.lateHours,
            earlyHours: result.earlyHours,
            annualLeaveHours: result.annualLeaveHours,
            benefitLeaveHours: result.benefitLeaveHours,
            remoteHours: result.remoteHours,
            compLeaveHours: result.compLeaveHours,
            correctionHours: result.correctionHours,
            calculatedAt: new Date(),
          },
        });
        attendance.processed++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${MODULE} Sync attendance error for ${employee.fullName}:`, msg);
        attendance.errors++;
      }
    }

    const otDetails = await rebuildOtDetailsFromApprovals(periodId, prisma);
    const otMonthly = await aggregateOtMonthlyBatch(periodId, prisma);
    const leaveBalances = await updateAllLeaveBalances(period.monthKey, prisma);

    const payslips = { processed: 0, errors: 0 };
    for (const employee of eligibleEmployees) {
      try {
        await calculatePayslip(employee.id, periodId, prisma);
        payslips.processed++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${MODULE} Sync payslip error for ${employee.fullName}:`, msg);
        payslips.errors++;
      }
    }

    console.log(
      `${MODULE} Attendance sync complete for ${period.label}: ` +
      `${attendance.processed}/${eligibleEmployees.length} attendance, ${payslips.processed}/${eligibleEmployees.length} payslips`,
    );

    return res.json({
      status: 'ok',
      data: {
        periodId,
        monthKey: period.monthKey,
        periodStatus: period.status,
        employees: eligibleEmployees.length,
        skippedBeforeJoinDate,
        attendance,
        otDetails,
        otMonthly,
        leaveBalances,
        payslips,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Sync attendance error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── POST /api/payroll/close/:periodId — Close process ─────

/**
 * POST /api/payroll/close/:periodId
 * Chốt công — chạy 14-step close process
 */
router.post('/close/:periodId', async (req: Request, res: Response) => {
  try {
    const periodId = routeParam(req, 'periodId');

    // Validate period exists
    const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      return res.status(404).json({
        status: 'error',
        message: 'Kỳ lương không tồn tại',
      });
    }

    // Dynamic import để tránh circular dependency
    const { executeCloseProcess } = await import('../modules/payroll/close-process.js');
    const result = await executeCloseProcess(periodId, prisma);

    console.log(`${MODULE} Close process result: ${result.status} (${result.completedSteps}/${result.totalSteps})`);

    return res.json({ status: 'ok', data: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Close process error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── GET /api/payroll/close-status/:periodId — Log ─────────

/**
 * GET /api/payroll/close-status/:periodId
 * Xem log chốt công — ordered by step
 */
router.get('/close-status/:periodId', async (req: Request, res: Response) => {
  try {
    const periodId = routeParam(req, 'periodId');

    const logs = await prisma.closeProcessLog.findMany({
      where: { periodId },
      orderBy: { stepOrder: 'asc' },
    });

    return res.json({ status: 'ok', data: logs });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Close status error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── GET /api/payroll/sheet-status/:periodId — Sheet link ──
/**
 * GET /api/payroll/sheet-status/:periodId
 * Trả về URL và token của Lark sheet đã tạo (nếu có)
 */
router.get('/sheet-status/:periodId', async (req: Request, res: Response) => {
  try {
    const periodId = routeParam(req, 'periodId');
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: {
        id: true,
        larkOtSheetUrl: true,
        larkOtSheetToken: true,
        label: true,
      },
    });

    if (!period) {
      return res.status(404).json({ status: 'error', message: 'Kỳ lương không tồn tại' });
    }

    return res.json({
      status: 'ok',
      data: {
        periodId: period.id,
        larkSheetUrl: period.larkOtSheetUrl,
        larkSheetToken: period.larkOtSheetToken,
        hasSheet: !!(period.larkOtSheetUrl && period.larkOtSheetToken),
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Sheet status error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── POST /api/payroll/export-sheet/:periodId — Export ─────
/**
 * POST /api/payroll/export-sheet/:periodId
 * Tạo hoặc cập nhật Lark Sheet tính công cho kỳ lương.
 * Nếu đã có sheet → update in-place (không tạo mới).
 */
router.post('/export-sheet/:periodId', async (req: Request, res: Response) => {
  try {
    const periodId = routeParam(req, 'periodId');
    const result = await exportOtSheetToLark(periodId);

    console.log(`${MODULE} Sheet export done: ${result.url} (isNew=${result.isNew})`);

    return res.json({
      status: 'ok',
      data: {
        url: result.url,
        spreadsheetToken: result.spreadsheetToken,
        isNew: result.isNew,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Export sheet error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── POST /api/payroll/export-salary-sheet/:periodId — Export Payroll Sheet ───
/**
 * POST /api/payroll/export-salary-sheet/:periodId
 * Cập nhật Lark Sheet bảng lương theo template payroll chính thức.
 */
router.post('/export-salary-sheet/:periodId', async (req: Request, res: Response) => {
  try {
    const periodId = routeParam(req, 'periodId');
    const result = await exportPayrollSheetToLark(periodId);

    console.log(`${MODULE} Salary sheet export done: ${result.url} (isNew=${result.isNew})`);

    return res.json({
      status: 'ok',
      data: result,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Export salary sheet error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── GET /api/payroll/salary-sheet-status/:periodId — Payroll Sheet status ───
/**
 * GET /api/payroll/salary-sheet-status/:periodId
 * Trả về URL và token của Lark Sheet bảng lương đã liên kết (nếu có).
 */
router.get('/salary-sheet-status/:periodId', async (req: Request, res: Response) => {
  try {
    const periodId = routeParam(req, 'periodId');
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: {
        id: true,
        larkSheetUrl: true,
        larkSheetToken: true,
      },
    });

    if (!period) {
      return res.status(404).json({ status: 'error', message: 'Kỳ lương không tồn tại' });
    }

    return res.json({
      status: 'ok',
      data: {
        periodId: period.id,
        larkSheetUrl: period.larkSheetUrl,
        larkSheetToken: period.larkSheetToken,
        hasSheet: !!(period.larkSheetUrl && period.larkSheetToken),
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Salary sheet status error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── PATCH /api/payroll/:payslipId/overrides — Manual edit ───
/**
 * PATCH /api/payroll/:payslipId/overrides
 * Lưu chỉnh tay của C&B và chạy lại calculator để gross/BH/PIT/net dùng ngay kết quả mới.
 */
router.patch('/:payslipId/overrides', async (req: Request, res: Response) => {
  try {
    const payslipId = routeParam(req, 'payslipId');
    if (!isUuid(payslipId)) {
      return res.status(400).json({ status: 'error', message: 'payslipId không hợp lệ' });
    }
    const payload = isRecord(req.body?.overrides) ? req.body.overrides : null;
    if (!payload) {
      return res.status(400).json({ status: 'error', message: 'overrides payload là bắt buộc' });
    }

    const payslip = await prisma.payslip.findUnique({
      where: { id: payslipId },
      include: { employee: true },
    });
    if (!payslip) {
      return res.status(404).json({ status: 'error', message: 'Phiếu lương không tồn tại' });
    }

    const fullBreakdown = deepCloneRecord(payslip.fullBreakdown);
    const currentOverrides = readManualOverrides(fullBreakdown);
    const { next: nextOverrides, changes } = applyPayrollOverridePayload(currentOverrides, payload);

    if (Object.keys(changes).length === 0) {
      return res.json({ status: 'ok', data: payslip, changed: 0 });
    }

    const changedBy = typeof req.body?.changedBy === 'string' && req.body.changedBy.trim()
      ? req.body.changedBy.trim()
      : 'C&B';
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    const editEntry = {
      at: new Date().toISOString(),
      by: changedBy,
      note,
      changes,
    };
    const manualEditLogs = [editEntry, ...readManualEditLogs(fullBreakdown)].slice(0, 50);
    const nextFullBreakdown = {
      ...fullBreakdown,
      manualOverrides: nextOverrides,
      manualEditLogs,
    };

    await prisma.$transaction([
      prisma.payslip.update({
        where: { id: payslipId },
        data: {
          fullBreakdown: nextFullBreakdown as Prisma.InputJsonValue,
        },
      }),
      prisma.auditLog.create({
        data: {
          tableName: 'payslips',
          recordId: payslipId,
          action: 'UPDATE',
          oldData: { manualOverrides: currentOverrides } as Prisma.InputJsonValue,
          newData: { manualOverrides: nextOverrides, note, changes } as Prisma.InputJsonValue,
          changedBy,
        },
      }),
    ]);

    const { calculatePayslip } = await import('../modules/payroll/payslip-calculator.js');
    await calculatePayslip(payslip.employeeId, payslip.periodId, prisma);

    const updated = await prisma.payslip.findUnique({
      where: { id: payslipId },
      include: { employee: true, period: true },
    });

    let sheetSync: { status: 'skipped' | 'ok' | 'error'; message?: string; url?: string } = { status: 'skipped' };
    if (updated?.period?.larkSheetToken) {
      try {
        const syncResult = await exportPayrollSheetToLark(updated.periodId);
        sheetSync = { status: 'ok', url: syncResult.url };
      } catch (syncError: unknown) {
        const syncMsg = syncError instanceof Error ? syncError.message : String(syncError);
        console.warn(`${MODULE} Salary sheet sync after manual edit failed:`, syncMsg);
        sheetSync = { status: 'error', message: syncMsg };
      }
    }

    return res.json({
      status: 'ok',
      data: updated,
      changed: Object.keys(changes).length,
      changes,
      sheetSync,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Manual edit error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── GET /api/payroll/:payslipId — Single payslip ──────────

/**
 * GET /api/payroll/:payslipId
 * Chi tiết phiếu lương — include employee + full breakdown
 */
router.get('/:payslipId', async (req: Request, res: Response) => {
  try {
    const payslipId = routeParam(req, 'payslipId');

    const payslip = await prisma.payslip.findUnique({
      where: { id: payslipId },
      include: {
        employee: true,
        period: true,
      },
    });

    if (!payslip) {
      return res.status(404).json({
        status: 'error',
        message: 'Phiếu lương không tồn tại',
      });
    }

    return res.json({ status: 'ok', data: payslip });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Get payslip error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── POST /api/payroll/export-ot-sheet/:periodId — Export OT ────
/**
 * POST /api/payroll/export-ot-sheet/:periodId
 * Tạo hoặc cập nhật Lark Sheet OT cho kỳ lương.
 */
router.post('/export-ot-sheet/:periodId', async (req: Request, res: Response) => {
  try {
    const periodId = routeParam(req, 'periodId');
    const result = await exportOtSheetToLark(periodId);
    console.log(`${MODULE} OT sheet export done: ${result.url} (isNew=${result.isNew})`);
    return res.json({ status: 'ok', data: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Export OT sheet error:`, msg);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

// ─── GET /api/payroll/ot-sheet-status/:periodId — OT Sheet status
router.get('/ot-sheet-status/:periodId', async (req: Request, res: Response) => {
  try {
    const periodId = routeParam(req, 'periodId');
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      select: { id: true, larkOtSheetUrl: true, larkOtSheetToken: true },
    });
    if (!period) return res.status(404).json({ status: 'error', message: 'Kỳ lương không tồn tại' });
    return res.json({
      status: 'ok',
      data: {
        periodId: period.id,
        larkOtSheetUrl: period.larkOtSheetUrl,
        larkOtSheetToken: period.larkOtSheetToken,
        hasSheet: !!period.larkOtSheetUrl,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ status: 'error', message: msg });
  }
});

export default router;
