/**
 * Lark IM API — Client tin nhắn
 * Gửi tin nhắn text và card đến user qua open_id
 */

import { LarkClient } from './client.js';
import type { ImSendMessageResponse } from './types.js';

// ─── LarkImClient ───────────────────────────────────────────

export class LarkImClient extends LarkClient {
  /**
   * Gửi tin nhắn text đến user
   *
   * @param openId - Open ID của người nhận
   * @param text - Nội dung tin nhắn
   * @param uuid - UUID để đảm bảo idempotency (optional)
   */
  async sendText(
    openId: string,
    text: string,
    uuid?: string,
  ): Promise<void> {
    console.log(`[Lark:IM] Gửi text đến ${openId}`);

    const queryParams: Record<string, string> = {
      receive_id_type: 'open_id',
    };

    const body: Record<string, unknown> = {
      receive_id: openId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    };

    if (uuid) {
      body.uuid = uuid;
    }

    await this.request<ImSendMessageResponse>(
      'POST',
      '/im/v1/messages',
      body,
      queryParams,
    );

    console.log(`[Lark:IM] Đã gửi text thành công đến ${openId}`);
  }

  /**
   * Gửi interactive card đến user
   *
   * @param openId - Open ID của người nhận
   * @param card - Card template object (Lark interactive card format)
   * @param uuid - UUID để đảm bảo idempotency (optional)
   */
  async sendCard(
    openId: string,
    card: object,
    uuid?: string,
  ): Promise<void> {
    console.log(`[Lark:IM] Gửi card đến ${openId}`);

    const queryParams: Record<string, string> = {
      receive_id_type: 'open_id',
    };

    const body: Record<string, unknown> = {
      receive_id: openId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    };

    if (uuid) {
      body.uuid = uuid;
    }

    await this.request<ImSendMessageResponse>(
      'POST',
      '/im/v1/messages',
      body,
      queryParams,
    );

    console.log(`[Lark:IM] Đã gửi card thành công đến ${openId}`);
  }
}
