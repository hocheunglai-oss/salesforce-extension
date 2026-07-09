import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleDollarSign, FileCheck2, Loader2, RefreshCw, Search, Send, ShieldCheck, X } from 'lucide-react';
import { format } from 'date-fns';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import StemDetailModal from '@/components/dashboard/StemDetailModal';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { numericValue, textValue } from '@/lib/displayValue';
import { cn } from '@/lib/utils';

const ACTIVE_STAGES = ['Draft', 'Pending Approval', 'Approved - Pending Execution', 'Rejected', 'Revision Requested', 'Executed', 'Closed'];
const DISPUTE_DELIVERY_DATE_MIN = '2026-01-01';
const ACTION_TYPES = [
  { value: 'hold_supplier_payment', label: 'Hold supplier payment', partyType: 'supplier' },
  { value: 'pay_full_supplier_invoice', label: 'Pay full supplier invoice amount', partyType: 'supplier' },
  { value: 'deduct_specific_amount', label: 'Deduct specific amount', partyType: 'supplier' },
  { value: 'issue_buyer_credit_note', label: 'Issue credit note to buyer', partyType: 'buyer' },
  { value: 'close_supplier_dispute', label: 'Close dispute with supplier', partyType: 'supplier' },
  { value: 'close_buyer_dispute', label: 'Close dispute with buyer', partyType: 'buyer' },
];
const SUPPLIER_CLOSE_REASONS = [
  'Full payment received from buyer',
  'Settlement agreement concluded with credit note / written agreement enclosed',
];
const BUYER_CLOSE_REASONS = [
  'Full payment received from buyer',
  'Settlement agreement concluded with written agreement enclosed',
];
const BALANCE_PAYMENT_INSTRUCTIONS = ['No Balance Payment', 'Pay Immediately', 'Pay with next supplier invoice'];
const DEFAULT_ACTION = {
  actionType: 'hold_supplier_payment',
  partyType: 'supplier',
  partyName: '',
  disputeIds: [],
  amount: '',
  specialSellPrice: '',
  specialBuyPrice: '',
  quantity: '',
  quantityUnit: 'MT',
  closeReason: '',
  balancePaymentInstruction: '',
  description: '',
  requiresAttachment: false,
};

const fmtMoney = (value) => {
  const number = numericValue(value);
  if (number == null) return '—';
  return `$${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (value) => {
  if (!value) return '—';
  try { return format(new Date(value), 'dd MMM yyyy'); } catch { return textValue(value, '—'); }
};

const fmtDateTime = (value) => {
  if (!value) return '—';
  try { return format(new Date(value), 'dd MMM yyyy HH:mm'); } catch { return textValue(value, '—'); }
};

const numberOrNull = (value) => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const isDeliveryDateAllowed = (row) => {
  const deliveryDate = textValue(row?.Delivery_Date__c, '').slice(0, 10);
  return !deliveryDate || deliveryDate >= DISPUTE_DELIVERY_DATE_MIN;
};

const actionLabel = (type) => ACTION_TYPES.find((item) => item.value === type)?.label || type || 'Action';
const actionPartyType = (type) => ACTION_TYPES.find((item) => item.value === type)?.partyType || 'supplier';

const stemBasePnl = (stem) => {
  const direct = numberOrNull(stem?._Stem_Base_Pnl);
  if (direct != null) return direct;
  const buyer = numberOrNull(stem?._Buyer_Finance_Row?.buyerInvoiceAmount ?? stem?.Total_Invoice_Amount__c);
  const supplier = numberOrNull(stem?.Total_Invoiced_Amount_From_Suppliers__c);
  if (buyer == null || supplier == null) return null;
  return buyer - supplier;
};

const supplierDueRows = (row) => Array.isArray(row?._Supplier_Invoice_Due_Rows) ? row._Supplier_Invoice_Due_Rows : [];

const fallbackList = (value) => textValue(value, '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function queueDetailLines(row) {
  const rows = supplierDueRows(row);
  if (rows.length) {
    const seenSupplierGroups = new Set();
    return rows.map((dueRow, index) => {
      const supplierName = dueRow.supplierName || 'Supplier';
      const dueDate = dueRow.dueDate || null;
      const invoiceName = dueRow.invoiceName || '';
      const groupKey = `${supplierName}\u0000${dueDate || ''}\u0000${invoiceName}`;
      const showSupplier = !seenSupplierGroups.has(groupKey);
      seenSupplierGroups.add(groupKey);
      return {
        key: `${groupKey}\u0000${dueRow.productQuantityLabel || dueRow.productName || index}`,
        productLabel: dueRow.productQuantityLabel || dueRow.productName || '—',
        supplierName,
        dueDate,
        invoiceName,
        showSupplier,
      };
    });
  }

  const products = fallbackList(row?._Product_Names);
  const suppliers = fallbackList(row?._Supplier_Names);
  const count = Math.max(products.length, suppliers.length, 1);
  return Array.from({ length: count }, (_, index) => ({
    key: `fallback-${index}`,
    productLabel: products[index] || (index === 0 ? '—' : ''),
    supplierName: suppliers[index] || '',
    dueDate: null,
    invoiceName: '',
    showSupplier: Boolean(suppliers[index]),
  }));
}

function Metric({ label, value, tone = 'default' }) {
  const toneClass = tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-foreground';
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-dm text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function stageTone(stage) {
  if (stage === 'Pending Approval') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (stage === 'Approved - Pending Execution') return 'border-blue-200 bg-blue-50 text-blue-800';
  if (stage === 'Executed' || stage === 'Closed') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (stage === 'Rejected' || stage === 'Revision Requested') return 'border-red-200 bg-red-50 text-red-800';
  return 'border-border bg-muted/50 text-muted-foreground';
}

function settlementFinancials(actions = []) {
  let buyerImpact = 0;
  let supplierImpact = 0;
  let buyerCreditNoteImpact = 0;
  let supplierCreditNoteImpact = 0;
  const lines = [];

  for (const action of actions) {
    const amount = numberOrNull(action.amount);
    if (action.actionType === 'issue_buyer_credit_note' && amount != null) {
      buyerImpact -= amount;
      lines.push({ label: 'Buyer credit note', impact: -amount });
    }
    if (action.actionType === 'deduct_specific_amount' && amount != null) {
      supplierImpact += amount;
      lines.push({ label: 'Supplier deduction', impact: amount });
    }
    const buyerCreditNote = numberOrNull(action.specialSellPrice);
    if (buyerCreditNote != null && buyerCreditNote > 0) {
      const impact = -buyerCreditNote;
      buyerCreditNoteImpact += impact;
      lines.push({ label: 'Buyer agreed credit note', buyerCreditNote, impact });
    }
    const supplierCreditNote = numberOrNull(action.specialBuyPrice);
    if (supplierCreditNote != null && supplierCreditNote > 0) {
      const impact = supplierCreditNote;
      supplierCreditNoteImpact += impact;
      lines.push({ label: 'Supplier agreed credit note', supplierCreditNote, impact });
    }
  }

  return {
    buyerImpact,
    supplierImpact,
    buyerCreditNoteImpact,
    supplierCreditNoteImpact,
    specialPricePnl: buyerCreditNoteImpact + supplierCreditNoteImpact,
    settlementPnl: buyerImpact + supplierImpact + buyerCreditNoteImpact + supplierCreditNoteImpact,
    lines,
  };
}

function partyOptions(stem, type) {
  if (!stem) return [];
  if (type === 'buyer') {
    const buyerRows = Array.isArray(stem._Buyer_Dispute_Rows) ? stem._Buyer_Dispute_Rows : [];
    if (buyerRows.length) {
      return buyerRows.map((row, index) => ({
        key: `buyer-${index}-${row.buyerName || stem._Buyer_Name || 'buyer'}`,
        type: 'buyer',
        name: row.buyerName || stem._Buyer_Name || 'Buyer',
        disputeIds: row.disputeIds || [],
        label: row.buyerName || stem._Buyer_Name || 'Buyer',
      }));
    }
    return [{
      key: 'buyer-default',
      type: 'buyer',
      name: stem._Buyer_Name || 'Buyer',
      disputeIds: [],
      label: stem._Buyer_Name || 'Buyer',
    }];
  }
  const supplierRows = Array.isArray(stem._Supplier_Finance_Rows_All) && stem._Supplier_Finance_Rows_All.length
    ? stem._Supplier_Finance_Rows_All
    : Array.isArray(stem._Supplier_Dispute_Rows)
      ? stem._Supplier_Dispute_Rows
      : [];
  if (supplierRows.length) {
    return supplierRows.map((row, index) => ({
      key: `supplier-${index}-${row.supplierName || 'supplier'}`,
      type: 'supplier',
      name: row.supplierName || 'Supplier',
      disputeIds: row.disputeIds || [],
      label: row.supplierName || 'Supplier',
    }));
  }
  return textValue(stem._Supplier_Names, '')
    .split(',')
    .map((name, index) => name.trim() && ({
      key: `supplier-fallback-${index}`,
      type: 'supplier',
      name: name.trim(),
      disputeIds: [],
      label: name.trim(),
    }))
    .filter(Boolean);
}

function normalizeActionForSave(action) {
  return {
    actionType: action.actionType,
    partyType: action.partyType,
    partyName: action.partyName,
    disputeIds: action.disputeIds || [],
    amount: numberOrNull(action.amount),
    specialSellPrice: numberOrNull(action.specialSellPrice),
    specialBuyPrice: numberOrNull(action.specialBuyPrice),
    quantity: numberOrNull(action.quantity),
    quantityUnit: action.quantityUnit || 'MT',
    closeReason: action.closeReason || '',
    balancePaymentInstruction: action.balancePaymentInstruction || '',
    description: action.description || '',
    requiresAttachment: action.requiresAttachment === true,
    executionStatus: action.executionStatus || 'Pending Execution',
  };
}

function workflowFromRow(row) {
  return row?._Dispute_Beta || { case: null, actions: [], events: [] };
}

function editableWorkflow(caseRow) {
  return !caseRow || ['Draft', 'Rejected', 'Revision Requested'].includes(caseRow.workflowStatus);
}

function actionExecutionPending(action) {
  return action.executionStatus !== 'Executed' && action.executionStatus !== 'Not Required';
}

function ActionForm({ stem, draftAction, setDraftAction, onAdd, disabled }) {
  const parties = partyOptions(stem, draftAction.partyType);
  const selectedPartyKey = parties.find((party) => party.name === draftAction.partyName)?.key || parties[0]?.key || '';
  const showAmount = draftAction.actionType === 'deduct_specific_amount' || draftAction.actionType === 'issue_buyer_credit_note';
  const showSupplierClose = draftAction.actionType === 'close_supplier_dispute';
  const showBuyerClose = draftAction.actionType === 'close_buyer_dispute';

  const updateActionType = (value) => {
    const nextPartyType = actionPartyType(value);
    const nextParties = partyOptions(stem, nextPartyType);
    const firstParty = nextParties[0];
    setDraftAction({
      ...DEFAULT_ACTION,
      actionType: value,
      partyType: nextPartyType,
      partyName: firstParty?.name || '',
      disputeIds: firstParty?.disputeIds || [],
    });
  };

  const updateParty = (key) => {
    const selected = parties.find((party) => party.key === key);
    if (!selected) return;
    setDraftAction((prev) => ({
      ...prev,
      partyType: selected.type,
      partyName: selected.name,
      disputeIds: selected.disputeIds,
    }));
  };

  return (
    <div className="rounded-xl border border-border bg-muted/10 p-3">
      <div className="grid gap-3 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Action</Label>
          <Select value={draftAction.actionType} onValueChange={updateActionType} disabled={disabled}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACTION_TYPES.map((action) => <SelectItem key={action.value} value={action.value}>{action.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Party</Label>
          <Select value={selectedPartyKey} onValueChange={updateParty} disabled={disabled}>
            <SelectTrigger><SelectValue placeholder="Select party" /></SelectTrigger>
            <SelectContent>
              {parties.map((party) => <SelectItem key={party.key} value={party.key}>{party.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {showAmount && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Amount</Label>
            <Input type="number" min="0" step="0.01" value={draftAction.amount} onChange={(event) => setDraftAction((prev) => ({ ...prev, amount: event.target.value }))} disabled={disabled} />
          </div>
        )}
        {showSupplierClose && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Close reason</Label>
            <Select value={draftAction.closeReason} onValueChange={(value) => setDraftAction((prev) => ({ ...prev, closeReason: value }))} disabled={disabled}>
              <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
              <SelectContent>
                {SUPPLIER_CLOSE_REASONS.map((reason) => <SelectItem key={reason} value={reason}>{reason}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {showBuyerClose && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Close reason</Label>
            <Select value={draftAction.closeReason} onValueChange={(value) => setDraftAction((prev) => ({ ...prev, closeReason: value }))} disabled={disabled}>
              <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
              <SelectContent>
                {BUYER_CLOSE_REASONS.map((reason) => <SelectItem key={reason} value={reason}>{reason}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {showSupplierClose && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Balance payment</Label>
            <Select value={draftAction.balancePaymentInstruction} onValueChange={(value) => setDraftAction((prev) => ({ ...prev, balancePaymentInstruction: value }))} disabled={disabled}>
              <SelectTrigger><SelectValue placeholder="Select instruction" /></SelectTrigger>
              <SelectContent>
                {BALANCE_PAYMENT_INSTRUCTIONS.map((instruction) => <SelectItem key={instruction} value={instruction}>{instruction}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-border bg-card/70 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Settlement credit notes</div>
            <div className="text-[11px] text-muted-foreground">Lump-sum agreed credit notes only. Quantity is not used for settlement P&L.</div>
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Buyer credit note amount</Label>
            <Input type="number" min="0" step="0.01" value={draftAction.specialSellPrice} onChange={(event) => setDraftAction((prev) => ({ ...prev, specialSellPrice: event.target.value }))} disabled={disabled} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Supplier credit note amount</Label>
            <Input type="number" min="0" step="0.01" value={draftAction.specialBuyPrice} onChange={(event) => setDraftAction((prev) => ({ ...prev, specialBuyPrice: event.target.value }))} disabled={disabled} />
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Instruction note</Label>
          <Textarea value={draftAction.description} onChange={(event) => setDraftAction((prev) => ({ ...prev, description: event.target.value }))} disabled={disabled} rows={2} />
        </div>
        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={draftAction.requiresAttachment} onCheckedChange={(checked) => setDraftAction((prev) => ({ ...prev, requiresAttachment: checked === true }))} disabled={disabled} />
            Agreement/document required
          </label>
          <Button type="button" onClick={onAdd} disabled={disabled} className="gap-2">
            <Send className="h-4 w-4" /> Add Action
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepHeading({ step, title, description }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-xs font-bold text-primary">{step}</div>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

function FinancialExposureSection({ stem }) {
  const buyerExposure = stem?._Buyer_Finance_Row || {
    buyerName: stem?._Buyer_Name,
    buyerInvoiceAmount: stem?.Total_Invoice_Amount__c,
    receivableBalance: stem?.Receivable_Balance__c,
    status: stem?._Buyer_Dispute_Label,
  };
  const supplierRows = Array.isArray(stem?._Supplier_Finance_Rows_All) && stem._Supplier_Finance_Rows_All.length
    ? stem._Supplier_Finance_Rows_All
    : Array.isArray(stem?._Supplier_Dispute_Rows)
      ? stem._Supplier_Dispute_Rows
      : [];

  return (
    <section className="space-y-3 rounded-xl border border-border bg-muted/10 p-4">
      <StepHeading
        step="1"
        title="Financial Exposure"
        description="Receivable from buyer and payable to every supplier invoice are shown even when that party is not currently under dispute."
      />
      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer receivable</div>
          <div className="mt-2 text-sm font-semibold text-foreground">{buyerExposure.buyerName || stem?._Buyer_Name || 'Buyer'}</div>
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2 text-sm">
            <div className="text-muted-foreground">Buyer invoice amount</div>
            <div className="font-semibold tabular-nums">{fmtMoney(buyerExposure.buyerInvoiceAmount)}</div>
            <div className="text-muted-foreground">Receivable balance</div>
            <div className="font-semibold tabular-nums">{fmtMoney(buyerExposure.receivableBalance)}</div>
            <div className="text-muted-foreground">Buyer dispute status</div>
            <div className="max-w-[220px] whitespace-pre-line text-right text-xs text-muted-foreground">{buyerExposure.status || 'Not under buyer dispute'}</div>
          </div>
          {buyerExposure.description && <div className="mt-3 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">{buyerExposure.description}</div>}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full min-w-[620px] text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Supplier</th>
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">Supplier Invoice</th>
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">Payable</th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Dispute</th>
              </tr>
            </thead>
            <tbody>
              {supplierRows.map((row, index) => (
                <tr key={`${row.supplierName || 'supplier'}-${index}`} className="border-b border-border/40">
                  <td className="px-3 py-2 font-medium text-foreground">{row.supplierName || 'Supplier'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(row.supplierInvoiceAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(row.payableBalance)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <div>{row.status || 'Not under supplier dispute'}</div>
                    {row.description && <div className="mt-0.5 text-[11px]">{row.description}</div>}
                    {Array.isArray(row.disputeIds) && row.disputeIds.length > 1 && <div className="mt-0.5 text-[11px]">{row.disputeIds.length} linked records</div>}
                  </td>
                </tr>
              ))}
              {!supplierRows.length && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No supplier invoice or payable rows found for this STEM.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function ManageBetaModal({ stem, open, onClose, onSaved, isDisputeAdmin }) {
  const workflow = workflowFromRow(stem);
  const [caseRow, setCaseRow] = useState(workflow.case);
  const [actions, setActions] = useState(workflow.actions || []);
  const [events, setEvents] = useState(workflow.events || []);
  const [note, setNote] = useState(workflow.case?.latestNote || '');
  const [draftAction, setDraftAction] = useState(DEFAULT_ACTION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const nextWorkflow = workflowFromRow(stem);
    const supplierParty = partyOptions(stem, 'supplier')[0];
    setCaseRow(nextWorkflow.case);
    setActions(nextWorkflow.actions || []);
    setEvents(nextWorkflow.events || []);
    setNote(nextWorkflow.case?.latestNote || '');
    setDraftAction({
      ...DEFAULT_ACTION,
      partyName: supplierParty?.name || '',
      disputeIds: supplierParty?.disputeIds || [],
    });
    setError(null);
  }, [stem]);

  if (!open || !stem) return null;

  const canEdit = editableWorkflow(caseRow);
  const canSubmit = canEdit && actions.length > 0;
  const canApprove = isDisputeAdmin && caseRow?.approvalStatus === 'Pending Approval';
  const canExecute = caseRow?.approvalStatus === 'Approved';
  const financials = settlementFinancials(actions);
  const basePnl = stemBasePnl(stem);
  const stemPnlIncludingDispute = basePnl == null ? null : basePnl + financials.settlementPnl;

  const refreshAfter = async (response) => {
    if (response?.case) setCaseRow(response.case);
    if (response?.actions) setActions(response.actions);
    await onSaved?.(stem.Id);
  };

  const invokeWorkflow = async (name, payload) => {
    setBusy(true);
    setError(null);
    const res = await appClient.functions.invoke(name, payload);
    if (res.data?.error) {
      setError(res.data.error);
      setBusy(false);
      return null;
    }
    await refreshAfter(res.data);
    setBusy(false);
    return res.data;
  };

  const addAction = () => {
    if (!draftAction.partyName) {
      setError('Select a buyer or supplier party before adding the action.');
      return;
    }
    if ((draftAction.actionType === 'deduct_specific_amount' || draftAction.actionType === 'issue_buyer_credit_note') && numberOrNull(draftAction.amount) == null) {
      setError('Amount is required for this action.');
      return;
    }
    if (draftAction.actionType === 'close_supplier_dispute' && (!draftAction.closeReason || !draftAction.balancePaymentInstruction)) {
      setError('Supplier close reason and balance payment instruction are required.');
      return;
    }
    if (draftAction.actionType === 'close_buyer_dispute' && !draftAction.closeReason) {
      setError('Buyer close reason is required.');
      return;
    }
    setActions((prev) => [...prev, { ...draftAction, clientId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, actionLabel: actionLabel(draftAction.actionType), executionStatus: 'Pending Execution' }]);
    setDraftAction((prev) => ({ ...DEFAULT_ACTION, partyType: prev.partyType, actionType: prev.actionType, partyName: prev.partyName, disputeIds: prev.disputeIds }));
    setError(null);
  };

  const removeAction = (index) => setActions((prev) => prev.filter((_, actionIndex) => actionIndex !== index));
  const saveDraft = () => invokeWorkflow('disputeBetaSaveDraft', {
    stem,
    actions: actions.map(normalizeActionForSave),
    latestNote: note,
  });
  const submitForApproval = async () => {
    const saved = await saveDraft();
    if (!saved?.case?.id) return;
    await invokeWorkflow('disputeBetaSubmitApproval', { caseId: saved.case.id, note });
  };
  const approve = () => invokeWorkflow('disputeBetaApprove', { caseId: caseRow.id, note: 'Approved in Dispute Beta.' });
  const reject = (revisionRequested = false) => {
    const reason = window.prompt(revisionRequested ? 'Revision reason' : 'Rejection reason');
    if (reason == null) return;
    invokeWorkflow('disputeBetaReject', { caseId: caseRow.id, reason, revisionRequested });
  };
  const executeAction = (action) => {
    const executionNote = window.prompt('Execution note', action.executionNote || '');
    if (executionNote == null) return;
    invokeWorkflow('disputeBetaMarkExecuted', { actionId: action.id, note: executionNote });
  };
  const closeWorkflow = () => invokeWorkflow('disputeBetaClose', { caseId: caseRow.id, note: 'Closed in Dispute Beta.' });

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="flex h-[92vh] w-[min(1180px,96vw)] max-w-none flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle className="pr-8">Dispute Beta - {stem._Display_Name || stem.Name}</DialogTitle>
        </DialogHeader>

        <div className="grid shrink-0 gap-3 border-b border-border bg-muted/10 px-5 py-3 md:grid-cols-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Workflow</div>
            <span className={cn('mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold', stageTone(caseRow?.workflowStatus || 'Draft'))}>{caseRow?.workflowStatus || 'Draft'}</span>
          </div>
          <Summary label="Buyer" value={stem._Buyer_Name || '—'} />
          <Summary label="Supplier(s)" value={stem._Supplier_Names || '—'} />
          <Summary label="STEM P&L (Including Dispute P&L)" value={fmtMoney(stemPnlIncludingDispute)} align="right" strong tone={(stemPnlIncludingDispute || 0) >= 0 ? 'green' : 'red'} />
          <Summary label="Dispute P&L" value={fmtMoney(financials.settlementPnl)} align="right" strong tone={financials.settlementPnl >= 0 ? 'green' : 'red'} />
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
          {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          {caseRow?.salesforceWritebackStatus && caseRow.salesforceWritebackStatus !== 'not_started' && (
            <div className={cn('rounded-lg border p-3 text-xs', caseRow.salesforceWritebackStatus === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900')}>
              Salesforce writeback: {caseRow.salesforceWritebackStatus}
              {caseRow.salesforceWritebackError ? <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{caseRow.salesforceWritebackError}</pre> : null}
            </div>
          )}

          <FinancialExposureSection stem={stem} />

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <StepHeading
                step="2"
                title="Trader Actions"
                description="Add one action per supplier or buyer side. Many suppliers can be linked to one buyer case, and buyer-side action is optional."
              />
              {!canEdit && <span className="text-xs text-muted-foreground">Actions are locked after submission.</span>}
            </div>
            <ActionForm stem={stem} draftAction={draftAction} setDraftAction={setDraftAction} onAdd={addAction} disabled={!canEdit || busy} />
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full min-w-[980px] text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Action</th>
                    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Party</th>
                    <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">Amount</th>
                    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Close / Balance</th>
                    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Execution</th>
                    <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">Control</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((action, index) => (
                    <tr key={action.id || action.clientId || index} className="border-b border-border/40">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{action.actionLabel || actionLabel(action.actionType)}</div>
                        {action.description && <div className="mt-0.5 text-muted-foreground">{action.description}</div>}
                        {(action.specialSellPrice || action.specialBuyPrice) && (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {action.specialSellPrice ? `Buyer CN ${fmtMoney(action.specialSellPrice)}` : null}
                            {action.specialSellPrice && action.specialBuyPrice ? ' / ' : null}
                            {action.specialBuyPrice ? `Supplier CN ${fmtMoney(action.specialBuyPrice)}` : null}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{action.partyName || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(action.amount)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <div>{action.closeReason || '—'}</div>
                        {action.balancePaymentInstruction && <div>{action.balancePaymentInstruction}</div>}
                        {action.requiresAttachment && <div className="text-amber-700">Attachment required</div>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn('rounded-full border px-2 py-0.5 text-xs', action.executionStatus === 'Executed' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-border bg-muted/50 text-muted-foreground')}>
                          {action.executionStatus || 'Pending Execution'}
                        </span>
                        {action.executedAt && <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtDateTime(action.executedAt)}</div>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canEdit ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => removeAction(index)} disabled={busy}>Remove</Button>
                        ) : canExecute && action.id && actionExecutionPending(action) ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => executeAction(action)} disabled={busy}>Mark executed</Button>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                  {!actions.length && (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No trader actions added.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-muted/10 p-4">
              <StepHeading
                step="3"
        title="Settlement Credit Notes & Dispute P&L"
        description="Buyer credit notes reduce P&L. Supplier credit notes and supplier deductions increase P&L."
      />
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2 text-sm">
                <div className="text-muted-foreground">Buyer instruction impact</div><div className="font-semibold tabular-nums">{fmtMoney(financials.buyerImpact)}</div>
                <div className="text-muted-foreground">Supplier deduction impact</div><div className="font-semibold tabular-nums">{fmtMoney(financials.supplierImpact)}</div>
                <div className="text-muted-foreground">Buyer credit note impact</div><div className="font-semibold tabular-nums">{fmtMoney(financials.buyerCreditNoteImpact)}</div>
                <div className="text-muted-foreground">Supplier credit note impact</div><div className="font-semibold tabular-nums">{fmtMoney(financials.supplierCreditNoteImpact)}</div>
                <div className="border-t border-border pt-2 font-semibold">Dispute P&L</div><div className="border-t border-border pt-2 font-semibold tabular-nums">{fmtMoney(financials.settlementPnl)}</div>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-muted/10 p-4">
              <h3 className="text-sm font-semibold text-foreground">Submission Note</h3>
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={5} disabled={!canEdit || busy} className="mt-3" />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-muted/10 p-4">
            <StepHeading
              step="4"
              title="Approval & Audit Trail"
              description="Dispute administrators approve before accounts/admin proceed with supplier payment or buyer credit note execution."
            />
            <div className="mt-3 space-y-2">
              {events.map((event) => (
                <div key={event.id} className="grid gap-2 rounded-lg border border-border bg-card p-2 text-xs md:grid-cols-[150px_160px_1fr]">
                  <div className="text-muted-foreground">{fmtDateTime(event.createdAt)}</div>
                  <div className="font-semibold text-foreground">{event.eventType}</div>
                  <div className="text-muted-foreground">{event.note || event.actorEmail || '—'}</div>
                </div>
              ))}
              {!events.length && <div className="text-sm text-muted-foreground">No audit events yet.</div>}
            </div>
          </section>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <div className="text-xs text-muted-foreground">
            {caseRow?.approvedByEmail ? `Approved by ${caseRow.approvedByEmail} at ${fmtDateTime(caseRow.approvedAt)}` : 'Approval required from Vincent Lee or Stanley Chui.'}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Close</Button>
            {canEdit && <Button type="button" variant="outline" onClick={saveDraft} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save Draft</Button>}
            {canSubmit && <Button type="button" onClick={submitForApproval} disabled={busy} className="gap-2"><Send className="h-4 w-4" /> Submit for Approval</Button>}
            {canApprove && <Button type="button" variant="outline" onClick={() => reject(true)} disabled={busy}>Request Revision</Button>}
            {canApprove && <Button type="button" variant="outline" onClick={() => reject(false)} disabled={busy}>Reject</Button>}
            {canApprove && <Button type="button" onClick={approve} disabled={busy} className="gap-2"><ShieldCheck className="h-4 w-4" /> Approve</Button>}
            {caseRow?.approvalStatus === 'Approved' && caseRow.workflowStatus !== 'Closed' && <Button type="button" onClick={closeWorkflow} disabled={busy} className="gap-2"><CheckCircle2 className="h-4 w-4" /> Close Workflow</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Summary({ label, value, align = 'left', strong = false, tone = 'default' }) {
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 truncate text-sm', strong ? 'font-semibold' : 'font-medium', tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : 'text-foreground')}>{value}</div>
    </div>
  );
}

export default function DisputeBeta() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedStages, setSelectedStages] = useState(['Draft', 'Pending Approval', 'Approved - Pending Execution', 'Revision Requested']);
  const [managedStem, setManagedStem] = useState(null);
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [isDisputeAdmin, setIsDisputeAdmin] = useState(false);
  const [fieldWarning, setFieldWarning] = useState('');

  const loadRows = async (options = {}) => {
    setLoading(true);
    setError(null);
    const res = await appClient.functions.invoke('disputeBetaList', { limit: 10000 }, { cache: true, force: options.force });
    if (res.data?.error) {
      setError(res.data.error);
      setRows([]);
      setLoading(false);
      return [];
    }
    const nextRows = res.data?.rows || [];
    setRows(nextRows);
    setIsDisputeAdmin(Boolean(res.data?.isDisputeAdmin));
    setFieldWarning(res.data?.fieldWarning || '');
    setLastRefresh(new Date());
    setLoading(false);
    return nextRows;
  };

  useEffect(() => { loadRows(); }, []);

  const selectedStageSet = useMemo(() => new Set(selectedStages), [selectedStages]);
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!isDeliveryDateAllowed(row)) return false;
      const beta = workflowFromRow(row);
      const stage = beta.case?.workflowStatus || 'Draft';
      const stageMatch = selectedStageSet.has(stage);
      const textMatch = !q || [
        row._Display_Name,
        row._Buyer_Name,
        row._Supplier_Names,
        row._Product_Names,
        row.Delivery_Date__c,
        row._Buyer_Invoice_Due_Date,
        queueDetailLines(row).map((line) => [line.supplierName, line.invoiceName, line.productLabel, line.dueDate].filter(Boolean).join(' ')).join(' '),
        row.Dispute_Status__c,
        beta.case?.latestNote,
      ].some((value) => textValue(value, '').toLowerCase().includes(q));
      return stageMatch && textMatch;
    });
  }, [rows, search, selectedStageSet]);

  const totals = useMemo(() => ({
    count: filteredRows.length,
    pending: filteredRows.filter((row) => workflowFromRow(row).case?.workflowStatus === 'Pending Approval').length,
    approved: filteredRows.filter((row) => workflowFromRow(row).case?.workflowStatus === 'Approved - Pending Execution').length,
    pnl: filteredRows.reduce((sum, row) => sum + Number(workflowFromRow(row).case?.settlementPnl || 0), 0),
  }), [filteredRows]);

  const toggleStage = (stage) => {
    setSelectedStages((prev) => prev.includes(stage) ? prev.filter((item) => item !== stage) : [...prev, stage]);
  };

  const refreshManagedStem = async (stemId) => {
    const nextRows = await loadRows({ force: true });
    if (stemId) setManagedStem(nextRows.find((row) => row.Id === stemId) || null);
  };

  return (
    <div className="flex h-[calc(100vh-64px)] min-h-0 flex-col gap-4 overflow-hidden p-4 md:p-5">
      <PageHeader
        icon={FileCheck2}
        eyebrow="Dispute workflow beta"
        title="Dispute Beta"
        description="Trader instructions, dispute administrator approval, execution tracking, and settlement P&L."
        className="shrink-0"
        meta={lastRefresh ? `Last updated ${format(lastRefresh, 'HH:mm:ss')}` : 'Auto-loaded from Salesforce and Supabase'}
        actions={(
          <Button variant="outline" onClick={() => loadRows({ force: true })} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </Button>
        )}
      />

      {fieldWarning && (
        <div className="shrink-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold">Salesforce workflow fields are not available</div>
          <div className="mt-1">{fieldWarning}</div>
        </div>
      )}

      <div className="grid shrink-0 gap-3 md:grid-cols-4">
        <Metric label="Beta Cases" value={totals.count.toLocaleString()} tone="red" />
        <Metric label="Pending Approval" value={totals.pending.toLocaleString()} tone="amber" />
        <Metric label="Approved / Execution" value={totals.approved.toLocaleString()} />
        <Metric label="Dispute P&L" value={fmtMoney(totals.pnl)} tone={totals.pnl >= 0 ? 'green' : 'red'} />
      </div>

      <div className="shrink-0 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search stem, buyer, supplier, product..." value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 pl-8 text-xs" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workflow stage</Label>
            <div className="flex flex-wrap gap-1.5">
              {ACTIVE_STAGES.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  onClick={() => toggleStage(stage)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                    selectedStageSet.has(stage)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {stage}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error && <div className="shrink-0 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <TableShell title="Dispute Beta Queue" meta={`${filteredRows.length.toLocaleString()} rows`} bodyClassName="min-h-0 flex-1 p-0" className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <StateBlock icon={Loader2} title="Loading Dispute Beta..." description="Fetching disputed STEMs and workflow state." />
        ) : filteredRows.length ? (
          <div className="h-full min-h-0 overflow-auto overscroll-contain">
            <table className="w-full min-w-[1380px] text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Stem</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Workflow</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Buyer / Invoice Due</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Products</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Supplier / Invoice Due</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Salesforce Status</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Dispute P&L</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Approval</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Manage</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, index) => {
                  const beta = workflowFromRow(row);
                  const stage = beta.case?.workflowStatus || 'Draft';
                  const detailLines = queueDetailLines(row);
                  return (
                    <tr
                      key={row.Id}
                      className={cn('cursor-pointer border-b border-border/40 hover:bg-muted/30', index % 2 ? 'bg-muted/10' : '')}
                      onClick={() => setSelectedStemId(row.Id)}
                    >
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <div className="font-medium text-foreground">{row._Display_Name || row.Name || '—'}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">Delivery {fmtDate(row.Delivery_Date__c)}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold', stageTone(stage))}>{stage}</span>
                      </td>
                      <td className="max-w-[240px] px-3 py-2.5">
                        <div className="truncate font-medium text-foreground" title={row._Buyer_Name || ''}>{row._Buyer_Name || '—'}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">Due {fmtDate(row._Buyer_Invoice_Due_Date || row.Buyer_Pay_Term_Date__c)}</div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        <div className="max-w-[340px] space-y-1">
                          {detailLines.slice(0, 5).map((line) => (
                            <div key={`product-${line.key}`} className="min-h-[30px] truncate leading-tight" title={line.productLabel}>
                              {line.productLabel || '—'}
                            </div>
                          ))}
                          {detailLines.length > 5 && <div className="text-[11px] text-muted-foreground">+{detailLines.length - 5} more</div>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        <div className="max-w-[340px] space-y-1">
                          {detailLines.slice(0, 5).map((line) => (
                            <div key={`supplier-${line.key}`} className="min-h-[30px] leading-tight">
                              {line.showSupplier ? (
                                <>
                                  <div className="truncate font-medium text-foreground" title={line.supplierName}>{line.supplierName || 'Supplier'}</div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {line.dueDate ? `Due ${fmtDate(line.dueDate)}` : 'Due —'}
                                    {line.invoiceName ? ` · ${line.invoiceName}` : ''}
                                  </div>
                                </>
                              ) : <span className="sr-only">Same supplier</span>}
                            </div>
                          ))}
                          {detailLines.length > 5 && <div className="text-[11px] text-muted-foreground">+{detailLines.length - 5} more</div>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{row.Dispute_Status__c || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">{fmtMoney(beta.case?.settlementPnl || 0)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        {beta.case?.approvedByEmail ? (
                          <div>
                            <div className="font-medium text-foreground">{beta.case.approvedByEmail}</div>
                            <div className="text-[11px]">{fmtDateTime(beta.case.approvedAt)}</div>
                          </div>
                        ) : beta.case?.submittedByEmail ? (
                          <div>
                            <div>{beta.case.submittedByEmail}</div>
                            <div className="text-[11px]">{fmtDateTime(beta.case.submittedAt)}</div>
                          </div>
                        ) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5"
                          onClick={(event) => {
                            event.stopPropagation();
                            setManagedStem(row);
                          }}
                        >
                          <CircleDollarSign className="h-3.5 w-3.5" /> Manage
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <StateBlock title="No Dispute Beta records found" description="No records match the current filters." />
        )}
      </TableShell>

      <StemDetailModal stemId={selectedStemId} open={!!selectedStemId} onClose={() => setSelectedStemId(null)} />
      <ManageBetaModal
        stem={managedStem}
        open={!!managedStem}
        onClose={() => setManagedStem(null)}
        onSaved={refreshManagedStem}
        isDisputeAdmin={isDisputeAdmin}
      />
    </div>
  );
}
