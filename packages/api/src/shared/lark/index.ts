/**
 * Lark API — Module Index
 * Re-export tất cả Lark clients và factory function
 */

// ─── Types ──────────────────────────────────────────────────

export type {
  LarkApiResponse,
  LarkPagination,
  LarkFieldValue,
  LarkRecordFields,
  LarkRecord,
  LarkField,
  LarkListFieldsResponse,
  LarkFilterCondition,
  LarkFilter,
  LarkListRecordsResponse,
  LarkBatchCreateResponse,
  LarkGetRecordResponse,
  AttendanceFlowRecord,
  AttendanceFlowQueryResponse,
  AttendanceTask,
  AttendanceCheckResult,
  AttendanceTaskResponse,
  ApprovalFormValue,
  ApprovalInstance,
  ApprovalListResponse,
  ApprovalInstanceResponse,
  ImSendMessageResponse,
} from './types.js';

export { LarkApiError } from './types.js';

// ─── Config ─────────────────────────────────────────────────

export {
  LARK_BASE_URL,
  TABLE_IDS,
  READ_ONLY_FIELD_TYPES,
  getLarkConfig,
} from './config.js';

export type { LarkConfig, TableId } from './config.js';

// ─── Auth ───────────────────────────────────────────────────

export { getTenantToken, clearTokenCache } from './auth.js';

// ─── Clients ────────────────────────────────────────────────

export { LarkClient } from './client.js';
export { LarkBaseClient } from './base.js';
export { LarkAttendanceClient } from './attendance.js';
export { LarkApprovalClient } from './approval.js';
export { LarkImClient } from './im.js';

// ─── Factory ────────────────────────────────────────────────

import type { LarkConfig } from './config.js';
import { getLarkConfig } from './config.js';
import { LarkBaseClient } from './base.js';
import { LarkAttendanceClient } from './attendance.js';
import { LarkApprovalClient } from './approval.js';
import { LarkImClient } from './im.js';

/** Kết quả từ createLarkClients */
export interface LarkClients {
  base: LarkBaseClient;
  attendance: LarkAttendanceClient;
  approval: LarkApprovalClient;
  im: LarkImClient;
}

/**
 * Factory function — tạo tất cả Lark clients từ 1 config
 * Nếu không truyền config, tự đọc từ env
 *
 * @example
 * const lark = createLarkClients();
 * const records = await lark.base.listAllRecords(TABLE_IDS.HR);
 * await lark.im.sendText(openId, 'Xin chào!');
 */
export function createLarkClients(config?: LarkConfig): LarkClients {
  const cfg = config ?? getLarkConfig();

  return {
    base: new LarkBaseClient(cfg),
    attendance: new LarkAttendanceClient(cfg),
    approval: new LarkApprovalClient(cfg),
    im: new LarkImClient(cfg),
  };
}
