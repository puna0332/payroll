/**
 * Tiện ích xử lý ngày tháng
 * Chuẩn hóa month key, label, và định dạng ngày Việt Nam
 */

/**
 * Tạo month key từ Date — định dạng YYYYMM
 *
 * @example
 * monthKey(new Date('2026-05-15'))  // '202605'
 */
export function monthKey(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${year}${month}`;
}

/**
 * Tạo nhãn hiển thị từ month key
 *
 * @example
 * monthLabel('202605')  // 'Tháng 05/2026'
 */
export function monthLabel(key: string): string {
  const year = key.slice(0, 4);
  const month = key.slice(4, 6);
  return `Tháng ${month}/${year}`;
}

/**
 * Định dạng ngày theo kiểu Việt Nam: DD/MM/YYYY
 *
 * @example
 * toVNDate(new Date('2026-05-15'))  // '15/05/2026'
 */
export function toVNDate(date: Date): string {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}
