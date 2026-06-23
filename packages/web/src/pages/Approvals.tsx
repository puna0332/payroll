import { motion, AnimatePresence } from 'framer-motion';
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import {
  ClipboardCheck, FileText, Clock, XCircle, Loader2,
  RefreshCw, Search, CalendarRange, Hash, User,
  Zap, TrendingUp, DollarSign, Tag, CheckCircle2,
  CalendarDays, CalendarClock, BedDouble, PlusCircle, Info,
} from 'lucide-react';
import {
  PageHeader, KpiCard, DataTable, type Column, StatusBadge,
  Avatar, Button, Modal, Dropdown, LoadingSkeleton, EmptyState,
} from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import api from '@/services/api';

// ─── Types ──────────────────────────────────────────────────

interface Period {
  id: string;
  monthKey: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  status: string;
}

interface ApprovalEmployee {
  id: string;
  fullName: string;
  employeeCode: string | null;
  department: string | null;
  position: string | null;
  avatarUrl: string | null;  // extracted from larkMetadata
}

interface ApprovalItem {
  id: string;
  instanceCode: string;
  approvalCode: string | null;
  serialNumber: string | null;
  approvalType: string;
  leaveType: string | null;
  leaveTypeBucket: string | null;
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'CANCELLED';
  applyDate: string | null;
  approvedHours: number;
  approvedDays: number;
  startTime: string | null;
  endTime: string | null;
  syncedAt: string | null;
  createdAt: string;
  submissionPolicyOverride?: boolean;
  employee: ApprovalEmployee;
  // Salary from SalaryPolicy (added by backend for OT calculation)
  hourlyRate?: number;
  baseSalary?: number;
  rankAllowance?: number;
  payrollSalary?: number;
  standardDays?: number;
  otLabels?: string[];
  otSegments?: OtBucketDetail[];
  otSummary?: OtSummary;
  submissionPolicy?: ApprovalSubmissionPolicy | null;
  rawData?: any | null;
}

// OT detail from GET /approvals/:id (includes bucket breakdown)
interface OtBucketDetail {
  bucket: string;
  label?: string;
  rate: number;
  ratePercent?: number;
  approvedHours: number;
  validHours: number;
  effectiveHours?: number;
  hourlyRate?: number;
  otHourlyRate?: number;
  amount?: number;
  startTime: string;
  endTime: string;
  frame: 'day' | 'night';
  dayType: string;
  source?: 'ledger' | 'attendance-overlap' | 'approved-window';
}

interface OtSummary {
  hours: number;
  amount: number;
  approvedHours: number;
}

interface CompLeaveMatch {
  approvalId: string;
  instanceCode: string;
  serialNumber: string | null;
  workedStart: string;
  workedEnd: string;
  compLeaveStart: string;
  compLeaveEnd: string;
  compLeaveHours: number;
}

interface ApprovalSubmissionPolicy {
  type: 'WORK_TIME_CHANGE' | 'OT';
  isLate: boolean;
  counted: boolean;
  overrideApplied?: boolean;
  submittedAt: string | null;
  submittedDate: string | null;
  effectiveDate: string;
  requiredSubmitFromDate?: string;
  requiredSubmitByDate: string;
  note: string;
}

interface ApprovalDetail extends ApprovalItem {
  otBuckets: OtBucketDetail[] | null;
  otSegments?: OtBucketDetail[];
  otSummary?: OtSummary;
  otPolicy: string | null;
  compLeaveMatches?: CompLeaveMatch[];
  isNightShift: boolean;
  hourlyRate: number;
  baseSalary: number;
  rankAllowance: number;
  payrollSalary: number;
  standardDays: number;
  dailyRate: number;
  changeWorkingFrame: {
    isNightShift: boolean;
    shiftStart: string;
    shiftEnd: string;
    changeType?: string;
    submissionPolicy?: ApprovalSubmissionPolicy;
    compLeaveHours?: number;
    workedPeriodStart?: string;
    workedPeriodEnd?: string;
  } | null;
  rawData?: any | null;
}

interface ApprovalStats {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  totalOtHours: number;
  totalLeaveDays: number;
}

type LarkFormWidget = {
  type?: string;
  id?: string;
  name?: string;
  value?: any;
};

// ─── Constants ──────────────────────────────────────────────

const OT_BUCKET_LABELS: Record<string, string> = {
  'Ngày thường 時間外 17h~22h': 'Ngày thường 150%',
  'Làm thêm ca đêm của ngày thường': 'Ngày thường đêm 200%',
  'Ngày thường 時間外(夜間まで残業) 22h~6h': 'Ngày thường đêm 210%',
  'Ngày nghỉ T7 休日出勤(土) 6h~22h': 'Thứ 7 nghỉ 200%',
  'Ngày nghỉ 休日出勤 6h~22h': 'Ngày nghỉ 200%',
  'Ngày nghỉ T7 ca đêm 土曜夜勤 22h~6h': 'Thứ 7 đêm 270%',
  'Ngày nghỉ ca đêm 休日の夜勤 22h~6h': 'Ngày nghỉ đêm 270%',
  'OT ngày lễ 祝日出勤': 'Ngày lễ 300%',
  'OT ngày lễ ca đêm 祝日夜勤 22h~6h': 'Ngày lễ đêm 390%',
  '平日の夜勤 22h~6h ca đêm': 'Ca đêm 30%',
  '平日夜勤の残業→翌日の6h~22h Số giờ làm thêm của ca đêm': 'OT sau ca đêm 150%',
};

const bucketColor = (bucket: string) => {
  if (bucket.includes('150') || bucket.includes('17h~22h')) return 'text-blue-600 bg-blue-50 border-blue-200';
  if (bucket.includes('Làm thêm ca đêm của ngày thường')) return 'text-fuchsia-600 bg-fuchsia-50 border-fuchsia-200';
  if (bucket.includes('210') || bucket.includes('夜間まで残業)')) return 'text-purple-600 bg-purple-50 border-purple-200';
  if (bucket.includes('200') || (bucket.includes('休日出勤') && bucket.includes('6h~22h'))) return 'text-indigo-600 bg-indigo-50 border-indigo-200';
  if (bucket.includes('270') || bucket.includes('休日の夜勤')) return 'text-violet-600 bg-violet-50 border-violet-200';
  if (bucket.includes('300') || (bucket.includes('lễ') && !bucket.includes('đêm') && !bucket.includes('夜勤'))) return 'text-orange-600 bg-orange-50 border-orange-200';
  if (bucket.includes('390') || (bucket.includes('lễ') && (bucket.includes('đêm') || bucket.includes('夜勤')))) return 'text-red-600 bg-red-50 border-red-200';
  if (bucket.includes('130') || bucket.includes('đêm') || bucket.includes('夜勤') || bucket.includes('Ca đêm 30%')) return 'text-slate-600 bg-slate-50 border-slate-200';
  return 'text-gray-600 bg-gray-50 border-gray-200';
};

/**
 * Tab filters — đúng theo spec:
 * - Phép năm 有休          : leaveTypeBucket = ANNUAL
 * - Nghỉ có lương 有給      : leaveTypeBucket = BENEFIT | COMP_LEAVE (phúc lợi, sinh nhật, sinh con...)
 * - Nghỉ Trừ lương 欠勤総合 : leaveTypeBucket = UNPAID (ốm, không hưởng lương, BHXH)
 * - OT                    : approvalType = OT
 * - Change working        : approvalType = ChangeHours
 */
const TABS = [
  {
    key: 'annual',
    label: 'Phép năm 有休',
    filters: { type: 'LEAVE', leaveTypeBucket: 'ANNUAL' },
  },
  {
    key: 'benefit',
    label: 'Nghỉ có lương 有給',
    filters: { type: 'LEAVE', leaveTypeBucket: 'BENEFIT,COMP_LEAVE' },
    hint: 'Phúc lợi, sinh nhật, sinh con, kết hôn, hưởng lương khác'
  },
  {
    key: 'unpaid',
    label: 'Nghỉ Trừ lương 欠勤総合',
    filters: { type: 'LEAVE', leaveTypeBucket: 'UNPAID' },
    hint: 'Không hưởng lương, nghỉ ốm, BHXH'
  },
  {
    key: 'ot',
    label: 'OT',
    filters: { type: 'OT', leaveTypeBucket: '' },
  },
  {
    key: 'change',
    label: 'Change working & holiday hour',
    filters: { type: 'CHANGE', leaveTypeBucket: '' },
  },
] as const;

const STATUS_MAP: Record<string, { label: string; status: string }> = {
  APPROVED:  { label: 'Đã duyệt',  status: 'approved' },
  PENDING:   { label: 'Đang chờ',   status: 'pending' },
  REJECTED:  { label: 'Từ chối',    status: 'failed' },
  CANCELLED: { label: 'Đã huỷ',    status: 'draft' },
};

// ─── Helpers ────────────────────────────────────────────────

const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const fmtVND = (n: number | null | undefined) => (n && n > 0)
  ? n.toLocaleString('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
  : '—';

const fmtHours = (n: number | null | undefined) => {
  const val = Number(n ?? 0);
  return val > 0 ? `${Number(val.toFixed(2))}h` : '—';
};

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const isChangeHoursType = (type: string | null | undefined) => (
  type === 'ChangeHours' ||
  type === 'Hoán đổi thời gian làm việc/nghỉ ngơi' ||
  type === 'Hoán đổi ngày nghỉ'
);

function parseRawData(rawData: any): any {
  if (!rawData) return [];
  if (typeof rawData === 'string') {
    try { return JSON.parse(rawData); } catch { return null; }
  }
  return rawData;
}

function getRawFormWidgets(rawData: any): LarkFormWidget[] {
  const data = parseRawData(rawData);
  const form = data?.form;
  return Array.isArray(form) ? form.filter(Boolean) : [];
}

function getChangeTypeValue(row: Pick<ApprovalItem, 'approvalType' | 'rawData'>): string {
  if (!isChangeHoursType(row.approvalType)) return '';
  const widget = getRawFormWidgets(row.rawData).find((item) => {
    const name = String(item.name ?? item.id ?? '').toLowerCase();
    return name.includes('変更タイプ') || name.includes('changetype') || name.includes('change type');
  });
  const value = widget?.value;
  if (Array.isArray(value)) return value.map(String).join(', ');
  return typeof value === 'string' ? value : '';
}

function getChangeDateIntervals(row: Pick<ApprovalItem, 'approvalType' | 'rawData'>): Array<{ start: Date; end: Date; hours: number }> {
  if (!isChangeHoursType(row.approvalType)) return [];
  return getRawFormWidgets(row.rawData)
    .filter((item) => item.type === 'dateInterval' && item.value)
    .map((item) => {
      const value = item.value as { start?: string; end?: string; interval?: number };
      const start = value.start ? new Date(value.start) : null;
      const end = value.end ? new Date(value.end) : null;
      if (!start || !end || start >= end) return null;
      const hours = Number(value.interval ?? ((end.getTime() - start.getTime()) / 3_600_000));
      return { start, end, hours: Number.isFinite(hours) ? hours : 0 };
    })
    .filter((item): item is { start: Date; end: Date; hours: number } => Boolean(item))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function getChangeEffectiveHours(row: Pick<ApprovalItem, 'approvalType' | 'rawData'>): number | null {
  const intervals = getChangeDateIntervals(row);
  const effective = intervals[intervals.length - 1];
  return effective ? effective.hours : null;
}

function getOtEffectiveStart(row: Pick<ApprovalItem, 'approvalType' | 'rawData' | 'startTime'>): Date | null {
  if (row.approvalType !== 'OT' && row.approvalType !== 'Làm thêm giờ') return null;
  const widget = getRawFormWidgets(row.rawData).find((item) => (
    item.type === 'workGroup' ||
    String(item.id ?? '').toLowerCase().includes('workgroup')
  ));
  const start = widget?.value?.start ?? row.startTime;
  if (!start) return null;
  const date = new Date(start);
  return Number.isNaN(date.getTime()) ? null : date;
}

function vnDateKey(d: Date): string {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const day = String(vn.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function fmtDateKey(dateKey: string | null | undefined): string {
  if (!dateKey) return 'không xác định';
  const [y, m, d] = dateKey.split('-');
  return y && m && d ? `${d}/${m}/${y}` : dateKey;
}

function extractSubmittedAtFromRaw(rawData: any, fallbackCreatedAt?: string | null): Date | null {
  const data = parseRawData(rawData);
  const rawStartTime = data?.start_time ?? data?.startTime;
  if (typeof rawStartTime === 'number' || typeof rawStartTime === 'string') {
    const millis = Number(rawStartTime);
    if (Number.isFinite(millis) && millis > 0) return new Date(millis);
  }

  const timeline = data?.timeline;
  if (Array.isArray(timeline)) {
    const startEvent = timeline.find((item) => item && typeof item === 'object' && item.type === 'START');
    const createTime = startEvent?.create_time;
    if (typeof createTime === 'number' || typeof createTime === 'string') {
      const millis = Number(createTime);
      if (Number.isFinite(millis) && millis > 0) return new Date(millis);
    }
  }

  return fallbackCreatedAt ? new Date(fallbackCreatedAt) : null;
}

function buildSubmissionPolicy(
  row: Pick<ApprovalItem, 'rawData'> & Partial<Pick<ApprovalItem, 'createdAt'>>,
  type: ApprovalSubmissionPolicy['type'],
  effectiveStart: Date,
): ApprovalSubmissionPolicy {
  const submittedAt = extractSubmittedAtFromRaw(row.rawData, row.createdAt);
  const submittedDate = submittedAt ? vnDateKey(submittedAt) : null;
  const effectiveDate = vnDateKey(effectiveStart);
  const requiredSubmitFromDate = type === 'OT'
    ? addDaysToDateKey(effectiveDate, -1)
    : undefined;
  const requiredSubmitByDate = type === 'OT'
    ? addDaysToDateKey(effectiveDate, 1)
    : addDaysToDateKey(effectiveDate, -1);
  const isOutsideWindow = !submittedDate
    || submittedDate > requiredSubmitByDate
    || Boolean(requiredSubmitFromDate && submittedDate < requiredSubmitFromDate);
  const subject = type === 'OT' ? 'Phiếu OT' : 'Phiếu đổi ca';

  return {
    type,
    isLate: isOutsideWindow,
    counted: !isOutsideWindow,
    submittedAt: submittedAt ? submittedAt.toISOString() : null,
    submittedDate,
    effectiveDate,
    requiredSubmitFromDate,
    requiredSubmitByDate,
    note: isOutsideWindow
      ? type === 'OT'
        ? `${subject} phải tạo trong khoảng ${fmtDateKey(requiredSubmitFromDate)} đến ${fmtDateKey(requiredSubmitByDate)} cho ngày OT ${fmtDateKey(effectiveDate)}. Phiếu tạo ${fmtDateKey(submittedDate)} nên ngoài hạn và không được tính.`
        : `${subject} cần tạo chậm nhất ${fmtDateKey(requiredSubmitByDate)} cho ngày áp dụng ${fmtDateKey(effectiveDate)}. Phiếu tạo ${fmtDateKey(submittedDate)} nên nộp muộn và không được tính.`
      : type === 'OT'
        ? `${subject} tạo ${fmtDateKey(submittedDate)} trong hạn ${fmtDateKey(requiredSubmitFromDate)} đến ${fmtDateKey(requiredSubmitByDate)} cho ngày OT ${fmtDateKey(effectiveDate)}.`
        : `${subject} tạo ${fmtDateKey(submittedDate)} đúng hạn cho ngày áp dụng ${fmtDateKey(effectiveDate)}.`,
  };
}

function applyFrontendSubmissionPolicyOverride(
  policy: ApprovalSubmissionPolicy | null,
  overrideEnabled?: boolean,
): ApprovalSubmissionPolicy | null {
  if (!policy || !overrideEnabled || !policy.isLate) return policy;
  const subject = policy.type === 'OT' ? 'Phiếu OT' : 'Phiếu đổi ca';
  return {
    ...policy,
    counted: true,
    overrideApplied: true,
    note: policy.requiredSubmitFromDate
      ? `${subject} ngoài khoảng hạn ${fmtDateKey(policy.requiredSubmitFromDate)} đến ${fmtDateKey(policy.requiredSubmitByDate)} cho ngày áp dụng ${fmtDateKey(policy.effectiveDate)}, nhưng đã được miễn trừ thủ công nên vẫn được tính.`
      : `${subject} nộp muộn so với hạn ${fmtDateKey(policy.requiredSubmitByDate)} cho ngày áp dụng ${fmtDateKey(policy.effectiveDate)}, nhưng đã được miễn trừ thủ công nên vẫn được tính.`,
  };
}

function getApprovalSubmissionPolicy(
  row: Pick<ApprovalItem, 'approvalType' | 'rawData' | 'startTime'> & Partial<Pick<ApprovalItem, 'createdAt' | 'submissionPolicy' | 'submissionPolicyOverride'>>
): ApprovalSubmissionPolicy | null {
  if (row.submissionPolicy) return applyFrontendSubmissionPolicyOverride(row.submissionPolicy, row.submissionPolicyOverride);

  const otEffectiveStart = getOtEffectiveStart(row);
  if (otEffectiveStart) {
    return applyFrontendSubmissionPolicyOverride(buildSubmissionPolicy(row, 'OT', otEffectiveStart), row.submissionPolicyOverride);
  }

  const changeType = getChangeTypeValue(row);
  const normalized = changeType.toLowerCase();
  const isWorkTimeChange = (
    changeType.includes('勤務時間変更') ||
    normalized.includes('shift') ||
    normalized.includes('đổi ca') ||
    normalized.includes('doi ca')
  );
  if (!isWorkTimeChange) return null;

  const intervals = getChangeDateIntervals(row);
  const effectiveInterval = intervals.length >= 2 ? intervals[intervals.length - 1] : intervals[0];
  if (!effectiveInterval) return null;

  return applyFrontendSubmissionPolicyOverride(buildSubmissionPolicy(row, 'WORK_TIME_CHANGE', effectiveInterval.start), row.submissionPolicyOverride);
}

function getChangeClassification(row: Pick<ApprovalItem, 'approvalType' | 'rawData'>) {
  const changeType = getChangeTypeValue(row);
  if (!changeType) return null;
  const normalized = changeType.toLowerCase();
  if (
    changeType.includes('休日変更') ||
    normalized.includes('comp') ||
    normalized.includes('nghỉ bù') ||
    normalized.includes('nghi bu')
  ) {
    return {
      label: 'Nghỉ bù',
      sub: '休日変更',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    };
  }
  if (
    changeType.includes('勤務時間変更') ||
    normalized.includes('shift') ||
    normalized.includes('đổi ca') ||
    normalized.includes('doi ca')
  ) {
    return {
      label: 'Đổi ca làm việc',
      sub: '勤務時間変更',
      className: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    };
  }
  return {
    label: 'Đổi lịch khác',
    sub: changeType,
    className: 'border-amber-200 bg-amber-50 text-amber-700',
  };
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { type: 'spring' as const, damping: 25, stiffness: 300 } } };

// ═══════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════

export default function Approvals() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('annual');
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [search, setSearch] = useState('');
  const [selectedApproval, setSelectedApproval] = useState<ApprovalItem | null>(null);
  const [overridePendingId, setOverridePendingId] = useState<string | null>(null);
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(
    (location.state as { openApprovalId?: string } | null)?.openApprovalId ?? null
  );

  // ─── Periods ──────────────────────────────────────────────
  const { data: periods = [] } = useQuery({
    queryKey: ['periods'],
    queryFn: async () => {
      const res = await api.get('/periods');
      return (res.data.data || res.data || []) as Period[];
    },
  });

  // Auto-select first period
  const activePeriodId = selectedPeriodId || periods[0]?.id || '';

  const periodOptions = periods.map(p => ({ value: p.id, label: p.label || p.monthKey }));

  // ─── Active tab filters ───────────────────────────────────
  const currentTab = TABS.find(t => t.key === activeTab) ?? TABS[0];

  // ─── Stats ────────────────────────────────────────────────
  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ['approvals-stats', activePeriodId],
    queryFn: async () => {
      const res = await api.get(`/approvals/stats?periodId=${activePeriodId}`);
      return res.data.data as ApprovalStats;
    },
    enabled: !!activePeriodId,
  });

  // ─── Approvals list ───────────────────────────────────────
  const queryParams = new URLSearchParams();
  if (activePeriodId) queryParams.set('periodId', activePeriodId);
  if (currentTab.filters.type) queryParams.set('type', currentTab.filters.type);
  if (currentTab.filters.leaveTypeBucket) queryParams.set('leaveTypeBucket', currentTab.filters.leaveTypeBucket);
  if (search) queryParams.set('search', search);

  const { data: approvals = [], isLoading: loadingApprovals } = useQuery<ApprovalItem[]>({
    queryKey: ['approvals', activePeriodId, activeTab, search],
    queryFn: async () => {
      const res = await api.get(`/approvals?${queryParams.toString()}`);
      return (res.data.data || []) as ApprovalItem[];
    },
    enabled: !!activePeriodId,
  });

  // Auto-open approval navigated from Attendance page
  useEffect(() => {
    if (!pendingOpenId || approvals.length === 0) return;
    const found = approvals.find(a => a.id === pendingOpenId);
    if (found) {
      setSelectedApproval(found);
      setPendingOpenId(null);
    } else {
      // Approval not in current tab/period — try switching to OT tab
      if (activeTab !== 'ot') {
        setActiveTab('ot');
      } else {
        // Still not found — fetch directly from API
        api.get(`/approvals/${pendingOpenId}`).then(res => {
          const item = res.data.data as ApprovalItem | null;
          if (item) { setSelectedApproval(item); setPendingOpenId(null); }
        }).catch(() => setPendingOpenId(null));
      }
    }
  }, [pendingOpenId, approvals, activeTab]);

  // ─── Sync Mutation ────────────────────────────────────────
  const syncMutation = useMutation({
    mutationFn: async () => {
      const period = periods.find(p => p.id === activePeriodId);
      await api.post('/approvals/sync', {
        startDate: period?.periodStart,
        endDate: period?.periodEnd,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['approvals-stats'] });
      toast('success', 'Đồng bộ Lark thành công!');
    },
    onError: (e: Error) => toast('error', e.message || 'Đồng bộ thất bại'),
  });

  const submissionOverrideMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      await api.patch(`/approvals/${id}/submission-policy-override`, { enabled });
    },
    onMutate: ({ id }) => setOverridePendingId(id),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['approvals-stats'] });
      qc.invalidateQueries({ queryKey: ['approval-detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['payroll'] });
      setSelectedApproval(prev => prev?.id === vars.id ? { ...prev, submissionPolicyOverride: vars.enabled } : prev);
      toast('success', vars.enabled ? 'Đã bật miễn trừ nộp muộn cho phiếu.' : 'Đã tắt miễn trừ nộp muộn cho phiếu.');
    },
    onError: (e: Error) => toast('error', e.message || 'Không cập nhật được miễn trừ nộp muộn'),
    onSettled: () => setOverridePendingId(null),
  });

  const renderLatePolicyStatus = (row: ApprovalItem) => {
    const submissionPolicy = getApprovalSubmissionPolicy(row);
    if (!submissionPolicy?.isLate) return null;

    const isOverride = submissionPolicy.overrideApplied || row.submissionPolicyOverride;
    return (
      <span
        title={submissionPolicy.note}
        className={`w-fit rounded-md border px-2 py-0.5 text-[10px] font-bold leading-tight ${
          isOverride
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-rose-200 bg-rose-50 text-rose-700'
        }`}
      >
        {isOverride ? 'Nộp muộn - đã miễn trừ' : 'Nộp muộn - không tính'}
      </span>
    );
  };

  const renderLatePolicyAction = (row: ApprovalItem) => {
    const submissionPolicy = getApprovalSubmissionPolicy(row);
    if (!submissionPolicy?.isLate) return <span className="text-xs text-muted-foreground">—</span>;

    const isOverride = submissionPolicy.overrideApplied || row.submissionPolicyOverride;
    const isPending = overridePendingId === row.id;
    return (
      <button
        type="button"
        title={isOverride ? 'Tắt miễn trừ, phiếu sẽ không được tính' : submissionPolicy.note}
        disabled={isPending}
        onClick={(event) => {
          event.stopPropagation();
          submissionOverrideMutation.mutate({ id: row.id, enabled: !isOverride });
        }}
        className={`inline-flex min-h-[34px] min-w-[124px] items-center justify-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-extrabold leading-tight shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${
          isOverride
            ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            : 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
        } ${isPending ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
      >
        {isPending ? <Loader2 size={14} className="animate-spin" /> : isOverride ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
        {isOverride ? 'Bỏ miễn trừ' : 'Miễn trừ'}
      </button>
    );
  };

  // ─── Filtered label helper ────────────────────────────────
  const getTypeLabel = (row: ApprovalItem) => {
    const type = row.approvalType;
    if (type === 'OT' || type === 'Làm thêm giờ') return 'Tăng ca (OT)';
    if (type === 'ChangeHours' || type === 'Hoán đổi thời gian làm việc/nghỉ ngơi' || type === 'Hoán đổi ngày nghỉ') return 'Đổi lịch làm việc';
    if (type === 'Correction' || type === 'Quên/chỉnh sửa chấm công') return 'Điều chỉnh chấm công';
    if (type === 'NightShift' || type === 'Ca đêm') return 'Ca đêm';
    return row.leaveType || row.leaveTypeBucket || 'Nghỉ phép';
  };

  // ─── Columns ──────────────────────────────────────────────
  const columns: Column<ApprovalItem>[] = useMemo(() => {
    const cols: Column<ApprovalItem>[] = [
      {
        key: 'employeeName', header: 'Nhân viên', sortable: true, width: '200px',
        render: (row) => (
          <div className="flex items-center gap-3">
            <Avatar name={row.employee.fullName} src={row.employee.avatarUrl ?? undefined} size="sm" />
            <div>
              <p className="text-sm font-medium text-foreground">{row.employee.fullName}</p>
              <p className="text-[10px] text-muted-foreground">{row.employee.department || ''}</p>
            </div>
          </div>
        ),
      },
      {
        key: 'type', header: 'Loại phiếu', sortable: true, width: '130px',
        render: (row) => (
          <span className="text-sm text-foreground">{getTypeLabel(row)}</span>
        ),
      },
      ...(activeTab === 'change' ? [
        {
          key: 'changeClassification', header: 'Phân loại', sortable: false, width: '210px',
          render: (row: ApprovalItem) => {
            const classification = getChangeClassification(row);
            const lateStatus = renderLatePolicyStatus(row);
            if (!classification) return lateStatus ?? <span className="text-xs text-muted-foreground">—</span>;
            return (
              <div className="flex flex-col items-start gap-1">
                <div className={`inline-flex flex-col rounded-lg border px-2.5 py-1 leading-tight ${classification.className}`}>
                  <span className="text-[11px] font-bold">{classification.label}</span>
                  <span className="text-[9px] opacity-75">{classification.sub}</span>
                </div>
                {lateStatus}
              </div>
            );
          },
        } satisfies Column<ApprovalItem>,
        {
          key: 'submissionPolicyOverride', header: 'Miễn trừ nộp muộn', sortable: false, width: '175px',
          render: (row: ApprovalItem) => renderLatePolicyAction(row),
        } satisfies Column<ApprovalItem>,
      ] : []),
      {
        key: 'startTime', header: 'Thời gian BĐ', type: 'date', sortable: true, width: '150px',
        render: (row) => <span className="text-xs font-mono tabular-nums text-foreground">{fmtDateTime(row.startTime)}</span>,
      },
      {
        key: 'endTime', header: 'Thời gian KT', type: 'date', sortable: true, width: '150px',
        render: (row) => <span className="text-xs font-mono tabular-nums text-foreground">{fmtDateTime(row.endTime)}</span>,
      },
    ];

    if (activeTab === 'ot') {
      cols.push({
        key: 'otSegments', header: 'Mapping OT', sortable: false, width: '390px',
        render: (row) => {
          const segments = row.otSegments || [];
          const lateStatus = renderLatePolicyStatus(row);
          if (segments.length === 0) {
            const labels = row.otLabels || [];
            if (labels.length === 0) return lateStatus ?? <span className="text-xs text-muted-foreground">—</span>;
            return (
              <div className="flex flex-col gap-1 max-w-[370px]">
                {lateStatus}
                <div className="flex flex-wrap gap-1">
                  {labels.map((lbl: string, idx: number) => (
                    <span key={idx} className={`inline-flex items-center text-[10px] font-bold font-mono px-2 py-0.5 rounded border leading-none whitespace-nowrap ${bucketColor(lbl)}`} title={lbl}>
                      {OT_BUCKET_LABELS[lbl] || lbl}
                    </span>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <div className="flex flex-col gap-1 max-w-[390px]">
              {lateStatus}
              {segments.map((seg, idx) => (
                <div key={`${seg.bucket}-${idx}`} className="flex items-center gap-1.5 text-[10px] leading-tight">
                  <span className={`inline-flex shrink-0 items-center px-1.5 py-0.5 rounded border font-bold ${bucketColor(seg.bucket)}`} title={seg.bucket}>
                    {seg.label || OT_BUCKET_LABELS[seg.bucket] || seg.bucket}
                  </span>
                  <span className="font-mono tabular-nums text-foreground">
                    {fmtHours(seg.effectiveHours)} x {fmtVND(seg.otHourlyRate)} = {fmtVND(seg.amount)}
                  </span>
                </div>
              ))}
            </div>
          );
        }
      });
      cols.push({
        key: 'submissionPolicyOverride', header: 'Miễn trừ nộp muộn', sortable: false, width: '175px',
        render: (row) => renderLatePolicyAction(row),
      });
      cols.push(
        {
          key: 'otActualHours', header: 'Giờ tính lương', type: 'number', sortable: false, width: '110px',
          render: (row) => (
            <span className="text-xs font-mono font-semibold tabular-nums text-purple-700">
              {fmtHours(row.otSummary?.hours)}
            </span>
          ),
        },
        {
          key: 'otAmount', header: 'Tiền OT', type: 'number', sortable: false, width: '120px',
          render: (row) => (
            <span className="text-xs font-mono font-semibold tabular-nums text-emerald-700">
              {fmtVND(row.otSummary?.amount)}
            </span>
          ),
        }
      );
    }

    cols.push(
      {
        key: 'totalHours', header: 'Số giờ/ngày', type: 'number', sortable: true, width: '100px',
        render: (row) => {
          const changeHours = getChangeEffectiveHours(row);
          return (
            <span className="text-xs font-mono tabular-nums text-foreground">
              {changeHours != null && changeHours > 0
                ? `${Number(changeHours.toFixed(2))}h`
                : row.approvedHours > 0
                  ? `${Number(row.approvedHours.toFixed(2))}h`
                  : row.approvedDays > 0
                    ? `${Number(row.approvedDays.toFixed(2))}d`
                    : '—'}
            </span>
          );
        },
      },
      {
        key: 'status', header: 'Trạng thái', sortable: true, width: '110px',
        render: (row) => {
          const info = STATUS_MAP[row.status] ?? STATUS_MAP.PENDING!;
          return <StatusBadge status={info.status} label={info.label} />;
        },
      },
      {
        key: 'serialNumber', header: 'Mã phiếu', sortable: true, width: '110px',
        render: (row) => (
          <span className="text-xs font-mono text-muted-foreground">{row.serialNumber || row.instanceCode?.slice(0, 8) || '—'}</span>
        ),
      }
    );

    return cols;
  }, [activeTab, overridePendingId]);

  // ═══════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }} className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <PageHeader title="Phiếu phê duyệt" subtitle="Quản lý nghỉ phép, tăng ca, đổi lịch từ Lark" />
        <div className="flex items-center gap-3">
          <Dropdown
            options={periodOptions}
            value={activePeriodId}
            onChange={setSelectedPeriodId}
            placeholder="Chọn kỳ..."
            className="w-48"
          />
          <Button variant="outline" size="sm" icon={RefreshCw}
            loading={syncMutation.isPending}
            onClick={() => syncMutation.mutate()}>
            Đồng bộ Lark
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      {loadingStats ? (
        <LoadingSkeleton type="kpi" />
      ) : (
        <motion.div variants={container} initial="hidden" animate="show"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <motion.div variants={item}>
            <KpiCard label="Tổng phiếu" value={stats?.total ?? 0} icon={FileText} color="#7c3aed" />
          </motion.div>
          <motion.div variants={item}>
            <KpiCard label="Đã duyệt" value={stats?.approved ?? 0} icon={ClipboardCheck} color="#16a34a" />
          </motion.div>
          <motion.div variants={item}>
            <KpiCard label="Đang chờ" value={stats?.pending ?? 0} icon={Clock} color="#d97706" />
          </motion.div>
          <motion.div variants={item}>
            <KpiCard label="Từ chối" value={stats?.rejected ?? 0} icon={XCircle} color="#dc2626" />
          </motion.div>
        </motion.div>
      )}

      {/* Tab Navigation + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex gap-1 bg-muted/30 rounded-xl p-1 border border-border overflow-x-auto">
          {TABS.map(tab => {
            const isActive = activeTab === tab.key;
            const hint = (tab as any).hint as string | undefined;
            return (
              <motion.button key={tab.key} whileTap={{ scale: 0.97 }} onClick={() => setActiveTab(tab.key)}
                title={hint}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/25'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}>
                {tab.label}
              </motion.button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm nhân viên..."
            className="w-full bg-background border border-input rounded-xl pl-9 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 shadow-xs"
          />
        </div>
      </div>

      {/* Data Table */}
      <AnimatePresence mode="wait">
        <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>

          {!activePeriodId ? (
            <EmptyState
              icon={CalendarRange}
              title="Chưa chọn kỳ lương"
              description="Vui lòng chọn kỳ lương để xem phiếu phê duyệt."
            />
          ) : loadingApprovals ? (
            <DataTable<ApprovalItem>
              columns={columns}
              data={[]}
              loading={true}
              rowKey="id"
            />
          ) : approvals.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="Không có phiếu nào"
              description={`Không tìm thấy phiếu ${currentTab.label} trong kỳ đã chọn.`}
            />
          ) : (
            <DataTable<ApprovalItem>
              columns={columns}
              data={approvals}
              pageSize={15}
              rowKey="id"
              onRowClick={(row) => setSelectedApproval(row)}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Detail Modal */}
      <ApprovalDetailModal
        approval={selectedApproval}
        onClose={() => setSelectedApproval(null)}
        getTypeLabel={getTypeLabel}
        onToggleSubmissionPolicyOverride={(approval, enabled) => submissionOverrideMutation.mutate({ id: approval.id, enabled })}
        overridePendingId={overridePendingId}
      />
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════
// Detail Modal
// ═══════════════════════════════════════════════════════════

function formatLarkTimestamp(tsStr: string): string {
  if (!tsStr) return '';
  try {
    const date = new Date(tsStr);
    if (isNaN(date.getTime())) return tsStr;

    // Check if time is exactly 00:00:00 local time (which often indicates a date-only field)
    const localHour = date.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    if (localHour === '00:00:00') {
      return date.toLocaleDateString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
    }

    return date.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour12: false
    });
  } catch {
    return tsStr;
  }
}

function formatLarkFieldValue(value: any): React.ReactNode {
  if (value == null) return '—';

  // 1. Array of values
  if (Array.isArray(value)) {
    return value.map(val => {
      if (typeof val === 'object' && val) {
        return val.text || val.name || JSON.stringify(val);
      }
      return String(val);
    }).join(', ');
  }

  // 2. DateInterval object
  if (typeof value === 'object' && value && ('start' in value || 'end' in value)) {
    const start = value.start ? formatLarkTimestamp(value.start) : '';
    const end = value.end ? formatLarkTimestamp(value.end) : '';
    const interval = value.interval;
    const unit = value.unit === 'HOUR' ? 'tiếng' : value.unit === 'DAY' ? 'ngày' : 'tiếng';
    
    if (start && end) {
      return (
        <span className="tabular-nums font-mono">
          {start} – {end} {interval !== undefined ? `(${interval} ${unit})` : ''}
        </span>
      );
    }
    if (start) return <span className="tabular-nums font-mono">{start}</span>;
    if (end) return <span className="tabular-nums font-mono">{end}</span>;
  }

  // 3. General object
  if (typeof value === 'object' && value) {
    if (value.text) return value.text;
    if (value.name) return value.name;
    // Check if it's a stringified JSON of DateInterval
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (parsed && typeof parsed === 'object' && ('start' in parsed || 'end' in parsed)) {
        return formatLarkFieldValue(parsed);
      }
    } catch {}
    return JSON.stringify(value);
  }

  // 4. ISO timestamp string or numeric string matching ISO
  if (typeof value === 'string') {
    // Check if it's an ISO timestamp
    const isoReg = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    if (isoReg.test(value)) {
      return <span className="tabular-nums font-mono">{formatLarkTimestamp(value)}</span>;
    }
    // Check if it's a JSON string of DateInterval
    if (value.startsWith('{') && value.includes('start') && value.includes('end')) {
      try {
        const parsed = JSON.parse(value);
        return formatLarkFieldValue(parsed);
      } catch {}
    }
  }

  return String(value);
}

const LARK_FIELD_TRANSLATIONS: Record<string, string> = {
  '稟議書番号': 'Số tài liệu Lark',
  '起案者': 'Người đề xuất',
  '起案部署': 'Bộ phận đề xuất',
  '変更タイプ': 'Loại thay đổi ca',
  'reason理由': 'Lý do',
  'reason': 'Lý do',
  'description 1': 'Mô tả chi tiết',
  'description': 'Mô tả',
  'dateinterval': 'Khoảng thời gian (DateInterval)',
};

function translateLarkFieldName(name: string, index: number, allFields: any[]) {
  const cleanName = name.trim();
  const lower = cleanName.toLowerCase();

  if (lower === 'dateinterval') {
    const dateIntervals = allFields.filter(f => f.name.toLowerCase() === 'dateinterval');
    if (dateIntervals.length > 1) {
      const occurrenceIndex = dateIntervals.indexOf(allFields[index]);
      if (occurrenceIndex === 0) return 'Thời gian làm bù / Khung giờ gốc';
      if (occurrenceIndex === 1) return 'Thời gian nghỉ bù / Khung giờ mới';
      return `Khung thời gian ${occurrenceIndex + 1}`;
    }
    return 'Khung thời gian đăng ký';
  }

  return LARK_FIELD_TRANSLATIONS[cleanName] || LARK_FIELD_TRANSLATIONS[lower] || cleanName;
}

function LarkFormFields({ rawData }: { rawData: any }) {
  const form = rawData?.form as Array<{ id: string; name: string; type: string; value: any }> | undefined;
  if (!form || !Array.isArray(form)) return null;

  // Filter useful fields to display
  const usefulFields = form.filter(f => {
    if (!f.name || f.value == null) return false;
    
    // Ignore big group widgets like workGroup or leaveGroup since they are parsed into timelines
    const type = (f.type || '').toLowerCase();
    if (type === 'workgroup' || type === 'leavegroup' || type === 'leavegroupv2') return false;
    
    // Skip empty values
    if (typeof f.value === 'string' && f.value.trim() === '') return false;
    if (Array.isArray(f.value) && f.value.length === 0) return false;
    
    // Skip system/calculated fields that don't provide value to user
    const name = f.name.toLowerCase();
    if (name.includes('id') || name.includes('mã số') || name.includes('trạng thái') || name.includes('instance')) return false;

    return true;
  });

  if (usefulFields.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3 mt-6">
      <p className="text-xs font-bold text-foreground uppercase tracking-wide flex items-center gap-1.5 border-b border-border pb-2.5">
        📝 Chi tiết đơn đăng ký (Lark Form)
      </p>
      <div className="space-y-2.5 text-xs">
        {usefulFields.map((f, i) => {
          // Special parser for remedyGroupV2 (Correction/Quên chấm công)
          if (f.type === 'remedyGroupV2' || f.type === 'remedyGroup' || f.id?.toLowerCase().includes('remedy')) {
            const v = f.value as any;
            if (v && typeof v === 'object') {
              const rDate = v.widgetRemedyGroupV2RemedyDate?.text || v.widgetRemedyGroupV2RemedyDate || '';
              const rTime = v.widgetRemedyGroupV2RemedyTime?.text || v.widgetRemedyGroupV2RemedyTime || '';
              const reason = v.widgetRemedyGroupV2Reason || v.reason || '';
              const clockTime = v.widgetRemedyGroupV2ClockTime?.text || v.widgetRemedyGroupV2ClockTime?.value || '';
              const punchNo = v.punchNo;
              const punchLabel = punchNo === 0 ? 'Check-in (Lần 1)' : punchNo === 1 ? 'Check-out (Lần 2)' : `Lần ${punchNo + 1}`;

              return (
                <div key={f.id || i} className="space-y-2 bg-amber-50/20 dark:bg-amber-950/20 border border-amber-300 rounded-xl p-4 mt-2">
                  <div className="flex items-center gap-1.5 border-b border-amber-300 pb-2.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                    <span>🕒 Chi tiết điều chỉnh chấm công (Remedy)</span>
                  </div>
                  <div className="space-y-2.5 text-xs">
                    {[
                      { label: 'Ngày cần điều chỉnh', value: <span className="font-semibold text-foreground">{rDate}</span> },
                      { label: 'Mốc điều chỉnh', value: <span className="font-bold text-amber-700 dark:text-amber-400">{punchLabel}</span> },
                      { label: 'Giờ điều chỉnh thành', value: <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{rTime.includes(' ') ? rTime.split(' ')[1] : rTime}</span> },
                      { label: 'Thông tin gốc', value: <span className="text-muted-foreground font-mono text-[11px]">{clockTime || 'Chưa ghi nhận'}</span> },
                      { label: 'Lý do xin điều chỉnh', value: <span className="text-foreground font-semibold italic">"{reason}"</span> },
                    ].map((row, idx) => (
                      <div key={idx} className="grid grid-cols-3 gap-2 py-2 border-b border-amber-200/20 last:border-0 items-start">
                        <span className="text-muted-foreground font-medium">{row.label}</span>
                        <span className="col-span-2">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
          }

          const displayVal = formatLarkFieldValue(f.value);
          if (!displayVal || displayVal === '—' || displayVal === '{}') return null;

          const friendlyName = translateLarkFieldName(f.name, i, usefulFields);
          const originalName = f.name;

          return (
            <div key={f.id || i} className="grid grid-cols-3 gap-2 py-2 border-b border-border/30 last:border-0 items-start">
              <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                {friendlyName}
                <span className="relative group inline-flex items-center">
                  <span className="text-muted-foreground/40 hover:text-muted-foreground cursor-help transition-colors inline-flex">
                    <Info size={11} />
                  </span>
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:flex flex-col items-center pointer-events-none z-50">
                    <span className="bg-slate-900 text-white text-[10px] font-medium px-2 py-1 rounded shadow-lg whitespace-nowrap">
                      Tên gốc: {originalName}
                    </span>
                    <span className="w-1.5 h-1.5 bg-slate-900 rotate-45 -mt-1"></span>
                  </span>
                </span>
              </span>
              <span className="col-span-2 text-foreground font-bold break-words">{displayVal}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function parseLeaveDetails(rawData: any) {
  if (!rawData) return null;
  let data = rawData;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  let form = data?.form;
  if (typeof form === 'string') {
    try { form = JSON.parse(form); } catch { }
  }
  if (!form || !Array.isArray(form)) {
    if (Array.isArray(data)) form = data;
    else return null;
  }

  const widgets = form as LarkFormWidget[];
  const leaveWidget = widgets.find((f) => 
    f.type === 'leaveGroupV2' || 
    f.type === 'leaveGroup' || 
    f.id?.toLowerCase().includes('leave')
  );

  const reasonField = widgets.find((f) => {
    const name = (f.name || '').toLowerCase();
    return name.includes('lý do') || name.includes('reason') || name.includes('理由');
  });

  const parsedReason = leaveWidget?.value?.reason || reasonField?.value || '';

  if (!leaveWidget || !leaveWidget.value) {
    return {
      start: null,
      end: null,
      interval: null,
      unit: null,
      reason: parsedReason,
      name: null,
    };
  }

  const v = leaveWidget.value;
  return {
    start: v.start || v.startTime || null,
    end: v.end || v.endTime || null,
    interval: v.interval || null,
    unit: v.unit || null,
    reason: parsedReason,
    name: v.name || null,
  };
}

function parseRemedyDetails(rawData: any) {
  if (!rawData) return null;
  let data = rawData;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  let form = data?.form;
  if (typeof form === 'string') {
    try { form = JSON.parse(form); } catch { }
  }
  if (!form || !Array.isArray(form)) {
    if (Array.isArray(data)) form = data;
    else return null;
  }

  const widgets = form as LarkFormWidget[];
  const remedyWidget = widgets.find((f) => f.type === 'remedyGroupV2' || f.type === 'remedyGroup' || f.id?.toLowerCase().includes('remedy'));
  if (!remedyWidget || !remedyWidget.value) return null;

  const v = remedyWidget.value;
  const remedyDate = v.widgetRemedyGroupV2RemedyDate?.text || v.widgetRemedyGroupV2RemedyDate || '';
  const remedyTime = v.widgetRemedyGroupV2RemedyTime?.text || v.widgetRemedyGroupV2RemedyTime || '';
  const reason = v.widgetRemedyGroupV2Reason || v.reason || '';
  const clockTime = v.widgetRemedyGroupV2ClockTime?.text || v.widgetRemedyGroupV2ClockTime?.value || '';
  const punchNo = v.punchNo;
  const punchLabel = punchNo === 0 ? 'Check-in (Lần 1)' : punchNo === 1 ? 'Check-out (Lần 2)' : `Lần ${punchNo + 1}`;

  // format remedyDate to DD/MM/YYYY
  let formattedDate = remedyDate;
  if (remedyDate && typeof remedyDate === 'string') {
    const parts = remedyDate.split('-');
    if (parts.length === 3) {
      formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  }

  return {
    remedyDate: formattedDate,
    punchLabel,
    remedyTime: remedyTime.includes(' ') ? remedyTime.split(' ')[1] : remedyTime,
    originalTime: clockTime,
    reason,
  };
}

function ApprovalDetailModal({ approval, onClose, getTypeLabel, onToggleSubmissionPolicyOverride, overridePendingId }: {
  approval: ApprovalItem | null;
  onClose: () => void;
  getTypeLabel: (row: ApprovalItem) => string;
  onToggleSubmissionPolicyOverride: (approval: ApprovalItem, enabled: boolean) => void;
  overridePendingId: string | null;
}) {
  const approvalId = approval?.id;
  const { data: otDetail, isLoading: loadingOtDetail } = useQuery({
    queryKey: ['approval-detail', approvalId],
    queryFn: async () => {
      if (!approvalId) throw new Error('Missing approval id');
      const res = await api.get(`/approvals/${approvalId}`);
      return res.data.data as ApprovalDetail;
    },
    enabled: !!approvalId,
  });

  if (!approval) return null;

  const isOT = approval.approvalType === 'OT' || approval.approvalType === 'Làm thêm giờ' || approval.approvalType === 'NightShift' || approval.approvalType === 'Ca đêm';
  const isChangeHours = approval.approvalType === 'ChangeHours' || approval.approvalType === 'Hoán đổi thời gian làm việc/nghỉ ngơi' || approval.approvalType === 'Hoán đổi ngày nghỉ';

  const info = STATUS_MAP[approval.status] ?? STATUS_MAP.PENDING!;

  // OT salary calculation is resolved by the API from the payroll period.
  const hourlyRate = otDetail?.hourlyRate ?? approval.hourlyRate ?? 0;
  const baseSalary = otDetail?.baseSalary ?? approval.baseSalary ?? 0;
  const rankAllowance = otDetail?.rankAllowance ?? approval.rankAllowance ?? 0;
  const payrollSalary = otDetail?.payrollSalary ?? approval.payrollSalary ?? (baseSalary + rankAllowance);
  const standardDays = otDetail?.standardDays ?? approval.standardDays ?? 0;
  const otBuckets = otDetail?.otBuckets ?? otDetail?.otSegments ?? approval.otSegments ?? null;
  const otPolicy = otDetail?.otPolicy ?? null;
  const isCompLeaveOtPolicy = !!otPolicy && /nghỉ bù|nghi bu/i.test(otPolicy);
  const compLeaveMatches = otDetail?.compLeaveMatches ?? [];

  // Format currency VND
  const fmtVND = (n: number) => n > 0
    ? n.toLocaleString('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
    : '—';

  // Format datetime HH:mm DD/MM/YYYY (VN timezone)
  const fmtDT = (d: string | null | undefined) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour12: false,
    }); // returns "HH:mm, DD/MM/YYYY"
  };



  // Use backend OT mapping so list, modal, payroll, and export share the same source of truth.
  const bucketCosts = otBuckets?.map(b => ({
    ...b,
    effectiveHours: b.effectiveHours ?? b.validHours ?? 0,
    cost: b.amount ?? 0,
    hourlyRate: b.hourlyRate ?? hourlyRate,
    otHourlyRate: b.otHourlyRate ?? (hourlyRate * b.rate),
  })) ?? [];

  const totalOtCost = bucketCosts.reduce((s, b) => s + b.cost, 0);
  const totalOtHours = bucketCosts.reduce((s, b) => s + b.effectiveHours, 0);

  const isLeaveType = approval.approvalType === 'Leave' || approval.approvalType === 'Nghỉ phép';
  const isCorrectionType = approval.approvalType === 'Correction' || approval.approvalType === 'Quên/chỉnh sửa chấm công';
  const isChangeType = approval.approvalType === 'ChangeHours' || approval.approvalType === 'Hoán đổi thời gian làm việc/nghỉ ngơi' || approval.approvalType === 'Hoán đổi ngày nghỉ' || approval.approvalType === 'NightShift' || approval.approvalType === 'Ca đêm';

  // Parse leave details from rawData if this is a Leave type ticket
  const leaveDetails = isLeaveType ? parseLeaveDetails(otDetail?.rawData) : null;
  const startDate = leaveDetails?.start ? new Date(leaveDetails.start) : (approval.startTime ? new Date(approval.startTime) : null);
  const endDate = leaveDetails?.end ? new Date(leaveDetails.end) : (approval.endTime ? new Date(approval.endTime) : null);

  let displayDays = '—';
  let displayHours = '—';
  let displayDaysVal = 0;
  let displayHoursVal = 0;

  if (leaveDetails?.interval != null && leaveDetails?.unit != null) {
    const val = Number(leaveDetails.interval);
    if (leaveDetails.unit.toUpperCase() === 'DAY') {
      displayDaysVal = val;
      displayHoursVal = val * 8;
    } else if (leaveDetails.unit.toUpperCase() === 'HOUR') {
      displayDaysVal = val / 8;
      displayHoursVal = val;
    }
    displayDays = displayDaysVal > 0 ? `${Number(displayDaysVal.toFixed(2))} ngày` : '—';
    displayHours = displayHoursVal > 0 ? `${Number(displayHoursVal.toFixed(2))}h` : '—';
  } else {
    displayDaysVal = approval.approvedDays;
    displayHoursVal = approval.approvedHours;
    displayDays = displayDaysVal > 0 ? `${Number(displayDaysVal.toFixed(2))} ngày` : '—';
    displayHours = displayHoursVal > 0 ? `${Number(displayHoursVal.toFixed(2))}h` : '—';
  }

  // changeWorkingFrame chứa shiftStart/shiftEnd = khung giờ ca MỚI (từ rawData)
  const changeFrame = otDetail?.changeWorkingFrame ?? null;
  const newShiftStart = changeFrame?.shiftStart ? new Date(changeFrame.shiftStart) : null;
  const newShiftEnd   = changeFrame?.shiftEnd   ? new Date(changeFrame.shiftEnd)   : null;
  const isCompLeave   = !!(changeFrame?.compLeaveHours && changeFrame.compLeaveHours > 0);
  const workedPeriodStart = changeFrame?.workedPeriodStart ? new Date(changeFrame.workedPeriodStart) : null;
  const workedPeriodEnd   = changeFrame?.workedPeriodEnd   ? new Date(changeFrame.workedPeriodEnd)   : null;
  const changeShiftHours = newShiftStart && newShiftEnd
    ? Math.max(0, (newShiftEnd.getTime() - newShiftStart.getTime()) / 3_600_000)
    : 0;
  const changeSubmissionPolicy = changeFrame?.submissionPolicy
    ?? getApprovalSubmissionPolicy({ ...approval, rawData: otDetail?.rawData ?? approval.rawData, submissionPolicy: otDetail?.submissionPolicy ?? approval.submissionPolicy });
  const detailSubmissionPolicy = otDetail?.submissionPolicy
    ?? getApprovalSubmissionPolicy({ ...approval, rawData: otDetail?.rawData ?? approval.rawData, submissionPolicy: approval.submissionPolicy });
  const renderDetailLatePolicy = (policy: ApprovalSubmissionPolicy | null | undefined) => {
    if (!policy?.isLate) return null;
    const isOverride = policy.overrideApplied || approval.submissionPolicyOverride;
    const isPending = overridePendingId === approval.id;
    return (
      <div className={`mb-3 rounded-lg border px-3 py-2 text-[10px] leading-relaxed ${
        isOverride
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-rose-200 bg-rose-50 text-rose-700'
      }`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="font-bold">{isOverride ? 'Nộp muộn - đã miễn trừ:' : 'Nộp muộn - không tính:'}</span> {policy.note}
          </div>
          <Button
            size="md"
            variant={isOverride ? 'outline' : 'success'}
            loading={isPending}
            icon={isOverride ? XCircle : CheckCircle2}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSubmissionPolicyOverride(approval, !isOverride);
            }}
            className="min-w-[124px] shrink-0 font-extrabold shadow-sm"
          >
            {isOverride ? 'Bỏ miễn trừ' : 'Miễn trừ'}
          </Button>
        </div>
      </div>
    );
  };

  const fmtShiftTime = (d: Date | null) => d
    ? d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';
  const fmtShiftDate = (d: Date | null) => d
    ? d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';

  const fields: Array<{ label: string; value: React.ReactNode; icon?: React.ElementType; hide?: boolean }> = [
    { label: 'Mã phiếu', value: <span className="font-mono text-sm">{approval.serialNumber || approval.instanceCode}</span>, icon: Hash },
    { label: 'Nhân viên', value: (
      <div className="flex items-center gap-2">
        <Avatar name={approval.employee.fullName} src={approval.employee.avatarUrl ?? undefined} size="sm" />
        <div>
          <p className="text-sm font-medium text-foreground">{approval.employee.fullName}</p>
          <p className="text-[10px] text-muted-foreground">{approval.employee.department || ''}</p>
        </div>
      </div>
    ), icon: User },
    { label: 'Loại phiếu', value: getTypeLabel(approval), icon: Tag },
    { label: 'Trạng thái', value: <StatusBadge status={info.status} label={info.label} />, icon: CheckCircle2 },
    // Ngày bắt đầu/kết thúc: lấy từ form đối với Leave, từ timeline đối với OT/ChangeHours
    { label: 'Ngày bắt đầu', value: <span className="tabular-nums">{startDate ? fmtDateTime(startDate.toISOString()) : '—'}</span>, icon: CalendarRange, hide: isChangeType || isCorrectionType },
    { label: 'Ngày kết thúc', value: <span className="tabular-nums">{endDate ? fmtDateTime(endDate.toISOString()) : '—'}</span>, icon: CalendarDays, hide: isChangeType || isCorrectionType },
    { label: 'Số giờ', value: displayHoursVal > 0 ? <span className="font-mono tabular-nums font-semibold">{displayHours}</span> : '—', icon: Clock, hide: (isLeaveType && displayHoursVal === 0) || isChangeType || isCorrectionType },
    { label: 'Số ngày', value: displayDaysVal > 0 ? <span className="font-mono tabular-nums font-semibold">{displayDays}</span> : '—', icon: CalendarClock, hide: (!isLeaveType && !isChangeType) || isCorrectionType },
    { label: 'Loại nghỉ', value: approval.leaveType || '—', icon: BedDouble, hide: !isLeaveType },
    { label: 'Đòng bộ lúc', value: <span className="tabular-nums">{fmtDateTime(approval.syncedAt)}</span>, icon: RefreshCw },
    { label: 'Ngày tạo', value: <span className="tabular-nums">{fmtDateTime(approval.createdAt)}</span>, icon: PlusCircle },
  ];

  return (
    <Modal isOpen={!!approval} onClose={onClose} title="Chi tiết phiếu phê duyệt" size="4xl">
      <div className="space-y-1">
        {fields.filter(f => !f.hide).map((f, i) => (
          <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }}
            className="flex items-baseline gap-4 py-2.5 border-b border-border/30 last:border-0">
            <div className="w-36 shrink-0 flex items-center gap-1.5">
              {/* Fixed-width icon slot so all labels align at the same position */}
              <span className="w-3.5 shrink-0 flex items-center justify-center text-muted-foreground/60">
                {f.icon && <f.icon size={11} strokeWidth={1.5} />}
              </span>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider leading-none">
                {f.label}
              </p>
            </div>
            <div className="flex-1 text-sm text-foreground">{f.value}</div>
          </motion.div>
        ))}

        {/* ── OT Salary Breakdown ── */}
        {isOT && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="pt-2">

            {/* Salary info row */}
            {hourlyRate > 0 && (
              <div className="mb-3 rounded-xl bg-gradient-to-r from-slate-50 to-blue-50 border border-blue-100 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp size={14} className="text-blue-600" />
                  <span className="text-xs font-bold text-blue-700 uppercase tracking-wide">Lương theo giờ</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-white rounded-lg p-2 border border-blue-100">
                    <div className="text-[10px] text-muted-foreground mb-1" title="Lương tính công = Lương cơ bản + Phụ cấp cấp bậc">Lương tính công</div>
                    <div className="text-sm font-bold text-foreground tabular-nums">{fmtVND(payrollSalary)}</div>
                  </div>
                  <div className="bg-white rounded-lg p-2 border border-blue-100">
                    <div className="text-[10px] text-muted-foreground mb-1">Số giờ OT</div>
                    <div className="text-sm font-bold text-blue-600 tabular-nums">{totalOtHours.toFixed(2)}h</div>
                  </div>
                  <div className="bg-white rounded-lg p-2 border border-emerald-100">
                    <div className="text-[10px] text-muted-foreground mb-1" title="Lương/giờ = Lương tính công / ngày chuẩn / 8, làm tròn lên bội số 10">Lương/giờ</div>
                    <div className="text-sm font-bold text-emerald-600 tabular-nums">{fmtVND(hourlyRate)}</div>
                    {standardDays > 0 && (
                      <div className="text-[9px] text-muted-foreground mt-0.5">{standardDays} ngày chuẩn</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {renderDetailLatePolicy(detailSubmissionPolicy)}

            {/* Bucket breakdown table */}
            {loadingOtDetail ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <Loader2 size={14} className="animate-spin" /> Đang tải chi tiết OT...
              </div>
            ) : bucketCosts.length > 0 ? (
              <div className="rounded-xl border border-border/50 overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b border-border/30">
                  <Zap size={13} className="text-amber-500" />
                  <span className="text-xs font-bold text-foreground uppercase tracking-wide">
                    {isCompLeaveOtPolicy ? 'Phân loại OT và nghỉ bù' : 'Phân loại OT và tiền lương'}
                  </span>
                  {otPolicy && (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                      {otPolicy}
                    </span>
                  )}
                </div>

                {/* Salary reference strip */}
                <div className="grid grid-cols-3 gap-px bg-muted/30 border-b border-border/20">
                  <div className="bg-card px-3 py-2 text-center">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5" title="Lương tính công = Lương cơ bản + Phụ cấp cấp bậc">Lương tính công</div>
                    <div className="text-xs font-bold text-foreground tabular-nums">{fmtVND(payrollSalary)}</div>
                  </div>
                  <div className="bg-card px-3 py-2 text-center">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5" title="Lương/giờ = Lương tính công / ngày chuẩn / 8, làm tròn lên bội số 10">Lương tính công / giờ</div>
                    <div className="text-xs font-bold text-emerald-600 tabular-nums">{fmtVND(hourlyRate)}</div>
                  </div>
                  <div className="bg-card px-3 py-2 text-center">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Tổng giờ OT</div>
                    <div className="text-xs font-bold text-blue-600 tabular-nums">{totalOtHours.toFixed(2)}h</div>
                  </div>
                </div>

                {/* Scrollable table */}
                <div className="overflow-x-auto">
                  <div className="w-full">
                    {/* Table header — 7 columns */}
                    <div className="grid grid-cols-[1fr_1.8fr_1fr_0.7fr_1fr_0.8fr_1fr] px-3 py-2 bg-muted/20 border-b border-border/20 text-[9px] font-bold text-muted-foreground uppercase tracking-wider gap-2">
                      <div>Bucket</div>
                      <div>Khung giờ</div>
                      <div className="text-right">Lương/giờ</div>
                      <div className="text-center">Hệ số</div>
                      <div className="text-right">Lương giờ OT</div>
                      <div className="text-right">Số giờ</div>
                      <div className="text-right">Thành tiền</div>
                    </div>

                    {/* Bucket rows */}
                    {bucketCosts.map((b, i) => {
                      const baseHourlyRate = b.hourlyRate ?? hourlyRate;
                      const hourlyOtRate = b.otHourlyRate ?? (baseHourlyRate * b.rate);
                      return (
                        <div key={i} className={`grid grid-cols-[1fr_1.8fr_1fr_0.7fr_1fr_0.8fr_1fr] px-3 py-3 border-b border-border/20 last:border-0 items-start gap-2 ${i % 2 === 0 ? 'bg-card' : 'bg-muted/10'}`}>
                          {/* Bucket */}
                          <div>
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${bucketColor(b.bucket)}`}>
                              <Zap size={8} />
                              {b.label || OT_BUCKET_LABELS[b.bucket] || b.bucket}
                            </span>
                            {b.frame === 'night' && <div className="text-[8px] text-indigo-400 mt-0.5">Ban đêm</div>}
                          </div>
                          {/* Khung giờ */}
                          <div className="text-[10px] text-muted-foreground leading-relaxed tabular-nums">
                            {b.startTime && b.endTime ? (
                              <>
                                <div className="text-foreground font-medium">{fmtDT(b.startTime)}</div>
                                <div className="text-[9px] text-muted-foreground">→ {fmtDT(b.endTime)}</div>
                              </>
                            ) : '—'}
                          </div>
                          {/* Lương/giờ */}
                          <div className="text-right">
                            <span className="text-[11px] font-semibold text-foreground tabular-nums">{fmtVND(baseHourlyRate)}</span>
                          </div>
                          {/* Hệ số */}
                          <div className="text-center">
                            <span className="text-sm font-bold text-amber-600 tabular-nums">x{b.rate}</span>
                          </div>
                          {/* Lương giờ OT */}
                          <div className="text-right">
                            {hourlyRate > 0
                              ? <span className="text-[11px] font-semibold text-blue-700 tabular-nums">{fmtVND(hourlyOtRate)}</span>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </div>
                          {/* Số giờ */}
                          <div className="text-right">
                            <span className="text-sm font-mono font-bold tabular-nums text-foreground">{b.effectiveHours.toFixed(2)}h</span>
                            {b.approvedHours !== b.effectiveHours && (
                              <div className="text-[8px] text-muted-foreground">duyệt {b.approvedHours.toFixed(2)}h</div>
                            )}
                            {b.validHours === 0 && b.approvedHours > 0 && (
                              <div className="text-[8px] text-orange-400">chưa có giờ thực tế</div>
                            )}
                          </div>
                          {/* Thành tiền */}
                          <div className="text-right">
                            {hourlyRate > 0
                              ? <span className={`text-sm font-bold tabular-nums ${b.cost > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                                  {b.cost > 0 ? fmtVND(b.cost) : 'Nghỉ bù'}
                                </span>
                              : <span className="text-xs text-muted-foreground">—</span>}
                          </div>
                        </div>
                      );
                    })}

                    {/* Total row */}
                    {hourlyRate > 0 && (
                      <div className="grid grid-cols-[1fr_1.8fr_1fr_0.7fr_1fr_0.8fr_1fr] px-3 py-3 bg-emerald-50 dark:bg-emerald-950/20 border-t-2 border-emerald-300 items-center gap-2">
                        <div className="col-span-5">
                          <div className="flex items-center gap-1.5">
                            <DollarSign size={13} className="text-emerald-600" />
                            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wide">
                              {isCompLeaveOtPolicy ? 'Tổng OT / nghỉ bù' : 'Tổng OT'}
                            </span>
                          </div>
                        </div>
                        <div className="text-right text-sm font-bold text-foreground tabular-nums">{totalOtHours.toFixed(2)}h</div>
                        <div className={`text-right text-base font-bold tabular-nums ${totalOtCost > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                          {fmtVND(totalOtCost)}
                        </div>
                      </div>
                    )}
                  </div>{/* end min-w */}
                </div>{/* end overflow-x-auto */}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/50 p-4 text-center text-sm text-muted-foreground">
                Chưa có dữ liệu phân bucket OT
              </div>
            )}

            {isCompLeaveOtPolicy && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-200/70">
                  <CalendarClock size={13} className="text-amber-700" />
                  <span className="text-xs font-bold text-amber-800 uppercase tracking-wide">Ngày nghỉ bù liên kết</span>
                </div>
                {compLeaveMatches.length > 0 ? (
                  <div className="divide-y divide-amber-200/70">
                    {compLeaveMatches.map((match) => (
                      <div key={`${match.instanceCode}-${match.compLeaveStart}`} className="grid grid-cols-[1.1fr_1fr_0.5fr] gap-3 px-4 py-3 text-xs">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Giờ OT nguồn</div>
                          <div className="font-semibold text-foreground tabular-nums">{fmtDT(match.workedStart)} → {fmtDT(match.workedEnd)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Nghỉ bù vào</div>
                          <div className="font-semibold text-foreground tabular-nums">{fmtDT(match.compLeaveStart)} → {fmtDT(match.compLeaveEnd)}</div>
                          <div className="text-[10px] text-muted-foreground">Phiếu {match.serialNumber || match.instanceCode}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Công bù</div>
                          <div className="font-mono text-sm font-bold text-amber-900">{match.compLeaveHours.toFixed(2)}h</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-3 text-xs text-amber-800">
                    Chưa tìm thấy phiếu đổi ngày/giờ làm việc dùng OT này để nghỉ bù. Phần OT chưa có nghỉ bù liên kết sẽ được tính lương theo bucket/rate; ngày công chỉ được cộng khi có phiếu nghỉ bù được duyệt.
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
        {/* ── ChangeHours / NightShift Section ── */}
        {isChangeHours && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="pt-2">
            {loadingOtDetail ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <Loader2 size={14} className="animate-spin" /> Đang tải thông tin ca làm việc...
              </div>
            ) : isCompLeave ? (
              /* ── Nghỉ bù (休日変更) UI ── */
              <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-4">

                {/* Header */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-lg">🔄</span>
                  <div>
                    <div className="text-sm font-bold text-emerald-800">Nghỉ bù (休日変更)</div>
                    <div className="text-[10px] text-emerald-600">Làm bù ngày nghỉ → được nghỉ bù</div>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-700">
                      ✓ ĐỦ CÔNG
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-teal-100 text-teal-700">
                      NGHỈ BÙ
                    </span>
                  </div>
                </div>

                {/* Worked period → Comp leave period flow */}
                <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center mb-4">
                  {/* Worked period */}
                  <div className="rounded-xl bg-orange-50 border border-orange-200 px-3 py-3">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-orange-500 mb-1.5 text-center">
                      ĐÃ LÀM BÙ
                    </div>
                    {workedPeriodStart && workedPeriodEnd ? (
                      <>
                        <div className="text-center font-bold text-orange-800 text-sm tabular-nums">
                          {workedPeriodStart.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false })}
                          {' – '}
                          {workedPeriodEnd.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false })}
                        </div>
                        <div className="text-center text-[9px] text-orange-500 mt-0.5 tabular-nums">
                          {workedPeriodStart.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit' })}
                        </div>
                        <div className="text-center text-[9px] font-semibold text-orange-700 mt-1">
                          {changeFrame?.workedPeriodEnd && changeFrame.workedPeriodStart
                            ? `${((new Date(changeFrame.workedPeriodEnd).getTime() - new Date(changeFrame.workedPeriodStart).getTime()) / 3600000).toFixed(0)}h đã làm`
                            : ''}
                        </div>
                      </>
                    ) : (
                      <div className="text-center text-[10px] text-orange-500">—</div>
                    )}
                  </div>

                  {/* Arrow */}
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="text-muted-foreground text-lg">→</div>
                    <div className="text-[8px] text-muted-foreground text-center">được nghỉ bù</div>
                  </div>

                  {/* Comp leave period */}
                  <div className="rounded-xl bg-emerald-100/70 border border-emerald-200 px-3 py-3">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-emerald-600 mb-1.5 text-center">
                      NGHỈ BÙ
                    </div>
                    {newShiftStart && newShiftEnd ? (
                      <>
                        <div className="text-center font-bold text-emerald-800 text-sm tabular-nums">
                          {fmtShiftTime(newShiftStart)}
                          {' – '}
                          {fmtShiftTime(newShiftEnd)}
                        </div>
                        <div className="text-center text-[9px] text-emerald-600 mt-0.5 tabular-nums">
                          {fmtShiftDate(newShiftStart)}
                        </div>
                        <div className="text-center text-[9px] font-semibold text-emerald-700 mt-1">
                          {changeFrame?.compLeaveHours}h nghỉ bù
                        </div>
                      </>
                    ) : <div className="text-center text-[10px] text-emerald-500">—</div>}
                  </div>
                </div>

                {/* Attendance conclusion */}
                <div className="rounded-lg bg-emerald-100 border border-emerald-200 px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-emerald-700 font-bold text-xs">✓ Chấm công ngày này được tính đủ công</span>
                  </div>
                  <p className="text-[10px] text-emerald-700 leading-relaxed">
                    Nhân viên có phiếu <strong>nghỉ bù</strong> từ{' '}
                    <strong>{fmtShiftTime(newShiftStart)}</strong> đến <strong>{fmtShiftTime(newShiftEnd)}</strong>.
                    {' '}Checkout lúc hoặc sau {fmtShiftTime(newShiftStart)} → đủ công.{' '}
                    Checkout sớm hơn → vẫn ghi nhận về sớm so với ca gốc trong Lark.
                  </p>
                </div>

                <div className="mt-3">
                  {renderDetailLatePolicy(changeSubmissionPolicy)}
                </div>
              </div>
            ) : (
              /* ── Regular shift change UI ── */
              <div className={`rounded-xl border p-4 ${changeFrame?.isNightShift
                ? 'bg-gradient-to-br from-indigo-50 to-slate-100 border-indigo-200'
                : 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200'}`}>

                {/* Header */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-lg">{changeFrame?.isNightShift ? '🌙' : '☀️'}</span>
                  <div>
                    <div className="text-sm font-bold text-foreground">
                      {changeFrame?.isNightShift ? 'Đổi sang ca đêm' : 'Thay đổi lịch làm việc'}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {changeFrame?.isNightShift ? 'Ca đêm: 22:00 – 06:00 hôm sau' : 'Điều chỉnh khung giờ làm việc'}
                    </div>
                  </div>
                  <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold
                    ${changeFrame?.isNightShift ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'}`}>
                    {changeFrame?.isNightShift ? 'CA ĐÊM' : 'CA NGÀY'}
                  </span>
                </div>

                {/* New shift time window */}
                {newShiftStart && newShiftEnd ? (
                  <div className="mb-4">
                    <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                      {workedPeriodStart && workedPeriodEnd ? 'Đổi ca làm việc' : 'Khung giờ làm việc mới'}
                    </div>
                    {workedPeriodStart && workedPeriodEnd ? (
                      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
                        <div className="rounded-xl px-4 py-3 border text-center bg-slate-50 border-slate-200">
                          <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground mb-1">CA GỐC</div>
                          <div className="text-lg font-bold tabular-nums text-foreground">
                            {fmtShiftTime(workedPeriodStart)} – {fmtShiftTime(workedPeriodEnd)}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{fmtShiftDate(workedPeriodStart)}</div>
                        </div>
                        <span className="text-indigo-300 font-bold text-center">→</span>
                        <div className={`rounded-xl px-4 py-3 border text-center
                          ${changeFrame?.isNightShift ? 'bg-indigo-100/60 border-indigo-200' : 'bg-amber-100/60 border-amber-200'}`}>
                          <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground mb-1">CA MỚI</div>
                          <div className="text-lg font-bold tabular-nums text-foreground">
                            {fmtShiftTime(newShiftStart)} – {fmtShiftTime(newShiftEnd)}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{fmtShiftDate(newShiftStart)}</div>
                        </div>
                      </div>
                    ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div className={`rounded-xl px-4 py-3 border text-center
                        ${changeFrame?.isNightShift ? 'bg-indigo-100/60 border-indigo-200' : 'bg-amber-100/60 border-amber-200'}`}>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground mb-1">VÀO CA</div>
                        <div className="text-2xl font-bold tabular-nums text-foreground">{fmtShiftTime(newShiftStart)}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{fmtShiftDate(newShiftStart)}</div>
                      </div>
                      <div className={`rounded-xl px-4 py-3 border text-center
                        ${changeFrame?.isNightShift ? 'bg-indigo-100/60 border-indigo-200' : 'bg-amber-100/60 border-amber-200'}`}>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground mb-1">RA CA</div>
                        <div className="text-2xl font-bold tabular-nums text-foreground">{fmtShiftTime(newShiftEnd)}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{fmtShiftDate(newShiftEnd)}</div>
                      </div>
                    </div>
                    )}
                  </div>
                ) : (
                  <div className="mb-4 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-[11px] text-amber-700">
                    ⚠️ Khung giờ ca mới chưa thể đọc được từ rawData Lark — thông tin có thể không đầy đủ
                  </div>
                )}

                {/* Application period */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Bắt đầu áp dụng', value: fmtShiftDate(newShiftStart) },
                    { label: 'Kết thúc áp dụng', value: fmtShiftDate(newShiftEnd) },
                    { label: 'Thời lượng', value: changeShiftHours > 0 ? `${Number(changeShiftHours.toFixed(2))}h` : '—' },
                  ].map((item, i) => (
                    <div key={i} className="bg-white/70 rounded-lg px-3 py-2.5 border border-border/30 text-center">
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">{item.label}</div>
                      <div className="text-xs font-bold text-foreground">{item.value}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3">
                  {renderDetailLatePolicy(changeSubmissionPolicy)}
                </div>

                <div className="mt-3 rounded-lg bg-white/50 border border-border/30 px-3 py-2 text-[10px] text-muted-foreground">
                  <span className="font-semibold text-foreground">Lưu ý:</span> Chấm công tính theo ca gốc trong Lark. Checkout sớm hơn giờ ra ca mới → vẫn ghi nhận về sớm.
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Nghỉ Phép (Leave) Section ── */}
        {isLeaveType && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="pt-2 text-left">
            {loadingOtDetail ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <Loader2 size={14} className="animate-spin" /> Đang tải chi tiết đơn nghỉ phép...
              </div>
            ) : (() => {
              const reason = leaveDetails?.reason || '';
              const bucket = approval.leaveTypeBucket || '';
              
              // Pick premium theme colors based on leave type bucket
              let wrapperClass = "bg-white border border-slate-200/60 rounded-2xl shadow-xl overflow-hidden border-t-4 border-t-sky-500 text-sky-950";
              let headerClass = "bg-gradient-to-r from-sky-50/70 to-white px-5 py-4 border-b border-slate-100";
              let badgeClass = "bg-sky-500/10 text-sky-600 border border-sky-200/80";
              let dotClass = "bg-sky-500";
              let labelTitle = "Nghỉ Phép Năm (Annual Leave)";
              let descText = "Phép năm hưởng 100% lương theo quy định và tự động cộng dồn công.";

              if (bucket === 'BENEFIT' || bucket === 'COMP_LEAVE') {
                wrapperClass = "bg-white border border-slate-200/60 rounded-2xl shadow-xl overflow-hidden border-t-4 border-t-emerald-500 text-emerald-950";
                headerClass = "bg-gradient-to-r from-emerald-50/70 to-white px-5 py-4 border-b border-slate-100";
                badgeClass = "bg-emerald-500/10 text-emerald-600 border border-emerald-200/80";
                dotClass = "bg-emerald-500";
                labelTitle = "Nghỉ Phép Phúc Lợi / Hưởng Lương";
                descText = "Nghỉ hưởng nguyên lương đối với các trường hợp hiếu hỷ, sinh nhật, nghỉ bù...";
              } else if (bucket === 'UNPAID') {
                wrapperClass = "bg-white border border-slate-200/60 rounded-2xl shadow-xl overflow-hidden border-t-4 border-t-rose-500 text-rose-950";
                headerClass = "bg-gradient-to-r from-rose-50/70 to-white px-5 py-4 border-b border-slate-100";
                badgeClass = "bg-rose-500/10 text-rose-600 border border-rose-200/80";
                dotClass = "bg-rose-500";
                labelTitle = "Nghỉ Không Lương / Trừ Lương";
                descText = "Các ngày nghỉ không hưởng lương hoặc nghỉ bảo hiểm xã hội tự chi trả.";
              }

              return (
                <div className={wrapperClass}>
                  {/* Header */}
                  <div className={headerClass}>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">🏖️</span>
                      <div className="text-left">
                        <div className="text-sm font-bold text-foreground">{labelTitle}</div>
                        <div className="text-[10px] text-muted-foreground">{descText}</div>
                      </div>
                      <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${badgeClass}`}>
                        {approval.leaveType || 'Nghỉ phép'}
                      </span>
                    </div>
                  </div>

                  <div className="p-5 space-y-4">
                    {/* Calendar Blocks */}
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-4 items-center">
                      {/* Start Date */}
                      <div className="rounded-xl bg-slate-50/50 border border-slate-100 p-3.5 shadow-sm text-center">
                        <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Bắt đầu nghỉ</div>
                        {startDate ? (
                          <>
                            <div className="text-lg font-extrabold text-foreground tabular-nums">
                              {startDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false })}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-1 font-semibold">
                              {startDate.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                            </div>
                          </>
                        ) : <div className="text-sm text-muted-foreground">—</div>}
                      </div>

                      {/* Arrow / Duration Icon */}
                      <div className="flex flex-col items-center gap-1">
                        <div className="text-muted-foreground/60 font-bold text-xl">➔</div>
                        <div className="text-[8px] bg-slate-100 text-muted-foreground px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                          Liên tục
                        </div>
                      </div>

                      {/* End Date */}
                      <div className="rounded-xl bg-slate-50/50 border border-slate-100 p-3.5 shadow-sm text-center">
                        <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Kết thúc nghỉ</div>
                        {endDate ? (
                          <>
                            <div className="text-lg font-extrabold text-foreground tabular-nums">
                              {endDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false })}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-1 font-semibold">
                              {endDate.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                            </div>
                          </>
                        ) : <div className="text-sm text-muted-foreground">—</div>}
                      </div>
                    </div>

                    {/* Summary row */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50/50 border border-slate-100 rounded-lg p-3 text-center shadow-sm">
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Số ngày nghỉ phép</div>
                        <div className="text-lg font-bold text-foreground tabular-nums">
                          {displayDays}
                        </div>
                      </div>
                      <div className="bg-slate-50/50 border border-slate-100 rounded-lg p-3 text-center shadow-sm">
                        <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Quy đổi số giờ</div>
                        <div className="text-lg font-bold text-foreground tabular-nums">
                          {displayHours}
                        </div>
                      </div>
                    </div>

                    {/* Context Note */}
                    <div className="rounded-lg bg-slate-50/30 border border-slate-100 px-4 py-3 text-xs space-y-1.5 shadow-sm text-left">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`}></span>
                        <p className="text-muted-foreground font-medium">
                          Phân nhóm bảng công: <strong className="text-foreground font-bold">{labelTitle}</strong>
                        </p>
                      </div>
                      <div className="text-[10px] text-muted-foreground leading-relaxed mt-1 border-t border-slate-100 pt-1.5">
                        💡 Khi phiếu này được duyệt, hệ thống chấm công sẽ ghi nhận ngày phép tương ứng vào bảng chấm công tháng hiện tại. Nhân sự sẽ được tự động tính đủ công và được hưởng nguyên lương / trừ lương tùy thuộc vào chính sách loại nghỉ của công ty.
                      </div>
                    </div>

                    {/* Reason Box */}
                    {reason && (
                      <div className="rounded-lg bg-slate-50/40 border border-slate-100 p-3.5 italic text-foreground/80 text-xs flex gap-2 items-start shadow-sm text-left">
                        <span className="text-muted-foreground/30 select-none text-xl leading-none font-serif">“</span>
                        <div className="flex-1 not-italic">
                          <span className="font-semibold text-muted-foreground block text-[9px] uppercase tracking-wider mb-1">LÝ DO XIN NGHỈ PHÉP:</span>
                          <p className="italic text-foreground font-medium text-sm">"{reason}"</p>
                        </div>
                        <span className="text-muted-foreground/30 select-none text-xl leading-none font-serif">”</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </motion.div>
        )}
        {/* ── Remedy (Correction) Section ── */}
        {isCorrectionType && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="pt-2">
            {loadingOtDetail ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <Loader2 size={14} className="animate-spin" /> Đang tải chi tiết điều chỉnh...
              </div>
            ) : (() => {
              const remedy = parseRemedyDetails(otDetail?.rawData);
              if (!remedy) {
                return (
                  <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4 text-center text-sm text-amber-800">
                    ⚠️ Không thể đọc dữ liệu form gốc của phiếu điều chỉnh chấm công.
                  </div>
                );
              }

              return (
                <div className="rounded-xl border border-accent/20 bg-accent/5 p-5 space-y-4">
                  {/* Header */}
                  <div className="flex items-center gap-2 border-b border-accent/10 pb-3">
                    <span className="text-xl">🕒</span>
                    <div>
                      <div className="text-sm font-bold text-accent">Thông tin điều chỉnh chấm công (Remedy)</div>
                      <div className="text-[10px] text-accent/80">Cập nhật bổ sung giờ chấm công bị thiếu hoặc sai lệch</div>
                    </div>
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold bg-accent/10 text-accent uppercase">
                      Điều chỉnh
                    </span>
                  </div>

                  {/* Visual Timeline Match */}
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
                    {/* Original State */}
                    <div className="rounded-xl bg-card border border-border p-3.5 shadow-sm text-center">
                      <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Trạng thái gốc</div>
                      <div className="text-sm font-bold text-muted-foreground/80 line-through decoration-1 text-center truncate">
                        Chưa ghi nhận
                      </div>
                      <div className="text-[10px] text-muted-foreground/60 mt-1 font-mono italic max-w-full truncate" title={remedy.originalTime}>
                        {remedy.originalTime || 'No record'}
                      </div>
                    </div>

                    {/* Arrow */}
                    <div className="flex flex-col items-center gap-1">
                      <div className="text-accent font-bold text-xl">➔</div>
                      <div className="text-[8px] bg-accent/10 text-accent px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Mới</div>
                    </div>

                    {/* Adjusted State */}
                    <div className="rounded-xl bg-success/5 border border-success/20 p-3.5 shadow-sm text-center">
                      <div className="text-[9px] font-bold uppercase tracking-wide text-success mb-1.5">Giờ điều chỉnh thành</div>
                      <div className="text-lg font-extrabold text-success tabular-nums">
                        {remedy.remedyTime}
                      </div>
                      <div className="text-[10px] text-success/90 font-semibold mt-1">
                        {remedy.punchLabel}
                      </div>
                    </div>
                  </div>

                  {/* Summary Box */}
                  <div className="rounded-lg bg-card/80 border border-border px-4 py-3 text-xs space-y-1.5 shadow-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                      <p className="text-muted-foreground font-medium">
                        Ngày điều chỉnh công: <strong className="text-foreground font-bold">{remedy.remedyDate}</strong>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                      <p className="text-muted-foreground font-medium">
                        Sự kiện ảnh hưởng: <strong className="text-accent font-bold">{remedy.punchLabel}</strong> của nhân viên.
                      </p>
                    </div>
                    <div className="text-[10px] text-muted-foreground leading-relaxed mt-1 border-t border-border pt-1.5">
                      💡 Khi phiếu này được duyệt, hệ thống chấm công sẽ bổ sung giờ <strong className="text-foreground">{remedy.punchLabel}</strong> là <strong className="text-success font-bold">{remedy.remedyTime}</strong> cho ngày <strong className="text-foreground">{remedy.remedyDate}</strong>, giúp hoàn thiện công của ngày đó.
                    </div>
                  </div>

                  {/* Reason Box */}
                  {remedy.reason && (
                    <div className="rounded-lg bg-accent/5 border border-accent/10 p-3 italic text-foreground/80 text-xs flex gap-2 items-start">
                      <span className="text-muted-foreground/40 select-none text-lg leading-none">“</span>
                      <div className="flex-1">
                        <span className="font-semibold text-foreground/90 not-italic block text-[10px] uppercase tracking-wider mb-0.5">Lý do điều chỉnh:</span>
                        {remedy.reason}
                      </div>
                      <span className="text-muted-foreground/40 select-none text-lg leading-none">”</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </motion.div>
        )}

        {/* ── Lark Form Widgets ── */}
        {loadingOtDetail ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
            <Loader2 size={14} className="animate-spin" /> Đang tải chi tiết đơn...
          </div>
        ) : (otDetail?.rawData && !isCorrectionType) ? (
          <LarkFormFields rawData={otDetail.rawData} />
        ) : null}
      </div>
    </Modal>
  );
}
