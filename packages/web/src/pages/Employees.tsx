import { motion } from 'framer-motion';
import { useNavigate } from 'react-router';
import { Users, Building2, TrendingUp, UserCheck, RefreshCw, Loader2 } from 'lucide-react';
import { useState, useMemo } from 'react';
import { PageHeader, KpiCard, DataTable, type Column, StatusBadge, FormInput, Dropdown, Button, LoadingSkeleton } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useEmployees, useTriggerSync } from '@/hooks/useQueries';

// ─── Helpers ────────────────────────────────────────────────

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getAvatarUrl(meta: any): string | null {
  if (!meta) return null;
  return meta.avatarUrl || null;
}

const EMP_TYPE_LABELS: Record<string, string> = {
  FT: 'Chính thức',
  PT: 'Bán TG',
  P: 'Thử việc',
  M: 'Quản lý',
};

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

// ─── Component ──────────────────────────────────────────────

export default function Employees() {
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const { toast } = useToast();
  const navigate = useNavigate();

  // Data from backend API → database
  const { data: employees, isLoading, dataUpdatedAt } = useEmployees();
  const syncMutation = useTriggerSync();

  const allEmployees = employees || [];

  // Get unique departments for filter
  const deptOptions = useMemo(() => {
    const depts = [...new Set(allEmployees.map((e: any) => e.department))].sort();
    return [
      { value: '', label: 'Tất cả phòng ban' },
      ...depts.map(d => ({ value: d, label: d })),
    ];
  }, [allEmployees]);

  // Filter
  const filtered = useMemo(() => allEmployees.filter((e: any) => {
    if (search) {
      const q = search.toLowerCase();
      const name = (e.fullName || e.full_name || '').toLowerCase();
      const uid = (e.userId || e.user_id || '').toLowerCase();
      const email = (e.email || '').toLowerCase();
      if (!name.includes(q) && !uid.includes(q) && !email.includes(q)) return false;
    }
    if (deptFilter && e.department !== deptFilter) return false;
    return true;
  }), [allEmployees, search, deptFilter]);

  // KPIs
  const active = filtered.filter((e: any) => e.status === 'ACTIVE').length;
  const deptCount = new Set(filtered.map((e: any) => e.department)).size;
  const newest = [...filtered].sort((a: any, b: any) => {
    const da = a.joinDate || a.join_date || '';
    const db = b.joinDate || b.join_date || '';
    return new Date(db).getTime() - new Date(da).getTime();
  })[0] as any;

  // Handle sync
  const handleSync = () => {
    syncMutation.mutate('employees', {
      onSuccess: () => toast('success', 'Đồng bộ nhân sự từ Lark Admin thành công!'),
      onError: (err) => toast('error', `Lỗi đồng bộ: ${(err as Error).message}`),
    });
  };

  // Table data
  const tableData = filtered.map((e: any) => {
    const meta = e.larkMetadata || e.lark_metadata;
    return {
      id: e.id,
      name: e.fullName || e.full_name || 'N/A',
      userId: e.userId || e.user_id || '',
      department: e.department || '—',
      email: e.email || '—',
      mobile: e.mobile || '—',
      employeeType: EMP_TYPE_LABELS[e.employmentType || e.employment_type] || e.employmentType || '—',
      joinDate: formatDate(e.joinDate || e.join_date),
      statusLabel: e.status === 'ACTIVE' ? 'Đang làm' : 'Nghỉ việc',
      statusKey: e.status === 'ACTIVE' ? 'active' : 'failed',
      avatarUrl: getAvatarUrl(meta),
    };
  });

  type RowType = typeof tableData[number];

  const columns: Column<RowType>[] = [
    {
      key: 'name', header: 'Nhân viên', sortable: true, width: '200px',
      render: (row) => (
        <div className="flex items-center gap-3">
          {row.avatarUrl ? (
            <img src={row.avatarUrl} alt={row.name}
              className="w-8 h-8 rounded-full object-cover shrink-0 border border-border"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
              {row.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-foreground">{row.name}</p>
            <p className="text-[10px] text-muted-foreground">{row.userId}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'department', header: 'Phòng ban', sortable: true, width: '150px',
      render: (row) => <span className="text-sm font-medium text-foreground">{row.department}</span>
    },
    {
      key: 'email', header: 'Email', width: '200px',
      render: (row) => <span className="text-xs text-muted-foreground truncate max-w-[190px] block" title={row.email}>{row.email}</span>
    },
    {
      key: 'mobile', header: 'SĐT', width: '135px',
      render: (row) => <span className="text-xs font-mono tabular-nums text-foreground">{row.mobile}</span>
    },
    {
      key: 'employeeType', header: 'Loại HĐ', width: '110px',
      render: (row) => (
        <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded border ${
          row.employeeType.includes('Thử việc')
            ? 'text-amber-700 bg-amber-50 border-amber-200'
            : row.employeeType.includes('Bán TG')
            ? 'text-purple-700 bg-purple-50 border-purple-200'
            : 'text-primary bg-primary/5 border-primary/20'
        }`}>
          {row.employeeType}
        </span>
      )
    },
    {
      key: 'statusLabel', header: 'Trạng thái', width: '110px',
      render: (row) => <StatusBadge status={row.statusKey} label={row.statusLabel} />,
    },
    {
      key: 'joinDate', header: 'Ngày vào', type: 'date', width: '110px',
      render: (row) => <span className="text-xs font-mono tabular-nums text-foreground">{row.joinDate}</span>
    },
  ];

  // Loading
  if (isLoading) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <PageHeader title="Nhân sự" subtitle="Đang tải dữ liệu..." />
        <LoadingSkeleton type="kpi" />
        <LoadingSkeleton type="table" rows={8} />
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader title="Nhân sự" subtitle={`${filtered.length} nhân viên — Dữ liệu từ database`}>
        <div className="flex items-center gap-3">
          {dataUpdatedAt && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              {new Date(dataUpdatedAt).toLocaleTimeString('vi-VN')}
            </span>
          )}
          <Button
            variant="outline" size="sm"
            icon={syncMutation.isPending ? Loader2 : RefreshCw}
            loading={syncMutation.isPending}
            onClick={handleSync}
          >
            {syncMutation.isPending ? 'Đang sync...' : 'Đồng bộ Lark'}
          </Button>
        </div>
      </PageHeader>

      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div variants={item}>
          <KpiCard label="Tổng nhân sự" value={filtered.length} subtitle="từ database" icon={Users} color="#2563eb" />
        </motion.div>
        <motion.div variants={item}>
          <KpiCard label="Đang làm việc" value={active} subtitle={filtered.length > 0 ? `${Math.round(active / filtered.length * 100)}% active` : ''} icon={UserCheck} color="#16a34a" />
        </motion.div>
        <motion.div variants={item}>
          <KpiCard label="Phòng ban" value={deptCount} subtitle="đang hoạt động" icon={Building2} color="#7c3aed" />
        </motion.div>
        <motion.div variants={item}>
          <KpiCard label="Mới nhất" value={newest?.fullName || newest?.full_name || '—'} subtitle={formatDate(newest?.joinDate || newest?.join_date)} icon={TrendingUp} color="#d97706" />
        </motion.div>
      </motion.div>

      <div className="flex flex-col sm:flex-row gap-3">
        <FormInput placeholder="Tìm tên, mã NV, email..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
        <Dropdown options={deptOptions} value={deptFilter} onChange={setDeptFilter} placeholder="Phòng ban" className="w-56" />
      </div>

      <DataTable columns={columns} data={tableData} selectable pageSize={20} rowKey="id"
        onRowClick={(row: Record<string, unknown>) => navigate(`/employees/${row.id}`)} />
    </motion.div>
  );
}
