import { cn } from '@/lib/utils';

export default function TableShell({ title, meta, actions, children, className, bodyClassName = 'p-2' }) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-card', className)}>
      {(title || meta || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
            {meta && <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}
