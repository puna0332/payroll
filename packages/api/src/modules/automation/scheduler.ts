/**
 * Automation Scheduler — Replaces Python's main() loop
 * Uses node-cron for periodic flow execution
 */

import cron from 'node-cron';
import { env } from '../../config/env.js';
import { flowExecutor } from './executor.js';

const MODULE = '[Automation:Scheduler]';

function parseSelectedCodes(value: string): string[] | undefined {
  const codes = value
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
  return codes.length > 0 ? codes : undefined;
}

/**
 * Initialize the automation scheduler.
 * Sets up cron jobs for periodic sync and daily sheet generation.
 */
export function initAutomationScheduler(): void {
  if (!env.LARK_APP_ID || !env.LARK_APP_SECRET) {
    console.warn(
      `${MODULE} ⚠️ Lark credentials not configured — automation flows will run but Lark sync will be skipped`,
    );
  }

  console.log(`${MODULE} Initializing automation scheduler...`);

  const intervalMs = env.ASNOVA_AUTOMATION_INTERVAL_SECONDS * 1000;
  const selectedCodes = parseSelectedCodes(env.ASNOVA_AUTOMATION_PERIODIC_CODES);
  const runIntervalTick = async () => {
    console.log(`${MODULE} [INTERVAL] Periodic tick triggered`);
    await flowExecutor.executeTick('interval', selectedCodes);
  };

  setTimeout(() => {
    void runIntervalTick();
  }, 5_000);
  setInterval(() => {
    void runIntervalTick();
  }, intervalMs);

  // ═══════════════════════════════════════════
  // Daily payroll sheet — 06:00 Asia/Ho_Chi_Minh
  // Runs rollup + payroll sheet generation
  // ═══════════════════════════════════════════
  const dailyHour = env.ASNOVA_DAILY_PAYROLL_SHEET_HOUR ?? 6;
  if (env.ASNOVA_DAILY_PAYROLL_SHEET_ENABLED === 'true') {
    cron.schedule(
      `0 ${dailyHour} * * *`,
      async () => {
        console.log(`${MODULE} [CRON] Daily payroll sheet triggered`);
        await flowExecutor.executeTick('daily', [
          'AUTO-MONTHLY-ATT-ROLLUP',
          'AUTO-PAYROLL-SHEET',
        ]);
      },
      { timezone: 'Asia/Ho_Chi_Minh' },
    );
  }

  console.log(`${MODULE} ✅ Automation scheduler initialized:`);
  console.log(`${MODULE}   ⏱️  Periodic tick:     every ${env.ASNOVA_AUTOMATION_INTERVAL_SECONDS}s`);
  console.log(`${MODULE}   🎯 Selected flows:     ${selectedCodes?.join(', ') ?? 'periodic defaults'}`);
  console.log(`${MODULE}   📅 Daily sheet:        ${env.ASNOVA_DAILY_PAYROLL_SHEET_ENABLED === 'true' ? `0 ${dailyHour} * * * (${dailyHour}:00 daily)` : 'disabled'}`);
  console.log(`${MODULE}   📋 Registered flows:   ${flowExecutor.getStatus().state}`);
}
