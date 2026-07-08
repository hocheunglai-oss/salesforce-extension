import { useState, useEffect } from 'react';
import { appClient } from '@/api/appClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { Loader2, AlertCircle, ExternalLink, FileText, Download, Settings, Search, Eye, X, CheckCircle2 } from 'lucide-react';
import { numericValue, textValue } from '@/lib/displayValue';
import { useDownloadAuthToken, withDownloadAuth } from '@/lib/authenticatedDownloadUrl';
import { readDocumentSettings } from '@/lib/documentSettings';

const SF_BASE = "https://fratellicosulich.my.salesforce.com";

const fmtDate = (v) => {
  if (!v) return '—';
  if (typeof v === 'object') return textValue(v);
  try { return format(new Date(v), 'dd MMM yyyy'); } catch { return textValue(v); }
};
const fmtMoney = (v) => {
  const number = numericValue(v);
  return number != null ? `$${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
};
const fmtBool = (v) => v === true ? 'Yes' : v === false ? 'No' : '—';
const fmtQuantity = (v, unit = 'MT') => {
  const number = numericValue(v);
  return number != null ? `${number.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${unit}` : '—';
};
const fmtBytes = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
const lineItemQuantityLabel = (li) => {
  const unit = li._Financial_Quantity_Unit || 'MT';
  if (li._Financial_Quantity != null) return fmtQuantity(li._Financial_Quantity, unit);
  if (li.Quantity_Delivered_Per_BDN__c != null) return fmtQuantity(li.Quantity_Delivered_Per_BDN__c, unit);
  if (li.Is_Quantity_Range__c && li.Quantity_Max__c) return `${li.Quantity__c ?? '—'}–${li.Quantity_Max__c} ${unit}`;
  if (li.Quantity_in_MT__c > 0) return fmtQuantity(li.Quantity_in_MT__c, unit);
  return li.Quantity__c != null ? fmtQuantity(li.Quantity__c, unit) : '—';
};

const SECTIONS = [
  {
    title: 'Overview',
    fields: [
      { key: 'Name', label: 'Stem Name' },
      { key: '_Buyer_Name', label: 'Buyer Name' },
      { key: 'Office__c', label: 'Office' },
      { key: 'Year__c', label: 'Year' },
      { key: 'F_STEM_Invoice__c', label: 'Invoice Type' },
      { key: 'PDD_Classification__c', label: 'PDD Classification' },
      { key: 'PO_Voyage_Number__c', label: 'PO / Voyage No.' },
      { key: 'Status__c', label: 'Status' },
      { key: 'Type__c', label: 'Type' },
    ],
  },
  {
    title: 'Vessel & Port',
    fields: [
      { key: '_Vessel_Name', label: 'Vessel' },
      { key: '_Port_Name', label: 'Port' },
      { key: '_Agent_Name', label: 'Agent' },
      { key: 'ETA_Start_Date__c', label: 'ETA Start', fmt: fmtDate },
      { key: 'ETA_End_Date__c', label: 'ETA End', fmt: fmtDate },
      { key: 'ETA_ETB__c', label: 'ETB', fmt: fmtDate },
    ],
  },
  {
    title: 'Dates',
    fields: [
      { key: 'Stem_Date__c', label: 'Stem Date', fmt: fmtDate },
      { key: 'Delivery_Date__c', label: 'Delivery Date', fmt: fmtDate },
      { key: 'Expected_Delivery_Date__c', label: 'Expected Delivery', fmt: fmtDate },
      { key: 'Due_Date__c', label: 'Due Date', fmt: fmtDate },
      { key: '_Buyer_Pay_Term_Date', label: 'Buyer Invoice Due Date', fmt: fmtDate },
      { key: 'Payment_Date__c', label: 'Payment Date', fmt: fmtDate },
      { key: 'Original_Invoice_Sent_Date__c', label: 'Invoice Sent Date', fmt: fmtDate },
      { key: 'Original_BDN_Sent_Date__c', label: 'BDN Sent Date', fmt: fmtDate },
    ],
  },
  {
    title: 'Dispute',
    fields: [
      { key: 'Dispute__c', label: 'Has Dispute', fmt: fmtBool },
      { key: 'Dispute_Status__c', label: 'Dispute Status' },
      { key: 'Dispute_Type__c', label: 'Dispute Type' },
      { key: 'Dispute_Particular__c', label: 'Dispute Particular' },
    ],
  },
  {
    title: 'Other',
    fields: [
      { key: '_Factoring_Invoice_Name', label: 'Factoring Invoice' },
      { key: 'Mailing_Status__c', label: 'Mailing Status' },
      { key: 'Due_Date_Override__c', label: 'Due Date Override', fmt: fmtBool },
      { key: 'CreatedDate', label: 'Created', fmt: fmtDate },
      { key: 'LastModifiedDate', label: 'Last Modified', fmt: fmtDate },
    ],
  },
];

function SectionHeader({ title }) {
  return (
    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 pb-1.5 border-b border-border">
      {title}
    </h3>
  );
}

const DOCUMENT_PURPOSE_ORDER = [
  'Invoices',
  'Contracts and Compliance',
  'Delivery / BDN Support',
  'Broker / Commission',
  'Other Attachments',
];

const DOCUMENT_REQUIREMENTS = [
  {
    label: 'Invoice to Buyer',
    test: (documents) => documents.some((document) => document.sourceGroup === 'Invoices to Buyer'),
  },
  {
    label: 'Invoice from Supplier',
    test: (documents) => documents.some((document) => document.sourceGroup === 'Invoices from Suppliers'),
  },
  {
    label: 'Contract / Nomination',
    test: (documents) => documents.some((document) => document.sourceGroup === 'Contracts and Compliance'),
  },
  {
    label: 'BDN / Delivery Support',
    test: (documents) => documents.some((document) => (
      document.sourceGroup === 'Product Line Attachments'
      || /\b(bdn|delivery|bunker delivery|delivery note)\b/i.test(documentSearchText(document))
    )),
  },
  {
    label: 'Compliance Document',
    test: (documents) => documents.some((document) => (
      /\b(compliance|pdd|psprs|sanction|kyc|aml|certificate|cert)\b/i.test(documentSearchText(document))
    )),
  },
];

function documentSearchText(document) {
  return [
    document.fileName,
    document.title,
    document.sourceGroup,
    document.sourceLabel,
    document.sourceObject,
    document.fileType,
    document.fileExtension,
    document.ownerName,
    documentPurpose(document),
  ].filter(Boolean).join(' ').toLowerCase();
}

function documentExtension(document) {
  const filenameExtension = String(document.fileName || '').split('.').pop()?.toLowerCase();
  return String(document.fileExtension || filenameExtension || '').toLowerCase();
}

function documentPreviewKind(document) {
  const extension = documentExtension(document);
  const fileType = String(document.fileType || '').toLowerCase();
  if (extension === 'pdf' || fileType.includes('pdf')) return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension) || fileType.startsWith('image/')) return 'image';
  return null;
}

function documentPurpose(document) {
  const sourceGroup = document.sourceGroup || 'Other Related';
  const text = [
    document.fileName,
    document.title,
    document.sourceLabel,
    sourceGroup,
  ].filter(Boolean).join(' ').toLowerCase();
  if (sourceGroup === 'Invoices to Buyer' || sourceGroup === 'Invoices from Suppliers') return 'Invoices';
  if (sourceGroup === 'Contracts and Compliance') return 'Contracts and Compliance';
  if (sourceGroup === 'Product Line Attachments' || /\b(bdn|delivery|bunker delivery|delivery note)\b/i.test(text)) return 'Delivery / BDN Support';
  if (sourceGroup === 'Broker') return 'Broker / Commission';
  return 'Other Attachments';
}

function DocumentsSection({
  documents,
  loading,
  error,
  settings,
  showAll,
  setShowAll,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [previewDocument, setPreviewDocument] = useState(null);
  const downloadAuthToken = useDownloadAuthToken(documents.length > 0);
  const documentUrl = (url) => withDownloadAuth(url, downloadAuthToken);
  const relevantGroups = new Set(settings.relevantSourceGroups || []);
  const baseDocuments = settings.showOnlyRelevant && !showAll
    ? documents.filter((document) => relevantGroups.has(document.sourceGroup))
    : documents;
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const visibleDocuments = normalizedSearch
    ? baseDocuments.filter((document) => documentSearchText(document).includes(normalizedSearch))
    : baseDocuments;
  const groupedDocuments = visibleDocuments.reduce((acc, document) => {
    const group = documentPurpose(document);
    if (!acc[group]) acc[group] = [];
    acc[group].push(document);
    return acc;
  }, {});
  const groupEntries = DOCUMENT_PURPOSE_ORDER
    .filter((group) => groupedDocuments[group]?.length)
    .map((group) => [group, groupedDocuments[group]]);
  const requirementChecklist = DOCUMENT_REQUIREMENTS.map((requirement) => ({
    label: requirement.label,
    found: requirement.test(documents),
  }));
  const missingRequirements = requirementChecklist.filter((item) => !item.found);
  const previewKind = previewDocument ? documentPreviewKind(previewDocument) : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SectionHeader title={`Documents (${visibleDocuments.length}${documents.length !== visibleDocuments.length ? ` of ${documents.length}` : ''})`} />
        <div className="flex items-center gap-2">
          {settings.showOnlyRelevant && documents.length !== visibleDocuments.length && (
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className="text-xs font-medium text-primary hover:underline"
            >
              {showAll ? 'Show relevant only' : 'Show all discovered'}
            </button>
          )}
          <a
            href="/settings"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary"
          >
            <Settings className="h-3 w-3" /> Sources
          </a>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Discovering Salesforce documents…
        </div>
      )}

      {error && !loading && (
        <div className="flex gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {!loading && !error && documents.length === 0 && (
        <div className="rounded-xl border border-border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
          No Salesforce files or legacy attachments were found for this STEM or its related records.
        </div>
      )}

      {!loading && !error && documents.length > 0 && (
        <div className="mb-3 rounded-xl border border-border bg-muted/10 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Required Documents</div>
            {missingRequirements.length > 0 && (
              <div className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                <AlertCircle className="h-3 w-3" /> {missingRequirements.length} missing
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {requirementChecklist.map((item) => (
              <span
                key={item.label}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium ${
                  item.found
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-300 bg-amber-100 text-amber-800'
                }`}
              >
                {item.found ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                {item.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && documents.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search documents..."
                className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DOCUMENT_PURPOSE_ORDER.map((group) => {
                const count = baseDocuments.filter((document) => documentPurpose(document) === group).length;
                if (!count) return null;
                return (
                  <span key={group} className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    {group}: {count}
                  </span>
                );
              })}
            </div>
          </div>

          {visibleDocuments.length === 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-700">
              Documents were found, but none match the current document filters.
            </div>
          )}

          {groupEntries.map(([group, docs]) => (
            <div key={group} className="overflow-hidden rounded-xl border border-border">
              <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group} ({docs.length})
              </div>
              <div className="divide-y divide-border/60">
                {docs.map((document) => (
                  <div key={document.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-xs hover:bg-muted/20">
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground" title={document.fileName || document.title}>
                          {document.fileName || document.title}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <span>{document.sourceGroup || group}</span>
                          <span>{document.sourceLabel || document.sourceObject || group}</span>
                          <span>{document.fileType || document.fileExtension || 'File'}</span>
                          <span>{fmtBytes(document.contentSize)}</span>
                          {document.createdDate && <span>{fmtDate(document.createdDate)}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {documentPreviewKind(document) ? (
                        <button
                          type="button"
                          onClick={() => setPreviewDocument(document)}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground hover:border-primary/40 hover:text-primary"
                        >
                          <Eye className="h-3 w-3" /> Open
                        </button>
                      ) : (
                        <a
                          href={documentUrl(document.downloadUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground hover:border-primary/40 hover:text-primary"
                        >
                          <Download className="h-3 w-3" /> Open
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {previewDocument && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPreviewDocument(null)}
        >
          <div
            className="flex h-[88vh] w-[min(1100px,94vw)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{previewDocument.fileName || previewDocument.title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{previewDocument.sourceGroup} · {previewDocument.sourceLabel || documentPurpose(previewDocument)}</div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={documentUrl(previewDocument.downloadUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewDocument(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-muted/20">
              {previewKind === 'image' ? (
                <div className="flex h-full items-center justify-center overflow-auto p-4">
                  <img
                    src={documentUrl(previewDocument.downloadUrl)}
                    alt={previewDocument.fileName || previewDocument.title || 'Document preview'}
                    className="max-h-full max-w-full rounded-md object-contain"
                  />
                </div>
              ) : (
                <iframe
                  title={previewDocument.fileName || previewDocument.title || 'Document preview'}
                  src={documentUrl(previewDocument.downloadUrl)}
                  className="h-full w-full border-0 bg-background"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PnlBanner({ record, lineItems, extraCosts, buyerBrokers }) {
  const buyer = record.Total_Invoice_Amount__c;
  const uninvoicedSupplierExtraCosts = extraCosts.reduce((sum, ec) => ec.Supplier_Invoice__c || ec.Cancelled__c ? sum : sum + (ec.Line_Total_Buy__c ?? 0), 0);
  const invoicedSupplierExtraCosts = extraCosts.reduce((sum, ec) => !ec.Supplier_Invoice__c || ec.Cancelled__c ? sum : sum + (ec.Line_Total_Buy__c ?? 0), 0);
  const sellOnlySupplierExtraCosts = extraCosts.reduce((sum, ec) => {
    if (ec.Supplier_Invoice__c || ec.Cancelled__c) return sum;
    const buy = ec.Line_Total_Buy__c ?? 0;
    const sell = ec.Line_Total__c ?? 0;
    return buy === 0 && sell > 0 ? sum + sell : sum;
  }, 0);
  const supplierLineTotal = lineItems.reduce((sum, li) => li.Cancelled__c ? sum : sum + (li.Total_Cost__c ?? 0), 0);
  const uninvoicedSupplierLineTotal = lineItems.reduce((sum, li) => li.Cancelled__c || li.Supplier_Invoice__c ? sum : sum + (li.Total_Cost__c ?? 0), 0);
  const supplierInvoiceTotal = record.Total_Invoiced_Amount_From_Suppliers__c ?? 0;
  const hasSupplierInvoiceLines = lineItems.some(li => !li.Cancelled__c && li.Supplier_Invoice__c);
  const rawSupplierBase = supplierInvoiceTotal + (hasSupplierInvoiceLines ? uninvoicedSupplierLineTotal : supplierLineTotal);
  const unmatchedSellOnlyExtra = hasSupplierInvoiceLines ? Math.max(0, sellOnlySupplierExtraCosts - invoicedSupplierExtraCosts) : 0;
  const qlikSupplierCost = record.QLIK_STEM_Line_Item_Total_Cost__c != null || record.QLIK_Costs_Total_Cost__c != null
    ? (record.QLIK_STEM_Line_Item_Total_Cost__c || 0) + (record.QLIK_Costs_Total_Cost__c || 0)
    : null;
  const supplierOverstatement = qlikSupplierCost == null ? 0 : rawSupplierBase + uninvoicedSupplierExtraCosts - qlikSupplierCost;
  const supplierBase = unmatchedSellOnlyExtra > 0 && supplierOverstatement > 0 && supplierOverstatement <= unmatchedSellOnlyExtra + 0.05
    ? qlikSupplierCost - uninvoicedSupplierExtraCosts
    : rawSupplierBase;
  const supplierExtraCosts = uninvoicedSupplierExtraCosts;
  const supplierBrokerComm = lineItems.reduce((sum, li) => {
    if (li.Cancelled__c) return sum;
    const qty = li._Financial_Quantity != null
      ? li._Financial_Quantity
      : (li.Quantity_Delivered_Per_BDN__c != null ? li.Quantity_Delivered_Per_BDN__c : (li.Quantity__c ?? 0));
    return sum + ((li.Suppliers_Brokers_Commission_Per_Unit__c ?? 0) * qty);
  }, 0);
  const buyerBrokerLineComm = lineItems.reduce((sum, li) => {
    if (li.Cancelled__c) return sum;
    const qty = li._Financial_Quantity != null
      ? li._Financial_Quantity
      : (li.Quantity_Delivered_Per_BDN__c != null ? li.Quantity_Delivered_Per_BDN__c : (li.Quantity__c ?? 0));
    const buyerPerUnitTotal = (li.Buyers_Brokers_Commission_Per_Unit__c ?? 0) * qty;
    const suppBrokerPerUnit = li.Suppliers_Brokers_Commission_Per_Unit__c ?? 0;
    const buyerComm = suppBrokerPerUnit !== 0 ? buyerPerUnitTotal : (li.Commission_Cost__c ?? buyerPerUnitTotal);
    return sum + buyerComm;
  }, 0);
  const buyerBrokerLumpsum = buyerBrokers.reduce((sum, bb) => sum + (bb.Commission_Lumpsum__c ?? 0), 0);
  const buyerBrokerComm = buyerBrokerLineComm + buyerBrokerLumpsum;
  if (buyer == null) return null;

  const netProfit = buyer - supplierBase - supplierExtraCosts - buyerBrokerComm - supplierBrokerComm;
  const isPositive = netProfit >= 0;

  return (
    <div className={`mt-3 rounded-xl border px-5 py-3 ${isPositive ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
      <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-0.5">Buyer Invoice</span>
          <span className="font-semibold text-foreground">{fmtMoney(buyer)}</span>
        </div>
        <div className="text-muted-foreground self-end pb-0.5">−</div>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-0.5">Supplier Invoice</span>
          <span className="font-semibold text-foreground">{fmtMoney(supplierBase)}</span>
        </div>
        {supplierExtraCosts !== 0 && (
          <>
            <div className="text-muted-foreground self-end pb-0.5">−</div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground mb-0.5">Extra Costs</span>
              <span className="font-semibold text-foreground">{fmtMoney(supplierExtraCosts)}</span>
            </div>
          </>
        )}
        {buyerBrokerComm !== 0 && (
          <>
            <div className="text-muted-foreground self-end pb-0.5">−</div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground mb-0.5">Buyer Broker</span>
              <span className="font-semibold text-foreground">{fmtMoney(buyerBrokerComm)}</span>
            </div>
          </>
        )}
        {supplierBrokerComm !== 0 && (
          <>
            <div className="text-muted-foreground self-end pb-0.5">−</div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground mb-0.5">Supplier Broker</span>
              <span className="font-semibold text-foreground">{fmtMoney(supplierBrokerComm)}</span>
            </div>
          </>
        )}
        <div className="ml-auto flex flex-col items-end">
          <span className="text-xs text-muted-foreground mb-0.5">Gross Profit</span>
          <span className={`text-base font-bold ${isPositive ? 'text-emerald-700' : 'text-red-600'}`}>{fmtMoney(netProfit)}</span>
        </div>
      </div>
    </div>
  );
}

function PaymentRowsTable({ rows, type, emptyMessage }) {
  const isSupplier = type === 'supplier';
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/10 px-3 py-4 text-sm text-muted-foreground">
        {emptyMessage || (isSupplier ? 'No supplier invoice paid dates found.' : 'No buyer invoice received dates found.')}
      </div>
    );
  }

  return (
    <div className="max-h-[220px] overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {isSupplier && <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left font-semibold text-muted-foreground">Supplier</th>}
            <th className="sticky top-0 z-10 bg-card px-3 py-2 text-right font-semibold text-muted-foreground">Amount</th>
            <th className="sticky top-0 z-10 bg-card px-3 py-2 text-left font-semibold text-muted-foreground">
              {isSupplier ? 'Paid Date' : 'Received Date'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((payment, index) => (
            <tr key={payment.Id || `${type}-${index}`} className={`border-b border-border/40 ${index % 2 ? 'bg-muted/10' : ''}`}>
              {isSupplier && <td className="px-3 py-2 font-medium text-foreground">{payment._Supplier_Name || payment._Supplier_Invoice_Name || payment.Supplier_Invoice__c || '—'}</td>}
              <td className="px-3 py-2 text-right font-medium text-foreground">{payment._Payment_Amount != null ? fmtMoney(payment._Payment_Amount) : '—'}</td>
              <td className="px-3 py-2 text-foreground">{fmtDate(payment.Date__c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BrokerCommissionPaymentTables({ groups, type }) {
  if (!groups.length) return null;
  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const title = `${group.brokerType} (${group.brokerName || 'Broker'}) Commission Invoice Paid Dates`;
        return (
          <div key={group.key || `${group.brokerType}-${group.brokerName}`}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
              <span className="text-xs text-muted-foreground">{group.payments?.length || 0} date{group.payments?.length === 1 ? '' : 's'}</span>
            </div>
            <PaymentRowsTable
              rows={group.payments || []}
              type={type}
              emptyMessage="No broker commission paid dates found."
            />
          </div>
        );
      })}
    </div>
  );
}

function FinancialMetric({ label, value, tone = 'default' }) {
  const toneClass = tone === 'receivable'
    ? 'text-blue-700'
    : tone === 'payable'
      ? 'text-amber-700'
      : 'text-foreground';
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-base font-semibold ${toneClass}`}>{fmtMoney(value)}</div>
    </div>
  );
}

function FinancialSummaryCard({ record, supplierPayments, buyerPayments, brokerCommissionPayments }) {
  const buyerBrokerGroups = (brokerCommissionPayments || []).filter((group) => group.brokerType === 'Buyer Broker');
  const secondaryBuyerBrokerGroups = (brokerCommissionPayments || []).filter((group) => group.brokerType === 'Secondary Buyer Broker');
  const supplierBrokerGroups = (brokerCommissionPayments || []).filter((group) => group.brokerType === 'Supplier Broker');
  return (
    <div className="rounded-xl bg-muted/20 p-4 md:col-span-2 xl:col-span-3">
      <SectionHeader title="Financials" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Buyer Side</div>
            <div className="text-xs text-muted-foreground">Invoice value, open receivable, and received dates.</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <FinancialMetric label="Buyer Invoice Amount" value={record.Total_Invoice_Amount__c} />
            <FinancialMetric label="Receivable Balance" value={record.Receivable_Balance__c} tone="receivable" />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Buyer Invoice Received Dates</h4>
              <span className="text-xs text-muted-foreground">{buyerPayments.length} date{buyerPayments.length === 1 ? '' : 's'}</span>
            </div>
            <PaymentRowsTable rows={buyerPayments} type="buyer" />
          </div>
          <BrokerCommissionPaymentTables groups={buyerBrokerGroups} type="buyer" />
          <BrokerCommissionPaymentTables groups={secondaryBuyerBrokerGroups} type="buyer" />
        </div>
        <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50/40 p-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Seller Side</div>
            <div className="text-xs text-muted-foreground">Supplier invoice value, open payable, and paid dates.</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <FinancialMetric label="Supplier Invoice Amount" value={record._Supplier_Invoice_Amount} />
            <FinancialMetric label="Payable Balance" value={record.Payable_Balance__c} tone="payable" />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Supplier Invoice Paid Dates</h4>
              <span className="text-xs text-muted-foreground">{supplierPayments.length} date{supplierPayments.length === 1 ? '' : 's'}</span>
            </div>
            <PaymentRowsTable rows={supplierPayments} type="supplier" />
          </div>
          <BrokerCommissionPaymentTables groups={supplierBrokerGroups} type="supplier" />
        </div>
      </div>
    </div>
  );
}

export default function StemDetailModal({ stemId, open, onClose }) {
  const [record, setRecord] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [extraCosts, setExtraCosts] = useState([]);
  const [buyerBrokers, setBuyerBrokers] = useState([]);
  const [supplierInvoicePayments, setSupplierInvoicePayments] = useState([]);
  const [buyerInvoicePayments, setBuyerInvoicePayments] = useState([]);
  const [brokerCommissionPayments, setBrokerCommissionPayments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState(null);
  const [documentSettings, setDocumentSettings] = useState(readDocumentSettings);
  const [showAllDocuments, setShowAllDocuments] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !stemId) return;
    setRecord(null);
    setLineItems([]);
    setExtraCosts([]);
    setBuyerBrokers([]);
    setSupplierInvoicePayments([]);
    setBuyerInvoicePayments([]);
    setBrokerCommissionPayments([]);
    setDocuments([]);
    setDocumentsError(null);
    setDocumentsLoading(true);
    setDocumentSettings(readDocumentSettings());
    setShowAllDocuments(false);
    setError(null);
    setLoading(true);
    appClient.functions.invoke('salesforceStemDetail', { stemId }).then(res => {
      if (res.data?.error) setError(res.data.error);
      else {
        setRecord(res.data.record);
        setLineItems(res.data.lineItems || []);
        setExtraCosts(res.data.extraCosts || []);
        setBuyerBrokers(res.data.buyerBrokers || []);
        setSupplierInvoicePayments(res.data.supplierInvoicePayments || []);
        setBuyerInvoicePayments(res.data.buyerInvoicePayments || []);
        setBrokerCommissionPayments(res.data.brokerCommissionPayments || []);
      }
      setLoading(false);
    });
    appClient.functions.invoke('salesforceStemDocuments', { stemId }).then(res => {
      if (res.data?.error) setDocumentsError(res.data.error);
      else {
        setDocuments(res.data?.documents || []);
      }
      setDocumentsLoading(false);
    });
  }, [open, stemId]);

  // Build a map from line item ID → buyer broker info
  const lineItemBuyerBrokerMap = {};
  buyerBrokers.forEach(bb => {
    const liId = bb['STEM_Line_Item__r']?.Id;
    if (liId) {
      if (!lineItemBuyerBrokerMap[liId]) lineItemBuyerBrokerMap[liId] = [];
      lineItemBuyerBrokerMap[liId].push(bb);
    }
  });

  const visibleExtraCosts = extraCosts.filter(ec =>
    !ec.Supplier_Invoice__c && (
      (ec.Unit_Price__c != null && ec.Unit_Price__c !== 0) ||
      (ec.Unit_Cost__c != null && ec.Unit_Cost__c !== 0) ||
      (ec.Line_Total__c != null && ec.Line_Total__c !== 0) ||
      (ec.Line_Total_Buy__c != null && ec.Line_Total_Buy__c !== 0)
    )
  );

  const getSecondaryBuyerBrokerUnit = (li) => {
    const suppBrokerPerUnit = Number(li.Suppliers_Brokers_Commission_Per_Unit__c || 0);
    if (suppBrokerPerUnit !== 0 || li.Commission_Cost__c == null) return null;
    const qty = li._Financial_Quantity != null
      ? li._Financial_Quantity
      : (li.Quantity_Delivered_Per_BDN__c != null ? li.Quantity_Delivered_Per_BDN__c : (li.Quantity__c ?? 0));
    if (!qty) return null;
    const primaryUnit = Number(li.Buyers_Brokers_Commission_Per_Unit__c || 0);
    const secondaryUnit = (Number(li.Commission_Cost__c || 0) / qty) - primaryUnit;
    return secondaryUnit > 0 ? secondaryUnit : null;
  };
  const showSecondaryBuyerBrokerUnit = lineItems.some(li => getSecondaryBuyerBrokerUnit(li) != null);

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-[95vw] w-[1400px] max-h-[92vh] overflow-hidden flex flex-col p-0">
          {/* Sticky Header */}
          <DialogHeader className="sticky top-0 z-20 px-7 pt-6 pb-4 border-b border-border shrink-0 bg-card/95 backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Stem Detail</p>
                <DialogTitle className="text-xl font-bold font-dm">
                  {record?.Name || stemId}
                </DialogTitle>
                {record?._Vessel_Name && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {record._Vessel_Name}
                    {record._Port_Name && <span className="ml-2 text-muted-foreground/60">· {record._Port_Name}</span>}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {record && (
                  <a
                    href={`${SF_BASE}/${record.Id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary px-2.5 py-1.5 rounded-md border border-border hover:border-primary/40 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Salesforce
                  </a>
                )}
              </div>
            </div>

            {record && <PnlBanner record={record} lineItems={lineItems} extraCosts={extraCosts} buyerBrokers={buyerBrokers} />}

            {record?.Dispute_Status__c && record.Dispute_Status__c !== 'No Dispute' && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Disputed — {record.Dispute_Status__c}{record.Dispute_Type__c ? ` · ${record.Dispute_Type__c}` : ''}</span>
              </div>
            )}
          </DialogHeader>

          {/* Scrollable Body */}
          <div className="overflow-y-auto flex-1 px-7 py-6">
            {loading && (
              <div className="flex items-center justify-center py-20 text-muted-foreground gap-3">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading…
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
              </div>
            )}

            {record && !loading && (
              <div className="space-y-7">
                {/* Info sections in a 3-col grid */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <FinancialSummaryCard record={record} supplierPayments={supplierInvoicePayments} buyerPayments={buyerInvoicePayments} brokerCommissionPayments={brokerCommissionPayments} />
                  {SECTIONS.map(section => {
                    const rows = section.fields.filter(f => {
                      const v = record[f.key];
                      return v != null && v !== '' && v !== false;
                    });
                    if (!rows.length) return null;
                    return (
                      <div key={section.title} className="bg-muted/20 rounded-xl p-4">
                        <SectionHeader title={section.title} />
                        <div className="space-y-2">
                          {rows.map(f => {
                            const raw = record[f.key];
                            const display = f.fmt ? f.fmt(raw) : textValue(raw);
                            return (
                              <div key={f.key} className="flex justify-between gap-3 text-sm">
                                <span className="text-muted-foreground shrink-0">{f.label}</span>
                                <span className="text-foreground font-medium text-right">{display}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Line Items */}
                {lineItems.length > 0 && (
                  <div>
                    <SectionHeader title={`Line Items (${lineItems.length})`} />
                    <div className="max-h-[360px] overflow-auto rounded-xl border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/40 border-b border-border">
                            <th className="sticky top-0 z-10 bg-card text-left py-2.5 px-3 font-semibold text-muted-foreground">Product</th>
                            <th className="sticky top-0 z-10 bg-card text-left py-2.5 px-3 font-semibold text-muted-foreground">Supplier</th>
                            {lineItems.some(li => li.BDN_Company__c) && (
                              <th className="sticky top-0 z-10 bg-card text-left py-2.5 px-3 font-semibold text-muted-foreground">BDN Company</th>
                            )}
                            <th className="sticky top-0 z-10 bg-card text-right py-2.5 px-3 font-semibold text-muted-foreground">Qty (MT)</th>
                            <th className="sticky top-0 z-10 bg-card text-right py-2.5 px-3 font-semibold text-muted-foreground">Sell/Unit</th>
                            <th className="sticky top-0 z-10 bg-card text-right py-2.5 px-3 font-semibold text-muted-foreground">Buy/Unit</th>
                            <th className="sticky top-0 z-10 bg-card text-right py-2.5 px-3 font-semibold text-muted-foreground">Total Sell</th>
                            <th className="sticky top-0 z-10 bg-card text-right py-2.5 px-3 font-semibold text-muted-foreground">Total Buy</th>
                            <th className="sticky top-0 z-10 bg-card text-left py-2.5 px-3 font-semibold text-muted-foreground">Buyer Broker</th>
                            <th className="sticky top-0 z-10 bg-card text-right py-2.5 px-3 font-semibold text-muted-foreground">Buyer Broker/Unit</th>
                            {showSecondaryBuyerBrokerUnit && (
                              <th className="sticky top-0 z-10 bg-card text-right py-2.5 px-3 font-semibold text-muted-foreground">Buyer Broker (Secondary)/Unit</th>
                            )}
                            <th className="sticky top-0 z-10 bg-card text-left py-2.5 px-3 font-semibold text-muted-foreground">Supp Broker</th>
                            <th className="sticky top-0 z-10 bg-card text-right py-2.5 px-3 font-semibold text-muted-foreground">Supp Broker/Unit</th>

                          </tr>
                        </thead>
                        <tbody>
                          {lineItems.map((li, idx) => {
                            // Buyer broker: from STEM_Buyer_Broker__c linked to this line item, fallback to stem-level broker name
                            const bbs = lineItemBuyerBrokerMap[li.Id] || [];
                            const bbLumpsum = bbs.reduce((s, bb) => s + (bb.Commission_Lumpsum__c ?? 0), 0);
                            const bbName = bbs.map(bb => bb._Buyer_Broker_Name).filter(Boolean).join(', ')
                              || record._Buyer_Broker_Name || null;
                            return (
                              <tr key={li.Id} className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${idx % 2 === 0 ? '' : 'bg-muted/10'}`}>
                                <td className="py-2.5 px-3 font-medium text-foreground">{li._Product_Name || '—'}</td>
                                <td className="py-2.5 px-3 text-muted-foreground">{li.Supplier_Name__c || '—'}</td>
                                {lineItems.some(l => l.BDN_Company__c) && (
                                  <td className="py-2.5 px-3 text-muted-foreground">{li.BDN_Company__c || '—'}</td>
                                )}
                                <td className="py-2.5 px-3 text-right text-foreground">
                                  {lineItemQuantityLabel(li)}
                                </td>
                                <td className="py-2.5 px-3 text-right text-foreground">
                                  {li.Price_Per_Unit__c != null
                                    ? fmtMoney(li.Price_Per_Unit__c)
                                    : li.Unit_Sell_At__c != null
                                      ? fmtMoney(li.Unit_Sell_At__c)
                                      : li['Offer_Line_Item__r']?.UnitPrice != null
                                        ? fmtMoney(li['Offer_Line_Item__r'].UnitPrice)
                                        : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-right text-foreground">
                                  {li.Cost_Per_Unit__c != null
                                    ? fmtMoney(li.Cost_Per_Unit__c)
                                    : li.Unit_Buy_At__c != null
                                      ? fmtMoney(li.Unit_Buy_At__c)
                                      : li.Unit_Cost__c != null
                                        ? fmtMoney(li.Unit_Cost__c)
                                        : li['Offer_Line_Item__r']?.Supplier_Unit_Price__c != null
                                          ? fmtMoney(li['Offer_Line_Item__r'].Supplier_Unit_Price__c)
                                          : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-right font-semibold text-foreground">{li.Total_Price__c != null ? fmtMoney(li.Total_Price__c) : '—'}</td>
                                <td className="py-2.5 px-3 text-right font-semibold text-foreground">{li.Total_Cost__c != null ? fmtMoney(li.Total_Cost__c) : '—'}</td>
                                <td className="py-2.5 px-3 text-left text-muted-foreground">{bbName || '—'}</td>
                                <td className="py-2.5 px-3 text-right text-foreground">{li.Buyers_Brokers_Commission_Per_Unit__c != null ? fmtMoney(li.Buyers_Brokers_Commission_Per_Unit__c) : '—'}</td>
                                {showSecondaryBuyerBrokerUnit && (
                                  <td className="py-2.5 px-3 text-right text-foreground">{getSecondaryBuyerBrokerUnit(li) != null ? fmtMoney(getSecondaryBuyerBrokerUnit(li)) : '—'}</td>
                                )}
                                <td className="py-2.5 px-3 text-left text-muted-foreground">{li._Supplier_Broker_Name || '—'}</td>
                                <td className="py-2.5 px-3 text-right text-foreground">{li.Suppliers_Brokers_Commission_Per_Unit__c != null ? fmtMoney(li.Suppliers_Brokers_Commission_Per_Unit__c) : '—'}</td>

                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Extra Costs */}
                {visibleExtraCosts.length > 0 && (
                  <div>
                    <SectionHeader title={`Extra Costs (${visibleExtraCosts.length})`} />

                    <div className="max-h-[320px] overflow-auto rounded-xl border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/40 border-b border-border">
                            <th className="sticky top-0 z-10 bg-card text-left py-2.5 px-3 font-semibold text-muted-foreground">Name</th>
                            <th className="sticky top-0 z-10 bg-card text-left py-2.5 px-3 font-semibold text-muted-foreground">Product</th>
                            <th className="sticky top-0 z-10 bg-card text-left py-2.5 px-3 font-semibold text-muted-foreground">Supplier</th>
                            <th className="sticky top-0 z-10 bg-card text-right py-2.5 px-3 font-semibold text-muted-foreground">Qty (MT)</th>
                            <th className="sticky top-0 z-10 bg-card text-right py-2.5 px-3 font-semibold text-muted-foreground">Sell/Unit</th>
                            <th className="sticky top-0 z-10 bg-card text-right py-2.5 px-3 font-semibold text-muted-foreground">Buy/Unit</th>
                            <th className="sticky top-0 z-10 bg-card text-right py-2.5 px-3 font-semibold text-muted-foreground">Total Sell</th>
                            <th className="sticky top-0 z-10 bg-card text-right py-2.5 px-3 font-semibold text-muted-foreground">Total Buy</th>
                            <th className="sticky top-0 z-10 bg-card text-right py-2.5 px-3 font-semibold text-muted-foreground">Net</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleExtraCosts.map((ec, idx) => {
                            const productName = ec._Product_Name || (ec['Product2Id__r']?.Name) || ec.Description__c || '—';
                            const net = (ec.Line_Total__c ?? 0) - (ec.Line_Total_Buy__c ?? 0);
                            const isNegative = net < 0 && ((ec.Line_Total__c != null && ec.Line_Total_Buy__c != null) || ec.Line_Total__c != null || ec.Line_Total_Buy__c != null);
                            const isCancelled = ec.Cancelled__c === true;
                            return (
                            <tr key={ec.Id} className={`border-b transition-colors ${isCancelled ? 'bg-red-100 border-red-300 hover:bg-red-100' : isNegative ? 'bg-red-50 border-red-200 hover:bg-red-50' : `border-border/40 hover:bg-muted/20 ${idx % 2 === 0 ? '' : 'bg-muted/10'}`}`}>
                              <td className="py-2.5 px-3 font-medium text-foreground">
                                <div className="flex items-center gap-2">
                                  <span>{ec.Name || '—'}</span>
                                  {isCancelled && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Cancelled</span>}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-muted-foreground">{productName}</td>
                              <td className="py-2.5 px-3 text-muted-foreground">{ec.Supplier_Name__c || '—'}</td>
                              <td className="py-2.5 px-3 text-right text-foreground">
                                {ec._Financial_Quantity != null
                                  ? fmtQuantity(ec._Financial_Quantity, ec._Financial_Quantity_Unit || 'MT')
                                  : (ec.Quantity__c != null ? fmtQuantity(ec.Quantity__c, ec._Financial_Quantity_Unit || 'MT') : '—')}
                              </td>
                              <td className="py-2.5 px-3 text-right text-foreground">{ec.Unit_Price__c != null ? fmtMoney(ec.Unit_Price__c) : '—'}</td>
                              <td className="py-2.5 px-3 text-right text-foreground">{ec.Unit_Cost__c != null ? fmtMoney(ec.Unit_Cost__c) : '—'}</td>
                              <td className="py-2.5 px-3 text-right font-semibold text-foreground">{ec.Line_Total__c != null ? fmtMoney(ec.Line_Total__c) : '—'}</td>
                              <td className="py-2.5 px-3 text-right font-semibold text-foreground">{ec.Line_Total_Buy__c != null ? fmtMoney(ec.Line_Total_Buy__c) : '—'}</td>
                              <td className={`py-2.5 px-3 text-right font-semibold ${isNegative ? 'text-red-600' : 'text-emerald-700'}`}>{ec.Line_Total__c != null && ec.Line_Total_Buy__c != null ? fmtMoney(net) : '—'}</td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Buyer Brokers */}
                {buyerBrokers.length > 0 && (
                  <div>
                    <SectionHeader title={`Buyer Brokers (${buyerBrokers.length})`} />
                    <div className="rounded-xl border border-border overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/40 border-b border-border">
                            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground">Broker</th>
                            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground">Ref Code</th>
                            <th className="text-right py-2.5 px-3 font-semibold text-muted-foreground">Commission</th>
                            <th className="text-left py-2.5 px-3 font-semibold text-muted-foreground">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {buyerBrokers.map((bb, idx) => (
                            <tr key={bb.Id} className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${idx % 2 === 0 ? '' : 'bg-muted/10'}`}>
                              <td className="py-2.5 px-3 font-medium text-foreground">{bb._Buyer_Broker_Name || '—'}</td>
                              <td className="py-2.5 px-3 text-muted-foreground">{bb.Refcode_Index__c || '—'}</td>
                              <td className="py-2.5 px-3 text-right text-foreground">{bb.Commission_Lumpsum__c != null ? fmtMoney(bb.Commission_Lumpsum__c) : '—'}</td>
                              <td className="py-2.5 px-3">
                                {bb.Exported__c
                                  ? <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">Exported</span>
                                  : <span className="text-muted-foreground">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <DocumentsSection
                  documents={documents}
                  loading={documentsLoading}
                  error={documentsError}
                  settings={documentSettings}
                  showAll={showAllDocuments}
                  setShowAll={setShowAllDocuments}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}
