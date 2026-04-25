import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { AlertCircle, Loader2, Play, Save, Trash2, Clock, Download, Plus, FileBarChart2, ChevronRight, Filter, Calculator, Link2, Code } from 'lucide-react';
import RecentStemsTable from '@/components/dashboard/RecentStemsTable';
import PnlTable from '@/components/dashboard/PnlTable';
import FilterGroup from '@/components/report-builder/FilterGroup';
import CalculatedFields from '@/components/report-builder/CalculatedFields';
import LookupFields from '@/components/report-builder/LookupFields';
import ColumnSelector from '@/components/report-builder/ColumnSelector';
import { format } from 'date-fns';

const CATEGORIES = [
  { value: 'sales_operations', label: 'Sales & Operations' },
  { value: 'sales_support', label: 'Sales Support' },
  { value: 'invoicing_accounting', label: 'Invoicing & Accounting' },
  { value: 'general', label: 'General' },
];
const SCHEDULE_FREQ = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];
const CAT_COLORS = {
  sales_operations: 'bg-blue-100 text-blue-700',
  sales_support: 'bg-emerald-100 text-emerald-700',
  invoicing_accounting: 'bg-amber-100 text-amber-700',
  general: 'bg-slate-100 text-slate-600',
};

const TABS = [
  { id: 'filters', label: 'Filters', icon: Filter },
  { id: 'aggregates', label: 'Aggregates', icon: Calculator },
  { id: 'lookups', label: 'Cross-Object', icon: Link2 },
];

const defaultFilterGroup = () => ({ type: 'group', logic: 'AND', conditions: [], id: 1 });

// Recursively build WHERE clause from filter group tree
function buildWhereFromGroup(group) {
  if (!group.conditions || group.conditions.length === 0) return '';
  const parts = group.conditions.map(cond => {
    if (cond.type === 'group') {
      const inner = buildWhereFromGroup(cond);
      return inner ? `(${inner})` : null;
    }
    if (!cond.field || !cond.operator || cond.value === '') return null;
    const val = cond.value;
    // Determine if value needs quoting
    const noQuote = ['true', 'false', 'null', 'TODAY', 'YESTERDAY', 'TOMORROW',
      'THIS_WEEK', 'LAST_WEEK', 'NEXT_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'NEXT_MONTH',
      'THIS_QUARTER', 'LAST_QUARTER', 'NEXT_QUARTER', 'THIS_YEAR', 'LAST_YEAR', 'NEXT_YEAR',
    ].includes(val) || val.startsWith('LAST_N_DAYS:') || /^-?\d+(\.\d+)?$/.test(val);

    const op = cond.operator;
    if (op === 'IN' || op === 'NOT IN' || op === 'INCLUDES' || op === 'EXCLUDES') {
      // Expect comma-separated list
      const items = val.split(',').map(v => v.trim());
      const formatted = items.map(v => (v.startsWith("'") ? v : `'${v}'`)).join(', ');
      return `${cond.field} ${op} (${formatted})`;
    }
    if (op === 'LIKE' || op === 'NOT LIKE') {
      return `${cond.field} ${op === 'NOT LIKE' ? 'NOT LIKE' : 'LIKE'} '${val}'`;
    }
    return `${cond.field} ${op} ${noQuote ? val : `'${val}'`}`;
  }).filter(Boolean);

  return parts.join(` ${group.logic} `);
}

export default function ReportBuilder() {
  const [savedReports, setSavedReports] = useState([]);
  const [objects, setObjects] = useState([]);
  const [fields, setFields] = useState([]);

  // Report config
  const [reportName, setReportName] = useState('');
  const [reportDesc, setReportDesc] = useState('');
  const [reportCategory, setReportCategory] = useState('general');
  const [selectedObject, setSelectedObject] = useState('stem__c');
  const [selectedFields, setSelectedFields] = useState([]);
  const [filterGroup, setFilterGroup] = useState(defaultFilterGroup());
  const [calcFields, setCalcFields] = useState([]);
  const [lookups, setLookups] = useState([]);
  const [orderByField, setOrderByField] = useState('CreatedDate');
  const [limitVal, setLimitVal] = useState(100);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleFreq, setScheduleFreq] = useState('weekly');
  const [scheduleEmail, setScheduleEmail] = useState('');
  const [activeTab, setActiveTab] = useState('filters');

  // Execution state
  const [records, setRecords] = useState([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [error, setError] = useState(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [selectedSavedReport, setSelectedSavedReport] = useState(null);
  const [showSoql, setShowSoql] = useState(false);

  useEffect(() => {
    loadSavedReports();
    base44.functions.invoke('salesforceSchema', {}).then(res => setObjects(res.data?.objects || []));
  }, []);

  useEffect(() => {
    if (!selectedObject) return;
    setLoadingFields(true);
    setFields([]);
    setSelectedFields([]);
    setCalcFields([]);
    setLookups([]);
    setFilterGroup(defaultFilterGroup());
    base44.functions.invoke('salesforceObjectFields', { objectName: selectedObject }).then(res => {
      const f = res.data?.fields || [];
      setFields(f);
      const defaults = f.filter(x =>
        !x.name.endsWith('Id') && x.name !== 'IsDeleted' && x.name !== 'SystemModstamp'
      ).slice(0, 10).map(x => x.name);
      setSelectedFields(defaults);
      setLoadingFields(false);
    });
  }, [selectedObject]);

  const loadSavedReports = async () => {
    const reports = await base44.entities.SavedReport.list('-updated_date', 50);
    setSavedReports(reports);
  };

  const buildSoql = useCallback(() => {
    // Base columns: selected fields + lookup traversals + aggregates
    const lookupCols = lookups
      .filter(l => l.relName && l.relFieldName)
      .map(l => `${l.relName}.${l.relFieldName}`);
    const aggCols = calcFields
      .filter(c => c.fn && c.field)
      .map(c => `${c.fn}(${c.field})${c.label ? ` ${c.label.replace(/\s+/g, '_')}` : ''}`);

    const isAggregateQuery = aggCols.length > 0;
    let cols;

    if (isAggregateQuery) {
      // Aggregate query: GROUP BY the selected non-aggregate fields
      const groupByCols = selectedFields.length > 0 ? selectedFields : ['Id'];
      cols = [...groupByCols, ...lookupCols, ...aggCols].join(', ');
      let q = `SELECT ${cols} FROM ${selectedObject}`;
      const where = buildWhereFromGroup(filterGroup);
      if (where) q += ` WHERE ${where}`;
      q += ` GROUP BY ${groupByCols.join(', ')}`;
      if (orderByField && selectedFields.includes(orderByField)) q += ` ORDER BY ${orderByField} DESC`;
      q += ` LIMIT ${limitVal}`;
      return q;
    }

    const baseCols = selectedFields.length > 0 ? selectedFields : ['Id', 'Name'];
    cols = [...baseCols, ...lookupCols].join(', ');
    let q = `SELECT ${cols} FROM ${selectedObject}`;
    const where = buildWhereFromGroup(filterGroup);
    if (where) q += ` WHERE ${where}`;
    if (orderByField) q += ` ORDER BY ${orderByField} DESC`;
    q += ` LIMIT ${limitVal}`;
    return q;
  }, [selectedFields, lookups, calcFields, filterGroup, selectedObject, orderByField, limitVal]);

  const runQuery = async () => {
    setLoading(true);
    setError(null);
    const soql = buildSoql();
    const res = await base44.functions.invoke('salesforceQuery', { soql });
    if (res.data?.error) {
      setError(res.data.error);
    } else {
      setRecords(res.data?.records || []);
      setTotalSize(res.data?.totalSize || 0);
    }
    setLoading(false);
  };

  const saveReport = async () => {
    if (!reportName.trim()) return;
    setSaving(true);
    const soql = buildSoql();
    const payload = {
      name: reportName,
      description: reportDesc,
      category: reportCategory,
      object_name: selectedObject,
      soql,
      selected_fields: selectedFields,
      filters: [filterGroup],
      schedule_enabled: scheduleEnabled,
      schedule_frequency: scheduleFreq,
      schedule_email: scheduleEmail,
      last_run_at: new Date().toISOString(),
      last_run_count: records.length,
    };
    if (selectedSavedReport) {
      await base44.entities.SavedReport.update(selectedSavedReport.id, payload);
    } else {
      await base44.entities.SavedReport.create(payload);
    }
    await loadSavedReports();
    setSaving(false);
    setSaveDialogOpen(false);
  };

  const loadReport = (report) => {
    setSelectedSavedReport(report);
    setReportName(report.name);
    setReportDesc(report.description || '');
    setReportCategory(report.category || 'general');
    setSelectedObject(report.object_name);
    setSelectedFields(report.selected_fields || []);
    setFilterGroup(report.filters?.[0] || defaultFilterGroup());
    setScheduleEnabled(report.schedule_enabled || false);
    setScheduleFreq(report.schedule_frequency || 'weekly');
    setScheduleEmail(report.schedule_email || '');
    setCalcFields([]);
    setLookups([]);
    setRecords([]);
    setError(null);
  };

  const deleteReport = async (id, e) => {
    e.stopPropagation();
    await base44.entities.SavedReport.delete(id);
    if (selectedSavedReport?.id === id) setSelectedSavedReport(null);
    await loadSavedReports();
  };

  const newReport = () => {
    setSelectedSavedReport(null);
    setReportName('');
    setReportDesc('');
    setReportCategory('general');
    setSelectedObject('stem__c');
    setFilterGroup(defaultFilterGroup());
    setCalcFields([]);
    setLookups([]);
    setRecords([]);
    setError(null);
  };

  const exportCsv = () => {
    if (!records.length) return;
    const headers = Object.keys(records[0]);
    const rows = records.map(r => headers.map(h => {
      const v = r[h];
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }));
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${reportName || selectedObject}_report.csv`;
    a.click();
  };

  const sortableFields = fields.filter(f => f.sortable);
  const soql = buildSoql();

  const filterCount = (grp) => {
    if (!grp?.conditions) return 0;
    return grp.conditions.reduce((n, c) => n + (c.type === 'group' ? filterCount(c) : 1), 0);
  };
  const activeFilterCount = filterCount(filterGroup);

  return (
    <div className="flex h-full">
      {/* Saved reports sidebar */}
      <aside className="w-60 shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Saved Reports</h2>
          <Button size="sm" variant="ghost" onClick={newReport} className="h-7 w-7 p-0">
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {savedReports.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No saved reports yet</p>
          ) : savedReports.map(r => (
            <button
              key={r.id}
              onClick={() => loadReport(r)}
              className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors group ${selectedSavedReport?.id === r.id ? 'bg-accent' : 'hover:bg-muted/50'}`}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{r.object_name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded mt-1 inline-block font-medium ${CAT_COLORS[r.category] || CAT_COLORS.general}`}>
                    {CATEGORIES.find(c => c.value === r.category)?.label || r.category}
                  </span>
                </div>
                <button onClick={(e) => deleteReport(r.id, e)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1 shrink-0">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              {r.last_run_at && (
                <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {format(new Date(r.last_run_at), 'dd MMM HH:mm')}
                </p>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* Main builder */}
      <div className="flex-1 overflow-auto">
        <div className="p-6 lg:p-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex-1 min-w-0 mr-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <FileBarChart2 className="w-4 h-4" />
                <span>Report Builder</span>
                {selectedSavedReport && <><ChevronRight className="w-3 h-3" /><span className="text-foreground font-medium truncate">{selectedSavedReport.name}</span></>}
              </div>
              <Input
                placeholder="Untitled Report"
                value={reportName}
                onChange={e => setReportName(e.target.value)}
                className="text-xl font-bold border-none shadow-none px-0 h-auto font-dm focus-visible:ring-0 text-foreground placeholder:text-muted-foreground/40"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => setShowSoql(v => !v)} className="gap-1.5 text-muted-foreground">
                <Code className="w-3.5 h-3.5" /> SOQL
              </Button>
              {records.length > 0 && (
                <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setSaveDialogOpen(true)} className="gap-1.5">
                <Save className="w-3.5 h-3.5" /> Save
              </Button>
              <Button size="sm" onClick={runQuery} disabled={loading} className="gap-1.5">
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Run
              </Button>
            </div>
          </div>

          {/* SOQL Preview */}
          {showSoql && (
            <div className="mb-5 p-3 bg-slate-900 rounded-xl overflow-x-auto">
              <p className="text-xs font-mono text-emerald-400 whitespace-pre-wrap break-all">{soql}</p>
            </div>
          )}

          {/* Config row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Object</label>
              <Select value={selectedObject} onValueChange={setSelectedObject}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-56">
                  {objects.map(o => <SelectItem key={o.name} value={o.name}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Order by</label>
              <Select value={orderByField} onValueChange={setOrderByField}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sortableFields.map(f => <SelectItem key={f.name} value={f.name}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Limit</label>
              <Select value={String(limitVal)} onValueChange={v => setLimitVal(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 200, 500, 1000, 2000].map(n => (
                    <SelectItem key={n} value={String(n)}>{n} rows</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Columns */}
          <div className="mb-5 bg-card rounded-xl border border-border p-4">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 block">
              Columns
            </label>
            <ColumnSelector
              fields={fields.filter(f => !['IsDeleted', 'SystemModstamp'].includes(f.name))}
              selectedFields={selectedFields}
              onChange={setSelectedFields}
              loading={loadingFields}
            />
          </div>

          {/* Advanced panels: tabs */}
          <div className="mb-5 bg-card rounded-xl border border-border overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-border">
              {TABS.map(tab => {
                const Icon = tab.icon;
                const badge = tab.id === 'filters' ? activeFilterCount
                  : tab.id === 'aggregates' ? calcFields.length
                  : lookups.length;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                      activeTab === tab.id
                        ? 'border-primary text-primary bg-accent/30'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                    {badge > 0 && (
                      <span className="ml-0.5 px-1.5 py-0 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Panel content */}
            <div className="p-4">
              {activeTab === 'filters' && (
                <FilterGroup
                  group={filterGroup}
                  fields={fields.filter(f => f.filterable && !['IsDeleted', 'SystemModstamp'].includes(f.name))}
                  onChange={setFilterGroup}
                  depth={0}
                />
              )}
              {activeTab === 'aggregates' && (
                <CalculatedFields
                  calcFields={calcFields}
                  onChange={setCalcFields}
                  fields={fields}
                />
              )}
              {activeTab === 'lookups' && (
                <LookupFields
                  lookups={lookups}
                  onChange={setLookups}
                  fields={fields.filter(f => f.type === 'reference')}
                  selectedObject={selectedObject}
                />
              )}
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {/* Results */}
          <div className="bg-card rounded-xl border border-border">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between gap-4">
              <span className="text-sm font-semibold text-foreground shrink-0">
                {records.length > 0 ? `${records.length.toLocaleString()} rows` : 'Results'}
                {totalSize > records.length && <span className="text-xs text-muted-foreground ml-1">(of {totalSize.toLocaleString()} total)</span>}
              </span>
            </div>
            <div className="p-2">
              {loading ? (
                <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-sm">Running query…</span>
                </div>
              ) : records.length > 0 ? (
                selectedObject === 'stem__c' ? <PnlTable records={records} /> : <RecentStemsTable records={records} />
              ) : (
                <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                  <Play className="w-8 h-8 opacity-20" />
                  <span className="text-sm">Configure your query and click Run</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Save Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Report Name</Label>
              <Input className="mt-1.5" value={reportName} onChange={e => setReportName(e.target.value)} placeholder="My Report" />
            </div>
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</Label>
              <Input className="mt-1.5" value={reportDesc} onChange={e => setReportDesc(e.target.value)} placeholder="Optional description" />
            </div>
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</Label>
              <Select value={reportCategory} onValueChange={setReportCategory}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="border-t border-border pt-4">
              <div className="flex items-center gap-2 mb-3">
                <input type="checkbox" id="sched" checked={scheduleEnabled} onChange={e => setScheduleEnabled(e.target.checked)} className="accent-primary" />
                <label htmlFor="sched" className="text-sm font-medium text-foreground">Enable email schedule</label>
              </div>
              {scheduleEnabled && (
                <div className="space-y-3 pl-5">
                  <div>
                    <Label className="text-xs text-muted-foreground">Frequency</Label>
                    <Select value={scheduleFreq} onValueChange={setScheduleFreq}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SCHEDULE_FREQ.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Email recipient</Label>
                    <Input className="mt-1" type="email" value={scheduleEmail} onChange={e => setScheduleEmail(e.target.value)} placeholder="email@company.com" />
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveReport} disabled={saving || !reportName.trim()} className="gap-2">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}