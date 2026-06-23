/**
 * Automation Engine — Flow Registry
 * 13 flows mapped 1:1 from Python automation_runner.py
 */

import type { FlowConfig, FlowContext, FlowResult, FlowGroup } from './types.js';

const MODULE = '[Automation:Registry]';
const DEFAULT_TIMEOUT = 900_000; // 15 minutes
const DAY_MS = 24 * 60 * 60 * 1000;

function ymdToUtcMs(value: string, endOfDay = false): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
}

function approvalSyncWindow(ctx: FlowContext): { startTime: number; endTime: number } {
  const now = Date.now();
  const startTime = ymdToUtcMs(ctx.startDate);
  const endOfPeriod = ymdToUtcMs(ctx.endDate, true);

  if (startTime != null && endOfPeriod != null) {
    return {
      startTime,
      endTime: Math.min(now, endOfPeriod + 45 * DAY_MS),
    };
  }

  return {
    startTime: now - 30 * DAY_MS,
    endTime: now,
  };
}

// ─── Flow Definitions ───────────────────────────────────────

const FLOWS: FlowConfig[] = [
  {
    code: 'AUTO-ATT-SYNC',
    name: 'Đồng bộ chấm công',
    kind: 'periodic',
    handler: async (ctx) => {
      const start = Date.now();
      try {
        const { syncAttendanceFromLark } = await import('../sync/sync-attendance.js');
        const { createLarkClients } = await import('../../shared/lark/index.js');
        const { attendance } = createLarkClients();
        const result = await syncAttendanceFromLark(attendance, {
          startDate: ctx.startDate,
          endDate: ctx.endDate,
        });
        return {
          success: true,
          recordsProcessed: result.created + result.updated + result.skipped,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        return { success: false, errors: [String(err)], durationMs: Date.now() - start };
      }
    },
  },
  {
    code: 'AUTO-APPROVAL-SYNC',
    name: 'Đồng bộ phiếu phê duyệt',
    kind: 'periodic',
    handler: async (ctx) => {
      const start = Date.now();
      try {
        const { syncApprovalsFromLark } = await import('../sync/sync-approvals.js');
        const { createLarkClients } = await import('../../shared/lark/index.js');
        const { approval } = createLarkClients();
        const { startTime, endTime } = approvalSyncWindow(ctx);
        const result = await syncApprovalsFromLark(approval, {
          startTime,
          endTime,
        });
        return {
          success: true,
          recordsProcessed: result.created + result.updated + result.skipped,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        return { success: false, errors: [String(err)], durationMs: Date.now() - start };
      }
    },
  },
  {
    code: 'AUTO-NIGHT-SHIFT-SYNC',
    name: 'Chuyển nhóm ca đêm',
    kind: 'periodic_hourly',
    handler: async (_ctx) => {
      const start = Date.now();
      // TODO: Port night_shift_group_switch.py
      return { success: true, recordsProcessed: 0, durationMs: Date.now() - start };
    },
  },
  {
    code: 'AUTO-MONTHLY-ATT-ROLLUP',
    name: 'Tổng hợp công tháng',
    kind: 'periodic',
    handler: async (_ctx) => {
      const start = Date.now();
      try {
        const { rollupAllEmployees } = await import('../attendance/rollup.js');
        const { prisma } = await import('../../shared/db/prisma.js');
        const period = await prisma.payrollPeriod.findFirst({
          where: { status: 'OPEN' },
          orderBy: { monthKey: 'desc' },
        });
        if (!period) return { success: true, recordsProcessed: 0, durationMs: Date.now() - start };
        const result = await rollupAllEmployees(period.id, prisma);
        return { success: true, recordsProcessed: result.processed ?? 0, durationMs: Date.now() - start };
      } catch (err) {
        return { success: false, errors: [String(err)], durationMs: Date.now() - start };
      }
    },
  },
  {
    code: 'AUTO-PAYSLIP-CALC',
    name: 'Tính phiếu lương',
    kind: 'periodic',
    handler: async (_ctx) => {
      const start = Date.now();
      try {
        const { calculateAllPayslips } = await import('../payroll/payslip-calculator.js');
        const { prisma } = await import('../../shared/db/prisma.js');
        const period = await prisma.payrollPeriod.findFirst({
          where: { status: 'OPEN' },
          orderBy: { monthKey: 'desc' },
        });
        if (!period) return { success: true, recordsProcessed: 0, durationMs: Date.now() - start };
        const result = await calculateAllPayslips(period.id, prisma);
        return { success: true, recordsProcessed: result.processed ?? 0, durationMs: Date.now() - start };
      } catch (err) {
        return { success: false, errors: [String(err)], durationMs: Date.now() - start };
      }
    },
  },
  {
    code: 'AUTO-MONTHLY-CLOSE',
    name: 'Poll chốt công tự động',
    kind: 'periodic',
    handler: async (_ctx) => {
      const start = Date.now();
      try {
        const { prisma } = await import('../../shared/db/prisma.js');
        // Find periods due for auto-close
        const duePeriods = await prisma.payrollPeriod.findMany({
          where: {
            autoClose: true,
            status: { in: ['SCHEDULED', 'READY'] },
            closeAt: { lte: new Date() },
          },
        });
        if (duePeriods.length === 0) {
          return { success: true, recordsProcessed: 0, durationMs: Date.now() - start };
        }
        const { executeCloseProcess } = await import('../payroll/close-process.js');
        let processed = 0;
        for (const period of duePeriods) {
          console.log(`${MODULE} Auto-closing period ${period.label}`);
          await executeCloseProcess(period.id, prisma);
          processed++;
        }
        return { success: true, recordsProcessed: processed, durationMs: Date.now() - start };
      } catch (err) {
        return { success: false, errors: [String(err)], durationMs: Date.now() - start };
      }
    },
  },
  {
    code: 'AUTO-BH-RECALC',
    name: 'Tính lại bảo hiểm',
    kind: 'manual',
    handler: async (_ctx) => {
      const start = Date.now();
      // TODO: Recalculate insurance for all employees
      return { success: true, recordsProcessed: 0, durationMs: Date.now() - start };
    },
  },
  {
    code: 'AUTO-OT-LEDGER',
    name: 'Tổng hợp sổ cái OT',
    kind: 'manual',
    handler: async (_ctx) => {
      const start = Date.now();
      try {
        const { aggregateOtMonthlyBatch, rebuildOtDetailsFromApprovals } = await import('../ot/ot-ledger.js');
        const { prisma } = await import('../../shared/db/prisma.js');
        const period = await prisma.payrollPeriod.findFirst({
          where: { status: 'OPEN' },
          orderBy: { monthKey: 'desc' },
        });
        if (!period) return { success: true, recordsProcessed: 0, durationMs: Date.now() - start };
        const details = await rebuildOtDetailsFromApprovals(period.id, prisma);
        const result = await aggregateOtMonthlyBatch(period.id, prisma);
        return { success: true, recordsProcessed: (result.processed ?? 0) + details.details, durationMs: Date.now() - start };
      } catch (err) {
        return { success: false, errors: [String(err)], durationMs: Date.now() - start };
      }
    },
  },
  {
    code: 'AUTO-PAYROLL-PREVIEW',
    name: 'Preview bảng lương → Lark',
    kind: 'manual',
    handler: async (_ctx) => {
      const start = Date.now();
      // TODO: Outbound sync to Lark Base
      return { success: true, recordsProcessed: 0, durationMs: Date.now() - start };
    },
  },
  {
    code: 'AUTO-POLICY-SNAPSHOT',
    name: 'Snapshot chính sách lương',
    kind: 'manual',
    handler: async (_ctx) => {
      const start = Date.now();
      try {
        const { createPolicySnapshots } = await import('../payroll/policy-snapshot.js');
        const { prisma } = await import('../../shared/db/prisma.js');
        const period = await prisma.payrollPeriod.findFirst({
          where: { status: 'OPEN' },
          orderBy: { monthKey: 'desc' },
        });
        if (!period) return { success: true, recordsProcessed: 0, durationMs: Date.now() - start };
        const result = await createPolicySnapshots(period.id, prisma);
        return {
          success: true,
          recordsProcessed: result.salary + result.tax + result.insurance,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        return { success: false, errors: [String(err)], durationMs: Date.now() - start };
      }
    },
  },
  {
    code: 'AUTO-PAYROLL-SHEET',
    name: 'Tạo Sheet bảng lương',
    kind: 'daily',
    handler: async (_ctx) => {
      const start = Date.now();
      // TODO: Excel generation (Phase 7)
      return { success: true, recordsProcessed: 0, durationMs: Date.now() - start };
    },
  },
  {
    code: 'AUTO-ATTENDANCE-SHEET',
    name: 'Tạo Sheet bảng công',
    kind: 'manual',
    handler: async (_ctx) => {
      const start = Date.now();
      // TODO: Excel generation (Phase 7)
      return { success: true, recordsProcessed: 0, durationMs: Date.now() - start };
    },
  },
  {
    code: 'AUTO-PAYSLIP',
    name: 'Tạo PDF phiếu lương',
    kind: 'manual',
    handler: async (_ctx) => {
      const start = Date.now();
      // TODO: PDF generation (Phase 7)
      return { success: true, recordsProcessed: 0, durationMs: Date.now() - start };
    },
  },
];

// ─── Flow Groups ────────────────────────────────────────────

export const FLOW_GROUPS: Record<FlowGroup, string[]> = {
  LIGHT_SYNC: [
    'AUTO-ATT-SYNC',
    'AUTO-APPROVAL-SYNC',
    'AUTO-NIGHT-SHIFT-SYNC',
    'AUTO-MONTHLY-ATT-ROLLUP',
    'AUTO-PAYSLIP-CALC',
    'AUTO-MONTHLY-CLOSE',
  ],
  PAYROLL_CALC: [
    'AUTO-BH-RECALC',
    'AUTO-MONTHLY-ATT-ROLLUP',
    'AUTO-OT-LEDGER',
    'AUTO-PAYSLIP-CALC',
    'AUTO-POLICY-SNAPSHOT',
    'AUTO-PAYROLL-PREVIEW',
  ],
  PAYROLL_OUTPUT: [
    'AUTO-ATTENDANCE-SHEET',
    'AUTO-PAYROLL-SHEET',
    'AUTO-PAYSLIP',
  ],
  PAYROLL_ALL: [
    'AUTO-BH-RECALC',
    'AUTO-MONTHLY-ATT-ROLLUP',
    'AUTO-OT-LEDGER',
    'AUTO-PAYSLIP-CALC',
    'AUTO-POLICY-SNAPSHOT',
    'AUTO-PAYROLL-PREVIEW',
    'AUTO-ATTENDANCE-SHEET',
    'AUTO-PAYROLL-SHEET',
    'AUTO-PAYSLIP',
  ],
};

// ─── Flow Aliases (from Python) ─────────────────────────────

export const FLOW_ALIASES: Record<string, string> = {
  // Groups
  FULL: 'LIGHT_SYNC',
  ALL: 'LIGHT_SYNC',
  SYNC: 'LIGHT_SYNC',
  LIGHT: 'LIGHT_SYNC',
  PAYROLL_FULL: 'PAYROLL_ALL',
  PAYROLL: 'PAYROLL_CALC',
  OUTPUT: 'PAYROLL_OUTPUT',

  // Individual aliases
  ATT: 'AUTO-ATT-SYNC',
  ATTENDANCE: 'AUTO-ATT-SYNC',
  ATTENDANCE_SYNC: 'AUTO-ATT-SYNC',
  APPROVAL: 'AUTO-APPROVAL-SYNC',
  APPROVAL_SYNC: 'AUTO-APPROVAL-SYNC',
  NIGHT: 'AUTO-NIGHT-SHIFT-SYNC',
  NIGHT_SHIFT: 'AUTO-NIGHT-SHIFT-SYNC',
  ROLLUP: 'AUTO-MONTHLY-ATT-ROLLUP',
  MONTHLY_ROLLUP: 'AUTO-MONTHLY-ATT-ROLLUP',
  PAYSLIP_CALC: 'AUTO-PAYSLIP-CALC',
  CLOSE: 'AUTO-MONTHLY-CLOSE',
  MONTHLY_CLOSE: 'AUTO-MONTHLY-CLOSE',
  INSURANCE: 'AUTO-BH-RECALC',
  INSURANCE_RECALC: 'AUTO-BH-RECALC',
  BH: 'AUTO-BH-RECALC',
  OT: 'AUTO-OT-LEDGER',
  OT_LEDGER: 'AUTO-OT-LEDGER',
  PREVIEW: 'AUTO-PAYROLL-PREVIEW',
  SNAPSHOT: 'AUTO-POLICY-SNAPSHOT',
  POLICY_SNAPSHOT: 'AUTO-POLICY-SNAPSHOT',
  SHEET: 'AUTO-PAYROLL-SHEET',
  SALARY_SHEET: 'AUTO-PAYROLL-SHEET',
  ATT_SHEET: 'AUTO-ATTENDANCE-SHEET',
  PDF: 'AUTO-PAYSLIP',
  PAYSLIP_PDF: 'AUTO-PAYSLIP',
};

// ─── Lookup Functions ───────────────────────────────────────

const flowMap = new Map(FLOWS.map((f) => [f.code, f]));

/** Get a flow by its code */
export function getFlowByCode(code: string): FlowConfig | undefined {
  return flowMap.get(code);
}

/** Get all registered flows */
export function getAllFlows(): FlowConfig[] {
  return [...FLOWS];
}

/**
 * Parse raw input into resolved flow codes.
 * Handles aliases, groups, comma/semicolon separators.
 */
export function normalizeAutomationCodes(rawInput: string): {
  selected: string[];
  invalid: string[];
} {
  const tokens = rawInput
    .toUpperCase()
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const selected = new Set<string>();
  const invalid: string[] = [];

  for (const token of tokens) {
    // Direct flow code?
    if (flowMap.has(token)) {
      selected.add(token);
      continue;
    }

    // Alias → flow code or group name?
    const resolved = FLOW_ALIASES[token];
    if (resolved) {
      // Is it a group name?
      if (resolved in FLOW_GROUPS) {
        for (const code of FLOW_GROUPS[resolved as FlowGroup]) {
          selected.add(code);
        }
      } else if (flowMap.has(resolved)) {
        selected.add(resolved);
      }
      continue;
    }

    // Is it a group name directly?
    if (token in FLOW_GROUPS) {
      for (const code of FLOW_GROUPS[token as FlowGroup]) {
        selected.add(code);
      }
      continue;
    }

    invalid.push(token);
  }

  return { selected: [...selected], invalid };
}
