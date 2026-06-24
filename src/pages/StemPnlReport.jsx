import { useState, useCallback } from 'react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, Loader2, Download, Play, TrendingUp, BarChart2 } from 'lucide-react';
import { format } from 'date-fns';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import PageHeader from '@/components/common/PageHeader';
import FilterSummary, { FilterChip } from '@/components/common/FilterSummary';
import TableShell from '@/components/common/TableShell';
import StateBlock from '@/components/common/StateBlock';

const fmt = (v, isPercent = false) => {
  if (v == null) return '—';
  if (isPercent) return `${Number(v).toFixed(1)}%`;
  return `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (v) => {
  if (!v) return '—';
  try { return format(new Date(v), 'dd MMM yyyy'); } catch { return v; }
};

const COLUMNS = [
  { key: 'Key',                label: 'Key',               num: false },
  { key: 'Buyer',              label: 'Buyer',             num: false },
  { key: 'Delivery_Date',      label: 'Delivery Date',     num: false, isDate: true },

  { key: 'Buyer_Invoice',      label: 'Buyer Invoice',     num: true },
  { key: 'Supplier_Invoice',   label: 'Supplier Invoice',  num: true },
  { key: 'Supplier_Broker_Comm', label: 'Supp. Broker',   num: true },
  { key: 'Buyer_Broker_Comm',  label: 'Buyer Broker',      num: true },
  { key: 'Net_Profit',         label: 'Gross Profit',      num: true },
  { key: 'Qlik_Total_Profit',  label: 'Qlik Net',          num: true },
  { key: 'Diff',               label: 'DIFF',              num: true },
];

const YEAR_OPTIONS = ['2026', '2025', '2024', '2023'];
const MONTH_OPTIONS = [
  { value: '01', label: 'January' }, { value: '02', label: 'February' },
  { value: '03', label: 'March' },   { value: '04', label: 'April' },
  { value: '05', label: 'May' },     { value: '06', label: 'June' },
  { value: '07', label: 'July' },    { value: '08', label: 'August' },
  { value: '09', label: 'September' },{ value: '10', label: 'October' },
  { value: '11', label: 'November' },{ value: '12', label: 'December' },
];

function StatCard({ label, value, sub, color = 'default' }) {
  const colorMap = {
    default: 'text-foreground',
    green: 'text-emerald-600',
    red: 'text-red-500',
    blue: 'text-blue-600',
    amber: 'text-amber-600',
  };
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-muted-foreground font-medium mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono ${colorMap[color]}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function StemPnlReport() {
  const [year, setYear] = useState('2025');
  const [month, setMonth] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [sortKey, setSortKey] = useState('Delivery_Date');
  const [sortDir, setSortDir] = useState(-1);
  const [search, setSearch] = useState('');
  const [selectedStemId, setSelectedStemId] = useState(null);

  const buildWhere = useCallback(() => {
    const parts = [];
    if (month !== 'all') {
      const from = `${year}-${month}-01`;
      const lastDay = new Date(Number(year), Number(month), 0).getDate();
      const to = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
      parts.push(`((Delivery_Date__c >= ${from} AND Delivery_Date__c <= ${to}) OR (Delivery_Date__c = null AND Expected_Delivery_Date__c >= ${from} AND Expected_Delivery_Date__c <= ${to}))`);
    } else {
      parts.push(`((Delivery_Date__c >= ${year}-01-01 AND Delivery_Date__c <= ${year}-12-31) OR (Delivery_Date__c = null AND Expected_Delivery_Date__c >= ${year}-01-01 AND Expected_Delivery_Date__c <= ${year}-12-31))`);
    }
    return parts.join(' AND ');
  }, [year, month]);

  const run = async () => {
    setLoading(true);
    setError(null);
    const where = buildWhere();
    const reportRes = await appClient.functions.invoke('stemPnl', { where, limit: 1000 });
    if (reportRes.data?.error) {
      setError(reportRes.data.error);
    } else {
      const reportRows = (reportRes.data.rows || []).map(row => ({
        ...row,
        Diff: row.Net_Profit != null && row.Qlik_Total_Profit != null ? row.Net_Profit - row.Qlik_Total_Profit : null,
      }));
      const reportTotals = reportRes.data.totals || null;
      setRows(reportRows);
      setTotals(reportTotals ? {
        ...reportTotals,
        Diff: reportTotals.Net_Profit != null && reportTotals.Qlik_Net_Profit != null ? reportTotals.Net_Profit - reportTotals.Qlik_Net_Profit : null,
      } : null);
    }
    setLoading(false);
  };

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d * -1);
    else { setSortKey(key); setSortDir(-1); }
  };

  const filtered = rows
    .filter(r => !search || [r.Key, r.Buyer, r.Status, r.Name].some(v => v && String(v).toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av < bv ? -sortDir : sortDir;
    });

  const periodLabel = month === 'all'
    ? `${year} full year`
    : `${MONTH_OPTIONS.find(m => m.value === month)?.label || month} ${year}`;

  const exportCsv = () => {
    if (!rows.length) return;
    const headers = COLUMNS.map(c => c.label);
    const csvRows = rows.map(r => COLUMNS.map(c => {
      const v = r[c.key];
      if (v == null) return '';
      return String(v).includes(',') ? `"${v}"` : String(v);
    }));
    const csv = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `stem_pnl_${year}${month !== 'all' ? '_' + month : ''}.csv`;
    a.click();
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="p-6 lg:p-8">
        <PageHeader
          icon={BarChart2}
          eyebrow="Stem P&L Report"
          title="Stem Profit & Loss"
          description="Validate calculated Gross Profit against Qlik reference values and inspect the underlying STEM detail."
          meta={rows.length > 0 ? `${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} stems shown` : undefined}
          actions={rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          )}
        />

        {/* Filters */}
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-24 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-36 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Full Year</SelectItem>
                {MONTH_OPTIONS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={run} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Run
            </Button>
            {rows.length > 0 && (
              <Input
                className="w-56 h-9 text-xs"
                placeholder="Search stem, buyer..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            )}
          </div>
          <FilterSummary className="mt-4" title="Report Period">
            <FilterChip label="Period" value={periodLabel} tone="active" />
            <FilterChip label="Fallback" value="Expected Delivery when Delivery Date is blank" />
          </FilterSummary>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {/* KPI cards */}
        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
            <StatCard label="Stems" value={totals.count} sub={`${totals.complete} complete`} />
            <StatCard label="Buyer Invoices" value={fmt(totals.Buyer_Invoice)} color="blue" />
            <StatCard label="Supplier Invoices" value={fmt(totals.Supplier_Invoice)} color="amber" />
            <StatCard label="Broker Commissions" value={fmt(totals.Total_Broker_Comm)} color="amber" />
            <StatCard
              label="Gross Profit"
              value={fmt(totals.Net_Profit)}
              sub={totals.Buyer_Invoice ? `${((totals.Net_Profit / totals.Buyer_Invoice) * 100).toFixed(1)}% margin` : null}
              color={(totals.Net_Profit ?? 0) >= 0 ? 'green' : 'red'}
            />
            <StatCard
              label="Qlik Net"
              value={fmt(totals.Qlik_Net_Profit)}
              sub={totals.Buyer_Invoice ? `${((totals.Qlik_Net_Profit / totals.Buyer_Invoice) * 100).toFixed(1)}% margin` : null}
              color={(totals.Qlik_Net_Profit ?? 0) >= 0 ? 'green' : 'red'}
            />
          </div>
        )}

        {/* Table */}
        {loading ? (
          <StateBlock icon={Loader2} title="Fetching stem P&L data..." description="Loading calculated Salesforce amounts and Qlik reference values." />
        ) : rows.length > 0 ? (
          <TableShell title="Stem P&L Results" meta={`${filtered.length.toLocaleString()} stems`} bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {COLUMNS.map(col => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className={`sticky top-0 z-10 bg-card py-2.5 px-3 font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap cursor-pointer hover:text-foreground transition-colors select-none ${col.num ? 'text-right' : 'text-left'} ${sortKey === col.key ? 'text-foreground' : ''}`}
                      >
                        {col.label} {sortKey === col.key ? (sortDir === -1 ? '↓' : '↑') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, i) => {
                    return (
                      <tr key={row.Id || i} onClick={() => setSelectedStemId(row.Id)} className="border-b border-border/40 hover:bg-muted/20 transition-colors cursor-pointer">
                        {COLUMNS.map(col => {
                          const v = row[col.key];
                          let display;
                          if (col.isDate) display = fmtDate(v);
                          else if (col.isPercent) display = fmt(v, true);
                          else if (col.num) display = fmt(v);
                          else display = v ?? '—';

                          const isProfit = ['Net_Profit', 'Qlik_Total_Profit'].includes(col.key);
                          const isDifference = col.key === 'Diff';
                          const isMargin = col.key === 'Margin_Pct';
                          let cellColor = '';
                          if (isDifference && v != null) {
                            cellColor = Math.abs(v) < 0.01 ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold';
                          } else if ((isProfit || isMargin) && v != null) {
                            cellColor = v >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold';
                          }

                          return (
                            <td key={col.key} className={`py-2.5 px-3 whitespace-nowrap ${col.num ? 'text-right font-mono' : ''} ${cellColor}`}>
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                {/* Totals row */}
                {totals && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/60 font-bold">
                      {COLUMNS.map((col, i) => {
                        const isNum = col.num && totals[col.key] != null;
                        return (
                          <td key={col.key} className={`py-2.5 px-3 whitespace-nowrap ${col.num ? 'text-right font-mono' : ''} ${['Net_Profit', 'Qlik_Total_Profit'].includes(col.key) ? (((col.key === 'Qlik_Total_Profit' ? totals.Qlik_Net_Profit : totals.Net_Profit) ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500') : col.key === 'Diff' ? (Math.abs(totals.Diff ?? 0) < 0.01 ? 'text-emerald-600' : 'text-red-500') : ''}`}>
                            {i === 0 ? 'TOTAL' : isNum ? (col.isPercent ? fmt(totals.Buyer_Invoice ? (totals.Net_Profit / totals.Buyer_Invoice) * 100 : null, true) : fmt(col.key === 'Qlik_Total_Profit' ? totals.Qlik_Net_Profit : totals[col.key])) : ''}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </TableShell>
        ) : !loading && !error ? (
          <StateBlock icon={TrendingUp} title="No P&L data loaded" description="Select a period and click Run to load results." />
        ) : null}
      </div>
      <StemDetailModal
        stemId={selectedStemId}
        open={!!selectedStemId}
        onClose={() => setSelectedStemId(null)}
        onUpdated={run}
      />
    </div>
  );
}
