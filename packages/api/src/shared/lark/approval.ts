/**
 * Lark Approval API — Client phê duyệt
 * List approval instances và lấy chi tiết form values
 */

import { LarkClient } from './client.js';
import type {
  ApprovalInstance,
  ApprovalListResponse,
  ApprovalInstanceResponse,
} from './types.js';

// ─── LarkApprovalClient ────────────────────────────────────

export class LarkApprovalClient extends LarkClient {
  /**
   * Liệt kê tất cả instance codes đã approved trong khoảng thời gian
   * Auto-paginate qua page_token
   *
   * @param approvalCode - Mã loại phê duyệt (approval definition code)
   * @param startTime - Unix timestamp (ms) bắt đầu
   * @param endTime - Unix timestamp (ms) kết thúc
   * @returns Danh sách instance_code
   */
  async listInstances(
    approvalCode: string,
    startTime: number,
    endTime: number,
  ): Promise<string[]> {
    console.log(
      `[Lark:Approval] Liệt kê instances cho approval_code=${approvalCode}`,
    );

    const allCodes: string[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;

    do {
      const queryParams: Record<string, string> = {
        approval_code: approvalCode,
        start_time: String(startTime),
        end_time: String(endTime),
        page_size: '100',
      };

      if (pageToken) {
        queryParams.page_token = pageToken;
      }

      const data = await this.request<ApprovalListResponse>(
        'GET',
        '/approval/v4/instances',
        undefined,
        queryParams,
      );

      if (data.instance_code_list && data.instance_code_list.length > 0) {
        allCodes.push(...data.instance_code_list);
      }

      pageToken = data.page_token;
      pageCount++;

      console.log(
        `[Lark:Approval] Trang ${pageCount}: ${data.instance_code_list?.length ?? 0} instances`,
      );
    } while (pageToken);

    console.log(
      `[Lark:Approval] Tổng: ${allCodes.length} instance codes`,
    );

    return allCodes;
  }

  /**
   * Lấy chi tiết 1 approval instance (bao gồm form values)
   *
   * @param instanceCode - Mã instance cần lấy
   * @returns Chi tiết instance với form data
   */
  async getInstance(instanceCode: string): Promise<ApprovalInstance> {
    console.log(
      `[Lark:Approval] Lấy chi tiết instance ${instanceCode}`,
    );

    // Lark returns instance data directly in `data`, not wrapped in `data.instance`
    const instance = await this.request<ApprovalInstance>(
      'GET',
      `/approval/v4/instances/${instanceCode}`,
    );

    // Parse form JSON string thành array
    if (typeof instance.form === 'string') {
      try {
        instance.form = JSON.parse(instance.form);
      } catch {
        console.log(
          `[Lark:Approval] Không parse được form JSON cho instance ${instanceCode}`,
        );
        instance.form = [];
      }
    }

    return instance;
  }
}
