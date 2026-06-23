import { motion } from 'framer-motion';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────

export type ColumnType = 'text' | 'number' | 'money' | 'date' | 'status' | 'custom';
type SortDir = 'asc' | 'desc' | null;

export interface Column<T> {
  key: string;
  header: string;
  type?: ColumnType;
  sortable?: boolean;
  width?: string;
  render?: (row: T, index: number) => React.ReactNode;
}

interface DataTableProps<T extends object> {
  columns: Column<T>[];
  data: T[];
  pageSize?: number;
  selectable?: boolean;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  loading?: boolean;
  rowKey?: string;
  actions?: (row: T) => React.ReactNode;
}

// ─── Helpers ────────────────────────────────────────────────

function formatMoney(val: unknown): string {
  const num = Number(val);
  if (isNaN(num)) return '—';
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(num);
}

function getCellClasses(type?: ColumnType): string {
  switch (type) {
    case 'number':
    case 'money':
      return 'text-right font-mono text-xs tabular-nums';
    case 'date':
      return 'font-mono text-xs tabular-nums';
    default:
      return '';
  }
}

function getRowValue<T extends object>(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

// ─── Component ──────────────────────────────────────────────

export function DataTable<T extends object>({
  columns,
  data,
  pageSize = 15,
  selectable = false,
  onRowClick,
  emptyMessage = 'Không có dữ liệu',
  loading = false,
  rowKey = 'id',
  actions,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  // Sort handler
  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc'));
      if (sortDir === 'desc') setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  }, [sortKey, sortDir]);

  // Sorted data
  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return data;
    return [...data].sort((a, b) => {
      const av = getRowValue(a, sortKey) as string | number;
      const bv = getRowValue(b, sortKey) as string | number;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pagedData = sorted.slice((page - 1) * pageSize, page * pageSize);

  // Selection
  const allSelected = pagedData.length > 0 && pagedData.every(r => selected.has(String(getRowValue(r, rowKey))));
  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pagedData.map(r => String(getRowValue(r, rowKey)))));
    }
  };
  const toggleRow = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Sort icon
  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return <ArrowUpDown size={13} className="text-muted-foreground/40" />;
    return sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />;
  };

  // Loading skeleton
  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="animate-pulse">
          <div className="h-10 bg-muted/30 border-b border-border" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 border-b border-border/50 flex items-center px-4 gap-4">
              <div className="h-3 bg-muted rounded w-24" />
              <div className="h-3 bg-muted rounded w-32" />
              <div className="h-3 bg-muted rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Selected bar */}
      {selected.size > 0 && (
        <div className="bg-primary/5 border-b border-primary/10 px-4 py-2 text-xs font-medium text-primary flex items-center gap-2">
          <span>{selected.size} đã chọn</span>
          <button onClick={() => setSelected(new Set())} className="text-primary/60 hover:text-primary cursor-pointer">— Bỏ chọn</button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          {/* Header */}
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              {selectable && (
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded border-[1.5px] border-border accent-primary cursor-pointer"
                  />
                </th>
              )}
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3 text-left
                    ${col.sortable !== false ? 'cursor-pointer select-none hover:text-foreground' : ''}
                    ${getCellClasses(col.type)}`}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={col.sortable !== false ? () => handleSort(col.key) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable !== false && <SortIcon col={col.key} />}
                  </span>
                </th>
              ))}
              {actions && <th className="w-10" />}
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {pagedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0) + (actions ? 1 : 0)} className="text-center py-12 text-sm text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pagedData.map((row, i) => {
                const id = String(getRowValue(row, rowKey));
                const isSelected = selected.has(id);

                return (
                  <motion.tr
                    key={id || i}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03, duration: 0.2 }}
                    className={`border-b border-border/50 transition-colors
                      ${onRowClick ? 'cursor-pointer hover:bg-muted/30' : ''}
                      ${isSelected ? 'bg-primary/[0.03]' : ''}`}
                    onClick={() => onRowClick?.(row)}
                  >
                    {selectable && (
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(id)}
                          className="w-4 h-4 rounded border-[1.5px] border-border accent-primary cursor-pointer"
                        />
                      </td>
                    )}
                    {columns.map(col => (
                      <td key={col.key} className={`px-4 py-3 text-sm ${getCellClasses(col.type)}`}>
                        {col.render
                          ? col.render(row, i)
                          : col.type === 'money'
                            ? formatMoney(getRowValue(row, col.key))
                            : String(getRowValue(row, col.key) ?? '—')}
                      </td>
                    ))}
                    {actions && (
                      <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
                        {actions(row)}
                      </td>
                    )}
                  </motion.tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="bg-muted/20 border-t border-border px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sorted.length)} / {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-30 cursor-pointer"
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const p = i + 1;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 text-xs rounded-lg font-medium transition-colors cursor-pointer
                    ${page === p ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground hover:bg-muted'}`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-30 cursor-pointer"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
