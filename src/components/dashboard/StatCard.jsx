import { cn } from '@/lib/utils';

export default function StatCard({ label, value, sub, icon: Icon, trend, color = 'blue' }) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-violet-50 text-violet-600',
    teal: 'bg-cyan-50 text-cyan-600',
    red: 'bg-red-50 text-red-600',
  };

  return (
    <div className="bg-card rounded-xl border border-border p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', colorMap[color])}>
            <Icon className="w-4.5 h-4.5" />
          </div>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground font-dm tracking-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {trend && (
        <p className={cn('text-xs font-medium', trend.positive ? 'text-emerald-600' : 'text-red-500')}>
          {trend.positive ? '↑' : '↓'} {trend.label}
        </p>
      )}
    </div>
  );
}