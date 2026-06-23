/**
 * Close Process Orchestrator — 14-step payroll closing pipeline
 *
 * Steps are executed sequentially. Each step is logged to close_process_logs.
 * On error: set period status to ERROR, log error, stop.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { rollupAllEmployees } from '../attendance/rollup.js';
import { aggregateOtMonthlyBatch, rebuildOtDetailsFromApprovals } from '../ot/ot-ledger.js';
import { calculateAllPayslips } from './payslip-calculator.js';
import { createPolicySnapshots } from './policy-snapshot.js';
import { updateAllLeaveBalances } from '../leave/balance.js';
import { createLarkClients } from '../../shared/lark/index.js';
import { syncPeriodToLark } from '../sync/sync-outbound.js';

const MODULE = '[Payroll:CloseProcess]';

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

// ─── Types ──────────────────────────────────────────────────

export interface CloseProcessResult {
  periodId: string;
  status: 'CLOSED' | 'ERROR';
  completedSteps: number;
  totalSteps: number;
  error?: string;
  stepResults: Record<string, unknown>;
}

interface StepDef {
  name: string;
  order: number;
  fn: (ctx: CloseContext) => Promise<unknown>;
}

interface CloseContext {
  periodId: string;
  prisma: PrismaClient;
  mk: string;
}

// ─── Step Definitions ───────────────────────────────────────

const STEPS: StepDef[] = [
  {
    name: 'validate_period',
    order: 1,
    fn: async (ctx) => {
      const period = await ctx.prisma.payrollPeriod.findUniqueOrThrow({
        where: { id: ctx.periodId },
      });
      if (!['OPEN', 'READY', 'SCHEDULED'].includes(period.status)) {
        throw new Error(`Period status must be OPEN/READY/SCHEDULED, got: ${period.status}`);
      }
      return { currentStatus: period.status, monthKey: period.monthKey };
    },
  },
  {
    name: 'set_status_closing',
    order: 2,
    fn: async (ctx) => {
      await ctx.prisma.payrollPeriod.update({
        where: { id: ctx.periodId },
        data: { status: 'CLOSING' },
      });
      return { status: 'CLOSING' };
    },
  },
  {
    name: 'create_policy_snapshots',
    order: 3,
    fn: async (ctx) => {
      return await createPolicySnapshots(ctx.periodId, ctx.prisma);
    },
  },
  {
    name: 'sync_attendance_final',
    order: 4,
    fn: async (_ctx) => {
      // TODO: trigger final attendance sync from Lark
      return { skipped: true, reason: 'Sync not yet wired' };
    },
  },
  {
    name: 'sync_approvals_final',
    order: 5,
    fn: async (_ctx) => {
      // TODO: trigger final approval sync from Lark
      return { skipped: true, reason: 'Sync not yet wired' };
    },
  },
  {
    name: 'rollup_monthly_attendance',
    order: 6,
    fn: async (ctx) => {
      return await rollupAllEmployees(ctx.periodId, ctx.prisma);
    },
  },
  {
    name: 'calculate_ot_details',
    order: 7,
    fn: async (ctx) => {
      return await rebuildOtDetailsFromApprovals(ctx.periodId, ctx.prisma);
    },
  },
  {
    name: 'aggregate_ot_monthly',
    order: 8,
    fn: async (ctx) => {
      return await aggregateOtMonthlyBatch(ctx.periodId, ctx.prisma);
    },
  },
  {
    name: 'update_leave_balances',
    order: 9,
    fn: async (ctx) => {
      return await updateAllLeaveBalances(ctx.mk, ctx.prisma);
    },
  },
  {
    name: 'calculate_payslips',
    order: 10,
    fn: async (ctx) => {
      return await calculateAllPayslips(ctx.periodId, ctx.prisma);
    },
  },
  {
    name: 'outbound_sync_lark',
    order: 11,
    fn: async (ctx) => {
      const { base } = createLarkClients();
      return syncPeriodToLark(base, ctx.periodId, 'all', ctx.prisma);
    },
  },
  {
    name: 'generate_attendance_sheet',
    order: 12,
    fn: async (_ctx) => {
      // TODO: generate Excel sheet
      return { skipped: true, reason: 'Sheet generation not yet implemented' };
    },
  },
  {
    name: 'generate_payroll_sheet',
    order: 13,
    fn: async (_ctx) => {
      // TODO: generate payroll Excel sheet
      return { skipped: true, reason: 'Sheet generation not yet implemented' };
    },
  },
  {
    name: 'set_status_closed',
    order: 14,
    fn: async (ctx) => {
      await ctx.prisma.payrollPeriod.update({
        where: { id: ctx.periodId },
        data: {
          status: 'CLOSED',
          closeAt: new Date(),
        },
      });
      return { status: 'CLOSED' };
    },
  },
];

// ─── Main Function ──────────────────────────────────────────

/**
 * Execute the full close process for a payroll period.
 *
 * 14 sequential steps with DB logging and error handling.
 */
export async function executeCloseProcess(
  periodId: string,
  prisma: PrismaClient,
): Promise<CloseProcessResult> {
  const period = await prisma.payrollPeriod.findUniqueOrThrow({
    where: { id: periodId },
  });

  const ctx: CloseContext = {
    periodId,
    prisma,
    mk: period.monthKey,
  };

  let completedSteps = 0;
  const stepResults: Record<string, unknown> = {};

  console.log(`${MODULE} ═══════════════════════════════════════`);
  console.log(`${MODULE} Starting close process for period ${period.label}`);
  console.log(`${MODULE} ═══════════════════════════════════════`);

  for (const step of STEPS) {
    const startedAt = new Date();
    console.log(`${MODULE} Step ${step.order}/${STEPS.length}: ${step.name} — Starting...`);

    try {
      const output = await step.fn(ctx);
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();

      // Log to close_process_logs
      await prisma.closeProcessLog.create({
        data: {
          periodId,
          stepName: step.name,
          stepOrder: step.order,
          status: 'COMPLETED',
          startedAt,
          finishedAt,
          output: toJsonValue(output),
        },
      });

      stepResults[step.name] = output;
      completedSteps++;

      console.log(`${MODULE} Step ${step.order}: ${step.name} — ✅ Done (${durationMs}ms)`);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const finishedAt = new Date();

      // Log error
      await prisma.closeProcessLog.create({
        data: {
          periodId,
          stepName: step.name,
          stepOrder: step.order,
          status: 'FAILED',
          startedAt,
          finishedAt,
          errorMessage,
        },
      });

      // Set period status to ERROR
      await prisma.payrollPeriod.update({
        where: { id: periodId },
        data: { status: 'ERROR' },
      });

      console.error(`${MODULE} Step ${step.order}: ${step.name} — ❌ FAILED: ${errorMessage}`);

      return {
        periodId,
        status: 'ERROR',
        completedSteps,
        totalSteps: STEPS.length,
        error: `Step ${step.name}: ${errorMessage}`,
        stepResults,
      };
    }
  }

  console.log(`${MODULE} ═══════════════════════════════════════`);
  console.log(`${MODULE} Close process COMPLETE — ${completedSteps}/${STEPS.length} steps`);
  console.log(`${MODULE} ═══════════════════════════════════════`);

  return {
    periodId,
    status: 'CLOSED',
    completedSteps,
    totalSteps: STEPS.length,
    stepResults,
  };
}
