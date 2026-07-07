import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Banknote, CheckCircle2, Loader2, RefreshCw, Search, Settings2, ShieldCheck, WalletCards } from 'lucide-react';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import StatCard from '@/components/dashboard/StatCard';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { cn } from '@/lib/utils';

const TYPE_FILTERS = [
  { value: 'incoming', label: 'Incoming only' },
  { value: 'all', label: 'All payments' },
  { value: 'Buyer Payment', label: 'Buyer payments' },
  { value: 'Supplier Refund', label: 'Supplier refunds' },
  { value: 'Unmatched', label: 'Needs review' },
];

const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'Fully paid', label: 'Fully paid' },
  { value: 'Overpaid / available balance', label: 'Overpaid' },
  { value: 'Partially paid', label: 'Partially paid' },
  { value: 'Needs review', label: 'Needs review' },
];

const statusClass = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  blue: 'border-blue-200 bg-blue-50 text-blue-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  purple: 'border-violet-200 bg-violet-50 text-violet-700',
  slate: 'border-slate-200 bg-slate-100 text-slate-700',
};

function todayHongKong() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function fmtMoney(value, currency = 'USD') {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  const prefix = currency === 'USD' || !currency ? '$' : `${currency} `;
  return `${prefix}${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(value) {
  if (!value) return '-';
  try { return format(new Date(value), 'dd MMM yyyy'); } catch { return String(value); }
}

function lowerText(value) {
  return String(value || '').toLowerCase();
}

function csvSafe(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(rows) {
  const headers = ['Type', 'Date', 'Invoice Due Date', 'Delay', 'From', 'Group', 'STEM', 'Amount', 'Receivable Balance', 'Payable Balance', 'Status', 'Reference'];
  const lines = [
    headers.map(csvSafe).join(','),
    ...rows.map((row) => [
      row.type || '',
      row.paymentDate || '',
      row.invoiceDueDate || (row.type === 'Buyer Payment' ? '' : 'N/A'),
      row.delayDays == null ? (row.type === 'Buyer Payment' ? '' : 'N/A') : `${row.delayDays} Days`,
      row.partyName || '',
      row.buyerGroupName || '',
      row.stemName || '',
      row.amount ?? '',
      row.receivableBalance ?? '',
      row.payableBalance ?? '',
      row.status || '',
      row.reference || '',
    ].map(csvSafe).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `incoming_payments_${todayHongKong()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function StatusBadge({ row }) {
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap', statusClass[row.statusTone] || statusClass.slate)}>
      {row.status || '-'}
    </Badge>
  );
}

export default function IncomingPayments() {
  const { toast } = useToast();
  const { isAdministrator } = useAuth();
  const [dateFrom, setDateFrom] = useState(todayHongKong);
  const [dateTo, setDateTo] = useState(todayHongKong);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState('50');
  const [savingSettings, setSavingSettings] = useState(false);
  const [allocationTarget, setAllocationTarget] = useState(null);
  const [allocationDraft, setAllocationDraft] = useState({ targetStem: '', amount: '', note: '' });
  const [allocationLoading, setAllocationLoading] = useState(false);
  const [selectedStemId, setSelectedStemId] = useState(null);

  const load = async (options = {}) => {
    setLoading(true);
    setError('');
    const res = await appClient.functions.invoke('incomingPaymentsList', {
      dateFrom,
      dateTo,
      limit: 5000,
    }, { cache: true, force: options.force });
    if (res.data?.error) {
      setError(res.data.error);
      setData(null);
    } else {
      setData(res.data);
      setThresholdDraft(String(res.data?.settings?.fullyPaidThreshold ?? 50));
    }
    setLoading(false);
  };

  useEffect(() => {
    load({ force: true });
  }, []);

  const rows = data?.rows || [];
  const visibleRows = useMemo(() => {
    let result = rows;
    if (typeFilter === 'incoming') result = result.filter((row) => row.isIncoming);
    else if (typeFilter !== 'all') result = result.filter((row) => row.type === typeFilter || (typeFilter === 'Unmatched' && row.status === 'Needs review'));
    if (statusFilter !== 'all') result = result.filter((row) => row.status === statusFilter);
    const query = search.trim().toLowerCase();
    if (query) {
      result = result.filter((row) => [
        row.partyName,
        row.stemName,
        row.keyStem,
        row.buyerName,
        row.buyerGroupName,
        row.supplierName,
        row.supplierInvoiceName,
        row.reference,
      ].some((value) => lowerText(value).includes(query)));
    }
    return result;
  }, [rows, search, statusFilter, typeFilter]);

  const summary = data?.summary || {};
  const threshold = data?.settings?.fullyPaidThreshold ?? 50;
  const lastMeta = data?.dateFrom && data?.dateTo ? `${fmtDate(data.dateFrom)} to ${fmtDate(data.dateTo)}` : null;

  const saveSettings = async () => {
    if (!isAdministrator) {
      toast({ title: 'Administrator access required', description: 'Only administrators can change the global payment threshold.' });
      return;
    }
    setSavingSettings(true);
    const res = await appClient.functions.invoke('incomingPaymentSettingsSave', {
      fullyPaidThreshold: Number(thresholdDraft),
    });
    setSavingSettings(false);
    if (res.data?.error) {
      toast({ title: 'Save failed', description: res.data.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Incoming Payment settings saved', description: `Fully paid threshold is ${fmtMoney(res.data.settings.fullyPaidThreshold)}.` });
    setSettingsOpen(false);
    appClient.functions.clearCache();
    load({ force: true });
  };

  const confirmAllocation = async () => {
    if (!allocationTarget) return;
    setAllocationLoading(true);
    const res = await appClient.functions.invoke('incomingPaymentAllocationConfirm', {
      buyerGroupName: allocationTarget.buyerGroupName,
      targetStem: allocationDraft.targetStem,
      amount: allocationDraft.amount,
      note: allocationDraft.note,
    });
    setAllocationLoading(false);
    if (res.data?.error) {
      toast({ title: 'Salesforce write-back not enabled', description: res.data.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Allocation confirmed' });
    setAllocationTarget(null);
  };

  return (
    <div className="min-h-screen bg-background px-4 py-5 md:px-6">
      <PageHeader
        icon={Banknote}
        eyebrow="Salesforce payments"
        title="Incoming Payment"
        description="Manage buyer payments received, supplier refunds, fully paid thresholds, and buyer-group overpayment balances from Salesforce payment records."
        meta={lastMeta ? `Payment date range: ${lastMeta}. Fully paid threshold: ${fmtMoney(threshold)}.` : null}
        actions={(
          <>
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="mr-2 h-4 w-4" />
              Global Settings
            </Button>
            <Button variant="outline" onClick={() => downloadCsv(visibleRows)} disabled={!visibleRows.length}>
              Export CSV
            </Button>
            <Button onClick={() => load({ force: true })} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </>
        )}
      />

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Incoming Total" value={fmtMoney(summary.totalIncomingAmount)} sub={`${summary.incomingRows || 0} incoming records`} icon={Banknote} color="green" />
        <StatCard label="Buyer Payments" value={fmtMoney(summary.buyerPaymentTotal)} sub="Existing Salesforce payments" icon={CheckCircle2} color="blue" />
        <StatCard label="Supplier Refunds" value={fmtMoney(summary.supplierRefundTotal)} sub="Negative supplier invoice payments" icon={WalletCards} color="teal" />
        <StatCard label="Available Buyer Balance" value={fmtMoney(summary.availableBalanceTotal)} sub={`${summary.availableBalanceCount || 0} overpaid STEMs`} icon={WalletCards} color="purple" />
        <StatCard label="Needs Review" value={String(summary.unmatchedCount || 0)} sub="Unmatched or incomplete payments" icon={AlertTriangle} color="amber" />
      </div>

      <TableShell
        title="Payment Filters"
        meta="Filters use Hong Kong date basis and the selected Payment__c date field."
        bodyClassName="p-4"
        className="mb-4"
      >
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_2fr_auto] md:items-end">
          <div>
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPE_FILTERS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Keyword</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search payment, STEM, buyer, group, supplier, reference" />
            </div>
          </div>
          <Button variant="outline" onClick={() => load({ force: true })} disabled={loading}>
            Apply
          </Button>
        </div>
      </TableShell>

      {data?.schemaWarnings?.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {data.schemaWarnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}

      {error && (
        <StateBlock
          icon={AlertTriangle}
          title="Unable to load incoming payments"
          description={error}
          action={<Button variant="outline" onClick={() => load({ force: true })}>Try Again</Button>}
        />
      )}

      {!error && (
        <>
          <TableShell
            title="Salesforce Payment Records"
            meta={`${visibleRows.length.toLocaleString()} visible of ${rows.length.toLocaleString()} records`}
            className="mb-4"
          >
            <div className="max-h-[52vh] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="whitespace-nowrap">Date</TableHead>
                    <TableHead className="whitespace-nowrap">Invoice Due Date</TableHead>
                    <TableHead className="whitespace-nowrap">Delay</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead>STEM</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Receivable</TableHead>
                    <TableHead className="text-right">Payable</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={12}>
                        <StateBlock icon={Loader2} title="Loading payment records" description="Reading Salesforce Payment__c records." />
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && !visibleRows.length && (
                    <TableRow>
                      <TableCell colSpan={12}>
                        <StateBlock icon={Search} title="No payments found" description="Adjust the filters or refresh the Salesforce data." />
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && visibleRows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={cn('hover:bg-muted/40', row.stemId && 'cursor-pointer')}
                      onClick={() => row.stemId && setSelectedStemId(row.stemId)}
                    >
                      <TableCell className="whitespace-nowrap text-sm font-medium">{row.type}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{fmtDate(row.paymentDate)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{row.type === 'Buyer Payment' ? fmtDate(row.invoiceDueDate) : 'N/A'}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{row.type === 'Buyer Payment' ? (row.delayDays == null ? '-' : `${row.delayDays} Days`) : 'N/A'}</TableCell>
                      <TableCell className="max-w-[220px] text-sm">
                        <div className="font-medium text-foreground">{row.partyName || '-'}</div>
                        {row.supplierInvoiceName && <div className="text-xs text-muted-foreground">{row.supplierInvoiceName}</div>}
                      </TableCell>
                      <TableCell className="min-w-[160px] text-sm">{row.buyerGroupName || '-'}</TableCell>
                      <TableCell className="min-w-[240px] text-sm">{row.stemName || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium">{fmtMoney(row.amount, row.currency)}</TableCell>
                      <TableCell className={cn('whitespace-nowrap text-right', Number(row.receivableBalance) < 0 && 'font-semibold text-violet-700')}>
                        {row.receivableBalance == null ? '-' : fmtMoney(row.receivableBalance, row.currency)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">{row.payableBalance == null ? '-' : fmtMoney(row.payableBalance, row.currency)}</TableCell>
                      <TableCell><StatusBadge row={row} /></TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">{row.reference || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TableShell>

          <TableShell
            title="Available Buyer Balances"
            meta="Overpaid STEMs are grouped by buyer group. Allocation is limited to the same buyer group."
          >
            <div className="max-h-[36vh] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Buyer Group</TableHead>
                    <TableHead>Buyers</TableHead>
                    <TableHead>Overpaid STEMs</TableHead>
                    <TableHead className="text-right">Available Balance</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!data?.availableBalances?.length && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <StateBlock icon={WalletCards} title="No available buyer balances" description="No linked STEM has Receivable_Balance__c below zero in this payment range." />
                      </TableCell>
                    </TableRow>
                  )}
                  {data?.availableBalances?.map((group) => (
                    <TableRow key={group.buyerGroupName} className="hover:bg-muted/40">
                      <TableCell className="min-w-[220px] font-medium">{group.buyerGroupName}</TableCell>
                      <TableCell className="min-w-[220px] text-sm text-muted-foreground">{group.buyerNames?.join(', ') || '-'}</TableCell>
                      <TableCell className="min-w-[320px] text-xs">
                        {(group.stems || []).map((stem) => (
                          <div key={stem.stemId} className="py-0.5">
                            <span className="font-medium text-foreground">{stem.stemName}</span>
                            <span className="ml-2 text-muted-foreground">{fmtMoney(stem.availableBalance)}</span>
                          </div>
                        ))}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold text-violet-700">{fmtMoney(group.totalAvailableBalance)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setAllocationTarget(group);
                            setAllocationDraft({ targetStem: '', amount: String(group.totalAvailableBalance || ''), note: '' });
                          }}
                        >
                          <ShieldCheck className="mr-2 h-4 w-4" />
                          Allocate
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TableShell>
        </>
      )}

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Incoming Payment Settings</DialogTitle>
            <DialogDescription>These settings are global and affect all users.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Fully paid threshold</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={thresholdDraft}
                onChange={(event) => setThresholdDraft(event.target.value)}
                disabled={!isAdministrator}
              />
              <p className="mt-1 text-xs text-muted-foreground">Buyer invoices are considered fully paid when receivable balance is within this amount.</p>
            </div>
            {!isAdministrator && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Only administrators can change this setting.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button onClick={saveSettings} disabled={!isAdministrator || savingSettings}>
              {savingSettings && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(allocationTarget)} onOpenChange={(open) => !open && setAllocationTarget(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Allocate Available Balance</DialogTitle>
            <DialogDescription>
              Available balances can only be assigned within the same buyer group. Salesforce write-back still requires confirmation of the target allocation object/fields.
            </DialogDescription>
          </DialogHeader>
          {allocationTarget && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
                <div className="font-medium">{allocationTarget.buyerGroupName}</div>
                <div className="text-muted-foreground">Available: {fmtMoney(allocationTarget.totalAvailableBalance)}</div>
              </div>
              <div>
                <Label>Target STEM</Label>
                <Input value={allocationDraft.targetStem} onChange={(event) => setAllocationDraft((prev) => ({ ...prev, targetStem: event.target.value }))} placeholder="Enter target STEM name or key" />
              </div>
              <div>
                <Label>Amount to allocate</Label>
                <Input type="number" step="0.01" value={allocationDraft.amount} onChange={(event) => setAllocationDraft((prev) => ({ ...prev, amount: event.target.value }))} />
              </div>
              <div>
                <Label>Approval note</Label>
                <Textarea value={allocationDraft.note} onChange={(event) => setAllocationDraft((prev) => ({ ...prev, note: event.target.value }))} placeholder="Optional approval note" />
              </div>
              {!isAdministrator && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Only administrators can confirm Salesforce write-back.
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAllocationTarget(null)}>Cancel</Button>
            <Button onClick={confirmAllocation} disabled={!isAdministrator || allocationLoading}>
              {allocationLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Write-back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StemDetailModal
        stemId={selectedStemId}
        open={!!selectedStemId}
        onClose={() => setSelectedStemId(null)}
        onUpdated={() => load({ force: true })}
      />
    </div>
  );
}
