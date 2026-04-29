import { useState } from 'react';
import { ChevronRight, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

// ── helpers ──────────────────────────────────────────────────────────────────

// Detect which columns in a record are child subquery results (Salesforce wraps them as { records: [...], totalSize: n, done: true })
function isSubqueryResult(val) {
  return val && typeof val === 'object' && Array.isArray(val.records) && 'totalSize' in val;
}

function fmtVal(key, val) {
  if (val == null || val === '') return '—';
  if (typeof val === 'object') {
    if (isSubqueryResult(val)) return '(subquery)';
    // Try to extract Name from relationship objects
    if (val.Name != null) return String(val.Name);
    // Fallback for other object types
    return '(object)';
  }
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (key.toLowerCase().includes('date')) {
    try { return format(new Date(val), 'dd MMM yyyy'); } catch { return val; }
  }
  if (
    key.toLowerCase().includes('amount') ||
    key.toLowerCase().includes('price') ||
    key.toLowerCase().includes('invoice') ||
    key.toLowerCase().includes('total') ||
    key.toLowerCase().includes('cost')
  ) {
    const n = Number(val);
    if (!isNaN(n)) return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  if (typeof val === 'number') return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const s = String(val);
  return s.length > 60 ? s.slice(0, 58) + '…' : s;
}

function colLabel(key) {
  return key.replace(/__c$/i, '').replace(/__r$/i, '').replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
}

// ── SubTable ─────────────────────────────────────────────────────────────────

function SubTable({ subqueryResult, label, depth = 0 }) {
  const [expandedSubRows, setExpandedSubRows] = useState(new Set());
  if (!subqueryResult?.records?.length) {
    return <p className="text-xs text-muted-foreground italic px-2 py-1">No {label} records</p>;
  }
  const rows = subqueryResult.records;
  const allCols = Object.keys(rows[0]).filter(k => k !== 'attributes');
  const mainCols = allCols.filter(k => !isSubqueryResult(rows[0][k]));
  const nestedCols = allCols.filter(k => isSubqueryResult(rows[0][k]));
  const hasNested = nestedCols.length > 0;

  const colors = depth === 0
    ? { bg: 'bg-purple-50', border: 'border-purple-200', th: 'text-purple-700', header: 'bg-purple-100/60', headerText: 'text-purple-600' }
    : { bg: 'bg-orange-50', border: 'border-orange-200', th: 'text-orange-700', header: 'bg-orange-100/60', headerText: 'text-orange-600' };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className={`${colors.bg} border-b ${colors.border}`}>
            {hasNested && <th className="py-1.5 px-2 w-6" />}
            {mainCols.map(c => (
              <th key={c} className={`py-1.5 px-2.5 text-left font-semibold ${colors.th} whitespace-nowrap`}>
                {colLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isExpanded = expandedSubRows.has(i);
            return (
              <>
                <tr
                  key={row.Id || i}
                  className={`border-b ${colors.border} hover:${colors.bg}/50 transition-colors ${hasNested ? 'cursor-pointer' : ''}`}
                  onClick={hasNested ? () => setExpandedSubRows(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; }) : undefined}
                >
                  {hasNested && (
                    <td className="py-1.5 px-2 text-muted-foreground">
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </td>
                  )}
                  {mainCols.map(c => (
                    <td key={c} className="py-1.5 px-2.5 text-foreground whitespace-nowrap">
                      {fmtVal(c, row[c])}
                    </td>
                  ))}
                </tr>
                {hasNested && isExpanded && (
                  <tr key={`nsub-${i}`} className={`${colors.bg}/30`}>
                    <td colSpan={mainCols.length + 1} className="p-0">
                      {nestedCols.map(nc => (
                        <div key={nc} className={`border-t ${colors.border}`}>
                          <div className={`px-4 py-1 ${colors.header} flex items-center gap-2`}>
                            <span className={`text-[9px] font-bold ${colors.headerText} uppercase tracking-wide`}>{colLabel(nc)}</span>
                            <span className={`text-[9px] ${colors.headerText}/60`}>({row[nc]?.totalSize ?? 0} records)</span>
                          </div>
                          <div className="px-2 py-1">
                            <SubTable subqueryResult={row[nc]} label={colLabel(nc)} depth={depth + 1} />
                          </div>
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ExpandableResultsTable({ records }) {
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [allExpanded, setAllExpanded] = useState(false);

  if (!records?.length) return (
    <div className="text-center py-8 text-muted-foreground text-sm">No records</div>
  );

  // Separate main columns from subquery columns
  const firstRow = records[0];
  const allKeys = Object.keys(firstRow).filter(k => k !== 'attributes');
  const mainCols = allKeys.filter(k => !isSubqueryResult(firstRow[k]));
  const subqueryCols = allKeys.filter(k => isSubqueryResult(firstRow[k]));
  const hasSubtables = subqueryCols.length > 0;

  const toggleRow = (idx) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedRows(new Set());
      setAllExpanded(false);
    } else {
      setExpandedRows(new Set(records.map((_, i) => i)));
      setAllExpanded(true);
    }
  };

  // Compute totals for numeric columns
  const numericCols = mainCols.filter(c => records.some(r => typeof r[c] === 'number'));
  const totals = {};
  numericCols.forEach(c => {
    totals[c] = records.reduce((sum, r) => sum + (typeof r[c] === 'number' ? r[c] : 0), 0);
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {hasSubtables && (
              <th className="py-2.5 px-2 w-8">
                <button
                  onClick={toggleAll}
                  title={allExpanded ? 'Collapse all' : 'Expand all'}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronsUpDown className="w-3.5 h-3.5" />
                </button>
              </th>
            )}
            {mainCols.map(c => {
              const isNum = typeof records[0]?.[c] === 'number';
              return (
                <th key={c} className={`py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${isNum ? 'text-right' : 'text-left'}`}>
                  {colLabel(c)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {records.map((row, idx) => {
            const isExpanded = expandedRows.has(idx);
            return (
              <>
                <tr
                  key={`row-${idx}`}
                  className={`border-b border-border/50 transition-colors ${
                    hasSubtables ? 'cursor-pointer hover:bg-muted/30' : 'hover:bg-muted/30'
                  } ${isExpanded ? 'bg-muted/20' : ''}`}
                  onClick={hasSubtables ? () => toggleRow(idx) : undefined}
                >
                  {hasSubtables && (
                    <td className="py-2.5 px-2 text-muted-foreground">
                      {isExpanded
                        ? <ChevronDown className="w-3.5 h-3.5" />
                        : <ChevronRight className="w-3.5 h-3.5" />}
                    </td>
                  )}
                  {mainCols.map(c => {
                    const v = row[c];
                    const isNum = typeof v === 'number';
                    return (
                      <td key={c} className={`py-2.5 px-3 text-foreground whitespace-nowrap ${isNum ? 'text-right font-mono' : ''}`}>
                        {fmtVal(c, v)}
                      </td>
                    );
                  })}
                </tr>
                {hasSubtables && isExpanded && (
                  <tr key={`sub-${idx}`} className="bg-purple-50/30">
                    <td colSpan={mainCols.length + 1} className="p-0">
                      <div className="border-b border-purple-200">
                        {subqueryCols.map(col => (
                          <div key={col} className="border-t border-purple-100 first:border-t-0">
                            <div className="px-4 py-1.5 bg-purple-100/60 flex items-center gap-2">
                              <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wide">
                                {colLabel(col)}
                              </span>
                              <span className="text-[10px] text-purple-400">
                                ({row[col]?.totalSize ?? 0} records)
                              </span>
                            </div>
                            <div className="px-2 py-1">
                              <SubTable subqueryResult={row[col]} label={colLabel(col)} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
          {numericCols.length > 0 && (
            <tr className="border-t-2 border-border bg-muted/40 font-semibold sticky bottom-0">
              {hasSubtables && <td className="py-2.5 px-2" />}
              {mainCols.map(c => {
                const isNum = numericCols.includes(c);
                return (
                  <td key={c} className={`py-2.5 px-3 whitespace-nowrap ${isNum ? 'text-right font-mono text-foreground' : 'text-xs text-muted-foreground'}`}>
                    {isNum ? fmtVal(c, totals[c]) : (mainCols.indexOf(c) === 0 ? 'TOTAL' : '')}
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}