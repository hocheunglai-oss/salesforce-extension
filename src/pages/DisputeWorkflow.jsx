import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, CircleDollarSign, ExternalLink, Eye, FileCheck2, Loader2, RefreshCw, Search, Send, ShieldCheck, Upload, X } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDownloadAuthToken, withDownloadAuth } from '@/lib/authenticatedDownloadUrl';
import { numericValue, textValue } from '@/lib/displayValue';
import { DISPUTE_BUYER_CLOSE_REASONS, DISPUTE_SUPPLIER_CLOSE_REASONS } from '@/lib/disputeWorkflowOptions';
import { cn } from '@/lib/utils';

const ACTIVE_STAGES = ['Draft', 'Pending Approval', 'Revision Requested', 'Rejected', 'Approved - Pending Accounting', 'Accounting In Progress', 'Settled - Ready to Close', 'Closed'];
const DISPUTE_DELIVERY_DATE_MIN = '2026-01-01';
const ACTION_TYPES = [
  { value: 'resolve_supplier_dispute', label: 'Resolve supplier dispute', partyType: 'supplier' },
  { value: 'hold_supplier_payment', label: 'Hold supplier payment', partyType: 'supplier', legacy: true },
  { value: 'pay_full_supplier_invoice', label: 'Pay full supplier invoice amount', partyType: 'supplier', legacy: true },
  { value: 'deduct_specific_amount', label: 'Deduct specific amount', partyType: 'supplier', legacy: true },
  { value: 'issue_buyer_credit_note', label: 'Issue credit note to buyer', partyType: 'buyer' },
  { value: 'close_supplier_dispute', label: 'Close dispute with supplier', partyType: 'supplier', legacy: true },
  { value: 'close_buyer_dispute', label: 'Close dispute with buyer', partyType: 'buyer' },
];
const NEW_ACTION_TYPES = ACTION_TYPES.filter((action) => !action.legacy);
const BALANCE_PAYMENT_INSTRUCTIONS = ['No Balance Payment', 'Pay Immediately', 'Pay with next supplier invoice'];
const ACCOUNTING_STATUSES = ['Pending Accounting', 'Instruction Issued', 'Settled', 'Not Required'];
const DOCUMENT_TYPES = [
  { value: 'settlement_agreement', label: 'Settlement Agreement' },
  { value: 'buyer_credit_note', label: 'Buyer Credit Note' },
  { value: 'supplier_credit_note', label: 'Supplier Credit Note' },
  { value: 'payment_instruction', label: 'Payment Instruction' },
  { value: 'proof_of_payment', label: 'Proof of Payment' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'other_support', label: 'Other Support' },
];
const DISPUTE_DOCUMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx';
const DISPUTE_DOCUMENT_EXTENSION_RE = /\.(pdf|png|jpe?g|webp|docx?|xlsx?)$/i;
const DEFAULT_ACTION = {
  actionType: 'resolve_supplier_dispute',
  partyType: 'supplier',
  partySide: 'supplier',
  partyName: '',
  partyId: null,
  partyAccountId: '',
  partyKey: '',
  amount: '',
  currencyIsoCode: 'USD',
  invoiceAllocations: [],
  specialSellPrice: '',
  specialBuyPrice: '',
  quantity: '',
  quantityUnit: 'MT',
  closeReason: '',
  balancePaymentInstruction: '',
  description: '',
  requiresAttachment: false,
  accountingStatus: 'Pending Accounting',
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

const supplierInvoiceExposureRows = (stem, supplierAccountId = null) => {
  const accountKey = String(supplierAccountId || '').slice(0, 15);
  const rows = Array.isArray(stem?._Supplier_Invoice_Exposure_Rows) ? stem._Supplier_Invoice_Exposure_Rows : [];
  return rows
    .filter((row) => !accountKey || String(row.supplierAccountId || '').slice(0, 15) === accountKey)
    .slice()
    .sort((left, right) => String(left.dueDate || '9999-12-31').localeCompare(String(right.dueDate || '9999-12-31'))
      || String(left.invoiceDate || left.createdDate || '9999-12-31').localeCompare(String(right.invoiceDate || right.createdDate || '9999-12-31'))
      || String(left.supplierInvoiceId || '').localeCompare(String(right.supplierInvoiceId || '')));
};

function supplierAllocationPreview(stem, action = {}) {
  const disputeAmount = Math.max(0, numberOrNull(action.disputeAmount ?? action.amount) || 0);
  const currencyIsoCode = action.currencyIsoCode || 'USD';
  const invoices = supplierInvoiceExposureRows(stem, action.partyAccountId)
    .filter((row) => (row.currencyIsoCode || 'USD') === currencyIsoCode);
  const requested = new Map((action.invoiceAllocations || []).map((item) => [String(item.supplierInvoiceId || item.sourceSupplierInvoiceId || ''), Math.max(0, numberOrNull(item.amount ?? item.allocatedAmount) || 0)]));
  const allocatedByInvoice = new Map();
  let requestedTotal = 0;
  for (const invoice of invoices) {
    const invoiceId = String(invoice.supplierInvoiceId || invoice.id || '');
    if (!requested.has(invoiceId)) continue;
    const allocatedAmount = Math.min(Math.max(0, numberOrNull(invoice.invoiceAmount) || 0), requested.get(invoiceId));
    allocatedByInvoice.set(invoiceId, allocatedAmount);
    requestedTotal += allocatedAmount;
  }
  let remaining = Math.max(0, disputeAmount - requestedTotal);
  for (const invoice of invoices) {
    const invoiceId = String(invoice.supplierInvoiceId || invoice.id || '');
    if (allocatedByInvoice.has(invoiceId) || remaining <= 0.01) continue;
    const allocatedAmount = Math.min(Math.max(0, numberOrNull(invoice.invoiceAmount) || 0), remaining);
    allocatedByInvoice.set(invoiceId, allocatedAmount);
    remaining = Math.max(0, remaining - allocatedAmount);
  }
  const allocations = invoices.map((invoice) => {
    const invoiceId = String(invoice.supplierInvoiceId || invoice.id || '');
    const allocatedAmount = allocatedByInvoice.get(invoiceId) || 0;
    const payableBalance = Math.max(0, numberOrNull(invoice.payableBalance) || 0);
    return {
      ...invoice,
      supplierInvoiceId: invoiceId,
      allocatedAmount,
      doNotPayAmount: Math.min(allocatedAmount, payableBalance),
      getBackPaidAmount: Math.max(0, allocatedAmount - payableBalance),
    };
  });
  const allocatedTotal = allocations.reduce((sum, item) => sum + item.allocatedAmount, 0);
  return {
    currencyIsoCode,
    disputeAmount,
    allocations,
    remaining: disputeAmount - allocatedTotal,
    totalDoNotPay: allocations.reduce((sum, item) => sum + item.doNotPayAmount, 0),
    totalGetBackPaid: allocations.reduce((sum, item) => sum + item.getBackPaidAmount, 0),
  };
}

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
      const supplierLabel = [supplierName, dueRow.paymentTerm].filter(Boolean).join(' | ');
      const dueDate = dueRow.dueDate || null;
      const invoiceName = dueRow.invoiceName || '';
      const groupKey = `${dueRow.supplierAccountId || supplierName}\u0000${dueDate || ''}\u0000${invoiceName}`;
      const showSupplier = !seenSupplierGroups.has(groupKey);
      seenSupplierGroups.add(groupKey);
      return {
        key: `${groupKey}\u0000${dueRow.productQuantityLabel || dueRow.productName || index}`,
        productLabel: dueRow.productQuantityLabel || dueRow.productName || '—',
        supplierName,
        supplierLabel,
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
  if (stage === 'Approved - Pending Accounting') return 'border-blue-200 bg-blue-50 text-blue-800';
  if (stage === 'Accounting In Progress') return 'border-cyan-200 bg-cyan-50 text-cyan-800';
  if (stage === 'Settled - Ready to Close' || stage === 'Closed') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
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
    if (['deduct_specific_amount', 'resolve_supplier_dispute'].includes(action.actionType) && amount != null) {
      supplierImpact += amount;
      lines.push({ label: action.actionType === 'resolve_supplier_dispute' ? 'Supplier dispute resolution' : 'Supplier deduction', impact: amount });
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

function partyOptions(stem, type, selectedAccountIds = []) {
  const registry = stem?._Dispute_Parties;
  if (!registry?.candidateSchemaValid) return [];
  const selectedKeys = new Set(selectedAccountIds.map((id) => String(id || '').slice(0, 15)));
  return (registry.candidates || [])
    .filter((party) => selectedKeys.has(String(party.accountId || '').slice(0, 15)) && (party.roles || []).includes(type))
    .map((party) => ({
      key: `${party.accountId}:${type}`,
      partyKey: party.partyKey,
      partyId: party.id || null,
      type,
      name: party.name,
      accountId: party.accountId,
      roles: party.roles || [],
      paymentTerms: party.paymentTerms || [],
      products: party.products || [],
      label: party.label || party.name,
    }));
}

function normalizeActionForSave(action) {
  return {
    id: action.id || null,
    actionType: action.actionType,
    partyType: action.partyType,
    partySide: action.partySide || action.partyType,
    partyId: action.partyId || null,
    partyName: action.partyName,
    partyAccountId: action.partyAccountId,
    partyKey: action.partyKey,
    amount: numberOrNull(action.amount),
    disputeAmount: numberOrNull(action.disputeAmount ?? action.amount),
    currencyIsoCode: action.currencyIsoCode || 'USD',
    invoiceAllocations: (action.invoiceAllocations || []).map((allocation) => ({
      supplierInvoiceId: allocation.supplierInvoiceId || allocation.sourceSupplierInvoiceId,
      amount: numberOrNull(allocation.amount ?? allocation.allocatedAmount),
    })).filter((allocation) => allocation.supplierInvoiceId && allocation.amount != null),
    specialSellPrice: numberOrNull(action.specialSellPrice),
    specialBuyPrice: numberOrNull(action.specialBuyPrice),
    quantity: numberOrNull(action.quantity),
    quantityUnit: action.quantityUnit || 'MT',
    closeReason: action.closeReason || '',
    balancePaymentInstruction: action.balancePaymentInstruction || '',
    description: action.description || '',
    requiresAttachment: action.requiresAttachment === true,
    accountingStatus: action.accountingStatus || action.executionStatus || 'Pending Accounting',
  };
}

function workflowFromRow(row) {
  return row?._Dispute_Workflow || { case: null, parties: [], actions: [], supplierInstructions: [], events: [], documents: [], reconciliationError: null };
}

function rowWithWorkflowResponse(row, response = {}) {
  if (!row || !response?.case) return row;
  const currentWorkflow = workflowFromRow(row);
  const nextWorkflow = { ...currentWorkflow };
  for (const key of ['case', 'parties', 'actions', 'supplierInstructions', 'events', 'documents', 'reconciliationError']) {
    if (response[key] !== undefined) nextWorkflow[key] = response[key];
  }
  if (response.case && response.reconciliationError === undefined) nextWorkflow.reconciliationError = null;

  let partyRegistry = row._Dispute_Parties;
  if (partyRegistry && Array.isArray(response.parties)) {
    const savedByAccount = new Map(response.parties.map((party) => [String(party.accountId || '').slice(0, 15), party]));
    const selected = (partyRegistry.candidates || []).flatMap((candidate) => {
      const saved = savedByAccount.get(String(candidate.accountId || '').slice(0, 15));
      return saved ? [{ ...candidate, id: saved.id, caseId: saved.caseId, selected: true }] : [];
    });
    const selectionValid = selected.length > 0;
    partyRegistry = {
      ...partyRegistry,
      selected,
      selectionValid,
      valid: partyRegistry.candidateSchemaValid === true && selectionValid,
    };
  }

  return {
    ...row,
    Dispute_Status__c: response.case.currentSalesforceStatus || row.Dispute_Status__c,
    _Dispute_Parties: partyRegistry,
    _Dispute_Workflow: nextWorkflow,
  };
}

function editableWorkflow(caseRow) {
  return !caseRow || ['Draft', 'Rejected', 'Revision Requested'].includes(caseRow.workflowStatus);
}

function actionAccountingStatus(action) {
  return action.accountingStatus || action.executionStatus || 'Pending Accounting';
}

function accountingStatusTone(status) {
  if (status === 'Settled' || status === 'Not Required') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'Instruction Issued') return 'border-blue-200 bg-blue-50 text-blue-800';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function documentTypeLabel(value) {
  return DOCUMENT_TYPES.find((type) => type.value === value)?.label || value || 'Document';
}

function documentPreviewKind(document) {
  const extension = String(document?.fileExtension || document?.fileName || '').split('.').pop()?.toLowerCase();
  const contentType = String(document?.contentType || '').toLowerCase();
  if (extension === 'pdf' || contentType.includes('pdf')) return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension) || contentType.startsWith('image/')) return 'image';
  return null;
}

function nextWorkflowOwner(stage, supplierInstructions = []) {
  if (stage === 'Closed') return 'Complete';
  if (stage === 'Pending Approval') return 'Approver';
  if (['Approved - Pending Accounting', 'Accounting In Progress', 'Settled - Ready to Close'].includes(stage)) return 'Finance / Accounting';
  if (['Draft', 'Rejected', 'Revision Requested'].includes(stage) && supplierInstructions.some((instruction) => instruction.instructionType === 'withhold_unpaid' && !['Hold Acknowledged', 'Settled', 'Not Required', 'Superseded'].includes(instruction.status))) return 'Trader + Finance (urgent hold)';
  if (stage === 'Closed') return 'Complete';
  return 'Trader';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(new Error('The selected document could not be read.'));
    reader.readAsDataURL(file);
  });
}

function SupplierAllocationPreview({ stem, action, setAction, disabled }) {
  const preview = supplierAllocationPreview(stem, action);
  const updateAllocation = (supplierInvoiceId, value) => {
    setAction((current) => {
      const currentAllocations = (current.invoiceAllocations || []).filter((allocation) => String(allocation.supplierInvoiceId || allocation.sourceSupplierInvoiceId) !== supplierInvoiceId);
      return {
        ...current,
        invoiceAllocations: [...currentAllocations, { supplierInvoiceId, amount: value }],
      };
    });
  };
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card/70">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invoice allocation preview</div>
          <div className="text-[11px] text-muted-foreground">Oldest due invoice first. Finance values are recalculated and confirmed by the server.</div>
        </div>
        <div className="text-xs font-semibold tabular-nums text-foreground">{action.currencyIsoCode || 'USD'} {fmtMoney(preview.disputeAmount)}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead><tr className="border-b border-border bg-muted/30"><th className="px-3 py-2 text-left font-semibold text-muted-foreground">Supplier invoice</th><th className="px-3 py-2 text-left font-semibold text-muted-foreground">Due</th><th className="px-3 py-2 text-right font-semibold text-muted-foreground">Invoice</th><th className="px-3 py-2 text-right font-semibold text-muted-foreground">Payable</th><th className="px-3 py-2 text-right font-semibold text-muted-foreground">Allocate</th><th className="px-3 py-2 text-right font-semibold text-muted-foreground">Do not pay</th><th className="px-3 py-2 text-right font-semibold text-muted-foreground">Get back</th></tr></thead>
          <tbody>
            {preview.allocations.map((invoice) => <tr key={invoice.supplierInvoiceId} className="border-b border-border/40"><td className="px-3 py-2"><div className="font-medium text-foreground">{invoice.invoiceName || invoice.supplierInvoiceId}</div><div className="text-[11px] text-muted-foreground">{invoice.paymentState || '—'}</div></td><td className="px-3 py-2 text-muted-foreground">{fmtDate(invoice.dueDate)}</td><td className="px-3 py-2 text-right tabular-nums">{fmtMoney(invoice.invoiceAmount)}</td><td className="px-3 py-2 text-right tabular-nums">{fmtMoney(invoice.payableBalance)}</td><td className="px-3 py-1.5 text-right"><Input aria-label={`Allocation for ${invoice.invoiceName || invoice.supplierInvoiceId}`} type="number" min="0" max={Math.max(0, numberOrNull(invoice.invoiceAmount) || 0)} step="0.01" value={invoice.allocatedAmount} onChange={(event) => updateAllocation(invoice.supplierInvoiceId, event.target.value)} disabled={disabled} className="ml-auto h-8 w-28 text-right text-xs tabular-nums" /></td><td className="px-3 py-2 text-right tabular-nums">{fmtMoney(invoice.doNotPayAmount)}</td><td className="px-3 py-2 text-right tabular-nums">{fmtMoney(invoice.getBackPaidAmount)}</td></tr>)}
            {!preview.allocations.length && <tr><td colSpan={7} className="px-3 py-5 text-center text-muted-foreground">No matching supplier invoices are available for this Account and currency.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2 border-t border-border bg-muted/20 px-3 py-2 text-xs sm:grid-cols-3"><div>Approved total <span className="float-right font-semibold tabular-nums">{fmtMoney(preview.disputeAmount)}</span></div><div>Do not pay <span className="float-right font-semibold tabular-nums">{fmtMoney(preview.totalDoNotPay)}</span></div><div>Get back paid amount <span className="float-right font-semibold tabular-nums">{fmtMoney(preview.totalGetBackPaid)}</span></div></div>
      {Math.abs(preview.remaining) > 0.01 && <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{preview.remaining > 0 ? `${fmtMoney(preview.remaining)} cannot be allocated to the displayed supplier invoices. Reduce the dispute amount or correct the invoice data.` : `Invoice allocations exceed the dispute amount by ${fmtMoney(Math.abs(preview.remaining))}. Reduce the edited allocations.`}</div>}
    </div>
  );
}

function ActionForm({ stem, selectedAccountIds, draftAction, setDraftAction, onAdd, disabled }) {
  const parties = partyOptions(stem, draftAction.partyType, selectedAccountIds);
  const selectedPartyKey = parties.find((party) => party.partyKey === draftAction.partyKey)?.key || parties[0]?.key || '';
  const showAmount = draftAction.actionType === 'resolve_supplier_dispute' || draftAction.actionType === 'deduct_specific_amount' || draftAction.actionType === 'issue_buyer_credit_note';
  const showSupplierResolution = draftAction.actionType === 'resolve_supplier_dispute';
  const showSupplierClose = draftAction.actionType === 'close_supplier_dispute';
  const showBuyerClose = draftAction.actionType === 'close_buyer_dispute';

  const updateActionType = (value) => {
    const nextPartyType = actionPartyType(value);
    const nextParties = partyOptions(stem, nextPartyType, selectedAccountIds);
    const firstParty = nextParties[0];
    setDraftAction({
      ...DEFAULT_ACTION,
      actionType: value,
      partyType: nextPartyType,
      partySide: nextPartyType,
      partyId: firstParty?.partyId || null,
      partyName: firstParty?.name || '',
      partyAccountId: firstParty?.accountId || '',
      partyKey: firstParty?.partyKey || '',
    });
  };

  const updateParty = (key) => {
    const selected = parties.find((party) => party.key === key);
    if (!selected) return;
    setDraftAction((prev) => ({
      ...prev,
      partyType: selected.type,
      partySide: selected.type,
      partyId: selected.partyId || null,
      partyName: selected.name,
      partyAccountId: selected.accountId,
      partyKey: selected.partyKey,
      invoiceAllocations: [],
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
              {NEW_ACTION_TYPES.map((action) => <SelectItem key={action.value} value={action.value}>{action.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Party</Label>
          <Select value={selectedPartyKey} onValueChange={updateParty} disabled={disabled || !parties.length}>
            <SelectTrigger><SelectValue placeholder="Select party" /></SelectTrigger>
            <SelectContent>
              {parties.map((party) => <SelectItem key={party.key} value={party.key}>{party.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {!parties.length && <p className="text-[11px] text-destructive">No valid disputed {draftAction.partyType} party is available.</p>}
        </div>
        {showAmount && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{showSupplierResolution ? 'Agreed dispute amount' : 'Amount'}</Label>
            <Input type="number" min="0" step="0.01" value={draftAction.amount} onChange={(event) => setDraftAction((prev) => ({ ...prev, amount: event.target.value, disputeAmount: event.target.value, invoiceAllocations: [] }))} disabled={disabled} />
          </div>
        )}
        {showSupplierResolution && <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Currency</Label><Input value={draftAction.currencyIsoCode || 'USD'} maxLength={3} onChange={(event) => setDraftAction((prev) => ({ ...prev, currencyIsoCode: event.target.value.toUpperCase(), invoiceAllocations: [] }))} disabled={disabled} className="uppercase" /></div>}
        {showSupplierClose && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Close reason</Label>
            <Select value={draftAction.closeReason} onValueChange={(value) => setDraftAction((prev) => ({ ...prev, closeReason: value }))} disabled={disabled}>
              <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
              <SelectContent>
                {DISPUTE_SUPPLIER_CLOSE_REASONS.map((reason) => <SelectItem key={reason} value={reason}>{reason}</SelectItem>)}
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
                {DISPUTE_BUYER_CLOSE_REASONS.map((reason) => <SelectItem key={reason} value={reason}>{reason}</SelectItem>)}
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

      {showSupplierResolution && <SupplierAllocationPreview stem={stem} action={draftAction} setAction={setDraftAction} disabled={disabled} />}

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

function FinancialExposureSection({ stem, selectedAccountIds = [] }) {
  const selectedKeys = new Set(selectedAccountIds.map((accountId) => String(accountId || '').slice(0, 15)));
  const buyerExposure = stem?._Buyer_Finance_Row || {
    buyerName: stem?._Buyer_Name,
    buyerInvoiceAmount: stem?.Total_Invoice_Amount__c,
    paymentDueDate: stem?._Buyer_Invoice_Due_Date || stem?.Buyer_Pay_Term_Date__c,
    receivableBalance: stem?.Receivable_Balance__c,
    status: stem?._Buyer_Dispute_Label,
  };
  const supplierInvoiceRows = supplierInvoiceExposureRows(stem);
  const supplierRows = Array.isArray(stem?._Supplier_Finance_Rows_All) && stem._Supplier_Finance_Rows_All.length
    ? stem._Supplier_Finance_Rows_All
    : Array.isArray(stem?._Supplier_Dispute_Rows)
      ? stem._Supplier_Dispute_Rows
      : [];

  return (
    <section className="space-y-3 rounded-xl border border-border bg-muted/10 p-4">
      <StepHeading
        step="2"
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
            <div className="text-muted-foreground">Buyer payment due date</div>
            <div className="font-semibold tabular-nums">{fmtDate(buyerExposure.paymentDueDate || stem?._Buyer_Invoice_Due_Date || stem?.Buyer_Pay_Term_Date__c)}</div>
            <div className="text-muted-foreground">Receivable balance</div>
            <div className="font-semibold tabular-nums">{fmtMoney(buyerExposure.receivableBalance)}</div>
            <div className="text-muted-foreground">Buyer dispute status</div>
            <div className="max-w-[220px] whitespace-pre-line text-right text-xs text-muted-foreground">{selectedKeys.has(String(stem?.Account__c || '').slice(0, 15)) ? 'Selected for dispute' : 'Not selected'}</div>
          </div>
          {buyerExposure.description && <div className="mt-3 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">{buyerExposure.description}</div>}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full min-w-[940px] text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Supplier</th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Supplier Invoice</th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Payment Due Date</th>
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">Invoice Amount</th>
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">Paid</th>
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">Payable</th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Payment State</th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Dispute</th>
              </tr>
            </thead>
            <tbody>
              {(supplierInvoiceRows.length ? supplierInvoiceRows : supplierRows).map((row, index) => (
                <tr key={row.supplierInvoiceId || `${row.supplierName || 'supplier'}-${index}`} className="border-b border-border/40">
                  <td className="px-3 py-2 font-medium text-foreground">{row.supplierName || 'Supplier'}</td>
                  <td className="px-3 py-2"><div className="font-medium text-foreground">{row.invoiceName || '—'}</div><div className="text-[11px] text-muted-foreground">{row.currencyIsoCode || '—'}</div></td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{fmtDate(row.dueDate || row.paymentDueDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(row.invoiceAmount ?? row.supplierInvoiceAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(row.paidAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(row.payableBalance)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.paymentState || '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground"><div>{selectedKeys.has(String(row.supplierAccountId || row.accountId || '').slice(0, 15)) ? 'Selected for dispute' : 'Not selected'}</div>{row.description && <div className="mt-0.5 text-[11px]">{row.description}</div>}</td>
                </tr>
              ))}
              {!supplierInvoiceRows.length && !supplierRows.length && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No supplier invoice or payable rows found for this STEM.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function WorkflowRulesModal({ open, onClose, capabilities }) {
  const lifecycle = [
    ['Draft', 'Trader records one supplier dispute amount. FCOS creates urgent Do not pay instructions for unpaid balances while the draft is prepared.'],
    ['Pending Approval', 'Approver reviews commercial terms, evidence, and dispute P&L.'],
    ['Approved - Pending Accounting', 'Approved supplier amounts are split into Do not pay and Get back paid amount invoice instructions for Finance.'],
    ['Accounting In Progress', 'Finance acknowledges holds, then records a cash refund or future-invoice offset with the required evidence.'],
    ['Settled - Ready to Close', 'Every action is Settled or Not Required; final closure can be recorded.'],
    ['Closed', 'Salesforce is updated and the audit record is final.'],
  ];
  const roles = [
    ['Trader', 'Records one commercial supplier amount, reviews invoice allocation, uploads evidence, and submits for approval.', 'Draft, Rejected, Revision Requested'],
    ['Approver', 'Approve, reject, or request revision after checking required documents.', 'Pending Approval'],
    ['Finance / Accounting', 'Acknowledges urgent unpaid holds before approval; after approval confirms refund/offset, evidence, and settlement for each invoice line.', 'Draft holds; Approved through Ready to Close'],
    ['Administrator', 'All workflow actions plus exceptional correction and support.', 'All stages'],
  ];
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="flex h-[88vh] w-[min(1040px,96vw)] max-w-none flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 pr-8"><BookOpen className="h-5 w-5" /> Dispute Workflow Rules</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Tabs defaultValue="roles">
            <TabsList className="grid h-auto w-full grid-cols-1 gap-1 sm:h-9 sm:w-[520px] sm:grid-cols-3">
              <TabsTrigger value="roles">Roles</TabsTrigger>
              <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
              <TabsTrigger value="controls">Documents & Closure</TabsTrigger>
            </TabsList>
            <TabsContent value="roles" className="mt-4 space-y-4">
              <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                Everyone can see every role. Your current access: <span className="font-semibold text-foreground">{capabilities?.role || 'User'}</span>
                {capabilities?.canApprove ? ' · Approver' : ''}{capabilities?.canAccount ? ' · Accounting' : ''}.
              </div>
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border sm:hidden">
                {roles.map(([role, responsibility, stages]) => (
                  <div key={role} className="space-y-1.5 px-3 py-3">
                    <div className="text-sm font-semibold text-foreground">{role}</div>
                    <div className="text-sm text-muted-foreground">{responsibility}</div>
                    <div className="text-xs text-muted-foreground">Active: {stages}</div>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-hidden rounded-lg border border-border sm:block">
                <table className="w-full min-w-[720px] text-sm">
                  <thead><tr className="border-b border-border bg-muted/40"><th className="px-3 py-2 text-left">Role</th><th className="px-3 py-2 text-left">Responsibilities</th><th className="px-3 py-2 text-left">Active stages</th></tr></thead>
                  <tbody>{roles.map(([role, responsibility, stages]) => <tr key={role} className="border-b border-border/50"><td className="px-3 py-3 font-semibold">{role}</td><td className="px-3 py-3 text-muted-foreground">{responsibility}</td><td className="px-3 py-3 text-muted-foreground">{stages}</td></tr>)}</tbody>
                </table>
              </div>
              <p className="text-sm text-muted-foreground">Visibility of these rules does not grant action permissions. Restricted controls are only shown to the responsible role.</p>
            </TabsContent>
            <TabsContent value="lifecycle" className="mt-4">
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {lifecycle.map(([stage, rule], index) => (
                  <div key={stage} className="grid gap-2 px-4 py-3 sm:grid-cols-[36px_220px_1fr]">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{index + 1}</div>
                    <div><span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold', stageTone(stage))}>{stage}</span></div>
                    <div className="text-sm text-muted-foreground">{rule}</div>
                  </div>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="controls" className="mt-4 space-y-5 text-sm">
              <section><h3 className="font-semibold text-foreground">Party identity rules</h3><div className="mt-2 space-y-2 text-muted-foreground"><p>Traders select at least one Account from the STEM buyer, line-item suppliers, or extra-cost suppliers.</p><p>Cancelled line and extra-cost items remain eligible. Repeated supplier IDs with different payment terms count once, while different Account IDs remain separate.</p><p>Party identity and workflow instructions are stored in Supabase and revalidated against Salesforce Account lookups.</p></div></section>
              <section><h3 className="font-semibold text-foreground">Payment-state and hold rules</h3><div className="mt-2 space-y-2 text-muted-foreground"><p>Each supplier invoice is shown as Unpaid, Partly paid, or Paid. FCOS allocates the approved supplier amount oldest invoice first, subject to trader edits and server revalidation.</p><p>The unpaid portion becomes an urgent Do not pay instruction as soon as the draft is saved. Finance may acknowledge that hold before approval, but cannot settle or release it until approval.</p><p>Later supplier payments automatically move value from Do not pay to Get back paid amount without changing the approved commercial total. Finance must review the revised instruction before closure.</p></div></section>
              <section><h3 className="font-semibold text-foreground">Refund, offset, and evidence</h3><div className="mt-2 space-y-2 text-muted-foreground"><p>After approval, Finance selects cash refund from the supplier or an offset against an eligible open invoice for the same supplier Account and currency. FCOS only creates instructions and suggestions; it never creates Salesforce payments, refunds, credit notes, or offsets.</p><p>Settled requires the settlement date and either a supplier credit note/supporting document linked to the instruction or a Finance reference. Documents remain stored in Salesforce Files and can optionally link to an invoice instruction.</p><p>The editable default name is the Hong Kong date plus From/To Buyer/Supplier. Duplicate names on the same STEM receive -1, -2, and so on.</p></div></section>
              <section><h3 className="font-semibold text-foreground">Closure rules</h3><div className="mt-2 space-y-2 text-muted-foreground"><p>Actions are optional for individual disputed parties, but every action that was added must be Settled or Not Required. Every generated supplier invoice instruction must also be Settled or Not Required. All required documents must remain linked and a final closure note is mandatory.</p><p>Existing supplier actions with no commercial amount are blocked until the trader records one amount. A zero amount requires a no-recovery explanation and can return an approved case to Revision Requested.</p><p>Closure succeeds only after the current Salesforce party structure is revalidated and Salesforce Dispute Status is written back as Closed.</p></div></section>
              <section><h3 className="font-semibold text-foreground">Salesforce status values</h3><p className="mt-2 text-muted-foreground">No Dispute, Open - Trader Review, Pending Approval, Revision Requested, Rejected, Approved - Pending Accounting, Accounting In Progress, Settled - Ready to Close, Closed.</p></section>
            </TabsContent>
          </Tabs>
        </div>
        <div className="flex shrink-0 justify-end border-t border-border px-5 py-3"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function DocumentPreviewModal({ document, onClose }) {
  const downloadAuthToken = useDownloadAuthToken(Boolean(document));
  const url = document ? withDownloadAuth(document.downloadUrl, downloadAuthToken) : '';
  const kind = documentPreviewKind(document);
  return (
    <Dialog open={Boolean(document)} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="flex h-[92vh] w-[min(1100px,96vw)] max-w-none flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4"><DialogTitle className="truncate pr-8 text-base">{document?.fileName || 'Document preview'}</DialogTitle></DialogHeader>
        <div className="min-h-0 flex-1 bg-muted/20 p-3">
          {kind === 'pdf' && <iframe title={document?.fileName || 'Document'} src={url} className="h-full w-full rounded-md border border-border bg-white" />}
          {kind === 'image' && <div className="flex h-full items-center justify-center overflow-auto"><img src={url} alt={document?.fileName || 'Document'} className="max-h-full max-w-full object-contain" /></div>}
          {!kind && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Preview is not available for this file type.</div>}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
          {document?.salesforceUrl && <Button asChild variant="outline"><a href={document.salesforceUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" /> Salesforce</a></Button>}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function documentDateToken() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function documentDirectionLabel(value) {
  return {
    from_supplier: 'From Supplier',
    to_supplier: 'To Supplier',
    from_buyer: 'From Buyer',
    to_buyer: 'To Buyer',
  }[value] || '';
}

function availableDocumentBaseName(direction, extension, documents = []) {
  const baseName = `${documentDateToken()} ${documentDirectionLabel(direction)}`;
  if (!extension) return baseName;
  const existing = new Set(documents.map((document) => String(document.fileName || '').toLowerCase()));
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidateBase = `${baseName}${suffix ? `-${suffix}` : ''}`;
    if (!existing.has(`${candidateBase}.${extension}`.toLowerCase())) return candidateBase;
  }
  return baseName;
}

function DocumentUploadModal({ caseRow, party, partySide, action, supplierInstruction, existingDocuments = [], open, onClose, onUploaded }) {
  const [documentType, setDocumentType] = useState('settlement_agreement');
  const [direction, setDirection] = useState('');
  const [requestedName, setRequestedName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const nextDirection = `from_${partySide || 'supplier'}`;
    setDocumentType('settlement_agreement');
    setDirection(nextDirection);
    setRequestedName(availableDocumentBaseName(nextDirection, '', existingDocuments));
    setNameEdited(false);
    setFile(null);
    setDragActive(false);
    setError('');
  }, [open, action?.id, supplierInstruction?.id, party?.id, partySide]);

  const extension = String(file?.name || '').match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase() || '';
  const updateDirection = (value) => {
    setDirection(value);
    if (!nameEdited) setRequestedName(availableDocumentBaseName(value, extension, existingDocuments));
  };
  const updateFile = (nextFile) => {
    if (nextFile && !DISPUTE_DOCUMENT_EXTENSION_RE.test(nextFile.name || '')) {
      setFile(null);
      setError('Select a PDF, image, Word, or Excel document.');
      return;
    }
    setFile(nextFile);
    setError('');
    const nextExtension = String(nextFile?.name || '').match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase() || '';
    if (!nameEdited) setRequestedName(availableDocumentBaseName(direction, nextExtension, existingDocuments));
  };
  const dropFile = (event) => {
    event.preventDefault();
    setDragActive(false);
    if (busy) return;
    updateFile(event.dataTransfer.files?.[0] || null);
  };

  const upload = async () => {
    if (!caseRow?.id || !party?.id) { setError('Save the disputed Account selection before uploading a document.'); return; }
    if (!file) { setError('Select a document to upload.'); return; }
    if (!requestedName.trim()) { setError('Document name is required.'); return; }
    if (file.size > 3 * 1024 * 1024) { setError('Maximum document size is 3 MB.'); return; }
    setBusy(true);
    setError('');
    try {
      const base64 = await fileToBase64(file);
      const res = await appClient.functions.invoke('disputeWorkflowUploadDocument', {
        caseId: caseRow.id,
        actionId: action?.id || null,
        supplierInstructionId: supplierInstruction?.id || null,
        partyId: party.id,
        partySide,
        documentDirection: direction,
        documentType,
        originalFileName: file.name,
        requestedFileName: requestedName,
        contentType: file.type || 'application/octet-stream',
        base64,
      });
      if (res.data?.error) { setError(res.data.error); return; }
      await onUploaded(res.data.document);
      onClose();
    } catch (uploadError) {
      setError(uploadError.message || 'Document upload failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Upload Dispute Document</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm"><div className="font-semibold">{party?.name || party?.accountName}</div><div className="text-muted-foreground">{partySide === 'buyer' ? 'Buyer' : 'Supplier'}{action ? ` · ${action.actionLabel || actionLabel(action.actionType)}` : ''}{supplierInstruction ? ` · ${supplierInstruction.instructionLabel || 'Supplier instruction'}: ${supplierInstruction.sourceSupplierInvoiceName || 'Invoice'}` : ''}</div></div>
          <div className="space-y-1.5"><Label>Direction</Label><Select value={direction} onValueChange={updateDirection}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={`from_${partySide}`}>From {partySide === 'buyer' ? 'Buyer' : 'Supplier'}</SelectItem><SelectItem value={`to_${partySide}`}>To {partySide === 'buyer' ? 'Buyer' : 'Supplier'}</SelectItem></SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Document type</Label><Select value={documentType} onValueChange={setDocumentType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DOCUMENT_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5">
            <Label htmlFor="dispute-document-file">File</Label>
            <label
              htmlFor="dispute-document-file"
              onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragActive(true); }}
              onDragOver={(event) => { event.preventDefault(); if (!busy) setDragActive(true); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false); }}
              onDrop={dropFile}
              className={cn(
                'flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-5 text-center transition-colors',
                dragActive ? 'border-primary bg-primary/5' : 'border-input bg-muted/20 hover:border-primary/60',
                busy && 'cursor-not-allowed opacity-60'
              )}
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="max-w-full truncate text-sm font-medium text-foreground">{file?.name || 'Drop document here or choose a file'}</span>
              <span className="text-xs text-muted-foreground">PDF, image, Word, or Excel · Maximum 3 MB</span>
              <input id="dispute-document-file" type="file" accept={DISPUTE_DOCUMENT_ACCEPT} onChange={(event) => updateFile(event.target.files?.[0] || null)} disabled={busy} className="sr-only" />
            </label>
          </div>
          <div className="space-y-1.5"><Label htmlFor="dispute-document-name">Salesforce filename</Label><div className="flex items-center"><Input id="dispute-document-name" value={requestedName} onChange={(event) => { setRequestedName(event.target.value); setNameEdited(true); }} className="rounded-r-none" /><div className="flex h-10 min-w-14 items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground">{extension ? `.${extension}` : '.file'}</div></div><p className="text-xs text-muted-foreground">If this name already exists on the STEM, FCOS adds -1, -2, and so on.</p></div>
          {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={upload} disabled={busy} className="gap-2">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload to Salesforce</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function AccountingUpdateModal({ action, open, onClose, onSaved }) {
  const [status, setStatus] = useState('Pending Accounting');
  const [instructionReference, setInstructionReference] = useState('');
  const [instructionDate, setInstructionDate] = useState('');
  const [instructionAmount, setInstructionAmount] = useState('');
  const [settlementReference, setSettlementReference] = useState('');
  const [settlementDate, setSettlementDate] = useState('');
  const [settlementAmount, setSettlementAmount] = useState('');
  const [accountingNote, setAccountingNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || !action) return;
    setStatus(actionAccountingStatus(action));
    setInstructionReference(action.instructionReference || '');
    setInstructionDate(action.instructionDate || '');
    setInstructionAmount(action.instructionAmount ?? '');
    setSettlementReference(action.settlementReference || '');
    setSettlementDate(action.settlementDate || '');
    setSettlementAmount(action.settlementAmount ?? '');
    setAccountingNote(action.accountingNote || '');
    setError('');
  }, [open, action]);

  const save = async () => {
    setBusy(true);
    setError('');
    const res = await appClient.functions.invoke('disputeWorkflowAccountingUpdate', {
      actionId: action.id,
      accountingStatus: status,
      instructionReference,
      instructionDate,
      instructionAmount: numberOrNull(instructionAmount),
      settlementReference,
      settlementDate,
      settlementAmount: numberOrNull(settlementAmount),
      accountingNote,
    });
    if (res.data?.error) { setError(res.data.error); setBusy(false); return; }
    await onSaved(res.data);
    setBusy(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Accounting Update - {action?.partyName || 'Party'}</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2"><Label>Status</Label><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ACCOUNTING_STATUSES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
          {(status === 'Instruction Issued' || status === 'Settled') && <><div className="space-y-1.5"><Label>Instruction date</Label><Input type="date" value={instructionDate} onChange={(event) => setInstructionDate(event.target.value)} /></div><div className="space-y-1.5"><Label>Instruction reference</Label><Input value={instructionReference} onChange={(event) => setInstructionReference(event.target.value)} /></div><div className="space-y-1.5"><Label>Instruction amount</Label><Input type="number" min="0" step="0.01" value={instructionAmount} onChange={(event) => setInstructionAmount(event.target.value)} /></div></>}
          {status === 'Settled' && <><div className="space-y-1.5"><Label>Settlement date</Label><Input type="date" value={settlementDate} onChange={(event) => setSettlementDate(event.target.value)} /></div><div className="space-y-1.5"><Label>Settlement reference</Label><Input value={settlementReference} onChange={(event) => setSettlementReference(event.target.value)} /></div><div className="space-y-1.5"><Label>Settlement amount</Label><Input type="number" min="0" step="0.01" value={settlementAmount} onChange={(event) => setSettlementAmount(event.target.value)} /></div></>}
          <div className="space-y-1.5 md:col-span-2"><Label>Accounting note</Label><Textarea rows={3} value={accountingNote} onChange={(event) => setAccountingNote(event.target.value)} placeholder={status === 'Not Required' ? 'Reason accounting is not required' : 'Payment or settlement details'} /></div>
          {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive md:col-span-2">{error}</div>}
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Accounting Update</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function SupplierInstructionModal({ instruction, stem, approvalStatus, open, onClose, onSaved }) {
  const beforeApproval = approvalStatus !== 'Approved';
  const [status, setStatus] = useState('Pending Accounting');
  const [recoveryMethod, setRecoveryMethod] = useState('');
  const [targetSupplierInvoiceId, setTargetSupplierInvoiceId] = useState('');
  const [offsetOptions, setOffsetOptions] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [instructionReference, setInstructionReference] = useState('');
  const [instructionDate, setInstructionDate] = useState('');
  const [instructionAmount, setInstructionAmount] = useState('');
  const [settlementReference, setSettlementReference] = useState('');
  const [settlementDate, setSettlementDate] = useState('');
  const [settlementAmount, setSettlementAmount] = useState('');
  const [accountingNote, setAccountingNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || !instruction) return;
    setStatus(beforeApproval ? 'Hold Acknowledged' : instruction.status || 'Pending Accounting');
    setRecoveryMethod(instruction.recoveryMethod || '');
    setTargetSupplierInvoiceId(instruction.targetSupplierInvoiceId || '');
    setInstructionReference(instruction.instructionReference || '');
    setInstructionDate(instruction.instructionDate || '');
    setInstructionAmount(instruction.instructionAmount ?? instruction.plannedAmount ?? '');
    setSettlementReference(instruction.settlementReference || '');
    setSettlementDate(instruction.settlementDate || '');
    setSettlementAmount(instruction.settlementAmount ?? instruction.plannedAmount ?? '');
    setAccountingNote(instruction.accountingNote || '');
    setOffsetOptions([]);
    setError('');
  }, [open, instruction, beforeApproval]);
  useEffect(() => {
    if (!open || !instruction || recoveryMethod !== 'future_invoice_offset') return;
    let active = true;
    setLoadingOptions(true);
    appClient.functions.invoke('disputeWorkflowSupplierOffsetOptions', { instructionId: instruction.id })
      .then((res) => { if (active) { setOffsetOptions(res.data?.options || []); if (res.data?.error) setError(res.data.error); } })
      .catch((nextError) => { if (active) setError(nextError.message || 'Unable to load offset invoice options.'); })
      .finally(() => { if (active) setLoadingOptions(false); });
    return () => { active = false; };
  }, [open, instruction, recoveryMethod]);
  const sourceInvoice = supplierInvoiceExposureRows(stem).find((row) => row.supplierInvoiceId === instruction?.sourceSupplierInvoiceId);
  const matchingRefunds = (sourceInvoice?.payments || []).filter((payment) => (
    Number(payment.amount) < 0
    && Math.abs(Math.abs(Number(payment.amount)) - Number(instruction?.plannedAmount || 0)) <= 0.01
    && (payment.currencyIsoCode || instruction?.currencyIsoCode) === instruction?.currencyIsoCode
  ));
  const [matchedSalesforcePaymentId, setMatchedSalesforcePaymentId] = useState('');
  useEffect(() => { if (open) setMatchedSalesforcePaymentId(instruction?.matchedSalesforcePaymentId || ''); }, [open, instruction]);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await appClient.functions.invoke('disputeWorkflowSupplierInstructionUpdate', {
        instructionId: instruction.id,
        revision: instruction.revision,
        status,
        recoveryMethod: instruction.instructionType === 'get_back_paid' ? recoveryMethod : undefined,
        targetSupplierInvoiceId: recoveryMethod === 'future_invoice_offset' ? targetSupplierInvoiceId : undefined,
        matchedSalesforcePaymentId: recoveryMethod === 'cash_refund' && matchedSalesforcePaymentId !== 'none' ? matchedSalesforcePaymentId || undefined : undefined,
        instructionReference,
        instructionDate,
        instructionAmount: numberOrNull(instructionAmount),
        settlementReference,
        settlementDate,
        settlementAmount: numberOrNull(settlementAmount),
        accountingNote,
      });
      if (res.data?.error) { setError(res.data.error); return; }
      await onSaved(res.data);
      onClose();
    } catch (saveError) {
      setError(saveError.message || 'Supplier instruction update failed.');
    } finally { setBusy(false); }
  };
  if (!instruction) return null;
  const statusOptions = beforeApproval ? ['Hold Acknowledged'] : ['Pending Accounting', 'Instruction Issued', 'Settled', 'Not Required'];
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{beforeApproval ? 'Acknowledge urgent hold' : 'Supplier invoice instruction'}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm sm:grid-cols-2"><div><div className="text-xs text-muted-foreground">{instruction.instructionLabel}</div><div className="font-semibold">{instruction.sourceSupplierInvoiceName || instruction.sourceSupplierInvoiceId}</div></div><div className="text-right"><div className="text-xs text-muted-foreground">Planned amount</div><div className="font-semibold tabular-nums">{instruction.currencyIsoCode} {fmtMoney(instruction.plannedAmount)}</div></div></div>
          {beforeApproval && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This is an immediate Finance hold. It can be acknowledged now, but it cannot be settled or released until commercial approval.</div>}
          <div className="space-y-1.5"><Label>Status</Label><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
          {!beforeApproval && instruction.instructionType === 'get_back_paid' && <><div className="space-y-1.5"><Label>Get back method</Label><Select value={recoveryMethod} onValueChange={setRecoveryMethod}><SelectTrigger><SelectValue placeholder="Choose refund or offset" /></SelectTrigger><SelectContent><SelectItem value="cash_refund">Cash refund from supplier</SelectItem><SelectItem value="future_invoice_offset">Offset against another supplier invoice</SelectItem></SelectContent></Select></div>{recoveryMethod === 'future_invoice_offset' && <div className="space-y-1.5"><Label>Offset invoice</Label><Select value={targetSupplierInvoiceId} onValueChange={setTargetSupplierInvoiceId} disabled={loadingOptions}><SelectTrigger><SelectValue placeholder={loadingOptions ? 'Loading eligible invoices...' : 'Select an eligible invoice'} /></SelectTrigger><SelectContent>{offsetOptions.map((option) => <SelectItem key={option.supplierInvoiceId} value={option.supplierInvoiceId}>{option.invoiceName || option.supplierInvoiceId} · {fmtMoney(option.unreservedPayableBalance ?? option.payableBalance)} available{option.reservedAmount > 0 ? ` (${fmtMoney(option.reservedAmount)} reserved)` : ''}</SelectItem>)}</SelectContent></Select></div>}{recoveryMethod === 'cash_refund' && <div className="space-y-1.5"><Label>Matching Salesforce refund (optional evidence)</Label><Select value={matchedSalesforcePaymentId} onValueChange={setMatchedSalesforcePaymentId}><SelectTrigger><SelectValue placeholder="No matching refund selected" /></SelectTrigger><SelectContent><SelectItem value="none">No matching refund selected</SelectItem>{matchingRefunds.map((payment) => <SelectItem key={payment.id} value={payment.id}>{payment.name || payment.id} · {fmtMoney(payment.amount)} · {fmtDate(payment.paymentDate || payment.date)}</SelectItem>)}</SelectContent></Select></div>}</>}
          {!beforeApproval && (status === 'Instruction Issued' || status === 'Settled') && <div className="grid gap-3 sm:grid-cols-3"><div className="space-y-1.5"><Label>Instruction date</Label><Input type="date" value={instructionDate} onChange={(event) => setInstructionDate(event.target.value)} /></div><div className="space-y-1.5"><Label>Instruction reference</Label><Input value={instructionReference} onChange={(event) => setInstructionReference(event.target.value)} /></div><div className="space-y-1.5"><Label>Instruction amount</Label><Input type="number" min="0" step="0.01" value={instructionAmount} onChange={(event) => setInstructionAmount(event.target.value)} /></div></div>}
          {!beforeApproval && status === 'Settled' && <div className="grid gap-3 sm:grid-cols-3"><div className="space-y-1.5"><Label>Settlement date</Label><Input type="date" value={settlementDate} onChange={(event) => setSettlementDate(event.target.value)} /></div><div className="space-y-1.5"><Label>Finance reference</Label><Input value={settlementReference} onChange={(event) => setSettlementReference(event.target.value)} /></div><div className="space-y-1.5"><Label>Settlement amount</Label><Input type="number" min="0" step="0.01" value={settlementAmount} onChange={(event) => setSettlementAmount(event.target.value)} /></div></div>}
          <div className="space-y-1.5"><Label>Accounting note</Label><Textarea rows={3} value={accountingNote} onChange={(event) => setAccountingNote(event.target.value)} placeholder={status === 'Not Required' ? 'Explain why this instruction is not required' : 'Reference, recovery detail, or finance note'} /></div>
          {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{beforeApproval ? 'Acknowledge Hold' : 'Save Instruction'}</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function SupplierAmountAmendModal({ action, stem, open, onClose, onSaved }) {
  const [amount, setAmount] = useState('');
  const [currencyIsoCode, setCurrencyIsoCode] = useState('USD');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const draft = { ...action, amount, disputeAmount: amount, currencyIsoCode, description: note, invoiceAllocations: [] };
  const preview = supplierAllocationPreview(stem, draft);
  useEffect(() => { if (open && action) { setAmount(action.disputeAmount ?? action.amount ?? ''); setCurrencyIsoCode(action.currencyIsoCode || 'USD'); setNote(action.description || ''); setError(''); } }, [open, action]);
  const save = async () => {
    if (numberOrNull(amount) == null || numberOrNull(amount) < 0) { setError('Supplier dispute amount must be zero or greater.'); return; }
    if (!/^[A-Z]{3}$/.test(currencyIsoCode)) { setError('Currency must be a three-letter code such as USD.'); return; }
    if (numberOrNull(amount) === 0 && !note.trim()) { setError('Explain why no supplier recovery is required for a zero amount.'); return; }
    if (Math.abs(preview.remaining) > 0.01) { setError('The dispute amount must be fully allocated to eligible supplier invoices.'); return; }
    setBusy(true); setError('');
    try {
      const res = await appClient.functions.invoke('disputeWorkflowSupplierAmountAmend', { actionId: action.id, disputeAmount: numberOrNull(amount), currencyIsoCode, note, invoiceAllocations: preview.allocations.filter((item) => item.allocatedAmount > 0).map((item) => ({ supplierInvoiceId: item.supplierInvoiceId, amount: item.allocatedAmount })) });
      if (res.data?.error) { setError(res.data.error); return; }
      await onSaved(res.data); onClose();
    } catch (saveError) { setError(saveError.message || 'Supplier dispute amount could not be saved.'); } finally { setBusy(false); }
  };
  const missingAmount = action?.supplierDisputeAmountRequired === true || numberOrNull(action?.disputeAmount ?? action?.amount) == null;
  return <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !busy) onClose(); }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{missingAmount ? 'Record supplier dispute amount' : 'Convert to invoice instructions'}</DialogTitle></DialogHeader><div className="space-y-4 py-2"><p className="text-sm text-muted-foreground">{missingAmount ? 'This existing supplier action needs an approved recovery amount before it can proceed. Adding a previously missing amount to an approved workflow requires approval again.' : 'This converts the unchanged legacy supplier amount into invoice-level Do not pay and Get back paid amount instructions without changing the approved commercial total.'}</p><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Dispute amount</Label><Input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></div><div className="space-y-1.5"><Label>Currency</Label><Input value={currencyIsoCode} maxLength={3} onChange={(event) => setCurrencyIsoCode(event.target.value.toUpperCase())} className="uppercase" /></div></div><div className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm sm:grid-cols-2"><div>Do not pay <span className="float-right font-semibold tabular-nums">{fmtMoney(preview.totalDoNotPay)}</span></div><div>Get back paid amount <span className="float-right font-semibold tabular-nums">{fmtMoney(preview.totalGetBackPaid)}</span></div></div><div className="space-y-1.5"><Label>Explanation</Label><Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Required when the amount is zero" /></div>{error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}</div><div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{missingAmount ? 'Save Amount' : 'Convert'}</Button></div></DialogContent></Dialog>;
}

function WorkflowDecisionModal({ mode, open, onClose, onConfirm, busy }) {
  const [note, setNote] = useState('');
  const config = {
    approve: ['Approve Instructions', 'Approval note', 'Confirm Approval'],
    revision: ['Request Revision', 'Revision reason', 'Return to Trader'],
    reject: ['Reject Instructions', 'Rejection reason', 'Reject'],
    close: ['Close Dispute', 'Final closure note', 'Close Dispute'],
  }[mode] || ['Workflow Decision', 'Note', 'Confirm'];
  useEffect(() => { if (open) setNote(''); }, [open, mode]);
  const requiresNote = mode !== 'approve';
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{config[0]}</DialogTitle></DialogHeader>
        <div className="space-y-1.5 py-2"><Label>{config[1]}</Label><Textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} /></div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={() => onConfirm(note)} disabled={busy || (requiresNote && !note.trim())}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{config[2]}</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function ManageWorkflowModal({ stem, open, onClose, onSaved, capabilities }) {
  const workflow = workflowFromRow(stem);
  const [caseRow, setCaseRow] = useState(workflow.case);
  const [parties, setParties] = useState(workflow.parties || []);
  const [selectedAccountIds, setSelectedAccountIds] = useState((workflow.parties || []).map((party) => party.accountId));
  const [actions, setActions] = useState(workflow.actions || []);
  const [supplierInstructions, setSupplierInstructions] = useState(workflow.supplierInstructions || []);
  const [events, setEvents] = useState(workflow.events || []);
  const [documents, setDocuments] = useState(workflow.documents || []);
  const [reconciliationError, setReconciliationError] = useState(workflow.reconciliationError || null);
  const [note, setNote] = useState(workflow.case?.latestNote || '');
  const [draftAction, setDraftAction] = useState(DEFAULT_ACTION);
  const [uploadTarget, setUploadTarget] = useState(null);
  const [documentPartyKey, setDocumentPartyKey] = useState('');
  const [accountingAction, setAccountingAction] = useState(null);
  const [supplierInstruction, setSupplierInstruction] = useState(null);
  const [amendAction, setAmendAction] = useState(null);
  const [previewDocument, setPreviewDocument] = useState(null);
  const [decisionMode, setDecisionMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const nextWorkflow = workflowFromRow(stem);
    const nextSelectedAccountIds = (nextWorkflow.parties || []).map((party) => party.accountId);
    const supplierParty = partyOptions(stem, 'supplier', nextSelectedAccountIds)[0];
    setCaseRow(nextWorkflow.case);
    setParties(nextWorkflow.parties || []);
    setSelectedAccountIds(nextSelectedAccountIds);
    setActions(nextWorkflow.actions || []);
    setSupplierInstructions(nextWorkflow.supplierInstructions || []);
    setEvents(nextWorkflow.events || []);
    setDocuments(nextWorkflow.documents || []);
    setReconciliationError(nextWorkflow.reconciliationError || null);
    setNote(nextWorkflow.case?.latestNote || '');
    setDraftAction({
      ...DEFAULT_ACTION,
      partyId: supplierParty?.partyId || null,
      partyType: 'supplier',
      partySide: 'supplier',
      partyName: supplierParty?.name || '',
      partyAccountId: supplierParty?.accountId || '',
      partyKey: supplierParty?.partyKey || '',
    });
    setDocumentPartyKey('');
    setError(null);
  }, [stem]);

  useEffect(() => {
    const desiredSide = actionPartyType(draftAction.actionType);
    let available = partyOptions(stem, desiredSide, selectedAccountIds);
    let nextActionType = draftAction.actionType;
    let nextSide = desiredSide;
    if (!available.length) {
      const supplierOptions = partyOptions(stem, 'supplier', selectedAccountIds);
      const buyerOptions = partyOptions(stem, 'buyer', selectedAccountIds);
      available = supplierOptions.length ? supplierOptions : buyerOptions;
      nextSide = supplierOptions.length ? 'supplier' : 'buyer';
      nextActionType = nextSide === 'supplier' ? 'resolve_supplier_dispute' : 'issue_buyer_credit_note';
    }
    const currentAvailable = available.some((party) => String(party.accountId || '').slice(0, 15) === String(draftAction.partyAccountId || '').slice(0, 15));
    if (currentAvailable || !available.length) return;
    const firstParty = available[0];
    setDraftAction({
      ...DEFAULT_ACTION,
      actionType: nextActionType,
      partyType: nextSide,
      partySide: nextSide,
      partyId: firstParty.partyId || null,
      partyName: firstParty.name,
      partyAccountId: firstParty.accountId,
      partyKey: firstParty.partyKey,
    });
  }, [draftAction.actionType, draftAction.partyAccountId, selectedAccountIds, stem]);

  if (!open || !stem) return null;

  const partyRegistry = stem._Dispute_Parties;
  const legacyReadOnly = caseRow?.legacyReadOnly === true;
  const externalClosure = caseRow?.externalClosure === true;
  const partyIssues = Array.isArray(partyRegistry?.issues) ? partyRegistry.issues : [];
  const candidateSchemaValid = partyRegistry?.candidateSchemaValid === true;
  const selectionValid = legacyReadOnly || selectedAccountIds.length > 0;
  const partiesValid = legacyReadOnly || (candidateSchemaValid && selectionValid);
  const canEdit = !legacyReadOnly && editableWorkflow(caseRow) && candidateSchemaValid;
  const documentedActionIds = new Set(documents.map((document) => document.actionId).filter(Boolean));
  const missingRequiredDocuments = actions.filter((action) => action.requiresAttachment && (!action.id || !documentedActionIds.has(action.id)));
  const supplierAmountRequired = actions.filter((action) => action.partyType === 'supplier' && action.supplierDisputeAmountRequired);
  const supplierConversionRequired = actions.filter((action) => action.partyType === 'supplier' && action.supplierInstructionConversionRequired);
  const canSubmit = canEdit && selectionValid && actions.length > 0 && missingRequiredDocuments.length === 0 && supplierAmountRequired.length === 0 && supplierConversionRequired.length === 0 && !reconciliationError;
  const canReview = !legacyReadOnly && capabilities?.canApprove && caseRow?.approvalStatus === 'Pending Approval';
  const canApprove = partiesValid
    && canReview
    && missingRequiredDocuments.length === 0
    && supplierAmountRequired.length === 0
    && supplierConversionRequired.length === 0
    && !reconciliationError;
  const canAccount = capabilities?.canAccount && caseRow?.approvalStatus === 'Approved' && caseRow?.workflowStatus !== 'Closed';
  const canAcknowledgeUrgentHold = capabilities?.canAccount && caseRow?.workflowStatus !== 'Closed';
  const canClose = partiesValid && capabilities?.canClose && caseRow?.workflowStatus === 'Settled - Ready to Close' && !reconciliationError;
  const canManageDocuments = !legacyReadOnly
    && caseRow?.workflowStatus !== 'Closed'
    && (canEdit || canAccount || capabilities?.canApprove);
  const financials = settlementFinancials(actions);
  const basePnl = stemBasePnl(stem);
  const stemPnlIncludingDispute = basePnl == null ? null : basePnl + financials.settlementPnl;
  const selectedAccountKeys = new Set(selectedAccountIds.map((id) => String(id || '').slice(0, 15)));
  const selectedPartySides = (partyRegistry?.candidates || []).flatMap((candidate) => {
    if (!selectedAccountKeys.has(String(candidate.accountId || '').slice(0, 15))) return [];
    const savedParty = parties.find((party) => String(party.accountId || '').slice(0, 15) === String(candidate.accountId || '').slice(0, 15));
    return (candidate.roles || []).map((side) => ({
      key: `${candidate.accountId}:${side}`,
      party: { ...candidate, id: savedParty?.id || candidate.id || null },
      partySide: side,
    }));
  });
  const selectedDocumentTarget = selectedPartySides.find((target) => target.key === documentPartyKey) || selectedPartySides[0] || null;

  const refreshAfter = async (response, options = {}) => {
    if (response?.case) setCaseRow(response.case);
    if (response?.parties) {
      setParties(response.parties);
      setSelectedAccountIds(response.parties.map((party) => party.accountId));
    }
    if (response?.actions) setActions(response.actions);
    if (response?.supplierInstructions) setSupplierInstructions(response.supplierInstructions);
    if (response?.events) setEvents(response.events);
    if (response?.documents) setDocuments(response.documents);
    if (response?.reconciliationError !== undefined) setReconciliationError(response.reconciliationError || null);
    else if (response?.case) setReconciliationError(null);
    await onSaved?.(stem.Id, response, options);
  };

  const invokeWorkflow = async (name, payload, options = {}) => {
    setBusy(true);
    setError(null);
    try {
      const res = await appClient.functions.invoke(name, payload);
      if (res.data?.error) {
        setError(res.data.error);
        return null;
      }
      await refreshAfter(res.data, options);
      return res.data;
    } finally {
      setBusy(false);
    }
  };

  const addAction = () => {
    if (!draftAction.partyName || !draftAction.partyAccountId || !draftAction.partyKey) {
      setError('Select a buyer or supplier party before adding the action.');
      return;
    }
    if (actions.some((action) => action.partyKey === draftAction.partyKey && (action.partySide || action.partyType) === (draftAction.partySide || draftAction.partyType))) {
      setError(`Only one ${draftAction.partyType} action may be added for ${draftAction.partyName}.`);
      return;
    }
    if ((draftAction.actionType === 'resolve_supplier_dispute' || draftAction.actionType === 'deduct_specific_amount' || draftAction.actionType === 'issue_buyer_credit_note') && numberOrNull(draftAction.amount) == null) {
      setError('Amount is required for this action.');
      return;
    }
    if (draftAction.actionType === 'resolve_supplier_dispute') {
      if (!/^[A-Z]{3}$/.test(draftAction.currencyIsoCode || '')) {
        setError('Currency must be a three-letter code such as USD.');
        return;
      }
      if (numberOrNull(draftAction.amount) === 0 && !draftAction.description?.trim()) {
        setError('Explain why no supplier recovery is required for a zero dispute amount.');
        return;
      }
      if (Math.abs(supplierAllocationPreview(stem, draftAction).remaining) > 0.01) {
        setError('Invoice allocations must equal the supplier dispute amount.');
        return;
      }
    }
    if (draftAction.actionType === 'close_buyer_dispute' && !draftAction.closeReason) {
      setError('Buyer close reason is required.');
      return;
    }
    setActions((prev) => [...prev, { ...draftAction, clientId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, actionLabel: actionLabel(draftAction.actionType), accountingStatus: 'Pending Accounting' }]);
    setDraftAction((prev) => ({
      ...DEFAULT_ACTION,
      partyType: prev.partyType,
      partySide: prev.partySide || prev.partyType,
      actionType: prev.actionType,
      partyId: prev.partyId || null,
      partyName: prev.partyName,
      partyAccountId: prev.partyAccountId,
      partyKey: prev.partyKey,
    }));
    setError(null);
  };

  const removeAction = (index) => setActions((prev) => prev.filter((_, actionIndex) => actionIndex !== index));
  const saveDraft = () => invokeWorkflow(
    'disputeWorkflowSaveDraft',
    {
      stem,
      selectedPartyAccountIds: selectedAccountIds,
      actions: actions.map(normalizeActionForSave),
      latestNote: note,
    },
    { localOnly: true },
  );
  const toggleSelectedAccount = (candidate, checked) => {
    const accountKey = String(candidate.accountId || '').slice(0, 15);
    if (!checked && actions.some((action) => String(action.partyAccountId || '').slice(0, 15) === accountKey)) {
      setError(`Remove the action for ${candidate.name} before removing this disputed Account.`);
      return;
    }
    if (!checked && documents.some((document) => String(document.partyAccountId || '').slice(0, 15) === accountKey)) {
      setError(`Keep ${candidate.name} selected because dispute documents are already linked to the Account.`);
      return;
    }
    setSelectedAccountIds((current) => checked
      ? [...new Set([...current, candidate.accountId])]
      : current.filter((accountId) => String(accountId || '').slice(0, 15) !== accountKey));
    if (checked && !draftAction.partyAccountId && (candidate.roles || []).length) {
      const side = candidate.roles.includes('supplier') ? 'supplier' : candidate.roles[0];
      setDraftAction((current) => ({
        ...current,
        actionType: side === 'buyer' ? 'issue_buyer_credit_note' : 'resolve_supplier_dispute',
        partyType: side,
        partySide: side,
        partyName: candidate.name,
        partyAccountId: candidate.accountId,
        partyKey: candidate.partyKey,
      }));
    }
    setError(null);
  };
  const openUpload = async ({ party, partySide, action = null, supplierInstruction: instruction = null }) => {
    if (!party?.accountId || !partySide) {
      setError('Select a disputed Account before uploading a document.');
      return;
    }
    if (party.id && caseRow?.id && (!action || action.id)) {
      setUploadTarget({ caseRow, party, partySide, action, supplierInstruction: instruction });
      return;
    }
    if (!canEdit) {
      setError('This workflow is locked and the selected Account has not been saved.');
      return;
    }
    const saved = await saveDraft();
    const savedParty = (saved?.parties || []).find((item) => String(item.accountId || '').slice(0, 15) === String(party.accountId || '').slice(0, 15));
    const savedAction = action ? (saved?.actions || []).find((item) => item.partyAccountId === action.partyAccountId && (item.partySide || item.partyType) === (action.partySide || action.partyType)) : null;
    if (!saved?.case?.id || !savedParty?.id || (action && !savedAction?.id)) {
      setError('The Account selection could not be saved for document upload.');
      return;
    }
    const savedInstruction = instruction ? (saved?.supplierInstructions || []).find((item) => item.id === instruction.id) : null;
    setUploadTarget({ caseRow: saved.case, party: savedParty, partySide, action: savedAction, supplierInstruction: savedInstruction });
  };
  const submitForApproval = async () => {
    const saved = await saveDraft();
    if (!saved?.case?.id) return;
    await invokeWorkflow('disputeWorkflowSubmitApproval', { caseId: saved.case.id, note });
  };
  const confirmDecision = async (decisionNote) => {
    let result = null;
    if (decisionMode === 'approve') result = await invokeWorkflow('disputeWorkflowApprove', { caseId: caseRow.id, note: decisionNote || 'Approved.' });
    if (decisionMode === 'revision') result = await invokeWorkflow('disputeWorkflowReject', { caseId: caseRow.id, reason: decisionNote, revisionRequested: true });
    if (decisionMode === 'reject') result = await invokeWorkflow('disputeWorkflowReject', { caseId: caseRow.id, reason: decisionNote, revisionRequested: false });
    if (decisionMode === 'close') result = await invokeWorkflow('disputeWorkflowClose', { caseId: caseRow.id, note: decisionNote });
    if (result) setDecisionMode(null);
  };
  const documentUploaded = async (document) => {
    setDocuments((prev) => [document, ...prev.filter((item) => item.id !== document.id)]);
    await onSaved?.(stem.Id);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="flex h-[92vh] w-[min(1180px,96vw)] max-w-none flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pr-8">
            <span>Dispute Workflow - {stem._Display_Name || stem.Name}</span>
            <span className="text-sm font-medium text-muted-foreground">Delivery {fmtDate(stem.Delivery_Date__c || stem.Expected_Delivery_Date__c || stem._Effective_Date)}</span>
          </DialogTitle>
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
          {reconciliationError && <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="font-semibold">Supplier payment reconciliation requires attention.</div><div className="mt-1">{reconciliationError}</div><div className="mt-2 text-xs">Submission and final closure are blocked until Salesforce payment data can be reconciled.</div></div></div>}
          {legacyReadOnly && !externalClosure && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              This dispute was already closed in Salesforce before FCOS workflow tracking. It is shown as read-only history and is not assigned back to a trader.
            </div>
          )}
          {externalClosure && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">Closed directly in Salesforce.</div>
                <div>
                  FCOS is showing this case as read-only Closed. Its preserved internal stage is {caseRow.internalWorkflowStatus || 'Draft'}.
                  Reopen the dispute in Salesforce to continue that workflow.
                </div>
              </div>
            </div>
          )}
          {missingRequiredDocuments.length > 0 && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><span className="font-semibold">Required documents missing.</span> Save the draft, then upload evidence against each flagged action before submission or approval.</div>
            </div>
          )}
          {supplierAmountRequired.length > 0 && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><span className="font-semibold">Supplier dispute amount required.</span> Record one commercial amount for each flagged supplier before approval, accounting settlement, or closure can continue.</div></div>
          )}
          {supplierConversionRequired.length > 0 && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><span className="font-semibold">Invoice instructions required.</span> Convert each legacy supplier action so Finance can work from the current supplier invoice balances.</div></div>
          )}
          {!externalClosure && caseRow?.salesforceWritebackStatus && caseRow.salesforceWritebackStatus !== 'not_started' && (
            <div className={cn('rounded-lg border p-3 text-xs', caseRow.salesforceWritebackStatus === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900')}>
              Salesforce writeback: {caseRow.salesforceWritebackStatus}
              {caseRow.salesforceWritebackError ? <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{caseRow.salesforceWritebackError}</pre> : null}
            </div>
          )}

          {!legacyReadOnly && !candidateSchemaValid && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <div className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" /> Correct Salesforce Account sources</div>
              <div className="mt-2 space-y-1">
                {partyIssues.length
                  ? partyIssues.map((issue) => <div key={`${issue.code}-${(issue.recordIds || []).join('-')}`}>{issue.message}</div>)
                  : <div>Account candidates could not be resolved from the STEM buyer, line items, and extra costs.</div>}
              </div>
              <div className="mt-2 text-xs">Saving, approval, document upload, and closure remain blocked until the Account lookup data is corrected.</div>
            </div>
          )}

          <section className="space-y-3">
            <StepHeading step="1" title="Disputed Accounts" description="Select at least one buyer or supplier Account involved in this dispute." />
            {candidateSchemaValid && (
              <div className="grid gap-2 md:grid-cols-2">
                {(partyRegistry?.candidates || []).map((candidate) => {
                  const checked = selectedAccountKeys.has(String(candidate.accountId || '').slice(0, 15));
                  const roleLabel = (candidate.roles || []).map((role) => role === 'buyer' ? 'Buyer' : 'Supplier').join(' & ');
                  return (
                    <label key={candidate.accountKey} className={cn('flex min-w-0 items-start gap-3 rounded-lg border p-3', checked ? 'border-primary/40 bg-primary/5' : 'border-border bg-card')}>
                      <Checkbox checked={checked} onCheckedChange={(value) => toggleSelectedAccount(candidate, value === true)} disabled={!editableWorkflow(caseRow) || busy} className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{candidate.name}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{roleLabel}{candidate.paymentTerms?.length ? ` · ${candidate.paymentTerms.join(', ')}` : ''}</span>
                        {candidate.cancelledSourceOnly && <span className="mt-1 block text-[11px] text-amber-700">Eligible from cancelled source item</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {candidateSchemaValid && !selectionValid && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Select at least one disputed Account before saving or adding actions.</div>}
          </section>

          <FinancialExposureSection stem={stem} selectedAccountIds={selectedAccountIds} />

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <StepHeading
                step="3"
                title="Trader Actions"
                description="Add one action per supplier or buyer side. Many suppliers can be linked to one buyer case, and buyer-side action is optional."
              />
              {!canEdit && <span className="text-xs text-muted-foreground">Actions are locked after submission.</span>}
            </div>
            <ActionForm stem={stem} selectedAccountIds={selectedAccountIds} draftAction={draftAction} setDraftAction={setDraftAction} onAdd={addAction} disabled={!canEdit || !selectionValid || busy} />
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[980px] text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Action</th>
                    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Party</th>
                    <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">Amount</th>
                    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Close / Balance</th>
                    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Accounting</th>
                    <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">Control</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((action, index) => {
                    const actionInstructions = supplierInstructions.filter((instruction) => instruction.actionId === action.id && instruction.status !== 'Superseded');
                    return <Fragment key={action.id || action.clientId || index}>
                    <tr className="border-b border-border/40">
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
                      <td className="px-3 py-2 text-muted-foreground">
                        <div>{action.partyName || '—'}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums"><div>{fmtMoney(action.disputeAmount ?? action.amount)}</div>{action.actionType === 'resolve_supplier_dispute' && <div className="text-[11px] text-muted-foreground">{action.currencyIsoCode || 'USD'}</div>}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <div>{action.closeReason || '—'}</div>
                        {action.balancePaymentInstruction && <div>{action.balancePaymentInstruction}</div>}
                        {action.requiresAttachment && <div className="text-amber-700">Attachment required</div>}
                        {action.supplierDisputeAmountRequired && <div className="font-medium text-amber-700">Supplier dispute amount required</div>}
                        {action.supplierInstructionConversionRequired && <div className="font-medium text-amber-700">Convert to invoice instructions</div>}
                        {action.id && <div className="text-[11px] text-muted-foreground">{documents.filter((document) => document.actionId === action.id).length} document(s)</div>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn('rounded-full border px-2 py-0.5 text-xs', accountingStatusTone(actionAccountingStatus(action)))}>
                          {actionAccountingStatus(action)}
                        </span>
                        {action.accountingAt && <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtDateTime(action.accountingAt)}</div>}
                        {action.settlementReference && <div className="mt-0.5 text-[11px] text-muted-foreground">{action.settlementReference}</div>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1.5">
                          {partiesValid && canManageDocuments && (canEdit || action.id) && <Button type="button" variant="outline" size="sm" onClick={() => openUpload({ party: { id: action.partyId, accountId: action.partyAccountId, name: action.partyName }, partySide: action.partySide || action.partyType, action })} disabled={busy} className="gap-1.5" title={action.id ? 'Upload document' : 'Save draft and upload document'}><Upload className="h-3.5 w-3.5" /> Upload</Button>}
                          {!legacyReadOnly && caseRow?.workflowStatus !== 'Closed' && action.partyType === 'supplier' && action.actionType !== 'resolve_supplier_dispute' && action.id && <Button type="button" variant="outline" size="sm" onClick={() => setAmendAction(action)} disabled={busy}>{action.supplierDisputeAmountRequired ? 'Record supplier dispute amount' : 'Convert to invoice instructions'}</Button>}
                          {canEdit && <Button type="button" variant="outline" size="sm" onClick={() => removeAction(index)} disabled={busy}>Remove</Button>}
                          {canAccount && action.id && action.actionType !== 'resolve_supplier_dispute' && <Button type="button" variant="outline" size="sm" onClick={() => setAccountingAction(action)} disabled={busy}>Update</Button>}
                          {!canEdit && !canAccount && !canManageDocuments && '—'}
                        </div>
                      </td>
                    </tr>
                    {action.actionType === 'resolve_supplier_dispute' && <tr className="border-b border-border/40 bg-muted/10"><td colSpan={6} className="px-3 py-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-semibold text-foreground">Supplier invoice instructions</div><div className="text-xs text-muted-foreground">Do not pay {fmtMoney(action.totalDoNotPay)} · Get back paid amount {fmtMoney(action.totalGetBackPaid)}</div></div><div className="space-y-2">{actionInstructions.map((instruction) => <div key={instruction.id} className="grid gap-2 rounded-md border border-border bg-card p-2 text-xs md:grid-cols-[1.25fr_auto_auto_auto]"><div><div className="font-medium text-foreground">{instruction.instructionLabel} · {instruction.sourceSupplierInvoiceName || instruction.sourceSupplierInvoiceId}</div><div className="mt-0.5 text-muted-foreground">{instruction.currencyIsoCode} {fmtMoney(instruction.plannedAmount)} · {instruction.recoveryMethod === 'future_invoice_offset' ? `Offset: ${instruction.targetSupplierInvoiceName || 'Invoice selected'}` : instruction.recoveryMethod === 'cash_refund' ? 'Cash refund' : 'Awaiting finance method'}</div></div><span className={cn('h-fit rounded-full border px-2 py-0.5 text-xs', accountingStatusTone(instruction.status))}>{instruction.status}</span><div className="flex flex-wrap justify-end gap-1.5">{canManageDocuments && <Button type="button" variant="outline" size="sm" onClick={() => openUpload({ party: { id: action.partyId, accountId: action.partyAccountId, name: action.partyName }, partySide: 'supplier', action, supplierInstruction: instruction })} disabled={busy}><Upload className="h-3.5 w-3.5" /></Button>}{(canAccount || (canAcknowledgeUrgentHold && instruction.instructionType === 'withhold_unpaid' && caseRow?.approvalStatus !== 'Approved')) && <Button type="button" variant="outline" size="sm" onClick={() => setSupplierInstruction(instruction)} disabled={busy}>{caseRow?.approvalStatus === 'Approved' ? 'Manage' : 'Acknowledge Hold'}</Button>}</div></div>)}{!actionInstructions.length && <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">Save this draft to generate the invoice-level instructions and urgent holds.</div>}</div></td></tr>}
                    </Fragment>;
                  })}
                  {!actions.length && (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No trader actions added.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <StepHeading step="4" title="Dispute Documents" description="Upload Salesforce files against a selected Account, with an optional action link." />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-xs text-muted-foreground">{documents.length} uploaded</span>
                {partiesValid && selectedDocumentTarget && canManageDocuments && (
                  <>
                    <Select value={selectedDocumentTarget.key} onValueChange={setDocumentPartyKey} disabled={busy}>
                      <SelectTrigger className="h-8 w-[min(260px,70vw)] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {selectedPartySides.map((target) => <SelectItem key={target.key} value={target.key}>{target.party.name} - {target.partySide === 'buyer' ? 'Buyer' : 'Supplier'}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="sm" onClick={() => openUpload(selectedDocumentTarget)} disabled={busy} className="gap-1.5"><Upload className="h-3.5 w-3.5" /> Upload Document</Button>
                  </>
                )}
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[780px] text-xs">
                <thead><tr className="border-b border-border bg-muted/40"><th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Document</th><th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Party / Action</th><th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Type</th><th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground">Uploaded</th><th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-muted-foreground">Open</th></tr></thead>
                <tbody>
                  {documents.map((document) => {
                    const linkedAction = actions.find((action) => action.id === document.actionId);
                    return <tr key={document.id} className="border-b border-border/40"><td className="max-w-[360px] px-3 py-2"><div className="truncate font-medium text-foreground" title={document.fileName}>{document.fileName}</div><div className="truncate text-[11px] text-muted-foreground" title={document.originalFileName}>{document.originalFileName}</div></td><td className="px-3 py-2 text-muted-foreground"><div className="font-medium text-foreground">{document.partyName}</div><div>{linkedAction?.actionLabel || documentDirectionLabel(document.documentDirection) || 'Account document'}</div></td><td className="px-3 py-2 text-muted-foreground">{documentTypeLabel(document.documentType)}</td><td className="px-3 py-2 text-muted-foreground"><div>{fmtDateTime(document.createdAt)}</div><div>{document.uploadedByEmail || '—'}</div></td><td className="px-3 py-2 text-right"><div className="flex justify-end gap-1.5">{documentPreviewKind(document) && <Button type="button" variant="outline" size="sm" onClick={() => setPreviewDocument(document)}><Eye className="h-3.5 w-3.5" /></Button>}{document.salesforceUrl && <Button asChild variant="outline" size="sm"><a href={document.salesforceUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a></Button>}</div></td></tr>;
                  })}
                  {!documents.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No dispute documents uploaded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-muted/10 p-4">
              <StepHeading
                step="5"
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
              step="6"
              title="Approval & Audit Trail"
              description="Approvers release instructions to accounting. Finance records instruction and settlement details before closure."
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
            Next owner: <span className="font-semibold text-foreground">{nextWorkflowOwner(caseRow?.workflowStatus || 'Draft', supplierInstructions)}</span>
            {caseRow?.approvedByEmail ? ` · Approved by ${caseRow.approvedByEmail} at ${fmtDateTime(caseRow.approvedAt)}` : ''}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Close</Button>
            {canEdit && <Button type="button" variant="outline" onClick={saveDraft} disabled={busy || !selectionValid}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save Draft</Button>}
            {canEdit && actions.length > 0 && <Button type="button" onClick={submitForApproval} disabled={busy || !canSubmit} className="gap-2" title={!canSubmit ? reconciliationError ? 'Resolve supplier payment reconciliation before submission' : 'Complete required documents and supplier amounts first' : undefined}><Send className="h-4 w-4" /> Submit for Approval</Button>}
            {canReview && <Button type="button" variant="outline" onClick={() => setDecisionMode('revision')} disabled={busy}>Request Revision</Button>}
            {canReview && <Button type="button" variant="outline" onClick={() => setDecisionMode('reject')} disabled={busy}>Reject</Button>}
            {canApprove && <Button type="button" onClick={() => setDecisionMode('approve')} disabled={busy} className="gap-2"><ShieldCheck className="h-4 w-4" /> Approve</Button>}
            {capabilities?.canClose && caseRow?.workflowStatus === 'Settled - Ready to Close' && <Button type="button" onClick={() => setDecisionMode('close')} disabled={busy || !canClose} title={!canClose && reconciliationError ? 'Resolve supplier payment reconciliation before closure' : undefined} className="gap-2"><CheckCircle2 className="h-4 w-4" /> Close Dispute</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <DocumentUploadModal caseRow={uploadTarget?.caseRow} party={uploadTarget?.party} partySide={uploadTarget?.partySide} action={uploadTarget?.action} supplierInstruction={uploadTarget?.supplierInstruction} existingDocuments={documents} open={Boolean(uploadTarget)} onClose={() => setUploadTarget(null)} onUploaded={documentUploaded} />
    <AccountingUpdateModal action={accountingAction} open={Boolean(accountingAction)} onClose={() => setAccountingAction(null)} onSaved={refreshAfter} />
    <SupplierInstructionModal instruction={supplierInstruction} stem={stem} approvalStatus={caseRow?.approvalStatus} open={Boolean(supplierInstruction)} onClose={() => setSupplierInstruction(null)} onSaved={refreshAfter} />
    <SupplierAmountAmendModal action={amendAction} stem={stem} open={Boolean(amendAction)} onClose={() => setAmendAction(null)} onSaved={refreshAfter} />
    <DocumentPreviewModal document={previewDocument} onClose={() => setPreviewDocument(null)} />
    <WorkflowDecisionModal mode={decisionMode} open={Boolean(decisionMode)} onClose={() => setDecisionMode(null)} onConfirm={confirmDecision} busy={busy} />
    </>
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

export default function DisputeWorkflow() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedStages, setSelectedStages] = useState(['Draft', 'Pending Approval', 'Revision Requested', 'Approved - Pending Accounting', 'Accounting In Progress', 'Settled - Ready to Close']);
  const [managedStem, setManagedStem] = useState(null);
  const [selectedStemId, setSelectedStemId] = useState(null);
  const [capabilities, setCapabilities] = useState({ role: 'user', canPrepare: true, canApprove: false, canAccount: false, canClose: false, canViewAllRules: true });
  const [rulesOpen, setRulesOpen] = useState(false);
  const [fieldWarning, setFieldWarning] = useState('');

  const loadRows = async (options = {}) => {
    setLoading(true);
    setError(null);
    const res = await appClient.functions.invoke('disputeWorkflowList', { limit: 10000 }, { cache: true, force: options.force });
    if (res.data?.error) {
      setError(res.data.error);
      setRows([]);
      setLoading(false);
      return [];
    }
    const nextRows = res.data?.rows || [];
    setRows(nextRows);
    setCapabilities(res.data?.capabilities || {
      role: 'user',
      canPrepare: true,
      canApprove: Boolean(res.data?.isDisputeAdmin),
      canAccount: Boolean(res.data?.isDisputeAccounting),
      canClose: Boolean(res.data?.isDisputeAccounting),
      canViewAllRules: true,
    });
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
      const workflow = workflowFromRow(row);
      const stage = workflow.case?.workflowStatus || 'Draft';
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
        workflow.case?.latestNote,
      ].some((value) => textValue(value, '').toLowerCase().includes(q));
      return stageMatch && textMatch;
    });
  }, [rows, search, selectedStageSet]);

  const totals = useMemo(() => ({
    count: filteredRows.length,
    pending: filteredRows.filter((row) => workflowFromRow(row).case?.workflowStatus === 'Pending Approval').length,
    accounting: filteredRows.filter((row) => ['Approved - Pending Accounting', 'Accounting In Progress'].includes(workflowFromRow(row).case?.workflowStatus)).length,
    readyToClose: filteredRows.filter((row) => workflowFromRow(row).case?.workflowStatus === 'Settled - Ready to Close').length,
    pnl: filteredRows.reduce((sum, row) => sum + Number(workflowFromRow(row).case?.settlementPnl || 0), 0),
  }), [filteredRows]);

  const toggleStage = (stage) => {
    setSelectedStages((prev) => prev.includes(stage) ? prev.filter((item) => item !== stage) : [...prev, stage]);
  };

  const refreshManagedStem = async (stemId, response, options = {}) => {
    if (options.localOnly && response?.case) {
      setRows((current) => current.map((row) => (
        row.Id === stemId ? rowWithWorkflowResponse(row, response) : row
      )));
      setManagedStem((current) => (
        current?.Id === stemId ? rowWithWorkflowResponse(current, response) : current
      ));
      setLastRefresh(new Date());
      return;
    }
    const nextRows = await loadRows({ force: true });
    if (stemId) setManagedStem(nextRows.find((row) => row.Id === stemId) || null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-4 md:p-5">
      <PageHeader
        icon={FileCheck2}
        eyebrow="Dispute workflow"
        title="Dispute Workflow"
        description="Trader instructions, approval, accounting settlement, Salesforce documents, and closure."
        className="shrink-0"
        meta={lastRefresh ? `Last updated ${format(lastRefresh, 'HH:mm:ss')}` : 'Auto-loaded from Salesforce and Supabase'}
        actions={(
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setRulesOpen(true)} className="gap-2"><BookOpen className="h-4 w-4" /> Workflow Rules</Button>
            <Button variant="outline" onClick={() => loadRows({ force: true })} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </Button>
          </div>
        )}
      />

      {fieldWarning && (
        <div className="shrink-0 rounded-xl border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
          <div className="font-semibold text-foreground">Workflow data storage</div>
          <div className="mt-1">{fieldWarning}</div>
        </div>
      )}

      <div className="grid shrink-0 gap-3 md:grid-cols-5">
        <Metric label="Disputed STEMs" value={totals.count.toLocaleString()} tone="red" />
        <Metric label="Pending Approval" value={totals.pending.toLocaleString()} tone="amber" />
        <Metric label="Pending Accounting" value={totals.accounting.toLocaleString()} />
        <Metric label="Ready to Close" value={totals.readyToClose.toLocaleString()} tone="green" />
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

      <TableShell title="Dispute Workflow Queue" meta={`${filteredRows.length.toLocaleString()} rows`} bodyClassName="min-h-0 flex-1 p-0" className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <StateBlock icon={Loader2} title="Loading Dispute Workflow..." description="Fetching disputed STEMs and workflow state." />
        ) : filteredRows.length ? (
          <div className="h-full min-h-0 overflow-auto overscroll-contain">
            <table className="w-full min-w-[1480px] text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Stem</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Workflow</th>
                  <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Next Owner</th>
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
                  const workflow = workflowFromRow(row);
                  const stage = workflow.case?.workflowStatus || 'Draft';
                  const detailLines = queueDetailLines(row);
                  const hasPartyIssues = !workflow.case?.legacyReadOnly && row._Dispute_Parties?.candidateSchemaValid !== true;
                  const legacyReadOnly = workflow.case?.legacyReadOnly === true;
                  const needsPartySelection = !legacyReadOnly && row._Dispute_Parties?.candidateSchemaValid === true && row._Dispute_Parties?.selectionValid !== true;
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
                        {workflow.case?.externalClosure && <div className="mt-1 text-[11px] font-medium text-amber-700">Changed directly in Salesforce</div>}
                        {hasPartyIssues && <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-destructive"><AlertCircle className="h-3 w-3" /> Salesforce party issue</div>}
                        {needsPartySelection && <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-700"><AlertCircle className="h-3 w-3" /> Party selection required</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-medium text-foreground">{nextWorkflowOwner(stage, workflow.supplierInstructions || workflow.actions?.flatMap((action) => action.supplierInstructions || []))}</td>
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
                                  <div className="truncate font-medium text-foreground" title={line.supplierLabel || line.supplierName}>{line.supplierLabel || line.supplierName || 'Supplier'}</div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {line.dueDate ? `Due ${fmtDate(line.dueDate)}` : 'Due —'}
                                  </div>
                                </>
                              ) : <span className="sr-only">Same supplier</span>}
                            </div>
                          ))}
                          {detailLines.length > 5 && <div className="text-[11px] text-muted-foreground">+{detailLines.length - 5} more</div>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{row.Dispute_Status__c || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">{fmtMoney(workflow.case?.settlementPnl || 0)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        {workflow.case?.approvedByEmail ? (
                          <div>
                            <div className="font-medium text-foreground">{workflow.case.approvedByEmail}</div>
                            <div className="text-[11px]">{fmtDateTime(workflow.case.approvedAt)}</div>
                          </div>
                        ) : workflow.case?.submittedByEmail ? (
                          <div>
                            <div>{workflow.case.submittedByEmail}</div>
                            <div className="text-[11px]">{fmtDateTime(workflow.case.submittedAt)}</div>
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
                          <CircleDollarSign className="h-3.5 w-3.5" /> {legacyReadOnly ? 'View' : 'Manage'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <StateBlock title="No Dispute Workflow records found" description="No records match the current filters." />
        )}
      </TableShell>

      <StemDetailModal stemId={selectedStemId} open={!!selectedStemId} onClose={() => setSelectedStemId(null)} />
      <ManageWorkflowModal
        stem={managedStem}
        open={!!managedStem}
        onClose={() => setManagedStem(null)}
        onSaved={refreshManagedStem}
        capabilities={capabilities}
      />
      <WorkflowRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} capabilities={capabilities} />
    </div>
  );
}
