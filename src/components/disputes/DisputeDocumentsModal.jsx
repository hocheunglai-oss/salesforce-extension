import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, Eye, FileText, Loader2, Pencil, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { appClient } from '@/api/appClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { textValue } from '@/lib/displayValue';

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
const isBdnDocument = (document) => (
  document.sourceGroup === 'Product Line Attachments'
  || /\b(bdn|delivery|bunker delivery|delivery note)\b/i.test(documentSearchText(document))
);
const isStemDocument = (document) => (
  document.sourceGroup === 'Invoices to Buyer'
  || document.sourceGroup === 'Invoices from Suppliers'
  || document.sourceGroup === 'Contracts and Compliance'
  || isBdnDocument(document)
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

function DocumentPreview({ document, onClose }) {
  const previewKind = documentPreviewKind(document);
  if (!document || !previewKind) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex h-[88vh] w-[min(1100px,94vw)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
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
            <div className="flex h-full items-center justify-center overflow-auto p-4">
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

export default function DisputeDocumentsModal({ stem, open, onClose }) {
  const [documents, setDocuments] = useState([]);
  const [activeTab, setActiveTab] = useState('disputeFlow');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [uploadName, setUploadName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [renameKey, setRenameKey] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [previewDocument, setPreviewDocument] = useState(null);

  const stemId = stem?.Id;
  const stemName = stem?._Display_Name || stem?.Name || stem?.KeyStem__c || 'STEM';

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

  useEffect(() => {
    if (!open) return;
    setDocuments([]);
    setActiveTab('disputeFlow');
    setFile(null);
    setUploadName('');
    setRenameKey(null);
    setRenameValue('');
    setPreviewDocument(null);
    loadDocuments();
  }, [open, stemId]);

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
    setFile(selectedFile);
    setUploadName(selectedFile?.name || '');
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
        setFile(null);
        setUploadName('');
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
          className="flex max-h-[90vh] w-[min(1120px,94vw)] max-w-none flex-col overflow-hidden p-0"
          onEscapeKeyDown={(event) => {
            if (previewDocument) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (previewDocument) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (previewDocument) event.preventDefault();
          }}
        >
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="pr-8">Documents</DialogTitle>
            <div className="text-sm text-muted-foreground">{stemName}</div>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto px-5 py-4">
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
                <div className="grid gap-2 md:grid-cols-[1.2fr_1fr_auto]">
                  <Input type="file" onChange={handleFileChange} className="h-9 text-xs" />
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
        </DialogContent>
      </Dialog>

      {previewDocument && (
        <DocumentPreview document={previewDocument} onClose={() => setPreviewDocument(null)} />
      )}
    </>
  );
}
