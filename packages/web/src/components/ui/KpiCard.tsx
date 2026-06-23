import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  color?: string;
  trend?: { value: number; label?: string };
}

export function KpiCard({ label, value, subtitle, icon: Icon, color = '#2563eb', trend }: KpiCardProps) {
  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: '0 8px 25px rgba(0,0,0,.08)' }}
      className="bg-card border border-border rounded-xl p-5 shadow-sm hover:border-primary/30 transition-colors relative overflow-hidden"
    >
      {/* Decorative glow */}
      <div
        className="absolute -right-6 -top-6 w-24 h-24 rounded-full blur-3xl opacity-[0.06]"
        style={{ backgroundColor: color }}
      />

      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        {Icon && (
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
            <Icon size={18} style={{ color }} />
          </div>
        )}
      </div>

      <h3 className="text-xl font-bold text-foreground tabular-nums">{value}</h3>

      <div className="flex items-center gap-2 mt-1.5">
        {trend && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
            style={{
              backgroundColor: trend.value >= 0 ? '#16a34a20' : '#dc262620',
              color: trend.value >= 0 ? '#16a34a' : '#dc2626',
            }}
          >
            {trend.value >= 0 ? '↗' : '↘'} {Math.abs(trend.value)}%
          </span>
        )}
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </motion.div>
  );
}
