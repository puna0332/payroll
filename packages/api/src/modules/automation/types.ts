/**
 * Automation Engine — Type definitions
 * Replaces Python automation_runner.py's FLOWS dict + dataclasses
 */

// ─── Flow Kinds ─────────────────────────────────────────────

/** How a flow is triggered */
export type FlowKind = 'periodic' | 'periodic_hourly' | 'daily' | 'manual';

/** What triggered the execution */
export type FlowTrigger = 'interval' | 'webhook' | 'daily' | 'close-process';

// ─── Flow Configuration ─────────────────────────────────────

export interface FlowConfig {
  /** Unique code e.g. 'AUTO-ATT-SYNC' */
  code: string;
  /** Vietnamese display name */
  name: string;
  /** Scheduling kind */
  kind: FlowKind;
  /** Async handler function */
  handler: (ctx: FlowContext) => Promise<FlowResult>;
  /** Timeout in ms, default 900_000 (15 min) */
  timeoutMs?: number;
}

// ─── Flow Context ───────────────────────────────────────────

export interface FlowContext {
  /** Current payroll month key e.g. '202605' */
  month: string;
  /** Period start date ISO e.g. '2026-04-19' */
  startDate: string;
  /** Period end date ISO e.g. '2026-05-27' */
  endDate: string;
  /** What triggered this execution */
  trigger: FlowTrigger;
}

// ─── Flow Result ────────────────────────────────────────────

export interface FlowResult {
  success: boolean;
  recordsProcessed?: number;
  errors?: string[];
  durationMs: number;
}

// ─── Flow Groups ────────────────────────────────────────────

export type FlowGroup =
  | 'LIGHT_SYNC'
  | 'PAYROLL_CALC'
  | 'PAYROLL_OUTPUT'
  | 'PAYROLL_ALL';

// ─── Execution Status ───────────────────────────────────────

export interface ExecutionStatus {
  state: 'idle' | 'running' | 'error';
  lastTrigger: string;
  lastSelectedCodes: string[];
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastFailures: number;
}
