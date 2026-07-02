import { useState } from 'react';
import { ChevronRight, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { format } from 'date-fns';
import FieldHoverInfo from '@/components/common/FieldHoverInfo';
import { compactTextValue, textValue } from '@/lib/displayValue';

// ── helpers ──────────────────────────────────────────────────────────────────

function isSubqueryResult(val) {
  return val && typeof val === 'object' && 'totalSize' in val && (Array.isArray(val.records) || val.records === null);
}

function fmtVal(key, val) {
  if (val == null || val === '') return '—';
  if (typeof val === 'object') {
    if (isSubqueryResult(val)) return '(subquery)';
    return compactTextValue(val, 60);
  }
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (key.toLowerCase().includes('date')) {
    try { return format(new Date(val), 'dd MMM yyyy'); } catch { return textValue(val); }
  }
  if (
    key.toLowerCase().includes('amount') ||
    key.toLowerCase().includes('price') ||
    key.toLowerCase().includes('invoice') ||
    key.toLowerCase().includes('total') ||
    key.toLowerCase().includes('cost') ||
    key.toLowerCase().includes('commission')
  ) {
    const n = Number(val);
    if (!isNaN(n)) return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (typeof val === 'number') return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return compactTextValue(val, 60);
}

function colLabel(key) {
  return key.replace(/__c$/i, '').replace(/__r$/i, '').replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
}

// ── SubTable ─────────────────────────────────────────────────────────────────

function SubTable({ subqueryResult, label, depth = 0, knownNestedCols = [] }) {
  const [expandedSubRows, setExpandedSubRows] = useState(new Set());
  const [hoverInfo, setHoverInfo] = useState(null);
  if (!subqueryResult?.records?.length) {
    return <p className="text-xs text-muted-foreground italic px-2 py-1">No {label} records</p>;
  }
  const rows = subqueryResult.records || [];

  // Scan ALL rows to detect subquery cols. Also include knownNestedCols passed from parent
  // (needed when this specific record's rows all have null for a nested subquery col,
  // but sibling records in the parent DO have data — the column still exists)
  const allCols = Array.from(new Set(rows.flatMap(r => Object.keys(r)))).filter(k => k !== 'attributes');
  const detectedNestedCols = allCols.filter(k => rows.some(r => isSubqueryResult(r[k])));
  // Also treat cols ending in __r that are null (potential subquery cols) as nested if known from siblings
  const nullRelCols = allCols.filter(k => k.endsWith('__r') && !detectedNestedCols.includes(k) && rows.every(r => r[k] === null));
  const nestedCols = [...new Set([...detectedNestedCols, ...knownNestedCols.filter(k => allCols.includes(k)), ...nullRelCols])];
  const mainCols = allCols.filter(k => !nestedCols.includes(k));
  const hasNested = nestedCols.length > 0;

  const colors = depth === 0
    ? { bg: 'bg-purple-50', border: 'border-purple-200', th: 'text-purple-700', header: 'bg-purple-100/60', headerText: 'text-purple-600' }
    : { bg: 'bg-orange-50', border: 'border-orange-200', th: 'text-orange-700', header: 'bg-orange-100/60', headerText: 'text-orange-600' };

  const toggleSubRow = (i) => setExpandedSubRows(prev => {
    const s = new Set(prev);
    s.has(i) ? s.delete(i) : s.add(i);
    return s;
  });

  const showColumnInfo = (col) => {
    const sample = rows.find(r => r[col] !== null && r[col] !== undefined && r[col] !== '') || rows[0];
    setHoverInfo({
      label: colLabel(col),
      fieldName: col,
      recordId: sample?.Id || sample?.id || '—',
      sampleValue: sample ? fmtVal(col, sample[col]) : '—',
    });
  };

  // Build flat array of <tr> elements to avoid Fragment prop issues
  const bodyRows = [];
  rows.forEach((row, i) => {
    const isExpanded = expandedSubRows.has(i);
    bodyRows.push(
      <tr
        key={`sub-row-${i}`}
        className={`border-b ${colors.border} transition-colors ${hasNested ? 'cursor-pointer hover:bg-muted/10' : ''}`}
        onClick={hasNested ? () => toggleSubRow(i) : undefined}
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
    );
    if (hasNested && isExpanded) {
      bodyRows.push(
        <tr key={`sub-nested-${i}`} className="bg-orange-50/40">
          <td colSpan={mainCols.length + 1} className="p-0">
            {nestedCols.map(nc => {
              const subVal = row[nc];
              return (
                <div key={nc} className={`border-t ${colors.border}`}>
                  <div className={`px-4 py-1 ${colors.header} flex items-center gap-2`}>
                    <span className={`text-[9px] font-bold ${colors.headerText} uppercase tracking-wide`}>{colLabel(nc)}</span>
                    <span className={`text-[9px] ${colors.headerText}/60`}>
                      ({isSubqueryResult(subVal) ? subVal.totalSize : 0} records)
                    </span>
                  </div>
                  <div className="px-2 py-1">
                    {isSubqueryResult(subVal)
                      ? <SubTable subqueryResult={subVal} label={colLabel(nc)} depth={depth + 1} />
                      : <p className="text-xs text-muted-foreground italic px-2 py-1">No {colLabel(nc)} records</p>
                    }
                  </div>
                </div>
              );
            })}
          </td>
        </tr>
      );
    }
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className={`${colors.bg} border-b ${colors.border}`}>
            {hasNested && <th className="py-1.5 px-2 w-6" />}
            {mainCols.map(c => (
              <th
                key={c}
                onMouseEnter={() => showColumnInfo(c)}
                onMouseLeave={() => setHoverInfo(null)}
                className={`py-1.5 px-2.5 text-left font-semibold ${colors.th} whitespace-nowrap`}
              >
                {colLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{bodyRows}</tbody>
      </table>
      <FieldHoverInfo info={hoverInfo} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ExpandableResultsTable({ records }) {
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [hoverInfo, setHoverInfo] = useState(null);

  if (!records?.length) return (
    <div className="text-center py-8 text-muted-foreground text-sm">No records</div>
  );

  // Scan ALL rows to correctly detect subquery columns
  const allKeys = Array.from(new Set(records.flatMap(r => Object.keys(r)))).filter(k => k !== 'attributes');
  const subqueryCols = allKeys.filter(k => records.some(r => isSubqueryResult(r[k])));
  const mainCols = allKeys.filter(k => !subqueryCols.includes(k));
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

  const showColumnInfo = (col) => {
    const sample = records.find(r => r[col] !== null && r[col] !== undefined && r[col] !== '') || records[0];
    setHoverInfo({
      label: colLabel(col),
      fieldName: col,
      recordId: sample?.Id || sample?.id || '—',
      sampleValue: sample ? fmtVal(col, sample[col]) : '—',
    });
  };

  // Compute totals for numeric columns
  const numericCols = mainCols.filter(c => records.some(r => typeof r[c] === 'number'));
  const totals = {};
  numericCols.forEach(c => {
    totals[c] = records.reduce((sum, r) => sum + (typeof r[c] === 'number' ? r[c] : 0), 0);
  });

  // For each subquery column, scan ALL records to find which nested cols appear anywhere
  // This ensures SubTable knows about nested cols even if a specific row has all-null values
  const allNestedColsPerSubquery = {};
  subqueryCols.forEach(col => {
    const nestedSet = new Set();
    records.forEach(row => {
      const sub = row[col];
      if (isSubqueryResult(sub) && sub.records) {
        sub.records.forEach(r => {
          Object.keys(r).filter(k => k !== 'attributes' && (isSubqueryResult(r[k]) || (k.endsWith('__r') && r[k] === null))).forEach(k => nestedSet.add(k));
        });
      }
    });
    allNestedColsPerSubquery[col] = [...nestedSet];
  });

  // Build flat array of <tr> elements to avoid Fragment prop issues from dev tooling
  const bodyRows = [];
  records.forEach((row, idx) => {
    const isExpanded = expandedRows.has(idx);
    bodyRows.push(
      <tr
        key={`row-${idx}`}
        className={`border-b border-border/50 transition-colors ${hasSubtables ? 'cursor-pointer hover:bg-muted/30' : 'hover:bg-muted/30'} ${isExpanded ? 'bg-muted/20' : ''}`}
        onClick={hasSubtables ? () => toggleRow(idx) : undefined}
      >
        {hasSubtables && (
          <td className="py-2.5 px-2 text-muted-foreground">
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
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
    );
    if (hasSubtables && isExpanded) {
      bodyRows.push(
        <tr key={`sub-${idx}`} className="bg-purple-50/30">
          <td colSpan={mainCols.length + 1} className="p-0">
            <div className="border-b border-purple-200">
              {subqueryCols.map(col => (
                <div key={col} className="border-t border-purple-100 first:border-t-0">
                  <div className="px-4 py-1.5 bg-purple-100/60 flex items-center gap-2">
                    <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wide">{colLabel(col)}</span>
                    <span className="text-[10px] text-purple-400">({row[col]?.totalSize ?? 0} records)</span>
                  </div>
                  <div className="px-2 py-1">
                    <SubTable
                      subqueryResult={row[col]}
                      label={colLabel(col)}
                      knownNestedCols={allNestedColsPerSubquery[col] || []}
                    />
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      );
    }
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {hasSubtables && (
              <th className="py-2.5 px-2 w-8">
                <button onClick={toggleAll} title={allExpanded ? 'Collapse all' : 'Expand all'} className="text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronsUpDown className="w-3.5 h-3.5" />
                </button>
              </th>
            )}
            {mainCols.map(c => {
              const isNum = records.some(r => typeof r[c] === 'number');
              return (
                <th
                  key={c}
                  onMouseEnter={() => showColumnInfo(c)}
                  onMouseLeave={() => setHoverInfo(null)}
                  className={`py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${isNum ? 'text-right' : 'text-left'}`}
                >
                  {colLabel(c)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {bodyRows}
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
      <FieldHoverInfo info={hoverInfo} />
    </div>
  );
}
