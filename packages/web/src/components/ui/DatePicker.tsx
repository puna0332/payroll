import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
}

const DAYS_VI = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MONTHS_VI = [
  'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
  'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1; // Monday = 0
}

export function DatePicker({ value, onChange, label, placeholder = 'dd/mm/yyyy', className = '' }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const parsed = value ? new Date(value) : null;
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? new Date().getMonth());

  // Position dropdown relative to trigger
  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownH = 340;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= dropdownH ? rect.bottom + 4 : rect.top - dropdownH - 4;
    setPos({ top, left: rect.left });
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Close on scroll
  useEffect(() => {
    if (!isOpen) return;
    const handler = () => setIsOpen(false);
    window.addEventListener('scroll', handler, true);
    return () => window.removeEventListener('scroll', handler, true);
  }, [isOpen]);

  const handleSelect = useCallback((day: number) => {
    const y = viewYear;
    const m = String(viewMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    onChange(`${y}-${m}-${d}`);
    setIsOpen(false);
  }, [viewYear, viewMonth, onChange]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const goToday = () => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    handleSelect(now.getDate());
  };

  // Build calendar grid
  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);
  const prevMonthDays = getDaysInMonth(viewYear, viewMonth === 0 ? 11 : viewMonth - 1);

  const cells: Array<{ day: number; current: boolean; today: boolean; selected: boolean }> = [];

  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ day: prevMonthDays - i, current: false, today: false, selected: false });
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({
      day: d,
      current: true,
      today: dateStr === todayStr,
      selected: dateStr === value,
    });
  }

  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, current: false, today: false, selected: false });
  }

  const displayValue = parsed
    ? `${String(parsed.getDate()).padStart(2, '0')}/${String(parsed.getMonth() + 1).padStart(2, '0')}/${parsed.getFullYear()}`
    : '';

  return (
    <div className={`relative ${className}`}>
      {label && (
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">{label}</label>
      )}

      {/* Input trigger */}
      <button ref={triggerRef} type="button" onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center justify-between bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-left
          focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 shadow-xs cursor-pointer
          hover:border-border-strong transition-colors">
        <span className={displayValue ? 'text-foreground tabular-nums' : 'text-muted-foreground'}>
          {displayValue || placeholder}
        </span>
        <Calendar size={14} className="text-muted-foreground" />
      </button>

      {/* Portal-rendered Calendar Dropdown */}
      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <motion.div
              ref={dropdownRef}
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ type: 'spring', damping: 25, stiffness: 400 }}
              style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 99999 }}
              className="w-[280px] bg-card border border-border rounded-xl shadow-2xl p-3"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={prevMonth}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-sm font-semibold text-foreground">
                  {MONTHS_VI[viewMonth]} {viewYear}
                </span>
                <button type="button" onClick={nextMonth}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  <ChevronRight size={14} />
                </button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 gap-0 mb-1">
                {DAYS_VI.map(d => (
                  <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground py-1">
                    {d}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-0">
                {cells.map((cell, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => cell.current && handleSelect(cell.day)}
                    disabled={!cell.current}
                    className={`
                      w-full aspect-square flex items-center justify-center text-xs rounded-lg transition-all cursor-pointer
                      ${cell.selected
                        ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                        : cell.today
                          ? 'bg-primary/10 text-primary font-semibold'
                          : cell.current
                            ? 'text-foreground hover:bg-muted'
                            : 'text-muted-foreground/30'
                      }
                      ${!cell.current ? 'cursor-default' : ''}
                    `}
                  >
                    {cell.day}
                  </button>
                ))}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                <button type="button" onClick={() => { onChange(''); setIsOpen(false); }}
                  className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
                  Xóa
                </button>
                <button type="button" onClick={goToday}
                  className="text-[10px] text-primary font-semibold hover:text-primary/80 cursor-pointer transition-colors">
                  Hôm nay
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
