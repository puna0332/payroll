/**
 * Lark Bitable (Base) — CRUD Client
 * Quản lý records trong Lark Base: list, search, create, update, delete
 * Auto-pagination, batch chunking (max 500), filter writable fields
 */

import { LarkClient } from './client.js';
import { type LarkConfig } from './config.js';
import type {
  LarkRecord,
  LarkRecordFields,
  LarkFilter,
  LarkListRecordsResponse,
  LarkListFieldsResponse,
  LarkBatchCreateResponse,
  LarkGetRecordResponse,
  LarkField,
} from './types.js';

// ─── Batch Limits ───────────────────────────────────────────

/** Lark API giới hạn 500 records mỗi lần batch */
const MAX_BATCH_SIZE = 500;

/** Page size mặc định khi list records */
const DEFAULT_PAGE_SIZE = 500;

// ─── Utilities ──────────────────────────────────────────────

/**
 * Chia mảng thành các chunk nhỏ
 */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// ─── LarkBaseClient ─────────────────────────────────────────

export class LarkBaseClient extends LarkClient {
  private readonly appToken: string;

  constructor(config: LarkConfig) {
    super(config);
    this.appToken = config.appToken;
  }

  // ── List All Records (auto-pagination) ──────────────────

  /**
   * Lấy tất cả records trong table, tự động phân trang
   * Dùng page_token loop cho đến khi has_more === false
   *
   * @param tableId - ID của table trong Base
   * @param filter - Bộ lọc (optional)
   */
  async listAllRecords(
    tableId: string,
    filter?: LarkFilter,
  ): Promise<LarkRecord[]> {
    console.log(`[Lark:Base] Đang lấy tất cả records từ table ${tableId}...`);

    const allRecords: LarkRecord[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;

    do {
      const queryParams: Record<string, string> = {
        page_size: String(DEFAULT_PAGE_SIZE),
      };
      if (pageToken) {
        queryParams.page_token = pageToken;
      }

      // Nếu có filter, encode vào query
      if (filter) {
        queryParams.filter = JSON.stringify(filter);
      }

      const data = await this.request<LarkListRecordsResponse>(
        'GET',
        `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records`,
        undefined,
        queryParams,
      );

      if (data.items && data.items.length > 0) {
        allRecords.push(...data.items);
      }

      pageToken = data.has_more ? data.page_token : undefined;
      pageCount++;

      console.log(
        `[Lark:Base] Trang ${pageCount}: ${data.items?.length ?? 0} records (tổng: ${allRecords.length})`,
      );
    } while (pageToken);

    console.log(
      `[Lark:Base] Hoàn tất: ${allRecords.length} records từ ${pageCount} trang`,
    );

    return allRecords;
  }

  // ── Search Records (with filter) ─────────────────────────

  /**
   * Tìm kiếm records theo filter
   * Dùng search endpoint với POST body
   *
   * @param tableId - ID table
   * @param filter - Bộ lọc bắt buộc
   * @param pageSize - Số records mỗi trang (default 500)
   */
  async searchRecords(
    tableId: string,
    filter: LarkFilter,
    pageSize: number = DEFAULT_PAGE_SIZE,
  ): Promise<LarkRecord[]> {
    console.log(
      `[Lark:Base] Tìm kiếm records trong table ${tableId}...`,
    );

    const allRecords: LarkRecord[] = [];
    let pageToken: string | undefined;

    do {
      const body: Record<string, unknown> = {
        filter,
        page_size: Math.min(pageSize, MAX_BATCH_SIZE),
      };
      if (pageToken) {
        body.page_token = pageToken;
      }

      const data = await this.request<LarkListRecordsResponse>(
        'POST',
        `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/search`,
        body,
      );

      if (data.items && data.items.length > 0) {
        allRecords.push(...data.items);
      }

      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);

    console.log(`[Lark:Base] Tìm thấy ${allRecords.length} records`);

    return allRecords;
  }

  // ── Get Single Record ────────────────────────────────────

  /**
   * Lấy 1 bản ghi theo record_id
   */
  async getRecord(
    tableId: string,
    recordId: string,
  ): Promise<LarkRecord> {
    console.log(`[Lark:Base] Lấy record ${recordId} từ table ${tableId}`);

    const data = await this.request<LarkGetRecordResponse>(
      'GET',
      `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/${recordId}`,
    );

    return data.record;
  }

  // ── List Fields (auto-pagination) ────────────────────────

  /**
   * Lấy field schema của một table.
   * Dùng trước outbound sync để chỉ ghi field tồn tại và bỏ qua Formula/Lookup/Auto fields.
   */
  async listAllFields(tableId: string): Promise<LarkField[]> {
    console.log(`[Lark:Base] Đang lấy field schema từ table ${tableId}...`);

    const allFields: LarkField[] = [];
    let pageToken: string | undefined;

    do {
      const queryParams: Record<string, string> = {
        page_size: '100',
      };
      if (pageToken) {
        queryParams.page_token = pageToken;
      }

      const data = await this.request<LarkListFieldsResponse>(
        'GET',
        `/bitable/v1/apps/${this.appToken}/tables/${tableId}/fields`,
        undefined,
        queryParams,
      );

      if (data.items && data.items.length > 0) {
        allFields.push(...data.items);
      }

      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);

    console.log(`[Lark:Base] Field schema: ${allFields.length} fields`);
    return allFields;
  }

  // ── Batch Create ─────────────────────────────────────────

  /**
   * Tạo records theo batch (max 500 records/lần)
   * Tự động chia thành nhiều chunk nếu vượt quá giới hạn
   *
   * @param tableId - ID table
   * @param records - Danh sách fields cần tạo
   * @returns Records đã tạo (có record_id)
   */
  async batchCreate(
    tableId: string,
    records: LarkRecordFields[],
  ): Promise<LarkRecord[]> {
    console.log(
      `[Lark:Base] Batch create ${records.length} records vào table ${tableId}`,
    );

    const chunks = chunk(records, MAX_BATCH_SIZE);
    const allCreated: LarkRecord[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const batch = chunks[i];
      console.log(
        `[Lark:Base] Chunk ${i + 1}/${chunks.length}: ${batch.length} records`,
      );

      const body = {
        records: batch.map((fields) => ({ fields })),
      };

      const data = await this.request<LarkBatchCreateResponse>(
        'POST',
        `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/batch_create`,
        body,
      );

      if (data.records) {
        allCreated.push(...data.records);
      }
    }

    console.log(`[Lark:Base] Đã tạo ${allCreated.length} records`);

    return allCreated;
  }

  // ── Batch Update ─────────────────────────────────────────

  /**
   * Cập nhật records theo batch (max 500 records/lần)
   *
   * @param tableId - ID table
   * @param records - Danh sách { record_id, fields } cần update
   */
  async batchUpdate(
    tableId: string,
    records: { record_id: string; fields: LarkRecordFields }[],
  ): Promise<void> {
    console.log(
      `[Lark:Base] Batch update ${records.length} records trong table ${tableId}`,
    );

    const chunks = chunk(records, MAX_BATCH_SIZE);

    for (let i = 0; i < chunks.length; i++) {
      const batch = chunks[i];
      console.log(
        `[Lark:Base] Update chunk ${i + 1}/${chunks.length}: ${batch.length} records`,
      );

      const body = { records: batch };

      await this.request<unknown>(
        'POST',
        `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/batch_update`,
        body,
      );
    }

    console.log(`[Lark:Base] Đã cập nhật ${records.length} records`);
  }

  // ── Batch Delete ─────────────────────────────────────────

  /**
   * Xóa records theo batch (max 500 records/lần)
   *
   * @param tableId - ID table
   * @param recordIds - Danh sách record_id cần xóa
   */
  async batchDelete(
    tableId: string,
    recordIds: string[],
  ): Promise<void> {
    console.log(
      `[Lark:Base] Batch delete ${recordIds.length} records từ table ${tableId}`,
    );

    const chunks = chunk(recordIds, MAX_BATCH_SIZE);

    for (let i = 0; i < chunks.length; i++) {
      const batch = chunks[i];
      console.log(
        `[Lark:Base] Delete chunk ${i + 1}/${chunks.length}: ${batch.length} records`,
      );

      const body = { records: batch };

      await this.request<unknown>(
        'POST',
        `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/batch_delete`,
        body,
      );
    }

    console.log(`[Lark:Base] Đã xóa ${recordIds.length} records`);
  }

  // ── Filter Writable Fields ───────────────────────────────

  /**
   * Lọc bỏ các field chỉ đọc (formula, lookup, auto, created/modified time)
   * Dùng trước khi create/update để tránh lỗi API
   *
   * @param fields - Object fields gốc
   * @param readOnlyFieldNames - Set chứa tên các field chỉ đọc
   * @returns Fields chỉ chứa các field có thể ghi
   */
  filterWritableFields(
    fields: LarkRecordFields,
    readOnlyFieldNames: Set<string>,
  ): LarkRecordFields {
    const writable: LarkRecordFields = {};

    for (const [key, value] of Object.entries(fields)) {
      if (!readOnlyFieldNames.has(key)) {
        writable[key] = value;
      }
    }

    return writable;
  }
}
