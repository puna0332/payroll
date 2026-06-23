import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  ArrowLeft, Save, User, Wallet, ShieldCheck, Receipt,
  Briefcase, Mail, Phone, Calendar, Hash, Building2,
  ClipboardList, FileSpreadsheet, Clock, TrendingUp,
  AlertCircle, CheckCircle2, Loader2, ChevronDown, Edit3, History,
  TreePalm, ChevronLeft, ChevronRight, Check, Calculator,
  CircleDollarSign,
} from 'lucide-react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, StatusBadge, LoadingSkeleton } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import api from '@/services/api';

// ─── Types ──────────────────────────────────────────────────

interface SalaryPolicyData {
  offerSalary: number; ratio: number; baseSalary: number;
  rankAllowance: number; bpqlAllowance: number; salesAllowance: number;
  technicalAllowance: number; languageAllowance: number; housingAllowance: number;
  transportAllowance: number; mealAllowance: number; phoneAllowance: number;
  attendanceAllowance: number; dailyRate: number; hourlyRate: number;
}

interface InsurancePolicyData {
  insuranceBasis: number;
  bhxhEmployee: number; bhytEmployee: number; bhtnEmployee: number; totalEmployee: number;
  bhxhEmployer: number; bhytEmployer: number; bhtnEmployer: number; totalEmployer: number;
  grandTotal: number;
}

interface TaxPolicyData {
  personalDeduction: number; dependents: number; dependentDeduction: number; taxCode: string;
}

interface PeriodRef {
  id: string; label: string; monthKey: string; status: string;
  periodStart: string; periodEnd: string;
}

interface AttendanceRecord {
  id: string; standardDays: number; actualDays: number; absentDays: number;
  workHours: number; lateHours: number; earlyHours: number;
  annualLeaveHours: number; benefitLeaveHours: number; remoteHours: number;
  compLeaveHours: number; correctionHours: number;
  period: PeriodRef;
}

interface PayslipRecord {
  id: string; standardDays: number; actualDays: number; workRatio: number;
  baseSalary: number; actualSalary: number; allowancesTotal: number;
  otTotalHours: number; otTotalAmount: number; lateDeduction: number;
  grossIncome: number; insuranceEmployee: number; insuranceEmployer: number;
  taxExempt: number; taxableIncome: number; pitAmount: number;
  afterTaxAdjustment: number; unionFee: number; netSalary: number; status: string;
  fullBreakdown?: {
    insurance?: {
      insuranceBasis?: number;
      basisBhxhBhyt?: number; basisBhtn?: number;
      employee?: { bhxh?: number; bhyt?: number; bhtn?: number; total?: number };
      employer?: { bhxh?: number; bhyt?: number; bhtn?: number; total?: number };
    };
    taxExemptions?: { ot?: number; meal?: number; phone?: number; total?: number };
    allowances?: Record<string, number>;
    manualOverrides?: Record<string, unknown>;
    manualEditLogs?: Array<Record<string, unknown>>;
  } | null;
  period: PeriodRef;
}

interface LeaveBalanceRecord {
  id: string; monthKey: string;
  opening: number; accrued: number; used: number;
  adjustment: number; seniorityBonus: number; closing: number;
}

interface EmployeeFullData {
  id: string; userId: string; fullName: string; department: string;
  position: string; scheduleType: string; employmentType: string;
  joinDate: string | null; leaveDate: string | null; status: string;
  email: string | null; mobile: string | null;
  openId: string | null; unionId: string | null;
  larkMetadata: Record<string, unknown> | null;
  salaryPolicies: SalaryPolicyData[];
  insurancePolicies: InsurancePolicyData[];
  taxPolicies: TaxPolicyData[];
  monthlyAttendances: AttendanceRecord[];
  leaveBalances: LeaveBalanceRecord[];
  payslips: PayslipRecord[];
}

// ─── Helpers ────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('vi-VN');
const fmtDec = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtCurrency = (n: number) => fmt.format(Math.round(n));
const fmtNum = (n: number) => fmtDec.format(n);
const fmtMoneyInput = (n: number) => (Number.isFinite(n) ? fmt.format(Math.round(n)) : '');
const fmtDecimalInput = (n: number) => (Number.isFinite(n) ? fmtDec.format(n) : '');
const parseLocalizedNumber = (value: string): number => {
  const normalized = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};
const monthKeyToPolicyKey = (monthKey?: string) => {
  if (!monthKey || monthKey.length < 6) return new Date().toISOString().slice(0, 7);
  return `${monthKey.slice(0, 4)}-${monthKey.slice(4, 6)}`;
};
const fmtDate = (d: string | Date | null | undefined): string => {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const fmtTimeVn = (d: string | Date | null | undefined): string => {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};
const toNum = (v: unknown): number => Number(v) || 0;
const fmtMonthKey = (mk: string): string => {
  if (mk.length === 6) return `Tháng ${mk.slice(4)}/${mk.slice(0, 4)}`;
  return mk;
};

const stagger: { container: Variants; item: Variants } = {
  container: { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.04 } } },
  item: { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { type: 'spring', damping: 25, stiffness: 300 } } },
};

// ─── Tab definitions ────────────────────────────────────────

type TabKey = 'info' | 'salary' | 'insurance' | 'tax' | 'leave' | 'attendance' | 'payslips' | 'history';

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'info', label: 'Thông tin', icon: User },
  { key: 'salary', label: 'Lương & Phụ cấp', icon: Wallet },
  { key: 'insurance', label: 'Bảo hiểm', icon: ShieldCheck },
  { key: 'tax', label: 'Thuế TNCN', icon: Receipt },
  { key: 'leave', label: 'Phép năm', icon: TreePalm },
  { key: 'attendance', label: 'Chấm công', icon: ClipboardList },
  { key: 'payslips', label: 'Bảng lương', icon: FileSpreadsheet },
  { key: 'history', label: 'Lịch sử', icon: History },
];

type BusinessNumberField<T> = {
  key: keyof T;
  label: string;
  hint?: string;
  decimal?: boolean;
  disabled?: boolean;
};

// ─── Custom Select Dropdown Component ────────────────────────
interface SelectOption {
  value: string;
  label: string;
}

function CustomSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: SelectOption[];
  onChange: (val: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((o) => o.value === value);

  const selectRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={selectRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full bg-background border border-input rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer transition-all hover:bg-muted/10 shadow-sm"
      >
        <span className="truncate font-semibold text-gray-700">{selectedOption?.label || value}</span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 shrink-0 ml-1 ${isOpen ? 'rotate-180 text-primary' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg shadow-black/5 p-1 max-h-[220px] overflow-y-auto backdrop-blur-md"
          >
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`flex items-center justify-between w-full text-left px-3 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-primary/10 text-primary'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                  }`}
                >
                  <span>{opt.label}</span>
                  {isSelected && <Check size={12} className="text-primary" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════

export default function EmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('info');

  // ── Fetch full employee data ──────────────────────────────
  const { data: employee, isLoading } = useQuery<EmployeeFullData>({
    queryKey: ['employee-full', id],
    queryFn: async () => {
      const { data } = await api.get<EmployeeFullData>(`/employees/${id}/full`);
      return data;
    },
    enabled: !!id,
  });

  // ── Fetch settings ────────────────────────────────────────
  const { data: settingsRes } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data } = await api.get('/settings');
      return data;
    },
  });
  const { data: payrollPeriods = [] } = useQuery<PeriodRef[]>({
    queryKey: ['periods'],
    queryFn: async () => {
      const { data } = await api.get<PeriodRef[]>('/periods');
      return data;
    },
  });

  const settingsMap = useMemo(() => {
    const m: Record<string, string> = {};
    const activeSettings = (settingsRes as Record<string, unknown>)?.activeSettings;
    if (Array.isArray(activeSettings)) {
      for (const s of activeSettings) {
        m[`${s.category}.${s.key}`] = s.value;
      }
    }
    return m;
  }, [settingsRes]);

  // ── Form states ───────────────────────────────────────────
  const defaultSalary: SalaryPolicyData = {
    offerSalary: 0, ratio: 1, baseSalary: 0,
    rankAllowance: 0, bpqlAllowance: 0, salesAllowance: 0,
    technicalAllowance: 0, languageAllowance: 0, housingAllowance: 0,
    transportAllowance: 0, mealAllowance: 0, phoneAllowance: 0,
    attendanceAllowance: 0, dailyRate: 0, hourlyRate: 0,
  };
  const [salaryForm, setSalaryForm] = useState<SalaryPolicyData>(defaultSalary);

  const defaultInsurance: InsurancePolicyData = {
    insuranceBasis: 0,
    bhxhEmployee: 0, bhytEmployee: 0, bhtnEmployee: 0, totalEmployee: 0,
    bhxhEmployer: 0, bhytEmployer: 0, bhtnEmployer: 0, totalEmployer: 0,
    grandTotal: 0,
  };
  const [insuranceForm, setInsuranceForm] = useState<InsurancePolicyData>(defaultInsurance);

  const defaultTax: TaxPolicyData = {
    personalDeduction: 11000000, dependents: 0, dependentDeduction: 0, taxCode: '',
  };
  const [taxForm, setTaxForm] = useState<TaxPolicyData>(defaultTax);

  // ── Hydrate forms ─────────────────────────────────────────
  useEffect(() => {
    if (!employee) return;
    const sp = employee.salaryPolicies?.[0];
    const latest = employee.payslips?.[0];
    const latestAllowances = latest?.fullBreakdown?.allowances ?? {};
    const shouldUsePayslipSalary = !sp || (toNum(sp.baseSalary) === 0 && toNum(latest?.baseSalary) > 0);
    if (shouldUsePayslipSalary) {
      const baseSalary = toNum(latest?.baseSalary);
      const standardDays = toNum(latest?.standardDays);
      const dailyRate = standardDays > 0 ? Math.round(baseSalary / standardDays) : 0;
      setSalaryForm({
        ...defaultSalary,
        offerSalary: baseSalary,
        baseSalary,
        rankAllowance: toNum(latestAllowances.rank),
        bpqlAllowance: 0,
        salesAllowance: 0,
        technicalAllowance: toNum(latestAllowances.technical),
        languageAllowance: toNum(latestAllowances.language),
        housingAllowance: toNum(latestAllowances.housing),
        transportAllowance: toNum(latestAllowances.transport),
        mealAllowance: toNum(latestAllowances.meal),
        phoneAllowance: toNum(latestAllowances.phone),
        attendanceAllowance: toNum(latestAllowances.attendance),
        dailyRate,
        hourlyRate: dailyRate > 0 ? Math.round(dailyRate / 8) : 0,
      });
    } else if (sp) {
      setSalaryForm(Object.fromEntries(Object.keys(defaultSalary).map(k => [k, toNum((sp as unknown as Record<string, unknown>)[k])])) as unknown as SalaryPolicyData);
    }
    const ip = employee.insurancePolicies?.[0];
    const latestInsurance = latest?.fullBreakdown?.insurance;
    const shouldUsePayslipInsurance = !ip || (toNum(ip.insuranceBasis) === 0 && toNum(latestInsurance?.insuranceBasis ?? latestInsurance?.basisBhxhBhyt) > 0);
    if (shouldUsePayslipInsurance) {
      const employeeInsurance = latestInsurance?.employee ?? {};
      const employerInsurance = latestInsurance?.employer ?? {};
      setInsuranceForm({
        insuranceBasis: toNum(latestInsurance?.insuranceBasis ?? latestInsurance?.basisBhxhBhyt),
        bhxhEmployee: toNum(employeeInsurance.bhxh),
        bhytEmployee: toNum(employeeInsurance.bhyt),
        bhtnEmployee: toNum(employeeInsurance.bhtn),
        totalEmployee: toNum(employeeInsurance.total),
        bhxhEmployer: toNum(employerInsurance.bhxh),
        bhytEmployer: toNum(employerInsurance.bhyt),
        bhtnEmployer: toNum(employerInsurance.bhtn),
        totalEmployer: toNum(employerInsurance.total),
        grandTotal: toNum(employeeInsurance.total) + toNum(employerInsurance.total),
      });
    } else if (ip) {
      setInsuranceForm(Object.fromEntries(Object.keys(defaultInsurance).map(k => [k, toNum((ip as unknown as Record<string, unknown>)[k])])) as unknown as InsurancePolicyData);
    }
    const tp = employee.taxPolicies?.[0];
    if (tp) setTaxForm({
      personalDeduction: toNum(tp.personalDeduction),
      dependents: toNum(tp.dependents),
      dependentDeduction: toNum(tp.dependentDeduction),
      taxCode: (tp as unknown as Record<string, unknown>).taxCode as string || '',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee]);

  // ── Auto-calculate insurance ──────────────────────────────
  useEffect(() => {
    const basis = insuranceForm.insuranceBasis;
    if (!basis) return;
    const rates = {
      bhxhEmp: toNum(settingsMap['insurance.bhxh_employee_rate']) || 8,
      bhytEmp: toNum(settingsMap['insurance.bhyt_employee_rate']) || 1.5,
      bhtnEmp: toNum(settingsMap['insurance.bhtn_employee_rate']) || 1,
      bhxhEr: toNum(settingsMap['insurance.bhxh_employer_rate']) || 17.5,
      bhytEr: toNum(settingsMap['insurance.bhyt_employer_rate']) || 3,
      bhtnEr: toNum(settingsMap['insurance.bhtn_employer_rate']) || 1,
    };
    const calc = (r: number) => Math.round(basis * r / 100);
    const emp = { bhxh: calc(rates.bhxhEmp), bhyt: calc(rates.bhytEmp), bhtn: calc(rates.bhtnEmp) };
    const er = { bhxh: calc(rates.bhxhEr), bhyt: calc(rates.bhytEr), bhtn: calc(rates.bhtnEr) };
    setInsuranceForm(prev => ({
      ...prev,
      bhxhEmployee: emp.bhxh, bhytEmployee: emp.bhyt, bhtnEmployee: emp.bhtn,
      totalEmployee: emp.bhxh + emp.bhyt + emp.bhtn,
      bhxhEmployer: er.bhxh, bhytEmployer: er.bhyt, bhtnEmployer: er.bhtn,
      totalEmployer: er.bhxh + er.bhyt + er.bhtn,
      grandTotal: emp.bhxh + emp.bhyt + emp.bhtn + er.bhxh + er.bhyt + er.bhtn,
    }));
  }, [insuranceForm.insuranceBasis, settingsMap]);

  // ── Mutations ─────────────────────────────────────────────
  const refreshPayrollViews = () => {
    queryClient.invalidateQueries({ queryKey: ['employee-full', id] });
    queryClient.invalidateQueries({ queryKey: ['payroll'] });
    queryClient.invalidateQueries({ queryKey: ['payroll-summary'] });
    queryClient.invalidateQueries({ queryKey: ['employee-history', id] });
  };

  const salaryMutation = useMutation({
    mutationFn: (data: SalaryPolicyData) => api.put(`/employees/${id}/salary`, data),
    onSuccess: () => { toast('success', 'Đã lưu lương/phụ cấp và tính lại bảng lương.'); refreshPayrollViews(); },
    onError: (err) => toast('error', `Lỗi: ${(err as Error).message}`),
  });

  const insuranceMutation = useMutation({
    mutationFn: (data: InsurancePolicyData) => api.put(`/employees/${id}/insurance`, data),
    onSuccess: () => { toast('success', 'Đã lưu bảo hiểm và tính lại bảng lương.'); refreshPayrollViews(); },
    onError: (err) => toast('error', `Lỗi: ${(err as Error).message}`),
  });

  const taxMutation = useMutation({
    mutationFn: (data: TaxPolicyData) => api.put(`/employees/${id}/tax`, data),
    onSuccess: () => { toast('success', 'Đã lưu thuế TNCN và tính lại bảng lương.'); refreshPayrollViews(); },
    onError: (err) => toast('error', `Lỗi: ${(err as Error).message}`),
  });

  // ── Info form state for inline editing ─────────────────────
  const [infoForm, setInfoForm] = useState({
    fullName: '', position: '', department: '', email: '', mobile: '',
    employmentType: '', scheduleType: '', status: '',
    probationStart: '', probationEnd: '',
  });
  const [infoEditing, setInfoEditing] = useState<string | null>(null);
  const [infoDirty, setInfoDirty] = useState(false);

  useEffect(() => {
    if (!employee) return;
    const metadata = (employee.larkMetadata as Record<string, unknown>) || {};
    setInfoForm({
      fullName: employee.fullName,
      position: employee.position,
      department: employee.department,
      email: employee.email || '',
      mobile: employee.mobile || '',
      employmentType: employee.employmentType,
      scheduleType: employee.scheduleType,
      status: employee.status,
      probationStart: (metadata.probationStart as string) || '',
      probationEnd: (metadata.probationEnd as string) || '',
    });
    setInfoDirty(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee]);

  const infoMutation = useMutation({
    mutationFn: (data: typeof infoForm) => {
      if (data.employmentType === 'P' && (!data.probationStart || !data.probationEnd)) {
        throw new Error('Nhân sự thử việc cần có đủ thời gian thử việc từ ngày/đến ngày.');
      }
      if (data.probationStart && data.probationEnd && data.probationEnd < data.probationStart) {
        throw new Error('Ngày kết thúc thử việc không được trước ngày bắt đầu.');
      }
      const metadata = {
        ...(employee?.larkMetadata as Record<string, unknown> || {}),
        probationStart: data.probationStart,
        probationEnd: data.probationEnd,
      };
      const payload = {
        fullName: data.fullName,
        position: data.position,
        department: data.department,
        email: data.email,
        mobile: data.mobile,
        employmentType: data.employmentType,
        scheduleType: data.scheduleType,
        status: data.status,
        larkMetadata: metadata,
      };
      return api.put(`/employees/${id}`, payload);
    },
    onSuccess: () => {
      toast('success', 'Cập nhật thông tin thành công!');
      refreshPayrollViews();
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setInfoEditing(null);
      setInfoDirty(false);
    },
    onError: (err) => toast('error', `Lỗi: ${(err as Error).message}`),
  });

  const updateInfoField = (key: string, value: string) => {
    setInfoForm(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'employmentType' && value === 'P' && !next.probationStart && employee?.joinDate) {
        next.probationStart = employee.joinDate.slice(0, 10);
      }
      return next;
    });
    setInfoDirty(true);
  };

  // ── Loading ───────────────────────────────────────────────
  if (isLoading || !employee) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/employees')}>Quay lại</Button>
        </div>
        <LoadingSkeleton type="card" rows={6} />
        <LoadingSkeleton type="card" rows={8} />
      </motion.div>
    );
  }

  const meta = employee.larkMetadata as Record<string, unknown> | null;
  const avatarUrl = meta?.avatarUrl as string | undefined;
  const displayEmployeeCode = employee.userId;
  const statusLabel = employee.status === 'ACTIVE' ? 'Đang làm' : 'Nghỉ việc';
  const statusKey = employee.status === 'ACTIVE' ? 'active' : 'failed';

  type InfoField = {
    label: string; icon: React.ElementType; fieldKey: string;
    value: string; editType: 'text' | 'select' | 'date' | 'readonly';
    note?: string;
    options?: Array<{ value: string; label: string }>;
  };

  const infoFields: InfoField[] = [
    { label: 'Mã nhân viên', value: displayEmployeeCode, icon: Hash, fieldKey: '', editType: 'readonly', note: 'Chỉnh sửa ở Lark Admin' },
    { label: 'Họ tên', value: infoForm.fullName, icon: User, fieldKey: 'fullName', editType: 'text' },
    { label: 'Email', value: infoForm.email, icon: Mail, fieldKey: 'email', editType: 'text' },
    { label: 'Số điện thoại', value: infoForm.mobile, icon: Phone, fieldKey: 'mobile', editType: 'text' },
    { label: 'Chức vụ', value: infoForm.position, icon: Briefcase, fieldKey: 'position', editType: 'text' },
    { label: 'Phòng ban', value: infoForm.department, icon: Building2, fieldKey: 'department', editType: 'text' },
    { label: 'Ngày vào', value: fmtDate(employee.joinDate), icon: Calendar, fieldKey: '', editType: 'readonly' },
    { label: 'Loại HĐ', value: infoForm.employmentType, icon: Briefcase, fieldKey: 'employmentType', editType: 'select',
      options: [
        { value: 'FT', label: 'Chính thức' }, { value: 'PT', label: 'Bán thời gian' },
        { value: 'P', label: 'Thử việc' }, { value: 'M', label: 'Quản lý' },
      ]
    },
    { label: 'Lịch làm việc', value: infoForm.scheduleType, icon: Calendar, fieldKey: 'scheduleType', editType: 'select',
      options: [
        { value: 'OFFICE', label: 'Hành chính' }, { value: 'SIX_DAY', label: '6 ngày/tuần' },
      ]
    },
    { label: 'Trạng thái', value: infoForm.status, icon: CheckCircle2, fieldKey: 'status', editType: 'select',
      options: [
        { value: 'ACTIVE', label: 'Đang làm' }, { value: 'INACTIVE', label: 'Nghỉ việc' },
      ]
    },
  ];

  infoFields.push(
    { label: infoForm.employmentType === 'P' ? 'Thử việc từ ngày *' : 'Thử việc từ ngày', value: infoForm.probationStart, icon: Calendar, fieldKey: 'probationStart', editType: 'date' },
    { label: infoForm.employmentType === 'P' ? 'Thử việc đến ngày *' : 'Thử việc đến ngày', value: infoForm.probationEnd, icon: Calendar, fieldKey: 'probationEnd', editType: 'date' }
  );

  // ── Derived display helpers ───────────────────────────────
  const displayVal = (f: InfoField) => {
    if (f.editType === 'readonly') return f.value || '—';
    if (f.editType === 'date') return fmtDate(f.value);
    if (f.editType === 'select' && f.options) {
      const opt = f.options.find(o => o.value === f.value);
      return opt?.label || f.value || '—';
    }
    return f.value || '—';
  };

  // ── Render helpers ────────────────────────────────────────
  const latestPayslip = employee.payslips?.[0];
  const editablePolicyPeriod = payrollPeriods.find(p => p.status === 'OPEN') ?? latestPayslip?.period;
  const policyPeriodKey = monthKeyToPolicyKey(editablePolicyPeriod?.monthKey);
  const latestPeriodLabel = editablePolicyPeriod?.label ?? fmtMonthKey(policyPeriodKey.replace('-', ''));
  const salaryWithPeriod = { ...salaryForm, periodKey: policyPeriodKey, bpqlAllowance: 0, salesAllowance: 0 };
  const insuranceWithPeriod = { ...insuranceForm, periodKey: policyPeriodKey };
  const taxWithPeriod = { ...taxForm, periodKey: policyPeriodKey };
  const allowancesTotal =
    toNum(salaryForm.rankAllowance) + toNum(salaryForm.technicalAllowance) + toNum(salaryForm.languageAllowance) +
    toNum(salaryForm.housingAllowance) + toNum(salaryForm.transportAllowance) + toNum(salaryForm.mealAllowance) +
    toNum(salaryForm.phoneAllowance) + toNum(salaryForm.attendanceAllowance);
  const grossPreview = toNum(salaryForm.baseSalary) + allowancesTotal;
  const employeeInsurance = latestPayslip?.fullBreakdown?.insurance?.employee;
  const employerInsurance = latestPayslip?.fullBreakdown?.insurance?.employer;
  const totalDeduction = toNum(latestPayslip?.insuranceEmployee) + toNum(latestPayslip?.pitAmount) + toNum(latestPayslip?.unionFee);

  const salaryIncomeFields: BusinessNumberField<SalaryPolicyData>[] = [
    { key: 'offerSalary', label: 'Lương offer', hint: 'Mức offer trong hồ sơ nhân sự' },
    { key: 'ratio', label: 'Hệ số lương', hint: 'Hệ số theo chính sách nội bộ', decimal: true },
    { key: 'baseSalary', label: 'Lương cơ bản', hint: 'Cột Basic salary trong bảng lương' },
    { key: 'rankAllowance', label: 'Phụ cấp cấp bậc', hint: 'Position allowance' },
    { key: 'bpqlAllowance', label: 'Phụ cấp BPQL', hint: 'Theo chính sách hiện tại luôn bằng 0', disabled: true },
    { key: 'salesAllowance', label: 'Phụ cấp kinh doanh', hint: 'Theo chính sách hiện tại luôn bằng 0', disabled: true },
    { key: 'technicalAllowance', label: 'Phụ cấp kỹ thuật', hint: 'Technical allowance' },
    { key: 'languageAllowance', label: 'Phụ cấp ngoại ngữ', hint: 'Foreign language allowance' },
    { key: 'housingAllowance', label: 'Phụ cấp nhà ở', hint: 'Apartment allowance' },
    { key: 'transportAllowance', label: 'Phụ cấp đi lại', hint: 'Commuting allowance' },
    { key: 'mealAllowance', label: 'Phụ cấp ăn uống', hint: 'Meal allowance' },
    { key: 'phoneAllowance', label: 'Phụ cấp điện thoại', hint: 'Telephone allowance' },
    { key: 'attendanceAllowance', label: 'Phụ cấp chuyên cần', hint: 'Attendance allowance' },
    { key: 'dailyRate', label: 'Lương ngày', hint: 'Dùng đối chiếu bảng lương' },
    { key: 'hourlyRate', label: 'Lương giờ', hint: 'Dùng tính OT' },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }} className="space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/employees')}>Quay lại</Button>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-5">
          {avatarUrl ? (
            <img src={avatarUrl} alt={employee.fullName}
              className="w-[72px] h-[72px] rounded-full object-cover shrink-0 border-2 border-border"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="w-[72px] h-[72px] rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl font-bold shrink-0">
              {employee.fullName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">{employee.fullName}</h1>
              <StatusBadge status={statusKey} label={statusLabel} />
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{employee.department} — {employee.position}</p>
            <div className="flex items-center gap-4 mt-1 text-[11px] text-muted-foreground">
              <span>#{displayEmployeeCode}</span>
              {employee.email && <span>{employee.email}</span>}
              {employee.joinDate && <span>Vào: {fmtDate(employee.joinDate)}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-muted/30 rounded-xl p-1 border border-border overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          const count = tab.key === 'attendance' ? employee.monthlyAttendances?.length
            : tab.key === 'payslips' ? employee.payslips?.length
            : tab.key === 'leave' ? employee.leaveBalances?.length : undefined;
          return (
            <motion.button key={tab.key} whileTap={{ scale: 0.97 }} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/25'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}>
              <Icon size={15} />
              {tab.label}
              {count !== undefined && count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${
                  isActive ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground'
                }`}>{count}</span>
              )}
            </motion.button>
          );
        })}
      </div>

      {/* ── Tab Content ─────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>

          {/* ─── Thông tin cơ bản (Single Edit Button) ─────────── */}
          {activeTab === 'info' && (
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <User size={18} className="text-primary" /> Thông tin cơ bản
                  </h3>
                  <div className="flex items-center gap-2">
                    {infoDirty && (
                      <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                        className="text-[10px] text-warning font-medium px-2 py-1 rounded-full bg-warning/10">
                        Chưa lưu
                      </motion.span>
                    )}
                    {infoEditing ? (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => {
                          setInfoEditing(null);
                          // Reset form to original
                          if (employee) {
                            const metadata = (employee.larkMetadata as Record<string, unknown>) || {};
                            setInfoForm({
                              fullName: employee.fullName,
                              position: employee.position,
                              department: employee.department,
                              email: employee.email || '',
                              mobile: employee.mobile || '',
                              employmentType: employee.employmentType,
                              scheduleType: employee.scheduleType,
                              status: employee.status,
                              probationStart: (metadata.probationStart as string) || '',
                              probationEnd: (metadata.probationEnd as string) || '',
                            });
                            setInfoDirty(false);
                          }
                        }}>Hủy</Button>
                        <Button variant="primary" size="sm" icon={Save} loading={infoMutation.isPending}
                          disabled={!infoDirty} onClick={() => infoMutation.mutate(infoForm)}>
                          Lưu thay đổi
                        </Button>
                      </>
                    ) : (
                      <Button variant="outline" size="sm" icon={Edit3}
                        onClick={() => setInfoEditing('all')}>
                        Chỉnh sửa
                      </Button>
                    )}
                  </div>
                </div>
                <motion.div variants={stagger.container} initial="hidden" animate="show"
                  className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {infoFields.map(f => {
                    const Icon = f.icon;
                    const isEditMode = infoEditing === 'all' && f.editType !== 'readonly';

                    return (
                      <motion.div key={f.label} variants={stagger.item}
                        className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all ${
                          isEditMode
                            ? 'bg-primary/3 border-primary/20'
                            : 'bg-muted/30 border-border/30'
                        }`}>
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          isEditMode ? 'bg-primary/15' : 'bg-primary/8'
                        }`}>
                          <Icon size={15} className="text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                            {f.label}
                          </p>

                          {isEditMode ? (
                            <div className="mt-1">
                              {f.editType === 'select' ? (
                                <CustomSelect value={f.value} options={f.options || []}
                                  onChange={val => updateInfoField(f.fieldKey, val)} />
                              ) : f.editType === 'date' ? (
                                <input type="date" value={f.value}
                                  onChange={e => updateInfoField(f.fieldKey, e.target.value)}
                                  className="w-full bg-background border border-input rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer" />
                              ) : (
                                <input type="text" value={f.value}
                                  onChange={e => updateInfoField(f.fieldKey, e.target.value)}
                                  className="w-full bg-background border border-input rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
                              )}
                            </div>
                          ) : (
                            <p className="text-sm font-medium text-foreground mt-0.5 break-all">
                              {displayVal(f)}
                            </p>
                          )}
                          {f.note && (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {f.note}
                            </p>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </motion.div>
              </div>
            </div>
          )}

          {/* ─── Lương & Phụ cấp ──────────────────────────── */}
          {activeTab === 'salary' && (
            <div className="space-y-4">
              <PayrollSnapshot
                title="Tóm tắt theo bảng lương"
                periodLabel={latestPeriodLabel}
                items={[
                  { label: 'Tổng thu nhập', value: toNum(latestPayslip?.grossIncome), tone: 'primary' },
                  { label: 'Lương thực nhận', value: toNum(latestPayslip?.netSalary), tone: 'success' },
                  { label: 'Lương tính công', value: toNum(latestPayslip?.actualSalary) },
                  { label: 'Phụ cấp đã tính', value: toNum(latestPayslip?.allowancesTotal) },
                  { label: 'OT tính lương', value: toNum(latestPayslip?.otTotalAmount) },
                  { label: 'Khấu trừ', value: totalDeduction, tone: 'danger' },
                ]}
              />

              <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                      <Wallet size={18} className="text-primary" /> Lương & phụ cấp
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Lưu vào chính sách kỳ {latestPeriodLabel}; bảng lương sẽ tự chạy lại gross, BH, PIT và net.
                    </p>
                  </div>
                  <Button variant="primary" size="sm" icon={Save} loading={salaryMutation.isPending}
                    onClick={() => salaryMutation.mutate(salaryWithPeriod)}>
                    Lưu & tính lại
                  </Button>
                </div>

                <PolicySection
                  title="Thu nhập hàng tháng"
                  subtitle="Monthly income (gross)"
                  icon={CircleDollarSign}
                  fields={salaryIncomeFields}
                  form={salaryForm}
                  onChange={(key, value) => {
                    setSalaryForm(prev => ({
                      ...prev,
                      [key]: value,
                      bpqlAllowance: 0,
                      salesAllowance: 0,
                    }));
                  }}
                />

                <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <BusinessMetric label="Tổng phụ cấp nhập vào" value={allowancesTotal} />
                  <BusinessMetric label="Lương cơ bản + phụ cấp" value={grossPreview} />
                  <BusinessMetric label="Bảng lương đang áp dụng" value={toNum(latestPayslip?.grossIncome)} tone="primary" />
                </div>
              </div>
            </div>
          )}

          {/* ─── Bảo hiểm ────────────────────────────────── */}
          {activeTab === 'insurance' && (
            <div className="space-y-4">
              <PayrollSnapshot
                title="Bảo hiểm đang tính trong bảng lương"
                periodLabel={latestPeriodLabel}
                items={[
                  { label: 'BH NLĐ', value: toNum(latestPayslip?.insuranceEmployee), tone: 'danger' },
                  { label: 'BH công ty', value: toNum(latestPayslip?.insuranceEmployer), tone: 'warning' },
                  { label: 'Basis BHXH/BHYT', value: toNum(latestPayslip?.fullBreakdown?.insurance?.basisBhxhBhyt) },
                  { label: 'Basis BHTN', value: toNum(latestPayslip?.fullBreakdown?.insurance?.basisBhtn) },
                ]}
              />

              <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                      <ShieldCheck size={18} className="text-primary" /> Bảo hiểm
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Nhập basis, hệ thống tính lại phần người lao động và doanh nghiệp theo tỷ lệ hiện hành.
                    </p>
                  </div>
                  <Button variant="primary" size="sm" icon={Save} loading={insuranceMutation.isPending}
                    onClick={() => insuranceMutation.mutate(insuranceWithPeriod)}>
                    Lưu & tính lại
                  </Button>
                </div>
                <div className="max-w-xl mb-5">
                  <BusinessNumberInput
                    label="Lương đóng BHXH/BHYT/BHTN"
                    hint="Salary for social, medical, unemployment insurance calculate"
                    value={insuranceForm.insuranceBasis}
                    onChange={(value) => setInsuranceForm(prev => ({ ...prev, insuranceBasis: value }))}
                  />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <InsuranceSection title="Người lao động" items={[
                    { label: `BHXH (${settingsMap['insurance.bhxh_employee_rate'] || '8'}%)`, value: employeeInsurance?.bhxh ?? insuranceForm.bhxhEmployee },
                    { label: `BHYT (${settingsMap['insurance.bhyt_employee_rate'] || '1.5'}%)`, value: employeeInsurance?.bhyt ?? insuranceForm.bhytEmployee },
                    { label: `BHTN (${settingsMap['insurance.bhtn_employee_rate'] || '1'}%)`, value: employeeInsurance?.bhtn ?? insuranceForm.bhtnEmployee },
                  ]} total={toNum(employeeInsurance?.total) || insuranceForm.totalEmployee} />
                  <InsuranceSection title="Doanh nghiệp" items={[
                    { label: `BHXH (${settingsMap['insurance.bhxh_employer_rate'] || '17.5'}%)`, value: employerInsurance?.bhxh ?? insuranceForm.bhxhEmployer },
                    { label: `BHYT (${settingsMap['insurance.bhyt_employer_rate'] || '3'}%)`, value: employerInsurance?.bhyt ?? insuranceForm.bhytEmployer },
                    { label: `BHTN (${settingsMap['insurance.bhtn_employer_rate'] || '1'}%)`, value: employerInsurance?.bhtn ?? insuranceForm.bhtnEmployer },
                  ]} total={toNum(employerInsurance?.total) || insuranceForm.totalEmployer} />
                </div>
              </div>
            </div>
          )}

          {/* ─── Thuế TNCN ───────────────────────────────── */}
          {activeTab === 'tax' && (
            <div className="space-y-4">
              <PayrollSnapshot
                title="Thuế đang tính trong bảng lương"
                periodLabel={latestPeriodLabel}
                items={[
                  { label: 'Thu nhập tính thuế', value: toNum(latestPayslip?.taxableIncome), tone: 'primary' },
                  { label: 'Thuế TNCN', value: toNum(latestPayslip?.pitAmount), tone: 'danger' },
                  { label: 'Thu nhập miễn thuế', value: toNum(latestPayslip?.taxExempt) },
                  { label: 'Điều chỉnh sau thuế', value: toNum(latestPayslip?.afterTaxAdjustment) },
                ]}
              />

              <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                      <Receipt size={18} className="text-primary" /> Thuế TNCN
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Các giảm trừ này dùng trực tiếp khi tính PIT cho bảng lương kỳ {latestPeriodLabel}.
                    </p>
                  </div>
                  <Button variant="primary" size="sm" icon={Save} loading={taxMutation.isPending}
                    onClick={() => taxMutation.mutate(taxWithPeriod)}>
                    Lưu & tính lại
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <BusinessNumberInput
                    label="Giảm trừ gia cảnh"
                    hint="Personal deduction"
                    value={taxForm.personalDeduction}
                    onChange={(value) => setTaxForm(prev => ({ ...prev, personalDeduction: value }))}
                  />
                  <BusinessNumberInput
                    label="Số người phụ thuộc"
                    hint="Dependents registration persons"
                    value={taxForm.dependents}
                    decimal
                    onChange={(value) => {
                      const deps = Math.max(0, Math.trunc(value));
                      const rate = toNum(settingsMap['tax.dependent_deduction']) || 4400000;
                      setTaxForm(prev => ({ ...prev, dependents: deps, dependentDeduction: deps * rate }));
                    }}
                  />
                  <BusinessNumberInput
                    label="Giảm trừ người phụ thuộc"
                    hint="Dependent deduction"
                    value={taxForm.dependentDeduction}
                    onChange={(value) => setTaxForm(prev => ({ ...prev, dependentDeduction: value }))}
                  />
                  <div>
                    <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                      Mã số thuế
                    </label>
                    <input
                      value={taxForm.taxCode}
                      onChange={(e) => setTaxForm(prev => ({ ...prev, taxCode: e.target.value }))}
                      placeholder="Nhập MST..."
                      className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">Tax code</p>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <BusinessMetric label="Tổng giảm trừ khai báo" value={taxForm.personalDeduction + taxForm.dependentDeduction} />
                  <BusinessMetric label="Thu nhập tính thuế kỳ này" value={toNum(latestPayslip?.taxableIncome)} tone="primary" />
                  <BusinessMetric label="PIT kỳ này" value={toNum(latestPayslip?.pitAmount)} tone="danger" />
                </div>
              </div>
            </div>
          )}

          {/* ─── Phép năm ─────────────────────────────────── */}
          {activeTab === 'leave' && (
            <LeaveTab balances={employee.leaveBalances || []} joinDate={employee.joinDate} />
          )}

          {/* ─── Chấm công theo kỳ ───────────────────────── */}
          {activeTab === 'attendance' && (
            <AttendanceTab employeeId={id!} attendances={employee.monthlyAttendances || []} />
          )}

          {/* ─── Bảng lương theo kỳ ──────────────────────── */}
          {activeTab === 'payslips' && (
            <PayslipsTab payslips={employee.payslips || []} />
          )}

          {/* ─── Lịch sử chỉnh sửa ──────────────────────── */}
          {activeTab === 'history' && (
            <HistoryTab employeeId={id!} />
          )}

        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Insurance Section sub-component ────────────────────────

function PayrollSnapshot({
  title,
  periodLabel,
  items,
}: {
  title: string;
  periodLabel: string;
  items: Array<{ label: string; value: number; tone?: 'primary' | 'success' | 'warning' | 'danger' }>;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Calculator size={15} className="text-primary" /> {title}
        </h3>
        <span className="rounded-full border border-border bg-muted/30 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
          {periodLabel}
        </span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
        {items.map((item) => (
          <BusinessMetric key={item.label} label={item.label} value={item.value} tone={item.tone} compact />
        ))}
      </div>
    </div>
  );
}

function BusinessMetric({
  label,
  value,
  tone,
  compact,
}: {
  label: string;
  value: number;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
  compact?: boolean;
}) {
  const toneClass = tone === 'primary'
    ? 'text-primary'
    : tone === 'success'
      ? 'text-emerald-600'
      : tone === 'warning'
        ? 'text-amber-600'
        : tone === 'danger'
          ? 'text-destructive'
          : 'text-foreground';
  return (
    <div className={`rounded-xl border border-border/70 bg-muted/20 ${compact ? 'p-3' : 'p-4'}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 font-bold tabular-nums ${compact ? 'text-sm' : 'text-base'} ${toneClass}`}>
        {fmtCurrency(toNum(value))} ₫
      </p>
    </div>
  );
}

function BusinessNumberInput({
  label,
  hint,
  value,
  onChange,
  decimal,
  disabled,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  decimal?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(decimal ? fmtDecimalInput(toNum(value)) : fmtMoneyInput(toNum(value)));

  useEffect(() => {
    setDraft(decimal ? fmtDecimalInput(toNum(value)) : fmtMoneyInput(toNum(value)));
  }, [decimal, value]);

  const commit = () => {
    const parsed = parseLocalizedNumber(draft);
    onChange(parsed);
    setDraft(decimal ? fmtDecimalInput(parsed) : fmtMoneyInput(parsed));
  };

  return (
    <div>
      <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <input
        inputMode="decimal"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className={`w-full h-10 rounded-lg border border-input bg-background px-3 text-sm font-semibold tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 ${
          disabled ? 'cursor-not-allowed bg-muted/40 text-muted-foreground' : ''
        }`}
        placeholder="0"
      />
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PolicySection<T extends object>({
  title,
  subtitle,
  icon: Icon,
  fields,
  form,
  onChange,
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  fields: BusinessNumberField<T>[];
  form: T;
  onChange: (key: keyof T, value: number) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-muted/10 p-4">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <Icon size={15} className="text-primary" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-foreground">{title}</h4>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {fields.map((field) => (
          <BusinessNumberInput
            key={String(field.key)}
            label={field.label}
            hint={field.hint}
            value={toNum(form[field.key])}
            decimal={field.decimal}
            disabled={field.disabled}
            onChange={(value) => onChange(field.key, value)}
          />
        ))}
      </div>
    </section>
  );
}

function InsuranceSection({ title, items, total }: {
  title: string;
  items: Array<{ label: string; value: number }>;
  total: number;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</h4>
      <div className="space-y-2">
        {items.map(item => (
          <div key={item.label} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
            <span className="text-sm text-muted-foreground">{item.label}</span>
            <span className="text-sm font-semibold text-foreground tabular-nums">{fmtCurrency(item.value)} ₫</span>
          </div>
        ))}
        <div className="flex items-center justify-between p-3 rounded-lg bg-primary/5 border border-primary/20">
          <span className="text-sm font-medium text-foreground">Tổng {title}</span>
          <span className="text-sm font-bold text-primary tabular-nums">{fmtCurrency(total)} ₫</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ATTENDANCE TAB
// ═══════════════════════════════════════════════════════════

function AttendanceTab({ employeeId, attendances }: { employeeId: string; attendances: AttendanceRecord[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (attendances.length === 0) {
    return (
      <div className="bg-card border border-dashed border-border rounded-xl p-12 text-center shadow-sm">
        <ClipboardList size={36} className="text-muted-foreground/30 mx-auto mb-3" />
        <h4 className="text-base font-semibold text-foreground mb-1">Chưa có dữ liệu chấm công</h4>
        <p className="text-sm text-muted-foreground">Dữ liệu sẽ xuất hiện khi có kỳ lương được chốt</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
        <ClipboardList size={18} className="text-primary" /> Chấm công theo kỳ
        <span className="text-xs text-muted-foreground font-normal">({attendances.length} kỳ)</span>
      </h3>

      <motion.div variants={stagger.container} initial="hidden" animate="show" className="space-y-2">
        {attendances.map(att => {
          const isExpanded = expandedId === att.id;
          const ratio = att.standardDays > 0 ? (toNum(att.actualDays) / toNum(att.standardDays)) * 100 : 0;

          return (
            <motion.div key={att.id} variants={stagger.item}
              className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              {/* Summary row */}
              <button onClick={() => setExpandedId(isExpanded ? null : att.id)}
                className="w-full flex items-center gap-4 p-4 text-left hover:bg-muted/20 transition-colors cursor-pointer">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-foreground">{att.period.label}</h4>
                    <StatusBadge status={att.period.status === 'CLOSED' ? 'closed' : 'active'}
                      label={att.period.status === 'CLOSED' ? 'Đã chốt' : 'Đang mở'} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {fmtDate(att.period.periodStart)} → {fmtDate(att.period.periodEnd)}
                  </p>
                </div>
                <div className="flex items-center gap-6 text-right shrink-0">
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase">Công</p>
                    <p className="text-sm font-semibold tabular-nums">{fmtNum(toNum(att.actualDays))}/{fmtNum(toNum(att.standardDays))}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase">Tỷ lệ</p>
                    <p className={`text-sm font-semibold tabular-nums ${ratio >= 100 ? 'text-success' : ratio >= 80 ? 'text-foreground' : 'text-warning'}`}>
                      {ratio.toFixed(0)}%
                    </p>
                  </div>
                  <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {/* Detail panel */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                    className="border-t border-border">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
                      {[
                        { label: 'Công chuẩn', value: toNum(att.standardDays), unit: 'ngày' },
                        { label: 'Công thực', value: toNum(att.actualDays), unit: 'ngày' },
                        { label: 'Vắng', value: toNum(att.absentDays), unit: 'ngày', warn: true },
                        { label: 'Giờ làm', value: toNum(att.workHours), unit: 'h' },
                        { label: 'Đi muộn', value: toNum(att.lateHours), unit: 'h', warn: true },
                        { label: 'Về sớm', value: toNum(att.earlyHours), unit: 'h', warn: true },
                        { label: 'Phép năm', value: toNum(att.annualLeaveHours), unit: 'h' },
                        { label: 'Phép chế độ', value: toNum(att.benefitLeaveHours), unit: 'h' },
                        { label: 'Làm remote', value: toNum(att.remoteHours), unit: 'h' },
                        { label: 'Bù công', value: toNum(att.compLeaveHours), unit: 'h' },
                        { label: 'Điều chỉnh', value: toNum(att.correctionHours), unit: 'h' },
                      ].map(item => (
                        <div key={item.label} className="p-2.5 rounded-lg bg-muted/20">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
                          <p className={`text-sm font-semibold tabular-nums mt-0.5 ${
                            item.warn && item.value > 0 ? 'text-warning' : 'text-foreground'
                          }`}>
                            {fmtNum(item.value)} <span className="text-[10px] text-muted-foreground font-normal">{item.unit}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-border/60 pt-4 px-4 pb-4">
                      <h4 className="text-xs font-bold text-foreground mb-3 uppercase tracking-wider flex items-center gap-1.5">
                        <Clock size={12} className="text-primary animate-pulse" /> Bảng công chi tiết hàng ngày
                      </h4>
                      <PeriodDailyAttendance employeeId={employeeId} periodId={att.period.id} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PAYSLIPS TAB
// ═══════════════════════════════════════════════════════════

function PayslipsTab({ payslips }: { payslips: PayslipRecord[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (payslips.length === 0) {
    return (
      <div className="bg-card border border-dashed border-border rounded-xl p-12 text-center shadow-sm">
        <FileSpreadsheet size={36} className="text-muted-foreground/30 mx-auto mb-3" />
        <h4 className="text-base font-semibold text-foreground mb-1">Chưa có bảng lương</h4>
        <p className="text-sm text-muted-foreground">Bảng lương sẽ xuất hiện sau khi tính lương cho kỳ</p>
      </div>
    );
  }

  const PAYSLIP_STATUS: Record<string, { label: string; status: string }> = {
    DRAFT: { label: 'Nháp', status: 'warning' },
    CONFIRMED: { label: 'Xác nhận', status: 'active' },
    PAID: { label: 'Đã trả', status: 'closed' },
  };

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
        <FileSpreadsheet size={18} className="text-primary" /> Bảng lương
        <span className="text-xs text-muted-foreground font-normal">({payslips.length} kỳ)</span>
      </h3>

      <motion.div variants={stagger.container} initial="hidden" animate="show" className="space-y-2">
        {payslips.map(ps => {
          const isExpanded = expandedId === ps.id;
          const psStatus = PAYSLIP_STATUS[ps.status] ?? PAYSLIP_STATUS.DRAFT!;

          return (
            <motion.div key={ps.id} variants={stagger.item}
              className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              {/* Summary */}
              <button onClick={() => setExpandedId(isExpanded ? null : ps.id)}
                className="w-full flex items-center gap-4 p-4 text-left hover:bg-muted/20 transition-colors cursor-pointer">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-foreground">{ps.period.label}</h4>
                    <StatusBadge status={psStatus.status} label={psStatus.label} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Công: {toNum(ps.actualDays)}/{toNum(ps.standardDays)} • OT: {toNum(ps.otTotalHours)}h
                  </p>
                </div>
                <div className="flex items-center gap-6 text-right shrink-0">
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase">Gross</p>
                    <p className="text-sm font-semibold tabular-nums">{fmtCurrency(toNum(ps.grossIncome))}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase">Net</p>
                    <p className="text-sm font-bold tabular-nums text-primary">{fmtCurrency(toNum(ps.netSalary))}</p>
                  </div>
                  <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {/* Payslip breakdown */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                    className="border-t border-border">
                    <div className="p-4 space-y-4">
                      {/* Income section */}
                      <div>
                        <h5 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                          <TrendingUp size={10} /> Thu nhập
                        </h5>
                        <div className="space-y-1.5">
                          {[
                            { label: 'Lương cơ bản', value: toNum(ps.baseSalary) },
                            { label: 'Lương thực nhận (theo công)', value: toNum(ps.actualSalary) },
                            { label: 'Phụ cấp', value: toNum(ps.allowancesTotal) },
                            { label: `OT (${toNum(ps.otTotalHours)}h)`, value: toNum(ps.otTotalAmount) },
                          ].filter(i => i.value > 0).map(item => (
                            <div key={item.label} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-muted/20">
                              <span className="text-xs text-muted-foreground">{item.label}</span>
                              <span className="text-xs font-semibold text-foreground tabular-nums">+{fmtCurrency(item.value)} ₫</span>
                            </div>
                          ))}
                          {toNum(ps.lateDeduction) > 0 && (
                            <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-destructive/5">
                              <span className="text-xs text-destructive">Trừ đi muộn</span>
                              <span className="text-xs font-semibold text-destructive tabular-nums">-{fmtCurrency(toNum(ps.lateDeduction))} ₫</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/40 border border-border/50">
                            <span className="text-xs font-semibold text-foreground">Tổng thu nhập (Gross)</span>
                            <span className="text-sm font-bold text-foreground tabular-nums">{fmtCurrency(toNum(ps.grossIncome))} ₫</span>
                          </div>
                        </div>
                      </div>

                      {/* Deductions section */}
                      <div>
                        <h5 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                          <AlertCircle size={10} /> Khấu trừ
                        </h5>
                        <div className="space-y-1.5">
                          {[
                            { label: 'BHXH/BHYT/BHTN (NLĐ)', value: toNum(ps.insuranceEmployee) },
                            { label: 'Thuế TNCN', value: toNum(ps.pitAmount) },
                            { label: 'Phí công đoàn', value: toNum(ps.unionFee) },
                          ].filter(i => i.value > 0).map(item => (
                            <div key={item.label} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-destructive/5">
                              <span className="text-xs text-muted-foreground">{item.label}</span>
                              <span className="text-xs font-semibold text-destructive tabular-nums">-{fmtCurrency(item.value)} ₫</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Net salary */}
                      <div className="pt-3 border-t border-border">
                        <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/20">
                          <span className="text-sm font-semibold text-foreground">💰 Thực nhận (Net)</span>
                          <span className="text-lg font-bold text-primary tabular-nums">{fmtCurrency(toNum(ps.netSalary))} ₫</span>
                        </div>
                      </div>

                      {/* Extra info */}
                      <div className="grid grid-cols-3 gap-2 text-[10px]">
                        <div className="p-2 rounded-lg bg-muted/20 text-center">
                          <p className="text-muted-foreground">Thu nhập miễn thuế</p>
                          <p className="font-semibold tabular-nums text-foreground">{fmtCurrency(toNum(ps.taxExempt))} ₫</p>
                        </div>
                        <div className="p-2 rounded-lg bg-muted/20 text-center">
                          <p className="text-muted-foreground">Thu nhập chịu thuế</p>
                          <p className="font-semibold tabular-nums text-foreground">{fmtCurrency(toNum(ps.taxableIncome))} ₫</p>
                        </div>
                        <div className="p-2 rounded-lg bg-muted/20 text-center">
                          <p className="text-muted-foreground">BH phía DN</p>
                          <p className="font-semibold tabular-nums text-foreground">{fmtCurrency(toNum(ps.insuranceEmployer))} ₫</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// LEAVE BALANCE TAB
// ═══════════════════════════════════════════════════════════

function LeaveTab({ balances, joinDate }: { balances: LeaveBalanceRecord[]; joinDate: string | null }) {
  // Latest balance = first item (sorted DESC by monthKey)
  const latest = balances[0];

  // Calculate seniority years
  const seniorityYears = joinDate
    ? Math.floor((Date.now() - new Date(joinDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : 0;

  if (balances.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 shadow-sm text-center">
        <TreePalm size={40} className="mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-muted-foreground text-sm">Chưa có dữ liệu phép năm</p>
        <p className="text-[11px] text-muted-foreground/60 mt-1">Dữ liệu sẽ được đồng bộ từ hệ thống</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Phép còn lại', value: toNum(latest?.closing), color: 'text-primary', bg: 'bg-primary/8' },
          { label: 'Đã sử dụng', value: toNum(latest?.used), color: 'text-destructive', bg: 'bg-destructive/8' },
          { label: 'Phát sinh tháng', value: toNum(latest?.accrued), color: 'text-emerald-500', bg: 'bg-emerald-500/8' },
          { label: 'Thâm niên', value: seniorityYears, color: 'text-amber-500', bg: 'bg-amber-500/8', suffix: ' năm' },
        ].map(c => (
          <motion.div key={c.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className={`${c.bg} border border-border/30 rounded-xl p-4`}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{c.label}</p>
            <p className={`text-2xl font-bold tabular-nums mt-1 ${c.color}`}>
              {fmtNum(c.value)}{c.suffix || ' ngày'}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Monthly breakdown table */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Calendar size={15} className="text-primary" /> Chi tiết phép theo tháng
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30">
                {['Tháng', 'Đầu kỳ', 'Phát sinh', 'Thâm niên', 'Đã dùng', 'Điều chỉnh', 'Cuối kỳ'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right first:text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {balances.map((b, i) => (
                <motion.tr key={b.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-t border-border/50 hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{fmtMonthKey(b.monthKey)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmtNum(toNum(b.opening))}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-500 font-medium">+{fmtNum(toNum(b.accrued))}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-500">{toNum(b.seniorityBonus) > 0 ? `+${fmtNum(toNum(b.seniorityBonus))}` : '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-destructive font-medium">{toNum(b.used) > 0 ? `-${fmtNum(toNum(b.used))}` : '0'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{toNum(b.adjustment) !== 0 ? fmtNum(toNum(b.adjustment)) : '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-primary">{fmtNum(toNum(b.closing))}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// HISTORY TAB (PAGINATED)
// ═══════════════════════════════════════════════════════════

interface AuditLogEntry {
  id: string;
  tableName: string;
  action: string;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  changedBy: string | null;
  changedAt: string;
}

interface HistoryResponse {
  data: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const FIELD_LABELS: Record<string, string> = {
  fullName: 'Họ tên', position: 'Chức vụ', department: 'Phòng ban',
  email: 'Email', mobile: 'Số điện thoại', status: 'Trạng thái',
  employmentType: 'Loại HĐ', scheduleType: 'Lịch làm việc',
  offerSalary: 'Lương Offer', baseSalary: 'Lương cơ bản', ratio: 'Hệ số lương',
  rankAllowance: 'Phụ cấp chức vụ', dailyRate: 'Lương ngày', hourlyRate: 'Lương giờ',
  bhxhEmployee: 'BHXH NLĐ', bhytEmployee: 'BHYT NLĐ', bhtnEmployee: 'BHTN NLĐ',
  personalDeduction: 'Giảm trừ bản thân', dependents: 'Số người phụ thuộc',
};

const TABLE_LABELS: Record<string, string> = {
  employees: 'Thông tin cơ bản',
  salary_policies: 'Lương & Phụ cấp',
  insurance_policies: 'Bảo hiểm',
  tax_policies: 'Thuế TNCN',
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  status: { ACTIVE: 'Đang làm', INACTIVE: 'Nghỉ việc' },
  employmentType: { FT: 'Chính thức', PT: 'Bán thời gian', P: 'Thử việc', M: 'Quản lý' },
  scheduleType: { OFFICE: 'Hành chính', SIX_DAY: '6 ngày/tuần' },
};

function humanize(field: string, value: unknown): string {
  const v = String(value ?? '—');
  return VALUE_LABELS[field]?.[v] || v;
}

const ITEMS_PER_PAGE = 15;

function HistoryTab({ employeeId }: { employeeId: string }) {
  const [page, setPage] = useState(1);

  const { data: historyData, isLoading } = useQuery<HistoryResponse>({
    queryKey: ['employee-history', employeeId, page],
    queryFn: async () => {
      const { data } = await api.get<HistoryResponse>(
        `/employees/${employeeId}/history?page=${page}&limit=${ITEMS_PER_PAGE}`
      );
      return data;
    },
  });

  const logs = historyData?.data || [];
  const totalPages = historyData?.totalPages || 1;
  const total = historyData?.total || 0;

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 shadow-sm text-center">
        <Loader2 size={24} className="animate-spin text-primary mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Đang tải lịch sử...</p>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 shadow-sm text-center">
        <History size={40} className="mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-muted-foreground text-sm">Chưa có lịch sử chỉnh sửa</p>
        <p className="text-[11px] text-muted-foreground/60 mt-1">Mọi thay đổi sẽ được ghi nhận tại đây</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-card border border-border rounded-xl shadow-sm">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <History size={15} className="text-primary" /> Lịch sử chỉnh sửa
          </h3>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {total} thay đổi
          </span>
        </div>

        {/* Timeline */}
        <div className="p-4">
          <div className="relative pl-6">
            <div className="absolute left-[11px] top-0 bottom-0 w-px bg-border" />

            {logs.map((log, i) => {
              const changes = log.oldData && log.newData
                ? Object.keys(log.newData).map(key => ({
                    field: FIELD_LABELS[key] || key,
                    from: humanize(key, (log.oldData as Record<string, unknown>)?.[key]),
                    to: humanize(key, (log.newData as Record<string, unknown>)?.[key]),
                  }))
                : [];

              const tableName = TABLE_LABELS[log.tableName] || log.tableName;

              return (
                <motion.div key={String(log.id)}
                  initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="relative mb-5 last:mb-0">
                  {/* Dot */}
                  <div className={`absolute -left-[15px] w-[10px] h-[10px] rounded-full border-2 ${
                    i === 0 && page === 1 ? 'border-primary bg-primary/30' : 'border-border bg-card'
                  }`} style={{ top: '5px' }} />

                  <div className="ml-2">
                    {/* Meta line */}
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-primary/8 text-primary font-medium">
                        {tableName}
                      </span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {new Date(log.changedAt).toLocaleString('vi-VN', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                      {log.changedBy && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {log.changedBy}
                        </span>
                      )}
                    </div>

                    {/* Changes */}
                    <div className="space-y-1 bg-muted/20 rounded-lg p-3 border border-border/30">
                      {changes.length > 0 ? changes.map(c => (
                        <div key={c.field} className="text-xs flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-foreground min-w-[100px]">{c.field}:</span>
                          <span className="text-destructive/80 line-through text-[11px]">{c.from}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-primary font-medium text-[11px]">{c.to}</span>
                        </div>
                      )) : (
                        <span className="text-[11px] text-muted-foreground">{log.action}</span>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-border flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              Trang {page}/{totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="p-1.5 rounded-lg hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer">
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                const p = start + i;
                if (p > totalPages) return null;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      p === page ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50 text-muted-foreground'
                    }`}>{p}</button>
                );
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="p-1.5 rounded-lg hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PeriodDailyAttendance Component ────────────────────────

interface PeriodDailyAttendanceProps {
  employeeId: string;
  periodId: string;
}

function PeriodDailyAttendance({ employeeId, periodId }: PeriodDailyAttendanceProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['attendance-daily', periodId],
    queryFn: async () => {
      const { data } = await api.get(`/attendance/daily?periodId=${periodId}`);
      return data;
    },
    enabled: !!periodId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground text-xs gap-2">
        <Loader2 size={14} className="animate-spin text-primary" /> Đang tải bảng công chi tiết...
      </div>
    );
  }

  const employeeRecords = data?.records?.filter((r: any) => r.employeeId === employeeId) || [];

  if (employeeRecords.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic text-center py-4">
        Không có dữ liệu chi tiết hàng ngày cho kỳ này.
      </p>
    );
  }

  const OT_BUCKET_LABELS: Record<string, string> = {
    'OT 150%': 'Ngày thường 時間外 17h~22h',
    'OT 210%': 'Ngày thường 時間外(夜間まで残業) 22h~6h',
    'Ca đêm 30%': '平日の夜勤 22h~6h ca đêm',
    'OT 130%': '平日夜勤 của ca đêm',
    'OT 200%': 'Ngày nghỉ 休日出勤 6h~22h',
    'OT 270%': 'Ngày nghỉ ca đêm 休日の夜勤 22h~6h',
    'OT 300%': 'OT ngày lễ 祝日出勤',
    'OT 390%': 'OT ngày lễ ca đêm 祝日夜勤 22h~6h',
  };

  const getStatusStyle = (conclusion: string) => {
    const c = (conclusion || '').toLowerCase();
    if (c === 'đủ công' || c.includes('đủ')) return 'bg-emerald-50 text-emerald-700 border-emerald-200/80';
    if (c.includes('trễ') || c.includes('sớm') || c.includes('thiếu check')) return 'bg-amber-50 text-amber-700 border-amber-200/80';
    if (c.includes('vắng') || c.includes('không chấm') || c.includes('thiếu công')) return 'bg-red-50 text-red-700 border-red-200/80';
    if (c.includes('phép') || c.includes('leave') || c.includes('nghỉ')) return 'bg-purple-50 text-purple-700 border-purple-200/80';
    return 'bg-slate-50 text-slate-700 border-slate-200/80';
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border/80 mt-2">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="bg-muted/40 text-muted-foreground border-b border-border/80 font-medium">
            <th className="py-2.5 px-3">Ngày</th>
            <th className="py-2.5 px-3">Giờ check</th>
            <th className="py-2.5 px-3 text-center">Giờ làm</th>
            <th className="py-2.5 px-3">Kết luận</th>
            <th className="py-2.5 px-3">Làm thêm (OT)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {employeeRecords.map((r: any) => {
            const dateObj = new Date(r.attendanceDate);
            const dateStr = dateObj.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
            const dayOfWeek = dateObj.toLocaleDateString('vi-VN', { weekday: 'short' });
            const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;

            // OT calculation
            const dayOtBuckets: any[] = [];
            r.approvals?.forEach((app: any) => {
              if (app.otBuckets) {
                app.otBuckets.forEach((bucket: any) => {
                  dayOtBuckets.push(bucket);
                });
              }
            });

            return (
              <tr key={r.id} className={`hover:bg-muted/20 transition-colors ${isWeekend ? 'bg-muted/10' : ''}`}>
                <td className="py-2.5 px-3 font-semibold text-gray-700">
                  {dayOfWeek}, {dateStr}
                </td>
                <td className="py-2.5 px-3 tabular-nums text-gray-600">
                  {fmtTimeVn(r.checkIn)}
                  {' → '}
                  {fmtTimeVn(r.checkOut)}
                </td>
                <td className="py-2.5 px-3 text-center font-medium tabular-nums text-gray-700">
                  {r.workHours > 0 ? `${r.workHours}h` : '—'}
                </td>
                <td className="py-2.5 px-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${getStatusStyle(r.conclusion)}`}>
                    {r.conclusion}
                  </span>
                </td>
                <td className="py-2.5 px-3">
                  {dayOtBuckets.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {dayOtBuckets.map((b: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <span className="font-bold text-[9px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                            {OT_BUCKET_LABELS[b.bucket] || b.bucket}
                          </span>
                          <span className="text-gray-500 text-[10px]">
                            {b.validHours > 0 ? `${b.validHours}h` : `${b.approvedHours}h (chờ công)`}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-400 italic">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
