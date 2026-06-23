/**
 * Lark Sheets API — Spreadsheet & Worksheet operations
 * Hỗ trợ: tạo spreadsheet, ghi dữ liệu, định dạng ô, freeze row
 *
 * Docs format fontSize: "10pt/1.5" (not a number!)
 * Batch style: { data: [{ ranges: string[], style: {...} }] }
 */

import { LarkClient } from './client.js';
import type { LarkConfig } from './config.js';
import { getTenantToken } from './auth.js';

// ─── Types ──────────────────────────────────────────────────

export interface SpreadsheetMeta {
  spreadsheetToken: string;
  url: string;
  title: string;
}

export interface SheetInfo {
  sheetId: string;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}

export type CellValue = string | number | boolean | null;

/** fontSize as "10pt/1.5" string (Lark API format) */
export interface StyleSpec {
  bold?: boolean;
  italic?: boolean;
  fontSize?: string;    // e.g. "10pt/1.5", "12pt/1.5", "9pt/1.5"
  foreColor?: string;   // hex e.g. "#FFFFFF"
  backColor?: string;   // hex e.g. "#1F4E79"
  hAlign?: 0 | 1 | 2;  // 0=left 1=center 2=right
  vAlign?: 0 | 1 | 2;  // 0=top 1=center 2=bottom
  borderType?: 'FULL_BORDER' | 'OUTER_BORDER' | 'INNER_BORDER' | 'NO_BORDER';
  borderColor?: string;
}

// Build Lark-compatible style object from StyleSpec
function buildStyleObj(style: StyleSpec): Record<string, unknown> {
  const font: Record<string, unknown> = {};
  if (style.bold !== undefined) font.bold = style.bold;
  if (style.italic !== undefined) font.italic = style.italic;
  if (style.fontSize !== undefined) font.fontSize = style.fontSize; // "10pt/1.5"

  const styleObj: Record<string, unknown> = {};
  if (Object.keys(font).length > 0) styleObj.font = font;
  if (style.backColor !== undefined) styleObj.backColor = style.backColor;
  if (style.foreColor !== undefined) styleObj.foreColor = style.foreColor;
  if (style.hAlign !== undefined) styleObj.hAlign = style.hAlign;
  if (style.vAlign !== undefined) styleObj.vAlign = style.vAlign;
  if (style.borderType !== undefined) {
    styleObj.borderType = style.borderType;
    if (style.borderColor) styleObj.borderColor = style.borderColor;
  }
  return styleObj;
}

// ─── LarkSheetsClient ───────────────────────────────────────

export class LarkSheetsClient extends LarkClient {
  constructor(config: LarkConfig) {
    super(config);
  }

  /** Column index (0-based) → Excel-style letter. 0→A, 25→Z, 26→AA */
  static colLetter(idx: number): string {
    let letter = '';
    let n = idx;
    while (n >= 0) {
      letter = String.fromCharCode(65 + (n % 26)) + letter;
      n = Math.floor(n / 26) - 1;
    }
    return letter;
  }

  /** Build range string: "sheetId!A1:D5" */
  static range(sheetId: string, startRow: number, startCol: number, endRow: number, endCol: number): string {
    return `${sheetId}!${LarkSheetsClient.colLetter(startCol)}${startRow}:${LarkSheetsClient.colLetter(endCol)}${endRow}`;
  }

  /** fontSize helper: number → "Npt/1.5" */
  static fontSize(pt: number): string {
    return `${pt}pt/1.5`;
  }

  // ── Spreadsheet ──────────────────────────────────────────

  /**
   * Tạo spreadsheet mới trong folder chỉ định
   * POST /open-apis/sheets/v3/spreadsheets
   */
  async createSpreadsheet(title: string, folderToken: string): Promise<SpreadsheetMeta> {
    const result = await this.request<{
      spreadsheet: {
        spreadsheet_token: string;
        url: string;
        title: string;
      };
    }>('POST', '/sheets/v3/spreadsheets', {
      title,
      folder_token: folderToken,
    });

    return {
      spreadsheetToken: result.spreadsheet.spreadsheet_token,
      url: result.spreadsheet.url,
      title: result.spreadsheet.title,
    };
  }

  /**
   * Copy an existing spreadsheet file into a folder.
   * POST /open-apis/drive/v1/files/:file_token/copy
   */
  async copySpreadsheet(
    sourceSpreadsheetToken: string,
    title: string,
    folderToken: string,
  ): Promise<SpreadsheetMeta> {
    const result = await this.request<{
      file: {
        token: string;
        url: string;
        name: string;
      };
    }>('POST', `/drive/v1/files/${sourceSpreadsheetToken}/copy`, {
      name: title,
      type: 'sheet',
      folder_token: folderToken,
    });

    return {
      spreadsheetToken: result.file.token,
      url: result.file.url,
      title: result.file.name,
    };
  }

  /**
   * Lấy metadata và danh sách sheets
   * GET /open-apis/sheets/v2/spreadsheets/:token/metainfo
   */
  async getMetainfo(spreadsheetToken: string): Promise<{
    title: string;
    sheets: SheetInfo[];
  }> {
    const result = await this.request<{
      spreadsheetToken: string;
      title: string;
      sheets: Array<{
        sheetId: string;
        title: string;
        index: number;
        rowCount: number;
        columnCount: number;
      }>;
    }>('GET', `/sheets/v2/spreadsheets/${spreadsheetToken}/metainfo`);

    return {
      title: result.title,
      sheets: (result.sheets ?? []).map((s) => ({
        sheetId: s.sheetId,
        title: s.title,
        index: s.index,
        rowCount: s.rowCount,
        columnCount: s.columnCount,
      })),
    };
  }

  // ── Worksheet operations ─────────────────────────────────

  /**
   * Rename sheet tab và/hoặc freeze rows
   * POST /open-apis/sheets/v2/spreadsheets/:token/sheets_batch_update
   */
  async updateSheet(
    spreadsheetToken: string,
    sheetId: string,
    opts: {
      title?: string;
      frozenRowCount?: number;
      frozenColCount?: number;
    }
  ): Promise<void> {
    const requests: Array<Record<string, unknown>> = [];

    if (opts.title !== undefined) {
      requests.push({
        updateSheet: {
          properties: { sheetId, title: opts.title },
        },
      });
    }

    if (opts.frozenRowCount !== undefined || opts.frozenColCount !== undefined) {
      requests.push({
        updateSheet: {
          properties: {
            sheetId,
            frozenRowCount: opts.frozenRowCount ?? 0,
            frozenColCount: opts.frozenColCount ?? 0,
          },
        },
      });
    }

    if (requests.length === 0) return;

    await this.request(
      'POST',
      `/sheets/v2/spreadsheets/${spreadsheetToken}/sheets_batch_update`,
      { requests }
    );
  }

  // ── Data ─────────────────────────────────────────────────

  /**
   * Ghi dữ liệu vào một range
   * PUT /open-apis/sheets/v2/spreadsheets/:token/values
   */
  async writeValues(
    spreadsheetToken: string,
    range: string,
    values: CellValue[][]
  ): Promise<void> {
    await this.request(
      'PUT',
      `/sheets/v2/spreadsheets/${spreadsheetToken}/values`,
      { valueRange: { range, values } }
    );
  }

  // ── Styling ──────────────────────────────────────────────

  /**
   * Set style cho 1 range
   * PUT /open-apis/sheets/v2/spreadsheets/:token/style
   * Body: { appendStyle: { range, style } }
   */
  async setStyle(
    spreadsheetToken: string,
    range: string,
    style: StyleSpec
  ): Promise<void> {
    await this.request(
      'PUT',
      `/sheets/v2/spreadsheets/${spreadsheetToken}/style`,
      {
        appendStyle: {
          range,
          style: buildStyleObj(style),
        },
      }
    );
  }

  /**
   * Batch set styles — nhiều (ranges[], style) trong 1 request
   * PUT /open-apis/sheets/v2/spreadsheets/:token/styles_batch_update
   * Body: { data: [{ ranges: string[], style: {...} }] }
   *
   * Note: groups multiple ranges that share the SAME style into 1 entry.
   * To reduce API calls, group ranges by style hash.
   */
  async setStyleBatch(
    spreadsheetToken: string,
    items: Array<{ range: string; style: StyleSpec }>
  ): Promise<void> {
    if (items.length === 0) return;

    // Group ranges by style signature to minimize batch entries
    const styleMap = new Map<string, { ranges: string[]; styleObj: Record<string, unknown> }>();

    for (const { range, style } of items) {
      const key = JSON.stringify(style);
      const existing = styleMap.get(key);
      if (existing) {
        existing.ranges.push(range);
      } else {
        styleMap.set(key, { ranges: [range], styleObj: buildStyleObj(style) });
      }
    }

    const data = Array.from(styleMap.values()).map(({ ranges, styleObj }) => ({
      ranges,
      style: styleObj,
    }));

    await this.request(
      'PUT',
      `/sheets/v2/spreadsheets/${spreadsheetToken}/styles_batch_update`,
      { data }
    );
  }

  // ── Column / Row Dimensions ──────────────────────────────

  /**
   * Set column widths
   * PUT /open-apis/sheets/v2/spreadsheets/:token/dimension_range
   * startIndex/endIndex are 1-based in Lark API
   * We accept 0-based externally and convert internally.
   */
  async setColumnWidths(
    spreadsheetToken: string,
    sheetId: string,
    startColIdx: number,  // 0-based inclusive → will +1
    endColIdx: number,    // 0-based exclusive
    pixelWidth: number
  ): Promise<void> {
    await this.request(
      'PUT',
      `/sheets/v2/spreadsheets/${spreadsheetToken}/dimension_range`,
      {
        dimension: {
          sheetId,
          majorDimension: 'COLUMNS',
          startIndex: startColIdx + 1,  // Lark is 1-based
          endIndex: endColIdx,          // exclusive, so endColIdx is correct
        },
        dimensionProperties: {
          fixedSize: pixelWidth,        // Lark uses fixedSize not pixelSize
        },
      }
    );
  }

  /**
   * Set row heights
   * startIndex/endIndex are 1-based in Lark API
   */
  async setRowHeights(
    spreadsheetToken: string,
    sheetId: string,
    startRowIdx: number,  // 0-based inclusive
    endRowIdx: number,    // 0-based exclusive
    pixelHeight: number
  ): Promise<void> {
    await this.request(
      'PUT',
      `/sheets/v2/spreadsheets/${spreadsheetToken}/dimension_range`,
      {
        dimension: {
          sheetId,
          majorDimension: 'ROWS',
          startIndex: startRowIdx + 1,  // Lark is 1-based
          endIndex: endRowIdx,          // exclusive → correct
        },
        dimensionProperties: {
          fixedSize: pixelHeight,
        },
      }
    );
  }

  // ── Merge Cells ──────────────────────────────────────────

  /**
   * Merge cells
   * POST /open-apis/sheets/v2/spreadsheets/:token/merge_cells
   */
  async mergeCells(
    spreadsheetToken: string,
    range: string,
    mergeType: 'MERGE_ALL' | 'MERGE_ROWS' | 'MERGE_COLUMNS' = 'MERGE_ALL'
  ): Promise<void> {
    await this.request(
      'POST',
      `/sheets/v2/spreadsheets/${spreadsheetToken}/merge_cells`,
      { range, mergeType }
    );
  }
}

// ─── Factory ────────────────────────────────────────────────

import { getLarkConfig } from './config.js';

export function createSheetsClient(config?: LarkConfig): LarkSheetsClient {
  return new LarkSheetsClient(config ?? getLarkConfig());
}
