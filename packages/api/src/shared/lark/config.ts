/**
 * Lark API — Cấu hình
 * Base URL, table IDs, read-only field types
 */

import { env } from '../../config/env.js';

// ─── Base URL ───────────────────────────────────────────────

export const LARK_BASE_URL = 'https://open.larksuite.com/open-apis';

// ─── Config Interface ───────────────────────────────────────

export interface LarkConfig {
  appId: string;
  appSecret: string;
  appToken: string;
}

/**
 * Đọc cấu hình Lark từ biến môi trường (đã validate bởi Zod)
 */
export function getLarkConfig(): LarkConfig {
  return {
    appId: env.LARK_APP_ID,
    appSecret: env.LARK_APP_SECRET,
    appToken: env.LARK_APP_TOKEN,
  };
}

/**
 * HR master data may be mirrored to a dedicated Base while payroll/attendance
 * sync continues to use the main LARK_APP_TOKEN.
 */
export function getLarkHrConfig(): LarkConfig {
  return {
    appId: env.LARK_APP_ID,
    appSecret: env.LARK_APP_SECRET,
    appToken: env.LARK_HR_APP_TOKEN || env.LARK_APP_TOKEN,
  };
}

// ─── Table IDs — Lark Base ──────────────────────────────────
// Placeholder values sẽ được thay thế bằng ID thực tế sau

export const TABLE_IDS = {
  /** Danh sách nhân sự */
  HR: 'tblak008sRzCjCPF',

  /** Chấm công hàng ngày */
  DAILY_ATTENDANCE: 'tblmSa9Z5Z3YnEvN',

  /** Chấm công hàng tháng */
  MONTHLY_ATTENDANCE: 'tblBwFkosS9StGjJ',

  /** Bản ghi phê duyệt */
  APPROVAL_RECORDS: 'tblwtwAISFQnTcKz',

  /** Chi tiết tăng ca */
  OT_DETAILS: 'tblYPG4YE6op7jX0',

  /** Tổng hợp tăng ca hàng tháng */
  OT_MONTHLY: 'tblGMC8BXiPAFVgj',

  /** Chính sách lương */
  SALARY_POLICY: 'tblRTOr2MmfemvO7',

  /** Chính sách thuế TNCN */
  TAX_POLICY: 'tblR2p8W8fbxZ6yF',

  /** Chính sách bảo hiểm */
  INSURANCE_POLICY: 'tblkKgPs4299uRUU',

  /** Phiếu lương */
  PAYSLIPS: 'tblLnyAnZ32rD804',

  /** Phiếu lương chuẩn */
  PAYSLIP_CLEAN: 'tbl1YaWzWFB9Cdgj',

  /** Số dư phép */
  LEAVE_BALANCE: 'tblR7KohpSUaFucm',

  /** Quy tắc nghỉ phép */
  LEAVE_RULES: 'tbl2GdNlYQfiySFD',

  /** Lịch làm việc */
  WORK_CALENDAR: 'tblcZi0NfJe8WNv3',

  /** Lịch đóng kỳ lương */
  CLOSE_CALENDAR: 'tbleLSKyuQvgge21',

  /** Quản lý sheet */
  SHEET_MANAGER: 'tblFJ7kwfc1H0qFS',
} as const;

export type TableId = (typeof TABLE_IDS)[keyof typeof TABLE_IDS];

// ─── Read-Only Field Types ──────────────────────────────────
// Các field type này chỉ đọc, không thể ghi khi create/update record

export const READ_ONLY_FIELD_TYPES = new Set([
  19,   // Lookup — Tra cứu
  20,   // Formula — Công thức
  21,   // DuplexLink reverse/lookup links — Tra cứu/liên kết ngược
  1001, // CreatedTime — Thời gian tạo
  1002, // ModifiedTime — Thời gian sửa
  1003, // CreatedUser — Người tạo
  1004, // ModifiedUser — Người sửa
  1005, // AutoNumber — Tự tăng
  1006, // Rollup — Tổng hợp
]);
