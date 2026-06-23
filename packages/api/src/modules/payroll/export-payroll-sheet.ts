/**
 * Export Payroll Sheet -> Lark Spreadsheet
 *
 * Uses the approved payroll template workbook as the source of formatting,
 * merges, dimensions, and header structure:
 * https://tsg3y8y89y0w.sg.larksuite.com/sheets/LwEashCNphYZVYtVyBSlhfnyg4d
 */

import { prisma } from '../../shared/db/prisma.js';
import { LarkBaseClient } from '../../shared/lark/base.js';
import { TABLE_IDS, getLarkConfig } from '../../shared/lark/config.js';
import { createSheetsClient, LarkSheetsClient, type CellValue } from '../../shared/lark/sheets.js';
import type { LarkRecord } from '../../shared/lark/types.js';
import { belongsToPeriodByJoinDate } from '../../shared/utils/employment-period.js';
import { updateAllLeaveBalances } from '../leave/balance.js';

const MODULE = '[ExportPayrollSheet]';

const PAYROLL_TEMPLATE_SPREADSHEET_TOKEN = 'LwEashCNphYZVYtVyBSlhfnyg4d';
const PAYROLL_FOLDER_TOKEN = 'HvTmf16Z2liDFAdKTyElfRRWgKc';
const PAYROLL_TAB_NAME_PREFIX = 'Payroll';
const DATA_START_ROW = 13;
const TEMPLATE_ROW_COUNT = 200;
const COL_COUNT = 76; // A-BX

const EMPLOYEE_ORDER = [
  'ASV001', 'ASV013',
  'ASV002', 'ASV003', 'ASV010', 'ASV011', 'ASV014', 'ASV022', 'ASV024',
  'ASV005', 'ASV008', 'ASV016', 'ASV017', 'ASV018', 'ASV023',
] as const;

type EmpCode = string;

const GROUPS: Array<{ key: string; totalLabel: string }> = [
  { key: 'expats', totalLabel: '駐在員Total' },
  { key: 'indirect', totalLabel: '間接部門Total' },
  { key: 'equipment', totalLabel: '機材センターTotal' },
  { key: 'other', totalLabel: 'その他Total' },
];

const NAME_OVERRIDES: Record<EmpCode, string> = {
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

function toNum(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'object' && typeof (value as Record<string, unknown>).toNumber === 'function') {
    return ((value as Record<string, unknown>).toNumber as () => number)();
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function round(n: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function roundUp10(n: number): number {
  return Math.ceil(n / 10) * 10;
}

function normalizeStaffCode(...values: unknown[]): EmpCode | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const match = value.trim().match(/^ASV0*(\d+)$/i);
    if (!match) continue;
    return `ASV${match[1].padStart(3, '0')}`;
  }
  return null;
}

function resolvePayrollGroup(code: EmpCode | null, department: unknown): string | null {
  if (code === 'ASV001' || code === 'ASV013') return 'expats';
  if (code && ['ASV002', 'ASV003', 'ASV010', 'ASV011', 'ASV014', 'ASV022', 'ASV024'].includes(code)) return 'indirect';
  if (code && ['ASV005', 'ASV008', 'ASV016', 'ASV017', 'ASV018', 'ASV023'].includes(code)) return 'equipment';
  if (typeof department !== 'string') return code ? 'other' : null;

  const dept = department.trim().toLowerCase();
  if (!dept) return code ? 'other' : null;
  if (dept === 'bod' || dept.includes('ban giám đốc')) return 'expats';
  if (dept.includes('ttvt') || dept.includes('機材') || dept.includes('kho') || dept.includes('thiết bị')) return 'equipment';
  if (dept.includes('bpql') || dept.includes('pkd') || dept.includes('管理') || dept.includes('営業')) return 'indirect';
  return code ? 'other' : null;
}

function payrollSortIndex(code: EmpCode | null, fullName: string): number {
  if (code) {
    const fixedIndex = (EMPLOYEE_ORDER as readonly string[]).indexOf(code);
    if (fixedIndex >= 0) return fixedIndex;
    const numeric = code.match(/\d+/);
    if (numeric) return EMPLOYEE_ORDER.length + Number(numeric[0]) / 1000;
  }
  return EMPLOYEE_ORDER.length + 100 + ((fullName.trim().toLowerCase().charCodeAt(0) || 999) / 1000);
}

function larkUrlToToken(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/sheets\/([A-Za-z0-9]+)/);
  return match?.[1] ?? null;
}

function richTextToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => richTextToString(item)).join('');
  if (value && typeof value === 'object') {
    const raw = value as Record<string, unknown>;
    if (typeof raw.text === 'string') return raw.text;
    if (typeof raw.name === 'string') return raw.name;
  }
  return value == null ? '' : String(value);
}

function linkFieldUrl(value: unknown): string | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const link = (value as Record<string, unknown>).link;
    return typeof link === 'string' ? link : null;
  }
  return null;
}

function formatDate(value: Date | null | undefined): string {
  if (!value) return '';
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${day}/${month}/${year}`;
}

function sheetDateSerial(value: Date): number {
  return Math.floor(value.getTime() / 86_400_000) + 25_569;
}

function classifyEmploymentType(value: string | null | undefined): string {
  if (value === 'PT') return 'P';
  if (value === 'INTERN') return 'M';
  return 'O';
}

function getAllowance(fullBreakdown: unknown, key: string): number {
  if (!fullBreakdown || typeof fullBreakdown !== 'object') return 0;
  const allowances = (fullBreakdown as Record<string, unknown>).allowances;
  if (!allowances || typeof allowances !== 'object') return 0;
  return toNum((allowances as Record<string, unknown>)[key]);
}

function readPayrollSegments(fullBreakdown: unknown): Record<string, unknown>[] {
  if (!fullBreakdown || typeof fullBreakdown !== 'object') return [];
  const segments = (fullBreakdown as Record<string, unknown>).payrollSegments;
  return Array.isArray(segments)
    ? segments.filter((segment): segment is Record<string, unknown> => !!segment && typeof segment === 'object' && !Array.isArray(segment))
    : [];
}

function segmentFullBreakdown(segment: Record<string, unknown>, fallback: unknown): unknown {
  const fullBreakdown = segment.fullBreakdown;
  return fullBreakdown && typeof fullBreakdown === 'object' ? fullBreakdown : fallback;
}

function segmentValue(segment: Record<string, unknown> | null, key: string, fallback: unknown): number {
  return segment && key in segment ? toNum(segment[key]) : toNum(fallback);
}

function getInsurance(fullBreakdown: unknown, side: 'employee' | 'employer', key: 'bhxh' | 'bhyt' | 'bhtn'): number {
  if (!fullBreakdown || typeof fullBreakdown !== 'object') return 0;
  const insurance = (fullBreakdown as Record<string, unknown>).insurance;
  if (!insurance || typeof insurance !== 'object') return 0;
  const part = (insurance as Record<string, unknown>)[side];
  if (!part || typeof part !== 'object') return 0;
  return toNum((part as Record<string, unknown>)[key]);
}

function getInsuranceBasis(fullBreakdown: unknown, key: 'basisBhxhBhyt' | 'basisBhtn' | 'insuranceBasis' = 'insuranceBasis'): number {
  if (!fullBreakdown || typeof fullBreakdown !== 'object') return 0;
  const insurance = (fullBreakdown as Record<string, unknown>).insurance;
  if (!insurance || typeof insurance !== 'object') return 0;
  const raw = insurance as Record<string, unknown>;
  return toNum(raw[key] ?? raw.insuranceBasis);
}

function bucketPart(
  breakdown: unknown,
  matcher: (bucket: string) => boolean,
  options: { payableOnly?: boolean } = {},
): { hours: number; amount: number } {
  if (!breakdown || typeof breakdown !== 'object') return { hours: 0, amount: 0 };
  return Object.entries(breakdown as Record<string, unknown>).reduce((acc, [bucket, detail]) => {
    if (!matcher(bucket) || !detail || typeof detail !== 'object') return acc;
    const raw = detail as Record<string, unknown>;
    if (options.payableOnly && toNum(raw.amount) <= 0) return acc;
    return {
      hours: acc.hours + toNum(raw.hours),
      amount: acc.amount + toNum(raw.amount),
    };
  }, { hours: 0, amount: 0 });
}

function buildSubtotalRow(label: string, rows: CellValue[][]): CellValue[] {
  const total = new Array<CellValue>(COL_COUNT).fill('');
  total[0] = label;

  for (let col = 6; col < COL_COUNT; col++) {
    const sum = rows.reduce((acc, row) => acc + (typeof row[col] === 'number' ? row[col] as number : 0), 0);
    if (sum !== 0) total[col] = round(sum, 2);
  }

  return total;
}

async function findPayrollSheetFromManager(monthKey: string): Promise<{ url: string; token: string } | null> {
  const base = new LarkBaseClient(getLarkConfig());
  const records = await base.listAllRecords(TABLE_IDS.SHEET_MANAGER);
  const normalizedMonthKey = monthKey.replace(/[^0-9]/g, '');
  const monthText = `${normalizedMonthKey.slice(4, 6)}/${normalizedMonthKey.slice(0, 4)}`;
  const monthLabel = `Tháng ${monthText}`;

  const match = records.find((record: LarkRecord) => {
    const fields = record.fields;
    const type = richTextToString(fields['Loại Sheet']);
    const month = richTextToString(fields['Tháng']);
    const payrollMonth = richTextToString(fields['Tháng lương']);
    return type === 'Bảng lương' && (month === monthText || payrollMonth === monthLabel);
  });

  const url = linkFieldUrl(match?.fields['Link Bảng lương']);
  const token = larkUrlToToken(url);
  return url && token ? { url, token } : null;
}

type PayrollPeriodInfo = {
  id: string;
  label: string;
  monthKey: string;
  periodStart: Date;
  periodEnd: Date;
};

type PayrollExportRow = {
  code: EmpCode;
  groupKey: string;
  sortIndex: number;
  row: CellValue[];
  otHours: number;
  otAmount: number;
};

async function buildPayrollRows(periodId: string): Promise<{
  period: PayrollPeriodInfo;
  rows: PayrollExportRow[];
}> {
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new Error(`Kỳ lương không tồn tại: ${periodId}`);
  await updateAllLeaveBalances(period.monthKey, prisma);

  const payslips = (await prisma.payslip.findMany({
    where: { periodId },
    include: { employee: true },
  })).filter((payslip) => belongsToPeriodByJoinDate(period.periodEnd, payslip.employee.joinDate));
  const employeeIds = payslips.map((p) => p.employeeId);

  const [attendances, taxPolicies, leaveBalances] = await Promise.all([
    prisma.monthlyAttendance.findMany({ where: { periodId, employeeId: { in: employeeIds } } }),
    prisma.taxPolicy.findMany({ where: { employeeId: { in: employeeIds }, isCurrent: true }, orderBy: { createdAt: 'desc' } }),
    prisma.leaveBalance.findMany({ where: { employeeId: { in: employeeIds }, monthKey: period.monthKey } }),
  ]);

  const attMap = new Map(attendances.map((item) => [item.employeeId, item]));
  const leaveMap = new Map(leaveBalances.map((item) => [item.employeeId, item]));
  const taxMap = new Map<string, (typeof taxPolicies)[number]>();
  for (const policy of taxPolicies) {
    if (!taxMap.has(policy.employeeId)) taxMap.set(policy.employeeId, policy);
  }

  const rows = payslips.flatMap<PayrollExportRow>((payslip) => {
    const metadata = payslip.employee.larkMetadata as Record<string, unknown> | null;
    const code = normalizeStaffCode(payslip.employee.employeeCode, metadata?.employeeNo, payslip.employee.userId);
    const groupKey = resolvePayrollGroup(code, payslip.employee.department);
    if (!groupKey) return [];
    const rowKey = code ?? payslip.employee.id;
    const displayCode = code ?? '';
    const displayName = (code ? NAME_OVERRIDES[code] : undefined) ?? payslip.employee.fullName;
    const baseSortIndex = payrollSortIndex(code, payslip.employee.fullName);

    const variants = readPayrollSegments(payslip.fullBreakdown);
    const rowVariants = variants.length > 0 ? variants : [null];
    return rowVariants.map<PayrollExportRow>((segment, segmentIndex) => {
    const fullBreakdown = segment ? segmentFullBreakdown(segment, payslip.fullBreakdown) : payslip.fullBreakdown;
    const attendance = attMap.get(payslip.employeeId);
    const leave = leaveMap.get(payslip.employeeId);
    const taxPolicy = taxMap.get(payslip.employeeId);
    const standardDays = segmentValue(segment, 'standardDays', payslip.standardDays);
    const actualDays = segmentValue(segment, 'actualDays', payslip.actualDays);
    const baseSalary = segmentValue(segment, 'baseSalary', payslip.baseSalary);
    const rank = getAllowance(fullBreakdown, 'rank');
    const bpql = 0;
    const sales = 0;
    const technical = getAllowance(fullBreakdown, 'technical');
    const language = getAllowance(fullBreakdown, 'language');
    const housing = getAllowance(fullBreakdown, 'housing');
    const transport = getAllowance(fullBreakdown, 'transport');
    const meal = getAllowance(fullBreakdown, 'meal');
    const phone = getAllowance(fullBreakdown, 'phone');
    const attendanceAllowance = getAllowance(fullBreakdown, 'attendance');
    const payrollSalary = baseSalary + rank;
    const daySalary = standardDays > 0 ? round(payrollSalary / standardDays, 0) : 0;
    const hourSalary = roundUp10(daySalary / 8);
    const position = code === 'ASV001' || code === 'ASV013' ? 'G.D' : payslip.employee.position ?? '';
    const classify = typeof segment?.staffClassify === 'string'
      ? segment.staffClassify
      : classifyEmploymentType(payslip.employee.employmentType);
    const dependents = taxPolicy?.dependents ?? 0;
    const annualLeaveDays = toNum(attendance?.annualLeaveHours) / 8;
    const absentDays = toNum(attendance?.absentDays);
    const earlyLateHours = toNum(attendance?.lateHours) + toNum(attendance?.earlyHours);
    const monthlyIncome = baseSalary + rank + bpql + sales + technical + language + housing + transport + meal + phone + attendanceAllowance;
    const totalIncome = segmentValue(segment, 'grossIncome', payslip.grossIncome);
    const insuranceBasis = getInsuranceBasis(fullBreakdown, 'basisBhxhBhyt');
    const insuranceBhtnBasis = getInsuranceBasis(fullBreakdown, 'basisBhtn');
    const empBhxh = getInsurance(fullBreakdown, 'employee', 'bhxh');
    const empBhyt = getInsurance(fullBreakdown, 'employee', 'bhyt');
    const empBhtn = getInsurance(fullBreakdown, 'employee', 'bhtn');
    const erBhxh = getInsurance(fullBreakdown, 'employer', 'bhxh');
    const erBhyt = getInsurance(fullBreakdown, 'employer', 'bhyt');
    const erBhtn = getInsurance(fullBreakdown, 'employer', 'bhtn');
    const payableOnly = { payableOnly: true };
    const rowOtBreakdown = segment && 'otBucketBreakdown' in segment ? segment.otBucketBreakdown : payslip.otBucketBreakdown;
    const weekdayOt = bucketPart(rowOtBreakdown, (bucket) => bucket.includes('Ngày thường 時間外 17h~22h') || bucket.includes('翌日の6h~22h'), payableOnly);
    const weekendOt = bucketPart(rowOtBreakdown, (bucket) => bucket.includes('Ngày nghỉ T7 休日出勤(土) 6h~22h') || bucket.includes('Ngày nghỉ 休日出勤 6h~22h'), payableOnly);
    const holidayOt = bucketPart(rowOtBreakdown, (bucket) => bucket.includes('OT ngày lễ 祝日出勤') && !bucket.includes('ca đêm'), payableOnly);
    const untilNightOt = bucketPart(rowOtBreakdown, (bucket) => bucket.includes('Ngày thường 時間外') && bucket.includes('22h~6h'), payableOnly);
    const normalNightOt = bucketPart(rowOtBreakdown, (bucket) => bucket.includes('平日の夜勤') || bucket.includes('Ca đêm 22h~6h'), payableOnly);
    const weekendNightOt = bucketPart(rowOtBreakdown, (bucket) => bucket.includes('Ngày nghỉ T7 ca đêm') || bucket.includes('Ngày nghỉ ca đêm') || bucket.includes('OT ngày lễ ca đêm'), payableOnly);
    const otAmountByBucket = weekdayOt.amount + weekendOt.amount + holidayOt.amount + untilNightOt.amount + normalNightOt.amount + weekendNightOt.amount;
    const otAmount = segmentValue(segment, 'otTotalAmount', payslip.otTotalAmount);
    const otAdjustment = otAmount - otAmountByBucket;
    const otTaxExempt = otAmount;
    const mealTaxExempt = standardDays > 0 ? round(Math.min(meal, 930_000) / standardDays * actualDays, 0) : 0;
    const phoneTaxExempt = standardDays > 0 ? round(phone / standardDays * actualDays, 0) : 0;
    const totalTaxExempt = otTaxExempt + mealTaxExempt + phoneTaxExempt;
    const row = new Array<CellValue>(COL_COUNT).fill('');

    row[1] = displayCode;
    const segmentLabel = typeof segment?.label === 'string' ? ` (${segment.label})` : '';
    row[2] = `${displayName}${segmentLabel}`;
    row[3] = position;
    row[4] = classify;
    row[5] = formatDate(payslip.employee.joinDate);
    row[6] = baseSalary;
    row[8] = baseSalary;
    row[9] = rank;
    row[10] = bpql;
    row[11] = sales;
    row[12] = technical;
    row[13] = language;
    row[14] = housing;
    row[15] = transport;
    row[16] = meal;
    row[17] = phone;
    row[18] = attendanceAllowance;
    row[19] = monthlyIncome;
    row[20] = payrollSalary;
    row[21] = daySalary;
    row[22] = hourSalary;
    row[23] = roundUp10(hourSalary * 1.5);
    row[24] = roundUp10(hourSalary * 2);
    row[25] = roundUp10(hourSalary * 3);
    row[26] = roundUp10(hourSalary * 1.8);
    row[27] = roundUp10(hourSalary * 0.3);
    row[28] = roundUp10(hourSalary * 2.7);
    row[29] = dependents;
    row[30] = standardDays;
    row[31] = actualDays;
    row[32] = annualLeaveDays;
    row[33] = toNum(leave?.opening);
    row[34] = toNum(leave?.closing);
    row[35] = absentDays;
    row[36] = round(earlyLateHours, 2);
    row[37] = round(weekdayOt.hours, 2);
    row[38] = round(weekendOt.hours, 2);
    row[39] = round(holidayOt.hours, 2);
    row[40] = round(untilNightOt.hours, 2);
    row[41] = round(normalNightOt.hours, 2);
    row[42] = round(weekendNightOt.hours, 2);
    row[43] = absentDays > 0 ? -round(daySalary * absentDays, 0) : 0;
    row[44] = segmentValue(segment, 'lateDeduction', payslip.lateDeduction) > 0 ? -segmentValue(segment, 'lateDeduction', payslip.lateDeduction) : 0;
    row[45] = attendanceAllowance;
    row[46] = weekdayOt.amount + otAdjustment;
    row[47] = weekendOt.amount;
    row[48] = holidayOt.amount;
    row[49] = untilNightOt.amount;
    row[50] = normalNightOt.amount;
    row[51] = weekendNightOt.amount;
    row[52] = segmentValue(segment, 'allowancesTotal', payslip.allowancesTotal);
    row[53] = 0;
    row[54] = 0;
    row[55] = totalIncome;
    row[56] = otTaxExempt;
    row[57] = mealTaxExempt;
    row[58] = phoneTaxExempt;
    row[59] = totalTaxExempt;
    row[60] = insuranceBasis;
    row[61] = insuranceBhtnBasis;
    row[62] = empBhxh;
    row[63] = empBhyt;
    row[64] = empBhtn;
    row[65] = segmentValue(segment, 'insuranceEmployee', payslip.insuranceEmployee);
    row[66] = segmentValue(segment, 'taxExempt', payslip.taxExempt);
    row[67] = segmentValue(segment, 'taxableIncome', payslip.taxableIncome);
    row[68] = segmentValue(segment, 'pitAmount', payslip.pitAmount);
    row[69] = segmentValue(segment, 'afterTaxAdjustment', payslip.afterTaxAdjustment);
    row[70] = segmentValue(segment, 'netSalary', payslip.netSalary);
    row[71] = erBhxh;
    row[72] = erBhyt;
    row[73] = erBhtn;
    row[74] = segmentValue(segment, 'insuranceEmployer', payslip.insuranceEmployer);
    row[75] = segmentValue(segment, 'insuranceEmployee', payslip.insuranceEmployee) + segmentValue(segment, 'insuranceEmployer', payslip.insuranceEmployer);

    return {
      code: rowKey,
      groupKey,
      sortIndex: baseSortIndex + segmentIndex / 10,
      row,
      otHours: weekdayOt.hours + weekendOt.hours + holidayOt.hours + untilNightOt.hours + normalNightOt.hours + weekendNightOt.hours,
      otAmount,
    };
    });
  }).sort((a, b) => a.sortIndex - b.sortIndex || String(a.row[2] ?? '').localeCompare(String(b.row[2] ?? ''), 'vi'));

  rows.forEach((item, index) => {
    item.row[0] = index + 1;
  });

  return { period, rows };
}

function buildDataMatrix(rows: PayrollExportRow[]): CellValue[][] {
  const matrix: CellValue[][] = [];

  for (const group of GROUPS) {
    const groupRows = rows.filter((row) => row.groupKey === group.key).map((row) => row.row);
    if (group.key === 'other' && groupRows.length === 0) continue;
    matrix.push(...groupRows);
    matrix.push(buildSubtotalRow(group.totalLabel, groupRows));
  }

  const grandTotal = buildSubtotalRow(`TỔNG (${rows.length})`, rows.map((row) => row.row));
  matrix.push(grandTotal);

  while (matrix.length < TEMPLATE_ROW_COUNT - DATA_START_ROW + 1) {
    matrix.push(new Array<CellValue>(COL_COUNT).fill(''));
  }

  return matrix;
}

async function resolvePayrollSpreadsheet(period: PayrollPeriodInfo): Promise<{
  spreadsheetToken: string;
  url: string;
  isNew: boolean;
}> {
  const sheets = createSheetsClient();
  const fromManager = await findPayrollSheetFromManager(period.monthKey);

  if (fromManager) {
    return { spreadsheetToken: fromManager.token, url: fromManager.url, isNew: false };
  }

  const existing = await prisma.payrollPeriod.findUnique({
    where: { id: period.id },
    select: { larkSheetToken: true, larkSheetUrl: true },
  });

  if (existing?.larkSheetToken) {
    try {
      const meta = await sheets.getMetainfo(existing.larkSheetToken);
      const payrollTab = meta.sheets.find((sheet) => sheet.title.startsWith(PAYROLL_TAB_NAME_PREFIX));
      if (payrollTab) {
        return {
          spreadsheetToken: existing.larkSheetToken,
          url: existing.larkSheetUrl ?? `https://tsg3y8y89y0w.sg.larksuite.com/sheets/${existing.larkSheetToken}`,
          isNew: false,
        };
      }
    } catch {
      // Fall through to copy from template.
    }
  }

  const title = `Bảng lương ${period.label} - Asnova`;
  const created = await sheets.copySpreadsheet(PAYROLL_TEMPLATE_SPREADSHEET_TOKEN, title, PAYROLL_FOLDER_TOKEN);
  return { spreadsheetToken: created.spreadsheetToken, url: created.url, isNew: true };
}

export async function exportPayrollSheetToLark(periodId: string): Promise<{
  url: string;
  spreadsheetToken: string;
  isNew: boolean;
  rows: number;
  otHours: number;
  otAmount: number;
}> {
  console.log(`${MODULE} Bắt đầu export bảng lương kỳ ${periodId}`);

  const { period, rows } = await buildPayrollRows(periodId);
  const sheets = createSheetsClient();
  const target = await resolvePayrollSpreadsheet(period);
  const meta = await sheets.getMetainfo(target.spreadsheetToken);
  const payrollTab = meta.sheets.find((sheet) => sheet.title.startsWith(PAYROLL_TAB_NAME_PREFIX)) ?? meta.sheets[0];
  if (!payrollTab) throw new Error('Không tìm thấy tab Payroll trong spreadsheet');

  const normalizedMonthKey = period.monthKey.replace(/[^0-9]/g, '');
  const month = Number(normalizedMonthKey.slice(4, 6));
  const year = normalizedMonthKey.slice(0, 4);
  await sheets.writeValues(target.spreadsheetToken, `${payrollTab.sheetId}!I4:J4`, [[month, `/ ${year}`]]);
  await sheets.writeValues(target.spreadsheetToken, `${payrollTab.sheetId}!J5:N5`, [[sheetDateSerial(period.periodStart), 'to', '', '', sheetDateSerial(period.periodEnd)]]);
  await sheets.writeValues(target.spreadsheetToken, `${payrollTab.sheetId}!I6:I6`, [[sheetDateSerial(period.periodEnd)]]);

  const data = buildDataMatrix(rows);
  const range = LarkSheetsClient.range(payrollTab.sheetId, DATA_START_ROW, 0, TEMPLATE_ROW_COUNT, COL_COUNT - 1);
  await sheets.writeValues(target.spreadsheetToken, range, data);

  await prisma.payrollPeriod.update({
    where: { id: period.id },
    data: { larkSheetUrl: target.url, larkSheetToken: target.spreadsheetToken },
  });

  const otHours = round(rows.reduce((sum, row) => sum + row.otHours, 0), 2);
  const otAmount = round(rows.reduce((sum, row) => sum + row.otAmount, 0), 0);
  console.log(`${MODULE} Hoàn thành ${rows.length} nhân sự, OT ${otHours}h / ${otAmount}`);

  return {
    url: target.url,
    spreadsheetToken: target.spreadsheetToken,
    isNew: target.isNew,
    rows: rows.length,
    otHours,
    otAmount,
  };
}
