import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, Eye, FileText, Loader2, Pencil, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { numericValue, textValue } from '@/lib/displayValue';

const fmtDate = (value) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return textValue(value);
  }
};

const fmtBytes = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fmtMoney = (value) => {
  const number = numericValue(value);
  if (number == null) return '—';
  return `$${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const UPLOAD_NAME_PRESETS = [
  { label: 'From Supplier', value: 'from supplier' },
  { label: 'To Supplier', value: 'to supplier' },
  { label: 'From Buyer', value: 'from buyer' },
  { label: 'To Buyer', value: 'to buyer' },
];
const DISPUTE_STATUS_OPTIONS = [
  'Opened',
  'Closed with Supplier only',
  'Closed with Buyer only',
  'Closed',
];

const todayUploadDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const uploadDocumentName = (date, preset) => `${date || todayUploadDate()} ${preset || UPLOAD_NAME_PRESETS[0].value}`;

const documentExtension = (document) => {
  const filenameExtension = String(document.fileName || '').split('.').pop()?.toLowerCase();
  return String(document.fileExtension || filenameExtension || '').toLowerCase();
};

const documentPreviewKind = (document) => {
  const extension = documentExtension(document);
  const fileType = String(document.fileType || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension) || fileType.startsWith('image/')) return 'image';
  if (extension === 'pdf' || fileType.includes('pdf')) return 'pdf';
  if (['txt', 'csv'].includes(extension) || fileType.startsWith('text/')) return 'text';
  return null;
};

const documentKind = (document) => document.attachmentId ? 'attachment' : 'contentDocument';

const documentSearchText = (document) => [
  document.fileName,
  document.title,
  document.sourceGroup,
  document.sourceLabel,
  document.sourceObject,
  document.fileType,
  document.fileExtension,
].filter(Boolean).join(' ').toLowerCase();

const isDisputeFlowDocument = (document) => document.sourceGroup === 'Direct STEM';
const isDeductBelowAmountStatus = (value) => /deduct\s+below\s+amount/i.test(textValue(value, ''));
const isBdnDocument = (document) => (
  document.sourceGroup === 'Product Line Attachments'
  || /\b(bdn|delivery|bunker delivery|delivery note)\b/i.test(documentSearchText(document))
);
const isInvoiceNamedBdnSourceDocument = (document) => {
  const nameText = [document.fileName, document.title].filter(Boolean).join(' ').toLowerCase();
  return nameText.includes('inv') && isBdnDocument(document);
};
const isStemDocument = (document) => (
  !isInvoiceNamedBdnSourceDocument(document)
  && (
    document.sourceGroup === 'Invoices to Buyer'
    || document.sourceGroup === 'Invoices from Suppliers'
    || document.sourceGroup === 'Contracts and Compliance'
    || isBdnDocument(document)
  )
);

const documentSourceLabel = (document) => {
  if (isBdnDocument(document)) return 'BDN';
  if (document.sourceGroup === 'Invoices to Buyer') {
    return document.sourceLabel && /factoring/i.test(document.sourceLabel)
      ? 'Invoices to Buyer / Factoring Invoice'
      : 'Invoices to Buyer';
  }
  return document.sourceGroup || 'Document';
};

const documentSourceDetail = (document) => {
  const sourceLabel = documentSourceLabel(document);
  const detail = document.sourceLabel;
  if (!detail || detail === sourceLabel) return '';
  if (/factoring/i.test(sourceLabel) && /factoring/i.test(detail)) return '';
  return ` · ${detail}`;
};

const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
  reader.onerror = () => reject(reader.error || new Error('Unable to read file.'));
  reader.readAsDataURL(file);
});

const lineValues = (value) => textValue(value, '')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

function TextLines({ value }) {
  const lines = lineValues(value);
  if (!lines.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-1">
      {lines.map((line, index) => (
        <div key={`${line}-${index}`} className="leading-5">{line}</div>
      ))}
    </div>
  );
}

function DetailSection({ title, meta, children }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/20 px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        {meta && <div className="text-[11px] text-muted-foreground">{meta}</div>}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function SummaryItem({ label, value, align = 'left' }) {
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-foreground" title={textValue(value, '')}>{value || '—'}</div>
    </div>
  );
}

function PartyDisputeList({ rows, side, fallback, onEditDispute }) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return <TextLines value={fallback} />;
  return (
    <div className="space-y-2">
      {list.map((line, index) => {
        const partyName = side === 'buyer' ? line.buyerName : line.supplierName;
        return (
          <div key={`${line.disputeIds?.join('-') || side}-${partyName || 'party'}-${index}`} className="rounded-lg border border-border bg-muted/10 p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground" title={partyName || ''}>{partyName || '—'}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{line.status || '—'}</div>
              </div>
              {line.disputeIds?.length ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1"
                  onClick={() => onEditDispute?.({ ...line, side })}
                >
                  <Pencil className="h-3 w-3" /> Edit
                </Button>
              ) : null}
            </div>
            {line.description && (
              <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                {line.description}
              </div>
            )}
            {side === 'supplier' && isDeductBelowAmountStatus(line.status) && numericValue(line.deductionAmount) != null && (
              <div className="mt-2 text-xs font-semibold text-amber-700">
                Deduction amount: {fmtMoney(line.deductionAmount)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SupplierFinanceList({ rows, field, fallback }) {
  const list = Array.isArray(rows) ? rows.filter(row => row?.[field] != null || row?.supplierName) : [];
  if (!list.length) {
    return <div className="text-right font-semibold tabular-nums">{fmtMoney(fallback)}</div>;
  }
  return (
    <div className="space-y-1">
      {list.map((row, index) => (
        <div key={`${field}-${row.supplierName || 'supplier'}-${index}`} className="grid grid-cols-[1fr_auto] gap-3 text-sm">
          <div className="truncate text-muted-foreground" title={row.supplierName || ''}>{row.supplierName || '—'}</div>
          <div className="font-semibold tabular-nums text-foreground">{fmtMoney(row[field])}</div>
        </div>
      ))}
    </div>
  );
}

function ProductPartyList({ pairs, supplierFallback, productFallback }) {
  const list = Array.isArray(pairs) ? pairs : [];
  if (!list.length) {
    return (
      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Supplier(s)</div>
          <div className="mt-1 text-sm"><TextLines value={supplierFallback} /></div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product(s)</div>
          <div className="mt-1 text-sm"><TextLines value={productFallback} /></div>
        </div>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Supplier</th>
            <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Product</th>
          </tr>
        </thead>
        <tbody>
          {list.map((pair, index) => (
            <tr key={`${pair.supplierName || 'supplier'}-${pair.productName || 'product'}-${index}`} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-2 text-muted-foreground">{pair.supplierName || '—'}</td>
              <td className="px-3 py-2 font-medium text-foreground">{pair.productName || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocumentPreview({ document, onClose }) {
  const previewKind = documentPreviewKind(document);
  if (!document || !previewKind) return null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col overflow-hidden bg-card">
      <div className="flex h-full w-full flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{document.fileName || document.title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{document.sourceGroup || 'Document'} · {document.sourceLabel || document.fileType || 'Salesforce File'}</div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={document.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </a>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-muted/20">
          {previewKind === 'image' ? (
            <div className="flex h-full items-center justify-center overflow-auto p-3">
              <img
                src={document.downloadUrl}
                alt={document.fileName || document.title || 'Document preview'}
                className="max-h-full max-w-full rounded-md object-contain"
              />
            </div>
          ) : (
            <iframe
              title={document.fileName || document.title || 'Document preview'}
              src={document.downloadUrl}
              className="h-full w-full border-0 bg-background"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function DisputeDocumentsModal({ stem, open, onClose, onEditDispute, onStatusUpdated }) {
  const fileInputRef = useRef(null);
  const [documents, setDocuments] = useState([]);
  const [activeTab, setActiveTab] = useState('disputeFlow');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [managedStatus, setManagedStatus] = useState(stem?.Dispute_Status__c || '');
  const [savingStatus, setSavingStatus] = useState(false);
  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadDate, setUploadDate] = useState(todayUploadDate());
  const [uploadNamePreset, setUploadNamePreset] = useState(UPLOAD_NAME_PRESETS[0].value);
  const [uploadName, setUploadName] = useState(uploadDocumentName(todayUploadDate(), UPLOAD_NAME_PRESETS[0].value));
  const [uploading, setUploading] = useState(false);
  const [renameKey, setRenameKey] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [previewDocument, setPreviewDocument] = useState(null);

  const stemId = stem?.Id;
  const stemName = stem?._Display_Name || stem?.Name || stem?.KeyStem__c || 'STEM';
  const buyerDisputeRows = Array.isArray(stem?._Buyer_Dispute_Rows) ? stem._Buyer_Dispute_Rows : [];
  const supplierDisputeRows = Array.isArray(stem?._Supplier_Dispute_Rows) ? stem._Supplier_Dispute_Rows : [];
  const supplierProductPairs = Array.isArray(stem?._Supplier_Product_Pairs) ? stem._Supplier_Product_Pairs : [];
  const supplierNames = new Set();
  for (const pair of supplierProductPairs) if (pair?.supplierName) supplierNames.add(pair.supplierName);
  for (const row of supplierDisputeRows) if (row?.supplierName) supplierNames.add(row.supplierName);
  for (const name of textValue(stem?._Supplier_Names, '').split(',')) {
    const trimmed = name.trim();
    if (trimmed) supplierNames.add(trimmed);
  }
  const supplierCount = supplierNames.size;
  const supplierSummary = supplierCount > 1 ? `${supplierCount} suppliers` : [...supplierNames][0] || '—';
  const hasStatusChange = managedStatus && managedStatus !== stem?.Dispute_Status__c;

  const sortedDocuments = useMemo(() => documents.slice().sort((a, b) => {
    return String(b.createdDate || '').localeCompare(String(a.createdDate || ''));
  }), [documents]);
  const disputeFlowDocuments = useMemo(() => sortedDocuments.filter(isDisputeFlowDocument), [sortedDocuments]);
  const stemDocuments = useMemo(() => sortedDocuments.filter(isStemDocument), [sortedDocuments]);
  const activeDocuments = activeTab === 'disputeFlow' ? disputeFlowDocuments : stemDocuments;
  const canManageActiveDocuments = activeTab === 'disputeFlow';

  const loadDocuments = async () => {
    if (!stemId) return;
    setLoading(true);
    setError(null);
    const res = await appClient.functions.invoke('salesforceStemDocuments', { stemId });
    if (res.data?.error) {
      setError(res.data.error);
      setDocuments([]);
    } else {
      setDocuments(res.data?.documents || []);
    }
    setLoading(false);
  };

  const resetUploadNaming = () => {
    const date = todayUploadDate();
    const preset = UPLOAD_NAME_PRESETS[0].value;
    setUploadDate(date);
    setUploadNamePreset(preset);
    setUploadName(uploadDocumentName(date, preset));
  };

  const setSelectedUploadFile = (selectedFile) => {
    setFile(selectedFile);
    if (!uploadName.trim()) setUploadName(uploadDocumentName(uploadDate, uploadNamePreset));
  };

  const clearSelectedUploadFile = () => {
    setFile(null);
    setDragActive(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    if (!open) return;
    setDocuments([]);
    setActiveTab('disputeFlow');
    clearSelectedUploadFile();
    resetUploadNaming();
    setRenameKey(null);
    setRenameValue('');
    setPreviewDocument(null);
    setStatusError(null);
    setManagedStatus(stem?.Dispute_Status__c || '');
    loadDocuments();
  }, [open, stemId]);

  useEffect(() => {
    if (open) setManagedStatus(stem?.Dispute_Status__c || '');
  }, [open, stem?.Dispute_Status__c]);

  const applyDocumentResponse = (data) => {
    if (data?.error) {
      setError(data.error);
      return false;
    }
    setDocuments(data?.documents || []);
    setError(null);
    return true;
  };

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0] || null;
    setSelectedUploadFile(selectedFile);
  };

  const handleDragEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleUploadDragEnter = (event) => {
    handleDragEvent(event);
    setDragActive(true);
  };

  const handleUploadDragLeave = (event) => {
    handleDragEvent(event);
    const nextTarget = event.relatedTarget;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) setDragActive(false);
  };

  const handleUploadDrop = (event) => {
    handleDragEvent(event);
    setDragActive(false);
    const droppedFile = event.dataTransfer?.files?.[0] || null;
    if (droppedFile) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSelectedUploadFile(droppedFile);
    }
  };

  const handleUploadDateChange = (event) => {
    const nextDate = event.target.value.replace(/\D/g, '').slice(0, 8);
    setUploadDate(nextDate);
    setUploadName(uploadDocumentName(nextDate, uploadNamePreset));
  };

  const applyUploadPreset = (preset) => {
    setUploadNamePreset(preset);
    setUploadName(uploadDocumentName(uploadDate, preset));
  };

  const handleUpload = async () => {
    if (!file || !stemId || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const fileBase64 = await readFileAsBase64(file);
      const res = await appClient.functions.invoke('salesforceStemDocumentUpload', {
        stemId,
        fileName: file.name,
        title: uploadName || file.name,
        contentType: file.type,
        fileBase64,
      });
      if (applyDocumentResponse(res.data)) {
        clearSelectedUploadFile();
        resetUploadNaming();
      }
    } catch (uploadError) {
      setError(uploadError.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const startRename = (document) => {
    setRenameKey(document.key);
    setRenameValue(document.fileName || document.title || '');
  };

  const handleRename = async (document) => {
    const title = renameValue.trim();
    if (!title || busyKey) return;
    setBusyKey(document.key);
    const res = await appClient.functions.invoke('salesforceDocumentRename', {
      stemId,
      kind: documentKind(document),
      id: document.contentDocumentId || document.attachmentId || document.id,
      title,
    });
    if (applyDocumentResponse(res.data)) {
      setRenameKey(null);
      setRenameValue('');
    }
    setBusyKey(null);
  };

  const handleDelete = async (document) => {
    if (busyKey) return;
    const ok = window.confirm(`Delete ${document.fileName || document.title || 'this document'} from Salesforce?`);
    if (!ok) return;
    setBusyKey(document.key);
    const res = await appClient.functions.invoke('salesforceDocumentDelete', {
      stemId,
      kind: documentKind(document),
      id: document.contentDocumentId || document.attachmentId || document.id,
    });
    applyDocumentResponse(res.data);
    setBusyKey(null);
  };

  const saveManagedStatus = async () => {
    if (!stemId || savingStatus || !managedStatus || managedStatus === stem?.Dispute_Status__c) return;
    setSavingStatus(true);
    setStatusError(null);
    const res = await appClient.functions.invoke('salesforceStemDetail', {
      stemId,
      updates: { Dispute_Status__c: managedStatus },
    });
    if (res.data?.error) {
      setStatusError(res.data.error);
      setSavingStatus(false);
      return;
    }
    await onStatusUpdated?.(stemId);
    setSavingStatus(false);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && previewDocument) return;
          if (!nextOpen) onClose();
        }}
      >
        <DialogContent
          className={`fixed flex max-w-none flex-col overflow-hidden p-0 ${
            previewDocument
              ? 'h-[96dvh] max-h-[96dvh] w-[98vw]'
              : 'max-h-[90dvh] w-[min(1120px,94vw)]'
          }`}
          onEscapeKeyDown={(event) => {
            if (previewDocument) {
              event.preventDefault();
              setPreviewDocument(null);
            }
          }}
          onPointerDownOutside={(event) => {
            if (previewDocument) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (previewDocument) event.preventDefault();
          }}
        >
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="pr-8">Manage Dispute</DialogTitle>
            <div className="text-sm text-muted-foreground">{stemName}</div>
          </DialogHeader>

          <div className="grid gap-3 border-b border-border bg-muted/10 px-5 py-3 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dispute Status</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <Select value={managedStatus} onValueChange={setManagedStatus} disabled={savingStatus}>
                  <SelectTrigger className="h-7 min-w-0 border-0 bg-transparent px-0 py-0 text-sm font-semibold shadow-none focus:ring-0">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {DISPUTE_STATUS_OPTIONS.map((status) => (
                      <SelectItem key={status} value={status}>{status}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasStatusChange && (
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={saveManagedStatus}
                    disabled={savingStatus}
                  >
                    {savingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                  </Button>
                )}
              </div>
              {statusError && <div className="mt-1 text-[11px] text-destructive">{statusError}</div>}
            </div>
            <SummaryItem label="Delivery" value={fmtDate(stem?._Effective_Date)} />
            <SummaryItem label="Buyer" value={stem?._Buyer_Name || '—'} />
            <SummaryItem label="Supplier(s)" value={supplierSummary} />
            <SummaryItem label="Receivable" value={fmtMoney(stem?.Receivable_Balance__c)} align="right" />
            <SummaryItem label="Payable" value={fmtMoney(stem?._Payable_Balance)} align="right" />
          </div>

          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <DetailSection title="Dispute Overview">
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Buyer Dispute</div>
                  <PartyDisputeList
                    rows={buyerDisputeRows}
                    side="buyer"
                    fallback={stem?._Buyer_Dispute_Label}
                    onEditDispute={onEditDispute}
                  />
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Supplier Dispute</div>
                  <PartyDisputeList
                    rows={supplierDisputeRows}
                    side="supplier"
                    fallback={stem?._Supplier_Dispute_Label}
                    onEditDispute={onEditDispute}
                  />
                </div>
              </div>
            </DetailSection>

            <DetailSection title="Financials">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-border bg-muted/10 p-3">
                  <div className="grid grid-cols-[1fr_auto] gap-3 text-sm">
                    <div className="text-muted-foreground">Buyer invoice amount</div>
                    <div className="font-semibold tabular-nums text-foreground">{fmtMoney(stem?.Total_Invoice_Amount__c)}</div>
                    <div className="text-muted-foreground">Receivable balance</div>
                    <div className="font-semibold tabular-nums text-foreground">{fmtMoney(stem?.Receivable_Balance__c)}</div>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-muted/10 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Supplier invoice amount(s)</div>
                  <SupplierFinanceList rows={supplierDisputeRows} field="supplierInvoiceAmount" fallback={stem?.Total_Invoiced_Amount_From_Suppliers__c} />
                  <div className="mt-3 border-t border-border pt-2">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payable balance</div>
                    <SupplierFinanceList rows={supplierDisputeRows} field="payableBalance" fallback={stem?._Payable_Balance} />
                  </div>
                </div>
              </div>
            </DetailSection>

            <DetailSection title="Products & Parties" meta={`${supplierProductPairs.length || 0} product line${supplierProductPairs.length === 1 ? '' : 's'}`}>
              <ProductPartyList pairs={supplierProductPairs} supplierFallback={stem?._Supplier_Names} productFallback={stem?._Product_Names} />
            </DetailSection>

            <DetailSection title="Documents" meta={`${activeDocuments.length} shown`}>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                  <TabsTrigger value="disputeFlow">Dispute Flow ({disputeFlowDocuments.length})</TabsTrigger>
                  <TabsTrigger value="stemDocuments">Stem Documents ({stemDocuments.length})</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button variant="outline" size="sm" onClick={loadDocuments} disabled={loading} className="gap-2">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
              </Button>
                </div>

            {activeTab === 'disputeFlow' && (
              <div className="rounded-xl border border-border bg-muted/10 p-3">
                <div className="mb-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upload Document</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">The file will be linked directly to this STEM as a Dispute Flow document.</div>
                </div>
                <div className="mb-2 grid gap-2 md:grid-cols-[120px_1fr]">
                  <Input
                    value={uploadDate}
                    onChange={handleUploadDateChange}
                    placeholder="yyyymmdd"
                    inputMode="numeric"
                    className="h-8 text-xs font-mono"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {UPLOAD_NAME_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => applyUploadPreset(preset.value)}
                        className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                          uploadNamePreset === preset.value
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-[1.2fr_1fr_auto]">
                  <div
                    onDragEnter={handleUploadDragEnter}
                    onDragOver={handleDragEvent}
                    onDragLeave={handleUploadDragLeave}
                    onDrop={handleUploadDrop}
                    className={`rounded-lg border border-dashed px-3 py-2 transition-colors ${
                      dragActive
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-card hover:border-primary/50'
                    }`}
                  >
                    <Input ref={fileInputRef} type="file" onChange={handleFileChange} className="h-8 text-xs" />
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {file ? `${file.name} · ${fmtBytes(file.size)}` : 'Drag file here, then click Upload when ready.'}
                    </div>
                  </div>
                  <Input
                    value={uploadName}
                    onChange={(event) => setUploadName(event.target.value)}
                    placeholder="Document name shown in Salesforce"
                    className="h-9 text-xs"
                  />
                  <Button onClick={handleUpload} disabled={!file || uploading} className="h-9 gap-2">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload
                  </Button>
                </div>
              </div>
            )}

            {error && (
              <div className="flex gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-border">
              <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {activeTab === 'disputeFlow' ? 'Dispute Flow Documents' : 'Stem Documents'} ({activeDocuments.length})
                </div>
                {activeTab === 'stemDocuments' && (
                  <div className="text-[11px] text-muted-foreground">View only: invoices, BDN, contracts, and compliance documents</div>
                )}
              </div>

              {loading ? (
                <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading Salesforce documents…
                </div>
              ) : activeDocuments.length ? (
                <div className="max-h-[48vh] overflow-auto">
                  <table className="w-full min-w-[940px] text-xs">
                    <thead>
                      <tr className="border-b border-border bg-card">
                        <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold text-muted-foreground">Document Name</th>
                        <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold text-muted-foreground">Source</th>
                        <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold text-muted-foreground">Type</th>
                        <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-right font-semibold text-muted-foreground">Size</th>
                        <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-left font-semibold text-muted-foreground">Created</th>
                        <th className="sticky top-0 z-10 bg-card px-3 py-2.5 text-right font-semibold text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeDocuments.map((document, index) => {
                        const isRenaming = renameKey === document.key;
                        const isBusy = busyKey === document.key;
                        return (
                          <tr key={document.key} className={`border-b border-border/50 hover:bg-muted/20 ${index % 2 ? 'bg-muted/10' : ''}`}>
                            <td className="max-w-[340px] px-3 py-2.5">
                              {isRenaming ? (
                                <div className="flex items-center gap-2">
                                  <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} className="h-8 text-xs" />
                                  <Button size="sm" onClick={() => handleRename(document)} disabled={isBusy} className="h-8">Save</Button>
                                  <Button size="sm" variant="ghost" onClick={() => setRenameKey(null)} disabled={isBusy} className="h-8">Cancel</Button>
                                </div>
                              ) : (
                                <div className="flex min-w-0 items-start gap-2">
                                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                  <div className="min-w-0">
                                    <div className="truncate font-semibold text-foreground" title={document.fileName || document.title}>
                                      {document.fileName || document.title || '—'}
                                    </div>
                                    {document.ownerName && <div className="mt-0.5 text-[11px] text-muted-foreground">{document.ownerName}</div>}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground">{documentSourceLabel(document)}{documentSourceDetail(document)}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{document.fileType || document.fileExtension || 'File'}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{fmtBytes(document.contentSize)}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(document.createdDate)}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex justify-end gap-1.5">
                                {documentPreviewKind(document) ? (
                                  <Button size="sm" variant="outline" onClick={() => setPreviewDocument(document)} className="h-8 gap-1">
                                    <Eye className="h-3.5 w-3.5" /> View
                                  </Button>
                                ) : (
                                  <a
                                    href={document.downloadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary"
                                  >
                                    <Download className="h-3.5 w-3.5" /> View
                                  </a>
                                )}
                                {canManageActiveDocuments && (
                                  <>
                                    <Button size="sm" variant="outline" onClick={() => startRename(document)} disabled={isBusy} className="h-8 gap-1">
                                      <Pencil className="h-3.5 w-3.5" /> Rename
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => handleDelete(document)} disabled={isBusy} className="h-8 gap-1 text-destructive hover:text-destructive">
                                      {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
                                    </Button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-8 text-sm text-muted-foreground">
                  {activeTab === 'disputeFlow'
                    ? 'No Direct STEM documents were found for this Dispute Flow.'
                    : 'No buyer invoice, supplier invoice, BDN, contract, or compliance documents were found for this STEM.'}
                </div>
              )}
            </div>
              </div>
            </DetailSection>
          </div>

          {previewDocument && (
            <DocumentPreview document={previewDocument} onClose={() => setPreviewDocument(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
