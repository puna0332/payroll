/**
 * Automation Engine — Flow Executor
 * Replaces Python's execute_tick() + run_once() + run_flow()
 */

import type {
  FlowConfig,
  FlowContext,
  FlowResult,
  FlowTrigger,
  ExecutionStatus,
} from './types.js';
import { getAllFlows, getFlowByCode } from './registry.js';

const MODULE = '[Automation:Executor]';
const DEFAULT_TIMEOUT = 900_000; // 15 minutes

// ─── Flow Executor ──────────────────────────────────────────

export class FlowExecutor {
  private running = false;
  private hourlyFlowState = new Map<string, Date>();
  private lastStatus: ExecutionStatus = {
    state: 'idle',
    lastTrigger: '',
    lastSelectedCodes: [],
    lastFailures: 0,
  };

  /**
   * Execute a tick — run selected or periodic flows.
   * Returns failure count.
   */
  async executeTick(
    trigger: FlowTrigger | string,
    selectedCodes?: string[],
  ): Promise<number> {
    if (this.running) {
      console.log(`${MODULE} Skipping tick — already running`);
      return 0;
    }

    this.running = true;
    this.lastStatus = {
      state: 'running',
      lastTrigger: trigger,
      lastSelectedCodes: selectedCodes ?? [],
      lastStartedAt: new Date().toISOString(),
      lastFailures: 0,
    };

    let failures = 0;

    try {
      const ctx = await this.getCurrentPeriod(trigger as FlowTrigger);
      let flows: FlowConfig[];

      if (selectedCodes && selectedCodes.length > 0) {
        // Webhook/manual trigger — run ALL specified flows regardless of kind
        flows = selectedCodes
          .map((code) => getFlowByCode(code))
          .filter((f): f is FlowConfig => f !== undefined);
      } else {
        // Interval trigger — only periodic + periodic_hourly flows
        flows = getAllFlows().filter(
          (f) => f.kind === 'periodic' || f.kind === 'periodic_hourly',
        );
      }

      console.log(
        `${MODULE} ── Tick [${trigger}] ── ${flows.length} flow(s) ──`,
      );

      for (const flow of flows) {
        // Hourly throttle check
        if (flow.kind === 'periodic_hourly' && !this.isHourlyFlowDue(flow.code)) {
          console.log(`${MODULE}   ⏭ ${flow.code} — skipped (hourly throttle)`);
          continue;
        }

        const result = await this.runFlow(flow, ctx);

        if (flow.kind === 'periodic_hourly') {
          this.markHourlyFlowAttempt(flow.code);
        }

        if (!result.success) {
          failures++;
        }
      }

      console.log(
        `${MODULE} ── Tick done ── failures: ${failures} ──`,
      );
    } catch (err) {
      console.error(`${MODULE} Tick error:`, err);
      failures++;
    } finally {
      this.running = false;
      this.lastStatus = {
        ...this.lastStatus,
        state: failures > 0 ? 'error' : 'idle',
        lastFinishedAt: new Date().toISOString(),
        lastFailures: failures,
      };
    }

    return failures;
  }

  /**
   * Run a single flow with timeout.
   */
  async runFlow(flow: FlowConfig, ctx: FlowContext): Promise<FlowResult> {
    const timeoutMs = flow.timeoutMs ?? DEFAULT_TIMEOUT;
    const startedAt = Date.now();

    console.log(`${MODULE}   ▶ ${flow.code} (${flow.name})`);

    try {
      // Race between handler and timeout
      const result = await Promise.race<FlowResult>([
        flow.handler(ctx),
        new Promise<FlowResult>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Flow ${flow.code} timed out after ${timeoutMs}ms`)),
            timeoutMs,
          ),
        ),
      ]);

      const emoji = result.success ? '✅' : '⚠️';
      console.log(
        `${MODULE}   ${emoji} ${flow.code} — ${result.durationMs}ms, ${result.recordsProcessed ?? 0} records`,
      );

      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`${MODULE}   ❌ ${flow.code} — FAILED: ${errMsg} (${durationMs}ms)`);

      return {
        success: false,
        errors: [errMsg],
        durationMs,
      };
    }
  }

  /**
   * Get current payroll period from DB, fallback to current month.
   */
  async getCurrentPeriod(trigger: FlowTrigger = 'interval'): Promise<FlowContext> {
    try {
      const { prisma } = await import('../../shared/db/prisma.js');

      const period = await prisma.payrollPeriod.findFirst({
        where: { status: 'OPEN' },
        orderBy: { monthKey: 'desc' },
      });

      if (period) {
        return {
          month: period.monthKey,
          startDate: period.periodStart.toISOString().split('T')[0],
          endDate: period.periodEnd.toISOString().split('T')[0],
          trigger,
        };
      }
    } catch {
      // DB unavailable — use fallback
    }

    // Fallback: current month
    const now = new Date();
    const month = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const endDate = now.toISOString().split('T')[0];

    return { month, startDate, endDate, trigger };
  }

  /**
   * Check if an hourly flow is due (>3600s since last run).
   */
  isHourlyFlowDue(code: string): boolean {
    const last = this.hourlyFlowState.get(code);
    if (!last) return true;
    return Date.now() - last.getTime() > 3600_000;
  }

  /**
   * Mark an hourly flow as attempted.
   */
  markHourlyFlowAttempt(code: string): void {
    this.hourlyFlowState.set(code, new Date());
  }

  /**
   * Get current execution status.
   */
  getStatus(): ExecutionStatus {
    return { ...this.lastStatus };
  }
}

// ─── Singleton ──────────────────────────────────────────────

export const flowExecutor = new FlowExecutor();
