import { Buffer } from 'node:buffer';
import { env } from '../../config/env.js';

export type PayslipHrNoteAttachment = {
  id: string;
  name: string;
  type: string;
  size?: number;
  dataUrl: string;
  createdAt: string;
};

type PayslipPdfContext = {
  payslip: Record<string, unknown> & {
    employee?: Record<string, unknown> | null;
    period?: Record<string, unknown> | null;
  };
  attendance?: Record<string, unknown> | null;
  leaveBalance?: Record<string, unknown> | null;
  taxPolicy?: Record<string, unknown> | null;
};

type WebhookPdfResponse = {
  url: string;
  provider?: string;
  fileName?: string;
  message?: string;
};

function decimalToNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value !== 'object' || !('toString' in value)) return 0;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function money(value: unknown): string {
  return new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: 0,
  }).format(Math.round(decimalToNumber(value)));
}

function numberText(value: unknown, digits = 2): string {
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(decimalToNumber(value));
}

function text(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  return String(value);
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readHrNote(fullBreakdown: unknown): { text: string; attachments: PayslipHrNoteAttachment[] } {
  const note = asRecord(asRecord(fullBreakdown).payslipHrNote);
  const attachments = Array.isArray(note.attachments)
    ? note.attachments.filter((item): item is PayslipHrNoteAttachment => {
      const raw = asRecord(item);
      return typeof raw.dataUrl === 'string' && typeof raw.type === 'string';
    })
    : [];
  return {
    text: typeof note.text === 'string' ? note.text : '',
    attachments,
  };
}

function readAllowances(fullBreakdown: unknown): Record<string, unknown> {
  return asRecord(asRecord(fullBreakdown).allowances);
}

function readPayrollSegment(fullBreakdown: unknown): Record<string, unknown> {
  return asRecord(asRecord(fullBreakdown).payrollSegment);
}

export function payslipPdfFileName(payslip: PayslipPdfContext['payslip']): string {
  const employee = asRecord(payslip.employee);
  const period = asRecord(payslip.period);
  const code = text(employee.employeeCode, text(payslip.employeeId, 'employee')).replace(/[^\w.-]+/g, '_');
  const monthKey = text(period.monthKey, text(payslip.periodId, 'period')).replace(/[^\w.-]+/g, '_');
  return `payslip-${code}-${monthKey}.pdf`;
}

export function buildPayslipHtml(context: PayslipPdfContext): string {
  const { payslip, attendance, leaveBalance, taxPolicy } = context;
  const employee = asRecord(payslip.employee);
  const period = asRecord(payslip.period);
  const allowances = readAllowances(payslip.fullBreakdown);
  const segment = readPayrollSegment(payslip.fullBreakdown);
  const hrNote = readHrNote(payslip.fullBreakdown);

  const rows = [
    ['Lương cơ bản / tính công', `${money(payslip.baseSalary)} đ`],
    ['Lương thực tế', `${money(payslip.actualSalary)} đ`],
    ['Tổng phụ cấp', `${money(payslip.allowancesTotal)} đ`],
    ['Tổng OT', `${numberText(payslip.otTotalHours)}h / ${money(payslip.otTotalAmount)} đ`],
    ['Trừ đi muộn/về sớm', `${money(payslip.lateDeduction)} đ`],
    ['Tổng thu nhập', `${money(payslip.grossIncome)} đ`],
    ['Bảo hiểm NLĐ', `${money(payslip.insuranceEmployee)} đ`],
    ['Thuế TNCN', `${money(payslip.pitAmount)} đ`],
    ['Điều chỉnh sau thuế', `${money(payslip.afterTaxAdjustment)} đ`],
    ['Lương thực nhận', `${money(payslip.netSalary)} đ`],
  ];

  const allowanceRows = [
    ['Cấp bậc', allowances.rank],
    ['Kỹ thuật', allowances.technical],
    ['Ngoại ngữ', allowances.language],
    ['Nhà ở', allowances.housing],
    ['Đi lại', allowances.transport],
    ['Ăn ca', allowances.meal],
    ['Điện thoại', allowances.phone],
    ['Chuyên cần', allowances.attendance],
  ].filter(([, value]) => decimalToNumber(value) !== 0);

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(payslipPdfFileName(payslip))}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #172033; margin: 32px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    h2 { font-size: 16px; margin: 24px 0 8px; color: #1f4e79; }
    .muted { color: #64748b; font-size: 12px; }
    .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #1f4e79; padding-bottom: 16px; }
    .box { border: 1px solid #d9e2ef; border-radius: 8px; padding: 12px; margin-top: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #d9e2ef; padding: 8px; text-align: left; font-size: 13px; }
    th { background: #f1f5f9; }
    td:last-child { text-align: right; font-weight: 600; }
    .net { background: #ecfdf5; color: #047857; font-size: 16px; }
    .note { white-space: pre-wrap; line-height: 1.5; }
    img { max-width: 220px; max-height: 160px; margin: 8px 8px 0 0; border: 1px solid #d9e2ef; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Phiếu lương</h1>
      <div class="muted">ASNova Payroll</div>
    </div>
    <div>
      <strong>${escapeHtml(text(period.label, text(period.monthKey)))}</strong><br />
      <span class="muted">${escapeHtml(text(period.periodStart))} - ${escapeHtml(text(period.periodEnd))}</span>
    </div>
  </div>

  <div class="box">
    <strong>${escapeHtml(text(employee.fullName))}</strong><br />
    <span class="muted">Mã NV: ${escapeHtml(text(employee.employeeCode, '-'))} | Bộ phận: ${escapeHtml(text(employee.department, '-'))}</span><br />
    <span class="muted">Phân đoạn lương: ${escapeHtml(text(segment.label, text(segment.key, 'Chính thức')))}</span>
  </div>

  <h2>Tổng hợp lương</h2>
  <table>
    <tbody>
      ${rows.map(([label, value]) => `<tr class="${label === 'Lương thực nhận' ? 'net' : ''}"><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}
    </tbody>
  </table>

  <h2>Phụ cấp</h2>
  <table>
    <tbody>
      ${(allowanceRows.length ? allowanceRows : [['Không có phụ cấp phát sinh', 0]])
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${money(value)} đ</td></tr>`)
    .join('')}
    </tbody>
  </table>

  <h2>Công, phép, thuế</h2>
  <table>
    <tbody>
      <tr><th>Ngày chuẩn</th><td>${numberText(payslip.standardDays)} ngày</td></tr>
      <tr><th>Ngày công thực tế</th><td>${numberText(payslip.actualDays)} ngày</td></tr>
      <tr><th>Giờ đi muộn/về sớm sau trừ phép</th><td>${numberText(asRecord(attendance).lateHours)}h / ${numberText(asRecord(attendance).earlyHours)}h</td></tr>
      <tr><th>Tồn phép cuối kỳ</th><td>${numberText(asRecord(leaveBalance).closing)} ngày</td></tr>
      <tr><th>Số người phụ thuộc</th><td>${numberText(asRecord(taxPolicy).dependents, 0)}</td></tr>
    </tbody>
  </table>

  ${hrNote.text || hrNote.attachments.length ? `
    <h2>Ghi chú HR</h2>
    <div class="box note">${escapeHtml(hrNote.text)}</div>
    <div>${hrNote.attachments.map((attachment) => `<img alt="${escapeHtml(attachment.name)}" src="${escapeHtml(attachment.dataUrl)}" />`).join('')}</div>
  ` : ''}
</body>
</html>`;
}

export async function generatePayslipPdf(context: PayslipPdfContext): Promise<Buffer | WebhookPdfResponse> {
  const html = buildPayslipHtml(context);
  const fileName = payslipPdfFileName(context.payslip);

  if (env.ASNOVA_PDF_WEBHOOK_URL) {
    const response = await fetch(env.ASNOVA_PDF_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.ASNOVA_WEBHOOK_SECRET ? { 'X-ASNOVA-Webhook-Secret': env.ASNOVA_WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify({ html, fileName, payslipId: context.payslip.id }),
    });
    if (!response.ok) {
      throw new Error(`PDF webhook trả lỗi HTTP ${response.status}`);
    }
    const json = await response.json() as Partial<WebhookPdfResponse>;
    if (!json.url) {
      throw new Error('PDF webhook không trả về url');
    }
    return {
      url: json.url,
      provider: json.provider ?? 'webhook',
      fileName: json.fileName ?? fileName,
      message: json.message,
    };
  }

  // Fallback keeps the endpoint usable in environments without a PDF renderer.
  // The preview endpoint still returns the full HTML; production can wire a PDF webhook.
  return Buffer.from(html, 'utf8');
}
