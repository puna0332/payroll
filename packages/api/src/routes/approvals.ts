/**
 * API Routes — Approvals (Phiếu phê duyệt)
 * Query, filter, and sync approval records from Lark
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../shared/db/prisma.js';
import { Prisma } from '@prisma/client';
import { applySubmissionPolicyOverride, parseOtApproval, type OtBucketResult, type OtParseResult } from '../modules/calc/ot-calculator.js';
import { getApprovalSubmissionPolicyConfig } from '../modules/calc/submission-policy-settings.js';
import { round } from '../shared/utils/round.js';
import { STANDARD_HOURS } from '../config/constants.js';
import { resolveEffectiveOtScheduleType } from '../shared/utils/work-schedule.js';

const router = Router();

type ApprovalOtSegment = {
  bucket: string;
  label: string;
  rate: number;
  ratePercent: number;
  approvedHours: number;
  validHours: number;
  effectiveHours: number;
  hourlyRate: number;
  otHourlyRate: number;
  amount: number;
  startTime: Date | null;
  endTime: Date | null;
  frame: string;
  dayType: string;
  source: 'ledger' | 'attendance-overlap' | 'approved-window';
};

type ApprovalOtSummary = {
  hours: number;
  amount: number;
  approvedHours: number;
};

type CompLeaveMatch = {
  approvalId: string;
  instanceCode: string;
  serialNumber: string | null;
  workedStart: Date;
  workedEnd: Date;
  compLeaveStart: Date;
  compLeaveEnd: Date;
  compLeaveHours: number;
};

type PeriodForOtPay = {
  id: string;
  monthKey: string;
} | null;

type OtPayBasis = {
  baseSalary: number;
  rankAllowance: number;
  payrollSalary: number;
  standardDays: number;
  dailyRate: number;
  hourlyRate: number;
};

function d2n(val: unknown): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

function roundUpVnd(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / 10) * 10;
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

async function findPayrollPeriodForDate(recordDate: Date | null | undefined): Promise<PeriodForOtPay> {
  if (!recordDate) return null;
  const candidates = await prisma.payrollPeriod.findMany({
    where: {
      periodStart: { lte: recordDate },
    },
    orderBy: { periodStart: 'desc' },
    select: { id: true, monthKey: true, periodEnd: true },
  });
  const period = candidates.find((item) => recordDate <= endOfUtcDay(item.periodEnd));
  return period ? { id: period.id, monthKey: period.monthKey } : null;
}

async function recalculateApprovalImpact(record: { employeeId: string; startTime: Date | null; applyDate: Date | null; endTime: Date | null; approvalType: string }) {
  const recordDate = record.startTime ?? record.applyDate ?? record.endTime;
  const period = await findPayrollPeriodForDate(recordDate);
  if (!period) return null;

  const [
    { calculateMonthlyAttendance },
    { rebuildOtDetailsFromApprovals, aggregateOtMonthly },
    { calculatePayslip },
  ] = await Promise.all([
    import('../modules/attendance/rollup.js'),
    import('../modules/ot/ot-ledger.js'),
    import('../modules/payroll/payslip-calculator.js'),
  ]);

  if (normalizeApprovalType(record.approvalType) === 'ChangeHours') {
    const attendance = await calculateMonthlyAttendance(record.employeeId, period.id, prisma);
    await prisma.monthlyAttendance.upsert({
      where: { employeeId_periodId: { employeeId: record.employeeId, periodId: period.id } },
      create: {
        employeeId: record.employeeId,
        periodId: period.id,
        standardDays: attendance.standardDays,
        rawActualDays: attendance.rawActualDays,
        paidCreditHours: attendance.paidCreditHours,
        unpaidHours: attendance.unpaidHours,
        actualDays: attendance.actualDays,
        absentDays: attendance.absentDays,
        workHours: attendance.workHours,
        lateHoursBeforeLeave: attendance.lateHoursBeforeLeave,
        earlyHoursBeforeLeave: attendance.earlyHoursBeforeLeave,
        lateEarlyLeaveDeductedHours: attendance.lateEarlyLeaveDeductedHours,
        lateHours: attendance.lateHours,
        earlyHours: attendance.earlyHours,
        annualLeaveHours: attendance.annualLeaveHours,
        benefitLeaveHours: attendance.benefitLeaveHours,
        remoteHours: attendance.remoteHours,
        compLeaveHours: attendance.compLeaveHours,
        correctionHours: attendance.correctionHours,
        calculatedAt: new Date(),
      },
      update: {
        standardDays: attendance.standardDays,
        rawActualDays: attendance.rawActualDays,
        paidCreditHours: attendance.paidCreditHours,
        unpaidHours: attendance.unpaidHours,
        actualDays: attendance.actualDays,
        absentDays: attendance.absentDays,
        workHours: attendance.workHours,
        lateHoursBeforeLeave: attendance.lateHoursBeforeLeave,
        earlyHoursBeforeLeave: attendance.earlyHoursBeforeLeave,
        lateEarlyLeaveDeductedHours: attendance.lateEarlyLeaveDeductedHours,
        lateHours: attendance.lateHours,
        earlyHours: attendance.earlyHours,
        annualLeaveHours: attendance.annualLeaveHours,
        benefitLeaveHours: attendance.benefitLeaveHours,
        remoteHours: attendance.remoteHours,
        compLeaveHours: attendance.compLeaveHours,
        correctionHours: attendance.correctionHours,
        calculatedAt: new Date(),
      },
    });
  }

  await rebuildOtDetailsFromApprovals(period.id, prisma);
  await aggregateOtMonthly(record.employeeId, period.id, prisma);
  await calculatePayslip(record.employeeId, period.id, prisma);
  return { periodId: period.id, monthKey: period.monthKey };
}

async function resolveOtPayBasis(employeeId: string, period: PeriodForOtPay): Promise<OtPayBasis> {
  const periodSalaryPolicy = period
    ? await prisma.salaryPolicy.findFirst({
        where: { employeeId, periodKey: period.monthKey },
        orderBy: { createdAt: 'desc' },
        select: { baseSalary: true, rankAllowance: true, dailyRate: true, hourlyRate: true },
      })
    : null;
  const salaryPolicy = periodSalaryPolicy ?? await prisma.salaryPolicy.findFirst({
    where: { employeeId, isCurrent: true },
    orderBy: { createdAt: 'desc' },
    select: { baseSalary: true, rankAllowance: true, dailyRate: true, hourlyRate: true },
  });
  const attendance = period
    ? await prisma.monthlyAttendance.findUnique({
        where: { employeeId_periodId: { employeeId, periodId: period.id } },
        select: { standardDays: true },
      })
    : null;

  const baseSalary = salaryPolicy ? d2n(salaryPolicy.baseSalary) : 0;
  const rankAllowance = salaryPolicy ? d2n(salaryPolicy.rankAllowance) : 0;
  const payrollSalary = baseSalary + rankAllowance;
  const standardDays = attendance ? d2n(attendance.standardDays) : 0;
  const dailyRate = standardDays > 0 && payrollSalary > 0
    ? payrollSalary / standardDays
    : (salaryPolicy ? d2n(salaryPolicy.dailyRate) : 0);
  const hourlyRate = standardDays > 0 && payrollSalary > 0
    ? roundUpVnd(payrollSalary / standardDays / STANDARD_HOURS)
    : roundUpVnd(salaryPolicy ? d2n(salaryPolicy.hourlyRate) : 0);

  return {
    baseSalary,
    rankAllowance,
    payrollSalary,
    standardDays,
    dailyRate,
    hourlyRate,
  };
}

function otBucketLabel(bucket: string): string {
  if (bucket.includes('Ngày thường 時間外 17h~22h')) return 'Ngày thường 150%';
  if (bucket.includes('Làm thêm ca đêm của ngày thường') || bucket.includes('weekday_night')) return 'Ngày thường đêm 200%';
  if (bucket.includes('夜間まで残業')) return 'Ngày thường đêm 210%';
  if (bucket.includes('Ngày nghỉ T7 休日出勤(土)')) return 'Thứ 7 nghỉ 200%';
  if (bucket.includes('Ngày nghỉ 休日出勤 6h~22h')) return 'Ngày nghỉ 200%';
  if (bucket.includes('Ngày nghỉ T7 ca đêm')) return 'Thứ 7 đêm 270%';
  if (bucket.includes('Ngày nghỉ ca đêm')) return 'Ngày nghỉ đêm 270%';
  if (bucket.includes('OT ngày lễ ca đêm')) return 'Ngày lễ đêm 390%';
  if (bucket.includes('OT ngày lễ 祝日出勤')) return 'Ngày lễ 300%';
  if (bucket.includes('平日の夜勤 22h~6h')) return 'Ca đêm 30%';
  if (bucket.includes('翌日の6h~22h')) return 'OT sau ca đêm 150%';
  return bucket;
}

function isWeekdayDayOtBucket(bucket: string): boolean {
  return bucket.includes('Ngày thường 時間外 17h~22h');
}

function isLegacyWeekdayNightOtBucket(bucket: string): boolean {
  return bucket.includes('夜間まで残業') || bucket.includes('夕間まで残業');
}

function isCompLeaveOtPolicy(policy: string | null | undefined): boolean {
  if (!policy) return false;
  const normalized = policy.toLowerCase();
  return normalized.includes('nghỉ bù') || normalized.includes('nghi bu');
}

function summarizeOtSegments(segments: ApprovalOtSegment[]): ApprovalOtSummary {
  return {
    hours: round(segments.reduce((sum, s) => sum + s.effectiveHours, 0), 2),
    amount: segments.reduce((sum, s) => sum + s.amount, 0),
    approvedHours: round(segments.reduce((sum, s) => sum + s.approvedHours, 0), 2),
  };
}

function mapOtBucket(
  bucket: OtBucketResult,
  hourlyRate: number,
  source: ApprovalOtSegment['source'],
  shouldPayOt = true,
  counted = true,
): ApprovalOtSegment {
  const approvedHours = round(d2n(bucket.approvedHours), 2);
  const validHours = round(d2n(bucket.validHours), 2);
  const effectiveHours = counted ? approvedHours : 0;
  const rate = d2n(bucket.rate);
  const otHourlyRate = roundUpVnd(hourlyRate * rate);

  return {
    bucket: bucket.bucket,
    label: otBucketLabel(bucket.bucket),
    rate,
    ratePercent: round(rate * 100, 0),
    approvedHours,
    validHours,
    effectiveHours,
    hourlyRate,
    otHourlyRate,
    amount: shouldPayOt && counted ? roundUpVnd(effectiveHours * otHourlyRate) : 0,
    startTime: bucket.startTime,
    endTime: bucket.endTime,
    frame: bucket.frame,
    dayType: bucket.dayType,
    source,
  };
}

function mapLedgerDetail(
  detail: {
    bucket: string;
    rate: Prisma.Decimal;
    hours: Prisma.Decimal;
    validHours: Prisma.Decimal;
    amount: Prisma.Decimal;
    startTime: Date | null;
    endTime: Date | null;
    dayType: string;
  },
  hourlyRate: number,
  continuesFromDayOt = false,
): ApprovalOtSegment {
  const isReclassifiedWeekdayNight = isLegacyWeekdayNightOtBucket(detail.bucket) && !continuesFromDayOt;
  const bucket = isReclassifiedWeekdayNight ? 'Làm thêm ca đêm của ngày thường' : detail.bucket;
  const rate = isReclassifiedWeekdayNight ? 2 : d2n(detail.rate);
  const approvedHours = round(d2n(detail.hours), 2);
  const validHours = round(d2n(detail.validHours), 2);
  const effectiveHours = approvedHours;
  const persistedAmount = d2n(detail.amount);
  const otHourlyRate = roundUpVnd(hourlyRate * rate);
  return {
    bucket,
    label: otBucketLabel(bucket),
    rate,
    ratePercent: round(rate * 100, 0),
    approvedHours,
    validHours,
    effectiveHours,
    hourlyRate,
    otHourlyRate,
    amount: persistedAmount > 0 ? roundUpVnd(effectiveHours * otHourlyRate) : 0,
    startTime: detail.startTime,
    endTime: detail.endTime,
    frame: bucket.includes('22h~6h') || bucket.includes('夜勤') || bucket.includes('ca đêm') ? 'night' : 'day',
    dayType: detail.dayType,
    source: 'ledger',
  };
}

async function findAttendanceByApproval(
  employeeId: string,
  approvedStart: Date | null | undefined,
) {
  if (!approvedStart) return null;
  const larkDate = addUtcDays(approvedStart, -1);
  return prisma.dailyAttendance.findUnique({
    where: {
      employeeId_attendanceDate: {
        employeeId,
        attendanceDate: new Date(Date.UTC(larkDate.getUTCFullYear(), larkDate.getUTCMonth(), larkDate.getUTCDate())),
      },
    },
  });
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

async function findCompLeaveMatches(
  employeeId: string,
  workedStart: Date | null | undefined,
  workedEnd: Date | null | undefined,
): Promise<CompLeaveMatch[]> {
  if (!workedStart || !workedEnd) return [];

  const changeRecords = await prisma.approvalRecord.findMany({
    where: {
      employeeId,
      status: 'APPROVED',
      approvalType: { in: ['ChangeHours', 'Hoán đổi thời gian làm việc/nghỉ ngơi', 'Hoán đổi ngày nghỉ'] },
    },
    select: {
      id: true,
      instanceCode: true,
      serialNumber: true,
      rawData: true,
    },
  });

  const matches: CompLeaveMatch[] = [];

  for (const record of changeRecords) {
    const intervals = parseDateIntervals(record.rawData);
    if (intervals.length < 2) continue;

    const workedInterval = intervals[0];
    if (!rangesOverlap(workedStart, workedEnd, workedInterval.start, workedInterval.end)) continue;

    for (const compLeaveInterval of intervals.slice(1)) {
      matches.push({
        approvalId: record.id,
        instanceCode: record.instanceCode,
        serialNumber: record.serialNumber,
        workedStart: workedInterval.start,
        workedEnd: workedInterval.end,
        compLeaveStart: compLeaveInterval.start,
        compLeaveEnd: compLeaveInterval.end,
        compLeaveHours: Math.min(d2n(compLeaveInterval.hours), 8),
      });
    }
  }

  return matches.sort((a, b) => a.compLeaveStart.getTime() - b.compLeaveStart.getTime());
}

// Helper: Normalize Vietnamese/English approvalType to English for frontend consistency
export function normalizeApprovalType(type: string | null | undefined): string {
  if (!type) return '';
  if (type === 'Làm thêm giờ' || type === 'OT') return 'OT';
  if (type === 'Nghỉ phép' || type === 'Leave') return 'Leave';
  if (type === 'Quên/chỉnh sửa chấm công' || type === 'Correction') return 'Correction';
  if (type === 'Hoán đổi thời gian làm việc/nghỉ ngơi' || type === 'Hoán đổi ngày nghỉ' || type === 'ChangeHours') return 'ChangeHours';
  if (type === 'Ca đêm' || type === 'NightShift') return 'NightShift';
  return type;
}

// ─── GET /api/approvals ────────────────────────────────────
// Query approval records with filters

router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      periodId,
      type,           // LEAVE | OT | CHANGE | CORRECTION | NIGHT_SHIFT | ALL
      leaveTypeBucket, // ANNUAL | UNPAID | BENEFIT | COMP_LEAVE
      status,         // APPROVED | REJECTED | PENDING | CANCELLED
      approvalCode,   // Specific approval definition code
      search,         // Search by employee name
    } = req.query;

    // Build where clause
    const where: Prisma.ApprovalRecordWhereInput = {};
    let selectedPeriod: Awaited<ReturnType<typeof prisma.payrollPeriod.findUnique>> = null;

    // Filter by approval type
    if (type && type !== 'ALL') {
      const typeMap: Record<string, string[]> = {
        LEAVE: ['Leave', 'Nghỉ phép'],
        OT: ['OT', 'Làm thêm giờ'],
        CHANGE: ['ChangeHours', 'Hoán đổi thời gian làm việc/nghỉ ngơi', 'Hoán đổi ngày nghỉ'],
        CORRECTION: ['Correction', 'Quên/chỉnh sửa chấm công'],
        NIGHT_SHIFT: ['NightShift', 'Ca đêm'],
      };
      where.approvalType = { in: typeMap[type as string] || [type as string] };
    }

    // Filter by leave type bucket
    if (leaveTypeBucket) {
      const buckets = (leaveTypeBucket as string).split(',');
      where.leaveTypeBucket = { in: buckets as any[] };
    }

    // Filter by status
    if (status) {
      where.status = status as any;
    }

    // Filter by approval code
    if (approvalCode) {
      where.approvalCode = approvalCode as string;
    }

    // Filter by period (match startTime within period date range)
    if (periodId) {
      selectedPeriod = await prisma.payrollPeriod.findUnique({
        where: { id: periodId as string },
      });
      if (selectedPeriod) {
        const periodEnd = endOfUtcDay(selectedPeriod.periodEnd);
        where.startTime = {
          gte: selectedPeriod.periodStart,
          lte: periodEnd,
        };
      }
    }

    // Search by employee name
    if (search) {
      where.employee = {
        fullName: { contains: search as string, mode: 'insensitive' },
      };
    }

    const records = await prisma.approvalRecord.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            department: true,
            position: true,
            scheduleType: true,
            larkMetadata: true,
          },
        },
      },
      orderBy: [
        { startTime: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    const recordIds = records.map(r => r.id);
    const ledgerDetails = recordIds.length > 0
      ? await prisma.otDetail.findMany({
          where: {
            approvalId: { in: recordIds },
            ...(selectedPeriod ? { periodId: selectedPeriod.id } : {}),
          },
          orderBy: [{ startTime: 'asc' }, { createdAt: 'asc' }],
        })
      : [];
    const ledgerByApproval = new Map<string, typeof ledgerDetails>();
    for (const detail of ledgerDetails) {
      if (!detail.approvalId) continue;
      const list = ledgerByApproval.get(detail.approvalId) ?? [];
      list.push(detail);
      ledgerByApproval.set(detail.approvalId, list);
    }

    const payBasisByKey = new Map<string, Promise<OtPayBasis>>();
    const getPayBasis = (employeeId: string, period: PeriodForOtPay) => {
      const key = `${employeeId}:${period?.id ?? 'current'}`;
      let basis = payBasisByKey.get(key);
      if (!basis) {
        basis = resolveOtPayBasis(employeeId, period);
        payBasisByKey.set(key, basis);
      }
      return basis;
    };
    const submissionPolicyConfig = await getApprovalSubmissionPolicyConfig(prisma);

    // Transform for frontend — extract avatarUrl from larkMetadata
    const data = await Promise.all(records.map(async r => {
      const meta = (r.employee.larkMetadata as Record<string, unknown> | null) ?? {};
      const normType = normalizeApprovalType(r.approvalType);
      const recordDate = r.startTime ?? r.applyDate ?? r.endTime;
      const periodForPay = selectedPeriod
        ? { id: selectedPeriod.id, monthKey: selectedPeriod.monthKey }
        : await findPayrollPeriodForDate(recordDate);
      const payBasis = await getPayBasis(r.employee.id, periodForPay);
      const hourlyRate = payBasis.hourlyRate;

      let otLabels: string[] = [];
      let otSegments: ApprovalOtSegment[] = [];
      let otParsedForPolicy: OtParseResult | null = null;
      if (normType === 'OT' || normType === 'NightShift' || normType === 'ChangeHours') {
        const rawD = r.rawData as Record<string, unknown> | null;
        if (rawD) {
          otParsedForPolicy = applySubmissionPolicyOverride(
            parseOtApproval(rawD, null, null, resolveEffectiveOtScheduleType(r.employee), normType, submissionPolicyConfig),
            r.submissionPolicyOverride,
          );
        }
        const counted = otParsedForPolicy?.submissionPolicy?.counted !== false;
        const ledger = ledgerByApproval.get(r.id) ?? [];
        if (ledger.length > 0) {
          const continuesFromDayOt = ledger.some((detail) => isWeekdayDayOtBucket(detail.bucket));
          otSegments = ledger.map(detail => {
            const segment = mapLedgerDetail(detail, hourlyRate, continuesFromDayOt);
            return counted ? segment : { ...segment, effectiveHours: 0, amount: 0 };
          });
        } else {
          if (otParsedForPolicy?.buckets) {
            otSegments = otParsedForPolicy.buckets.map(b => mapOtBucket(
              b,
              hourlyRate,
              'approved-window',
              !isCompLeaveOtPolicy(otParsedForPolicy?.otPolicy),
              counted,
            ));
          }
        }
        otLabels = Array.from(new Set(otSegments.map(s => s.bucket)));
      }
      const otSummary = summarizeOtSegments(otSegments);

      return {
        id: r.id,
        instanceCode: r.instanceCode,
        approvalCode: r.approvalCode,
        serialNumber: r.serialNumber,
        approvalType: normType,
        leaveType: r.leaveType,
        leaveTypeBucket: r.leaveTypeBucket,
        status: r.status,
        applyDate: r.applyDate,
        approvedHours: Number(r.approvedHours),
        approvedDays: Number(r.approvedDays),
        startTime: r.startTime,
        endTime: r.endTime,
        syncedAt: r.syncedAt,
        createdAt: r.createdAt,
        submissionPolicyOverride: r.submissionPolicyOverride,
        hourlyRate,
        baseSalary: payBasis.baseSalary,
        rankAllowance: payBasis.rankAllowance,
        payrollSalary: payBasis.payrollSalary,
        standardDays: payBasis.standardDays,
        dailyRate: payBasis.dailyRate,
        submissionPolicy: otParsedForPolicy?.submissionPolicy ?? null,
        otLabels,
        otSegments,
        otSummary,
        rawData: r.rawData,
        employee: {
          id: r.employee.id,
          fullName: r.employee.fullName,
          employeeCode: r.employee.employeeCode,
          department: r.employee.department,
          position: r.employee.position,
          avatarUrl: (meta.avatarUrl as string | null) ?? null,
        },
      };
    }));

    res.json({ success: true, data });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[API:Approvals] Error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── GET /api/approvals/stats ──────────────────────────────
// Summary stats for KPI cards

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const { periodId } = req.query;

    const where: Prisma.ApprovalRecordWhereInput = {};
    if (periodId) {
      const period = await prisma.payrollPeriod.findUnique({
        where: { id: periodId as string },
      });
      if (period) {
        const periodEnd = endOfUtcDay(period.periodEnd);
        where.startTime = {
          gte: period.periodStart,
          lte: periodEnd,
        };
      }
    }

    const [total, approved, pending, rejected] = await Promise.all([
      prisma.approvalRecord.count({ where }),
      prisma.approvalRecord.count({ where: { ...where, status: 'APPROVED' } }),
      prisma.approvalRecord.count({ where: { ...where, status: 'PENDING' } }),
      prisma.approvalRecord.count({ where: { ...where, status: 'REJECTED' } }),
    ]);

    // Sum approved OT hours
    const otAgg = await prisma.approvalRecord.aggregate({
      where: { ...where, approvalType: { in: ['OT', 'Làm thêm giờ'] }, status: 'APPROVED' },
      _sum: { approvedHours: true },
    });

    // Sum approved leave days
    const leaveAgg = await prisma.approvalRecord.aggregate({
      where: { ...where, approvalType: { in: ['Leave', 'Nghỉ phép'] }, status: 'APPROVED' },
      _sum: { approvedDays: true },
    });

    res.json({
      success: true,
      data: {
        total,
        approved,
        pending,
        rejected,
        totalOtHours: Number(otAgg._sum.approvedHours ?? 0),
        totalLeaveDays: Number(leaveAgg._sum.approvedDays ?? 0),
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── GET /api/approvals/codes ──────────────────────────────
// List configured approval definition codes from settings

router.get('/codes', async (_req: Request, res: Response) => {
  try {
    const settings = await prisma.payrollSetting.findMany({
      where: {
        category: 'approval',
        policyVersion: { category: 'approval', status: 'ACTIVE' },
      },
      orderBy: { sortOrder: 'asc' },
    });

    const codes = settings.map(s => {
      let parsed: Record<string, string> = {};
      try { parsed = JSON.parse(s.value); } catch { parsed = { code: s.value }; }
      return {
        id: s.id,
        key: s.key,
        label: s.label || s.key,
        description: s.description,
        ...parsed,
      };
    });

    res.json({ success: true, data: codes });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── POST /api/approvals/sync ──────────────────────────────
// Trigger sync from Lark for specific approval codes

router.post('/sync', async (req: Request, res: Response) => {
  try {
    const { approvalCodes, startDate, endDate } = req.body;

    // Dynamically import sync function
    const { syncApprovalsFromLark } = await import('../modules/sync/sync-approvals.js');
    const { createLarkClients } = await import('../shared/lark/index.js');
    const { approval } = createLarkClients();

    // Get codes from request or from DB settings
    let codesToSync: string[] = approvalCodes || [];

    if (codesToSync.length === 0) {
      // Load from DB settings
      const settings = await prisma.payrollSetting.findMany({
        where: {
          category: 'approval',
          policyVersion: { category: 'approval', status: 'ACTIVE' },
        },
      });
      codesToSync = settings
        .map(s => {
          try { return JSON.parse(s.value).code; } catch { return s.value; }
        })
        .filter(Boolean);
    }

    if (codesToSync.length === 0) {
      return res.json({
        success: false,
        error: 'No approval codes configured. Add codes in Settings → Phê duyệt.',
      });
    }

    const start = startDate
      ? new Date(startDate).getTime()
      : Date.now() - 30 * 24 * 60 * 60 * 1000; // Default: last 30 days
    const end = endDate
      ? Math.min(Date.now(), addUtcDays(endOfUtcDay(new Date(endDate)), 45).getTime())
      : Date.now();

    const result = await syncApprovalsFromLark(approval, {
      startTime: start,
      endTime: end,
      approvalCodes: codesToSync,
    });

    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[API:Approvals] Sync error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── PATCH /api/approvals/:id/submission-policy-override ─────
// Manual grace switch for late OT / work-time-change approvals
router.patch('/:id/submission-policy-override', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const enabled = Boolean(req.body?.enabled);
    const record = await prisma.approvalRecord.update({
      where: { id },
      data: { submissionPolicyOverride: enabled },
      select: {
        id: true,
        employeeId: true,
        approvalType: true,
        startTime: true,
        applyDate: true,
        endTime: true,
        submissionPolicyOverride: true,
      },
    });

    const recalculated = await recalculateApprovalImpact(record);
    res.json({
      success: true,
      data: {
        id: record.id,
        submissionPolicyOverride: record.submissionPolicyOverride,
        recalculated,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[API:Approvals] Override error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// ─── GET /api/approvals/:id ────────────────────────────────
// Get single approval detail

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const record = await prisma.approvalRecord.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            department: true,
            position: true,
            scheduleType: true,
            larkMetadata: true,
          },
        },
      },
    });

    if (!record) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }

    const emp = record.employee as {
      id: string; fullName: string; employeeCode: string | null;
      department: string | null; position: string | null; scheduleType: string | null; larkMetadata: unknown;
    };
    const meta = (emp.larkMetadata as Record<string, unknown> | null) ?? {};
    const recordDate = record.startTime ?? record.applyDate ?? record.endTime;
    const period = recordDate
      ? await prisma.payrollPeriod.findFirst({
          where: {
            periodStart: { lte: recordDate },
            periodEnd: { gte: recordDate },
          },
        })
      : null;
    const payBasis = await resolveOtPayBasis(
      record.employeeId,
      period ? { id: period.id, monthKey: period.monthKey } : null,
    );
    const hourlyRate = payBasis.hourlyRate;
    const baseSalary = payBasis.baseSalary;
    const dailyRate = payBasis.dailyRate;
    const submissionPolicyConfig = await getApprovalSubmissionPolicyConfig(prisma);

    // Parse OT buckets + changeWorkingFrame if applicable
    const normType = normalizeApprovalType(record.approvalType);
    let otParsed: OtParseResult | null = null;
    let otSegments: ApprovalOtSegment[] = [];
    let compLeaveMatches: CompLeaveMatch[] = [];
    if (normType === 'OT' || normType === 'NightShift' || normType === 'ChangeHours') {
      const rawD = record.rawData as Record<string, unknown> | null;
      if (rawD) {
        const scheduleType = resolveEffectiveOtScheduleType(emp);
        const firstPass = applySubmissionPolicyOverride(
          parseOtApproval(rawD, null, null, scheduleType, normType, submissionPolicyConfig),
          record.submissionPolicyOverride,
        );
        const ledgerDetails = await prisma.otDetail.findMany({
          where: {
            approvalId: record.id,
            ...(period ? { periodId: period.id } : {}),
          },
          orderBy: [{ startTime: 'asc' }, { createdAt: 'asc' }],
        });

        if (ledgerDetails.length > 0) {
          otParsed = firstPass;
          const continuesFromDayOt = ledgerDetails.some((detail) => isWeekdayDayOtBucket(detail.bucket));
          const counted = firstPass?.submissionPolicy?.counted !== false;
          otSegments = ledgerDetails.map(detail => {
            const segment = mapLedgerDetail(detail, hourlyRate, continuesFromDayOt);
            return counted ? segment : { ...segment, effectiveHours: 0, amount: 0 };
          });
        } else {
          const daily = await findAttendanceByApproval(record.employeeId, firstPass?.approvedStart ?? record.startTime ?? record.applyDate);
          otParsed = applySubmissionPolicyOverride(parseOtApproval(
            rawD,
            daily?.checkIn ?? null,
            daily?.checkOut ?? null,
            scheduleType,
            normType,
            submissionPolicyConfig,
          ), record.submissionPolicyOverride) ?? firstPass;
          otSegments = otParsed?.buckets.map(b => mapOtBucket(
            b,
            hourlyRate,
            daily ? 'attendance-overlap' : 'approved-window',
            !isCompLeaveOtPolicy(otParsed?.otPolicy),
            otParsed?.submissionPolicy?.counted !== false,
          )) ?? [];
        }

        if (normType === 'OT' && isCompLeaveOtPolicy(firstPass?.otPolicy)) {
          compLeaveMatches = await findCompLeaveMatches(
            record.employeeId,
            firstPass?.approvedStart ?? record.startTime,
            firstPass?.approvedEnd ?? record.endTime,
          );
        }
      }
    }
    const otSummary = summarizeOtSegments(otSegments);

    res.json({
      success: true,
      data: {
        id: record.id,
        instanceCode: record.instanceCode,
        approvalCode: record.approvalCode,
        serialNumber: record.serialNumber,
        approvalType: normType,
        leaveType: record.leaveType,
        leaveTypeBucket: record.leaveTypeBucket,
        status: record.status,
        applyDate: record.applyDate,
        approvedHours: Number(record.approvedHours),
        approvedDays: Number(record.approvedDays),
        startTime: record.startTime,
        endTime: record.endTime,
        syncedAt: record.syncedAt,
        createdAt: record.createdAt,
        submissionPolicyOverride: record.submissionPolicyOverride,
        // Salary for OT calculation
        hourlyRate,
        baseSalary,
        rankAllowance: payBasis.rankAllowance,
        payrollSalary: payBasis.payrollSalary,
        standardDays: payBasis.standardDays,
        dailyRate,
        submissionPolicy: otParsed?.submissionPolicy ?? null,
        employee: {
          id: emp.id,
          fullName: emp.fullName,
          employeeCode: emp.employeeCode,
          department: emp.department,
          position: emp.position,
          avatarUrl: (meta.avatarUrl as string | null) ?? null,
        },
        // OT bucket breakdown (if applicable)
        otBuckets: otSegments.length > 0 ? otSegments : null,
        otSegments,
        otSummary,
        otPolicy: otParsed?.otPolicy ?? null,
        compLeaveMatches,
        isNightShift: otParsed?.isNightShift ?? false,
        // ChangeHours: khung giờ ca mới (shiftStart/shiftEnd từ rawData)
        changeWorkingFrame: otParsed?.changeWorkingFrame ?? null,
        rawData: record.rawData,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
