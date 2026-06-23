import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, Clock, AlertTriangle, CheckCircle2,
  Download, Loader2, ChevronLeft, ChevronRight,
  X, MapPin, Wifi, LogIn, LogOut, AlertCircle,
  LayoutGrid, List, FileText, ExternalLink, ClipboardCheck,
  Zap, Moon, Info,
} from 'lucide-react';
import React, { useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, KpiCard, FormInput, Button } from '@/components/ui';
import api from '@/services/api';

type ViewMode = 'grid' | 'table';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

interface EmployeeRow {
  id: string;
  fullName: string;
  employeeCode?: string | null;
  position?: string | null;
  department: string;
  employmentType: string;
  scheduleType: string;
  avatarUrl?: string;
}

// ─── Approval sub-types (from attendance API) ─────────────

interface OtBucketDetail {
  bucket: string;        // 'OT 150%' | 'OT 200%' | 'OT 210%' | 'OT 270%' | 'OT 300%' | 'OT 390%' | 'Ca đêm 30%'
  rate: number;
  approvedHours: number;
  validHours: number;
  startTime: string;
  endTime: string;
  frame: 'day' | 'night';
  dayType: string;
}

interface DayApproval {
  id: string;
  instanceCode: string;
  serialNumber: string | null;
  approvalType: string;   // 'OT' | 'Correction' | 'Leave' | 'ChangeHours' | 'NightShift'
  leaveType: string | null;
  leaveTypeBucket: string | null;
  status: string;
  approvedHours: number;
  approvedDays: number;
  startTime: string | null;
  endTime: string | null;
  otBuckets: OtBucketDetail[] | null;
  validOtHours: number | null;
  otPolicy: string | null;
  isNightShift: boolean;
  changeWorkingFrame: {
    isNightShift: boolean;
    shiftStart: string;
    shiftEnd: string;
    changeType?: string;
    compLeaveHours?: number;
    workedPeriodStart?: string;
    workedPeriodEnd?: string;
  } | null;
  rawData?: any | null;
}

interface CorrectionCredit {
  effectiveLateHours: number;
  effectiveEarlyHours: number;
  workCreditHours: number;
  lateOffset: number;
  earlyOffset: number;
}

interface DailyRecord {
  id: string;
  employeeId: string;
  attendanceDate: string;
  checkIn: string | null;
  checkOut: string | null;
  workHours: number;
  lateHours: number;
  earlyHours: number;
  otHoursPreliminary: number;
  missingHours: number;
  conclusion: string | null;
  checkInLocation: string | null;
  checkOutLocation: string | null;
  checkInWifi: string | null;
  checkInIsWifi: boolean;
  checkInIsField: boolean;
  checkInResult: string | null;
  checkOutResult: string | null;
  checkInSupplement: string | null;
  checkOutSupplement: string | null;
  status?: string | null;
  hasLeave?: boolean;
  // Shift schedule info
  shiftId: string | null;
  groupId: string | null;
  shiftCheckIn: string | null;
  shiftCheckOut: string | null;
  // Approvals linked to this day
  approvals: DayApproval[];
  correctionCredit: CorrectionCredit | null;
  effectiveLateHours: number;
  effectiveEarlyHours: number;
}

interface PeriodInfo {
  id: string;
  monthKey: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  status: string;
}

interface TimesheetResponse {
  employees: EmployeeRow[];
  records: DailyRecord[];
  period: PeriodInfo | null;
}

type LarkFormWidget = {
  type?: string;
  id?: string;
  name?: string;
  value?: any;
};

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

/** Format decimal hours → "Xh Yp" (hours + minutes, Vietnamese) */
function fmtHM(hours: number): string {
  if (hours <= 0) return '0h';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  if (h === 0) return `${m}p`;
  return `${h}h${m.toString().padStart(2, '0')}p`;
}

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

const OT_BUCKET_LABELS: Record<string, string> = {
  'OT 150%': 'Ngày thường 時間外 17h~22h',
  'OT 210%': 'Ngày thường 時間外(夜間まで残業) 22h~6h',
  'Ca đêm 30%': '平日の夜勤 22h~6h ca đêm',
  'OT 130%': '平日夜勤の残業→翌日の6h~22h Số giờ làm thêm của ca đêm',
  'OT 200%': 'Ngày nghỉ 休日出勤 6h~22h',
  'OT 270%': 'Ngày nghỉ ca đêm 休日の夜勤 22h~6h',
  'OT 300%': 'OT ngày lễ 祝日出勤',
  'OT 390%': 'OT ngày lễ ca đêm 祝日夜勤 22h~6h',
};

// ─── Vietnamese Public Holidays 2026 ──────────────────────
// Lunar holidays vary by year — must update annually
const VN_HOLIDAYS: Record<string, string> = {
  // Tết Dương lịch
  '01-01': 'Tết Dương lịch',
  // Tết Nguyên Đán 2026 (17/1 – 23/1 Dương lịch, 29 Tết – mùng 5)
  '01-17': 'Tết Nguyên Đán',
  '01-18': 'Tết Nguyên Đán',
  '01-19': 'Tết Nguyên Đán (Giao thừa)',
  '01-20': 'Tết Nguyên Đán (Mùng 1)',
  '01-21': 'Tết Nguyên Đán (Mùng 2)',
  '01-22': 'Tết Nguyên Đán (Mùng 3)',
  '01-23': 'Tết Nguyên Đán (Mùng 4)',
  // Giỗ Tổ Hùng Vương 10/3 ÂL → 2026: 26/4 (Thứ 7) + 27/4 (Nghỉ bù Thứ 2)
  '04-26': 'Giỗ Tổ Hùng Vương',
  '04-27': 'Nghỉ bù Giỗ Tổ Hùng Vương',
  // Giải phóng miền Nam + Quốc tế Lao động
  '04-30': 'Ngày Thống nhất 30/4',
  '05-01': 'Quốc tế Lao động 1/5',
  '05-02': 'Nghỉ bù 30/4 & 1/5',
  // Quốc khánh 2/9
  '09-02': 'Quốc khánh 2/9',
};

function isVNHoliday(iso: string): string | null {
  // iso: YYYY-MM-DD → extract MM-DD
  const mmdd = iso.slice(5, 10);
  return VN_HOLIDAYS[mmdd] || null;
}

interface DayInfo {
  iso: string;
  day: number;
  month: number;
  weekday: number;
  label: string;
  weekend: boolean;
  isHoliday: boolean;
  holidayName: string | null;
}

function buildDaysFromPeriod(period: PeriodInfo | null, monthKey: string): DayInfo[] {
  let startDate: Date;
  let endDate: Date;
  if (period) {
    startDate = new Date(period.periodStart);
    endDate = new Date(period.periodEnd);
  } else {
    const y = parseInt(monthKey.slice(0, 4));
    const m = parseInt(monthKey.slice(4));
    startDate = new Date(y, m - 1, 1);
    endDate = new Date(y, m, 0);
  }
  const days: DayInfo[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    const y = current.getFullYear();
    const m = current.getMonth() + 1;
    const d = current.getDate();
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const holidayName = isVNHoliday(iso);
    days.push({
      iso, day: d, month: m,
      weekday: current.getDay(),
      label: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][current.getDay()] ?? '',
      weekend: current.getDay() === 0 || current.getDay() === 6,
      isHoliday: !!holidayName,
      holidayName,
    });
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function fmtTime(dt: string | null | undefined): string {
  if (!dt) return '—';
  const d = new Date(dt);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}

function fmtDateRange(period: PeriodInfo): string {
  const start = new Date(period.periodStart);
  const end = new Date(period.periodEnd);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${fmt(start)} → ${fmt(end)}`;
}

function fmtFullDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
}

interface TimesheetRow {
  employee: EmployeeRow;
  records: Map<string, DailyRecord>;
  totalWork: number;
  totalLate: number;
  totalEarly: number;
  totalOT: number;
  fullDays: number;
  requiredDays: number; // working days required for this employee's department
}

/** Check if department is TTVT (works Mon-Sat) */
function isTTVT(dept: string): boolean {
  const d = dept.toUpperCase();
  return d.includes('TTVT') || d.includes('KHO') || d.includes('THIẾT BỊ');
}

/** Is this day a non-working day for the given department? */
function isDayOff(day: DayInfo, dept: string): boolean {
  // Holidays are off for everyone
  if (day.isHoliday) return true;
  // Sunday (0) is always off for everyone
  if (day.weekday === 0) return true;
  // Saturday (6) is off for non-TTVT departments only
  if (day.weekday === 6 && !isTTVT(dept)) return true;
  return false;
}

/** Count required working days for a department */
function countRequiredDays(days: DayInfo[], dept: string): number {
  return days.filter(d => !isDayOff(d, dept)).length;
}

interface EmployeeWeight {
  groupIndex: number;
  memberIndex: number;
  groupName: string;
  totalLabel: string;
  staffCodeDisplay: string;
}

export function getEmployeeOrderWeight(fullName: string, code: string | null, dept: string): EmployeeWeight {
  const c = code?.toUpperCase() || '';
  const name = fullName.toUpperCase().replace(/\s+/g, '');
  const d = dept.toUpperCase();

  // Expats group (groupIndex: 0)
  if (c === 'ASV001' || name.includes('TANAKA') || name.includes('KIIICHIRO') || d === 'BOD') {
    const isASV001 = c === 'ASV001' || name.includes('TANAKA') || name.includes('KIIICHIRO');
    return {
      groupIndex: 0,
      memberIndex: isASV001 ? 0 : 1,
      groupName: '駐在員 (Ban Giám đốc / Expats)',
      totalLabel: '駐在員Total',
      staffCodeDisplay: isASV001 ? 'ASV001' : 'ASV013'
    };
  }

  // Indirect group (groupIndex: 1)
  if (
    c === 'ASV002' || name.includes('BAOTRAN') || name === 'TRAN' ||
    c === 'ASV003' || name.includes('NGOCTRAM') || name === 'TRAM' ||
    c === 'ASV010' || name.includes('VANHAI') || name === 'HẢI' || name === 'HAI' ||
    c === 'ASV011' || name.includes('VANCANH') || name.includes('VĂNCẢNH') ||
    c === 'ASV014' || name.includes('THUTRANG') ||
    c === 'ASV022' || name.includes('VANHAU') || name.includes('VĂNHẬU') ||
    c === 'ASV024' || name.includes('VANSU') || name.includes('VĂNSỬ') ||
    d.includes('BPQL') || d.includes('PKD') || d.includes('TVTK')
  ) {
    let memberIndex = 99;
    let staffCodeDisplay = c || 'ASV---';
    if (c === 'ASV002' || name.includes('BAOTRAN') || name === 'TRAN') { memberIndex = 0; staffCodeDisplay = 'ASV002'; }
    else if (c === 'ASV003' || name.includes('NGOCTRAM') || name === 'TRAM') { memberIndex = 1; staffCodeDisplay = 'ASV003'; }
    else if (c === 'ASV010' || name.includes('VANHAI') || name === 'HẢI' || name === 'HAI') { memberIndex = 2; staffCodeDisplay = 'ASV010'; }
    else if (c === 'ASV011' || name.includes('VANCANH') || name.includes('VĂNCẢNH')) { memberIndex = 3; staffCodeDisplay = 'ASV011'; }
    else if (c === 'ASV014' || name.includes('THUTRANG')) { memberIndex = 4; staffCodeDisplay = 'ASV014'; }
    else if (c === 'ASV022' || name.includes('VANHAU') || name.includes('VĂNHẬU')) { memberIndex = 5; staffCodeDisplay = 'ASV022'; }
    else if (c === 'ASV024' || name.includes('VANSU') || name.includes('VĂNSỬ')) { memberIndex = 6; staffCodeDisplay = 'ASV024'; }

    return {
      groupIndex: 1,
      memberIndex,
      groupName: '間接部門 (Bộ phận Gián tiếp / Văn phòng)',
      totalLabel: '間接部門Total',
      staffCodeDisplay
    };
  }

  // Equipment center group (groupIndex: 2)
  if (
    c === 'ASV005' || name.includes('XUANTAI') || name === 'TAI' ||
    c === 'ASV008' || name.includes('DUCHUAN') || name === 'HUAN' ||
    c === 'ASV016' || c === 'ASV0016' || name.includes('NGOCKHANH') || name.includes('NGỌCKHÁNH') ||
    c === 'ASV017' || c === 'ASV0017' || name.includes('MINHCHAU') || name.includes('MINHCHÂU') ||
    c === 'ASV018' || c === 'ASV0018' || name.includes('ANHHUNG') || name.includes('ANHHÙNG') ||
    c === 'ASV023' || name.includes('THANHNOC') || name.includes('THANHNGOC') || name.includes('THANHNGỌC') ||
    d.includes('TTVT') || d.includes('KHO')
  ) {
    let memberIndex = 99;
    let staffCodeDisplay = c || 'ASV---';
    if (c === 'ASV005' || name.includes('XUANTAI') || name === 'TAI') { memberIndex = 0; staffCodeDisplay = 'ASV005'; }
    else if (c === 'ASV008' || name.includes('DUCHUAN') || name === 'HUAN') { memberIndex = 1; staffCodeDisplay = 'ASV008'; }
    else if (c === 'ASV016' || c === 'ASV0016' || name.includes('NGOCKHANH') || name.includes('NGỌCKHÁNH')) { memberIndex = 2; staffCodeDisplay = 'ASV016'; }
    else if (c === 'ASV017' || c === 'ASV0017' || name.includes('MINHCHAU') || name.includes('MINHCHÂU')) { memberIndex = 3; staffCodeDisplay = 'ASV017'; }
    else if (c === 'ASV018' || c === 'ASV0018' || name.includes('ANHHUNG') || name.includes('ANHHÙNG')) { memberIndex = 4; staffCodeDisplay = 'ASV018'; }
    else if (c === 'ASV023' || name.includes('THANHNOC') || name.includes('THANHNGOC') || name.includes('THANHNGỌC')) { memberIndex = 5; staffCodeDisplay = 'ASV023'; }

    return {
      groupIndex: 2,
      memberIndex,
      groupName: '機材センター (Trung tâm Thiết bị / Kho bãi)',
      totalLabel: '機材センターTotal',
      staffCodeDisplay
    };
  }

  // Fallback (groupIndex: 3)
  return {
    groupIndex: 3,
    memberIndex: 99,
    groupName: 'Bộ phận khác',
    totalLabel: 'KhácTotal',
    staffCodeDisplay: c || 'ASV---'
  };
}

function buildRows(employees: EmployeeRow[], records: DailyRecord[], days: DayInfo[], search: string): TimesheetRow[] {
  const recMap = new Map<string, Map<string, DailyRecord>>();
  for (const r of records) {
    if (!recMap.has(r.employeeId)) recMap.set(r.employeeId, new Map());
    recMap.get(r.employeeId)!.set(r.attendanceDate.slice(0, 10), r);
  }
  return employees
    .filter(e => !search || e.fullName.toLowerCase().includes(search.toLowerCase()) || e.department.toLowerCase().includes(search.toLowerCase()))
    .map(emp => {
      const empRecords = recMap.get(emp.id) || new Map<string, DailyRecord>();
      const required = countRequiredDays(days, emp.department);
      let totalWork = 0, totalLate = 0, totalEarly = 0, totalOT = 0, fullDays = 0;
      for (const day of days) {
        if (isDayOff(day, emp.department)) continue; // skip off-days entirely
        const r = empRecords.get(day.iso);
        if (r) {
          totalWork += r.workHours;
          totalLate += r.lateHours;
          totalEarly += r.earlyHours;
          totalOT += r.otHoursPreliminary;
          const code = getCellCode(day, r, emp.department);
          const hasUnpaidLeave = (r.approvals ?? []).some(a => a.status === 'APPROVED' && a.leaveTypeBucket === 'UNPAID');
          const isCredited = (code === '✓' || code === 'P' || code === 'L' || code === 'R' || code === 'CĐ' || code === 'B') && !hasUnpaidLeave;
          if (isCredited) {
            fullDays++;
          }
        }
      }
      return { employee: emp, records: empRecords, totalWork, totalLate, totalEarly, totalOT, fullDays, requiredDays: required };
    })
    .sort((a, b) => {
      const wA = getEmployeeOrderWeight(a.employee.fullName, a.employee.employeeCode ?? null, a.employee.department);
      const wB = getEmployeeOrderWeight(b.employee.fullName, b.employee.employeeCode ?? null, b.employee.department);
      if (wA.groupIndex !== wB.groupIndex) return wA.groupIndex - wB.groupIndex;
      return wA.memberIndex - wB.memberIndex;
    });
}

function getCellCode(day: DayInfo, record: DailyRecord | undefined, dept: string): string {
  const off = isDayOff(day, dept);

  // Off-day: show day type indicator regardless of record
  if (off) {
    if (day.isHoliday) return '—';
    return '—'; // weekend dash
  }

  if (!record) return '×';
  const c = (record.conclusion || '').toLowerCase();
  if (c.includes('đủ công')) return '✓';
  if (c.includes('phép') || c.includes('leave')) return 'P';
  if (c === 'holiday' || c === 'ngày lễ') return 'L';
  if (c === 'remote') return 'R';
  if (c === 'benefit_leave') return 'CĐ';
  if (c === 'comp_leave') return 'B';
  if (c.includes('đang làm')) return '•';
  if (c === 'thiếu check-in' || c === 'thiếu check-out') return '!';
  if (record.workHours >= 8) return '✓';

  // Check comp leave: workHours + compLeaveHours >= 8 → đủ công
  const compLeaveHours = (record.approvals ?? []).reduce((s, a) => {
    if (a.approvalType === 'ChangeHours' && a.status === 'APPROVED' &&
        a.changeWorkingFrame?.compLeaveHours && a.changeWorkingFrame.compLeaveHours > 0) {
      return s + a.changeWorkingFrame.compLeaveHours;
    }
    return s;
  }, 0);
  if (compLeaveHours > 0 && record.workHours + compLeaveHours >= 8) return '✓';

  if (record.workHours > 0) return '!'; // partial day → just icon, no number
  if (c === 'không chấm công' || c === 'thiếu công') return '×';
  return '×';
}

function getCellClasses(day: DayInfo, record: DailyRecord | undefined, dept: string): string {
  const off = isDayOff(day, dept);

  // Off-day: always same styling regardless of record
  if (off) {
    if (day.isHoliday) return 'bg-red-50/60 text-red-300';
    return 'bg-gray-50/80 text-gray-300';
  }

  if (!record) return 'text-gray-300';
  const code = getCellCode(day, record, dept);
  let fg = 'text-amber-600';
  if (code === '✓') fg = 'text-emerald-600';
  else if (code === 'P') fg = 'text-violet-600';
  else if (code === 'L') fg = 'text-red-400';
  else if (code === 'R') fg = 'text-blue-600';
  else if (code === 'CĐ' || code === 'B') fg = 'text-orange-600';
  else if (code === '•') fg = 'text-blue-600';
  else if (code === '!') fg = 'text-amber-600';
  else if (code === '×') fg = 'text-red-400';
  return fg;
}

function supplementLabel(s: string | null): string | null {
  if (!s || s === 'None') return null;
  // 'Leave' is Lark's auto-tag for late arrivals — NOT an actual leave request
  // Only show supplements that represent actual user actions
  const ignore = new Set(['Leave', 'Normal']);
  if (ignore.has(s)) return null;
  const m: Record<string, string> = {
    ManagerModification: 'Admin sửa', CardReplacement: 'Bổ sung công',
    ShiftChange: 'Đổi ca', Travel: 'Công tác',
    GoOut: 'Ngoài VP', FieldPunch: 'Chấm ngoài', CardReplacementApplication: 'Đang xin bổ sung',
  };
  return m[s] || null; // Don't show unknown supplements
}

function escapeExcelCell(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ATTENDANCE_LEGEND = [
  { code: '✓', label: 'Đủ công', note: 'Ngày làm đủ công hoặc đã được bù đủ bằng phép/nghỉ bù.' },
  { code: '×', label: 'Vắng / không chấm công', note: 'Ngày làm việc không có dữ liệu chấm công hợp lệ.' },
  { code: '!', label: 'Thiếu', note: 'Thiếu check-in/check-out, thiếu công, đi trễ hoặc về sớm.' },
  { code: 'P', label: 'Phép', note: 'Có phiếu nghỉ phép/chế độ được duyệt.' },
  { code: 'R', label: 'Remote', note: 'Làm việc từ xa/công tác được ghi nhận.' },
  { code: 'L', label: 'Ngày lễ', note: 'Ngày nghỉ lễ trong lịch công.' },
  { code: 'B / CĐ', label: 'Nghỉ bù / chế độ', note: 'Được cộng công từ phiếu nghỉ bù hoặc loại phép hưởng lương.' },
  { code: '—', label: 'Ngày nghỉ', note: 'T7/CN hoặc ngày nghỉ theo lịch của nhóm nhân sự.' },
  { code: '⚡', label: 'Có phiếu OT', note: 'Ô có đơn làm thêm giờ đã duyệt; xem bảng chi tiết để biết serial, giờ, bucket.' },
  { code: '🌙', label: 'Ca đêm', note: 'Có phiếu đổi ca/ca đêm liên quan.' },
  { code: '📝', label: 'Chỉnh công', note: 'Có phiếu điều chỉnh/quên chấm công được duyệt.' },
];

function approvalTypeText(a: DayApproval): string {
  if (a.approvalType === 'Correction') return 'Chỉnh sửa chấm công';
  if (a.approvalType === 'Leave') return 'Nghỉ phép';
  if (a.approvalType === 'OT') return 'Làm thêm giờ (OT)';
  if (a.approvalType === 'NightShift') return 'Ca đêm';
  if (a.approvalType === 'ChangeHours') {
    const isCompLeave = !!(a.changeWorkingFrame?.compLeaveHours && a.changeWorkingFrame.compLeaveHours > 0);
    return isCompLeave ? 'Nghỉ bù' : (a.changeWorkingFrame?.isNightShift ? 'Đổi ca đêm' : 'Đổi giờ làm');
  }
  return a.approvalType || 'Phiếu';
}

function approvalRef(a: DayApproval): string {
  return a.serialNumber || a.instanceCode || a.id;
}

function fmtExcelDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatApprovalSummary(a: DayApproval): string {
  const amount = a.approvedDays > 0 ? `${a.approvedDays} ngày` : fmtHM(a.approvedHours);
  return `${approvalRef(a)} - ${approvalTypeText(a)} - ${amount}`;
}

function formatApprovalDetail(a: DayApproval): string {
  const lines = [
    formatApprovalSummary(a),
    `Thời gian: ${fmtExcelDateTime(a.startTime)} → ${fmtExcelDateTime(a.endTime)}`,
  ];

  if (a.approvalType === 'OT' && a.otBuckets?.length) {
    lines.push(`Bucket OT: ${a.otBuckets.map((b) => {
      const label = OT_BUCKET_LABELS[b.bucket] ?? b.bucket;
      return `${label} (${fmtHM(b.approvedHours)} duyệt, ${fmtHM(b.validHours)} hợp lệ, hệ số ${b.rate}x)`;
    }).join('; ')}`);
  }

  if (a.approvalType === 'Leave' && a.leaveType) {
    lines.push(`Loại nghỉ: ${a.leaveType}`);
  }

  if (a.approvalType === 'ChangeHours' && a.changeWorkingFrame) {
    const frame = a.changeWorkingFrame;
    if (frame.compLeaveHours) {
      lines.push(`Nghỉ bù: ${fmtHM(frame.compLeaveHours)}`);
      lines.push(`OT nguồn: ${fmtExcelDateTime(frame.workedPeriodStart)} → ${fmtExcelDateTime(frame.workedPeriodEnd)}`);
    }
    lines.push(`Khung áp dụng: ${fmtExcelDateTime(frame.shiftStart)} → ${fmtExcelDateTime(frame.shiftEnd)}`);
  }

  return lines.join('\n');
}

function recordMarkers(record: DailyRecord | undefined): string {
  if (!record) return '';
  const markers: string[] = [];
  if ((record.approvals ?? []).some((a) => a.approvalType === 'OT')) markers.push('⚡');
  if ((record.approvals ?? []).some((a) => a.approvalType === 'ChangeHours' && a.changeWorkingFrame?.isNightShift)) markers.push('🌙');
  if ((record.approvals ?? []).some((a) => a.approvalType === 'Correction')) markers.push('📝');
  return markers.length ? ` ${markers.join('')}` : '';
}

function dayKindText(day: DayInfo, dept: string): string {
  if (day.isHoliday) return `Ngày lễ${day.holidayName ? ` - ${day.holidayName}` : ''}`;
  if (isDayOff(day, dept)) return day.label === 'CN' ? 'Chủ nhật / ngày nghỉ' : 'Thứ bảy / ngày nghỉ';
  return 'Ngày làm việc';
}

function recordLocationText(record: DailyRecord | undefined): string {
  if (!record) return '—';
  const parts = [
    record.checkInLocation ? `In: ${record.checkInLocation}` : null,
    record.checkOutLocation ? `Out: ${record.checkOutLocation}` : null,
    record.checkInIsWifi && record.checkInWifi ? `Wifi: ${record.checkInWifi}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join('\n') : '—';
}

function recordNoteText(record: DailyRecord | undefined, day: DayInfo, dept: string): string {
  const notes: string[] = [];
  if (day.isHoliday && day.holidayName) notes.push(day.holidayName);
  if (isDayOff(day, dept) && !day.isHoliday) notes.push(dayKindText(day, dept));
  if (!record) {
    if (!isDayOff(day, dept)) notes.push('Không có record chấm công');
    return notes.join('\n') || '—';
  }
  const inSupp = supplementLabel(record.checkInSupplement);
  const outSupp = supplementLabel(record.checkOutSupplement);
  if (inSupp) notes.push(`Check-in: ${inSupp}`);
  if (outSupp) notes.push(`Check-out: ${outSupp}`);
  if (record.effectiveLateHours !== record.lateHours) notes.push(`Đi trễ sau phép/chỉnh công: ${fmtHM(record.effectiveLateHours)}`);
  if (record.effectiveEarlyHours !== record.earlyHours) notes.push(`Về sớm sau phép/chỉnh công: ${fmtHM(record.effectiveEarlyHours)}`);
  if (record.correctionCredit) notes.push(`Phiếu chỉnh công bù ${fmtHM(record.correctionCredit.workCreditHours)}`);
  return notes.join('\n') || '—';
}

type ExcelXmlDataType = 'String' | 'Number';

type ExcelXmlCell = {
  value: unknown;
  style?: string;
  type?: ExcelXmlDataType;
  mergeAcross?: number;
};

function excelXmlType(value: unknown): ExcelXmlDataType {
  return typeof value === 'number' && Number.isFinite(value) ? 'Number' : 'String';
}

function excelXmlCell(cell: ExcelXmlCell): string {
  const type = cell.type ?? excelXmlType(cell.value);
  const attrs = [
    cell.style ? `ss:StyleID="${cell.style}"` : '',
    cell.mergeAcross ? `ss:MergeAcross="${cell.mergeAcross}"` : '',
  ].filter(Boolean).join(' ');
  const data = type === 'Number' && typeof cell.value === 'number'
    ? String(cell.value)
    : escapeExcelCell(cell.value);
  return `<Cell${attrs ? ` ${attrs}` : ''}><Data ss:Type="${type}">${data}</Data></Cell>`;
}

function excelXmlRow(cells: ExcelXmlCell[], height?: number): string {
  return `<Row${height ? ` ss:Height="${height}"` : ''}>${cells.map(excelXmlCell).join('')}</Row>`;
}

function excelXmlColumns(widths: number[]): string {
  return widths.map((width) => `<Column ss:Width="${width}" />`).join('');
}

function excelXmlSheetName(name: string): string {
  return name.replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet';
}

function excelXmlCellStyle(day: DayInfo, record: DailyRecord | undefined, dept: string): string {
  const code = getCellCode(day, record, dept);
  if (day.isHoliday) return 'Holiday';
  if (isDayOff(day, dept)) return 'Off';
  if (code === '✓') return 'Ok';
  if (code === '×') return 'Bad';
  if (code === '!') return 'Warn';
  if (code === 'P') return 'Leave';
  if (code === 'R') return 'Remote';
  if (code === 'B' || code === 'CĐ') return 'Comp';
  return 'Center';
}

function excelXmlWorksheet(name: string, widths: number[], rows: string[], freezeRows = 0): string {
  const freezeOptions = freezeRows > 0
    ? `<FreezePanes/><FrozenNoSplit/><SplitHorizontal>${freezeRows}</SplitHorizontal><TopRowBottomPane>${freezeRows}</TopRowBottomPane><ActivePane>2</ActivePane>`
    : '';
  return `<Worksheet ss:Name="${escapeExcelCell(excelXmlSheetName(name))}">
    <Table>${excelXmlColumns(widths)}${rows.join('')}</Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      ${freezeOptions}
      <Panes><Pane><Number>2</Number></Pane></Panes>
      <ProtectObjects>False</ProtectObjects>
      <ProtectScenarios>False</ProtectScenarios>
    </WorksheetOptions>
  </Worksheet>`;
}

function downloadAttendanceExcel(rows: TimesheetRow[], days: DayInfo[], period: PeriodInfo | null, monthKey: string) {
  const title = `Bảng công ${fmtMonthLabel(period?.monthKey ?? monthKey)}`;
  const headers = [
    'STT',
    'Mã NV',
    'Họ và tên',
    'Bộ phận',
    'Loại lịch',
    ...days.map((day) => `${String(day.day).padStart(2, '0')}/${String(day.month).padStart(2, '0')} ${day.label}`),
    'Công thực',
    'Công chuẩn',
    'Giờ làm',
    'Đi trễ',
    'Về sớm',
    'OT',
  ];

  const summaryRows = rows.map((row, index) => {
    const baseCells = [
      index + 1,
      row.employee.employeeCode || '',
      row.employee.fullName,
      row.employee.department,
      row.employee.scheduleType,
    ];
    const summaryCells = [
      row.fullDays,
      row.requiredDays,
      fmtHM(row.totalWork),
      fmtHM(row.totalLate),
      fmtHM(row.totalEarly),
      fmtHM(row.totalOT),
    ];
    const dayCells: ExcelXmlCell[] = days.map((day) => {
      const record = row.records.get(day.iso);
      const value = `${getCellCode(day, record, row.employee.department)}${recordMarkers(record)}`;
      return { value, style: excelXmlCellStyle(day, record, row.employee.department) };
    });
    return excelXmlRow([
      ...baseCells.map((cell, idx) => ({ value: cell, style: idx === 0 ? 'Right' : 'Default' })),
      ...dayCells,
      ...summaryCells.map((cell) => ({ value: cell, style: 'Summary' })),
    ]);
  });

  const detailHeaders = [
    'STT',
    'Mã NV',
    'Nhân sự',
    'Bộ phận',
    'Ngày',
    'Loại ngày',
    'Ký hiệu',
    'Ca',
    'Check-in',
    'Check-out',
    'Giờ công',
    'Đi trễ',
    'Về sớm',
    'Kết luận',
    'Địa điểm / Wifi',
    'Ghi chú chấm công',
    'Phiếu liên quan',
    'Chi tiết phiếu',
  ];

  let detailIndex = 0;
  const detailRows = rows.flatMap((row) => days.map((day) => {
    const record = row.records.get(day.iso);
    const code = `${getCellCode(day, record, row.employee.department)}${recordMarkers(record)}`;
    const approvals = record?.approvals ?? [];
    const shift = record?.shiftCheckIn ? `${fmtTime(record.shiftCheckIn)} - ${fmtTime(record.shiftCheckOut)}` : '—';
    detailIndex += 1;
    const cells = [
      detailIndex,
      row.employee.employeeCode || '',
      row.employee.fullName,
      row.employee.department,
      `${day.iso} ${day.label}`,
      dayKindText(day, row.employee.department),
      code,
      shift,
      fmtTime(record?.checkIn),
      fmtTime(record?.checkOut),
      record ? fmtHM(record.workHours) : '—',
      record ? fmtHM(record.effectiveLateHours ?? record.lateHours) : '—',
      record ? fmtHM(record.effectiveEarlyHours ?? record.earlyHours) : '—',
      record?.conclusion || (isDayOff(day, row.employee.department) ? 'Ngày nghỉ' : 'Không chấm công'),
      recordLocationText(record),
      recordNoteText(record, day, row.employee.department),
      approvals.length ? approvals.map(formatApprovalSummary).join('\n') : '—',
      approvals.length ? approvals.map(formatApprovalDetail).join('\n\n') : '—',
    ];
    return excelXmlRow(cells.map((cell, idx) => ({
      value: cell,
      style: idx === 0 || (idx >= 10 && idx <= 12) ? 'Right' : idx >= 14 ? 'Wrap' : 'Default',
    })));
  }));

  const mainWidths = [
    42, 72, 165, 145, 82,
    ...days.map(() => 38),
    70, 70, 74, 74, 74, 74,
  ];
  const detailWidths = [42, 72, 165, 145, 95, 155, 72, 120, 112, 112, 78, 78, 78, 180, 220, 260, 300, 420];

  const mainRows = [
    excelXmlRow([{ value: title, style: 'Title', mergeAcross: headers.length - 1 }], 30),
    period ? excelXmlRow([{ value: `Kỳ công: ${fmtDateRange(period)} · Trạng thái: ${period.status}`, style: 'Meta', mergeAcross: headers.length - 1 }], 24) : '',
    excelXmlRow(headers.map((header) => ({ value: header, style: 'Header' })), 32),
    ...summaryRows,
    excelXmlRow([{ value: '', mergeAcross: headers.length - 1 }], 12),
    excelXmlRow([{ value: 'Chú thích ký hiệu', style: 'Section', mergeAcross: 2 }], 24),
    excelXmlRow(['Ký hiệu', 'Ý nghĩa', 'Ghi chú'].map((header) => ({ value: header, style: 'Header' })), 24),
    ...ATTENDANCE_LEGEND.map((item) => excelXmlRow([
      { value: item.code, style: 'LegendCode' },
      { value: item.label, style: 'Default' },
      { value: item.note, style: 'Wrap' },
    ])),
  ].filter(Boolean) as string[];

  const detailSheetRows = [
    excelXmlRow([{ value: 'Chi tiết ngày / ghi chú / phiếu liên quan', style: 'Title', mergeAcross: detailHeaders.length - 1 }], 30),
    period ? excelXmlRow([{ value: `Kỳ công: ${fmtDateRange(period)} · Trạng thái: ${period.status}`, style: 'Meta', mergeAcross: detailHeaders.length - 1 }], 24) : '',
    excelXmlRow(detailHeaders.map((header) => ({ value: header, style: 'Header' })), 32),
    ...detailRows,
  ].filter(Boolean) as string[];

  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Author>ASNOVA Payroll</Author>
    <Title>${escapeExcelCell(title)}</Title>
    <Created>${new Date().toISOString()}</Created>
  </DocumentProperties>
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Top"/>
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#b7c4d6"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#b7c4d6"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#b7c4d6"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#b7c4d6"/></Borders>
      <Font ss:FontName="Arial" ss:Size="10" ss:Color="#111827"/>
    </Style>
    <Style ss:ID="Header" ss:Parent="Default"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1f4e79" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Title" ss:Parent="Default"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="16" ss:Bold="1" ss:Color="#1f2937"/><Interior ss:Color="#d9eaf7" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Meta" ss:Parent="Default"><Font ss:FontName="Arial" ss:Size="10" ss:Color="#475569"/><Interior ss:Color="#f8fafc" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Section" ss:Parent="Default"><Font ss:FontName="Arial" ss:Size="12" ss:Bold="1" ss:Color="#1e3a8a"/><Interior ss:Color="#eef2ff" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Center" ss:Parent="Default"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1"/></Style>
    <Style ss:ID="Right" ss:Parent="Default"><Alignment ss:Horizontal="Right" ss:Vertical="Top"/></Style>
    <Style ss:ID="Wrap" ss:Parent="Default"><Alignment ss:Vertical="Top" ss:WrapText="1"/></Style>
    <Style ss:ID="Summary" ss:Parent="Default"><Alignment ss:Horizontal="Right" ss:Vertical="Top"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1"/><Interior ss:Color="#f8fafc" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Ok" ss:Parent="Center"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#047857"/><Interior ss:Color="#ecfdf5" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Bad" ss:Parent="Center"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#dc2626"/><Interior ss:Color="#fef2f2" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Warn" ss:Parent="Center"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#b45309"/><Interior ss:Color="#fffbeb" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Leave" ss:Parent="Center"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#6d28d9"/><Interior ss:Color="#f5f3ff" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Remote" ss:Parent="Center"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#2563eb"/><Interior ss:Color="#eff6ff" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Comp" ss:Parent="Center"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#c2410c"/><Interior ss:Color="#fff7ed" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Off" ss:Parent="Center"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#6b7280"/><Interior ss:Color="#f3f4f6" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Holiday" ss:Parent="Center"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#b91c1c"/><Interior ss:Color="#fee2e2" ss:Pattern="Solid"/></Style>
    <Style ss:ID="LegendCode" ss:Parent="Center"><Interior ss:Color="#f8fafc" ss:Pattern="Solid"/></Style>
  </Styles>
  ${excelXmlWorksheet('Bảng công', mainWidths, mainRows, 3)}
  ${excelXmlWorksheet('Chi tiết ngày', detailWidths, detailSheetRows, 3)}
</Workbook>`;

  const blob = new Blob(['\ufeff', workbookXml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ASNOVA-Cham-cong-${period?.monthKey ?? monthKey}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ═══════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════

export default function Attendance() {
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [detailModal, setDetailModal] = useState<{
    record: DailyRecord; day: DayInfo; employee: EmployeeRow;
  } | null>(null);

  const { data, isLoading } = useQuery<TimesheetResponse>({
    queryKey: ['attendance-daily', monthKey],
    queryFn: async () => {
      const { data } = await api.get<TimesheetResponse>(`/attendance/daily?monthKey=${monthKey}`);
      return data;
    },
  });

  const period = data?.period ?? null;

  const days = useMemo(() => buildDaysFromPeriod(period, monthKey), [period, monthKey]);
  const rows = useMemo(() => {
    if (!data) return [];
    return buildRows(data.employees || [], data.records || [], days, search);
  }, [data, days, search]);


  const avgRate = rows.length > 0
    ? (rows.reduce((s, r) => s + r.fullDays, 0) / rows.reduce((s, r) => s + r.requiredDays, 0) * 100) : 0;
  const lateCount = rows.filter(r => r.totalLate > 0).length;
  const absentCount = rows.filter(r => r.fullDays < r.requiredDays).length;
  const fullCount = rows.filter(r => r.fullDays >= r.requiredDays).length;

  const handleCellClick = useCallback((record: DailyRecord | undefined, day: DayInfo, employee: EmployeeRow) => {
    if (record) setDetailModal({ record, day, employee });
  }, []);

  const handleExportExcel = useCallback(() => {
    if (rows.length === 0) return;
    downloadAttendanceExcel(rows, days, period, monthKey);
  }, [rows, days, period, monthKey]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      className="space-y-5">
      <PageHeader title="Chấm công" subtitle={`Bảng công — ${fmtMonthLabel(monthKey)}${period ? ` (${fmtDateRange(period)})` : ''}`}>
        <Button
          variant="outline"
          size="sm"
          icon={Download}
          disabled={isLoading || rows.length === 0}
          onClick={handleExportExcel}
        >
          Xuất Excel
        </Button>
      </PageHeader>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Tỷ lệ công" value={`${avgRate.toFixed(1)}%`}
          subtitle={`${rows.length} nhân viên`} icon={CalendarDays} color="#2563eb" />
        <KpiCard label="Tổng giờ OT"
          value={fmtHM(rows.reduce((s, r) => s + r.totalOT, 0))}
          subtitle={`${rows.filter(r => r.totalOT > 0).length} người có OT`}
          icon={Clock} color="#d97706" />
        <KpiCard label="Đi trễ / Về sớm" value={lateCount.toString()}
          subtitle="nhân viên có giờ trễ" icon={AlertTriangle} color="#dc2626" />
        <KpiCard label="Đủ công" value={fullCount.toString()}
          subtitle={`${absentCount} người thiếu công`} icon={CheckCircle2} color="#16a34a" />
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg px-1 py-0.5 shadow-sm">
          <button onClick={() => setMonthKey(prevMonth(monthKey))}
            className="p-1.5 rounded hover:bg-gray-100 transition-colors cursor-pointer">
            <ChevronLeft size={14} className="text-gray-500" />
          </button>
          <span className="text-sm font-semibold px-3 tabular-nums min-w-[130px] text-center text-gray-800">
            {fmtMonthLabel(monthKey)}
          </span>
          <button onClick={() => setMonthKey(nextMonth(monthKey))}
            className="p-1.5 rounded hover:bg-gray-100 transition-colors cursor-pointer">
            <ChevronRight size={14} className="text-gray-500" />
          </button>
        </div>

        <div className="flex-1 max-w-[220px]">
          <FormInput placeholder="Tìm nhân viên..." value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>

        {/* View toggle */}
        <div className="flex items-center bg-white border border-gray-200 rounded-lg p-0.5 shadow-sm">
          <button onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded transition-colors cursor-pointer ${viewMode === 'grid' ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>
            <LayoutGrid size={14} />
          </button>
          <button onClick={() => setViewMode('table')}
            className={`p-1.5 rounded transition-colors cursor-pointer ${viewMode === 'table' ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>
            <List size={14} />
          </button>
        </div>

        {viewMode === 'grid' && (
          <div className="flex items-center gap-1.5 text-[10px] ml-auto flex-wrap">
            {[
              { code: '✓', label: 'Đủ công', bg: '#ecfdf5', fg: '#059669' },
              { code: '×', label: 'Vắng', bg: '#fef2f2', fg: '#dc2626' },
              { code: '!', label: 'Thiếu', bg: '#fef2f2', fg: '#ef4444' },
              { code: 'P', label: 'Phép', bg: '#f5f3ff', fg: '#7c3aed' },
              { code: 'R', label: 'Remote', bg: '#eff6ff', fg: '#2563eb' },
              { code: 'L', label: 'Lễ', bg: '#fef2f2', fg: '#dc2626' },
            ].map(l => (
              <span key={l.code} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold"
                style={{ backgroundColor: l.bg, color: l.fg }}>
                {l.code} {l.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <Loader2 size={24} className="animate-spin text-blue-500 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Đang tải bảng công...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
          <CalendarDays size={32} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-600 mb-1">Chưa có dữ liệu chấm công</p>
          <p className="text-xs text-gray-400">Dữ liệu sẽ được đồng bộ tự động từ Lark</p>
        </div>
      ) : viewMode === 'grid' ? (
        <TimesheetGrid rows={rows} days={days} onCellClick={handleCellClick} />
      ) : (
        <AttendanceTable rows={rows} days={days} onRowClick={(rec, day, emp) => setDetailModal({ record: rec, day, employee: emp })} />
      )}

      {/* Modal */}
      <AnimatePresence>
        {detailModal && (
          <DetailModal {...detailModal} onClose={() => setDetailModal(null)} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════
// TIMESHEET GRID
// ═══════════════════════════════════════════════════════════

function TimesheetGrid({ rows, days, onCellClick }: {
  rows: TimesheetRow[]; days: DayInfo[];
  onCellClick: (r: DailyRecord | undefined, d: DayInfo, e: EmployeeRow) => void;
}) {
  // Group rows in memory
  const groups = useMemo(() => {
    const map = new Map<number, { groupName: string; totalLabel: string; items: TimesheetRow[] }>();
    for (const r of rows) {
      const weight = getEmployeeOrderWeight(r.employee.fullName, r.employee.employeeCode ?? null, r.employee.department);
      if (!map.has(weight.groupIndex)) {
        map.set(weight.groupIndex, {
          groupName: weight.groupName,
          totalLabel: weight.totalLabel,
          items: []
        });
      }
      map.get(weight.groupIndex)!.items.push(r);
    }
    // Sort keys
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([_, val]) => val);
  }, [rows]);

  let sttCounter = 0;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[1200px] border-collapse text-sm">
          <thead>
            {/* Weekday labels */}
            <tr>
              <th rowSpan={2}
                className="sticky left-0 z-30 w-[190px] min-w-[190px] bg-gray-50 border-b border-r border-gray-200 px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                Nhân sự
              </th>
              {days.map(day => (
                <th key={`w-${day.iso}`}
                  title={day.holidayName || undefined}
                  className={`border-b border-r border-gray-100 px-0 py-1 text-center text-[10px] font-semibold uppercase
                    ${day.isHoliday ? 'bg-red-50 text-red-400' : day.weekend ? 'bg-gray-100 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>
                  {day.isHoliday ? 'L' : day.label}
                </th>
              ))}
              <th rowSpan={2}
                className="sticky right-0 z-30 w-[70px] min-w-[70px] bg-gray-50 border-b border-l border-gray-200 px-2 py-2 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                Tổng
              </th>
            </tr>
            {/* Day numbers */}
            <tr>
              {days.map((day, i) => {
                const showMonth = i === 0 || day.month !== days[i - 1]?.month;
                return (
                  <th key={`d-${day.iso}`}
                    className={`border-b border-r border-gray-100 px-0 py-1 text-center text-[10px] font-mono font-medium
                      ${day.isHoliday ? 'bg-red-50 text-red-400' : day.weekend ? 'bg-gray-100 text-gray-400' : 'bg-gray-50/80 text-gray-500'}
                      ${showMonth ? 'border-l-2 border-l-blue-300' : ''}`}>
                    {String(day.day).padStart(2, '0')}
                    {showMonth && (
                      <span className="block text-[7px] text-blue-400 font-semibold leading-none">T{day.month}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              if (group.items.length === 0) return null;

              return (
                <React.Fragment key={group.groupName}>
                  {/* Group header row */}
                  <tr className="bg-slate-50 border-y border-slate-200">
                    <td colSpan={days.length + 2} className="sticky left-0 bg-slate-50/95 font-bold text-[11px] text-slate-700 px-3 py-1.5 uppercase tracking-wide z-10">
                      {group.groupName}
                    </td>
                  </tr>

                  {/* Group members */}
                  {group.items.map(row => {
                    sttCounter++;
                    const stt = sttCounter;
                    const weight = getEmployeeOrderWeight(row.employee.fullName, row.employee.employeeCode ?? null, row.employee.department);

                    return (
                      <tr key={row.employee.id} className="group hover:bg-blue-50/30 transition-colors">
                        {/* Employee */}
                        <td className="sticky left-0 z-20 w-[190px] min-w-[190px] bg-white border-b border-r border-gray-100 px-3 py-1.5 group-hover:bg-blue-50/30 transition-colors shadow-[2px_0_4px_-2px_rgba(0,0,0,0.04)]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[10px] font-mono font-semibold text-gray-400 w-4 text-right shrink-0">{stt}.</span>
                            {row.employee.avatarUrl ? (
                              <img src={row.employee.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center text-[8px] font-bold text-blue-500 shrink-0">
                                {row.employee.fullName.split(' ').slice(-2).map(w => w[0]).join('').toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 justify-between">
                                <p className="text-[11px] font-bold text-gray-800 truncate leading-tight">{row.employee.fullName}</p>
                                {weight.staffCodeDisplay && (
                                  <span className="text-[8px] font-mono px-1 rounded bg-slate-100 text-slate-500 font-bold shrink-0">{weight.staffCodeDisplay}</span>
                                )}
                              </div>
                              <p className="text-[9px] text-gray-400 truncate leading-tight mt-0.5">{row.employee.position && row.employee.position !== 'N/A' ? row.employee.position : row.employee.department}</p>
                            </div>
                          </div>
                        </td>

                        {/* Day cells */}
                        {days.map(day => {
                          const record = row.records.get(day.iso);
                          return (
                            <DayCell key={`${row.employee.id}-${day.iso}`}
                              day={day} record={record} dept={row.employee.department}
                              onClick={() => onCellClick(record, day, row.employee)} />
                          );
                        })}

                        {/* Summary */}
                        <td className="sticky right-0 z-20 w-[70px] min-w-[70px] bg-white border-b border-l border-gray-100 px-2 py-1.5 text-center group-hover:bg-blue-50/30 transition-colors shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.04)]">
                          <p className={`text-[11px] font-bold tabular-nums ${row.fullDays >= row.requiredDays ? 'text-emerald-600' : 'text-gray-700'}`}>
                            {row.fullDays}/{row.requiredDays}
                          </p>
                          <p className="text-[8px] text-gray-400">
                            {row.fullDays >= row.requiredDays ? 'đủ công' : `thiếu ${row.requiredDays - row.fullDays}`}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// DAY CELL — hover shows tooltip BELOW the cell
// ═══════════════════════════════════════════════════════════

function DayCell({ day, record, dept, onClick }: {
  day: DayInfo; record: DailyRecord | undefined; dept: string; onClick: () => void;
}) {
  const cellRef = useRef<HTMLTableCellElement>(null);
  const [showTip, setShowTip] = useState(false);
  const code = getCellCode(day, record, dept);
  const cls = getCellClasses(day, record, dept);
  const off = isDayOff(day, dept);
  const hasData = !!record && (record.checkIn != null || record.workHours > 0);
  const hasApprovals = !!record && (record.approvals?.length ?? 0) > 0;
  const canOpen = hasData || hasApprovals;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEnter = useCallback(() => {
    timerRef.current = setTimeout(() => setShowTip(true), 200);
  }, []);

  const onLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setShowTip(false);
  }, []);

  return (
    <td ref={cellRef}
      className={`border-b border-r border-gray-100 p-0 text-center ${cls} ${canOpen || off ? 'cursor-pointer' : ''}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={canOpen ? onClick : undefined}
    >
      <div className="relative flex h-7 w-full min-w-[24px] items-center justify-center font-mono text-[10px] font-bold tabular-nums select-none">
        {code}
        {/* OT indicator dot — small lightning at bottom-right of cell */}
        {record?.approvals?.some(a => a.approvalType === 'OT') && (
          <span className="absolute bottom-0.5 right-0.5 text-[6px] leading-none text-blue-500" title="Có OT">⚡</span>
        )}
        {/* Night shift indicator */}
        {record?.approvals?.some(a => a.approvalType === 'ChangeHours' && a.changeWorkingFrame?.isNightShift) && (
          <span className="absolute top-0.5 right-0.5 text-[6px] leading-none text-indigo-500" title="Ca đêm">🌙</span>
        )}
      </div>
      {/* Tooltip positioned relative to cell */}
      {showTip && cellRef.current && (
        <CellTooltip anchorEl={cellRef.current} record={record} day={day} dept={dept} />
      )}
    </td>
  );
}

// ═══════════════════════════════════════════════════════════
// CELL TOOLTIP — contextual based on day type
// ═══════════════════════════════════════════════════════════

function CellTooltip({ anchorEl, record, day, dept }: {
  anchorEl: HTMLElement; record: DailyRecord | undefined; day: DayInfo; dept: string;
}) {
  const rect = anchorEl.getBoundingClientRect();
  const tipW = 270;
  let left = rect.left + rect.width / 2 - tipW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
  const spaceBelow = window.innerHeight - rect.bottom;
  const top = spaceBelow < 120 ? rect.top - 130 : rect.bottom + 6;

  const off = isDayOff(day, dept);
  const hasCheckIn = record?.checkIn != null;
  const isNoAttendance = !record || (!hasCheckIn && record.workHours === 0);
  const approvals = record?.approvals ?? [];
  const hasApprovals = approvals.length > 0;

  // ──── Off-day without real attendance → show day type label ────
  if (off && isNoAttendance && !hasApprovals) {
    return createPortal(
      <div className="pointer-events-none fixed z-[9999]" style={{ left, top, width: tipW }}>
        <div className="bg-white rounded-lg shadow-lg border border-gray-200 px-3 py-2.5 text-center">
          {day.isHoliday ? (
            <>
              <div className="text-base mb-0.5">🇻🇳</div>
              <p className="text-[11px] font-bold text-red-500">{day.holidayName}</p>
              <p className="text-[9px] text-red-400 mt-0.5">Ngày lễ — Nghỉ</p>
            </>
          ) : (
            <>
              <div className="text-base mb-0.5 text-gray-300">😴</div>
              <p className="text-[11px] font-semibold text-gray-500">{day.label === 'CN' ? 'Chủ nhật' : 'Thứ bảy'}</p>
              <p className="text-[9px] text-gray-400 mt-0.5">Ngày nghỉ</p>
            </>
          )}
        </div>
      </div>,
      document.body
    );
  }

  // ──── Normal working day without attendance → "Không chấm công" ────
  const isLeaveDay = record && (
    (record.conclusion || '').toLowerCase().includes('phép') ||
    (record.conclusion || '').toLowerCase().includes('leave') ||
    record.status === 'leave' ||
    record.hasLeave
  );
  const isRemoteDay = record && (
    (record.conclusion || '').toLowerCase() === 'remote' ||
    record.status === 'remote'
  );
  const compLeaveApps = (record?.approvals ?? []).filter(
    a => a.approvalType === 'ChangeHours' &&
      a.status === 'APPROVED' &&
      !!(a.changeWorkingFrame?.compLeaveHours && a.changeWorkingFrame.compLeaveHours > 0)
  );
  const totalCompLeaveHours = compLeaveApps.reduce((sum, a) => sum + (a.changeWorkingFrame?.compLeaveHours ?? 0), 0);
  const hasCompLeaveCredit = totalCompLeaveHours > 0;
  const fmtDateTime = (value?: string | null) => value
    ? new Date(value).toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';

  if (isNoAttendance && !off && !isLeaveDay && !isRemoteDay && hasCompLeaveCredit) {
    return createPortal(
      <div className="pointer-events-none fixed z-[9999]" style={{ left, top, width: 310 }}>
        <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-xl">
          <div className="border-b border-emerald-100 bg-emerald-50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-emerald-600" />
                <p className="text-[11px] font-bold text-emerald-800">Đủ công nhờ phiếu nghỉ bù</p>
              </div>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-700">
                {fmtHM(totalCompLeaveHours)}
              </span>
            </div>
            <p className="mt-0.5 text-[9px] text-emerald-700">{fmtFullDate(day.iso)}</p>
          </div>
          <div className="space-y-2 px-3 py-2.5 text-[10px] text-gray-700">
            {compLeaveApps.map((approval) => {
              const frame = approval.changeWorkingFrame;
              return (
                <div key={approval.id} className="rounded-lg border border-amber-100 bg-amber-50/70 px-2.5 py-2">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div>
                      <p className="text-[8px] font-bold uppercase tracking-wide text-amber-600">OT nguồn</p>
                      <p className="mt-0.5 font-semibold tabular-nums text-amber-900">
                        {fmtDateTime(frame?.workedPeriodStart)} → {fmtDateTime(frame?.workedPeriodEnd)}
                      </p>
                    </div>
                    <span className="text-amber-500">→</span>
                    <div>
                      <p className="text-[8px] font-bold uppercase tracking-wide text-emerald-600">Nghỉ bù vào</p>
                      <p className="mt-0.5 font-semibold tabular-nums text-emerald-900">
                        {fmtDateTime(frame?.shiftStart)} → {fmtDateTime(frame?.shiftEnd)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between border-t border-amber-100 pt-1.5">
                    <span className="text-[9px] text-gray-500">Phiếu {approval.serialNumber || approval.instanceCode}</span>
                    <span className="text-[9px] font-bold text-emerald-700">{fmtHM(frame?.compLeaveHours ?? 0)} công bù</span>
                  </div>
                </div>
              );
            })}
            <p className="text-[9px] leading-relaxed text-gray-500">
              Ngày này không có check-in/out, nhưng đã được xác nhận bằng phiếu nghỉ bù nên vẫn tính vào công thực tế.
            </p>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  if (isNoAttendance && !off && !isLeaveDay && !isRemoteDay) {
    return createPortal(
      <div className="pointer-events-none fixed z-[9999]" style={{ left, top, width: tipW }}>
        <div className="bg-white rounded-lg shadow-lg border border-gray-200 px-3 py-2.5 text-center">
          <div className="text-base mb-0.5 text-red-300">✗</div>
          <p className="text-[11px] font-semibold text-red-500">Không chấm công</p>
          <p className="text-[9px] text-gray-400 mt-0.5">{fmtFullDate(day.iso)}</p>
        </div>
      </div>,
      document.body
    );
  }

  // ──── Has attendance data → show full details ────
  if (!record) return null;

  const c = (record.conclusion || '').toLowerCase();
  const isLeave = c.includes('phép') || c.includes('leave');
  const isRemote = c === 'remote';
  const isWorkingNow = c.includes('đang làm');

  // Approvals
  const correctionApps = approvals.filter(a => a.approvalType === 'Correction');
  const otApps = approvals.filter(a => a.approvalType === 'OT');
  const leaveApps = approvals.filter(a => a.approvalType === 'Leave');
  const changeApps = approvals.filter(a => a.approvalType === 'ChangeHours');
  const hasCorrection = correctionApps.length > 0;
  const activeCompLeaveApps = changeApps.filter(a => a.changeWorkingFrame?.compLeaveHours && a.changeWorkingFrame.compLeaveHours > 0);
  const activeCompLeaveHours = activeCompLeaveApps.reduce((s, a) => s + (a.changeWorkingFrame?.compLeaveHours ?? 0), 0);

  // Use effective hours after correction
  const effLate = record.effectiveLateHours ?? record.lateHours;
  const effEarly = record.effectiveEarlyHours ?? record.earlyHours;

  return createPortal(
    <div className="pointer-events-none fixed z-[9999]" style={{ left, top, width: tipW }}>
      <div className="bg-white rounded-lg shadow-lg border border-gray-200 px-3 py-2 text-[10px] text-gray-700">
        {/* Holiday banner */}
        {day.isHoliday && day.holidayName && (
          <div className="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-red-100 text-[9px] text-red-500 font-semibold">
            🇻🇳 {day.holidayName}
          </div>
        )}
        {off && !day.isHoliday && (
          <div className="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-gray-100 text-[9px] text-gray-500 font-semibold">
            <CalendarDays size={9} />
            {day.label === 'CN' ? 'Chủ nhật' : 'Thứ bảy'} — Ngày nghỉ theo lịch
          </div>
        )}
        {/* Leave / Remote banner */}
        {isLeave && (
          <div className="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-violet-100 text-[9px] text-violet-600 font-semibold">
            📋 {record.conclusion}
          </div>
        )}
        {isRemote && (
          <div className="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-blue-100 text-[9px] text-blue-600 font-semibold">
            🏠 Làm việc từ xa
          </div>
        )}
        {isWorkingNow && (
          <div className="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-blue-100 text-[9px] text-blue-600 font-semibold">
            <Clock size={9} />
            Đã check-in, đang chờ check-out
          </div>
        )}
        {/* Night shift banner */}
        {changeApps.some(a => a.changeWorkingFrame?.isNightShift) && (
          <div className="flex items-center gap-1 mb-1.5 pb-1 border-b border-indigo-100 text-[9px] text-indigo-600 font-semibold">
            <Moon size={9}/> Ca đêm
          </div>
        )}
        {activeCompLeaveHours > 0 && (
          <div className="mb-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700">
                <CheckCircle2 size={9} />
                Sử dụng phiếu nghỉ bù
              </span>
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                {fmtHM(activeCompLeaveHours)}
              </span>
            </div>
            {activeCompLeaveApps.map(a => (
              <div key={a.id} className="mt-1 text-[8.5px] leading-snug text-emerald-700">
                OT nguồn {fmtDateTime(a.changeWorkingFrame?.workedPeriodStart)} → {fmtDateTime(a.changeWorkingFrame?.workedPeriodEnd)}
                <br />
                Nghỉ bù {fmtDateTime(a.changeWorkingFrame?.shiftStart)} → {fmtDateTime(a.changeWorkingFrame?.shiftEnd)}
              </div>
            ))}
          </div>
        )}
        {/* Shift schedule */}
        {record.shiftCheckIn && hasCheckIn && (
          <div className="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-gray-100 text-[9px] text-gray-400">
            <Clock size={9} className="shrink-0" />
            <span>Ca: {fmtTime(record.shiftCheckIn)} – {fmtTime(record.shiftCheckOut)}</span>
          </div>
        )}
        {/* Check-in / Check-out */}
        {hasCheckIn && (
          <>
            <div className="flex items-center gap-1.5 mb-1">
              <LogIn size={10} className="text-emerald-500 shrink-0" />
              <span className="text-gray-400 w-5">In</span>
              <span className="font-semibold tabular-nums text-gray-800">{fmtTime(record.checkIn)}</span>
              {record.checkInLocation && (
                <span className="text-gray-400 truncate flex-1 text-[9px] ml-1">{record.checkInLocation}</span>
              )}
              {!record.checkInLocation && record.checkInIsWifi && record.checkInWifi && (
                <span className="text-gray-400 truncate flex-1 text-[9px] ml-1 flex items-center gap-0.5">
                  <Wifi size={8} className="text-blue-400" />{record.checkInWifi}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <LogOut size={10} className="text-orange-500 shrink-0" />
              <span className="text-gray-400 w-5">Out</span>
              <span className="font-semibold tabular-nums text-gray-800">{fmtTime(record.checkOut)}</span>
              {record.checkOutLocation && (
                <span className="text-gray-400 truncate flex-1 text-[9px] ml-1">{record.checkOutLocation}</span>
              )}
            </div>
          </>
        )}
        {/* Status badges */}
        <div className="flex items-center gap-1 mt-1.5 pt-1 border-t border-gray-100 flex-wrap">
          {record.workHours > 0 && (
            <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1 py-px rounded font-medium">{fmtHM(record.workHours)}</span>
          )}
          {effLate > 0 && (
            <span className="text-[9px] text-amber-600 bg-amber-50 px-1 py-px rounded font-medium">Trễ {fmtHM(effLate)}</span>
          )}
          {effLate === 0 && record.lateHours > 0 && hasCorrection && (
            <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1 py-px rounded line-through opacity-60">Trễ {fmtHM(record.lateHours)}✔</span>
          )}
          {effEarly > 0 && (
            <span className="text-[9px] text-orange-600 bg-orange-50 px-1 py-px rounded font-medium">Sớm {fmtHM(effEarly)}</span>
          )}
          {record.conclusion && !isLeave && (
            <span className={`text-[9px] px-1 py-px rounded ${isWorkingNow ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-500'}`}>{record.conclusion}</span>
          )}
        </div>
        {/* Linked approvals summary */}
        {hasApprovals && (
          <div className="mt-1.5 pt-1.5 border-t border-gray-100 space-y-0.5">
            {hasCorrection && (
              <div className="flex items-center gap-1 text-[9px] text-emerald-600">
                <ClipboardCheck size={8}/>
                <span>Bù {fmtHM(correctionApps.reduce((s,a)=>s+a.approvedHours,0))} (chỉnh công)</span>
              </div>
            )}
            {leaveApps.map(a => (
              <div key={a.id} className="flex items-center gap-1 text-[9px] text-violet-600">
                <FileText size={8}/>
                <span className="truncate">{a.leaveType || 'Nghỉ phép'}{a.approvedDays>0 ? ` · ${a.approvedDays}c` : ` · ${fmtHM(a.approvedHours)}`}</span>
              </div>
            ))}
            {otApps.map(a => (
              <div key={a.id} className="flex items-center gap-1 text-[9px] text-blue-600">
                <Zap size={8}/>
                <span>OT {fmtHM(a.approvedHours)}{a.otBuckets?.length ? ` · ${a.otBuckets.map(b=>OT_BUCKET_LABELS[b.bucket] || b.bucket).join('/')}` : ''}</span>
              </div>
            ))}
            {changeApps.map(a => (
              <div key={a.id} className={`flex items-center gap-1 text-[9px] ${a.changeWorkingFrame?.compLeaveHours ? 'text-emerald-600' : 'text-indigo-600'}`}>
                {a.changeWorkingFrame?.compLeaveHours ? <CheckCircle2 size={8}/> : <Moon size={8}/>}
                <span>
                  {a.changeWorkingFrame?.compLeaveHours
                    ? `Nghỉ bù ${fmtHM(a.changeWorkingFrame.compLeaveHours)}`
                    : (a.changeWorkingFrame?.isNightShift ? 'Ca đêm — đổi ca' : 'Đổi giờ làm')}
                </span>
              </div>
            ))}
            <div className="text-[8px] text-gray-400 pt-0.5">↳ Nhấn để xem chi tiết phiếu</div>
          </div>
        )}
      </div>
    </div>,
    document.body
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

function renderLarkFormFields(rawData: any) {
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
    <div className="rounded-xl border border-gray-200 bg-slate-50/50 p-3.5 space-y-2.5">
      <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5 border-b border-slate-100 pb-2">
        📝 Chi tiết đơn đăng ký (Lark Form)
      </p>
      <div className="space-y-2.5 text-[10.5px]">
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
                <div key={f.id || i} className="space-y-2 bg-amber-50/40 border border-amber-200/60 rounded-xl p-3.5 mt-1">
                  <div className="flex items-center gap-1.5 border-b border-amber-200 pb-2 text-[11px] font-bold text-amber-700">
                    <span>🕒 Chi tiết điều chỉnh chấm công (Remedy)</span>
                  </div>
                  <div className="space-y-2 text-[10.5px]">
                    {[
                      { label: 'Ngày cần điều chỉnh', value: <span className="font-semibold text-foreground">{rDate}</span> },
                      { label: 'Mốc điều chỉnh', value: <span className="font-bold text-amber-700">{punchLabel}</span> },
                      { label: 'Giờ điều chỉnh thành', value: <span className="font-bold text-emerald-600 tabular-nums">{rTime.includes(' ') ? rTime.split(' ')[1] : rTime}</span> },
                      { label: 'Thông tin gốc', value: <span className="text-gray-500 font-mono text-[9.5px]">{clockTime || 'Chưa ghi nhận'}</span> },
                      { label: 'Lý do xin điều chỉnh', value: <span className="text-foreground font-semibold italic">"{reason}"</span> },
                    ].map((row, idx) => (
                      <div key={idx} className="grid grid-cols-3 gap-2 py-1.5 border-b border-amber-100/50 last:border-0 items-start">
                        <span className="text-gray-400 font-medium">{row.label}</span>
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
            <div key={f.id || i} className="grid grid-cols-3 gap-2 py-1.5 border-b border-slate-100/50 last:border-0">
              <span className="flex items-center gap-1.5 text-gray-400 font-medium leading-normal">
                {friendlyName}
                <span className="relative group inline-flex items-center">
                  <span className="text-gray-400/40 hover:text-gray-500 cursor-help transition-colors inline-flex">
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
              <span className="col-span-2 text-gray-800 font-bold leading-normal break-words">{displayVal}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailModal({ record, day, employee, onClose }: {
  record: DailyRecord; day: DayInfo; employee: EmployeeRow; onClose: () => void;
}) {
  const navigate = useNavigate();
  const [selectedApproval, setSelectedApproval] = useState<DayApproval | null>(null);

  // Navigate to Approvals page and open specific approval
  const openApprovalInPage = (approvalId: string) => {
    onClose();
    navigate('/approvals', { state: { openApprovalId: approvalId } });
  };

  const conclusion = record.conclusion || 'Không xác định';
  const hasCheckIn = record.checkIn != null;
  const c = conclusion.toLowerCase();
  const isLeave = c.includes('phép') || c.includes('leave');

  // Approvals
  const approvals = record.approvals ?? [];
  const correctionApps = approvals.filter(a => a.approvalType === 'Correction');
  const otApps = approvals.filter(a => a.approvalType === 'OT');
  const changeApps = approvals.filter(a => a.approvalType === 'ChangeHours');
  const hasApprovals = approvals.length > 0;

  // Effective late/early after correction
  const effLate = record.effectiveLateHours ?? record.lateHours;
  const effEarly = record.effectiveEarlyHours ?? record.earlyHours;
  const cc = record.correctionCredit;
  const missingEffective = Math.max(effLate + effEarly, 0);

  // ── Comp leave effective calculation ──────────────────────────────
  const approvedCompLeaveApps = changeApps.filter(
    a => a.status === 'APPROVED' &&
         !!(a.changeWorkingFrame?.compLeaveHours && a.changeWorkingFrame.compLeaveHours > 0)
  );
  const totalCompLeaveHours = approvedCompLeaveApps.reduce(
    (s, a) => s + (a.changeWorkingFrame?.compLeaveHours ?? 0), 0
  );
  const STANDARD_WORK_HOURS = 8;
  const workWithComp = record.workHours + totalCompLeaveHours;
  const isCompLeaveFullDay = totalCompLeaveHours > 0 && workWithComp >= STANDARD_WORK_HOURS;
  const compLeaveCanCloseDay = ['Về sớm', 'Đi trễ', 'Không chấm công', 'Thiếu công'].includes(conclusion);
  const effectiveConclusion = isCompLeaveFullDay && compLeaveCanCloseDay
    ? 'Đủ công (nghỉ bù)' : conclusion;

  const statusMap: Record<string, { icon: typeof CheckCircle2; color: string; bg: string }> = {
    'Đủ công': { icon: CheckCircle2, color: '#059669', bg: '#ecfdf5' },
    'Đi trễ': { icon: AlertCircle, color: '#d97706', bg: '#fffbeb' },
    'Về sớm': { icon: AlertCircle, color: '#ea580c', bg: '#fff7ed' },
    'Không chấm công': { icon: X, color: '#dc2626', bg: '#fef2f2' },
    'Thiếu check-in': { icon: AlertCircle, color: '#dc2626', bg: '#fef2f2' },
    'Thiếu check-out': { icon: AlertCircle, color: '#ea580c', bg: '#fff7ed' },
    'Đang làm (chưa check-out)': { icon: Clock, color: '#2563eb', bg: '#eff6ff' },
  };
  const effectiveSt = isCompLeaveFullDay && compLeaveCanCloseDay
    ? { icon: CheckCircle2, color: '#059669', bg: '#ecfdf5' }
    : (statusMap[conclusion] || { icon: AlertCircle, color: '#6b7280', bg: '#f9fafb' });
  const st = effectiveSt;
  const Icon = st.icon;

  const approvalTypeLabel = (a: DayApproval) => {
    if (a.approvalType === 'Correction') return '📝 Chỉnh sửa chấm công';
    if (a.approvalType === 'Leave') return '📋 Nghỉ phép';
    if (a.approvalType === 'OT') return '⚡ Làm thêm giờ (OT)';
    if (a.approvalType === 'NightShift') return '🌙 Ca đêm';
    if (a.approvalType === 'ChangeHours') {
      const isCompLeave = !!(a.changeWorkingFrame?.compLeaveHours && a.changeWorkingFrame.compLeaveHours > 0);
      return isCompLeave ? '🔄 Nghỉ bù' : (a.changeWorkingFrame?.isNightShift ? '🌙 Đổi ca đêm' : '☀️ Đổi giờ làm');
    }
    return `📄 ${a.approvalType}`;
  };

  const bucketColor = (bucket: string) => {
    if (bucket.includes('150') || bucket.includes('17h~22h')) return 'text-blue-600 bg-blue-50';
    if (bucket.includes('210') || bucket.includes('夜間まで残業)')) return 'text-purple-600 bg-purple-50';
    if (bucket.includes('200') || (bucket.includes('休日出勤') && bucket.includes('6h~22h'))) return 'text-indigo-600 bg-indigo-50';
    if (bucket.includes('270') || bucket.includes('休日の夜勤')) return 'text-violet-600 bg-violet-50';
    if (bucket.includes('300') || (bucket.includes('lễ') && !bucket.includes('đêm') && !bucket.includes('夜勤'))) return 'text-orange-600 bg-orange-50';
    if (bucket.includes('390') || (bucket.includes('lễ') && (bucket.includes('đêm') || bucket.includes('夜勤')))) return 'text-red-600 bg-red-50';
    if (bucket.includes('130') || bucket.includes('đêm') || bucket.includes('夜勤') || bucket.includes('Ca đêm 30%')) return 'text-slate-600 bg-slate-50';
    return 'text-gray-600 bg-gray-50';
  };

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
      className="fixed inset-0 z-[500] flex items-center justify-center"
      onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />

      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.15 }}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[420px] mx-4 border border-gray-200 max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 sticky top-0 bg-white z-10 border-b border-gray-100">
          <div className="flex items-center gap-3 min-w-0">
            {employee.avatarUrl ? (
              <img src={employee.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-[10px] font-bold text-blue-500">
                {employee.fullName.split(' ').slice(-2).map(w => w[0]).join('').toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{employee.fullName}</p>
              <p className="text-[11px] text-gray-400 truncate">{fmtFullDate(day.iso)}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 cursor-pointer">
            <X size={16} />
          </button>
        </div>

        {/* Holiday banner */}
        {day.isHoliday && day.holidayName && (
          <div className="mx-5 mt-3 mb-2 rounded-lg px-3 py-2 bg-red-50 flex items-center gap-2">
            <span className="text-base">🇻🇳</span>
            <span className="text-[11px] font-bold text-red-500">{day.holidayName}</span>
          </div>
        )}

        {/* Leave banner */}
        {isLeave && (
          <div className="mx-5 mt-3 mb-2 rounded-lg px-3 py-2 bg-violet-50 flex items-center gap-2">
            <span className="text-base">📋</span>
            <span className="text-[11px] font-bold text-violet-600">{conclusion}</span>
          </div>
        )}

        {/* Status */}
        <div className="mx-5 mt-3 mb-3 rounded-lg px-3 py-2 flex items-center gap-2" style={{ backgroundColor: st.bg }}>
          <Icon size={15} style={{ color: st.color }} />
          <span className="text-sm font-bold" style={{ color: st.color }}>{effectiveConclusion}</span>
          {record.workHours > 0 && (
            <span className="ml-auto text-xs text-gray-500 tabular-nums">{fmtHM(record.workHours)}</span>
          )}
        </div>
        {/* Comp leave override note */}
        {isCompLeaveFullDay && (
          <div className="mx-5 -mt-2 mb-3 rounded-lg px-3 py-2 bg-emerald-50 border border-emerald-200 flex items-start gap-2">
            <span className="text-sm shrink-0">🔄</span>
            <div className="text-[10px] text-emerald-700 leading-relaxed">
              <span className="font-bold">Có nghỉ bù:</span> Giờ công thực tế{' '}
              <span className="font-semibold tabular-nums">{fmtHM(record.workHours)}</span>
              {' '}+{' '}nghỉ bù{' '}
              <span className="font-semibold tabular-nums">{fmtHM(totalCompLeaveHours)}</span>
              {' '}={' '}
              <span className="font-bold text-emerald-800 tabular-nums">{fmtHM(workWithComp)}</span>
              {' '}≥ 8h → Đủ công
            </div>
          </div>
        )}

        {/* Shift schedule */}
        {record.shiftCheckIn && hasCheckIn && (
          <div className="mx-5 mb-3 rounded-lg px-3 py-2 bg-gray-50 flex items-center gap-2">
            <Clock size={14} className="text-gray-400" />
            <span className="text-[11px] text-gray-500">Ca làm việc:</span>
            <span className="text-[11px] font-bold text-gray-700 tabular-nums">{fmtTime(record.shiftCheckIn)} – {fmtTime(record.shiftCheckOut)}</span>
          </div>
        )}

        {/* Check-in / Check-out */}
        {hasCheckIn && (
          <div className="px-5 space-y-3 mb-3">
            <CheckRow type="in" time={record.checkIn} location={record.checkInLocation}
              wifi={record.checkInWifi} isWifi={record.checkInIsWifi}
              isField={record.checkInIsField} supplement={record.checkInSupplement} />
            <CheckRow type="out" time={record.checkOut} location={record.checkOutLocation}
              wifi={null} isWifi={false} isField={false} supplement={record.checkOutSupplement} />
          </div>
        )}

        {/* ── OT Summary Section (Khối tổng hợp làm thêm) ── */}
        {otApps.length > 0 && (
          <div className="px-5 mb-3">
            <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50/60 to-indigo-50/60 p-3.5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Zap size={14} className="text-blue-500 shrink-0" />
                <span className="text-xs font-bold text-blue-700">Làm thêm giờ (OT)</span>
                <span className="ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-600 tabular-nums">
                  {otApps.length} phiếu
                </span>
              </div>

              {/* OT Timelines */}
              <div className="space-y-3">
                {otApps.map((ot) => {
                  if (!ot.startTime && !ot.endTime) return null;
                  const fmtT = (s: string | null) => s
                    ? new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false })
                    : '—';

                  const otStart = ot.startTime ? new Date(ot.startTime) : null;
                  const recIn = record.checkIn ? new Date(record.checkIn) : null;
                  const recOut = record.checkOut ? new Date(record.checkOut) : null;

                  const otCheckInStr = (recIn && otStart)
                    ? (recIn > otStart ? record.checkIn : ot.startTime)
                    : null;
                  const otCheckOutStr = (recOut && otStart && recOut > otStart)
                    ? record.checkOut
                    : null;

                  return (
                    <div key={ot.id} className="bg-white rounded-lg p-2.5 border border-blue-200 shadow-sm text-[11px] space-y-2">
                      <div className="flex justify-between items-center text-[10px] text-gray-500 font-semibold border-b border-gray-50 pb-1.5">
                        <span>Mã phiếu: {ot.serialNumber || ot.instanceCode?.slice(0, 8)}</span>
                        <span className="text-blue-600 font-bold tabular-nums">+{fmtHM(ot.approvedHours)}</span>
                      </div>

                      {/* Timeline & Check-in/out */}
                      <div className="grid grid-cols-1 gap-1.5 text-gray-600">
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-400 shrink-0 w-[95px]">Ca làm việc OT:</span>
                          <span className="font-bold text-blue-800 tabular-nums">{fmtT(ot.startTime)} – {fmtT(ot.endTime)}</span>
                        </div>
                        {hasCheckIn && (
                          <>
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-400 shrink-0 w-[95px]">Chấm công In:</span>
                              <span className="font-semibold text-gray-700 tabular-nums">{fmtTime(otCheckInStr)}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-400 shrink-0 w-[95px]">Chấm công Out:</span>
                              <span className="font-semibold text-gray-700 tabular-nums">{fmtTime(otCheckOutStr)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Total Summary Stats */}
              <div className="mt-3 pt-2.5 border-t border-blue-200 flex justify-between items-center text-[10.5px]">
                <div className="flex flex-col gap-0.5">
                  <div className="text-gray-500">Tổng giờ phê duyệt:</div>
                  <div className="text-gray-500">Giờ OT hợp lệ (tính lương):</div>
                </div>
                <div className="flex flex-col items-end gap-0.5 font-bold">
                  <div className="text-blue-700 tabular-nums">{fmtHM(otApps.reduce((s, a) => s + a.approvedHours, 0))}</div>
                  <div className="text-emerald-600 tabular-nums">
                    {fmtHM(otApps.reduce((s, a) => s + (a.validOtHours ?? 0), 0))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stats grid */}
        {hasCheckIn && (
          <div className="px-5 mb-3">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Giờ thiếu" value={missingEffective > 0 ? fmtHM(missingEffective) : '—'} warn={missingEffective > 0} />
              <Stat label={effLate !== record.lateHours ? 'Đi trễ sau phép' : (cc ? 'Trễ (raw)' : 'Đi trễ')} value={effLate > 0 ? fmtHM(effLate) : '—'} warn={effLate > 0} />
              <Stat label={effEarly !== record.earlyHours ? 'Về sớm sau phép' : (cc ? 'Sớm (raw)' : 'Về sớm')} value={effEarly > 0 ? fmtHM(effEarly) : '—'} warn={effEarly > 0} />
              <Stat label="OT phiếu" value={otApps.length > 0 ? fmtHM(otApps.reduce((s,a) => s + a.approvedHours, 0)) : '—'} good={otApps.length > 0} />
              <Stat label="Giờ công" value={fmtHM(record.workHours)} />
              <Stat label="Loại" value={conclusion} small />
            </div>
          </div>
        )}

        {/* ── Correction Credit ── */}
        {cc && (cc.lateOffset > 0 || cc.earlyOffset > 0) && (
          <div className="mx-5 mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <ClipboardCheck size={13} className="text-emerald-600" />
              <span className="text-xs font-bold text-emerald-700">Phiếu chỉnh sửa chấm công</span>
              <span className="ml-auto text-[10px] text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                +{fmtHM(correctionApps.reduce((s,a) => s + a.approvedHours, 0))}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              {cc.lateOffset > 0 && (
                <>
                  <div className="text-gray-500">Đi trễ ban đầu:</div>
                  <div className="text-amber-600 font-semibold">{fmtHM(record.lateHours)}</div>
                  <div className="text-gray-500">Sau khi bù:</div>
                  <div className={`font-bold ${effLate > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {effLate > 0 ? fmtHM(effLate) : '0p ✓ Đủ công'}
                  </div>
                </>
              )}
              {cc.earlyOffset > 0 && (
                <>
                  <div className="text-gray-500">Về sớm ban đầu:</div>
                  <div className="text-orange-600 font-semibold">{fmtHM(record.earlyHours)}</div>
                  <div className="text-gray-500">Sau khi bù:</div>
                  <div className={`font-bold ${effEarly > 0 ? 'text-orange-600' : 'text-emerald-600'}`}>
                    {effEarly > 0 ? fmtHM(effEarly) : '0p ✓ Đủ công'}
                  </div>
                </>
              )}
              {cc.workCreditHours > 0 && (
                <>
                  <div className="text-gray-500">Bổ sung giờ công:</div>
                  <div className="text-emerald-600 font-bold">+{fmtHM(cc.workCreditHours)}</div>
                </>
              )}
            </div>
          </div>
        )}



        {/* ── Linked Approvals List ── */}
        {hasApprovals && (
          <div className="mx-5 mb-5">
            <p className="text-[11px] font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
              <FileText size={11} /> Phiếu phê duyệt liên quan ({approvals.length})
            </p>
            <div className="space-y-1.5">
              {approvals.map(a => (
                <div key={a.id}
                  onClick={() => setSelectedApproval(a)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all text-left group cursor-pointer">
                  <div className="shrink-0 text-sm leading-none">
                    {a.approvalType === 'OT' ? '⚡' :
                     a.approvalType === 'Correction' ? '📝' :
                     a.approvalType === 'Leave' ? '📋' :
                     a.approvalType === 'ChangeHours' ? (
                       (a.changeWorkingFrame?.compLeaveHours ?? 0) > 0 ? '🔄' :
                       a.changeWorkingFrame?.isNightShift ? '🌙' : '☀️'
                     ) : '📄'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-gray-700 group-hover:text-blue-700 transition-colors">
                      {approvalTypeLabel(a)}
                    </div>
                    <div className="text-[9px] text-gray-400 flex items-center gap-1 mt-0.5 flex-wrap">
                      <span>{a.serialNumber || a.instanceCode}</span>
                      {a.leaveType && <><span>·</span><span>{a.leaveType}</span></>}
                      <span>·</span>
                      <span>{a.approvedDays > 0 ? `${a.approvedDays} ngày` : fmtHM(a.approvedHours)}</span>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1">
                    <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full font-medium">{a.status}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); openApprovalInPage(a.id); }}
                      className="p-0.5 rounded hover:bg-blue-100 text-gray-400 hover:text-blue-500 transition-colors cursor-pointer"
                      title="Xem trong trang Phế duyệt"
                    >
                      <ExternalLink size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        </div>{/* end scrollable */}
      </motion.div>

      {/* ── Approval Detail Sub-modal ── */}
      {selectedApproval && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="absolute inset-0 z-[600] flex items-center justify-center p-4"
          onClick={() => setSelectedApproval(null)}>
          <div className="absolute inset-0 bg-black/30 rounded-2xl" />
          <div className="relative bg-white rounded-2xl shadow-2xl border-2 border-gray-200 w-full max-w-[440px] max-h-[82vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            {/* Sub-modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
              <h3 className="text-sm font-bold text-gray-900">{approvalTypeLabel(selectedApproval as any)}</h3>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => openApprovalInPage(selectedApproval.id)}
                  className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors cursor-pointer font-medium"
                  title="Mở trong trang Phê duyệt"
                >
                  <ExternalLink size={10} /> Xem đầy đủ
                </button>
                <button onClick={() => setSelectedApproval(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 cursor-pointer">
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Sub-modal body */}
            <div className="px-5 py-4 space-y-4">

              {/* ── Common header info ── */}
              <div className="rounded-xl border border-gray-100 overflow-hidden">
                {[
                  { label: 'Số phiếu', value: <span className="font-mono text-xs font-semibold">{selectedApproval.serialNumber || selectedApproval.instanceCode}</span> },
                  { label: 'Trạng thái', value: (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      selectedApproval.status === 'APPROVED' ? 'text-emerald-700 bg-emerald-50' :
                      selectedApproval.status === 'PENDING'  ? 'text-amber-700 bg-amber-50'   :
                      'text-red-700 bg-red-50'
                    }`}>
                      {selectedApproval.status === 'APPROVED' ? '✓ Đã duyệt' : selectedApproval.status === 'PENDING' ? '⏳ Đang chờ' : '✗ Từ chối'}
                    </span>
                  )},
                ].map((row, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2.5 border-b border-gray-50 last:border-0 text-[11px]">
                    <span className="text-gray-400 font-medium">{row.label}</span>
                    <div>{row.value}</div>
                  </div>
                ))}
              </div>

              {/* ── OT specific ── */}
              {selectedApproval.approvalType === 'OT' && (
                <>
                  {/* OT time window */}
                  <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 p-3">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Zap size={12} className="text-blue-600" />
                      <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">Khung giờ OT phê duyệt</span>
                      {selectedApproval.otPolicy && (
                        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 font-medium">
                          {selectedApproval.otPolicy}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div className="bg-white/80 rounded-lg px-2.5 py-2 border border-blue-100">
                        <div className="text-[9px] text-blue-400 mb-0.5 font-medium">BẮT ĐẦU OT</div>
                        <div className="text-sm font-bold text-blue-900 tabular-nums">
                          {selectedApproval.startTime
                            ? new Date(selectedApproval.startTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false })
                            : '—'}
                        </div>
                        <div className="text-[9px] text-blue-400 tabular-nums">
                          {selectedApproval.startTime
                            ? new Date(selectedApproval.startTime).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' })
                            : ''}
                        </div>
                      </div>
                      <div className="bg-white/80 rounded-lg px-2.5 py-2 border border-indigo-100">
                        <div className="text-[9px] text-indigo-400 mb-0.5 font-medium">KẾT THÚC OT</div>
                        <div className="text-sm font-bold text-indigo-900 tabular-nums">
                          {selectedApproval.endTime
                            ? new Date(selectedApproval.endTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false })
                            : '—'}
                        </div>
                        <div className="text-[9px] text-indigo-400 tabular-nums">
                          {selectedApproval.endTime
                            ? new Date(selectedApproval.endTime).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' })
                            : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-blue-200">
                      <span className="text-[10px] text-blue-500">Số giờ phê duyệt</span>
                      <span className="text-sm font-bold text-blue-700 tabular-nums">{fmtHM(selectedApproval.approvedHours)}</span>
                    </div>
                  </div>

                  {/* OT Buckets */}
                  {selectedApproval.otBuckets && selectedApproval.otBuckets.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                      <p className="text-[11px] font-bold text-amber-700 mb-2 flex items-center gap-1.5">
                        <Zap size={11} className="text-amber-500" /> Phân loại giờ OT
                      </p>
                      <div className="space-y-2">
                        {selectedApproval.otBuckets.map((b, i) => (
                          <div key={i} className="flex items-center gap-2 text-[10px] bg-white/70 rounded-lg px-2.5 py-2 border border-amber-100">
                            <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${bucketColor(b.bucket)}`}>{OT_BUCKET_LABELS[b.bucket] || b.bucket}</span>
                            <span className="text-gray-500 tabular-nums">{fmtHM(b.approvedHours)} phê duyệt</span>
                            {b.validHours > 0
                              ? <span className="text-emerald-600 font-semibold">→ {fmtHM(b.validHours)} hợp lệ ✓</span>
                              : <span className="text-orange-400 italic">→ chưa có chấm công OT</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── Leave specific ── */}
              {selectedApproval.approvalType === 'Leave' && (() => {
                const leaveDetails = parseLeaveDetails(selectedApproval.rawData);
                const reason = leaveDetails?.reason || '';
                const bucket = selectedApproval.leaveTypeBucket || '';
                
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

                const startDate = leaveDetails?.start ? new Date(leaveDetails.start) : (selectedApproval.startTime ? new Date(selectedApproval.startTime) : null);
                const endDate = leaveDetails?.end ? new Date(leaveDetails.end) : (selectedApproval.endTime ? new Date(selectedApproval.endTime) : null);

                // Parse interval and unit
                let displayDays = '—';
                let displayHours = '—';
                
                if (leaveDetails?.interval != null && leaveDetails?.unit != null) {
                  const val = Number(leaveDetails.interval);
                  if (leaveDetails.unit.toUpperCase() === 'DAY') {
                    displayDays = `${Number(val.toFixed(2))} ngày`;
                    displayHours = `${Number((val * 8).toFixed(2))} giờ`;
                  } else if (leaveDetails.unit.toUpperCase() === 'HOUR') {
                    displayDays = `${Number((val / 8).toFixed(2))} ngày`;
                    displayHours = `${Number(val.toFixed(2))} giờ`;
                  } else {
                    displayDays = selectedApproval.approvedDays > 0 ? `${Number(selectedApproval.approvedDays.toFixed(2))} ngày` : '—';
                    displayHours = selectedApproval.approvedHours > 0 ? `${Number(selectedApproval.approvedHours.toFixed(2))} giờ` : '—';
                  }
                } else {
                  displayDays = selectedApproval.approvedDays > 0 ? `${Number(selectedApproval.approvedDays.toFixed(2))} ngày` : '—';
                  displayHours = selectedApproval.approvedHours > 0 ? `${Number(selectedApproval.approvedHours.toFixed(2))} giờ` : '—';
                }

                return (
                  <div className={wrapperClass}>
                    {/* Header */}
                    <div className={headerClass}>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🏖️</span>
                        <div className="text-left">
                          <div className="text-[11px] font-bold text-foreground">{labelTitle}</div>
                          <div className="text-[9px] text-muted-foreground">{descText}</div>
                        </div>
                        <span className={`ml-auto text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${badgeClass}`}>
                          {selectedApproval.leaveType || 'Nghỉ phép'}
                        </span>
                      </div>
                    </div>

                    <div className="p-4 space-y-3.5">
                      {/* Calendar Blocks */}
                      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
                        {/* Start Date */}
                        <div className="rounded-xl bg-slate-50/50 border border-slate-100 p-2.5 shadow-sm text-center">
                          <div className="text-[8px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Bắt đầu nghỉ</div>
                          {startDate ? (
                            <>
                              <div className="text-sm font-extrabold text-slate-800 tabular-nums">
                                {startDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false })}
                              </div>
                              <div className="text-[9px] text-slate-500 mt-0.5 font-semibold">
                                {startDate.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                              </div>
                            </>
                          ) : <div className="text-xs text-muted-foreground">—</div>}
                        </div>

                        {/* Arrow / Duration Icon */}
                        <div className="flex flex-col items-center gap-0.5">
                          <div className="text-muted-foreground/60 font-bold text-base">➔</div>
                          <div className="text-[8px] bg-slate-100 text-muted-foreground px-1 py-0.5 rounded font-bold uppercase tracking-wider">
                            Liên tục
                          </div>
                        </div>

                        {/* End Date */}
                        <div className="rounded-xl bg-slate-50/50 border border-slate-100 p-2.5 shadow-sm text-center">
                          <div className="text-[8px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Kết thúc nghỉ</div>
                          {endDate ? (
                            <>
                              <div className="text-sm font-extrabold text-slate-800 tabular-nums">
                                {endDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false })}
                              </div>
                              <div className="text-[9px] text-slate-500 mt-0.5 font-semibold">
                                {endDate.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                              </div>
                            </>
                          ) : <div className="text-xs text-muted-foreground">—</div>}
                        </div>
                      </div>

                      {/* Summary row */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-slate-50/50 border border-slate-100 rounded-lg p-2 text-center shadow-sm">
                          <div className="text-[8px] text-muted-foreground uppercase tracking-wide mb-0.5">Số ngày nghỉ phép</div>
                          <div className="text-sm font-bold text-slate-800 tabular-nums">
                            {displayDays}
                          </div>
                        </div>
                        <div className="bg-slate-50/50 border border-slate-100 rounded-lg p-2 text-center shadow-sm">
                          <div className="text-[8px] text-muted-foreground uppercase tracking-wide mb-0.5">Quy đổi số giờ</div>
                          <div className="text-sm font-bold text-slate-800 tabular-nums">
                            {displayHours}
                          </div>
                        </div>
                      </div>

                      {/* Context Note */}
                      <div className="rounded-lg bg-slate-50/30 border border-slate-100 px-3 py-2 text-[10px] space-y-1 shadow-sm text-left">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1 h-1 rounded-full ${dotClass}`}></span>
                          <p className="text-slate-500 font-medium">
                            Phân nhóm bảng công: <strong className="text-slate-700 font-bold">{labelTitle}</strong>
                          </p>
                        </div>
                        <div className="text-[9px] text-slate-400 leading-relaxed mt-0.5 border-t border-slate-100 pt-1">
                          💡 Hệ thống chấm công Payroll tự động ghi nhận ngày phép tương ứng và phân loại vào bảng tính lương tháng.
                        </div>
                      </div>

                    {/* Reason Box */}
                    {reason && (
                      <div className="rounded-lg bg-white border border-slate-150 p-3 italic text-gray-700 text-[10px] flex gap-1.5 items-start shadow-sm text-left">
                        <span className="text-gray-300 select-none text-lg leading-none font-serif">“</span>
                        <div className="flex-1 not-italic">
                          <span className="font-semibold text-gray-400 block text-[8px] uppercase tracking-wider mb-0.5">LÝ DO XIN NGHỈ PHÉP:</span>
                          <p className="italic text-gray-800 font-medium text-xs">"{reason}"</p>
                        </div>
                        <span className="text-gray-300 select-none text-lg leading-none font-serif">”</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

              {/* ── Correction specific ── */}
              {selectedApproval.approvalType === 'Correction' && (() => {
                const remedy = parseRemedyDetails(selectedApproval.rawData);
                if (!remedy) {
                  return (
                    <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4 text-center text-sm text-amber-800">
                      ⚠️ Không thể đọc dữ liệu form gốc của phiếu điều chỉnh chấm công.
                    </div>
                  );
                }

                return (
                  <div className="rounded-xl border border-accent/20 bg-accent/5 p-4 space-y-3.5">
                    {/* Header */}
                    <div className="flex items-center gap-2 border-b border-accent/10 pb-2.5">
                      <span className="text-lg">🕒</span>
                      <div>
                        <div className="text-[11px] font-bold text-accent">Thông tin điều chỉnh chấm công (Remedy)</div>
                        <div className="text-[9px] text-accent/80">Cập nhật bổ sung giờ chấm công bị thiếu hoặc sai lệch</div>
                      </div>
                      <span className="ml-auto text-[9px] px-2 py-0.5 rounded-full font-bold bg-accent/10 text-accent uppercase">
                        Điều chỉnh
                      </span>
                    </div>

                    {/* Visual Timeline Match */}
                    <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
                      {/* Original State */}
                      <div className="rounded-xl bg-card border border-border p-3 shadow-sm text-center">
                        <div className="text-[8px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Trạng thái gốc</div>
                        <div className="text-xs font-bold text-muted-foreground/80 line-through decoration-1 text-center truncate">
                          Chưa ghi nhận
                        </div>
                        <div className="text-[9px] text-muted-foreground/60 mt-0.5 font-mono italic max-w-full truncate" title={remedy.originalTime}>
                          {remedy.originalTime || 'No record'}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="text-accent font-bold text-lg">➔</div>
                        <div className="text-[8px] bg-accent/10 text-accent px-1 py-0.5 rounded font-bold uppercase tracking-wider scale-90">Mới</div>
                      </div>

                      {/* Adjusted State */}
                      <div className="rounded-xl bg-success/5 border border-success/20 p-3 shadow-sm text-center">
                        <div className="text-[8px] font-bold uppercase tracking-wide text-success mb-1">Giờ điều chỉnh thành</div>
                        <div className="text-base font-extrabold text-success tabular-nums">
                          {remedy.remedyTime}
                        </div>
                        <div className="text-[9px] text-success/90 font-semibold mt-0.5">
                          {remedy.punchLabel}
                        </div>
                      </div>
                    </div>

                    {/* Summary Box */}
                    <div className="rounded-lg bg-card/80 border border-border px-3.5 py-2.5 text-[10.5px] space-y-1 shadow-sm">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                        <p className="text-muted-foreground font-medium">
                          Ngày điều chỉnh công: <strong className="text-foreground font-bold">{remedy.remedyDate}</strong>
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                        <p className="text-muted-foreground font-medium">
                          Sự kiện ảnh hưởng: <strong className="text-accent font-bold">{remedy.punchLabel}</strong> của nhân viên.
                        </p>
                      </div>
                      <div className="text-[9.5px] text-muted-foreground leading-relaxed mt-1 border-t border-border pt-1.5">
                        💡 Khi phiếu này được duyệt, hệ thống chấm công sẽ bổ sung giờ <strong className="text-foreground">{remedy.punchLabel}</strong> là <strong className="text-success font-bold">{remedy.remedyTime}</strong> cho ngày <strong className="text-foreground">{remedy.remedyDate}</strong>, giúp hoàn thiện công của ngày đó.
                      </div>
                    </div>

                    {/* Reason Box */}
                    {remedy.reason && (
                      <div className="rounded-lg bg-accent/5 border border-accent/10 p-2.5 italic text-foreground/80 text-[10.5px] flex gap-1.5 items-start">
                        <span className="text-muted-foreground/40 select-none text-base leading-none">“</span>
                        <div className="flex-1">
                          <span className="font-semibold text-foreground/90 not-italic block text-[9px] uppercase tracking-wider mb-0.5">Lý do điều chỉnh:</span>
                          {remedy.reason}
                        </div>
                        <span className="text-muted-foreground/40 select-none text-base leading-none">”</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── ChangeHours / NightShift specific ── */}
              {(selectedApproval.approvalType === 'ChangeHours' || selectedApproval.approvalType === 'NightShift') && (() => {
                const frame = selectedApproval.changeWorkingFrame;
                const isNight = frame?.isNightShift ?? false;
                const isCompLeave = !!(frame?.compLeaveHours && frame.compLeaveHours > 0);
                const newShiftStart = frame?.shiftStart ? new Date(frame.shiftStart) : null;
                const newShiftEnd   = frame?.shiftEnd   ? new Date(frame.shiftEnd)   : null;
                const workedStart   = frame?.workedPeriodStart ? new Date(frame.workedPeriodStart) : null;
                const workedEnd     = frame?.workedPeriodEnd   ? new Date(frame.workedPeriodEnd)   : null;
                const fmtT = (d: Date | null) => d ? d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
                const fmtD = (d: Date | null) => d ? d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit' }) : '—';

                if (isCompLeave) {
                  return (
                    <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-3">
                      {/* Header */}
                      <div className="flex items-center gap-1.5 mb-3">
                        <span className="text-base">🔄</span>
                        <div>
                          <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wide">Nghỉ bù (休日変更)</div>
                          <div className="text-[9px] text-emerald-600">Làm bù ngày nghỉ → được nghỉ bù</div>
                        </div>
                        <div className="ml-auto flex items-center gap-1">
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-700">✓ ĐỦ CÔNG</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-teal-100 text-teal-700">NGHỈ BÙ</span>
                        </div>
                      </div>

                      {/* Worked → Comp leave flow */}
                      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center mb-3">
                        <div className="rounded-lg bg-orange-50 border border-orange-200 px-2.5 py-2.5">
                          <div className="text-[8px] font-bold uppercase text-orange-500 mb-1 text-center">ĐÃ LÀM BÙ</div>
                          {workedStart && workedEnd ? (
                            <>
                              <div className="text-center font-bold text-orange-800 text-xs tabular-nums">
                                {fmtT(workedStart)} – {fmtT(workedEnd)}
                              </div>
                              <div className="text-center text-[9px] text-orange-500 mt-0.5">{fmtD(workedStart)}</div>
                              <div className="text-center text-[9px] font-semibold text-orange-700 mt-0.5">
                                {Math.round((workedEnd.getTime()-workedStart.getTime())/3600000)}h đã làm
                              </div>
                            </>
                          ) : <div className="text-center text-[9px] text-orange-400">—</div>}
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="text-muted-foreground">→</span>
                          <span className="text-[7px] text-muted-foreground">nghỉ bù</span>
                        </div>
                        <div className="rounded-lg bg-emerald-100/70 border border-emerald-200 px-2.5 py-2.5">
                          <div className="text-[8px] font-bold uppercase text-emerald-600 mb-1 text-center">NGHỈ BÙ</div>
                          {newShiftStart && newShiftEnd ? (
                            <>
                              <div className="text-center font-bold text-emerald-800 text-xs tabular-nums">
                                {fmtT(newShiftStart)} – {fmtT(newShiftEnd)}
                              </div>
                              <div className="text-center text-[9px] text-emerald-600 mt-0.5">{fmtD(newShiftStart)}</div>
                              <div className="text-center text-[9px] font-semibold text-emerald-700 mt-0.5">{frame?.compLeaveHours}h nghỉ bù</div>
                            </>
                          ) : <div className="text-center text-[9px] text-emerald-400">—</div>}
                        </div>
                      </div>

                      {/* Conclusion */}
                      <div className="rounded-lg bg-emerald-100 border border-emerald-200 px-3 py-2">
                        <p className="text-[10px] text-emerald-700 leading-relaxed">
                          <span className="font-bold">✓ Đủ công.</span>{' '}
                          Nghỉ bù từ <strong>{fmtT(newShiftStart)}</strong>–<strong>{fmtT(newShiftEnd)}</strong> ({frame?.compLeaveHours}h).
                          Checkout lúc hoặc sau {fmtT(newShiftStart)} → đủ công theo ca gốc.
                        </p>
                      </div>
                    </div>
                  );
                }

                // Regular shift change
                return (
                  <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-slate-50 border border-indigo-200 p-3">
                    <div className="flex items-center gap-1.5 mb-3">
                      <span className="text-base">{isNight ? '🌙' : '☀️'}</span>
                      <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wide">
                        {isNight ? 'Đổi sang ca đêm' : 'Thay đổi lịch làm việc'}
                      </span>
                      <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-medium ${isNight ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'}`}>
                        {isNight ? 'Ca đêm' : 'Ca ngày'}
                      </span>
                    </div>
                    {newShiftStart && newShiftEnd ? (
                      <div className="flex items-center gap-2 mb-3">
                        <div className="flex-1 bg-indigo-50 rounded-lg px-2.5 py-2 text-center border border-indigo-100">
                          <div className="text-[8px] text-indigo-400 mb-0.5">VÀO CA</div>
                          <div className="text-sm font-bold text-indigo-800 tabular-nums">{fmtT(newShiftStart)}</div>
                          <div className="text-[8px] text-indigo-400 mt-0.5">{fmtD(newShiftStart)}</div>
                        </div>
                        <span className="text-indigo-300 font-bold">→</span>
                        <div className="flex-1 bg-indigo-50 rounded-lg px-2.5 py-2 text-center border border-indigo-100">
                          <div className="text-[8px] text-indigo-400 mb-0.5">RA CA</div>
                          <div className="text-sm font-bold text-indigo-800 tabular-nums">{fmtT(newShiftEnd)}</div>
                          <div className="text-[8px] text-indigo-400 mt-0.5">{fmtD(newShiftEnd)}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="px-3 py-2 bg-amber-50/50 rounded-lg border border-amber-200 text-[10px] text-amber-600 italic mb-3">
                        ⚠️ Khung giờ ca mới chưa được đồng bộ — xem chi tiết trong trang phê duyệt
                      </div>
                    )}
                    <div className="flex justify-between items-center px-3 py-2 bg-indigo-50/70 rounded-lg text-[11px]">
                      <span className="text-indigo-600 font-semibold">Số ngày áp dụng</span>
                      <span className="font-bold text-indigo-700">{selectedApproval.approvedDays > 0 ? `${selectedApproval.approvedDays} ngày` : fmtHM(selectedApproval.approvedHours)}</span>
                    </div>
                    <div className="mt-2 rounded-lg border border-indigo-200 bg-white/60 px-3 py-2">
                      <p className="text-[10px] text-gray-600 leading-relaxed">
                        Chấm công tính theo ca gốc trong Lark. Checkout sớm hơn giờ ra ca mới → vẫn ghi nhận về sớm.
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* ── Lark Form Widgets ── */}
              {selectedApproval.rawData && selectedApproval.approvalType !== 'Correction' && renderLarkFormFields(selectedApproval.rawData)}

            </div>
          </div>
        </motion.div>
      )}
    </motion.div>,
    document.body
  );
}

function CheckRow({ type, time, location, wifi, isWifi, isField, supplement, onSupplementClick }: {
  type: 'in' | 'out';
  time: string | null;
  location: string | null;
  wifi: string | null;
  isWifi: boolean;
  isField: boolean;
  supplement: string | null;
  onSupplementClick?: () => void;
}) {
  const isIn = type === 'in';
  return (
    <div className="flex items-start gap-3">
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isIn ? 'bg-emerald-50' : 'bg-orange-50'}`}>
        {isIn ? <LogIn size={13} className="text-emerald-600" /> : <LogOut size={13} className="text-orange-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-400 font-medium">{isIn ? 'Check-in' : 'Check-out'}</span>
          <span className="text-sm font-bold tabular-nums text-gray-800">{fmtTime(time)}</span>
        </div>
        {location && (
          <p className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-400">
            <MapPin size={9} className="shrink-0" /><span className="truncate">{location}</span>
          </p>
        )}
        {isWifi && wifi && (
          <p className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-400">
            <Wifi size={9} className="text-blue-400 shrink-0" /><span className="truncate">{wifi}</span>
          </p>
        )}
        <div className="flex gap-1 mt-1 flex-wrap">
          {isField && (
            <span className="text-[8px] px-1.5 py-px rounded bg-orange-50 text-orange-600 font-medium border border-orange-200">Chấm ngoài</span>
          )}
          {supplementLabel(supplement) && (
            onSupplementClick ? (
              <button
                onClick={onSupplementClick}
                className="text-[8px] px-1.5 py-px rounded bg-violet-50 text-violet-600 font-medium border border-violet-200 hover:bg-violet-100 hover:border-violet-400 transition-colors cursor-pointer underline-offset-1 hover:underline"
              >
                {supplementLabel(supplement)} ↗
              </button>
            ) : (
              <span className="text-[8px] px-1.5 py-px rounded bg-violet-50 text-violet-600 font-medium border border-violet-200">{supplementLabel(supplement)}</span>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, warn, good, small }: {
  label: string; value: string; warn?: boolean; good?: boolean; small?: boolean;
}) {
  return (
    <div className="bg-gray-50 rounded-lg px-2.5 py-1.5">
      <p className="text-[8px] text-gray-400 font-medium uppercase tracking-wider">{label}</p>
      <p className={`${small ? 'text-[10px]' : 'text-xs'} font-bold tabular-nums mt-0.5 ${
        warn ? 'text-red-500' : good ? 'text-blue-600' : 'text-gray-700'
      } truncate`}>{value}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ATTENDANCE TABLE VIEW — flat list with pagination
// ═══════════════════════════════════════════════════════════

const PAGE_SIZE = 20;

interface FlatRecord {
  record: DailyRecord;
  employee: EmployeeRow;
  dayInfo: DayInfo;
}

function AttendanceTable({ rows, days, onRowClick }: {
  rows: TimesheetRow[];
  days: DayInfo[];
  onRowClick: (record: DailyRecord, day: DayInfo, employee: EmployeeRow) => void;
}) {
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState<'date' | 'name' | 'checkin' | 'status'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Build flat record list
  const flatRecords = useMemo(() => {
    const result: FlatRecord[] = [];
    for (const row of rows) {
      for (const day of days) {
        const record = row.records.get(day.iso);
        if (record) {
          result.push({ record, employee: row.employee, dayInfo: day });
        }
      }
    }
    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date': cmp = a.record.attendanceDate.localeCompare(b.record.attendanceDate); break;
        case 'name': cmp = a.employee.fullName.localeCompare(b.employee.fullName, 'vi'); break;
        case 'checkin': cmp = (a.record.checkIn || '').localeCompare(b.record.checkIn || ''); break;
        case 'status': cmp = (a.record.conclusion || '').localeCompare(b.record.conclusion || ''); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return result;
  }, [rows, days, sortField, sortDir]);

  const totalPages = Math.ceil(flatRecords.length / PAGE_SIZE);
  const pageRecords = flatRecords.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
    setPage(0);
  };

  const SortIcon = ({ field }: { field: typeof sortField }) => (
    <span className={`ml-0.5 text-[8px] ${sortField === field ? 'text-blue-500' : 'text-gray-300'}`}>
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );

  function fmtShortDate(iso: string): string {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const wd = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getDay()];
    return `${wd} ${day}/${month}`;
  }

  function conclusionBadge(c: string | null) {
    const m: Record<string, { bg: string; fg: string }> = {
      'Đủ công': { bg: '#ecfdf5', fg: '#059669' },
      'Đi trễ': { bg: '#fffbeb', fg: '#d97706' },
      'Về sớm': { bg: '#fff7ed', fg: '#ea580c' },
      'Nửa công': { bg: '#fffbeb', fg: '#d97706' },
      'Không chấm công': { bg: '#fef2f2', fg: '#dc2626' },
      'Thiếu check-in': { bg: '#fef2f2', fg: '#dc2626' },
      'Thiếu check-out': { bg: '#fff7ed', fg: '#ea580c' },
    };
    const s = m[c || ''] || { bg: '#f9fafb', fg: '#6b7280' };
    return (
      <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded"
        style={{ backgroundColor: s.bg, color: s.fg }}>
        {c || '—'}
      </span>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 text-[11px] text-gray-500 uppercase tracking-wider">
              <th className="text-left px-3 py-2.5 font-semibold cursor-pointer hover:text-gray-700 select-none" onClick={() => toggleSort('name')}>
                Nhân viên <SortIcon field="name" />
              </th>
              <th className="text-left px-3 py-2.5 font-semibold cursor-pointer hover:text-gray-700 select-none" onClick={() => toggleSort('date')}>
                Ngày <SortIcon field="date" />
              </th>
              <th className="text-center px-3 py-2.5 font-semibold">Ca</th>
              <th className="text-center px-3 py-2.5 font-semibold cursor-pointer hover:text-gray-700 select-none" onClick={() => toggleSort('checkin')}>
                Check-in <SortIcon field="checkin" />
              </th>
              <th className="text-center px-3 py-2.5 font-semibold">Check-out</th>
              <th className="text-center px-3 py-2.5 font-semibold">Giờ công</th>
              <th className="text-center px-3 py-2.5 font-semibold">Địa điểm</th>
              <th className="text-center px-3 py-2.5 font-semibold cursor-pointer hover:text-gray-700 select-none" onClick={() => toggleSort('status')}>
                Trạng thái <SortIcon field="status" />
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRecords.map(({ record, employee, dayInfo }) => (
              <tr key={record.id}
                className="border-t border-gray-100 hover:bg-blue-50/30 transition-colors cursor-pointer"
                onClick={() => onRowClick(record, dayInfo, employee)}>
                {/* Employee */}
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {employee.avatarUrl ? (
                      <img src={employee.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center text-[8px] font-bold text-blue-500">
                        {employee.fullName.split(' ').slice(-2).map(w => w[0]).join('').toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-[11px] font-semibold text-gray-800 leading-tight">{employee.fullName}</p>
                      <p className="text-[9px] text-gray-400 leading-tight">{employee.department}</p>
                    </div>
                  </div>
                </td>
                {/* Date */}
                <td className="px-3 py-2">
                  <span className={`text-[11px] font-medium tabular-nums ${dayInfo.weekend ? 'text-gray-400' : 'text-gray-700'}`}>
                    {fmtShortDate(record.attendanceDate)}
                  </span>
                </td>
                {/* Shift */}
                <td className="px-3 py-2 text-center">
                  {record.shiftCheckIn ? (
                    <span className="text-[10px] text-gray-500 tabular-nums">
                      {fmtTime(record.shiftCheckIn)}–{fmtTime(record.shiftCheckOut)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-300">—</span>
                  )}
                </td>
                {/* Check-in */}
                <td className="px-3 py-2 text-center">
                  <span className="text-[11px] font-semibold tabular-nums text-gray-800">{fmtTime(record.checkIn)}</span>
                </td>
                {/* Check-out */}
                <td className="px-3 py-2 text-center">
                  <span className="text-[11px] font-semibold tabular-nums text-gray-800">{fmtTime(record.checkOut)}</span>
                </td>
                {/* Work hours */}
                <td className="px-3 py-2 text-center">
                  <span className={`text-[11px] font-bold tabular-nums ${record.workHours >= 8 ? 'text-emerald-600' : record.workHours > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                    {record.workHours > 0 ? fmtHM(record.workHours) : '—'}
                  </span>
                </td>
                {/* Location */}
                <td className="px-3 py-2 text-center max-w-[150px]">
                  {record.checkInLocation ? (
                    <span className="text-[10px] text-gray-400 truncate block">{record.checkInLocation}</span>
                  ) : record.checkInIsWifi && record.checkInWifi ? (
                    <span className="text-[10px] text-gray-400 flex items-center justify-center gap-0.5">
                      <Wifi size={9} className="text-blue-400" />{record.checkInWifi}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-300">—</span>
                  )}
                </td>
                {/* Status */}
                <td className="px-3 py-2 text-center">
                  {conclusionBadge(record.conclusion)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
          <p className="text-[11px] text-gray-400">
            Hiển thị {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, flatRecords.length)} / {flatRecords.length} bản ghi
          </p>
          <div className="flex items-center gap-1">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-2 py-1 text-[11px] rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors">
              <ChevronLeft size={12} />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i;
              } else if (page < 3) {
                pageNum = i;
              } else if (page > totalPages - 4) {
                pageNum = totalPages - 7 + i;
              } else {
                pageNum = page - 3 + i;
              }
              return (
                <button key={pageNum} onClick={() => setPage(pageNum)}
                  className={`w-7 h-7 text-[11px] rounded transition-colors cursor-pointer ${
                    page === pageNum ? 'bg-blue-500 text-white font-bold' : 'text-gray-500 hover:bg-gray-100'
                  }`}>
                  {pageNum + 1}
                </button>
              );
            })}
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
              className="px-2 py-1 text-[11px] rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors">
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
