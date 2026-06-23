import { motion } from 'framer-motion';
import { useState, useMemo } from 'react';
import { PageHeader, DataTable, type Column, StatusBadge, FormInput, Dropdown } from '@/components/ui';

interface AuditRow {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  entity: string;
  entityId: string;
  details: string;
  status: string;
}

const MOCK_DATA: AuditRow[] = [
  { id: '1', timestamp: '29/05 11:05', user: 'System', action: 'SYNC', entity: 'Approval', entityId: 'APR-156', details: 'Đồng bộ 12 phiếu phê duyệt', status: 'success' },
  { id: '2', timestamp: '29/05 11:00', user: 'System', action: 'SYNC', entity: 'Attendance', entityId: 'ATT-2024', details: 'Đồng bộ chấm công 46 nhân viên', status: 'success' },
  { id: '3', timestamp: '29/05 10:30', user: 'admin@asnova', action: 'CALCULATE', entity: 'Payslip', entityId: 'PSL-045', details: 'Tính lại phiếu lương Nguyễn Văn An', status: 'success' },
  { id: '4', timestamp: '29/05 10:00', user: 'System', action: 'OUTBOUND', entity: 'LarkBase', entityId: 'TBL-ATT', details: 'Đẩy bảng công 38 dòng → Lark Base', status: 'warning' },
  { id: '5', timestamp: '29/05 09:30', user: 'System', action: 'SYNC', entity: 'Employee', entityId: 'EMP-046', details: 'Cập nhật 2 nhân viên mới', status: 'success' },
  { id: '6', timestamp: '28/05 18:00', user: 'admin@asnova', action: 'CLOSE', entity: 'Period', entityId: 'PER-04', details: 'Chốt kỳ T04/2026', status: 'success' },
  { id: '7', timestamp: '28/05 17:30', user: 'System', action: 'CALCULATE', entity: 'OT', entityId: 'OT-062', details: 'Tổng hợp OT 12 nhân viên', status: 'success' },
  { id: '8', timestamp: '28/05 16:00', user: 'admin@asnova', action: 'UPDATE', entity: 'SalaryPolicy', entityId: 'SAL-023', details: 'Cập nhật lương Trần Thị B → 18M', status: 'success' },
];

const ACTIONS = [
  { value: '', label: 'Tất cả' },
  { value: 'SYNC', label: 'Đồng bộ' },
  { value: 'CALCULATE', label: 'Tính toán' },
  { value: 'CLOSE', label: 'Chốt kỳ' },
  { value: 'OUTBOUND', label: 'Đẩy ra' },
  { value: 'UPDATE', label: 'Cập nhật' },
];

export default function Audit() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  const filtered = useMemo(() => {
    return MOCK_DATA.filter(r => {
      if (search && !r.details.toLowerCase().includes(search.toLowerCase())) return false;
      if (actionFilter && r.action !== actionFilter) return false;
      return true;
    });
  }, [search, actionFilter]);

  const columns: Column<AuditRow>[] = [
    { key: 'timestamp', header: 'Thời gian', type: 'date', width: '110px' },
    { key: 'user', header: 'Người dùng', width: '120px' },
    {
      key: 'action',
      header: 'Hành động',
      render: (row) => <StatusBadge status={row.action.toLowerCase()} label={row.action} dot={false} />,
    },
    { key: 'entity', header: 'Đối tượng', width: '100px' },
    { key: 'details', header: 'Chi tiết' },
    {
      key: 'status',
      header: 'Kết quả',
      render: (row) => <StatusBadge status={row.status} label={row.status === 'success' ? 'OK' : 'Cảnh báo'} />,
    },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
      <PageHeader title="Audit Log" subtitle="Lịch sử hoạt động hệ thống" />
      <div className="flex flex-col sm:flex-row gap-3">
        <FormInput placeholder="Tìm kiếm..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
        <Dropdown options={ACTIONS} value={actionFilter} onChange={setActionFilter} placeholder="Hành động" className="w-40" />
      </div>
      <DataTable columns={columns} data={filtered} pageSize={20} rowKey="id" />
    </motion.div>
  );
}
