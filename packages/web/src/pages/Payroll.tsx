import { motion } from 'framer-motion';
import {
  AlertTriangle,
  BadgeCheck,
  BriefcaseBusiness,
  CalendarRange,
  Calculator,
  CheckCircle2,
  Clock3,
  Download,
  DollarSign,
  Eye,
  ExternalLink,
  FileImage,
  FileText,
  Grid2X2,
  ImagePlus,
  Mail,
  Plane,
  Pencil,
  RefreshCw,
  ReceiptText,
  RotateCcw,
  Save,
  Sheet,
  Shield,
  Table2,
  TimerReset,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import type { FocusEvent, MouseEvent, ReactNode } from 'react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PageHeader,
  Avatar, Button, Dropdown, EmptyState, FormInput, Modal,
} from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import api from '@/services/api';

type PayrollTab = 'timesheet' | 'salary' | 'slips';
type PayslipViewMode = 'table' | 'cards';
type PayrollOtHourOverrideKey = 'weekday' | 'weekdayNight' | 'weekend' | 'holiday' | 'untilNight' | 'nightNormal' | 'nightWeekend';
type SyncAttendanceOptions = { silent?: boolean };

interface PayrollPeriod {
  id: string;
  monthKey: string;
  label: string;
  status: string;
}

interface EmployeeMetadata {
  avatarUrl?: string | null;
  staffClassify?: string | null;
}

interface PayrollManualOverrides {
  standardDays?: number;
  actualDays?: number;
  baseSalary?: number;
  otTotalAmount?: number;
  afterTaxAdjustment?: number;
  allowances?: {
    rank?: number;
    technical?: number;
    language?: number;
    housing?: number;
    transport?: number;
    meal?: number;
    phone?: number;
    attendance?: number;
  };
  otHours?: Partial<Record<PayrollOtHourOverrideKey, number>>;
}

interface PayrollManualEditLog {
  at: string;
  by?: string;
  note?: string;
  changes?: Record<string, { oldValue: unknown; newValue: unknown }>;
}

interface PayslipHrAttachment {
  id?: string;
  name: string;
  type: string;
  size?: number;
  dataUrl: string;
  createdAt?: string;
}

interface PayslipHrNote {
  text?: string;
  attachments?: PayslipHrAttachment[];
  updatedAt?: string;
  updatedBy?: string;
}

interface PayslipApiRow {
  id: string;
  employeeId?: string;
  standardDays: number | string;
  actualDays: number | string;
  workRatio: number | string;
  baseSalary: number | string;
  actualSalary: number | string;
  allowancesTotal: number | string;
  otTotalHours: number | string;
  otTotalAmount: number | string;
  lateDeduction: number | string;
  grossIncome: number | string;
  insuranceEmployee: number | string;
  insuranceEmployer: number | string;
  taxExempt: number | string;
  taxableIncome: number | string;
  pitAmount: number | string;
  afterTaxAdjustment: number | string;
  unionFee: number | string;
  netSalary: number | string;
  status: string;
  fullBreakdown?: {
    gross?: {
      workRatio?: number;
      grossIncome?: number;
      actualSalary?: number;
      lateDeduction?: number;
      proratedAllowances?: number;
    };
    insurance?: {
      employee?: { bhxh?: number; bhyt?: number; bhtn?: number; total?: number };
      employer?: { bhxh?: number; bhyt?: number; bhtn?: number; total?: number };
      insuranceBasis?: number;
      basisBhxhBhyt?: number;
      basisBhtn?: number;
      caps?: { bhxhBhyt?: number; bhxh_bhyt?: number; bhtn?: number };
    };
    pit?: {
      pitAmount?: number;
      taxableIncome?: number;
      effectiveRate?: number;
      bracketDetails?: Array<{
        bracket: number;
        taxableInBracket: number;
        tax: number;
        rate: number;
      }>;
    };
    taxExemptions?: {
      ot?: number;
      meal?: number;
      phone?: number;
      total?: number;
    };
    allowances?: {
      rank?: number;
      bpql?: number;
      sales?: number;
      technical?: number;
      language?: number;
      housing?: number;
      transport?: number;
      meal?: number;
      phone?: number;
      attendance?: number;
    };
    manualOverrides?: PayrollManualOverrides;
    manualEditLogs?: PayrollManualEditLog[];
    payrollSegment?: {
      key?: string;
      label?: string;
      virtual?: boolean;
      dateRange?: string;
      sourceHours?: number;
      note?: string;
    };
    payslipHrNote?: PayslipHrNote;
  } | null;
  otBucketBreakdown?: Record<string, { hours: number; amount: number }> | null;
  employee?: {
    fullName?: string | null;
    originalFullName?: string | null;
    department?: string | null;
    position?: string | null;
    employeeCode?: string | null;
    employmentType?: string | null;
    staffClassify?: string | null;
    scheduleType?: string | null;
    joinDate?: string | null;
    groupKey?: string | null;
    sortIndex?: number | null;
    avatarUrl?: string | null;
    payrollSegment?: {
      key?: string;
      label?: string;
      virtual?: boolean;
      dateRange?: string;
      sourceHours?: number;
      note?: string;
    } | null;
    larkMetadata?: EmployeeMetadata | null;
  } | null;
  attendance?: {
    workHours: number;
    absentDays: number;
    lateHoursBeforeLeave?: number;
    earlyHoursBeforeLeave?: number;
    lateEarlyLeaveDeductedHours?: number;
    lateHours: number;
    earlyHours: number;
    annualLeaveHours: number;
    benefitLeaveHours: number;
    compLeaveHours: number;
  } | null;
  taxPolicyInfo?: {
    dependents: number;
    personalDeduction: number;
    dependentDeduction?: number;
  } | null;
  leaveBalance?: {
    opening: number;
    accrued: number;
    used: number;
    lateEarlyUsed?: number;
    closing: number;
  } | null;
}

interface PayrollSummary {
  totalEmployees: number;
  totalGross: number;
  totalInsurance: number;
  totalPIT: number;
  totalNet: number;
}

interface PayrollRow {
  id: string;
  employeeId: string;
  name: string;
  originalName: string;
  department: string;
  position: string;
  employeeCode: string;
  employmentType: string;
  staffClassify: string;
  joinDate: string | null;
  groupKey: string;
  sortIndex: number;
  avatarUrl: string | null;
  isVirtualSegment: boolean;
  segmentLabel: string | null;
  segmentDateRange: string | null;
  // Attendance
  standardDays: number;
  actualDays: number;
  workRatio: number;
  workHours: number;
  absentDays: number;
  lateHoursBeforeLeave: number;
  earlyHoursBeforeLeave: number;
  lateEarlyLeaveDeductedHours: number;
  lateHours: number;
  earlyHours: number;
  annualLeaveHours: number;
  benefitLeaveHours: number;
  compLeaveHours: number;
  // Leave balance
  prevLeaveBalance: number;
  currentLeaveBalance: number;
  leaveUsed: number;
  lateEarlyLeaveUsed: number;
  // Tax policy
  dependents: number;
  personalDeduction: number;
  dependentDeduction: number;
  familyDeduction: number;
  // Salary
  baseSalary: number;
  payrollSalary: number;
  actualSalary: number;
  dailyRate: number;
  hourlyRate: number;
  overtimeRate: number;
  otRateWeekdayNight: number;
  otRateWeekend: number;
  otRateHoliday: number;
  otRateUntilNight: number;
  otRateNightNormal: number;
  otRateNightWeekend: number;
  // Allowances (raw, before proration)
  allowRank: number;
  allowBpql: number;
  allowSales: number;
  allowTechnical: number;
  allowLanguage: number;
  allowHousing: number;
  allowTransport: number;
  allowMeal: number;
  allowPhone: number;
  allowAttendance: number;
  allowancesTotal: number;
  // OT by bucket (hours)
  otHrsWeekday: number;    // Ngày thường 17h~22h (150%)
  otHrsWeekdayNight: number; // Làm thêm ca đêm của ngày thường (200%)
  otHrsWeekend: number;    // T7 + CN ban ngày (150%/200%)
  otHrsHoliday: number;    // Ngày lễ ban ngày (300%)
  otHrsUntilNight: number; // Đến đêm 22h~6h tiếp theo (200%)
  otHrsNightNormal: number;// Ca đêm ngày thường (30% allowance)
  otHrsNightWeekend: number; // Ca đêm ngày nghỉ
  otHrsNightOt: number;    // OT của ca đêm (翌日6h~22h = 150%)
  otHours: number;
  otAmount: number;
  // OT amounts by bucket
  otAmtWeekday: number;
  otAmtWeekdayNight: number;
  otAmtWeekend: number;
  otAmtHoliday: number;
  otAmtUntilNight: number;
  otAmtNightNormal: number;
  otAmtNightWeekend: number;
  // Deductions
  lateDeduction: number;
  // Tax-exempt items
  taxExemptOT: number;
  taxExemptMeal: number;
  taxExemptPhone: number;
  totalTaxExempt: number;
  // Gross
  grossIncome: number;
  // Insurance
  insuranceRawBasis: number;
  insuranceBhxhCap: number;
  insuranceBhtnCap: number;
  insuranceBasis: number;
  insuranceBhtnBasis: number;
  empBhxh: number;
  empBhyt: number;
  empBhtn: number;
  insurance: number;        // = empBhxh + empBhyt + empBhtn
  erBhxh: number;
  erBhyt: number;
  erBhtn: number;
  insuranceEmployer: number;// = erBhxh + erBhyt + erBhtn
  totalInsurance: number;   // NLĐ + DN
  // PIT
  taxExempt: number;        // giảm trừ gia cảnh
  taxableIncome: number;
  pit: number;
  afterTaxAdj: number;
  unionFee: number;
  netSalary: number;
  status: string;
  fullBreakdown: PayslipApiRow['fullBreakdown'];
  payslipHrNote: PayslipHrNote;
  manualOverrides: PayrollManualOverrides;
  manualEditLogs: PayrollManualEditLog[];
  otBuckets: Record<string, { hours: number; amount: number }>;
  auditOtHours: number;
  compLeaveOtHours: number;
  compLeaveOtBuckets: Record<string, { hours: number; amount: number }>;
}

interface PayrollGroup {
  key: string;
  label: string;
  rows: PayrollRow[];
}

interface TimesheetEmployee {
  employeeCode: string | null;
  fullName: string;
  originalFullName?: string | null;
  department: string;
  position: string;
  employmentType: string;
  scheduleType: string;
  groupKey?: string | null;
  sortIndex?: number | null;
  avatarUrl: string | null;
}

interface TimesheetPeriod {
  id: string;
  monthKey: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  status: string;
}

interface TimesheetAttendance {
  standardDays: number;
  rawActualDays: number;
  paidCreditHours: number;
  unpaidHours: number;
  actualDays: number;
  absentDays: number;
  workHours: number;
  lateHoursBeforeLeave: number;
  earlyHoursBeforeLeave: number;
  lateEarlyLeaveDeductedHours: number;
  lateHours: number;
  earlyHours: number;
  annualLeaveHours: number;
  benefitLeaveHours: number;
  remoteHours: number;
  compLeaveHours: number;
  correctionHours: number;
}

interface LeaveBalance {
  opening: number;
  accrued: number;
  used: number;
  lateEarlyUsed?: number;
  adjustment: number;
  seniorityBonus: number;
  closing: number;
}

interface OtBucket {
  hours: number;
  amount: number;
}

interface TimesheetApiRow {
  id: string;
  employeeId: string;
  employee: TimesheetEmployee;
  period: TimesheetPeriod;
  attendance: TimesheetAttendance;
  leaveBalance: LeaveBalance | null;
  ot: {
    totalHours: number;
    totalAmount: number;
    bucketBreakdown: Record<string, OtBucket>;
    overDailyDates: unknown[];
    overMonthlyLimit: boolean;
  };
  // Realtime OT from ApprovalRecord (matches Approvals page)
  approvedOt?: {
    totalHours: number;
    bucketBreakdown: Record<string, number>;
  };
}

interface TimesheetTotals {
  standardDays: number;
  actualDays: number;
  workHours: number;
  lateHours: number;
  earlyHours: number;
  lateHoursBeforeLeave: number;
  earlyHoursBeforeLeave: number;
  lateEarlyLeaveDeductedHours: number;
  leaveUsed: number;
  absentDays: number;
  otHours: number;
}

interface TimesheetResponse {
  data: TimesheetApiRow[];
  period: TimesheetPeriod;
  totals: TimesheetTotals;
}

interface TimesheetRow {
  id: string;
  employeeId: string;
  name: string;
  employeeCode: string;
  groupKey: string;
  sortIndex: number;
  department: string;
  position: string;
  scheduleType: string;
  avatarUrl: string | null;
  period: TimesheetPeriod;
  standardDays: number;
  rawActualDays: number;
  actualDays: number;
  workHours: number;
  lateHours: number;
  earlyHours: number;
  lateHoursBeforeLeave: number;
  earlyHoursBeforeLeave: number;
  lateEarlyLeaveDeductedHours: number;
  paidCreditHours: number;
  unpaidHours: number;
  leaveUsed: number;
  lateEarlyLeaveUsed: number;
  leaveRemaining: number;
  annualLeaveHours: number;
  benefitLeaveHours: number;
  remoteHours: number;
  compLeaveHours: number;
  correctionHours: number;
  // Realtime from ApprovalRecord (matches Approvals page totals)
  approvedOtHours: number;
  approvedOtBuckets: Record<string, number>;
  // From otMonthly (actual worked hours for payslip)
  otHours: number;
  otAmount: number;
  otBuckets: Record<string, OtBucket>;
  absentDays: number;
  overMonthlyLimit: boolean;
}

interface TimesheetGroup {
  key: string;
  label: string;
  rows: TimesheetRow[];
}

interface SheetStatus {
  periodId: string;
  larkSheetUrl: string | null;
  larkSheetToken: string | null;
  hasSheet: boolean;
}

interface OtSheetStatus {
  periodId: string;
  larkOtSheetUrl: string | null;
  larkOtSheetToken: string | null;
  hasSheet: boolean;
}

interface SalarySheetStatus {
  periodId: string;
  larkSheetUrl: string | null;
  larkSheetToken: string | null;
  hasSheet: boolean;
}

interface PayslipPdfAttachment {
  name: string;
  url: string;
  fileToken: string | null;
  type: string | null;
  size: number | null;
}

interface PayslipBaseRecord {
  recordId: string;
  sourceId: string;
  employeeCode: string;
  employeeName: string;
  periodLabel: string;
  payrollWindow: string;
  status: string;
  confirmationStatus: string;
  sendPdf: boolean;
  sendMail: boolean;
  pdfAttachments: PayslipPdfAttachment[];
  hrNote: string;
  leaveStatus: string;
  larkNumbers: {
    standardDays: number;
    actualDays: number;
    otHours: number;
    gross: number;
    insuranceEmployee: number;
    pit: number;
    net: number;
  };
  explanations: {
    period: string;
    payroll: string;
    ot: string;
    leave: string;
    deduction: string;
  };
}

interface PayslipBaseResponse {
  data: PayslipBaseRecord[];
  meta: {
    tableId: string;
    sourcePrefix: string;
    fieldCount: number;
    fields: Array<{ id: string; name: string; type: number; uiType?: string; isPrimary: boolean; isHidden: boolean }>;
  };
}


interface OtPopoverState {
  top: number;
  left: number;
  totalHours: number;
  totalAmount: number;
  buckets: Record<string, OtBucket>;
}

interface FormulaLine {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'green' | 'red' | 'amber' | 'blue' | 'violet';
}

interface FormulaTooltipContent {
  title: string;
  subtitle?: string;
  formula: string;
  lines: FormulaLine[];
  result: string;
  note?: string;
}

interface FormulaPopoverState extends FormulaTooltipContent {
  top: number;
  left: number;
}

type FormulaOpenEvent = MouseEvent<HTMLElement> | FocusEvent<HTMLElement>;
type FormulaOpenHandler = (event: FormulaOpenEvent, formula: FormulaTooltipContent) => void;

const toNum = (value: number | string | null | undefined): number => Number(value ?? 0) || 0;
const fmtDecimal = (n: number, maximumFractionDigits = 2, minimumFractionDigits = 0) => new Intl.NumberFormat('vi-VN', {
  maximumFractionDigits,
  minimumFractionDigits,
}).format(n);
const fmtVND = (n: number) => new Intl.NumberFormat('vi-VN').format(n);
const fmtDays = (n: number) => `${fmtDecimal(n)} ngày`;
const fmtHours = (n: number) => `${fmtDecimal(n)}h`;
const fmtMoney = (n: number) => `${fmtVND(Math.round(n))} ₫`;
const roundToTens = (n: number) => (Number.isFinite(n) && n > 0 ? Math.ceil(n / 10) * 10 : 0);
const payrollOtComponentAmount = (row: PayrollRow) => (
  row.otAmtWeekday
  + row.otAmtWeekdayNight
  + row.otAmtWeekend
  + row.otAmtHoliday
  + row.otAmtUntilNight
  + row.otAmtNightNormal
  + row.otAmtNightWeekend
);
const fmtPayrollNumber = (n: number, suffix = '') => `${fmtDecimal(n)}${suffix}`;
const fmtInputMoney = (n: number) => fmtVND(Math.round(n));
const fmtInputDecimal = (n: number) => fmtDecimal(n, 2);
const fmtPlainDate = (value: string | null) => value ? formatDate(value) : '—';
const fmtFileSize = (bytes?: number) => {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${fmtDecimal(bytes / 1024, 1)} KB`;
  return `${fmtDecimal(bytes / (1024 * 1024), 1)} MB`;
};
const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };
const TIMESHEET_GROUP_ORDER = ['expats', 'indirect', 'equipment', 'other'];
const INSURANCE_BHXH_BHYT_CAP = 46_800_000;
const INSURANCE_BHTN_CAP = 99_200_000;
const DEFAULT_DEPENDENT_DEDUCTION = 6_200_000;
const PAYROLL_EDIT_FIELD_LABELS: Record<string, string> = {
  standardDays: 'Ngày công chuẩn',
  actualDays: 'Ngày công thực tế',
  baseSalary: 'Lương cơ bản',
  otTotalAmount: 'Tiền OT được tính lương',
  afterTaxAdjustment: 'Điều chỉnh sau thuế',
  'allowances.rank': 'Phụ cấp cấp bậc',
  'allowances.technical': 'Phụ cấp kỹ thuật',
  'allowances.language': 'Phụ cấp ngoại ngữ',
  'allowances.housing': 'Phụ cấp nhà ở',
  'allowances.transport': 'Phụ cấp đi lại',
  'allowances.meal': 'Phụ cấp ăn uống',
  'allowances.phone': 'Phụ cấp điện thoại',
  'allowances.attendance': 'Phụ cấp chuyên cần',
  'otHours.weekday': 'Giờ OT + ca đêm',
  'otHours.weekdayNight': 'Giờ làm thêm ca đêm ngày thường',
  'otHours.weekend': 'Giờ làm ngày nghỉ',
  'otHours.holiday': 'Giờ làm ngày lễ',
  'otHours.untilNight': 'Giờ làm thêm đến đêm',
  'otHours.nightNormal': 'Giờ ca đêm thường',
  'otHours.nightWeekend': 'Giờ ca đêm ngày nghỉ',
};

function readImageAsPayslipAttachment(file: File): Promise<PayslipHrAttachment> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    return Promise.reject(new Error(`${file.name} phải là ảnh PNG, JPG hoặc WEBP`));
  }
  if (file.size > 2_500_000) {
    return Promise.reject(new Error(`${file.name} vượt quá 2.5MB`));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Không đọc được file ${file.name}`));
    reader.onload = () => resolve({
      id: `${Date.now()}-${file.name}`,
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: String(reader.result ?? ''),
      createdAt: new Date().toISOString(),
    });
    reader.readAsDataURL(file);
  });
}

function sourceIdForPayslip(row: PayrollRow, monthKey?: string): string {
  const segment = row.isVirtualSegment && row.segmentLabel
    ? `-${row.segmentLabel.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
    : '';
  return `PAYSLIP-${monthKey ?? ''}-${row.employeeCode}${segment}`;
}

const TIMESHEET_GROUP_LABELS: Record<string, string> = {
  expats: '駐在員 (BAN GIÁM ĐỐC / EXPATS)',
  indirect: '間接部門 (BỘ PHẬN GIÁN TIẾP / VĂN PHÒNG)',
  equipment: '機材センター (TRUNG TÂM THIẾT BỊ / KHO BÃI)',
  other: 'BỘ PHẬN KHÁC',
};

// OT bucket labels — must match bucket strings from ot-calculator.ts classifyOtBucket()
const OT_BUCKET_LABELS: Record<string, string> = {
  'Ngày thường 時間外 17h~22h':                       'Ngày thường 時間外 17h~22h',
  'weekday_night':                                    'Làm thêm ca đêm của ngày thường (200%)',
  'Ngày thường — Ban đêm':                            'Làm thêm ca đêm của ngày thường (200%)',
  'Làm thêm ca đêm của ngày thường':                  'Làm thêm ca đêm của ngày thường (200%)',
  '日勤の夜間残業6h~22h':                              'Làm thêm ca đêm của ngày thường (200%)',
  'Ngày thường 時間外(夕間まで残業) 22h~6h':              'Làm thêm đến đêm (210%)',
  'Ngày thường 時間外(夜間まで残業) 22h~6h':              'Làm thêm đến đêm (210%)',
  'Ngày nghỉ T7 休日出勤(土) 6h~22h':                  'Ngày nghỉ T7 休日出勤(土) 6h~22h',
  'Ngày nghỉ T7 ca đêm 土曜夜勤 22h~6h':               'Ngày nghỉ T7 ca đêm 土曜夜勤 22h~6h',
  'Ngày nghỉ 休日出勤 6h~22h':                         'Ngày nghỉ CN 休日出勤 6h~22h',
  'Ngày nghỉ ca đêm 休日の夜勤 22h~6h':                 'Ngày nghỉ CN ca đêm 休日の夜勤 22h~6h',
  'OT ngày lễ 祝日出勤':                               'OT ngày lễ 祝日出勤',
  'OT ngày lễ ca đêm 祝日夜勤 22h~6h':                 'OT ngày lễ ca đêm 祝日夜勤 22h~6h',
  '平日の夜勤 22h~6h ca đêm':                          'Ca đêm 22h~6h (30%)',
  '平日夜勤の残業→翌日の6h~22h Số giờ làm thêm của ca đêm': 'OT của ca đêm (130%)',
};

const isWeekdayDayOtBucket = (bucket: string) => bucket.includes('Ngày thường 時間外 17h~22h');
const isWeekdayNightOtBucket = (bucket: string) => (
  bucket.includes('weekday_night')
  || bucket.includes('Ngày thường — Ban đêm')
  || bucket.includes('Làm thêm ca đêm của ngày thường')
  || bucket.includes('日勤の夜間残業')
);
const isUntilNightOtBucket = (bucket: string) => (
  (bucket.includes('夜間まで残業') || bucket.includes('夕間まで残業'))
  && bucket.includes('22h~6h')
);
const isWeekendOtBucket = (bucket: string) => (
  bucket.includes('Ngày nghỉ T7 休日出勤(土) 6h~22h')
  || bucket.includes('Ngày nghỉ 休日出勤 6h~22h')
);
const isHolidayOtBucket = (bucket: string) => bucket.includes('OT ngày lễ 祝日出勤') && !bucket.includes('ca đêm');
const isNightNormalOtBucket = (bucket: string) => bucket.includes('平日の夜勤') || bucket.includes('Ca đêm 22h~6h');
const isNightWeekendOtBucket = (bucket: string) => bucket.includes('Ngày nghỉ T7 ca đêm') || bucket.includes('Ngày nghỉ ca đêm');
const isNightShiftDayOtBucket = (bucket: string) => bucket.includes('翌日の6h') || bucket.includes('夜勤残業');

function otBucketColor(bucket: string): string {
  if (bucket === 'Ngày thường 時間外 17h~22h') return 'text-blue-700 bg-blue-50 border-blue-200';
  if (bucket.includes('weekday_night') || bucket.includes('Ngày thường — Ban đêm') || bucket.includes('Làm thêm ca đêm của ngày thường') || bucket.includes('日勤の夜間残業')) return 'text-fuchsia-700 bg-fuchsia-50 border-fuchsia-200';
  if (bucket === 'Ngày thường 時間外(夕間まで残業) 22h~6h') return 'text-purple-700 bg-purple-50 border-purple-200';
  if (bucket === 'Ngày thường 時間外(夜間まで残業) 22h~6h') return 'text-purple-700 bg-purple-50 border-purple-200';
  if (bucket === 'Ngày nghỉ T7 休日出勤(土) 6h~22h') return 'text-sky-700 bg-sky-50 border-sky-200';
  if (bucket === 'Ngày nghỉ T7 ca đêm 土曜夜勤 22h~6h') return 'text-cyan-700 bg-cyan-50 border-cyan-200';
  if (bucket === 'Ngày nghỉ 休日出勤 6h~22h') return 'text-indigo-700 bg-indigo-50 border-indigo-200';
  if (bucket === 'Ngày nghỉ ca đêm 休日の夜勤 22h~6h') return 'text-violet-700 bg-violet-50 border-violet-200';
  if (bucket === 'OT ngày lễ 祝日出勤') return 'text-orange-700 bg-orange-50 border-orange-200';
  if (bucket === 'OT ngày lễ ca đêm 祝日夜勤 22h~6h') return 'text-red-700 bg-red-50 border-red-200';
  if (bucket.includes('夜勤') || bucket.includes('ca đêm') || bucket.includes('Ca đêm')) return 'text-slate-700 bg-slate-50 border-slate-200';
  return 'text-gray-700 bg-gray-50 border-gray-200';
}

function avatarUrlFromPayslip(row: PayslipApiRow): string | null {
  return row.employee?.avatarUrl ?? row.employee?.larkMetadata?.avatarUrl ?? null;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

function groupPayrollRows(rows: PayrollRow[]): PayrollGroup[] {
  const grouped = rows.reduce<Record<string, PayrollRow[]>>((acc, row) => {
    acc[row.groupKey] = [...(acc[row.groupKey] ?? []), row];
    return acc;
  }, {});

  return TIMESHEET_GROUP_ORDER
    .filter((key) => (grouped[key]?.length ?? 0) > 0)
    .map((key) => ({
      key,
      label: TIMESHEET_GROUP_LABELS[key] ?? key,
      rows: [...(grouped[key] ?? [])].sort((a, b) => a.sortIndex - b.sortIndex),
    }));
}

const PAYSLIP_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT:     { label: 'Nháp',    cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  FINALIZED: { label: 'Chốt',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  SENT:      { label: 'Đã gửi', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  CONFIRMED: { label: 'XN',     cls: 'bg-violet-50 text-violet-700 border-violet-200' },
};

const formulaToneClass: Record<NonNullable<FormulaLine['tone']>, string> = {
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  green: 'text-emerald-600',
  red: 'text-rose-600',
  amber: 'text-amber-600',
  blue: 'text-blue-600',
  violet: 'text-violet-600',
};

const FLOATING_TOOLTIP_MARGIN = 12;
const FLOATING_TOOLTIP_POINTER_GAP = 18;

function clampFloatingValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function getFloatingTooltipPosition(
  event: FormulaOpenEvent | MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>,
  width: number,
  estimatedHeight: number,
): { top: number; left: number } {
  const rect = event.currentTarget.getBoundingClientRect();
  const maxLeft = Math.max(FLOATING_TOOLTIP_MARGIN, window.innerWidth - width - FLOATING_TOOLTIP_MARGIN);
  const maxTop = Math.max(FLOATING_TOOLTIP_MARGIN, window.innerHeight - estimatedHeight - FLOATING_TOOLTIP_MARGIN);
  const isPointerEvent = 'clientX' in event
    && typeof event.clientX === 'number'
    && typeof event.clientY === 'number'
    && (event.clientX !== 0 || event.clientY !== 0);

  if (isPointerEvent) {
    const right = event.clientX + FLOATING_TOOLTIP_POINTER_GAP;
    const left = event.clientX - FLOATING_TOOLTIP_POINTER_GAP - width;
    const topBelow = event.clientY + FLOATING_TOOLTIP_POINTER_GAP;
    const topAbove = event.clientY - FLOATING_TOOLTIP_POINTER_GAP - estimatedHeight;

    return {
      left: clampFloatingValue(
        right + width <= window.innerWidth - FLOATING_TOOLTIP_MARGIN ? right : left,
        FLOATING_TOOLTIP_MARGIN,
        maxLeft,
      ),
      top: clampFloatingValue(
        topBelow + estimatedHeight <= window.innerHeight - FLOATING_TOOLTIP_MARGIN ? topBelow : topAbove,
        FLOATING_TOOLTIP_MARGIN,
        maxTop,
      ),
    };
  }

  const left = rect.left + rect.width / 2 - width / 2;
  const spaceBelow = window.innerHeight - rect.bottom;
  const top = spaceBelow < estimatedHeight + FLOATING_TOOLTIP_POINTER_GAP
    ? rect.top - estimatedHeight - FLOATING_TOOLTIP_POINTER_GAP
    : rect.bottom + FLOATING_TOOLTIP_POINTER_GAP;

  return {
    left: clampFloatingValue(left, FLOATING_TOOLTIP_MARGIN, maxLeft),
    top: clampFloatingValue(top, FLOATING_TOOLTIP_MARGIN, maxTop),
  };
}

function FormulaTooltip({ data }: { data: FormulaPopoverState }) {
  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999] w-[360px] max-w-[calc(100vw-24px)] rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
      style={{ top: data.top, left: data.left }}
      role="tooltip"
    >
      <div className="border-b border-border bg-muted/30 px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">{data.title}</p>
        {data.subtitle && <p className="mt-0.5 text-[10px] text-muted-foreground">{data.subtitle}</p>}
      </div>
      <div className="space-y-2 px-3 py-2.5">
        <div className="rounded-lg border border-primary/10 bg-primary/5 px-2 py-1.5 text-[10px] font-medium leading-relaxed text-foreground">
          {data.formula}
        </div>
        <div className="divide-y divide-border/60">
          {data.lines.map((line) => (
            <div key={`${line.label}-${line.value}`} className="flex items-start justify-between gap-3 py-1.5">
              <span className="text-[10px] text-muted-foreground">{line.label}</span>
              <span className={`text-right text-[11px] font-semibold tabular-nums ${formulaToneClass[line.tone ?? 'default']}`}>{line.value}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between rounded-lg bg-primary/5 px-2 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Kết quả</span>
          <span className="text-xs font-bold tabular-nums text-primary">{data.result}</span>
        </div>
        {data.note && <p className="text-[10px] leading-relaxed text-muted-foreground">{data.note}</p>}
      </div>
    </div>,
    document.body,
  );
}

function cellFormulaHandlers(
  formula: FormulaTooltipContent | undefined,
  onOpenFormula?: FormulaOpenHandler,
  onCloseFormula?: () => void,
) {
  if (!formula || !onOpenFormula || !onCloseFormula) return {};
  return {
    tabIndex: 0,
    'aria-label': `${formula.title}: ${formula.result}`,
    onMouseEnter: (event: MouseEvent<HTMLElement>) => onOpenFormula(event, formula),
    onMouseLeave: onCloseFormula,
    onFocus: (event: FocusEvent<HTMLElement>) => onOpenFormula(event, formula),
    onBlur: onCloseFormula,
  };
}

function PayrollMoneyCell({
  value,
  strong = false,
  tone = 'default',
  formula,
  formatter,
  onOpenFormula,
  onCloseFormula,
}: {
  value: number;
  strong?: boolean;
  tone?: 'default' | 'green' | 'red' | 'amber' | 'blue' | 'violet';
  formula?: FormulaTooltipContent;
  formatter?: (value: number) => string;
  onOpenFormula?: FormulaOpenHandler;
  onCloseFormula?: () => void;
}) {
  const toneClass = {
    default: 'text-foreground',
    green: 'text-emerald-600',
    red: 'text-rose-600',
    amber: 'text-amber-600',
    blue: 'text-blue-600',
    violet: 'text-violet-600',
  }[tone];

  return (
    <td
      className={`px-2 py-2 text-right text-[11px] tabular-nums whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${formula ? 'cursor-help underline decoration-dotted underline-offset-2' : ''} ${strong ? 'font-bold' : 'font-medium'} ${value === 0 ? 'text-muted-foreground' : toneClass}`}
      {...cellFormulaHandlers(formula, onOpenFormula, onCloseFormula)}
    >
      {value === 0 ? '—' : (formatter ? formatter(value) : fmtVND(Math.round(value)))}
    </td>
  );
}

function PayrollNumberCell({
  value,
  suffix = '',
  tone = 'default',
  formula,
  onOpenFormula,
  onCloseFormula,
}: {
  value: number;
  suffix?: string;
  tone?: 'default' | 'green' | 'red' | 'amber' | 'blue' | 'violet';
  formula?: FormulaTooltipContent;
  onOpenFormula?: FormulaOpenHandler;
  onCloseFormula?: () => void;
}) {
  const toneClass = {
    default: 'text-foreground',
    green: 'text-emerald-600',
    red: 'text-rose-600',
    amber: 'text-amber-600',
    blue: 'text-blue-600',
    violet: 'text-violet-600',
  }[tone];
  return (
    <td
      className={`px-2 py-2 text-right text-[11px] font-medium tabular-nums whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${formula ? 'cursor-help underline decoration-dotted underline-offset-2' : ''} ${value === 0 ? 'text-muted-foreground' : toneClass}`}
      {...cellFormulaHandlers(formula, onOpenFormula, onCloseFormula)}
    >
      {value === 0 ? '—' : fmtPayrollNumber(value, suffix)}
    </td>
  );
}

function PayrollTextCell({ children, sticky = false }: { children: ReactNode; sticky?: boolean }) {
  return (
    <td className={`px-2 py-2 text-[11px] text-foreground whitespace-nowrap ${sticky ? 'sticky left-0 z-10 bg-card' : ''}`}>
      {children || '—'}
    </td>
  );
}

type PayrollEditForm = {
  standardDays: string;
  actualDays: string;
  baseSalary: string;
  rank: string;
  technical: string;
  language: string;
  housing: string;
  transport: string;
  meal: string;
  phone: string;
  attendance: string;
  otTotalAmount: string;
  otHoursWeekday: string;
  otHoursWeekdayNight: string;
  otHoursWeekend: string;
  otHoursHoliday: string;
  otHoursUntilNight: string;
  otHoursNightNormal: string;
  otHoursNightWeekend: string;
  afterTaxAdjustment: string;
  note: string;
};

type PayrollOverridePayload = {
  standardDays?: number | null;
  actualDays?: number | null;
  baseSalary?: number | null;
  otTotalAmount?: number | null;
  afterTaxAdjustment?: number | null;
  allowances?: Record<string, number | null>;
  otHours?: Partial<Record<PayrollOtHourOverrideKey, number | null>>;
};

function buildPayrollEditForm(row: PayrollRow): PayrollEditForm {
  return {
    standardDays: fmtInputDecimal(row.standardDays),
    actualDays: fmtInputDecimal(row.actualDays),
    baseSalary: fmtInputMoney(row.baseSalary),
    rank: fmtInputMoney(row.allowRank),
    technical: fmtInputMoney(row.allowTechnical),
    language: fmtInputMoney(row.allowLanguage),
    housing: fmtInputMoney(row.allowHousing),
    transport: fmtInputMoney(row.allowTransport),
    meal: fmtInputMoney(row.allowMeal),
    phone: fmtInputMoney(row.allowPhone),
    attendance: fmtInputMoney(row.allowAttendance),
    otTotalAmount: fmtInputMoney(row.otAmount),
    otHoursWeekday: fmtInputDecimal(row.otHrsWeekday),
    otHoursWeekdayNight: fmtInputDecimal(row.otHrsWeekdayNight),
    otHoursWeekend: fmtInputDecimal(row.otHrsWeekend),
    otHoursHoliday: fmtInputDecimal(row.otHrsHoliday),
    otHoursUntilNight: fmtInputDecimal(row.otHrsUntilNight),
    otHoursNightNormal: fmtInputDecimal(row.otHrsNightNormal),
    otHoursNightWeekend: fmtInputDecimal(row.otHrsNightWeekend),
    afterTaxAdjustment: fmtInputMoney(row.afterTaxAdj),
    note: '',
  };
}

function parseEditNumber(value: string): number {
  const cleaned = value.replace(/[₫\s]/g, '').trim();
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  const normalized = hasComma && hasDot
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : hasComma
      ? cleaned.replace(',', '.')
      : /^-?\d{1,3}(\.\d{3})+$/.test(cleaned)
        ? cleaned.replace(/\./g, '')
        : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function changedNumber(current: string, initial: string): number | undefined {
  return current.trim() === initial.trim() ? undefined : parseEditNumber(current);
}

function countManualOverrides(overrides: PayrollManualOverrides): number {
  const simpleCount = ['standardDays', 'actualDays', 'baseSalary', 'otTotalAmount', 'afterTaxAdjustment']
    .filter((key) => (overrides as Record<string, unknown>)[key] !== undefined).length;
  const allowanceCount = Object.values(overrides.allowances ?? {}).filter((value) => value !== undefined).length;
  const otHourCount = Object.values(overrides.otHours ?? {}).filter((value) => value !== undefined).length;
  return simpleCount + allowanceCount + otHourCount;
}

function PayrollEditModal({
  row,
  saving,
  onClose,
  onSave,
}: {
  row: PayrollRow | null;
  saving: boolean;
  onClose: () => void;
  onSave: (row: PayrollRow, payload: { overrides: PayrollOverridePayload; note: string }) => Promise<void>;
}) {
  const [form, setForm] = useState<PayrollEditForm>(() => row ? buildPayrollEditForm(row) : buildPayrollEditForm({
    standardDays: 0, actualDays: 0, baseSalary: 0, allowRank: 0, allowTechnical: 0, allowLanguage: 0,
    allowHousing: 0, allowTransport: 0, allowMeal: 0, allowPhone: 0, allowAttendance: 0, otAmount: 0, afterTaxAdj: 0,
    otHrsWeekday: 0, otHrsWeekdayNight: 0, otHrsWeekend: 0, otHrsHoliday: 0, otHrsUntilNight: 0, otHrsNightNormal: 0, otHrsNightWeekend: 0,
  } as PayrollRow));
  const [initialForm, setInitialForm] = useState(form);

  const handleOpenChange = useCallback(() => {
    if (!row) return;
    const next = buildPayrollEditForm(row);
    setForm(next);
    setInitialForm(next);
  }, [row]);

  // Reset local form whenever a different payslip is opened.
  useEffect(handleOpenChange, [handleOpenChange]);

  if (!row) return null;

  const overrideCount = countManualOverrides(row.manualOverrides);
  const setField = (field: keyof PayrollEditForm, value: string) => setForm((prev) => ({ ...prev, [field]: value }));
  const formatField = (field: keyof PayrollEditForm, money?: boolean) => {
    const parsed = parseEditNumber(form[field]);
    setField(field, money ? fmtInputMoney(parsed) : fmtInputDecimal(parsed));
  };
  const inputClass = 'h-9 rounded-lg px-3 py-2 text-xs';
  const editableFields: Array<{ key: keyof PayrollEditForm; label: string; money?: boolean }> = [
    { key: 'standardDays', label: 'Ngày công chuẩn' },
    { key: 'actualDays', label: 'Ngày công thực tế' },
    { key: 'baseSalary', label: 'Lương cơ bản', money: true },
    { key: 'rank', label: 'Phụ cấp cấp bậc', money: true },
    { key: 'technical', label: 'Phụ cấp kỹ thuật', money: true },
    { key: 'language', label: 'Phụ cấp ngoại ngữ', money: true },
    { key: 'housing', label: 'Phụ cấp nhà ở', money: true },
    { key: 'transport', label: 'Phụ cấp đi lại', money: true },
    { key: 'meal', label: 'Phụ cấp ăn uống', money: true },
    { key: 'phone', label: 'Phụ cấp điện thoại', money: true },
    { key: 'attendance', label: 'Phụ cấp chuyên cần', money: true },
    { key: 'otTotalAmount', label: 'Tiền OT tính lương', money: true },
    { key: 'afterTaxAdjustment', label: 'Điều chỉnh sau thuế', money: true },
  ];
  const otHourFields: Array<{ key: keyof PayrollEditForm; payloadKey: PayrollOtHourOverrideKey; label: string }> = [
    { key: 'otHoursWeekday', payloadKey: 'weekday', label: 'Làm thêm giờ + làm thêm của ca đêm' },
    { key: 'otHoursWeekdayNight', payloadKey: 'weekdayNight', label: 'Làm thêm ca đêm của ngày thường' },
    { key: 'otHoursWeekend', payloadKey: 'weekend', label: 'Làm ngày nghỉ' },
    { key: 'otHoursHoliday', payloadKey: 'holiday', label: 'Làm ngày lễ' },
    { key: 'otHoursUntilNight', payloadKey: 'untilNight', label: 'Làm thêm đến đêm' },
    { key: 'otHoursNightNormal', payloadKey: 'nightNormal', label: 'Ca đêm thường' },
    { key: 'otHoursNightWeekend', payloadKey: 'nightWeekend', label: 'Ca đêm ngày nghỉ' },
  ];

  const submit = async () => {
    const overrides: PayrollOverridePayload = {};
    const allowances: Record<string, number | null> = {};
    const otHours: Partial<Record<PayrollOtHourOverrideKey, number | null>> = {};
    const simplePairs: Array<[keyof PayrollEditForm, keyof PayrollOverridePayload]> = [
      ['standardDays', 'standardDays'],
      ['actualDays', 'actualDays'],
      ['baseSalary', 'baseSalary'],
      ['otTotalAmount', 'otTotalAmount'],
      ['afterTaxAdjustment', 'afterTaxAdjustment'],
    ];

    simplePairs.forEach(([formKey, payloadKey]) => {
      const value = changedNumber(form[formKey], initialForm[formKey]);
      if (value !== undefined) {
        (overrides as Record<string, number | null | Record<string, number | null>>)[payloadKey] = value;
      }
    });

    ([
      ['rank', 'rank'],
      ['technical', 'technical'],
      ['language', 'language'],
      ['housing', 'housing'],
      ['transport', 'transport'],
      ['meal', 'meal'],
      ['phone', 'phone'],
      ['attendance', 'attendance'],
    ] as Array<[keyof PayrollEditForm, string]>).forEach(([formKey, allowanceKey]) => {
      const value = changedNumber(form[formKey], initialForm[formKey]);
      if (value !== undefined) allowances[allowanceKey] = value;
    });

    if (Object.keys(allowances).length > 0) overrides.allowances = allowances;
    otHourFields.forEach(({ key, payloadKey }) => {
      const value = changedNumber(form[key], initialForm[key]);
      if (value !== undefined) otHours[payloadKey] = value;
    });
    if (Object.keys(otHours).length > 0) overrides.otHours = otHours;
    await onSave(row, { overrides, note: form.note });
  };

  const clearOverrides = async () => {
    await onSave(row, {
      note: form.note || 'Gỡ chỉnh tay bảng lương',
      overrides: {
        standardDays: null,
        actualDays: null,
        baseSalary: null,
        otTotalAmount: null,
        afterTaxAdjustment: null,
        allowances: {
          rank: null,
          technical: null,
          language: null,
          housing: null,
          transport: null,
          meal: null,
          phone: null,
          attendance: null,
        },
        otHours: {
          weekday: null,
          weekdayNight: null,
          weekend: null,
          holiday: null,
          untilNight: null,
          nightNormal: null,
          nightWeekend: null,
        },
      },
    });
  };

  return (
    <Modal
      isOpen={!!row}
      onClose={onClose}
      title={`Chỉnh bảng lương - ${row.employeeCode}`}
      size="4xl"
      footer={(
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Đóng</Button>
          <Button variant="outline" size="sm" icon={RotateCcw} disabled={saving || overrideCount === 0} onClick={clearOverrides}>
            Gỡ chỉnh tay
          </Button>
          <Button variant="primary" size="sm" icon={Save} loading={saving} onClick={submit}>
            Lưu & tính lại
          </Button>
        </>
      )}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-3">
          <Avatar name={row.name} size="md" src={row.avatarUrl ?? undefined} />
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">{row.name}</p>
            <p className="text-xs text-muted-foreground">{row.department} · {row.position || 'Chưa cập nhật chức vụ'}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Net hiện tại</p>
            <p className="text-sm font-bold tabular-nums text-emerald-600">{fmtMoney(row.netSalary)}</p>
          </div>
        </div>

        <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-blue-800">
          Khi lưu, hệ thống giữ phần chỉnh tay trong phiếu lương rồi chạy lại công thức: lương tính công, gross, BH, PIT và lương thực nhận sẽ dùng số mới ngay.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {editableFields.map((field) => (
            <FormInput
              key={field.key}
              label={field.label}
              value={form[field.key]}
              money={field.money}
              inputMode="decimal"
              className={inputClass}
              onChange={(event) => setField(field.key, event.target.value)}
              onBlur={() => formatField(field.key, field.money)}
            />
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Giờ OT</p>
            <p className="text-[10px] font-medium text-muted-foreground">Đơn vị: giờ</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {otHourFields.map((field) => (
              <FormInput
                key={field.key}
                label={field.label}
                value={form[field.key]}
                inputMode="decimal"
                className={inputClass}
                onChange={(event) => setField(field.key, event.target.value)}
                onBlur={() => formatField(field.key)}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Ghi chú chỉnh sửa</label>
          <textarea
            value={form.note}
            onChange={(event) => setField('note', event.target.value)}
            placeholder="Ví dụ: điều chỉnh theo xác nhận C&B / quyết định lương tháng..."
            className="w-full min-h-[76px] rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between bg-muted/30 px-3 py-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Lịch sử chỉnh sửa</span>
            <span className="text-[11px] font-semibold text-primary">{overrideCount} override đang áp dụng</span>
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-border/60">
            {row.manualEditLogs.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">Chưa có log chỉnh tay cho phiếu lương này.</p>
            ) : row.manualEditLogs.map((log, index) => (
              <div key={`${log.at}-${index}`} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-foreground">{log.by || 'C&B'}</p>
                  <p className="text-[10px] text-muted-foreground">{formatDate(log.at)}</p>
                </div>
                {log.note && <p className="mt-1 text-[11px] text-muted-foreground">{log.note}</p>}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(log.changes ?? {}).map(([field, change]) => (
                    <span key={field} className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                      {PAYROLL_EDIT_FIELD_LABELS[field] ?? field}: {String(change.oldValue ?? 'gốc')} → {String(change.newValue ?? 'gốc')}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SalaryGroupHeader({ title, subtitle, colSpan, tone }: { title: string; subtitle: string; colSpan: number; tone: string }) {
  return (
    <th colSpan={colSpan} className={`border border-border px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider ${tone}`}>
      <div>{title}</div>
      <div className="text-[9px] font-medium normal-case opacity-80">{subtitle}</div>
    </th>
  );
}

function SalaryColumnHeader({ vi, en, className = '' }: { vi: string; en: string; className?: string }) {
  return (
    <th className={`border border-border px-2 py-2 text-center align-bottom text-[10px] font-semibold text-muted-foreground min-w-[96px] ${className}`}>
      <div className="leading-tight">{vi}</div>
      <div className="mt-1 text-[9px] font-normal leading-tight text-muted-foreground/80">{en}</div>
    </th>
  );
}

function bucketFormulaLines(row: PayrollRow, matcher?: (bucket: string) => boolean): FormulaLine[] {
  const entries = Object.entries(row.otBuckets)
    .filter(([bucket, detail]) => detail.hours > 0 && (!matcher || matcher(bucket)))
    .sort(([, a], [, b]) => b.amount - a.amount);

  if (entries.length === 0) {
    return [{ label: 'Bucket OT', value: 'Không có giờ được duyệt', tone: 'muted' }];
  }

  return entries.map(([bucket, detail]) => ({
    label: OT_BUCKET_LABELS[bucket] ?? bucket,
    value: `${fmtPayrollNumber(detail.hours, 'h')} → ${fmtMoney(detail.amount)}`,
    tone: 'violet',
  }));
}

function compLeaveOtFormulaLines(row: PayrollRow): FormulaLine[] {
  const entries = Object.entries(row.compLeaveOtBuckets)
    .filter(([, detail]) => detail.hours > 0)
    .sort(([, a], [, b]) => b.hours - a.hours);

  if (entries.length === 0) {
    return [];
  }

  return entries.map(([bucket, detail]) => ({
    label: `Nghỉ bù - ${OT_BUCKET_LABELS[bucket] ?? bucket}`,
    value: `${fmtPayrollNumber(detail.hours, 'h')} / không chi trả`,
    tone: 'amber',
  }));
}

function payrollFormulas(row: PayrollRow, monthlyIncome: number, actualAllowances: number, earlyLateHours: number): Record<string, FormulaTooltipContent> {
  const personalDeduction = row.employmentType === 'P' ? 0 : row.personalDeduction;
  const dependentDeduction = row.employmentType === 'P' ? 0 : row.dependents * row.dependentDeduction;
  const absentDeduction = row.absentDays > 0 ? Math.max(0, row.dailyRate * row.absentDays) : 0;
  const otComponentTotal = row.otAmtWeekday + row.otAmtWeekdayNight + row.otAmtWeekend + row.otAmtHoliday
    + row.otAmtUntilNight + row.otAmtNightNormal + row.otAmtNightWeekend;
  const earlyLateBeforeLeaveHours = row.lateHoursBeforeLeave + row.earlyHoursBeforeLeave;
  const lateEarlyLeaveDays = row.lateEarlyLeaveUsed || row.lateEarlyLeaveDeductedHours / 8;
  const leaveBeforeLateEarly = row.currentLeaveBalance + lateEarlyLeaveDays;
  const leaveUsedBeforeLateEarly = Math.max(row.leaveUsed - lateEarlyLeaveDays, 0);
  const netRaw = row.grossIncome - row.insurance - row.pit + row.afterTaxAdj;
  const otRateFormula = (title: string, multiplier: number, result: number): FormulaTooltipContent => {
    const displayMultiplier = String(multiplier).replace('.', ',');
    return {
      title,
      formula: `${title} = lương giờ đã làm tròn × ${displayMultiplier}`,
      lines: [
        { label: 'Lương giờ đã làm tròn', value: fmtMoney(row.hourlyRate), tone: 'blue' },
        { label: 'Hệ số', value: `${displayMultiplier}×`, tone: 'violet' },
      ],
      result: fmtMoney(result),
      note: 'Kết quả áp dụng cùng quy tắc làm tròn đến hàng chục như cột Lương giờ.',
    };
  };
  const pitLines = row.fullBreakdown?.pit?.bracketDetails?.length
    ? row.fullBreakdown.pit.bracketDetails.map((bracket) => ({
        label: `Bậc ${bracket.bracket} (${Math.round(bracket.rate * 100)}%)`,
        value: `${fmtMoney(bracket.taxableInBracket)} × ${Math.round(bracket.rate * 100)}% = ${fmtMoney(bracket.tax)}`,
        tone: 'red' as const,
      }))
    : [{ label: 'Thu nhập tính thuế', value: row.taxableIncome > 0 ? fmtMoney(row.taxableIncome) : 'Không phát sinh PIT', tone: row.taxableIncome > 0 ? 'red' as const : 'muted' as const }];

  return {
    monthlyIncome: {
      title: 'Tổng thu nhập hàng tháng',
      subtitle: 'Lương chính sách trước tính công',
      formula: 'Tổng thu nhập tháng = lương cơ bản + phụ cấp cố định trong chính sách lương',
      lines: [
        { label: 'Lương cơ bản', value: fmtMoney(row.baseSalary), tone: 'blue' },
        { label: 'Phụ cấp cấp bậc', value: fmtMoney(row.allowRank) },
        { label: 'Phụ cấp BPQL', value: fmtMoney(row.allowBpql), tone: row.allowBpql === 0 ? 'muted' : 'default' },
        { label: 'Phụ cấp kinh doanh', value: fmtMoney(row.allowSales), tone: row.allowSales === 0 ? 'muted' : 'default' },
        { label: 'Các phụ cấp khác', value: fmtMoney(row.allowTechnical + row.allowLanguage + row.allowHousing + row.allowTransport + row.allowMeal + row.allowPhone + row.allowAttendance) },
      ],
      result: fmtMoney(monthlyIncome),
      note: 'BPQL và kinh doanh đang được chuẩn hóa = 0 theo mapping payroll hiện tại.',
    },
    payrollSalary: {
      title: 'Lương tính công',
      subtitle: 'Quỹ lương dùng để chia ngày/giờ',
      formula: 'Lương tính công = lương cơ bản + phụ cấp cấp bậc',
      lines: [
        { label: 'Lương cơ bản', value: fmtMoney(row.baseSalary), tone: 'blue' },
        { label: 'Phụ cấp cấp bậc', value: fmtMoney(row.allowRank), tone: row.allowRank === 0 ? 'muted' : 'default' },
      ],
      result: fmtMoney(row.payrollSalary),
    },
    dailyRate: {
      title: 'Lương ngày',
      formula: 'Lương ngày = lương tính công / ngày công chuẩn',
      lines: [
        { label: 'Lương tính công', value: fmtMoney(row.payrollSalary), tone: 'blue' },
        { label: 'Ngày chuẩn', value: `${fmtPayrollNumber(row.standardDays)} ngày` },
      ],
      result: fmtMoney(row.dailyRate),
    },
    hourlyRate: {
      title: 'Lương giờ',
      formula: 'Lương giờ = lương ngày / 8 giờ',
      lines: [
        { label: 'Lương ngày', value: fmtMoney(row.dailyRate), tone: 'blue' },
        { label: 'Giờ chuẩn/ngày', value: '8h' },
      ],
      result: fmtMoney(row.hourlyRate),
    },
    overtimeRate: otRateFormula('Ngoài giờ', 1.5, row.overtimeRate),
    otRateWeekdayNight: otRateFormula('Làm thêm ca đêm của ngày thường', 2, row.otRateWeekdayNight),
    otRateWeekend: otRateFormula('Làm ngày nghỉ', 2, row.otRateWeekend),
    otRateHoliday: otRateFormula('Làm ngày lễ', 3, row.otRateHoliday),
    otRateUntilNight: otRateFormula('Làm thêm đến đêm', 2.1, row.otRateUntilNight),
    otRateNightNormal: otRateFormula('Ca đêm thường', 0.3, row.otRateNightNormal),
    otRateNightWeekend: otRateFormula('Ca đêm ngày nghỉ', 2.7, row.otRateNightWeekend),
    otHours: {
      title: 'Tổng số giờ OT',
      subtitle: 'Chỉ lấy phiếu OT có phát sinh tiền',
      formula: 'Giờ OT tính lương = tổng giờ đã duyệt trên phiếu OT thuộc chính sách chi trả; OT nghỉ bù chỉ dùng để đối soát công bù',
      lines: [
        ...bucketFormulaLines(row).map((line) => ({ ...line, value: (line.value.split('→')[0] ?? line.value).trim() })),
        ...compLeaveOtFormulaLines(row),
        { label: 'Tổng giờ OT trên phiếu duyệt', value: fmtHours(row.auditOtHours), tone: row.auditOtHours > row.otHours ? 'muted' : 'violet' },
      ],
      result: fmtHours(row.otHours),
      note: row.compLeaveOtHours > 0
        ? `Có ${fmtHours(row.compLeaveOtHours)} OT nghỉ bù: không đưa vào cột lương OT, ngày công chỉ được cộng khi có phiếu nghỉ bù/休日変更 được duyệt.`
        : 'validHours theo chấm công chỉ dùng audit, không dùng để tính lương OT.',
    },
    overtimeAndNightShiftHours: {
      title: 'Làm thêm giờ + làm thêm của ca đêm',
      subtitle: 'Bucket ngày thường 17h-22h',
      formula: 'Làm thêm giờ + làm thêm của ca đêm = tổng giờ bucket Ngày thường 時間外 17h~22h',
      lines: bucketFormulaLines(row, isWeekdayDayOtBucket)
        .map((line) => ({ ...line, value: (line.value.split('→')[0] ?? line.value).trim() })),
      result: fmtHours(row.otHrsWeekday),
    },
    weekdayNightHours: {
      title: 'Làm thêm ca đêm của ngày thường',
      subtitle: 'Bucket ngày thường 22h-6h',
      formula: 'Làm thêm ca đêm của ngày thường = giờ OT ban đêm 22h-6h, không kéo tiếp từ đoạn OT trước 22h',
      lines: bucketFormulaLines(row, isWeekdayNightOtBucket)
        .map((line) => ({ ...line, value: (line.value.split('→')[0] ?? line.value).trim() })),
      result: fmtHours(row.otHrsWeekdayNight),
    },
    untilNightHours: {
      title: 'Làm thêm đến đêm',
      subtitle: 'Bucket 22h-6h sau khi đã OT trước 22h',
      formula: 'Làm thêm đến đêm = giờ 22h-6h nhưng phiếu đã có OT từ trước 22h',
      lines: bucketFormulaLines(row, isUntilNightOtBucket)
        .map((line) => ({ ...line, value: (line.value.split('→')[0] ?? line.value).trim() })),
      result: fmtHours(row.otHrsUntilNight),
    },
    earlyLateBeforeLeave: {
      title: 'Về sớm/đi trễ (chưa trừ vào tồn phép)',
      formula: 'Về sớm/đi trễ trước phép = đi trễ sau làm tròn + về sớm sau làm tròn, trước khi bù bằng tồn phép năm',
      lines: [
        { label: 'Đi trễ sau làm tròn', value: fmtHours(row.lateHoursBeforeLeave), tone: row.lateHoursBeforeLeave > 0 ? 'amber' : 'muted' },
        { label: 'Về sớm sau làm tròn', value: fmtHours(row.earlyHoursBeforeLeave), tone: row.earlyHoursBeforeLeave > 0 ? 'amber' : 'muted' },
        { label: 'Đã trừ vào tồn phép năm', value: fmtHours(row.lateEarlyLeaveDeductedHours), tone: row.lateEarlyLeaveDeductedHours > 0 ? 'blue' : 'muted' },
      ],
      result: fmtHours(earlyLateBeforeLeaveHours),
      note: 'Quy tắc làm tròn trễ/sớm lấy từ Cài đặt > Chung > Cài đặt chung mặc định.',
    },
    leaveBalance: {
      title: 'Tồn phép năm',
      subtitle: 'Trước và sau khi trừ trễ/sớm',
      formula: 'Tồn phép năm sau trừ = tồn trước khi trừ trễ/sớm - phần trễ/sớm đã trừ vào phép',
      lines: [
        { label: 'Tồn tháng trước', value: fmtDays(row.prevLeaveBalance), tone: 'blue' },
        { label: 'Phép đã dùng trong kỳ (không gồm trễ/sớm)', value: fmtDays(leaveUsedBeforeLateEarly), tone: leaveUsedBeforeLateEarly > 0 ? 'violet' : 'muted' },
        { label: 'Tồn trước khi trừ trễ/sớm', value: fmtDays(leaveBeforeLateEarly), tone: 'blue' },
        { label: 'Đã trừ trễ/sớm vào phép', value: `-${fmtDays(lateEarlyLeaveDays)}`, tone: lateEarlyLeaveDays > 0 ? 'amber' : 'muted' },
      ],
      result: fmtDays(row.currentLeaveBalance),
      note: 'Trễ/sớm chỉ bù bằng phép đến khi tồn phép năm về 0; phần còn lại mới chuyển sang trừ lương.',
    },
    lateDeduction: {
      title: 'Trừ đi trễ/về sớm',
      formula: 'Khoản trừ trễ/sớm = số giờ còn lại sau khi bù tồn phép năm × đơn giá giờ tính lương',
      lines: [
        { label: 'Trễ/sớm trước phép', value: fmtHours(earlyLateBeforeLeaveHours), tone: earlyLateBeforeLeaveHours > 0 ? 'amber' : 'muted' },
        { label: 'Đã bù bằng tồn phép năm', value: `-${fmtHours(row.lateEarlyLeaveDeductedHours)}`, tone: row.lateEarlyLeaveDeductedHours > 0 ? 'blue' : 'muted' },
        { label: 'Đi trễ còn trừ lương', value: fmtHours(row.lateHours), tone: row.lateHours > 0 ? 'amber' : 'muted' },
        { label: 'Về sớm còn trừ lương', value: fmtHours(row.earlyHours), tone: row.earlyHours > 0 ? 'amber' : 'muted' },
        { label: 'Tổng còn trừ lương', value: fmtHours(earlyLateHours), tone: earlyLateHours > 0 ? 'amber' : 'muted' },
        { label: 'Lương giờ', value: fmtMoney(row.hourlyRate), tone: 'blue' },
      ],
      result: fmtMoney(row.lateDeduction),
    },
    otAmount: {
      title: 'Tiền OT + ca đêm',
      subtitle: 'Theo cột làm thêm giờ + làm thêm của ca đêm',
      formula: 'Tiền OT + ca đêm = Làm thêm giờ + làm thêm của ca đêm × Ngoài giờ',
      lines: [
        { label: 'Làm thêm giờ + làm thêm của ca đêm', value: fmtHours(row.otHrsWeekday), tone: row.otHrsWeekday > 0 ? 'violet' : 'muted' },
        { label: 'Ngoài giờ', value: fmtMoney(row.overtimeRate), tone: 'blue' },
      ],
      result: fmtMoney(row.otAmtWeekday),
    },
    otAmtWeekdayNight: {
      title: 'Tiền làm thêm vào ban đêm của ca ngày thường',
      subtitle: 'Theo cột Day-shift night OT',
      formula: 'Tiền làm thêm vào ban đêm của ca ngày thường = Làm thêm ca đêm của ngày thường × Làm thêm ca đêm của ngày thường (200%)',
      lines: [
        { label: 'Làm thêm ca đêm của ngày thường', value: fmtHours(row.otHrsWeekdayNight), tone: row.otHrsWeekdayNight > 0 ? 'violet' : 'muted' },
        { label: 'Làm thêm ca đêm của ngày thường (200%)', value: fmtMoney(row.otRateWeekdayNight), tone: 'blue' },
      ],
      result: fmtMoney(row.otAmtWeekdayNight),
    },
    otAmtWeekend: {
      title: 'Tiền ngày nghỉ',
      formula: 'Tiền ngày nghỉ = Làm ngày nghỉ × Làm ngày nghỉ',
      lines: [
        { label: 'Làm ngày nghỉ (giờ)', value: fmtHours(row.otHrsWeekend), tone: row.otHrsWeekend > 0 ? 'violet' : 'muted' },
        { label: 'Làm ngày nghỉ (đơn giá)', value: fmtMoney(row.otRateWeekend), tone: 'blue' },
      ],
      result: fmtMoney(row.otAmtWeekend),
    },
    otAmtHoliday: {
      title: 'Tiền ngày lễ',
      formula: 'Tiền ngày lễ = Làm ngày lễ × Làm ngày lễ',
      lines: [
        { label: 'Làm ngày lễ (giờ)', value: fmtHours(row.otHrsHoliday), tone: row.otHrsHoliday > 0 ? 'violet' : 'muted' },
        { label: 'Làm ngày lễ (đơn giá)', value: fmtMoney(row.otRateHoliday), tone: 'blue' },
      ],
      result: fmtMoney(row.otAmtHoliday),
    },
    otAmtUntilNight: {
      title: 'Tiền thêm đến đêm',
      formula: 'Tiền thêm đến đêm = Làm thêm đến đêm × Làm thêm đến đêm',
      lines: [
        { label: 'Làm thêm đến đêm (giờ)', value: fmtHours(row.otHrsUntilNight), tone: row.otHrsUntilNight > 0 ? 'violet' : 'muted' },
        { label: 'Làm thêm đến đêm (đơn giá)', value: fmtMoney(row.otRateUntilNight), tone: 'blue' },
      ],
      result: fmtMoney(row.otAmtUntilNight),
    },
    otAmtNightNormal: {
      title: 'Tiền ca đêm thường',
      formula: 'Tiền ca đêm thường = Ca đêm thường × Ca đêm thường',
      lines: [
        { label: 'Ca đêm thường (giờ)', value: fmtHours(row.otHrsNightNormal), tone: row.otHrsNightNormal > 0 ? 'violet' : 'muted' },
        { label: 'Ca đêm thường (đơn giá)', value: fmtMoney(row.otRateNightNormal), tone: 'blue' },
      ],
      result: fmtMoney(row.otAmtNightNormal),
    },
    otAmtNightWeekend: {
      title: 'Tiền ca đêm nghỉ',
      formula: 'Tiền ca đêm nghỉ = Ca đêm ngày nghỉ × Ca đêm ngày nghỉ',
      lines: [
        { label: 'Ca đêm ngày nghỉ (giờ)', value: fmtHours(row.otHrsNightWeekend), tone: row.otHrsNightWeekend > 0 ? 'violet' : 'muted' },
        { label: 'Ca đêm ngày nghỉ (đơn giá)', value: fmtMoney(row.otRateNightWeekend), tone: 'blue' },
      ],
      result: fmtMoney(row.otAmtNightWeekend),
    },
    actualAllowances: {
      title: 'Trợ cấp theo số ngày công',
      formula: 'Trợ cấp thực nhận = phụ cấp tháng × ngày công thực tế / ngày công chuẩn',
      lines: [
        { label: 'Tỷ lệ công', value: `${fmtDecimal(row.workRatio * 100)}%` },
        { label: 'Phụ cấp điện thoại theo công', value: fmtMoney(row.allowPhone * row.workRatio), tone: 'blue' },
        { label: 'Các phụ cấp khác theo công', value: fmtMoney(Math.max(actualAllowances - row.allowPhone * row.workRatio, 0)) },
      ],
      result: fmtMoney(actualAllowances),
      note: 'Theo template Payroll 4.2026, phụ cấp ăn uống/điện thoại và các phụ cấp cố định được quy đổi theo ngày công thực tế.',
    },
    grossIncome: {
      title: 'Tổng thu nhập',
      subtitle: 'Gross income',
      formula: 'Tổng thu nhập = lương cơ bản + phụ cấp cấp bậc - trừ vắng mặt - trừ đi trễ/về sớm + tiền chuyên cần + các khoản OT + trợ cấp theo công + cộng khác 1 + cộng khác 2',
      lines: [
        { label: 'Lương cơ bản + phụ cấp cấp bậc', value: fmtMoney(row.payrollSalary), tone: 'blue' },
        { label: 'Trừ vắng mặt', value: `-${fmtMoney(absentDeduction)}`, tone: absentDeduction > 0 ? 'red' : 'muted' },
        { label: 'Trừ trễ/sớm', value: `-${fmtMoney(row.lateDeduction)}`, tone: row.lateDeduction > 0 ? 'red' : 'muted' },
        { label: 'Tiền chuyên cần', value: fmtMoney(row.allowAttendance), tone: 'green' },
        { label: 'Tổng tiền OT theo cột', value: fmtMoney(otComponentTotal), tone: 'violet' },
        { label: 'Trợ cấp theo công', value: fmtMoney(actualAllowances), tone: 'blue' },
        { label: 'Cộng khác ① + ②', value: fmtMoney(0), tone: 'muted' },
      ],
      result: fmtMoney(row.grossIncome),
    },
    otTaxExempt: {
      title: 'OT miễn thuế',
      formula: 'OT miễn thuế = Tiền OT + ca đêm + Tiền làm thêm vào ban đêm của ca ngày thường + Tiền ngày nghỉ + Tiền ngày lễ + Tiền thêm đến đêm + Tiền ca đêm thường + Tiền ca đêm nghỉ',
      lines: [
        { label: 'Tiền OT + ca đêm', value: fmtMoney(row.otAmtWeekday), tone: 'violet' },
        { label: 'Tiền làm thêm vào ban đêm của ca ngày thường', value: fmtMoney(row.otAmtWeekdayNight), tone: 'violet' },
        { label: 'Tiền ngày nghỉ', value: fmtMoney(row.otAmtWeekend), tone: 'violet' },
        { label: 'Tiền ngày lễ', value: fmtMoney(row.otAmtHoliday), tone: 'violet' },
        { label: 'Tiền thêm đến đêm', value: fmtMoney(row.otAmtUntilNight), tone: 'violet' },
        { label: 'Tiền ca đêm thường', value: fmtMoney(row.otAmtNightNormal), tone: 'violet' },
        { label: 'Tiền ca đêm nghỉ', value: fmtMoney(row.otAmtNightWeekend), tone: 'violet' },
      ],
      result: fmtMoney(row.taxExemptOT),
    },
    totalTaxExempt: {
      title: 'Tổng thu nhập miễn thuế',
      formula: 'Tổng thu nhập miễn thuế = OT miễn thuế + ăn uống miễn thuế + điện thoại theo công',
      lines: [
        { label: 'OT miễn thuế', value: fmtMoney(row.taxExemptOT), tone: 'green' },
        { label: 'Phụ cấp ăn uống miễn thuế', value: fmtMoney(row.taxExemptMeal), tone: 'green' },
        { label: 'Phụ cấp điện thoại theo công', value: fmtMoney(row.taxExemptPhone), tone: 'green' },
      ],
      result: fmtMoney(row.totalTaxExempt),
      note: 'Ăn uống áp trần 930.000đ/tháng và prorate theo ngày công như template chuẩn.',
    },
    familyDeduction: {
      title: 'Giảm trừ gia cảnh',
      formula: 'Giảm trừ gia cảnh = mức giảm trừ cho bản thân người nộp thuế + số người phụ thuộc × giảm trừ người phụ thuộc',
      lines: [
        { label: 'Mức giảm trừ cho bản thân người nộp thuế', value: fmtMoney(personalDeduction), tone: 'blue' },
        { label: 'Số người phụ thuộc', value: fmtDecimal(row.dependents), tone: row.dependents > 0 ? 'blue' : 'muted' },
        { label: 'Giảm trừ người phụ thuộc', value: fmtMoney(row.dependentDeduction), tone: 'blue' },
        { label: 'Giảm trừ phụ thuộc', value: fmtMoney(dependentDeduction), tone: row.dependents > 0 ? 'blue' : 'muted' },
      ],
      result: fmtMoney(row.familyDeduction),
      note: row.employmentType === 'P'
        ? 'Nhân sự thử việc/part-time không áp dụng giảm trừ gia cảnh trong công thức PIT hiện tại.'
        : undefined,
    },
    insurance: {
      title: 'BHXH/BHYT/BHTN người lao động',
      formula: 'Lương đóng BHXH = min(nền đóng BH, trần BHXH); lương đóng BHTN = min(nền đóng BH, trần BHTN)',
      lines: [
        { label: 'Nền đóng BH', value: 'Lương cơ bản + cấp bậc + BPQL + kinh doanh + kỹ thuật + ngoại ngữ', tone: 'muted' },
        { label: 'Tổng nền đóng BH', value: fmtMoney(row.insuranceRawBasis), tone: 'blue' },
        { label: 'Mức trần lương đóng BHXH', value: fmtMoney(row.insuranceBhxhCap), tone: 'amber' },
        { label: 'Mức trần lương đóng BHTN', value: fmtMoney(row.insuranceBhtnCap), tone: 'amber' },
        { label: 'Lương đóng BHXH/BHYT', value: fmtMoney(row.insuranceBasis), tone: 'amber' },
        { label: 'Lương đóng BHTN', value: fmtMoney(row.insuranceBhtnBasis), tone: 'amber' },
        { label: 'BHXH người lao động (8%)', value: fmtMoney(row.empBhxh), tone: 'amber' },
        { label: 'BHYT người lao động (1.5%)', value: fmtMoney(row.empBhyt), tone: 'amber' },
        { label: 'BHTN người lao động (1%)', value: fmtMoney(row.empBhtn), tone: 'amber' },
      ],
      result: fmtMoney(row.insurance),
      note: 'Các phụ cấp nhà ở, đi lại, ăn uống, điện thoại và chuyên cần không nằm trong nền đóng BH theo công thức hiện tại.',
    },
    taxableIncome: {
      title: 'Thu nhập tính thuế',
      formula: 'Thu nhập tính thuế = tổng thu nhập - miễn thuế PIT - bảo hiểm NLĐ - giảm trừ gia cảnh',
      lines: [
        { label: 'Tổng thu nhập', value: fmtMoney(row.grossIncome), tone: 'blue' },
        { label: 'Tổng thu nhập miễn thuế', value: `-${fmtMoney(row.totalTaxExempt)}`, tone: 'green' },
        { label: 'Bảo hiểm người lao động', value: `-${fmtMoney(row.insurance)}`, tone: 'amber' },
        { label: 'Giảm trừ bản thân', value: `-${fmtMoney(personalDeduction)}`, tone: 'muted' },
        { label: 'Giảm trừ phụ thuộc', value: `-${fmtMoney(dependentDeduction)}`, tone: dependentDeduction > 0 ? 'muted' : 'default' },
      ],
      result: fmtMoney(row.taxableIncome),
    },
    pit: {
      title: 'Thuế TNCN',
      subtitle: 'Biểu thuế lũy tiến theo template Payroll 4.2026',
      formula: 'Thuế TNCN = thu nhập tính thuế áp theo bậc 5% / 10% / 20% / 30% / 35%',
      lines: pitLines,
      result: fmtMoney(row.pit),
    },
    netSalary: {
      title: 'Lương thực nhận',
      subtitle: 'Số tiền nhân sự nhận sau bảo hiểm và thuế',
      formula: 'Lương thực nhận = tổng thu nhập - bảo hiểm người lao động - thuế TNCN + điều chỉnh sau thuế',
      lines: [
        { label: 'Tổng thu nhập trong kỳ', value: fmtMoney(row.grossIncome), tone: 'blue' },
        { label: 'Khoản trừ bảo hiểm người lao động', value: `-${fmtMoney(row.insurance)}`, tone: 'amber' },
        { label: 'Thuế TNCN', value: `-${fmtMoney(row.pit)}`, tone: 'red' },
        { label: 'Điều chỉnh sau thuế', value: fmtMoney(row.afterTaxAdj), tone: row.afterTaxAdj === 0 ? 'muted' : 'green' },
        { label: 'Tạm tính trước làm tròn', value: fmtMoney(netRaw), tone: 'muted' },
      ],
      result: fmtMoney(row.netSalary),
      note: 'Kết quả làm tròn đến 100đ theo cột Lương thực nhận của template.',
    },
    insuranceEmployer: {
      title: 'Bảo hiểm công ty',
      formula: 'Chi phí bảo hiểm công ty = lương đóng BHXH/BHYT × 20.5% + lương đóng BHTN × 1%',
      lines: [
        { label: 'Tổng nền đóng BH trước trần', value: fmtMoney(row.insuranceRawBasis), tone: 'blue' },
        { label: 'Trần BHXH/BHYT', value: fmtMoney(row.insuranceBhxhCap), tone: 'amber' },
        { label: 'Trần BHTN', value: fmtMoney(row.insuranceBhtnCap), tone: 'amber' },
        { label: 'Lương đóng BHXH/BHYT', value: fmtMoney(row.insuranceBasis), tone: 'amber' },
        { label: 'Lương đóng BHTN', value: fmtMoney(row.insuranceBhtnBasis), tone: 'amber' },
        { label: 'BHXH công ty (17.5%)', value: fmtMoney(row.erBhxh), tone: 'amber' },
        { label: 'BHYT công ty (3%)', value: fmtMoney(row.erBhyt), tone: 'amber' },
        { label: 'BHTN công ty (1%)', value: fmtMoney(row.erBhtn), tone: 'amber' },
      ],
      result: fmtMoney(row.insuranceEmployer),
    },
    totalInsurance: {
      title: 'Tổng chi phí bảo hiểm',
      formula: 'Tổng chi phí bảo hiểm = phần người lao động + phần công ty',
      lines: [
        { label: 'Người lao động', value: fmtMoney(row.insurance), tone: 'amber' },
        { label: 'Công ty', value: fmtMoney(row.insuranceEmployer), tone: 'amber' },
      ],
      result: fmtMoney(row.totalInsurance),
    },
  };
}

function PayrollSalaryDetailRow({
  row,
  rowNumber,
  onOpenFormula,
  onCloseFormula,
  onEdit,
}: {
  row: PayrollRow;
  rowNumber: number;
  onOpenFormula: FormulaOpenHandler;
  onCloseFormula: () => void;
  onEdit: (row: PayrollRow) => void;
}) {
  const statusInfo = PAYSLIP_STATUS[row.status] ?? { label: row.status, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  const monthlyIncome = row.baseSalary + row.allowRank + row.allowBpql + row.allowSales + row.allowTechnical
    + row.allowLanguage + row.allowHousing + row.allowTransport + row.allowMeal + row.allowPhone + row.allowAttendance;
  const earlyLateHours = row.lateHours + row.earlyHours;
  const earlyLateBeforeLeaveHours = row.lateHoursBeforeLeave + row.earlyHoursBeforeLeave;
  const leaveDays = row.annualLeaveHours / 8;
  const actualAllowances = row.allowancesTotal;
  const otherTaxable = 0;
  const otherTaxFree = 0;
  const formula = payrollFormulas(row, monthlyIncome, actualAllowances, earlyLateHours);

  return (
    <tr className="border-b border-border/50 hover:bg-primary/[0.02]">
      <td className="sticky left-0 z-10 bg-card px-2 py-2 text-right text-[11px] text-muted-foreground tabular-nums min-w-[44px]">{rowNumber}.</td>
      <td className="sticky left-[44px] z-10 bg-card px-2 py-2 text-[11px] font-bold text-foreground tabular-nums min-w-[74px]">{row.employeeCode || 'ASV---'}</td>
      <td className="sticky left-[118px] z-10 bg-card px-2 py-2 min-w-[210px]">
        <div className="flex items-center gap-2">
          <Avatar name={row.name} size="sm" src={row.avatarUrl ?? undefined} />
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-foreground">{row.name}</p>
            <p className="truncate text-[10px] text-muted-foreground">{row.department}</p>
          </div>
        </div>
      </td>
      <PayrollTextCell>{row.position || '—'}</PayrollTextCell>
      <PayrollTextCell>{row.staffClassify || row.employmentType || '—'}</PayrollTextCell>
      <PayrollTextCell>{fmtPlainDate(row.joinDate)}</PayrollTextCell>

      <PayrollMoneyCell value={row.baseSalary} strong />
      <PayrollMoneyCell value={row.allowRank} />
      <PayrollMoneyCell value={row.allowBpql} />
      <PayrollMoneyCell value={row.allowSales} />
      <PayrollMoneyCell value={row.allowTechnical} />
      <PayrollMoneyCell value={row.allowLanguage} />
      <PayrollMoneyCell value={row.allowHousing} />
      <PayrollMoneyCell value={row.allowTransport} />
      <PayrollMoneyCell value={row.allowMeal} />
      <PayrollMoneyCell value={row.allowPhone} />
      <PayrollMoneyCell value={row.allowAttendance} />
      <PayrollMoneyCell value={monthlyIncome} strong tone="blue" formula={formula.monthlyIncome} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />

      <PayrollMoneyCell value={row.payrollSalary} strong formula={formula.payrollSalary} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.dailyRate} formula={formula.dailyRate} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.hourlyRate} formula={formula.hourlyRate} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.overtimeRate} tone="violet" formula={formula.overtimeRate} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.otRateWeekdayNight} tone="violet" formula={formula.otRateWeekdayNight} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.otRateWeekend} tone="violet" formula={formula.otRateWeekend} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.otRateHoliday} tone="violet" formula={formula.otRateHoliday} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.otRateUntilNight} tone="violet" formula={formula.otRateUntilNight} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.otRateNightNormal} tone="violet" formula={formula.otRateNightNormal} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.otRateNightWeekend} tone="violet" formula={formula.otRateNightWeekend} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollNumberCell value={row.dependents} />
      <PayrollNumberCell value={row.standardDays} />
      <PayrollNumberCell value={row.actualDays} tone={row.actualDays < row.standardDays ? 'amber' : 'green'} />
      <PayrollNumberCell value={leaveDays} />
      <PayrollNumberCell value={row.prevLeaveBalance} />
      <PayrollNumberCell value={row.currentLeaveBalance} tone={row.currentLeaveBalance > 0 ? 'green' : 'amber'} formula={formula.leaveBalance} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollNumberCell value={row.absentDays} tone="red" />
      <PayrollNumberCell value={earlyLateBeforeLeaveHours} suffix="h" tone="amber" formula={formula.earlyLateBeforeLeave} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollNumberCell value={earlyLateHours} suffix="h" tone="amber" formula={formula.lateDeduction} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollNumberCell value={row.otHours} suffix="h" tone="violet" formula={formula.otHours} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollNumberCell value={row.otHrsWeekday} suffix="h" tone="violet" formula={formula.overtimeAndNightShiftHours} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollNumberCell value={row.otHrsWeekdayNight} suffix="h" tone="violet" formula={formula.weekdayNightHours} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollNumberCell value={row.otHrsWeekend} suffix="h" tone="violet" />
      <PayrollNumberCell value={row.otHrsHoliday} suffix="h" tone="violet" />
      <PayrollNumberCell value={row.otHrsUntilNight} suffix="h" tone="violet" formula={formula.untilNightHours} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollNumberCell value={row.otHrsNightNormal} suffix="h" tone="violet" />
      <PayrollNumberCell value={row.otHrsNightWeekend} suffix="h" tone="violet" />
      <PayrollMoneyCell value={row.absentDays > 0 ? Math.max(0, row.dailyRate * row.absentDays) : 0} tone="red" />
      <PayrollMoneyCell value={row.lateDeduction} tone="red" formula={formula.lateDeduction} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.allowAttendance} tone="green" />
      <PayrollMoneyCell value={row.otAmtWeekday} tone="violet" formula={formula.otAmount} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.otAmtWeekdayNight} tone="violet" formula={formula.otAmtWeekdayNight} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.otAmtWeekend} tone="violet" formula={formula.otAmtWeekend} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.otAmtHoliday} tone="violet" formula={formula.otAmtHoliday} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.otAmtUntilNight} tone="violet" formula={formula.otAmtUntilNight} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.otAmtNightNormal} tone="violet" formula={formula.otAmtNightNormal} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.otAmtNightWeekend} tone="violet" formula={formula.otAmtNightWeekend} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={actualAllowances} tone="blue" formula={formula.actualAllowances} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={otherTaxable} />
      <PayrollMoneyCell value={otherTaxFree} />
      <PayrollMoneyCell value={row.grossIncome} strong tone="blue" formula={formula.grossIncome} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />

      <PayrollMoneyCell value={row.taxExemptOT} tone="green" formula={formula.otTaxExempt} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.taxExemptMeal} tone="green" />
      <PayrollMoneyCell value={row.taxExemptPhone} tone="green" />
      <PayrollMoneyCell value={row.totalTaxExempt} strong tone="green" formula={formula.totalTaxExempt} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />

      <PayrollMoneyCell value={row.insuranceBasis} tone="amber" formula={formula.insurance} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.insuranceBhtnBasis} tone="amber" formula={formula.insurance} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.empBhxh} tone="amber" />
      <PayrollMoneyCell value={row.empBhyt} tone="amber" />
      <PayrollMoneyCell value={row.empBhtn} tone="amber" />
      <PayrollMoneyCell value={row.insurance} strong tone="amber" formula={formula.insurance} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />

      <PayrollMoneyCell value={row.familyDeduction} formula={formula.familyDeduction} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.taxableIncome} formula={formula.taxableIncome} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.pit} strong tone="red" formula={formula.pit} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.afterTaxAdj} />
      <PayrollMoneyCell value={row.netSalary} strong tone="green" formula={formula.netSalary} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />

      <PayrollMoneyCell value={row.erBhxh} tone="amber" />
      <PayrollMoneyCell value={row.erBhyt} tone="amber" />
      <PayrollMoneyCell value={row.erBhtn} tone="amber" />
      <PayrollMoneyCell value={row.insuranceEmployer} strong tone="amber" formula={formula.insuranceEmployer} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <PayrollMoneyCell value={row.totalInsurance} strong tone="amber" formula={formula.totalInsurance} onOpenFormula={onOpenFormula} onCloseFormula={onCloseFormula} />
      <td className="px-2 py-2 text-center min-w-[80px]">
        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusInfo.cls}`}>
          {statusInfo.label}
        </span>
      </td>
      <td className="px-2 py-2 text-center min-w-[92px]">
        {row.isVirtualSegment ? (
          <span
            className="inline-flex max-w-[84px] flex-col items-center rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700"
            title={row.segmentDateRange ? `${row.segmentLabel ?? 'Tách dòng'}: ${row.segmentDateRange}` : row.segmentLabel ?? 'Tách dòng'}
          >
            <span>Tách dòng</span>
            {row.segmentLabel && <span className="truncate text-[9px] font-medium">{row.segmentLabel}</span>}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onEdit(row)}
            className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/5 px-2 py-1 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Pencil size={12} />
            Sửa
            {countManualOverrides(row.manualOverrides) > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] leading-none text-primary-foreground">
                {countManualOverrides(row.manualOverrides)}
              </span>
            )}
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Salary Tab — KPI summary + table ──────────────────────
function PayrollSalarySection({
  rows,
  loading,
  summary,
  activePeriodId,
  onSaveEdit,
  savingEdit,
}: {
  rows: PayrollRow[];
  loading: boolean;
  summary: PayrollSummary | undefined;
  activePeriodId: string;
  onSaveEdit: (row: PayrollRow, payload: { overrides: PayrollOverridePayload; note: string }) => Promise<void>;
  savingEdit: boolean;
}) {
  const totalNet = summary?.totalNet ?? rows.reduce((s, r) => s + r.netSalary, 0);
  const totalGross = rows.reduce((s, r) => s + r.grossIncome, 0);
  const totalIns = summary?.totalInsurance ?? rows.reduce((s, r) => s + r.insurance, 0);
  const totalPIT = summary?.totalPIT ?? rows.reduce((s, r) => s + r.pit, 0);
  const totalEmployees = rows.length;
  const totalOT = rows.reduce((s, r) => s + r.otHours, 0);
  const totalCompLeaveOT = rows.reduce((s, r) => s + r.compLeaveOtHours, 0);
  const totalOTAmt = rows.reduce((s, r) => s + payrollOtComponentAmount(r), 0);
  const avgNet = totalEmployees > 0 ? Math.round(totalNet / totalEmployees) : 0;
  const [formulaPopover, setFormulaPopover] = useState<FormulaPopoverState | null>(null);
  const [editingRow, setEditingRow] = useState<PayrollRow | null>(null);

  const showFormulaPopover = useCallback<FormulaOpenHandler>((event, formula) => {
    const width = 360;
    const { top, left } = getFloatingTooltipPosition(event, width, 300);

    setFormulaPopover({
      ...formula,
      top,
      left,
    });
  }, []);

  return (
    <>
      {/* ── Summary bar ── */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
        {[
          { icon: WalletCards, label: 'Tổng Net', value: `${fmtVND(totalNet)} ₫`, sub: `TB: ${fmtVND(avgNet)}₫`, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { icon: DollarSign, label: 'Tổng Gross', value: `${fmtVND(totalGross)} ₫`, sub: `${totalEmployees} nhân sự`, color: 'text-blue-600', bg: 'bg-blue-50' },
          { icon: Shield, label: 'Tổng BHXH (NLĐ)', value: `${fmtVND(totalIns)} ₫`, sub: `BH toàn phần: ${fmtVND(totalIns + rows.reduce((s,r)=>s+r.insuranceEmployer,0))}₫`, color: 'text-amber-600', bg: 'bg-amber-50' },
          { icon: Calculator, label: 'Thuế TNCN', value: `${fmtVND(totalPIT)} ₫`, sub: `OT tính lương: ${fmtHours(totalOT)} / ${fmtVND(totalOTAmt)}₫ · nghỉ bù ${fmtHours(totalCompLeaveOT)}`, color: 'text-rose-600', bg: 'bg-rose-50' },
        ].map(({ icon: Icon, label, value, sub, color, bg }) => (
          <motion.div key={label} variants={item}>
            <div className="bg-card border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow hover:border-primary/20">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center`}>
                  <Icon size={14} className={color} />
                </div>
              </div>
              <p className={`text-sm font-bold tabular-nums ${color}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* ── Table ── */}
      {!activePeriodId ? (
        <EmptyState icon={FileText} title="Chưa có kỳ lương" description="Tạo kỳ lương trong phần Cài đặt để bắt đầu tính lương." />
      ) : rows.length === 0 && !loading ? (
        <EmptyState icon={Calculator} title="Chưa có phiếu lương" description="Bấm Tính lương để tạo phiếu lương từ dữ liệu công, OT và chính sách hiện tại." />
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[7420px] text-sm">
              <thead>
                <tr className="bg-muted/40">
                  <SalaryGroupHeader title="THÔNG TIN CƠ BẢN" subtitle="Basic information" colSpan={6} tone="text-slate-700 bg-slate-50" />
                  <SalaryGroupHeader title="THU NHẬP HÀNG THÁNG" subtitle="Monthly income (gross)" colSpan={12} tone="text-blue-700 bg-blue-50" />
                  <SalaryGroupHeader title="TÍNH LƯƠNG" subtitle="Payroll calculation" colSpan={41} tone="text-violet-700 bg-violet-50" />
                  <SalaryGroupHeader title="THU NHẬP MIỄN THUẾ" subtitle="Tax exemption" colSpan={4} tone="text-emerald-700 bg-emerald-50" />
                  <SalaryGroupHeader title="BH NLĐ (10.5%)" subtitle="Employee insurance" colSpan={6} tone="text-amber-700 bg-amber-50" />
                  <SalaryGroupHeader title="THUẾ & LƯƠNG THỰC CHI" subtitle="PIT / Actual payment" colSpan={5} tone="text-rose-700 bg-rose-50" />
                  <SalaryGroupHeader title="BH CÔNG TY" subtitle="Company insurance allowance fee" colSpan={5} tone="text-orange-700 bg-orange-50" />
                  <SalaryGroupHeader title="TRẠNG THÁI" subtitle="Status" colSpan={2} tone="text-slate-700 bg-slate-50" />
                </tr>
                <tr className="bg-card border-b border-border">
                  <SalaryColumnHeader vi="STT" en="NO." className="sticky left-0 z-20 bg-card min-w-[44px]" />
                  <SalaryColumnHeader vi="Mã số NV" en="Staff code" className="sticky left-[44px] z-20 bg-card min-w-[74px]" />
                  <SalaryColumnHeader vi="Họ và tên" en="Name" className="sticky left-[118px] z-20 bg-card min-w-[210px]" />
                  <SalaryColumnHeader vi="Chức vụ" en="Position" />
                  <SalaryColumnHeader vi="Phân loại" en="Staff classify" />
                  <SalaryColumnHeader vi="Ngày vào cty" en="入社日" />

                  <SalaryColumnHeader vi="Lương cơ bản" en="Basic salary" />
                  <SalaryColumnHeader vi="Phụ cấp cấp bậc" en="Position allowance" />
                  <SalaryColumnHeader vi="Phụ cấp BPQL" en="Management dept" />
                  <SalaryColumnHeader vi="Phụ cấp kinh doanh" en="Sales team" />
                  <SalaryColumnHeader vi="Phụ cấp kỹ thuật" en="Technical" />
                  <SalaryColumnHeader vi="Phụ cấp ngoại ngữ" en="Foreign language" />
                  <SalaryColumnHeader vi="Phụ cấp nhà ở" en="Apartment" />
                  <SalaryColumnHeader vi="Phụ cấp đi lại" en="Commuting" />
                  <SalaryColumnHeader vi="Phụ cấp ăn uống" en="Meal" />
                  <SalaryColumnHeader vi="Phụ cấp điện thoại" en="Telephone" />
                  <SalaryColumnHeader vi="Phụ cấp chuyên cần" en="Attendance" />
                  <SalaryColumnHeader vi="Tổng thu nhập" en="Total income" />

                  <SalaryColumnHeader vi="Lương tính công" en="Wages for attendance" />
                  <SalaryColumnHeader vi="Lương ngày" en="Day-salary" />
                  <SalaryColumnHeader vi="Lương giờ" en="Hour-salary" />
                  <SalaryColumnHeader vi="Ngoài giờ" en="OT" />
                  <SalaryColumnHeader vi="Làm thêm ca đêm của ngày thường" en="Day-shift night OT 200%" />
                  <SalaryColumnHeader vi="Làm ngày nghỉ" en="W/D-off" />
                  <SalaryColumnHeader vi="Làm ngày lễ" en="W/Ho" />
                  <SalaryColumnHeader vi="Làm thêm đến đêm" en="Working until night" />
                  <SalaryColumnHeader vi="Ca đêm thường" en="Night normal day" />
                  <SalaryColumnHeader vi="Ca đêm ngày nghỉ" en="Night weekend" />
                  <SalaryColumnHeader vi="Người phụ thuộc" en="Dependents" />
                  <SalaryColumnHeader vi="Ngày chuẩn" en="Fixed work days" />
                  <SalaryColumnHeader vi="Ngày thực tế" en="Actual working days" />
                  <SalaryColumnHeader vi="Phép năm" en="Annual leave" />
                  <SalaryColumnHeader vi="Tồn tháng trước" en="前月残" />
                  <SalaryColumnHeader vi="Tồn phép năm" en="Annual leave remains" />
                  <SalaryColumnHeader vi="Vắng mặt" en="Abs" />
                  <SalaryColumnHeader vi="Về sớm/đi trễ (chưa trừ vào tồn phép)" en="Before annual leave offset" />
                  <SalaryColumnHeader vi="Về sớm/đi trễ" en="Early leave, late" />
                  <SalaryColumnHeader vi="Tổng số giờ OT" en="Total OT hours" />
                  <SalaryColumnHeader vi="Làm thêm giờ + làm thêm của ca đêm" en="OT + night-shift OT" />
                  <SalaryColumnHeader vi="Làm thêm ca đêm của ngày thường" en="Day-shift night OT" />
                  <SalaryColumnHeader vi="Làm ngày nghỉ" en="Working on day-off" />
                  <SalaryColumnHeader vi="Làm ngày lễ" en="Working on holiday" />
                  <SalaryColumnHeader vi="Làm thêm đến đêm" en="Working until night" />
                  <SalaryColumnHeader vi="Ca đêm thường" en="Night normal day" />
                  <SalaryColumnHeader vi="Ca đêm ngày nghỉ" en="Night weekend" />
                  <SalaryColumnHeader vi="Trừ vắng mặt" en="Abs deduction" />
                  <SalaryColumnHeader vi="Trừ đi trễ/về sớm" en="Late/early deduction" />
                  <SalaryColumnHeader vi="Tiền chuyên cần" en="Attendance allowance" />
                  <SalaryColumnHeader vi="Tiền OT + ca đêm" en="OT amount" />
                  <SalaryColumnHeader vi="Tiền làm thêm vào ban đêm của ca ngày thường" en="Day-shift night OT amount" />
                  <SalaryColumnHeader vi="Tiền ngày nghỉ" en="Day-off amount" />
                  <SalaryColumnHeader vi="Tiền ngày lễ" en="Holiday amount" />
                  <SalaryColumnHeader vi="Tiền thêm đến đêm" en="Until night amount" />
                  <SalaryColumnHeader vi="Tiền ca đêm thường" en="Night normal amount" />
                  <SalaryColumnHeader vi="Tiền ca đêm nghỉ" en="Night weekend amount" />
                  <SalaryColumnHeader vi="Trợ cấp theo công" en="Actual allowances" />
                  <SalaryColumnHeader vi="Cộng khác ①" en="Others" />
                  <SalaryColumnHeader vi="Cộng khác ②" en="Other tax-free" />
                  <SalaryColumnHeader vi="Tổng thu nhập" en="Total income" />

                  <SalaryColumnHeader vi="OT miễn thuế" en="O.W PIT exemption" />
                  <SalaryColumnHeader vi="Phụ cấp ăn uống" en="Meal allowance" />
                  <SalaryColumnHeader vi="Phụ cấp điện thoại" en="Telephone allowance" />
                  <SalaryColumnHeader vi="Tổng miễn thuế" en="Total tax exemption" />

                  <SalaryColumnHeader vi="Lương đóng BHXH/BHYT" en="Social/medical basis" />
                  <SalaryColumnHeader vi="Lương đóng BHTN" en="Unemployment basis" />
                  <SalaryColumnHeader vi="BHXH (8%)" en="Social insurance" />
                  <SalaryColumnHeader vi="BHYT (1.5%)" en="Medical insurance" />
                  <SalaryColumnHeader vi="BHTN (1%)" en="Unemployment" />
                  <SalaryColumnHeader vi="Tổng cộng" en="Total of ins" />

                  <SalaryColumnHeader vi="Giảm trừ gia cảnh" en="Personal + dependents deduction" />
                  <SalaryColumnHeader vi="Thu nhập tính thuế" en="Assessable income" />
                  <SalaryColumnHeader vi="Thuế TNCN" en="PIT" />
                  <SalaryColumnHeader vi="Điều chỉnh sau thuế" en="Adjustment after tax" />
                  <SalaryColumnHeader vi="Lương thực nhận" en="Net salary" />

                  <SalaryColumnHeader vi="BHXH (17.5%)" en="Social insurance" />
                  <SalaryColumnHeader vi="BHYT (3%)" en="Medical insurance" />
                  <SalaryColumnHeader vi="BHTN (1%)" en="Unemployment" />
                  <SalaryColumnHeader vi="Tổng cộng cty" en="Total company" />
                  <SalaryColumnHeader vi="Tổng cty + staff" en="Total company + staff" />
                  <SalaryColumnHeader vi="Trạng thái" en="Status" />
                  <SalaryColumnHeader vi="Thao tác" en="Edit" />
                </tr>
              </thead>
              {loading ? (
                <tbody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/40">
                      {Array.from({ length: 18 }).map((__, j) => (
                        <td key={j} className="px-3 py-3">
                          <div className="h-3 bg-muted/60 rounded animate-pulse" style={{ width: j === 1 ? 120 : 60 }} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ) : (() => {
                  const groups = groupPayrollRows(rows);
                  let rowNumber = 0;
                  return (
                    <tbody>
                      {groups.map((group) => (
                        <Fragment key={group.key}>
                          {/* Group header */}
                          <tr>
                            <td colSpan={81} className="bg-muted/60 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/60">
                              {group.label}
                            </td>
                          </tr>
                          {group.rows.map((row) => {
                            rowNumber += 1;
                            return (
                              <PayrollSalaryDetailRow
                                key={row.id}
                                row={row}
                                rowNumber={rowNumber}
                                onOpenFormula={showFormulaPopover}
                                onCloseFormula={() => setFormulaPopover(null)}
                                onEdit={setEditingRow}
                              />
                            );
                          })}
                        </Fragment>
                      ))}
                      {/* Totals row */}
                      <tr className="border-t-2 border-border bg-muted/30 font-bold">
                        <td className="sticky left-0 z-10 bg-muted px-3 py-2.5 text-right text-[11px] text-muted-foreground" colSpan={6}>
                          <span className="font-semibold text-foreground">TỔNG ({rows.length})</span>
                        </td>
                        <td colSpan={12} className="px-3 py-2.5 text-right text-xs tabular-nums text-blue-600">
                          Gross: {fmtVND(totalGross)}
                        </td>
                        <td colSpan={41} className="px-3 py-2.5 text-right text-xs tabular-nums text-violet-600">
                          OT tính lương: {fmtHours(totalOT)} / {fmtVND(totalOTAmt)} · Nghỉ bù: {fmtHours(totalCompLeaveOT)}
                        </td>
                        <td colSpan={10} className="px-3 py-2.5 text-right text-xs tabular-nums text-amber-600">
                          BH NLĐ: {fmtVND(totalIns)}
                        </td>
                        <td colSpan={5} className="px-3 py-2.5 text-right text-xs tabular-nums text-rose-600">
                          PIT: {fmtVND(totalPIT)}
                        </td>
                        <td colSpan={7} className="px-3 py-2.5 text-right text-sm tabular-nums text-emerald-700">
                          Net: {fmtVND(totalNet)}
                        </td>
                      </tr>
                    </tbody>
                  );
                })()}
            </table>
          </div>
          <div className="px-4 py-2 bg-muted/20 border-t border-border flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Bảng chi tiết theo template payroll: Basic information, Monthly income, Insurance and tax calculation, Actual payment.</span>
            <span className="text-[10px] text-muted-foreground ml-auto">Đơn vị: VND / giờ / ngày</span>
          </div>
          {formulaPopover && <FormulaTooltip data={formulaPopover} />}
          <PayrollEditModal
            row={editingRow}
            saving={savingEdit}
            onClose={() => setEditingRow(null)}
            onSave={async (row, payload) => {
              await onSaveEdit(row, payload);
              setEditingRow(null);
            }}
          />
        </div>
      )}
    </>
  );
}

function getTimesheetGroupKey(department: string): string {
  if (department === 'BOD') return 'expats';
  if (department.includes('TTVT') || department.includes('機材')) return 'equipment';
  if (department.includes('BPQL') || department.includes('PKD')) return 'indirect';
  return 'other';
}

function groupTimesheetRows(rows: TimesheetRow[]): TimesheetGroup[] {
  const grouped = rows.reduce<Record<string, TimesheetRow[]>>((acc, row) => {
    const key = row.groupKey || getTimesheetGroupKey(row.department);
    acc[key] = [...(acc[key] ?? []), row];
    return acc;
  }, {});

  return TIMESHEET_GROUP_ORDER
    .filter((key) => (grouped[key]?.length ?? 0) > 0)
    .map((key) => ({
      key,
      label: TIMESHEET_GROUP_LABELS[key] ?? key,
      rows: [...(grouped[key] ?? [])].sort((a, b) => a.sortIndex - b.sortIndex),
    }));
}



// ── Leave breakdown tooltip — hover to see phép by type ──────────
function LeaveBreakdownTooltip({
  row,
  anchorEl,
}: {
  row: TimesheetRow;
  anchorEl: HTMLElement | null;
}) {
  if (!anchorEl) return null;
  const rect = anchorEl.getBoundingClientRect();
  const tipW = 260;
  let left = rect.left + rect.width / 2 - tipW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
  const spaceBelow = window.innerHeight - rect.bottom;
  const top = spaceBelow < 140 ? rect.top - 148 : rect.bottom + 6;

  const annualDays = row.annualLeaveHours / 8;
  const benefitDays = row.benefitLeaveHours / 8;
  const compDays = row.compLeaveHours / 8;
  const remoteDays = row.remoteHours / 8;
  const correctionDays = row.correctionHours / 8;
  const lateEarlyDays = row.lateEarlyLeaveUsed || row.lateEarlyLeaveDeductedHours / 8;

  const items = [
    annualDays > 0   && { label: 'Phép năm',      days: annualDays,    color: 'text-violet-700 bg-violet-50 border-violet-200' },
    lateEarlyDays > 0 && { label: 'Bù trễ/sớm',    days: lateEarlyDays, color: 'text-amber-700 bg-amber-50 border-amber-200' },
    benefitDays > 0  && { label: 'Phép chế độ',   days: benefitDays,   color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    compDays > 0     && { label: 'Nghỉ bù (Comp)', days: compDays,    color: 'text-orange-700 bg-orange-50 border-orange-200' },
    remoteDays > 0   && { label: 'Remote',          days: remoteDays,   color: 'text-blue-700 bg-blue-50 border-blue-200' },
    correctionDays > 0 && { label: 'Bổ sung công',  days: correctionDays, color: 'text-cyan-700 bg-cyan-50 border-cyan-200' },
  ].filter(Boolean) as { label: string; days: number; color: string }[];

  return createPortal(
    <div className="pointer-events-none fixed z-[9999]" style={{ left, top, width: tipW }}>
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
        <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Chi tiết phép dùng</span>
          <span className="text-[11px] font-bold text-violet-700">{fmtDays(row.leaveUsed)}</span>
        </div>
        <div className="divide-y divide-gray-100">
          {items.length === 0 ? (
            <p className="px-3 py-2.5 text-[11px] text-gray-400">Không có phép trong kỳ này.</p>
          ) : items.map((it) => (
            <div key={it.label} className="flex items-center justify-between px-3 py-2">
              <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${it.color}`}>{it.label}</span>
              <span className="text-[11px] font-bold text-gray-800 tabular-nums">{fmtDays(it.days)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}


function summarizeOtBuckets(rows: TimesheetRow[]): Record<string, OtBucket> {
  return rows.reduce<Record<string, OtBucket>>((acc, row) => {
    // Use approved OT buckets (realtime from ApprovalRecord) for summary
    Object.entries(row.approvedOtBuckets).forEach(([bucket, hours]) => {
      const current = acc[bucket] ?? { hours: 0, amount: 0 };
      acc[bucket] = { hours: current.hours + hours, amount: 0 };
    });
    return acc;
  }, {});
}


function OtSegmentsPanel({ totalHours, buckets }: { totalHours: number; buckets: Record<string, OtBucket> }) {
  const segments = Object.entries(buckets)
    .filter(([, d]) => d.hours > 0)
    .sort(([, a], [, b]) => b.hours - a.hours);

  return (
    <div className="w-[360px] rounded-xl border border-border bg-popover shadow-2xl text-left overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">OT theo mốc giờ</span>
        <span className="text-sm font-bold text-violet-700 tabular-nums">{fmtHours(totalHours)}</span>
      </div>
      {/* Rows */}
      <div className="divide-y divide-border/50">
        {segments.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">Không có OT trong kỳ này.</p>
        ) : (
          segments.map(([bucket, detail]) => {
            const label = OT_BUCKET_LABELS[bucket] ?? bucket;
            const colorCls = otBucketColor(bucket);
            return (
              <div key={bucket} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  {/* Bucket badge — same style as Approvals page */}
                  <span className={`shrink-0 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold leading-none whitespace-nowrap ${colorCls}`}>
                    {bucket}
                  </span>
                  <span className="text-[11px] text-muted-foreground leading-snug" title={label}>{label}</span>
                </div>
                <span className="shrink-0 text-xs font-bold tabular-nums text-foreground">{fmtHours(detail.hours)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function OtTotalButton({
  totalHours,
  totalAmount,
  buckets,
  compact = false,
  onOpen,
  onClose,
}: {
  totalHours: number;
  totalAmount: number;
  buckets: Record<string, OtBucket>;
  compact?: boolean;
  onOpen: (event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>, payload: Pick<OtPopoverState, 'totalHours' | 'totalAmount' | 'buckets'>) => void;
  onClose: () => void;
}) {
  const payload = { totalHours, totalAmount, buckets };

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-end gap-1.5 rounded-lg border border-violet-100 bg-violet-50 px-2 py-1 font-semibold text-violet-700 tabular-nums shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${compact ? 'text-[11px]' : 'text-xs'}`}
      aria-label={`Tổng giờ OT ${fmtHours(totalHours)}`}
      onMouseEnter={(event) => onOpen(event, payload)}
      onMouseLeave={onClose}
      onFocus={(event) => onOpen(event, payload)}
      onBlur={onClose}
    >
      <TimerReset size={13} />
      {fmtHours(totalHours)}
    </button>
  );
}



// ── TimesheetDataRow — each employee row in the payroll timesheet ──────────
function TimesheetDataRow({
  row, rowNumber, onOpenOt, onCloseOt,
}: {
  row: TimesheetRow;
  rowNumber: number;
  onOpenOt: (event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>, payload: Pick<OtPopoverState, 'totalHours' | 'totalAmount' | 'buckets'>) => void;
  onCloseOt: () => void;
}) {
  const leaveCellRef = useRef<HTMLTableCellElement>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showLeaveTip, setShowLeaveTip] = useState(false);

  const onLeaveEnter = useCallback(() => {
    leaveTimerRef.current = setTimeout(() => setShowLeaveTip(true), 180);
  }, []);

  const onLeaveLeave = useCallback(() => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    setShowLeaveTip(false);
  }, []);

  // Compute total late+early in minutes for display
  const lateMin = Math.round(row.lateHours * 60);
  const earlyMin = Math.round(row.earlyHours * 60);
  const lateBeforeMin = Math.round(row.lateHoursBeforeLeave * 60);
  const earlyBeforeMin = Math.round(row.earlyHoursBeforeLeave * 60);
  const leaveOffsetMin = Math.round(row.lateEarlyLeaveDeductedHours * 60);
  const fmtMinutes = (m: number) => m >= 60 ? `${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}p` : `${m}p`;
  const beforeLeaveMin = lateBeforeMin + earlyBeforeMin;
  const netLateEarlyMin = lateMin + earlyMin;

  // Determine if absent days are "real" (not covered by leave)
  const realAbsent = Math.max(0, row.absentDays);

  return (
    <tr className="border-b border-border/40 hover:bg-muted/20 transition-colors group">
      {/* # */}
      <td className="px-3 py-2 text-right text-[11px] text-muted-foreground tabular-nums">{rowNumber}.</td>

      {/* Nhân sự */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar name={row.name} size="sm" src={row.avatarUrl ?? undefined} />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground leading-tight">{row.name}</p>
            <p className="truncate text-[10px] text-muted-foreground leading-tight">{row.employeeCode}</p>
          </div>
        </div>
      </td>

      {/* Kỳ lương */}
      <td className="px-3 py-2">
        <p className="text-xs font-medium text-foreground truncate">{row.period.label}</p>
        <p className="text-[10px] text-muted-foreground">
          {formatDate(row.period.periodStart).slice(0, 5)} – {formatDate(row.period.periodEnd).slice(0, 5)}
        </p>
      </td>

      {/* Chuẩn = standardDays */}
      <td className="px-3 py-2 text-right">
        <span className="text-xs font-semibold tabular-nums text-foreground">{fmtDays(row.standardDays)}</span>
      </td>

      {/* Thực tế = actualDays + workHours */}
      <td className="px-3 py-2 text-right">
        <p className={`text-xs font-semibold tabular-nums ${row.actualDays < row.standardDays ? 'text-amber-600' : 'text-foreground'}`}>
          {fmtDays(row.actualDays)}
        </p>
        <p className="text-[10px] text-muted-foreground tabular-nums">{fmtHours(row.workHours)}</p>
      </td>

      {/* Trễ / Sớm — phân tách hai giá trị, hiện số phút */}
      <td className="px-3 py-2 text-right">
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-1 text-[11px] tabular-nums">
            <span className="text-[9px] font-medium text-gray-400 uppercase tracking-wide">Trễ</span>
            <span className={lateMin > 0 ? 'font-bold text-amber-600' : 'text-muted-foreground'}>
              {lateMin > 0 ? fmtMinutes(lateMin) : '—'}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[11px] tabular-nums">
            <span className="text-[9px] font-medium text-gray-400 uppercase tracking-wide">Sớm</span>
            <span className={earlyMin > 0 ? 'font-bold text-amber-600' : 'text-muted-foreground'}>
              {earlyMin > 0 ? fmtMinutes(earlyMin) : '—'}
            </span>
          </div>
          {(beforeLeaveMin > netLateEarlyMin || leaveOffsetMin > 0) && (
            <div className="flex items-center gap-1 text-[10px] tabular-nums">
              <span className="text-[9px] font-medium text-gray-400 uppercase tracking-wide">Trước phép</span>
              <span className="font-semibold text-amber-700">{beforeLeaveMin > 0 ? fmtMinutes(beforeLeaveMin) : '—'}</span>
              {leaveOffsetMin > 0 && <span className="text-blue-600">(-{fmtMinutes(leaveOffsetMin)})</span>}
            </div>
          )}
        </div>
      </td>

      {/* Phép dùng — hover to see breakdown */}
      <td ref={leaveCellRef} className="px-3 py-2 text-right relative cursor-default"
        onMouseEnter={onLeaveEnter}
        onMouseLeave={onLeaveLeave}
      >
        {row.leaveUsed > 0 ? (
          <>
            <span className="text-xs font-semibold tabular-nums text-violet-700 underline decoration-dotted underline-offset-2">
              {fmtDays(row.leaveUsed)}
            </span>
            {showLeaveTip && (
              <LeaveBreakdownTooltip row={row} anchorEl={leaveCellRef.current} />
            )}
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground">—</span>
        )}
      </td>

      {/* Phép còn */}
      <td className="px-3 py-2 text-right">
        {row.leaveRemaining > 0 ? (
          <span className="text-xs font-semibold tabular-nums text-emerald-600">
            {fmtDays(row.leaveRemaining)}
          </span>
        ) : row.leaveRemaining < 0 ? (
          <span className="text-xs font-bold tabular-nums text-rose-600">
            {fmtDays(row.leaveRemaining)}
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-amber-600">Hết phép</span>
        )}
      </td>

      {/* OT (h) — hiển tổng giờ từ phiếu phê duyệt */}
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {row.overMonthlyLimit && <AlertTriangle size={12} className="text-amber-500" />}
          {row.approvedOtHours > 0 ? (
            <OtTotalButton
              totalHours={row.approvedOtHours}
              totalAmount={row.otAmount}
              buckets={Object.fromEntries(
                Object.entries(row.approvedOtBuckets).map(([k, h]) => [k, { hours: h, amount: 0 }])
              )}
              compact
              onOpen={onOpenOt}
              onClose={onCloseOt}
            />
          ) : (
            <span className="text-[11px] text-muted-foreground">—</span>
          )}
        </div>
      </td>

      {/* Vắng */}
      <td className="px-3 py-2 text-right">
        {realAbsent > 0 ? (
          <span className="text-xs font-bold tabular-nums text-rose-600">
            {fmtDays(realAbsent)}
          </span>
        ) : (
          <span className="text-[11px] text-emerald-600 font-semibold">✓</span>
        )}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────
function TimesheetSelfCheckTable({
  groups,
  loading,
  onOpenOt,
  onCloseOt,
}: {
  groups: TimesheetGroup[];
  loading: boolean;
  onOpenOt: (event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>, payload: Pick<OtPopoverState, 'totalHours' | 'totalAmount' | 'buckets'>) => void;
  onCloseOt: () => void;
}) {
  let rowNumber = 0;

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="animate-pulse">
          <div className="h-10 bg-muted/30 border-b border-border" />
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-14 border-b border-border/50 flex items-center px-4 gap-4">
              <div className="h-8 w-8 bg-muted rounded-full" />
              <div className="h-3 bg-muted rounded w-40" />
              <div className="h-3 bg-muted rounded w-24" />
              <div className="h-3 bg-muted rounded w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="animate-pulse">
          <div className="h-10 bg-muted/30 border-b border-border" />
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-12 border-b border-border/50 flex items-center px-4 gap-4">
              <div className="h-7 w-7 bg-muted rounded-full" />
              <div className="h-3 bg-muted rounded w-36" />
              <div className="h-3 bg-muted rounded w-20 ml-auto" />
              <div className="h-3 bg-muted rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border">
              <th className="w-[52px] px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">#</th>
              <th className="w-[200px] px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Nhân sự</th>
              <th className="w-[140px] px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Kỳ lương</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Chuẩn</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Thực tế</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Trễ / Sớm</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Phép dùng</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Phép còn</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">OT (h)</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Vắng</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.key}>
                {/* Group header row */}
                <tr>
                  <td colSpan={10} className="bg-muted/60 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/60">
                    {group.label}
                  </td>
                </tr>
                {group.rows.map((row) => {
                  rowNumber += 1;
                  return (
                    <TimesheetDataRow
                      key={row.id}
                      row={row}
                      rowNumber={rowNumber}
                      onOpenOt={onOpenOt}
                      onCloseOt={onCloseOt}
                    />
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusChip({ label, tone = 'slate' }: { label: string; tone?: 'slate' | 'green' | 'blue' | 'amber' | 'red' | 'violet' }) {
  const cls = {
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-rose-200 bg-rose-50 text-rose-700',
    violet: 'border-violet-200 bg-violet-50 text-violet-700',
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
}

function PayslipInfoCard({
  title,
  rows,
  columns = 1,
}: {
  title: string;
  rows: Array<{ label: string; sub?: string; value: string; tone?: string }>;
  columns?: 1 | 2;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wider text-foreground">{title}</p>
      </div>
      <div className={`grid ${columns === 2 ? 'md:grid-cols-2' : ''} divide-y divide-border/60 md:divide-y-0`}>
        {rows.map((item) => (
          <div key={`${title}-${item.label}`} className="flex items-start justify-between gap-3 border-border/60 px-4 py-2.5 md:border-b">
            <span className="min-w-0 text-xs text-muted-foreground">
              <span className="block font-medium text-foreground/80">{item.label}</span>
              {item.sub && <span className="block text-[10px] text-muted-foreground">{item.sub}</span>}
            </span>
            <span className={`shrink-0 text-right text-sm font-bold tabular-nums ${item.tone ?? 'text-foreground'}`}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function payslipBaseForRow(row: PayrollRow, monthKey: string | undefined, bySource: Map<string, PayslipBaseRecord>, byCode: Map<string, PayslipBaseRecord>) {
  return bySource.get(sourceIdForPayslip(row, monthKey)) ?? byCode.get(row.employeeCode);
}

function PdfPreviewModal({
  html,
  title,
  onClose,
}: {
  html: string | null;
  title: string;
  onClose: () => void;
}) {
  if (!html) return null;
  return (
    <Modal
      isOpen={!!html}
      onClose={onClose}
      title={title}
      size="5xl"
      footer={<Button variant="ghost" size="sm" onClick={onClose}>Đóng preview</Button>}
    >
      <div className="overflow-hidden rounded-xl border border-border bg-muted/30">
        <iframe
          title={title}
          srcDoc={html}
          className="h-[76vh] w-full bg-white"
          sandbox="allow-same-origin"
        />
      </div>
    </Modal>
  );
}

function PayslipDetailModal({
  row,
  larkRecord,
  period,
  onClose,
  onGeneratePdf,
  onPreviewPdf,
  onSaveHrNote,
  generatingPdf,
  previewingPdf,
  savingHrNote,
}: {
  row: PayrollRow | null;
  larkRecord?: PayslipBaseRecord;
  period?: PayrollPeriod;
  onClose: () => void;
  onGeneratePdf: (row: PayrollRow, note?: PayslipHrNote) => void;
  onPreviewPdf: (row: PayrollRow, note?: PayslipHrNote) => Promise<string>;
  onSaveHrNote: (row: PayrollRow, note: PayslipHrNote) => Promise<void>;
  generatingPdf: boolean;
  previewingPdf: boolean;
  savingHrNote: boolean;
}) {
  const [hrText, setHrText] = useState('');
  const [hrAttachments, setHrAttachments] = useState<PayslipHrAttachment[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    setHrText(row?.payslipHrNote?.text ?? larkRecord?.hrNote ?? '');
    setHrAttachments(row?.payslipHrNote?.attachments ?? []);
  }, [row?.id, row?.payslipHrNote, larkRecord?.hrNote]);

  if (!row) return null;

  const handleUploadImages = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const next = await Promise.all(Array.from(files).map(readImageAsPayslipAttachment));
      setHrAttachments((current) => [...current, ...next].slice(0, 4));
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Không đọc được ảnh ghi chú HR');
    }
  };

  const status = PAYSLIP_STATUS[row.status] ?? { label: row.status, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  const pdfAttachment = larkRecord?.pdfAttachments[0];
  const otRows = Object.entries(row.otBuckets).filter(([, value]) => value.hours > 0 || value.amount > 0);
  const totalLateEarlyHours = row.lateHours + row.earlyHours;
  const totalLateEarlyBeforeLeaveHours = row.lateHoursBeforeLeave + row.earlyHoursBeforeLeave;
  const totalLeaveHours = row.annualLeaveHours + row.benefitLeaveHours + row.compLeaveHours;
  const periodRange = row.segmentDateRange || period?.label || 'Kỳ lương hiện tại';
  const basicRows = [
    { label: 'Mã nhân sự', sub: 'Staff code', value: row.employeeCode },
    { label: 'Họ và tên', sub: 'Name', value: row.name },
    { label: 'Phòng ban', sub: 'Department', value: row.department },
    { label: 'Chức vụ', sub: 'Position', value: row.position || 'Chưa cập nhật' },
    { label: 'Phân loại', sub: 'Staff classify', value: row.staffClassify },
    { label: 'Ngày vào công ty', sub: 'Join date', value: fmtPlainDate(row.joinDate) },
  ];
  const workRecordRows = [
    { label: 'Kỳ lương', sub: 'Payment period', value: larkRecord?.payrollWindow || period?.label || 'Kỳ hiện tại' },
    { label: 'Thời gian làm việc', sub: 'Work period', value: periodRange },
    { label: 'Số ngày chuẩn/tháng', sub: 'Fixed work days', value: fmtDays(row.standardDays) },
    { label: 'Số ngày làm việc thực tế', sub: 'Actual work days', value: fmtDays(row.actualDays), tone: row.actualDays < row.standardDays ? 'text-orange-600' : 'text-emerald-700' },
    { label: 'Giờ công thực tế', sub: 'Work hours', value: fmtHours(row.workHours) },
    { label: 'Vắng mặt', sub: 'Absence', value: fmtDays(row.absentDays), tone: row.absentDays > 0 ? 'text-rose-600' : 'text-foreground' },
    { label: 'Trễ/Về sớm trước phép', sub: 'Before annual leave offset', value: fmtHours(totalLateEarlyBeforeLeaveHours), tone: totalLateEarlyBeforeLeaveHours > 0 ? 'text-orange-600' : 'text-foreground' },
    { label: 'Đã bù bằng phép năm', sub: 'Annual leave offset', value: fmtHours(row.lateEarlyLeaveDeductedHours), tone: row.lateEarlyLeaveDeductedHours > 0 ? 'text-blue-600' : 'text-foreground' },
    { label: 'Đi trễ còn trừ lương', sub: 'Late after offset', value: fmtHours(row.lateHours), tone: row.lateHours > 0 ? 'text-orange-600' : 'text-foreground' },
    { label: 'Về sớm còn trừ lương', sub: 'Early leave after offset', value: fmtHours(row.earlyHours), tone: row.earlyHours > 0 ? 'text-orange-600' : 'text-foreground' },
    { label: 'Trễ/Về sớm còn trừ lương', sub: 'Early leave + late', value: fmtHours(totalLateEarlyHours), tone: totalLateEarlyHours > 0 ? 'text-orange-600' : 'text-foreground' },
    { label: 'OT tính lương', sub: 'Overtime work allowance', value: `${fmtHours(row.otHours)} / ${fmtMoney(payrollOtComponentAmount(row))}`, tone: row.otHours > 0 ? 'text-violet-700' : 'text-foreground' },
  ];
  const leaveRows = [
    { label: 'Tồn tháng trước', sub: 'Opening', value: fmtDays(row.prevLeaveBalance) },
    { label: 'Phép dùng', sub: 'Annual leave used', value: fmtDays(row.leaveUsed) },
    { label: 'Bù trễ/sớm bằng phép', sub: 'Late/early offset', value: fmtDays(row.lateEarlyLeaveUsed), tone: row.lateEarlyLeaveUsed > 0 ? 'text-orange-600' : 'text-foreground' },
    { label: 'Phép năm', sub: 'Annual leave hours', value: fmtHours(row.annualLeaveHours) },
    { label: 'Nghỉ có lương', sub: 'Benefit leave hours', value: fmtHours(row.benefitLeaveHours) },
    { label: 'Nghỉ bù', sub: 'Comp leave hours', value: fmtHours(row.compLeaveHours) },
    { label: 'Tổng phép giờ', sub: 'Total leave hours', value: fmtHours(totalLeaveHours) },
    { label: 'Tồn phép năm', sub: "Annual leave's remains", value: fmtDays(row.currentLeaveBalance), tone: 'text-emerald-700' },
  ];
  const monthlyIncomeRows = [
    { label: 'Lương cơ bản', sub: 'Basic salary', value: fmtMoney(row.baseSalary) },
    { label: 'Lương tính công', sub: 'Basic salary + position allowance', value: fmtMoney(row.payrollSalary) },
    { label: 'Lương theo công thực tế', sub: 'Attendance-prorated salary', value: fmtMoney(row.actualSalary) },
    { label: 'Trừ đi trễ/về sớm', sub: 'Deduction due to early leave, late', value: fmtMoney(row.lateDeduction), tone: row.lateDeduction > 0 ? 'text-rose-600' : 'text-foreground' },
    { label: 'Phụ cấp theo ngày công', sub: 'Actual Allowances', value: fmtMoney(row.allowancesTotal), tone: 'text-blue-700' },
    { label: 'Tổng tiền OT', sub: 'Overtime total', value: `${fmtHours(row.otHours)} / ${fmtMoney(payrollOtComponentAmount(row))}`, tone: 'text-violet-700' },
    { label: 'Làm thêm ca đêm của ngày thường', sub: 'Day-shift night overtime 200%', value: `${fmtHours(row.otHrsWeekdayNight)} / ${fmtMoney(row.otAmtWeekdayNight)}`, tone: row.otHrsWeekdayNight > 0 ? 'text-violet-700' : 'text-foreground' },
    { label: 'Làm thêm đến đêm', sub: 'Working until night 210%', value: `${fmtHours(row.otHrsUntilNight)} / ${fmtMoney(row.otAmtUntilNight)}`, tone: row.otHrsUntilNight > 0 ? 'text-violet-700' : 'text-foreground' },
    { label: 'Làm vào ngày nghỉ', sub: 'Working on day-off', value: fmtHours(row.otHrsWeekend) },
    { label: 'Làm vào ngày lễ', sub: 'Working on holiday', value: fmtHours(row.otHrsHoliday) },
    { label: 'Làm thêm đến đêm', sub: 'Working until night', value: fmtHours(row.otHrsUntilNight) },
    { label: 'Làm ca đêm ngày thường', sub: 'Night normal day', value: fmtHours(row.otHrsNightNormal) },
    { label: 'Làm ca đêm ngày nghỉ', sub: 'Night weekend', value: fmtHours(row.otHrsNightWeekend) },
    { label: 'Tổng thu nhập', sub: 'Total income / Gross', value: fmtMoney(row.grossIncome), tone: 'text-blue-700' },
  ];
  const allowanceRowsUi = [
    { label: 'Phụ cấp cấp bậc', sub: 'Position allowance', value: fmtMoney(row.allowRank) },
    { label: 'Phụ cấp BPQL', sub: 'Management dept', value: fmtMoney(row.allowBpql) },
    { label: 'Phụ cấp kinh doanh', sub: 'Sales team', value: fmtMoney(row.allowSales) },
    { label: 'Phụ cấp kỹ thuật', sub: 'Technical', value: fmtMoney(row.allowTechnical) },
    { label: 'Phụ cấp ngoại ngữ', sub: 'Foreign language', value: fmtMoney(row.allowLanguage) },
    { label: 'Phụ cấp nhà ở', sub: 'Apartment', value: fmtMoney(row.allowHousing) },
    { label: 'Phụ cấp đi lại', sub: 'Commuting', value: fmtMoney(row.allowTransport) },
    { label: 'Phụ cấp ăn uống', sub: 'Meal', value: fmtMoney(row.allowMeal) },
    { label: 'Phụ cấp điện thoại', sub: 'Telephone', value: fmtMoney(row.allowPhone) },
    { label: 'Phụ cấp chuyên cần', sub: 'Attendance', value: fmtMoney(row.allowAttendance) },
  ];
  const insuranceRows = [
    { label: 'Lương đóng BHXH/BHYT', sub: 'Salary for social/medical insurance', value: fmtMoney(row.insuranceBasis), tone: 'text-orange-600' },
    { label: 'Lương đóng BHTN', sub: 'Salary for unemployment insurance', value: fmtMoney(row.insuranceBhtnBasis), tone: 'text-orange-600' },
    { label: 'BHXH NLĐ (8%)', sub: 'Social insurance', value: fmtMoney(row.empBhxh), tone: 'text-orange-600' },
    { label: 'BHYT NLĐ (1.5%)', sub: 'Medical insurance', value: fmtMoney(row.empBhyt), tone: 'text-orange-600' },
    { label: 'BHTN NLĐ (1%)', sub: 'Unemployment insurance', value: fmtMoney(row.empBhtn), tone: 'text-orange-600' },
    { label: 'Tổng BH NLĐ', sub: 'Total employee insurance', value: fmtMoney(row.insurance), tone: 'text-orange-600' },
    { label: 'BH công ty', sub: 'Total company insurance', value: fmtMoney(row.insuranceEmployer), tone: 'text-orange-600' },
    { label: 'BH tổng cộng', sub: 'Company + staff', value: fmtMoney(row.totalInsurance), tone: 'text-orange-600' },
  ];
  const taxRows = [
    { label: 'Tổng miễn thuế', sub: 'Total tax exemption', value: fmtMoney(row.totalTaxExempt), tone: 'text-emerald-700' },
    { label: 'OT miễn thuế', sub: 'O.W PIT exemption', value: fmtMoney(row.taxExemptOT), tone: 'text-emerald-700' },
    { label: 'Ăn uống miễn thuế', sub: 'Meal allowance exemption', value: fmtMoney(row.taxExemptMeal), tone: 'text-emerald-700' },
    { label: 'Điện thoại miễn thuế', sub: 'Telephone allowance exemption', value: fmtMoney(row.taxExemptPhone), tone: 'text-emerald-700' },
    { label: 'Giảm trừ gia cảnh', sub: 'Personal + dependents deduction', value: fmtMoney(row.familyDeduction) },
    { label: 'Người phụ thuộc', sub: 'Dependents', value: fmtDecimal(row.dependents) },
    { label: 'Thu nhập tính thuế', sub: 'Assessable income', value: fmtMoney(row.taxableIncome), tone: 'text-foreground' },
    { label: 'Thuế TNCN', sub: 'PIT', value: fmtMoney(row.pit), tone: 'text-rose-600' },
    { label: 'Đoàn phí', sub: 'Labor union', value: fmtMoney(row.unionFee) },
    { label: 'Điều chỉnh sau thuế', sub: 'Adjustment after tax', value: fmtMoney(row.afterTaxAdj) },
    { label: 'Lương thực nhận', sub: 'Net salary', value: fmtMoney(row.netSalary), tone: 'text-emerald-700' },
  ];
  const currentHrNote = (): PayslipHrNote => ({ text: hrText, attachments: hrAttachments });

  return (
    <Modal
      isOpen={!!row}
      onClose={onClose}
      title={`Phiếu lương - ${row.employeeCode}`}
      size="5xl"
      footer={(
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Đóng</Button>
          <Button
            variant="outline"
            size="sm"
            icon={Eye}
            loading={previewingPdf}
            onClick={() => { void onPreviewPdf(row, currentHrNote()); }}
          >
            Xem trước PDF
          </Button>
          {pdfAttachment && (
            <Button
              variant="outline"
              size="sm"
              icon={ExternalLink}
              onClick={() => window.open(pdfAttachment.url, '_blank', 'noopener,noreferrer')}
            >
              Mở PDF Lark
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={Download}
            loading={generatingPdf}
            onClick={() => onGeneratePdf(row, currentHrNote())}
          >
            Tạo PDF
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Avatar name={row.name} src={row.avatarUrl ?? undefined} size="lg" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-foreground">{row.name}</h3>
                {row.segmentLabel && <StatusChip label={row.segmentLabel} tone="violet" />}
                <StatusChip label={larkRecord?.status ?? status.label} tone={larkRecord?.status === 'Sẵn sàng' ? 'green' : 'slate'} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{row.department} · {row.position || 'Chưa cập nhật'} · {row.staffClassify}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{larkRecord?.payrollWindow || row.segmentDateRange || period?.label || 'Kỳ lương hiện tại'}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lương thực nhận</p>
            <p className="text-xl font-black tabular-nums text-emerald-600">{fmtMoney(row.netSalary)}</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Công thực tế</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{fmtDays(row.actualDays)}</p>
            <p className="text-[11px] text-muted-foreground">Chuẩn {fmtDays(row.standardDays)}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">OT tính lương</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-violet-700">{fmtHours(row.otHours)}</p>
            <p className="text-[11px] text-muted-foreground">{fmtMoney(payrollOtComponentAmount(row))}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">BH + PIT</p>
            <p className="mt-1 text-sm font-bold tabular-nums text-amber-700">BH {fmtMoney(row.insurance)}</p>
            <p className="text-[11px] font-semibold tabular-nums text-rose-600">PIT {fmtMoney(row.pit)}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lark PDF</p>
            <p className="mt-1 text-sm font-bold text-foreground">{pdfAttachment ? 'Đã có file' : 'Chưa có file'}</p>
            <p className="text-[11px] text-muted-foreground">{larkRecord?.confirmationStatus ?? 'Chưa đồng bộ Lark'}</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <PayslipInfoCard title="Thông tin cơ bản" rows={basicRows} />
          <PayslipInfoCard title="Công & kỳ lương" rows={workRecordRows} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <PayslipInfoCard title="Thu nhập hàng tháng" rows={monthlyIncomeRows} />
          <PayslipInfoCard title="Phụ cấp & thưởng" rows={allowanceRowsUi} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <PayslipInfoCard title="Bảo hiểm" rows={insuranceRows} />
          <PayslipInfoCard title="Thuế & thực nhận" rows={taxRows} />
        </div>

        <PayslipInfoCard title="Phép năm" rows={leaveRows} columns={2} />

        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wider text-foreground">Diễn giải nghiệp vụ</p>
            </div>
            <div className="space-y-2 p-4 text-xs text-muted-foreground">
              <p>{larkRecord?.explanations.period || `Kỳ ${period?.label ?? ''}: ${row.segmentDateRange ?? 'theo kỳ lương đã chọn'}`}</p>
              <p>{larkRecord?.explanations.payroll || `Công chuẩn ${fmtDays(row.standardDays)}, công thực tế ${fmtDays(row.actualDays)}, lương tính công ${fmtMoney(row.payrollSalary)}.`}</p>
              <p>{larkRecord?.explanations.deduction || `BH NLĐ ${fmtMoney(row.insurance)}, PIT ${fmtMoney(row.pit)}, net ${fmtMoney(row.netSalary)}.`}</p>
              {larkRecord?.hrNote && <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-700">{larkRecord.hrNote}</p>}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wider text-foreground">OT theo phân khúc</p>
          </div>
          {otRows.length === 0 ? (
            <p className="px-4 py-4 text-xs text-muted-foreground">Không có OT tính lương trong kỳ này.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-muted-foreground">Bucket</th>
                    <th className="px-4 py-2 text-right font-semibold text-muted-foreground">Số giờ</th>
                    <th className="px-4 py-2 text-right font-semibold text-muted-foreground">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {otRows.map(([bucket, detail]) => (
                    <tr key={bucket} className="border-t border-border/60">
                      <td className="px-4 py-2"><span className={`rounded border px-2 py-0.5 font-semibold ${otBucketColor(bucket)}`}>{OT_BUCKET_LABELS[bucket] ?? bucket}</span></td>
                      <td className="px-4 py-2 text-right font-bold tabular-nums text-violet-700">{fmtHours(detail.hours)}</td>
                      <td className="px-4 py-2 text-right font-bold tabular-nums text-emerald-700">{fmtMoney(detail.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-foreground">Ghi chú HR cho PDF</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Nội dung và ảnh sẽ được render trực tiếp vào phần ghi chú HR trong file PDF.</p>
            </div>
            {row.payslipHrNote?.updatedAt && (
              <span className="text-[11px] text-muted-foreground">Đã lưu bởi {row.payslipHrNote.updatedBy ?? 'HR'}</span>
            )}
          </div>
          <div className="space-y-3 p-4">
            <textarea
              value={hrText}
              onChange={(event) => setHrText(event.target.value)}
              rows={4}
              maxLength={5000}
              className="w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              placeholder="Ví dụ: Xác nhận điều chỉnh phụ cấp, tình trạng nghỉ bù, ghi chú C&B trước khi gửi phiếu..."
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-xs transition hover:bg-muted">
                <ImagePlus size={14} />
                Thêm ảnh ghi chú
                <input
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={(event) => {
                    void handleUploadImages(event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>
              <span className="text-[11px] text-muted-foreground">Tối đa 4 ảnh, mỗi ảnh dưới 2.5MB.</span>
            </div>
            {hrAttachments.length > 0 && (
              <div className="grid gap-2 md:grid-cols-2">
                {hrAttachments.map((attachment) => (
                  <div key={attachment.id ?? attachment.name} className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-2">
                    <img src={attachment.dataUrl} alt={attachment.name} className="h-14 w-20 rounded-md border border-border object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-foreground">{attachment.name}</p>
                      <p className="text-[11px] text-muted-foreground">{fmtFileSize(attachment.size)}</p>
                    </div>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-destructive"
                      onClick={() => setHrAttachments((current) => current.filter((item) => item !== attachment))}
                      aria-label={`Xóa ${attachment.name}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                icon={FileImage}
                loading={savingHrNote}
                onClick={() => onSaveHrNote(row, { text: hrText, attachments: hrAttachments })}
              >
                Lưu ghi chú HR
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PayslipSlipSection({
  rows,
  loading,
  activePeriod,
  baseRecords,
  baseMeta,
  loadingBase,
  onGeneratePdf,
  onPreviewPdf,
  onSaveHrNote,
  generatingPdf,
  previewingPdf,
  savingHrNote,
}: {
  rows: PayrollRow[];
  loading: boolean;
  activePeriod?: PayrollPeriod;
  baseRecords: PayslipBaseRecord[];
  baseMeta?: PayslipBaseResponse['meta'];
  loadingBase: boolean;
  onGeneratePdf: (row: PayrollRow, note?: PayslipHrNote) => void;
  onPreviewPdf: (row: PayrollRow, note?: PayslipHrNote) => Promise<string>;
  onSaveHrNote: (row: PayrollRow, note: PayslipHrNote) => Promise<void>;
  generatingPdf: boolean;
  previewingPdf: boolean;
  savingHrNote: boolean;
}) {
  const [viewMode, setViewMode] = useState<PayslipViewMode>('table');
  const [selectedRow, setSelectedRow] = useState<PayrollRow | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('Preview phiếu lương');
  const bySource = useMemo(() => new Map(baseRecords.map((record) => [record.sourceId, record])), [baseRecords]);
  const byCode = useMemo(() => new Map(baseRecords.map((record) => [record.employeeCode, record])), [baseRecords]);
  const totalReady = rows.filter((row) => payslipBaseForRow(row, activePeriod?.monthKey, bySource, byCode)?.pdfAttachments.length).length;
  const totalConfirmed = rows.filter((row) => {
    const record = payslipBaseForRow(row, activePeriod?.monthKey, bySource, byCode);
    return record?.confirmationStatus && record.confirmationStatus !== 'Chưa gửi';
  }).length;

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-12 rounded-lg bg-muted/60" />)}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <ReceiptText size={15} className="text-blue-600" />
            <span className="text-xs text-muted-foreground">Phiếu lương:</span>
            <span className="text-xs font-bold tabular-nums text-foreground">{rows.length}</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Download size={15} className="text-emerald-600" />
            <span className="text-xs text-muted-foreground">PDF Lark:</span>
            <span className="text-xs font-bold tabular-nums text-emerald-700">{totalReady}/{rows.length}</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} className="text-violet-600" />
            <span className="text-xs text-muted-foreground">Xác nhận:</span>
            <span className="text-xs font-bold tabular-nums text-violet-700">{totalConfirmed}</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Sheet size={15} className="text-green-600" />
            <span className="text-xs text-muted-foreground">Lark Base:</span>
            <span className="text-xs font-bold text-foreground">{loadingBase ? 'Đang đọc...' : `${baseMeta?.fieldCount ?? 0} trường`}</span>
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-muted/20 p-1">
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${viewMode === 'table' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Table2 size={14} /> Table
          </button>
          <button
            type="button"
            onClick={() => setViewMode('cards')}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${viewMode === 'cards' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Grid2X2 size={14} /> Card
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={ReceiptText} title="Chưa có phiếu lương" description="Bấm Tính lương để tạo dữ liệu phiếu lương cho kỳ đã chọn." />
      ) : viewMode === 'table' ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="w-[56px] px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">#</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nhân sự</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Kỳ / trạng thái</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Gross</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">BH + PIT</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Net</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">OT</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">PDF</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const record = payslipBaseForRow(row, activePeriod?.monthKey, bySource, byCode);
                  const pdf = record?.pdfAttachments[0];
                  return (
                    <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">{index + 1}.</td>
                      <td className="px-3 py-3">
                        <button type="button" onClick={() => setSelectedRow(row)} className="flex items-center gap-2 text-left">
                          <Avatar name={row.name} src={row.avatarUrl ?? undefined} size="sm" />
                          <span>
                            <span className="block text-xs font-bold text-foreground">{row.name}</span>
                            <span className="text-[10px] text-muted-foreground">{row.employeeCode} · {row.department}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-semibold text-foreground">{activePeriod?.label ?? 'Kỳ hiện tại'}</span>
                          {row.segmentLabel && <StatusChip label={row.segmentLabel} tone="violet" />}
                          <StatusChip label={record?.status ?? PAYSLIP_STATUS[row.status]?.label ?? row.status} tone={record?.status === 'Sẵn sàng' ? 'green' : 'slate'} />
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{record?.confirmationStatus ?? 'Chưa có record clean trên Lark'}</p>
                      </td>
                      <td className="px-3 py-3 text-right text-xs font-bold tabular-nums text-blue-700">{fmtMoney(row.grossIncome)}</td>
                      <td className="px-3 py-3 text-right">
                        <p className="text-xs font-bold tabular-nums text-amber-700">{fmtMoney(row.insurance)}</p>
                        <p className="text-[10px] font-semibold tabular-nums text-rose-600">{fmtMoney(row.pit)}</p>
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-black tabular-nums text-emerald-700">{fmtMoney(row.netSalary)}</td>
                      <td className="px-3 py-3 text-right">
                        <p className="text-xs font-bold tabular-nums text-violet-700">{fmtHours(row.otHours)}</p>
                        <p className="text-[10px] text-muted-foreground">{fmtMoney(payrollOtComponentAmount(row))}</p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          {pdf ? <StatusChip label="Đã có PDF" tone="green" /> : <StatusChip label="Chưa tạo" tone="amber" />}
                          {record?.sendMail && <Mail size={13} className="text-blue-600" />}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Button variant="ghost" size="sm" icon={Eye} onClick={() => setSelectedRow(row)}>Chi tiết</Button>
                          {pdf && <Button variant="outline" size="sm" icon={ExternalLink} onClick={() => window.open(pdf.url, '_blank', 'noopener,noreferrer')}>Lark</Button>}
                          <Button variant="outline" size="sm" icon={FileText} loading={previewingPdf} onClick={() => {
                            setPreviewTitle(`Preview phiếu lương - ${row.employeeCode}`);
                            void onPreviewPdf(row).then(setPreviewHtml);
                          }}>Preview</Button>
                          <Button variant="outline" size="sm" icon={Download} loading={generatingPdf} onClick={() => onGeneratePdf(row)}>PDF</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const record = payslipBaseForRow(row, activePeriod?.monthKey, bySource, byCode);
            const pdf = record?.pdfAttachments[0];
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedRow(row)}
                className="rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:border-primary/30 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar name={row.name} src={row.avatarUrl ?? undefined} size="md" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">{row.name}</p>
                      <p className="text-[11px] text-muted-foreground">{row.employeeCode} · {row.position || row.department}</p>
                    </div>
                  </div>
                  {pdf ? <StatusChip label="PDF" tone="green" /> : <StatusChip label="Draft" tone="amber" />}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted/30 p-2">
                    <p className="text-[10px] text-muted-foreground">Gross</p>
                    <p className="text-xs font-bold tabular-nums text-blue-700">{fmtMoney(row.grossIncome)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 p-2">
                    <p className="text-[10px] text-muted-foreground">Net</p>
                    <p className="text-xs font-black tabular-nums text-emerald-700">{fmtMoney(row.netSalary)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 p-2">
                    <p className="text-[10px] text-muted-foreground">BH + PIT</p>
                    <p className="text-xs font-bold tabular-nums text-rose-700">{fmtMoney(row.insurance + row.pit)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 p-2">
                    <p className="text-[10px] text-muted-foreground">OT</p>
                    <p className="text-xs font-bold tabular-nums text-violet-700">{fmtHours(row.otHours)}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{record?.status ?? PAYSLIP_STATUS[row.status]?.label ?? row.status}</span>
                  <span>{record?.confirmationStatus ?? 'Chưa đồng bộ Lark'}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <PayslipDetailModal
        row={selectedRow}
        larkRecord={selectedRow ? payslipBaseForRow(selectedRow, activePeriod?.monthKey, bySource, byCode) : undefined}
        period={activePeriod}
        onClose={() => setSelectedRow(null)}
        onGeneratePdf={onGeneratePdf}
        onPreviewPdf={(row, note) => {
          setPreviewTitle(`Preview phiếu lương - ${row.employeeCode}`);
          return onPreviewPdf(row, note).then((html) => {
            setPreviewHtml(html);
            return html;
          });
        }}
        onSaveHrNote={onSaveHrNote}
        generatingPdf={generatingPdf}
        previewingPdf={previewingPdf}
        savingHrNote={savingHrNote}
      />
      <PdfPreviewModal
        html={previewHtml}
        title={previewTitle}
        onClose={() => setPreviewHtml(null)}
      />
    </>
  );
}

export default function Payroll() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [activeTab, setActiveTab] = useState<PayrollTab>('timesheet');
  const autoSyncKeysRef = useRef<Set<string>>(new Set());

  const { data: periods = [] } = useQuery<PayrollPeriod[]>({
    queryKey: ['periods'],
    queryFn: async () => {
      const { data } = await api.get<PayrollPeriod[]>('/periods');
      return data;
    },
    staleTime: 60_000,
  });

  const activePeriodId = selectedPeriodId || periods[0]?.id || '';
  const activePeriod = periods.find((period) => period.id === activePeriodId);
  const periodOptions = periods.map((period) => ({
    value: period.id,
    label: `${period.label || period.monthKey} · ${period.status}`,
  }));

  const { data: payslips = [], isLoading: loadingPayslips } = useQuery<PayslipApiRow[]>({
    queryKey: ['payroll', activePeriodId],
    queryFn: async () => {
      const { data } = await api.get<{ status: string; data: PayslipApiRow[] }>(
        `/payroll?periodId=${activePeriodId}`,
      );
      return data.data || [];
    },
    enabled: !!activePeriodId && (activeTab === 'salary' || activeTab === 'slips'),
    staleTime: 60_000,
  });

  const { data: payslipBaseResponse, isLoading: loadingPayslipBase } = useQuery<PayslipBaseResponse>({
    queryKey: ['payroll-payslip-base', activePeriodId],
    queryFn: async () => {
      const { data } = await api.get<PayslipBaseResponse>(`/payroll/payslip-base?periodId=${activePeriodId}`);
      return data;
    },
    enabled: !!activePeriodId && activeTab === 'slips',
    staleTime: 60_000,
  });

  const { data: summary } = useQuery<PayrollSummary>({
    queryKey: ['payroll-summary', activePeriodId],
    queryFn: async () => {
      const { data } = await api.get<{ status: string; data: PayrollSummary }>(
        `/payroll/summary?periodId=${activePeriodId}`,
      );
      return data.data;
    },
    enabled: !!activePeriodId && activeTab === 'salary',
    staleTime: 60_000,
  });

  const { data: timesheetResponse, isLoading: loadingTimesheet } = useQuery<TimesheetResponse>({
    queryKey: ['payroll-timesheet', activePeriodId],
    queryFn: async () => {
      const { data } = await api.get<TimesheetResponse>(`/payroll/timesheet?periodId=${activePeriodId}`);
      return data;
    },
    enabled: !!activePeriodId,
    staleTime: 60_000,
  });

  const calculateMutation = useMutation({
    mutationFn: async () => api.post(`/payroll/calculate/${activePeriodId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-summary'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-timesheet'] });
      toast('success', 'Đã tính lương cho kỳ đã chọn');
    },
    onError: (error: Error) => toast('error', error.message),
  });

  const syncAttendanceMutation = useMutation({
    mutationFn: async (_options?: SyncAttendanceOptions) => api.post<{
      status: string;
      data: {
        attendance: { processed: number; errors: number };
        payslips: { processed: number; errors: number };
      };
    }>(`/payroll/sync-attendance/${activePeriodId}`),
    onSuccess: ({ data }, options) => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-summary'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-timesheet'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-payslip-base'] });
      const attendance = data.data.attendance;
      const payslips = data.data.payslips;
      const hasErrors = attendance.errors > 0 || payslips.errors > 0;
      if (!options?.silent) {
        toast(
          hasErrors ? 'warning' : 'success',
          `Đã đồng bộ công ${attendance.processed} nhân sự và tính lại lương ${payslips.processed} nhân sự`,
        );
      }
    },
    onError: (error: Error) => toast('error', `Đồng bộ công thất bại: ${error.message}`),
  });

  const closeMutation = useMutation({
    mutationFn: async () => api.post(`/payroll/close/${activePeriodId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods'] });
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-timesheet'] });
      toast('success', 'Đã chạy quy trình chốt công');
    },
    onError: (error: Error) => toast('error', error.message),
  });

  useEffect(() => {
    if (!activePeriodId) return;
    if (activeTab !== 'timesheet' && activeTab !== 'salary') return;
    if (syncAttendanceMutation.isPending || calculateMutation.isPending || closeMutation.isPending) return;

    const key = `${activePeriodId}:${activeTab}`;
    if (autoSyncKeysRef.current.has(key)) return;
    autoSyncKeysRef.current.add(key);

    syncAttendanceMutation.mutate(
      { silent: true },
      {
        onError: () => {
          autoSyncKeysRef.current.delete(key);
        },
      },
    );
  }, [
    activePeriodId,
    activeTab,
    calculateMutation.isPending,
    closeMutation.isPending,
    syncAttendanceMutation.isPending,
  ]);

  // ── Sheet status — fetch on load, refresh after export ──
  const { data: sheetStatus, isLoading: loadingSheetStatus } = useQuery<SheetStatus>({
    queryKey: ['payroll-sheet-status', activePeriodId],
    queryFn: async () => {
      const { data } = await api.get<{ status: string; data: SheetStatus }>(
        `/payroll/sheet-status/${activePeriodId}`,
      );
      return data.data;
    },
    enabled: !!activePeriodId,
    staleTime: 30_000,
  });

  const exportSheetMutation = useMutation({
    mutationFn: async () => api.post(`/payroll/export-sheet/${activePeriodId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-sheet-status', activePeriodId] });
      queryClient.invalidateQueries({ queryKey: ['payroll-ot-sheet-status', activePeriodId] });
      toast('success', sheetStatus?.hasSheet ? 'Sheet tính công đã được cập nhật' : 'Đã tạo sheet tính công trên Lark');
    },
    onError: (error: Error) => toast('error', `Xuất sheet thất bại: ${error.message}`),
  });

  // ── OT Sheet status ──
  const { data: otSheetStatus, isLoading: loadingOtSheetStatus } = useQuery<OtSheetStatus>({
    queryKey: ['payroll-ot-sheet-status', activePeriodId],
    queryFn: async () => {
      const { data } = await api.get<{ status: string; data: OtSheetStatus }>(
        `/payroll/ot-sheet-status/${activePeriodId}`,
      );
      return data.data;
    },
    enabled: !!activePeriodId,
    staleTime: 30_000,
  });

  const exportOtSheetMutation = useMutation({
    mutationFn: async () => api.post(`/payroll/export-ot-sheet/${activePeriodId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-ot-sheet-status', activePeriodId] });
      queryClient.invalidateQueries({ queryKey: ['payroll-sheet-status', activePeriodId] });
      toast('success', otSheetStatus?.hasSheet ? 'Sheet OT đã được cập nhật' : 'Đã tạo sheet OT trên Lark');
    },
    onError: (error: Error) => toast('error', `Xuất sheet OT thất bại: ${error.message}`),
  });

  const { data: salarySheetStatus, isLoading: loadingSalarySheetStatus } = useQuery<SalarySheetStatus>({
    queryKey: ['payroll-salary-sheet-status', activePeriodId],
    queryFn: async () => {
      const { data } = await api.get<{ status: string; data: SalarySheetStatus }>(
        `/payroll/salary-sheet-status/${activePeriodId}`,
      );
      return data.data;
    },
    enabled: !!activePeriodId,
    staleTime: 30_000,
  });

  const exportSalarySheetMutation = useMutation({
    mutationFn: async ({ popup }: { popup?: Window | null } = {}) => {
      const response = await api.post<{
        status: string;
        data: { url: string; rows: number; otHours: number; otAmount: number; isNew?: boolean };
      }>(`/payroll/export-salary-sheet/${activePeriodId}`);
      return { response, popup };
    },
    onSuccess: ({ response, popup }) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-salary-sheet-status', activePeriodId] });
      const { data } = response.data;
      toast('success', `${data.isNew ? 'Đã tạo' : 'Đã cập nhật'} bảng lương ${data.rows} nhân sự · OT ${data.otHours}h / ${fmtVND(data.otAmount)}₫`);
      if (popup) {
        popup.location.href = data.url;
      } else if (!salarySheetStatus?.hasSheet) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
    },
    onError: (error: Error, variables) => {
      variables?.popup?.close();
      toast('error', `Xuất bảng lương thất bại: ${error.message}`);
    },
  });

  const handleSalarySheetClick = () => {
    if (!activePeriodId || rows.length === 0 || exportSalarySheetMutation.isPending) return;

    if (salarySheetStatus?.hasSheet && salarySheetStatus.larkSheetUrl) {
      window.open(salarySheetStatus.larkSheetUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    const popup = window.open('about:blank', '_blank', 'noopener,noreferrer');
    exportSalarySheetMutation.mutate({ popup });
  };

  const handleSalarySheetUpdate = () => {
    if (!activePeriodId || rows.length === 0 || exportSalarySheetMutation.isPending) return;
    exportSalarySheetMutation.mutate({});
  };

  const editPayslipMutation = useMutation({
    mutationFn: async ({ row, payload }: { row: PayrollRow; payload: { overrides: PayrollOverridePayload; note: string } }) => {
      if (row.isVirtualSegment) {
        throw new Error('Dòng tách thử việc/chính thức được tính tự động từ phiếu lương tổng, không chỉnh tay trực tiếp.');
      }
      const hasSimple = Object.keys(payload.overrides).some((key) => key !== 'allowances');
      const hasAllowances = Object.keys(payload.overrides.allowances ?? {}).length > 0;
      if (!hasSimple && !hasAllowances) {
        return { data: { status: 'ok', changed: 0 } };
      }
      return api.patch(`/payroll/${row.id}/overrides`, {
        overrides: payload.overrides,
        note: payload.note,
        changedBy: 'C&B',
      });
    },
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ['payroll', activePeriodId] });
      queryClient.invalidateQueries({ queryKey: ['payroll-summary', activePeriodId] });
      queryClient.invalidateQueries({ queryKey: ['payroll-salary-sheet-status', activePeriodId] });
      const sheetSync = (_response.data as { sheetSync?: { status?: string; message?: string } })?.sheetSync;
      if (sheetSync?.status === 'ok') {
        toast('success', `Đã lưu chỉnh sửa và đồng bộ sheet bảng lương cho ${variables.row.employeeCode}`);
      } else if (sheetSync?.status === 'error') {
        toast('warning', `Đã lưu chỉnh sửa, nhưng đồng bộ sheet chưa thành công: ${sheetSync.message ?? 'Lark chưa phản hồi'}`);
      } else {
        toast('success', `Đã lưu chỉnh sửa bảng lương cho ${variables.row.employeeCode}`);
      }
    },
    onError: (error: Error) => toast('error', `Lưu chỉnh sửa thất bại: ${error.message}`),
  });

  const savePayslipHrNote = async (row: PayrollRow, note: PayslipHrNote) => {
    const baseId = row.id.split(':')[0] ?? row.id;
    const { data } = await api.patch(`/payroll/${baseId}/hr-note`, {
      text: note.text ?? '',
      attachments: note.attachments ?? [],
      changedBy: 'HR',
    });
    return data;
  };

  const payslipPdfMutation = useMutation({
    mutationFn: async ({ row, note }: { row: PayrollRow; note?: PayslipHrNote }) => {
      if (note) {
        await savePayslipHrNote(row, note);
      }
      const response = await api.post(`/payroll/payslip-pdf/${encodeURIComponent(row.id)}`, undefined, {
        responseType: 'blob',
      });
      const rawContentType = response.headers['content-type'];
      const contentType = Array.isArray(rawContentType)
        ? rawContentType.join(';')
        : typeof rawContentType === 'string'
          ? rawContentType
          : '';
      if (contentType.includes('application/json')) {
        const text = await (response.data as Blob).text();
        const json = JSON.parse(text) as { data?: { url?: string } };
        if (json.data?.url) {
          window.open(json.data.url, '_blank', 'noopener,noreferrer');
          return;
        }
      }
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ASNOVA-Payslip-${activePeriod?.monthKey ?? 'period'}-${row.employeeCode}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => {
      toast('success', 'Đã tạo PDF phiếu lương');
      queryClient.invalidateQueries({ queryKey: ['payroll-payslip-base', activePeriodId] });
    },
    onError: (error: Error) => toast('error', `Tạo PDF thất bại: ${error.message}`),
  });

  const payslipPreviewMutation = useMutation({
    mutationFn: async ({ row, note }: { row: PayrollRow; note?: PayslipHrNote }) => {
      if (note) {
        await savePayslipHrNote(row, note);
      }
      const response = await api.get<string>(`/payroll/payslip-preview/${encodeURIComponent(row.id)}`, {
        responseType: 'text',
      });
      return response.data;
    },
    onError: (error: Error) => toast('error', `Preview PDF thất bại: ${error.message}`),
  });

  const payslipHrNoteMutation = useMutation({
    mutationFn: async ({ row, note }: { row: PayrollRow; note: PayslipHrNote }) => {
      return savePayslipHrNote(row, note);
    },
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ['payroll', activePeriodId] });
      toast('success', `Đã lưu ghi chú HR cho ${variables.row.employeeCode}`);
    },
    onError: (error: Error) => toast('error', `Lưu ghi chú HR thất bại: ${error.message}`),
  });


  const rows = useMemo<PayrollRow[]>(() => payslips.map((payslip) => {
    const dept = payslip.employee?.department || '';
    const groupKey = payslip.employee?.groupKey || getTimesheetGroupKey(dept);
    const sortIndex = payslip.employee?.sortIndex ?? 999;
    const insurance = payslip.fullBreakdown?.insurance;
    const allowances = payslip.fullBreakdown?.allowances;
    const attendance = payslip.attendance;
    const leave = payslip.leaveBalance;
    const bucketValues = Object.entries(payslip.otBucketBreakdown ?? {});
    const payableBucketValues = bucketValues.filter(([, value]) => toNum(value.amount) > 0);
    const compLeaveBucketValues = bucketValues.filter(([, value]) => toNum(value.hours) > 0 && toNum(value.amount) <= 0);
    const payableOtBuckets = Object.fromEntries(payableBucketValues);
    const compLeaveOtBuckets = Object.fromEntries(compLeaveBucketValues);
    const bucketBy = (
      values: Array<[string, { hours: number; amount: number }]>,
      matcher: (key: string) => boolean,
    ) => values.reduce(
      (acc, [key, value]) => matcher(key)
        ? { hours: acc.hours + toNum(value.hours), amount: acc.amount + toNum(value.amount) }
        : acc,
      { hours: 0, amount: 0 },
    );
    const payableBucketBy = (matcher: (key: string) => boolean) => bucketBy(payableBucketValues, matcher);
    const weekdayOt = payableBucketBy(isWeekdayDayOtBucket);
    const weekdayNightOt = payableBucketBy(isWeekdayNightOtBucket);
    const weekendOt = payableBucketBy(isWeekendOtBucket);
    const holidayOt = payableBucketBy(isHolidayOtBucket);
    const untilNightOt = payableBucketBy(isUntilNightOtBucket);
    const nightNormalOt = payableBucketBy(isNightNormalOtBucket);
    const nightWeekendOt = payableBucketBy(isNightWeekendOtBucket);
    const nightOt = payableBucketBy(isNightShiftDayOtBucket);
    const payableOtHours = payableBucketValues.reduce((sum, [, value]) => sum + toNum(value.hours), 0);
    const compLeaveOtHours = compLeaveBucketValues.reduce((sum, [, value]) => sum + toNum(value.hours), 0);
    const standardDays = toNum(payslip.standardDays);
    const baseSalary = toNum(payslip.baseSalary);
    const allowRank = toNum(allowances?.rank);
    const payrollSalary = baseSalary + allowRank;
    const dailyRate = standardDays > 0 ? payrollSalary / standardDays : 0;
    const hourlyRate = roundToTens(dailyRate / 8);
    const overtimeRate = roundToTens(hourlyRate * 1.5);
    const otRateWeekdayNight = roundToTens(hourlyRate * 2);
    const otRateWeekend = roundToTens(hourlyRate * 2);
    const otRateHoliday = roundToTens(hourlyRate * 3);
    const otRateUntilNight = roundToTens(hourlyRate * 2.1);
    const otRateNightNormal = roundToTens(hourlyRate * 0.3);
    const otRateNightWeekend = roundToTens(hourlyRate * 2.7);
    const overtimeAndNightShiftHours = weekdayOt.hours;
    const dayShiftNightOtHours = weekdayNightOt.hours;
    const overtimeAndNightShiftAmount = overtimeAndNightShiftHours * overtimeRate;
    const dayShiftNightOtAmount = dayShiftNightOtHours * otRateWeekdayNight;
    const weekendOtAmount = weekendOt.hours * otRateWeekend;
    const holidayOtAmount = holidayOt.hours * otRateHoliday;
    const untilNightOtAmount = untilNightOt.hours * otRateUntilNight;
    const nightNormalOtAmount = nightNormalOt.hours * otRateNightNormal;
    const nightWeekendOtAmount = nightWeekendOt.hours * otRateNightWeekend;
    const actualAllowancesValue = toNum(payslip.allowancesTotal);
    const absentDays = toNum(attendance?.absentDays);
    const absentDeduction = absentDays > 0 ? dailyRate * absentDays : 0;
    const grossIncomeValue = Math.max(0,
      payrollSalary
      - absentDeduction
      - toNum(payslip.lateDeduction)
      + toNum(allowances?.attendance)
      + overtimeAndNightShiftAmount
      + dayShiftNightOtAmount
      + weekendOtAmount
      + holidayOtAmount
      + untilNightOtAmount
      + nightNormalOtAmount
      + nightWeekendOtAmount
      + actualAllowancesValue,
    );
    const insurancePolicyBasis = toNum(insurance?.insuranceBasis);
    const insuranceRawBasis = insurancePolicyBasis || (
      baseSalary
      + allowRank
      + toNum(allowances?.bpql)
      + toNum(allowances?.sales)
      + toNum(allowances?.technical)
      + toNum(allowances?.language)
    );
    const insuranceBhxhCap = toNum(insurance?.caps?.bhxhBhyt ?? insurance?.caps?.bhxh_bhyt) || INSURANCE_BHXH_BHYT_CAP;
    const insuranceBhtnCap = toNum(insurance?.caps?.bhtn) || INSURANCE_BHTN_CAP;
    const insuranceBasisBhxhBhyt = toNum(insurance?.basisBhxhBhyt) || Math.min(insuranceRawBasis, insuranceBhxhCap);
    const insuranceBasisBhtn = toNum(insurance?.basisBhtn) || Math.min(insuranceRawBasis, insuranceBhtnCap);
    const taxExemptions = payslip.fullBreakdown?.taxExemptions;
    const payrollSegment = payslip.fullBreakdown?.payrollSegment ?? payslip.employee?.payrollSegment ?? null;
    const dependents = payslip.taxPolicyInfo?.dependents ?? 0;
    const personalDeduction = payslip.taxPolicyInfo?.personalDeduction ?? 0;
    const taxExemptValue = toNum(payslip.taxExempt);
    const dependentDeduction = toNum(payslip.taxPolicyInfo?.dependentDeduction)
      || (dependents > 0 && taxExemptValue > personalDeduction
        ? Math.round((taxExemptValue - personalDeduction) / dependents)
        : DEFAULT_DEPENDENT_DEDUCTION);
    const familyDeduction = payslip.employee?.employmentType === 'P'
      ? 0
      : personalDeduction + dependents * dependentDeduction;
    const mealTaxExempt = toNum(taxExemptions?.meal) || Math.round(Math.min(toNum(allowances?.meal), 930_000) * toNum(payslip.workRatio));
    const phoneTaxExempt = toNum(taxExemptions?.phone) || Math.round(toNum(allowances?.phone) * toNum(payslip.workRatio));
    const otTaxExempt = (
      overtimeAndNightShiftAmount
      + dayShiftNightOtAmount
      + weekendOtAmount
      + holidayOtAmount
      + untilNightOtAmount
      + nightNormalOtAmount
      + nightWeekendOtAmount
    );
    return {
      id: payslip.id,
      employeeId: payslip.employeeId ?? '',
      name: payslip.employee?.fullName || 'Chưa gán nhân viên',
      originalName: payslip.employee?.originalFullName || payslip.employee?.fullName || 'Chưa gán nhân viên',
      department: dept || 'Chưa phân bổ',
      position: payslip.employee?.position || '',
      employeeCode: payslip.employee?.employeeCode || '',
      employmentType: payslip.employee?.employmentType || 'FT',
      staffClassify: payslip.employee?.staffClassify || payslip.employee?.larkMetadata?.staffClassify || payslip.employee?.employmentType || 'FT',
      joinDate: payslip.employee?.joinDate ?? null,
      groupKey,
      sortIndex,
      avatarUrl: avatarUrlFromPayslip(payslip),
      isVirtualSegment: Boolean(payrollSegment?.virtual),
      segmentLabel: payrollSegment?.label ?? null,
      segmentDateRange: payrollSegment?.dateRange ?? null,
      standardDays,
      actualDays: toNum(payslip.actualDays),
      workRatio: toNum(payslip.workRatio),
      workHours: toNum(attendance?.workHours),
      absentDays,
      lateHoursBeforeLeave: toNum(attendance?.lateHoursBeforeLeave),
      earlyHoursBeforeLeave: toNum(attendance?.earlyHoursBeforeLeave),
      lateEarlyLeaveDeductedHours: toNum(attendance?.lateEarlyLeaveDeductedHours),
      lateHours: toNum(attendance?.lateHours),
      earlyHours: toNum(attendance?.earlyHours),
      annualLeaveHours: toNum(attendance?.annualLeaveHours),
      benefitLeaveHours: toNum(attendance?.benefitLeaveHours),
      compLeaveHours: toNum(attendance?.compLeaveHours),
      prevLeaveBalance: toNum(leave?.opening),
      currentLeaveBalance: toNum(leave?.closing),
      leaveUsed: toNum(leave?.used),
      lateEarlyLeaveUsed: toNum(leave?.lateEarlyUsed),
      dependents,
      personalDeduction,
      dependentDeduction,
      familyDeduction,
      baseSalary,
      payrollSalary,
      actualSalary: toNum(payslip.actualSalary),
      dailyRate,
      hourlyRate,
      overtimeRate,
      otRateWeekdayNight,
      otRateWeekend,
      otRateHoliday,
      otRateUntilNight,
      otRateNightNormal,
      otRateNightWeekend,
      allowRank,
      allowBpql: toNum(allowances?.bpql),
      allowSales: toNum(allowances?.sales),
      allowTechnical: toNum(allowances?.technical),
      allowLanguage: toNum(allowances?.language),
      allowHousing: toNum(allowances?.housing),
      allowTransport: toNum(allowances?.transport),
      allowMeal: toNum(allowances?.meal),
      allowPhone: toNum(allowances?.phone),
      allowAttendance: toNum(allowances?.attendance),
      allowancesTotal: actualAllowancesValue,
      otHrsWeekday: overtimeAndNightShiftHours,
      otHrsWeekdayNight: weekdayNightOt.hours,
      otHrsWeekend: weekendOt.hours,
      otHrsHoliday: holidayOt.hours,
      otHrsUntilNight: untilNightOt.hours,
      otHrsNightNormal: nightNormalOt.hours,
      otHrsNightWeekend: nightWeekendOt.hours,
      otHrsNightOt: nightOt.hours,
      otHours: payableOtHours,
      otAmount: toNum(payslip.otTotalAmount),
      otAmtWeekday: overtimeAndNightShiftAmount,
      otAmtWeekdayNight: dayShiftNightOtAmount,
      otAmtWeekend: weekendOtAmount,
      otAmtHoliday: holidayOtAmount,
      otAmtUntilNight: untilNightOtAmount,
      otAmtNightNormal: nightNormalOtAmount,
      otAmtNightWeekend: nightWeekendOtAmount,
      lateDeduction: toNum(payslip.lateDeduction),
      taxExemptOT: otTaxExempt,
      taxExemptMeal: mealTaxExempt,
      taxExemptPhone: phoneTaxExempt,
      totalTaxExempt: otTaxExempt + mealTaxExempt + phoneTaxExempt,
      grossIncome: grossIncomeValue,
      insuranceRawBasis,
      insuranceBhxhCap,
      insuranceBhtnCap,
      insuranceBasis: insuranceBasisBhxhBhyt,
      insuranceBhtnBasis: insuranceBasisBhtn,
      empBhxh: toNum(insurance?.employee?.bhxh),
      empBhyt: toNum(insurance?.employee?.bhyt),
      empBhtn: toNum(insurance?.employee?.bhtn),
      insurance: toNum(payslip.insuranceEmployee),
      erBhxh: toNum(insurance?.employer?.bhxh),
      erBhyt: toNum(insurance?.employer?.bhyt),
      erBhtn: toNum(insurance?.employer?.bhtn),
      insuranceEmployer: toNum(payslip.insuranceEmployer),
      totalInsurance: toNum(payslip.insuranceEmployee) + toNum(payslip.insuranceEmployer),
      taxExempt: taxExemptValue,
      taxableIncome: toNum(payslip.taxableIncome),
      pit: toNum(payslip.pitAmount),
      afterTaxAdj: toNum(payslip.afterTaxAdjustment),
      unionFee: toNum(payslip.unionFee),
      netSalary: toNum(payslip.netSalary),
      status: payslip.status,
      fullBreakdown: payslip.fullBreakdown ?? null,
      payslipHrNote: payslip.fullBreakdown?.payslipHrNote ?? { text: '', attachments: [] },
      manualOverrides: payslip.fullBreakdown?.manualOverrides ?? {},
      manualEditLogs: payslip.fullBreakdown?.manualEditLogs ?? [],
      otBuckets: payableOtBuckets,
      auditOtHours: toNum(payslip.otTotalHours),
      compLeaveOtHours,
      compLeaveOtBuckets,
    };
  }).filter((row) => row.sortIndex < 999)
    .sort((a, b) => a.sortIndex - b.sortIndex), [payslips]);

  const timesheetRows = useMemo<TimesheetRow[]>(() => (timesheetResponse?.data ?? []).map((row) => {
    const attendance = row.attendance;
    const leaveUsed = row.leaveBalance?.used ?? (
      (attendance.annualLeaveHours + attendance.benefitLeaveHours + attendance.compLeaveHours) / 8
    );

    return {
      id: row.id,
      employeeId: row.employeeId,
      name: row.employee.fullName,
      employeeCode: row.employee.employeeCode ?? 'ASV---',
      groupKey: row.employee.groupKey || getTimesheetGroupKey(row.employee.department || ''),
      sortIndex: row.employee.sortIndex ?? 999,
      department: row.employee.department || 'Chưa phân bổ',
      position: row.employee.position || 'Chưa cập nhật',
      scheduleType: row.employee.scheduleType,
      avatarUrl: row.employee.avatarUrl,
      period: row.period,
      standardDays: attendance.standardDays,
      rawActualDays: attendance.rawActualDays,
      actualDays: attendance.actualDays,
      workHours: attendance.workHours,
      lateHours: attendance.lateHours,
      earlyHours: attendance.earlyHours,
      lateHoursBeforeLeave: attendance.lateHoursBeforeLeave,
      earlyHoursBeforeLeave: attendance.earlyHoursBeforeLeave,
      lateEarlyLeaveDeductedHours: attendance.lateEarlyLeaveDeductedHours,
      paidCreditHours: attendance.paidCreditHours,
      unpaidHours: attendance.unpaidHours,
      leaveUsed,
      lateEarlyLeaveUsed: row.leaveBalance?.lateEarlyUsed ?? 0,
      leaveRemaining: row.leaveBalance?.closing ?? 0,
      annualLeaveHours: attendance.annualLeaveHours,
      benefitLeaveHours: attendance.benefitLeaveHours,
      remoteHours: attendance.remoteHours,
      compLeaveHours: attendance.compLeaveHours,
      correctionHours: attendance.correctionHours,
      otHours: row.ot.totalHours,
      otAmount: row.ot.totalAmount,
      otBuckets: row.ot.bucketBreakdown,
      absentDays: attendance.absentDays,
      overMonthlyLimit: row.ot.overMonthlyLimit,
      // Realtime approved OT (matches Approvals page)
      approvedOtHours: row.approvedOt?.totalHours ?? 0,
      approvedOtBuckets: row.approvedOt?.bucketBreakdown ?? {},
    };
  }), [timesheetResponse]);

  const timesheetTotals = timesheetResponse?.totals;
  const aggregateOtBuckets = useMemo(() => summarizeOtBuckets(timesheetRows), [timesheetRows]);
  const aggregateOtAmount = timesheetRows.reduce((sum, row) => sum + row.otAmount, 0);
  const timesheetGroups = useMemo(() => groupTimesheetRows(timesheetRows), [timesheetRows]);
  const [otPopover, setOtPopover] = useState<OtPopoverState | null>(null);

  const showOtPopover = (
    event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>,
    payload: Pick<OtPopoverState, 'totalHours' | 'totalAmount' | 'buckets'>,
  ) => {
    const width = 320;
    const { top, left } = getFloatingTooltipPosition(event, width, 260);
    setOtPopover({
      ...payload,
      top,
      left,
    });
  };

  const showTimesheet = activeTab === 'timesheet';
  const showSalary = activeTab === 'salary';
  const timesheetEmployeeCount = timesheetRows.length;
  const activePeriodLabel = timesheetResponse?.period.label ?? activePeriod?.label ?? 'Chưa có kỳ lương';
  const timesheetLateEarlyBeforeLeave = (timesheetTotals?.lateHoursBeforeLeave ?? 0) + (timesheetTotals?.earlyHoursBeforeLeave ?? 0);
  const timesheetLateEarlyNet = (timesheetTotals?.lateHours ?? 0) + (timesheetTotals?.earlyHours ?? 0);
  const timesheetLateEarlyOffset = timesheetTotals?.lateEarlyLeaveDeductedHours ?? 0;

  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader title="Bảng lương" subtitle={activePeriodLabel}>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <Dropdown
            options={periodOptions}
            value={activePeriodId}
            onChange={setSelectedPeriodId}
            placeholder="Chọn kỳ lương"
            className="w-56"
          />
          <Button
            variant="outline"
            size="sm"
            icon={Calculator}
            loading={calculateMutation.isPending}
            disabled={!activePeriodId}
            onClick={() => calculateMutation.mutate()}
          >
            Tính lương
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={RefreshCw}
            loading={syncAttendanceMutation.isPending}
            disabled={!activePeriodId || calculateMutation.isPending || closeMutation.isPending}
            onClick={() => syncAttendanceMutation.mutate({ silent: false })}
          >
            Đồng bộ công
          </Button>
          {!showTimesheet && (
            salarySheetStatus?.hasSheet ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  icon={RefreshCw}
                  loading={exportSalarySheetMutation.isPending}
                  disabled={!activePeriodId || rows.length === 0 || loadingSalarySheetStatus}
                  onClick={handleSalarySheetUpdate}
                >
                  Cập nhật sheet
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  icon={ExternalLink}
                  disabled={!salarySheetStatus.larkSheetUrl || loadingSalarySheetStatus}
                  onClick={handleSalarySheetClick}
                >
                  Mở sheet lương
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                icon={Sheet}
                loading={exportSalarySheetMutation.isPending}
                disabled={!activePeriodId || rows.length === 0 || loadingSalarySheetStatus}
                onClick={handleSalarySheetClick}
              >
                Xuất lương
              </Button>
            )
          )}
          <Button
            variant="accent"
            size="sm"
            icon={FileText}
            loading={closeMutation.isPending}
            disabled={!activePeriodId || activePeriod?.status === 'CLOSED'}
            onClick={() => closeMutation.mutate()}
          >
            Chốt công
          </Button>
        </div>
      </PageHeader>

      <div className="flex items-center gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab('timesheet')}
          className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${showTimesheet ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          <BriefcaseBusiness size={15} />
          Tính công
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('salary')}
          className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${showSalary ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          <WalletCards size={15} />
          Bảng lương
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('slips')}
          className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${activeTab === 'slips' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          <ReceiptText size={15} />
          Phiếu lương
        </button>
      </div>

      {showTimesheet ? (
        <>
          {/* Slim summary bar — replace 4 KPI cards */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-5 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <UserRound size={14} className="text-blue-600" />
              <span className="text-xs text-muted-foreground">Nhân sự:</span>
              <span className="text-xs font-bold text-foreground tabular-nums">{timesheetEmployeeCount}</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <CalendarRange size={14} className="text-cyan-600" />
              <span className="text-xs text-muted-foreground">Chuẩn:</span>
              <span className="text-xs font-bold text-foreground tabular-nums">{fmtDays(timesheetTotals?.standardDays ?? 0)}</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <BadgeCheck size={14} className="text-emerald-600" />
              <span className="text-xs text-muted-foreground">Thực tế:</span>
              <span className="text-xs font-bold text-foreground tabular-nums">
                {fmtDays(timesheetTotals?.actualDays ?? 0)}
              </span>
              <span className="text-[10px] text-muted-foreground">({fmtHours(timesheetTotals?.workHours ?? 0)})</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Clock3 size={14} className="text-amber-600" />
              <span className="text-xs text-muted-foreground">Trễ/Sớm:</span>
              <span className="text-xs font-semibold tabular-nums text-amber-600">{fmtHours(timesheetLateEarlyBeforeLeave)}</span>
              {timesheetLateEarlyOffset > 0 && <span className="text-[10px] font-semibold tabular-nums text-blue-600">-{fmtHours(timesheetLateEarlyOffset)}</span>}
              <span className="text-[10px] text-muted-foreground">còn {fmtHours(timesheetLateEarlyNet)}</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Plane size={14} className="text-blue-500" />
              <span className="text-xs text-muted-foreground">Phép dùng:</span>
              <span className="text-xs font-semibold tabular-nums text-foreground">{fmtDays(timesheetTotals?.leaveUsed ?? 0)}</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <TimerReset size={14} className="text-violet-600" />
              <span className="text-xs text-muted-foreground">Tổng OT:</span>
              <OtTotalButton
                totalHours={timesheetTotals?.otHours ?? 0}
                totalAmount={aggregateOtAmount}
                buckets={aggregateOtBuckets}
                compact
                onOpen={showOtPopover}
                onClose={() => setOtPopover(null)}
              />
            </div>
            {(timesheetTotals?.absentDays ?? 0) > 0 && (
              <>
                <div className="h-4 w-px bg-border" />
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} className="text-rose-500" />
                  <span className="text-xs text-muted-foreground">Vắng:</span>
                  <span className="text-xs font-semibold tabular-nums text-rose-600">{fmtDays(timesheetTotals?.absentDays ?? 0)}</span>
                </div>
              </>
            )}
            <div className="h-4 w-px bg-border" />
            {/* Lark Sheet export badge / button */}
            <div className="flex items-center gap-2">
              <Sheet size={14} className="text-green-600" />
              <span className="text-xs text-muted-foreground">Sheet:</span>
              {loadingSheetStatus ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <RefreshCw size={11} className="animate-spin" />
                  Đang kiểm tra...
                </span>
              ) : sheetStatus?.hasSheet ? (
                <span className="inline-flex items-center gap-1">
                  <a
                    href={sheetStatus.larkSheetUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-[11px] font-semibold text-green-700 transition-colors hover:bg-green-100"
                    title="Mở sheet tính công trên Lark"
                  >
                    <BadgeCheck size={12} className="text-green-600" />
                    Đã có sheet
                    <ExternalLink size={10} />
                  </a>
                  <button
                    type="button"
                    title="Cập nhật sheet với dữ liệu mới nhất"
                    disabled={exportSheetMutation.isPending}
                    onClick={() => exportSheetMutation.mutate()}
                    className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-50"
                  >
                    <RefreshCw size={11} className={exportSheetMutation.isPending ? 'animate-spin' : ''} />
                    {exportSheetMutation.isPending ? 'Đang cập nhật...' : 'Cập nhật'}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={!activePeriodId || exportSheetMutation.isPending}
                  onClick={() => exportSheetMutation.mutate()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-[11px] font-semibold text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50"
                >
                  <Sheet size={11} />
                  {exportSheetMutation.isPending ? (
                    <><RefreshCw size={10} className="animate-spin" /> Đang xuất...</>
                  ) : 'Xuất Sheet'}
                </button>
              )}
            </div>
          </div>

          {/* OT Lark Sheet export badge / button */}
          <div className="flex items-center gap-2">
            <Sheet size={14} className="text-orange-500" />
            <span className="text-xs text-muted-foreground">Sheet OT:</span>
            {loadingOtSheetStatus ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <RefreshCw size={11} className="animate-spin" />
                Đang kiểm tra...
              </span>
            ) : otSheetStatus?.hasSheet ? (
              <span className="inline-flex items-center gap-1">
                <a
                  href={otSheetStatus.larkOtSheetUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-[11px] font-semibold text-orange-700 transition-colors hover:bg-orange-100"
                  title="Mở sheet OT trên Lark"
                >
                  <BadgeCheck size={12} className="text-orange-500" />
                  Đã có Sheet OT
                  <ExternalLink size={10} />
                </a>
                <button
                  type="button"
                  title="Cập nhật sheet OT với dữ liệu mới nhất"
                  disabled={exportOtSheetMutation.isPending}
                  onClick={() => exportOtSheetMutation.mutate()}
                  className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-50"
                >
                  <RefreshCw size={11} className={exportOtSheetMutation.isPending ? 'animate-spin' : ''} />
                  {exportOtSheetMutation.isPending ? 'Đang cập nhật...' : 'Cập nhật'}
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={!activePeriodId || exportOtSheetMutation.isPending}
                onClick={() => exportOtSheetMutation.mutate()}
                className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-[11px] font-semibold text-orange-700 transition-colors hover:bg-orange-100 disabled:opacity-50"
              >
                <Sheet size={11} />
                {exportOtSheetMutation.isPending ? (
                  <><RefreshCw size={10} className="animate-spin" /> Đang xuất...</>
                ) : 'Xuất Sheet OT'}
              </button>
            )}
          </div>

          {!activePeriodId ? (
            <EmptyState icon={FileText} title="Chưa có kỳ lương" description="Tạo kỳ lương trong phần Cài đặt để bắt đầu kiểm công." />
          ) : timesheetRows.length === 0 && !loadingTimesheet ? (
            <EmptyState icon={BriefcaseBusiness} title="Chưa có dữ liệu tính công" description="Chạy chốt công để tổng hợp công, phép và OT cho kỳ này." />
          ) : (
            <TimesheetSelfCheckTable
              groups={timesheetGroups}
              loading={loadingTimesheet}
              onOpenOt={showOtPopover}
              onCloseOt={() => setOtPopover(null)}
            />
          )}
          {otPopover && (
            <div
              className="pointer-events-none fixed z-[60]"
              style={{ top: otPopover.top, left: otPopover.left }}
            >
              <OtSegmentsPanel
                totalHours={otPopover.totalHours}
                buckets={otPopover.buckets}
              />
            </div>
          )}
        </>
      ) : showSalary ? (
        <PayrollSalarySection
          rows={rows}
          loading={loadingPayslips}
          summary={summary}
          activePeriodId={activePeriodId}
          onSaveEdit={async (row, payload) => {
            await editPayslipMutation.mutateAsync({ row, payload });
          }}
          savingEdit={editPayslipMutation.isPending}
        />
      ) : (
        <PayslipSlipSection
          rows={rows}
          loading={loadingPayslips}
          activePeriod={activePeriod}
          baseRecords={payslipBaseResponse?.data ?? []}
          baseMeta={payslipBaseResponse?.meta}
          loadingBase={loadingPayslipBase}
          onGeneratePdf={(row, note) => payslipPdfMutation.mutate({ row, note })}
          onPreviewPdf={(row, note) => payslipPreviewMutation.mutateAsync({ row, note })}
          onSaveHrNote={(row, note) => payslipHrNoteMutation.mutateAsync({ row, note }).then(() => undefined)}
          generatingPdf={payslipPdfMutation.isPending}
          previewingPdf={payslipPreviewMutation.isPending}
          savingHrNote={payslipHrNoteMutation.isPending}
        />
      )}
    </motion.div>
  );
}
