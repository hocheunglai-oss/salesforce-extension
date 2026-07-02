import { format } from 'date-fns';
import { compactTextValue, textValue } from '@/lib/displayValue';

export default function RecentStemsTable({ records = [] }) {
  if (!records.length) return (
    <div className="text-center py-8 text-muted-foreground text-sm">No recent records</div>
  );

  const columns = Object.keys(records[0]).filter(k => k !== 'Id');

  const formatVal = (key, val) => {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'boolean') return val ? 'Yes' : 'No';
    if (key.toLowerCase().includes('date') || key.toLowerCase().includes('Date')) {
      if (typeof val === 'object') return textValue(val);
      try { return format(new Date(val), 'dd MMM yyyy'); } catch { return textValue(val); }
    }
    if (typeof val === 'number') {
      return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return compactTextValue(val, 40);
  };

  const colLabel = (key) => key
    .replace(/__c$/, '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim();

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map(col => (
              <th key={col} className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                {colLabel(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((row, i) => (
            <tr key={row.Id || i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
              {columns.map(col => (
                <td key={col} className="py-2.5 px-3 text-foreground whitespace-nowrap">
                  {formatVal(col, row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
