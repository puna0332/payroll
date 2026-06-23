/**
 * Hàm làm tròn số — dùng cho tính toán tài chính
 * Sử dụng ROUND_HALF_UP (banker's rounding không phù hợp với lương)
 */

/**
 * Làm tròn giá trị đến số chữ số thập phân chỉ định
 * Mặc định: 0 chữ số (làm tròn nguyên)
 *
 * @example
 * round(1234.567)     // 1235
 * round(1234.567, 2)  // 1234.57
 * round(1234.5, 0)    // 1235
 */
export function round(value: number, decimals: number = 0): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Làm tròn lên đến số chữ số thập phân chỉ định
 * Dùng khi cần ceiling (ví dụ: tính số ngày nghỉ tối thiểu)
 *
 * @example
 * roundUp(1234.001, 0)  // 1235
 * roundUp(1234.001, 2)  // 1234.01 (đã tròn)
 */
export function roundUp(value: number, decimals: number = 0): number {
  const factor = Math.pow(10, decimals);
  return Math.ceil(value * factor) / factor;
}
