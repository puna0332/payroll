/**
 * API Routes — Leave Balance Management (Quản lý phép)
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../shared/db/prisma.js';
import { updateAllLeaveBalances, updateLeaveBalance } from '../modules/leave/balance.js';
import { normalizeApprovalType } from './approvals.js';
import { Decimal } from '@prisma/client/runtime/library';

const router = Router();

// Helper to safely convert Decimal fields to numbers
function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Decimal) return value.toNumber();
  if (typeof value === 'object' && 'toNumber' in value && typeof (value as Record<string, unknown>).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * GET /api/leave/balances
 * Returns leave balances and approved leave records for a specific month.
 * Query parameters:
 *   - monthKey: string (YYYYMM, e.g. "202605")
 */
router.get('/balances', async (req: Request, res: Response) => {
  try {
    const { monthKey } = req.query;

    if (!monthKey || typeof monthKey !== 'string' || !/^\d{6}$/.test(monthKey)) {
      return res.status(400).json({ success: false, error: 'monthKey (YYYYMM) is required' });
    }

    // 1. Run live update to ensure calculated balances are fresh and complete
    await updateAllLeaveBalances(monthKey, prisma);

    // 2. Determine date range for overlapping approvals
    let startDate: Date;
    let endDate: Date;
    let periodInfo = null;

    const period = await prisma.payrollPeriod.findUnique({
      where: { monthKey },
    });

    if (period) {
      startDate = period.periodStart;
      endDate = period.periodEnd;
      periodInfo = {
        id: period.id,
        monthKey: period.monthKey,
        label: period.label,
        periodStart: period.periodStart.toISOString(),
        periodEnd: period.periodEnd.toISOString(),
        status: period.status,
      };
    } else {
      const year = parseInt(monthKey.slice(0, 4), 10);
      const month = parseInt(monthKey.slice(4, 6), 10);
      startDate = new Date(Date.UTC(year, month - 1, 1));
      endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    }

    // 3. Fetch all active employee balances for this month
    const balancesRaw = await prisma.leaveBalance.findMany({
      where: { monthKey },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            department: true,
            position: true,
            status: true,
            larkMetadata: true,
          },
        },
      },
      orderBy: { employee: { fullName: 'asc' } },
    });

    // 4. Fetch overlapping approved leaves
    const approvalsRaw = await prisma.approvalRecord.findMany({
      where: {
        status: 'APPROVED',
        leaveTypeBucket: { in: ['ANNUAL', 'COMP_LEAVE', 'UNPAID', 'BENEFIT', 'REMOTE'] },
        OR: [
          { startTime: { gte: startDate, lte: endDate } },
          { endTime:   { gte: startDate, lte: endDate } },
          { startTime: { lte: startDate }, endTime: { gte: endDate } },
        ],
      },
      select: {
        id: true,
        instanceCode: true,
        serialNumber: true,
        approvalType: true,
        leaveType: true,
        leaveTypeBucket: true,
        status: true,
        approvedHours: true,
        approvedDays: true,
        startTime: true,
        endTime: true,
        employeeId: true,
        rawData: true,
      },
    });

    // Normalize and serialize data
    const balances = balancesRaw.map((b) => {
      const meta = (b.employee.larkMetadata as Record<string, unknown> | null) ?? {};
      return {
        id: b.id,
        employeeId: b.employeeId,
        monthKey: b.monthKey,
        opening: toNumber(b.opening),
        accrued: toNumber(b.accrued),
        used: toNumber(b.used),
        adjustment: toNumber(b.adjustment),
        seniorityBonus: toNumber(b.seniorityBonus),
        closing: toNumber(b.closing),
        employee: {
          id: b.employee.id,
          fullName: b.employee.fullName,
          department: b.employee.department,
          position: b.employee.position,
          status: b.employee.status,
          avatarUrl: (meta.avatarUrl as string | null) ?? null,
        },
      };
    });

    const approvals = approvalsRaw.map((a) => ({
      id: a.id,
      instanceCode: a.instanceCode,
      serialNumber: a.serialNumber,
      approvalType: normalizeApprovalType(a.approvalType),
      leaveType: a.leaveType,
      leaveTypeBucket: a.leaveTypeBucket,
      status: a.status,
      approvedHours: toNumber(a.approvedHours),
      approvedDays: toNumber(a.approvedDays),
      startTime: a.startTime?.toISOString() ?? null,
      endTime: a.endTime?.toISOString() ?? null,
      employeeId: a.employeeId,
      rawData: a.rawData,
    }));

    return res.json({
      success: true,
      data: {
        balances,
        approvals,
        period: periodInfo,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[API:Leave] Get Balances Error:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/leave/adjust
 * Adjust an employee's leave balance properties (adjustment and seniority bonus) for a specific month.
 * Body parameters:
 *   - employeeId: string
 *   - monthKey: string
 *   - adjustment: number
 *   - seniorityBonus: number
 */
router.post('/adjust', async (req: Request, res: Response) => {
  try {
    const { employeeId, monthKey, opening, accrued, adjustment, seniorityBonus } = req.body;

    if (!employeeId || !monthKey || adjustment === undefined || seniorityBonus === undefined) {
      return res.status(400).json({
        success: false,
        error: 'employeeId, monthKey, adjustment, and seniorityBonus are required',
      });
    }

    // 1. Fetch current record to keep parameters or override with request values
    const existing = await prisma.leaveBalance.findUnique({
      where: { employeeId_monthKey: { employeeId, monthKey } },
    });

    const defaultOpening = existing ? toNumber(existing.opening) : 0;
    const finalOpening = opening !== undefined ? Number(opening) : defaultOpening;

    const defaultAccrued = existing ? toNumber(existing.accrued) : 1.0;
    const finalAccrued = accrued !== undefined ? Number(accrued) : defaultAccrued;

    const used = existing ? toNumber(existing.used) : 0;

    // closing = opening + accrued + adjustment + seniorityBonus - used
    const closing = Math.max(finalOpening + finalAccrued + Number(adjustment) + Number(seniorityBonus) - used, 0);

    // 2. Upsert adjustment parameters in DB
    const updated = await prisma.leaveBalance.upsert({
      where: { employeeId_monthKey: { employeeId, monthKey } },
      create: {
        employeeId,
        monthKey,
        opening: finalOpening,
        accrued: finalAccrued,
        used,
        adjustment: Number(adjustment),
        seniorityBonus: Number(seniorityBonus),
        closing,
      },
      update: {
        opening: finalOpening,
        accrued: finalAccrued,
        adjustment: Number(adjustment),
        seniorityBonus: Number(seniorityBonus),
        closing,
      },
    });

    // 3. Re-run standard calculation engine to enforce standard triggers and return computed balance
    const freshBalance = await updateLeaveBalance(employeeId, monthKey, prisma);

    return res.json({
      success: true,
      data: {
        employeeId,
        monthKey,
        opening: freshBalance.opening,
        accrued: freshBalance.accrued,
        used: freshBalance.used,
        adjustment: freshBalance.adjustment,
        seniorityBonus: freshBalance.seniorityBonus,
        closing: freshBalance.closing,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[API:Leave] Balance Adjustment Error:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
});

export default router;
