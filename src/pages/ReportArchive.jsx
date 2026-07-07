import { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, FileSpreadsheet, History, Loader2, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { appClient } from '@/api/appClient';
import PageHeader from '@/components/common/PageHeader';
import StateBlock from '@/components/common/StateBlock';
import TableShell from '@/components/common/TableShell';
import { Badge } from '@/components/ui/badge';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';

const statusClasses = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  uploading: 'border-sky-200 bg-sky-50 text-sky-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
  deleted: 'border-slate-200 bg-slate-100 text-slate-600',
};

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Hong_Kong',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function normalizeFileName(value) {
  const cleaned = String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
  if (!cleaned) return '';
  return cleaned.toLowerCase().endsWith('.xls') ? cleaned : `${cleaned}.xls`;
}

function base64ToBlob(base64, mimeType) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'application/vnd.ms-excel' });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function filterSummary(metadata = {}) {
  const rows = Array.isArray(metadata.filterSummaryRows)
    ? metadata.filterSummaryRows
    : Object.entries(metadata.filters || {});
  if (!rows.length) return '—';
  return rows
    .map((row) => `${row[0]}: ${row[1] || '—'}`)
    .join(' · ');
}

export default function ReportArchive() {
  const { toast } = useToast();
  const [reports, setReports] = useState([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState('');
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [auditTarget, setAuditTarget] = useState(null);

  const loadReports = async (options = {}) => {
    setLoading(true);
    setError('');
    const res = await appClient.functions.invoke('reportExportsList', {
      includeDeleted: showDeleted,
      limit: 200,
    }, { cache: true, force: options.force });
    if (res.data?.error) {
      setError(res.data.error);
      setReports([]);
    } else {
      setReports(res.data?.reports || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadReports({ force: true });
  }, [showDeleted]);

  const activeCount = useMemo(() => reports.filter((report) => report.status === 'active').length, [reports]);

  const startRename = (report) => {
    setRenameTarget(report);
    setRenameValue(report.fileName || '');
  };

  const renameReport = async () => {
    const fileName = normalizeFileName(renameValue);
    if (!renameTarget || !fileName) return;
    setActionLoading(`rename:${renameTarget.id}`);
    const res = await appClient.functions.invoke('reportExportRename', {
      id: renameTarget.id,
      fileName,
    });
    setActionLoading('');
    if (res.data?.error) {
      toast({ title: 'Rename failed', description: res.data.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Report renamed', description: fileName });
    setRenameTarget(null);
    appClient.functions.clearCache();
    loadReports({ force: true });
  };

  const deleteReport = async () => {
    if (!deleteTarget) return;
    setActionLoading(`delete:${deleteTarget.id}`);
    const res = await appClient.functions.invoke('reportExportDelete', { id: deleteTarget.id });
    setActionLoading('');
    if (res.data?.error) {
      toast({ title: 'Delete failed', description: res.data.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Report moved to Google Drive trash', description: deleteTarget.fileName });
    setDeleteTarget(null);
    appClient.functions.clearCache();
    loadReports({ force: true });
  };

  const downloadReport = async (report) => {
    setActionLoading(`download:${report.id}`);
    const res = await appClient.functions.invoke('reportExportDownload', { id: report.id });
    setActionLoading('');
    if (res.data?.error) {
      toast({ title: 'Download failed', description: res.data.error, variant: 'destructive' });
      return;
    }
    const blob = base64ToBlob(res.data.contentBase64, res.data.mimeType);
    downloadBlob(blob, res.data.fileName || report.fileName);
    toast({ title: 'Download started', description: res.data.fileName || report.fileName });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        icon={History}
        eyebrow="Google Drive report archive"
        title="Reports Archive"
        description="Review exported XLS reports, audit trail, and Google Drive file actions."
        meta={`${activeCount.toLocaleString()} active reports · ${reports.length.toLocaleString()} shown`}
        actions={(
          <>
            <Button type="button" variant={showDeleted ? 'default' : 'outline'} size="sm" onClick={() => setShowDeleted((value) => !value)}>
              {showDeleted ? 'Showing Deleted' : 'Show Deleted'}
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => loadReports({ force: true })} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </>
        )}
      />

      {error && <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <TableShell
        title="Archived XLS Reports"
        meta="Files are stored in Google Drive and managed through the app audit layer."
        bodyClassName="p-0"
      >
        {loading ? (
          <StateBlock icon={Loader2} title="Loading report archive..." description="Fetching report metadata and audit events." />
        ) : reports.length ? (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <TableRow>
                <TableHead>Exported At</TableHead>
                <TableHead>Report Type</TableHead>
                <TableHead>File Name</TableHead>
                <TableHead>Exported By</TableHead>
                <TableHead className="text-right">Rows / Count</TableHead>
                <TableHead>Applied Filters</TableHead>
                <TableHead className="text-right">File Size</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((report) => (
                <TableRow key={report.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(report.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap font-medium">{report.reportLabel || report.reportType}</TableCell>
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <span className="max-w-80 break-words font-medium">{report.fileName}</span>
                    </div>
                    {report.errorMessage && <p className="mt-1 text-xs text-destructive">{report.errorMessage}</p>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{report.exportedByEmail || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(report.metadata?.rowCount || 0).toLocaleString()}</TableCell>
                  <TableCell className="max-w-md text-xs text-muted-foreground">{filterSummary(report.metadata)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap text-xs">{formatBytes(report.sizeBytes)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusClasses[report.status] || ''}>{report.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button type="button" variant="ghost" size="icon" title="View audit trail" onClick={() => setAuditTarget(report)}>
                        <History className="h-4 w-4" />
                      </Button>
                      {report.driveWebViewLink && (
                        <Button type="button" variant="ghost" size="icon" title="Open in Google Drive" onClick={() => window.open(report.driveWebViewLink, '_blank', 'noopener,noreferrer')}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                      <Button type="button" variant="ghost" size="icon" title="Download XLS" disabled={report.status !== 'active' || actionLoading === `download:${report.id}`} onClick={() => downloadReport(report)}>
                        {actionLoading === `download:${report.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </Button>
                      <Button type="button" variant="ghost" size="icon" title="Rename" disabled={report.status !== 'active'} onClick={() => startRename(report)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" title="Delete" disabled={report.status !== 'active'} onClick={() => setDeleteTarget(report)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <StateBlock icon={FileSpreadsheet} title="No archived reports" description="Export an XLS report to save it to Google Drive and record the audit trail." />
        )}
      </TableShell>

      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Report</DialogTitle>
            <DialogDescription>Rename updates the Google Drive file and records an audit event.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="report-file-name">File name</Label>
            <Input id="report-file-name" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button type="button" onClick={renameReport} disabled={!normalizeFileName(renameValue) || actionLoading === `rename:${renameTarget?.id}`}>
              {actionLoading === `rename:${renameTarget?.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Report</DialogTitle>
            <DialogDescription>The file will be moved to Google Drive trash. The audit record remains visible when deleted reports are shown.</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm font-medium">{deleteTarget?.fileName}</div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={deleteReport} disabled={actionLoading === `delete:${deleteTarget?.id}`}>
              {actionLoading === `delete:${deleteTarget?.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!auditTarget} onOpenChange={(open) => !open && setAuditTarget(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Audit Trail</DialogTitle>
            <DialogDescription>{auditTarget?.fileName}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(auditTarget?.events || []).map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap text-xs">{formatDateTime(event.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{event.eventType}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{event.actorEmail || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {event.previousFileName && event.newFileName
                        ? `${event.previousFileName} -> ${event.newFileName}`
                        : event.newFileName || event.metadata?.message || event.metadata?.error || '—'}
                    </TableCell>
                  </TableRow>
                ))}
                {!auditTarget?.events?.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">No audit events found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
