/**
 * Automation Routes — Thay thế Python webhook server
 *
 * Endpoints:
 *   GET  /health  — trạng thái engine
 *   GET  /flows   — catalog flows, groups, aliases
 *   POST /run     — trigger chạy flows (background, trả 202)
 *
 * Auth: X-ASNOVA-Webhook-Secret | Authorization: Bearer | ?token=
 * Lark challenge: trả challenge nếu body có trường challenge
 */

import { Router, type Request, type Response } from 'express';
import { flowExecutor } from './executor.js';
import {
  getAllFlows,
  FLOW_GROUPS,
  FLOW_ALIASES,
  normalizeAutomationCodes,
} from './registry.js';

const MODULE = '[Automation:Routes]';

const router = Router();

// ─── Auth Helper ────────────────────────────────────────────

/**
 * Xác thực webhook secret.
 * Kiểm tra theo thứ tự:
 *   1. Header X-ASNOVA-Webhook-Secret
 *   2. Authorization: Bearer <token>
 *   3. Query param ?token=<token>
 *
 * Nếu ASNOVA_WEBHOOK_SECRET chưa set → cho phép mọi request (dev mode).
 */
function isAuthorized(req: Request): boolean {
  const secret = process.env.ASNOVA_WEBHOOK_SECRET;

  // Dev mode — không có secret thì bỏ qua auth
  if (!secret) return true;

  // 1. Custom header
  const headerSecret = req.headers['x-asnova-webhook-secret'] as string | undefined;
  if (headerSecret === secret) return true;

  // 2. Bearer token
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    if (bearerToken === secret) return true;
  }

  // 3. Query param
  const queryToken = req.query.token as string | undefined;
  if (queryToken === secret) return true;

  return false;
}

// ─── Routes ─────────────────────────────────────────────────

/**
 * GET /health — Trạng thái engine
 */
router.get('/health', (_req: Request, res: Response) => {
  try {
    const status = flowExecutor.getStatus();
    res.json({
      ok: true,
      status,
      service: 'asnova-automation-engine',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${MODULE} Health check error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * GET /flows — Catalog flows, groups, aliases
 */
router.get('/flows', (_req: Request, res: Response) => {
  try {
    const flows = getAllFlows().map((f) => ({
      code: f.code,
      name: f.name,
      kind: f.kind,
      timeoutMs: f.timeoutMs,
    }));

    res.json({
      ok: true,
      flows,
      groups: FLOW_GROUPS,
      aliases: FLOW_ALIASES,
      totalFlows: flows.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${MODULE} Flows catalog error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * POST /run — Trigger chạy flows
 *
 * Body: { automation_code: string, challenge?: string }
 *   - automation_code: mã flow, alias, group (phân tách bằng dấu phẩy/chấm phẩy)
 *   - challenge: Lark verification challenge (trả lại ngay)
 *
 * Response: 202 Accepted (chạy background)
 */
router.post('/run', (req: Request, res: Response) => {
  try {
    // ── Lark challenge handling
    const body = req.body as Record<string, unknown>;
    if (body.challenge && typeof body.challenge === 'string') {
      console.log(`${MODULE} Lark challenge received — responding`);
      res.json({ challenge: body.challenge });
      return;
    }

    // ── Auth check
    if (!isAuthorized(req)) {
      console.warn(`${MODULE} Unauthorized /run attempt from ${req.ip}`);
      res.status(401).json({
        ok: false,
        error: 'Unauthorized — invalid or missing webhook secret',
      });
      return;
    }

    // ── Parse automation_code
    const rawCode = body.automation_code;
    if (!rawCode || typeof rawCode !== 'string') {
      res.status(400).json({
        ok: false,
        error: 'Missing or invalid automation_code in request body',
      });
      return;
    }

    // ── Normalize codes
    const { selected, invalid } = normalizeAutomationCodes(rawCode);

    if (selected.length === 0) {
      res.status(400).json({
        ok: false,
        error: 'No valid automation codes found',
        invalid,
        hint: 'Use GET /flows to see available codes, groups, and aliases',
      });
      return;
    }

    console.log(`${MODULE} POST /run — codes: ${selected.join(', ')}${invalid.length > 0 ? ` (invalid: ${invalid.join(', ')})` : ''}`);

    // ── Fire and forget (background execution)
    // Không await — trả 202 ngay lập tức
    flowExecutor.executeTick('webhook', selected).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${MODULE} Background executeTick error: ${msg}`);
    });

    // ── 202 Accepted
    res.status(202).json({
      ok: true,
      message: 'Automation flows queued for execution',
      selected,
      invalid: invalid.length > 0 ? invalid : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${MODULE} POST /run error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
