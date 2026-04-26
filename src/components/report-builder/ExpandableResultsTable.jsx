import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtVal(key, val) {
  if (val == null || val === '') return '—';
  if (typeof val === 'object') {
    if (isSubqueryResult(val)) return '(subquery)';
    return '(object)'; // nested object, not a subquery
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
  if (typeof val === 'number') return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const s = String(val);
  return s.length > 60 ? s.slice(0, 58) + '…' : s;
}

function colLabel(key) {
  return key.replace(/__c$/i, '').replace(/__r$/i, '').replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
}

// Detect which columns in a record are child subquery results (Salesforce wraps them as { records: [...], totalSize: n, done: true })
function isSubqueryResult(val) {
  return val && typeof val === 'object' && Array.isArray(val.records) && 'totalSize' in val;
}

// ── SubTable ─────────────────────────────────────────────────────────────────

function SubTable({ subqueryResult, label }) {
  if (!subqueryResult?.records?.length) {
    return <p className="text-xs text-muted-foreground italic px-2 py-1">No {label} records</p>;
  }
  const rows = subqueryResult.records;
  const cols = Object.keys(rows[0]).filter(k => k !== 'attributes');

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-purple-50 border-b border-purple-200">
            {cols.map(c => (
              <th key={c} className="py-1.5 px-2.5 text-left font-semibold text-purple-700 whitespace-nowrap">
                {colLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.Id || i} className="border-b border-purple-100 hover:bg-purple-50/50 transition-colors">
              {cols.map(c => (
                <td key={c} className="py-1.5 px-2.5 text-foreground whitespace-nowrap">
                  {isSubqueryResult(row[c]) ? '(nested)' : fmtVal(c, row[c])}
                </td>
              ))}
            </tr>
          ))}
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
            {mainCols.map(c => (
              <th key={c} className="py-2.5 px-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                {colLabel(c)}
              </th>
            ))}
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
                  {mainCols.map(c => (
                    <td key={c} className="py-2.5 px-3 text-foreground whitespace-nowrap">
                      {fmtVal(c, row[c])}
                    </td>
                  ))}
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
        </tbody>
      </table>
    </div>
  );
}