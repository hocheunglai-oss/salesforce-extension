import { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { AlertCircle, Loader2, Play, Save, Trash2, Clock, Download, Plus, FileBarChart2, ChevronRight, Filter, Calculator, Link2, Code, BookOpen, ChevronDown, LayoutList, AlignJustify } from 'lucide-react';

import FilterGroup from '@/components/report-builder/FilterGroup';
import CalculatedFields from '@/components/report-builder/CalculatedFields';
import LookupFields from '@/components/report-builder/LookupFields';
import ColumnSelector, { toSoqlToken } from '@/components/report-builder/ColumnSelector';
import ExpandableResultsTable from '@/components/report-builder/ExpandableResultsTable';
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
function buildWhereFromGroup(group, childRelationships = []) {
  if (!group.conditions || group.conditions.length === 0) return '';
  const parts = group.conditions.map(cond => {
    if (cond.type === 'group') {
      const inner = buildWhereFromGroup(cond, childRelationships);
      return inner ? `(${inner})` : null;
    }
    if (!cond.field || !cond.operator || cond.value === '') return null;

    // Child relationship filter: __child__rel__:RelName:FieldName
    // Convert to SOQL semi-join: Id IN (SELECT <parent_lookup_field> FROM <childSObject> WHERE FieldName op val)
    if (cond.field.startsWith('__child__rel__:')) {
      const rest = cond.field.slice('__child__rel__:'.length);
      const colon = rest.indexOf(':');
      const relName = rest.slice(0, colon);
      const childField = rest.slice(colon + 1);
      const val = cond.value;
      const noQuote = ['true', 'false', 'null'].includes(val) || /^-?\d+(\.\d+)?$/.test(val);
      const formatted = noQuote ? val : `'${val}'`;
      // Look up the real child object name and its parent lookup field from childRelationships
      const relMeta = childRelationships.find(r => r.relationshipName === relName);
      const childObject = relMeta?.childSObject || relName;
      const lookupField = relMeta?.field || 'Id';
      return `Id IN (SELECT ${lookupField} FROM ${childObject} WHERE ${childField} ${cond.operator} ${formatted})`;
    }

    const val = cond.value;
    // Determine if value needs quoting
    const noQuote = ['true', 'false', 'null', 'TODAY', 'YESTERDAY', 'TOMORROW',
      'THIS_WEEK', 'LAST_WEEK', 'NEXT_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'NEXT_MONTH',
      'THIS_QUARTER', 'LAST_QUARTER', 'NEXT_QUARTER', 'THIS_YEAR', 'LAST_YEAR', 'NEXT_YEAR',
    ].includes(val) || val.startsWith('LAST_N_DAYS:') || /^-?\d+(\.\d+)?$/.test(val);

    const op = cond.operator;
    if (op === 'IN' || op === 'NOT IN' || op === 'INCLUDES' || op === 'EXCLUDES') {
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
  const [fields, setFields] = useState([]);
  const [childRelationships, setChildRelationships] = useState([]);

  // Report config
  const [reportName, setReportName] = useState('');
  const [reportDesc, setReportDesc] = useState('');
  const [reportCategory, setReportCategory] = useState('general');
  const [selectedObject, setSelectedObject] = useState(() => localStorage.getItem('rb_default_object') || 'stem__c');
  const [selectedFields, setSelectedFields] = useState([]);
  const [filterGroup, setFilterGroup] = useState(defaultFilterGroup());
  const [calcFields, setCalcFields] = useState([]);
  const [lookups, setLookups] = useState([]);
  const [orderByField, setOrderByField] = useState(() => localStorage.getItem('rb_default_orderby') || 'KeyStem__c');
  const [limitVal, setLimitVal] = useState(() => Number(localStorage.getItem('rb_default_limit') || 100));
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
  const [fieldsError, setFieldsError] = useState(false);
  const [fieldsRetry, setFieldsRetry] = useState(0);
  const [compact, setCompact] = useState(() => localStorage.getItem('rb_compact') === 'true');
  const [showReportsPanel, setShowReportsPanel] = useState(false);

  const toggleCompact = () => setCompact(v => {
    const next = !v;
    localStorage.setItem('rb_compact', String(next));
    return next;
  });
  const pendingFieldsRef = useRef(null); // fields to restore after object switch
  const pendingFilterRef = useRef(null); // filter group to restore after object switch

  useEffect(() => {
    loadSavedReports();
  }, []);

  useEffect(() => {
    if (!selectedObject) return;
    setLoadingFields(true);
    // fieldsRetry is used to re-trigger this effect on manual retry
    setFieldsError(false);
    setFields([]);
    setChildRelationships([]);
    setCalcFields([]);
    setLookups([]);
    setFilterGroup(defaultFilterGroup());
    setSelectedFields([]);
    base44.functions.invoke('salesforceObjectFields', { objectName: selectedObject }).then(res => {
      if (res.data?.error) throw new Error(res.data.error);
      const f = res.data?.fields || [];
      setFields(f);
      setChildRelationships(res.data?.childRelationships || []);
      if (pendingFieldsRef.current) {
        setSelectedFields(pendingFieldsRef.current);
        pendingFieldsRef.current = null;
      } else {
        setSelectedFields([]);
      }
      if (pendingFilterRef.current) {
        setFilterGroup(pendingFilterRef.current);
        pendingFilterRef.current = null;
      }
    }).catch(err => {
      console.error('Failed to load fields:', err);
      setFieldsError(true);
    }).finally(() => {
      setLoadingFields(false);
    });
  }, [selectedObject, fieldsRetry]);

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
      .filter(c => c.type === 'aggregate' && c.fn && c.field)
      .map(c => `${c.fn}(${c.field})${c.label ? ` ${c.label.replace(/\s+/g, '_')}` : ''}`);

    // Only SOQL aggregates (SUM, COUNT etc.) require GROUP BY — formulas are computed client-side after fetching
    const isAggregateQuery = aggCols.length > 0;
    let cols;

    if (isAggregateQuery) {
      // Aggregate query: GROUP BY the selected non-aggregate fields
      const groupByCols = selectedFields.length > 0 ? selectedFields : ['Id'];
      cols = [...groupByCols.map(toSoqlToken), ...lookupCols, ...aggCols].join(', ');
      let q = `SELECT ${cols} FROM ${selectedObject}`;
      const where = buildWhereFromGroup(filterGroup, childRelationships);
      if (where) q += ` WHERE ${where}`;
      q += ` GROUP BY ${groupByCols.join(', ')}`;
      if (orderByField && selectedFields.includes(orderByField)) q += ` ORDER BY ${orderByField} DESC`;
      q += ` LIMIT ${limitVal}`;
      return q;
    }

    // Extract fields referenced in formula expressions and add them to the query
    const formulaReferencedFields = [];       // flat fields e.g. Costs_Total__c
    const formulaChildFields = {};            // child subquery fields e.g. { STEM_Line_Items__r: ['Buyers_Brokers_Commission_Lumpsum__c', ...] }
    calcFields.filter(c => c.type === 'formula' && c.expr).forEach(cf => {
      const matches = [...cf.expr.matchAll(/[A-Za-z_]+\(([A-Za-z0-9_.]+)\)/g)];
      for (const m of matches) {
        const field = m[1];
        if (!field) continue;
        if (field.includes('.')) {
          const dotIdx = field.indexOf('.');
          const rel = field.slice(0, dotIdx);
          const childField = field.slice(dotIdx + 1);
          if (!formulaChildFields[rel]) formulaChildFields[rel] = [];
          if (!formulaChildFields[rel].includes(childField)) formulaChildFields[rel].push(childField);
        } else {
          if (!formulaReferencedFields.includes(field)) formulaReferencedFields.push(field);
        }
      }
    });

    // Group child fields by relationship so each relationship becomes one subquery
    const childFieldsByRel = {};
    const nonChildFields = [];
    const baseFields = selectedFields.length > 0 ? selectedFields : ['Id', 'Name'];
    // Add formula-referenced fields that aren't already in selectedFields
    const allFields = [...baseFields];
    formulaReferencedFields.forEach(f => {
      if (!allFields.includes(f)) allFields.push(f);
    });
    for (const f of allFields) {
      if (f.startsWith('__child__:')) {
        const rest = f.slice('__child__:'.length);
        const colonIdx = rest.indexOf(':');
        const rel = rest.slice(0, colonIdx);
        const field = rest.slice(colonIdx + 1);
        if (!childFieldsByRel[rel]) childFieldsByRel[rel] = [];
        childFieldsByRel[rel].push(field);
      } else {
        nonChildFields.push(f);
      }
    }
    // Merge formula child fields into childFieldsByRel
    Object.entries(formulaChildFields).forEach(([rel, flds]) => {
      if (!childFieldsByRel[rel]) childFieldsByRel[rel] = [];
      flds.forEach(f => { if (!childFieldsByRel[rel].includes(f)) childFieldsByRel[rel].push(f); });
    });

    const childSubqueries = Object.entries(childFieldsByRel).map(
      ([rel, flds]) => `(SELECT ${flds.join(', ')} FROM ${rel})`
    );
    const baseCols = [...nonChildFields, ...childSubqueries];
    cols = [...baseCols, ...lookupCols].join(', ');
    let q = `SELECT ${cols} FROM ${selectedObject}`;
    const where = buildWhereFromGroup(filterGroup, childRelationships);
    if (where) q += ` WHERE ${where}`;
    if (orderByField) q += ` ORDER BY ${orderByField} DESC`;
    q += ` LIMIT ${limitVal}`;
    return q;
  }, [selectedFields, lookups, calcFields, filterGroup, selectedObject, orderByField, limitVal]);

  const evaluateFormulas = (records) => {
    // Build a map: "FN(Field__c)" → aggregate label (for resolving aggregate refs in formulas)
    const aggLabelMap = {};
    calcFields.filter(c => c.type === 'aggregate' && c.fn && c.field && c.label).forEach(c => {
      // Key: "SUM(Field__c)" (case-insensitive match)
      aggLabelMap[`${c.fn.toUpperCase()}(${c.field})`] = c.label;
    });

    return records.map(row => {
      const enriched = { ...row };
      calcFields.filter(c => c.type === 'formula').forEach(cf => {
        if (!cf.expr || !cf.label) return;
        try {
          let expr = cf.expr;
          // Replace FN(Field__c) references — first try to resolve via aggregate label map,
          // then fall back to reading the field directly from the row (or summing child records)
          const fieldRegex = /([A-Za-z_]+)\(([A-Za-z0-9_.]+)\)/gi;
          expr = expr.replace(fieldRegex, (match, fn, field) => {
            const aggKey = `${fn.toUpperCase()}(${field})`;
            if (aggLabelMap[aggKey] !== undefined) {
              // This fn(field) corresponds to a named aggregate column
              const val = row[aggLabelMap[aggKey]];
              return val != null ? String(val) : '0';
            }
            // Check if it's a child relationship path: Rel__r.Field__c
            if (field.includes('.')) {
              const dotIdx = field.indexOf('.');
              const relName = field.slice(0, dotIdx);
              const childField = field.slice(dotIdx + 1);
              const subquery = row[relName];
              if (subquery && Array.isArray(subquery.records)) {
                // Sum (or apply fn) across child records
                const fnUpper = fn.toUpperCase();
                const childVals = subquery.records.map(r => Number(r[childField]) || 0);
                if (fnUpper === 'SUM') return String(childVals.reduce((a, b) => a + b, 0));
                if (fnUpper === 'COUNT' || fnUpper === 'COUNT_DISTINCT') return String(childVals.length);
                if (fnUpper === 'AVG') return childVals.length ? String(childVals.reduce((a, b) => a + b, 0) / childVals.length) : '0';
                if (fnUpper === 'MIN') return childVals.length ? String(Math.min(...childVals)) : '0';
                if (fnUpper === 'MAX') return childVals.length ? String(Math.max(...childVals)) : '0';
                return String(childVals.reduce((a, b) => a + b, 0));
              }
              return '0';
            }
            // Plain field reference wrapped in a pseudo-fn — just use the field value
            const val = row[field];
            return val != null ? String(val) : '0';
          });
          const result = Function(`return ${expr}`)();
          enriched[cf.label] = result;
          // Debug: store the resolved expression for troubleshooting
          enriched[`_debug_${cf.label}`] = expr;
        } catch (e) {
          enriched[cf.label] = `ERR: ${e.message}`;
        }
      });
      return enriched;
    });
  };

  const runQuery = async () => {
    setLoading(true);
    setError(null);
    const soql = buildSoql();
    const res = await base44.functions.invoke('salesforceQuery', { soql });
    if (res.data?.error) {
      setError(res.data.error);
    } else {
      let records = res.data?.records || [];
      // Evaluate formula fields
      records = evaluateFormulas(records);
      setRecords(records);
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
      calc_fields: calcFields,
      lookups: lookups,
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
    setScheduleEnabled(report.schedule_enabled || false);
    setScheduleFreq(report.schedule_frequency || 'weekly');
    setScheduleEmail(report.schedule_email || '');
    setCalcFields(report.calc_fields || []);
    setLookups(report.lookups || []);
    setRecords([]);
    setError(null);
    // Stash selected fields so they survive the object-load reset
    pendingFieldsRef.current = report.selected_fields?.length ? report.selected_fields : null;
    if (report.object_name !== selectedObject) {
      setSelectedObject(report.object_name);
      pendingFilterRef.current = report.filters?.[0] || defaultFilterGroup();
    } else {
      setSelectedFields(report.selected_fields || []);
      setFilterGroup(report.filters?.[0] || defaultFilterGroup());
      pendingFieldsRef.current = null;
    }
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
    setFilterGroup(defaultFilterGroup());
    setCalcFields([]);
    setLookups([]);
    setSelectedFields([]);
    setOrderByField('KeyStem__c');
    setRecords([]);
    setError(null);
    pendingFieldsRef.current = null;
    if (selectedObject === 'stem__c') {
      setFieldsRetry(v => v + 1); // re-trigger fields load via useEffect
    } else {
      setSelectedObject('stem__c');
    }
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

  const soql = buildSoql();

  const filterCount = (grp) => {
    if (!grp?.conditions) return 0;
    return grp.conditions.reduce((n, c) => n + (c.type === 'group' ? filterCount(c) : 1), 0);
  };
  const activeFilterCount = filterCount(filterGroup);

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Main builder */}
      <div className="flex-1 overflow-auto">
        <div className="p-6 lg:p-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
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
              <Button
                variant={showReportsPanel ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setShowReportsPanel(v => !v)}
                className="gap-1.5 text-muted-foreground"
              >
                <BookOpen className="w-3.5 h-3.5" />
                Saved
                {savedReports.length > 0 && <span className="text-[10px] font-bold bg-muted rounded-full px-1.5">{savedReports.length}</span>}
                <ChevronDown className={`w-3 h-3 transition-transform ${showReportsPanel ? 'rotate-180' : ''}`} />
              </Button>
              <Button variant="ghost" size="sm" onClick={toggleCompact} className="gap-1.5 text-muted-foreground" title={compact ? 'Comfortable view' : 'Compact view'}>
                {compact ? <AlignJustify className="w-3.5 h-3.5" /> : <LayoutList className="w-3.5 h-3.5" />}
              </Button>
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

          {/* Saved Reports dropdown panel */}
          {showReportsPanel && (
            <div className="mb-4 bg-card rounded-xl border border-border p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Saved Reports</span>
                <Button size="sm" variant="ghost" onClick={() => { newReport(); setShowReportsPanel(false); }} className="h-6 gap-1 text-xs text-muted-foreground">
                  <Plus className="w-3 h-3" /> New
                </Button>
              </div>
              {savedReports.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No saved reports yet</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {savedReports.map(r => (
                    <button
                      key={r.id}
                      onClick={() => { loadReport(r); setShowReportsPanel(false); }}
                      className={`group text-left px-3 py-2 rounded-lg border transition-colors ${
                        selectedSavedReport?.id === r.id
                          ? 'bg-primary/10 border-primary/40'
                          : 'bg-background border-border hover:border-primary/30 hover:bg-muted/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{r.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`text-[9px] px-1 rounded font-medium ${CAT_COLORS[r.category] || CAT_COLORS.general}`}>
                              {CATEGORIES.find(c => c.value === r.category)?.label || r.category}
                            </span>
                            {r.last_run_at && (
                              <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                                <Clock className="w-2 h-2" />
                                {format(new Date(r.last_run_at), 'dd MMM')}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={(e) => deleteReport(r.id, e)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0 mt-0.5"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SOQL Preview */}
          {!compact && showSoql && (
            <div className="mb-5 p-3 bg-slate-900 rounded-xl overflow-x-auto">
              <p className="text-xs font-mono text-emerald-400 whitespace-pre-wrap break-all">{soql}</p>
            </div>
          )}


          {/* Columns */}
          <div className="mb-5 bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Columns
              </label>
              {fieldsError && (
                <button onClick={() => setFieldsRetry(v => v + 1)} className="text-xs text-destructive hover:underline flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Failed to load — click to retry
                </button>
              )}
            </div>
            <ColumnSelector
              fields={fields.filter(f => !['IsDeleted', 'SystemModstamp'].includes(f.name))}
              selectedFields={selectedFields}
              onChange={setSelectedFields}
              loading={loadingFields}
              relatedObjects={fields
                .filter(f => f.type === 'reference' && f.relationshipName)
                .map(f => ({
                  relationshipName: f.relationshipName,
                  objectName: f.referenceTo?.[0] || f.relationshipName,
                  label: f.label,
                  isChild: false,
                }))}
              childRelationships={childRelationships}
            />
          </div>

          {/* Advanced panels: tabs */}
          {!compact && <div className="mb-5 bg-card rounded-xl border border-border overflow-hidden">
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
                  relatedObjects={fields
                    .filter(f => f.type === 'reference' && f.relationshipName)
                    .map(f => ({
                      relationshipName: f.relationshipName,
                      objectName: f.referenceTo?.[0] || f.relationshipName,
                      label: f.label,
                    }))}
                  childRelationships={childRelationships}
                  onChange={setFilterGroup}
                  depth={0}
                />
              )}
              {activeTab === 'aggregates' && (
                <CalculatedFields
                  calcFields={calcFields}
                  onChange={setCalcFields}
                  fields={fields}
                  relatedObjects={fields
                    .filter(f => f.type === 'reference' && f.relationshipName)
                    .map(f => ({
                      relationshipName: f.relationshipName,
                      objectName: f.referenceTo?.[0] || f.relationshipName,
                      label: f.label,
                    }))}
                  childRelationships={childRelationships}
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
          </div>}

          {!compact && error && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {/* Results */}
          {!compact && <div className="bg-card rounded-xl border border-border">
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
                <ExpandableResultsTable records={records} />
              ) : (
                <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                  <Play className="w-8 h-8 opacity-20" />
                  <span className="text-sm">Configure your query and click Run</span>
                </div>
              )}
            </div>
          </div>}
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