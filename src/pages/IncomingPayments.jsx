import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Banknote, Eye, Loader2, Mail, Pencil, RefreshCw, Save, Search, Send, Settings2, ShieldCheck, WalletCards, X } from 'lucide-react';
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
import { hasUsableSmtpSettings, readPaymentReminderSmtpSettings, readSmtpSettings, smtpFromAddress } from '@/lib/smtpSettings';
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

Payment created date range: {{dateFrom}} to {{dateTo}}.
Incoming total: {{incomingTotal}}.

${RECEIVABLE_PAYMENTS_TABLE_TOKEN}

${BUYER_CIA_TABLE_TOKEN}`,
  includeReceivablePayments: true,
  includeBuyerCiaInvoices: true,
};

const EMAIL_TABLE_TOKENS = [
  { label: 'Incoming Total', token: '{{incomingTotal}}' },
  { label: 'Buyer Payments', token: '{{buyerPaymentTotal}}' },
  { label: 'Supplier Refunds', token: '{{supplierRefundTotal}}' },
  { label: 'Incoming Records', token: '{{receivablePaymentCount}}' },
  { label: 'Needs Review', token: '{{needsReviewCount}}' },
  { label: 'Request Late Payment Interest Invoice', token: '{{requestLatePaymentInterestInvoiceLink}}' },
  { label: 'Receivable Payments Table', token: RECEIVABLE_PAYMENTS_TABLE_TOKEN },
  { label: 'Buyer CIA Invoices Table', token: BUYER_CIA_TABLE_TOKEN },
];

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

function dateOnlyHongKong(value) {
  if (!value) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(value));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return '';
  }
}

function insertedDateText(row) {
  if (!row?.paymentDate || !row?.createdDate) return '';
  return dateOnlyHongKong(row.paymentDate) !== dateOnlyHongKong(row.createdDate)
    ? `Inserted on ${fmtDate(row.createdDate)}`
    : '';
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

function readUrlFilterPatch() {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const patch = {};
  if (params.has('dateFrom')) patch.dateFrom = params.get('dateFrom') || todayHongKong();
  if (params.has('dateTo')) patch.dateTo = params.get('dateTo') || patch.dateFrom || todayHongKong();
  if (params.has('search')) patch.search = params.get('search') || '';
  if (params.has('keyword')) patch.search = params.get('keyword') || '';
  return patch;
}

function initialPageState() {
  const cached = readPageState(PAGE_STATE_KEY, defaultPageState);
  const filterPatch = readUrlFilterPatch();
  if (!Object.keys(filterPatch).length) return cached;
  return { ...cached, ...filterPatch, data: null };
}

function readEmailSettings() {
  try {
    const raw = localStorage.getItem(EMAIL_SETTINGS_KEY);
    const settings = raw ? { ...DEFAULT_EMAIL_SETTINGS, ...JSON.parse(raw) } : DEFAULT_EMAIL_SETTINGS;
    return {
      ...settings,
      intro: String(settings.intro || DEFAULT_EMAIL_SETTINGS.intro)
        .replace('Received date range:', 'Payment created date range:'),
    };
  } catch {
    return DEFAULT_EMAIL_SETTINGS;
  }
}

function saveEmailSettings(settings) {
  localStorage.setItem(EMAIL_SETTINGS_KEY, JSON.stringify({ ...DEFAULT_EMAIL_SETTINGS, ...settings }));
}

function incomingPaymentSmtpCredentials(from) {
  const internalSettings = readSmtpSettings();
  if (hasUsableSmtpSettings(internalSettings)) {
    return {
      label: 'Internal Email Reminder Sender',
      credentials: {
        method: 'smtp',
        smtp: { ...internalSettings, port: Number(internalSettings.port || 587), from: smtpFromAddress(internalSettings, from) },
      },
    };
  }
  const paymentReminderSettings = readPaymentReminderSmtpSettings();
  if (hasUsableSmtpSettings(paymentReminderSettings)) {
    return {
      label: 'Payment Reminder Sender',
      credentials: {
        method: 'smtp',
        smtp: { ...paymentReminderSettings, port: Number(paymentReminderSettings.port || 587), from: smtpFromAddress(paymentReminderSettings, from) },
      },
    };
  }
  return { label: '', credentials: undefined };
}

export default function IncomingPayments() {
  const { toast } = useToast();
  const { isAdministrator } = useAuth();
  const [pageState, setPageState] = useState(initialPageState);
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
  const [savedEmailSettings, setSavedEmailSettings] = useState(readEmailSettings);
  const [emailSettings, setEmailSettings] = useState(() => savedEmailSettings);
  const [emailTemplateEditing, setEmailTemplateEditing] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailAction, setEmailAction] = useState('');
  const [emailPreview, setEmailPreview] = useState(null);
  const [emailError, setEmailError] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [interestRequestLoading, setInterestRequestLoading] = useState({});
  const emailContentRef = useRef(null);

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

  const markInterestInvoiceRequested = (paymentId, notification) => {
    updatePageState((prev) => ({
      data: prev.data ? {
        ...prev.data,
        rows: (prev.data.rows || []).map((row) => (
          (row.paymentId || row.id) === paymentId
            ? {
                ...row,
                interestInvoiceNotificationSent: true,
                interestInvoiceNotification: notification || row.interestInvoiceNotification || null,
              }
            : row
        )),
      } : prev.data,
    }));
  };

  const sendInterestInvoiceRequest = async (row) => {
    const paymentId = row.paymentId || row.id;
    if (!paymentId) return;
    setInterestRequestLoading((prev) => ({ ...prev, [paymentId]: true }));
    try {
      const delivery = incomingPaymentSmtpCredentials(emailSettings.from || DEFAULT_EMAIL_SETTINGS.from);
      if (!delivery.credentials) {
        toast({
          title: 'Email sender not configured',
          description: 'Save and enable an SMTP sender in Settings > Email Senders, then try the interest invoice request again.',
          variant: 'destructive',
        });
        return;
      }
      const res = await appClient.functions.invoke('incomingPaymentInterestInvoiceRequest', {
        paymentId,
        paymentName: row.paymentName || row.paymentDisplayName || row.salesforcePaymentName,
        stemId: row.stemId,
        stemName: row.stemName,
        buyerName: row.buyerName || row.partyName,
        partyName: row.partyName,
        buyerGroupName: row.buyerGroupName,
        paymentDate: row.paymentDate,
        createdDate: row.createdDate,
        delayDays: row.delayDays,
        amount: row.amount,
        currency: row.currency,
        receivableBalance: row.receivableBalance,
        from: emailSettings.from || DEFAULT_EMAIL_SETTINGS.from,
        credentials: delivery.credentials,
      });
      if (res.data?.error) {
        toast({ title: 'Interest invoice request failed', description: res.data.error, variant: 'destructive' });
        return;
      }
      markInterestInvoiceRequested(paymentId, res.data?.notification || null);
      const senderNote = delivery.label ? ` using ${delivery.label}` : '';
      toast({
        title: res.data?.alreadySent ? 'Interest invoice already requested' : 'Interest invoice request sent',
        description: res.data?.alreadySent
          ? 'This payment already has a recorded request.'
          : `Louisa has been notified${senderNote}.`,
      });
    } catch (error) {
      toast({
        title: 'Interest invoice request failed',
        description: error?.message || 'Unexpected error while sending the notification.',
        variant: 'destructive',
      });
    } finally {
      setInterestRequestLoading((prev) => {
        const next = { ...prev };
        delete next[paymentId];
        return next;
      });
    }
  };

  const receivableColumns = useMemo(() => [
    { id: 'status', header: 'Status', cell: (row) => <PaymentStatusBadge row={row} /> },
    {
      id: 'receivedDate',
      header: 'Received Date',
      headerClassName: 'whitespace-nowrap',
      cellClassName: 'whitespace-nowrap text-sm',
      cell: (row) => {
        const inserted = insertedDateText(row);
        return (
          <div>
            <div>{fmtDate(row.paymentDate)}</div>
            {inserted && <div className="text-xs font-semibold text-amber-700">{inserted}</div>}
          </div>
        );
      },
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
    {
      id: 'interestInvoice',
      header: 'Interest Invoice',
      headerClassName: 'text-right whitespace-nowrap',
      cellClassName: 'text-right whitespace-nowrap',
      cell: (row) => {
        const paymentId = row.paymentId || row.id;
        const eligible = row.type === 'Buyer Payment' && Number(row.delayDays) > 3;
        if (!eligible) return <span className="text-muted-foreground">N/A</span>;
        const sent = Boolean(row.interestInvoiceNotificationSent);
        const loadingRequest = Boolean(interestRequestLoading[paymentId]);
        const sentLabel = row.interestInvoiceNotification?.sentAt ? `Requested ${fmtDate(row.interestInvoiceNotification.sentAt)}` : 'Requested';
        return (
          <Button
            variant={sent ? 'secondary' : 'outline'}
            size="sm"
            disabled={sent || loadingRequest}
            title={sentLabel}
            className={cn(sent && 'bg-slate-700 text-white hover:bg-slate-700 disabled:opacity-100')}
            onClick={(event) => {
              event.stopPropagation();
              sendInterestInvoiceRequest(row);
            }}
          >
            {loadingRequest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            {sent ? 'Requested' : 'Request'}
          </Button>
        );
      },
    },
  ], [interestRequestLoading, sendInterestInvoiceRequest]);

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

  const startEmailTemplateEdit = () => {
    setSavedEmailSettings(emailSettings);
    setEmailTemplateEditing(true);
    setEmailMessage('');
    setEmailError('');
  };

  const saveEmailTemplate = () => {
    saveEmailSettings(emailSettings);
    setSavedEmailSettings(emailSettings);
    setEmailTemplateEditing(false);
    toast({ title: 'Incoming Payment email template saved' });
  };

  const cancelEmailTemplateChanges = () => {
    setEmailSettings(savedEmailSettings);
    setEmailTemplateEditing(false);
    setEmailMessage('');
    setEmailError('');
  };

  const insertEmailToken = (token) => {
    if (!emailTemplateEditing) return;
    const target = emailContentRef.current;
    const current = emailSettings.intro || '';
    const start = target?.selectionStart ?? current.length;
    const end = target?.selectionEnd ?? start;
    const separatorBefore = start > 0 && !/\s$/.test(current.slice(0, start)) ? '\n\n' : '';
    const separatorAfter = end < current.length && !/^\s/.test(current.slice(end)) ? '\n\n' : '';
    const next = `${current.slice(0, start)}${separatorBefore}${token}${separatorAfter}${current.slice(end)}`;
    updateEmailSetting('intro', next);
    window.requestAnimationFrame(() => {
      target?.focus();
      const cursor = start + separatorBefore.length + token.length + separatorAfter.length;
      target?.setSelectionRange(cursor, cursor);
    });
  };

  const openEmailReport = () => {
    const saved = readEmailSettings();
    setSavedEmailSettings(saved);
    setEmailSettings(saved);
    setEmailTemplateEditing(false);
    setEmailOpen(true);
    setEmailPreview(null);
    setEmailError('');
    setEmailMessage('');
  };

  const closeEmailReport = () => {
    if (emailTemplateEditing && JSON.stringify(emailSettings) !== JSON.stringify(savedEmailSettings)) {
      const discard = window.confirm('Discard unsaved Incoming Payment email template changes?');
      if (!discard) return;
      cancelEmailTemplateChanges();
    }
    setEmailOpen(false);
  };

  const runEmailReport = async (preview = true) => {
    if (!preview && !String(emailSettings.to || '').trim()) {
      const message = 'Enter at least one To recipient before sending.';
      setEmailError(message);
      toast({ title: 'Email send failed', description: message, variant: 'destructive' });
      return;
    }
    setEmailBusy(true);
    setEmailAction(preview ? 'preview' : 'send');
    setEmailError('');
    setEmailMessage('');
    try {
      const delivery = preview ? { credentials: undefined, label: '' } : incomingPaymentSmtpCredentials(emailSettings.from);
      const res = await appClient.functions.invoke('incomingPaymentEmailReport', {
        dateFrom,
        dateTo,
        search,
        settings: { ...emailSettings, appUrl: window.location.origin },
        credentials: delivery.credentials,
        preview,
      });
      if (res.data?.error) {
        setEmailError(res.data.error);
        toast({
          title: preview ? 'Email preview failed' : 'Email send failed',
          description: res.data.error,
          variant: 'destructive',
        });
      } else if (preview) {
        setEmailPreview(res.data.email || null);
        setEmailMessage(`Preview ready: ${res.data.report?.receivableRows ?? 0} receivable payments and ${res.data.report?.buyerCiaRows ?? 0} Buyer CIA invoices.`);
      } else {
        setEmailPreview(res.data.email || null);
        const senderNote = delivery.label ? ` using ${delivery.label}` : '';
        setEmailMessage(`Sent Incoming Payment report to ${res.data.to?.join(', ') || emailSettings.to}${senderNote}.`);
        toast({ title: 'Incoming Payment report sent', description: `Sent to ${res.data.to?.join(', ') || emailSettings.to}${senderNote}.` });
      }
    } catch (error) {
      const message = error?.message || 'Unexpected error while sending Incoming Payment report.';
      setEmailError(message);
      toast({
        title: preview ? 'Email preview failed' : 'Email send failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setEmailBusy(false);
      setEmailAction('');
    }
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
        meta={lastMeta ? `Payment created date range: ${lastMeta}. Fully paid threshold: ${fmtMoney(threshold)}.` : null}
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
        meta="Filters use Payment__c CreatedDate on a Hong Kong date basis. Received Date remains the payment value date."
        bodyClassName="p-4"
        className="mb-4"
      >
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end">
          <div>
            <Label className="text-xs text-muted-foreground">Created From</Label>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Created To</Label>
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

      <Dialog open={emailOpen} onOpenChange={(open) => (open ? setEmailOpen(true) : closeEmailReport())}>
        <DialogContent className="max-h-[92vh] w-[96vw] max-w-[1500px] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Incoming Payment Report Email</DialogTitle>
            <DialogDescription>
              The report uses the current payment-created date range and keyword filter. Tables are generated when you preview or send.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[70vh] gap-4 overflow-hidden pr-1 lg:grid-cols-[430px_minmax(0,1fr)]">
            <div className="space-y-3 overflow-auto pr-1">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input value={emailSettings.from} onChange={(event) => updateEmailSetting('from', event.target.value)} disabled={!emailTemplateEditing} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input value={emailSettings.to} onChange={(event) => updateEmailSetting('to', event.target.value)} placeholder="email@example.com" disabled={!emailTemplateEditing} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">CC</Label>
                  <Input value={emailSettings.cc} onChange={(event) => updateEmailSetting('cc', event.target.value)} disabled={!emailTemplateEditing} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">BCC</Label>
                  <Input value={emailSettings.bcc} onChange={(event) => updateEmailSetting('bcc', event.target.value)} disabled={!emailTemplateEditing} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs text-muted-foreground">Subject</Label>
                  <Input value={emailSettings.subject} onChange={(event) => updateEmailSetting('subject', event.target.value)} disabled={!emailTemplateEditing} />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-2">
                  {EMAIL_TABLE_TOKENS.map((item) => (
                    <button
                      key={item.token}
                      type="button"
                      draggable={emailTemplateEditing}
                      disabled={!emailTemplateEditing}
                      onClick={() => insertEmailToken(item.token)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', item.token);
                        event.dataTransfer.effectAllowed = 'copy';
                      }}
                      className={cn(
                        'rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-foreground transition-colors',
                        emailTemplateEditing ? 'cursor-grab hover:bg-muted/70' : 'cursor-not-allowed opacity-50',
                      )}
                      title={emailTemplateEditing ? 'Drag into the template or click to insert' : 'Click Edit Template to modify'}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <Textarea
                  ref={emailContentRef}
                  value={emailSettings.intro}
                  onChange={(event) => updateEmailSetting('intro', event.target.value)}
                  disabled={!emailTemplateEditing}
                  className="min-h-72 font-mono text-xs"
                />
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
                  {emailAction === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                  {emailAction === 'preview' ? 'Previewing' : 'Preview'}
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
            <Button variant="outline" onClick={closeEmailReport}>Close</Button>
            {!emailTemplateEditing ? (
              <Button variant="outline" onClick={startEmailTemplateEdit}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit Template
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={cancelEmailTemplateChanges}>
                  <X className="mr-2 h-4 w-4" />
                  Cancel Changes
                </Button>
                <Button variant="outline" onClick={saveEmailTemplate} disabled={JSON.stringify(emailSettings) === JSON.stringify(savedEmailSettings)}>
                  <Save className="mr-2 h-4 w-4" />
                  Save Template
                </Button>
              </>
            )}
            <Button onClick={() => runEmailReport(false)} disabled={emailBusy}>
              {emailAction === 'send' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {emailAction === 'send' ? 'Sending' : 'Send Email'}
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
