import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, Download, Eye, Loader2, Mail, RefreshCw, ReceiptText, Save, Send, X } from 'lucide-react';
import { format } from 'date-fns';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const EMAIL_SETTINGS_KEY = 'salesforce_extension:buyer_invoice_email_settings';
const DEFAULT_EMAIL_SETTINGS = {
  from: 'Fratelli Cosulich <info@cosulich.com.hk>',
  to: 'bt@cosulich.com.hk',
  cc: 'lousia@cosulich.com.hk, laureen@cosulich.com.hk',
  daysAhead: 7,
  subject: 'Outstanding Buyer Invoices Report',
  intro: 'Please find below the latest overdue buyer invoices and buyer invoices due soon.',
  includeSummary: true,
  includeTable: true,
  weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  sendTimes: '08:00, 14:00',
};

const fmtMoney = (value) => {
  if (value == null || value === '') return '—';
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (value) => {
  if (!value) return '—';
  try { return format(new Date(value), 'dd MMM yyyy'); } catch { return value; }
};

const csvValue = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

function SummaryCard({ label, value, tone = 'default' }) {
  const toneClass = {
    default: 'text-foreground',
    red: 'text-red-600',
    blue: 'text-blue-600',
    green: 'text-emerald-600',
  }[tone];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-dm text-2xl font-bold ${toneClass}`}>{value}</p>
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

function rowSeverityClass(daysUntilDue, idx) {
  const severity = overdueSeverity(daysUntilDue);
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

function overdueDisplayValue(daysUntilDue) {
  if (daysUntilDue == null) return '—';
  return (-Number(daysUntilDue)).toLocaleString();
}

function readEmailSettings() {
  try {
    const raw = localStorage.getItem(EMAIL_SETTINGS_KEY);
    const saved = raw ? { ...DEFAULT_EMAIL_SETTINGS, ...JSON.parse(raw) } : DEFAULT_EMAIL_SETTINGS;
    if (String(saved.from || '').includes('admin@fcuno.com')) saved.from = DEFAULT_EMAIL_SETTINGS.from;
    return saved;
  } catch {
    return DEFAULT_EMAIL_SETTINGS;
  }
}

function sameSettings(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function BuyerInvoices() {
  const [daysAhead, setDaysAhead] = useState(7);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [showEmailSchedule, setShowEmailSchedule] = useState(false);
  const [savedEmailSettings, setSavedEmailSettings] = useState(readEmailSettings);
  const [emailSettings, setEmailSettings] = useState(savedEmailSettings);
  const [useSmtpCredentials, setUseSmtpCredentials] = useState(false);
  const [smtpCredentials, setSmtpCredentials] = useState({
    host: 'smtp.office365.com',
    port: '587',
    user: 'info@cosulich.com.hk',
    password: '',
    secure: false,
  });
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState(null);
  const [emailError, setEmailError] = useState(null);

  const emailDirty = useMemo(() => !sameSettings(emailSettings, savedEmailSettings), [emailSettings, savedEmailSettings]);

  const loadRows = async () => {
    const nextDays = Math.max(0, Math.min(Number(daysAhead) || 0, 365));
    setLoading(true);
    setError(null);
    const res = await appClient.functions.invoke('salesforceBuyerInvoicesDue', { daysAhead: nextDays });
    if (res.data?.error) {
      setError(res.data.error);
      setRows([]);
    } else {
      setRows(res.data?.rows || []);
      setMeta(res.data || null);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadRows();
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('salesforce-extension:dirty-state', {
      detail: {
        key: 'buyer-invoice-email-settings',
        dirty: emailDirty,
        message: 'Save changes to the email report schedule before leaving?',
      },
    }));
    const beforeUnload = (event) => {
      if (!emailDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.dispatchEvent(new CustomEvent('salesforce-extension:dirty-state', {
        detail: { key: 'buyer-invoice-email-settings', dirty: false },
      }));
    };
  }, [emailDirty]);

  const totals = useMemo(() => {
    const overdue = rows.filter((row) => row.status === 'Overdue');
    const dueSoon = rows.filter((row) => row.status !== 'Overdue');
    return {
      overdueCount: overdue.length,
      overdueReceivable: overdue.reduce((sum, row) => sum + Number(row.receivableBalance || 0), 0),
      dueSoonCount: dueSoon.length,
      dueSoonReceivable: dueSoon.reduce((sum, row) => sum + Number(row.receivableBalance || 0), 0),
    };
  }, [rows]);

  const exportCsv = () => {
    const headers = ['Stem Name', 'Buyer Name', 'Invoice Amount', 'Receivable Balance', 'Buyer Invoice Due Date', "Buyer's Trader in Charge", 'Status', 'Overdue'];
    const csvRows = rows.map((row) => [
      row.stemName,
      row.buyerName,
      row.invoiceAmount,
      row.receivableBalance,
      row.buyerInvoiceDueDate,
      row.buyerTraderInCharge,
      row.status,
      row.daysUntilDue == null ? '' : -Number(row.daysUntilDue),
    ]);
    const csv = [headers, ...csvRows].map((row) => row.map(csvValue).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `buyer-invoices-due-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const updateEmailSetting = (key, value) => {
    setEmailSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleEmailWeekday = (day) => {
    setEmailSettings((prev) => {
      const set = new Set(prev.weekdays || []);
      if (set.has(day)) set.delete(day);
      else set.add(day);
      return { ...prev, weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].filter((item) => set.has(item)) };
    });
  };

  const saveEmailSettings = () => {
    localStorage.setItem(EMAIL_SETTINGS_KEY, JSON.stringify(emailSettings));
    setSavedEmailSettings(emailSettings);
    setEmailMessage('Email report schedule saved.');
    setEmailError(null);
  };

  const cancelEmailSettings = () => {
    setEmailSettings(savedEmailSettings);
    setEmailMessage(null);
    setEmailError(null);
  };

  const toggleEmailSchedule = () => {
    if (showEmailSchedule && emailDirty && !window.confirm('Discard unsaved email schedule changes?')) return;
    setShowEmailSchedule((value) => !value);
  };

  const sendEmailReport = async (preview = false) => {
    setEmailBusy(true);
    setEmailError(null);
    setEmailMessage(null);
    const settings = {
      ...emailSettings,
      daysAhead: Number(emailSettings.daysAhead || daysAhead || 7),
    };
    const credentials = useSmtpCredentials && !preview
      ? { method: 'smtp', smtp: { ...smtpCredentials, port: Number(smtpCredentials.port || 587) } }
      : undefined;
    const res = await appClient.functions.invoke('outstandingBuyerInvoicesEmailReport', { settings, credentials, preview, force: !preview });
    if (res.data?.error) {
      setEmailError(res.data.error);
    } else if (preview) {
      setEmailMessage(`Preview ready: ${res.data.report?.rows?.length ?? 0} invoice rows. Subject: ${res.data.email?.subject}`);
    } else {
      setEmailMessage(`Sent ${res.data.rows ?? 0} invoice rows to ${res.data.to?.join(', ') || emailSettings.to}.`);
    }
    setEmailBusy(false);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        icon={ReceiptText}
        eyebrow="Buyer invoice follow-up"
        title="Outstanding Buyer Invoices"
        description="Manage overdue buyer invoices and invoices due within the selected number of days."
        meta={meta ? `Window: ${fmtDate(meta.today)} to ${fmtDate(meta.dueThrough)} · ${rows.length.toLocaleString()} invoices` : undefined}
        actions={(
          <>
            <Button variant="outline" onClick={toggleEmailSchedule} className="gap-2 w-fit">
              <Mail className="h-4 w-4" /> Email Schedule
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={loading || !rows.length} className="gap-2 w-fit">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button variant="outline" onClick={loadRows} disabled={loading} className="gap-2 w-fit">
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
          <Button onClick={loadRows} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            Apply
          </Button>
          <p className="pb-2 text-xs text-muted-foreground">
            Overdue invoices are always included.
          </p>
        </div>
      </div>

      {showEmailSchedule && (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Email Report Schedule</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Default production schedule is weekdays at 08:00 and 14:00 Hong Kong time. Save changes before leaving this page.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={cancelEmailSettings} disabled={!emailDirty || emailBusy} className="gap-2">
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button variant="outline" onClick={saveEmailSettings} disabled={!emailDirty || emailBusy} className="gap-2">
              <Save className="h-4 w-4" /> Save
            </Button>
            <Button variant="outline" onClick={() => sendEmailReport(true)} disabled={emailBusy} className="gap-2">
              {emailBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Preview
            </Button>
            <Button onClick={() => sendEmailReport(false)} disabled={emailBusy} className="gap-2">
              {emailBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send Now
            </Button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
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
            <Label className="text-xs text-muted-foreground">Email intro</Label>
            <Textarea value={emailSettings.intro} onChange={(event) => updateEmailSetting('intro', event.target.value)} className="min-h-20" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Weekdays</Label>
            <div className="flex flex-wrap gap-1.5">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day) => (
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
          <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3 lg:col-span-3">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input type="checkbox" checked={useSmtpCredentials} onChange={(event) => setUseSmtpCredentials(event.target.checked)} />
              Use SMTP email account credentials for Send Now
            </label>
            <p className="text-xs text-muted-foreground">
              These credentials are sent only with the Send Now request and are not saved. Scheduled reports use server-side email credentials.
            </p>
            {useSmtpCredentials && (
              <div className="grid gap-3 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">SMTP host</Label>
                  <Input value={smtpCredentials.host} onChange={(event) => setSmtpCredentials(prev => ({ ...prev, host: event.target.value }))} placeholder="smtp.office365.com" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Port</Label>
                  <Input type="number" value={smtpCredentials.port} onChange={(event) => setSmtpCredentials(prev => ({ ...prev, port: event.target.value }))} placeholder="587" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Email username</Label>
                  <Input value={smtpCredentials.user} onChange={(event) => setSmtpCredentials(prev => ({ ...prev, user: event.target.value }))} placeholder="info@cosulich.com.hk" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Password / app password</Label>
                  <Input type="password" value={smtpCredentials.password} onChange={(event) => setSmtpCredentials(prev => ({ ...prev, password: event.target.value }))} placeholder="Not saved" />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground lg:col-span-4">
                  <input type="checkbox" checked={smtpCredentials.secure} onChange={(event) => setSmtpCredentials(prev => ({ ...prev, secure: event.target.checked }))} />
                  Use SSL/TLS immediately, usually port 465. Leave unchecked for STARTTLS on port 587.
                </label>
              </div>
            )}
          </div>
        </div>

        {emailMessage && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{emailMessage}</div>}
        {emailError && <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{emailError}</div>}
      </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <SummaryCard label="Overdue" value={`${fmtMoney(totals.overdueReceivable)} (${totals.overdueCount.toLocaleString()})`} tone="red" />
        <SummaryCard label="Due Soon" value={`${fmtMoney(totals.dueSoonReceivable)} (${totals.dueSoonCount.toLocaleString()})`} tone="blue" />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {loading && (
        <StateBlock icon={Loader2} title="Loading buyer invoices..." description="Fetching due dates, invoice amounts, buyers, and trader assignments from Salesforce." />
      )}

      {!loading && !error && (
        <TableShell title="Buyer Invoice Due List" meta={`${rows.length.toLocaleString()} rows`} bodyClassName="p-0">
          {rows.length ? (
            <div className="max-h-[68vh] overflow-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stem Name</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer Name</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invoice Amount</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Receivable Balance</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer Invoice Due Date</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer's Trader in Charge</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedStemId(row.stemId)}
                      className={`cursor-pointer border-b border-border/40 transition-colors ${rowSeverityClass(row.daysUntilDue, idx)}`}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{row.stemName || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.buyerName || '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">{fmtMoney(row.invoiceAmount)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">{fmtMoney(row.receivableBalance)}</td>
                      <td className="px-4 py-3 text-foreground">{fmtDate(row.buyerInvoiceDueDate)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.buyerTraderInCharge || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusPill(row.status, row.daysUntilDue)}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${dueTextClass(row.daysUntilDue)}`}>
                        {overdueDisplayValue(row.daysUntilDue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <StateBlock title="No buyer invoices found" description="No overdue invoices or invoices due inside the selected window." />
          )}
        </TableShell>
      )}

      <StemDetailModal stemId={selectedStemId} open={!!selectedStemId} onClose={() => setSelectedStemId(null)} onUpdated={loadRows} />
    </div>
  );
}
