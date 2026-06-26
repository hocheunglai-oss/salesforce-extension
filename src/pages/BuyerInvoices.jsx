import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, Download, Loader2, RefreshCw, ReceiptText } from 'lucide-react';
import { format } from 'date-fns';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

function statusPill(status) {
  if (status === 'Overdue') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

export default function BuyerInvoices() {
  const [daysAhead, setDaysAhead] = useState(7);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedStemId, setSelectedStemId] = useState(null);

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
    const headers = ['Stem Name', 'Buyer Name', 'Invoice Amount', 'Receivable Balance', 'Buyer Invoice Due Date', "Buyer's Trader in Charge", 'Status', 'Days Until Due'];
    const csvRows = rows.map((row) => [
      row.stemName,
      row.buyerName,
      row.invoiceAmount,
      row.receivableBalance,
      row.buyerInvoiceDueDate,
      row.buyerTraderInCharge,
      row.status,
      row.daysUntilDue,
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
                    <th className="sticky top-0 z-10 bg-card px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedStemId(row.stemId)}
                      className={`cursor-pointer border-b border-border/40 transition-colors hover:bg-muted/30 ${idx % 2 ? 'bg-muted/10' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{row.stemName || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.buyerName || '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">{fmtMoney(row.invoiceAmount)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">{fmtMoney(row.receivableBalance)}</td>
                      <td className="px-4 py-3 text-foreground">{fmtDate(row.buyerInvoiceDueDate)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.buyerTraderInCharge || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusPill(row.status)}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${row.daysUntilDue < 0 ? 'text-red-600' : 'text-foreground'}`}>
                        {row.daysUntilDue == null ? '—' : row.daysUntilDue.toLocaleString()}
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
