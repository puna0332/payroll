/**
 * Leave Balance Module — Quản lý tồn phép năm
 *
 * Formula: closing = opening + accrued + adjustment + seniorityBonus − used
 */

import { PrismaClient } from '@prisma/client';
import { round } from '../../shared/utils/round.js';
import { STANDARD_HOURS } from '../../config/constants.js';

const MODULE = '[Leave:Balance]';

// ─── Types ──────────────────────────────────────────────────

export interface LeaveBalanceResult {
  opening: number;
  accrued: number;
  used: number;
  lateEarlyUsed: number;
  adjustment: number;
  seniorityBonus: number;
  closing: number;
}

// ─── Helpers ────────────────────────────────────────────────

function d2n(val: unknown): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

/**
 * Get the previous month key (YYYYMM)
 */
function prevMonthKey(mk: string): string {
  const year = parseInt(mk.slice(0, 4));
  const month = parseInt(mk.slice(4, 6));

  if (month === 1) {
    return `${year - 1}12`;
  }
  return `${year}${(month - 1).toString().padStart(2, '0')}`;
}

function monthStart(mk: string): Date {
  const year = parseInt(mk.slice(0, 4), 10);
  const month = parseInt(mk.slice(4, 6), 10);
  return new Date(Date.UTC(year, month - 1, 1));
}

function monthEnd(mk: string): Date {
  const year = parseInt(mk.slice(0, 4), 10);
  const month = parseInt(mk.slice(4, 6), 10);
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
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

// ─── Main Functions ─────────────────────────────────────────

/**
 * Update leave balance for an employee for a specific month.
 *
 * - opening = previous month's closing (0 if first)
 * - accrued = 1.0 day/month (standard)
 * - used = ANNUAL leave hours in this month / 8
 * - closing ≥ 0
 */
export async function updateLeaveBalance(
  employeeId: string,
  mk: string,
  prisma: PrismaClient,
): Promise<LeaveBalanceResult> {
  // 0. Check for existing adjustments and manual overrides first
  const existing = await prisma.leaveBalance.findUnique({
    where: { employeeId_monthKey: { employeeId, monthKey: mk } },
  });

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { joinDate: true },
  });
  const firstAccrualMonth = employee?.joinDate ? monthKeyFromDate(employee.joinDate) : mk;

  // 1. Get opening balance from previous month. If the previous month is missing,
  // build the chain first so "current balance" is valid even when user opens only
  // the current month for the first time.
  const prevKey = prevMonthKey(mk);
  let prevBalance = compareMonthKey(prevKey, firstAccrualMonth) >= 0
    ? await prisma.leaveBalance.findUnique({
        where: { employeeId_monthKey: { employeeId, monthKey: prevKey } },
      })
    : null;

  if (!prevBalance && compareMonthKey(prevKey, firstAccrualMonth) >= 0) {
    await updateLeaveBalance(employeeId, prevKey, prisma);
    prevBalance = await prisma.leaveBalance.findUnique({
      where: { employeeId_monthKey: { employeeId, monthKey: prevKey } },
    });
  }
  
  const stdOpening = prevBalance ? d2n(prevBalance.closing) : 0;
  const existingOpening = existing ? d2n(existing.opening) : null;
  const opening = existingOpening !== null && Math.abs(existingOpening - stdOpening) > 0.0001
    ? existingOpening
    : stdOpening;

  // 2. Standard accrual: default to +1.0 (8h), but allow manual override in database
  const shouldAccrue = compareMonthKey(mk, firstAccrualMonth) >= 0;
  const monthlyAccrual = await getMonthlyAccrualDays(prisma);
  const standardAccrual = shouldAccrue ? monthlyAccrual : 0;
  const accrued = existing && existing.accrued !== null && d2n(existing.accrued) !== standardAccrual
    ? d2n(existing.accrued)
    : standardAccrual;

  // 3. Used = annual leave hours in this payroll period/month.
  const period = await prisma.payrollPeriod.findUnique({
    where: { monthKey: mk },
    select: { id: true, periodStart: true, periodEnd: true },
  });
  const rangeStart = period?.periodStart ?? monthStart(mk);
  const rangeEnd = period?.periodEnd ?? monthEnd(mk);
  const approvals = await prisma.approvalRecord.findMany({
    where: {
      employeeId,
      status: 'APPROVED',
      leaveTypeBucket: 'ANNUAL',
      OR: [
        { startTime: { gte: rangeStart, lte: rangeEnd } },
        { endTime: { gte: rangeStart, lte: rangeEnd } },
        { startTime: { lte: rangeStart }, endTime: { gte: rangeEnd } },
        { startTime: null, applyDate: { gte: rangeStart, lte: rangeEnd } },
      ],
    },
  });

  const usedHours = approvals.reduce((sum, a) => sum + d2n(a.approvedHours), 0);
  const monthlyAttendance = period
    ? await prisma.monthlyAttendance.findUnique({
        where: { employeeId_periodId: { employeeId, periodId: period.id } },
        select: { lateEarlyLeaveDeductedHours: true },
      })
    : null;
  const lateEarlyUsed = round(d2n(monthlyAttendance?.lateEarlyLeaveDeductedHours) / STANDARD_HOURS, 2);
  const used = round(usedHours / STANDARD_HOURS + lateEarlyUsed, 2);

  const adjustment = existing ? d2n(existing.adjustment) : 0;
  const seniorityBonus = existing ? d2n(existing.seniorityBonus) : 0;

  // 5. Calculate closing
  const closing = round(Math.max(opening + accrued + adjustment + seniorityBonus - used, 0), 2);

  const result: LeaveBalanceResult = {
    opening: round(opening, 2),
    accrued,
    used,
    lateEarlyUsed,
    adjustment,
    seniorityBonus,
    closing,
  };

  // 6. Upsert
  await prisma.leaveBalance.upsert({
    where: { employeeId_monthKey: { employeeId, monthKey: mk } },
    create: {
      employeeId,
      monthKey: mk,
      ...result,
    },
    update: {
      opening: result.opening,
      accrued: result.accrued,
      used: result.used,
      lateEarlyUsed: result.lateEarlyUsed,
      closing: result.closing,
    },
  });

  console.log(`${MODULE} ${employeeId} ${mk}: opening=${opening}, +${accrued}, −${used}, closing=${closing}`);
  return result;
}

/**
 * Batch update leave balances for all active employees.
 */
export async function updateAllLeaveBalances(
  mk: string,
  prisma: PrismaClient,
): Promise<{ processed: number; errors: number }> {
  const employees = await prisma.employee.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  let processed = 0;
  let errors = 0;

  for (const emp of employees) {
    try {
      await updateLeaveBalance(emp.id, mk, prisma);
      processed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${MODULE} Error for ${emp.id}: ${msg}`);
      errors++;
    }
  }

  return { processed, errors };
}
