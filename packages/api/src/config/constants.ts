/**
 * Hằng số nghiệp vụ — Business constants
 * Quy định giờ làm việc, bảo hiểm, thuế TNCN, tăng ca
 */

// ─── Giờ làm việc tiêu chuẩn ───────────────────────────────

/** Số giờ làm việc tiêu chuẩn mỗi ngày */
export const STANDARD_HOURS = 8;

/** Giờ check-in tiêu chuẩn */
export const STANDARD_CHECKIN = '08:00';

/** Giờ check-out tiêu chuẩn */
export const STANDARD_CHECKOUT = '17:00';

/** Số phút ân hạn khi check-out sớm */
export const CHECKOUT_GRACE_MINUTES = 30;

// ─── Giới hạn tăng ca ───────────────────────────────────────

/** Giới hạn OT tháng (giờ) */
export const MONTHLY_OT_LIMIT = 40;

/** Giới hạn OT ngày (giờ) */
export const DAILY_OT_LIMIT = 4;

/** Cảnh báo ca liên tục (giờ) */
export const CONTINUOUS_SHIFT_ALERT = 12;

// ─── Bảo hiểm ──────────────────────────────────────────────

/** Mức trần đóng bảo hiểm */
export const INSURANCE_CAPS = {
  /** Trần BHXH + BHYT: 20 x lương cơ sở (2,340,000 * 20) */
  bhxh_bhyt: 46_800_000,
  /** Trần BHTN: 20 x lương tối thiểu vùng I (4,960,000 * 20) */
  bhtn: 99_200_000,
} as const;

/** Tỷ lệ đóng bảo hiểm */
export const INSURANCE_RATES = {
  employee: {
    /** BHXH người lao động: 8% */
    bhxh: 0.08,
    /** BHYT người lao động: 1.5% */
    bhyt: 0.015,
    /** BHTN người lao động: 1% */
    bhtn: 0.01,
  },
  employer: {
    /** BHXH người sử dụng lao động: 17.5% */
    bhxh: 0.175,
    /** BHYT người sử dụng lao động: 3% */
    bhyt: 0.03,
    /** BHTN người sử dụng lao động: 1% */
    bhtn: 0.01,
  },
} as const;

// ─── Thuế TNCN ──────────────────────────────────────────────

/** Giảm trừ người phụ thuộc: 6,200,000 VND/người/tháng */
export const DEPENDENT_DEDUCTION = 6_200_000;

/** Giảm trừ bản thân theo template payroll 2026 */
export const PERSONAL_DEDUCTION = 15_500_000;

/** Mức miễn thuế tiền ăn: 930,000 VND/tháng */
export const MEAL_TAX_EXEMPT_CAP = 930_000;

/**
 * Biểu thuế lũy tiến từng phần — 7 bậc
 * Theo Luật Thuế TNCN Việt Nam
 */
export const PIT_BRACKETS = [
  { ceiling:  10_000_000, rate: 0.05 },
  { ceiling:  30_000_000, rate: 0.10 },
  { ceiling:  60_000_000, rate: 0.20 },
  { ceiling: 100_000_000, rate: 0.30 },
  { ceiling:    Infinity, rate: 0.35 },
] as const;

// ─── Tăng ca — OT Buckets ───────────────────────────────────

/**
 * 9 loại tăng ca với hệ số nhân khác nhau
 * Theo quy định Bộ luật Lao động Việt Nam
 */
export const OT_BUCKETS = [
  {
    key: 'weekday_day',
    label: 'Ngày thường — Ban ngày',
    rate: 1.5,
    dayKind: 'weekday',
    frame: 'day',
  },
  {
    key: 'weekday_night',
    label: 'Ngày thường — Ban đêm',
    rate: 2.0,
    dayKind: 'weekday',
    frame: 'night',
  },
  {
    key: 'saturday_day',
    label: 'Thứ 7 — Ban ngày',
    rate: 1.5,
    dayKind: 'saturday',
    frame: 'day',
  },
  {
    key: 'saturday_night',
    label: 'Thứ 7 — Ban đêm',
    rate: 2.0,
    dayKind: 'saturday',
    frame: 'night',
  },
  {
    key: 'sunday_day',
    label: 'Chủ nhật — Ban ngày',
    rate: 2.0,
    dayKind: 'sunday',
    frame: 'day',
  },
  {
    key: 'sunday_night',
    label: 'Chủ nhật — Ban đêm',
    rate: 2.7,
    dayKind: 'sunday',
    frame: 'night',
  },
  {
    key: 'holiday_day',
    label: 'Ngày lễ — Ban ngày',
    rate: 3.0,
    dayKind: 'holiday',
    frame: 'day',
  },
  {
    key: 'holiday_night',
    label: 'Ngày lễ — Ban đêm',
    rate: 3.9,
    dayKind: 'holiday',
    frame: 'night',
  },
  {
    key: 'night_normal',
    label: 'Phụ cấp đêm (ca đêm thường)',
    rate: 0.3,
    dayKind: 'any',
    frame: 'night_allowance',
  },
] as const;

export type OtBucketKey = (typeof OT_BUCKETS)[number]['key'];

// ─── OT Time Boundaries ──────────────────────────────────────

/**
 * Ranh giới ban đêm: 22:00 → 06:00 hôm sau
 * Night boundary per Vietnam Labor Code
 */
export const OT_NIGHT_START_H = 22;  // 22:00
export const OT_NIGHT_END_H   = 6;   // 06:00
export const OT_DAY_START_H   = 6;   // Ngày bắt đầu từ 06:00
export const SHIFT_END_H      = 17;  // 17:00 — kết thúc ca chuẩn (OT bắt đầu sau đây)

/**
 * Lark workGroup detail category:
 * 1 = Workday (ngày thường)
 * 2 = Day off (ngày nghỉ T7/CN)
 * 3 = Holiday (ngày lễ)
 */
export const LARK_OT_CATEGORY = {
  WORKDAY: '1',
  DAY_OFF: '2',
  HOLIDAY: '3',
} as const;

// ─── Vietnamese Holidays 2026 ────────────────────────────────

/**
 * Ngày lễ Việt Nam 2026 — format MM-DD
 * Dùng chung backend + frontend để phân loại OT bucket
 */
export const VN_HOLIDAYS_2026: Record<string, string> = {
  '01-01': 'Tết Dương lịch',
  '01-17': 'Tết Nguyên Đán (trước)',
  '01-18': 'Tết Nguyên Đán (trước)',
  '01-19': 'Tết Nguyên Đán (29 Tết)',
  '01-20': 'Tết Nguyên Đán (30 Tết)',
  '01-21': 'Tết Nguyên Đán (Mùng 1)',
  '01-22': 'Tết Nguyên Đán (Mùng 2)',
  '01-23': 'Tết Nguyên Đán (Mùng 3)',
  '04-26': 'Giỗ Tổ Hùng Vương (nghỉ bù)',
  '04-27': 'Giỗ Tổ Hùng Vương',
  '04-30': 'Giải phóng miền Nam',
  '05-01': 'Quốc tế Lao động',
  '09-02': 'Quốc khánh',
  '09-03': 'Nghỉ bù Quốc khánh',
};

/**
 * Kiểm tra ngày có phải ngày lễ không
 */
export function isVnHoliday(date: Date): { isHoliday: boolean; name?: string } {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const key = `${mm}-${dd}`;
  const name = VN_HOLIDAYS_2026[key];
  return name ? { isHoliday: true, name } : { isHoliday: false };
}
