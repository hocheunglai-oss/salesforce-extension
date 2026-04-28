import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, GitBranch, Loader2, ChevronDown } from 'lucide-react';
import { base44 } from '@/api/base44Client';

// ── Operators ─────────────────────────────────────────────────────────────────
const OPERATORS_BY_TYPE = {
  string:    ['=', '!=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN'],
  picklist:  ['=', '!=', 'IN', 'NOT IN', 'INCLUDES', 'EXCLUDES'],
  boolean:   ['='],
  date:      ['=', '!=', '<', '>', '<=', '>='],
  datetime:  ['=', '!=', '<', '>', '<=', '>='],
  double:    ['=', '!=', '<', '>', '<=', '>='],
  currency:  ['=', '!=', '<', '>', '<=', '>='],
  integer:   ['=', '!=', '<', '>', '<=', '>='],
  id:        ['=', '!=', 'IN', 'NOT IN'],
  reference: ['=', '!=', 'IN', 'NOT IN'],
};
const DATE_LITERALS = [
  'TODAY','YESTERDAY','TOMORROW',
  'THIS_WEEK','LAST_WEEK','NEXT_WEEK',
  'THIS_MONTH','LAST_MONTH','NEXT_MONTH',
  'THIS_QUARTER','LAST_QUARTER','NEXT_QUARTER',
  'THIS_YEAR','LAST_YEAR','NEXT_YEAR',
  'LAST_N_DAYS:7','LAST_N_DAYS:30','LAST_N_DAYS:90',
];
function getOperators(t) { return OPERATORS_BY_TYPE[t] || OPERATORS_BY_TYPE.string; }

// ── Meta cache ────────────────────────────────────────────────────────────────
const metaCache = {};
async function fetchMeta(objectName) {
  if (metaCache[objectName]) return metaCache[objectName];
  const res = await base44.functions.invoke('salesforceObjectFields', { objectName });
  if (res.data?.error) throw new Error(res.data.error);
  const fields = (res.data?.fields || [])
    .filter(f => f.filterable !== false)
    .sort((a, b) => a.label.localeCompare(b.label));
  const parentRels = fields
    .filter(f => f.type === 'reference' && f.relationshipName)
    .map(f => ({ relationshipName: f.relationshipName, objectName: f.referenceTo?.[0] || f.relationshipName, label: f.label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const childRels = (res.data?.childRelationships || [])
    .sort((a, b) => a.relationshipName.localeCompare(b.relationshipName));
  metaCache[objectName] = { fields, parentRels, childRels };
  return metaCache[objectName];
}

// ── Portal dropdown ───────────────────────────────────────────────────────────
function PortalDropdown({ triggerRef, open, onClose, children }) {
  const [style, setStyle] = useState({});
  const ref = useRef(null);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setStyle({
      position: 'fixed',
      left: rect.left,
      width: Math.max(rect.width, 260),
      zIndex: 9999,
      ...(spaceBelow < 260 && rect.top > 260
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target) &&
          triggerRef.current && !triggerRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div ref={ref} style={style} className="bg-popover border border-border rounded-md shadow-xl">
      {children}
    </div>,
    document.body
  );
}

// ── Searchable select ─────────────────────────────────────────────────────────
function SearchableSelect({ value, placeholder, options, onChange, loading, className = '' }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef(null);

  const selected = options.find(o => o.value === value && !o.isHeader);
  const filtered = search
    ? options.filter(o => !o.isHeader && o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { setOpen(v => !v); setSearch(''); }}
        className="flex h-8 w-full items-center justify-between gap-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm hover:bg-muted/30 transition-colors"
      >
        <span className={`truncate ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : (selected?.label || placeholder)}
        </span>
        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
      </button>
      <PortalDropdown triggerRef={triggerRef} open={open} onClose={() => setOpen(false)}>
        <div className="p-1.5 border-b border-border">
          <input
            autoFocus
            className="w-full text-xs px-2 py-1 rounded bg-muted/40 outline-none placeholder:text-muted-foreground"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="max-h-60 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
          ) : filtered.map((o, i) => (
            <button
              key={o.value + i}
              type="button"
              disabled={!!o.isHeader}
              onClick={() => { if (!o.isHeader) { onChange(o.value); setOpen(false); setSearch(''); } }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                o.isHeader
                  ? 'text-[10px] font-bold text-muted-foreground uppercase tracking-wide cursor-default'
                  : o.value === value
                    ? 'bg-accent/70 font-semibold hover:bg-accent'
                    : 'hover:bg-accent'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </PortalDropdown>
    </div>
  );
}

// ── FilterRow ─────────────────────────────────────────────────────────────────
// Fully controlled — all state lives in `condition` prop, no internal state
function FilterRow({ condition, fields, relatedObjects, childRelationships, onChange, onRemove }) {
  // ── Parse condition.field into parts ──────────────────────────────────────
  // condition.field formats:
  //   "FieldName"                      → plain field on this object
  //   "Rel__r.FieldName"               → parent lookup (1 level)
  //   "__child__rel__:RelName:Field"   → child relationship filter
  const parseField = (f) => {
    if (!f) return { relType: 'this', relName: '', fieldName: '' };
    if (f.startsWith('__child__rel__:')) {
      const rest = f.slice('__child__rel__:'.length);
      const colon = rest.indexOf(':');
      return { relType: 'child', relName: rest.slice(0, colon), fieldName: rest.slice(colon + 1) };
    }
    if (f.includes('.')) {
      const dot = f.indexOf('.');
      return { relType: 'parent', relName: f.slice(0, dot), fieldName: f.slice(dot + 1) };
    }
    return { relType: 'this', relName: '', fieldName: f };
  };

  const { relType, relName, fieldName } = parseField(condition.field);

  // ── Related object fields (loaded on demand, cached) ─────────────────────
  const [relFields, setRelFields] = useState([]);
  const [loadingRel, setLoadingRel] = useState(false);

  useEffect(() => {
    if (relType === 'this') { setRelFields([]); return; }
    let objectName = null;
    if (relType === 'parent') {
      const ro = (relatedObjects || []).find(r => r.relationshipName === relName);
      objectName = ro?.objectName || relName;
    } else if (relType === 'child') {
      const cr = (childRelationships || []).find(r => r.relationshipName === relName);
      objectName = cr?.childSObject || relName;
    }
    if (!objectName) return;
    // Only fetch if it looks like a valid Salesforce object name (avoid fetching partial/invalid names)
    if (!/^[A-Za-z][A-Za-z0-9_]*(__c|__x|__mdt|__e|__b)?$/.test(objectName)) return;
    if (metaCache[objectName]) { setRelFields(metaCache[objectName].fields); return; }
    setLoadingRel(true);
    fetchMeta(objectName).then(meta => {
      setRelFields(meta.fields);
      setLoadingRel(false);
    }).catch(() => {
      setLoadingRel(false);
    });
  }, [relType, relName]);

  // ── Object (relationship) selector options ────────────────────────────────
  const relOptions = useMemo(() => {
    const opts = [{ value: '__this__', label: 'This Object' }];
    const parents = [...(relatedObjects || [])].sort((a, b) => a.label.localeCompare(b.label));
    const children = [...(childRelationships || [])].sort((a, b) => a.relationshipName.localeCompare(b.relationshipName));
    if (parents.length) {
      opts.push({ value: '__h_parent__', label: '↗ Parent Lookups', isHeader: true });
      parents.forEach(r => opts.push({ value: 'parent:' + r.relationshipName, label: `${r.label} (${r.objectName})` }));
    }
    if (children.length) {
      opts.push({ value: '__h_child__', label: '↙ Child Relationships', isHeader: true });
      children.forEach(r => opts.push({ value: 'child:' + r.relationshipName, label: `${r.relationshipName} (${r.childSObject})` }));
    }
    return opts;
  }, [relatedObjects, childRelationships]);

  const relValue = relType === 'this' ? '__this__'
    : relType === 'parent' ? 'parent:' + relName
    : 'child:' + relName;

  // ── Field options (for current level) ────────────────────────────────────
  const activeFields = relType === 'this'
    ? [...fields].sort((a, b) => a.label.localeCompare(b.label))
    : relFields;
  const fieldOptions = activeFields.map(f => ({ value: f.name, label: f.label }));

  // ── Field type for operator/value rendering ───────────────────────────────
  const activeField = activeFields.find(f => f.name === fieldName);
  const fieldType = activeField?.type || 'string';
  const operators = getOperators(fieldType);
  const isDate = fieldType === 'date' || fieldType === 'datetime';
  const isBool = fieldType === 'boolean';

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleRelChange = (v) => {
    // Reset everything when object changes
    onChange({ ...condition, field: '', operator: '=', value: '' });
  };

  // We need the raw relKey to build the SOQL path when field is chosen
  const pendingRelRef = useRef(relValue);
  const handleRelSelect = (v) => {
    pendingRelRef.current = v;
    onChange({ ...condition, field: '', operator: '=', value: '' });
  };

  const handleFieldSelect = (fn) => {
    const rv = pendingRelRef.current !== relValue ? pendingRelRef.current : relValue;
    let soqlField;
    if (rv === '__this__') {
      soqlField = fn;
    } else if (rv.startsWith('parent:')) {
      const rn = rv.slice('parent:'.length);
      soqlField = `${rn}.${fn}`;
    } else if (rv.startsWith('child:')) {
      const rn = rv.slice('child:'.length);
      soqlField = `__child__rel__:${rn}:${fn}`;
    } else {
      soqlField = fn;
    }
    // Only reset value if field actually changed
    const valueToKeep = soqlField !== condition.field ? '' : condition.value;
    const opToKeep = soqlField !== condition.field ? '=' : condition.operator;
    onChange({ ...condition, field: soqlField, operator: opToKeep, value: valueToKeep });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap py-1">
      {/* Object / relationship picker */}
      <SearchableSelect
        value={relValue}
        placeholder="Object…"
        options={relOptions}
        onChange={handleRelSelect}
        className="w-44"
      />

      {/* Field picker */}
      <SearchableSelect
        value={fieldName}
        placeholder="Field…"
        options={fieldOptions}
        onChange={handleFieldSelect}
        loading={loadingRel}
        className="w-44"
      />

      {/* Operator */}
      <Select value={condition.operator || '='} onValueChange={v => onChange({ ...condition, operator: v })}>
        <SelectTrigger className="w-28 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map(op => (
            <SelectItem key={op} value={op} className="text-xs font-mono">{op}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Value */}
      {isBool ? (
        <Select value={condition.value || ''} onValueChange={v => onChange({ ...condition, value: v })}>
          <SelectTrigger className="w-24 h-8 text-xs"><SelectValue placeholder="Value…" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="true" className="text-xs">true</SelectItem>
            <SelectItem value="false" className="text-xs">false</SelectItem>
          </SelectContent>
        </Select>
      ) : isDate ? (
        <div className="flex gap-1.5">
          <Select
            value={DATE_LITERALS.includes(condition.value) ? condition.value : '__custom__'}
            onValueChange={v => { if (v !== '__custom__') onChange({ ...condition, value: v }); }}
          >
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Date literal…" /></SelectTrigger>
            <SelectContent className="max-h-52">
              {DATE_LITERALS.map(l => <SelectItem key={l} value={l} className="text-xs font-mono">{l}</SelectItem>)}
              <SelectItem value="__custom__" className="text-xs">Custom…</SelectItem>
            </SelectContent>
          </Select>
          {!DATE_LITERALS.includes(condition.value) && (
            <Input
              className="w-32 h-8 text-xs font-mono"
              placeholder="YYYY-MM-DD"
              value={condition.value || ''}
              onChange={e => onChange({ ...condition, value: e.target.value })}
            />
          )}
        </div>
      ) : (
        <Input
          className="w-40 h-8 text-xs font-mono"
          placeholder={condition.operator === 'IN' || condition.operator === 'NOT IN' ? "'A','B'" : 'value'}
          value={condition.value || ''}
          onChange={e => onChange({ ...condition, value: e.target.value })}
        />
      )}

      <button onClick={onRemove} className="text-muted-foreground hover:text-destructive p-1 shrink-0">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── FilterGroup (recursive) ───────────────────────────────────────────────────
export default function FilterGroup({ group, fields, relatedObjects, childRelationships, onChange, depth = 0 }) {
  const addCondition = () => {
    onChange({
      ...group,
      conditions: [
        ...group.conditions,
        { type: 'condition', field: '', operator: '=', value: '', id: Date.now() }
      ]
    });
  };

  const addGroup = () => {
    onChange({
      ...group,
      conditions: [
        ...group.conditions,
        { type: 'group', logic: 'AND', conditions: [], id: Date.now() }
      ]
    });
  };

  const updateCondition = (idx, updated) => {
    const conditions = [...group.conditions];
    conditions[idx] = updated;
    onChange({ ...group, conditions });
  };

  const removeCondition = (idx) => {
    onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== idx) });
  };

  const borderColors = ['border-primary/30', 'border-amber-400/40', 'border-emerald-400/40', 'border-violet-400/40'];
  const bgColors    = ['bg-accent/20',       'bg-amber-50/50',       'bg-emerald-50/50',      'bg-violet-50/50'];

  return (
    <div className={`rounded-lg border ${borderColors[depth % 4]} ${bgColors[depth % 4]} p-3 space-y-1`}>
      {/* Logic toggle */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {depth === 0 ? 'Where' : 'Group'}
        </span>
        <div className="flex rounded-md border border-border overflow-hidden">
          {['AND', 'OR'].map(l => (
            <button key={l} onClick={() => onChange({ ...group, logic: l })}
              className={`px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                group.logic === l ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
              }`}>
              {l}
            </button>
          ))}
        </div>
        {group.conditions.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {group.conditions.length} condition{group.conditions.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Conditions */}
      {group.conditions.map((cond, idx) => (
        <div key={cond.id || idx}>
          {idx > 0 && (
            <div className="text-[10px] font-bold text-muted-foreground/60 uppercase pl-1 my-0.5">{group.logic}</div>
          )}
          {cond.type === 'group' ? (
            <div className="relative">
              <FilterGroup
                group={cond}
                fields={fields}
                relatedObjects={relatedObjects}
                childRelationships={childRelationships}
                onChange={updated => updateCondition(idx, updated)}
                depth={depth + 1}
              />
              <button onClick={() => removeCondition(idx)}
                className="absolute top-2 right-2 text-muted-foreground hover:text-destructive">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <FilterRow
              condition={cond}
              fields={fields}
              relatedObjects={relatedObjects}
              childRelationships={childRelationships}
              onChange={updated => updateCondition(idx, updated)}
              onRemove={() => removeCondition(idx)}
            />
          )}
        </div>
      ))}

      {/* Add buttons */}
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={addCondition} className="h-7 text-xs gap-1 text-primary">
          <Plus className="w-3 h-3" /> Add Condition
        </Button>
        <Button size="sm" variant="ghost" onClick={addGroup} className="h-7 text-xs gap-1 text-muted-foreground">
          <GitBranch className="w-3 h-3" /> Add Group
        </Button>
      </div>
    </div>
  );
}