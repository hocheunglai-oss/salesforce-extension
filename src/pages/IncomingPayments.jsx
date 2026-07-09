import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Banknote, Check, Eye, Loader2, Mail, Pencil, RefreshCw, Save, Search, Send, Settings2, ShieldCheck, WalletCards, X } from 'lucide-react';
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
const INTEREST_EMAIL_SETTINGS_KEY = 'salesforce_extension:incoming_payment_interest_email_settings';
const RECEIVABLE_PAYMENTS_TABLE_TOKEN = '{{receivablePaymentsTable}}';
const BUYER_CIA_TABLE_TOKEN = '{{buyerCiaInvoicesTable}}';
const INTEREST_CALCULATION_TABLE_TOKEN = '{{interestCalculationTable}}';
const STEM_LINK_TOKEN = '{{stemLink}}';
const INTEREST_STEM_LINK_TOKEN_PATTERN = /\{\{\s*stemLink\s*\}\}/i;
const INCOMING_EMAIL_STEPS = ['Review report', 'Review recipients', 'Email preview'];
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

const DEFAULT_INTEREST_EMAIL_SETTINGS = {
  to: 'louisa@cosulich.com.hk',
  cc: '{{requesterEmail}}',
  bcc: '',
  subject: 'Late Payment Interest Invoice Request - {{stemName}}',
  body: `Late Payment Interest Invoice Request

{{requestedBy}} is requesting Louisa to issue a late payment interest invoice for the following delayed buyer payment.

Buyer: {{buyerName}}
Group: {{buyerGroupName}}
STEM: {{stemName}}
${STEM_LINK_TOKEN}
Payment: {{paymentName}}
Received date: {{receivedDate}}
Payment terms delay: {{delayDays}}
Payment amount: {{paymentAmount}}
Receivable balance: {{receivableBalance}}
Calculated interest total: {{interestTotal}}

${INTEREST_CALCULATION_TABLE_TOKEN}`,
};

const EMAIL_TABLE_TOKENS = [
  { label: 'Incoming Total', token: '{{incomingTotal}}' },
  { label: 'Buyer Payments', token: '{{buyerPaymentTotal}}' },
  { label: 'Supplier Refunds', token: '{{supplierRefundTotal}}' },
  { label: 'Incoming Records', token: '{{receivablePaymentCount}}' },
  { label: 'Needs Review', token: '{{needsReviewCount}}' },
  { label: 'Late Payment Interest Invoice', token: '{{requestLatePaymentInterestInvoiceLink}}' },
  { label: 'Receivable Payments Table', token: RECEIVABLE_PAYMENTS_TABLE_TOKEN },
  { label: 'Buyer CIA Invoices Table', token: BUYER_CIA_TABLE_TOKEN },
];

const INTEREST_EMAIL_TOKENS = [
  { label: 'Requested By', token: '{{requestedBy}}' },
  { label: 'Requester Email', token: '{{requesterEmail}}' },
  { label: 'Buyer', token: '{{buyerName}}' },
  { label: 'Group', token: '{{buyerGroupName}}' },
  { label: 'STEM', token: '{{stemName}}' },
  { label: 'Link to STEM', token: STEM_LINK_TOKEN },
  { label: 'Payment', token: '{{paymentName}}' },
  { label: 'Received Date', token: '{{receivedDate}}' },
  { label: 'Inserted Date', token: '{{insertedDate}}' },
  { label: 'Delay Days', token: '{{delayDays}}' },
  { label: 'Payment Amount', token: '{{paymentAmount}}' },
  { label: 'Receivable Balance', token: '{{receivableBalance}}' },
  { label: 'Interest Rate', token: '{{interestRate}}' },
  { label: 'Interest Total', token: '{{interestTotal}}' },
  { label: 'Calculation Table', token: INTEREST_CALCULATION_TABLE_TOKEN },
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

function readUrlStemId() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('stemId') || params.get('stem') || null;
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

function readInterestEmailSettings() {
  try {
    const raw = localStorage.getItem(INTEREST_EMAIL_SETTINGS_KEY);
    return raw ? { ...DEFAULT_INTEREST_EMAIL_SETTINGS, ...JSON.parse(raw) } : DEFAULT_INTEREST_EMAIL_SETTINGS;
  } catch {
    return DEFAULT_INTEREST_EMAIL_SETTINGS;
  }
}

function saveInterestEmailSettings(settings) {
  localStorage.setItem(INTEREST_EMAIL_SETTINGS_KEY, JSON.stringify({ ...DEFAULT_INTEREST_EMAIL_SETTINGS, ...settings }));
}

function incomingPaymentSmtpCredentials(from) {
  const internalSettings = readSmtpSettings();
  if (hasUsableSmtpSettings(internalSettings)) {
    return {
      label: 'Internal',
      credentials: {
        method: 'smtp',
        smtp: { ...internalSettings, port: Number(internalSettings.port || 587), from: smtpFromAddress(internalSettings, from) },
      },
    };
  }
  return { label: '', credentials: undefined };
}

function escapeInterestHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderInterestTemplate(value, context) {
  return String(value || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(context, key) ? context[key] : match
  ));
}

function interestContentHtml(content) {
  const blocks = String(content || '').split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block, index) => {
    const html = escapeInterestHtml(block).replaceAll('\n', '<br>');
    if (index === 0) return `<h2 style="margin:0 0 8px;font-size:18px;color:#111827">${html}</h2>`;
    return `<p style="margin:0 0 14px;color:#4b5563">${html}</p>`;
  }).join('');
}

function replaceInterestToken(source, pattern, replacement) {
  return String(source || '')
    .replace(new RegExp(`<p\\b[^>]*>\\s*${pattern.source}\\s*<\\/p>`, 'i'), replacement)
    .replace(pattern, replacement);
}

function interestStemLinkHtml(url) {
  return `<p style="margin:0 0 14px"><a href="${escapeInterestHtml(url)}" style="display:inline-block;border-radius:8px;background:#1f2937;color:#ffffff;text-decoration:none;font-weight:700;padding:9px 13px">Link to STEM</a></p>`;
}

function sampleInterestCalculationHtml() {
  return `
    <div style="margin-top:16px">
      <h3 style="margin:0 0 8px;font-size:15px;color:#111827">Late Payment Interest Calculation</h3>
      <p style="margin:0 0 8px;color:#667085">Formula: Outstanding Balance x Monthly Interest Rate x Overdue Days / 30.</p>
      <table style="border-collapse:collapse;width:100%;max-width:860px;font-size:12px;margin-bottom:12px">
        <tbody>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px;width:210px">Buyer invoice amount</th><td style="padding:5px 8px;font-weight:700">$51,101.00</td></tr>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px">Buyer invoice due date</th><td style="padding:5px 8px">07 Feb 2026</td></tr>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px">Account interest rate</th><td style="padding:5px 8px">2.00% per month</td></tr>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px">Calculated interest total</th><td style="padding:5px 8px;font-size:15px;font-weight:800;color:#1f2937">$374.74</td></tr>
        </tbody>
      </table>
      <table style="border-collapse:collapse;width:100%;max-width:960px;font-size:12px">
        <thead><tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px"><th style="text-align:left;padding:7px 8px">Period</th><th style="text-align:right;padding:7px 8px">Balance</th><th style="text-align:right;padding:7px 8px">Days</th><th style="text-align:left;padding:7px 8px">Formula</th><th style="text-align:right;padding:7px 8px">Interest</th></tr></thead>
        <tbody>
          <tr>
            <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;white-space:nowrap">07 Feb 2026 to 18 Feb 2026</td>
            <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;white-space:nowrap">$51,101.00</td>
            <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;white-space:nowrap">11</td>
            <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px">$51,101.00 x 2.00% per month x 11 / 30</td>
            <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;font-weight:700;white-space:nowrap">$374.74</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function buildInterestPreview(settings) {
  const sampleStemUrl = typeof window === 'undefined'
    ? 'https://salesforce-extension-murex.vercel.app/incoming-payments?stemId=sample'
    : `${window.location.origin}/incoming-payments?stemId=sample`;
  const context = {
    requestedBy: 'Vincent Lee',
    requesterEmail: 'vincent@cosulich.com.hk',
    buyerName: 'KAIYUAN CO LTD',
    buyerGroupName: 'KAIYUAN CO LTD',
    stemName: 'HK2524501T - UDE NOAH - YOSU',
    paymentName: 'Buyer payment - HK2524501T',
    receivedDate: '18 Feb 2026',
    insertedDate: '18 Feb 2026',
    delayDays: '11 Days',
    paymentAmount: '$51,101.00',
    receivableBalance: '$8,714.39',
    interestRate: '2.00% per month',
    interestRateField: 'Late Payment Interest Rate',
    interestTotal: '$374.74',
  };
  const to = renderInterestTemplate(settings.to ?? DEFAULT_INTEREST_EMAIL_SETTINGS.to, context);
  const cc = renderInterestTemplate(settings.cc ?? DEFAULT_INTEREST_EMAIL_SETTINGS.cc, context);
  const bcc = renderInterestTemplate(settings.bcc ?? DEFAULT_INTEREST_EMAIL_SETTINGS.bcc, context);
  const subject = renderInterestTemplate(settings.subject || DEFAULT_INTEREST_EMAIL_SETTINGS.subject, context);
  const body = renderInterestTemplate(settings.body || DEFAULT_INTEREST_EMAIL_SETTINGS.body, context);
  const tokenPattern = /\{\{\s*interestCalculationTable\s*\}\}/i;
  const tokenParagraphPattern = /<p\b[^>]*>\s*\{\{\s*interestCalculationTable\s*\}\}\s*<\/p>/i;
  const htmlContent = replaceInterestToken(
    interestContentHtml(body),
    INTEREST_STEM_LINK_TOKEN_PATTERN,
    interestStemLinkHtml(sampleStemUrl),
  )
    .replace(tokenParagraphPattern, sampleInterestCalculationHtml())
    .replace(tokenPattern, sampleInterestCalculationHtml());
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#1f2937;line-height:1.45">${htmlContent}</div>`;
  return { to, cc, bcc, subject, html };
}

function CompactTableEmptyState({ icon: Icon, title, description }) {
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
      {Icon && <Icon className="h-4 w-4 opacity-60" />}
      <div className="min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
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
  const [selectedStemId, setSelectedStemId] = useState(readUrlStemId);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailStep, setEmailStep] = useState(0);
  const [savedEmailSettings, setSavedEmailSettings] = useState(readEmailSettings);
  const [emailSettings, setEmailSettings] = useState(() => savedEmailSettings);
  const [emailTemplateEditing, setEmailTemplateEditing] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailAction, setEmailAction] = useState('');
  const [emailPreview, setEmailPreview] = useState(null);
  const [emailError, setEmailError] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [interestTemplateOpen, setInterestTemplateOpen] = useState(false);
  const [savedInterestEmailSettings, setSavedInterestEmailSettings] = useState(readInterestEmailSettings);
  const [interestEmailSettings, setInterestEmailSettings] = useState(() => savedInterestEmailSettings);
  const [interestTemplateEditing, setInterestTemplateEditing] = useState(false);
  const [interestPreview, setInterestPreview] = useState(null);
  const [interestTemplateMessage, setInterestTemplateMessage] = useState('');
  const [interestActiveField, setInterestActiveField] = useState('body');
  const [interestRequestLoading, setInterestRequestLoading] = useState({});
  const emailContentRef = useRef(null);
  const interestToRef = useRef(null);
  const interestCcRef = useRef(null);
  const interestBccRef = useRef(null);
  const interestSubjectRef = useRef(null);
  const interestContentRef = useRef(null);

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
  const availableBalanceRows = data?.availableBalances || [];
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

  const sendInterestInvoiceRequest = async (row, { force = false } = {}) => {
    const paymentId = row.paymentId || row.id;
    if (!paymentId) return;
    let forceResend = force;
    if (row.interestInvoiceNotificationSent && !forceResend) {
      const proceed = window.confirm('A late payment interest invoice request has already been sent for this payment. Send another request?');
      if (!proceed) return;
      forceResend = true;
    }
    setInterestRequestLoading((prev) => ({ ...prev, [paymentId]: true }));
    try {
      const delivery = incomingPaymentSmtpCredentials(emailSettings.from || DEFAULT_EMAIL_SETTINGS.from);
      if (!delivery.credentials) {
        toast({
          title: 'Using server email sender',
          description: 'No Internal SMTP sender is saved in this browser. The request will use the server SMTP setting in Vercel.',
        });
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
        invoiceAmount: row.invoiceAmount,
        currency: row.currency,
        receivableBalance: row.receivableBalance,
        from: emailSettings.from || DEFAULT_EMAIL_SETTINGS.from,
        template: readInterestEmailSettings(),
        appUrl: window.location.origin,
        credentials: delivery.credentials,
        force: forceResend,
      });
      if (res.data?.error) {
        toast({ title: 'Interest invoice request failed', description: res.data.error, variant: 'destructive' });
        return;
      }
      markInterestInvoiceRequested(paymentId, res.data?.notification || null);
      const senderNote = delivery.label ? ` using ${delivery.label}` : '';
      toast({
        title: res.data?.resent ? 'Interest invoice request sent again' : 'Interest invoice request sent',
        description: `Louisa and your email have been notified${senderNote}.`,
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
      header: 'Terms',
      headerClassName: 'w-[80px] whitespace-nowrap',
      cellClassName: 'w-[80px] max-w-[80px] whitespace-normal text-xs leading-tight',
      cell: (row) => row.type === 'Buyer Payment' ? row.paymentTerms || '-' : 'N/A',
    },
    {
      id: 'delay',
      header: 'Delay',
      headerClassName: 'w-[70px] whitespace-nowrap text-left',
      cellClassName: 'w-[70px] whitespace-nowrap text-left text-sm tabular-nums',
      cell: (row) => row.type === 'Buyer Payment' ? (row.delayDays == null ? '-' : row.delayDays) : 'N/A',
    },
    {
      id: 'from',
      header: 'From',
      cellClassName: 'max-w-[220px] text-sm',
      cell: (row) => (
        <div className="space-y-1">
          <div className="font-medium text-foreground">{row.partyName || '-'}</div>
          {row.type !== 'Buyer Payment' && <PaymentStatusBadge row={row} />}
          {row.type === 'Buyer Payment' && row.status && !['Partially paid', 'Fully paid'].includes(row.status) && (
            <div className="text-xs font-semibold text-amber-700">{row.status}</div>
          )}
        </div>
      ),
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
            disabled={loadingRequest}
            title={sentLabel}
            className={cn(sent && 'bg-slate-700 text-white hover:bg-slate-800')}
            onClick={(event) => {
              event.stopPropagation();
              sendInterestInvoiceRequest(row);
            }}
          >
            {loadingRequest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            {sent ? 'Request Again' : 'Request'}
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
    setEmailStep(0);
    setEmailOpen(true);
    setEmailPreview(null);
    setEmailError('');
    setEmailMessage('');
  };

  const updateInterestEmailSetting = (field, value) => {
    setInterestEmailSettings((prev) => ({ ...prev, [field]: value }));
  };

  const openInterestTemplate = () => {
    const saved = readInterestEmailSettings();
    setSavedInterestEmailSettings(saved);
    setInterestEmailSettings(saved);
    setInterestTemplateEditing(false);
    setInterestPreview(buildInterestPreview(saved));
    setInterestTemplateMessage('');
    setInterestTemplateOpen(true);
  };

  const closeInterestTemplate = () => {
    if (interestTemplateEditing && JSON.stringify(interestEmailSettings) !== JSON.stringify(savedInterestEmailSettings)) {
      const discard = window.confirm('Discard unsaved late payment interest email template changes?');
      if (!discard) return;
      setInterestEmailSettings(savedInterestEmailSettings);
      setInterestTemplateEditing(false);
    }
    setInterestTemplateOpen(false);
  };

  const startInterestTemplateEdit = () => {
    setSavedInterestEmailSettings(interestEmailSettings);
    setInterestTemplateEditing(true);
    setInterestTemplateMessage('');
  };

  const saveInterestTemplate = () => {
    saveInterestEmailSettings(interestEmailSettings);
    setSavedInterestEmailSettings(interestEmailSettings);
    setInterestTemplateEditing(false);
    setInterestTemplateMessage('Late payment interest request template saved.');
    toast({ title: 'Late payment interest template saved' });
  };

  const cancelInterestTemplateChanges = () => {
    setInterestEmailSettings(savedInterestEmailSettings);
    setInterestTemplateEditing(false);
    setInterestTemplateMessage('');
    setInterestPreview(buildInterestPreview(savedInterestEmailSettings));
  };

  const insertInterestTextToken = (field, token) => {
    const refs = {
      to: interestToRef,
      cc: interestCcRef,
      bcc: interestBccRef,
      subject: interestSubjectRef,
    };
    const target = refs[field]?.current;
    const current = interestEmailSettings[field] || '';
    const start = target?.selectionStart ?? current.length;
    const end = target?.selectionEnd ?? start;
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
    updateInterestEmailSetting(field, next);
    window.requestAnimationFrame(() => {
      target?.focus();
      target?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const insertInterestBodyToken = (token) => {
    if (!interestTemplateEditing) return;
    const target = interestContentRef.current;
    const current = interestEmailSettings.body || '';
    const start = target?.selectionStart ?? current.length;
    const end = target?.selectionEnd ?? start;
    const separatorBefore = start > 0 && !/\s$/.test(current.slice(0, start)) ? '\n\n' : '';
    const separatorAfter = end < current.length && !/^\s/.test(current.slice(end)) ? '\n\n' : '';
    const next = `${current.slice(0, start)}${separatorBefore}${token}${separatorAfter}${current.slice(end)}`;
    updateInterestEmailSetting('body', next);
    window.requestAnimationFrame(() => {
      target?.focus();
      const cursor = start + separatorBefore.length + token.length + separatorAfter.length;
      target?.setSelectionRange(cursor, cursor);
    });
  };

  const insertInterestToken = (token) => {
    if (!interestTemplateEditing) return;
    if (interestActiveField === 'body') insertInterestBodyToken(token);
    else insertInterestTextToken(interestActiveField, token);
  };

  const dropInterestToken = (field, event) => {
    if (!interestTemplateEditing) return;
    event.preventDefault();
    const token = event.dataTransfer.getData('text/plain');
    if (!token) return;
    setInterestActiveField(field);
    if (field === 'body') insertInterestBodyToken(token);
    else insertInterestTextToken(field, token);
  };

  const previewInterestTemplate = () => {
    setInterestPreview(buildInterestPreview(interestEmailSettings));
    setInterestTemplateMessage('Preview generated with a sample buyer payment record.');
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

  const goEmailStep = (step) => {
    const next = Math.max(0, Math.min(step, INCOMING_EMAIL_STEPS.length - 1));
    if (next > 1 && !String(emailSettings.to || '').trim()) {
      const message = 'Enter at least one To recipient before continuing.';
      setEmailError(message);
      setEmailStep(1);
      return;
    }
    setEmailError('');
    setEmailStep(next);
    if (next === INCOMING_EMAIL_STEPS.length - 1) {
      runEmailReport(true);
    }
  };

  const goNextEmailStep = () => goEmailStep(emailStep + 1);
  const goBackEmailStep = () => goEmailStep(emailStep - 1);

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
            <Button variant="outline" onClick={openInterestTemplate}>
              <Pencil className="mr-2 h-4 w-4" />
              Interest Request Template
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
        {visibleBuyerCiaRows.length > 0 ? (
          <div className={cn(visibleBuyerCiaRows.length > 5 ? 'max-h-[360px] overflow-auto' : 'overflow-visible')}>
            <ReorderableDataTable
              tableKey="incoming-payment-cia-invoices"
              columns={ciaColumns}
              rows={visibleBuyerCiaRows}
              rowKey={(row) => row.stemId}
              isReorderEnabled={isAdministrator}
              onRowClick={(row) => row.stemId && setSelectedStemId(row.stemId)}
              rowClassName="hover:bg-muted/40"
            />
          </div>
        ) : (
          <CompactTableEmptyState
            icon={Search}
            title="No unpaid CIA buyer invoices"
            description="No open buyer invoice STEMs with CIA payment terms were found."
          />
        )}
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
            {availableBalanceRows.length > 0 ? (
              <div className={cn(availableBalanceRows.length > 5 ? 'max-h-[360px] overflow-auto' : 'overflow-visible')}>
                <ReorderableDataTable
                  tableKey="incoming-payment-available-balances"
                  columns={availableBalanceColumns}
                  rows={availableBalanceRows}
                  rowKey={(group) => group.buyerGroupName}
                  isReorderEnabled={isAdministrator}
                  rowClassName="hover:bg-muted/40"
                />
              </div>
            ) : (
              <CompactTableEmptyState
                icon={WalletCards}
                title="No available buyer balances"
                description="No linked STEM has Receivable_Balance__c below zero in this payment range."
              />
            )}
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
        <DialogContent className="max-h-[94vh] w-[96vw] max-w-[1500px] gap-0 overflow-hidden p-0 text-slate-950">
          <DialogHeader className="border-b border-slate-200 px-5 py-4 text-left">
            <div className="flex flex-wrap items-start justify-between gap-4 pr-8">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Incoming Payment</p>
                <DialogTitle className="mt-1 text-xl font-semibold text-slate-950">Incoming Payment Report Email</DialogTitle>
                <DialogDescription className="mt-1 text-sm text-slate-500">
                  Uses the current payment-created date range and keyword filter.
                </DialogDescription>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <div><span className="font-semibold text-slate-900">Created:</span> {fmtDate(dateFrom)} to {fmtDate(dateTo)}</div>
                <div className="mt-1"><span className="font-semibold text-slate-900">Keyword:</span> {search || '-'}</div>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[calc(94vh-152px)] overflow-auto px-5 py-4">
            <div className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Receivable payments</div>
                      <div className="mt-1 text-lg font-semibold text-slate-950">{visibleRows.length.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Buyer CIA invoices</div>
                      <div className="mt-1 text-lg font-semibold text-slate-950">{visibleBuyerCiaRows.length.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Incoming total</div>
                      <div className="mt-1 text-lg font-semibold text-slate-950">{fmtMoney(summary.totalIncomingAmount)}</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <div><span className="font-semibold text-slate-900">To:</span> {emailSettings.to || '-'}</div>
                  <div className="mt-1"><span className="font-semibold text-slate-900">CC:</span> {emailSettings.cc || '-'}</div>
                  <div className="mt-1"><span className="font-semibold text-slate-900">BCC:</span> {emailSettings.bcc || '-'}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
                {INCOMING_EMAIL_STEPS.map((step, index) => {
                  const isActive = emailStep === index;
                  const isComplete = index < emailStep;
                  const disabled = emailBusy || (index > 1 && !String(emailSettings.to || '').trim());
                  return (
                    <button
                      key={step}
                      type="button"
                      disabled={disabled}
                      onClick={() => goEmailStep(index)}
                      className={cn(
                        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                        isActive
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : isComplete
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                        disabled && !isActive && 'cursor-not-allowed opacity-50 hover:bg-white',
                      )}
                    >
                      <span className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-full text-[11px]',
                        isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600',
                      )}>
                        {isComplete ? <Check className="h-3 w-3" /> : index + 1}
                      </span>
                      {step}
                    </button>
                  );
                })}
              </div>

              {emailError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {emailError}
                </div>
              )}

              {emailStep === 0 && (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">Review report</h3>
                    <p className="text-xs text-slate-500">The email will use the same filters currently applied on this page.</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Created from</div>
                      <div className="mt-1 text-sm font-semibold text-slate-950">{fmtDate(dateFrom)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Created to</div>
                      <div className="mt-1 text-sm font-semibold text-slate-950">{fmtDate(dateTo)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Keyword</div>
                      <div className="mt-1 truncate text-sm font-semibold text-slate-950">{search || '-'}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Fully paid threshold</div>
                      <div className="mt-1 text-sm font-semibold text-slate-950">{fmtMoney(threshold)}</div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-sm font-semibold text-slate-950">Report tables</div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="text-sm font-medium text-slate-900">Receivable Payments</div>
                        <div className="mt-1 text-xs text-slate-500">{visibleRows.length.toLocaleString()} rows matched by current filters.</div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="text-sm font-medium text-slate-900">Buyer CIA Invoices</div>
                        <div className="mt-1 text-xs text-slate-500">{visibleBuyerCiaRows.length.toLocaleString()} rows matched by current filters.</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {emailStep === 1 && (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">Review recipients</h3>
                    <p className="text-xs text-slate-500">Only the addresses shown here will be used for this send.</p>
                  </div>
                  <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-2">
                    <div className="space-y-1.5 md:col-span-2">
                      <Label className="text-xs text-slate-500">From</Label>
                      <Input value={emailSettings.from} onChange={(event) => updateEmailSetting('from', event.target.value)} />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label className="text-xs text-slate-500">To</Label>
                      <Input value={emailSettings.to} onChange={(event) => updateEmailSetting('to', event.target.value)} placeholder="email@example.com" className={cn(!String(emailSettings.to || '').trim() && 'border-red-300 focus-visible:ring-red-400')} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-500">CC</Label>
                      <Input value={emailSettings.cc} onChange={(event) => updateEmailSetting('cc', event.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-500">BCC</Label>
                      <Input value={emailSettings.bcc} onChange={(event) => updateEmailSetting('bcc', event.target.value)} />
                    </div>
                  </div>
                </div>
              )}

              {emailStep === 2 && (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">Email preview</h3>
                    <p className="text-xs text-slate-500">Edit the saved template when needed, then preview and send.</p>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                      {emailTemplateEditing && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex flex-wrap gap-2">
                            {EMAIL_TABLE_TOKENS.map((item) => (
                              <button
                                key={item.token}
                                type="button"
                                draggable
                                onClick={() => insertEmailToken(item.token)}
                                onDragStart={(event) => {
                                  event.dataTransfer.setData('text/plain', item.token);
                                  event.dataTransfer.effectAllowed = 'copy';
                                }}
                                className="cursor-grab rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                                title="Drag into the template or click to insert"
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                          <p className="mt-2 text-xs text-slate-500">Drag table tokens into the content to move the generated tables.</p>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">Subject</Label>
                        <Input value={emailSettings.subject} onChange={(event) => updateEmailSetting('subject', event.target.value)} disabled={!emailTemplateEditing} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">Email content</Label>
                        <Textarea
                          ref={emailContentRef}
                          value={emailSettings.intro}
                          onChange={(event) => updateEmailSetting('intro', event.target.value)}
                          onDragOver={(event) => emailTemplateEditing && event.preventDefault()}
                          onDrop={(event) => {
                            if (!emailTemplateEditing) return;
                            event.preventDefault();
                            const token = event.dataTransfer.getData('text/plain');
                            if (token) insertEmailToken(token);
                          }}
                          disabled={!emailTemplateEditing}
                          className="min-h-[360px] font-mono text-xs"
                        />
                        <p className="text-xs text-slate-500">
                          Table tokens: <span className="font-mono">{RECEIVABLE_PAYMENTS_TABLE_TOKEN}</span> and <span className="font-mono">{BUYER_CIA_TABLE_TOKEN}</span>
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white">
                      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-3 py-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-950">Preview</div>
                          <div className="mt-1 grid gap-1 text-xs text-slate-500">
                            <div><span className="font-semibold text-slate-900">To:</span> {emailSettings.to || '-'}</div>
                            <div><span className="font-semibold text-slate-900">CC:</span> {emailSettings.cc || '-'}</div>
                            <div><span className="font-semibold text-slate-900">BCC:</span> {emailSettings.bcc || '-'}</div>
                            <div><span className="font-semibold text-slate-900">Subject:</span> {emailPreview?.subject || emailSettings.subject || '-'}</div>
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => runEmailReport(true)} disabled={emailBusy}>
                          {emailAction === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                          {emailAction === 'preview' ? 'Previewing' : 'Preview'}
                        </Button>
                      </div>
                      <div className="max-h-[58vh] overflow-auto p-4">
                        {emailPreview?.html ? (
                          <div
                            className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-900"
                            dangerouslySetInnerHTML={{ __html: emailPreview.html }}
                          />
                        ) : (
                          <div className="flex h-[360px] items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-500">
                            Generate a preview before sending.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {emailMessage && !emailError && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                      {emailMessage}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-slate-50 px-5 py-3">
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-h-9 flex-1">
                {emailError && (
                  <div className="inline-flex max-w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {emailError}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {emailStep === INCOMING_EMAIL_STEPS.length - 1 && (
                  !emailTemplateEditing ? (
                    <Button type="button" variant="outline" onClick={startEmailTemplateEdit} disabled={emailBusy}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit Template
                    </Button>
                  ) : (
                    <>
                      <Button type="button" variant="outline" onClick={cancelEmailTemplateChanges} disabled={emailBusy}>
                        <X className="mr-2 h-4 w-4" />
                        Cancel
                      </Button>
                      <Button type="button" variant="outline" onClick={saveEmailTemplate} disabled={emailBusy || JSON.stringify(emailSettings) === JSON.stringify(savedEmailSettings)}>
                        <Save className="mr-2 h-4 w-4" />
                        Save Template
                      </Button>
                    </>
                  )
                )}
                <Button type="button" variant="outline" onClick={closeEmailReport} disabled={emailBusy}>Close</Button>
                {emailStep > 0 && (
                  <Button type="button" variant="outline" onClick={goBackEmailStep} disabled={emailBusy}>Back</Button>
                )}
                {emailStep < INCOMING_EMAIL_STEPS.length - 1 && (
                  <Button type="button" onClick={goNextEmailStep} disabled={emailBusy}>
                    Next
                  </Button>
                )}
                {emailStep === INCOMING_EMAIL_STEPS.length - 1 && (
                  <Button type="button" onClick={() => runEmailReport(false)} disabled={emailBusy}>
                    {emailAction === 'send' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    {emailAction === 'send' ? 'Sending' : 'Send Email'}
                  </Button>
                )}
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={interestTemplateOpen} onOpenChange={(open) => (open ? setInterestTemplateOpen(true) : closeInterestTemplate())}>
        <DialogContent className="max-h-[92vh] w-[96vw] max-w-[1400px] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Late Payment Interest Request Email</DialogTitle>
            <DialogDescription>
              Template used by the row-level Request button. Delivery uses the Internal sender in Settings.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[70vh] gap-4 overflow-hidden pr-1 lg:grid-cols-[430px_minmax(0,1fr)]">
            <div className="space-y-3 overflow-auto pr-1">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    ref={interestToRef}
                    value={interestEmailSettings.to}
                    onFocus={() => setInterestActiveField('to')}
                    onDragOver={(event) => interestTemplateEditing && event.preventDefault()}
                    onDrop={(event) => dropInterestToken('to', event)}
                    onChange={(event) => updateInterestEmailSetting('to', event.target.value)}
                    disabled={!interestTemplateEditing}
                    placeholder="louisa@cosulich.com.hk"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Cc</Label>
                  <Input
                    ref={interestCcRef}
                    value={interestEmailSettings.cc}
                    onFocus={() => setInterestActiveField('cc')}
                    onDragOver={(event) => interestTemplateEditing && event.preventDefault()}
                    onDrop={(event) => dropInterestToken('cc', event)}
                    onChange={(event) => updateInterestEmailSetting('cc', event.target.value)}
                    disabled={!interestTemplateEditing}
                    placeholder="{{requesterEmail}}"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Bcc</Label>
                  <Input
                    ref={interestBccRef}
                    value={interestEmailSettings.bcc}
                    onFocus={() => setInterestActiveField('bcc')}
                    onDragOver={(event) => interestTemplateEditing && event.preventDefault()}
                    onDrop={(event) => dropInterestToken('bcc', event)}
                    onChange={(event) => updateInterestEmailSetting('bcc', event.target.value)}
                    disabled={!interestTemplateEditing}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs text-muted-foreground">Subject</Label>
                  <Input
                    ref={interestSubjectRef}
                    value={interestEmailSettings.subject}
                    onFocus={() => setInterestActiveField('subject')}
                    onDragOver={(event) => interestTemplateEditing && event.preventDefault()}
                    onDrop={(event) => dropInterestToken('subject', event)}
                    onChange={(event) => updateInterestEmailSetting('subject', event.target.value)}
                    disabled={!interestTemplateEditing}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-2">
                  {INTEREST_EMAIL_TOKENS.map((item) => (
                    <button
                      key={item.token}
                      type="button"
                      draggable={interestTemplateEditing}
                      disabled={!interestTemplateEditing}
                      onClick={() => insertInterestToken(item.token)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', item.token);
                        event.dataTransfer.effectAllowed = 'copy';
                      }}
                      className={cn(
                        'rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-foreground transition-colors',
                        interestTemplateEditing ? 'cursor-grab hover:bg-muted/70' : 'cursor-not-allowed opacity-50',
                      )}
                      title={interestTemplateEditing ? 'Drag into the template or click to insert' : 'Click Edit Template to modify'}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <Textarea
                  ref={interestContentRef}
                  value={interestEmailSettings.body}
                  onFocus={() => setInterestActiveField('body')}
                  onChange={(event) => updateInterestEmailSetting('body', event.target.value)}
                  disabled={!interestTemplateEditing}
                  className="min-h-80 font-mono text-xs"
                  onDragOver={(event) => interestTemplateEditing && event.preventDefault()}
                  onDrop={(event) => dropInterestToken('body', event)}
                />
                <p className="text-xs text-muted-foreground">
                  Place <span className="font-mono">{INTEREST_CALCULATION_TABLE_TOKEN}</span> where the calculation table should appear.
                </p>
              </div>
              {interestTemplateMessage && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  {interestTemplateMessage}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div>
                  <div className="text-sm font-semibold text-foreground">Preview</div>
                  <div className="space-y-0.5 text-xs text-muted-foreground">
                    {interestPreview?.subject ? (
                      <>
                        <div>To: {interestPreview.to || '-'}</div>
                        <div>Cc: {interestPreview.cc || '-'}</div>
                        {interestPreview.bcc ? <div>Bcc: {interestPreview.bcc}</div> : null}
                        <div>Subject: {interestPreview.subject}</div>
                      </>
                    ) : 'Generate a preview with the sample payment record.'}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={previewInterestTemplate}>
                  <Eye className="mr-2 h-4 w-4" />
                  Preview
                </Button>
              </div>
              <div className="h-[520px] overflow-auto p-4">
                {interestPreview?.html ? (
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: interestPreview.html }}
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
            <Button variant="outline" onClick={closeInterestTemplate}>Close</Button>
            {!interestTemplateEditing ? (
              <Button variant="outline" onClick={startInterestTemplateEdit}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit Template
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={cancelInterestTemplateChanges}>
                  <X className="mr-2 h-4 w-4" />
                  Cancel Changes
                </Button>
                <Button variant="outline" onClick={saveInterestTemplate} disabled={JSON.stringify(interestEmailSettings) === JSON.stringify(savedInterestEmailSettings)}>
                  <Save className="mr-2 h-4 w-4" />
                  Save Template
                </Button>
              </>
            )}
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
