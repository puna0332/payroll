/**
 * PayrollPeriod Routes — CRUD quản lý kỳ lương / lịch chốt công
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../shared/db/prisma.js';

const router = Router();

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') {
    throw new Error(`Route param ${name} is required`);
  }
  return value;
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function monthRange(monthKey: string): { start: Date; end: Date } {
  const year = Number(monthKey.substring(0, 4));
  const month = Number(monthKey.substring(4, 6));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('monthKey phải có định dạng YYYYMM');
  }
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0)),
  };
}

function resolvePeriodDates(
  monthKey: string,
  periodStart: unknown,
  periodEnd: unknown,
  autoClose: unknown,
): { periodStart: Date; periodEnd: Date; autoClose: boolean } {
  const fixedMonthly = autoClose === true;
  if (fixedMonthly) {
    const range = monthRange(monthKey);
    return { periodStart: range.start, periodEnd: range.end, autoClose: true };
  }

  if (typeof periodStart !== 'string' || typeof periodEnd !== 'string') {
    throw new Error('periodStart, periodEnd bắt buộc với lịch chốt công thủ công');
  }
  return {
    periodStart: parseDateOnly(periodStart),
    periodEnd: parseDateOnly(periodEnd),
    autoClose: false,
  };
}

/**
 * GET /api/periods
 * Danh sách kỳ lương, mới nhất trước
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const periods = await prisma.payrollPeriod.findMany({
      orderBy: { monthKey: 'desc' },
    });
    return res.json(periods);
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/periods/:id
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req, 'id');
    const period = await prisma.payrollPeriod.findUnique({
      where: { id },
      include: {
        _count: { select: { payslips: true, monthlyAttendances: true, otMonthlies: true } },
      },
    });
    if (!period) return res.status(404).json({ error: 'Kỳ lương không tồn tại' });
    return res.json(period);
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/periods
 * Tạo kỳ lương mới
 * Body: { monthKey: "202606", label, periodStart, periodEnd, closeAt?, autoClose? }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { monthKey, label, periodStart, periodEnd, closeAt, autoClose } = req.body;

    if (!monthKey) {
      return res.status(400).json({ error: 'monthKey bắt buộc' });
    }
    const resolved = resolvePeriodDates(monthKey, periodStart, periodEnd, autoClose);

    // Check duplicate
    const existing = await prisma.payrollPeriod.findUnique({ where: { monthKey } });
    if (existing) {
      return res.status(409).json({ error: `Kỳ lương ${monthKey} đã tồn tại` });
    }

    const year = monthKey.substring(0, 4);
    const month = monthKey.substring(4, 6);

    const period = await prisma.payrollPeriod.create({
      data: {
        monthKey,
        label: label || `Tháng ${month}/${year}`,
        periodStart: resolved.periodStart,
        periodEnd: resolved.periodEnd,
        closeAt: closeAt ? parseDateOnly(closeAt) : null,
        autoClose: resolved.autoClose,
        status: 'OPEN',
      },
    });

    return res.status(201).json({ success: true, data: period });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * PUT /api/periods/:id
 * Cập nhật kỳ lương (chỉnh closeAt, autoClose, status)
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req, 'id');
    const { label, periodStart, periodEnd, closeAt, autoClose, status } = req.body;

    const period = await prisma.payrollPeriod.findUnique({ where: { id } });
    if (!period) return res.status(404).json({ error: 'Kỳ lương không tồn tại' });

    const data: Record<string, unknown> = {};
    if (label !== undefined) data.label = label;
    if (autoClose !== undefined || periodStart !== undefined || periodEnd !== undefined) {
      const resolved = resolvePeriodDates(
        period.monthKey,
        periodStart ?? period.periodStart.toISOString().slice(0, 10),
        periodEnd ?? period.periodEnd.toISOString().slice(0, 10),
        autoClose ?? period.autoClose,
      );
      data.periodStart = resolved.periodStart;
      data.periodEnd = resolved.periodEnd;
      data.autoClose = resolved.autoClose;
    }
    if (closeAt !== undefined) data.closeAt = closeAt ? parseDateOnly(closeAt) : null;
    if (status !== undefined) data.status = status;

    const updated = await prisma.payrollPeriod.update({
      where: { id },
      data,
    });

    return res.json({ success: true, data: updated });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/periods/:id/close
 * Chốt công kỳ lương — thay đổi status thành CLOSED
 */
router.post('/:id/close', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req, 'id');
    const period = await prisma.payrollPeriod.findUnique({ where: { id } });
    if (!period) return res.status(404).json({ error: 'Kỳ lương không tồn tại' });
    if (period.status === 'CLOSED') return res.status(400).json({ error: 'Kỳ lương đã chốt' });

    const updated = await prisma.payrollPeriod.update({
      where: { id },
      data: { status: 'CLOSED', closeAt: new Date() },
    });

    return res.json({ success: true, data: updated });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/periods/:id/reopen
 * Mở lại kỳ lương đã chốt
 */
router.post('/:id/reopen', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req, 'id');
    const period = await prisma.payrollPeriod.findUnique({ where: { id } });
    if (!period) return res.status(404).json({ error: 'Kỳ lương không tồn tại' });

    const updated = await prisma.payrollPeriod.update({
      where: { id },
      data: { status: 'OPEN', closeAt: null },
    });

    return res.json({ success: true, data: updated });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * DELETE /api/periods/:id
 * Xóa kỳ lương (chỉ khi chưa có payslip)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = routeParam(req, 'id');
    const period = await prisma.payrollPeriod.findUnique({
      where: { id },
      include: { _count: { select: { payslips: true } } },
    });
    if (!period) return res.status(404).json({ error: 'Kỳ lương không tồn tại' });
    if (period._count.payslips > 0) {
      return res.status(400).json({ error: `Không thể xóa — đã có ${period._count.payslips} phiếu lương` });
    }

    await prisma.payrollPeriod.delete({ where: { id } });
    return res.json({ success: true, message: 'Đã xóa kỳ lương' });
  } catch (error: unknown) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
