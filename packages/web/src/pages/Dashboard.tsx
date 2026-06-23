import { motion } from 'framer-motion';
import {
  Users, Building2, Clock,
  TrendingUp, RefreshCw, Activity, Loader2,
} from 'lucide-react';
import { useMemo } from 'react';
import { PageHeader, KpiCard, Button, LoadingSkeleton } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useEmployees, useTriggerSync } from '@/hooks/useQueries';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';

// ─── Helpers ────────────────────────────────────────────────

function getAvatarUrl(meta: any): string | null {
  return meta?.avatarUrl || null;
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const tooltipStyle = {
  contentStyle: {
    backgroundColor: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    fontSize: 12,
    boxShadow: '0 4px 12px rgba(0,0,0,.08)',
  },
};

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 16, scale: 0.95 }, show: { opacity: 1, y: 0, scale: 1 } };

// ─── Component ──────────────────────────────────────────────

export default function Dashboard() {
  const { data: employees, isLoading, dataUpdatedAt } = useEmployees();
  const syncMutation = useTriggerSync();
  const { toast } = useToast();

  const allEmps = employees || [];
  const activeEmployees = allEmps.filter((e: any) => e.status === 'ACTIVE');

  // Department headcount
  const deptCounts = useMemo(() => {
    const map = new Map<string, number>();
    allEmps.forEach((e: any) => {
      const dept = e.department || 'Chưa phân bổ';
      map.set(dept, (map.get(dept) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, headcount]) => ({
        name: name.length > 14 ? name.substring(0, 14) + '…' : name,
        headcount,
      }))
      .sort((a, b) => b.headcount - a.headcount);
  }, [allEmps]);

  // Join year distribution
  const joinTrend = useMemo(() => {
    const years = new Map<string, number>();
    allEmps.forEach((e: any) => {
      const joinDate = e.joinDate || e.join_date;
      if (!joinDate) return;
      const year = new Date(joinDate).getFullYear().toString();
      years.set(year, (years.get(year) || 0) + 1);
    });
    return Array.from(years.entries())
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, count]) => ({ year, count }));
  }, [allEmps]);

  // Gender from larkMetadata
  const genderData = useMemo(() => {
    let male = 0, female = 0, unknown = 0;
    allEmps.forEach((e: any) => {
      const meta = e.larkMetadata || e.lark_metadata;
      const g = meta?.gender;
      if (g === 1) male++;
      else if (g === 2) female++;
      else unknown++;
    });
    return [
      { name: 'Nam', value: male, color: '#2563eb' },
      { name: 'Nữ', value: female, color: '#db2777' },
      { name: 'Chưa XĐ', value: unknown, color: '#94a3b8' },
    ].filter(g => g.value > 0);
  }, [allEmps]);

  // Recent joins
  const recentJoins = useMemo(() =>
    [...allEmps]
      .filter((e: any) => e.joinDate || e.join_date)
      .sort((a: any, b: any) => new Date(b.joinDate || b.join_date).getTime() - new Date(a.joinDate || a.join_date).getTime())
      .slice(0, 5), [allEmps]);

  // Handle sync
  const handleSync = () => {
    syncMutation.mutate('employees', {
      onSuccess: () => toast('success', 'Đồng bộ nhân sự thành công!'),
      onError: (err) => toast('error', `Lỗi: ${(err as Error).message}`),
    });
  };

  // Seniority
  const seniorityYears = useMemo(() => {
    const dates = allEmps
      .map((e: any) => e.joinDate || e.join_date)
      .filter(Boolean)
      .map((d: string) => new Date(d).getTime());
    if (dates.length === 0) return 0;
    const oldest = Math.min(...dates);
    return Math.round((Date.now() - oldest) / (365.25 * 86400_000));
  }, [allEmps]);

  // Loading
  if (isLoading) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <PageHeader title="Tổng quan" subtitle="Đang tải dữ liệu..." />
        <LoadingSkeleton type="kpi" />
        <LoadingSkeleton type="card" rows={6} />
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader title="Tổng quan" subtitle="Asnova Payroll — Dữ liệu từ database">
        <div className="flex items-center gap-3">
          {dataUpdatedAt && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              {new Date(dataUpdatedAt).toLocaleTimeString('vi-VN')}
            </span>
          )}
          <Button variant="outline" size="sm"
            icon={syncMutation.isPending ? Loader2 : RefreshCw}
            loading={syncMutation.isPending}
            onClick={handleSync}
          >
            {syncMutation.isPending ? 'Đang...' : 'Đồng bộ Lark'}
          </Button>
        </div>
      </PageHeader>

      {/* KPI */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div variants={item}><KpiCard label="Tổng nhân sự" value={allEmps.length} subtitle={`${activeEmployees.length} đang làm`} icon={Users} color="#2563eb" /></motion.div>
        <motion.div variants={item}><KpiCard label="Phòng ban" value={deptCounts.length} icon={Building2} color="#7c3aed" /></motion.div>
        <motion.div variants={item}>
          <KpiCard label="Mới nhất" value={(recentJoins[0] as any)?.fullName || (recentJoins[0] as any)?.full_name || '—'}
            subtitle={formatDate((recentJoins[0] as any)?.joinDate || (recentJoins[0] as any)?.join_date)}
            icon={TrendingUp} color="#16a34a" />
        </motion.div>
        <motion.div variants={item}><KpiCard label="Thâm niên" value={`${seniorityYears} năm`} subtitle="nhân viên lâu nhất" icon={Clock} color="#d97706" /></motion.div>
      </motion.div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Department Bar */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="lg:col-span-2 bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Building2 size={16} className="text-primary" />
            Phân bố nhân sự theo phòng ban
          </h3>
          {deptCounts.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={deptCounts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} width={130} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="headcount" name="Số người" fill="#2563eb" radius={[0, 6, 6, 0]} barSize={22} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-muted-foreground text-center py-8">Chưa có dữ liệu — nhấn "Đồng bộ Lark" để bắt đầu</p>}
        </motion.div>

        {/* Gender Pie */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4">Giới tính</h3>
          {genderData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={genderData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" paddingAngle={3}>
                  {genderData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip {...tooltipStyle} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-muted-foreground text-center py-8">Chưa có dữ liệu</p>}
        </motion.div>
      </div>

      {/* Trend + Recent */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="lg:col-span-2 bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-success" />
            Tuyển dụng theo năm
          </h3>
          {joinTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={joinTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="count" name="Nhân viên mới" fill="#16a34a" radius={[6, 6, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-muted-foreground text-center py-8">Chưa có dữ liệu</p>}
        </motion.div>

        {/* Recent Joins */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Activity size={16} className="text-accent" />
            Nhân viên mới nhất
          </h3>
          <div className="space-y-3">
            {recentJoins.length > 0 ? recentJoins.map((emp: any, i: number) => {
              const meta = emp.larkMetadata || emp.lark_metadata;
              const avatar = getAvatarUrl(meta);
              const name = emp.fullName || emp.full_name || 'N/A';
              return (
                <motion.div key={emp.id || i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7 + i * 0.05 }} className="flex items-center gap-3">
                  {avatar ? (
                    <img src={avatar} alt={name} className="w-8 h-8 rounded-full object-cover border border-border shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                      {name.charAt(0)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{name}</p>
                    <p className="text-[10px] text-muted-foreground">{emp.department}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                    {formatDate(emp.joinDate || emp.join_date)}
                  </span>
                </motion.div>
              );
            }) : <p className="text-sm text-muted-foreground text-center py-4">Chưa có dữ liệu</p>}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
