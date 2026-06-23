/**
 * Lark API — HTTP Client
 * Base client với auto-auth, retry on 401, rate limiting, error handling
 */

import { LARK_BASE_URL, type LarkConfig } from './config.js';
import { getTenantToken, clearTokenCache } from './auth.js';
import { LarkApiError, type LarkApiResponse } from './types.js';

// ─── Rate Limiting ──────────────────────────────────────────

/** Delay với exponential backoff */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tính thời gian chờ exponential backoff */
function getBackoffMs(attempt: number): number {
  // 1s, 2s, 4s, 8s, 16s — tối đa 16 giây
  return Math.min(1000 * Math.pow(2, attempt), 16_000);
}

// ─── Max retry cho rate limiting ────────────────────────────
const MAX_RATE_LIMIT_RETRIES = 5;

// ─── LarkClient ─────────────────────────────────────────────

export class LarkClient {
  constructor(protected readonly config: LarkConfig) {}

  /**
   * Gửi HTTP request đến Lark API
   * - Tự gắn Bearer token
   * - Kiểm tra response.code === 0
   * - Retry 1 lần khi 401 (token expired)
   * - Retry với exponential backoff khi 429 (rate limited)
   * - Log tất cả requests
   *
   * @param method - HTTP method (GET, POST, PUT, DELETE, PATCH)
   * @param path - API path (không bao gồm base URL), ví dụ: /bitable/v1/apps/...
   * @param body - Request body (optional)
   * @param queryParams - Query parameters (optional)
   */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string>,
  ): Promise<T> {
    return this._doRequest<T>(method, path, body, queryParams, false);
  }

  /**
   * Internal request handler với retry logic
   */
  private async _doRequest<T>(
    method: string,
    path: string,
    body: unknown | undefined,
    queryParams: Record<string, string> | undefined,
    isRetry: boolean,
    rateLimitAttempt = 0,
  ): Promise<T> {
    const token = await getTenantToken(this.config);

    // Build URL với query params
    let url = `${LARK_BASE_URL}${path}`;
    if (queryParams && Object.keys(queryParams).length > 0) {
      const params = new URLSearchParams(queryParams);
      url += `?${params.toString()}`;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    };

    console.log(`[Lark:Client] ${method} ${path}`);

    const response = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    // ── Rate limiting (429) — exponential backoff ──
    if (response.status === 429) {
      if (rateLimitAttempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new Error(
          `[Lark:Client] Rate limited sau ${MAX_RATE_LIMIT_RETRIES} lần retry: ${method} ${path}`,
        );
      }

      const backoff = getBackoffMs(rateLimitAttempt);
      console.log(
        `[Lark:Client] Rate limited (429), chờ ${backoff}ms rồi retry (lần ${rateLimitAttempt + 1})...`,
      );
      await delay(backoff);

      return this._doRequest<T>(
        method,
        path,
        body,
        queryParams,
        isRetry,
        rateLimitAttempt + 1,
      );
    }

    // ── Token expired (401) — retry 1 lần ──
    if (response.status === 401 && !isRetry) {
      console.log('[Lark:Client] Token expired (401), đang refresh và retry...');
      clearTokenCache();
      return this._doRequest<T>(method, path, body, queryParams, true);
    }

    if (!response.ok) {
      let errorBody = '';
      try { errorBody = await response.text(); } catch { /* ignore */ }
      console.error(`[Lark:Client] HTTP ${response.status} ${response.statusText}: ${method} ${path}`);
      console.error(`[Lark:Client] Response body:`, errorBody);
      console.error(`[Lark:Client] Request body:`, JSON.stringify(body));
      throw new Error(
        `[Lark:Client] HTTP ${response.status} ${response.statusText}: ${method} ${path} — ${errorBody}`,
      );
    }

    const result = (await response.json()) as LarkApiResponse<T>;

    // Kiểm tra Lark business error code
    if (result.code !== 0) {
      throw new LarkApiError(result.code, result.msg, path);
    }

    console.log(`[Lark:Client] ${method} ${path} → OK`);

    return result.data;
  }
}
