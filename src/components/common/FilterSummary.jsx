import { cn } from '@/lib/utils';

export function FilterChip({ label, value, tone = 'default' }) {
  const toneClass = tone === 'active'
    ? 'border-primary/30 bg-primary/10 text-primary'
    : 'border-border bg-muted/40 text-muted-foreground';

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium', toneClass)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </span>
  );
}

export default function FilterSummary({ title = 'Active Filters', children, className }) {
  return (
    <div className={cn('rounded-lg border border-border bg-muted/25 px-3 py-2', className)}>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
