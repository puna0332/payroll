/**
 * Tạo khóa idempotency — đảm bảo không trùng lặp dữ liệu
 * Dùng cho upsert chấm công, phê duyệt, chi tiết OT
 */

/**
 * Khóa idempotency cho bản ghi chấm công hàng ngày
 *
 * @example
 * attendanceKey('U001', '2026-05-15')  // 'att:U001:2026-05-15'
 */
export function attendanceKey(userId: string, date: string): string {
  return `att:${userId}:${date}`;
}

/**
 * Khóa idempotency cho bản ghi phê duyệt
 *
 * @example
 * approvalKey('INST-2026-001')  // 'apr:INST-2026-001'
 */
export function approvalKey(instanceCode: string): string {
  return `apr:${instanceCode}`;
}

/**
 * Khóa idempotency cho chi tiết OT
 *
 * @example
 * otDetailKey('emp-uuid', '2026-05-15', 'weekday_day')
 * // 'ot:emp-uuid:2026-05-15:weekday_day'
 */
export function otDetailKey(
  employeeId: string,
  date: string,
  bucket: string,
): string {
  return `ot:${employeeId}:${date}:${bucket}`;
}
