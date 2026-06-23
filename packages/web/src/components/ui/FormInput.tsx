interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  money?: boolean;
}

export function FormInput({ label, error, money, className = '', ...props }: FormInputProps) {
  return (
    <div>
      {label && <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">{label}</label>}
      <input
        className={`w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground
          focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 shadow-xs hover:border-primary/30
          placeholder:text-muted-foreground/60 transition-all
          ${money ? 'tabular-nums' : ''}
          ${error ? 'border-destructive/50 ring-1 ring-destructive/20' : ''}
          ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
