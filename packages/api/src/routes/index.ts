import { Router, type Request, type Response } from 'express';
import syncRoutes from './sync.js';
import webhookRoutes from './webhooks.js';
import employeeRoutes from './employees.js';
import attendanceRoutes from './attendance.js';
import settingsRoutes from './settings.js';
import periodRoutes from './periods.js';
import payrollRoutes from './payroll.js';
import approvalRoutes from './approvals.js';
import automationRoutes from '../modules/automation/routes.js';
import leaveRoutes from './leave.js';

/**
 * Route registrar — đăng ký tất cả module routes
 * Thêm route mới bằng cách import và mount tại đây
 */

const router = Router();

// ─── Health Check ───────────────────────────────────────────

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'asnova-payroll-api',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ─── Module Routes ──────────────────────────────────────────

router.use('/sync', syncRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/employees', employeeRoutes);
router.use('/settings', settingsRoutes);
router.use('/periods', periodRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/payroll', payrollRoutes);
router.use('/approvals', approvalRoutes);
router.use('/automation', automationRoutes);
router.use('/leave', leaveRoutes);

export default router;
