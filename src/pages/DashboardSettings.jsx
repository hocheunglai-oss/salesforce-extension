import { useState, useEffect, useRef, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import StatCard from '@/components/dashboard/StatCard';
import PnlTable from '@/components/dashboard/PnlTable';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import { Package, Building2, DollarSign, AlertCircle, RefreshCw, SlidersHorizontal, Loader2, Search, X } from 'lucide-react';
import { format } from 'date-fns';

const STORAGE_KEY = 'dashboard_filters_v2';
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];

const MONTHS = [
  { value: 1, label: 'Jan' }, { value: 2, label: 'Feb' }, { value: 3, label: 'Mar' },
  { value: 4, label: 'Apr' }, { value: 5, label: 'May' }, { value: 6, label: 'Jun' },
  { value: 7, label: 'Jul' }, { value: 8, label: 'Aug' }, { value: 9, label: 'Sep' },
  { value: 10, label: 'Oct' }, { value: 11, label: 'Nov' }, { value: 12, label: 'Dec' },
];

const now = new Date();
const THIS_YEAR = now.getFullYear();
const THIS_MONTH = now.getMonth() + 1; // 1-based
const YEARS = [THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2];

// Build WHERE clause from selected years + months using Delivery_Date__c
function buildDeliveryWhere(years, months) {
  if (!years.length) return '';
  const conditions = [];
  for (const yr of years) {
    if (!months.length || months.length === 12) {
      // Whole year
      conditions.push(`(Delivery_Date__c >= ${yr}-01-01 AND Delivery_Date__c <= ${yr}-12-31)`);
    } else {
      // Specific months within this year
      for (const mo of months) {
        const mm = String(mo).padStart(2, '0');
        const lastDay = new Date(yr, mo, 0).getDate();
        conditions.push(`(Delivery_Date__c >= ${yr}-${mm}-01 AND Delivery_Date__c <= ${yr}-${mm}-${lastDay})`);
      }
    }
  }
  return conditions.join(' OR ');
}

export default function DashboardSettings() {
  const savedFilters = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } })();

  const [selectedYears, setSelectedYears] = useState(savedFilters.selectedYears ?? [THIS_YEAR]);
  const [selectedMonths, setSelectedMonths] = useState(savedFilters.selectedMonths ?? [THIS_MONTH]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [tableSearch, setTableSearch] = useState('');
  const [selectedStemId, setSelectedStemId] = useState(null);
  const debounceRef = useRef(null);

  const toggleYear = (yr) => setSelectedYears(prev =>
    prev.includes(yr) ? (prev.length > 1 ? prev.filter(y => y !== yr) : prev) : [...prev, yr]
  );

  const toggleMonth = (mo) => setSelectedMonths(prev =>
    prev.includes(mo) ? (prev.length > 1 ? prev.filter(m => m !== mo) : prev) : [...prev, mo]
  );

  const toggleAllMonths = () => setSelectedMonths(
    selectedMonths.length === 12 ? [THIS_MONTH] : MONTHS.map(m => m.value)
  );

  const buildWhereClause = (yrs = selectedYears, mos = selectedMonths) =>
    buildDeliveryWhere(yrs, mos);

  const load = async (yrs = selectedYears, mos = selectedMonths) => {
    setLoading(true);
    setError(null);
    const where = buildWhereClause(yrs, mos);
    const res = await base44.functions.invoke('salesforceDashboardFiltered', { where, trendYear: THIS_YEAR });
    if (res.data?.error) {
      setError(res.data.error);
    } else {
      setData(res.data);
      setLastRefresh(new Date());
    }
    setLoading(false);
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedYears, selectedMonths }));
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      load(selectedYears, selectedMonths);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [selectedYears, selectedMonths]);

  // Filtered table rows: enforce selected years/months client-side as a strict safety net, then search
  const filteredStems = useMemo(() => {
    if (!data?.recentStems?.length) return data?.recentStems || [];
    const yearsSet = new Set(selectedYears);
    const monthsSet = new Set(selectedMonths);
    // Parse date string directly (e.g. "2026-04-30") to avoid any timezone issues
    let stems = data.recentStems.filter(row => {
      if (!row.Delivery_Date__c) return false;
      const parts = row.Delivery_Date__c.split('-');
      const yr = Number(parts[0]);
      const mo = Number(parts[1]);
      return yearsSet.has(yr) && monthsSet.has(mo);
    });
    if (!tableSearch.trim()) return stems;
    const q = tableSearch.toLowerCase();
    const SEARCH_FIELDS = ['Name', 'KeyStem__c', 'Vessel__c', 'Buyer_Name__c', 'Buyer__c'];
    return stems.filter(row =>
      SEARCH_FIELDS.some(f => row[f] != null && String(row[f]).toLowerCase().includes(q))
    );
  }, [data?.recentStems, tableSearch, selectedYears, selectedMonths]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <SlidersHorizontal className="w-4 h-4" />
            <span>Dashboard</span>
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground font-dm tracking-tight">Dashboard</h1>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">Auto-saved</span>
          </div>
          {lastRefresh && <p className="text-xs text-muted-foreground mt-0.5">Last updated {format(lastRefresh, 'HH:mm:ss')}</p>}
        </div>
        <Button variant="outline" onClick={() => load()} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </Button>
      </div>

      {/* Filter panel */}
      <div className="bg-card rounded-xl border border-border p-5 mb-6">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Filters — Delivery Date</h2>

        {/* Year selector */}
        <div className="mb-4">
          <Label className="text-xs font-medium text-muted-foreground mb-2 block">Year</Label>
          <div className="flex gap-2 flex-wrap">
            {YEARS.map(yr => (
              <button
                key={yr}
                onClick={() => toggleYear(yr)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                  selectedYears.includes(yr)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted/40 text-muted-foreground border-border hover:border-primary/50'
                }`}
              >
                {yr}
              </button>
            ))}
          </div>
        </div>

        {/* Month selector */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs font-medium text-muted-foreground">Month</Label>
            <button
              onClick={toggleAllMonths}
              className="text-xs text-primary hover:underline"
            >
              {selectedMonths.length === 12 ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {MONTHS.map(m => (
              <button
                key={m.value}
                onClick={() => toggleMonth(m.value)}
                className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                  selectedMonths.includes(m.value)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted/40 text-muted-foreground border-border hover:border-primary/50'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Active filter summary */}
        <div className="mt-4 p-2.5 bg-muted/40 rounded-lg">
          <p className="text-xs font-mono text-muted-foreground truncate">
            <span className="font-semibold text-foreground">WHERE</span> {buildWhereClause() || '(all records)'}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}



      {loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-card rounded-xl border border-border p-5 h-28 animate-pulse" />)}
        </div>
      )}

      {data && !loading && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard label="Matching STEMs" value={data.stemTotal?.toLocaleString() ?? '—'} icon={Package} color="blue" />
            <StatCard
              label="Accounts"
              value={data.accountCount != null ? data.accountCount.toLocaleString() : '—'}
              sub="Distinct accounts in filtered STEMs"
              icon={Building2}
              color="green"
            />
            <StatCard
              label="Total Net Profit"
              value={data.totalProfit != null ? `$${data.totalProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
              sub={data.totalProfit == null ? (data.buyerAmountField ? 'Supplier field not found' : 'Buyer/supplier fields not found') : `Buyer $${(data.totalBuyer ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} − Supplier $${(data.totalSupplier ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
              icon={DollarSign}
              color="amber"
            />
            <StatCard
              label="Disputed"
              value={data.disputedCount != null ? data.disputedCount.toLocaleString() : '—'}
              sub={data.stemTotal > 0 && data.disputedCount != null
                ? `${((data.disputedCount / data.stemTotal) * 100).toFixed(1)}% of total`
                : undefined}
              icon={AlertCircle}
              color="red"
            />
          </div>

          {/* Monthly Net P&L Trend */}
          {data.monthlyNetPnl?.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-5 mb-8">
              <h3 className="text-sm font-semibold text-foreground mb-1">Monthly Net P&amp;L Trend</h3>
              <p className="text-xs text-muted-foreground mb-4">Total Net P&amp;L by month for {data.monthlyNetPnlYear || THIS_YEAR}</p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.monthlyNetPnl} barSize={44}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v) => [`$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 'Net P&L']} />
                  <Bar dataKey="netPnl" radius={[4, 4, 0, 0]}>
                    {data.monthlyNetPnl.map((item, idx) => (
                      <Cell key={idx} fill={item.netPnl >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Monthly Buyer Net P&L Trend */}
          {data.monthlyBuyerNetPnl?.length > 0 && data.monthlyBuyerNames?.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-5 mb-8">
              <h3 className="text-sm font-semibold text-foreground mb-1">Monthly Net P&amp;L by Buyer</h3>
              <p className="text-xs text-muted-foreground mb-4">Top buyer accounts by Net P&amp;L for {data.monthlyNetPnlYear || THIS_YEAR}</p>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={data.monthlyBuyerNetPnl} barSize={44}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v, name) => [`$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, name]} />
                  {data.monthlyBuyerNames.map((buyer, idx) => (
                    <Bar key={buyer} dataKey={buyer} stackId="buyers" fill={COLORS[idx % COLORS.length]} radius={idx === data.monthlyBuyerNames.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Charts */}
          {(data.stemByStatus?.length > 0 || data.stemByType?.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {data.stemByStatus?.length > 0 && (
                <div className="bg-card rounded-xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4">STEMs by Status</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.stemByStatus} barSize={32}>
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {data.stemByStatus.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {data.stemByType?.length > 0 && (
                <div className="bg-card rounded-xl border border-border p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-4">STEMs by Type</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.stemByType} barSize={32}>
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {data.stemByType.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Top 10 Buyers by Net P&L */}
          {data.topBuyersByNetPnl && data.topBuyersByNetPnl.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-5 mb-8">
            <h3 className="text-sm font-semibold text-foreground mb-1">
              Top 10 Buyers by Net P&amp;L
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({selectedYears.sort((a,b) => a-b).join(', ')} · {selectedMonths.length === 12 ? 'All months' : selectedMonths.map(m => MONTHS.find(x => x.value === m)?.label).join(', ')})
              </span>
            </h3>
            <div className="mt-4 space-y-2">
              {(() => {
                const maxAbs = Math.max(...data.topBuyersByNetPnl.map(b => Math.abs(b.netPnl)), 1);
                return data.topBuyersByNetPnl.map((b, i) => {
                  const pct = (Math.abs(b.netPnl) / maxAbs) * 100;
                  const isPos = b.netPnl >= 0;
                  return (
                    <div key={b.name} className="flex items-center gap-3">
                      <span className="w-5 text-xs font-bold text-muted-foreground text-right shrink-0">{i + 1}</span>
                      <span className="w-52 text-xs text-foreground truncate shrink-0" title={b.name}>{b.name}</span>
                      <div className="flex-1 bg-muted/50 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all ${isPos ? 'bg-emerald-500' : 'bg-red-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className={`text-xs font-semibold w-28 text-right shrink-0 ${isPos ? 'text-emerald-600' : 'text-red-600'}`}>
                        ${b.netPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
          )}

          {/* P&L Report */}
          <div className="bg-card rounded-xl border border-border">
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <h3 className="text-sm font-semibold text-foreground shrink-0">Filtered STEMs</h3>
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search by vessel, stem name, or buyer…"
                  value={tableSearch}
                  onChange={e => setTableSearch(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
                {tableSearch && (
                  <button onClick={() => setTableSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <span className="text-xs text-muted-foreground ml-auto shrink-0">
                {filteredStems.length}{filteredStems.length !== data.recentStems?.length ? ` of ${data.recentStems?.length}` : ''} shown
              </span>
            </div>
            <div className="p-2">
              <PnlTable records={filteredStems} onRowClick={(row) => setSelectedStemId(row.Id)} />
            </div>
          </div>
        </>
      )}
      <StemDetailModal
        stemId={selectedStemId}
        open={!!selectedStemId}
        onClose={() => setSelectedStemId(null)}
        onUpdated={() => load(selectedYears, selectedMonths)}
      />
    </div>
  );
}