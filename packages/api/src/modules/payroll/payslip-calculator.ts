/**
 * Payslip Calculator — Orchestrator tính phiếu lương hoàn chỉnh
 *
 * Pipeline: attendance → salary policy → OT → gross → insurance → PIT → net
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { round, roundUp } from '../../shared/utils/round.js';
import { DEPENDENT_DEDUCTION, MEAL_TAX_EXEMPT_CAP, PERSONAL_DEDUCTION } from '../../config/constants.js';
import { calculateGrossIncome, type Allowances } from './gross-income.js';
import { calculateInsurance, type InsuranceCaps } from './insurance.js';
import { calculatePit } from './pit.js';
import { calculateNetSalary } from './net-salary.js';
import { calculateHourlyRate } from '../ot/hourly-rate.js';
import { normalizePayrollAllowances } from './allowance-policy.js';
import { belongsToPeriodByJoinDate } from '../../shared/utils/employment-period.js';

const MODULE = '[Payroll:Payslip]';
const ASV024_SPLIT_MONTH = '202605';
const ASV024_PROBATION_END = '2026-05-09';
const ASV024_OFFICIAL_BASE_SALARY = 20_000_000;
const ASV024_PROBATION_RATIO = 0.85;
const ASV024_OFFICIAL_ALLOWANCES: Allowances = normalizePayrollAllowances({
  rank: 0,
  bpql: 0,
  sales: 0,
  technical: 0,
  language: 500_000,
  housing: 1_000_000,
  transport: 900_000,
  meal: 930_000,
  phone: 0,
  attendance: 0,
});
// ─── Types ──────────────────────────────────────────────────

export interface PayslipResult {
  standardDays: number;
  actualDays: number;
  workRatio: number;
  baseSalary: number;
  actualSalary: number;
  allowancesTotal: number;
  otTotalHours: number;
  otTotalAmount: number;
  otBucketBreakdown: Record<string, unknown> | null;
  lateDeduction: number;
  grossIncome: number;
  insuranceEmployee: number;
  insuranceEmployer: number;
  taxExempt: number;
  taxableIncome: number;
  pitAmount: number;
  afterTaxAdjustment: number;
  unionFee: number;
  netSalary: number;
}

interface ManualPayrollOverrides {
  standardDays?: number;
  actualDays?: number;
  baseSalary?: number;
  otTotalAmount?: number;
  afterTaxAdjustment?: number;
  allowances?: Partial<Allowances>;
  otHours?: Partial<Record<OtHourOverrideKey, number>>;
  [key: string]: unknown;
}

type OtHourOverrideKey =
  | 'weekday'
  | 'weekdayNight'
  | 'weekend'
  | 'holiday'
  | 'untilNight'
  | 'nightNormal'
  | 'nightWeekend';

type OtBucketDetail = { hours: number; amount: number };

type ProbationSegmentRule = {
  source: 'employee_metadata' | 'legacy_asv024';
  probationStart: string;
  probationEnd: string;
  probationRatio: number;
  officialStart: string | null;
  officialBaseSalary: number;
  officialAllowances: Allowances;
  officialActualDaysCap?: number;
};

const OT_HOUR_OVERRIDE_DEFS: Array<{
  key: OtHourOverrideKey;
  bucket: string;
  rate: number;
  matches: (bucket: string) => boolean;
}> = [
  {
    key: 'weekday',
    bucket: 'Ngày thường 時間外 17h~22h',
    rate: 1.5,
    matches: (bucket) => bucket.includes('Ngày thường 時間外 17h~22h'),
  },
  {
    key: 'weekdayNight',
    bucket: 'Làm thêm ca đêm của ngày thường',
    rate: 2,
    matches: (bucket) =>
      bucket.includes('weekday_night')
      || bucket.includes('Ngày thường — Ban đêm')
      || bucket.includes('Làm thêm ca đêm của ngày thường')
      || bucket.includes('日勤の夜間残業'),
  },
  {
    key: 'weekend',
    bucket: 'Ngày nghỉ 休日出勤 6h~22h',
    rate: 2,
    matches: (bucket) =>
      bucket.includes('Ngày nghỉ T7 休日出勤(土) 6h~22h')
      || bucket.includes('Ngày nghỉ 休日出勤 6h~22h'),
  },
  {
    key: 'holiday',
    bucket: 'OT ngày lễ 祝日出勤',
    rate: 3,
    matches: (bucket) => bucket.includes('OT ngày lễ 祝日出勤') && !bucket.includes('ca đêm'),
  },
  {
    key: 'untilNight',
    bucket: 'Ngày thường 時間外(夜間まで残業) 22h~6h',
    rate: 2.1,
    matches: (bucket) => (bucket.includes('夜間まで残業') || bucket.includes('夕間まで残業')) && bucket.includes('22h~6h'),
  },
  {
    key: 'nightNormal',
    bucket: '平日の夜勤 22h~6h ca đêm',
    rate: 0.3,
    matches: (bucket) => bucket.includes('平日の夜勤') || bucket.includes('Ca đêm 22h~6h'),
  },
  {
    key: 'nightWeekend',
    bucket: 'Ngày nghỉ ca đêm 休日の夜勤 22h~6h',
    rate: 2.7,
    matches: (bucket) => bucket.includes('Ngày nghỉ T7 ca đêm') || bucket.includes('Ngày nghỉ ca đêm'),
  },
];

// ─── Helpers ────────────────────────────────────────────────

function d2n(val: unknown): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getManualOverrides(fullBreakdown: unknown): ManualPayrollOverrides {
  if (!isRecord(fullBreakdown) || !isRecord(fullBreakdown.manualOverrides)) return {};
  return fullBreakdown.manualOverrides as ManualPayrollOverrides;
}

function overrideNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundUpToTens(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.ceil(value / 10) * 10 : 0;
}

function normalizeOtBucketBreakdown(value: unknown): Record<string, OtBucketDetail> {
  if (!isRecord(value)) return {};

  return Object.entries(value).reduce<Record<string, OtBucketDetail>>((acc, [bucket, detail]) => {
    if (!isRecord(detail)) return acc;
    acc[bucket] = {
      hours: d2n(detail.hours),
      amount: d2n(detail.amount),
    };
    return acc;
  }, {});
}

function hasOtHourOverrides(manualOverrides: ManualPayrollOverrides): boolean {
  const otHours = isRecord(manualOverrides.otHours) ? manualOverrides.otHours : {};
  return OT_HOUR_OVERRIDE_DEFS.some((def) => def.key in otHours);
}

function applyOtHourOverrides(input: {
  bucketBreakdown: unknown;
  manualOverrides: ManualPayrollOverrides;
  hourlyRate: number;
}): { bucketBreakdown: Record<string, OtBucketDetail>; totalHours: number; totalAmount: number } {
  const next = normalizeOtBucketBreakdown(input.bucketBreakdown);
  const otHours = isRecord(input.manualOverrides.otHours) ? input.manualOverrides.otHours : {};
  const roundedHourlyRate = roundUpToTens(input.hourlyRate);

  for (const def of OT_HOUR_OVERRIDE_DEFS) {
    if (!(def.key in otHours)) continue;
    const parsed = Number(otHours[def.key]);
    if (!Number.isFinite(parsed) || parsed < 0) continue;

    for (const bucket of Object.keys(next)) {
      if (def.matches(bucket)) delete next[bucket];
    }

    const hours = round(parsed, 2);
    const unitRate = roundUpToTens(roundedHourlyRate * def.rate);
    next[def.bucket] = {
      hours,
      amount: hours > 0 ? roundUp(hours * unitRate, 0) : 0,
    };
  }

  const totalHours = round(
    Object.entries(next)
      .filter(([bucket]) => bucket !== 'night_normal')
      .reduce((sum, [, detail]) => sum + detail.hours, 0),
    2,
  );
  const totalAmount = Object.values(next).reduce((sum, detail) => sum + detail.amount, 0);
  return { bucketBreakdown: next, totalHours, totalAmount };
}

function attendanceBaseSalary(baseSalary: number, allowances: Allowances): number {
  return baseSalary + allowances.rank;
}

function insuranceSalaryBasis(baseSalary: number, allowances: Allowances): number {
  return baseSalary
    + allowances.rank
    + allowances.bpql
    + allowances.sales
    + allowances.technical
    + allowances.language;
}

function allowancesExcludingRank(allowances: Allowances): Allowances {
  return {
    ...allowances,
    rank: 0,
  };
}

function parsePositiveSetting(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function loadInsuranceCaps(prisma: PrismaClient): Promise<Partial<InsuranceCaps>> {
  const settings = await prisma.payrollSetting.findMany({
    where: {
      policyVersion: { status: 'ACTIVE' },
      category: { in: ['general', 'insurance'] },
      key: {
        in: [
          'social_insurance_salary_cap',
          'unemployment_insurance_salary_cap',
          'insurance_salary_cap',
        ],
      },
    },
    select: { category: true, key: true, value: true },
  });

  const get = (category: string, key: string): number | undefined =>
    parsePositiveSetting(settings.find((item) => item.category === category && item.key === key)?.value);

  return {
    bhxhBhyt:
      get('general', 'social_insurance_salary_cap')
      ?? get('insurance', 'insurance_salary_cap'),
    bhtn: get('general', 'unemployment_insurance_salary_cap'),
  };
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function monthKeyToPolicyPeriodKey(monthKey: string): string {
  return `${monthKey.slice(0, 4)}-${monthKey.slice(4, 6)}`;
}

function isWithinDateRange(value: Date, start: string, end: string): boolean {
  const key = dateKey(value);
  return key >= start && key <= end;
}

function isAsv024Transition(employee: { employeeCode?: string | null; userId: string }, period: { monthKey: string }): boolean {
  return period.monthKey === ASV024_SPLIT_MONTH && (employee.employeeCode === 'ASV024' || employee.userId === 'db25735a');
}

function normalizeDateKey(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function addDaysKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function maxDateKey(a: string, b: string): string {
  return a >= b ? a : b;
}

function minDateKey(a: string, b: string): string {
  return a <= b ? a : b;
}

function hasDateOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA <= endB && endA >= startB;
}

function parseProbationRatio(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return ASV024_PROBATION_RATIO;
  return parsed > 1 ? parsed / 100 : parsed;
}

function resolveProbationSegmentRule(
  employee: { employeeCode?: string | null; userId: string; larkMetadata?: unknown },
  period: { monthKey: string; periodStart: Date; periodEnd: Date },
  officialBaseSalary: number,
  officialAllowances: Allowances,
): ProbationSegmentRule | null {
  const periodStart = dateKey(period.periodStart);
  const periodEnd = dateKey(period.periodEnd);
  const metadata = isRecord(employee.larkMetadata) ? employee.larkMetadata : {};
  const probationStart = normalizeDateKey(metadata.probationStart);
  const probationEnd = normalizeDateKey(metadata.probationEnd);

  if (probationStart && probationEnd && probationEnd >= probationStart && hasDateOverlap(probationStart, probationEnd, periodStart, periodEnd)) {
    const officialStart = addDaysKey(probationEnd, 1);
    return {
      source: 'employee_metadata',
      probationStart,
      probationEnd,
      probationRatio: parseProbationRatio(metadata.probationRatio),
      officialStart: officialStart <= periodEnd ? officialStart : null,
      officialBaseSalary,
      officialAllowances,
    };
  }

  if (isAsv024Transition(employee, period)) {
    const officialStart = addDaysKey(ASV024_PROBATION_END, 1);
    return {
      source: 'legacy_asv024',
      probationStart: periodStart,
      probationEnd: ASV024_PROBATION_END,
      probationRatio: ASV024_PROBATION_RATIO,
      officialStart,
      officialBaseSalary: ASV024_OFFICIAL_BASE_SALARY,
      officialAllowances: ASV024_OFFICIAL_ALLOWANCES,
      officialActualDaysCap: 13,
    };
  }

  return null;
}

function calculatePayrollTaxExemptions(input: {
  allowances: Allowances;
  otTotalAmount: number;
  workRatio: number;
}): { ot: number; meal: number; phone: number; total: number } {
  const ot = round(input.otTotalAmount, 0);
  const meal = round(Math.min(input.allowances.meal, MEAL_TAX_EXEMPT_CAP) * input.workRatio, 0);
  const phone = round(input.allowances.phone * input.workRatio, 0);
  return { ot, meal, phone, total: ot + meal + phone };
}

function calculateSegment(input: {
  key: string;
  label: string;
  employmentType: 'P' | 'FT';
  standardDays: number;
  actualDays: number;
  baseSalary: number;
  allowances: Allowances;
  insuranceCaps: Partial<InsuranceCaps>;
  lateHours: number;
  earlyHours: number;
  otTotalHours?: number;
  otTotalAmount?: number;
  personalDeduction: number;
  dependentDeduction: number;
}) {
  const payrollSalary = attendanceBaseSalary(input.baseSalary, input.allowances);
  const hourlyRate = calculateHourlyRate(payrollSalary, input.standardDays);
  const gross = calculateGrossIncome({
    baseSalary: payrollSalary,
    actualDays: input.actualDays,
    standardDays: input.standardDays,
    allowances: allowancesExcludingRank(input.allowances),
    otTotalAmount: input.otTotalAmount ?? 0,
    lateHours: input.lateHours,
    earlyHours: input.earlyHours,
    hourlyRate,
  });
  const insurance = calculateInsurance(insuranceSalaryBasis(input.baseSalary, input.allowances), input.employmentType, input.insuranceCaps);
  const taxExemptions = calculatePayrollTaxExemptions({
    allowances: input.allowances,
    otTotalAmount: input.otTotalAmount ?? 0,
    workRatio: gross.workRatio,
  });
  const pit = calculatePit({
    grossIncome: gross.grossIncome,
    insuranceEmployee: insurance.employee.total,
    taxExemptIncome: taxExemptions.total,
    personalDeduction: input.employmentType === 'P' ? 0 : input.personalDeduction,
    dependentDeduction: input.employmentType === 'P' ? 0 : input.dependentDeduction,
    employmentType: input.employmentType,
  });
  const netSalary = calculateNetSalary({
    grossIncome: gross.grossIncome,
    insuranceEmployee: insurance.employee.total,
    pitAmount: pit.pitAmount,
    afterTaxAdjustment: 0,
    unionFee: 0,
  });

  return {
    key: input.key,
    label: input.label,
    employmentType: input.employmentType,
    staffClassify: input.employmentType === 'P' ? 'P' : 'O',
    standardDays: input.standardDays,
    actualDays: input.actualDays,
    workRatio: gross.workRatio,
    baseSalary: input.baseSalary,
    actualSalary: gross.actualSalary,
    allowancesTotal: gross.proratedAllowances,
    otTotalHours: input.otTotalHours ?? 0,
    otTotalAmount: input.otTotalAmount ?? 0,
    otBucketBreakdown: null as Record<string, unknown> | null,
    lateDeduction: gross.lateDeduction,
    grossIncome: gross.grossIncome,
    insuranceEmployee: insurance.employee.total,
    insuranceEmployer: insurance.employer.total,
    taxExempt: input.employmentType === 'P' ? 0 : input.personalDeduction + input.dependentDeduction,
    taxableIncome: pit.taxableIncome,
    pitAmount: pit.pitAmount,
    afterTaxAdjustment: 0,
    unionFee: 0,
    netSalary,
    gross,
    insurance,
    pit,
    allowances: input.allowances,
    taxExemptions,
    hourlyRate,
  };
}

// ─── Main Functions ─────────────────────────────────────────

/**
 * Calculate complete payslip for one employee in one period.
 */
export async function calculatePayslip(
  employeeId: string,
  periodId: string,
  prisma: PrismaClient,
): Promise<PayslipResult> {
  // 1. Fetch data
  const [attendance, otMonthly, employee, period, existingPayslip, insuranceCaps] = await Promise.all([
    prisma.monthlyAttendance.findUnique({
      where: { employeeId_periodId: { employeeId, periodId } },
    }),
    prisma.otMonthly.findUnique({
      where: { employeeId_periodId: { employeeId, periodId } },
    }),
    prisma.employee.findUniqueOrThrow({ where: { id: employeeId } }),
    prisma.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } }),
    prisma.payslip.findUnique({
      where: { employeeId_periodId: { employeeId, periodId } },
      select: { fullBreakdown: true },
    }),
    loadInsuranceCaps(prisma),
  ]);
  const policyPeriodKey = monthKeyToPolicyPeriodKey(period.monthKey);
  const [periodSalaryPolicy, currentSalaryPolicy, periodTaxPolicy, currentTaxPolicy] = await Promise.all([
    prisma.salaryPolicy.findUnique({
      where: { employeeId_periodKey: { employeeId, periodKey: policyPeriodKey } },
    }),
    prisma.salaryPolicy.findFirst({
      where: { employeeId, isCurrent: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.taxPolicy.findUnique({
      where: { employeeId_periodKey: { employeeId, periodKey: policyPeriodKey } },
    }),
    prisma.taxPolicy.findFirst({
      where: { employeeId, isCurrent: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const salaryPolicy = periodSalaryPolicy ?? currentSalaryPolicy;
  const taxPolicy = periodTaxPolicy ?? currentTaxPolicy;

  if (!attendance) {
    throw new Error(`No monthly attendance found for employee ${employeeId} in period ${periodId}`);
  }

  const existingFullBreakdown = isRecord(existingPayslip?.fullBreakdown)
    ? existingPayslip.fullBreakdown
    : {};
  const manualOverrides = getManualOverrides(existingFullBreakdown);

  // 2. Extract values
  const standardDays = overrideNumber(manualOverrides.standardDays, d2n(attendance.standardDays));
  const actualDays = overrideNumber(manualOverrides.actualDays, d2n(attendance.actualDays));
  const lateHours = d2n(attendance.lateHours);
  const earlyHours = d2n(attendance.earlyHours);

  const baseSalary = overrideNumber(manualOverrides.baseSalary, salaryPolicy ? d2n(salaryPolicy.baseSalary) : 0);

  const policyAllowances: Allowances = normalizePayrollAllowances({
    rank: salaryPolicy ? d2n(salaryPolicy.rankAllowance) : 0,
    bpql: salaryPolicy ? d2n(salaryPolicy.bpqlAllowance) : 0,
    sales: salaryPolicy ? d2n(salaryPolicy.salesAllowance) : 0,
    technical: salaryPolicy ? d2n(salaryPolicy.technicalAllowance) : 0,
    language: salaryPolicy ? d2n(salaryPolicy.languageAllowance) : 0,
    housing: salaryPolicy ? d2n(salaryPolicy.housingAllowance) : 0,
    transport: salaryPolicy ? d2n(salaryPolicy.transportAllowance) : 0,
    meal: salaryPolicy ? d2n(salaryPolicy.mealAllowance) : 0,
    phone: salaryPolicy ? d2n(salaryPolicy.phoneAllowance) : 0,
    attendance: salaryPolicy ? d2n(salaryPolicy.attendanceAllowance) : 0,
  });
  const allowanceOverrides = isRecord(manualOverrides.allowances) ? manualOverrides.allowances : {};
  const allowances: Allowances = normalizePayrollAllowances({
    ...policyAllowances,
    rank: overrideNumber(allowanceOverrides.rank, policyAllowances.rank),
    technical: overrideNumber(allowanceOverrides.technical, policyAllowances.technical),
    language: overrideNumber(allowanceOverrides.language, policyAllowances.language),
    housing: overrideNumber(allowanceOverrides.housing, policyAllowances.housing),
    transport: overrideNumber(allowanceOverrides.transport, policyAllowances.transport),
    meal: overrideNumber(allowanceOverrides.meal, policyAllowances.meal),
    phone: overrideNumber(allowanceOverrides.phone, policyAllowances.phone),
    attendance: overrideNumber(allowanceOverrides.attendance, policyAllowances.attendance),
  });
  const payrollSalary = attendanceBaseSalary(baseSalary, allowances);
  const hourlyRate = calculateHourlyRate(payrollSalary, standardDays);

  const personalDeduction = taxPolicy ? d2n(taxPolicy.personalDeduction) : PERSONAL_DEDUCTION;
  const dependents = taxPolicy ? taxPolicy.dependents : 0;
  const dependentDeductionPerPerson = taxPolicy && d2n(taxPolicy.dependentDeduction) > 0
    ? d2n(taxPolicy.dependentDeduction)
    : DEPENDENT_DEDUCTION;
  const dependentDeduction = dependents * dependentDeductionPerPerson;

  const probationRule = resolveProbationSegmentRule(employee, period, baseSalary, allowances);
  if (probationRule) {
    const dailyAttendances = await prisma.dailyAttendance.findMany({
      where: {
        employeeId,
        attendanceDate: {
          gte: period.periodStart,
          lte: period.periodEnd,
        },
      },
      orderBy: { attendanceDate: 'asc' },
    });
    const periodStartKey = dateKey(period.periodStart);
    const periodEndKey = dateKey(period.periodEnd);
    const probationStartInPeriod = maxDateKey(probationRule.probationStart, periodStartKey);
    const probationEndInPeriod = minDateKey(probationRule.probationEnd, periodEndKey);
    const officialStartInPeriod = probationRule.officialStart
      ? maxDateKey(probationRule.officialStart, periodStartKey)
      : null;
    const probationHours = dailyAttendances
      .filter((item) => isWithinDateRange(item.attendanceDate, probationStartInPeriod, probationEndInPeriod))
      .reduce((sum, item) => sum + d2n(item.workHours), 0);
    const officialHours = officialStartInPeriod && officialStartInPeriod <= periodEndKey
      ? dailyAttendances
        .filter((item) => isWithinDateRange(item.attendanceDate, officialStartInPeriod, periodEndKey))
        .reduce((sum, item) => sum + d2n(item.workHours), 0)
      : 0;
    const officialActualDaysRaw = round(officialHours / 8, 2);
    const officialActualDays = probationRule.officialActualDaysCap
      ? Math.min(probationRule.officialActualDaysCap, officialActualDaysRaw)
      : officialActualDaysRaw;
    const segmentStandardDays = standardDays > 0 ? standardDays : 25;
    const probationSegment = calculateSegment({
      key: 'probation',
      label: `Thử việc ${Math.round(probationRule.probationRatio * 100)}%`,
      employmentType: 'P',
      standardDays: segmentStandardDays,
      actualDays: round(probationHours / 8, 2),
      baseSalary: probationRule.officialBaseSalary * probationRule.probationRatio,
      allowances: probationRule.officialAllowances,
      insuranceCaps,
      lateHours: 0,
      earlyHours: 0,
      personalDeduction,
      dependentDeduction,
    });
    const segments: Array<ReturnType<typeof calculateSegment> & { dateRange: string; sourceHours: number; note: string }> = [
      {
        ...probationSegment,
        dateRange: `${probationStartInPeriod}~${probationEndInPeriod}`,
        sourceHours: round(probationHours, 2),
        note: `Tính theo giờ trong thời gian thử việc, hưởng ${Math.round(probationRule.probationRatio * 100)}%, áp dụng phụ cấp theo chính sách, không tính BH/giảm trừ gia cảnh.`,
      },
    ];
    let officialSegment: ReturnType<typeof calculateSegment> | null = null;
    if (officialStartInPeriod && officialStartInPeriod <= periodEndKey) {
      officialSegment = calculateSegment({
        key: 'official',
        label: 'Chính thức',
        employmentType: 'FT',
        standardDays: segmentStandardDays,
        actualDays: officialActualDays,
        baseSalary: probationRule.officialBaseSalary,
        allowances: probationRule.officialAllowances,
        insuranceCaps,
        lateHours: 0,
        earlyHours: 0,
        personalDeduction,
        dependentDeduction,
      });
      segments.push({
        ...officialSegment,
        dateRange: `${officialStartInPeriod}~${periodEndKey}`,
        sourceHours: round(officialHours, 2),
        note: `Tính lương chính thức từ ngày ${officialStartInPeriod}, tính BH/PIT như nhân sự chính thức.`,
      });
    }
    const insuranceAnchorSegment = officialSegment ?? probationSegment;
    const result: PayslipResult = {
      standardDays,
      actualDays,
      workRatio: standardDays > 0 ? round(actualDays / standardDays, 4) : 0,
      baseSalary: probationRule.officialBaseSalary,
      actualSalary: segments.reduce((sum, item) => sum + item.actualSalary, 0),
      allowancesTotal: segments.reduce((sum, item) => sum + item.allowancesTotal, 0),
      otTotalHours: 0,
      otTotalAmount: 0,
      otBucketBreakdown: null,
      lateDeduction: 0,
      grossIncome: segments.reduce((sum, item) => sum + item.grossIncome, 0),
      insuranceEmployee: segments.reduce((sum, item) => sum + item.insuranceEmployee, 0),
      insuranceEmployer: segments.reduce((sum, item) => sum + item.insuranceEmployer, 0),
      taxExempt: officialSegment?.taxExempt ?? probationSegment.taxExempt,
      taxableIncome: segments.reduce((sum, item) => sum + item.taxableIncome, 0),
      pitAmount: segments.reduce((sum, item) => sum + item.pitAmount, 0),
      afterTaxAdjustment: overrideNumber(manualOverrides.afterTaxAdjustment, 0),
      unionFee: 0,
      netSalary: 0,
    };
    result.netSalary = calculateNetSalary({
      grossIncome: result.grossIncome,
      insuranceEmployee: result.insuranceEmployee,
      pitAmount: result.pitAmount,
      afterTaxAdjustment: result.afterTaxAdjustment,
      unionFee: result.unionFee,
    });
    const aggregateInsurance = {
      insuranceBasis: insuranceAnchorSegment.insurance.insuranceBasis,
      basisBhxhBhyt: insuranceAnchorSegment.insurance.basisBhxhBhyt,
      basisBhtn: insuranceAnchorSegment.insurance.basisBhtn,
      caps: insuranceAnchorSegment.insurance.caps,
      employee: {
        bhxh: insuranceAnchorSegment.insurance.employee.bhxh,
        bhyt: insuranceAnchorSegment.insurance.employee.bhyt,
        bhtn: insuranceAnchorSegment.insurance.employee.bhtn,
        total: result.insuranceEmployee,
      },
      employer: {
        bhxh: insuranceAnchorSegment.insurance.employer.bhxh,
        bhyt: insuranceAnchorSegment.insurance.employer.bhyt,
        bhtn: insuranceAnchorSegment.insurance.employer.bhtn,
        total: result.insuranceEmployer,
      },
      grandTotal: result.insuranceEmployee + result.insuranceEmployer,
    };
    const fullBreakdownJson = {
      ...existingFullBreakdown,
      gross: {
        workRatio: result.workRatio,
        actualSalary: result.actualSalary,
        proratedAllowances: result.allowancesTotal,
        phoneAllowance: insuranceAnchorSegment.gross.phoneAllowance,
        lateDeduction: result.lateDeduction,
        grossIncome: result.grossIncome,
      },
      insurance: aggregateInsurance,
      pit: {
        taxableIncome: result.taxableIncome,
        pitAmount: result.pitAmount,
        effectiveRate: result.grossIncome > 0 ? round(result.pitAmount / result.grossIncome, 4) : 0,
        bracketDetails: segments.flatMap((item) => item.pit.bracketDetails),
      },
      allowances: probationRule.officialAllowances,
      taxExemptions: {
        ot: 0,
        meal: insuranceAnchorSegment.taxExemptions.meal,
        phone: insuranceAnchorSegment.taxExemptions.phone,
        total: insuranceAnchorSegment.taxExemptions.total,
      },
      payrollSegments: segments.map((segment) => ({
        key: segment.key,
        label: segment.label,
        virtual: true,
        dateRange: segment.dateRange,
        sourceHours: segment.sourceHours,
        note: segment.note,
        employmentType: segment.employmentType,
        staffClassify: segment.staffClassify,
        standardDays: segment.standardDays,
        actualDays: segment.actualDays,
        workRatio: segment.workRatio,
        baseSalary: segment.baseSalary,
        actualSalary: segment.actualSalary,
        allowancesTotal: segment.allowancesTotal,
        otTotalHours: segment.otTotalHours,
        otTotalAmount: segment.otTotalAmount,
        otBucketBreakdown: segment.otBucketBreakdown,
        lateDeduction: segment.lateDeduction,
        grossIncome: segment.grossIncome,
        insuranceEmployee: segment.insuranceEmployee,
        insuranceEmployer: segment.insuranceEmployer,
        taxExempt: segment.taxExempt,
        taxableIncome: segment.taxableIncome,
        pitAmount: segment.pitAmount,
        afterTaxAdjustment: segment.afterTaxAdjustment,
        unionFee: segment.unionFee,
        netSalary: segment.netSalary,
        fullBreakdown: {
          gross: segment.gross,
          insurance: segment.insurance,
          pit: segment.pit,
          allowances: segment.allowances,
          taxExemptions: segment.taxExemptions,
          payrollSegment: {
            key: segment.key,
            label: segment.label,
            virtual: true,
            dateRange: segment.dateRange,
            sourceHours: segment.sourceHours,
            note: segment.note,
          },
        },
      })),
      payrollSegmentRule: {
        source: probationRule.source,
        employeeCode: employee.employeeCode,
        monthKey: period.monthKey,
        probationStart: probationRule.probationStart,
        probationEnd: probationRule.probationEnd,
        officialStart: probationRule.officialStart,
        officialBaseSalary: probationRule.officialBaseSalary,
        probationRatio: probationRule.probationRatio,
      },
      manualOverrides,
      manualAppliedAt: new Date().toISOString(),
    } as unknown as Prisma.InputJsonValue;

    await prisma.payslip.upsert({
      where: { employeeId_periodId: { employeeId, periodId } },
      create: {
        employeeId,
        periodId,
        ...result,
        otBucketBreakdown: Prisma.JsonNull,
        status: 'DRAFT',
        fullBreakdown: fullBreakdownJson,
        calculatedAt: new Date(),
      },
      update: {
        ...result,
        otBucketBreakdown: Prisma.JsonNull,
        fullBreakdown: fullBreakdownJson,
        calculatedAt: new Date(),
      },
    });

    console.log(`${MODULE} ${employee.fullName}: probation split gross=${result.grossIncome.toLocaleString()}, net=${result.netSalary.toLocaleString()}`);
    return result;
  }

  const sourceOtBucketBreakdown = (otMonthly?.bucketBreakdown as Record<string, unknown>) ?? null;
  const manualOtHoursApplied = hasOtHourOverrides(manualOverrides);
  const adjustedOt = manualOtHoursApplied
    ? applyOtHourOverrides({
        bucketBreakdown: sourceOtBucketBreakdown,
        manualOverrides,
        hourlyRate,
      })
    : null;
  const otTotalHours = adjustedOt?.totalHours ?? (otMonthly ? d2n(otMonthly.totalHours) : 0);
  const derivedOtTotalAmount = adjustedOt?.totalAmount ?? (otMonthly ? d2n(otMonthly.totalAmount) : 0);
  const otTotalAmount = overrideNumber(manualOverrides.otTotalAmount, derivedOtTotalAmount);
  const otBucketBreakdown = adjustedOt?.bucketBreakdown ?? sourceOtBucketBreakdown;

  // 3. Calculate gross income
  const gross = calculateGrossIncome({
    baseSalary: payrollSalary,
    actualDays,
    standardDays,
    allowances: allowancesExcludingRank(allowances),
    otTotalAmount,
    lateHours,
    earlyHours,
    hourlyRate,
  });

  // 4. Calculate insurance
  const insurance = calculateInsurance(insuranceSalaryBasis(baseSalary, allowances), employee.employmentType, insuranceCaps);

  // 5. Calculate PIT
  const taxExemptions = calculatePayrollTaxExemptions({
    allowances,
    otTotalAmount,
    workRatio: gross.workRatio,
  });

  const pit = calculatePit({
    grossIncome: gross.grossIncome,
    insuranceEmployee: insurance.employee.total,
    taxExemptIncome: taxExemptions.total,
    personalDeduction,
    dependentDeduction,
    employmentType: employee.employmentType,
  });

  // 6. Calculate net salary
  const unionFee = 0; // TODO: implement union fee logic
  const afterTaxAdjustment = overrideNumber(manualOverrides.afterTaxAdjustment, 0);

  const netSalary = calculateNetSalary({
    grossIncome: gross.grossIncome,
    insuranceEmployee: insurance.employee.total,
    pitAmount: pit.pitAmount,
    afterTaxAdjustment,
    unionFee,
  });

  // 7. Build result
  const result: PayslipResult = {
    standardDays,
    actualDays,
    workRatio: gross.workRatio,
    baseSalary,
    actualSalary: gross.actualSalary,
    allowancesTotal: gross.proratedAllowances,
    otTotalHours,
    otTotalAmount,
    otBucketBreakdown,
    lateDeduction: gross.lateDeduction,
    grossIncome: gross.grossIncome,
    insuranceEmployee: insurance.employee.total,
    insuranceEmployer: insurance.employer.total,
    taxExempt: personalDeduction + dependentDeduction,
    taxableIncome: pit.taxableIncome,
    pitAmount: pit.pitAmount,
    afterTaxAdjustment,
    unionFee,
    netSalary,
  };
  const otBucketBreakdownJson =
    otBucketBreakdown === null
      ? Prisma.JsonNull
      : (otBucketBreakdown as unknown as Prisma.InputJsonValue);
  const normalFullBreakdownBase = { ...existingFullBreakdown };
  delete normalFullBreakdownBase.payrollSegments;
  delete normalFullBreakdownBase.payrollSegmentRule;
  delete normalFullBreakdownBase.payrollSegment;
  const fullBreakdownJson = {
    ...normalFullBreakdownBase,
    gross,
    insurance,
    pit,
    allowances,
    taxExemptions,
    manualOverrides,
    manualAppliedAt: new Date().toISOString(),
  } as unknown as Prisma.InputJsonValue;

  // 8. Upsert payslip
  await prisma.payslip.upsert({
    where: { employeeId_periodId: { employeeId, periodId } },
    create: {
      employeeId,
      periodId,
      ...result,
      otBucketBreakdown: otBucketBreakdownJson,
      status: 'DRAFT',
      fullBreakdown: fullBreakdownJson,
      calculatedAt: new Date(),
    },
    update: {
      ...result,
      otBucketBreakdown: otBucketBreakdownJson,
      fullBreakdown: fullBreakdownJson,
      calculatedAt: new Date(),
    },
  });

  console.log(`${MODULE} ${employee.fullName}: gross=${gross.grossIncome.toLocaleString()}, net=${netSalary.toLocaleString()}`);
  return result;
}

/**
 * Batch calculate payslips for all active employees in a period.
 */
export async function calculateAllPayslips(
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
        await prisma.payslip.deleteMany({ where: { employeeId: emp.id, periodId } });
        continue;
      }

      await calculatePayslip(emp.id, periodId, prisma);
      processed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${MODULE} Error for ${emp.fullName}: ${msg}`);
      errors++;
    }
  }

  console.log(`${MODULE} Batch complete: ${processed} payslips, ${errors} errors`);
  return { processed, errors };
}
