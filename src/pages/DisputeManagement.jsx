import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, FileText, Loader2, Pencil, RefreshCw, Search, X } from 'lucide-react';
import { format } from 'date-fns';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import DisputeDocumentsModal from '@/components/disputes/DisputeDocumentsModal';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { numericValue, textValue } from '@/lib/displayValue';

const ACTIVE_DISPUTE_STATUSES = [
  'Opened',
  'Closed with Supplier only',
  'Closed with Buyer only',
  'Closed',
];
const NOT_CLOSED_STATUSES = ACTIVE_DISPUTE_STATUSES.filter(status => status !== 'Closed');
const BUYER_DISPUTE_STATUS_OPTIONS = [
  'No agreement yet',
  'Settlement Agreement Concluded',
];
const SUPPLIER_DISPUTE_STATUS_OPTIONS = [
  'Decision Pending',
  'Deduct below amount...',
  'Pay Full Supplier Invoice Amount',
];

const normalizeStatus = (value) => textValue(value, '').toLowerCase();
const displayStatus = (value) =>
  ACTIVE_DISPUTE_STATUSES.find(status => normalizeStatus(status) === normalizeStatus(value)) || value;
const isDeductBelowAmountStatus = (value) => /deduct\s+below\s+amount/i.test(textValue(value, ''));

const fmtMoney = (value) => {
  const number = numericValue(value);
  if (number == null) return '—';
  return `$${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (value) => {
  if (!value) return '—';
  if (typeof value === 'object') return textValue(value);
  try { return format(new Date(value), 'dd MMM yyyy'); } catch { return textValue(value); }
};

const csvValue = (value) => `"${textValue(value, '').replaceAll('"', '""')}"`;

const pairTitle = (pairs, key) =>
  Array.isArray(pairs) && pairs.length
    ? pairs.map((pair) => pair?.[key] || '—').join('\n')
    : '';

const lineValues = (value) => textValue(value, '')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

function MultilineValue({ value }) {
  const lines = lineValues(value);
  if (!lines.length) return '—';
  return (
    <div className="space-y-1">
      {lines.map((line, idx) => (
        <div key={`${line}-${idx}`} className="whitespace-nowrap leading-5">{line}</div>
      ))}
    </div>
  );
}

function PartyDisputeLines({ rows, side, fallback, onEdit }) {
  if (!Array.isArray(rows)) return <MultilineValue value={fallback ?? rows} />;
  const lines = Array.isArray(rows) ? rows : [];
  if (!lines.length) return '—';
  return (
    <div className="space-y-2">
      {lines.map((line, idx) => (
        <div key={`${line.disputeIds?.join('-') || side}-${line.supplierName || line.buyerName || 'party'}-${idx}`} className="group flex items-start gap-2 leading-5">
          <div className="min-w-0">
            <div className="whitespace-nowrap">
              {[side === 'buyer' ? line.buyerName : line.supplierName, line.status].filter(Boolean).join(': ') || '—'}
            </div>
            {line.description && (
              <div className="mt-0.5 whitespace-pre-wrap text-[11px] leading-4 text-muted-foreground/85">
                {line.description}
              </div>
            )}
            {side === 'supplier' && isDeductBelowAmountStatus(line.status) && numericValue(line.deductionAmount) != null && (
              <div className="mt-0.5 text-[11px] font-medium leading-4 text-amber-700">
                Deduction amount: {fmtMoney(line.deductionAmount)}
              </div>
            )}
          </div>
          {line.disputeIds?.length ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onEdit?.({ ...line, side });
              }}
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground opacity-70 hover:border-primary/50 hover:text-primary group-hover:opacity-100"
              title="Edit dispute status and description"
            >
              <Pencil className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MoneyLines({ rows, field, fallback }) {
  const lines = Array.isArray(rows) && rows.length ? rows : null;
  if (!lines) return fmtMoney(fallback);
  return (
    <div className="space-y-1 text-right tabular-nums">
      {lines.map((line, idx) => (
        <div key={`${field}-${idx}-${line.supplierName || ''}`} className="whitespace-nowrap leading-5">
          {fmtMoney(line[field])}
        </div>
      ))}
    </div>
  );
}

const supplierRowsTitle = (rows, formatter) =>
  Array.isArray(rows) && rows.length
    ? rows.map(formatter).join('\n')
    : '';

const disputeStatusOptions = (side, currentStatus) => {
  const base = side === 'buyer' ? BUYER_DISPUTE_STATUS_OPTIONS : SUPPLIER_DISPUTE_STATUS_OPTIONS;
  const current = textValue(currentStatus, '').trim();
  if (!current || base.some(option => normalizeStatus(option) === normalizeStatus(current))) return base;
  return [...base, current];
};

const supplierMoneyCsv = (rows, field, fallback) =>
  Array.isArray(rows) && rows.length
    ? rows.map((row) => {
        const supplier = row.supplierName ? `${row.supplierName}: ` : '';
        return `${supplier}${fmtMoney(row[field])}`;
      }).join('\n')
    : fallback;

function Metric({ label, value, tone = 'default' }) {
  const toneClass = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-foreground';
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-dm text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

export default function DisputeManagement() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState(NOT_CLOSED_STATUSES);
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [documentsStem, setDocumentsStem] = useState(null);
  const [editingDispute, setEditingDispute] = useState(null);
  const [editStatus, setEditStatus] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDeductionAmount, setEditDeductionAmount] = useState('');
  const [editError, setEditError] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const loadRows = async () => {
    setLoading(true);
    setError(null);
    const res = await appClient.functions.invoke('salesforceDisputeStems', { limit: 10000 });
    if (res.data?.error) {
      setError(res.data.error);
      setRows([]);
    } else {
      setRows(res.data?.rows || []);
      setLastRefresh(new Date());
    }
    setLoading(false);
  };

  useEffect(() => { loadRows(); }, []);

  const selectedStatusKeys = useMemo(() => new Set(selectedStatuses.map(normalizeStatus)), [selectedStatuses]);
  const notClosedActive = NOT_CLOSED_STATUSES.every(status => selectedStatusKeys.has(normalizeStatus(status)))
    && !selectedStatusKeys.has(normalizeStatus('Closed'));

  const toggleStatus = (status) => {
    const statusKey = normalizeStatus(status);
    setSelectedStatuses(prev => {
      const hasStatus = prev.some(item => normalizeStatus(item) === statusKey);
      return hasStatus
        ? prev.filter(item => normalizeStatus(item) !== statusKey)
        : [...prev, status];
    });
  };

  const toggleNotClosed = () => {
    setSelectedStatuses(notClosedActive ? [] : NOT_CLOSED_STATUSES);
  };

  const openDisputeEdit = (line) => {
    setEditingDispute(line);
    setEditStatus(line.status || '');
    setEditDescription(line.description || '');
    setEditDeductionAmount(line.deductionAmount ?? '');
    setEditError(null);
  };

  const closeDisputeEdit = () => {
    if (savingEdit) return;
    setEditingDispute(null);
    setEditStatus('');
    setEditDescription('');
    setEditDeductionAmount('');
    setEditError(null);
  };

  const saveDisputeEdit = async () => {
    if (!editingDispute?.disputeIds?.length || savingEdit) return;
    const showDeductionAmount = editingDispute.side === 'supplier' && isDeductBelowAmountStatus(editStatus);
    setSavingEdit(true);
    setEditError(null);
    const res = await appClient.functions.invoke('salesforceDisputePartyUpdate', {
      disputeIds: editingDispute.disputeIds,
      side: editingDispute.side,
      status: editStatus,
      description: editDescription,
      deductionAmount: showDeductionAmount ? editDeductionAmount : null,
    });
    if (res.data?.error) {
      setEditError(res.data.error);
      setSavingEdit(false);
      return;
    }
    setEditingDispute(null);
    setEditStatus('');
    setEditDescription('');
    setEditDeductionAmount('');
    setSavingEdit(false);
    await loadRows();
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      const isActiveDispute = normalizeStatus(row.Dispute_Status__c) !== 'no dispute';
      const statusMatch = selectedStatusKeys.has(normalizeStatus(row.Dispute_Status__c));
      const textMatch = !q || [
        row._Display_Name,
        row._Buyer_Name,
        row._Supplier_Names,
        row._Product_Names,
        row._Buyer_Dispute_Label,
        row._Supplier_Dispute_Label,
        displayStatus(row.Dispute_Status__c),
      ].some(value => value != null && textValue(value, '').toLowerCase().includes(q));
      return isActiveDispute && statusMatch && textMatch;
    });
  }, [rows, search, selectedStatusKeys]);

  const totals = useMemo(() => ({
    count: filteredRows.length,
    receivable: filteredRows.reduce((sum, row) => sum + Number(row.Receivable_Balance__c || 0), 0),
    buyerInvoice: filteredRows.reduce((sum, row) => sum + Number(row.Total_Invoice_Amount__c || 0), 0),
    payable: filteredRows.reduce((sum, row) => sum + Number(row._Payable_Balance || 0), 0),
  }), [filteredRows]);

  const exportCsv = () => {
    const headers = ['Stem Name', 'Buyer Name', 'Supplier Name(s)', 'Product Name(s)', 'Buyer Dispute', 'Supplier Dispute', 'Dispute Status', 'Delivery Date', 'Expected Delivery', 'Buyer Invoice', 'Supplier Invoice', 'Receivable Balance', 'Payable Balance', 'Last Modified'];
    const csvRows = filteredRows.map(row => [
      row._Display_Name,
      row._Buyer_Name,
      row._Supplier_Names,
      row._Product_Names,
      row._Buyer_Dispute_Label,
      row._Supplier_Dispute_Label,
      displayStatus(row.Dispute_Status__c),
      row.Delivery_Date__c,
      row.Expected_Delivery_Date__c,
      row.Total_Invoice_Amount__c,
      supplierMoneyCsv(row._Supplier_Dispute_Rows, 'supplierInvoiceAmount', row.Total_Invoiced_Amount_From_Suppliers__c),
      row.Receivable_Balance__c,
      supplierMoneyCsv(row._Supplier_Dispute_Rows, 'payableBalance', row._Payable_Balance),
      row.LastModifiedDate,
    ]);
    const csv = [headers, ...csvRows].map(row => row.map(csvValue).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dispute-management-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const editStatusOptions = useMemo(
    () => disputeStatusOptions(editingDispute?.side, editStatus),
    [editingDispute?.side, editStatus]
  );
  const showEditDeductionAmount = editingDispute?.side === 'supplier' && isDeductBelowAmountStatus(editStatus);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        icon={AlertTriangle}
        eyebrow="Dispute workflow"
        title="Dispute Management"
        description="Manage all disputed STEMs from Salesforce, inspect detail, and export the working list."
        meta={lastRefresh ? `Last updated ${format(lastRefresh, 'HH:mm:ss')}` : 'Auto-loaded from Salesforce'}
        actions={(
          <>
            <Button variant="outline" onClick={exportCsv} disabled={loading || !filteredRows.length} className="gap-2">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button variant="outline" onClick={loadRows} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </Button>
          </>
        )}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Disputed STEMs" value={totals.count.toLocaleString()} tone="red" />
        <Metric label="Receivable Balance" value={fmtMoney(totals.receivable)} tone="amber" />
        <Metric label="Payable Balance" value={fmtMoney(totals.payable)} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search stem, buyer, supplier, product..." value={search} onChange={event => setSearch(event.target.value)} className="h-9 pl-8 text-xs" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</Label>
            <button type="button" onClick={toggleNotClosed} className="text-xs text-primary hover:underline">
              {notClosedActive ? 'Clear all' : 'Select Not Closed'}
            </button>
            <div className="flex flex-wrap gap-1.5">
              {ACTIVE_DISPUTE_STATUSES.map(status => (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggleStatus(status)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedStatusKeys.has(normalizeStatus(status))
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
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <TableShell title="Disputed STEMs" meta={`${filteredRows.length.toLocaleString()} rows`} bodyClassName="p-0">
        {loading ? (
          <StateBlock icon={Loader2} title="Loading disputes..." description="Fetching dispute STEMs from Salesforce." />
        ) : filteredRows.length ? (
          <div className="max-h-[68vh] overflow-auto">
            <table className="w-max min-w-full table-auto text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Stem Name</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Buyer Name</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Supplier Name(s)</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Product Name(s)</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Buyer Dispute</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Supplier Dispute</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Delivery</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Buyer Invoice</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Supplier Invoice</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Receivable Balance</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Payable Balance</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Modified</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Documents</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, idx) => {
                  const pairs = Array.isArray(row._Supplier_Product_Pairs) ? row._Supplier_Product_Pairs : [];
                  const supplierDisputeRows = Array.isArray(row._Supplier_Dispute_Rows) ? row._Supplier_Dispute_Rows : [];
                  const buyerDisputeRows = Array.isArray(row._Buyer_Dispute_Rows) ? row._Buyer_Dispute_Rows : [];
                  return (
                    <tr key={row.Id} onClick={() => setSelectedStemId(row.Id)} className={`cursor-pointer border-b border-border/40 hover:bg-muted/30 ${idx % 2 ? 'bg-muted/10' : ''}`}>
                      <td className="whitespace-nowrap px-3 py-2.5 font-medium text-foreground">{row._Display_Name || row.Name || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{row._Buyer_Name || '—'}</td>
                      <td className="px-3 py-2.5 text-muted-foreground" title={pairTitle(pairs, 'supplierName') || row._Supplier_Names || ''}>
                        {pairs.length ? (
                          <div className="space-y-1">
                            {pairs.map((pair, pairIdx) => (
                              <div key={`${pair.supplierName || 'supplier'}-${pair.productName || 'product'}-${pairIdx}`} className="whitespace-nowrap leading-5">
                                {pair.supplierName || '—'}
                              </div>
                            ))}
                          </div>
                        ) : (
                          row._Supplier_Names || '—'
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground" title={pairTitle(pairs, 'productName') || row._Product_Names || ''}>
                        {pairs.length ? (
                          <div className="space-y-1">
                            {pairs.map((pair, pairIdx) => (
                              <div key={`${pair.productName || 'product'}-${pair.supplierName || 'supplier'}-${pairIdx}`} className="whitespace-nowrap leading-5">
                                {pair.productName || '—'}
                              </div>
                            ))}
                          </div>
                        ) : (
                          row._Product_Names || '—'
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground" title={row._Buyer_Dispute_Label || ''}>
                        <PartyDisputeLines rows={buyerDisputeRows.length ? buyerDisputeRows : row._Buyer_Dispute_Label} side="buyer" fallback={row._Buyer_Dispute_Label} onEdit={openDisputeEdit} />
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground" title={supplierRowsTitle(supplierDisputeRows, (line) => [line.supplierName, line.status].filter(Boolean).join(': ')) || row._Supplier_Dispute_Label || ''}>
                        <PartyDisputeLines rows={supplierDisputeRows.length ? supplierDisputeRows : row._Supplier_Dispute_Label} side="supplier" fallback={row._Supplier_Dispute_Label} onEdit={openDisputeEdit} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">{displayStatus(row.Dispute_Status__c) || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{fmtDate(row._Effective_Date)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{fmtMoney(row.Total_Invoice_Amount__c)}</td>
                      <td className="px-3 py-2.5 font-medium text-foreground">
                        <MoneyLines rows={supplierDisputeRows} field="supplierInvoiceAmount" fallback={row.Total_Invoiced_Amount_From_Suppliers__c} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums font-semibold">{fmtMoney(row.Receivable_Balance__c)}</td>
                      <td className="px-3 py-2.5 font-medium text-foreground">
                        <MoneyLines rows={supplierDisputeRows} field="payableBalance" fallback={row._Payable_Balance} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">{fmtDate(row.LastModifiedDate)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5"
                          onClick={(event) => {
                            event.stopPropagation();
                            setDocumentsStem(row);
                          }}
                        >
                          <FileText className="h-3.5 w-3.5" /> Manage
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <StateBlock title="No disputed STEMs found" description="No records match the current dispute filters." />
        )}
      </TableShell>

      <StemDetailModal stemId={selectedStemId} open={!!selectedStemId} onClose={() => setSelectedStemId(null)} onUpdated={loadRows} />
      <DisputeDocumentsModal stem={documentsStem} open={!!documentsStem} onClose={() => setDocumentsStem(null)} />
      <Dialog open={!!editingDispute} onOpenChange={(open) => { if (!open) closeDisputeEdit(); }}>
        <DialogContent className="w-[min(560px,94vw)] max-w-none">
          <DialogHeader>
            <DialogTitle>Edit {editingDispute?.side === 'buyer' ? 'Buyer' : 'Supplier'} Dispute</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Party</div>
              <div className="mt-1 font-medium text-foreground">
                {editingDispute?.side === 'buyer' ? editingDispute?.buyerName : editingDispute?.supplierName || '—'}
              </div>
              {editingDispute?.disputeIds?.length > 1 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  This will update {editingDispute.disputeIds.length} duplicate dispute records for the same party.
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select dispute status" />
                </SelectTrigger>
                <SelectContent>
                  {editStatusOptions.map((status) => (
                    <SelectItem key={status} value={status}>{status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {showEditDeductionAmount && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deduction Amount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editDeductionAmount}
                  onChange={(event) => setEditDeductionAmount(event.target.value)}
                  placeholder="Amount to deduct"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</Label>
              <Textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} placeholder="Dispute description" rows={5} />
            </div>

            {editError && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {editError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeDisputeEdit} disabled={savingEdit}>Cancel</Button>
              <Button type="button" onClick={saveDisputeEdit} disabled={savingEdit} className="gap-2">
                {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
