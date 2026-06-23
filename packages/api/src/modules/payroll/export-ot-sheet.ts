/**
 * Export OT Sheet → Lark Spreadsheet
 *
 * Tạo sheet OT theo đúng template:
 *   https://tsg3y8y89y0w.sg.larksuite.com/sheets/ZwW3sBQY7hZUrotGyHXlNK1Fgng?sheet=3xDAoJ
 *
 * Columns (A–AG = 33 cols):
 *  A  Request No.
 *  B  Status
 *  C  Submitted at
 *  D  Completed at
 *  E  Requester
 *  F  Initiator department
 *  G  Loại ngày OT
 *  H  Nghỉ lễ
 *  I  Thứ
 *  J  Ngày OT
 *  K  Ngày bắt đầu
 *  L  Ngày kết thúc
 *  M  Start time
 *  N  End time
 *  O  Bắt đầu giải lao1
 *  P  Kết thúc giải lao1
 *  Q  Khoảng giờ nghỉ giải lao
 *  R  Giờ OT thực tế
 *  S  Reason for overtime
 *  T  Giờ nghỉ bù quy đổi
 *  U  Trễ hạn gửi đơn
 *  V  Chính sách OT
 *  W  OT 150% - Ngày thường ca ngày / OT ca đêm 06:00-22:00
 *  X  OT 200% - Nghỉ/ngày thường đêm rời
 *  Y  OT 210% - Ngày thường kéo sang đêm
 *  Z  OT 130% / Ca đêm 30% - Ca đêm
 *  AA OT 270% - Ngày nghỉ ca đêm
 *  AB OT 300% - Ngày lễ ca ngày
 *  AC OT 390% - Ngày lễ ca đêm
 *  AD OT nghỉ bù / không tính lương
 *  AE Tiền OT
 *  AF Giờ hợp lệ tính lương
 *  AG Ghi chú đối chiếu
 */

import { prisma } from '../../shared/db/prisma.js';
import { createSheetsClient, LarkSheetsClient, type CellValue } from '../../shared/lark/sheets.js';
import { roundUp } from '../../shared/utils/round.js';
import { resolveEffectiveOtScheduleType } from '../../shared/utils/work-schedule.js';
import { applySubmissionPolicyOverride, parseOtApproval } from '../calc/ot-calculator.js';
import { getApprovalSubmissionPolicyConfig } from '../calc/submission-policy-settings.js';

const MODULE = '[ExportOtSheet]';

// ─── Config ─────────────────────────────────────────────────
const TIMESHEET_FOLDER_TOKEN = 'HvTmf16Z2liDFAdKTyElfRRWgKc';
const OT_TEMPLATE_SPREADSHEET_TOKEN = 'ZwW3sBQY7hZUrotGyHXlNK1Fgng';
const TEMPLATE_TAB_TITLES = [
  'Phép năm 有休',
  'Nghỉ Trừ lương 欠勤総合',
  'Phúc lợi 福利欠勤',
  'OT',
  'Change working & holidays hour1',
];
const SHEET_TAB_NAME = 'OT';
const CHANGE_TAB_NAME = 'Change working & holidays hour1';
const COL_COUNT = 33; // A–AG
const CHANGE_COL_COUNT = 37; // A–AK
const TEMPLATE_ROW_COUNT = 200;

// ─── Colors ─────────────────────────────────────────────────
const C = {
  titleBg:     '#1F4E79',
  titleFg:     '#FFFFFF',
  dateBg:      '#2E75B6',
  dateFg:      '#FFFFFF',
  headerBg:    '#BDD7EE',
  headerFg:    '#1F4E79',
  bucket150:   '#DAEEF3',  // Ngày thường day
  bucket200:   '#FFC7CE',  // Nghỉ/đêm rời (red-ish)
  bucket210:   '#E2EFDA',  // Ngày thường sang đêm
  bucket130:   '#FFEB9C',  // Ca đêm 30%
  bucket270:   '#F4B183',  // Ngày nghỉ ca đêm
  bucket300:   '#FF7F7F',  // Ngày lễ ca ngày
  bucket390:   '#C00000',  // Ngày lễ ca đêm
  bucketBu:    '#D9D9D9',  // Nghỉ bù
  otMoney:     '#E2EFDA',  // Tiền OT
  altRow:      '#EBF3FB',
  altRow2:     '#FFFFFF',
  border:      '#9DC3E6',
  totalBg:     '#1F4E79',
  totalFg:     '#FFFFFF',
};

// ─── Bucket column mapping ───────────────────────────────────
// Maps bucket name → column index (0-based, W=22 .. AD=29)
const BUCKET_COL_MAP: Record<string, number> = {
  // OT 150% workday day (col W = 22)
  'Ngày thường 時間外 17h~22h':                                        22,
  // OT 200% day off (CN) day (col X = 23)
  'Ngày nghỉ 休日出勤 6h~22h':                                         23,
  'Ngày nghỉ T7 休日出勤(土) 6h~22h':                                  23,
  // OT 210% workday night (col Y = 24)
  'Ngày thường 時間外(夜間まで残業) 22h~6h':                            24,
  // OT 130% / Ca đêm 30% (col Z = 25)
  '平日の夜勤 22h~6h ca đêm':                                          25,
  '平日夜勤の残業→翌日の6h~22h Số giờ làm thêm của ca đêm':            25,
  // OT 270% day off night (col AA = 26)
  'Ngày nghỉ ca đêm 休日の夜勤 22h~6h':                               26,
  'Ngày nghỉ T7 ca đêm 土曜夜勤 22h~6h':                              26,
  // OT 300% holiday day (col AB = 27)
  'OT ngày lễ 祝日出勤':                                              27,
  // OT 390% holiday night (col AC = 28)
  'OT ngày lễ ca đêm 祝日夜勤 22h~6h':                                28,
};

const COMP_LEAVE_POLICIES = ['Nghỉ bù', 'nghỉ bù', 'Nghỉ bù/không tính lương'];
const CHANGE_APPROVAL_TYPES = [
  'ChangeHours',
  'Hoán đổi thời gian làm việc/nghỉ ngơi',
  'Hoán đổi ngày nghỉ',
];

const employeeNameCollator = new Intl.Collator('vi', {
  sensitivity: 'base',
  numeric: true,
  ignorePunctuation: true,
});

// ─── Helpers ────────────────────────────────────────────────

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).toNumber === 'function') {
    return ((v as Record<string, unknown>).toNumber as () => number)();
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function isTransientDbError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    'Server has closed the connection',
    'Connection reset',
    'Operation timed out',
    'P1001',
    'P1002',
    'P1017',
  ].some((needle) => message.includes(needle));
}

async function withDbRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt === attempts) break;
      console.warn(`${MODULE} Retry DB query ${label} (${attempt}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    }
  }
  throw lastError;
}

function compareEmployeeName(
  a: { employee: { fullName: string | null; employeeCode: string | null; userId: string | null }; startTime?: Date | null; applyDate?: Date | null },
  b: { employee: { fullName: string | null; employeeCode: string | null; userId: string | null }; startTime?: Date | null; applyDate?: Date | null },
): number {
  const nameCompare = employeeNameCollator.compare(a.employee.fullName ?? '', b.employee.fullName ?? '');
  if (nameCompare !== 0) return nameCompare;

  const codeCompare = employeeNameCollator.compare(
    a.employee.employeeCode ?? a.employee.userId ?? '',
    b.employee.employeeCode ?? b.employee.userId ?? '',
  );
  if (codeCompare !== 0) return codeCompare;

  return (a.startTime ?? a.applyDate ?? new Date(0)).getTime()
    - (b.startTime ?? b.applyDate ?? new Date(0)).getTime();
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isCompLeavePolicy(policy: string): boolean {
  return COMP_LEAVE_POLICIES.some((p) => policy.toLowerCase().includes(p.toLowerCase()));
}

function isTemplateWorkbook(sheets: Array<{ title: string; columnCount: number }>): boolean {
  return TEMPLATE_TAB_TITLES.every((title) => sheets.some((sheet) => sheet.title === title))
    && (sheets.find((sheet) => sheet.title === SHEET_TAB_NAME)?.columnCount ?? 0) >= COL_COUNT;
}

/** Format UTC Date → VN datetime string "YYYY-MM-DD HH:MM:SS" */
function fmtVnDateTime(d: Date | null | undefined): string {
  if (!d) return '';
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  const Y = vn.getUTCFullYear();
  const M = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const D = String(vn.getUTCDate()).padStart(2, '0');
  const h = String(vn.getUTCHours()).padStart(2, '0');
  const m = String(vn.getUTCMinutes()).padStart(2, '0');
  const s = String(vn.getUTCSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

/** Format UTC Date → VN date string "YYYY/MM/DD" */
function fmtVnDate(d: Date | null | undefined): string {
  if (!d) return '';
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  const Y = vn.getUTCFullYear();
  const M = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const D = String(vn.getUTCDate()).padStart(2, '0');
  return `${Y}/${M}/${D}`;
}

/** Format UTC Date → VN date only "YYYY-MM-DD" */
function fmtVnDateDash(d: Date | null | undefined): string {
  if (!d) return '';
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  const Y = vn.getUTCFullYear();
  const M = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const D = String(vn.getUTCDate()).padStart(2, '0');
  return `${Y}-${M}-${D}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Get weekday name in VN timezone */
function vnWeekday(d: Date): string {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  return WEEKDAYS[vn.getUTCDay()];
}

/** Get reason from rawData form */
function extractReason(rawData: Record<string, unknown> | null): string {
  if (!rawData) return '';
  const form = rawData.form as Array<Record<string, unknown>> | undefined;
  if (!form) return '';
  // Find reason field in workGroup widget
  const wg = form.find((f) => (f.type as string) === 'workGroup' || (f.id as string)?.toLowerCase().includes('workgroup'));
  if (wg?.value) {
    const v = wg.value as Record<string, unknown>;
    if (typeof v.reason === 'string' && v.reason.trim()) return v.reason.trim();
  }
  // fallback: text widget labeled "Lý do"
  const lyDo = form.find((f) => (f.name as string)?.includes('Lý do') || (f.name as string)?.includes('reason'));
  if (lyDo?.value) return String(lyDo.value).trim();
  return '';
}

/** Get break times from rawData form */
function extractBreakTimes(rawData: Record<string, unknown> | null): { breakStart: Date | null; breakEnd: Date | null } {
  if (!rawData) return { breakStart: null, breakEnd: null };
  const form = rawData.form as Array<Record<string, unknown>> | undefined;
  if (!form) return { breakStart: null, breakEnd: null };

  const bdgl = form.find((f) => (f.name as string)?.includes('Bắt đầu giải lao'));
  const ktgl = form.find((f) => (f.name as string)?.includes('Kết thúc giải lao'));

  const parseDate = (v: unknown): Date | null => {
    if (!v || typeof v !== 'string') return null;
    try { const d = new Date(v); return isNaN(d.getTime()) ? null : d; } catch { return null; }
  };

  return {
    breakStart: parseDate(bdgl?.value),
    breakEnd: parseDate(ktgl?.value),
  };
}

/** Determine Loại ngày OT from buckets/dayType */
function extractLoaiNgayOT(parsed: { dayType: string; buckets: Array<{ dayType: string; frame: string }> } | null, rawData: Record<string, unknown> | null): string {
  if (!parsed) return '';

  const dayType = parsed.dayType;
  const hasNight = parsed.buckets.some((b) => b.frame === 'night');
  const hasDay = parsed.buckets.some((b) => b.frame === 'day');

  if (dayType === 'holiday') return 'Ngày lễ';
  if (dayType === 'day_off') {
    if (hasNight && hasDay) return 'Ngày nghỉ/ngày thường đêm rời';
    if (hasNight) return 'Ngày nghỉ';
    return 'Ngày nghỉ/ngày thường đêm rời';
  }
  if (dayType === 'workday') {
    if (hasNight) return 'Ngày nghỉ/ngày thường đêm rời';
    return 'Ngày thường';
  }
  return '';
}

/** Format period date range */
function fmtDateRange(start: Date, end: Date): string {
  const fmtD = (d: Date) => {
    const vn = new Date(d.getTime() + VN_OFFSET_MS);
    return `${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}/${vn.getUTCFullYear()}`;
  };
  return `Từ ngày 開始日: ${fmtD(start)}\u3000～\u3000 Đến ngày 終了日: ${fmtD(end)}`;
}

function fmtPeriodRange(start: Date, end: Date): string {
  const fmtD = (d: Date) => {
    const vn = new Date(d.getTime() + VN_OFFSET_MS);
    return `${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}/${vn.getUTCFullYear()}`;
  };
  return `${fmtD(start)}~${fmtD(end)}`;
}

function fmtMonthTitle(period: { monthKey: string; label: string }): string {
  const match = period.monthKey.match(/^(\d{4})(\d{2})$/);
  if (match) return `${match[2]}/${match[1]}`;
  const labelMatch = period.label.match(/(\d{2})\/(\d{4})/);
  return labelMatch ? `${labelMatch[1]}/${labelMatch[2]}` : period.label;
}

function parseRawDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function getFormWidgets(rawData: Record<string, unknown> | null): Array<Record<string, unknown>> {
  const form = rawData?.form;
  return Array.isArray(form) ? form as Array<Record<string, unknown>> : [];
}

function widgetName(widget: Record<string, unknown>): string {
  return String(widget.name ?? widget.title ?? widget.id ?? '').toLowerCase();
}

function stringifyWidgetValue(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(stringifyWidgetValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const raw = value as Record<string, unknown>;
    for (const key of ['text', 'name', 'value', 'label', 'reason']) {
      if (typeof raw[key] === 'string' && raw[key]) return raw[key] as string;
    }
    return '';
  }
  return String(value);
}

function findFormValue(rawData: Record<string, unknown> | null, patterns: string[]): string {
  const widgets = getFormWidgets(rawData);
  const lowerPatterns = patterns.map((p) => p.toLowerCase());
  const found = widgets.find((widget) => lowerPatterns.some((pattern) => widgetName(widget).includes(pattern)));
  return found ? stringifyWidgetValue(found.value).trim() : '';
}

function getDateIntervals(rawData: Record<string, unknown> | null): Array<{ start: Date; end: Date; hours: number }> {
  return getFormWidgets(rawData)
    .filter((widget) => widget.type === 'dateInterval' && widget.value)
    .map((widget) => {
      const value = widget.value as { start?: unknown; end?: unknown; interval?: unknown };
      const start = parseRawDate(value.start);
      const end = parseRawDate(value.end);
      return start && end && start < end
        ? { start, end, hours: toNum(value.interval) || round2((end.getTime() - start.getTime()) / 3_600_000) }
        : null;
    })
    .filter((interval): interval is { start: Date; end: Date; hours: number } => Boolean(interval))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function daysBetween(start: Date | null | undefined, end: Date | null | undefined): number {
  if (!start || !end) return 0;
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
}

// ─── Main Row Builder ────────────────────────────────────────

interface OtRow {
  cells: CellValue[];      // 33 cells (A–AG)
  isCompLeave: boolean;    // For row background color
  bucketCols: number[];    // Which OT bucket columns have values (for coloring)
}

type ExportApprovalRecord = {
  id: string;
  employeeId: string;
  instanceCode: string;
  serialNumber: string | null;
  approvalType: string;
  status: string;
  applyDate: Date | null;
  approvedHours: unknown;
  startTime: Date | null;
  endTime: Date | null;
  rawData: unknown;
  createdAt: Date;
  submissionPolicyOverride: boolean;
  employee: {
    id?: string;
    userId: string | null;
    fullName: string | null;
    employeeCode: string | null;
    department: string | null;
    scheduleType: string | null;
    larkMetadata?: unknown;
    salaryPolicies: Array<{ hourlyRate: unknown }>;
  };
};

type ExportDailyRecord = {
  employeeId: string;
  attendanceDate: Date;
  checkIn: Date | null;
  checkOut: Date | null;
};

type RawApprovalRow = {
  id: string;
  employeeId: string;
  instanceCode: string;
  serialNumber: string | null;
  approvalType: string;
  status: string;
  applyDate: Date | null;
  approvedHours: unknown;
  startTime: Date | null;
  endTime: Date | null;
  rawData: unknown;
  createdAt: Date;
  userId: string | null;
  fullName: string | null;
  employeeCode: string | null;
  department: string | null;
  scheduleType: string | null;
  larkMetadata?: unknown;
  hourlyRate: unknown;
  submissionPolicyOverride: boolean;
};

function mapRawApproval(row: RawApprovalRow): ExportApprovalRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    instanceCode: row.instanceCode,
    serialNumber: row.serialNumber,
    approvalType: row.approvalType,
    status: row.status,
    applyDate: row.applyDate,
    approvedHours: row.approvedHours,
    startTime: row.startTime,
    endTime: row.endTime,
    rawData: row.rawData,
    createdAt: row.createdAt,
    submissionPolicyOverride: row.submissionPolicyOverride,
    employee: {
      userId: row.userId,
      fullName: row.fullName,
      employeeCode: row.employeeCode,
      department: row.department,
      scheduleType: row.scheduleType,
      larkMetadata: row.larkMetadata,
      salaryPolicies: [{ hourlyRate: row.hourlyRate }],
    },
  };
}

async function fetchApprovalRows(
  period: { monthKey: string; periodStart: Date; periodEnd: Date },
  approvalTypes: string[],
  includeEndTime: boolean,
): Promise<ExportApprovalRecord[]> {
  const endFilter = includeEndTime ? 'OR (ar.end_time >= $3 AND ar.end_time <= $4)' : '';
  const periodEnd = endOfUtcDay(period.periodEnd);
  const rows = await withDbRetry(`approvalRecord.raw(${approvalTypes.join(',')})`, () =>
    prisma.$queryRawUnsafe<RawApprovalRow[]>(`
      SELECT
        ar.id,
        ar.employee_id AS "employeeId",
        ar.instance_code AS "instanceCode",
        ar.serial_number AS "serialNumber",
        ar.approval_type AS "approvalType",
        ar.status::text AS "status",
        ar.apply_date AS "applyDate",
        ar.approved_hours AS "approvedHours",
        ar.start_time AS "startTime",
        ar.end_time AS "endTime",
        ar.raw_data AS "rawData",
        ar.created_at AS "createdAt",
        ar.submission_policy_override AS "submissionPolicyOverride",
        e.user_id AS "userId",
        e.full_name AS "fullName",
        e.employee_code AS "employeeCode",
        e.department AS "department",
        e.schedule_type::text AS "scheduleType",
        e.lark_metadata AS "larkMetadata",
        sp.hourly_rate AS "hourlyRate"
      FROM approval_records ar
      JOIN employees e ON e.id = ar.employee_id
      LEFT JOIN LATERAL (
        SELECT hourly_rate
        FROM salary_policies sp
        WHERE sp.employee_id = e.id
          AND (sp.period_key = $1 OR sp.is_current = true)
        ORDER BY sp.created_at DESC
        LIMIT 1
      ) sp ON true
      WHERE ar.status = 'APPROVED'::"ApprovalStatus"
        AND ar.approval_type = ANY($2::text[])
        AND (
          (ar.start_time >= $3 AND ar.start_time <= $4)
          ${endFilter}
          OR (ar.apply_date >= $3::date AND ar.apply_date <= $4::date)
        )
    `, period.monthKey, approvalTypes, period.periodStart, periodEnd),
  );
  return rows.map(mapRawApproval);
}

async function buildOtRows(periodId: string): Promise<{
  period: { label: string; periodStart: Date; periodEnd: Date };
  rows: OtRow[];
  totals: CellValue[];
}> {
  const period = await withDbRetry('payrollPeriod.findUnique(buildOtRows)', () =>
    prisma.payrollPeriod.findUnique({ where: { id: periodId } }),
  );
  if (!period) throw new Error(`Kỳ lương không tồn tại: ${periodId}`);

  const otApprovals = await fetchApprovalRows(period, ['OT', 'Làm thêm giờ', 'NightShift', 'Ca đêm'], false);
  otApprovals.sort(compareEmployeeName);

  const queryStart = addUtcDays(period.periodStart, -1);
  const queryEnd = addUtcDays(endOfUtcDay(period.periodEnd), -1);
  const dailyRecords = await withDbRetry('dailyAttendance.raw(OT)', () =>
    prisma.$queryRawUnsafe<ExportDailyRecord[]>(`
      SELECT
        employee_id AS "employeeId",
        attendance_date AS "attendanceDate",
        check_in AS "checkIn",
        check_out AS "checkOut"
      FROM daily_attendances
      WHERE attendance_date >= $1::date
        AND attendance_date <= $2::date
    `, queryStart, queryEnd),
  );
  const dailyByEmployeeDate = new Map<string, ExportDailyRecord>();
  for (const record of dailyRecords) {
    const actualDate = addUtcDays(record.attendanceDate, 1);
    dailyByEmployeeDate.set(`${record.employeeId}:${dateKey(actualDate)}`, record);
  }

  const rows: OtRow[] = [];
  const submissionPolicyConfig = await getApprovalSubmissionPolicyConfig(prisma);

  // OT bucket totals (W=22 to AD=29, index 22–29)
  const bucketTotals = new Array(COL_COUNT).fill(0);
  let totalActualHours = 0;
  let totalValidHours = 0;

  for (const rec of otApprovals) {
    const emp = rec.employee;
    const rawData = rec.rawData as Record<string, unknown> | null;
    const schedType = resolveEffectiveOtScheduleType(emp);
    const normType = ['NightShift', 'Ca đêm'].includes(rec.approvalType) ? 'NightShift' : 'OT';

    const firstPass = rawData ? applySubmissionPolicyOverride(
      parseOtApproval(rawData, null, null, schedType, normType, submissionPolicyConfig),
      rec.submissionPolicyOverride,
    ) : null;
    const approvedStart = firstPass?.approvedStart ?? rec.startTime ?? rec.applyDate;
    const daily = approvedStart ? dailyByEmployeeDate.get(`${rec.employeeId}:${dateKey(approvedStart)}`) : undefined;
    const parsed = rawData
      ? applySubmissionPolicyOverride(
          parseOtApproval(rawData, daily?.checkIn ?? null, daily?.checkOut ?? null, schedType, normType, submissionPolicyConfig),
          rec.submissionPolicyOverride,
        )
      : null;
    const displayStart = parsed?.approvedStart ?? approvedStart ?? null;
    const displayEnd = parsed?.approvedEnd ?? rec.endTime ?? displayStart;

    // Build cells array (33 cells)
    const cells: CellValue[] = new Array(COL_COUNT).fill('');

    // A: Request No.
    cells[0] = rec.serialNumber || rec.instanceCode || '';
    // B: Status
    cells[1] = rec.status || 'APPROVED';
    // C: Submitted at — from rawData.timeline or createdAt
    cells[2] = '';
    // D: Completed at
    cells[3] = '';
    // E: Requester
    cells[4] = emp.fullName || '';
    // F: Initiator department (employeeCode / userId)
    const empCode = emp.employeeCode || emp.userId || '';
    cells[5] = empCode;
    // G: Loại ngày OT
    cells[6] = extractLoaiNgayOT(parsed, rawData);
    // H: Nghỉ lễ (1 if holiday)
    cells[7] = parsed?.dayType === 'holiday' ? '1' : '';
    // I: Thứ (weekday of startTime)
    cells[8] = displayStart ? vnWeekday(displayStart) : '';
    // J: Ngày OT (date of start in VN)
    cells[9] = displayStart ? fmtVnDateDash(displayStart) : '';
    // K: Ngày bắt đầu
    cells[10] = displayStart ? fmtVnDate(displayStart) : '';
    // L: Ngày kết thúc
    cells[11] = displayEnd ? fmtVnDate(displayEnd) : '';
    // M: Start time
    cells[12] = displayStart ? fmtVnDateTime(displayStart) : '';
    // N: End time
    cells[13] = displayEnd ? fmtVnDateTime(displayEnd) : '';

    // O/P: Break times from form
    const { breakStart, breakEnd } = extractBreakTimes(rawData);
    cells[14] = breakStart ? fmtVnDateTime(breakStart) : '';
    cells[15] = breakEnd ? fmtVnDateTime(breakEnd) : '';

    // Q: Khoảng giờ nghỉ giải lao (0 if no break)
    const breakHours = (breakStart && breakEnd)
      ? round2((breakEnd.getTime() - breakStart.getTime()) / 3_600_000)
      : 0;
    cells[16] = 0; // Default 0

    // R: Giờ OT thực tế (approved total hours)
    const actualHours = toNum(rec.approvedHours);
    cells[17] = actualHours || '';
    totalActualHours += actualHours;

    // S: Reason for overtime
    cells[18] = extractReason(rawData);

    // T: Giờ nghỉ bù quy đổi
    cells[19] = '';

    // U: Trễ hạn gửi đơn
    const latePolicy = parsed?.submissionPolicy?.isLate ? parsed.submissionPolicy : null;
    cells[20] = latePolicy ? (latePolicy.overrideApplied ? 'Nộp muộn - đã miễn trừ' : 'Nộp muộn - không tính') : '';

    // V: Chính sách OT
    const otPolicy = parsed?.otPolicy || '';
    cells[21] = otPolicy;

    // W–AD: OT bucket columns (indices 22–29)
    const bucketCols: number[] = [];
    let validTotalForRow = 0;
    let moneyTotalForRow = 0;
    const gncBuildParts: string[] = [];
    let isCompLeave = false;

    if (parsed) {
      const isNghiBu = isCompLeavePolicy(otPolicy);
      const counted = parsed.submissionPolicy?.counted !== false;
      const hourlyRate = toNum(emp.salaryPolicies[0]?.hourlyRate);

      for (const bucket of parsed.buckets) {
        const h = round2(bucket.approvedHours);
        if (h <= 0) continue;

        const colIdx = counted ? BUCKET_COL_MAP[bucket.bucket] : undefined;
        if (colIdx !== undefined) {
          const cur = toNum(cells[colIdx]);
          cells[colIdx] = round2(cur + h) || '';
          bucketTotals[colIdx] = round2(toNum(bucketTotals[colIdx]) + h);
          bucketCols.push(colIdx);
        }

        const payableHours = isNghiBu || !counted ? 0 : round2(bucket.approvedHours);
        const amount = isNghiBu ? 0 : roundUp(payableHours * bucket.rate * hourlyRate, 0);
        validTotalForRow += payableHours;
        moneyTotalForRow += amount;
        isCompLeave = isCompLeave || isNghiBu;
        gncBuildParts.push(`${bucket.bucket}; approved=${round2(bucket.approvedHours)}; payable=${payableHours}; money=${amount}`);
      }

      if (latePolicy) gncBuildParts.push(latePolicy.note);

      validTotalForRow = round2(validTotalForRow);
      moneyTotalForRow = roundUp(moneyTotalForRow, 0);
    }

    // AE: Tiền OT
    cells[30] = moneyTotalForRow || 0;
    // AF: Giờ hợp lệ tính lương
    cells[31] = validTotalForRow || '';
    totalValidHours += validTotalForRow;
    // AG: Ghi chú đối chiếu
    cells[32] = gncBuildParts.join('; ');

    rows.push({ cells, isCompLeave, bucketCols: [...new Set(bucketCols)] });
  }

  // TỔNG CỘNG row (33 cells)
  const totals: CellValue[] = new Array(COL_COUNT).fill('');
  totals[0] = 'TỔNG CỘNG';
  totals[17] = round2(totalActualHours) || '';
  for (let i = 22; i <= 29; i++) {
    if (bucketTotals[i]) totals[i] = round2(bucketTotals[i]);
  }
  totals[30] = roundUp(rows.reduce((sum, row) => sum + toNum(row.cells[30]), 0), 0) || 0;
  totals[31] = round2(totalValidHours) || '';

  return { period, rows, totals };
}

// ─── Styling ─────────────────────────────────────────────────

async function applyStyles(
  sheets: ReturnType<typeof createSheetsClient>,
  token: string,
  sid: string,
  totalDataRows: number,
): Promise<void> {
  const { range, fontSize } = LarkSheetsClient;
  const fullRow = (r: number) => range(sid, r, 0, r, COL_COUNT - 1);

  // Row 1: Title
  await sheets.mergeCells(token, fullRow(1));
  await sheets.setStyle(token, fullRow(1), {
    bold: true, fontSize: fontSize(13), foreColor: C.titleFg,
    backColor: C.titleBg, hAlign: 1, vAlign: 1,
    borderType: 'FULL_BORDER', borderColor: C.border,
  });

  // Row 2: Date range
  await sheets.mergeCells(token, fullRow(2));
  await sheets.setStyle(token, fullRow(2), {
    bold: true, fontSize: fontSize(10), foreColor: C.dateFg,
    backColor: C.dateBg, hAlign: 0, vAlign: 1,
    borderType: 'FULL_BORDER', borderColor: C.border,
  });

  // Row 3: Column headers
  await sheets.setStyle(token, fullRow(3), {
    bold: true, fontSize: fontSize(9), foreColor: C.headerFg,
    backColor: C.headerBg, hAlign: 1, vAlign: 1,
    borderType: 'FULL_BORDER', borderColor: C.border,
  });

  // OT bucket header columns — color each bucket column
  const bucketColors: [number, string][] = [
    [22, C.bucket150], [23, C.bucket200], [24, C.bucket210],
    [25, C.bucket130], [26, C.bucket270], [27, C.bucket300],
    [28, C.bucket390], [29, C.bucketBu], [30, C.otMoney], [31, C.otMoney],
  ];

  const headerStyleItems = bucketColors.map(([col, bg]) => ({
    range: range(sid, 3, col, 3, col),
    style: { bold: true, fontSize: fontSize(9), foreColor: C.headerFg, backColor: bg, hAlign: 1, vAlign: 1, borderType: 'FULL_BORDER', borderColor: C.border } as Parameters<typeof sheets.setStyle>[2],
  }));
  if (headerStyleItems.length) await sheets.setStyleBatch(token, headerStyleItems);

  // Data rows: alternate row bg — skip border to reduce API load
  if (totalDataRows > 0) {
    const baseDataRow = 4;
    // Group odd/even rows for 2 batch calls
    const evenRanges: string[] = [];
    const oddRanges: string[] = [];
    for (let r = baseDataRow; r < baseDataRow + totalDataRows; r++) {
      if (r % 2 === 0) evenRanges.push(fullRow(r));
      else oddRanges.push(fullRow(r));
    }
    if (evenRanges.length) {
      await sheets.setStyleBatch(token, evenRanges.map((rng) => ({
        range: rng,
        style: { fontSize: fontSize(9), backColor: C.altRow, vAlign: 1 },
      })));
    }
    if (oddRanges.length) {
      await sheets.setStyleBatch(token, oddRanges.map((rng) => ({
        range: rng,
        style: { fontSize: fontSize(9), backColor: C.altRow2, vAlign: 1 },
      })));
    }
  }

  // Totals row
  const totalsRow = 3 + totalDataRows + 1;
  await sheets.setStyle(token, fullRow(totalsRow), {
    bold: true, fontSize: fontSize(9), foreColor: C.totalFg,
    backColor: C.totalBg, hAlign: 1, vAlign: 1,
    borderType: 'FULL_BORDER', borderColor: C.border,
  });
}

async function setDimensions(
  sheets: ReturnType<typeof createSheetsClient>,
  token: string,
  sid: string,
  totalRows: number,
): Promise<void> {
  // Column widths (A–AG = 33 cols)
  const colWidths = [
    120, // A: Request No.
    80,  // B: Status
    120, // C: Submitted at
    120, // D: Completed at
    120, // E: Requester
    100, // F: Dept
    180, // G: Loại ngày OT
    60,  // H: Nghỉ lễ
    80,  // I: Thứ
    100, // J: Ngày OT
    100, // K: Ngày BĐ
    100, // L: Ngày KT
    160, // M: Start time
    160, // N: End time
    140, // O: BĐ giải lao
    140, // P: KT giải lao
    70,  // Q: Giải lao h
    70,  // R: Giờ OT TT
    300, // S: Reason
    80,  // T: Giờ nghỉ bù
    80,  // U: Trễ hạn
    140, // V: Chính sách OT
    80,  // W: OT 150%
    80,  // X: OT 200%
    80,  // Y: OT 210%
    80,  // Z: OT 130%
    80,  // AA: OT 270%
    80,  // AB: OT 300%
    80,  // AC: OT 390%
    80,  // AD: Nghỉ bù
    80,  // AE: Tiền OT
    80,  // AF: Giờ HL
    300, // AG: Ghi chú
  ];

  for (let i = 0; i < colWidths.length; i++) {
    await sheets.setColumnWidths(token, sid, i, i + 1, colWidths[i]);
  }

  // Row heights
  await sheets.setRowHeights(token, sid, 0, 1, 45);  // title
  await sheets.setRowHeights(token, sid, 1, 2, 32);  // date range
  await sheets.setRowHeights(token, sid, 2, 3, 55);  // col header (tall for long names)
  if (totalRows > 3) {
    await sheets.setRowHeights(token, sid, 3, totalRows, 28);  // data rows
  }
}

// ─── Change Working Sheet Builder ────────────────────────────

function buildChangeHeader(period: { monthKey: string; label: string; periodStart: Date; periodEnd: Date }): CellValue[] {
  return [
    `Change working & holidays hour - ${fmtMonthTitle(period)} (${fmtPeriodRange(period.periodStart, period.periodEnd)})`,
    'Status',
    'Submitted at',
    'Completed at',
    'Requester',
    '変更タイプ',
    'Reason理由',
    '変更日時(1) Start time',
    'End(1)',
    '合計',
    '変更希望日時(ngày 1) .Start time :',
    'End ngày 1',
    'total ngày 1',
    '変更希望日時(ngay 2)  .Start time :',
    'End ngay 2',
    'Total ngay 2',
    '変更希望日時(ngày 3) Start time :-',
    'End',
    'Total ngay 3',
    'Ngày đi làm thay đổi(bắt đầu)',
    'ngày đi làm 1 bđ',
    'ngày nghỉ 1.1 bđ',
    'ngày nghỉ 1.1 kt',
    'ngày nghỉ 1.2 bđ',
    'ngày nghỉ 1.2 kt',
    'ngày nghỉ 1.3 kt',
    'ngày nghỉ 1.3 bđ',
    'Ngày đi làm thay đổi(kết thúc)',
    '変更日時(2) Start time',
    'End(2)',
    'Total',
    'Số ngày gửi đơn trễ',
    'Trễ hạn gửi đơn',
    'Bắt đầu nghỉ trưa',
    'Kết thúc nghỉ trưa',
    'Total (h)',
    'Total (day)',
  ];
}

async function buildChangeWorkingValues(periodId: string): Promise<{
  period: { monthKey: string; label: string; periodStart: Date; periodEnd: Date };
  values: CellValue[][];
  recordsCount: number;
}> {
  const period = await withDbRetry('payrollPeriod.findUnique(changeWorking)', () =>
    prisma.payrollPeriod.findUnique({ where: { id: periodId } }),
  );
  if (!period) throw new Error(`Kỳ lương không tồn tại: ${periodId}`);

  const records = await fetchApprovalRows(period, CHANGE_APPROVAL_TYPES, true);
  records.sort(compareEmployeeName);
  const submissionPolicyConfig = await getApprovalSubmissionPolicyConfig(prisma);

  const rows = records.map((rec) => {
    const rawData = rec.rawData as Record<string, unknown> | null;
    const schedType = resolveEffectiveOtScheduleType(rec.employee);
    const parsed = rawData ? applySubmissionPolicyOverride(
      parseOtApproval(rawData, null, null, schedType, 'ChangeHours', submissionPolicyConfig),
      rec.submissionPolicyOverride,
    ) : null;
    const frame = parsed?.changeWorkingFrame;
    const intervals = getDateIntervals(rawData);
    const primaryInterval = intervals[0];
    const secondInterval = intervals[1];
    const thirdInterval = intervals[2];
    const changeStart = frame?.shiftStart ?? parsed?.approvedStart ?? rec.startTime ?? primaryInterval?.start ?? null;
    const changeEnd = frame?.shiftEnd ?? parsed?.approvedEnd ?? rec.endTime ?? primaryInterval?.end ?? null;
    const workedStart = frame?.workedPeriodStart ?? primaryInterval?.start ?? null;
    const workedEnd = frame?.workedPeriodEnd ?? primaryInterval?.end ?? null;
    const totalHours = round2(toNum(rec.approvedHours) || parsed?.approvedTotalHours || primaryInterval?.hours || 0);
    const lateDays = daysBetween(changeStart ?? rec.applyDate, rec.createdAt);
    const { breakStart, breakEnd } = extractBreakTimes(rawData);

    const cells: CellValue[] = new Array(CHANGE_COL_COUNT).fill('');
    cells[0] = rec.serialNumber || rec.instanceCode || '';
    cells[1] = rec.status || 'APPROVED';
    cells[2] = fmtVnDateTime(rec.createdAt);
    cells[3] = '';
    cells[4] = rec.employee.fullName || '';
    cells[5] = frame?.changeType || findFormValue(rawData, ['変更タイプ', 'change type']) || rec.approvalType;
    cells[6] = extractReason(rawData) || findFormValue(rawData, ['reason', '理由', 'lý do']);
    cells[7] = fmtVnDateTime(changeStart);
    cells[8] = fmtVnDateTime(changeEnd);
    cells[9] = totalHours || '';
    cells[10] = fmtVnDateTime(primaryInterval?.start ?? changeStart);
    cells[11] = fmtVnDateTime(primaryInterval?.end ?? changeEnd);
    cells[12] = round2(primaryInterval?.hours ?? totalHours) || '';
    cells[13] = fmtVnDateTime(secondInterval?.start);
    cells[14] = fmtVnDateTime(secondInterval?.end);
    cells[15] = round2(secondInterval?.hours ?? 0) || '';
    cells[16] = fmtVnDateTime(thirdInterval?.start);
    cells[17] = fmtVnDateTime(thirdInterval?.end);
    cells[18] = round2(thirdInterval?.hours ?? 0) || '';
    cells[19] = fmtVnDate(workedStart);
    cells[20] = fmtVnDateTime(workedStart);
    cells[21] = fmtVnDateTime(primaryInterval?.start ?? changeStart);
    cells[22] = fmtVnDateTime(primaryInterval?.end ?? changeEnd);
    cells[23] = fmtVnDateTime(secondInterval?.start);
    cells[24] = fmtVnDateTime(secondInterval?.end);
    cells[25] = fmtVnDateTime(thirdInterval?.end);
    cells[26] = fmtVnDateTime(thirdInterval?.start);
    cells[27] = fmtVnDate(workedEnd);
    cells[28] = fmtVnDateTime(secondInterval?.start);
    cells[29] = fmtVnDateTime(secondInterval?.end);
    cells[30] = round2(secondInterval?.hours ?? 0) || '';
    cells[31] = lateDays || '';
    cells[32] = parsed?.submissionPolicy?.isLate
      ? (parsed.submissionPolicy.overrideApplied ? 'Nộp muộn - đã miễn trừ' : 'Nộp muộn - không tính')
      : (lateDays > 0 ? 'YES' : 'NO');
    cells[33] = fmtVnDateTime(breakStart);
    cells[34] = fmtVnDateTime(breakEnd);
    cells[35] = totalHours || '';
    cells[36] = totalHours ? round2(totalHours / 8) : '';
    return cells;
  });

  const values = [buildChangeHeader(period), ...rows];
  while (values.length < TEMPLATE_ROW_COUNT) {
    values.push(new Array(CHANGE_COL_COUNT).fill(''));
  }

  return { period, values, recordsCount: rows.length };
}

async function writeChangeWorkingTab(
  sheets: ReturnType<typeof createSheetsClient>,
  token: string,
  sid: string,
  periodId: string,
): Promise<void> {
  const { values, recordsCount } = await buildChangeWorkingValues(periodId);
  const rangeAll = LarkSheetsClient.range(sid, 1, 0, values.length, CHANGE_COL_COUNT - 1);
  await sheets.writeValues(token, rangeAll, values);
  console.log(`${MODULE} Đã ghi ${values.length} hàng, ${recordsCount} Change working records`);
}

// ─── Main Export Function ────────────────────────────────────

export async function exportOtSheetToLark(periodId: string): Promise<{
  url: string;
  spreadsheetToken: string;
  isNew: boolean;
}> {
  console.log(`${MODULE} Bắt đầu export OT sheet kỳ ${periodId}`);

  const { period, rows, totals } = await buildOtRows(periodId);
  const sheets = createSheetsClient();

  // ── Determine sheet token ──
  const existing = await withDbRetry('payrollPeriod.findUnique(existingSheet)', () => prisma.payrollPeriod.findUnique({
    where: { id: periodId },
    select: { larkOtSheetToken: true, larkOtSheetUrl: true, larkSheetToken: true, larkSheetUrl: true },
  }));

  let spreadsheetToken = existing?.larkOtSheetToken ?? existing?.larkSheetToken ?? '';
  let sheetId = '';
  let changeSheetId = '';
  let isNew = false;
  let shouldCreateFromTemplate = false;
  let usingTemplateWorkbook = false;

  if (spreadsheetToken) {
    try {
      const meta = await sheets.getMetainfo(spreadsheetToken);
      const tab = meta.sheets.find((s) => s.title === SHEET_TAB_NAME) ?? meta.sheets[0];
      const changeTab = meta.sheets.find((s) => s.title === CHANGE_TAB_NAME);
      if (tab && isTemplateWorkbook(meta.sheets)) {
        sheetId = tab.sheetId;
        changeSheetId = changeTab?.sheetId ?? '';
        usingTemplateWorkbook = true;
        console.log(`${MODULE} Cập nhật OT sheet: ${spreadsheetToken}`);
      } else {
        spreadsheetToken = '';
        shouldCreateFromTemplate = true;
      }
    } catch {
      spreadsheetToken = '';
      shouldCreateFromTemplate = true;
    }
  }

  if (!spreadsheetToken || !sheetId) {
    const title = `OT ${period.label} - Asnova`;
    const created = await sheets.copySpreadsheet(OT_TEMPLATE_SPREADSHEET_TOKEN, title, TIMESHEET_FOLDER_TOKEN);
    spreadsheetToken = created.spreadsheetToken;
    isNew = true;
    console.log(`${MODULE} ${shouldCreateFromTemplate ? 'Tạo lại' : 'Tạo'} OT spreadsheet từ template: ${created.url}`);

    const meta = await sheets.getMetainfo(spreadsheetToken);
    const otSheet = meta.sheets.find((s) => s.title === SHEET_TAB_NAME);
    if (!otSheet) throw new Error('Không tìm thấy tab OT trong spreadsheet template');
    const changeSheet = meta.sheets.find((s) => s.title === CHANGE_TAB_NAME);
    if (!changeSheet) throw new Error('Không tìm thấy tab Change working & holidays hour1 trong spreadsheet template');
    sheetId = otSheet.sheetId;
    changeSheetId = changeSheet.sheetId;
    usingTemplateWorkbook = true;
  }

  // ── Build values matrix ──
  const fmtD = (d: Date) => {
    const vn = new Date(d.getTime() + VN_OFFSET_MS);
    return `${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}/${vn.getUTCFullYear()}`;
  };

  const titleRow: CellValue[] = [
    'DANH SÁCH NHÂN VIÊN LÀM THÊM GIỜ\nOT 従業員のリスト',
    ...new Array(COL_COUNT - 1).fill(''),
  ];

  const dateRow: CellValue[] = [
    fmtDateRange(period.periodStart, period.periodEnd),
    ...new Array(COL_COUNT - 1).fill(''),
  ];
  dateRow[29] = '代休時間';

  const headerRow: CellValue[] = [
    'Request No.', 'Status', 'Submitted at', 'Completed at', 'Requester',
    'Initiator department', 'Loại ngày OT', 'Nghỉ lễ', 'Thứ', 'Ngày OT',
    'Ngày bắt đầu', 'Ngày kết thúc', 'Start time', 'End time',
    'Bắt đầu giải lao1', 'Kết thúc giải lao1', 'Khoảng giờ nghỉ giải lao',
    'Giờ OT thực tế', 'Reason for overtime', 'Giờ nghỉ bù quy đổi',
    'Trễ hạn gửi đơn', 'Chính sách OT',
    'OT 150% - Ngày thường ca ngày / OT ca đêm 06:00-22:00',
    'OT 200% - Nghỉ/ngày thường đêm rời',
    'OT 210% - Ngày thường kéo sang đêm',
    'OT 130% / Ca đêm 30% - Ca đêm',
    'OT 270% - Ngày nghỉ ca đêm',
    'OT 300% - Ngày lễ ca ngày',
    'OT 390% - Ngày lễ ca đêm',
    'OT nghỉ bù / không tính lương',
    'Tiền OT',
    'Giờ hợp lệ tính lương',
    'Ghi chú đối chiếu',
  ];

  const allValues: CellValue[][] = [
    titleRow,
    dateRow,
    headerRow,
    ...rows.map((r) => r.cells),
    totals,
  ];

  const totalRows = Math.max(TEMPLATE_ROW_COUNT, allValues.length);
  while (allValues.length < totalRows) {
    allValues.push(new Array(COL_COUNT).fill(''));
  }
  const rangeAll = LarkSheetsClient.range(sheetId, 1, 0, totalRows, COL_COUNT - 1);
  await sheets.writeValues(spreadsheetToken, rangeAll, allValues);
  console.log(`${MODULE} Đã ghi ${totalRows} hàng, ${rows.length} OT records`);

  if (!usingTemplateWorkbook) {
    await applyStyles(sheets, spreadsheetToken, sheetId, rows.length);
    console.log(`${MODULE} Đã format`);

    await setDimensions(sheets, spreadsheetToken, sheetId, totalRows);
    console.log(`${MODULE} Đã set dimensions`);
  } else {
    console.log(`${MODULE} Giữ nguyên format/merge/dimensions từ template`);
  }

  if (changeSheetId) {
    await writeChangeWorkingTab(sheets, spreadsheetToken, changeSheetId, periodId);
  } else {
    console.warn(`${MODULE} Bỏ qua Change working vì workbook không có tab ${CHANGE_TAB_NAME}`);
  }

  // ── Save URL ──
  const sheetUrl = `https://tsg3y8y89y0w.sg.larksuite.com/sheets/${spreadsheetToken}`;

  await withDbRetry('payrollPeriod.update(sheetUrl)', () => prisma.payrollPeriod.update({
    where: { id: periodId },
    data: {
      larkOtSheetUrl: sheetUrl,
      larkOtSheetToken: spreadsheetToken,
    },
  }));

  console.log(`${MODULE} Hoàn thành! URL: ${sheetUrl}`);
  return { url: sheetUrl, spreadsheetToken, isNew };
}
