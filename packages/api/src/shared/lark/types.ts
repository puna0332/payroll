/**
 * Lark API — Type definitions
 * Định nghĩa kiểu dữ liệu cho các API Lark: Bitable, Attendance, Approval, IM
 */

// ─── Chung / Common ─────────────────────────────────────────

/** Response chuẩn từ tất cả Lark API */
export interface LarkApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

/** Thông tin phân trang */
export interface LarkPagination {
  page_token?: string;
  page_size?: number;
  has_more?: boolean;
  total?: number;
}

// ─── Lark API Error ─────────────────────────────────────────

export class LarkApiError extends Error {
  constructor(
    public readonly code: number,
    public readonly larkMsg: string,
    public readonly path: string,
  ) {
    super(`[LarkApiError] code=${code} msg="${larkMsg}" path="${path}"`);
    this.name = 'LarkApiError';
  }
}

// ─── Bitable / Base ─────────────────────────────────────────

/** Giá trị field có thể là nhiều kiểu khác nhau */
export type LarkFieldValue =
  | string
  | number
  | boolean
  | null
  | LarkFieldValue[]
  | { text?: string; link?: string; type?: string; [key: string]: unknown };

/** Record fields — key-value map */
export type LarkRecordFields = Record<string, LarkFieldValue>;

/** Một bản ghi trong Lark Base */
export interface LarkRecord {
  record_id: string;
  fields: LarkRecordFields;
}

/** Field metadata returned by Base list-fields API */
export interface LarkField {
  field_id: string;
  field_name: string;
  type: number;
  ui_type?: string;
  is_primary?: boolean;
  is_hidden?: boolean;
  property?: unknown;
}

/** Response từ list fields API */
export interface LarkListFieldsResponse {
  items: LarkField[];
  page_token?: string;
  has_more: boolean;
  total: number;
}

/** Điều kiện lọc đơn */
export interface LarkFilterCondition {
  field_name: string;
  operator:
    | 'is'
    | 'isNot'
    | 'contains'
    | 'doesNotContain'
    | 'isEmpty'
    | 'isNotEmpty'
    | 'isGreater'
    | 'isGreaterEqual'
    | 'isLess'
    | 'isLessEqual';
  value: string[];
}

/** Bộ lọc — filter object gửi lên API */
export interface LarkFilter {
  conjunction?: 'and' | 'or';
  conditions: LarkFilterCondition[];
}

/** Response từ list records API */
export interface LarkListRecordsResponse {
  items: LarkRecord[];
  page_token?: string;
  has_more: boolean;
  total: number;
}

/** Response từ batch create API */
export interface LarkBatchCreateResponse {
  records: LarkRecord[];
}

/** Response từ get single record API */
export interface LarkGetRecordResponse {
  record: LarkRecord;
}

// ─── Attendance / Chấm công ─────────────────────────────────

/** Bản ghi chấm công flow (check-in/check-out) */
export interface AttendanceFlowRecord {
  user_id: string;
  creator_id: string;
  location_name: string;
  check_time: string;
  comment: string;
  record_id?: string;
  longitude?: number;
  latitude?: number;
  ssid?: string;
  bssid?: string;
  is_field?: boolean;
  is_wifi?: boolean;
  type?: number; // 1=check_in, 2=check_out
}

/** Response data từ user_flows/query API */
export interface AttendanceFlowQueryResponse {
  user_flow_results: AttendanceFlowRecord[];
}

/** Task chấm công (ca làm việc, schedule) — from user_tasks/query API */
export interface AttendanceTask {
  result_id?: string;
  user_id: string;
  employee_name?: string;
  day: number; // YYYYMMDD integer (API field name is 'day')
  group_id?: string;
  shift_id?: string;
  shift_name?: string;
  records?: AttendanceTaskRecord[];
}

/** Bản ghi task — mỗi ca có check-in và check-out */
export interface AttendanceTaskRecord {
  check_in_record_id?: string;
  check_in_record?: AttendanceFlowRecord;
  check_out_record_id?: string;
  check_out_record?: AttendanceFlowRecord;
  check_in_result?: string; // 'Normal' | 'Late' | 'Early' | 'Lack' | 'NoNeedCheck' | 'SystemCheck'
  check_out_result?: string;
  check_in_result_supplement?: string;
  check_out_result_supplement?: string;
  check_in_shift_time?: string;
  check_out_shift_time?: string;
}

/** Kết quả check-in/check-out (legacy — kept for backward compat) */
export interface AttendanceCheckResult {
  check_time?: string;
  is_field?: boolean;
  result?: string;
}

// ─── Shift / Ca làm việc ────────────────────────────────────

/** Shift punch time rule */
export interface ShiftPunchTimeRule {
  on_time: string;       // e.g. '9:00'
  off_time: string;      // e.g. '18:00'
  late_minutes_as_late?: number;
  late_minutes_as_lack?: number;
  on_advance_minutes?: number;
  early_minutes_as_early?: number;
  early_minutes_as_lack?: number;
  off_delay_minutes?: number;
}

/** Shift rest time rule */
export interface ShiftRestTimeRule {
  rest_begin_time: string;
  rest_end_time: string;
}

/** Shift detail from GET /attendance/v1/shifts/:shift_id */
export interface LarkShiftDetail {
  shift_id: string;
  shift_name: string;
  punch_times: number;
  is_flexible?: boolean;
  flexible_minutes?: number;
  no_need_off?: boolean;
  punch_time_rule?: ShiftPunchTimeRule[];
  rest_time_rule?: ShiftRestTimeRule[];
}

/** Response from shift detail API */
export interface ShiftDetailResponse {
  shift: LarkShiftDetail;
}

/** Response from shift query API */
export interface ShiftQueryResponse {
  shift_list?: LarkShiftDetail[];
}

/** Response data từ user_tasks API */
export interface AttendanceTaskResponse {
  user_task_results: AttendanceTask[];
  invalid_user_ids?: string[];
  unauthorized_user_ids?: string[];
}

// ─── Approval / Phê duyệt ──────────────────────────────────

/** Form value trong approval instance */
export interface ApprovalFormValue {
  id: string;
  type: string;
  value: string;
  name?: string;
  ext?: unknown;
}

/** Chi tiết một approval instance */
export interface ApprovalInstance {
  approval_code: string;
  approval_name?: string;
  instance_code: string;
  user_id: string;
  open_id?: string;
  department_id?: string;
  serial_number?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED' | 'DELETED';
  form: ApprovalFormValue[] | string;
  start_time: string;
  end_time: string;
  uuid?: string;
  task_list?: unknown[];
  comment_list?: unknown[];
  timeline?: unknown[];
}

/** Response từ list instances API */
export interface ApprovalListResponse {
  instance_code_list: string[];
  page_token?: string;
  has_more: boolean;
}

/** Response từ get instance detail API */
export interface ApprovalInstanceResponse {
  instance: ApprovalInstance;
}

// ─── IM / Tin nhắn ──────────────────────────────────────────

/** Response từ send message API */
export interface ImSendMessageResponse {
  message_id: string;
}
