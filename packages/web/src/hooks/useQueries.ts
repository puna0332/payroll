import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type {
  Employee, MonthlyAttendance, Payslip, OtMonthly,
  PayrollPeriod, LeaveBalance, DailyAttendance, ApprovalRecord,
} from '../types';

// ─── Query Keys ─────────────────────────────────────────────

export const QUERY_KEYS = {
  employees: ['employees'] as const,
  employee: (id: string) => ['employee', id] as const,
  periods: ['periods'] as const,
  period: (id: string) => ['period', id] as const,
  monthlyAttendance: (periodId: string) => ['monthlyAttendance', periodId] as const,
  dailyAttendance: (empId: string, periodId: string) => ['dailyAttendance', empId, periodId] as const,
  payslips: (periodId: string) => ['payslips', periodId] as const,
  payslip: (empId: string, periodId: string) => ['payslip', empId, periodId] as const,
  otLedger: (periodId: string) => ['otLedger', periodId] as const,
  leaveBalances: (mk: string) => ['leaveBalances', mk] as const,
  approvals: (periodId: string) => ['approvals', periodId] as const,
  dashboard: (periodId: string) => ['dashboard', periodId] as const,
  syncStatus: ['syncStatus'] as const,
};

// ─── Employee ───────────────────────────────────────────────

export function useEmployees() {
  return useQuery({
    queryKey: QUERY_KEYS.employees,
    queryFn: async () => {
      const { data } = await api.get<Employee[]>('/employees');
      return data;
    },
  });
}

export function useEmployee(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.employee(id),
    queryFn: async () => {
      const { data } = await api.get<Employee>(`/employees/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

// ─── Payroll Period ─────────────────────────────────────────

export function usePeriods() {
  return useQuery({
    queryKey: QUERY_KEYS.periods,
    queryFn: async () => {
      const { data } = await api.get<PayrollPeriod[]>('/periods');
      return data;
    },
  });
}

// ─── Monthly Attendance ─────────────────────────────────────

export function useMonthlyAttendance(periodId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.monthlyAttendance(periodId),
    queryFn: async () => {
      const { data } = await api.get<MonthlyAttendance[]>(`/attendance/monthly?periodId=${periodId}`);
      return data;
    },
    enabled: !!periodId,
  });
}

export function useDailyAttendance(employeeId: string, periodId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.dailyAttendance(employeeId, periodId),
    queryFn: async () => {
      const { data } = await api.get<DailyAttendance[]>(`/attendance/daily?employeeId=${employeeId}&periodId=${periodId}`);
      return data;
    },
    enabled: !!employeeId && !!periodId,
  });
}

// ─── Payslips ───────────────────────────────────────────────

export function usePayslips(periodId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.payslips(periodId),
    queryFn: async () => {
      const { data } = await api.get<Payslip[]>(`/payslips?periodId=${periodId}`);
      return data;
    },
    enabled: !!periodId,
  });
}

// ─── OT ─────────────────────────────────────────────────────

export function useOtLedger(periodId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.otLedger(periodId),
    queryFn: async () => {
      const { data } = await api.get<OtMonthly[]>(`/ot/ledger?periodId=${periodId}`);
      return data;
    },
    enabled: !!periodId,
  });
}

// ─── Leave ──────────────────────────────────────────────────

export function useLeaveBalances(monthKey: string) {
  return useQuery({
    queryKey: QUERY_KEYS.leaveBalances(monthKey),
    queryFn: async () => {
      const { data } = await api.get<LeaveBalance[]>(`/leave/balances?monthKey=${monthKey}`);
      return data;
    },
    enabled: !!monthKey,
  });
}

// ─── Approvals ──────────────────────────────────────────────

export function useApprovals(periodId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.approvals(periodId),
    queryFn: async () => {
      const { data } = await api.get<ApprovalRecord[]>(`/approvals?periodId=${periodId}`);
      return data;
    },
    enabled: !!periodId,
  });
}

// ─── Dashboard ──────────────────────────────────────────────

export interface DashboardData {
  totalEmployees: number;
  activeEmployees: number;
  totalPayroll: number;
  avgSalary: number;
  totalOtHours: number;
  periodStatus: string;
  attendance: { actual: number; standard: number };
  departmentBreakdown: Array<{ department: string; count: number; totalPayroll: number }>;
  recentActivity: Array<{ type: string; message: string; time: string }>;
}

export function useDashboard(periodId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.dashboard(periodId),
    queryFn: async () => {
      const { data } = await api.get<DashboardData>(`/dashboard?periodId=${periodId}`);
      return data;
    },
    enabled: !!periodId,
  });
}

// ─── Sync Status ────────────────────────────────────────────

export interface SyncStatusData {
  lastEmployeeSync: string | null;
  lastAttendanceSync: string | null;
  lastApprovalSync: string | null;
  lastOutboundSync: string | null;
}

export function useSyncStatus() {
  return useQuery({
    queryKey: QUERY_KEYS.syncStatus,
    queryFn: async () => {
      const { data } = await api.get<SyncStatusData>('/sync/status');
      return data;
    },
    refetchInterval: 30_000, // auto-refresh every 30s
  });
}

// ─── Mutations ──────────────────────────────────────────────

export function useTriggerSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (type: 'employees' | 'attendance' | 'approvals' | 'outbound') => {
      const { data } = await api.post(`/sync/${type}`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.syncStatus });
    },
  });
}

export function useClosePayroll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (periodId: string) => {
      const { data } = await api.post(`/periods/${periodId}/close`);
      return data;
    },
    onSuccess: (_, periodId) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.period(periodId) });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.periods });
    },
  });
}

export function useRecalculate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (periodId: string) => {
      const { data } = await api.post(`/periods/${periodId}/recalculate`);
      return data;
    },
    onSuccess: (_, periodId) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.payslips(periodId) });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.monthlyAttendance(periodId) });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.otLedger(periodId) });
    },
  });
}
