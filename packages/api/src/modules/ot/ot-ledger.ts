/**
 * OT Ledger — Aggregate OT details into monthly summary per employee
 * Checks daily (4h) and monthly (40h) limits
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { round, roundUp } from '../../shared/utils/round.js';
import { DAILY_OT_LIMIT, MONTHLY_OT_LIMIT } from '../../config/constants.js';
import { applySubmissionPolicyOverride, parseOtApproval } from '../calc/ot-calculator.js';
import { getApprovalSubmissionPolicyConfig } from '../calc/submission-policy-settings.js';
import { otDetailKey } from '../../shared/utils/idempotency.js';
import { resolveEffectiveOtScheduleType } from '../../shared/utils/work-schedule.js';

const MODULE = '[OT:Ledger]';

// ─── Types ──────────────────────────────────────────────────

export interface OtMonthlyResult {
  totalHours: number;
  totalAmount: number;
  bucketBreakdown: Record<string, { hours: number; amount: number }>;
  overDailyDates: string[];
  overMonthlyLimit: boolean;
}

// ─── Helpers ────────────────────────────────────────────────

function d2n(val: unknown): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
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

function normalizeApprovalType(type: string | null): string {
  if (!type) return '';
  if (type === 'Làm thêm giờ' || type === 'OT') return 'OT';
  if (type === 'Ca đêm' || type === 'NightShift') return 'NightShift';
  return type;
}

function extractOtPolicy(rawData: Record<string, unknown>): string {
  const form = rawData.form;
  if (!Array.isArray(form)) return '';
  const widget = form.find((item) => {
    if (!item || typeof item !== 'object') return false;
    const name = (item as Record<string, unknown>).name;
    return typeof name === 'string' && name.includes('Chính sách OT');
  });
  const value = widget && typeof widget === 'object'
    ? (widget as Record<string, unknown>).value
    : '';
  return typeof value === 'string' ? value : '';
}

function isCompLeaveOtPolicy(policy: string): boolean {
  return policy.toLowerCase().includes('nghỉ bù');
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

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  const toleranceMs = 60_000;
  return Math.max(aStart.getTime(), bStart.getTime()) <= Math.min(aEnd.getTime(), bEnd.getTime()) + toleranceMs;
}

function linkedCompLeaveHoursForOt(
  changeApprovals: Array<{ rawData: Prisma.JsonValue }>,
  workedStart: Date | null | undefined,
  workedEnd: Date | null | undefined,
  approvedHours: number,
): number {
  if (!workedStart || !workedEnd || approvedHours <= 0) return 0;

  const linkedHours = changeApprovals.reduce((sum, approval) => {
    const intervals = parseDateIntervals(approval.rawData);
    if (intervals.length < 2) return sum;
    const workedInterval = intervals[0];
    if (!rangesOverlap(workedStart, workedEnd, workedInterval.start, workedInterval.end)) return sum;
    return sum + intervals.slice(1).reduce((hours, interval) => hours + Math.min(d2n(interval.hours), 8), 0);
  }, 0);

  return round(Math.min(linkedHours, approvedHours), 2);
}

// ─── Main Functions ─────────────────────────────────────────

/**
 * Rebuild OT details from approved OT/NightShift approvals and actual check-in/out.
 * This makes ot_monthlies reflect actual worked OT hours instead of stale/preliminary data.
 */
export async function rebuildOtDetailsFromApprovals(
  periodId: string,
  prisma: PrismaClient,
): Promise<{ processed: number; details: number; skipped: number }> {
  const period = await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const periodEnd = endOfUtcDay(period.periodEnd);

  const approvals = await prisma.approvalRecord.findMany({
    where: {
      status: 'APPROVED',
      OR: [
        { startTime: { gte: period.periodStart, lte: periodEnd } },
        { endTime: { gte: period.periodStart, lte: periodEnd } },
        { applyDate: { gte: period.periodStart, lte: periodEnd } },
      ],
    },
    include: {
      employee: {
        select: {
          id: true,
          scheduleType: true,
          employeeCode: true,
          userId: true,
          department: true,
          larkMetadata: true,
          salaryPolicies: {
            where: {
              OR: [
                { periodKey: period.monthKey },
                { isCurrent: true },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { hourlyRate: true },
          },
        },
      },
    },
  });

  const otApprovals = approvals.filter((approval) => {
    const type = normalizeApprovalType(approval.approvalType);
    return type === 'OT' || type === 'NightShift';
  });

  const employeeIds = Array.from(new Set(otApprovals.map((approval) => approval.employeeId)));
  const changeApprovals = employeeIds.length > 0
    ? await prisma.approvalRecord.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: 'APPROVED',
          approvalType: { in: ['ChangeHours', 'Hoán đổi thời gian làm việc/nghỉ ngơi', 'Hoán đổi ngày nghỉ'] },
        },
        select: {
          employeeId: true,
          rawData: true,
        },
      })
    : [];
  const changeByEmployee = new Map<string, typeof changeApprovals>();
  for (const change of changeApprovals) {
    const list = changeByEmployee.get(change.employeeId) ?? [];
    list.push(change);
    changeByEmployee.set(change.employeeId, list);
  }

  await prisma.otDetail.deleteMany({ where: { periodId } });

  const queryStart = addUtcDays(period.periodStart, -1);
  const queryEnd = addUtcDays(periodEnd, -1);
  const dailyRecords = await prisma.dailyAttendance.findMany({
    where: {
      attendanceDate: {
        gte: queryStart,
        lte: queryEnd,
      },
    },
  });

  const dailyByEmployeeDate = new Map<string, typeof dailyRecords[number]>();
  for (const record of dailyRecords) {
    const actualDate = addUtcDays(record.attendanceDate, 1);
    dailyByEmployeeDate.set(`${record.employeeId}:${dateKey(actualDate)}`, record);
  }

  let processed = 0;
  let details = 0;
  let skipped = 0;
  const submissionPolicyConfig = await getApprovalSubmissionPolicyConfig(prisma);

  for (const approval of otApprovals) {
    const rawData = approval.rawData as Record<string, unknown> | null;
    if (!rawData) {
      skipped++;
      continue;
    }

    const type = normalizeApprovalType(approval.approvalType);
    const otPolicy = extractOtPolicy(rawData);
    const shouldPayOt = !isCompLeaveOtPolicy(otPolicy);
    const scheduleType = resolveEffectiveOtScheduleType(approval.employee);
    const firstPass = applySubmissionPolicyOverride(
      parseOtApproval(rawData, null, null, scheduleType, type, submissionPolicyConfig),
      approval.submissionPolicyOverride,
    );
    const approvedStart = firstPass?.approvedStart ?? approval.startTime ?? approval.applyDate;
    if (!approvedStart) {
      skipped++;
      continue;
    }
    if (firstPass?.submissionPolicy?.counted === false) {
      skipped++;
      continue;
    }

    const daily = dailyByEmployeeDate.get(`${approval.employeeId}:${dateKey(approvedStart)}`);
    const parsed = applySubmissionPolicyOverride(parseOtApproval(
      rawData,
      daily?.checkIn ?? null,
      daily?.checkOut ?? null,
      scheduleType,
      type,
      submissionPolicyConfig,
    ), approval.submissionPolicyOverride);

    if (!parsed) {
      skipped++;
      continue;
    }

    const hourlyRate = d2n(approval.employee.salaryPolicies[0]?.hourlyRate);
    let approvalDetails = 0;
    let remainingCompLeaveCoverage = shouldPayOt ? 0 : linkedCompLeaveHoursForOt(
      changeByEmployee.get(approval.employeeId) ?? [],
      firstPass?.approvedStart ?? approval.startTime,
      firstPass?.approvedEnd ?? approval.endTime,
      parsed.buckets.reduce((sum, bucket) => sum + bucket.approvedHours, 0),
    );

    for (const [index, bucket] of parsed.buckets.entries()) {
      if (bucket.approvedHours <= 0) continue;

      const coveredHours = shouldPayOt ? 0 : Math.min(bucket.approvedHours, remainingCompLeaveCoverage);
      remainingCompLeaveCoverage = round(Math.max(remainingCompLeaveCoverage - coveredHours, 0), 2);
      const payableHours = shouldPayOt ? bucket.approvedHours : round(Math.max(bucket.approvedHours - coveredHours, 0), 2);
      const workDate = new Date(Date.UTC(
        bucket.startTime.getUTCFullYear(),
        bucket.startTime.getUTCMonth(),
        bucket.startTime.getUTCDate(),
      ));
      const ledgerParts = [
        coveredHours > 0 ? { suffix: 'comp-leave', hours: coveredHours, amount: 0 } : null,
        payableHours > 0 ? { suffix: shouldPayOt ? 'payable' : 'unlinked-payable', hours: payableHours, amount: roundUp(payableHours * bucket.rate * hourlyRate, 0) } : null,
      ].filter((part): part is { suffix: string; hours: number; amount: number } => Boolean(part));

      for (const part of ledgerParts) {
        const idempotencyKey = otDetailKey(
          approval.employeeId,
          dateKey(workDate),
          `${approval.id}:${index}:${part.suffix}:${bucket.bucket}`,
        );

        await prisma.otDetail.upsert({
          where: { idempotencyKey },
          create: {
            employeeId: approval.employeeId,
            approvalId: approval.id,
            periodId,
            workDate,
            bucket: bucket.bucket,
            rate: bucket.rate,
            hours: part.hours,
            validHours: Math.min(bucket.validHours, part.hours),
            amount: part.amount,
            dayType: bucket.dayType,
            startTime: bucket.startTime,
            endTime: bucket.endTime,
            idempotencyKey,
            calculatedAt: new Date(),
          },
          update: {
            approvalId: approval.id,
            bucket: bucket.bucket,
            rate: bucket.rate,
            hours: part.hours,
            validHours: Math.min(bucket.validHours, part.hours),
            amount: part.amount,
            dayType: bucket.dayType,
            startTime: bucket.startTime,
            endTime: bucket.endTime,
            calculatedAt: new Date(),
          },
        });

        approvalDetails++;
        details++;
      }
    }

    if (approvalDetails > 0) processed++;
    else skipped++;
  }

  console.log(`${MODULE} Rebuilt OT details: ${details} details from ${processed} approvals, skipped ${skipped}`);
  return { processed, details, skipped };
}

/**
 * Aggregate all OT details for an employee in a period.
 * Groups by bucket, checks daily/monthly limits, upserts ot_monthly.
 */
export async function aggregateOtMonthly(
  employeeId: string,
  periodId: string,
  prisma: PrismaClient,
): Promise<OtMonthlyResult> {
  // 1. Fetch all OT details
  const details = await prisma.otDetail.findMany({
    where: { employeeId, periodId },
  });

  // 2. Bucket breakdown
  const bucketBreakdown: Record<string, { hours: number; amount: number }> = {};
  const dailyHours: Record<string, number> = {};

  for (const d of details) {
    const key = d.bucket;
    const hours = d2n(d.hours);
    const amount = d2n(d.amount);

    if (!bucketBreakdown[key]) {
      bucketBreakdown[key] = { hours: 0, amount: 0 };
    }
    bucketBreakdown[key].hours = round(bucketBreakdown[key].hours + hours, 2);
    bucketBreakdown[key].amount += amount;

    // Daily tracking (skip night_normal to avoid double-counting)
    if (key !== 'night_normal') {
      const dateKey = d.workDate.toISOString().split('T')[0];
      dailyHours[dateKey] = (dailyHours[dateKey] ?? 0) + hours;
    }
  }

  // 3. Check limits
  const mainHours = Object.entries(bucketBreakdown)
    .filter(([key]) => key !== 'night_normal')
    .reduce((sum, [, v]) => sum + v.hours, 0);

  const totalHours = round(mainHours, 2);
  const totalAmount = Object.values(bucketBreakdown).reduce((sum, v) => sum + v.amount, 0);

  const overDailyDates = Object.entries(dailyHours)
    .filter(([, h]) => h > DAILY_OT_LIMIT)
    .map(([date]) => date);

  const overMonthlyLimit = totalHours > MONTHLY_OT_LIMIT;

  if (overMonthlyLimit) {
    console.warn(`${MODULE} Monthly OT limit: ${totalHours}h > ${MONTHLY_OT_LIMIT}h for employee ${employeeId}`);
  }
  if (overDailyDates.length > 0) {
    console.warn(`${MODULE} Daily OT limit exceeded on: ${overDailyDates.join(', ')}`);
  }

  // 4. Upsert ot_monthly
  await prisma.otMonthly.upsert({
    where: {
      employeeId_periodId: { employeeId, periodId },
    },
    create: {
      employeeId,
      periodId,
      totalHours,
      totalAmount,
      bucketBreakdown: bucketBreakdown as Prisma.InputJsonValue,
      overDailyDates,
      overMonthlyLimit,
      calculatedAt: new Date(),
    },
    update: {
      totalHours,
      totalAmount,
      bucketBreakdown: bucketBreakdown as Prisma.InputJsonValue,
      overDailyDates,
      overMonthlyLimit,
      calculatedAt: new Date(),
    },
  });

  console.log(`${MODULE} Employee ${employeeId}: ${totalHours}h, ${totalAmount.toLocaleString()} VND, ${Object.keys(bucketBreakdown).length} buckets`);

  return { totalHours, totalAmount, bucketBreakdown, overDailyDates, overMonthlyLimit };
}

/**
 * Batch aggregate OT for all employees who have OT details in a period.
 */
export async function aggregateOtMonthlyBatch(
  periodId: string,
  prisma: PrismaClient,
): Promise<{ processed: number; overLimit: number }> {
  // Find distinct employees with OT details
  const employeeIds = await prisma.otDetail.findMany({
    where: { periodId },
    select: { employeeId: true },
    distinct: ['employeeId'],
  });

  let processed = 0;
  let overLimit = 0;

  for (const { employeeId } of employeeIds) {
    try {
      const result = await aggregateOtMonthly(employeeId, periodId, prisma);
      processed++;
      if (result.overMonthlyLimit) overLimit++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${MODULE} Error aggregating OT for ${employeeId}: ${msg}`);
    }
  }

  console.log(`${MODULE} Batch complete: ${processed} employees, ${overLimit} over monthly limit`);
  return { processed, overLimit };
}
