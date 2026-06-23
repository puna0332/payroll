/**
 * Export Tính Công → Lark Sheet
 *
 * Tạo hoặc cập nhật spreadsheet tính công cho 1 kỳ lương.
 * Format: giống sheet mẫu với header, nhóm, dữ liệu và totals.
 *
 * Columns (A–K):
 *   A: STT
 *   B: Họ và Tên
 *   C: Kỳ lương
 *   D: Công chuẩn
 *   E: Công thực
 *   F: Trễ (h)
 *   G: Sớm (h)
 *   H: Phép dùng (h)
 *   I: Phép còn (h)
 *   J: OT (h)
 *   K: Vắng (ngày)
 */

import { prisma } from '../../shared/db/prisma.js';
import { createSheetsClient, LarkSheetsClient, type CellValue } from '../../shared/lark/sheets.js';
import { belongsToPeriodByJoinDate } from '../../shared/utils/employment-period.js';
import { resolveEffectiveOtScheduleType } from '../../shared/utils/work-schedule.js';
import { applySubmissionPolicyOverride, parseOtApproval } from '../calc/ot-calculator.js';
import { getApprovalSubmissionPolicyConfig } from '../calc/submission-policy-settings.js';

const MODULE = '[ExportTimesheet]';

function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

// ─── Config ─────────────────────────────────────────────────

const TIMESHEET_FOLDER_TOKEN = 'HvTmf16Z2liDFAdKTyElfRRWgKc';
const SHEET_TAB_NAME = 'Tính công';
const COL_COUNT = 11; // A–K (0–10)

// ─── Colors — sử dụng dark blue theme như sheet mẫu ─────────

const C = {
  headerDark:   '#1F4E79',  // header chính / group header
  headerText:   '#FFFFFF',
  colHeader:    '#2E75B6',  // column header
  expats:       '#D6E4F0',  // nhóm expats
  indirect:     '#EBF3FB',  // nhóm gián tiếp
  direct:       '#FFF2CC',  // nhóm trực tiếp
  altWhite:     '#FFFFFF',
  totals:       '#BDD7EE',  // tổng cộng
  border:       '#9DC3E6',
  negative:     '#FF0000',  // số âm / vắng
  warning:      '#FF6600',  // trễ/sớm
};

// ─── Employee ordering ───────────────────────────────────────

const EMPLOYEE_ORDER = [
  'ASV001', 'ASV013',
  'ASV002', 'ASV003', 'ASV010', 'ASV011', 'ASV014', 'ASV022', 'ASV024',
  'ASV005', 'ASV008', 'ASV016', 'ASV017', 'ASV018', 'ASV023',
] as const;

type EmpCode = string;

const EXPAT_GROUP = { key: 'expats', label: '駐在員 / EXPATS' };
const INDIRECT_GROUP = { key: 'indirect', label: '間接部門 / BỘ PHẬN GIÁN TIẾP' };
const DIRECT_GROUP = { key: 'direct', label: '機材センター / TRỰC TIẾP KHO BÃI · THIẾT BỊ' };
const OTHER_GROUP = { key: 'other', label: 'KHÁC' };

const GROUP_MAP: Record<EmpCode, { key: string; label: string }> = {
  ASV001: EXPAT_GROUP,
  ASV013: EXPAT_GROUP,
  ASV002: INDIRECT_GROUP,
  ASV003: INDIRECT_GROUP,
  ASV010: INDIRECT_GROUP,
  ASV011: INDIRECT_GROUP,
  ASV014: INDIRECT_GROUP,
  ASV022: INDIRECT_GROUP,
  ASV024: INDIRECT_GROUP,
  ASV005: DIRECT_GROUP,
  ASV008: DIRECT_GROUP,
  ASV016: DIRECT_GROUP,
  ASV017: DIRECT_GROUP,
  ASV018: DIRECT_GROUP,
  ASV023: DIRECT_GROUP,
};

const NAME_OVERRIDES: Record<EmpCode, string> = {
  ASV001: 'TANAKA KIIICHIRO', ASV013: 'HOSHIHARA SHINICHI',
  ASV002: 'TRAN HOANG BAO TRAN', ASV003: 'NGUYEN NGOC TRAM',
  ASV010: 'Nguyễn Văn Hải', ASV011: 'Nguyễn Văn Cảnh',
  ASV014: 'Nguyễn Thị Thu Trang', ASV022: 'Văn Hậu',
  ASV024: 'Dương Văn Sử', ASV005: 'NGUYEN XUAN TAI',
  ASV008: 'Nguyễn Đức Huân', ASV016: 'Lê Ngọc Khánh',
  ASV017: 'Hà Minh Châu', ASV018: 'Phan Anh Hùng',
  ASV023: 'Vũ Thị Thanh Ngọc',
};

// ─── Helpers ────────────────────────────────────────────────

function toNum(v: unknown): number {
  if (v == null) return 0;
  // Duck-type Prisma Decimal — works regardless of ESM module isolation
  if (typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).toNumber === 'function') {
    return ((v as Record<string, unknown>).toNumber as () => number)();
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    // Handle "29" or "29.50"
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function normalizeCode(...vals: unknown[]): EmpCode | null {
  for (const v of vals) {
    if (typeof v !== 'string') continue;
    const m = v.trim().match(/^ASV0*(\d+)$/i);
    if (m) return `ASV${m[1].padStart(3, '0')}`;
  }
  return null;
}

function resolveGroup(code: EmpCode | null, department: unknown): { key: string; label: string } | null {
  if (code && GROUP_MAP[code]) return GROUP_MAP[code];
  if (typeof department !== 'string') return code ? OTHER_GROUP : null;

  const dept = department.trim().toLowerCase();
  if (!dept) return code ? OTHER_GROUP : null;
  if (dept === 'bod' || dept.includes('ban giám đốc')) return EXPAT_GROUP;
  if (dept.includes('ttvt') || dept.includes('機材') || dept.includes('kho') || dept.includes('thiết bị')) return DIRECT_GROUP;
  if (dept.includes('bpql') || dept.includes('pkd') || dept.includes('管理') || dept.includes('営業')) return INDIRECT_GROUP;
  return code ? OTHER_GROUP : null;
}

function sortIndex(code: EmpCode | null, fullName: string): number {
  if (code) {
    const fixedIndex = (EMPLOYEE_ORDER as readonly string[]).indexOf(code);
    if (fixedIndex >= 0) return fixedIndex;
    const numeric = code.match(/\d+/);
    if (numeric) return EMPLOYEE_ORDER.length + Number(numeric[0]) / 1000;
  }
  return EMPLOYEE_ORDER.length + 100 + ((fullName.trim().toLowerCase().charCodeAt(0) || 999) / 1000);
}

function formatDate(d: Date): string {
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

function fmtNum(n: number, decimals = 1): string | number {
  if (n === 0) return '';
  return decimals === 0 ? n : round2(n);
}

// ─── Row data type ───────────────────────────────────────────

interface RowData {
  code: EmpCode;
  name: string;
  groupKey: string;
  groupLabel: string;
  periodLabel: string;
  standardDays: number;
  actualDays: number;
  lateHours: number;
  earlyHours: number;
  leaveUsed: number;
  leaveRemaining: number;
  approvedOtHours: number;
  absentDays: number;
}

// ─── Fetch data from DB ──────────────────────────────────────

async function fetchData(periodId: string): Promise<{
  period: { id: string; label: string; monthKey: string; periodStart: Date; periodEnd: Date };
  rows: RowData[];
}> {
  const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new Error(`Kỳ lương không tồn tại: ${periodId}`);
  const periodEnd = endOfUtcDay(period.periodEnd);

  const [employees, monthlyAttendances, leaveBalances, otApprovals] = await Promise.all([
    prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, userId: true, employeeCode: true, fullName: true, department: true, larkMetadata: true, scheduleType: true, joinDate: true },
    }),
    prisma.monthlyAttendance.findMany({ where: { periodId } }),
    prisma.leaveBalance.findMany({ where: { monthKey: period.monthKey } }),
    prisma.approvalRecord.findMany({
      where: {
        status: 'APPROVED',
        approvalType: { in: ['OT', 'Làm thêm giờ', 'NightShift', 'Ca đêm'] },
        OR: [
          { startTime: { gte: period.periodStart, lte: periodEnd } },
          { applyDate: { gte: period.periodStart, lte: periodEnd } },
        ],
      },
      include: { employee: { select: { scheduleType: true, employeeCode: true, userId: true, department: true, larkMetadata: true } } },
    }),
  ]);

  const attMap = new Map(monthlyAttendances.map((a) => [a.employeeId, a]));
  const leaveMap = new Map(leaveBalances.map((l) => [l.employeeId, l]));
  const submissionPolicyConfig = await getApprovalSubmissionPolicyConfig(prisma);

  // Approved OT per employee
  const otMap = new Map<string, number>();
  for (const rec of otApprovals) {
    const rawData = rec.rawData as Record<string, unknown> | null;
    if (!rawData) continue;
    const schedType = resolveEffectiveOtScheduleType(rec.employee);
    const normType = ['NightShift', 'Ca đêm'].includes(rec.approvalType) ? 'NightShift' : 'OT';
    const parsed = applySubmissionPolicyOverride(
      parseOtApproval(rawData, null, null, schedType, normType, submissionPolicyConfig),
      rec.submissionPolicyOverride,
    );
    if (!parsed) continue;
    if (parsed.submissionPolicy?.counted === false) continue;
    const hrs = parsed.buckets.reduce((s, b) => s + b.approvedHours, 0);
    otMap.set(rec.employeeId, round2((otMap.get(rec.employeeId) ?? 0) + hrs));
  }

  const rows: RowData[] = [];
  const orderedEmployees = employees
    .filter((emp) => belongsToPeriodByJoinDate(period.periodEnd, emp.joinDate))
    .map((emp) => {
      const meta = emp.larkMetadata as Record<string, unknown> | null;
      const code = normalizeCode(emp.employeeCode, meta?.employeeNo, emp.userId);
      const group = resolveGroup(code, emp.department);
      return { emp, code, group, order: sortIndex(code, emp.fullName) };
    })
    .filter((item): item is typeof item & { group: { key: string; label: string } } => !!item.group)
    .sort((a, b) => a.order - b.order || a.emp.fullName.localeCompare(b.emp.fullName, 'vi'));

  for (const { emp, code, group } of orderedEmployees) {
    const rowCode = code ?? emp.id;
    const att = attMap.get(emp.id);
    const leave = leaveMap.get(emp.id);

    rows.push({
      code: rowCode,
      name: (code ? NAME_OVERRIDES[code] : undefined) ?? emp.fullName,
      groupKey: group.key,
      groupLabel: group.label,
      periodLabel: period.label,
      standardDays: toNum(att?.standardDays),
      actualDays: toNum(att?.actualDays),
      lateHours: round2(toNum(att?.lateHours)),
      earlyHours: round2(toNum(att?.earlyHours)),
      leaveUsed: round2(toNum(att?.annualLeaveHours) + toNum(att?.benefitLeaveHours)),
      leaveRemaining: leave ? toNum(leave.closing) : 0,
      approvedOtHours: otMap.get(emp.id) ?? 0,
      absentDays: round2(toNum(att?.absentDays)),
    });
  }

  return { period, rows };
}

// ─── Build sheet values matrix ───────────────────────────────

interface SheetPlan {
  values: CellValue[][];
  titleRow: number;          // 1-based
  colHeaderRow: number;      // 1-based
  groupHeaders: Array<{ row: number; key: string; label: string }>;
  dataRows: Array<{ row: number; code: EmpCode }>;
  totalsRow: number;         // 1-based
}

function buildSheetPlan(period: { label: string; periodStart: Date; periodEnd: Date }, rows: RowData[]): SheetPlan {
  const values: CellValue[][] = [];

  // Row 1: Title (merged)
  const dateRange = `${formatDate(period.periodStart)} – ${formatDate(period.periodEnd)}`;
  values.push([`BẢNG TÍNH CÔNG ${period.label.toUpperCase()}  (${dateRange})`, ...Array(COL_COUNT - 1).fill('')]);
  const titleRow = 1;

  // Row 2: Column headers
  values.push([
    'STT', 'Họ và Tên', 'Kỳ lương',
    'Công chuẩn', 'Công thực',
    'Trễ (h)', 'Sớm (h)',
    'Phép dùng (h)', 'Phép còn (h)',
    'OT (h)', 'Vắng (ngày)',
  ]);
  const colHeaderRow = 2;

  // Group data rows
  const groupHeaders: SheetPlan['groupHeaders'] = [];
  const dataRows: SheetPlan['dataRows'] = [];

  // Group rows by groupKey while preserving order
  const groups: Map<string, { label: string; rows: RowData[] }> = new Map();
  for (const row of rows) {
    if (!groups.has(row.groupKey)) {
      groups.set(row.groupKey, { label: row.groupLabel, rows: [] });
    }
    groups.get(row.groupKey)!.rows.push(row);
  }

  let stt = 1;
  for (const [, group] of groups) {
    // Group header row
    const ghRow = values.length + 1;
    groupHeaders.push({ row: ghRow, key: '', label: group.label });
    values.push([group.label, ...Array(COL_COUNT - 1).fill('')]);

    // Data rows
    for (const row of group.rows) {
      const drRow = values.length + 1;
      dataRows.push({ row: drRow, code: row.code });
      values.push([
        stt++,
        row.name,
        row.periodLabel,
        row.standardDays,
        row.actualDays > 0 ? round2(row.actualDays) : '',
        fmtNum(row.lateHours),
        fmtNum(row.earlyHours),
        fmtNum(row.leaveUsed),
        row.leaveRemaining !== 0 ? round2(row.leaveRemaining) : '',
        fmtNum(row.approvedOtHours),
        fmtNum(row.absentDays),
      ]);
    }
  }

  // Totals row
  const totalsRow = values.length + 1;
  const totals = rows.reduce(
    (acc, r) => ({
      standardDays: Math.max(acc.standardDays, r.standardDays),
      actualDays: acc.actualDays + r.actualDays,
      lateHours: acc.lateHours + r.lateHours,
      earlyHours: acc.earlyHours + r.earlyHours,
      leaveUsed: acc.leaveUsed + r.leaveUsed,
      approvedOtHours: acc.approvedOtHours + r.approvedOtHours,
      absentDays: acc.absentDays + r.absentDays,
    }),
    { standardDays: 0, actualDays: 0, lateHours: 0, earlyHours: 0, leaveUsed: 0, approvedOtHours: 0, absentDays: 0 }
  );

  values.push([
    'TỔNG CỘNG', '', '',
    totals.standardDays,
    round2(totals.actualDays) || '',
    round2(totals.lateHours) || '',
    round2(totals.earlyHours) || '',
    round2(totals.leaveUsed) || '',
    '',
    round2(totals.approvedOtHours) || '',
    round2(totals.absentDays) || '',
  ]);

  return { values, titleRow, colHeaderRow, groupHeaders, dataRows, totalsRow };
}

// ─── Apply styling ───────────────────────────────────────────

async function applyStyles(
  sheets: ReturnType<typeof createSheetsClient>,
  token: string,
  sid: string,
  plan: SheetPlan,
  rows: RowData[]
): Promise<void> {
  const { range } = LarkSheetsClient;
  const { fontSize } = LarkSheetsClient;

  // Helper: single-row range across all cols
  const fullRow = (r: number) => range(sid, r, 0, r, COL_COUNT - 1);

  // 1. Title row: merge + dark header style
  await sheets.mergeCells(token, fullRow(plan.titleRow));
  await sheets.setStyle(token, fullRow(plan.titleRow), {
    bold: true, fontSize: fontSize(13), foreColor: C.headerText,
    backColor: C.headerDark, hAlign: 1, vAlign: 1,
    borderType: 'FULL_BORDER', borderColor: C.border,
  });

  // 2. Column header row
  await sheets.setStyle(token, fullRow(plan.colHeaderRow), {
    bold: true, fontSize: fontSize(9), foreColor: C.headerText,
    backColor: C.colHeader, hAlign: 1, vAlign: 1,
    borderType: 'FULL_BORDER', borderColor: C.border,
  });

  // 3. Group header rows (batch by key)
  // Batch: merge all group rows first
  for (const gh of plan.groupHeaders) {
    await sheets.mergeCells(token, fullRow(gh.row));
  }

  // Batch style all group headers in one call
  if (plan.groupHeaders.length > 0) {
    await sheets.setStyleBatch(token, plan.groupHeaders.map((gh) => ({
      range: fullRow(gh.row),
      style: {
        bold: true, fontSize: fontSize(9), foreColor: C.headerText,
        backColor: C.headerDark, hAlign: 0, vAlign: 1,
        borderType: 'FULL_BORDER', borderColor: C.border,
      },
    })));
  }

  // 4. Data rows — group into batches by style
  const rowMap = new Map(rows.map((r) => [r.code, r]));
  const batchItems: Array<{ range: string; style: Parameters<typeof sheets.setStyle>[2] }> = [];

  for (const dr of plan.dataRows) {
    const row = rowMap.get(dr.code);
    const groupKey = row?.groupKey ?? 'other';

    const bgColor = groupKey === 'expats' ? C.expats : groupKey === 'indirect' ? C.indirect : C.direct;

    // Base style for whole row
    batchItems.push({
      range: fullRow(dr.row),
      style: { fontSize: fontSize(9), backColor: bgColor, vAlign: 1, borderType: 'FULL_BORDER', borderColor: C.border },
    });

    // Center-align numeric columns (D–K = cols 3–10)
    batchItems.push({
      range: range(sid, dr.row, 3, dr.row, COL_COUNT - 1),
      style: { hAlign: 1 },
    });

    // STT column left-aligned
    batchItems.push({
      range: range(sid, dr.row, 0, dr.row, 0),
      style: { hAlign: 1, foreColor: '#666666' },
    });
  }

  if (batchItems.length > 0) {
    await sheets.setStyleBatch(token, batchItems);
  }

  // 5. Totals row
  await sheets.setStyle(token, fullRow(plan.totalsRow), {
    bold: true, fontSize: fontSize(9), backColor: C.totals, hAlign: 1, vAlign: 1,
    borderType: 'FULL_BORDER', borderColor: C.border,
  });

  // Center-align ALL numeric columns in totals
  await sheets.setStyle(token, range(sid, plan.totalsRow, 3, plan.totalsRow, COL_COUNT - 1), {
    hAlign: 1,
  });
}

// ─── Column widths & row heights ─────────────────────────────

async function setDimensions(
  sheets: ReturnType<typeof createSheetsClient>,
  token: string,
  sid: string,
  totalRows: number
): Promise<void> {
  // Column widths (A–K)
  const colWidths = [40, 200, 110, 80, 80, 70, 70, 90, 80, 70, 80];
  for (let i = 0; i < colWidths.length; i++) {
    await sheets.setColumnWidths(token, sid, i, i + 1, colWidths[i]);
  }

  // Row heights
  await sheets.setRowHeights(token, sid, 0, 1, 40);  // title row
  await sheets.setRowHeights(token, sid, 1, 2, 32);  // col header
  if (totalRows > 2) {
    await sheets.setRowHeights(token, sid, 2, totalRows, 26); // data rows
  }
}

// ─── Main export function ────────────────────────────────────

/**
 * Xuất hoặc cập nhật Lark Sheet tính công cho kỳ lương.
 * - Nếu chưa có → tạo mới trong folder TIMESHEET_FOLDER_TOKEN
 * - Nếu đã có → ghi đè data và re-apply styles
 */
export async function exportTimesheetToLark(periodId: string): Promise<{
  url: string;
  spreadsheetToken: string;
  isNew: boolean;
}> {
  console.log(`${MODULE} Bắt đầu export kỳ ${periodId}`);

  const { period, rows } = await fetchData(periodId);
  const plan = buildSheetPlan(period, rows);
  const sheets = createSheetsClient();

  // ── Determine if creating new or updating ────────────────
  const existing = await prisma.payrollPeriod.findUnique({
    where: { id: periodId },
    select: { larkSheetToken: true, larkSheetUrl: true },
  });

  let spreadsheetToken = existing?.larkSheetToken ?? '';
  let sheetId = '';
  let isNew = false;

  if (spreadsheetToken) {
    // Try to get existing sheet's sheetId
    try {
      const meta = await sheets.getMetainfo(spreadsheetToken);
      const tab = meta.sheets.find((s) => s.title === SHEET_TAB_NAME) ?? meta.sheets[0];
      if (tab) {
        sheetId = tab.sheetId;
        console.log(`${MODULE} Cập nhật sheet hiện tại: ${spreadsheetToken}, sheetId: ${sheetId}`);
      } else {
        spreadsheetToken = ''; // force recreate
      }
    } catch {
      console.warn(`${MODULE} Sheet cũ không truy cập được, tạo mới`);
      spreadsheetToken = '';
    }
  }

  if (!spreadsheetToken || !sheetId) {
    // Create new spreadsheet
    const title = `Tính công ${period.label} - Asnova`;
    const created = await sheets.createSpreadsheet(title, TIMESHEET_FOLDER_TOKEN);
    spreadsheetToken = created.spreadsheetToken;
    isNew = true;
    console.log(`${MODULE} Tạo spreadsheet mới: ${created.url}`);

    // Get default sheet ID
    const meta = await sheets.getMetainfo(spreadsheetToken);
    const firstSheet = meta.sheets[0];
    if (!firstSheet) throw new Error('Không tìm thấy sheet trong spreadsheet mới tạo');
    sheetId = firstSheet.sheetId;

    // Rename tab + freeze first 2 rows
    await sheets.updateSheet(spreadsheetToken, sheetId, {
      title: SHEET_TAB_NAME,
      frozenRowCount: 2,
    });
  }

  // ── Write all data ────────────────────────────────────────
  const rangeAll = LarkSheetsClient.range(sheetId, 1, 0, plan.values.length, COL_COUNT - 1);
  await sheets.writeValues(spreadsheetToken, rangeAll, plan.values);
  console.log(`${MODULE} Đã ghi ${plan.values.length} hàng`);

  // ── Apply formatting ──────────────────────────────────────
  await applyStyles(sheets, spreadsheetToken, sheetId, plan, rows);
  console.log(`${MODULE} Đã format sheet`);

  // ── Set column widths & row heights ──────────────────────
  await setDimensions(sheets, spreadsheetToken, sheetId, plan.values.length);
  console.log(`${MODULE} Đã set dimensions`);

  // ── Save URL to DB ────────────────────────────────────────
  const sheetUrl = existing?.larkSheetUrl
    ?? `https://tsg3y8y89y0w.sg.larksuite.com/sheets/${spreadsheetToken}`;

  await prisma.payrollPeriod.update({
    where: { id: periodId },
    data: { larkSheetUrl: sheetUrl, larkSheetToken: spreadsheetToken },
  });

  console.log(`${MODULE} Hoàn thành! URL: ${sheetUrl}`);
  return { url: sheetUrl, spreadsheetToken, isNew };
}
