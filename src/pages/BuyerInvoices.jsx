import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CalendarClock, Check, Copy, Eye, Loader2, Mail, MessageSquareText, RefreshCw, ReceiptText, Save, Search, Send, X } from 'lucide-react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import DraftNotice from '@/components/common/DraftNotice';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
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
  paymentReminderBody: `<p>Dear {{primaryRecipientName}},</p><p>Please find below the outstanding buyer invoices for your attention.</p><p>${INVOICE_TABLE_TOKEN}</p><p>This reminder includes overdue invoices and invoices due within {{daysAhead}} days. Please arrange payment or let us know the expected payment date.</p><p><strong>Late payment interest warning:</strong> where payment remains overdue, a late payment interest charge of <strong>2.00% per month</strong> may apply.</p><p>Regards,<br>Fratelli Cosulich</p>`,
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
      { label: 'Primary recipient', token: '{{primaryRecipientName}}' },
      { label: 'Buyer group', token: '{{buyerGroupName}}' },
      { label: 'Invoice amount', token: '{{invoiceAmount}}' },
      { label: 'Receivable balance', token: '{{receivableBalance}}' },
      { label: 'Due date', token: '{{buyerInvoiceDueDate}}' },
      { label: 'Buyer trader', token: '{{buyerTraderInCharge}}' },
      { label: 'Account emails', token: '{{buyerAccountsEmail}}' },
      { label: 'Trader emails', token: '{{buyerTraderEmail}}' },
      { label: 'Payment handler', token: '{{paymentHandlerName}}' },
      { label: 'Payment handler email', token: '{{paymentHandlerEmail}}' },
      { label: 'Buyer broker names', token: '{{buyerBrokerNames}}' },
      { label: 'Buyer broker emails', token: '{{buyerBrokerEmails}}' },
      { label: 'Buyer broker formats', token: '{{buyerBrokerInvoiceFormats}}' },
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
const PAYMENT_REMINDER_STEPS = ['Select invoices', 'Review recipients', 'Email preview'];

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

function routingGroupRecipients(group = {}) {
  return {
    to: arrayToInput(group.to || []),
    cc: arrayToInput(group.cc || []),
    bcc: arrayToInput(group.bcc || []),
  };
}

function uniqueEmailList(...values) {
  const seen = new Set();
  const emails = [];
  const add = (value) => {
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    String(value || '').split(/[,\n;]/).map((item) => item.trim()).filter(Boolean).forEach((email) => {
      const key = email.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      emails.push(email);
    });
  };
  values.forEach(add);
  return emails;
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

function invoiceTablePreviewHtml(rows = []) {
  if (!rows.length) return invoiceTableMarkerHtml(0);
  const bodyRows = rows.map((row) => {
    const severity = overdueSeverity(row.daysUntilDue);
    const rowStyle = severity === 'red'
      ? 'background:#fee2e2'
      : severity === 'orange'
        ? 'background:#fed7aa'
        : severity === 'yellow'
          ? 'background:#fef08a'
          : '';
    const cellStyle = 'border-bottom:1px solid #d9e2ef;padding:7px 8px;vertical-align:top;white-space:nowrap';
    return `
      <tr style="${rowStyle}">
        <td style="${cellStyle};font-weight:600;white-space:normal;min-width:170px">${escapeHtml(row.stemName)}</td>
        <td style="${cellStyle};white-space:normal;min-width:120px">${escapeHtml(row.buyerName || '-')}</td>
        <td style="${cellStyle};text-align:right">${fmtMoney(row.invoiceAmount)}</td>
        <td style="${cellStyle};text-align:right;font-weight:600">${fmtMoney(row.receivableBalance)}</td>
        <td style="${cellStyle}">${fmtDate(row.buyerInvoiceDueDate)}</td>
        <td style="${cellStyle};white-space:normal;min-width:95px">${escapeHtml(row.buyerTraderInCharge || '-')}</td>
        <td style="${cellStyle};white-space:normal;min-width:90px">${escapeHtml(row.prpspStatus || '-')}</td>
        <td style="${cellStyle};text-align:left;font-weight:600">${escapeHtml(overdueDisplayValue(row.daysUntilDue))}</td>
      </tr>`;
  }).join('');
  return `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #d9e2ef;border-radius:10px;margin:14px 0 16px;max-width:100%">
      <table style="border-collapse:collapse;width:auto;min-width:100%;max-width:none;font-size:12px;line-height:1.25;table-layout:auto">
        <thead>
          <tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px;letter-spacing:.04em">
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Stem</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Buyer</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Invoice</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Receivable</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Due Date</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Trader</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">PSPRS</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Overdue</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

function emailBodyPreviewHtml(body, rows = []) {
  const html = normalizeReminderPreviewHtml(body);
  const marker = invoiceTablePreviewHtml(rows);
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

function renderReminderPreviewTemplate(template, context) {
  const values = context || {};
  return textValue(template, '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  ));
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
  const paymentReminderBody = textValue(merged.paymentReminderBody, DEFAULT_EMAIL_SETTINGS.paymentReminderBody)
    .replace(/Dear\s+\{\{\s*buyerName\s*\}\}/i, 'Dear {{primaryRecipientName}}')
    .replace(/To\s+\{\{\s*buyerName\s*\}\}/i, 'To {{primaryRecipientName}}');
  return {
    ...merged,
    to: arrayToInput(merged.to),
    cc: arrayToInput(merged.cc),
    sendTimes: arrayToInput(merged.sendTimes),
    weekdays: Array.isArray(merged.weekdays) ? merged.weekdays : WEEKDAYS,
    paymentReminderCc: arrayToInput(merged.paymentReminderCc),
    paymentReminderBcc: arrayToInput(merged.paymentReminderBcc),
    paymentReminderBody: richTemplateValue(paymentReminderBody),
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
  return value.toLocaleString();
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

function invoiceRecordsPlainText(rows) {
  return rows.map(invoiceRecordPlainText).join('\n');
}

function invoiceRecordsHtml(rows) {
  return rows.map(invoiceRecordHtml).join('');
}

function copyGroupKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isCopyCandidate(row, selected) {
  if (!row || !selected) return false;
  if (row.id === selected.id) return true;
  const selectedBuyer = copyGroupKey(selected.buyerName);
  const rowBuyer = copyGroupKey(row.buyerName);
  if (selectedBuyer && rowBuyer && selectedBuyer === rowBuyer) return true;
  const selectedGroup = copyGroupKey(selected.buyerGroupName);
  const rowGroup = copyGroupKey(row.buyerGroupName);
  return Boolean(selectedGroup && rowGroup && selectedGroup === rowGroup);
}

function matchesInvoiceKeyword(row, keyword) {
  const terms = String(keyword || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const searchable = `${row?.stemName || ''} ${row?.buyerName || ''}`.toLowerCase();
  return terms.every((term) => searchable.includes(term));
}

function brokerRoutingLabel(mode) {
  if (mode === 'broker_only') return 'Broker only';
  if (mode === 'buyer_cc_broker') return 'Buyer CC broker';
  return 'Buyer only';
}

function brokerRoutingTone(mode) {
  if (mode === 'broker_only') return 'border-purple-200 bg-purple-50 text-purple-700';
  if (mode === 'buyer_cc_broker') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

function reminderOverduePillClass(daysUntilDue) {
  const severity = overdueSeverity(daysUntilDue);
  if (severity === 'red') return 'border-red-300 bg-red-100 text-red-800';
  if (severity === 'orange') return 'border-orange-300 bg-orange-100 text-orange-800';
  if (severity === 'yellow') return 'border-yellow-300 bg-yellow-100 text-yellow-900';
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

function reminderRowAccentClass(row) {
  if (row?.prpspStatus === 'Conditional-Not Sent') return 'border-l-purple-400';
  const severity = overdueSeverity(row?.daysUntilDue);
  if (severity === 'red') return 'border-l-red-400';
  if (severity === 'orange') return 'border-l-orange-400';
  if (severity === 'yellow') return 'border-l-yellow-400';
  return 'border-l-transparent';
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
  const [templateSaving, setTemplateSaving] = useState(false);
  const [error, setError] = useState(null);
  const [templateMessage, setTemplateMessage] = useState('');
  const [templateEditing, setTemplateEditing] = useState(false);
  const [data, setData] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const reminderBodyEditorRef = useRef(null);
  const [form, setForm] = useState({
    recipientBatches: {},
    subject: '',
    body: '',
  });
  const [baseDraftValue, setBaseDraftValue] = useState(null);
  const [restoredAt, setRestoredAt] = useState(null);

  useEffect(() => {
    if (open) setCurrentStep(0);
  }, [open, row?.stemId]);

  useEffect(() => {
    if (!open || !row) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      setTemplateMessage('');
      setTemplateEditing(false);
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
        const baseRecipientBatches = Object.fromEntries((res.data.routingGroups || []).map((group) => [
          group.key,
          routingGroupRecipients(group),
        ]));
        const baseForm = {
          recipientBatches: baseRecipientBatches,
          templateCc: res.data.settings?.paymentReminderCc || '',
          templateBcc: res.data.settings?.paymentReminderBcc || '',
          subject: res.data.subject || '',
          body: richTemplateValue(res.data.body || ''),
        };
        const baseSelectedIds = candidates.map((candidate) => candidate.stemId);
        const draft = readDraft(draftKey);
        const candidateIds = new Set(baseSelectedIds);
        const draftSelectedIds = Array.isArray(draft?.data?.selectedIds)
          ? draft.data.selectedIds.filter((id) => candidateIds.has(id))
          : baseSelectedIds;
        const draftForm = draft?.data?.form || null;
        const nextForm = draftForm
          ? {
              ...baseForm,
              ...draftForm,
              recipientBatches: {
                ...baseRecipientBatches,
                ...(draftForm.recipientBatches || {}),
              },
            }
          : baseForm;
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
  const selectedRoutingGroups = useMemo(() => {
    const selected = new Set(selectedIds);
    return (data?.routingGroups || [])
      .map((group) => ({
        ...group,
        stemIds: (group.stemIds || []).filter((id) => selected.has(id)),
      }))
      .filter((group) => group.stemIds.length);
  }, [data?.routingGroups, selectedIds]);
  const selectedRecipientBatches = useMemo(() => selectedRoutingGroups.map((group) => ({
    ...group,
    recipients: form.recipientBatches?.[group.key] || routingGroupRecipients(group),
  })), [form.recipientBatches, selectedRoutingGroups]);
  const selectedFinalTo = useMemo(() => uniqueEmailList(...selectedRecipientBatches.map((group) => group.recipients.to || '')), [selectedRecipientBatches]);
  const selectedFinalCc = useMemo(() => uniqueEmailList(...selectedRecipientBatches.map((group) => group.recipients.cc || '')), [selectedRecipientBatches]);
  const selectedFinalBcc = useMemo(() => uniqueEmailList(...selectedRecipientBatches.map((group) => group.recipients.bcc || '')), [selectedRecipientBatches]);
  const hasMissingRecipient = useMemo(() => (
    selectedRecipientBatches.some((group) => !uniqueEmailList(group.recipients.to).length)
  ), [selectedRecipientBatches]);
  const selectedRoutingWarnings = useMemo(() => (
    [...new Set(selectedRows.flatMap((candidate) => candidate.buyerBrokerRoutingWarnings || []))]
  ), [selectedRows]);
  const selectedPreviewGroup = useMemo(() => (
    selectedRoutingGroups.find((group) => (group.stemIds || []).includes(row?.stemId))
    || selectedRoutingGroups[0]
    || null
  ), [row?.stemId, selectedRoutingGroups]);
  const selectedPreviewRecipients = useMemo(() => (
    selectedPreviewGroup
      ? form.recipientBatches?.[selectedPreviewGroup.key] || routingGroupRecipients(selectedPreviewGroup)
      : { to: '', cc: '', bcc: '' }
  ), [form.recipientBatches, selectedPreviewGroup]);
  const previewSelectedRow = useMemo(() => (
    selectedRows.find((candidate) => candidate.stemId === row?.stemId)
    || selectedRows[0]
    || row
    || {}
  ), [row, selectedRows]);
  const previewContext = useMemo(() => {
    const totalReceivable = selectedRows.reduce((sum, candidate) => sum + Number(candidate.receivableBalance || 0), 0);
    return {
      stemName: previewSelectedRow?.stemName || '',
      keyStem: previewSelectedRow?.keyStem || '',
      buyerName: previewSelectedRow?.buyerName || 'Customer',
      primaryRecipientName: selectedPreviewGroup?.primaryRecipientName || previewSelectedRow?.buyerName || 'Customer',
      buyerGroupName: previewSelectedRow?.buyerGroupName || '',
      invoiceAmount: fmtMoney(previewSelectedRow?.invoiceAmount),
      receivableBalance: fmtMoney(previewSelectedRow?.receivableBalance),
      buyerInvoiceDueDate: fmtDate(previewSelectedRow?.buyerInvoiceDueDate),
      buyerTraderInCharge: previewSelectedRow?.buyerTraderInCharge || '',
      buyerAccountsEmail: previewSelectedRow?.buyerAccountsEmail || '',
      buyerTraderEmail: previewSelectedRow?.buyerTraderEmail || '',
      paymentHandlerName: previewSelectedRow?.paymentHandlerName || previewSelectedRow?.collection?.ownerName || '',
      paymentHandlerEmail: previewSelectedRow?.paymentHandlerEmail || '',
	      buyerBrokerNames: [...new Set(selectedRows.map((candidate) => candidate.buyerBrokerNames).filter(Boolean))].join(', '),
	      buyerBrokerEmails: uniqueEmailList(...selectedRows.map((candidate) => candidate.buyerBrokerEmails || '')).join(', '),
	      buyerBrokerInvoiceFormats: [...new Set(selectedRows.map((candidate) => candidate.buyerBrokerInvoiceFormats).filter(Boolean))].join(', '),
	      toRecipients: selectedPreviewRecipients.to || '',
	      ccRecipients: selectedPreviewRecipients.cc || '',
	      bccRecipients: selectedPreviewRecipients.bcc || '',
	      psprsStatus: previewSelectedRow?.prpspStatus || '',
	      overdue: overdueDisplayValue(previewSelectedRow?.daysUntilDue),
	      invoiceStatus: previewSelectedRow?.status || '',
      daysAhead: String(daysAhead ?? DEFAULT_EMAIL_SETTINGS.daysAhead),
      invoiceCount: String(selectedRows.length),
      totalReceivable: fmtMoney(totalReceivable),
    };
	  }, [daysAhead, previewSelectedRow, selectedPreviewGroup, selectedPreviewRecipients.bcc, selectedPreviewRecipients.cc, selectedPreviewRecipients.to, selectedRows]);
	  const renderedPreviewSubject = useMemo(() => (
	    renderReminderPreviewTemplate(form.subject, previewContext)
	  ), [form.subject, previewContext]);
  const renderedPreviewBody = useMemo(() => (
    renderReminderPreviewTemplate(form.body, previewContext)
  ), [form.body, previewContext]);
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
  const updateBatchRecipient = (groupKey, field, value) => {
    setForm((prev) => ({
      ...prev,
      recipientBatches: {
        ...(prev.recipientBatches || {}),
        [groupKey]: {
          ...(prev.recipientBatches?.[groupKey] || {}),
          [field]: value,
        },
      },
    }));
  };
  const discardDraft = () => {
    clearDraft(draftKey);
    if (baseDraftValue) {
      setForm(baseDraftValue.form);
      setSelectedIds(baseDraftValue.selectedIds);
    }
    setRestoredAt(null);
  };
  const insertReminderBodyToken = (token) => {
    if (!templateEditing || !token) return;
    const editor = reminderBodyEditorRef.current?.getEditor?.();
    if (!editor) {
      const current = token === INVOICE_TABLE_TOKEN ? removeInvoiceTableTokenHtml(form.body) : form.body;
      updateForm('body', `${current}<p>${token}</p>`);
      return;
    }
    insertTokenIntoQuill(editor, token);
  };
  const dropReminderBodyToken = (event) => {
    if (!templateEditing) return;
    event.preventDefault();
    const token = event.dataTransfer.getData('application/x-template-variable') || event.dataTransfer.getData('text/plain');
    insertReminderBodyToken(token);
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
    const reviewedRecipientBatches = selectedRecipientBatches.map((group) => ({
      key: group.key,
      stemIds: group.stemIds || [],
      to: group.recipients.to || '',
      cc: group.recipients.cc || '',
      bcc: group.recipients.bcc || '',
    }));
    const missingRecipientBatch = reviewedRecipientBatches.find((batch) => !uniqueEmailList(batch.to).length);
    if (missingRecipientBatch) {
      setCurrentStep(1);
      setError('Enter at least one To email before sending.');
      return;
    }
    setSending(true);
    setError(null);
    const smtpSettings = readPaymentReminderSmtpSettings();
    const hasLocalSmtp = hasUsableSmtpSettings(smtpSettings);
    const hasServerEmailProvider = Boolean(data?.settings?.emailDelivery?.hasServerProvider);
    if (!hasLocalSmtp && !hasServerEmailProvider) {
      setError('Payment reminder email sending is not configured. Save External Payment Reminder credentials in Settings, or configure SMTP credentials in Vercel.');
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
      recipientBatches: reviewedRecipientBatches,
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

  const savePaymentReminderTemplateFromModal = async () => {
    setTemplateSaving(true);
    setError(null);
    const res = await appClient.functions.invoke('buyerInvoiceEmailSettingsSave', {
      settings: {
        ...(data?.settings || {}),
	        paymentReminderSubject: form.subject,
	        paymentReminderCc: form.templateCc || '',
	        paymentReminderBcc: form.templateBcc || '',
	        paymentReminderBody: form.body,
	      },
	    });
    if (res.data?.error) {
      setError(res.data.error);
    } else {
	      setBaseDraftValue((prev) => prev ? { ...prev, form: { ...prev.form, templateCc: form.templateCc, templateBcc: form.templateBcc, subject: form.subject, body: form.body } } : prev);
      clearDraft(draftKey);
      setTemplateMessage('Payment reminder template saved.');
      setTemplateEditing(false);
    }
    setTemplateSaving(false);
  };

  const cancelPaymentReminderTemplateChanges = () => {
    setForm((prev) => ({
	      ...prev,
	      templateCc: baseDraftValue?.form?.templateCc ?? prev.templateCc,
	      templateBcc: baseDraftValue?.form?.templateBcc ?? prev.templateBcc,
	      subject: baseDraftValue?.form?.subject ?? prev.subject,
	      body: baseDraftValue?.form?.body ?? prev.body,
	    }));
    setTemplateMessage('');
    setTemplateEditing(false);
  };

  const goToStep = (step) => {
    if (step > 0 && !selectedRows.length) {
      setError('Select at least one invoice before continuing.');
      return;
    }
    if (step > 1 && hasMissingRecipient) {
      setError('Enter at least one To email before sending.');
      setCurrentStep(1);
      return;
    }
    setError(null);
    setCurrentStep(Math.max(0, Math.min(step, PAYMENT_REMINDER_STEPS.length - 1)));
  };

  const goNext = () => goToStep(currentStep + 1);
  const goBack = () => goToStep(currentStep - 1);

  return (
    <Dialog open={open && Boolean(row)} onOpenChange={(nextOpen) => {
      if (!nextOpen && !sending) onClose();
    }}>
      <DialogContent className="payment-reminder-dialog max-h-[94vh] w-[96vw] max-w-[1500px] gap-0 overflow-hidden p-0 text-slate-950">
        <DialogHeader className="border-b border-slate-200 px-5 py-4 text-left">
          <div className="flex flex-wrap items-start justify-between gap-4 pr-8">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">{row.stemName}</p>
              <DialogTitle className="mt-1 text-xl font-semibold text-slate-950">External payment reminder</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-slate-500">
                {row.buyerName || '-'}{row.buyerGroupName ? ` · ${row.buyerGroupName}` : ''}
              </DialogDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium',
                lastReminderSentToday
                  ? 'border-zinc-700 bg-zinc-800 text-white'
                  : lastReminderSentAt
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-slate-200 bg-slate-100 text-slate-600',
              )}>
                Last sent: {lastReminderSentAt ? fmtDateTime(lastReminderSentAt) : 'Not sent yet'}
              </span>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[calc(94vh-152px)] overflow-auto px-5 py-4">
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
              <DraftNotice restoredAt={restoredAt} label="Draft restored" onDiscard={discardDraft} />

              <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Selected</div>
                      <div className="mt-1 text-lg font-semibold text-slate-950">{selectedRows.length.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Receivable</div>
                      <div className="mt-1 text-lg font-semibold text-slate-950">{fmtMoney(selectedReceivable)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Email batches</div>
                      <div className="mt-1 text-lg font-semibold text-slate-950">{selectedRecipientBatches.length.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <div><span className="font-semibold text-slate-900">To:</span> {selectedFinalTo.join(', ') || '-'}</div>
                  <div className="mt-1"><span className="font-semibold text-slate-900">CC:</span> {selectedFinalCc.join(', ') || '-'}</div>
                  <div className="mt-1"><span className="font-semibold text-slate-900">BCC:</span> {selectedFinalBcc.join(', ') || '-'}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
                {PAYMENT_REMINDER_STEPS.map((step, index) => {
                  const isActive = currentStep === index;
                  const isComplete = index < currentStep;
                  const disabled = loading || (index > 0 && !selectedRows.length) || (index > 1 && hasMissingRecipient);
                  return (
                    <button
                      key={step}
                      type="button"
                      disabled={disabled}
                      onClick={() => goToStep(index)}
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

              {selectedRoutingWarnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="font-semibold">Check broker routing</div>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {selectedRoutingWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </div>
              )}

              {currentStep === 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-950">Select invoices</h3>
                      <p className="text-xs text-slate-500">Same buyer and buyer group invoices in the current due window.</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={toggleAll}>
                      {selectedIds.length === candidates.length ? 'Clear all' : 'Select all'}
                    </Button>
                  </div>
                  <div className="max-h-[52vh] overflow-auto rounded-lg border border-slate-200 bg-white">
                    <table className="w-full min-w-[1180px] text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Include</th>
                          <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">STEM</th>
                          <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Buyer</th>
                          <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Buyer Broker</th>
                          <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Routing</th>
                          <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Receivable</th>
                          <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Due Date</th>
                          <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Overdue</th>
                          <th className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Collection</th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidates.map((candidate) => (
                          <tr key={candidate.stemId} className={`border-b border-l-4 border-slate-100 bg-white transition-colors hover:bg-slate-50 ${reminderRowAccentClass(candidate)}`}>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(candidate.stemId)}
                                onChange={() => toggleInvoice(candidate.stemId)}
                              />
                            </td>
                            <td className="px-3 py-2 font-medium text-slate-950">{candidate.stemName || '-'}</td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-900">{candidate.buyerName || '-'}</div>
                              {candidate.buyerGroupName && <div className="text-[11px] text-slate-500">{candidate.buyerGroupName}</div>}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              <div className="font-medium text-slate-800">{candidate.buyerBrokerNames || '-'}</div>
                              {candidate.buyerBrokerInvoiceFormats && <div className="text-[11px] text-slate-500">{candidate.buyerBrokerInvoiceFormats}</div>}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex w-fit items-center justify-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium leading-none ${brokerRoutingTone(candidate.buyerBrokerRoutingMode)}`}>
                                {brokerRoutingLabel(candidate.buyerBrokerRoutingMode)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-950">{fmtMoney(candidate.receivableBalance)}</td>
                            <td className="px-3 py-2 text-slate-700">{fmtDate(candidate.buyerInvoiceDueDate)}</td>
                            <td className="px-3 py-2 text-left">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${reminderOverduePillClass(candidate.daysUntilDue)}`}>
                                {overdueDisplayValue(candidate.daysUntilDue)}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-medium ${collectionPill(collectionStatus(candidate))}`}>
                                {collectionStatus(candidate)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {currentStep === 1 && (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">Review recipients</h3>
                    <p className="text-xs text-slate-500">Only the addresses shown here will be used.</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {selectedRecipientBatches.map((group, index) => (
                      <div key={group.key} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-slate-950">Batch {index + 1}</div>
                            <div className="mt-0.5 text-xs text-slate-500">{group.primaryRecipientName || 'Recipient group'}</div>
                          </div>
                          <span className={`inline-flex w-fit items-center justify-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${brokerRoutingTone(group.mode)}`}>
                            {brokerRoutingLabel(group.mode)}
                          </span>
                        </div>
                        <div className="mb-3 rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                          {group.stemIds.length.toLocaleString()} invoice{group.stemIds.length === 1 ? '' : 's'}
                        </div>
                        <div className="grid gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500">To</Label>
                            <Input
                              value={group.recipients.to}
                              onChange={(event) => updateBatchRecipient(group.key, 'to', event.target.value)}
                              placeholder="Enter recipient email"
                              className={cn(!uniqueEmailList(group.recipients.to).length && 'border-red-300 focus-visible:ring-red-400')}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500">CC</Label>
                            <Input value={group.recipients.cc} onChange={(event) => updateBatchRecipient(group.key, 'cc', event.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500">BCC</Label>
                            <Input value={group.recipients.bcc} onChange={(event) => updateBatchRecipient(group.key, 'bcc', event.target.value)} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">Email preview</h3>
                    <p className="text-xs text-slate-500">Review the message before sending.</p>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                      {templateEditing && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <PaymentReminderVariablePalette onInsert={insertReminderBodyToken} />
                          <p className="mt-2 text-xs text-slate-500">Drag variables into the email content. Drag {INVOICE_TABLE_TOKEN} to move the invoice table.</p>
                        </div>
                      )}
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-slate-500">CC template</Label>
                          <Input
                            value={form.templateCc || ''}
                            onChange={(event) => updateForm('templateCc', event.target.value)}
                            disabled={!templateEditing}
                            placeholder="Optional CC saved to template"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-slate-500">BCC template</Label>
                          <Input
                            value={form.templateBcc || ''}
                            onChange={(event) => updateForm('templateBcc', event.target.value)}
                            disabled={!templateEditing}
                            placeholder="Optional BCC saved to template"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">Subject</Label>
                        <Input value={form.subject} onChange={(event) => updateForm('subject', event.target.value)} disabled={!templateEditing} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-500">Email content</Label>
                        <div
                          className={cn(
                            'rounded-md border border-slate-200 bg-white [&_.ql-container]:min-h-72 [&_.ql-container]:border-0 [&_.ql-toolbar]:border-0 [&_.ql-toolbar]:border-b [&_.ql-toolbar]:border-slate-200',
                            !templateEditing && 'opacity-85',
                          )}
                          onDragOver={(event) => templateEditing && event.preventDefault()}
                          onDrop={dropReminderBodyToken}
                        >
                          <ReactQuill
                            ref={reminderBodyEditorRef}
                            theme="snow"
                            modules={QUILL_MODULES}
                            value={form.body}
                            readOnly={!templateEditing}
                            onChange={(value) => updateForm('body', value)}
                          />
                        </div>
                        <p className="text-xs text-slate-500">Invoice table position: <span className="font-mono">{INVOICE_TABLE_TOKEN}</span></p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white">
                      <div className="border-b border-slate-200 px-3 py-2">
                        <div className="text-sm font-semibold text-slate-950">Preview</div>
                        <div className="mt-1 grid gap-1 text-xs text-slate-500">
                          <div><span className="font-semibold text-slate-900">To:</span> {selectedFinalTo.join(', ') || '-'}</div>
                          <div><span className="font-semibold text-slate-900">CC:</span> {selectedFinalCc.join(', ') || '-'}</div>
                          <div><span className="font-semibold text-slate-900">BCC:</span> {selectedFinalBcc.join(', ') || '-'}</div>
                          <div><span className="font-semibold text-slate-900">Subject:</span> {renderedPreviewSubject || '-'}</div>
                        </div>
                      </div>
                      <div className="max-h-[58vh] overflow-auto p-4">
                        {selectedRoutingWarnings.length > 0 && (
                          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                            <div className="font-semibold">Check broker routing</div>
                            <ul className="mt-1 list-disc space-y-1 pl-4">
                              {selectedRoutingWarnings.map((warning) => <li key={`preview-${warning}`}>{warning}</li>)}
                            </ul>
                          </div>
                        )}
                        <div
                          className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-900 [&_p]:mb-3 [&_p]:mt-0"
                          dangerouslySetInnerHTML={{ __html: emailBodyPreviewHtml(renderedPreviewBody, selectedRows) }}
                        />
                      </div>
                    </div>
                  </div>

                  {templateMessage && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                      {templateMessage}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-slate-200 bg-slate-50 px-5 py-3">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-h-9 flex-1">
              {error && data && (
                <div className="inline-flex max-w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {data && currentStep === PAYMENT_REMINDER_STEPS.length - 1 && (
                !templateEditing ? (
                  <Button type="button" variant="outline" onClick={() => setTemplateEditing(true)} disabled={sending} className="gap-2">
                    <Mail className="h-4 w-4" />
                    Edit Template
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="outline" onClick={cancelPaymentReminderTemplateChanges} disabled={sending || templateSaving} className="gap-2">
                      <X className="h-4 w-4" />
                      Cancel
                    </Button>
                    <Button type="button" variant="outline" onClick={savePaymentReminderTemplateFromModal} disabled={sending || templateSaving} className="gap-2">
                      {templateSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save Template
                    </Button>
                  </>
                )
              )}
              <Button type="button" variant="outline" onClick={onClose} disabled={sending}>Close</Button>
              {data && currentStep > 0 && (
                <Button type="button" variant="outline" onClick={goBack} disabled={sending}>Back</Button>
              )}
              {data && currentStep < PAYMENT_REMINDER_STEPS.length - 1 && (
                <Button type="button" onClick={goNext} disabled={sending || (currentStep === 0 && !selectedRows.length)}>
                  Next
                </Button>
              )}
              {data && currentStep === PAYMENT_REMINDER_STEPS.length - 1 && (
                <Button type="button" onClick={sendReminder} disabled={sending || !selectedRows.length} className="gap-2">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send Email
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyInvoiceSelectionModal({ row, candidates = [], open, onClose, onCopy }) {
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(candidates.map((candidate) => candidate.id));
  }, [candidates, open]);

  if (!open || !row) return null;

  const selectedRows = candidates.filter((candidate) => selectedIds.includes(candidate.id));
  const toggleInvoice = (id) => {
    setSelectedIds((prev) => (
      prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id]
    ));
  };
  const allSelected = selectedIds.length === candidates.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Copy invoice details</p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{row.buyerName || '-'}</h2>
            <p className="text-sm text-muted-foreground">
              Select the same buyer or buyer-group invoices to copy.
            </p>
          </div>
          <Button variant="outline" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 overflow-auto p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {selectedRows.length.toLocaleString()} selected · {fmtMoney(selectedRows.reduce((sum, item) => sum + Number(item.receivableBalance || 0), 0))}
            </div>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setSelectedIds(allSelected ? [row.id] : candidates.map((candidate) => candidate.id))}
            >
              {allSelected ? 'Keep current only' : 'Select all'}
            </button>
          </div>

          <div className="max-h-[48vh] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Include</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stem</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer Group</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Receivable Balance</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Due Date</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate, idx) => (
                  <tr key={candidate.id} className={`border-b border-border/40 ${rowSeverityClass(candidate, idx)}`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(candidate.id)}
                        onChange={() => toggleInvoice(candidate.id)}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-foreground">{candidate.stemName || '-'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{candidate.buyerName || '-'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{candidate.buyerGroupName || '-'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-foreground">{fmtMoney(candidate.receivableBalance)}</td>
                    <td className="px-3 py-2 text-foreground">{fmtDate(candidate.buyerInvoiceDueDate)}</td>
                    <td className={`px-3 py-2 text-left font-medium ${dueTextClass(candidate.daysUntilDue)}`}>{overdueDisplayValue(candidate.daysUntilDue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onCopy(selectedRows)} disabled={!selectedRows.length} className="gap-2">
              <Copy className="h-4 w-4" />
              Copy Selected
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
  const [copySelection, setCopySelection] = useState(null);
  const [showEmailSchedule, setShowEmailSchedule] = useState(false);
  const [savedEmailSettings, setSavedEmailSettings] = useState(readLegacyEmailSettings);
  const [emailSettings, setEmailSettings] = useState(savedEmailSettings);
  const [emailMeta, setEmailMeta] = useState(null);
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailAction, setEmailAction] = useState('');
  const [emailPreview, setEmailPreview] = useState(null);
  const [internalEmailEditing, setInternalEmailEditing] = useState(false);
  const [emailMessage, setEmailMessage] = useState(null);
  const [emailError, setEmailError] = useState(null);
  const [emailDraftRestoredAt, setEmailDraftRestoredAt] = useState(null);
  const [selectedBuyerTraders, setSelectedBuyerTraders] = useState([]);
  const [selectedCollectionStatuses, setSelectedCollectionStatuses] = useState(COLLECTION_STATUSES);
  const [invoiceKeyword, setInvoiceKeyword] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [followUpFilter, setFollowUpFilter] = useState('all');
  const [actionOnly, setActionOnly] = useState(false);
  const [copiedRowIds, setCopiedRowIds] = useState(() => new Set());
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
    if (invoiceKeyword.trim()) {
      next = next.filter((row) => matchesInvoiceKeyword(row, invoiceKeyword));
    }
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
  }, [actionOnly, buyerTraderOptions, followUpFilter, invoiceKeyword, rows, selectedBuyerTraders, selectedCollectionStatuses, severityFilter, today]);

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

  const copyInvoiceRows = async (selectedRows) => {
    try {
      await writeClipboardTable({
        html: invoiceRecordsHtml(selectedRows),
        text: invoiceRecordsPlainText(selectedRows),
      });
      setCopiedRowIds((prev) => {
        const next = new Set(prev);
        selectedRows.forEach((item) => next.add(item.id));
        return next;
      });
      setCopySelection(null);
    } catch {
      setError('Unable to copy invoice details to clipboard.');
    }
  };

  const copyInvoiceRecord = async (row) => {
    const candidates = filteredRows
      .filter((candidate) => isCopyCandidate(candidate, row))
      .sort((a, b) => {
        if (a.buyerInvoiceDueDate !== b.buyerInvoiceDueDate) return String(a.buyerInvoiceDueDate || '').localeCompare(String(b.buyerInvoiceDueDate || ''));
        return String(a.stemName || '').localeCompare(String(b.stemName || ''));
      });
    if (candidates.length > 1) {
      setCopySelection({ row, candidates });
      return;
    }
    await copyInvoiceRows([row]);
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
      setInternalEmailEditing(false);
    }
    setEmailBusy(false);
  };

  const cancelEmailSettings = () => {
    clearDraft('buyer-invoices:email-settings');
    setEmailSettings(savedEmailSettings);
    setEmailDraftRestoredAt(null);
    setEmailMessage(null);
    setEmailError(null);
    setInternalEmailEditing(false);
  };

  const toggleEmailSchedule = () => {
    if (showEmailSchedule && emailDirty && !window.confirm('Discard unsaved email schedule changes?')) return;
    setShowEmailSchedule((value) => {
      const next = !value;
      if (next) {
        setInternalEmailEditing(false);
        setEmailPreview(null);
        setEmailMessage(null);
        setEmailError(null);
      }
      return next;
    });
  };

  const closeInternalEmailReminder = () => {
    if (emailDirty && !window.confirm('Discard unsaved internal email reminder changes?')) return;
    setShowEmailSchedule(false);
    setInternalEmailEditing(false);
  };

  const sendEmailReport = async (preview = false) => {
    setEmailBusy(true);
    setEmailAction(preview ? 'preview' : 'send');
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
      setEmailPreview(res.data.email || null);
      setEmailMeta((prev) => ({ ...(prev || {}), lastPreviewAt: new Date().toISOString(), lastPreviewRowCount: res.data.report?.rows?.length ?? 0 }));
      setEmailMessage(`Preview ready: ${res.data.report?.rows?.length ?? 0} invoice rows. Subject: ${res.data.email?.subject}`);
    } else {
      setEmailPreview(res.data.email || null);
      setEmailMeta((prev) => ({ ...(prev || {}), lastSentAt: new Date().toISOString(), lastSentRowCount: res.data.rows ?? 0, lastError: null }));
      setEmailMessage(`Sent ${res.data.rows ?? 0} invoice rows to ${res.data.to?.join(', ') || emailSettings.to}.`);
    }
    setEmailBusy(false);
    setEmailAction('');
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
    setEmailMessage(`Payment reminder sent in ${(result.emails ?? result.batches?.length ?? 1).toLocaleString()} email batch${(result.emails ?? result.batches?.length ?? 1) === 1 ? '' : 'es'} to ${result.to?.join(', ') || 'recipient'} for ${result.rows ?? 0} invoice rows.`);
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
              <Mail className="h-4 w-4" /> Outstanding Buyer Invoices - Internal Daily Report
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
          <div className="space-y-1.5">
            <Label htmlFor="invoice-keyword" className="text-xs text-muted-foreground">Search STEM / Buyer</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="invoice-keyword"
                value={invoiceKeyword}
                onChange={(event) => setInvoiceKeyword(event.target.value)}
                placeholder="Stem name or buyer name"
                className="h-9 w-72 pl-8 pr-8"
              />
              {invoiceKeyword && (
                <button
                  type="button"
                  onClick={() => setInvoiceKeyword('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Clear invoice search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
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
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer Trader / Payment Handler</Label>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex h-[92vh] w-[96vw] max-w-[1500px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            <div className="shrink-0 flex items-start justify-between gap-4 border-b border-border p-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Outstanding buyer invoices</p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">Outstanding Buyer Invoices - Internal Daily Report</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Shared server schedule. Production cron runs weekdays at 08:00 and 14:00 Hong Kong time and prevents duplicate sends.
                </p>
              </div>
              <Button variant="outline" size="icon" onClick={closeInternalEmailReminder} disabled={emailBusy}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[430px_minmax(0,1fr)]">
              <div className="min-h-0 space-y-3 overflow-auto pr-1">
                <DraftNotice restoredAt={emailDraftRestoredAt} label="Email reminder settings draft restored" onDiscard={cancelEmailSettings} />

                <div className="grid gap-2 md:grid-cols-2">
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

                <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <input type="checkbox" checked={emailSettings.enabled !== false} onChange={(event) => updateEmailSetting('enabled', event.target.checked)} disabled={!internalEmailEditing} />
                  Enable scheduled sending
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Input value={emailSettings.from} onChange={(event) => updateEmailSetting('from', event.target.value)} disabled={!internalEmailEditing} />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input value={emailSettings.to} onChange={(event) => updateEmailSetting('to', event.target.value)} disabled={!internalEmailEditing} />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label className="text-xs text-muted-foreground">CC</Label>
                    <Input value={emailSettings.cc} onChange={(event) => updateEmailSetting('cc', event.target.value)} disabled={!internalEmailEditing} />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label className="text-xs text-muted-foreground">Subject</Label>
                    <Input value={emailSettings.subject} onChange={(event) => updateEmailSetting('subject', event.target.value)} disabled={!internalEmailEditing} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Due in next days</Label>
                    <Input type="number" min="0" max="365" value={emailSettings.daysAhead} onChange={(event) => updateEmailSetting('daysAhead', event.target.value)} disabled={!internalEmailEditing} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Send times</Label>
                    <Input value={emailSettings.sendTimes} onChange={(event) => updateEmailSetting('sendTimes', event.target.value)} placeholder="08:00, 14:00" disabled={!internalEmailEditing} />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label className="text-xs text-muted-foreground">Email content</Label>
                    <Textarea value={emailSettings.intro} onChange={(event) => updateEmailSetting('intro', event.target.value)} className="min-h-44 font-mono text-xs" disabled={!internalEmailEditing} />
                    <p className="text-xs text-muted-foreground">
                      Available placeholders: {'{{reportStart}}'}, {'{{reportEnd}}'}, {'{{daysAhead}}'}.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Weekdays</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((day) => (
                      <button
                        key={day}
                        type="button"
                        disabled={!internalEmailEditing}
                        onClick={() => toggleEmailWeekday(day)}
                        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                          emailSettings.weekdays?.includes(day)
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/50'
                        } ${!internalEmailEditing ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={emailSettings.includeSummary} onChange={(event) => updateEmailSetting('includeSummary', event.target.checked)} disabled={!internalEmailEditing} />
                    Include KPI summary
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={emailSettings.includeTable} onChange={(event) => updateEmailSetting('includeTable', event.target.checked)} disabled={!internalEmailEditing} />
                    Include invoice table
                  </label>
                </div>

                <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
                  Send Now uses the Internal SMTP credentials from Settings when available. Scheduled production email uses server-side SMTP environment variables.
                </div>

                {emailMessage && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{emailMessage}</div>}
                {emailError && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{emailError}</div>}
              </div>

              <div className="flex min-h-0 flex-col rounded-xl border border-border bg-background">
                <div className="shrink-0 flex items-center justify-between border-b border-border px-3 py-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Preview</div>
                    <div className="text-xs text-muted-foreground">
                      {emailPreview?.subject ? `Subject: ${emailPreview.subject}` : 'Generate a preview before sending.'}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => sendEmailReport(true)} disabled={emailBusy || emailLoading}>
                    {emailAction === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                    {emailAction === 'preview' ? 'Previewing' : 'Preview'}
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-4">
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

            <div className="shrink-0 flex flex-wrap justify-end gap-2 border-t border-border p-4">
              {!internalEmailEditing ? (
                <Button variant="outline" onClick={() => setInternalEmailEditing(true)} disabled={emailBusy || emailLoading} className="gap-2">
                  <Mail className="h-4 w-4" /> Edit Template
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={cancelEmailSettings} disabled={emailBusy} className="gap-2">
                    <X className="h-4 w-4" /> Cancel Changes
                  </Button>
                  <Button variant="outline" onClick={saveEmailSettings} disabled={!emailDirty || emailBusy || emailLoading} className="gap-2">
                    {emailBusy && emailAction !== 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Template
                  </Button>
                </>
              )}
              <Button variant="outline" onClick={closeInternalEmailReminder} disabled={emailBusy}>Close</Button>
              <Button onClick={() => sendEmailReport(false)} disabled={emailBusy || emailLoading} className="gap-2">
                {emailAction === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {emailAction === 'send' ? 'Sending' : 'Send Now'}
              </Button>
            </div>
          </div>
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
              <table className="w-full min-w-[1680px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stem</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer Broker</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invoice Amount</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Receivable Balance</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer Invoice Due Date</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer Trader</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">PSPRS</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment Collection Handler</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next Follow-up</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overdue</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, idx) => {
                    const reminderSentToday = wasPaymentReminderSentToday(row);
                    const rowCopied = copiedRowIds.has(row.id);
                    return (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedStemId(row.stemId)}
                        className={`cursor-pointer border-b border-border/40 transition-colors ${rowSeverityClass(row, idx)}`}
                      >
                      <td className="px-4 py-3 font-medium text-foreground">{row.stemName || '-'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.buyerName || '-'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.buyerBrokerNames || '-'}</td>
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
                      <td className={`px-4 py-3 text-left font-medium ${dueTextClass(row.daysUntilDue)}`}>
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
                            className={cn(
                              'h-7 px-2',
                              rowCopied && 'border-zinc-700 bg-zinc-800 text-white shadow-sm hover:bg-zinc-700 hover:text-white',
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              copyInvoiceRecord(row);
                            }}
                          >
                            {rowCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
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
      <CopyInvoiceSelectionModal
        row={copySelection?.row}
        candidates={copySelection?.candidates || []}
        open={!!copySelection}
        onClose={() => setCopySelection(null)}
        onCopy={copyInvoiceRows}
      />
    </div>
  );
}
