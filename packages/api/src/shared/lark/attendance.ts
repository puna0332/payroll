/**
 * Lark Attendance API — Client chấm công
 * Query attendance flows và user tasks
 * Batch tối đa 50 user_ids/request
 */

import { LarkClient } from './client.js';
import type {
  AttendanceFlowRecord,
  AttendanceFlowQueryResponse,
  AttendanceTask,
  AttendanceTaskResponse,
  LarkShiftDetail,
  ShiftDetailResponse,
  ShiftQueryResponse,
} from './types.js';

// ─── Limits ─────────────────────────────────────────────────

/** Lark attendance API giới hạn 50 users/request */
const MAX_USERS_PER_BATCH = 50;

// ─── Utilities ──────────────────────────────────────────────

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// ─── LarkAttendanceClient ───────────────────────────────────

export class LarkAttendanceClient extends LarkClient {
  /**
   * Truy vấn attendance flows (check-in/check-out) cho danh sách users
   * Tự động chia batch nếu > 50 users
   *
   * @param userIds - Danh sách employee_id hoặc user_id
   * @param startDate - Ngày bắt đầu (YYYYMMDD, ví dụ: '20260501')
   * @param endDate - Ngày kết thúc (YYYYMMDD, ví dụ: '20260531')
   * @returns Tất cả attendance flows
   */
  async queryUserFlows(
    userIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<AttendanceFlowRecord[]> {
    console.log(
      `[Lark:Attendance] Query flows cho ${userIds.length} users từ ${startDate} đến ${endDate}`,
    );

    const userChunks = chunk(userIds, MAX_USERS_PER_BATCH);
    const allFlows: AttendanceFlowRecord[] = [];

    for (let i = 0; i < userChunks.length; i++) {
      const batch = userChunks[i];
      console.log(
        `[Lark:Attendance] Batch ${i + 1}/${userChunks.length}: ${batch.length} users`,
      );

      const queryParams: Record<string, string> = {
        employee_type: 'employee_id',
      };

      // Lark API requires Unix timestamps (seconds) for check_time_from/check_time_to
      const fromTs = Math.floor(new Date(startDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') + 'T00:00:00+07:00').getTime() / 1000);
      const toTs = Math.floor(new Date(endDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') + 'T23:59:59+07:00').getTime() / 1000);

      const body = {
        user_ids: batch,
        check_time_from: String(fromTs),
        check_time_to: String(toTs),
        include_terminated_user: true,
      };

      const data = await this.request<AttendanceFlowQueryResponse>(
        'POST',
        '/attendance/v1/user_flows/query',
        body,
        queryParams,
      );

      if (data.user_flow_results && data.user_flow_results.length > 0) {
        allFlows.push(...data.user_flow_results);
      }
    }

    console.log(
      `[Lark:Attendance] Hoàn tất: ${allFlows.length} user flow results`,
    );

    return allFlows;
  }

  /**
   * Lấy attendance tasks (ca làm việc / schedules) cho danh sách users
   * Tự động chia batch nếu > 50 users
   *
   * @param userIds - Danh sách employee_id
   * @param startDate - Ngày bắt đầu (YYYYMMDD)
   * @param endDate - Ngày kết thúc (YYYYMMDD)
   * @returns Tất cả attendance tasks
   */
  async getUserTasks(
    userIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<AttendanceTask[]> {
    console.log(
      `[Lark:Attendance] Query tasks cho ${userIds.length} users từ ${startDate} đến ${endDate}`,
    );

    // Lark API limits to 30-day intervals — split into date chunks
    const dateChunks = chunkDateRange(startDate, endDate, 30);
    const userChunks = chunk(userIds, MAX_USERS_PER_BATCH);
    const allTasks: AttendanceTask[] = [];

    for (const [chunkStart, chunkEnd] of dateChunks) {
      for (let i = 0; i < userChunks.length; i++) {
        const batch = userChunks[i];
        console.log(
          `[Lark:Attendance] Tasks batch ${i + 1}/${userChunks.length}: ${batch.length} users, ${chunkStart}→${chunkEnd}`,
        );

        const queryParams: Record<string, string> = {
          employee_type: 'employee_id',
          ignore_invalid_users: 'true',
          include_terminated_user: 'true',
        };

        // user_tasks API uses integer dates: YYYYMMDD format
        const fromInt = parseInt(chunkStart.replace(/-/g, ''), 10);
        const toInt = parseInt(chunkEnd.replace(/-/g, ''), 10);

        const body = {
          user_ids: batch,
          check_date_from: fromInt,
          check_date_to: toInt,
        };

        const data = await this.request<AttendanceTaskResponse>(
          'POST',
          '/attendance/v1/user_tasks/query',
          body,
          queryParams,
        );

        if (data.user_task_results && data.user_task_results.length > 0) {
          allTasks.push(...data.user_task_results);
        }
      }
    }

    console.log(
      `[Lark:Attendance] Hoàn tất: ${allTasks.length} task results (${dateChunks.length} date chunk(s))`,
    );

    return allTasks;
  }

  /**
   * Get shift detail by shift_id
   * GET /attendance/v1/shifts/:shift_id
   */
  async getShiftDetail(shiftId: string): Promise<LarkShiftDetail | null> {
    try {
      console.log(`[Lark:Attendance] Getting shift detail: ${shiftId}`);
      const data = await this.request<ShiftDetailResponse>(
        'GET',
        `/attendance/v1/shifts/${shiftId}`,
      );
      return data.shift || null;
    } catch (e) {
      console.warn(`[Lark:Attendance] Failed to get shift ${shiftId}:`, (e as Error).message);
      return null;
    }
  }

  /**
   * Query shift by name
   * POST /attendance/v1/shifts/query
   */
  async queryShiftByName(shiftName: string): Promise<LarkShiftDetail[]> {
    console.log(`[Lark:Attendance] Query shift by name: ${shiftName}`);
    const data = await this.request<ShiftQueryResponse>(
      'POST',
      '/attendance/v1/shifts/query',
      {},
      { shift_name: shiftName },
    );
    return data.shift_list || [];
  }

  /**
   * Batch get shift details for multiple shift IDs
   * Caches results to avoid redundant API calls
   */
  async getShifts(shiftIds: string[]): Promise<Map<string, LarkShiftDetail>> {
    const unique = [...new Set(shiftIds.filter(Boolean))];
    const results = new Map<string, LarkShiftDetail>();
    for (const id of unique) {
      const shift = await this.getShiftDetail(id);
      if (shift) results.set(id, shift);
    }
    console.log(`[Lark:Attendance] Loaded ${results.size}/${unique.length} shifts`);
    return results;
  }
}

/**
 * Split a date range into chunks of max `maxDays` days.
 * Returns array of [startDate, endDate] pairs in YYYY-MM-DD format.
 */
function chunkDateRange(start: string, end: string, maxDays: number): [string, string][] {
  const chunks: [string, string][] = [];
  const startDate = new Date(start);
  const endDate = new Date(end);

  let current = new Date(startDate);
  while (current <= endDate) {
    const chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + maxDays - 1);
    if (chunkEnd > endDate) {
      chunkEnd.setTime(endDate.getTime());
    }

    const fmtDate = (d: Date) => d.toISOString().split('T')[0];
    chunks.push([fmtDate(current), fmtDate(chunkEnd)]);

    current = new Date(chunkEnd);
    current.setDate(current.getDate() + 1);
  }

  return chunks;
}
