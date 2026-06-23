/**
 * Sync Scheduler — Cron jobs cho tự động đồng bộ
 * Sử dụng node-cron để chạy sync tasks theo lịch
 */

import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../shared/db/prisma.js';
import { env } from '../config/env.js';

const MODULE = '[Scheduler]';

/**
 * SyncJob tracker — ghi log mỗi sync job vào database
 */
async function trackSyncJob(
  prisma: PrismaClient,
  jobType: string,
  direction: 'INBOUND' | 'OUTBOUND',
  runner: () => Promise<{ created?: number; updated?: number; synced?: number; errors?: number }>,
): Promise<void> {
  const job = await prisma.syncJob.create({
    data: {
      jobType,
      direction,
      status: 'RUNNING',
    },
  });

  try {
    const result = await runner();

    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        recordsCreated: result.created ?? result.synced ?? 0,
        recordsUpdated: result.updated ?? 0,
        recordsFailed: result.errors ?? 0,
        recordsProcessed:
          (result.created ?? 0) + (result.updated ?? 0) + (result.synced ?? 0),
      },
    });

    console.log(`${MODULE} Job ${jobType} completed:`, result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage: msg,
      },
    });
    console.error(`${MODULE} Job ${jobType} failed:`, msg);
  }
}

/**
 * Khởi tạo tất cả cron jobs
 *
 * Schedule (based on automation_runner.py from legacy system):
 * 1. Attendance sync: mỗi 30 phút (08:00-22:00)
 * 2. Approval sync: mỗi 15 phút (08:00-22:00)
 * 3. Employee sync: 1 lần/ngày (02:00)
 * 4. Outbound sync: mỗi 2 giờ
 */
export function initScheduler(): void {
  if (!env.LARK_APP_ID || !env.LARK_APP_SECRET) {
    console.warn(`${MODULE} Lark credentials not configured — scheduler disabled`);
    return;
  }

  console.log(`${MODULE} Initializing cron scheduler...`);

  // ═══════════════════════════════════════════
  // 1. Attendance sync: */30 8-22 * * *
  // ═══════════════════════════════════════════
  cron.schedule('*/30 8-22 * * *', async () => {
    console.log(`${MODULE} [CRON] Attendance sync triggered`);
    await trackSyncJob(prisma, 'ATTENDANCE_SYNC', 'INBOUND', async () => {
      // Dynamic import to avoid circular deps
      const { syncAttendanceFromLark } = await import('./sync/sync-attendance.js');
      const { createLarkClients } = await import('../shared/lark/index.js');
      const { attendance } = createLarkClients();

      const today = new Date().toISOString().split('T')[0];
      return syncAttendanceFromLark(attendance, {
        startDate: today,
        endDate: today,
      });
    });
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  // ═══════════════════════════════════════════
  // 2. Approval sync: */10 7-22 * * * (mỗi 10 phút)
  //    Luôn sync từ đầu kỳ lương hiện tại để không bỏ sót phiếu
  // ═══════════════════════════════════════════
  cron.schedule('*/10 7-22 * * *', async () => {
    console.log(`${MODULE} [CRON] Approval sync triggered`);
    await trackSyncJob(prisma, 'APPROVAL_SYNC', 'INBOUND', async () => {
      const { syncApprovalsFromLark } = await import('./sync/sync-approvals.js');
      const { createLarkClients } = await import('../shared/lark/index.js');
      const { approval } = createLarkClients();

      // Load approval codes từ DB settings (dynamic)
      const settings = await prisma.payrollSetting.findMany({
        where: {
          category: 'approval',
          policyVersion: { category: 'approval', status: 'ACTIVE' },
        },
      });
      const approvalCodes = settings
        .map(s => { try { return JSON.parse(s.value).code; } catch { return s.value; } })
        .filter(Boolean) as string[];

      if (approvalCodes.length === 0) {
        console.warn(`${MODULE} No approval codes in DB — skipping`);
        return { created: 0, updated: 0, skipped: 0 };
      }

      // Sync từ đầu kỳ lương hiện tại (hoặc 30 ngày qua nếu không có)
      const currentPeriod = await prisma.payrollPeriod.findFirst({
        where: { status: 'OPEN' },
        orderBy: { monthKey: 'desc' },
      });

      const startTime = currentPeriod
        ? new Date(currentPeriod.periodStart).getTime()
        : Date.now() - 30 * 24 * 60 * 60 * 1000;
      const endTime = Date.now();

      return syncApprovalsFromLark(approval, { startTime, endTime, approvalCodes });
    });
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  // ═══════════════════════════════════════════
  // 2b. Pending Approval sync: */5 7-22 * * * (mỗi 5 phút)
  //     Chỉ đồng bộ các phiếu có trạng thái PENDING trong hệ thống để cập nhật status mới nhất
  // ═══════════════════════════════════════════
  cron.schedule('*/5 7-22 * * *', async () => {
    console.log(`${MODULE} [CRON] Pending Approval sync triggered`);
    await trackSyncJob(prisma, 'PENDING_APPROVAL_SYNC', 'INBOUND', async () => {
      const { syncPendingApprovalsFromLark } = await import('./sync/sync-approvals.js');
      const { createLarkClients } = await import('../shared/lark/index.js');
      const { approval } = createLarkClients();

      return syncPendingApprovalsFromLark(approval);
    });
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  // ═══════════════════════════════════════════
  // 3. Employee sync: 0 2 * * * (2:00 AM daily)
  // ═══════════════════════════════════════════
  cron.schedule('0 2 * * *', async () => {
    console.log(`${MODULE} [CRON] Employee sync triggered`);
    await trackSyncJob(prisma, 'EMPLOYEE_SYNC', 'INBOUND', async () => {
      const { syncEmployeesFromLark } = await import('./sync/sync-employees.js');
      const { createLarkClients } = await import('../shared/lark/index.js');
      const { base } = createLarkClients();
      return syncEmployeesFromLark(prisma, base);
    });
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  // ═══════════════════════════════════════════
  // 4. Outbound sync: 0 */2 * * * (every 2 hours)
  // ═══════════════════════════════════════════
  cron.schedule('0 */2 * * *', async () => {
    console.log(`${MODULE} [CRON] Outbound sync triggered`);

    // Find current open period
    const period = await prisma.payrollPeriod.findFirst({
      where: { status: 'OPEN' },
      orderBy: { monthKey: 'desc' },
    });

    if (!period) {
      console.log(`${MODULE} No open period found — skipping outbound sync`);
      return;
    }

    await trackSyncJob(prisma, 'OUTBOUND_ATTENDANCE', 'OUTBOUND', async () => {
      const { syncPeriodToLark } = await import('./sync/sync-outbound.js');
      const { createLarkClients } = await import('../shared/lark/index.js');
      const { base } = createLarkClients();
      return syncPeriodToLark(base, period.id, 'all', prisma);
    });
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  console.log(`${MODULE} ✅ Scheduler initialized with 5 cron jobs:`);
  console.log(`${MODULE}   📋 Attendance:   */30 8-22 * * * (every 30 min)`);
  console.log(`${MODULE}   📋 Approvals:    */10 7-22 * * * (every 10 min)`);
  console.log(`${MODULE}   📋 Pending Apps: */5 7-22 * * *  (every 5 min)`);
  console.log(`${MODULE}   👤 Employees:    0 2 * * *       (daily 2:00 AM)`);
  console.log(`${MODULE}   🔄 Outbound:     0 */2 * * *     (every 2 hours)`);
}
