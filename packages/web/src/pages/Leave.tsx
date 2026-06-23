import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, TrendingDown, AlertCircle, ChevronLeft, ChevronRight,
  Search, LayoutGrid, List, Edit2, BadgeInfo,
  Loader2, UserCheck, X, Save
} from 'lucide-react';
import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { PageHeader, KpiCard, FormInput, Button, Avatar } from '@/components/ui';
import api from '@/services/api';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

interface EmployeeInfo {
  id: string;
  fullName: string;
  department: string;
  position: string;
  status: string;
  avatarUrl: string | null;
}

interface LeaveBalance {
  id: string;
  employeeId: string;
  monthKey: string;
  opening: number;
  accrued: number;
  used: number;
  adjustment: number;
  seniorityBonus: number;
  closing: number;
  employee: EmployeeInfo;
}

interface ApprovalRecord {
  id: string;
  instanceCode: string;
  serialNumber: string | null;
  approvalType: string;
  leaveType: string | null;
  leaveTypeBucket: string | null;
  status: string;
  approvedHours: number;
  approvedDays: number;
  startTime: string | null;
  endTime: string | null;
  employeeId: string;
  rawData: any;
}

interface PeriodInfo {
  id: string;
  monthKey: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  status: string;
}

interface LeaveBalancesResponse {
  balances: LeaveBalance[];
  approvals: ApprovalRecord[];
  period: PeriodInfo | null;
}

type ViewMode = 'table' | 'grid';

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function fmtMonthLabel(mk: string): string {
  if (mk.length === 6) return `Tháng ${mk.slice(4)}/${mk.slice(0, 4)}`;
  return mk;
}

function prevMonth(mk: string): string {
  const y = parseInt(mk.slice(0, 4));
  const m = parseInt(mk.slice(4));
  if (m <= 1) return `${y - 1}12`;
  return `${y}${String(m - 1).padStart(2, '0')}`;
}

function nextMonth(mk: string): string {
  const y = parseInt(mk.slice(0, 4));
  const m = parseInt(mk.slice(4));
  if (m >= 12) return `${y + 1}01`;
  return `${y}${String(m + 1).padStart(2, '0')}`;
}

interface DayInfo {
  iso: string;
  day: number;
  month: number;
  weekday: number;
  label: string;
  weekend: boolean;
}

function buildDaysFromPeriod(period: PeriodInfo | null, monthKey: string): DayInfo[] {
  let startDate: Date;
  let endDate: Date;
  if (period) {
    startDate = new Date(period.periodStart);
    endDate = new Date(period.periodEnd);
  } else {
    const y = parseInt(monthKey.slice(0, 4), 10);
    const m = parseInt(monthKey.slice(4, 6), 10);
    startDate = new Date(y, m - 1, 1);
    endDate = new Date(y, m, 0);
  }

  const days: DayInfo[] = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const endLimit = new Date(endDate);
  endLimit.setHours(0, 0, 0, 0);

  while (current <= endLimit) {
    const y = current.getFullYear();
    const m = current.getMonth() + 1;
    const d = current.getDate();
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({
      iso,
      day: d,
      month: m,
      weekday: current.getDay(),
      label: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][current.getDay()] ?? '',
      weekend: current.getDay() === 0 || current.getDay() === 6,
    });
    current.setDate(current.getDate() + 1);
  }
  return days;
}

// Check overlapping leaves for a day
function getDayLeaves(employeeId: string, isoDate: string, approvals: ApprovalRecord[]) {
  const targetTime = new Date(isoDate).getTime();

  return approvals.filter((a) => {
    if (a.employeeId !== employeeId) return false;
    if (!a.startTime || !a.endTime) return false;

    // Get date bounds (zeroed out)
    const start = new Date(a.startTime);
    const startTime = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const end = new Date(a.endTime);
    const endTime = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();

    return targetTime >= startTime && targetTime <= endTime;
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

// ═══════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════

export default function Leave() {
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [adjustModal, setAdjustModal] = useState<{
    employeeId: string;
    fullName: string;
    opening: number;
    accrued: number;
    adjustment: number;
    seniorityBonus: number;
  } | null>(null);

  // State to manage floating premium tooltips
  const [hoveredCell, setHoveredCell] = useState<{
    employeeId: string;
    dayIso: string;
    info: {
      code: string;
      instanceCode: string;
      leaveType: string;
      duration: string;
      startTime: string;
      endTime: string;
      reason: string;
    };
    x: number;
    y: number;
  } | null>(null);

  // Fetch balances & approvals from API
  const { data: rawRes, isLoading, refetch } = useQuery<{ success: boolean; data: LeaveBalancesResponse }>({
    queryKey: ['leave-balances', monthKey],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: LeaveBalancesResponse }>(
        `/leave/balances?monthKey=${monthKey}`
      );
      return data;
    },
  });

  const responseData = rawRes?.data;
  const balances = responseData?.balances || [];
  const approvals = responseData?.approvals || [];
  const period = responseData?.period || null;

  // Filter balances by search string
  const filteredBalances = useMemo(() => {
    if (!search.trim()) return balances;
    const query = search.toLowerCase();
    return balances.filter(
      (b) =>
        b.employee.fullName.toLowerCase().includes(query) ||
        b.employee.department.toLowerCase().includes(query) ||
        b.employee.position.toLowerCase().includes(query)
    );
  }, [balances, search]);

  // Aggregate numbers for KPI
  const totalUsed = useMemo(() => balances.reduce((sum, b) => sum + b.used, 0), [balances]);
  const avgBalance = useMemo(() => {
    if (balances.length === 0) return 0;
    return balances.reduce((sum, b) => sum + b.closing, 0) / balances.length;
  }, [balances]);
  const warningCount = useMemo(() => balances.filter((b) => b.closing <= 0).length, [balances]);

  // Handle Adjustment Mutation
  const adjustMutation = useMutation({
    mutationFn: async (payload: {
      employeeId: string;
      monthKey: string;
      opening: number;
      accrued: number;
      adjustment: number;
      seniorityBonus: number;
    }) => {
      return api.post('/leave/adjust', payload);
    },
    onSuccess: () => {
      setAdjustModal(null);
      refetch();
    },
  });

  const days = useMemo(() => buildDaysFromPeriod(period, monthKey), [period, monthKey]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6 relative"
    >
      <PageHeader
        title="Nghỉ phép"
        subtitle={`Quản lý số dư phép — ${fmtMonthLabel(monthKey)}${
          period ? ` (${period.periodStart.slice(5, 10).replace('-', '/')} → ${period.periodEnd.slice(5, 10).replace('-', '/')})` : ''
        }`}
      />

      {/* KPI Cards */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <motion.div variants={item}>
          <KpiCard
            label="Tổng phép đã dùng"
            value={`${totalUsed.toFixed(1)} ngày`}
            subtitle={`${balances.filter((b) => b.used > 0).length} nhân sự nghỉ tháng này`}
            icon={CalendarDays}
            color="#7c3aed"
          />
        </motion.div>
        <motion.div variants={item}>
          <KpiCard
            label="Tồn phép TB"
            value={`${avgBalance.toFixed(1)} ngày`}
            subtitle="tồn bình quân toàn công ty"
            icon={TrendingDown}
            color="#16a34a"
          />
        </motion.div>
        <motion.div variants={item}>
          <KpiCard
            label="Hết phép"
            value={warningCount}
            subtitle="nhân sự có số dư bằng 0"
            icon={AlertCircle}
            color="#dc2626"
          />
        </motion.div>
        <motion.div variants={item}>
          <KpiCard
            label="Nhân viên"
            value={balances.length}
            subtitle="đang theo dõi phép năm"
            icon={UserCheck}
            color="#2563eb"
          />
        </motion.div>
      </motion.div>

      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/70 backdrop-blur-md border border-gray-200/80 p-3.5 rounded-2xl shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {/* Month Navigator */}
          <div className="flex items-center gap-0.5 bg-gray-50 border border-gray-200 rounded-xl px-1.5 py-1 shadow-inner">
            <button
              onClick={() => setMonthKey(prevMonth(monthKey))}
              className="p-1.5 rounded-lg hover:bg-white active:bg-gray-100 text-gray-500 hover:text-gray-700 hover:shadow-sm cursor-pointer transition-all"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-sm font-semibold px-4 tabular-nums min-w-[130px] text-center text-gray-800">
              {fmtMonthLabel(monthKey)}
            </span>
            <button
              onClick={() => setMonthKey(nextMonth(monthKey))}
              className="p-1.5 rounded-lg hover:bg-white active:bg-gray-100 text-gray-500 hover:text-gray-700 hover:shadow-sm cursor-pointer transition-all"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Search box */}
          <div className="relative w-[240px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <FormInput
              placeholder="Tìm tên, phòng ban..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 py-1.5 h-9 bg-gray-50/50"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Toggle View Mode */}
          <div className="flex items-center bg-gray-100/80 border border-gray-200/50 rounded-xl p-1 shadow-sm">
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                viewMode === 'table'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <List size={13} />
              <span>Bảng tổng hợp</span>
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                viewMode === 'grid'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <LayoutGrid size={13} />
              <span>Bảng ngày nghỉ</span>
            </button>
          </div>
        </div>
      </div>

      {/* Primary Content View */}
      {isLoading ? (
        <div className="bg-white border border-gray-150 rounded-2xl p-16 text-center shadow-sm">
          <Loader2 size={26} className="animate-spin text-blue-500 mx-auto mb-3" />
          <p className="text-sm text-gray-400 font-medium">Đang tính toán số dư phép năm...</p>
        </div>
      ) : filteredBalances.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-16 text-center shadow-sm">
          <CalendarDays size={36} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-700">Không tìm thấy dữ liệu phép</p>
          <p className="text-xs text-gray-400 mt-1">
            Vui lòng thay đổi từ khóa hoặc liên hệ Quản lý HR để cấu hình.
          </p>
        </div>
      ) : viewMode === 'table' ? (
        <div className="bg-white border border-gray-200/80 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-5 py-3.5 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Nhân viên
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">
                    Tồn đầu kỳ
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">
                    Phát sinh
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">
                    Đã dùng
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">
                    Điều chỉnh
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">
                    Thâm niên
                  </th>
                  <th className="px-5 py-3.5 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">
                    Tồn cuối kỳ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredBalances.map((b) => (
                  <tr
                    key={b.id}
                    className="hover:bg-gray-50/50 transition-colors group"
                  >
                    <td className="px-5 py-3.5 flex items-center gap-3">
                      <Avatar name={b.employee.fullName} size="sm" src={b.employee.avatarUrl || undefined} />
                      <div>
                        <p className="text-sm font-semibold text-gray-800 leading-snug">
                          {b.employee.fullName}
                        </p>
                        <p className="text-[10px] text-gray-400 font-medium">
                          {b.employee.department} · {b.employee.position}
                        </p>
                      </div>
                    </td>
                    {/* Opening Balance - Clickable to Edit */}
                    <td className="px-4 py-3.5 text-right tabular-nums">
                      <button
                        onClick={() =>
                          setAdjustModal({
                            employeeId: b.employeeId,
                            fullName: b.employee.fullName,
                            opening: b.opening,
                            accrued: b.accrued,
                            adjustment: b.adjustment,
                            seniorityBonus: b.seniorityBonus,
                          })
                        }
                        className="inline-flex items-center gap-1 text-gray-700 hover:text-blue-600 font-medium hover:bg-blue-50 px-2.5 py-1 rounded-lg transition-all hover:border-dashed hover:border-blue-300 border border-transparent cursor-pointer"
                      >
                        {b.opening.toFixed(1)}
                        <Edit2 size={8} className="opacity-0 group-hover:opacity-60 transition-opacity ml-0.5" />
                      </button>
                    </td>
                    {/* Accrued Balance - Clickable to Edit */}
                    <td className="px-4 py-3.5 text-right tabular-nums">
                      <button
                        onClick={() =>
                          setAdjustModal({
                            employeeId: b.employeeId,
                            fullName: b.employee.fullName,
                            opening: b.opening,
                            accrued: b.accrued,
                            adjustment: b.adjustment,
                            seniorityBonus: b.seniorityBonus,
                          })
                        }
                        className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-bold hover:bg-emerald-50 px-2.5 py-1 rounded-lg transition-all hover:border-dashed hover:border-emerald-300 border border-transparent cursor-pointer"
                      >
                        +{b.accrued.toFixed(1)}
                        <Edit2 size={8} className="opacity-0 group-hover:opacity-60 transition-opacity ml-0.5" />
                      </button>
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums">
                      {b.used > 0 ? (
                        <span className="text-red-500 font-semibold px-2">-{b.used.toFixed(1)}</span>
                      ) : (
                        <span className="text-gray-300 px-2">—</span>
                      )}
                    </td>
                    {/* Adjustment - Clickable to Edit */}
                    <td className="px-4 py-3.5 text-right tabular-nums">
                      <button
                        onClick={() =>
                          setAdjustModal({
                            employeeId: b.employeeId,
                            fullName: b.employee.fullName,
                            opening: b.opening,
                            accrued: b.accrued,
                            adjustment: b.adjustment,
                            seniorityBonus: b.seniorityBonus,
                          })
                        }
                        className="inline-flex items-center gap-1 text-gray-600 hover:text-blue-600 font-medium hover:bg-blue-50 px-2.5 py-1 rounded-lg transition-all hover:border-dashed hover:border-blue-300 border border-transparent cursor-pointer"
                      >
                        <span>
                          {b.adjustment > 0
                            ? `+${b.adjustment.toFixed(1)}`
                            : b.adjustment < 0
                            ? `${b.adjustment.toFixed(1)}`
                            : '0'}
                        </span>
                        <Edit2 size={8} className="opacity-0 group-hover:opacity-60 transition-opacity ml-0.5" />
                      </button>
                    </td>
                    {/* Seniority - Clickable to Edit */}
                    <td className="px-4 py-3.5 text-right tabular-nums">
                      <button
                        onClick={() =>
                          setAdjustModal({
                            employeeId: b.employeeId,
                            fullName: b.employee.fullName,
                            opening: b.opening,
                            accrued: b.accrued,
                            adjustment: b.adjustment,
                            seniorityBonus: b.seniorityBonus,
                          })
                        }
                        className="inline-flex items-center gap-1 text-gray-600 hover:text-purple-600 font-medium hover:bg-purple-50 px-2.5 py-1 rounded-lg transition-all hover:border-dashed hover:border-purple-300 border border-transparent cursor-pointer"
                      >
                        <span>
                          {b.seniorityBonus > 0 ? `+${b.seniorityBonus.toFixed(1)}` : '0'}
                        </span>
                        <Edit2 size={8} className="opacity-0 group-hover:opacity-60 transition-opacity ml-0.5" />
                      </button>
                    </td>
                    <td className="px-5 py-3.5 text-right font-bold tabular-nums">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs ${
                          b.closing <= 0
                            ? 'bg-red-50 text-red-600 border border-red-200'
                            : b.closing <= 1.5
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}
                      >
                        {b.closing.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200/80 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-r border-gray-200 w-[190px]">
                    Nhân viên
                  </th>
                  {days.map((day) => (
                    <th
                      key={day.iso}
                      className={`px-0 py-2 border-r border-gray-200 text-center w-7 min-w-[28px] ${
                        day.weekend ? 'bg-gray-100/50' : ''
                      }`}
                    >
                      <div className="text-[9px] font-bold text-gray-400 uppercase tracking-tight">
                        {day.label}
                      </div>
                      <div className="text-xs font-bold text-gray-600">{day.day}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredBalances.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="sticky left-0 z-10 bg-white hover:bg-gray-50 border-r border-gray-200 shadow-[2px_0_5px_rgba(0,0,0,0.03)] px-4 py-2.5 flex items-center gap-2.5">
                      <Avatar name={b.employee.fullName} size="xs" src={b.employee.avatarUrl || undefined} />
                      <div className="truncate">
                        <p className="text-xs font-bold text-gray-800 truncate">
                          {b.employee.fullName}
                        </p>
                        <p className="text-[8px] text-gray-400 font-semibold truncate">
                          {b.employee.department}
                        </p>
                      </div>
                    </td>

                    {days.map((day) => {
                      const dayLeaves = getDayLeaves(b.employeeId, day.iso, approvals);
                      const hasLeave = dayLeaves.length > 0;
                      let badgeBg = '';
                      let label = '';
                      let tooltipInfo: any = null;

                      if (hasLeave) {
                        const leave = dayLeaves[0]!;
                        const code = leave.leaveTypeBucket || 'ANNUAL';
                        
                        // Structure hover tooltip content in detail
                        tooltipInfo = {
                          code: code === 'ANNUAL' ? 'P' : code === 'UNPAID' ? 'KL' : code === 'COMP_LEAVE' ? 'B' : code === 'REMOTE' ? 'R' : 'Phép',
                          instanceCode: leave.instanceCode,
                          leaveType: leave.leaveType || 'Nghỉ phép',
                          duration: leave.approvedDays > 0 ? `${leave.approvedDays} ngày` : `${leave.approvedHours} giờ`,
                          startTime: fmtDate(leave.startTime),
                          endTime: fmtDate(leave.endTime),
                          reason: leave.rawData?.form
                            ? (Array.isArray(leave.rawData.form)
                                ? leave.rawData.form.find((f: any) =>
                                    (f.name || '').toLowerCase().includes('lý do') ||
                                    (f.name || '').toLowerCase().includes('reason') ||
                                    (f.name || '').toLowerCase().includes('理由')
                                  )?.value || 'Không có lý do'
                                : 'Không có lý do')
                            : 'Không có lý do',
                        };

                        if (code === 'ANNUAL') {
                          label = 'P';
                          badgeBg = 'bg-purple-100 hover:bg-purple-200 text-purple-700';
                        } else if (code === 'UNPAID') {
                          label = 'KL';
                          badgeBg = 'bg-rose-100 hover:bg-rose-200 text-rose-700';
                        } else if (code === 'COMP_LEAVE') {
                          label = 'B';
                          badgeBg = 'bg-indigo-100 hover:bg-indigo-200 text-indigo-700';
                        } else if (code === 'REMOTE') {
                          label = 'R';
                          badgeBg = 'bg-blue-100 hover:bg-blue-200 text-blue-700';
                        } else {
                          label = 'Phép';
                          badgeBg = 'bg-violet-100 hover:bg-violet-200 text-violet-700';
                        }
                      }

                      return (
                        <td
                          key={day.iso}
                          className={`p-0 border-r border-gray-150 text-center w-7 min-w-[28px] ${
                            day.weekend ? 'bg-gray-50/20' : ''
                          }`}
                        >
                          {hasLeave ? (
                            <div className="flex items-center justify-center h-8">
                              <span
                                onMouseEnter={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setHoveredCell({
                                    employeeId: b.employeeId,
                                    dayIso: day.iso,
                                    info: tooltipInfo,
                                    x: rect.left + rect.width / 2 + window.scrollX,
                                    y: rect.top + window.scrollY,
                                  });
                                }}
                                onMouseLeave={() => setHoveredCell(null)}
                                className={`text-[9px] font-extrabold w-6 h-6 flex items-center justify-center rounded-lg shadow-sm transition-all hover:scale-110 cursor-help ${badgeBg}`}
                              >
                                {label}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-gray-200">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Legend indicator */}
          <div className="flex items-center gap-3 p-3.5 bg-gray-50 border-t border-gray-100 flex-wrap text-[10px]">
            <span className="font-semibold text-gray-500 uppercase tracking-tight mr-1">
              Ký hiệu nghỉ phép:
            </span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200/50 font-bold">
              P
            </span>
            <span className="text-gray-500">Nghỉ phép năm</span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200/50 font-bold">
              KL
            </span>
            <span className="text-gray-500">Nghỉ không lương</span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200/50 font-bold">
              B
            </span>
            <span className="text-gray-500">Nghỉ bù (Comp Leave)</span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200/50 font-bold">
              R
            </span>
            <span className="text-gray-500">WFH / Remote</span>
          </div>
        </div>
      )}

      {/* Floating Premium HTML Hover Label Tooltip */}
      {createPortal(
        <AnimatePresence>
          {hoveredCell && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 5 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 5 }}
              className="absolute z-50 pointer-events-none bg-white/95 text-gray-800 text-[11px] rounded-2xl p-4 shadow-[0_12px_40px_rgba(0,0,0,0.12)] border border-gray-200/80 backdrop-blur-md transition-all font-sans"
              style={{
                left: hoveredCell.x,
                top: hoveredCell.y,
                transform: 'translate(-50%, -100%) translateY(-10px)',
              }}
            >
              <div className="flex items-center gap-2.5 mb-2.5 pb-2 border-b border-gray-100">
                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black border ${
                  hoveredCell.info.code === 'P' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                  hoveredCell.info.code === 'KL' ? 'bg-rose-550/10 text-rose-700 border-rose-200' :
                  hoveredCell.info.code === 'B' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                  'bg-blue-50 text-blue-700 border-blue-200'
                }`}>
                  {hoveredCell.info.code}
                </span>
                <span className="font-extrabold text-gray-800 text-xs truncate max-w-[220px]">{hoveredCell.info.leaveType}</span>
              </div>
              <div className="space-y-1.5 text-gray-600 font-medium leading-relaxed">
                <p><span className="text-gray-400 font-bold mr-1.5">Mã phiếu:</span> <span className="font-mono tabular-nums text-[10px] text-gray-500">{hoveredCell.info.instanceCode}</span></p>
                <p><span className="text-gray-400 font-bold mr-1.5">Thời lượng:</span> <span className="font-bold text-gray-800">{hoveredCell.info.duration}</span></p>
                <p><span className="text-gray-400 font-bold mr-1.5">Thời gian:</span> <span className="text-gray-800 font-semibold">{hoveredCell.info.startTime} → {hoveredCell.info.endTime}</span></p>
                <p className="max-w-[280px] break-words whitespace-pre-wrap"><span className="text-gray-400 font-bold mr-1.5 block sm:inline">Lý do:</span> <span className="italic text-gray-700 font-normal">"{hoveredCell.info.reason}"</span></p>
              </div>
              {/* Caret arrow with border matching */}
              <div className="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-0 h-0 border-x-[6px] border-x-transparent border-t-[6px] border-t-gray-200/80" />
              <div className="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-0 h-0 border-x-[5px] border-x-transparent border-t-[5px] border-t-white/95" />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Manual Adjustment Modal Overlay */}
      <AnimatePresence>
        {adjustModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Modal backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAdjustModal(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-md"
            />

            {/* Modal Box */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-lg bg-white border border-gray-200 rounded-3xl p-6 shadow-2xl overflow-hidden z-10"
            >
              <div className="flex items-center justify-between pb-4 border-b border-gray-100">
                <div>
                  <h3 className="text-base font-bold text-gray-800">Chỉnh sửa số ngày nghỉ phép</h3>
                  <p className="text-xs text-gray-400 font-medium mt-0.5">
                    {adjustModal.fullName} · {fmtMonthLabel(monthKey)}
                  </p>
                </div>
                <button
                  onClick={() => setAdjustModal(null)}
                  className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="py-5 space-y-4">
                {/* Information Card */}
                <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-3.5 flex gap-2.5">
                  <BadgeInfo size={16} className="text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-blue-700 font-medium leading-relaxed">
                    Mỗi tháng theo kỳ lương hệ thống tự động <span className="font-bold">+1 ngày phép (8h)</span> làm phép phát sinh. <br />
                    Tồn cuối kỳ được tính theo công thức: <br />
                    <span className="font-extrabold text-blue-800">
                      Tồn cuối = Tồn đầu + Phát sinh + Điều chỉnh + Thâm niên − Đã dùng
                    </span>
                  </p>
                </div>

                {/* Opening & Accrued row */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-600 block">
                      Tồn đầu kỳ (Opening)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={adjustModal.opening}
                      onChange={(e) =>
                        setAdjustModal({
                          ...adjustModal,
                          opening: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full px-3.5 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-semibold tabular-nums text-gray-800"
                    />
                    <p className="text-[8px] text-gray-400 font-medium">Số phép dư mang sang từ kỳ trước.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-600 block">
                      Phép phát sinh (Accrued)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={adjustModal.accrued}
                      onChange={(e) =>
                        setAdjustModal({
                          ...adjustModal,
                          accrued: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full px-3.5 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-semibold tabular-nums text-gray-800"
                    />
                    <p className="text-[8px] text-gray-400 font-medium">Phép được cộng thêm trong kỳ lương này.</p>
                  </div>
                </div>

                {/* Adjustment & Seniority Bonus row */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-600 block">
                      Phép điều chỉnh (Adjustment)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={adjustModal.adjustment}
                      onChange={(e) =>
                        setAdjustModal({
                          ...adjustModal,
                          adjustment: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full px-3.5 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-semibold tabular-nums text-gray-800"
                    />
                    <p className="text-[8px] text-gray-400 font-medium">Điều chỉnh tăng (+) hoặc giảm (-) phép.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-600 block">
                      Thâm niên cộng thêm
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={adjustModal.seniorityBonus}
                      onChange={(e) =>
                        setAdjustModal({
                          ...adjustModal,
                          seniorityBonus: Math.max(parseFloat(e.target.value) || 0, 0),
                        })
                      }
                      className="w-full px-3.5 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all font-semibold tabular-nums text-gray-800"
                    />
                    <p className="text-[8px] text-gray-400 font-medium">Phép thâm niên cộng thêm trong tháng.</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-gray-100">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAdjustModal(null)}
                  className="rounded-xl px-4 font-semibold text-xs text-gray-500 hover:text-gray-700"
                >
                  Hủy
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={adjustMutation.isPending}
                  onClick={() =>
                    adjustMutation.mutate({
                      employeeId: adjustModal.employeeId,
                      monthKey,
                      opening: adjustModal.opening,
                      accrued: adjustModal.accrued,
                      adjustment: adjustModal.adjustment,
                      seniorityBonus: adjustModal.seniorityBonus,
                    })
                  }
                  className="rounded-xl px-5 font-bold text-xs bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/10 text-white flex items-center gap-1.5"
                >
                  {adjustMutation.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Save size={13} />
                  )}
                  <span>Lưu thay đổi</span>
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
