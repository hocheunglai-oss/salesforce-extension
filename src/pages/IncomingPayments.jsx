import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Banknote, Eye, Loader2, Mail, RefreshCw, Search, Send, Settings2, ShieldCheck, WalletCards } from 'lucide-react';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import ReorderableDataTable from '@/components/common/ReorderableDataTable';
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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { readPageState, writePageState } from '@/lib/pageStateCache';
import { hasUsableSmtpSettings, readSmtpSettings, smtpFromAddress } from '@/lib/smtpSettings';
import { cn } from '@/lib/utils';

const PAGE_STATE_KEY = 'incoming-payments:v1';
const EMAIL_SETTINGS_KEY = 'salesforce_extension:incoming_payment_email_settings';
const RECEIVABLE_PAYMENTS_TABLE_TOKEN = '{{receivablePaymentsTable}}';
const BUYER_CIA_TABLE_TOKEN = '{{buyerCiaInvoicesTable}}';
const DEFAULT_EMAIL_SETTINGS = {
  from: 'Fratelli Cosulich <info@cosulich.com.hk>',
  to: 'bt@cosulich.com.hk',
  cc: '',
  bcc: '',
  subject: 'Incoming Payment Report - {{dateFrom}} to {{dateTo}}',
  intro: `Incoming Payment Report

Please find below the receivable payments and Buyer CIA invoices for the selected filters.

Received date range: {{dateFrom}} to {{dateTo}}.
Incoming total: {{incomingTotal}}.

${RECEIVABLE_PAYMENTS_TABLE_TOKEN}

${BUYER_CIA_TABLE_TOKEN}`,
  includeReceivablePayments: true,
  includeBuyerCiaInvoices: true,
};

const paymentStatusClass = {
  'Buyer Payment': 'border-blue-200 bg-blue-50 text-blue-700',
  'Supplier Refund': 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Bank Charge': 'border-amber-200 bg-amber-50 text-amber-800',
  Unmatched: 'border-amber-200 bg-amber-50 text-amber-800',
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

function PaymentStatusBadge({ row }) {
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap', paymentStatusClass[row.type] || paymentStatusClass.Unmatched)}>
      {row.type || '-'}
    </Badge>
  );
}

function defaultPageState() {
  return {
    dateFrom: todayHongKong(),
    dateTo: todayHongKong(),
    search: '',
    data: null,
    thresholdDraft: '50',
  };
}

function readEmailSettings() {
  try {
    const raw = localStorage.getItem(EMAIL_SETTINGS_KEY);
    return raw ? { ...DEFAULT_EMAIL_SETTINGS, ...JSON.parse(raw) } : DEFAULT_EMAIL_SETTINGS;
  } catch {
    return DEFAULT_EMAIL_SETTINGS;
  }
}

function saveEmailSettings(settings) {
  localStorage.setItem(EMAIL_SETTINGS_KEY, JSON.stringify({ ...DEFAULT_EMAIL_SETTINGS, ...settings }));
}

export default function IncomingPayments() {
  const { toast } = useToast();
  const { isAdministrator } = useAuth();
  const [pageState, setPageState] = useState(() => readPageState(PAGE_STATE_KEY, defaultPageState));
  const { dateFrom, dateTo, search, data, thresholdDraft } = pageState;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [allocationTarget, setAllocationTarget] = useState(null);
  const [allocationDraft, setAllocationDraft] = useState({ targetStem: '', amount: '', note: '' });
  const [allocationLoading, setAllocationLoading] = useState(false);
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSettings, setEmailSettings] = useState(readEmailSettings);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailPreview, setEmailPreview] = useState(null);
  const [emailError, setEmailError] = useState('');
  const [emailMessage, setEmailMessage] = useState('');

  const updatePageState = (patch) => {
    setPageState((prev) => ({
      ...prev,
      ...(typeof patch === 'function' ? patch(prev) : patch),
    }));
  };

  const setDateFrom = (value) => updatePageState({ dateFrom: value });
  const setDateTo = (value) => updatePageState({ dateTo: value });
  const setSearch = (value) => updatePageState({ search: value });
  const setThresholdDraft = (value) => updatePageState({ thresholdDraft: value });

  useEffect(() => {
    writePageState(PAGE_STATE_KEY, pageState);
  }, [pageState]);

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
    } else {
      updatePageState({
        data: res.data,
        thresholdDraft: String(res.data?.settings?.fullyPaidThreshold ?? 50),
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!data) load({ force: true });
  }, []);

  const rows = data?.rows || [];
  const buyerCiaRows = data?.buyerCiaInvoices || [];
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => [
      row.partyName,
      row.stemName,
      row.keyStem,
      row.buyerName,
      row.buyerGroupName,
      row.supplierName,
      row.supplierInvoiceName,
    ].some((value) => lowerText(value).includes(query)));
  }, [rows, search]);
  const visibleBuyerCiaRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return buyerCiaRows;
    return buyerCiaRows.filter((row) => [
      row.buyerName,
      row.buyerGroupName,
      row.buyerTrader,
      row.stemName,
      row.keyStem,
    ].some((value) => lowerText(value).includes(query)));
  }, [buyerCiaRows, search]);

  const summary = data?.summary || {};
  const threshold = data?.settings?.fullyPaidThreshold ?? 50;
  const lastMeta = data?.dateFrom && data?.dateTo ? `${fmtDate(data.dateFrom)} to ${fmtDate(data.dateTo)}` : null;

  const receivableColumns = useMemo(() => [
    { id: 'status', header: 'Status', cell: (row) => <PaymentStatusBadge row={row} /> },
    {
      id: 'receivedDate',
      header: 'Received Date',
      headerClassName: 'whitespace-nowrap',
      cellClassName: 'whitespace-nowrap text-sm',
      cell: (row) => fmtDate(row.paymentDate),
    },
    {
      id: 'paymentTerms',
      header: 'Payment Terms',
      headerClassName: 'whitespace-nowrap',
      cellClassName: 'whitespace-nowrap text-sm',
      cell: (row) => row.type === 'Buyer Payment' ? row.paymentTerms || '-' : 'N/A',
    },
    {
      id: 'delay',
      header: 'Delay',
      headerClassName: 'whitespace-nowrap',
      cellClassName: 'whitespace-nowrap text-sm',
      cell: (row) => row.type === 'Buyer Payment' ? (row.delayDays == null ? '-' : `${row.delayDays} Days`) : 'N/A',
    },
    {
      id: 'from',
      header: 'From',
      cellClassName: 'max-w-[220px] text-sm',
      cell: (row) => <div className="font-medium text-foreground">{row.partyName || '-'}</div>,
    },
    { id: 'group', header: 'Group', cellClassName: 'min-w-[160px] text-sm', cell: (row) => row.buyerGroupName || '-' },
    { id: 'stem', header: 'STEM', cellClassName: 'min-w-[240px] text-sm', cell: (row) => row.stemName || '-' },
    {
      id: 'amount',
      header: 'Amount',
      headerClassName: 'text-right',
      cellClassName: 'whitespace-nowrap text-right font-medium',
      cell: (row) => (
        <div>
          <div>{fmtMoney(row.amount, row.currency)}</div>
          {(row.bankCharges || []).map((charge) => (
            <div key={charge.id || charge.paymentId} className="text-xs font-semibold text-amber-700">
              Bank Charge {fmtMoney(charge.amount, charge.currency || row.currency)}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'receivable',
      header: 'Receivable',
      headerClassName: 'text-right',
      cellClassName: 'whitespace-nowrap text-right',
      cell: (row) => (
        <span className={cn(Number(row.receivableBalance) < 0 && 'font-semibold text-violet-700')}>
          {row.receivableBalance == null ? '-' : fmtMoney(row.receivableBalance, row.currency)}
        </span>
      ),
    },
  ], []);

  const ciaColumns = useMemo(() => [
    { id: 'buyer', header: 'Buyer', cellClassName: 'min-w-[220px] text-sm font-medium', cell: (row) => row.buyerName || '-' },
    { id: 'group', header: 'Group', cellClassName: 'min-w-[180px] text-sm', cell: (row) => row.buyerGroupName || '-' },
    { id: 'buyerTrader', header: 'Buyer Trader', cellClassName: 'min-w-[160px] text-sm', cell: (row) => row.buyerTrader || '-' },
    { id: 'stem', header: 'STEM', cellClassName: 'min-w-[240px] text-sm', cell: (row) => row.stemName || '-' },
    {
      id: 'calculatedAmount',
      header: 'Calculated Amount',
      headerClassName: 'text-right',
      cellClassName: 'whitespace-nowrap text-right font-medium',
      cell: (row) => fmtMoney(row.calculatedAmount),
    },
    {
      id: 'receivableBalance',
      header: 'Receivable Balance',
      headerClassName: 'text-right',
      cellClassName: 'whitespace-nowrap text-right',
      cell: (row) => fmtMoney(row.receivableBalance),
    },
    {
      id: 'deliveryDate',
      header: 'Delivery Date',
      headerClassName: 'whitespace-nowrap',
      cellClassName: 'whitespace-nowrap text-sm',
      cell: (row) => fmtDate(row.deliveryDate),
    },
  ], []);

  const availableBalanceColumns = useMemo(() => [
    { id: 'group', header: 'Buyer Group', cellClassName: 'min-w-[220px] font-medium', cell: (group) => group.buyerGroupName },
    { id: 'buyers', header: 'Buyers', cellClassName: 'min-w-[220px] text-sm text-muted-foreground', cell: (group) => group.buyerNames?.join(', ') || '-' },
    {
      id: 'stems',
      header: 'Overpaid STEMs',
      cellClassName: 'min-w-[320px] text-xs',
      cell: (group) => (
        <>
          {(group.stems || []).map((stem) => (
            <div key={stem.stemId} className="py-0.5">
              <span className="font-medium text-foreground">{stem.stemName}</span>
              <span className="ml-2 text-muted-foreground">{fmtMoney(stem.availableBalance)}</span>
            </div>
          ))}
        </>
      ),
    },
    {
      id: 'balance',
      header: 'Available Balance',
      headerClassName: 'text-right',
      cellClassName: 'whitespace-nowrap text-right font-semibold text-violet-700',
      cell: (group) => fmtMoney(group.totalAvailableBalance),
    },
    {
      id: 'action',
      header: 'Action',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      cell: (group) => (
        <Button
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            setAllocationTarget(group);
            setAllocationDraft({ targetStem: '', amount: String(group.totalAvailableBalance || ''), note: '' });
          }}
        >
          <ShieldCheck className="mr-2 h-4 w-4" />
          Allocate
        </Button>
      ),
    },
  ], []);

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

  const updateEmailSetting = (field, value) => {
    setEmailSettings((prev) => ({ ...prev, [field]: value }));
  };

  const saveEmailTemplate = () => {
    saveEmailSettings(emailSettings);
    toast({ title: 'Incoming Payment email template saved' });
  };

  const openEmailReport = () => {
    setEmailOpen(true);
    setEmailPreview(null);
    setEmailError('');
    setEmailMessage('');
  };

  const runEmailReport = async (preview = true) => {
    setEmailBusy(true);
    setEmailError('');
    setEmailMessage('');
    if (!preview) saveEmailSettings(emailSettings);
    const smtpSettings = readSmtpSettings();
    const credentials = hasUsableSmtpSettings(smtpSettings) && !preview
      ? { method: 'smtp', smtp: { ...smtpSettings, port: Number(smtpSettings.port || 587), from: smtpFromAddress(smtpSettings, emailSettings.from) } }
      : undefined;
    const res = await appClient.functions.invoke('incomingPaymentEmailReport', {
      dateFrom,
      dateTo,
      search,
      settings: emailSettings,
      credentials,
      preview,
    });
    if (res.data?.error) {
      setEmailError(res.data.error);
    } else if (preview) {
      setEmailPreview(res.data.email || null);
      setEmailMessage(`Preview ready: ${res.data.report?.receivableRows ?? 0} receivable payments and ${res.data.report?.buyerCiaRows ?? 0} Buyer CIA invoices.`);
    } else {
      setEmailPreview(res.data.email || null);
      setEmailMessage(`Sent Incoming Payment report to ${res.data.to?.join(', ') || emailSettings.to}.`);
    }
    setEmailBusy(false);
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
        description="Manage receivable buyer payments, supplier refunds, fully paid thresholds, and buyer-group overpayment balances from Salesforce payment records."
        meta={lastMeta ? `Received date range: ${lastMeta}. Fully paid threshold: ${fmtMoney(threshold)}.` : null}
        actions={(
          <>
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="mr-2 h-4 w-4" />
              Global Settings
            </Button>
            <Button variant="outline" onClick={openEmailReport}>
              <Mail className="mr-2 h-4 w-4" />
              Email Report
            </Button>
            <Button onClick={() => load({ force: true })} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </>
        )}
      />

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Incoming Total"
          value={fmtMoney(summary.totalIncomingAmount)}
          sub={`Buyer Payments ${fmtMoney(summary.buyerPaymentTotal)} · Supplier Refunds ${fmtMoney(summary.supplierRefundTotal)} · ${summary.incomingRows || 0} records`}
          icon={Banknote}
          color="green"
        />
        <StatCard label="Needs Review" value={String(summary.unmatchedCount || 0)} sub="Unmatched or incomplete payments" icon={AlertTriangle} color="amber" />
      </div>

      <TableShell
        title="Buyer CIA Invoices"
        meta={`${visibleBuyerCiaRows.length.toLocaleString()} visible of ${buyerCiaRows.length.toLocaleString()} unpaid CIA buyer invoice stems`}
        className="mb-4"
      >
        <div className="max-h-[32vh] overflow-auto">
          <ReorderableDataTable
            tableKey="incoming-payment-cia-invoices"
            columns={ciaColumns}
            rows={visibleBuyerCiaRows}
            rowKey={(row) => row.stemId}
            isReorderEnabled={isAdministrator}
            emptyIcon={Search}
            emptyTitle="No unpaid CIA buyer invoices"
            emptyDescription="No open buyer invoice STEMs with CIA payment terms were found."
            onRowClick={(row) => row.stemId && setSelectedStemId(row.stemId)}
            rowClassName="hover:bg-muted/40"
          />
        </div>
      </TableShell>

      <TableShell
        title="Payment Filters"
        meta="Filters use Hong Kong date basis and the selected Payment__c date field."
        bodyClassName="p-4"
        className="mb-4"
      >
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end">
          <div>
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Keyword</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search STEM, buyer, group, or supplier" />
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
            title="Receivable Payments"
            meta={`${visibleRows.length.toLocaleString()} visible of ${rows.length.toLocaleString()} records`}
            className="mb-4"
          >
            <div className="max-h-[52vh] overflow-auto">
              <ReorderableDataTable
                tableKey="incoming-payment-receivable-payments"
                columns={receivableColumns}
                rows={visibleRows}
                rowKey={(row) => row.id}
                loading={loading}
                loadingTitle="Loading receivable payments"
                emptyIcon={Search}
                emptyTitle="No payments found"
                emptyDescription="Adjust the filters or refresh the Salesforce data."
                isReorderEnabled={isAdministrator}
                onRowClick={(row) => row.stemId && setSelectedStemId(row.stemId)}
                rowClassName={(row) => cn('hover:bg-muted/40', row.stemId && 'cursor-pointer')}
              />
            </div>
          </TableShell>

          <TableShell
            title="Available Buyer Balances"
            meta="Overpaid STEMs are grouped by buyer group. Allocation is limited to the same buyer group."
          >
            <div className="max-h-[36vh] overflow-auto">
              <ReorderableDataTable
                tableKey="incoming-payment-available-balances"
                columns={availableBalanceColumns}
                rows={data?.availableBalances || []}
                rowKey={(group) => group.buyerGroupName}
                isReorderEnabled={isAdministrator}
                emptyIcon={WalletCards}
                emptyTitle="No available buyer balances"
                emptyDescription="No linked STEM has Receivable_Balance__c below zero in this payment range."
                rowClassName="hover:bg-muted/40"
              />
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

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Incoming Payment Report Email</DialogTitle>
            <DialogDescription>
              The report uses the current received-date range and keyword filter. Tables are generated when you preview or send.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[70vh] gap-4 overflow-auto pr-1 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input value={emailSettings.from} onChange={(event) => updateEmailSetting('from', event.target.value)} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input value={emailSettings.to} onChange={(event) => updateEmailSetting('to', event.target.value)} placeholder="email@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">CC</Label>
                  <Input value={emailSettings.cc} onChange={(event) => updateEmailSetting('cc', event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">BCC</Label>
                  <Input value={emailSettings.bcc} onChange={(event) => updateEmailSetting('bcc', event.target.value)} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs text-muted-foreground">Subject</Label>
                  <Input value={emailSettings.subject} onChange={(event) => updateEmailSetting('subject', event.target.value)} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Email Content</Label>
                <Textarea
                  value={emailSettings.intro}
                  onChange={(event) => updateEmailSetting('intro', event.target.value)}
                  className="min-h-56 font-mono text-xs"
                />
                <div className="rounded-lg border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                  Available table tokens: <span className="font-mono">{RECEIVABLE_PAYMENTS_TABLE_TOKEN}</span> and{' '}
                  <span className="font-mono">{BUYER_CIA_TABLE_TOKEN}</span>. If a token is removed, that table is appended below the content.
                </div>
              </div>

              <div className="grid gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={emailSettings.includeReceivablePayments !== false}
                    onChange={(event) => updateEmailSetting('includeReceivablePayments', event.target.checked)}
                  />
                  Include Receivable Payments table
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={emailSettings.includeBuyerCiaInvoices !== false}
                    onChange={(event) => updateEmailSetting('includeBuyerCiaInvoices', event.target.checked)}
                  />
                  Include Buyer CIA Invoices table
                </label>
              </div>

              {emailError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {emailError}
                </div>
              )}
              {emailMessage && !emailError && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  {emailMessage}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div>
                  <div className="text-sm font-semibold text-foreground">Preview</div>
                  <div className="text-xs text-muted-foreground">
                    {emailPreview?.subject ? `Subject: ${emailPreview.subject}` : 'Generate a preview before sending.'}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => runEmailReport(true)} disabled={emailBusy}>
                  {emailBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                  Preview
                </Button>
              </div>
              <div className="h-[520px] overflow-auto p-4">
                {emailPreview?.html ? (
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: emailPreview.html }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No preview generated yet.
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailOpen(false)}>Close</Button>
            <Button variant="outline" onClick={saveEmailTemplate}>Save Template</Button>
            <Button onClick={() => runEmailReport(false)} disabled={emailBusy}>
              {emailBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send Email
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
