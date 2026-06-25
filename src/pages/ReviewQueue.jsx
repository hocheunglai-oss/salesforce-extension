import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Download, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PageHeader from '@/components/common/PageHeader';
import FilterSummary, { FilterChip } from '@/components/common/FilterSummary';
import TableShell from '@/components/common/TableShell';
import StateBlock from '@/components/common/StateBlock';
import StatCard from '@/components/dashboard/StatCard';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import { cn } from '@/lib/utils';
import { MONTHS, THIS_MONTH, THIS_YEAR, buildDeliveryWhere, formatSelectedMonths, getRecentYears } from '@/lib/dashboardFilters';

const BUYER_FIELD = 'Total_Invoice_Amount__c';
const SUPPLIER_FIELD = 'Total_Invoiced_Amount_From_Suppliers__c';
const STORAGE_KEY = 'review_queue_filters_v1';
const YEARS = getRecentYears();

const REVIEW_FILTERS = [
  { key: 'all', label: 'All review items' },
  { key: 'missing-delivery', label: 'Missing delivery date' },
  { key: 'missing-buyer', label: 'Missing buyer invoice' },
  { key: 'missing-supplier', label: 'Missing supplier invoice' },
  { key: 'negative-gross', label: 'Negative gross profit' },
];

const fmtMoney = (value) => {
  if (value == null || value === '') return '-';
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const fmtDate = (value) => {
  if (!value) return '-';
  try { return format(new Date(value), 'dd MMM yyyy'); } catch { return value; }
};

function classifyStem(row) {
  const buyer = row[BUYER_FIELD];
  const supplier = row[SUPPLIER_FIELD];
  const buyerBroker = row.__buyerCommCalc || 0;
  const supplierBroker = row.__suppCommPerUnitCalc || 0;
  const brokerTotal = buyerBroker + supplierBroker;
  const grossProfit = row.__netPnlCalc != null
    ? row.__netPnlCalc
    : buyer != null && supplier != null
      ? buyer - supplier - brokerTotal
      : null;
  const reasons = [];

  if (!row.Delivery_Date__c && row.Expected_Delivery_Date__c) {
    reasons.push({ key: 'missing-delivery', label: 'Missing delivery date', severity: 'high' });
  }
  if (buyer == null || Number(buyer) === 0) {
    reasons.push({ key: 'missing-buyer', label: 'Missing buyer invoice', severity: 'high' });
  }
  if (supplier == null || Number(supplier) === 0) {
    reasons.push({ key: 'missing-supplier', label: 'Missing supplier invoice', severity: 'high' });
  }
  if (grossProfit != null && grossProfit < 0) {
    reasons.push({ key: 'negative-gross', label: 'Negative gross profit', severity: 'high' });
  }
  const severity = reasons.some(r => r.severity === 'high') ? 'high' : reasons.length ? 'medium' : 'clear';
  return {
    ...row,
    reviewReasons: reasons,
    reviewSeverity: severity,
    grossProfit,
    effectiveDate: row.Delivery_Date__c || row.Expected_Delivery_Date__c,
    usesFallbackDate: !row.Delivery_Date__c && !!row.Expected_Delivery_Date__c,
  };
}

function ReasonBadge({ reason }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium',
      reason.severity === 'high'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-amber-200 bg-amber-50 text-amber-700'
    )}>
      {reason.label}
    </span>
  );
}

export default function ReviewQueue() {
  const savedFilters = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } })();
  const [selectedYears, setSelectedYears] = useState(savedFilters.selectedYears ?? [THIS_YEAR]);
  const [selectedMonths, setSelectedMonths] = useState(savedFilters.selectedMonths ?? [THIS_MONTH]);
  const [activeReviewType, setActiveReviewType] = useState(
    REVIEW_FILTERS.some(filter => filter.key === savedFilters.activeReviewType) ? savedFilters.activeReviewType : 'all'
  );
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
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

  const load = async (yrs = selectedYears, mos = selectedMonths) => {
    setLoading(true);
    setError(null);
    const where = buildDeliveryWhere(yrs, mos);
    const res = await appClient.functions.invoke('salesforceDashboardFiltered', { where, trendYear: THIS_YEAR });
    if (res.data?.error) {
      setError(res.data.error);
    } else {
      setData(res.data);
      setLastRefresh(new Date());
    }
    setLoading(false);
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedYears, selectedMonths, activeReviewType }));
  }, [selectedYears, selectedMonths, activeReviewType]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(selectedYears, selectedMonths), 350);
    return () => clearTimeout(debounceRef.current);
  }, [selectedYears, selectedMonths]);

  const selectedYearLabel = selectedYears.slice().sort((a, b) => a - b).join(', ');
  const selectedMonthLabel = formatSelectedMonths(selectedMonths);

  const reviewRows = useMemo(() => {
    const rows = (data?.recentStems || []).map(classifyStem).filter(row => row.reviewReasons.length > 0);
    const filteredByType = activeReviewType === 'all'
      ? rows
      : rows.filter(row => row.reviewReasons.some(reason => reason.key === activeReviewType));
    if (!search.trim()) return filteredByType;
    const q = search.toLowerCase();
    return filteredByType.filter(row =>
      [row.Name, row.KeyStem__c, row.Buyer_Name__c, row.Buyer__c, row.ETA_Start_Date__c, row.Delivery_Date__c]
        .some(value => value != null && String(value).toLowerCase().includes(q))
    );
  }, [data?.recentStems, activeReviewType, search]);

  const classifiedRows = useMemo(() => (data?.recentStems || []).map(classifyStem), [data?.recentStems]);
  const highPriorityCount = classifiedRows.filter(row => row.reviewSeverity === 'high').length;
  const fallbackCount = classifiedRows.filter(row => row.usesFallbackDate).length;
  const clearCount = classifiedRows.filter(row => row.reviewReasons.length === 0).length;

  const exportCsv = () => {
    if (!reviewRows.length) return;
    const headers = ['Priority', 'Review Reasons', 'Name', 'Buyer Name', 'Delivery Date', 'Expected Delivery', 'Buyer Invoice', 'Supplier Invoice', 'Gross Profit'];
    const rows = reviewRows.map(row => [
      row.reviewSeverity,
      row.reviewReasons.map(reason => reason.label).join('; '),
      row.Name || '',
      row.Buyer_Name__c || row.Buyer__c || '',
      row.Delivery_Date__c || '',
      row.Expected_Delivery_Date__c || '',
      row[BUYER_FIELD] ?? '',
      row[SUPPLIER_FIELD] ?? '',
      row.grossProfit ?? '',
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(value => {
        const text = String(value ?? '');
        return text.includes(',') || text.includes('"') ? `"${text.replace(/"/g, '""')}"` : text;
      }).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `review_queue_${selectedYearLabel.replace(/\s/g, '')}_${selectedMonthLabel.replace(/\s/g, '')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader
        icon={ClipboardCheck}
        eyebrow="Financial Review"
        title="Review Queue"
        description="Focus on STEMs that need human validation before finance, broker, or management reporting."
        meta={lastRefresh ? `Last updated ${format(lastRefresh, 'HH:mm:ss')}` : 'Auto-loaded from Salesforce'}
        actions={(
          <>
            <Button variant="outline" onClick={exportCsv} disabled={loading || !reviewRows.length} className="gap-2">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
            <Button variant="outline" onClick={() => load()} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh
            </Button>
          </>
        )}
      />

      <div className="bg-card rounded-xl border border-border p-5 mb-6">
        <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Period</h2>
            <Label className="text-xs font-medium text-muted-foreground mb-2 block">Year</Label>
            <div className="flex gap-2 flex-wrap mb-4">
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
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-medium text-muted-foreground">Month</Label>
              <button onClick={toggleAllMonths} className="text-xs text-primary hover:underline">
                {selectedMonths.length === 12 ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {MONTHS.map(month => (
                <button
                  key={month.value}
                  onClick={() => toggleMonth(month.value)}
                  className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                    selectedMonths.includes(month.value)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/40 text-muted-foreground border-border hover:border-primary/50'
                  }`}
                >
                  {month.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Review Type</h2>
            <div className="flex flex-wrap gap-2">
              {REVIEW_FILTERS.map(filter => (
                <Button
                  key={filter.key}
                  type="button"
                  size="sm"
                  variant={activeReviewType === filter.key ? 'default' : 'outline'}
                  onClick={() => setActiveReviewType(filter.key)}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
            <FilterSummary className="mt-4" title="Queue Scope">
              <FilterChip label="Year" value={selectedYearLabel || 'None'} tone="active" />
              <FilterChip label="Month" value={selectedMonthLabel || 'None'} tone="active" />
              <FilterChip label="Date logic" value="Delivery Date, else Expected Delivery" />
            </FilterSummary>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, index) => <div key={index} className="bg-card rounded-xl border border-border p-5 h-28 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Review Items" value={reviewRows.length.toLocaleString()} sub={`${classifiedRows.length.toLocaleString()} STEMs scanned`} icon={ClipboardCheck} color="blue" />
          <StatCard label="High Priority" value={highPriorityCount.toLocaleString()} sub="Missing invoice/date or negative profit" icon={AlertTriangle} color="red" />
          <StatCard label="Fallback Date" value={fallbackCount.toLocaleString()} sub="Expected Delivery used" icon={RefreshCw} color="amber" />
          <StatCard label="Clear" value={clearCount.toLocaleString()} sub="No review reason" icon={CheckCircle2} color="green" />
        </div>
      )}

      <TableShell
        title="Review Queue"
        meta={`${reviewRows.length.toLocaleString()} matching items`}
        actions={(
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search stem, buyer, or date..."
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="pl-8 h-8 text-xs"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
        bodyClassName="p-0"
      >
        {loading ? (
          <StateBlock
            icon={Loader2}
            title={data ? 'Refreshing review queue...' : 'Loading review queue...'}
            description="Updating the review classifications from Salesforce."
          />
        ) : reviewRows.length > 0 ? (
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-left font-semibold uppercase tracking-wide text-muted-foreground">Priority</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-left font-semibold uppercase tracking-wide text-muted-foreground">Review Reason</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-left font-semibold uppercase tracking-wide text-muted-foreground">Name</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-left font-semibold uppercase tracking-wide text-muted-foreground">Buyer Name</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-left font-semibold uppercase tracking-wide text-muted-foreground">Delivery Date</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-right font-semibold uppercase tracking-wide text-muted-foreground">Buyer Invoice</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-right font-semibold uppercase tracking-wide text-muted-foreground">Supplier Invoice</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-right font-semibold uppercase tracking-wide text-muted-foreground">Gross Profit</th>
                </tr>
              </thead>
              <tbody>
                {reviewRows.map(row => (
                  <tr key={row.Id} onClick={() => setSelectedStemId(row.Id)} className="cursor-pointer border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className={cn(
                        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase',
                        row.reviewSeverity === 'high' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                      )}>
                        {row.reviewSeverity}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 min-w-[240px]">
                      <div className="flex flex-wrap gap-1.5">
                        {row.reviewReasons.map(reason => <ReasonBadge key={`${row.Id}-${reason.key}-${reason.label}`} reason={reason} />)}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-foreground whitespace-nowrap">{row.Name || '-'}</td>
                    <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{row.Buyer_Name__c || row.Buyer__c || '-'}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-foreground">{fmtDate(row.Delivery_Date__c)}</span>
                        {row.usesFallbackDate && <span className="text-[11px] text-amber-600">Expected: {fmtDate(row.Expected_Delivery_Date__c)}</span>}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-foreground whitespace-nowrap">{fmtMoney(row[BUYER_FIELD])}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-foreground whitespace-nowrap">{fmtMoney(row[SUPPLIER_FIELD])}</td>
                    <td className={cn(
                      'py-2.5 px-3 text-right tabular-nums font-semibold whitespace-nowrap',
                      row.grossProfit == null ? 'text-muted-foreground' : row.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'
                    )}>
                      {fmtMoney(row.grossProfit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <StateBlock icon={CheckCircle2} title="No review items found" description="This period has no STEMs matching the selected review criteria." />
        )}
      </TableShell>

      <StemDetailModal
        stemId={selectedStemId}
        open={!!selectedStemId}
        onClose={() => setSelectedStemId(null)}
        onUpdated={() => load(selectedYears, selectedMonths)}
      />
    </div>
  );
}
