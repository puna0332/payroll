/**
 * Attendance Module — Barrel exports
 */

export { classifyLeaveType, isPaidCredit, type LeaveTypeBucket } from './leave-classifier.js';
export {
  calculateMonthlyAttendance,
  rollupAllEmployees,
  type MonthlyAttendanceResult,
} from './rollup.js';
