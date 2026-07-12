import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Download, History, Loader2, RefreshCw, Save, Search, UserCog, X } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
const STORAGE_KEY = 'review_queue_filters';
const YEARS = getRecentYears();
const WORKFLOW_STATUSES = ['Open', 'Acknowledged', 'In Progress', 'Resolved', 'Dismissed'];
const WORKFLOW_DEPARTMENTS = ['Unassigned', 'Trading', 'Operations', 'Accounting', 'Management'];
const WORKFLOW_PRIORITIES = ['High', 'Medium', 'Low'];

const REVIEW_FILTERS = [
  { key: 'all', label: 'All exceptions' },
  { key: 'potential-delay', label: 'Potential Delay' },
  { key: 'missing-buyer', label: 'Missing buyer invoice' },
  { key: 'missing-supplier', label: 'Missing supplier invoice' },
  { key: 'negative-gross', label: 'Negative gross profit' },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const fmtMoney = (value) => {
  if (value == null || value === '') return '-';
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const fmtDate = (value) => {
  if (!value) return '-';
  try { return format(new Date(value), 'dd MMM yyyy'); } catch { return value; }
};

const dateOnlyUtc = (value) => {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
};

const todayUtc = () => {
  const today = new Date();
  return Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
};

const daysSinceDate = (value) => {
  const date = dateOnlyUtc(value);
  if (date == null) return null;
  return Math.floor((todayUtc() - date) / MS_PER_DAY);
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
  const expectedDelayDays = daysSinceDate(row.Expected_Delivery_Date__c);

  if (!row.Delivery_Date__c && expectedDelayDays != null && expectedDelayDays >= 3) {
    reasons.push({ key: 'potential-delay', label: 'Potential Delay', severity: 'high' });
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
    expectedDelayDays,
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
  const [workflowScope, setWorkflowScope] = useState(
    ['active', 'resolved', 'all'].includes(savedFilters.workflowScope) ? savedFilters.workflowScope : 'active'
  );
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [workflowByStemId, setWorkflowByStemId] = useState({});
  const [ownerOptions, setOwnerOptions] = useState([]);
  const [selectedWorkflowRow, setSelectedWorkflowRow] = useState(null);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [workflowError, setWorkflowError] = useState('');
  const [workflowForm, setWorkflowForm] = useState({
    status: 'Open', department: 'Unassigned', ownerUserId: '', priority: 'High', dueDate: '', latestNote: '', resolutionNote: '',
  });
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

  const load = async (yrs = selectedYears, mos = selectedMonths, options = {}) => {
    setLoading(true);
    setError(null);
    const where = buildDeliveryWhere(yrs, mos);
    const res = await appClient.functions.invoke('salesforceDashboardFiltered', { where, trendYear: THIS_YEAR }, { cache: true, force: options.force });
    if (res.data?.error) {
      setError(res.data.error);
    } else {
      setData(res.data);
      setLastRefresh(new Date(res.meta?.cachedAt || Date.now()));
      const stemIds = (res.data?.recentStems || []).map((row) => row.Id).filter(Boolean);
      const workflowRes = await appClient.functions.invoke('exceptionReviewWorkflowList', { stemIds }, { cache: true, force: options.force });
      if (workflowRes.data?.error) {
        setError(workflowRes.data.error);
      } else {
        setWorkflowByStemId(workflowRes.data.byStemId || {});
        setOwnerOptions(workflowRes.data.ownerOptions || []);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedYears, selectedMonths, activeReviewType, workflowScope }));
  }, [selectedYears, selectedMonths, activeReviewType, workflowScope]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(selectedYears, selectedMonths), 350);
    return () => clearTimeout(debounceRef.current);
  }, [selectedYears, selectedMonths]);

  const selectedYearLabel = selectedYears.slice().sort((a, b) => a - b).join(', ');
  const selectedMonthLabel = formatSelectedMonths(selectedMonths);

  const reviewRows = useMemo(() => {
    const rows = (data?.recentStems || []).map(classifyStem).filter(row => row.reviewReasons.length > 0).map((row) => ({
      ...row,
      exceptionWorkflow: workflowByStemId[row.Id] || null,
    }));
    const scopedRows = rows.filter((row) => {
      const status = row.exceptionWorkflow?.status || 'Open';
      if (workflowScope === 'active') return status !== 'Resolved' && status !== 'Dismissed';
      if (workflowScope === 'resolved') return status === 'Resolved' || status === 'Dismissed';
      return true;
    });
    const filteredByType = activeReviewType === 'all'
      ? scopedRows
      : scopedRows.filter(row => row.reviewReasons.some(reason => reason.key === activeReviewType));
    if (!search.trim()) return filteredByType;
    const q = search.toLowerCase();
    return filteredByType.filter(row =>
      [row.Name, row.KeyStem__c, row.Buyer_Name__c, row.Buyer__c, row.ETA_Start_Date__c, row.Delivery_Date__c]
        .some(value => value != null && String(value).toLowerCase().includes(q))
    );
  }, [data?.recentStems, activeReviewType, search, workflowByStemId, workflowScope]);

  const classifiedRows = useMemo(() => (data?.recentStems || []).map(classifyStem), [data?.recentStems]);
  const highPriorityCount = classifiedRows.filter(row => row.reviewSeverity === 'high').length;
  const potentialDelayCount = classifiedRows.filter(row => row.reviewReasons.some(reason => reason.key === 'potential-delay')).length;
  const clearCount = classifiedRows.filter(row => row.reviewReasons.length === 0).length;

  const openWorkflow = (row) => {
    const workflow = workflowByStemId[row.Id] || {};
    setSelectedWorkflowRow(row);
    setWorkflowError('');
    setWorkflowForm({
      status: workflow.status || 'Open',
      department: workflow.department || 'Unassigned',
      ownerUserId: workflow.ownerUserId || '',
      priority: workflow.priority || 'High',
      dueDate: workflow.dueDate || '',
      latestNote: workflow.latestNote || '',
      resolutionNote: workflow.resolutionNote || '',
    });
  };

  const saveWorkflow = async () => {
    if (!selectedWorkflowRow) return;
    setWorkflowSaving(true);
    setWorkflowError('');
    const existing = workflowByStemId[selectedWorkflowRow.Id] || null;
    const res = await appClient.functions.invoke('exceptionReviewWorkflowSave', {
      stemId: selectedWorkflowRow.Id,
      ...workflowForm,
      expectedUpdatedAt: existing?.updatedAt || null,
    });
    setWorkflowSaving(false);
    if (res.data?.error) {
      setWorkflowError(res.data.error);
      return;
    }
    setWorkflowByStemId((prev) => ({
      ...prev,
      [selectedWorkflowRow.Id]: {
        ...res.data.item,
        events: [res.data.event, ...(prev[selectedWorkflowRow.Id]?.events || [])].filter(Boolean),
      },
    }));
    setSelectedWorkflowRow(null);
  };

  const exportCsv = () => {
    if (!reviewRows.length) return;
    const headers = ['Priority', 'Exception Reason', 'Name', 'Buyer Name', 'Delivery Date', 'Expected Delivery', 'Buyer Invoice', 'Supplier Invoice', 'Gross Profit'];
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
    link.download = `exception_review_${selectedYearLabel.replace(/\s/g, '')}_${selectedMonthLabel.replace(/\s/g, '')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <PageHeader
        icon={ClipboardCheck}
        eyebrow="Finance Exceptions"
        title="Exception Review"
        description="Focus on STEMs that need validation before finance, broker, or management reporting."
        meta={lastRefresh ? `Last updated ${format(lastRefresh, 'HH:mm:ss')}` : 'Auto-loaded from Salesforce'}
        actions={(
          <>
            <Button variant="outline" onClick={exportCsv} disabled={loading || !reviewRows.length} className="gap-2">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
            <Button variant="outline" onClick={() => load(selectedYears, selectedMonths, { force: true })} disabled={loading} className="gap-2">
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
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Exception Type</h2>
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
            <div className="mt-3 inline-flex overflow-hidden rounded-md border border-border bg-background">
              {[['active', 'Active'], ['resolved', 'Resolved'], ['all', 'All']].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setWorkflowScope(value)}
                  className={cn('h-8 px-3 text-xs font-semibold', workflowScope === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  {label}
                </button>
              ))}
            </div>
            <FilterSummary className="mt-4" title="Queue Scope">
              <FilterChip label="Year" value={selectedYearLabel || 'None'} tone="active" />
              <FilterChip label="Month" value={selectedMonthLabel || 'None'} tone="active" />
              <FilterChip label="Date logic" value="Delivery Date, else Expected Delivery" />
              <FilterChip label="Workflow" value={workflowScope === 'active' ? 'Active items' : workflowScope === 'resolved' ? 'Resolved items' : 'All items'} />
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
          <StatCard label="Open Exceptions" value={reviewRows.length.toLocaleString()} sub={`${classifiedRows.length.toLocaleString()} STEMs scanned`} icon={ClipboardCheck} color="blue" />
          <StatCard label="Urgent Exceptions" value={highPriorityCount.toLocaleString()} sub="Potential delay, missing invoice, or negative profit" icon={AlertTriangle} color="red" />
          <StatCard label="Potential Delays" value={potentialDelayCount.toLocaleString()} sub="Delivery blank and expected date 3+ days past" icon={RefreshCw} color="amber" />
          <StatCard label="No Exceptions" value={clearCount.toLocaleString()} sub="No exception reason" icon={CheckCircle2} color="green" />
        </div>
      )}

      <TableShell
        title="Exception List"
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
            title={data ? 'Refreshing exceptions...' : 'Loading exceptions...'}
            description="Updating exception classifications from Salesforce."
          />
        ) : reviewRows.length > 0 ? (
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-left font-semibold uppercase tracking-wide text-muted-foreground">Priority</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-left font-semibold uppercase tracking-wide text-muted-foreground">Exception Reason</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-left font-semibold uppercase tracking-wide text-muted-foreground">Name</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-left font-semibold uppercase tracking-wide text-muted-foreground">Buyer Name</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-left font-semibold uppercase tracking-wide text-muted-foreground">Delivery Date</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-left font-semibold uppercase tracking-wide text-muted-foreground">Workflow</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-left font-semibold uppercase tracking-wide text-muted-foreground">Owner</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-left font-semibold uppercase tracking-wide text-muted-foreground">Due</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-right font-semibold uppercase tracking-wide text-muted-foreground">Buyer Invoice</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-right font-semibold uppercase tracking-wide text-muted-foreground">Supplier Invoice</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-right font-semibold uppercase tracking-wide text-muted-foreground">Gross Profit</th>
                  <th className="sticky top-0 z-10 bg-card py-2.5 px-3 text-right font-semibold uppercase tracking-wide text-muted-foreground">Action</th>
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
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-medium text-foreground">{row.exceptionWorkflow?.status || 'Open'}</div>
                      <div className="text-[11px] text-muted-foreground">{row.exceptionWorkflow?.department || 'Unassigned'} · {row.exceptionWorkflow?.priority || 'High'}</div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-muted-foreground">{row.exceptionWorkflow?.ownerName || 'Unassigned'}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-muted-foreground">{fmtDate(row.exceptionWorkflow?.dueDate)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-foreground whitespace-nowrap">{fmtMoney(row[BUYER_FIELD])}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-foreground whitespace-nowrap">{fmtMoney(row[SUPPLIER_FIELD])}</td>
                    <td className={cn(
                      'py-2.5 px-3 text-right tabular-nums font-semibold whitespace-nowrap',
                      row.grossProfit == null ? 'text-muted-foreground' : row.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'
                    )}>
                      {fmtMoney(row.grossProfit)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={(event) => {
                          event.stopPropagation();
                          openWorkflow(row);
                        }}
                      >
                        <UserCog className="h-3.5 w-3.5" /> Manage
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <StateBlock icon={CheckCircle2} title="No exceptions found" description="This period has no STEMs matching the selected exception criteria." />
        )}
      </TableShell>

      <StemDetailModal
        stemId={selectedStemId}
        open={!!selectedStemId}
        onClose={() => setSelectedStemId(null)}
        onUpdated={() => load(selectedYears, selectedMonths, { force: true })}
      />

      <Dialog open={Boolean(selectedWorkflowRow)} onOpenChange={(open) => !open && setSelectedWorkflowRow(null)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>Manage Exception · {selectedWorkflowRow?.Name || 'STEM'}</DialogTitle>
            <DialogDescription>Assign the next owner and record the handoff or resolution for all departments to see.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(92vh-150px)] overflow-auto px-5 py-4">
            {workflowError && <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{workflowError}</div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase text-muted-foreground">Status</span>
                <select value={workflowForm.status} onChange={(event) => setWorkflowForm((prev) => ({ ...prev, status: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {WORKFLOW_STATUSES.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase text-muted-foreground">Priority</span>
                <select value={workflowForm.priority} onChange={(event) => setWorkflowForm((prev) => ({ ...prev, priority: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {WORKFLOW_PRIORITIES.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase text-muted-foreground">Department</span>
                <select value={workflowForm.department} onChange={(event) => setWorkflowForm((prev) => ({ ...prev, department: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {WORKFLOW_DEPARTMENTS.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase text-muted-foreground">Owner</span>
                <select value={workflowForm.ownerUserId} onChange={(event) => setWorkflowForm((prev) => ({ ...prev, ownerUserId: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Unassigned</option>
                  {ownerOptions.map((owner) => <option key={owner.id} value={owner.id}>{owner.name} · {owner.userType}</option>)}
                </select>
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground">Due Date</span>
                <Input type="date" value={workflowForm.dueDate} onChange={(event) => setWorkflowForm((prev) => ({ ...prev, dueDate: event.target.value }))} />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground">Handoff Note</span>
                <Textarea rows={3} value={workflowForm.latestNote} onChange={(event) => setWorkflowForm((prev) => ({ ...prev, latestNote: event.target.value }))} placeholder="What was checked, and what should happen next?" />
              </label>
              {(workflowForm.status === 'Resolved' || workflowForm.status === 'Dismissed') && (
                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">Resolution Note</span>
                  <Textarea required rows={3} value={workflowForm.resolutionNote} onChange={(event) => setWorkflowForm((prev) => ({ ...prev, resolutionNote: event.target.value }))} placeholder="Explain the final outcome." />
                </label>
              )}
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><History className="h-4 w-4" /> History</div>
              {(workflowByStemId[selectedWorkflowRow?.Id]?.events || []).length ? (
                <div className="space-y-2">
                  {workflowByStemId[selectedWorkflowRow?.Id].events.map((event) => (
                    <div key={event.id} className="rounded-md border border-border bg-muted/20 p-3 text-sm">
                      <div className="flex justify-between gap-3"><span className="font-medium">{event.status} · {event.department}</span><span className="text-xs text-muted-foreground">{event.createdAt ? format(new Date(event.createdAt), 'dd MMM yyyy HH:mm') : ''}</span></div>
                      <div className="mt-1 text-xs text-muted-foreground">{event.ownerName || 'Unassigned'} · {event.priority || '-'} · {event.actorEmail || '-'}</div>
                      {event.note && <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{event.note}</p>}
                    </div>
                  ))}
                </div>
              ) : <StateBlock title="No workflow history" description="Save the first assignment or review note to begin the shared history." />}
            </div>
          </div>
          <DialogFooter className="border-t border-border px-5 py-4">
            <Button variant="outline" onClick={() => setSelectedWorkflowRow(null)} disabled={workflowSaving}>Cancel</Button>
            <Button onClick={saveWorkflow} disabled={workflowSaving || ((workflowForm.status === 'Resolved' || workflowForm.status === 'Dismissed') && !workflowForm.resolutionNote.trim())} className="gap-2">
              {workflowSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
