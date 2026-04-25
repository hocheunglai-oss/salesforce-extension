import { useState, useEffect, useRef, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import StatCard from '@/components/dashboard/StatCard';
import PnlTable from '@/components/dashboard/PnlTable';
import { Package, Building2, DollarSign, AlertCircle, RefreshCw, SlidersHorizontal, Loader2, Search, X } from 'lucide-react';
import { format } from 'date-fns';

const STORAGE_KEY = 'dashboard_filters_v1';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];

const DATE_PRESETS = [
  { label: 'All time', value: 'all' },
  { label: 'Today', value: 'TODAY' },
  { label: 'This week', value: 'THIS_WEEK' },
  { label: 'This month', value: 'THIS_MONTH' },
  { label: 'This quarter', value: 'THIS_QUARTER' },
  { label: 'This year', value: 'THIS_YEAR' },
  { label: 'Last 7 days', value: 'LAST_N_DAYS:7' },
  { label: 'Last 30 days', value: 'LAST_N_DAYS:30' },
  { label: 'Last 90 days', value: 'LAST_N_DAYS:90' },
  { label: 'Last 6 months', value: 'LAST_N_DAYS:180' },
  { label: 'Last year', value: 'LAST_YEAR' },
  { label: 'Custom range', value: 'custom' },
];

const OFFICES = ['All', 'HK', 'SG', 'Dubai', 'Rotterdam', 'Houston'];
const DISPUTED_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Disputed only', value: 'true' },
  { label: 'Non-disputed only', value: 'false' },
];

export default function DashboardSettings() {
  // Load saved filters from localStorage
  const savedFilters = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } })();

  const [datePreset, setDatePreset] = useState(savedFilters.datePreset ?? 'THIS_YEAR');
  const [customFrom, setCustomFrom] = useState(savedFilters.customFrom ?? '');
  const [customTo, setCustomTo] = useState(savedFilters.customTo ?? '');
  const [office, setOffice] = useState(savedFilters.office ?? 'All');
  const [disputed, setDisputed] = useState(savedFilters.disputed ?? 'all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [tableSearch, setTableSearch] = useState('');
  const debounceRef = useRef(null);

  const buildDateFilter = (dp = datePreset, cf = customFrom, ct = customTo) => {
    if (dp === 'all') return '';
    if (dp === 'custom') {
      const parts = [];
      if (cf) parts.push(`Stem_Date__c >= ${cf}`);
      if (ct) parts.push(`Stem_Date__c <= ${ct}`);
      return parts.join(' AND ');
    }
    return `Stem_Date__c = ${dp}`;
  };

  const buildWhereClause = (dp = datePreset, cf = customFrom, ct = customTo, off = office, disp = disputed) => {
    const parts = [];
    const dateFilter = buildDateFilter(dp, cf, ct);
    if (dateFilter) parts.push(dateFilter);
    if (off !== 'All') parts.push(`Office__c = '${off}'`);
    if (disp !== 'all') parts.push(`Dispute__c = ${disp}`);
    return parts.length > 0 ? parts.join(' AND ') : '';
  };

  const load = async (dp = datePreset, cf = customFrom, ct = customTo, off = office, disp = disputed) => {
    setLoading(true);
    setError(null);
    const where = buildWhereClause(dp, cf, ct, off, disp);
    const res = await base44.functions.invoke('salesforceDashboardFiltered', { where });
    if (res.data?.error) {
      setError(res.data.error);
    } else {
      setData(res.data);
      setLastRefresh(new Date());
    }
    setLoading(false);
  };

  // Auto-save filters + debounced auto-load whenever filters change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ datePreset, customFrom, customTo, office, disputed }));
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      load(datePreset, customFrom, customTo, office, disputed);
    }, 600);
    return () => clearTimeout(debounceRef.current);
  }, [datePreset, customFrom, customTo, office, disputed]);

  // Filtered table rows by field-level search
  const filteredStems = useMemo(() => {
    if (!data?.recentStems?.length) return data?.recentStems || [];
    if (!tableSearch.trim()) return data.recentStems;
    const q = tableSearch.toLowerCase();
    return data.recentStems.filter(row =>
      Object.values(row).some(v => v != null && String(v).toLowerCase().includes(q))
    );
  }, [data?.recentStems, tableSearch]);

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
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Filters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Date range */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Date Range (Stem Date)</Label>
            <Select value={datePreset} onValueChange={setDatePreset}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATE_PRESETS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Custom date inputs */}
          {datePreset === 'custom' && (
            <>
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">From Date</Label>
                <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">To Date</Label>
                <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
              </div>
            </>
          )}

          {/* Office */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Office</Label>
            <Select value={office} onValueChange={setOffice}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OFFICES.map(o => <SelectItem key={o} value={o}>{o === 'All' ? 'All Offices' : o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Disputed */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Dispute Status</Label>
            <Select value={disputed} onValueChange={setDisputed}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DISPUTED_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Active filter summary */}
        {buildWhereClause() && (
          <div className="mt-4 p-2.5 bg-muted/40 rounded-lg">
            <p className="text-xs font-mono text-muted-foreground">
              <span className="font-semibold text-foreground">WHERE</span> {buildWhereClause()}
            </p>
          </div>
        )}
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
              label="Total Profit (P&L)"
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

          {/* P&L Report */}
          <div className="bg-card rounded-xl border border-border">
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <h3 className="text-sm font-semibold text-foreground shrink-0">Stem P&amp;L Report</h3>
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search…"
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
              <PnlTable records={filteredStems} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}