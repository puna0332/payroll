/**
 * Attendance Rollup — Tổng hợp chấm công hàng ngày → bảng công tháng
 *
 * Core formula:
 * actualDays = max(0, min(rawActualDays + paidCredits/8, standardDays) − unpaid/8)
 */

import { PrismaClient } from '@prisma/client';
import { round } from '../../shared/utils/round.js';
import { STANDARD_HOURS, VN_HOLIDAYS_2026 } from '../../config/constants.js';
import { getLateEarlyRoundingRules, roundLateEarlyHours } from './late-early-rounding.js';
import { belongsToPeriodByJoinDate } from '../../shared/utils/employment-period.js';
import { resolveEffectiveScheduleType } from '../../shared/utils/work-schedule.js';
import { applySubmissionPolicyOverride, parseOtApproval } from '../calc/ot-calculator.js';
import { getApprovalSubmissionPolicyConfig } from '../calc/submission-policy-settings.js';

const MODULE = '[Attendance:Rollup]';

// ─── Types ──────────────────────────────────────────────────

export interface MonthlyAttendanceResult {
  standardDays: number;
  rawActualDays: number;
  paidCreditHours: number;
  unpaidHours: number;
  actualDays: number;
  absentDays: number;
  workHours: number;
  lateHoursBeforeLeave: number;
  earlyHoursBeforeLeave: number;
  lateEarlyLeaveDeductedHours: number;
  lateHours: number;
  earlyHours: number;
  annualLeaveHours: number;
  benefitLeaveHours: number;
  remoteHours: number;
  compLeaveHours: number;
  correctionHours: number;
}

// ─── Helpers ────────────────────────────────────────────────

/** Safely convert Prisma Decimal to number */
function d2n(val: unknown): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

function prevMonthKey(mk: string): string {
  const year = parseInt(mk.slice(0, 4), 10);
  const month = parseInt(mk.slice(4, 6), 10);
  return month === 1 ? `${year - 1}12` : `${year}${String(month - 1).padStart(2, '0')}`;
}

function monthKeyFromDate(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function compareMonthKey(a: string, b: string): number {
  return Number(a) - Number(b);
}

async function getMonthlyAccrualDays(prisma: PrismaClient): Promise<number> {
  const setting = await prisma.payrollSetting.findFirst({
    where: {
      category: 'benefit',
      key: 'annual_leave_days',
      policyVersion: { status: 'ACTIVE' },
    },
    select: { value: true },
  });
  const annualLeaveDays = setting ? Number(setting.value) : 12;
  return Number.isFinite(annualLeaveDays) && annualLeaveDays >= 0
    ? round(annualLeaveDays / 12, 2)
    : 1;
}

async function annualLeaveAvailableHours(
  prisma: PrismaClient,
  employeeId: string,
  monthKey: string,
  employeeJoinDate: Date | null,
  approvedAnnualLeaveHours: number,
): Promise<number> {
  const existing = await prisma.leaveBalance.findUnique({
    where: { employeeId_monthKey: { employeeId, monthKey } },
  });
  const firstAccrualMonth = employeeJoinDate ? monthKeyFromDate(employeeJoinDate) : monthKey;
  const prevKey = prevMonthKey(monthKey);
  const prevBalance = compareMonthKey(prevKey, firstAccrualMonth) >= 0
    ? await prisma.leaveBalance.findUnique({
        where: { employeeId_monthKey: { employeeId, monthKey: prevKey } },
      })
    : null;

  const standardOpening = prevBalance ? d2n(prevBalance.closing) : 0;
  const existingOpening = existing ? d2n(existing.opening) : null;
  const opening = existingOpening !== null && Math.abs(existingOpening - standardOpening) > 0.0001
    ? existingOpening
    : standardOpening;

  const shouldAccrue = compareMonthKey(monthKey, firstAccrualMonth) >= 0;
  const monthlyAccrual = await getMonthlyAccrualDays(prisma);
  const standardAccrual = shouldAccrue ? monthlyAccrual : 0;
  const accrued = existing && existing.accrued !== null && d2n(existing.accrued) !== standardAccrual
    ? d2n(existing.accrued)
    : standardAccrual;
  const adjustment = existing ? d2n(existing.adjustment) : 0;
  const seniorityBonus = existing ? d2n(existing.seniorityBonus) : 0;
  const approvedUsedDays = round(approvedAnnualLeaveHours / STANDARD_HOURS, 2);
  const availableDays = Math.max(opening + accrued + adjustment + seniorityBonus - approvedUsedDays, 0);

  return round(availableDays * STANDARD_HOURS, 2);
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthDayKey(date: Date): string {
  return date.toISOString().slice(5, 10);
}

function isFallbackStandardDate(date: Date, scheduleType: 'OFFICE' | 'SIX_DAY'): boolean {
  const day = date.getUTCDay();
  const isScheduledWorkday = scheduleType === 'SIX_DAY'
    ? day >= 1 && day <= 6
    : day >= 1 && day <= 5;
  return isScheduledWorkday && !VN_HOLIDAYS_2026[monthDayKey(date)];
}

async function buildStandardDateSet(
  periodStart: Date,
  periodEnd: Date,
  standardDays: number | null,
  scheduleType: 'OFFICE' | 'SIX_DAY',
  prisma: PrismaClient,
): Promise<Set<string>> {
  const calendarRows = await prisma.workCalendar.findMany({
    where: {
      calendarDate: {
        gte: periodStart,
        lte: periodEnd,
      },
    },
    orderBy: { calendarDate: 'asc' },
  });

  const workCalendarByDate = new Map(calendarRows.map((row) => [dateKey(row.calendarDate), row]));
  const candidates: string[] = [];

  for (let current = new Date(periodStart); current <= periodEnd; current = addUtcDays(current, 1)) {
    const key = dateKey(current);
    const calendarDay = workCalendarByDate.get(key);
    const countsAsStandard = calendarDay ? calendarDay.countsAsStandard : isFallbackStandardDate(current, scheduleType);
    if (countsAsStandard) candidates.push(key);
  }

  const limit = standardDays ?? candidates.length;
  return new Set(candidates.slice(Math.max(0, candidates.length - limit)));
}

function normalizeApprovalType(type: string | null): string {
  if (!type) return '';
  if (type === 'Làm thêm giờ' || type === 'OT') return 'OT';
  if (type === 'Nghỉ phép' || type === 'Leave') return 'Leave';
  if (type === 'Quên/chỉnh sửa chấm công' || type === 'Correction') return 'Correction';
  if (type === 'Hoán đổi thời gian làm việc/nghỉ ngơi' || type === 'Hoán đổi ngày nghỉ' || type === 'ChangeHours') return 'ChangeHours';
  if (type === 'Ca đêm' || type === 'NightShift') return 'NightShift';
  return type;
}

function formWidgets(rawData: unknown): Array<Record<string, unknown>> {
  if (!rawData || typeof rawData !== 'object') return [];
  const rawForm = (rawData as { form?: unknown }).form;
  if (Array.isArray(rawForm)) return rawForm.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  if (typeof rawForm === 'string') {
    try {
      const parsed = JSON.parse(rawForm);
      return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function widgetTextValues(widget: Record<string, unknown>): string[] {
  const values: string[] = [];
  const value = widget.value;
  if (typeof value === 'string') values.push(value);
  if (Array.isArray(value)) values.push(...value.filter((item): item is string => typeof item === 'string'));

  const option = widget.option;
  if (Array.isArray(option)) {
    for (const item of option) {
      if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
        values.push((item as { text: string }).text);
      }
    }
  } else if (option && typeof option === 'object' && typeof (option as { text?: unknown }).text === 'string') {
    values.push((option as { text: string }).text);
  }

  return values;
}

function isCompLeaveChange(rawData: unknown): boolean {
  const widgets = formWidgets(rawData);
  const changeTypeWidget = widgets.find((widget) => {
    const name = String(widget.name ?? '');
    return name.includes('変更タイプ') || name.toLowerCase().includes('change');
  });
  if (!changeTypeWidget) return false;

  return widgetTextValues(changeTypeWidget).some((value) => (
    value.includes('休日変更') ||
    value.toLowerCase().includes('comp') ||
    value.toLowerCase().includes('nghỉ bù') ||
    value.toLowerCase().includes('nghi bu')
  ));
}

function parseDateIntervals(rawData: unknown): Array<{ start: Date; end: Date; hours: number }> {
  return formWidgets(rawData)
    .filter((widget) => String(widget.type ?? '').toLowerCase() === 'dateinterval' && widget.value && typeof widget.value === 'object')
    .map((widget) => {
      const value = widget.value as { start?: unknown; end?: unknown; interval?: unknown };
      const start = typeof value.start === 'string' ? new Date(value.start) : null;
      const end = typeof value.end === 'string' ? new Date(value.end) : null;
      const hours = Number(value.interval ?? 0);
      return start && end && start < end ? { start, end, hours: Number.isFinite(hours) ? hours : 0 } : null;
    })
    .filter((item): item is { start: Date; end: Date; hours: number } => Boolean(item))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function effectiveCompLeaveHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.min(hours, STANDARD_HOURS);
}

function vnHour(date: Date): number {
  return (date.getUTCHours() + 7) % 24;
}

function paidLeaveEdgeOffset(start: Date | null, hours: number): { late: number; early: number } {
  if (!start || !Number.isFinite(hours) || hours <= 0) return { late: 0, early: 0 };
  return vnHour(start) >= 12
    ? { late: 0, early: hours }
    : { late: hours, early: 0 };
}

function effectiveNetHours(value: number): number {
  const rounded = round(Math.max(value, 0), 2);
  return rounded < 0.05 ? 0 : rounded;
}

function compLeaveHoursFromChangeApproval(rawData: unknown, standardDateSet: Set<string>): number {
  if (!isCompLeaveChange(rawData)) return 0;

  const intervals = parseDateIntervals(rawData);
  if (intervals.length === 0) return 0;

  // 休日変更 stores the worked day first, then one or more compensated leave windows.
  // If there is only one interval, treat that interval as the credited leave window.
  const compLeaveIntervals = intervals.length >= 2 ? intervals.slice(1) : intervals;

  return compLeaveIntervals.reduce((sum, interval) => {
    if (!standardDateSet.has(dateKey(interval.start))) return sum;
    return sum + effectiveCompLeaveHours(interval.hours);
  }, 0);
}

// ─── Main Function ──────────────────────────────────────────

/**
 * Calculate monthly attendance for one employee in one period.
 *
 * @param employeeId — UUID of the employee
 * @param periodId — UUID of the payroll period
 * @param prisma — Prisma client instance
 */
export async function calculateMonthlyAttendance(
  employeeId: string,
  periodId: string,
  prisma: PrismaClient,
): Promise<MonthlyAttendanceResult> {
  // 1. Fetch period + employee info
  const [period, employee] = await Promise.all([
    prisma.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } }),
    prisma.employee.findUniqueOrThrow({ where: { id: employeeId } }),
  ]);

  const mk = period.monthKey;
  const scheduleType = resolveEffectiveScheduleType(employee);

  // 2. Get standard days from leave rules
  const leaveRule = await prisma.leaveRule.findUnique({
    where: {
      monthKey_scheduleType: {
        monthKey: mk,
        scheduleType,
      },
    },
  });
  const periodEnd = endOfUtcDay(period.periodEnd);
  const lateEarlyRoundingRules = await getLateEarlyRoundingRules(prisma);
  const submissionPolicyConfig = await getApprovalSubmissionPolicyConfig(prisma);

  const standardDateSet = await buildStandardDateSet(
    period.periodStart,
    periodEnd,
    leaveRule?.standardDays ?? null,
    scheduleType,
    prisma,
  );
  const standardDays = leaveRule ? leaveRule.standardDays : standardDateSet.size;
  const queryStart = addUtcDays(period.periodStart, -1);
  const queryEnd = addUtcDays(periodEnd, -1);

  // 3. Sum daily attendance using the same Lark date offset as /attendance/daily.
  const dailyRecords = await prisma.dailyAttendance.findMany({
    where: {
      employeeId,
      attendanceDate: {
        gte: queryStart,
        lte: queryEnd,
      },
    },
  });

  let rawActualDays = 0;
  let workHoursTotal = 0;
  let lateHoursTotal = 0;
  let earlyHoursTotal = 0;

  for (const rec of dailyRecords) {
    const actualDate = addUtcDays(rec.attendanceDate, 1);
    if (!standardDateSet.has(dateKey(actualDate))) continue;

    const wh = d2n(rec.workHours);
    rawActualDays += Math.min(wh, STANDARD_HOURS) / STANDARD_HOURS;
    workHoursTotal += wh;
    const rawLateHours = d2n(rec.rawLateHours) > 0 ? d2n(rec.rawLateHours) : d2n(rec.lateHours);
    const rawEarlyHours = d2n(rec.rawEarlyHours) > 0 ? d2n(rec.rawEarlyHours) : d2n(rec.earlyHours);
    lateHoursTotal += roundLateEarlyHours(rawLateHours, lateEarlyRoundingRules);
    earlyHoursTotal += roundLateEarlyHours(rawEarlyHours, lateEarlyRoundingRules);
  }

  // 4. Sum approved leave by bucket
  const approvals = await prisma.approvalRecord.findMany({
    where: {
      employeeId,
      status: 'APPROVED',
      OR: [
        { startTime: { gte: period.periodStart, lte: periodEnd } },
        { endTime: { gte: period.periodStart, lte: periodEnd } },
        { applyDate: { gte: period.periodStart, lte: periodEnd } },
      ],
    },
  });

  let annualLeaveHours = 0;
  let benefitLeaveHours = 0;
  let remoteHours = 0;
  let compLeaveHours = 0;
  let correctionHours = 0;
  let unpaidHours = 0;
  let leaveLateOffsetHours = 0;
  let leaveEarlyOffsetHours = 0;

  for (const ap of approvals) {
    const approvalType = normalizeApprovalType(ap.approvalType);
    if (approvalType === 'OT' || approvalType === 'NightShift') continue;

    if (approvalType === 'ChangeHours') {
      const parsed = ap.rawData
        ? applySubmissionPolicyOverride(
            parseOtApproval(
              ap.rawData as Record<string, unknown>,
              null,
              null,
              scheduleType === 'SIX_DAY' ? 'six_day' : 'office',
              'ChangeHours',
              submissionPolicyConfig,
            ),
            ap.submissionPolicyOverride,
          )
        : null;
      if (parsed?.submissionPolicy?.counted === false) continue;
      compLeaveHours += compLeaveHoursFromChangeApproval(ap.rawData, standardDateSet);
      continue;
    }

    const approvalDate = ap.startTime ?? ap.applyDate;
    if (approvalDate && !standardDateSet.has(dateKey(approvalDate))) continue;

    const hours = d2n(ap.approvedHours);
    switch (ap.leaveTypeBucket) {
      case 'ANNUAL': {
        annualLeaveHours += hours;
        const offset = paidLeaveEdgeOffset(ap.startTime ?? ap.applyDate, hours);
        leaveLateOffsetHours += offset.late;
        leaveEarlyOffsetHours += offset.early;
        break;
      }
      case 'BENEFIT': {
        benefitLeaveHours += hours;
        const offset = paidLeaveEdgeOffset(ap.startTime ?? ap.applyDate, hours);
        leaveLateOffsetHours += offset.late;
        leaveEarlyOffsetHours += offset.early;
        break;
      }
      case 'REMOTE': {
        remoteHours += hours;
        const offset = paidLeaveEdgeOffset(ap.startTime ?? ap.applyDate, hours);
        leaveLateOffsetHours += offset.late;
        leaveEarlyOffsetHours += offset.early;
        break;
      }
      case 'COMP_LEAVE': {
        compLeaveHours += hours;
        const offset = paidLeaveEdgeOffset(ap.startTime ?? ap.applyDate, hours);
        leaveLateOffsetHours += offset.late;
        leaveEarlyOffsetHours += offset.early;
        break;
      }
      case 'CORRECTION':  correctionHours += hours; break;
      case 'UNPAID':      unpaidHours += hours; break;
      // OT and CHANGE don't affect attendance credits
      default: break;
    }
  }

  // 5. Calculate paid credit hours (count toward "worked")
  const lateHoursBeforeLeave = effectiveNetHours(lateHoursTotal - correctionHours / 2 - leaveLateOffsetHours);
  const earlyHoursBeforeLeave = effectiveNetHours(earlyHoursTotal - correctionHours / 2 - leaveEarlyOffsetHours);
  const lateEarlyHoursBeforeLeave = lateHoursBeforeLeave + earlyHoursBeforeLeave;
  const availableAnnualLeaveHours = await annualLeaveAvailableHours(
    prisma,
    employeeId,
    mk,
    employee.joinDate,
    annualLeaveHours,
  );
  const lateEarlyLeaveDeductedHours = round(Math.min(lateEarlyHoursBeforeLeave, availableAnnualLeaveHours), 2);
  const lateLeaveOffsetHours = Math.min(lateHoursBeforeLeave, lateEarlyLeaveDeductedHours);
  const earlyLeaveOffsetHours = Math.min(
    earlyHoursBeforeLeave,
    Math.max(lateEarlyLeaveDeductedHours - lateLeaveOffsetHours, 0),
  );
  const netLateHours = effectiveNetHours(lateHoursBeforeLeave - lateLeaveOffsetHours);
  const netEarlyHours = effectiveNetHours(earlyHoursBeforeLeave - earlyLeaveOffsetHours);

  const paidCreditHours = annualLeaveHours + benefitLeaveHours
    + remoteHours + compLeaveHours + correctionHours + lateEarlyLeaveDeductedHours;

  // 6. Calculate actual days
  // actualDays = min(raw + credits/8, standardDays), clamped ≥ 0
  const creditedDays = rawActualDays + round(paidCreditHours / STANDARD_HOURS, 2);
  const actualDays = round(Math.max(Math.min(creditedDays, standardDays), 0), 2);
  const unpaidDays = round(unpaidHours / STANDARD_HOURS, 2);

  // 7. Absent days
  const absentDays = round(Math.max(standardDays - actualDays, 0), 2);

  const result: MonthlyAttendanceResult = {
    standardDays,
    rawActualDays,
    paidCreditHours: round(paidCreditHours, 2),
    unpaidHours: round(unpaidHours, 2),
    actualDays,
    absentDays,
    workHours: round(workHoursTotal, 2),
    lateHoursBeforeLeave: round(lateHoursBeforeLeave, 2),
    earlyHoursBeforeLeave: round(earlyHoursBeforeLeave, 2),
    lateEarlyLeaveDeductedHours: round(lateEarlyLeaveDeductedHours, 2),
    lateHours: netLateHours,
    earlyHours: netEarlyHours,
    annualLeaveHours: round(annualLeaveHours, 2),
    benefitLeaveHours: round(benefitLeaveHours, 2),
    remoteHours: round(remoteHours, 2),
    compLeaveHours: round(compLeaveHours, 2),
    correctionHours: round(correctionHours, 2),
  };

  console.log(`${MODULE} Employee ${employeeId}: actual=${actualDays}/${standardDays}d, unpaid=${unpaidDays}d, absent=${absentDays}d`);
  return result;
}

/**
 * Batch rollup for all active employees in a period.
 * Upserts monthly_attendances records.
 */
export async function rollupAllEmployees(
  periodId: string,
  prisma: PrismaClient,
): Promise<{ processed: number; errors: number }> {
  const period = await prisma.payrollPeriod.findUniqueOrThrow({
    where: { id: periodId },
    select: { periodEnd: true },
  });
  const employees = await prisma.employee.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, fullName: true, joinDate: true },
  });

  let processed = 0;
  let errors = 0;

  for (const emp of employees) {
    try {
      if (!belongsToPeriodByJoinDate(period.periodEnd, emp.joinDate)) {
        await prisma.monthlyAttendance.deleteMany({ where: { employeeId: emp.id, periodId } });
        continue;
      }

      const result = await calculateMonthlyAttendance(emp.id, periodId, prisma);

      await prisma.monthlyAttendance.upsert({
        where: {
          employeeId_periodId: { employeeId: emp.id, periodId },
        },
        create: {
          employeeId: emp.id,
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

      processed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${MODULE} Error for ${emp.fullName}: ${msg}`);
      errors++;
    }
  }

  console.log(`${MODULE} Rollup complete: ${processed} processed, ${errors} errors`);
  return { processed, errors };
}
