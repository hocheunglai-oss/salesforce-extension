import { useState, useEffect } from 'react';
import { appClient } from '@/api/appClient';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Download, AlertCircle, Loader2, Database, Copy, Check, ChevronDown } from 'lucide-react';
import ExplorerResultsTable from '@/components/data-explorer/ExplorerResultsTable';
import FieldHoverInfo from '@/components/common/FieldHoverInfo';
import PageHeader from '@/components/common/PageHeader';
import TableShell from '@/components/common/TableShell';
import StateBlock from '@/components/common/StateBlock';
import { textValue } from '@/lib/displayValue';

export default function DataExplorer() {
  const [objects, setObjects] = useState([]);
  const [selectedObject, setSelectedObject] = useState('stem__c');
  const [fields, setFields] = useState([]);
  const [selectedFields, setSelectedFields] = useState([]);
  const [whereClause, setWhereClause] = useState('');
  const [orderByField, setOrderByField] = useState('CreatedDate');
  const [limitVal, setLimitVal] = useState(50);
  const [records, setRecords] = useState([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [loadingObjects, setLoadingObjects] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [showSoql, setShowSoql] = useState(false);
  const [showFields, setShowFields] = useState(true);

  useEffect(() => {
    appClient.functions.invoke('salesforceSchema', {}).then(res => {
      setObjects(res.data?.objects || []);
      setLoadingObjects(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedObject) return;
    setLoadingFields(true);
    setFields([]);
    setSelectedFields([]);
    setRecords([]);
    appClient.functions.invoke('salesforceObjectFields', { objectName: selectedObject }).then(res => {
      const f = res.data?.fields || [];
      setFields(f);
      const defaults = f.filter(x => !x.name.endsWith('Id') && x.name !== 'IsDeleted' && x.name !== 'SystemModstamp').slice(0, 8).map(x => x.name);
      setSelectedFields(defaults);
      setLoadingFields(false);
    });
  }, [selectedObject]);

  const buildSoql = () => {
    const cols = selectedFields.length > 0 ? selectedFields.join(', ') : 'Id, Name';
    let q = `SELECT ${cols} FROM ${selectedObject}`;
    if (whereClause.trim()) q += ` WHERE ${whereClause.trim()}`;
    if (orderByField) q += ` ORDER BY ${orderByField} DESC`;
    q += ` LIMIT ${limitVal}`;
    return q;
  };

  const soql = buildSoql();

  const runQuery = async () => {
    setLoading(true);
    setError(null);
    const res = await appClient.functions.invoke('salesforceQuery', { soql });
    if (res.data?.error) {
      setError(res.data.error);
    } else {
      setRecords(res.data?.records || []);
      setTotalSize(res.data?.totalSize || 0);
    }
    setLoading(false);
  };

  const exportCsv = () => {
    if (!records.length) return;
    const headers = Object.keys(records[0]);
    const rows = records.map(r => headers.map(h => {
      const v = r[h];
      if (v === null || v === undefined) return '';
      const s = textValue(v, '');
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }));
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedObject}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copySoql = () => {
    navigator.clipboard.writeText(soql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const toggleField = (name) => {
    setSelectedFields(prev =>
      prev.includes(name) ? prev.filter(f => f !== name) : [...prev, name]
    );
  };

  const showFieldInfo = async (field) => {
    const baseInfo = { label: field.label, fieldName: field.name, type: field.type, loading: true };
    setHoverInfo(baseInfo);
    let res = await appClient.functions.invoke('salesforceQuery', { soql: `SELECT Id, ${field.name} FROM ${selectedObject} WHERE ${field.name} != null LIMIT 1` });
    if (res.data?.error) res = await appClient.functions.invoke('salesforceQuery', { soql: `SELECT Id, ${field.name} FROM ${selectedObject} LIMIT 1` });
    const row = res.data?.records?.[0];
    setHoverInfo(current => current?.fieldName === field.name ? {
      ...baseInfo,
      loading: false,
      recordId: row?.Id || '—',
      sampleValue: row ? textValue(row[field.name]) : '—',
    } : current);
  };

  const sortableFields = fields.filter(f => f.sortable);

  return (
    <div className="p-6 lg:p-8 max-w-full">
      <PageHeader
        icon={Database}
        eyebrow="Admin / Reporting"
        title="Data Explorer"
        description="Build a focused Salesforce query, preview SOQL when needed, then inspect or export the result set."
        meta={records.length > 0 ? `${records.length.toLocaleString()} rows loaded${totalSize > records.length ? ` of ${totalSize.toLocaleString()}` : ''}` : undefined}
        actions={(
          <>
            <Button variant="outline" onClick={() => setShowSoql(v => !v)} className="gap-1.5">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSoql ? 'rotate-180' : ''}`} />
              SOQL
            </Button>
            {records.length > 0 && (
              <Button variant="outline" onClick={exportCsv} className="gap-1.5">
                <Download className="w-3.5 h-3.5" /> Export CSV
              </Button>
            )}
            <Button onClick={runQuery} disabled={loading || !selectedObject} className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Run Query
            </Button>
          </>
        )}
      />

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left panel */}
        <div className="w-full lg:w-72 shrink-0 space-y-4">
          {/* Object selector */}
          <div className="bg-card rounded-xl border border-border p-4">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Object</label>
            {loadingObjects ? (
              <div className="h-9 bg-muted animate-pulse rounded-lg" />
            ) : (
              <Select value={selectedObject} onValueChange={setSelectedObject}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {objects.map(o => (
                    <SelectItem key={o.name} value={o.name}>
                      <span className="flex items-center gap-2">
                        {o.label}
                        {o.custom && <Badge variant="secondary" className="text-[10px] py-0">custom</Badge>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Fields */}
          <div className="bg-card rounded-xl border border-border p-4">
            <button
              type="button"
              onClick={() => setShowFields(v => !v)}
              className="mb-2 flex w-full items-center justify-between gap-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              <span>Fields ({selectedFields.length} selected)</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showFields ? 'rotate-180' : ''}`} />
            </button>
            {loadingFields ? (
              <div className="space-y-1.5">
                {[...Array(6)].map((_, i) => <div key={i} className="h-7 bg-muted animate-pulse rounded" />)}
              </div>
            ) : showFields ? (
              <div className="max-h-64 overflow-y-auto space-y-0.5">
                {fields.filter(f => !['IsDeleted', 'SystemModstamp'].includes(f.name)).map(f => (
                  <label
                    key={f.name}
                    onMouseEnter={() => showFieldInfo(f)}
                    onMouseLeave={() => setHoverInfo(null)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-muted/50 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFields.includes(f.name)}
                      onChange={() => toggleField(f.name)}
                      className="accent-primary"
                    />
                    <span className="text-foreground truncate">{f.label}</span>
                    {f.custom && <span className="text-[10px] text-muted-foreground ml-auto shrink-0">custom</span>}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{selectedFields.length ? selectedFields.join(', ') : 'No fields selected'}</p>
            )}
          </div>

          {/* Filters */}
          <div className="bg-card rounded-xl border border-border p-4 space-y-3">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">Query Controls</label>
            <div>
              <p className="text-xs text-muted-foreground mb-1">WHERE clause (SOQL)</p>
              <Input
                placeholder="e.g. Office__c = 'HK'"
                value={whereClause}
                onChange={e => setWhereClause(e.target.value)}
                className="text-sm font-mono"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Order by</p>
              <Select value={orderByField} onValueChange={setOrderByField}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sortableFields.map(f => (
                    <SelectItem key={f.name} value={f.name}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Limit</p>
              <Select value={String(limitVal)} onValueChange={v => setLimitVal(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 200, 500, 1000].map(n => (
                    <SelectItem key={n} value={String(n)}>{n} rows</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={runQuery} disabled={loading || !selectedObject} className="w-full gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Run Query
          </Button>
        </div>

        {/* Results */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* SOQL Preview */}
          {showSoql && <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
              <span className="text-xs font-semibold text-emerald-400 font-mono">SOQL Preview</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={copySoql}
                className="h-6 gap-1 text-xs text-slate-400 hover:text-white"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <div className="px-4 py-3 overflow-x-auto">
              <code className="text-xs text-emerald-300 font-mono whitespace-pre-wrap break-all">{soql}</code>
            </div>
          </div>}

          {error && (
            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}

          <TableShell
            title={records.length > 0 ? `${records.length.toLocaleString()} rows` : 'Results'}
            meta={totalSize > records.length ? `of ${totalSize.toLocaleString()} total Salesforce rows` : undefined}
          >
              {loading ? (
                <StateBlock icon={Loader2} title="Querying Salesforce..." description="Running the generated SOQL against the selected object." />
              ) : records.length > 0 ? (
                <ExplorerResultsTable records={records} />
              ) : (
                <StateBlock icon={Database} title="No results loaded" description="Build your query and click Run Query." />
              )}
          </TableShell>
        </div>
      </div>
      <FieldHoverInfo info={hoverInfo} />
    </div>
  );
}
