import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, X } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}

export function Dropdown({ options, value, onChange, placeholder = 'Chọn...', label, className = '' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className={`relative ${className}`}>
      {label && <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">{label}</label>}
      <button
        onClick={() => setOpen(!open)}
        className={`w-full bg-background border rounded-xl px-3.5 py-2.5 text-sm shadow-xs flex items-center justify-between transition-all cursor-pointer
          ${open ? 'border-primary/40 ring-2 ring-primary/10' : 'border-input hover:border-primary/30'}`}
      >
        <span className={selected ? 'text-foreground' : 'text-muted-foreground/60'}>{selected?.label ?? placeholder}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={16} className="text-muted-foreground" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute top-full left-0 right-0 mt-1.5 bg-popover border border-border rounded-xl shadow-lg overflow-hidden z-50 max-h-60 overflow-y-auto"
          >
            {options.map(opt => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full text-left px-3.5 py-2.5 text-sm transition-all flex items-center justify-between cursor-pointer
                  ${opt.value === value ? 'bg-primary/8 text-primary font-medium' : 'text-foreground hover:bg-muted/70'}`}
              >
                {opt.label}
                {opt.value === value && <Check size={14} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Multi-Select ───────────────────────────────────────────

interface MultiSelectProps {
  options: DropdownOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  label?: string;
}

export function MultiSelect({ options, values, onChange, placeholder = 'Chọn...', label }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (val: string) => {
    onChange(values.includes(val) ? values.filter(v => v !== val) : [...values, val]);
  };

  return (
    <div ref={ref} className="relative">
      {label && <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">{label}</label>}
      <button
        onClick={() => setOpen(!open)}
        className={`w-full bg-background border rounded-xl px-3.5 py-2.5 text-sm shadow-xs flex items-center justify-between transition-all cursor-pointer
          ${open ? 'border-primary/40 ring-2 ring-primary/10' : 'border-input hover:border-primary/30'}`}
      >
        <span className={values.length ? 'text-foreground' : 'text-muted-foreground/60'}>
          {values.length ? `${values.length} đã chọn` : placeholder}
        </span>
        <div className="flex items-center gap-1">
          {values.length > 0 && (
            <span onClick={(e) => { e.stopPropagation(); onChange([]); }} className="p-0.5 hover:bg-muted rounded cursor-pointer">
              <X size={12} className="text-muted-foreground" />
            </span>
          )}
          <ChevronDown size={16} className="text-muted-foreground" />
        </div>
      </button>

      {/* Tags */}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {values.map(v => {
            const opt = options.find(o => o.value === v);
            return (
              <span key={v} className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-lg font-medium flex items-center gap-1">
                {opt?.label ?? v}
                <button onClick={() => toggle(v)} className="hover:text-primary/60 cursor-pointer"><X size={12} /></button>
              </span>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute top-full left-0 right-0 mt-1.5 bg-popover border border-border rounded-xl shadow-lg overflow-hidden z-50 max-h-60 overflow-y-auto"
          >
            {options.map(opt => (
              <button
                key={opt.value}
                onClick={() => toggle(opt.value)}
                className="w-full text-left px-3.5 py-2.5 text-sm transition-all flex items-center gap-2.5 cursor-pointer hover:bg-muted/70"
              >
                <span className={`w-4 h-4 rounded border-[1.5px] flex items-center justify-center transition-colors
                  ${values.includes(opt.value) ? 'bg-primary border-primary' : 'border-border'}`}>
                  {values.includes(opt.value) && <Check size={10} className="text-primary-foreground" />}
                </span>
                {opt.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
