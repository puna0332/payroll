// ── Employee ──────────────────────────────────────────────────────────

export interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string;
  position: string;
  email?: string;
  phone?: string;
  startDate: string;
  status: 'active' | 'inactive' | 'probation';
  baseSalary: number;
  bankAccount?: string;
  bankName?: string;
  taxCode?: string;
  insuranceNumber?: string;
}

// ── Attendance ────────────────────────────────────────────────────────

export interface DailyAttendance {
  id: string;
  employeeId: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  workHours: number;
  status: 'present' | 'absent' | 'late' | 'leave' | 'holiday';
  note?: string;
}

export interface MonthlyAttendance {
  id: string;
  employeeId: string;
  employeeName: string;
  period: string;
  totalWorkDays: number;
  actualWorkDays: number;
  lateDays: number;
  absentDays: number;
  leaveDays: number;
  holidayDays: number;
  otHours: number;
}

// ── Approval ──────────────────────────────────────────────────────────

export interface ApprovalRecord {
  id: string;
  type: 'ot' | 'leave' | 'payroll' | 'adjustment';
  referenceId: string;
  requestedBy: string;
  approvedBy?: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  approvedAt?: string;
  note?: string;
}

// ── OT (Overtime) ────────────────────────────────────────────────────

export interface OtDetail {
  id: string;
  employeeId: string;
  date: string;
  startTime: string;
  endTime: string;
  hours: number;
  type: 'weekday' | 'weekend' | 'holiday' | 'night';
  rate: number;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
}

export interface OtMonthly {
  id: string;
  employeeId: string;
  employeeName: string;
  period: string;
  weekdayHours: number;
  weekendHours: number;
  holidayHours: number;
  nightHours: number;
  totalHours: number;
  totalAmount: number;
}

// ── Payroll ──────────────────────────────────────────────────────────

export interface Payslip {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  period: string;
  baseSalary: number;
  actualWorkDays: number;
  standardWorkDays: number;
  proRataSalary: number;
  otAmount: number;
  allowances: number;
  deductions: number;
  socialInsurance: number;
  healthInsurance: number;
  unemploymentInsurance: number;
  personalIncomeTax: number;
  netSalary: number;
  status: 'draft' | 'review' | 'approved' | 'paid';
}

export interface PayrollPeriod {
  id: string;
  period: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'open' | 'closed' | 'locked';
  totalEmployees: number;
  totalGrossSalary: number;
  totalNetSalary: number;
  createdAt: string;
  closedAt?: string;
}

// ── Leave ────────────────────────────────────────────────────────────

export interface LeaveBalance {
  id: string;
  employeeId: string;
  employeeName: string;
  year: number;
  annualLeaveTotal: number;
  annualLeaveUsed: number;
  annualLeaveRemaining: number;
  sickLeaveUsed: number;
  unpaidLeaveUsed: number;
}
