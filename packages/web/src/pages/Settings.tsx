import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  RefreshCw, Clock, Users, FileText, Send, Calendar, Plus, X,
  Loader2, Lock, Unlock, Trash2, Edit3, Eye, EyeOff,
  Shield, Receipt, Gift, Settings2, Save, CalendarDays,
  ChevronRight, AlertCircle,
  History, Copy, Power, PowerOff,
  ChevronLeft, FileCheck, Layers,
} from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Button, StatusBadge, Modal, DatePicker, Dropdown } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import api from '@/services/api';

// ─── Types ──────────────────────────────────────────────────

interface PayrollPeriod {
  id: string;
  monthKey: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  autoClose: boolean;
  closeAt: string | null;
  createdAt: string;
  _count?: { payslips: number; monthlyAttendances: number };
}

interface PolicyVersion {
  id: string;
  category: string;
  name: string;
  version: number;
  status: string; // ACTIVE | INACTIVE | DRAFT
  effectiveFrom: string;
  effectiveTo: string | null;
  description: string | null;
  createdAt: string;
  settings: PayrollSetting[];
  _count?: { settings: number; changeLogs: number };
}

interface PayrollSetting {
  id: string;
  policyVersionId: string;
  category: string;
  key: string;
  value: string;
  label: string;
  description: string | null;
  dataType: string;
  sortOrder: number;
}

interface ChangeLog {
  id: string;
  policyVersionId: string;
  category: string;
  action: string;
  summary: string;
  details: string | null;
  changedAt: string;
  policyVersion: { name: string; version: number };
}

// ─── Constants ──────────────────────────────────────────────

const TABS = [
  { key: 'periods', label: 'Lịch chốt công', icon: Calendar },
  { key: 'sync', label: 'Đồng bộ', icon: RefreshCw },
  { key: 'insurance', label: 'Bảo hiểm', icon: Shield },
  { key: 'tax', label: 'Thuế TNCN', icon: Receipt },
  { key: 'benefit', label: 'Phúc lợi', icon: Gift },
  { key: 'general', label: 'Chung', icon: Settings2 },
] as const;

const SYNC_JOBS = [
  {
    key: 'employees',
    label: 'Nhân sự',
    icon: Users,
    schedule: 'Hàng ngày 02:00',
    color: 'var(--color-primary)',
    description: 'Kéo nhân sự/phòng ban từ Lark Admin về app, rồi cập nhật HR Base và các bảng chính sách hiện có.',
  },
  {
    key: 'attendance',
    label: 'Chấm công',
    icon: Clock,
    schedule: 'Mỗi 30 phút',
    color: 'var(--color-success)',
    description: 'Kéo dữ liệu chấm công từ Lark Attendance về app; nếu bấm thủ công sẽ lấy mặc định 30 ngày gần nhất.',
  },
  {
    key: 'approvals',
    label: 'Phê duyệt',
    icon: FileText,
    schedule: 'Mỗi 15 phút',
    color: 'var(--color-accent)',
    description: 'Kéo phiếu OT, nghỉ phép, nghỉ bù và các phê duyệt liên quan từ Lark Approval về app.',
  },
  {
    key: 'outbound',
    label: 'Đẩy về Lark',
    icon: Send,
    schedule: 'Mỗi 2 giờ',
    color: 'var(--color-warning)',
    description: 'Đẩy dữ liệu đã tính trong app về Lark Base cho kỳ lương mới nhất để xem và đối chiếu.',
  },
] as const;

const APPROVAL_SUBMISSION_SETTING_KEYS = new Set([
  'approval_submission_policy_enabled',
  'approval_submission_required_days_before',
  'approval_ot_allowed_early_days_before',
  'approval_ot_allowed_late_days_after',
]);
const APPROVAL_SYNC_NEEDED_KEY = 'asnova:approval-sync-needed';
const APPROVAL_SYNC_NEEDED_EVENT = 'asnova-approval-sync-needed';

// ─── Helpers ────────────────────────────────────────────────

const fmt = new Intl.NumberFormat('vi-VN');
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const fmtDateTime = (d: string) => new Date(d).toLocaleString('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
});
const toInputDate = (d: string | null | undefined) =>
  d ? new Date(d).toISOString().split('T')[0] ?? '' : '';

type PeriodMode = 'manual' | 'fixed';

function periodMode(period: Pick<PayrollPeriod, 'autoClose'>): PeriodMode {
  return period.autoClose ? 'fixed' : 'manual';
}

function monthRangeFromKey(monthKey: string): { start: string; end: string; closeAt: string } {
  const year = Number(monthKey.substring(0, 4));
  const month = Number(monthKey.substring(4, 6));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return { start: '', end: '', closeAt: '' };
  }
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const closeMonthDate = new Date(year, month, 5);
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
    closeAt: `${closeMonthDate.getFullYear()}-${String(closeMonthDate.getMonth() + 1).padStart(2, '0')}-${String(closeMonthDate.getDate()).padStart(2, '0')}`,
  };
}

const stagger: { container: Variants; item: Variants } = {
  container: { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } },
  item: { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { type: 'spring', damping: 25, stiffness: 300 } } },
};

const STATUS_MAP: Record<string, { label: string; status: 'active' | 'closed' | 'warning' }> = {
  ACTIVE: { label: 'Đang áp dụng', status: 'active' },
  INACTIVE: { label: 'Không áp dụng', status: 'closed' },
  DRAFT: { label: 'Bản nháp', status: 'warning' },
};

// ═══════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════

export default function Settings() {
  const [activeTab, setActiveTab] = useState('periods');

  const { data: periods = [], isLoading: loadingPeriods } = useQuery({
    queryKey: ['periods'],
    queryFn: async () => { const { data } = await api.get<PayrollPeriod[]>('/periods'); return data; },
  });

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }} className="space-y-6">
      <PageHeader title="Cài đặt" subtitle="Quản lý lịch chốt công, đồng bộ & chính sách lương" />

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-muted/30 rounded-xl p-1 border border-border overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <motion.button key={tab.key} whileTap={{ scale: 0.97 }} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/25'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}>
              <Icon size={15} />
              {tab.label}
            </motion.button>
          );
        })}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          {activeTab === 'periods' && <PeriodsTab periods={periods} loading={loadingPeriods} />}
          {activeTab === 'sync' && <SyncTab />}
          {activeTab === 'insurance' && <PolicyCategoryTab category="insurance" title="Bảo hiểm xã hội" icon={Shield} />}
          {activeTab === 'tax' && <PolicyCategoryTab category="tax" title="Thuế TNCN" icon={Receipt} />}
          {activeTab === 'benefit' && <PolicyCategoryTab category="benefit" title="Phúc lợi & Phụ cấp" icon={Gift} />}
          {activeTab === 'general' && <PolicyCategoryTab category="general" title="Cài đặt chung" icon={Settings2} />}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════
// POLICY CATEGORY TAB — Version-centric UI
// ═══════════════════════════════════════════════════════════

function PolicyCategoryTab({ category, title, icon: TitleIcon }: {
  category: string; title: string; icon: React.ComponentType<{ size: number; className?: string }>;
}) {
  const [openVersionId, setOpenVersionId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['policy-versions', category],
    queryFn: async () => {
      const { data } = await api.get<{ data: PolicyVersion[] }>(`/settings/versions/${category}`);
      return data.data;
    },
  });

  const openVersion = versions.find(v => v.id === openVersionId);

  // If drilling into a version, show detail view
  if (openVersion) {
    return <VersionDetailView version={openVersion} onBack={() => setOpenVersionId(null)} />;
  }

  const activeVersion = versions.find(v => v.status === 'ACTIVE');
  const otherVersions = versions.filter(v => v.status !== 'ACTIVE');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <TitleIcon size={18} className="text-primary" /> {title}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {versions.length} version • {activeVersion ? `"${activeVersion.name}" đang áp dụng` : 'Chưa có version active'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={History} onClick={() => setShowChangelog(true)}>Lịch sử</Button>
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setShowCreateModal(true)}>Tạo version</Button>
        </div>
      </div>

      {isLoading && (
        <div className="flex flex-col items-center py-16 gap-3">
          <Loader2 size={28} className="animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Đang tải...</p>
        </div>
      )}

      {/* Active Version — prominent card */}
      {activeVersion && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Đang áp dụng</h4>
          </div>
          <VersionCard version={activeVersion} isActive onClick={() => setOpenVersionId(activeVersion.id)} />
        </div>
      )}

      {/* Other Versions */}
      {otherVersions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Layers size={12} />
            Versions khác ({otherVersions.length})
          </h4>
          <motion.div variants={stagger.container} initial="hidden" animate="show" className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {otherVersions.map(v => (
              <motion.div key={v.id} variants={stagger.item}>
                <VersionCard version={v} onClick={() => setOpenVersionId(v.id)} />
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && versions.length === 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="bg-card border border-dashed border-border rounded-2xl p-16 text-center shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-primary/8 flex items-center justify-center mx-auto mb-5">
            <TitleIcon size={32} className="text-primary/40" />
          </div>
          <h4 className="text-base font-semibold text-foreground mb-1">Chưa có version nào</h4>
          <p className="text-sm text-muted-foreground mb-6">Tạo version đầu tiên để bắt đầu quản lý chính sách</p>
          <Button variant="primary" size="md" icon={Plus} onClick={() => setShowCreateModal(true)}>Tạo version đầu tiên</Button>
        </motion.div>
      )}

      {/* Create Version Modal */}
      <CreateVersionModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)}
        category={category} existingVersions={versions} />

      {/* Changelog Modal */}
      <ChangelogModal isOpen={showChangelog} onClose={() => setShowChangelog(false)} category={category} />
    </div>
  );
}

// ─── Version Card ───────────────────────────────────────────

function VersionCard({ version: v, isActive, onClick }: { version: PolicyVersion; isActive?: boolean; onClick: () => void }) {
  const statusInfo = STATUS_MAP[v.status] ?? STATUS_MAP.DRAFT!;
  const settingCount = v._count?.settings ?? v.settings?.length ?? 0;

  return (
    <motion.div whileHover={{ y: -3 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      onClick={onClick}
      className={`bg-card border rounded-xl p-5 shadow-sm cursor-pointer relative overflow-hidden group transition-all ${
        isActive ? 'border-primary/30 ring-1 ring-primary/10' : 'border-border hover:border-border/80'
      }`}>

      {/* Decorative */}
      {isActive && <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-primary/[0.04] blur-3xl" />}

      {/* Header */}
      <div className="flex items-start justify-between mb-3 relative">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">v{v.version}</span>
            <StatusBadge status={statusInfo.status} label={statusInfo.label} />
          </div>
          <h4 className="text-base font-bold text-foreground truncate">{v.name}</h4>
          {v.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{v.description}</p>}
        </div>
        <ChevronRight size={16} className="text-muted-foreground group-hover:text-foreground transition-colors mt-1 shrink-0" />
      </div>

      {/* Date + Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Áp dụng từ</p>
          <p className="text-xs tabular-nums text-foreground font-medium">{fmtDate(v.effectiveFrom)}</p>
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Đến</p>
          <p className="text-xs tabular-nums text-foreground font-medium">{v.effectiveTo ? fmtDate(v.effectiveTo) : 'Vô thời hạn'}</p>
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Chỉ số</p>
          <p className="text-xs tabular-nums text-foreground font-medium">{settingCount} rules</p>
        </div>
      </div>

      {/* Quick preview of settings (skip JSON) */}
      {v.settings && v.settings.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/30 flex flex-wrap gap-1.5">
          {v.settings.filter(s => s.dataType !== 'json').slice(0, 4).map(s => (
            <span key={s.key} className="text-[9px] px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground border border-border/30">
              {(s.label.split('—')[0] ?? s.label).trim()}: <strong className="text-foreground tabular-nums">{
                s.dataType === 'currency'
                  ? fmt.format(Number(s.value)) + '₫'
                  : s.dataType === 'percent'
                    ? s.value + '%'
                    : s.dataType === 'boolean'
                      ? (String(s.value).toLowerCase() === 'true' ? 'Bật' : 'Tắt')
                      : s.value
              }</strong>
            </span>
          ))}
          {v.settings.filter(s => s.dataType !== 'json').length > 4 && (
            <span className="text-[9px] px-2 py-0.5 text-muted-foreground">+{v.settings.filter(s => s.dataType !== 'json').length - 4}</span>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════
// VERSION DETAIL VIEW — drill-in to edit rules
// ═══════════════════════════════════════════════════════════

function VersionDetailView({ version: initVersion, onBack }: { version: PolicyVersion; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [changeNote, setChangeNote] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const hasChanges = Object.keys(edits).length > 0;

  // Real-time data
  const { data: version } = useQuery({
    queryKey: ['policy-version', initVersion.id],
    queryFn: async () => {
      const { data } = await api.get<{ data: PolicyVersion }>(`/settings/version/${initVersion.id}`);
      return data.data;
    },
    initialData: initVersion,
  });

  const statusInfo = STATUS_MAP[version.status] ?? STATUS_MAP.DRAFT!;

  // Save rules mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(edits).map(([id, value]) => ({ id, value }));
      await api.put(`/settings/version/${version.id}/rules`, { settings: updates, changeNote: changeNote || undefined });
    },
    onSuccess: () => {
      const touchesApprovalSubmissionRule = Object.keys(edits).some((id) => {
        const setting = version.settings.find((item) => item.id === id);
        return setting ? APPROVAL_SUBMISSION_SETTING_KEYS.has(setting.key) : false;
      });
      if (touchesApprovalSubmissionRule) {
        window.localStorage.setItem(APPROVAL_SYNC_NEEDED_KEY, '1');
        window.dispatchEvent(new Event(APPROVAL_SYNC_NEEDED_EVENT));
      }
      qc.invalidateQueries({ queryKey: ['policy-version', version.id] });
      qc.invalidateQueries({ queryKey: ['policy-versions'] });
      setEdits({});
      setChangeNote('');
      toast('success', touchesApprovalSubmissionRule ? 'Đã lưu. Cần đồng bộ lại phiếu phê duyệt.' : 'Đã lưu thay đổi!');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  // Activate / Deactivate
  const activateMutation = useMutation({
    mutationFn: async () => { await api.post(`/settings/version/${version.id}/activate`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policy-versions'] });
      qc.invalidateQueries({ queryKey: ['policy-version'] });
      toast('success', `Đã kích hoạt ${version.name}!`);
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => { await api.post(`/settings/version/${version.id}/deactivate`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policy-versions'] });
      qc.invalidateQueries({ queryKey: ['policy-version'] });
      toast('success', 'Đã vô hiệu hóa version');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { await api.delete(`/settings/version/${version.id}`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policy-versions'] });
      toast('success', 'Đã xóa version');
      onBack();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const settings = version.settings || [];

  return (
    <div className="space-y-5">
      {/* Back + Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={onBack} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">v{version.version}</span>
              <h3 className="text-lg font-bold text-foreground">{version.name}</h3>
              <StatusBadge status={statusInfo.status} label={statusInfo.label} />
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-[10px] text-muted-foreground">Áp dụng: <strong className="tabular-nums text-foreground">{fmtDate(version.effectiveFrom)}</strong></span>
              {version.effectiveTo && <span className="text-[10px] text-muted-foreground">→ {fmtDate(version.effectiveTo)}</span>}
              {version.description && <span className="text-[10px] text-muted-foreground italic">• {version.description}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {version.status === 'DRAFT' && (
            <Button variant="success" size="sm" icon={Power} onClick={() => activateMutation.mutate()}
              loading={activateMutation.isPending}>Kích hoạt</Button>
          )}
          {version.status === 'INACTIVE' && (
            <Button variant="accent" size="sm" icon={Power} onClick={() => activateMutation.mutate()}
              loading={activateMutation.isPending}>Kích hoạt lại</Button>
          )}
          {version.status === 'ACTIVE' && (
            <Button variant="outline" size="sm" icon={PowerOff} onClick={() => deactivateMutation.mutate()}
              loading={deactivateMutation.isPending}>Vô hiệu</Button>
          )}
          {version.status !== 'ACTIVE' && (
            <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setShowDeleteModal(true)}
              className="text-destructive hover:bg-destructive/10" />
          )}
        </div>
      </div>

      {/* Inactive/Draft Banner */}
      {version.status === 'INACTIVE' && (
        <div className="bg-muted/30 rounded-xl p-3 border border-border flex items-center gap-2">
          <AlertCircle size={14} className="text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">Version này <strong>không còn áp dụng</strong>. Các thay đổi sẽ không ảnh hưởng đến tính lương.</p>
        </div>
      )}
      {version.status === 'DRAFT' && (
        <div className="bg-warning/5 rounded-xl p-3 border border-warning/10 flex items-center gap-2">
          <FileCheck size={14} className="text-warning shrink-0" />
          <p className="text-xs text-warning">Bản nháp — chỉnh sửa xong hãy <strong>Kích hoạt</strong> để áp dụng vào tính lương.</p>
        </div>
      )}

      {/* Rules Table */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
          <p className="text-xs font-semibold text-foreground">{settings.length} chỉ số</p>
          {hasChanges && (
            <div className="flex items-center gap-2">
              <input value={changeNote} onChange={e => setChangeNote(e.target.value)} placeholder="Ghi chú thay đổi..."
                className="w-52 text-xs px-3 py-1.5 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <Button variant="primary" size="sm" icon={Save} onClick={() => saveMutation.mutate()}
                loading={saveMutation.isPending}>Lưu ({Object.keys(edits).length})</Button>
            </div>
          )}
        </div>

        <div className="divide-y divide-border">
          {settings.map((s, i) => {
            const currentValue = edits[s.id] !== undefined ? edits[s.id] : s.value;
            const isEdited = edits[s.id] !== undefined;
            const isBooleanOn = ['true', '1', 'on', 'yes'].includes(String(currentValue).toLowerCase());

            if (s.dataType === 'json') {
              let brackets: Array<{ from: number; to: number | null; rate: number }> = [];
              try { brackets = JSON.parse(s.value); } catch { /* skip */ }
              return (
                <div key={s.id} className="p-4">
                  <p className="text-sm font-medium text-foreground mb-1">{s.label}</p>
                  {s.description && <p className="text-[10px] text-muted-foreground mb-3">{s.description}</p>}
                  <table className="w-full text-sm">
                    <thead><tr className="text-[10px] text-muted-foreground uppercase">
                      <th className="text-left py-1">Bậc</th><th className="text-right py-1">Từ</th><th className="text-right py-1">Đến</th><th className="text-right py-1">Thuế suất</th>
                    </tr></thead>
                    <tbody>{brackets.map((b, bi) => (
                      <tr key={bi} className="border-t border-border/30">
                        <td className="py-1.5 font-medium">{bi + 1}</td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmt.format(b.from)}</td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">{b.to ? fmt.format(b.to) : '∞'}</td>
                        <td className="py-1.5 text-right tabular-nums font-semibold text-primary">{b.rate}%</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              );
            }

            return (
              <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                className={`px-4 py-3.5 flex items-center gap-4 ${isEdited ? 'bg-primary/5' : 'hover:bg-muted/20'} transition-colors`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{s.label}</p>
                  {s.description && <p className="text-[10px] text-muted-foreground leading-relaxed">{s.description}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.dataType === 'boolean' ? (
                    <button
                      type="button"
                      onClick={() => setEdits(prev => ({ ...prev, [s.id]: isBooleanOn ? 'false' : 'true' }))}
                      aria-pressed={isBooleanOn}
                      className={`relative h-8 w-16 rounded-full border px-1 transition-colors cursor-pointer ${
                        isBooleanOn ? 'border-primary bg-primary/90' : 'border-border bg-muted'
                      }`}
                    >
                      <span className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                        isBooleanOn ? 'translate-x-8' : 'translate-x-0'
                      }`} />
                      <span className={`absolute inset-y-0 flex items-center text-[10px] font-bold ${
                        isBooleanOn ? 'left-2 text-primary-foreground' : 'right-2 text-muted-foreground'
                      }`}>
                        {isBooleanOn ? 'Bật' : 'Tắt'}
                      </span>
                    </button>
                  ) : s.dataType === 'currency' ? (
                    <div className="relative">
                      <input type="text" value={fmt.format(Number(currentValue))}
                        onChange={e => { const raw = e.target.value.replace(/\D/g, ''); setEdits(prev => ({ ...prev, [s.id]: raw })); }}
                        className="w-36 text-right px-3 py-1.5 text-sm rounded-lg border border-input bg-background text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 shadow-xs" />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">₫</span>
                    </div>
                  ) : s.dataType === 'percent' ? (
                    <div className="relative">
                      <input type="number" step="0.1" value={currentValue}
                        onChange={e => setEdits(prev => ({ ...prev, [s.id]: e.target.value }))}
                        className="w-24 text-right px-3 py-1.5 text-sm rounded-lg border border-input bg-background text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 shadow-xs" />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span>
                    </div>
                  ) : (
                    <input type="number" step="any" value={currentValue}
                      onChange={e => setEdits(prev => ({ ...prev, [s.id]: e.target.value }))}
                      className="w-28 text-right px-3 py-1.5 text-sm rounded-lg border border-input bg-background text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 shadow-xs" />
                  )}
                  {isEdited && (
                    <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} whileTap={{ scale: 0.8 }}
                      onClick={() => setEdits(prev => { const n = { ...prev }; delete n[s.id]; return n; })}
                      className="text-muted-foreground hover:text-foreground cursor-pointer"><X size={14} /></motion.button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Delete Confirm */}
      <Modal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Xác nhận xóa version" size="sm"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowDeleteModal(false)}>Hủy</Button>
            <Button variant="destructive" size="sm" icon={Trash2} onClick={() => deleteMutation.mutate()} loading={deleteMutation.isPending}>Xóa</Button>
          </>
        }>
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={28} className="text-destructive" />
          </div>
          <p className="text-sm text-foreground mb-1">Xóa <strong>{version.name}</strong> (v{version.version})?</p>
          <p className="text-xs text-muted-foreground">Hành động này không thể hoàn tác.</p>
        </div>
      </Modal>
    </div>
  );
}

// ─── Create Version Modal ───────────────────────────────────

function CreateVersionModal({ isOpen, onClose, category, existingVersions }: {
  isOpen: boolean; onClose: () => void; category: string; existingVersions: PolicyVersion[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '', effectiveFrom: new Date().toISOString().split('T')[0] ?? '', description: '', cloneFromId: '',
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      await api.post('/settings/versions', {
        category,
        name: form.name,
        effectiveFrom: form.effectiveFrom,
        description: form.description || undefined,
        cloneFromId: form.cloneFromId || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policy-versions', category] });
      toast('success', 'Tạo version mới thành công!');
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Tạo version mới" size="lg"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
          <Button variant="primary" size="sm" icon={Plus} onClick={() => createMutation.mutate()}
            loading={createMutation.isPending} disabled={!form.name || !form.effectiveFrom}>Tạo version</Button>
        </>
      }>
      <div className="space-y-5">
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Tên version *</label>
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            placeholder="VD: Cập nhật NĐ 74/2025..."
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 shadow-xs" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <DatePicker label="Ngày áp dụng *" value={form.effectiveFrom} onChange={v => setForm(p => ({ ...p, effectiveFrom: v }))} />
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Clone từ</label>
            <Dropdown
              value={form.cloneFromId}
              onChange={(value) => setForm(p => ({ ...p, cloneFromId: value }))}
              options={[
                { value: '', label: 'Version đang active' },
                ...existingVersions.map(v => ({ value: v.id, label: `v${v.version} — ${v.name}` })),
              ]}
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Mô tả</label>
          <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            placeholder="Ghi chú về thay đổi chính sách..."
            rows={2} className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 shadow-xs resize-none" />
        </div>

        <div className="bg-primary/5 rounded-xl p-3 border border-primary/10 flex items-start gap-2">
          <Copy size={14} className="text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-foreground">Version mới sẽ được tạo ở trạng thái <strong>Bản nháp</strong>. Chỉnh sửa xong → Kích hoạt để áp dụng.</p>
        </div>
      </div>
    </Modal>
  );
}

// ─── Changelog Modal ────────────────────────────────────────

function ChangelogModal({ isOpen, onClose, category }: { isOpen: boolean; onClose: () => void; category: string }) {
  const { data: logs = [] } = useQuery({
    queryKey: ['changelog', category],
    queryFn: async () => {
      const { data } = await api.get<{ data: ChangeLog[] }>(`/settings/changelog/${category}`);
      return data.data;
    },
    enabled: isOpen,
  });

  const ACTION_COLORS: Record<string, string> = {
    CREATE: 'bg-primary',
    UPDATE: 'bg-accent',
    ACTIVATE: 'bg-success',
    DEACTIVATE: 'bg-muted-foreground',
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Lịch sử thay đổi" size="xl">
      <div className="space-y-1">
        {logs.length === 0 ? (
          <div className="text-center py-10">
            <History size={36} className="text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Chưa có thay đổi nào</p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-[18px] top-4 bottom-4 w-[2px] bg-border" />
            {logs.map((log, i) => {
              let details: Array<{ key: string; label?: string; oldValue?: string; newValue?: string }> = [];
              if (log.details) try { details = JSON.parse(log.details); } catch { /* skip */ }

              return (
                <motion.div key={log.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }} className="relative flex gap-4 py-3">
                  <div className="relative z-10 shrink-0">
                    <div className={`w-[10px] h-[10px] rounded-full mt-1.5 ml-[14px] ring-2 ring-card ${ACTION_COLORS[log.action] || 'bg-muted'}`} />
                  </div>
                  <div className="flex-1 bg-muted/20 rounded-xl p-3 border border-border/50">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          v{log.policyVersion.version}
                        </span>
                        <p className="text-sm font-medium text-foreground">{log.summary}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{fmtDateTime(log.changedAt)}</span>
                    </div>

                    {/* Change details */}
                    {Array.isArray(details) && details.length > 0 && details[0]?.oldValue && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {details.slice(0, 5).map((d, di) => (
                          <span key={di} className="text-[9px] px-2 py-0.5 rounded bg-muted/40 text-muted-foreground">
                            {d.label || d.key}: <span className="line-through">{d.oldValue}</span> → <span className="text-primary font-semibold">{d.newValue}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════
// PERIODS TAB (unchanged from before)
// ═══════════════════════════════════════════════════════════

function PeriodsTab({ periods, loading }: { periods: PayrollPeriod[]; loading: boolean }) {
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'delete' | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null);
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [periodTab, setPeriodTab] = useState<PeriodMode>('manual');
  const { toast } = useToast();
  const qc = useQueryClient();

  const closeMutation = useMutation({
    mutationFn: async (id: string) => { await api.post(`/periods/${id}/close`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['periods'] }); toast('success', 'Đã chốt công kỳ lương!'); },
    onError: (e: Error) => toast('error', e.message),
  });

  const reopenMutation = useMutation({
    mutationFn: async (id: string) => { await api.post(`/periods/${id}/reopen`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['periods'] }); toast('success', 'Đã mở lại kỳ lương'); },
    onError: (e: Error) => toast('error', e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/periods/${id}`); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['periods'] }); setModalMode(null); setSelectedPeriod(null); toast('success', 'Đã xóa kỳ lương'); },
    onError: (e: Error) => toast('error', e.message),
  });

  const openEdit = useCallback((p: PayrollPeriod) => { setSelectedPeriod(p); setModalMode('edit'); }, []);
  const openDelete = useCallback((p: PayrollPeriod) => { setSelectedPeriod(p); setModalMode('delete'); }, []);
  const closeModal = useCallback(() => { setModalMode(null); setSelectedPeriod(null); }, []);

  const visiblePeriods = periods.filter(p => periodMode(p) === periodTab);
  const openPeriods = visiblePeriods.filter(p => p.status === 'OPEN');
  const closedPeriods = visiblePeriods.filter(p => p.status === 'CLOSED');
  const manualCount = periods.filter(p => periodMode(p) === 'manual').length;
  const fixedCount = periods.filter(p => periodMode(p) === 'fixed').length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 size={28} className="animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Đang tải lịch chốt công...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <CalendarDays size={20} className="text-primary" />
            Lịch chốt công
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Quản lý kỳ công, kỳ lương — {visiblePeriods.length}/{periods.length} kỳ đang xem
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted/40 rounded-lg border border-border p-0.5">
            <button onClick={() => setViewMode('card')} className={`p-1.5 rounded-md transition-all cursor-pointer ${viewMode === 'card' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}>
              <Eye size={14} />
            </button>
            <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-md transition-all cursor-pointer ${viewMode === 'table' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'}`}>
              <EyeOff size={14} />
            </button>
          </div>
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setModalMode('create')}>Tạo kỳ lương</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {([
          { key: 'manual', title: 'Thủ công', desc: 'Tự chọn ngày bắt đầu, ngày kết thúc và ngày chốt.', count: manualCount },
          { key: 'fixed', title: 'Cố định theo tháng', desc: 'Tự lấy từ ngày 01 đến ngày cuối tháng của kỳ lương.', count: fixedCount },
        ] as Array<{ key: PeriodMode; title: string; desc: string; count: number }>).map(item => {
          const active = periodTab === item.key;
          return (
            <button key={item.key} onClick={() => setPeriodTab(item.key)}
              className={`text-left rounded-xl border p-4 transition-all cursor-pointer ${
                active ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-card hover:bg-muted/20'
              }`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-foreground">{item.title}</span>
                <span className={`text-[10px] rounded-full px-2 py-0.5 font-bold ${
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}>{item.count} kỳ</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{item.desc}</p>
            </button>
          );
        })}
      </div>

      {visiblePeriods.length === 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="bg-card border border-dashed border-border rounded-2xl p-16 text-center shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-primary/8 flex items-center justify-center mx-auto mb-5">
            <Calendar size={32} className="text-primary/40" />
          </div>
          <h4 className="text-base font-semibold text-foreground mb-1">
            Chưa có kỳ lương {periodTab === 'fixed' ? 'cố định' : 'thủ công'}
          </h4>
          <p className="text-sm text-muted-foreground mb-6">
            Tạo kỳ lương đầu tiên cho chế độ này
          </p>
          <Button variant="primary" size="md" icon={Plus} onClick={() => setModalMode('create')}>Tạo kỳ lương</Button>
        </motion.div>
      )}

      {viewMode === 'card' && visiblePeriods.length > 0 && (
        <>
          {openPeriods.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <h4 className="text-sm font-semibold text-foreground">Đang mở ({openPeriods.length})</h4>
              </div>
              <motion.div variants={stagger.container} initial="hidden" animate="show" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {openPeriods.map(p => (
                  <motion.div key={p.id} variants={stagger.item}>
                    <PeriodCard period={p} onClose={() => closeMutation.mutate(p.id)} onEdit={() => openEdit(p)} onDelete={() => openDelete(p)} isClosing={closeMutation.isPending} />
                  </motion.div>
                ))}
              </motion.div>
            </div>
          )}
          {closedPeriods.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2"><Lock size={14} className="text-muted-foreground" /><h4 className="text-sm font-semibold text-muted-foreground">Đã chốt ({closedPeriods.length})</h4></div>
              <motion.div variants={stagger.container} initial="hidden" animate="show" className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                {closedPeriods.map(p => (
                  <motion.div key={p.id} variants={stagger.item}>
                    <ClosedPeriodCard period={p} onReopen={() => reopenMutation.mutate(p.id)} onDelete={() => openDelete(p)} />
                  </motion.div>
                ))}
              </motion.div>
            </div>
          )}
        </>
      )}

      {viewMode === 'table' && visiblePeriods.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                {['Kỳ lương', 'Kiểu', 'Bắt đầu', 'Kết thúc', 'Chốt', 'Trạng thái', ''].map(h => (
                  <th key={h} className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiblePeriods.map((p, i) => {
                const isOpen = p.status === 'OPEN';
                return (
                  <motion.tr key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                    className="border-b border-border/50 hover:bg-muted/20 transition-colors group">
                    <td className="px-4 py-3"><p className="text-sm font-semibold text-foreground">{p.label}</p></td>
                    <td className="px-4 py-3"><PeriodModeBadge mode={periodMode(p)} /></td>
                    <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">{fmtDate(p.periodStart)}</td>
                    <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">{fmtDate(p.periodEnd)}</td>
                    <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">{fmtDate(p.closeAt)}</td>
                    <td className="px-4 py-3"><StatusBadge status={isOpen ? 'active' : 'closed'} label={isOpen ? 'Mở' : 'Đã chốt'} /></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isOpen ? (
                          <>
                            <Button variant="ghost" size="sm" icon={Lock} onClick={() => closeMutation.mutate(p.id)}>Chốt</Button>
                            <Button variant="ghost" size="sm" icon={Edit3} onClick={() => openEdit(p)} />
                          </>
                        ) : (
                          <Button variant="ghost" size="sm" icon={Unlock} onClick={() => reopenMutation.mutate(p.id)}>Mở lại</Button>
                        )}
                        <Button variant="ghost" size="sm" icon={Trash2} onClick={() => openDelete(p)} className="text-destructive" />
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreatePeriodModal isOpen={modalMode === 'create'} onClose={closeModal} initialMode={periodTab} />
      <EditPeriodModal isOpen={modalMode === 'edit'} period={selectedPeriod} onClose={closeModal} />
      <DeletePeriodModal isOpen={modalMode === 'delete'} period={selectedPeriod}
        onConfirm={() => selectedPeriod && deleteMutation.mutate(selectedPeriod.id)}
        onClose={closeModal} loading={deleteMutation.isPending} />
    </div>
  );
}

// ─── Period Cards ───────────────────────────────────────────

function PeriodModeBadge({ mode }: { mode: PeriodMode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
      mode === 'fixed'
        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
        : 'bg-slate-50 text-slate-600 border border-slate-200'
    }`}>
      {mode === 'fixed' ? 'Cố định' : 'Thủ công'}
    </span>
  );
}

function PeriodModeSelector({ mode, onChange }: { mode: PeriodMode; onChange: (mode: PeriodMode) => void }) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Kiểu lịch chốt công</label>
      <div className="grid grid-cols-2 gap-2">
        {([
          { key: 'manual', title: 'Thủ công', desc: 'Tự chọn khoảng ngày' },
          { key: 'fixed', title: 'Cố định', desc: '01 đến cuối tháng' },
        ] as Array<{ key: PeriodMode; title: string; desc: string }>).map(item => {
          const active = mode === item.key;
          return (
            <button key={item.key} type="button" onClick={() => onChange(item.key)}
              className={`rounded-xl border px-3 py-2.5 text-left transition-all cursor-pointer ${
                active ? 'border-primary bg-primary/5 text-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}>
              <div className="text-xs font-bold">{item.title}</div>
              <div className="text-[10px] leading-relaxed">{item.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PeriodCard({ period: p, onClose, onEdit, onDelete, isClosing }: {
  period: PayrollPeriod; onClose: () => void; onEdit: () => void; onDelete: () => void; isClosing: boolean;
}) {
  const daysTotal = (new Date(p.periodEnd).getTime() - new Date(p.periodStart).getTime()) / 86400000;
  const daysPassed = (Date.now() - new Date(p.periodStart).getTime()) / 86400000;
  const progress = Math.min(100, Math.max(0, (daysPassed / daysTotal) * 100));
  const daysLeft = p.closeAt ? Math.ceil((new Date(p.closeAt).getTime() - Date.now()) / 86400000) : null;

  return (
    <motion.div whileHover={{ y: -3 }} className="bg-card border border-border rounded-xl p-5 shadow-sm relative overflow-hidden group">
      <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-success/[0.06] blur-3xl" />
      <div className="flex items-start justify-between mb-3 relative">
        <div>
          <h4 className="text-base font-bold text-foreground">{p.label}</h4>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-[10px] text-muted-foreground">{p.monthKey}</p>
            <PeriodModeBadge mode={periodMode(p)} />
          </div>
        </div>
        <StatusBadge status="active" label="Đang mở" />
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3 text-[11px]">
        <div><span className="text-muted-foreground">Bắt đầu</span><p className="tabular-nums text-foreground">{fmtDate(p.periodStart)}</p></div>
        <div><span className="text-muted-foreground">Kết thúc</span><p className="tabular-nums text-foreground">{fmtDate(p.periodEnd)}</p></div>
        <div><span className="text-muted-foreground">Chốt</span><p className="tabular-nums text-foreground">{fmtDate(p.closeAt)}</p></div>
        <div><span className="text-muted-foreground">Còn</span><p className={`tabular-nums ${daysLeft !== null && daysLeft <= 3 ? 'text-destructive' : 'text-foreground'}`}>{daysLeft !== null ? `${daysLeft}d` : '—'}</p></div>
      </div>
      <div className="mb-3">
        <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
          <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.8 }}
            className={`h-full rounded-full ${progress >= 100 ? 'bg-destructive' : progress >= 80 ? 'bg-warning' : 'bg-success'}`} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" icon={Lock} onClick={onClose} loading={isClosing} className="flex-1">Chốt</Button>
        <Button variant="outline" size="sm" icon={Edit3} onClick={onEdit} />
        <Button variant="ghost" size="sm" icon={Trash2} onClick={onDelete} className="text-destructive" />
      </div>
    </motion.div>
  );
}

function ClosedPeriodCard({ period: p, onReopen, onDelete }: { period: PayrollPeriod; onReopen: () => void; onDelete: () => void }) {
  return (
    <motion.div whileHover={{ y: -2 }} className="bg-card border border-border rounded-xl p-4 shadow-sm opacity-80 hover:opacity-100 transition-opacity group">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-foreground">{p.label}</h4>
        <StatusBadge status="closed" label="Đã chốt" />
      </div>
      <div className="mb-2"><PeriodModeBadge mode={periodMode(p)} /></div>
      <div className="grid grid-cols-3 gap-2 text-[11px] mb-3">
        <div><span className="text-muted-foreground">Bắt đầu</span><p className="tabular-nums">{fmtDate(p.periodStart)}</p></div>
        <div><span className="text-muted-foreground">Kết thúc</span><p className="tabular-nums">{fmtDate(p.periodEnd)}</p></div>
        <div><span className="text-muted-foreground">Chốt</span><p className="tabular-nums">{fmtDate(p.closeAt)}</p></div>
      </div>
      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="outline" size="sm" icon={Unlock} onClick={onReopen} className="flex-1">Mở lại</Button>
        <Button variant="ghost" size="sm" icon={Trash2} onClick={onDelete} className="text-destructive" />
      </div>
    </motion.div>
  );
}

// ─── Period Modals ──────────────────────────────────────────

function CreatePeriodModal({ isOpen, onClose, initialMode }: { isOpen: boolean; onClose: () => void; initialMode: PeriodMode }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const defaultMK = `${nextMonth.getFullYear()}${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
  const defaultRange = monthRangeFromKey(defaultMK);
  const [form, setForm] = useState({
    monthKey: defaultMK,
    periodStart: defaultRange.start,
    periodEnd: defaultRange.end,
    closeAt: defaultRange.closeAt,
    autoClose: initialMode === 'fixed',
  });

  const handleMK = useCallback((mk: string) => {
    setForm(prev => {
      const range = monthRangeFromKey(mk);
      return {
        ...prev,
        monthKey: mk,
        periodStart: prev.autoClose ? range.start : prev.periodStart || range.start,
        periodEnd: prev.autoClose ? range.end : prev.periodEnd || range.end,
        closeAt: prev.autoClose ? range.closeAt : prev.closeAt || range.closeAt,
      };
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const range = monthRangeFromKey(defaultMK);
    setForm({
      monthKey: defaultMK,
      periodStart: range.start,
      periodEnd: range.end,
      closeAt: range.closeAt,
      autoClose: initialMode === 'fixed',
    });
  }, [defaultMK, initialMode, isOpen]);

  const handleModeChange = useCallback((mode: PeriodMode) => {
    setForm(prev => {
      const range = monthRangeFromKey(prev.monthKey);
      return {
        ...prev,
        autoClose: mode === 'fixed',
        periodStart: mode === 'fixed' ? range.start : prev.periodStart,
        periodEnd: mode === 'fixed' ? range.end : prev.periodEnd,
      };
    });
  }, []);

  const createMutation = useMutation({
    mutationFn: async () => { await api.post('/periods', { ...form, closeAt: form.closeAt || null }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['periods'] }); toast('success', 'Tạo kỳ lương thành công!'); onClose(); },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Tạo kỳ lương mới" size="lg"
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Hủy</Button><Button variant="primary" size="sm" icon={Plus} onClick={() => createMutation.mutate()} loading={createMutation.isPending} disabled={!form.monthKey}>Tạo</Button></>}>
      <div className="space-y-4">
        <PeriodModeSelector mode={form.autoClose ? 'fixed' : 'manual'} onChange={handleModeChange} />

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Kỳ lương</label>
          <div className="grid grid-cols-2 gap-2">
            <Dropdown
              value={form.monthKey.substring(4, 6)}
              onChange={(value) => handleMK(form.monthKey.substring(0, 4) + value)}
              options={Array.from({ length: 12 }, (_, i) => {
                const m = String(i + 1).padStart(2, '0');
                return { value: m, label: `Tháng ${m}` };
              })}
            />
            <Dropdown
              value={form.monthKey.substring(0, 4)}
              onChange={(value) => handleMK(value + form.monthKey.substring(4, 6))}
              options={Array.from({ length: 5 }, (_, i) => {
                const y = String(new Date().getFullYear() - 1 + i);
                return { value: y, label: y };
              })}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Kỳ lương: <strong className="text-foreground">Tháng {form.monthKey.substring(4, 6)}/{form.monthKey.substring(0, 4)}</strong>
          </p>
        </div>
        {form.autoClose ? (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5">
              <div className="text-[10px] text-indigo-600 uppercase font-bold">Bắt đầu</div>
              <div className="text-sm font-semibold tabular-nums text-foreground">{fmtDate(form.periodStart)}</div>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5">
              <div className="text-[10px] text-indigo-600 uppercase font-bold">Kết thúc</div>
              <div className="text-sm font-semibold tabular-nums text-foreground">{fmtDate(form.periodEnd)}</div>
            </div>
            <DatePicker label="Dự kiến chốt" value={form.closeAt} onChange={v => setForm(p => ({ ...p, closeAt: v }))} />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <DatePicker label="Bắt đầu" value={form.periodStart} onChange={v => setForm(p => ({ ...p, periodStart: v }))} />
            <DatePicker label="Kết thúc" value={form.periodEnd} onChange={v => setForm(p => ({ ...p, periodEnd: v }))} />
            <DatePicker label="Dự kiến chốt" value={form.closeAt} onChange={v => setForm(p => ({ ...p, closeAt: v }))} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function EditPeriodModal({ isOpen, period, onClose }: { isOpen: boolean; period: PayrollPeriod | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ periodStart: '', periodEnd: '', closeAt: '', autoClose: false });

  useEffect(() => {
    if (!period || !isOpen) return;
    setForm({
      periodStart: toInputDate(period.periodStart),
      periodEnd: toInputDate(period.periodEnd),
      closeAt: toInputDate(period.closeAt),
      autoClose: period.autoClose,
    });
  }, [isOpen, period?.id]);

  const handleModeChange = useCallback((mode: PeriodMode) => {
    if (!period) return;
    setForm(prev => {
      const range = monthRangeFromKey(period.monthKey);
      return {
        ...prev,
        autoClose: mode === 'fixed',
        periodStart: mode === 'fixed' ? range.start : prev.periodStart,
        periodEnd: mode === 'fixed' ? range.end : prev.periodEnd,
      };
    });
  }, [period]);

  const updateMutation = useMutation({
    mutationFn: async () => { if (!period) return; await api.put(`/periods/${period.id}`, { ...form, closeAt: form.closeAt || null }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['periods'] }); toast('success', 'Cập nhật thành công!'); onClose(); },
    onError: (e: Error) => toast('error', e.message),
  });

  if (!period) return null;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Sửa ${period.label}`} size="lg"
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Hủy</Button><Button variant="primary" size="sm" icon={Save} onClick={() => updateMutation.mutate()} loading={updateMutation.isPending}>Lưu</Button></>}>
      <div className="space-y-4">
        <PeriodModeSelector mode={form.autoClose ? 'fixed' : 'manual'} onChange={handleModeChange} />
        {form.autoClose ? (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5">
              <div className="text-[10px] text-indigo-600 uppercase font-bold">Bắt đầu</div>
              <div className="text-sm font-semibold tabular-nums text-foreground">{fmtDate(form.periodStart)}</div>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5">
              <div className="text-[10px] text-indigo-600 uppercase font-bold">Kết thúc</div>
              <div className="text-sm font-semibold tabular-nums text-foreground">{fmtDate(form.periodEnd)}</div>
            </div>
            <DatePicker label="Dự kiến chốt" value={form.closeAt} onChange={v => setForm(p => ({ ...p, closeAt: v }))} />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <DatePicker label="Bắt đầu" value={form.periodStart} onChange={v => setForm(p => ({ ...p, periodStart: v }))} />
            <DatePicker label="Kết thúc" value={form.periodEnd} onChange={v => setForm(p => ({ ...p, periodEnd: v }))} />
            <DatePicker label="Dự kiến chốt" value={form.closeAt} onChange={v => setForm(p => ({ ...p, closeAt: v }))} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function DeletePeriodModal({ isOpen, period, onConfirm, onClose, loading }: {
  isOpen: boolean; period: PayrollPeriod | null; onConfirm: () => void; onClose: () => void; loading: boolean;
}) {
  if (!period) return null;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Xác nhận xóa" size="sm"
      footer={<><Button variant="outline" size="sm" onClick={onClose}>Hủy</Button><Button variant="destructive" size="sm" icon={Trash2} onClick={onConfirm} loading={loading}>Xóa</Button></>}>
      <div className="text-center py-4">
        <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4"><AlertCircle size={28} className="text-destructive" /></div>
        <p className="text-sm text-foreground">Xóa <strong>{period.label}</strong>?</p>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════
// SYNC TAB
// ═══════════════════════════════════════════════════════════

function SyncTab() {
  const [syncingKey, setSyncingKey] = useState<string | null>(null);
  const [approvalSyncNeeded, setApprovalSyncNeeded] = useState(() =>
    window.localStorage.getItem(APPROVAL_SYNC_NEEDED_KEY) === '1',
  );
  const { toast } = useToast();

  useEffect(() => {
    const refreshNeeded = () => setApprovalSyncNeeded(window.localStorage.getItem(APPROVAL_SYNC_NEEDED_KEY) === '1');
    window.addEventListener(APPROVAL_SYNC_NEEDED_EVENT, refreshNeeded);
    window.addEventListener('storage', refreshNeeded);
    return () => {
      window.removeEventListener(APPROVAL_SYNC_NEEDED_EVENT, refreshNeeded);
      window.removeEventListener('storage', refreshNeeded);
    };
  }, []);

  const handleSync = async (key: string) => {
    setSyncingKey(key);
    try {
      if (key === 'employees') await api.post('/sync/employees-admin');
      else await api.post(`/sync/${key}`);
      if (key === 'approvals') {
        window.localStorage.removeItem(APPROVAL_SYNC_NEEDED_KEY);
        setApprovalSyncNeeded(false);
      }
      toast('success', `Đồng bộ ${key} thành công!`);
    } catch (e) { toast('error', `Lỗi: ${(e as Error).message}`); }
    finally { setSyncingKey(null); }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground flex items-center gap-2"><RefreshCw size={18} className="text-primary" /> Đồng bộ dữ liệu</h3>
      <motion.div variants={stagger.container} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SYNC_JOBS.map(job => {
          const Icon = job.icon;
          const needsAttention = job.key === 'approvals' && approvalSyncNeeded;
          return (
            <motion.div key={job.key} variants={stagger.item} whileHover={{ y: -3 }}
              className={`bg-card border rounded-xl p-5 shadow-sm transition-all ${
                needsAttention ? 'border-amber-300 ring-2 ring-amber-100 bg-amber-50/40' : 'border-border'
              }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${job.color} 10%, transparent)` }}>
                    <Icon size={20} style={{ color: job.color }} />
                  </div>
                  <div><h4 className="text-sm font-semibold text-foreground">{job.label}</h4><p className="text-[10px] text-muted-foreground">{job.schedule}</p></div>
                </div>
                <Button variant={needsAttention ? 'primary' : 'outline'} size="sm" onClick={() => handleSync(job.key)} loading={syncingKey === job.key} icon={RefreshCw}>Sync</Button>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed mt-3 pt-3 border-t border-border/50">
                {job.description}
              </p>
              {needsAttention && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
                  Rule hạn nộp phiếu vừa thay đổi, cần đồng bộ lại phiếu phê duyệt.
                </p>
              )}
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
