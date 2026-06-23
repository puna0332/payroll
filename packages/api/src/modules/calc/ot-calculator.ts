/**
 * OT Calculator — Phân loại bucket OT và tính giờ hợp lệ
 *
 * Nguồn dữ liệu:
 * - ApprovalRecord.rawData.form[widgetWorkGroup].value: { start, end, detail[], timezoneOffset }
 * - DailyAttendance.rawData.records[]: { check_in_record, check_out_record, check_in_shift_time, check_out_shift_time }
 *
 * Logic chính:
 * 1. Parse OT window từ Lark workGroup widget (UTC ISO → VN time)
 * 2. Phân loại day type từ Lark detail[].workDetailCategory (1=Workday, 2=Day off, 3=Holiday)
 * 3. Cắt segment tại ranh giới 06:00 / 22:00
 * 4. Map mỗi segment → OT bucket
 * 5. Tính valid hours = overlap(actual checkin/out, approved window)
 */

import {
  OT_NIGHT_START_H,
  OT_NIGHT_END_H,
  LARK_OT_CATEGORY,
  VN_HOLIDAYS_2026,
} from '../../config/constants.js';

// ─── Types ────────────────────────────────────────────────────

export type DayType = 'workday' | 'day_off' | 'holiday';
export type TimeFrame = 'day' | 'night';

export interface OtBucketResult {
  bucket: string;          // e.g. 'OT 150%', 'OT 300%'
  rate: number;            // e.g. 1.5, 3.0
  dayType: DayType;
  frame: TimeFrame;
  startTime: Date;         // Segment start (VN time)
  endTime: Date;           // Segment end (VN time)
  approvedHours: number;   // Hours in this segment from approved form
  validHours: number;      // Hours actually worked (overlap with actual checkin/out)
  isNightShift: boolean;   // Ca đêm cố định
}

export interface ApprovalSubmissionPolicy {
  type: 'WORK_TIME_CHANGE' | 'OT';
  isLate: boolean;
  counted: boolean;
  overrideApplied?: boolean;
  submittedAt: Date | null;
  submittedDate: string | null;
  effectiveDate: string;
  requiredSubmitFromDate?: string;
  requiredSubmitByDate: string;
  note: string;
}

export type WorkTimeChangeSubmissionPolicy = ApprovalSubmissionPolicy;

export interface SubmissionPolicyConfig {
  enabled: boolean;
  requiredDaysBefore: number;
  otAllowedEarlyDaysBefore: number;
  otAllowedLateDaysAfter: number;
}

export const DEFAULT_SUBMISSION_POLICY_CONFIG: SubmissionPolicyConfig = {
  enabled: true,
  requiredDaysBefore: 1,
  otAllowedEarlyDaysBefore: 1,
  otAllowedLateDaysAfter: 1,
};

export interface OtParseResult {
  approvedStart: Date;       // UTC adjusted to VN
  approvedEnd: Date;
  approvedTotalHours: number;
  dayType: DayType;          // Primary day type (from first detail segment)
  isNightShift: boolean;     // Ca đêm detect (Change Working → night frame)
  buckets: OtBucketResult[];
  validTotalHours: number;   // Tổng giờ valid (sum of all bucket validHours)
  otPolicy: string;          // 'Tính lương OT' | 'Nghỉ bù' | ''
  submissionPolicy?: ApprovalSubmissionPolicy;
  changeWorkingFrame?: {     // Chỉ có khi type=ChangeHours
    isNightShift: boolean;
    shiftStart: Date;
    shiftEnd: Date;
    changeType?: string;         // e.g. '休日変更' (comp leave), 'ca đêm', etc.
    submissionPolicy?: WorkTimeChangeSubmissionPolicy;
    compLeaveHours?: number;     // Giờ nghỉ bù được duyệt
    workedPeriodStart?: Date;    // Khoảng làm thêm đã làm (ngày nghỉ/lễ)
    workedPeriodEnd?: Date;
  };
}

// ─── Lark WorkGroup Widget Types ─────────────────────────────

interface LarkWorkDetail {
  workDetailStart: string;       // ISO UTC e.g. "2026-05-18T10:00:00Z"
  workDetailEnd: string;
  workDetailCategory: {
    text: string;                // "Workday" | "Day off" | "Holiday"
    value: string;               // "1" | "2" | "3"
  };
  workDetailInterval: {
    value: string;               // Hours as string e.g. "6"
  };
}

interface LarkWorkGroupValue {
  start: string;                 // ISO UTC
  end: string;                   // ISO UTC
  interval: number;              // Total hours
  detail: LarkWorkDetail[];
  timezoneOffset: number;        // e.g. -420 for UTC+7
  reason: string;
}

// ─── Helper — VN time offset ─────────────────────────────────

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7

/** Convert UTC ISO string → Date in VN time (Date object preserves UTC internally, but VN=UTC+7) */
function toVnDate(isoUtc: string): Date {
  return new Date(isoUtc);
}

function adjustDateOnlyToStandardHours(d: Date, targetHourVn: number): Date {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  const adjustedVn = new Date(Date.UTC(
    vn.getUTCFullYear(),
    vn.getUTCMonth(),
    vn.getUTCDate(),
    targetHourVn,
    0,
    0,
    0
  ));
  return new Date(adjustedVn.getTime() - VN_OFFSET_MS);
}

export function adjustIfDateOnly(start: Date, end: Date): { start: Date; end: Date } {
  const startH = vnHour(start);
  const startM = vnMinutes(start);
  const endH = vnHour(end);
  const endM = vnMinutes(end);

  if (startH === 0 && startM === 0 && endH === 0 && endM === 0) {
    const adjStart = adjustDateOnlyToStandardHours(start, 8);
    const endVn = new Date(end.getTime() + VN_OFFSET_MS);
    const prevDayEndVn = new Date(endVn.getTime() - 24 * 60 * 60 * 1000);
    const adjEnd = adjustDateOnlyToStandardHours(prevDayEndVn, 17);
    if (adjEnd <= adjStart) {
      return {
        start: adjStart,
        end: adjustDateOnlyToStandardHours(start, 17)
      };
    }
    return { start: adjStart, end: adjEnd };
  }
  return { start, end };
}

/** Get hours in VN timezone (UTC+7) */
function vnHour(d: Date): number {
  return ((d.getUTCHours() + 7) % 24);
}

/** Get minutes in VN timezone */
function vnMinutes(d: Date): number {
  return d.getUTCMinutes();
}

/** Minutes since midnight VN time */
function vnMinutesSinceMidnight(d: Date): number {
  return vnHour(d) * 60 + vnMinutes(d);
}

/** Start of VN day (midnight VN = UTC-7hours of same day) */
function vnStartOfDay(d: Date): Date {
  const vnDate = new Date(d.getTime() + VN_OFFSET_MS);
  const midnight = new Date(Date.UTC(vnDate.getUTCFullYear(), vnDate.getUTCMonth(), vnDate.getUTCDate()));
  return new Date(midnight.getTime() - VN_OFFSET_MS);
}

/** VN date string MM-DD */
function vnMonthDay(d: Date): string {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

/** VN weekday (0=Sun, 6=Sat) */
function vnDayOfWeek(d: Date): number {
  return new Date(d.getTime() + VN_OFFSET_MS).getUTCDay();
}

function vnDateKey(d: Date): string {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const day = String(vn.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function normalizeSubmissionPolicyConfig(config?: Partial<SubmissionPolicyConfig> | null): SubmissionPolicyConfig {
  const rawDays = Number(config?.requiredDaysBefore ?? DEFAULT_SUBMISSION_POLICY_CONFIG.requiredDaysBefore);
  const requiredDaysBefore = Number.isFinite(rawDays)
    ? Math.max(0, Math.min(30, Math.floor(rawDays)))
    : DEFAULT_SUBMISSION_POLICY_CONFIG.requiredDaysBefore;
  const rawOtEarlyDays = Number(config?.otAllowedEarlyDaysBefore ?? DEFAULT_SUBMISSION_POLICY_CONFIG.otAllowedEarlyDaysBefore);
  const otAllowedEarlyDaysBefore = Number.isFinite(rawOtEarlyDays)
    ? Math.max(0, Math.min(30, Math.floor(rawOtEarlyDays)))
    : DEFAULT_SUBMISSION_POLICY_CONFIG.otAllowedEarlyDaysBefore;
  const rawOtLateDays = Number(config?.otAllowedLateDaysAfter ?? DEFAULT_SUBMISSION_POLICY_CONFIG.otAllowedLateDaysAfter);
  const otAllowedLateDaysAfter = Number.isFinite(rawOtLateDays)
    ? Math.max(0, Math.min(30, Math.floor(rawOtLateDays)))
    : DEFAULT_SUBMISSION_POLICY_CONFIG.otAllowedLateDaysAfter;

  return {
    enabled: config?.enabled ?? DEFAULT_SUBMISSION_POLICY_CONFIG.enabled,
    requiredDaysBefore,
    otAllowedEarlyDaysBefore,
    otAllowedLateDaysAfter,
  };
}

function isCompLeaveChangeType(changeType: string): boolean {
  const normalized = changeType.toLowerCase();
  return (
    changeType.includes('休日変更') ||
    normalized.includes('comp') ||
    normalized.includes('nghỉ bù') ||
    normalized.includes('nghi bu')
  );
}

function isWorkTimeChangeType(changeType: string): boolean {
  const normalized = changeType.toLowerCase();
  return (
    changeType.includes('勤務時間変更') ||
    normalized.includes('shift') ||
    normalized.includes('đổi ca') ||
    normalized.includes('doi ca')
  );
}

function extractSubmittedAt(rawData: Record<string, unknown>): Date | null {
  const rawStartTime = rawData.start_time ?? rawData.startTime;
  if (typeof rawStartTime === 'number' || typeof rawStartTime === 'string') {
    const millis = Number(rawStartTime);
    if (Number.isFinite(millis) && millis > 0) return new Date(millis);
  }

  const timeline = rawData.timeline;
  if (Array.isArray(timeline)) {
    const startEvent = timeline.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'START') as Record<string, unknown> | undefined;
    const createTime = startEvent?.create_time;
    if (typeof createTime === 'number' || typeof createTime === 'string') {
      const millis = Number(createTime);
      if (Number.isFinite(millis) && millis > 0) return new Date(millis);
    }
  }

  return null;
}

function buildSubmissionPolicy(
  rawData: Record<string, unknown>,
  type: ApprovalSubmissionPolicy['type'],
  effectiveStart: Date,
  config?: Partial<SubmissionPolicyConfig> | null,
): ApprovalSubmissionPolicy {
  const policyConfig = normalizeSubmissionPolicyConfig(config);
  const submittedAt = extractSubmittedAt(rawData);
  const submittedDate = submittedAt ? vnDateKey(submittedAt) : null;
  const effectiveDate = vnDateKey(effectiveStart);
  const requiredSubmitFromDate = type === 'OT'
    ? addDaysToDateKey(effectiveDate, -policyConfig.otAllowedEarlyDaysBefore)
    : undefined;
  const requiredSubmitByDate = type === 'OT'
    ? addDaysToDateKey(effectiveDate, policyConfig.otAllowedLateDaysAfter)
    : addDaysToDateKey(effectiveDate, -policyConfig.requiredDaysBefore);
  const isOutsideWindow = policyConfig.enabled && (
    !submittedDate ||
    submittedDate > requiredSubmitByDate ||
    Boolean(requiredSubmitFromDate && submittedDate < requiredSubmitFromDate)
  );
  const subject = type === 'OT' ? 'Phiếu OT' : 'Phiếu đổi ca';

  if (!policyConfig.enabled) {
    return {
      type,
      isLate: false,
      counted: true,
      submittedAt,
      submittedDate,
      effectiveDate,
      requiredSubmitFromDate,
      requiredSubmitByDate,
      note: `${subject} đang tắt rule hạn nộp nên vẫn được ghi nhận cho ngày áp dụng ${effectiveDate}.`,
    };
  }

  if (type === 'OT') {
    return {
      type,
      isLate: isOutsideWindow,
      counted: !isOutsideWindow,
      submittedAt,
      submittedDate,
      effectiveDate,
      requiredSubmitFromDate,
      requiredSubmitByDate,
      note: isOutsideWindow
        ? `${subject} phải được tạo trong khoảng ${requiredSubmitFromDate} đến ${requiredSubmitByDate} cho ngày OT ${effectiveDate}. Phiếu này tạo ngày ${submittedDate ?? 'không xác định'} nên ngoài hạn và không được tính.`
        : `${subject} được tạo trong hạn cho ngày OT ${effectiveDate} (${requiredSubmitFromDate} đến ${requiredSubmitByDate}).`,
    };
  }

  return {
    type,
    isLate: isOutsideWindow,
    counted: !isOutsideWindow,
    submittedAt,
    submittedDate,
    effectiveDate,
    requiredSubmitByDate,
    note: isOutsideWindow
      ? `${subject} phải được tạo chậm nhất ngày ${requiredSubmitByDate} cho ngày áp dụng ${effectiveDate}. Phiếu này tạo ngày ${submittedDate ?? 'không xác định'} nên nộp muộn và không được tính.`
      : `${subject} được tạo đúng hạn cho ngày áp dụng ${effectiveDate}.`,
  };
}

export function applySubmissionPolicyOverride<T extends OtParseResult | null>(
  parsed: T,
  overrideEnabled = false,
): T {
  if (!parsed || !overrideEnabled) return parsed;

  const apply = (policy: ApprovalSubmissionPolicy | undefined): ApprovalSubmissionPolicy | undefined => {
    if (!policy || !policy.isLate) return policy;
    const subject = policy.type === 'OT' ? 'Phiếu OT' : 'Phiếu đổi ca';
    return {
      ...policy,
    counted: true,
    overrideApplied: true,
    note: policy.requiredSubmitFromDate
      ? `${subject} ngoài khoảng hạn ${policy.requiredSubmitFromDate} đến ${policy.requiredSubmitByDate} cho ngày áp dụng ${policy.effectiveDate}, nhưng đã được miễn trừ thủ công nên vẫn được tính.`
      : `${subject} nộp muộn so với hạn ${policy.requiredSubmitByDate} cho ngày áp dụng ${policy.effectiveDate}, nhưng đã được miễn trừ thủ công nên vẫn được tính.`,
  };
  };

  const submissionPolicy = apply(parsed.submissionPolicy);
  const changeWorkingFrame = parsed.changeWorkingFrame
    ? {
        ...parsed.changeWorkingFrame,
        submissionPolicy: apply(parsed.changeWorkingFrame.submissionPolicy),
      }
    : undefined;

  return {
    ...parsed,
    submissionPolicy,
    changeWorkingFrame,
  } as T;
}

function buildWorkTimeChangeSubmissionPolicy(
  rawData: Record<string, unknown>,
  changeType: string,
  shiftStart: Date,
  config?: Partial<SubmissionPolicyConfig> | null,
): ApprovalSubmissionPolicy | undefined {
  if (!isWorkTimeChangeType(changeType)) return undefined;
  return buildSubmissionPolicy(rawData, 'WORK_TIME_CHANGE', shiftStart, config);
}

// ─── Day Type Resolver ────────────────────────────────────────

/**
 * Xác định day type của 1 ngày
 * Priority: Holiday > Day off (T7/CN by schedule) > Workday
 */
export function resolveDayType(
  date: Date,
  scheduleType: 'office' | 'six_day' = 'office',
  larkCategory?: string,  // từ workDetailCategory.value nếu có
): DayType {
  // Lark đã phân loại rõ ràng trong OT form
  if (larkCategory) {
    if (larkCategory === LARK_OT_CATEGORY.HOLIDAY) return 'holiday';
    if (larkCategory === LARK_OT_CATEGORY.DAY_OFF) return 'day_off';
    if (larkCategory === LARK_OT_CATEGORY.WORKDAY) return 'workday';
  }

  // Fallback: kiểm tra VN holidays
  const mmdd = vnMonthDay(date);
  if (VN_HOLIDAYS_2026[mmdd]) return 'holiday';

  // Kiểm tra T7/CN theo schedule
  const dow = vnDayOfWeek(date);
  if (dow === 0) return 'day_off';  // Chủ nhật luôn nghỉ
  if (dow === 6 && scheduleType === 'office') return 'day_off';  // T7 nghỉ với office
  // six_day (TTVT): T7 là workday

  return 'workday';
}

// ─── Time Frame Detector ──────────────────────────────────────

/**
 * Xác định một khoảng thời gian là day hay night
 * Night = 22:00–06:00
 */
function isNightTime(minutesSinceMidnight: number): boolean {
  const h = Math.floor(minutesSinceMidnight / 60);
  return h >= OT_NIGHT_START_H || h < OT_NIGHT_END_H;
}

// ─── OT Bucket Classifier ────────────────────────────────────

/**
 * Map (dayType, frame, isNightShiftEmployee) → OT bucket name + rate
 *
 * Bảng 9 buckets theo nghiệp vụ Asnova:
 * ┌──────────────────────────────────────────────────────┐
 * │ workday + day (17:00–22:00)         → OT 150% (1.5) │
 * │ workday + night only (22:00–06:00)  → OT 200% (2.0) │
 * │ workday + day then night            → OT 210% (2.1) │  ← OT kéo sang đêm
 * │ night shift + day                   → OT 130% (1.3) │
 * │ night shift + night                 → Ca đêm 30%(0.3)│
 * │ day_off (T7) + day                  → OT 200% (2.0) │
 * │ day_off (T7) + night                → OT 270% (2.7) │
 * │ day_off (CN) + day                  → OT 200% (2.0) │
 * │ day_off (CN) + night                → OT 270% (2.7) │
 * │ holiday + day                       → OT 300% (3.0) │
 * │ holiday + night                     → OT 390% (3.9) │
 * └──────────────────────────────────────────────────────┘
 */
export function classifyOtBucket(
  dayType: DayType,
  frame: TimeFrame,
  isNightShiftEmployee: boolean,
  isSaturday: boolean = false,
  continuesFromDayOt: boolean = false,
): { bucket: string; rate: number } {
  // Ca đêm cố định
  if (isNightShiftEmployee) {
    return frame === 'night'
      ? { bucket: '平日の夜勤 22h~6h ca đêm', rate: 0.3 }
      : { bucket: '平日夜勤の残業→翌日の6h~22h Số giờ làm thêm của ca đêm', rate: 1.5 };
  }

  if (dayType === 'holiday') {
    return frame === 'night'
      ? { bucket: 'OT ngày lễ ca đêm 祝日夜勤 22h~6h', rate: 3.9 }
      : { bucket: 'OT ngày lễ 祝日出勤', rate: 3.0 };
  }

  if (dayType === 'day_off') {
    if (isSaturday) {
      return frame === 'night'
        ? { bucket: 'Ngày nghỉ T7 ca đêm 土曜夜勤 22h~6h', rate: 2.7 }
        : { bucket: 'Ngày nghỉ T7 休日出勤(土) 6h~22h', rate: 2.0 };
    }
    // CN: 200% ngày, 270% đêm
    return frame === 'night'
      ? { bucket: 'Ngày nghỉ ca đêm 休日の夜勤 22h~6h', rate: 2.7 }
      : { bucket: 'Ngày nghỉ 休日出勤 6h~22h', rate: 2.0 };
  }

  // workday
  if (frame === 'night') {
    return continuesFromDayOt
      ? { bucket: 'Ngày thường 時間外(夜間まで残業) 22h~6h', rate: 2.1 }
      : { bucket: 'Làm thêm ca đêm của ngày thường', rate: 2.0 };
  }
  return { bucket: 'Ngày thường 時間外 17h~22h', rate: 1.5 };
}

// ─── Segment Splitter ─────────────────────────────────────────

interface TimeSegment {
  start: Date;
  end: Date;
  frame: TimeFrame;
  dayType: DayType;
  isSaturday: boolean;
  hours: number;
}

/**
 * Cắt khoảng thời gian OT tại ranh giới 06:00 và 22:00
 * Xử lý OT qua nửa đêm (cross-midnight)
 *
 * Boundary rules:
 * - Night: 22:00–06:00 (crosses midnight)
 * - Day:   06:00–22:00
 */
export function splitOtSegments(
  start: Date,
  end: Date,
  dayType: DayType,
  scheduleType: 'office' | 'six_day' = 'office',
): TimeSegment[] {
  const segments: TimeSegment[] = [];

  // Boundary timestamps trong cùng ngày (VN midnight base)
  let cursor = new Date(start.getTime());

  while (cursor < end) {
    const cursorMins = vnMinutesSinceMidnight(cursor);
    const cursorH = Math.floor(cursorMins / 60);
    const isNight = isNightTime(cursorMins);

    // Tìm ranh giới tiếp theo
    let boundaryH: number;
    if (isNight) {
      // Đang trong night zone (22–06), boundary tiếp theo là 06:00
      boundaryH = OT_NIGHT_END_H;
    } else {
      // Đang trong day zone (06–22), boundary tiếp theo là 22:00
      boundaryH = OT_NIGHT_START_H;
    }

    // Tính thời điểm boundary trong UTC
    let boundaryDate: Date;
    if (!isNight) {
      // Day → next boundary là 22:00 cùng ngày VN
      const dayBase = vnStartOfDay(cursor);
      boundaryDate = new Date(dayBase.getTime() + boundaryH * 3600_000);
    } else if (cursorH >= OT_NIGHT_START_H) {
      // Night zone trước nửa đêm (22:00–00:00) → boundary là 06:00 hôm sau
      const dayBase = vnStartOfDay(cursor);
      boundaryDate = new Date(dayBase.getTime() + (24 + OT_NIGHT_END_H) * 3600_000);
    } else {
      // Night zone sau nửa đêm (00:00–06:00) → boundary là 06:00 cùng ngày VN
      const dayBase = vnStartOfDay(cursor);
      boundaryDate = new Date(dayBase.getTime() + OT_NIGHT_END_H * 3600_000);
    }

    const segEnd = new Date(Math.min(boundaryDate.getTime(), end.getTime()));
    const hours = (segEnd.getTime() - cursor.getTime()) / 3_600_000;

    if (hours > 0.001) {
      // Resolve day type for this segment (may change across midnight)
      const segDayType = resolveDayType(cursor, scheduleType);
      const dow = vnDayOfWeek(cursor);

      segments.push({
        start: new Date(cursor.getTime()),
        end: segEnd,
        frame: isNight ? 'night' : 'day',
        dayType: segDayType,
        isSaturday: dow === 6,
        hours: Math.round(hours * 100) / 100,
      });
    }

    cursor = segEnd;
  }

  return segments;
}

// ─── Valid Hours Calculator ───────────────────────────────────

/**
 * Tính giờ OT hợp lệ = overlap giữa approved window và actual checkin/out
 * Formula: valid = min(actualEnd, approvedEnd) − max(actualStart, approvedStart)
 */
export function calcValidOtHours(
  approvedStart: Date,
  approvedEnd: Date,
  actualStart: Date | null,
  actualEnd: Date | null,
): number {
  if (!actualStart || !actualEnd) return 0;
  const overlapStart = Math.max(approvedStart.getTime(), actualStart.getTime());
  const overlapEnd   = Math.min(approvedEnd.getTime(),   actualEnd.getTime());
  if (overlapEnd <= overlapStart) return 0;
  const hours = (overlapEnd - overlapStart) / 3_600_000;
  return Math.round(hours * 100) / 100;
}

// ─── Change Working / Night Shift Detector ───────────────────

/**
 * Detect ca đêm từ Change Working phiếu hoặc NightShift phiếu
 * Ca đêm = shift chứa giờ trong khoảng 22:00–06:00
 *
 * Cũng detect từ attendance rawData: shift_id trỏ tới ca đêm
 * (nếu shiftCheckIn >= 22:00 hoặc shiftCheckOut <= 06:00)
 */
export function detectNightShift(
  shiftCheckIn: Date | null,
  shiftCheckOut: Date | null,
): boolean {
  if (!shiftCheckIn || !shiftCheckOut) return false;
  const inH  = vnHour(shiftCheckIn);
  const outH = vnHour(shiftCheckOut);
  // Ca đêm nếu: check-in >= 22:00 HOẶC check-out <= 06:00
  return inH >= OT_NIGHT_START_H || outH <= OT_NIGHT_END_H;
}

// ─── Main OT Parser ───────────────────────────────────────────

/**
 * Parse toàn bộ thông tin OT từ 1 ApprovalRecord
 *
 * @param rawData   - ApprovalRecord.rawData (parsed JSON)
 * @param actualIn  - DailyAttendance.checkIn (actual checkin time)
 * @param actualOut - DailyAttendance.checkOut (actual checkout time)
 * @param scheduleType - 'office' | 'six_day'
 * @param approvalType - 'OT' | 'ChangeHours' | 'NightShift'
 */
export function parseOtApproval(
  rawData: Record<string, unknown>,
  actualIn: Date | null,
  actualOut: Date | null,
  scheduleType: 'office' | 'six_day' = 'office',
  approvalType: string = 'OT',
  submissionPolicyConfig?: Partial<SubmissionPolicyConfig> | null,
): OtParseResult | null {
  // ── 1. Extract workGroup widget from form ──
  const form = rawData.form as Array<Record<string, unknown>> | undefined;
  if (!form) return null;

  const workGroupWidget = form.find(
    (f) => (f.type as string) === 'workGroup' || (f.id as string)?.toLowerCase().includes('workgroup'),
  );

  if (!workGroupWidget?.value) {
    // NightShift phiếu dùng leaveGroup
    return parseNightShiftApproval(rawData, actualIn, actualOut, scheduleType, submissionPolicyConfig);
  }

  const wg = workGroupWidget.value as LarkWorkGroupValue;

  // ── 2. Parse approved time window (UTC → local Date) ──
  const rawStart = toVnDate(wg.start);
  const rawEnd   = toVnDate(wg.end);
  const { start: approvedStart, end: approvedEnd } = adjustIfDateOnly(rawStart, rawEnd);
  const approvedTotalHours = wg.interval || 0;

  // ── 3. OT policy (Tính lương OT / Nghỉ bù) ──
  const policyWidget = form.find((f) => (f.name as string)?.includes('Chính sách OT'));
  const otPolicy = (policyWidget?.value as string) || '';

  // ── 4. Primary day type from Lark detail[0] ──
  const firstDetail = wg.detail?.[0];
  const primaryCategory = firstDetail?.workDetailCategory?.value;
  const primaryDayType = resolveDayType(approvedStart, scheduleType, primaryCategory);

  // ── 5. Split approved window into day/night segments ──
  const segments = splitOtSegments(approvedStart, approvedEnd, primaryDayType, scheduleType);
  const hasWorkdayDayOtBeforeNight = segments.some((seg) => seg.dayType === 'workday' && seg.frame === 'day');

  // ── 6. Classify each segment into OT bucket ──
  const buckets: OtBucketResult[] = segments.map((seg) => {
    const { bucket, rate } = classifyOtBucket(
      seg.dayType,
      seg.frame,
      false,
      seg.isSaturday,
      seg.dayType === 'workday' && seg.frame === 'night' && hasWorkdayDayOtBeforeNight,
    );

    // Valid hours = overlap với actual checkin/out
    const validH = calcValidOtHours(seg.start, seg.end, actualIn, actualOut);

    return {
      bucket,
      rate,
      dayType: seg.dayType,
      frame: seg.frame,
      startTime: seg.start,
      endTime: seg.end,
      approvedHours: seg.hours,
      validHours: validH,
      isNightShift: false,
    };
  });

  const validTotalHours = buckets.reduce((s, b) => s + b.validHours, 0);
  const submissionPolicy = approvalType === 'OT'
    ? buildSubmissionPolicy(rawData, 'OT', approvedStart, submissionPolicyConfig)
    : undefined;

  return {
    approvedStart,
    approvedEnd,
    approvedTotalHours,
    dayType: primaryDayType,
    isNightShift: false,
    buckets,
    validTotalHours: Math.round(validTotalHours * 100) / 100,
    otPolicy,
    submissionPolicy,
  };
}

// ─── Night Shift / Change Working Parser ─────────────────────

/**
 * Parse NightShift phiếu hoặc ChangeHours phiếu (xác định khung ca)
 * Hỗ trợ:
 *  - leaveGroup widget: NightShift phiếu
 *  - dateInterval widgets: ChangeHours / 休日変更 (nghỉ bù)
 */
export function parseNightShiftApproval(
  rawData: Record<string, unknown>,
  actualIn: Date | null,
  actualOut: Date | null,
  scheduleType: 'office' | 'six_day' = 'office',
  submissionPolicyConfig?: Partial<SubmissionPolicyConfig> | null,
): OtParseResult | null {
  const form = rawData.form as Array<Record<string, unknown>> | undefined;
  if (!form) return null;

  // ── Path 1: leaveGroup widget (NightShift phiếu) ──
  const leaveWidget = form.find(
    (f) => (f.type as string) === 'leaveGroup' || (f.id as string)?.toLowerCase().includes('leavegroup'),
  );

  if (leaveWidget?.value) {
    const lg = leaveWidget.value as { startTime: string; endTime: string; interval?: number };
    const rawStart = toVnDate(lg.startTime);
    const rawEnd   = toVnDate(lg.endTime);
    const { start: approvedStart, end: approvedEnd } = adjustIfDateOnly(rawStart, rawEnd);
    const approvedTotalHours = lg.interval || (approvedEnd.getTime() - approvedStart.getTime()) / 3_600_000;

    const isNight = detectNightShift(approvedStart, approvedEnd);
    const dayType = resolveDayType(approvedStart, scheduleType);
    const frame: TimeFrame = isNight ? 'night' : 'day';
    const { bucket, rate } = classifyOtBucket(dayType, frame, true);
    const validH = calcValidOtHours(approvedStart, approvedEnd, actualIn, actualOut);

    return {
      approvedStart,
      approvedEnd,
      approvedTotalHours,
      dayType,
      isNightShift: isNight,
    buckets: [{ bucket, rate, dayType, frame, startTime: approvedStart, endTime: approvedEnd, approvedHours: approvedTotalHours, validHours: validH, isNightShift: isNight }],
    validTotalHours: Math.round(validH * 100) / 100,
    otPolicy: '',
    submissionPolicy: undefined,
    changeWorkingFrame: { isNightShift: isNight, shiftStart: approvedStart, shiftEnd: approvedEnd },
  };
  }

  // ── Path 2: dateInterval widgets (ChangeHours / 休日変更 nghỉ bù) ──
  const dateIntervals = form
    .filter((f) => (f.type as string) === 'dateInterval' && f.value)
    .map((f) => {
      const v = f.value as { start: string; end: string; interval: number; timezoneOffset?: number };
      const rawStart = toVnDate(v.start);
      const rawEnd   = toVnDate(v.end);
      const { start, end } = adjustIfDateOnly(rawStart, rawEnd);
      return { start, end, hours: v.interval ?? 0 };
    })
    .filter((d) => d.start < d.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime()); // earliest first

  if (dateIntervals.length === 0) return null;

  // Đọc loại thay đổi từ 変更タイプ widget (checkboxV2)
  const changeTypeWidget = form.find(
    (f) => (f.name as string)?.includes('変更タイプ') || (f.name as string)?.includes('ChangeType'),
  );
  const changeTypeValues = changeTypeWidget?.value as string[] | undefined;
  const changeType = changeTypeValues?.[0] ?? '';

  const isCompLeaveChange = isCompLeaveChangeType(changeType);
  const oldShiftInterval = !isCompLeaveChange && dateIntervals.length >= 2 ? dateIntervals[0] : null;
  const workedInterval = isCompLeaveChange && dateIntervals.length >= 2 ? dateIntervals[0] : null;
  const effectiveInterval = dateIntervals.length >= 2 ? dateIntervals[dateIntervals.length - 1] : dateIntervals[0];

  const approvedStart = effectiveInterval.start;
  const approvedEnd   = effectiveInterval.end;
  const approvedTotalHours = effectiveInterval.hours;

  const isNight = detectNightShift(approvedStart, approvedEnd);
  const dayType = resolveDayType(approvedStart, scheduleType);
  const frame: TimeFrame = isNight ? 'night' : 'day';
  const { bucket, rate } = classifyOtBucket(dayType, frame, false);
  const validH = calcValidOtHours(approvedStart, approvedEnd, actualIn, actualOut);
  const submissionPolicy = buildWorkTimeChangeSubmissionPolicy(rawData, changeType, approvedStart, submissionPolicyConfig);

  return {
    approvedStart,
    approvedEnd,
    approvedTotalHours,
    dayType,
    isNightShift: isNight,
    buckets: [{ bucket, rate, dayType, frame, startTime: approvedStart, endTime: approvedEnd, approvedHours: approvedTotalHours, validHours: validH, isNightShift: isNight }],
    validTotalHours: Math.round(validH * 100) / 100,
    otPolicy: '',
    submissionPolicy,
    changeWorkingFrame: {
      isNightShift: isNight,
      shiftStart: approvedStart,
      shiftEnd:   approvedEnd,
      changeType,
      submissionPolicy,
      compLeaveHours: isCompLeaveChange ? approvedTotalHours : undefined,
      workedPeriodStart: (workedInterval ?? oldShiftInterval)?.start,
      workedPeriodEnd:   (workedInterval ?? oldShiftInterval)?.end,
    },
  };
}

// ─── Correction Credit Calculator ────────────────────────────

/**
 * Tính correction credit từ phiếu chỉnh sửa chấm công
 * Logic: credit offset giờ trễ/sớm trước, phần còn lại bổ sung vào work hours
 *
 * @param approvedHours - Giờ được duyệt trong phiếu correction
 * @param lateHours     - Giờ đi trễ thực tế
 * @param earlyHours    - Giờ về sớm thực tế
 * @returns { effectiveLateHours, effectiveEarlyHours, workCreditHours }
 */
export function calcCorrectionCredit(
  approvedHours: number,
  lateHours: number,
  earlyHours: number,
): {
  effectiveLateHours: number;
  effectiveEarlyHours: number;
  workCreditHours: number;
  lateOffset: number;
  earlyOffset: number;
} {
  let credit = approvedHours;

  // 1. Offset giờ trễ trước
  const lateOffset = Math.min(lateHours, credit);
  const effectiveLateHours = Math.max(0, lateHours - lateOffset);
  credit -= lateOffset;

  // 2. Offset giờ về sớm
  const earlyOffset = Math.min(earlyHours, credit);
  const effectiveEarlyHours = Math.max(0, earlyHours - earlyOffset);
  credit -= earlyOffset;

  // 3. Phần còn lại cộng vào giờ công
  const workCreditHours = Math.max(0, credit);

  return {
    effectiveLateHours: Math.round(effectiveLateHours * 100) / 100,
    effectiveEarlyHours: Math.round(effectiveEarlyHours * 100) / 100,
    workCreditHours: Math.round(workCreditHours * 100) / 100,
    lateOffset: Math.round(lateOffset * 100) / 100,
    earlyOffset: Math.round(earlyOffset * 100) / 100,
  };
}
