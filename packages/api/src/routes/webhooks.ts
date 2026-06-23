/**
 * Lark Webhook Handler
 * Nhận events từ Lark: approval changes, Bitable record changes
 * Pattern: Return 200 immediately → process async
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../shared/db/prisma.js';

const router = Router();
const MODULE = '[Webhook:Lark]';

/**
 * POST /api/webhooks/lark
 * Main webhook endpoint for Lark events
 */
router.post('/lark', async (req: Request, res: Response) => {
  const body = req.body;

  // Step 1: Challenge verification (only on first setup)
  if (body.type === 'url_verification') {
    console.log(`${MODULE} Challenge verification received`);
    return res.json({ challenge: body.challenge });
  }

  // Step 2: Return 200 immediately (Lark has 5s timeout)
  res.json({ code: 0 });

  // Step 3: Process async (non-blocking)
  const eventType = body.header?.event_type ?? body.event?.type ?? 'unknown';
  const event = body.event ?? {};

  console.log(`${MODULE} Received event: ${eventType}`);

  try {
    await processEvent(eventType, event);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Processing error:`, msg);
  }
});

/**
 * POST /api/webhooks/lark/base-automation
 * Lark Base Automation → webhook endpoint
 * Note: Base Automation không gửi custom headers → unprotected
 */
router.post('/lark/base-automation', async (req: Request, res: Response) => {
  const body = req.body;

  // Return 200 immediately
  res.json({ code: 0 });

  const { record_id, app_token, table_id, action_type } = body;
  console.log(`${MODULE} Base automation: table=${table_id}, record=${record_id}, action=${action_type}`);

  try {
    await processBaseAutomation(record_id, table_id, app_token, action_type);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`${MODULE} Base automation error:`, msg);
  }
});

/**
 * Process Lark platform events
 */
async function processEvent(eventType: string, event: Record<string, unknown>): Promise<void> {
  switch (eventType) {
    case 'approval_instance': {
      const instanceCode = event.instance_code as string;
      const status = event.status as string;
      console.log(`${MODULE} Approval event: ${instanceCode} → ${status}`);

      // Idempotency check
      const existing = await prisma.approvalRecord.findUnique({
        where: { instanceCode },
      });

      if (existing) {
        // Update status only
        const statusMap: Record<string, 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'PENDING'> = {
          'APPROVED': 'APPROVED',
          'REJECTED': 'REJECTED',
          'CANCELED': 'CANCELLED',
          'REVERTED': 'CANCELLED',
          'PENDING': 'PENDING',
        };

        await prisma.approvalRecord.update({
          where: { instanceCode },
          data: {
            status: statusMap[status] ?? 'PENDING',
            syncedAt: new Date(),
          },
        });
        console.log(`${MODULE} Updated approval ${instanceCode} → ${status}`);
      } else {
        // Schedule a full sync for this approval
        console.log(`${MODULE} Unknown approval ${instanceCode} — will be picked up by next sync`);
      }
      break;
    }

    case 'drive.bitable.record.changed': {
      const tableId = event.table_id as string;
      const recordId = event.record_id as string;
      console.log(`${MODULE} Bitable record changed: table=${tableId}, record=${recordId}`);
      // Trigger selective re-sync if needed
      break;
    }

    case 'contact.user.updated_v3': {
      console.log(`${MODULE} Contact updated — scheduling employee re-sync`);
      // Could trigger employee sync here
      break;
    }

    default:
      console.log(`${MODULE} Unhandled event type: ${eventType}`);
  }
}

/**
 * Process Lark Base Automation webhook calls
 */
async function processBaseAutomation(
  recordId: string,
  tableId: string,
  _appToken: string,
  actionType: string,
): Promise<void> {
  console.log(`${MODULE} Base automation: ${actionType} on ${tableId}/${recordId}`);

  // Can be extended to:
  // 1. Re-fetch record from Lark Base
  // 2. Update PostgreSQL
  // 3. Trigger downstream calculations
}

export default router;
