import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import FieldHoverInfo from '@/components/common/FieldHoverInfo';
import { compactTextValue, numericValue, textValue } from '@/lib/displayValue';

const isMoneyKey = (key) =>
  key.toLowerCase().includes('amount') ||
  key.toLowerCase().includes('balance') ||
  key.toLowerCase().includes('receivable') ||
  key.toLowerCase().includes('invoice') ||
  key.toLowerCase().includes('price') ||
  key.toLowerCase().includes('profit') ||
  key.toLowerCase().includes('commission') ||
  key.toLowerCase().includes('total') ||
  key.toLowerCase().includes('cost');

const fmtVal = (key, val) => {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'object') return compactTextValue(val, 60);
  if (key.toLowerCase().includes('date')) {
    try { return format(new Date(val), 'dd MMM yyyy'); } catch { return textValue(val); }
  }
  const numeric = numericValue(val);
  if (numeric != null && (typeof val === 'number' || (typeof val === 'string' && val.trim() !== ''))) {
    const n = numeric;
    if (isMoneyKey(key)) {
      return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return compactTextValue(val, 60);
};

const colLabel = (key) =>
  key.replace(/__c$/i, '').replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();

export default function ExplorerResultsTable({ records = [] }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(1);
  const [search, setSearch] = useState('');
  const [hoverInfo, setHoverInfo] = useState(null);

  const columns = records.length > 0 ? Object.keys(records[0]).filter(k => k !== 'Id') : [];
  const isNumericColumn = (key) => records.some(row => row[key] !== null && row[key] !== undefined && row[key] !== '' && !isNaN(Number(row[key])));

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d * -1);
    else { setSortKey(key); setSortDir(1); }
  };

  const filtered = useMemo(() => {
    let rows = records;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r => columns.some(c => r[c] != null && textValue(r[c], '').toLowerCase().includes(q)));
    }
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const an = Number(av), bn = Number(bv);
        if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortDir;
        return textValue(av).localeCompare(textValue(bv)) * sortDir;
      });
    }
    return rows;
  }, [records, search, sortKey, sortDir]);

  const showColumnInfo = (col) => {
    const sample = filtered.find(r => r[col] !== null && r[col] !== undefined && r[col] !== '') || records[0];
    setHoverInfo({
      label: colLabel(col),
      fieldName: col,
      recordId: sample?.Id || sample?.id || '—',
      sampleValue: sample ? fmtVal(col, sample[col]) : '—',
    });
  };

  if (!records.length) return (
    <div className="text-center py-8 text-muted-foreground text-sm">No records</div>
  );

  return (
    <div>
      <div className="px-3 pb-3">
        <Input
          placeholder="Search results…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-8 text-xs w-64"
        />
      </div>
      <div className="max-h-[620px] overflow-auto rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {columns.map(col => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  onMouseEnter={() => showColumnInfo(col)}
                  onMouseLeave={() => setHoverInfo(null)}
                  className={`sticky top-0 z-10 bg-card py-2.5 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors ${isNumericColumn(col) ? 'text-right' : 'text-left'} ${sortKey === col ? 'text-foreground' : ''}`}
                >
                  <span className={`flex items-center gap-1 ${isNumericColumn(col) ? 'justify-end' : ''}`}>
                    {colLabel(col)}
                    {sortKey === col
                      ? (sortDir === 1 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                      : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={row.Id || i} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                {columns.map(col => (
                  <td key={col} className={`py-2.5 px-3 whitespace-nowrap text-foreground ${isNumericColumn(col) ? 'text-right tabular-nums' : ''}`}>
                    {fmtVal(col, row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-6 text-muted-foreground text-sm">No matching records</div>
        )}
      </div>
      <FieldHoverInfo info={hoverInfo} />
    </div>
  );
}
