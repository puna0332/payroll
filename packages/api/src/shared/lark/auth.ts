/**
 * Lark API — Xác thực (Authentication)
 * Quản lý tenant access token với lazy refresh
 * Token TTL: 2 giờ, refresh khi còn < 60 giây
 */

import { LARK_BASE_URL, type LarkConfig } from './config.js';
import type { LarkApiResponse } from './types.js';

// ─── Token Cache ────────────────────────────────────────────

interface TokenCache {
  token: string;
  expiresAt: number; // Unix timestamp (ms)
}

/** Cache token ở module level — shared giữa tất cả requests */
let tokenCache: TokenCache | null = null;

/** Buffer trước khi hết hạn (60 giây) */
const REFRESH_BUFFER_MS = 60 * 1000;

// ─── Token Response ─────────────────────────────────────────

interface TokenResponse {
  tenant_access_token: string;
  expire: number; // seconds until expiry
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Lấy tenant access token, tự động refresh khi sắp hết hạn
 * Sử dụng tenant_access_token/internal endpoint (custom app)
 */
export async function getTenantToken(config: LarkConfig): Promise<string> {
  const now = Date.now();

  // Trả về token cached nếu còn hạn (với buffer 60s)
  if (tokenCache && tokenCache.expiresAt - now > REFRESH_BUFFER_MS) {
    return tokenCache.token;
  }

  console.log('[Lark:Auth] Đang refresh tenant access token...');

  const url = `${LARK_BASE_URL}/auth/v3/tenant_access_token/internal`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `[Lark:Auth] HTTP ${response.status} khi lấy token: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as LarkApiResponse<TokenResponse>;

  if (data.code !== 0) {
    throw new Error(
      `[Lark:Auth] Lỗi lấy token: code=${data.code} msg="${data.msg}"`,
    );
  }

  // Cache token mới với thời gian hết hạn
  const expireMs = (data as unknown as TokenResponse).expire * 1000;
  tokenCache = {
    token: (data as unknown as TokenResponse).tenant_access_token,
    expiresAt: now + expireMs,
  };

  console.log(
    `[Lark:Auth] Token refreshed thành công, hết hạn sau ${Math.round(expireMs / 1000 / 60)} phút`,
  );

  return tokenCache.token;
}

/**
 * Xóa token cache — dùng khi nhận 401 để force refresh
 */
export function clearTokenCache(): void {
  tokenCache = null;
  console.log('[Lark:Auth] Token cache đã xóa');
}
