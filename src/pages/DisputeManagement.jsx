import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileText, Loader2, RefreshCw, Search, X } from 'lucide-react';
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

const disputeStatusOptions = (side, currentStatus) => {
  const base = side === 'buyer' ? BUYER_DISPUTE_STATUS_OPTIONS : SUPPLIER_DISPUTE_STATUS_OPTIONS;
  const current = textValue(currentStatus, '').trim();
  if (!current || base.some(option => normalizeStatus(option) === normalizeStatus(current))) return base;
  return [...base, current];
};

const compactSupplierSummary = (row) => {
  const names = new Set();
  const pairs = Array.isArray(row._Supplier_Product_Pairs) ? row._Supplier_Product_Pairs : [];
  const supplierRows = Array.isArray(row._Supplier_Dispute_Rows) ? row._Supplier_Dispute_Rows : [];
  for (const pair of pairs) if (pair?.supplierName) names.add(pair.supplierName);
  for (const supplierRow of supplierRows) if (supplierRow?.supplierName) names.add(supplierRow.supplierName);
  for (const name of textValue(row._Supplier_Names, '').split(',')) {
    const trimmed = name.trim();
    if (trimmed) names.add(trimmed);
  }
  const list = [...names];
  if (!list.length) return '—';
  if (list.length === 1) return list[0];
  return `${list[0]} +${list.length - 1}`;
};

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
      setLoading(false);
      return [];
    } else {
      const nextRows = res.data?.rows || [];
      setRows(nextRows);
      setLastRefresh(new Date());
      setLoading(false);
      return nextRows;
    }
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
    const nextRows = await loadRows();
    setDocumentsStem(prev => prev ? nextRows.find(row => row.Id === prev.Id) || prev : prev);
  };

  const refreshManagedStem = async (stemId) => {
    const nextRows = await loadRows();
    setDocumentsStem(prev => {
      const targetId = stemId || prev?.Id;
      return prev && targetId ? nextRows.find(row => row.Id === targetId) || prev : prev;
    });
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
    payable: filteredRows.reduce((sum, row) => sum + Number(row._Payable_Balance || 0), 0),
  }), [filteredRows]);

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
        description="Manage all disputed STEMs from Salesforce, inspect detail, and maintain dispute documents."
        meta={lastRefresh ? `Last updated ${format(lastRefresh, 'HH:mm:ss')}` : 'Auto-loaded from Salesforce'}
        actions={(
          <Button variant="outline" onClick={loadRows} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </Button>
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
            <table className="w-full min-w-[980px] table-auto text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Stem Name</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Buyer</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Supplier(s)</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Delivery</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Receivable / Payable</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Modified</th>
                  <th className="sticky top-0 z-10 whitespace-nowrap bg-card px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Manage</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, idx) => {
                  const supplierSummary = compactSupplierSummary(row);
                  return (
                    <tr key={row.Id} onClick={() => setSelectedStemId(row.Id)} className={`cursor-pointer border-b border-border/40 hover:bg-muted/30 ${idx % 2 ? 'bg-muted/10' : ''}`}>
                      <td className="whitespace-nowrap px-3 py-2.5 font-medium text-foreground">{row._Display_Name || row.Name || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{displayStatus(row.Dispute_Status__c) || '—'}</td>
                      <td className="max-w-[240px] truncate whitespace-nowrap px-3 py-2.5 text-muted-foreground" title={row._Buyer_Name || ''}>{row._Buyer_Name || '—'}</td>
                      <td className="max-w-[260px] truncate whitespace-nowrap px-3 py-2.5 text-muted-foreground" title={row._Supplier_Names || supplierSummary}>{supplierSummary}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{fmtDate(row._Effective_Date)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                        <div className="font-semibold text-foreground">{fmtMoney(row.Receivable_Balance__c)}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtMoney(row._Payable_Balance)}</div>
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
      <DisputeDocumentsModal
        stem={documentsStem}
        open={!!documentsStem}
        onClose={() => setDocumentsStem(null)}
        onEditDispute={openDisputeEdit}
        onStatusUpdated={refreshManagedStem}
      />
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
