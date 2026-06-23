const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  active: { bg: '#2563eb20', fg: '#2563eb' },
  completed: { bg: '#16a34a20', fg: '#16a34a' },
  closed: { bg: '#16a34a20', fg: '#16a34a' },
  pending: { bg: '#d9770620', fg: '#d97706' },
  scheduled: { bg: '#d9770620', fg: '#d97706' },
  open: { bg: '#2563eb20', fg: '#2563eb' },
  failed: { bg: '#dc262620', fg: '#dc2626' },
  error: { bg: '#dc262620', fg: '#dc2626' },
  progress: { bg: '#7c3aed20', fg: '#7c3aed' },
  closing: { bg: '#7c3aed20', fg: '#7c3aed' },
  review: { bg: '#0891b220', fg: '#0891b2' },
  ready: { bg: '#0891b220', fg: '#0891b2' },
  approved: { bg: '#05966920', fg: '#059669' },
  draft: { bg: '#94a3b820', fg: '#94a3b8' },
  confirmed: { bg: '#16a34a20', fg: '#16a34a' },
  paid: { bg: '#05966920', fg: '#059669' },
};

interface StatusBadgeProps {
  status: string;
  label?: string;
  dot?: boolean;
}

export function StatusBadge({ status, label, dot = true }: StatusBadgeProps) {
  const key = status.toLowerCase();
  const colors = STATUS_COLORS[key] ?? { bg: '#94a3b820', fg: '#94a3b8' };
  const displayLabel = label ?? status;

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[10px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: colors.bg, color: colors.fg }}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.fg }} />}
      {displayLabel}
    </span>
  );
}
