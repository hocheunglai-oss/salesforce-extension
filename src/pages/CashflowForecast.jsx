import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Info,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import StatCard from '@/components/dashboard/StatCard';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/use-toast';
import { readPageState, writePageState } from '@/lib/pageStateCache';
import { cn } from '@/lib/utils';

const PAGE_STATE_KEY = 'cashflow-forecast';

function hkDateOnly(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDaysIso(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return hkDateOnly(date);
}

function fmtMoney(value, currency = 'USD') {
  const number = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 2,
  }).format(number);
}

function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function numberFmt(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function bucketKey(date, bucket = 'daily') {
  if (bucket === 'monthly') return String(date || '').slice(0, 7);
  if (bucket === 'weekly') {
    const value = new Date(`${date}T00:00:00.000Z`);
    const day = value.getUTCDay() || 7;
    value.setUTCDate(value.getUTCDate() - day + 1);
    return hkDateOnly(value);
  }
  return date;
}

function bucketLabel(key, bucket = 'daily') {
  if (!key) return '—';
  if (bucket === 'monthly') return key;
  if (bucket === 'weekly') return `Week of ${fmtDate(key)}`;
  return fmtDate(key);
}

function summarizeRows(rows, bucket = 'daily') {
  const totals = {
    buyerReceipts: 0,
    supplierPayments: 0,
    netCashflow: 0,
    overdueRiskReceipts: 0,
    rowCount: rows.length,
  };
  const today = hkDateOnly();
  const buckets = new Map();
  rows.forEach((row) => {
    const amount = Number(row.amount || 0);
    if (row.direction === 'inflow') {
      totals.buyerReceipts += amount;
      if (row.sourceDueDate && row.sourceDueDate < today) totals.overdueRiskReceipts += amount;
    } else {
      totals.supplierPayments += amount;
    }
    const key = bucketKey(row.forecastDate, bucket);
    if (!buckets.has(key)) buckets.set(key, { bucket: key, label: bucketLabel(key, bucket), inflow: 0, outflow: 0, net: 0 });
    const current = buckets.get(key);
    if (row.direction === 'inflow') current.inflow += amount;
    if (row.direction === 'outflow') current.outflow += amount;
    current.net = current.inflow - current.outflow;
  });
  totals.netCashflow = totals.buyerReceipts - totals.supplierPayments;
  return {
    totals,
    buckets: [...buckets.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))),
  };
}

function sortValue(row, key) {
  if (key === 'amount') return Number(row.amount || 0);
  return String(row[key] || '').toLowerCase();
}

export default function CashflowForecast() {
  const { toast } = useToast();
  const defaults = useMemo(() => {
    const today = hkDateOnly();
    return {
      dateFrom: today,
      dateTo: addDaysIso(today, 90),
      bucket: 'daily',
      keyword: '',
      buyerGroup: '',
      supplier: '',
    };
  }, []);
  const initialState = useMemo(() => readPageState(PAGE_STATE_KEY, defaults), [defaults]);
  const [dateFrom, setDateFrom] = useState(initialState.dateFrom || defaults.dateFrom);
  const [dateTo, setDateTo] = useState(initialState.dateTo || defaults.dateTo);
  const [bucket, setBucket] = useState(initialState.bucket || defaults.bucket);
  const [keyword, setKeyword] = useState(initialState.keyword || '');
  const [buyerGroup, setBuyerGroup] = useState(initialState.buyerGroup || '');
  const [supplier, setSupplier] = useState(initialState.supplier || '');
  const [data, setData] = useState({ rows: [], buckets: [], totals: {}, performance: [], settings: null, holidayOverrides: [], holidaySourceStatus: [], warnings: [] });
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [overrideDraft, setOverrideDraft] = useState({ date: '', countryCode: 'MANUAL', name: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sort, setSort] = useState({ key: 'forecastDate', direction: 'asc' });
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [methodologyOpen, setMethodologyOpen] = useState(false);

  useEffect(() => {
    writePageState(PAGE_STATE_KEY, { dateFrom, dateTo, bucket, keyword, buyerGroup, supplier });
  }, [dateFrom, dateTo, bucket, keyword, buyerGroup, supplier]);

  const load = async ({ force = false } = {}) => {
    setLoading(true);
    setError('');
    const response = await appClient.functions.invoke('cashflowForecast', {
      dateFrom,
      dateTo,
      bucket,
    }, {
      cache: true,
      force,
      cacheKey: `cashflowForecast:${dateFrom}:${dateTo}:${bucket}`,
    });
    setLoading(false);
    if (response.data?.error) {
      setError(response.data.error);
      return;
    }
    setData(response.data || {});
    setSettingsDraft(response.data?.settings || null);
  };

  useEffect(() => {
    load({ force: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = data.rows || [];
  const canManageSettings = data.capabilities?.canManageSettings === true;
  const buyerGroupOptions = useMemo(() => (
    [...new Set(rows.map((row) => row.buyerGroup).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
  ), [rows]);
  const supplierOptions = useMemo(() => (
    [...new Set(rows.filter((row) => row.direction === 'outflow').map((row) => row.counterparty).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
  ), [rows]);

  const filteredRows = useMemo(() => {
    const keywordNeedle = keyword.trim().toLowerCase();
    const buyerGroupNeedle = buyerGroup.trim().toLowerCase();
    const supplierNeedle = supplier.trim().toLowerCase();
    return rows.filter((row) => {
      if (keywordNeedle) {
        const haystack = [
          row.stemName,
          row.counterparty,
          row.buyerGroup,
          row.type,
          row.sourceRecordName,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(keywordNeedle)) return false;
      }
      if (buyerGroupNeedle && !String(row.buyerGroup || '').toLowerCase().includes(buyerGroupNeedle)) return false;
      if (supplierNeedle) {
        if (row.direction !== 'outflow') return false;
        if (!String(row.counterparty || '').toLowerCase().includes(supplierNeedle)) return false;
      }
      return true;
    });
  }, [rows, keyword, buyerGroup, supplier]);

  const sortedRows = useMemo(() => {
    const direction = sort.direction === 'desc' ? -1 : 1;
    return filteredRows.slice().sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (typeof av === 'number' || typeof bv === 'number') return ((Number(av) || 0) - (Number(bv) || 0)) * direction;
      return String(av).localeCompare(String(bv)) * direction;
    });
  }, [filteredRows, sort]);

  const filteredSummary = useMemo(() => summarizeRows(filteredRows, bucket), [filteredRows, bucket]);

  const updateSort = (key) => {
    setSort((current) => (
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    ));
  };

  const saveSettings = async () => {
    if (!settingsDraft) return;
    setSaving(true);
    const response = await appClient.functions.invoke('cashflowSettingsSave', settingsDraft);
    setSaving(false);
    if (response.data?.error) {
      toast({ title: 'Settings not saved', description: response.data.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Cashflow settings saved' });
    appClient.functions.clearCache();
    await load({ force: true });
  };

  const addOverride = async () => {
    if (!overrideDraft.date) {
      toast({ title: 'Blocked date required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const response = await appClient.functions.invoke('cashflowSettingsSave', {
      overrideAction: 'add',
      date: overrideDraft.date,
      countryCode: overrideDraft.countryCode,
      name: overrideDraft.name || 'Manual blocked date',
    });
    setSaving(false);
    if (response.data?.error) {
      toast({ title: 'Blocked date not saved', description: response.data.error, variant: 'destructive' });
      return;
    }
    setOverrideDraft({ date: '', countryCode: 'MANUAL', name: '' });
    toast({ title: 'Blocked date added' });
    appClient.functions.clearCache();
    await load({ force: true });
  };

  const deleteOverride = async (id) => {
    setSaving(true);
    const response = await appClient.functions.invoke('cashflowSettingsSave', { overrideAction: 'delete', id });
    setSaving(false);
    if (response.data?.error) {
      toast({ title: 'Blocked date not deleted', description: response.data.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Blocked date removed' });
    appClient.functions.clearCache();
    await load({ force: true });
  };

  const columns = [
    { key: 'forecastDate', label: 'Forecast Date' },
    { key: 'direction', label: 'Direction' },
    { key: 'type', label: 'Type' },
    { key: 'counterparty', label: 'Counterparty' },
    { key: 'buyerGroup', label: 'Buyer Group' },
    { key: 'stemName', label: 'STEM' },
    { key: 'sourceDueDate', label: 'Due Date' },
    { key: 'originalDate', label: 'Original Date' },
    { key: 'amount', label: 'Amount', align: 'right' },
    { key: 'modelLevel', label: 'Model' },
    { key: 'holidayAdjustment', label: 'Adjustment' },
  ];

  return (
    <div className="min-h-screen bg-background px-4 py-5 md:px-6">
      <PageHeader
        icon={WalletCards}
        eyebrow="AR and AP forecast"
        title="Cashflow Forecast"
        description="Predict buyer receipts from historical payment delay and supplier outflows on due date, adjusted for weekends, Singapore holidays, and US holidays."
        meta={`Hong Kong timezone. Range: ${fmtDate(dateFrom)} to ${fmtDate(dateTo)}.`}
        actions={(
          <>
            <Button variant="outline" onClick={() => setMethodologyOpen(true)} className="gap-2">
              <Info className="h-4 w-4" />
              Methodology
            </Button>
            <Button onClick={() => load({ force: true })} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </>
        )}
      />

      <Sheet open={methodologyOpen} onOpenChange={setMethodologyOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Cashflow Forecast Methodology</SheetTitle>
            <SheetDescription>
              How the forecast converts Salesforce receivables and payables into expected daily cash movement.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-5 text-sm text-muted-foreground">
            <section className="rounded-lg border border-border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold text-foreground">Purpose</h3>
              <p className="mt-2">
                The forecast estimates future cash inflow from buyer collections and future cash outflow from supplier invoice payments. It is a planning tool, not an accounting posting.
              </p>
            </section>

            <section className="rounded-lg border border-border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold text-foreground">Buyer Receipts</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5">
                <li>Source is open buyer invoices using the same inclusion rules as Outstanding Buyer Invoices.</li>
                <li>Amount is the current receivable balance.</li>
                <li>Prediction starts from the buyer invoice due date, then applies expected payment delay.</li>
                <li>If the predicted date is already past, the forecast starts from today before business-day adjustment.</li>
              </ul>
            </section>

            <section className="rounded-lg border border-border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold text-foreground">Payment Delay Model</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5">
                <li>Historical buyer payment performance before 1 Jan 2026 is ignored.</li>
                <li>The model first uses the exact buyer account when enough paid samples exist.</li>
                <li>If buyer history is insufficient, it falls back to buyer group, then global buyer history.</li>
                <li>Recent payments are weighted more heavily so the forecast reacts to current payment behavior.</li>
                <li>Model level, sample count, and confidence are shown in the Forecast Rows table.</li>
              </ul>
            </section>

            <section className="rounded-lg border border-border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold text-foreground">Supplier Payments</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5">
                <li>Supplier invoices are treated as expected cash outflows.</li>
                <li>The assumption is that supplier invoices are paid in full on the contractual due date.</li>
                <li>Supplier payment timing is not predicted from history in this version.</li>
                <li>STEMs with delivery date before 1 Jan 2026 are excluded from receivable and payable forecast rows.</li>
              </ul>
            </section>

            <section className="rounded-lg border border-border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold text-foreground">Business-Day Adjustment</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5">
                <li>Timezone basis is Hong Kong.</li>
                <li>Forecast dates falling on weekends are moved to the next available business day.</li>
                <li>Singapore public holidays and US bank/public holidays are blocked dates.</li>
                <li>Holiday data comes from Nager.Date and is cached by year and country.</li>
                <li>Manual blocked-date overrides in Forecast Settings are also applied.</li>
              </ul>
            </section>

            <section className="rounded-lg border border-border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold text-foreground">Current Assumptions</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5">
                <li>Forecast scope is AR and AP only.</li>
                <li>Buyer receipts use receivable balance, not original invoice amount.</li>
                <li>Supplier payments are assumed payable on time unless the date is blocked.</li>
                <li>Currency conversion is not applied in this page unless already present in the source amount.</li>
                <li>Forecast rows reconcile to the KPI cards and chart after current page filters are applied.</li>
              </ul>
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <TableShell title="Forecast Filters" bodyClassName="p-4" className="mb-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_150px_1.5fr_1.5fr_1.5fr_auto] lg:items-end">
          <div>
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Bucket</Label>
            <Select value={bucket} onValueChange={setBucket}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Keyword</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="STEM, buyer, supplier..." />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Buyer Group</Label>
            <Input list="cashflow-buyer-groups" value={buyerGroup} onChange={(event) => setBuyerGroup(event.target.value)} placeholder="All buyer groups" />
            <datalist id="cashflow-buyer-groups">
              {buyerGroupOptions.map((option) => <option key={option} value={option} />)}
            </datalist>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Supplier</Label>
            <Input list="cashflow-suppliers" value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="All suppliers" />
            <datalist id="cashflow-suppliers">
              {supplierOptions.map((option) => <option key={option} value={option} />)}
            </datalist>
          </div>
          <Button variant="outline" onClick={() => load({ force: true })} disabled={loading}>
            Run
          </Button>
        </div>
      </TableShell>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {data.warnings?.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Forecast warnings</p>
              <p className="mt-1">{data.warnings.slice(0, 3).join(' ')}</p>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Projected Buyer Receipts" value={fmtMoney(filteredSummary.totals.buyerReceipts)} sub={`${numberFmt(filteredRows.filter((row) => row.direction === 'inflow').length)} forecast receipt rows`} icon={TrendingUp} color="green" />
        <StatCard label="Projected Supplier Payments" value={fmtMoney(filteredSummary.totals.supplierPayments)} sub="Assumed paid on contractual due date" icon={TrendingDown} color="amber" />
        <StatCard label="Net Cashflow" value={fmtMoney(filteredSummary.totals.netCashflow)} sub="Buyer receipts minus supplier payments" icon={WalletCards} color={filteredSummary.totals.netCashflow >= 0 ? 'blue' : 'red'} />
        <StatCard label="Overdue-Risk Receipts" value={fmtMoney(filteredSummary.totals.overdueRiskReceipts)} sub="Open buyer invoices already past due" icon={AlertTriangle} color="red" />
      </div>

      <TableShell title="Cashflow Movement" meta={`${filteredSummary.buckets.length.toLocaleString()} ${bucket} buckets`} className="mb-4" bodyClassName="p-4">
        {loading ? (
          <StateBlock icon={Loader2} title="Loading cashflow forecast..." description="Reading Salesforce invoices, payment performance, and holiday calendars." />
        ) : filteredSummary.buckets.length ? (
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={filteredSummary.buckets} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(value) => `$${numberFmt(value / 1000)}k`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => fmtMoney(value)} />
                <Legend />
                <Bar dataKey="inflow" name="Buyer Receipts" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="outflow" name="Supplier Payments" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="net" name="Net Cashflow" stroke="#2563eb" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <StateBlock title="No forecast rows" description="No projected buyer receipts or supplier payments match the selected filters." />
        )}
      </TableShell>

      <TableShell title="Forecast Rows" meta={`${sortedRows.length.toLocaleString()} rows`} className="mb-4" bodyClassName="p-0">
        <div className="max-h-[520px] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                {columns.map((column) => (
                  <th key={column.key} className={cn('whitespace-nowrap px-3 py-2 font-semibold', column.align === 'right' && 'text-right')}>
                    <button className="inline-flex items-center gap-1" onClick={() => updateSort(column.key)}>
                      {column.label}
                      {sort.key === column.key && <span>{sort.direction === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr
                  key={row.id}
                  className={cn('border-b border-border/70 hover:bg-muted/40', row.stemId && 'cursor-pointer')}
                  onClick={() => row.stemId && setSelectedStemId(row.stemId)}
                >
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{fmtDate(row.forecastDate)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Badge className={row.direction === 'inflow' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : 'bg-amber-100 text-amber-800 hover:bg-amber-100'}>
                      {row.direction === 'inflow' ? 'Inflow' : 'Outflow'}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{row.type}</td>
                  <td className="min-w-[220px] px-3 py-2">{row.counterparty || '—'}</td>
                  <td className="min-w-[180px] px-3 py-2 text-muted-foreground">{row.buyerGroup || '—'}</td>
                  <td className="min-w-[240px] px-3 py-2 font-medium">{row.stemName || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2">{fmtDate(row.sourceDueDate)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{fmtDate(row.originalDate)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold">{fmtMoney(row.amount, row.currency)}</td>
                  <td className="min-w-[150px] px-3 py-2">
                    <div>{row.modelLevel || '—'}</div>
                    {row.predictedDelayDays != null && <div className="text-xs text-muted-foreground">{row.predictedDelayDays} days · {row.confidence}</div>}
                  </td>
                  <td className="min-w-[240px] px-3 py-2 text-xs text-muted-foreground">{row.holidayAdjustment || '—'}</td>
                </tr>
              ))}
              {!loading && !sortedRows.length && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-10">
                    <StateBlock title="No forecast rows" description="Adjust the date range or filters to show projected cash movements." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </TableShell>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <TableShell title="Buyer Payment Performance" meta={`${(data.performance || []).length.toLocaleString()} models`} bodyClassName="p-0">
          <div className="max-h-[420px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2">Level</th>
                  <th className="px-3 py-2">Buyer / Group</th>
                  <th className="px-3 py-2 text-right">Delay</th>
                  <th className="px-3 py-2 text-right">Samples</th>
                  <th className="px-3 py-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {(data.performance || []).map((row) => (
                  <tr key={row.id} className="border-b border-border/70">
                    <td className="whitespace-nowrap px-3 py-2">{row.level}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.name}</div>
                      {row.buyerGroup && row.level === 'Buyer' && <div className="text-xs text-muted-foreground">{row.buyerGroup}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold">{row.predictedDelayDays} days</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{row.sampleCount}</td>
                    <td className="whitespace-nowrap px-3 py-2">{row.confidence}</td>
                  </tr>
                ))}
                {!data.performance?.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8">
                      <StateBlock title="No buyer payment history" description="The model will use a zero-day default delay until paid buyer invoice samples are available." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TableShell>

        <TableShell
          title="Forecast Settings"
          meta={`Holiday source: ${data.holidaySourceStatus?.some((row) => row.fromCache) ? 'Nager.Date with cache' : 'Nager.Date'}`}
          actions={(
            <Button onClick={saveSettings} disabled={saving || !settingsDraft || !canManageSettings}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save
            </Button>
          )}
          bodyClassName="p-4"
        >
          {settingsDraft && (
            <div className="grid gap-3 sm:grid-cols-2">
              {!canManageSettings && <div className="sm:col-span-2 text-xs text-muted-foreground">These shared assumptions are read-only for your role.</div>}
              <div>
                <Label className="text-xs text-muted-foreground">Horizon Days</Label>
                <Input disabled={!canManageSettings} type="number" min="1" max="365" value={settingsDraft.horizonDays} onChange={(event) => setSettingsDraft((current) => ({ ...current, horizonDays: event.target.value }))} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Lookback Months</Label>
                <Input disabled={!canManageSettings} type="number" min="1" max="36" value={settingsDraft.lookbackMonths} onChange={(event) => setSettingsDraft((current) => ({ ...current, lookbackMonths: event.target.value }))} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Minimum Buyer Samples</Label>
                <Input disabled={!canManageSettings} type="number" min="1" max="100" value={settingsDraft.minBuyerSamples} onChange={(event) => setSettingsDraft((current) => ({ ...current, minBuyerSamples: event.target.value }))} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Minimum Group Samples</Label>
                <Input disabled={!canManageSettings} type="number" min="1" max="100" value={settingsDraft.minGroupSamples} onChange={(event) => setSettingsDraft((current) => ({ ...current, minGroupSamples: event.target.value }))} />
              </div>
            </div>
          )}

          <div className="mt-5 border-t border-border pt-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <CalendarDays className="h-4 w-4" />
              Manual Blocked Dates
            </div>
            <div className="grid gap-2 sm:grid-cols-[150px_110px_1fr_auto]">
              <Input disabled={!canManageSettings} type="date" value={overrideDraft.date} onChange={(event) => setOverrideDraft((current) => ({ ...current, date: event.target.value }))} />
              <Input disabled={!canManageSettings} value={overrideDraft.countryCode} onChange={(event) => setOverrideDraft((current) => ({ ...current, countryCode: event.target.value.toUpperCase() }))} placeholder="MANUAL" />
              <Input disabled={!canManageSettings} value={overrideDraft.name} onChange={(event) => setOverrideDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Reason" />
              <Button variant="outline" onClick={addOverride} disabled={saving || !canManageSettings}>
                <Check className="mr-2 h-4 w-4" />
                Add
              </Button>
            </div>
            <div className="mt-3 max-h-[190px] overflow-auto rounded-lg border border-border">
              {(data.holidayOverrides || []).length ? (data.holidayOverrides || []).map((override) => (
                <div key={override.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0">
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">{fmtDate(override.date)} · {override.name}</div>
                    <div className="text-xs text-muted-foreground">{override.countryCode}</div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => deleteOverride(override.id)} disabled={saving || !canManageSettings} title="Delete blocked date">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )) : (
                <div className="px-3 py-4 text-sm text-muted-foreground">No manual blocked dates.</div>
              )}
            </div>
          </div>
        </TableShell>
      </div>

      <StemDetailModal stemId={selectedStemId} open={!!selectedStemId} onClose={() => setSelectedStemId(null)} />
    </div>
  );
}
