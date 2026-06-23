/**
 * Tiện ích xử lý tiếng Việt
 * Dùng để tìm kiếm, so sánh chuỗi không dấu
 */

/**
 * Loại bỏ dấu tiếng Việt — chuyển về ASCII thuần
 *
 * @example
 * removeVietnameseTones('Nguyễn Văn Ả')  // 'Nguyen Van A'
 * removeVietnameseTones('Đặng Thị Bé')   // 'Dang Thi Be'
 */
export function removeVietnameseTones(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[\u02C6\u0306\u031B]/g, '');
}
