import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CalendarClock, Check, Copy, Eye, Loader2, Mail, MessageSquareText, RefreshCw, ReceiptText, Save, Send, X } from 'lucide-react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import DraftNotice from '@/components/common/DraftNotice';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  hasUsableSmtpSettings,
  readPaymentReminderSmtpSettings,
  readSmtpSettings,
  smtpFromAddress,
} from '@/lib/smtpSettings';
import { numericValue, textValue } from '@/lib/displayValue';
import { cn } from '@/lib/utils';
import { clearDraft, readDraft, sameDraftValue, useDraftAutosave } from '@/lib/draftAutosave';

const EMAIL_SETTINGS_KEY = 'salesforce_extension:buyer_invoice_email_settings';
const INVOICE_TABLE_TOKEN = '{{invoiceTable}}';
const OLD_DEFAULT_EMAIL_INTRO = 'Please find below the latest overdue buyer invoices and buyer invoices due soon.';
const COLLECTION_STATUSES = ['Not Started', 'Reminder Sent', 'Awaiting Buyer Reply', 'Promise to Pay', 'Escalated', 'Paid / Closed', 'On Hold'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const HONG_KONG_TIME_ZONE = 'Asia/Hong_Kong';
const HONG_KONG_TIME_LABEL = 'HKT (GMT+8)';
const DEFAULT_EMAIL_SETTINGS = {
  enabled: true,
  from: 'Fratelli Cosulich <info@cosulich.com.hk>',
  to: 'bt@cosulich.com.hk',
  cc: 'lousia@cosulich.com.hk, laureen@cosulich.com.hk',
  daysAhead: 7,
  subject: 'Outstanding Buyer Invoices Report',
  intro: 'Outstanding Buyer Invoices\n\nPlease find below the latest overdue buyer invoices and buyer invoices due in {{daysAhead}} days.\n\nReport window: {{reportStart}} to {{reportEnd}}. Overdue invoices are always included.',
  includeSummary: true,
  includeTable: true,
  weekdays: WEEKDAYS,
  sendTimes: '08:00, 14:00',
  paymentReminderRecipientFieldPath: '',
  paymentReminderCc: '',
  paymentReminderBcc: '',
  paymentReminderSubject: 'Payment Reminder - {{buyerName}} - Outstanding Buyer Invoices',
  paymentReminderBody: `<p>Dear {{buyerName}},</p><p>Please find below the outstanding buyer invoices for your attention.</p><p>${INVOICE_TABLE_TOKEN}</p><p>This reminder includes overdue invoices and invoices due within {{daysAhead}} days. Please arrange payment or let us know the expected payment date.</p><p><strong>Late payment interest warning:</strong> where payment remains overdue, a late payment interest charge of <strong>2.00% per month</strong> may apply.</p><p>Regards,<br>Fratelli Cosulich</p>`,
};

const QUILL_MODULES = {
  toolbar: [
    [{ header: [false, 3, 4] }],
    ['bold', 'italic', 'underline'],
    [{ color: [] }, { background: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link'],
    ['clean'],
  ],
};

const PAYMENT_REMINDER_VARIABLE_GROUPS = [
  {
    label: 'Stem',
    variables: [
      { label: 'Stem name', token: '{{stemName}}' },
      { label: 'Key stem', token: '{{keyStem}}' },
      { label: 'Buyer name', token: '{{buyerName}}' },
      { label: 'Buyer group', token: '{{buyerGroupName}}' },
      { label: 'Invoice amount', token: '{{invoiceAmount}}' },
      { label: 'Receivable balance', token: '{{receivableBalance}}' },
      { label: 'Due date', token: '{{buyerInvoiceDueDate}}' },
      { label: 'Buyer trader', token: '{{buyerTraderInCharge}}' },
      { label: 'Account emails', token: '{{buyerAccountsEmail}}' },
      { label: 'Trader emails', token: '{{buyerTraderEmail}}' },
      { label: 'Payment handler', token: '{{paymentHandlerName}}' },
      { label: 'Payment handler email', token: '{{paymentHandlerEmail}}' },
      { label: 'To recipients', token: '{{toRecipients}}' },
      { label: 'PSPRS status', token: '{{psprsStatus}}' },
      { label: 'Invoice status', token: '{{invoiceStatus}}' },
      { label: 'Overdue', token: '{{overdue}}' },
      { label: 'Invoice table', token: INVOICE_TABLE_TOKEN },
    ],
  },
  {
    label: 'Reminder',
    variables: [
      { label: 'Due days', token: '{{daysAhead}}' },
      { label: 'Today', token: '{{today}}' },
      { label: 'Due through', token: '{{dueThrough}}' },
      { label: 'Invoice count', token: '{{invoiceCount}}' },
      { label: 'Total receivable', token: '{{totalReceivable}}' },
    ],
  },
];

const COPY_ROW_FIELDS = [
  (row) => row.stemName || '-',
  (row) => row.buyerName || '-',
  (row) => copiedReceivableBalance(row),
  (row) => `Due Date ${fmtDate(row.buyerInvoiceDueDate)}`,
  (row) => overdueCopyStatus(row.daysUntilDue),
];

const fmtMoney = (value) => {
  const number = numericValue(value);
  if (number == null) return '-';
  return `$${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function copiedReceivableBalance(row) {
  const receivable = numericValue(row?.receivableBalance);
  const invoice = numericValue(row?.invoiceAmount);
  const value = fmtMoney(row?.receivableBalance);
  return receivable != null && invoice != null && Math.abs(receivable - invoice) > 0.005
    ? `Balance ${value}`
    : value;
}

function parseDateValue(value) {
  if (!value) return null;
  if (typeof value === 'object' && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hongKongDateKey(value = new Date()) {
  const date = parseDateValue(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HONG_KONG_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

const fmtDate = (value) => {
  if (!value) return '-';
  const date = parseDateValue(value);
  if (!date) return textValue(value);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: HONG_KONG_TIME_ZONE,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  } catch {
    return textValue(value);
  }
};

const fmtDateTime = (value) => {
  if (!value) return '-';
  const date = parseDateValue(value);
  if (!date) return textValue(value);
  try {
    const label = new Intl.DateTimeFormat('en-GB', {
      timeZone: HONG_KONG_TIME_ZONE,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
    return `${label} ${HONG_KONG_TIME_LABEL}`;
  } catch {
    return textValue(value);
  }
};

function splitBuyerTraderNames(value) {
  return textValue(value, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function arrayToInput(value) {
  return Array.isArray(value) ? value.join(', ') : textValue(value, '');
}

function richTemplateValue(value) {
  const raw = textValue(value, '');
  if (!raw) return DEFAULT_EMAIL_SETTINGS.paymentReminderBody;
  if (/<\/?[a-z][\s\S]*>/i.test(raw)) return raw;
  return raw
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

function sanitizePreviewHtml(value) {
  return textValue(value, '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

function previewPlainText(value) {
  return textValue(value, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeReminderPreviewHtml(value) {
  const html = sanitizePreviewHtml(richTemplateValue(value));
  const matches = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  const paragraphs = matches.length ? matches.map((match) => match[1]) : [html];
  return paragraphs
    .map((inner) => inner.trim())
    .filter((inner) => previewPlainText(inner))
    .map((inner) => {
      const text = previewPlainText(inner).replace(/\s+/g, ' ').trim().toLowerCase();
      let margin = '0 0 12px';
      if (/^to\s+/.test(text)) margin = '0 0 3px';
      else if (/^attn\b/.test(text)) margin = '0 0 18px';
      else if (/^regards,?/.test(text)) margin = '24px 0 3px';
      else if (/^fratelli\s+cosulich/.test(text)) margin = '0';
      return `<p style="margin:${margin};padding:0;line-height:1.35;text-align:left">${inner}</p>`;
    })
    .join('');
}

function invoiceTableMarkerHtml(count) {
  return `
    <div style="margin:12px 0;padding:10px 12px;border:1px dashed #2563eb;border-radius:8px;background:#eff6ff;color:#1d4ed8;font-size:13px;font-weight:600">
      Outstanding invoice table inserted here (${Number(count || 0).toLocaleString()} invoices)
    </div>`;
}

function emailBodyPreviewHtml(body, selectedCount) {
  const html = normalizeReminderPreviewHtml(body);
  const marker = invoiceTableMarkerHtml(selectedCount);
  const tokenPattern = /\{\{\s*invoiceTable\s*\}\}/i;
  if (tokenPattern.test(html)) {
    return html
      .replace(new RegExp(`<p\\b[^>]*>\\s*${tokenPattern.source}\\s*<\\/p>`, 'i'), marker)
      .replace(tokenPattern, marker);
  }
  const match = /for your attention\./i.exec(html);
  if (!match) return `${html}${marker}`;
  const afterMarker = match.index + match[0].length;
  const rest = html.slice(afterMarker);
  const paragraphClose = /<\/p>/i.exec(rest);
  if (paragraphClose && paragraphClose.index < 300) {
    const insertAt = afterMarker + paragraphClose.index + paragraphClose[0].length;
    return `${html.slice(0, insertAt)}${marker}${html.slice(insertAt)}`;
  }
  return `${html.slice(0, afterMarker)}${marker}${html.slice(afterMarker)}`;
}

function removeInvoiceTableTokenHtml(value) {
  const tokenPattern = /\{\{\s*invoiceTable\s*\}\}/gi;
  return textValue(value, '')
    .replace(new RegExp(`<p\\b[^>]*>\\s*${tokenPattern.source}\\s*<\\/p>`, 'gi'), '')
    .replace(tokenPattern, '');
}

function insertTokenIntoQuill(editor, token) {
  const range = editor.getSelection(true);
  let index = range?.index ?? editor.getLength();
  if (token === INVOICE_TABLE_TOKEN) {
    const text = editor.getText();
    const matches = [...text.matchAll(/\{\{\s*invoiceTable\s*\}\}/gi)];
    for (const match of matches.reverse()) {
      editor.deleteText(match.index, match[0].length);
      if (match.index < index) index -= match[0].length;
    }
  }
  editor.insertText(Math.max(0, index), token);
  editor.setSelection(Math.max(0, index) + token.length, 0);
}

function emailSettingsToForm(settings = DEFAULT_EMAIL_SETTINGS) {
  const merged = { ...DEFAULT_EMAIL_SETTINGS, ...settings };
  if (String(merged.from || '').includes('admin@fcuno.com')) merged.from = DEFAULT_EMAIL_SETTINGS.from;
  if (!merged.intro || merged.intro === OLD_DEFAULT_EMAIL_INTRO) merged.intro = DEFAULT_EMAIL_SETTINGS.intro;
  return {
    ...merged,
    to: arrayToInput(merged.to),
    cc: arrayToInput(merged.cc),
    sendTimes: arrayToInput(merged.sendTimes),
    weekdays: Array.isArray(merged.weekdays) ? merged.weekdays : WEEKDAYS,
    paymentReminderCc: arrayToInput(merged.paymentReminderCc),
    paymentReminderBcc: arrayToInput(merged.paymentReminderBcc),
    paymentReminderBody: richTemplateValue(merged.paymentReminderBody),
  };
}

function readLegacyEmailSettings() {
  try {
    const raw = localStorage.getItem(EMAIL_SETTINGS_KEY);
    return emailSettingsToForm(raw ? JSON.parse(raw) : DEFAULT_EMAIL_SETTINGS);
  } catch {
    return emailSettingsToForm(DEFAULT_EMAIL_SETTINGS);
  }
}

function sameSettings(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function SummaryCard({ label, value, tone = 'default' }) {
  const toneClass = {
    default: 'text-foreground',
    red: 'text-red-600',
    blue: 'text-blue-600',
    green: 'text-emerald-600',
    amber: 'text-amber-700',
  }[tone];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-dm text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function PaymentReminderVariablePalette({ onInsert }) {
  const [copiedToken, setCopiedToken] = useState(null);

  const copyToken = async (token) => {
    try {
      await navigator.clipboard?.writeText(token);
      setCopiedToken(token);
      window.setTimeout(() => setCopiedToken((current) => (current === token ? null : current)), 1200);
    } catch {
      onInsert(token);
    }
  };

  return (
    <div className="space-y-3">
      {PAYMENT_REMINDER_VARIABLE_GROUPS.map((group) => (
        <div key={group.label} className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label} variables</div>
          <div className="flex flex-wrap gap-1.5">
            {group.variables.map((variable) => (
              <div key={variable.token} className="inline-flex overflow-hidden rounded-md border border-border bg-muted/50">
                <button
                  type="button"
                  draggable
                  onClick={() => onInsert(variable.token)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', variable.token);
                    event.dataTransfer.setData('application/x-template-variable', variable.token);
                  }}
                  className="px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  title={`Insert ${variable.token}`}
                >
                  {variable.label}
                </button>
                <button
                  type="button"
                  onClick={() => copyToken(variable.token)}
                  className="border-l border-border px-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  title={`Copy ${variable.token}`}
                  aria-label={`Copy ${variable.label} variable`}
                >
                  {copiedToken === variable.token ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function overdueSeverity(daysUntilDue) {
  if (daysUntilDue == null || Number(daysUntilDue) > 0) return null;
  const overdueDays = Math.abs(Number(daysUntilDue));
  if (overdueDays >= 14) return 'red';
  if (overdueDays >= 7) return 'orange';
  return 'yellow';
}

function rowSeverityClass(row, idx) {
  if (row.prpspStatus === 'Conditional-Not Sent') return 'bg-purple-200 hover:bg-purple-300/80';
  const severity = overdueSeverity(row.daysUntilDue);
  if (severity === 'red') return 'bg-red-100 hover:bg-red-200/80';
  if (severity === 'orange') return 'bg-orange-200 hover:bg-orange-300/80';
  if (severity === 'yellow') return 'bg-yellow-200 hover:bg-yellow-300/80';
  return `${idx % 2 ? 'bg-muted/10' : ''} hover:bg-muted/30`;
}

function dueTextClass(daysUntilDue) {
  const severity = overdueSeverity(daysUntilDue);
  if (severity === 'red') return 'text-red-700';
  if (severity === 'orange') return 'text-orange-700';
  if (severity === 'yellow') return 'text-yellow-700';
  return 'text-foreground';
}

function statusPill(status, daysUntilDue) {
  const severity = overdueSeverity(daysUntilDue);
  if (severity === 'red') return 'bg-red-200 text-red-900 border-red-300';
  if (severity === 'orange') return 'bg-orange-300 text-orange-950 border-orange-400';
  if (severity === 'yellow') return 'bg-yellow-300 text-yellow-950 border-yellow-400';
  if (status === 'Overdue') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

function collectionPill(status) {
  if (status === 'Escalated') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'Promise to Pay') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'Reminder Sent' || status === 'Awaiting Buyer Reply') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'On Hold') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'Paid / Closed') return 'bg-muted text-muted-foreground border-border';
  return 'bg-background text-foreground border-border';
}

function isPaymentReminderSentEvent(event) {
  return /^Payment reminder sent\b/i.test(textValue(event?.note, ''));
}

function latestPaymentReminderSentEvent(row) {
  const events = Array.isArray(row?.collectionEvents) ? row.collectionEvents : [];
  return events
    .filter(isPaymentReminderSentEvent)
    .filter((event) => event.createdAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

function latestPaymentReminderSentAt(row) {
  return latestPaymentReminderSentEvent(row)?.createdAt || null;
}

function wasPaymentReminderSentToday(row, todayKey = hongKongDateKey()) {
  const sentAt = latestPaymentReminderSentAt(row);
  return Boolean(sentAt && hongKongDateKey(sentAt) === todayKey);
}

function overdueDisplayValue(daysUntilDue) {
  if (daysUntilDue == null) return '-';
  const overdue = -Number(daysUntilDue);
  const value = Object.is(overdue, -0) ? 0 : overdue;
  return `${value.toLocaleString()} Days`;
}

function overdueCopyStatus(daysUntilDue) {
  if (daysUntilDue == null) return '-';
  const days = Number(daysUntilDue);
  if (!Number.isFinite(days)) return '-';
  if (days <= 0) {
    const overdueDays = Object.is(-days, -0) ? 0 : Math.abs(days);
    return `Overdue ${overdueDays.toLocaleString()} Days`;
  }
  return 'Due Soon';
}

function copyCell(value) {
  return textValue(value, '-').replace(/\s+/g, ' ').trim() || '-';
}

function escapeHtml(value) {
  return copyCell(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function invoiceRecordPlainText(row) {
  return COPY_ROW_FIELDS.map((getValue) => copyCell(getValue(row))).join(' - ').toUpperCase();
}

function invoiceRecordHtml(row) {
  return `<div style="font-family:Arial,sans-serif;font-size:12px;color:#111827;">${escapeHtml(invoiceRecordPlainText(row))}</div>`;
}

async function writeClipboardTable({ html, text }) {
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ]);
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function readInitialFilters() {
  if (typeof window === 'undefined') return { daysAhead: 7, buyerTraders: [], hasBuyerTraderFilter: false };
  const params = new URLSearchParams(window.location.search);
  const daysAhead = Math.max(0, Math.min(Number(params.get('daysAhead')) || 7, 365));
  const buyerTraders = [
    ...params.getAll('buyerTrader'),
    ...params.getAll('buyerTraders'),
    ...params.getAll('trader'),
  ].flatMap((value) => splitBuyerTraderNames(value));
  return {
    daysAhead,
    buyerTraders,
    hasBuyerTraderFilter: buyerTraders.length > 0,
  };
}

function collectionStatus(row) {
  return row.collection?.status || 'Not Started';
}

function defaultCollectionOwner(row) {
  return splitBuyerTraderNames(row?.buyerTraderInCharge)[0] || '';
}

function collectionOwner(row) {
  return row.collection?.ownerName || defaultCollectionOwner(row);
}

function isFollowUpDue(row, today) {
  const date = row.collection?.nextFollowUpDate;
  return Boolean(date && date <= today && collectionStatus(row) !== 'Paid / Closed');
}

function isNeedsAction(row, today) {
  return row.status === 'Overdue' || isFollowUpDue(row, today);
}

function uniqueNames(values) {
  return [...new Set(values.map((value) => textValue(value, '').trim()).filter(Boolean))];
}

function CollectionModal({ row, open, onClose, onSaved, ownerOptions = [] }) {
  const draftKey = row?.stemId ? `buyer-invoices:collection:${row.stemId}` : null;
  const [form, setForm] = useState({
    status: 'Not Started',
    ownerName: '',
    latestNote: '',
    nextFollowUpDate: '',
    promisedPaymentDate: '',
    promisedAmount: '',
  });
  const [baseForm, setBaseForm] = useState(null);
  const [restoredAt, setRestoredAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const rowTraderOptions = useMemo(() => splitBuyerTraderNames(row?.buyerTraderInCharge), [row?.buyerTraderInCharge]);
  const ownerChoices = useMemo(() => uniqueNames([
    ...rowTraderOptions,
    ...ownerOptions,
  ]), [ownerOptions, rowTraderOptions]);

  useEffect(() => {
    if (!row) return;
    const existingHandler = row.collection?.ownerName || '';
    const nextBase = {
      status: collectionStatus(row),
      ownerName: ownerChoices.includes(existingHandler) ? existingHandler : rowTraderOptions[0] || ownerOptions[0] || '',
      latestNote: row.collection?.latestNote || '',
      nextFollowUpDate: row.collection?.nextFollowUpDate || '',
      promisedPaymentDate: row.collection?.promisedPaymentDate || '',
      promisedAmount: row.collection?.promisedAmount ?? '',
    };
    const draft = readDraft(draftKey);
    const nextForm = draft?.data && !sameDraftValue(draft.data, nextBase)
      ? { ...nextBase, ...draft.data }
      : nextBase;
    setBaseForm(nextBase);
    setForm(nextForm);
    setRestoredAt(draft?.data && !sameDraftValue(draft.data, nextBase) ? draft.updatedAt : null);
    setError(null);
  }, [draftKey, ownerChoices, ownerOptions, row, rowTraderOptions]);

  const formDirty = Boolean(baseForm && !sameDraftValue(form, baseForm));
  useDraftAutosave(draftKey, form, {
    enabled: open && Boolean(row),
    dirty: formDirty,
    message: 'Autosaved collection follow-up draft. Save or discard it before leaving.',
  });

  if (!open || !row) return null;

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const discardDraft = () => {
    clearDraft(draftKey);
    if (baseForm) setForm(baseForm);
    setRestoredAt(null);
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await appClient.functions.invoke('buyerInvoiceCollectionSave', {
      stemId: row.stemId,
      updates: form,
    });
    if (res.data?.error) {
      setError(res.data.error);
    } else {
      clearDraft(draftKey);
      appClient.functions.clearCache();
      onSaved(res.data);
      onClose();
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Collection follow-up</p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{row.stemName}</h2>
            <p className="text-sm text-muted-foreground">{row.buyerName || '-'}</p>
          </div>
          <Button variant="outline" size="icon" onClick={onClose} disabled={saving}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid max-h-[calc(90vh-76px)] gap-4 overflow-auto p-4 lg:grid-cols-[1fr_0.9fr]">
          <div className="space-y-4">
            <DraftNotice restoredAt={restoredAt} label="Collection draft restored" onDiscard={discardDraft} />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Collection Status</Label>
                <select
                  value={form.status}
                  onChange={(event) => update('status', event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {COLLECTION_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Payment Handler</Label>
                <select
                  value={form.ownerName}
                  onChange={(event) => update('ownerName', event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {!ownerChoices.length && <option value="">No buyer trader assigned</option>}
                  {ownerChoices.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Next Follow-up Date</Label>
                <Input type="date" value={form.nextFollowUpDate} onChange={(event) => update('nextFollowUpDate', event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Promised Payment Date</Label>
                <Input type="date" value={form.promisedPaymentDate} onChange={(event) => update('promisedPaymentDate', event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Promised Amount</Label>
                <Input type="number" min="0" step="0.01" value={form.promisedAmount} onChange={(event) => update('promisedAmount', event.target.value)} />
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                <div><span className="font-semibold text-foreground">Due:</span> {fmtDate(row.buyerInvoiceDueDate)}</div>
                <div><span className="font-semibold text-foreground">Receivable:</span> {fmtMoney(row.receivableBalance)}</div>
                <div><span className="font-semibold text-foreground">PSPRS:</span> {row.prpspStatus || '-'}</div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Latest Note</Label>
              <Textarea value={form.latestNote} onChange={(event) => update('latestNote', event.target.value)} className="min-h-32" placeholder="Add the latest follow-up note..." />
            </div>
            {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-background/50">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">History</h3>
              <p className="text-xs text-muted-foreground">Status, note, payment handler, follow-up, and promise changes.</p>
            </div>
            <div className="max-h-[58vh] overflow-auto p-3">
              {(row.collectionEvents || []).length ? (
                <div className="space-y-2">
                  {row.collectionEvents.map((event) => (
                    <div key={event.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-medium text-foreground">{event.status || event.eventType}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(event.createdAt)}</span>
                      </div>
                      {event.note && <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{event.note}</p>}
                      <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                        {event.ownerName && <span>Payment Handler: {event.ownerName}</span>}
                        {event.nextFollowUpDate && <span>Next follow-up: {fmtDate(event.nextFollowUpDate)}</span>}
                        {event.promisedPaymentDate && <span>Promise date: {fmtDate(event.promisedPaymentDate)}</span>}
                        {event.promisedAmount != null && <span>Promise amount: {fmtMoney(event.promisedAmount)}</span>}
                        {event.actorEmail && <span>Updated by: {event.actorEmail}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <StateBlock title="No collection history" description="Save a status or note to create the first collection history entry." />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentReminderModal({ row, open, daysAhead, onClose, onSent }) {
  const draftKey = row?.stemId ? `buyer-invoices:payment-reminder:${row.stemId}:${daysAhead}` : null;
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const reminderBodyEditorRef = useRef(null);
  const [form, setForm] = useState({
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
  });
  const [baseDraftValue, setBaseDraftValue] = useState(null);
  const [restoredAt, setRestoredAt] = useState(null);

  useEffect(() => {
    if (!open || !row) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const res = await appClient.functions.invoke('buyerInvoicePaymentReminderPrepare', {
        stemId: row.stemId,
        daysAhead,
      });
      if (cancelled) return;
      if (res.data?.error) {
        setError(res.data.error);
        setData(null);
      } else {
        const candidates = res.data.candidates || [];
        const baseForm = {
          to: arrayToInput(res.data.to || []),
          cc: arrayToInput(res.data.cc || []),
          bcc: arrayToInput(res.data.bcc || []),
          subject: res.data.subject || '',
          body: richTemplateValue(res.data.body || ''),
        };
        const baseSelectedIds = candidates.map((candidate) => candidate.stemId);
        const draft = readDraft(draftKey);
        const candidateIds = new Set(baseSelectedIds);
        const draftSelectedIds = Array.isArray(draft?.data?.selectedIds)
          ? draft.data.selectedIds.filter((id) => candidateIds.has(id))
          : baseSelectedIds;
        const nextForm = draft?.data?.form ? { ...baseForm, ...draft.data.form } : baseForm;
        setData(res.data);
        setSelectedIds(draftSelectedIds.length ? draftSelectedIds : baseSelectedIds);
        setForm(nextForm);
        const nextBaseDraftValue = { form: baseForm, selectedIds: baseSelectedIds };
        const nextDraftValue = { form: nextForm, selectedIds: draftSelectedIds.length ? draftSelectedIds : baseSelectedIds };
        setBaseDraftValue(nextBaseDraftValue);
        setRestoredAt(draft?.data && !sameDraftValue(draft.data, nextBaseDraftValue) && !sameDraftValue(draft.data, nextDraftValue) ? draft.updatedAt : draft?.data && !sameDraftValue(nextDraftValue, nextBaseDraftValue) ? draft.updatedAt : null);
      }
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [daysAhead, draftKey, open, row]);

  const candidates = data?.candidates || [];
  const selectedRows = useMemo(() => {
    const selected = new Set(selectedIds);
    return candidates.filter((candidate) => selected.has(candidate.stemId));
  }, [candidates, selectedIds]);
  const selectedReceivable = useMemo(() => (
    selectedRows.reduce((sum, candidate) => sum + Number(candidate.receivableBalance || 0), 0)
  ), [selectedRows]);
  const reminderHistoryRow = data?.selected || candidates.find((candidate) => candidate.stemId === row?.stemId) || row;
  const lastReminderSentAt = latestPaymentReminderSentAt(reminderHistoryRow) || latestPaymentReminderSentAt(row);
  const lastReminderSentToday = wasPaymentReminderSentToday(reminderHistoryRow) || wasPaymentReminderSentToday(row);
  const currentDraftValue = useMemo(() => ({ form, selectedIds }), [form, selectedIds]);
  const reminderDirty = Boolean(baseDraftValue && !sameDraftValue(currentDraftValue, baseDraftValue));
  useDraftAutosave(draftKey, currentDraftValue, {
    enabled: open && Boolean(row) && !loading,
    dirty: reminderDirty,
    message: 'Autosaved payment reminder draft. Send or discard it before leaving.',
  });

  if (!open || !row) return null;

  const updateForm = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const discardDraft = () => {
    clearDraft(draftKey);
    if (baseDraftValue) {
      setForm(baseDraftValue.form);
      setSelectedIds(baseDraftValue.selectedIds);
    }
    setRestoredAt(null);
  };
  const insertInvoiceTableToken = () => {
    const editor = reminderBodyEditorRef.current?.getEditor?.();
    if (!editor) {
      updateForm('body', `${removeInvoiceTableTokenHtml(form.body)}<p>${INVOICE_TABLE_TOKEN}</p>`);
      return;
    }
    insertTokenIntoQuill(editor, INVOICE_TABLE_TOKEN);
  };
  const toggleInvoice = (stemId) => {
    setSelectedIds((prev) => (
      prev.includes(stemId)
        ? prev.filter((id) => id !== stemId)
        : [...prev, stemId]
    ));
  };
  const toggleAll = () => {
    setSelectedIds((prev) => (
      prev.length === candidates.length ? [] : candidates.map((candidate) => candidate.stemId)
    ));
  };
  const sendReminder = async () => {
    if (!selectedRows.length) {
      setError('Select at least one invoice to include.');
      return;
    }
    if (!form.to.trim()) {
      setError('Payment reminder recipient is required.');
      return;
    }
    setSending(true);
    setError(null);
    const smtpSettings = readPaymentReminderSmtpSettings();
    const hasLocalSmtp = hasUsableSmtpSettings(smtpSettings);
    const hasServerEmailProvider = Boolean(data?.settings?.emailDelivery?.hasServerProvider);
    if (!hasLocalSmtp && !hasServerEmailProvider) {
      setError('Payment reminder email sending is not configured. Save Payment Reminder Sender credentials in Settings, or add RESEND_API_KEY / SMTP credentials in Vercel.');
      setSending(false);
      return;
    }
    const credentials = hasLocalSmtp
      ? { method: 'smtp', smtp: { ...smtpSettings, port: Number(smtpSettings.port || 587), from: smtpFromAddress(smtpSettings, data?.settings?.from) } }
      : undefined;
    const res = await appClient.functions.invoke('buyerInvoicePaymentReminderSend', {
      stemId: row.stemId,
      invoiceStemIds: selectedIds,
      daysAhead,
      to: form.to,
      cc: form.cc,
      bcc: form.bcc,
      subject: form.subject,
      body: form.body,
      credentials,
    });
    if (res.data?.error) {
      setError(res.data.error);
    } else {
      clearDraft(draftKey);
      appClient.functions.clearCache();
      onSent(res.data);
      onClose();
    }
    setSending(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment reminder</p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{row.stemName}</h2>
            <p className="text-sm text-muted-foreground">
              {row.buyerName || '-'}{row.buyerGroupName ? ` · ${row.buyerGroupName}` : ''}
            </p>
          </div>
          <Button variant="outline" size="icon" onClick={onClose} disabled={sending}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="max-h-[calc(92vh-78px)] overflow-auto p-4">
          {loading && (
            <StateBlock icon={Loader2} title="Preparing reminder..." description="Finding related buyer and buyer group invoices in the current due window." />
          )}

          {!loading && error && (
            <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && data && (
            <div className="space-y-4">
              <DraftNotice restoredAt={restoredAt} label="Payment reminder draft restored" onDiscard={discardDraft} />
              <div
                className={cn(
                  'rounded-xl border p-4 shadow-sm',
                  lastReminderSentToday
                    ? 'border-zinc-700 bg-zinc-900 text-white'
                    : lastReminderSentAt
                      ? 'border-amber-300 bg-amber-50 text-amber-950'
                      : 'border-border bg-muted/20 text-foreground',
                )}
              >
                <p className={cn(
                  'text-xs font-semibold uppercase tracking-wide',
                  lastReminderSentToday ? 'text-zinc-200' : 'text-muted-foreground',
                )}>
                  Last Payment Reminder Sent
                </p>
                <div className="mt-1 text-lg font-semibold">
                  {lastReminderSentAt ? fmtDateTime(lastReminderSentAt) : 'Not sent yet'}
                </div>
                <p className={cn(
                  'mt-1 text-xs',
                  lastReminderSentToday ? 'text-zinc-300' : 'text-muted-foreground',
                )}>
                  All reminder dates and times use Hong Kong time, GMT+8.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3 text-sm">
                <div>
                  <div className="font-semibold text-foreground">
                    {selectedRows.length.toLocaleString()} selected · {fmtMoney(selectedReceivable)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    To: buyer account accounts email + buyer trader in charge email + payment handler email
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Related invoices</h3>
                    <p className="text-xs text-muted-foreground">
                      Same buyer and same buyer group, except Fratelli Cosulich group, using the current Due in next days value.
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={toggleAll}>
                    {selectedIds.length === candidates.length ? 'Clear all' : 'Select all'}
                  </Button>
                </div>
                <div className="max-h-[34vh] overflow-auto rounded-lg border border-border">
                  <table className="w-full min-w-[1240px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Include</th>
                        <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stem Name</th>
                        <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer</th>
                        <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer Group</th>
                        <th className="sticky top-0 z-10 bg-card px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Receivable Balance</th>
                        <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Due Date</th>
                        <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recipient</th>
                        <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Collection</th>
                        <th className="sticky top-0 z-10 bg-card px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overdue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((candidate, idx) => (
                        <tr key={candidate.stemId} className={`border-b border-border/40 ${rowSeverityClass(candidate, idx)}`}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(candidate.stemId)}
                              onChange={() => toggleInvoice(candidate.stemId)}
                            />
                          </td>
                          <td className="px-3 py-2 font-medium text-foreground">{candidate.stemName || '-'}</td>
                          <td className="px-3 py-2 text-muted-foreground">{candidate.buyerName || '-'}</td>
                          <td className="px-3 py-2 text-muted-foreground">{candidate.buyerGroupName || '-'}</td>
                          <td className="px-3 py-2 text-right font-semibold text-foreground">{fmtMoney(candidate.receivableBalance)}</td>
                          <td className="px-3 py-2 text-foreground">{fmtDate(candidate.buyerInvoiceDueDate)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{candidate.paymentReminderRecipient || '-'}</td>
                          <td className="px-3 py-2">
                            <span className={`w-fit rounded-full border px-2 py-0.5 text-xs font-medium ${collectionPill(collectionStatus(candidate))}`}>
                              {collectionStatus(candidate)}
                            </span>
                          </td>
                          <td className={`px-3 py-2 text-right font-medium ${dueTextClass(candidate.daysUntilDue)}`}>
                            {overdueDisplayValue(candidate.daysUntilDue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-background/40 p-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Email</h3>
                  <p className="text-xs text-muted-foreground">
                    Review recipients, subject, content, and the inline invoice table before sending.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5 md:col-span-3">
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input
                      value={form.to}
                      onChange={(event) => updateForm('to', event.target.value)}
                      placeholder="buyer@example.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">CC</Label>
                    <Input value={form.cc} onChange={(event) => updateForm('cc', event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">BCC</Label>
                    <Input value={form.bcc} onChange={(event) => updateForm('bcc', event.target.value)} />
                  </div>
                  <div className="space-y-1.5 md:col-span-3">
                    <Label className="text-xs text-muted-foreground">Subject</Label>
                    <Input value={form.subject} onChange={(event) => updateForm('subject', event.target.value)} />
                  </div>
                  <div className="space-y-1.5 md:col-span-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label className="text-xs text-muted-foreground">Email content</Label>
                      <Button type="button" variant="outline" size="sm" onClick={insertInvoiceTableToken}>
                        Insert invoice table here
                      </Button>
                    </div>
                    <div className="rounded-md border border-input bg-background [&_.ql-container]:min-h-64 [&_.ql-container]:border-0 [&_.ql-toolbar]:border-0 [&_.ql-toolbar]:border-b [&_.ql-toolbar]:border-border">
                      <ReactQuill
                        ref={reminderBodyEditorRef}
                        theme="snow"
                        modules={QUILL_MODULES}
                        value={form.body}
                        onChange={(value) => updateForm('body', value)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Move the invoice table by moving <span className="font-mono">{INVOICE_TABLE_TOKEN}</span> to the desired position.
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-foreground">Email content preview</h3>
                    <p className="text-xs text-muted-foreground">
                      The outstanding invoice table is inserted at the marker below when the email is sent.
                    </p>
                  </div>
                  <div
                    className="max-h-72 overflow-auto rounded-lg border border-border bg-background p-4 text-sm leading-6 text-foreground [&_p]:mb-3 [&_p]:mt-0"
                    dangerouslySetInnerHTML={{ __html: emailBodyPreviewHtml(form.body, selectedRows.length) }}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  {error ? (
                    <div className="max-w-3xl rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                      {error}
                    </div>
                  ) : <span />}
                  <Button type="button" onClick={sendReminder} disabled={sending || !selectedRows.length} className="gap-2">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send Reminder
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PaymentReminderTemplateModal({
  open,
  emailSettings,
  updateEmailSetting,
  emailDirty,
  draftRestoredAt,
  emailBusy,
  emailLoading,
  emailMessage,
  emailError,
  onClose,
  onCancel,
  onSave,
  onDiscardDraft,
}) {
  const [activeTemplateField, setActiveTemplateField] = useState('body');
  const ccRef = useRef(null);
  const bccRef = useRef(null);
  const subjectRef = useRef(null);
  const bodyEditorRef = useRef(null);

  const inputRefs = {
    paymentReminderCc: ccRef,
    paymentReminderBcc: bccRef,
    paymentReminderSubject: subjectRef,
  };

  const insertTextVariable = (key, token) => {
    const current = emailSettings[key] || '';
    const node = inputRefs[key]?.current;
    const start = node?.selectionStart ?? current.length;
    const end = node?.selectionEnd ?? start;
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
    updateEmailSetting(key, next);
    window.setTimeout(() => {
      node?.focus();
      node?.setSelectionRange(start + token.length, start + token.length);
    }, 0);
  };

  const insertBodyVariable = (token) => {
    const editor = bodyEditorRef.current?.getEditor?.();
    if (!editor) {
      const current = token === INVOICE_TABLE_TOKEN
        ? removeInvoiceTableTokenHtml(emailSettings.paymentReminderBody)
        : emailSettings.paymentReminderBody || '';
      updateEmailSetting('paymentReminderBody', `${current}${token}`);
      return;
    }
    insertTokenIntoQuill(editor, token);
  };

  const insertVariable = (token) => {
    if (activeTemplateField === 'body') insertBodyVariable(token);
    else insertTextVariable(activeTemplateField, token);
  };

  const dropToken = (key, event) => {
    event.preventDefault();
    const token = event.dataTransfer.getData('application/x-template-variable') || event.dataTransfer.getData('text/plain');
    if (!token) return;
    setActiveTemplateField(key);
    if (key === 'body') insertBodyVariable(token);
    else insertTextVariable(key, token);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment reminder</p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">Payment Reminder Template</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Default template used when sending a manual reminder from an invoice row.
            </p>
          </div>
          <Button variant="outline" size="icon" onClick={onClose} disabled={emailBusy}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="max-h-[calc(92vh-76px)] overflow-auto p-4">
          <div className="space-y-4">
            <DraftNotice restoredAt={draftRestoredAt} label="Payment reminder template draft restored" onDiscard={onDiscardDraft} />
            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">To</div>
              <div className="mt-1 text-sm font-medium text-foreground">Automatic from buyer account emails, buyer trader email, and payment handler email</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Uses <span className="font-mono">Account.Accounts_Email__c</span>, <span className="font-mono">Nomination__c.BT_ST_Email_Address__c</span>, and the saved Payment Handler name. You can still edit the final To field before sending a reminder.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/10 p-3">
              <PaymentReminderVariablePalette onInsert={insertVariable} />
              <p className="mt-2 text-xs text-muted-foreground">
                Click a variable to insert it into the active template field, drag it into CC, BCC, Subject, or Content, or copy the token.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Reminder CC template</Label>
              <Input
                ref={ccRef}
                value={emailSettings.paymentReminderCc || ''}
                onFocus={() => setActiveTemplateField('paymentReminderCc')}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropToken('paymentReminderCc', event)}
                onChange={(event) => updateEmailSetting('paymentReminderCc', event.target.value)}
                placeholder="finance@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Reminder BCC template</Label>
              <Input
                ref={bccRef}
                value={emailSettings.paymentReminderBcc || ''}
                onFocus={() => setActiveTemplateField('paymentReminderBcc')}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropToken('paymentReminderBcc', event)}
                onChange={(event) => updateEmailSetting('paymentReminderBcc', event.target.value)}
                placeholder="archive@example.com"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs text-muted-foreground">Payment reminder subject</Label>
              <Input
                ref={subjectRef}
                value={emailSettings.paymentReminderSubject || ''}
                onFocus={() => setActiveTemplateField('paymentReminderSubject')}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropToken('paymentReminderSubject', event)}
                onChange={(event) => updateEmailSetting('paymentReminderSubject', event.target.value)}
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">Payment reminder content</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => insertBodyVariable(INVOICE_TABLE_TOKEN)}>
                  Insert invoice table position
                </Button>
              </div>
              <div
                className="rounded-md border border-input bg-background [&_.ql-container]:min-h-72 [&_.ql-container]:border-0 [&_.ql-toolbar]:border-0 [&_.ql-toolbar]:border-b [&_.ql-toolbar]:border-border"
                onFocus={() => setActiveTemplateField('body')}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropToken('body', event)}
              >
                <ReactQuill
                  ref={bodyEditorRef}
                  theme="snow"
                  modules={QUILL_MODULES}
                  value={emailSettings.paymentReminderBody || ''}
                  onChange={(value) => updateEmailSetting('paymentReminderBody', value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Move the invoice table by placing <span className="font-mono">{INVOICE_TABLE_TOKEN}</span> where the table should appear. The default template includes a 2.00% per month late payment interest charge warning.
              </p>
            </div>
            </div>
          </div>

          {emailMessage && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{emailMessage}</div>}
          {emailError && <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{emailError}</div>}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel} disabled={emailBusy} className="gap-2">
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button onClick={onSave} disabled={!emailDirty || emailBusy || emailLoading} className="gap-2">
              {emailBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BuyerInvoices() {
  const initialFilters = useMemo(() => readInitialFilters(), []);
  const today = useMemo(() => hongKongDateKey(), []);
  const [daysAhead, setDaysAhead] = useState(initialFilters.daysAhead);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [selectedCollectionRow, setSelectedCollectionRow] = useState(null);
  const [selectedReminderRow, setSelectedReminderRow] = useState(null);
  const [showEmailSchedule, setShowEmailSchedule] = useState(false);
  const [showPaymentReminderTemplate, setShowPaymentReminderTemplate] = useState(false);
  const [savedEmailSettings, setSavedEmailSettings] = useState(readLegacyEmailSettings);
  const [emailSettings, setEmailSettings] = useState(savedEmailSettings);
  const [emailMeta, setEmailMeta] = useState(null);
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState(null);
  const [emailError, setEmailError] = useState(null);
  const [emailDraftRestoredAt, setEmailDraftRestoredAt] = useState(null);
  const [selectedBuyerTraders, setSelectedBuyerTraders] = useState([]);
  const [selectedCollectionStatuses, setSelectedCollectionStatuses] = useState(COLLECTION_STATUSES);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [followUpFilter, setFollowUpFilter] = useState('all');
  const [actionOnly, setActionOnly] = useState(false);
  const [copiedRowId, setCopiedRowId] = useState(null);
  const traderFilterInitialized = useRef(false);
  const initialBuyerTraderFilter = useRef(initialFilters);

  const emailDirty = useMemo(() => !sameSettings(emailSettings, savedEmailSettings), [emailSettings, savedEmailSettings]);
  useDraftAutosave('buyer-invoices:email-settings', emailSettings, {
    enabled: !emailLoading,
    dirty: emailDirty,
    message: 'Autosaved internal email reminder/template draft. Save or discard it before leaving.',
  });

  const buyerTraderOptions = useMemo(() => (
    [...new Set(rows.flatMap((row) => [
      ...splitBuyerTraderNames(row.buyerTraderInCharge),
      collectionOwner(row),
    ].filter(Boolean)))]
      .sort((a, b) => a.localeCompare(b))
  ), [rows]);

  useEffect(() => {
    if (!buyerTraderOptions.length) {
      setSelectedBuyerTraders([]);
      return;
    }
    if (!traderFilterInitialized.current) {
      traderFilterInitialized.current = true;
      if (initialBuyerTraderFilter.current.hasBuyerTraderFilter) {
        const selected = new Set(initialBuyerTraderFilter.current.buyerTraders);
        setSelectedBuyerTraders(buyerTraderOptions.filter((name) => selected.has(name)));
      } else {
        setSelectedBuyerTraders(buyerTraderOptions);
      }
      return;
    }
    setSelectedBuyerTraders((prev) => {
      const next = prev.filter((name) => buyerTraderOptions.includes(name));
      return next.length || prev.length === 0 ? next : buyerTraderOptions;
    });
  }, [buyerTraderOptions]);

  const filteredRows = useMemo(() => {
    let next = rows;
    if (buyerTraderOptions.length && selectedBuyerTraders.length !== buyerTraderOptions.length) {
      const selected = new Set(selectedBuyerTraders);
      next = next.filter((row) => (
        splitBuyerTraderNames(row.buyerTraderInCharge).some((name) => selected.has(name))
        || selected.has(collectionOwner(row))
      ));
    }
    if (selectedCollectionStatuses.length !== COLLECTION_STATUSES.length) {
      const selected = new Set(selectedCollectionStatuses);
      next = next.filter((row) => selected.has(collectionStatus(row)));
    }
    if (severityFilter !== 'all') {
      next = next.filter((row) => {
        const severity = overdueSeverity(row.daysUntilDue);
        if (severityFilter === 'due-soon') return !severity;
        return severity === severityFilter;
      });
    }
    if (followUpFilter === 'due') next = next.filter((row) => isFollowUpDue(row, today));
    if (followUpFilter === 'scheduled') next = next.filter((row) => Boolean(row.collection?.nextFollowUpDate));
    if (actionOnly) next = next.filter((row) => isNeedsAction(row, today));
    return next;
  }, [actionOnly, buyerTraderOptions, followUpFilter, rows, selectedBuyerTraders, selectedCollectionStatuses, severityFilter, today]);

  const loadRows = async (options = {}) => {
    const nextDays = Math.max(0, Math.min(Number(daysAhead) || 0, 365));
    setLoading(true);
    setError(null);
    const res = await appClient.functions.invoke('salesforceBuyerInvoicesDue', { daysAhead: nextDays }, { cache: true, force: options.force });
    if (res.data?.error) {
      setError(res.data.error);
      setRows([]);
    } else {
      setRows(res.data?.rows || []);
      setMeta(res.data || null);
    }
    setLoading(false);
  };

  const loadEmailSettings = async () => {
    setEmailLoading(true);
    const res = await appClient.functions.invoke('buyerInvoiceEmailSettingsGet');
    if (res.data?.error) {
      setEmailError(res.data.error);
    } else {
      const formSettings = emailSettingsToForm(res.data.settings);
      const draft = readDraft('buyer-invoices:email-settings');
      const nextSettings = draft?.data && !sameSettings(draft.data, formSettings)
        ? emailSettingsToForm(draft.data)
        : formSettings;
      setSavedEmailSettings(formSettings);
      setEmailSettings(nextSettings);
      setEmailDraftRestoredAt(draft?.data && !sameSettings(nextSettings, formSettings) ? draft.updatedAt : null);
      setEmailMeta(res.data.meta || null);
      setEmailError(null);
    }
    setEmailLoading(false);
  };

  useEffect(() => {
    loadRows();
    loadEmailSettings();
  }, []);

  const totals = useMemo(() => {
    const overdue = filteredRows.filter((row) => row.status === 'Overdue');
    const dueSoon = filteredRows.filter((row) => row.status !== 'Overdue');
    const needsAction = filteredRows.filter((row) => isNeedsAction(row, today));
    return {
      overdueCount: overdue.length,
      overdueReceivable: overdue.reduce((sum, row) => sum + Number(row.receivableBalance || 0), 0),
      dueSoonCount: dueSoon.length,
      dueSoonReceivable: dueSoon.reduce((sum, row) => sum + Number(row.receivableBalance || 0), 0),
      needsActionCount: needsAction.length,
      needsActionReceivable: needsAction.reduce((sum, row) => sum + Number(row.receivableBalance || 0), 0),
    };
  }, [filteredRows, today]);

  const settingsForServer = () => {
    const hasBuyerTraderFilter = buyerTraderOptions.length > 0 && selectedBuyerTraders.length !== buyerTraderOptions.length;
    return {
      ...emailSettings,
      daysAhead: Number(emailSettings.daysAhead || daysAhead || 7),
      buyerTraders: hasBuyerTraderFilter ? selectedBuyerTraders : [],
      hasBuyerTraderFilter,
      appUrl: window.location.origin,
    };
  };

  const copyInvoiceRecord = async (row) => {
    try {
      await writeClipboardTable({
        html: invoiceRecordHtml(row),
        text: invoiceRecordPlainText(row),
      });
      setCopiedRowId(row.id);
      window.setTimeout(() => setCopiedRowId((current) => (current === row.id ? null : current)), 1500);
    } catch {
      setError('Unable to copy invoice details to clipboard.');
    }
  };

  const updateEmailSetting = (key, value) => {
    setEmailSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleEmailWeekday = (day) => {
    setEmailSettings((prev) => {
      const set = new Set(prev.weekdays || []);
      if (set.has(day)) set.delete(day);
      else set.add(day);
      return { ...prev, weekdays: WEEKDAYS.filter((item) => set.has(item)) };
    });
  };

  const toggleBuyerTrader = (name) => {
    setSelectedBuyerTraders((prev) => {
      if (prev.includes(name)) return prev.length > 1 ? prev.filter((item) => item !== name) : prev;
      return [...prev, name].sort((a, b) => a.localeCompare(b));
    });
  };

  const toggleAllBuyerTraders = () => {
    setSelectedBuyerTraders((prev) => (
      prev.length === buyerTraderOptions.length ? [] : buyerTraderOptions
    ));
  };

  const toggleCollectionStatus = (status) => {
    setSelectedCollectionStatuses((prev) => (
      prev.includes(status)
        ? prev.filter((item) => item !== status)
        : [...prev, status].sort((a, b) => COLLECTION_STATUSES.indexOf(a) - COLLECTION_STATUSES.indexOf(b))
    ));
  };

  const saveEmailSettings = async () => {
    setEmailBusy(true);
    setEmailError(null);
    const res = await appClient.functions.invoke('buyerInvoiceEmailSettingsSave', { settings: settingsForServer() });
    if (res.data?.error) {
      setEmailError(res.data.error);
    } else {
      const formSettings = emailSettingsToForm(res.data.settings);
      clearDraft('buyer-invoices:email-settings');
      setSavedEmailSettings(formSettings);
      setEmailSettings(formSettings);
      setEmailDraftRestoredAt(null);
      setEmailMeta(res.data.meta || null);
      setEmailMessage('Email report schedule saved.');
    }
    setEmailBusy(false);
  };

  const cancelEmailSettings = () => {
    clearDraft('buyer-invoices:email-settings');
    setEmailSettings(savedEmailSettings);
    setEmailDraftRestoredAt(null);
    setEmailMessage(null);
    setEmailError(null);
  };

  const toggleEmailSchedule = () => {
    if (showEmailSchedule && emailDirty && !window.confirm('Discard unsaved email schedule changes?')) return;
    setShowEmailSchedule((value) => !value);
  };

  const closePaymentReminderTemplate = () => {
    if (emailDirty && !window.confirm('Discard unsaved payment reminder template changes?')) return;
    setShowPaymentReminderTemplate(false);
  };

  const cancelPaymentReminderTemplate = () => {
    cancelEmailSettings();
    setShowPaymentReminderTemplate(false);
  };

  const sendEmailReport = async (preview = false) => {
    setEmailBusy(true);
    setEmailError(null);
    setEmailMessage(null);
    const smtpSettings = readSmtpSettings();
    const credentials = hasUsableSmtpSettings(smtpSettings) && !preview
      ? { method: 'smtp', smtp: { ...smtpSettings, port: Number(smtpSettings.port || 587), from: smtpFromAddress(smtpSettings, emailSettings.from) } }
      : undefined;
    const res = await appClient.functions.invoke('outstandingBuyerInvoicesEmailReport', { settings: settingsForServer(), credentials, preview, force: !preview });
    if (res.data?.error) {
      setEmailError(res.data.error);
    } else if (preview) {
      setEmailMeta((prev) => ({ ...(prev || {}), lastPreviewAt: new Date().toISOString(), lastPreviewRowCount: res.data.report?.rows?.length ?? 0 }));
      setEmailMessage(`Preview ready: ${res.data.report?.rows?.length ?? 0} invoice rows. Subject: ${res.data.email?.subject}`);
    } else {
      setEmailMeta((prev) => ({ ...(prev || {}), lastSentAt: new Date().toISOString(), lastSentRowCount: res.data.rows ?? 0, lastError: null }));
      setEmailMessage(`Sent ${res.data.rows ?? 0} invoice rows to ${res.data.to?.join(', ') || emailSettings.to}.`);
    }
    setEmailBusy(false);
  };

  const mergeCollectionResult = (result) => {
    if (!result?.item) return;
    setRows((prev) => prev.map((row) => {
      if (row.stemId !== result.item.stemId) return row;
      return {
        ...row,
        collection: result.item,
        collectionEvents: result.event
          ? [result.event, ...(row.collectionEvents || [])]
          : row.collectionEvents || [],
      };
    }));
  };

  const mergeCollectionResults = (results = []) => {
    for (const result of results) mergeCollectionResult(result);
  };

  const handleReminderSent = (result) => {
    mergeCollectionResults(result.collectionResults || []);
    setEmailMessage(`Payment reminder sent to ${result.to?.join(', ') || 'recipient'} for ${result.rows ?? 0} invoice rows.`);
    setEmailError(null);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        icon={ReceiptText}
        eyebrow="Buyer invoice follow-up"
        title="Outstanding Buyer Invoices"
        description="Manage overdue buyer invoices, due invoices, and AR collection follow-up."
        meta={meta ? `Window: ${fmtDate(meta.today)} to ${fmtDate(meta.dueThrough)} · ${filteredRows.length.toLocaleString()} of ${rows.length.toLocaleString()} invoices` : undefined}
        actions={(
          <>
            <Button variant="outline" onClick={toggleEmailSchedule} className="gap-2 w-fit">
              <Mail className="h-4 w-4" /> Internal Email Reminder
            </Button>
            <Button variant="outline" onClick={() => setShowPaymentReminderTemplate(true)} className="gap-2 w-fit">
              <Mail className="h-4 w-4" /> Payment Reminder Template
            </Button>
            <Button variant="outline" onClick={() => loadRows({ force: true })} disabled={loading} className="gap-2 w-fit">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </>
        )}
      />

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="days-ahead" className="text-xs text-muted-foreground">Due in next days</Label>
            <Input
              id="days-ahead"
              type="number"
              min="0"
              max="365"
              value={daysAhead}
              onChange={(event) => setDaysAhead(event.target.value)}
              className="h-9 w-32"
            />
          </div>
          <Button onClick={() => loadRows({ force: true })} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            Apply
          </Button>
          <Button variant={actionOnly ? 'default' : 'outline'} onClick={() => setActionOnly((value) => !value)} className="gap-2">
            <MessageSquareText className="h-4 w-4" />
            Needs Action Today
          </Button>
          <p className="pb-2 text-xs text-muted-foreground">Overdue invoices are always included.</p>
        </div>

        <div className="mt-4 grid gap-4 border-t border-border pt-4 xl:grid-cols-[1fr_1fr]">
          {buyerTraderOptions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer Trader in Charge / Payment Handler</Label>
                <button type="button" onClick={toggleAllBuyerTraders} className="text-xs text-primary hover:underline">
                  {selectedBuyerTraders.length === buyerTraderOptions.length ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {buyerTraderOptions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleBuyerTrader(name)}
                    className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
                      selectedBuyerTraders.includes(name)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Collection Status</Label>
              <button
                type="button"
                onClick={() => setSelectedCollectionStatuses(selectedCollectionStatuses.length === COLLECTION_STATUSES.length ? [] : COLLECTION_STATUSES)}
                className="text-xs text-primary hover:underline"
              >
                {selectedCollectionStatuses.length === COLLECTION_STATUSES.length ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {COLLECTION_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggleCollectionStatus(status)}
                  className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
                    selectedCollectionStatuses.includes(status)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Overdue Severity</Label>
            <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="all">All</option>
              <option value="red">Overdue 14+ days</option>
              <option value="orange">Overdue 7-13 days</option>
              <option value="yellow">Overdue 0-6 days</option>
              <option value="due-soon">Due today / due soon</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Follow-up</Label>
            <select value={followUpFilter} onChange={(event) => setFollowUpFilter(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="all">All</option>
              <option value="due">Follow-up due</option>
              <option value="scheduled">Follow-up scheduled</option>
            </select>
          </div>
        </div>
      </div>

      {showEmailSchedule && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Internal Email Reminder</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Shared server schedule. Production cron runs weekdays at 08:00 and 14:00 Hong Kong time and prevents duplicate sends.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={cancelEmailSettings} disabled={!emailDirty || emailBusy} className="gap-2">
                <X className="h-4 w-4" /> Cancel
              </Button>
              <Button variant="outline" onClick={saveEmailSettings} disabled={!emailDirty || emailBusy || emailLoading} className="gap-2">
                {emailBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
              </Button>
              <Button variant="outline" onClick={() => sendEmailReport(true)} disabled={emailBusy || emailLoading} className="gap-2">
                {emailBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Preview
              </Button>
              <Button onClick={() => sendEmailReport(false)} disabled={emailBusy || emailLoading} className="gap-2">
                {emailBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send Now
              </Button>
            </div>
          </div>

          <DraftNotice restoredAt={emailDraftRestoredAt} label="Email reminder settings draft restored" onDiscard={cancelEmailSettings} className="mb-4" />

          <div className="mb-4 grid gap-2 md:grid-cols-4">
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <div className="font-semibold text-foreground">Next Scheduled Run</div>
              <div className="mt-1 text-muted-foreground">{emailMeta?.nextScheduledRun || '-'}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <div className="font-semibold text-foreground">Last Sent</div>
              <div className="mt-1 text-muted-foreground">{fmtDateTime(emailMeta?.lastSentAt)} · {emailMeta?.lastSentRowCount ?? '-'} rows</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <div className="font-semibold text-foreground">Last Preview</div>
              <div className="mt-1 text-muted-foreground">{fmtDateTime(emailMeta?.lastPreviewAt)} · {emailMeta?.lastPreviewRowCount ?? '-'} rows</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <div className="font-semibold text-foreground">Last Error</div>
              <div className="mt-1 truncate text-muted-foreground" title={emailMeta?.lastError || ''}>{emailMeta?.lastError || '-'}</div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground lg:col-span-3">
              <input type="checkbox" checked={emailSettings.enabled !== false} onChange={(event) => updateEmailSetting('enabled', event.target.checked)} />
              Enable scheduled sending
            </label>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input value={emailSettings.from} onChange={(event) => updateEmailSetting('from', event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input value={emailSettings.to} onChange={(event) => updateEmailSetting('to', event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">CC</Label>
              <Input value={emailSettings.cc} onChange={(event) => updateEmailSetting('cc', event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Subject</Label>
              <Input value={emailSettings.subject} onChange={(event) => updateEmailSetting('subject', event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Due in next days</Label>
              <Input type="number" min="0" max="365" value={emailSettings.daysAhead} onChange={(event) => updateEmailSetting('daysAhead', event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Send times</Label>
              <Input value={emailSettings.sendTimes} onChange={(event) => updateEmailSetting('sendTimes', event.target.value)} placeholder="08:00, 14:00" />
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label className="text-xs text-muted-foreground">Email content</Label>
              <Textarea value={emailSettings.intro} onChange={(event) => updateEmailSetting('intro', event.target.value)} className="min-h-32" />
              <p className="text-xs text-muted-foreground">
                Available placeholders: {'{{reportStart}}'}, {'{{reportEnd}}'}, {'{{daysAhead}}'}.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Weekdays</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleEmailWeekday(day)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                      emailSettings.weekdays?.includes(day)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={emailSettings.includeSummary} onChange={(event) => updateEmailSetting('includeSummary', event.target.checked)} />
                Include KPI summary
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={emailSettings.includeTable} onChange={(event) => updateEmailSetting('includeTable', event.target.checked)} />
                Include invoice table
              </label>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground lg:col-span-3">
              Send Now can still use saved SMTP credentials from Settings. Scheduled production email uses server-side Resend or SMTP environment variables.
            </div>
          </div>

          {emailMessage && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{emailMessage}</div>}
          {emailError && <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{emailError}</div>}
        </div>
      )}

      {!showEmailSchedule && emailMessage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{emailMessage}</div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard label="Overdue" value={`${fmtMoney(totals.overdueReceivable)} (${totals.overdueCount.toLocaleString()})`} tone="red" />
        <SummaryCard label={`Due in ${Number(meta?.daysAhead ?? daysAhead ?? 7).toLocaleString()} Days`} value={`${fmtMoney(totals.dueSoonReceivable)} (${totals.dueSoonCount.toLocaleString()})`} tone="blue" />
        <SummaryCard label="Needs Action Today" value={`${fmtMoney(totals.needsActionReceivable)} (${totals.needsActionCount.toLocaleString()})`} tone="amber" />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {loading && (
        <StateBlock icon={Loader2} title="Loading buyer invoices..." description="Fetching due dates, invoice amounts, buyers, trader assignments, and collection state." />
      )}

      {!loading && !error && (
        <TableShell title="Buyer Invoice Due List" meta={`${filteredRows.length.toLocaleString()} rows`} bodyClassName="p-0">
          {filteredRows.length ? (
            <div className="max-h-[68vh] overflow-auto">
              <table className="w-full min-w-[1540px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stem Name</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer Name</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invoice Amount</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Receivable Balance</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer Invoice Due Date</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer Trader in Charge</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">PSPRS</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Collection / Payment Handler</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next Follow-up</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overdue</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, idx) => {
                    const reminderSentToday = wasPaymentReminderSentToday(row);
                    return (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedStemId(row.stemId)}
                        className={`cursor-pointer border-b border-border/40 transition-colors ${rowSeverityClass(row, idx)}`}
                      >
                      <td className="px-4 py-3 font-medium text-foreground">{row.stemName || '-'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.buyerName || '-'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">{fmtMoney(row.invoiceAmount)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">{fmtMoney(row.receivableBalance)}</td>
                      <td className="px-4 py-3 text-foreground">{fmtDate(row.buyerInvoiceDueDate)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.buyerTraderInCharge || '-'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.prpspStatus || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`w-fit rounded-full border px-2 py-0.5 text-xs font-medium ${collectionPill(collectionStatus(row))}`}>
                            {collectionStatus(row)}
                          </span>
                          {collectionOwner(row) && <span className="text-xs text-muted-foreground">{collectionOwner(row)}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        <div className={isFollowUpDue(row, today) ? 'font-semibold text-amber-800' : ''}>
                          {fmtDate(row.collection?.nextFollowUpDate)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusPill(row.status, row.daysUntilDue)}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${dueTextClass(row.daysUntilDue)}`}>
                        {overdueDisplayValue(row.daysUntilDue)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            title={reminderSentToday ? 'Payment reminder sent today' : 'Send payment reminder'}
                            aria-label={`Send payment reminder for ${row.stemName || 'invoice'}`}
                            className={cn(
                              'h-7 px-2',
                              reminderSentToday && 'border-zinc-700 bg-zinc-800 text-white shadow-sm hover:bg-zinc-700 hover:text-white',
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedReminderRow(row);
                            }}
                          >
                            <Mail className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            title="Manage collection"
                            aria-label={`Manage collection for ${row.stemName || 'invoice'}`}
                            className="h-7 px-2"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedCollectionRow(row);
                            }}
                          >
                            <MessageSquareText className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            title="Copy row details"
                            aria-label={`Copy ${row.stemName || 'invoice'} details`}
                            className="h-7 px-2"
                            onClick={(event) => {
                              event.stopPropagation();
                              copyInvoiceRecord(row);
                            }}
                          >
                            {copiedRowId === row.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <StateBlock title="No buyer invoices found" description="No overdue invoices, due invoices, or collection rows match the selected filters." />
          )}
        </TableShell>
      )}

      <StemDetailModal stemId={selectedStemId} open={!!selectedStemId} onClose={() => setSelectedStemId(null)} onUpdated={() => loadRows({ force: true })} />
      <CollectionModal
        row={selectedCollectionRow}
        open={!!selectedCollectionRow}
        onClose={() => setSelectedCollectionRow(null)}
        onSaved={mergeCollectionResult}
        ownerOptions={buyerTraderOptions}
      />
      <PaymentReminderModal
        row={selectedReminderRow}
        open={!!selectedReminderRow}
        daysAhead={Math.max(0, Math.min(Number(daysAhead) || 0, 365))}
        onClose={() => setSelectedReminderRow(null)}
        onSent={handleReminderSent}
      />
      <PaymentReminderTemplateModal
        open={showPaymentReminderTemplate}
        emailSettings={emailSettings}
        updateEmailSetting={updateEmailSetting}
        emailDirty={emailDirty}
        draftRestoredAt={emailDraftRestoredAt}
        emailBusy={emailBusy}
        emailLoading={emailLoading}
        emailMessage={emailMessage}
        emailError={emailError}
        onClose={closePaymentReminderTemplate}
        onCancel={cancelPaymentReminderTemplate}
        onSave={saveEmailSettings}
        onDiscardDraft={cancelEmailSettings}
      />
    </div>
  );
}
