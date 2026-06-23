/**
 * Leave Type Classifier
 * Phân loại loại nghỉ phép từ chuỗi text (Vietnamese/English) → LeaveTypeBucket enum
 */

// Note: Cannot import Prisma enum directly in pure function module
// Use string literal type matching the Prisma enum
export type LeaveTypeBucket =
  | 'ANNUAL'
  | 'UNPAID'
  | 'BENEFIT'
  | 'REMOTE'
  | 'COMP_LEAVE'
  | 'CORRECTION'
  | 'OT'
  | 'CHANGE';

const MODULE = '[Attendance:LeaveClassifier]';

/**
 * Keyword → bucket mapping
 * Thứ tự ưu tiên: specific trước, generic sau
 */
const KEYWORD_MAP: Array<{ keywords: string[]; bucket: LeaveTypeBucket }> = [
  {
    bucket: 'UNPAID',
    keywords: [
      'khong luong', 'không lương', 'unpaid', 'khong huong luong',
      'nghi om', 'nghỉ ốm', 'bhxh', 'sick', 'nghi khong luong',
    ],
  },
  {
    bucket: 'BENEFIT',
    keywords: [
      'phuc loi', 'phúc lợi', 'welfare', 'benefit',
      'nghi co luong', 'nghỉ có lương', 'paid leave',
      'che do', 'chế độ', 'sinh nhat', 'sinh nhật', 'birthday',
      'hieu hi', 'hiếu hỉ', 'tang', 'cuoi', 'cưới',
    ],
  },
  {
    bucket: 'REMOTE',
    keywords: [
      'remote', 'wfh', 'work from home', 'lam viec tu xa',
      'làm việc từ xa', 'tu xa', 'từ xa',
    ],
  },
  {
    bucket: 'COMP_LEAVE',
    keywords: [
      'nghi bu', 'nghỉ bù', 'compensatory', 'comp leave',
      'comp_leave', 'bù phép',
    ],
  },
  {
    bucket: 'CORRECTION',
    keywords: [
      'bo sung cham cong', 'bổ sung chấm công', 'correction',
      'quen cham cong', 'quên chấm công', 'forgot punch',
      'chinh sua', 'chỉnh sửa',
    ],
  },
  {
    bucket: 'OT',
    keywords: [
      'dang ky ot', 'đăng ký ot', 'ot request', 'overtime',
      'tang ca', 'tăng ca', 'lam them', 'làm thêm',
    ],
  },
  {
    bucket: 'CHANGE',
    keywords: [
      'thay doi gio', 'thay đổi giờ', 'change working',
      'change schedule', 'doi ca', 'đổi ca',
      'thay doi', 'thay đổi',
    ],
  },
  {
    // ANNUAL is the default/fallback — most common leave type
    bucket: 'ANNUAL',
    keywords: [
      'phep nam', 'phép năm', 'annual', 'annual leave',
      'nghi phep', 'nghỉ phép', 'paid time off', 'pto',
      'huu', 'hữu', // 有休 (yūkyū)
    ],
  },
];

/**
 * Remove Vietnamese diacritics for fuzzy matching
 */
function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim();
}

/**
 * Classify a leave type string into a bucket.
 *
 * @param leaveType — raw leave type label from Lark approval
 * @returns LeaveTypeBucket or null if unrecognized
 *
 * @example
 * classifyLeaveType('Nghỉ phép năm 有休')  // 'ANNUAL'
 * classifyLeaveType('Nghỉ không lương')      // 'UNPAID'
 * classifyLeaveType('Đăng ký OT')            // 'OT'
 */
export function classifyLeaveType(leaveType: string): LeaveTypeBucket | null {
  if (!leaveType || leaveType.trim().length === 0) {
    return null;
  }

  const normalized = normalize(leaveType);

  for (const { keywords, bucket } of KEYWORD_MAP) {
    for (const keyword of keywords) {
      if (normalized.includes(normalize(keyword))) {
        console.log(`${MODULE} "${leaveType}" → ${bucket} (matched: "${keyword}")`);
        return bucket;
      }
    }
  }

  // Default fallback: treat unknown as ANNUAL (most common)
  console.warn(`${MODULE} "${leaveType}" → ANNUAL (fallback, no keyword match)`);
  return 'ANNUAL';
}

/**
 * Check if a bucket counts as "paid credit" (tính công)
 * Paid credits increase actual_days in attendance rollup
 */
export function isPaidCredit(bucket: LeaveTypeBucket): boolean {
  return ['ANNUAL', 'BENEFIT', 'REMOTE', 'COMP_LEAVE', 'CORRECTION'].includes(bucket);
}
