/**
 * Tiện ích định dạng tiền tệ
 * Dùng cho hiển thị số tiền VND trong payslip, báo cáo
 */

/**
 * Định dạng số tiền theo chuẩn VND với ký hiệu ₫
 *
 * @example
 * formatVND(15_350_000)  // '15.350.000 ₫'
 * formatVND(0)           // '0 ₫'
 */
export function formatVND(amount: number): string {
  return (
    new Intl.NumberFormat('vi-VN', {
      maximumFractionDigits: 0,
    }).format(Math.round(amount)) + ' ₫'
  );
}

/**
 * Định dạng số tiền thuần — không có ký hiệu tiền tệ
 * Dùng khi xuất Excel, CSV hoặc đồng bộ Lark
 *
 * @example
 * formatMoneyPlain(15_350_000)  // '15,350,000'
 * formatMoneyPlain(1234.56)     // '1,235'
 */
export function formatMoneyPlain(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}
