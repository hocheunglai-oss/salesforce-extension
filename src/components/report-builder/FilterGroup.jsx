import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, GitBranch, Loader2, ChevronRight, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';

// ── Operators ────────────────────────────────────────────────────────────────
const OPERATORS_BY_TYPE = {
  string:    ['=', '!=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'INCLUDES', 'EXCLUDES'],
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

// ── Cache ────────────────────────────────────────────────────────────────────
const metaCache = {}; // objectName -> { fields, parentRels, childRels }

async function fetchMeta(objectName) {
  if (metaCache[objectName]) return metaCache[objectName];
  const res = await base44.functions.invoke('salesforceObjectFields', { objectName });
  const fields = (res.data?.fields || []).sort((a, b) => a.label.localeCompare(b.label));
  const parentRels = fields
    .filter(f => f.type === 'reference' && f.relationshipName)
    .map(f => ({ relationshipName: f.relationshipName, objectName: f.referenceTo?.[0] || f.relationshipName, label: f.label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const childRels = (res.data?.childRelationships || [])
    .sort((a, b) => a.relationshipName.localeCompare(b.relationshipName));
  const meta = { fields, parentRels, childRels };
  metaCache[objectName] = meta;
  return meta;
}

// ── Searchable dropdown ──────────────────────────────────────────────────────
function SearchableDropdown({ value, placeholder, options, onSelect, loading, className = '' }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase())
  );

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setSearch(''); }}
        className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm text-left hover:bg-muted/30 transition-colors"
      >
        <span className={selected ? 'text-foreground' : 'text-muted-foreground'}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : (selected?.label || placeholder)}
        </span>
        <ChevronRight className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-64 bg-popover border border-border rounded-md shadow-lg">
          <div className="p-1.5 border-b border-border">
            <input
              autoFocus
              className="w-full text-xs px-2 py-1 rounded bg-muted/40 outline-none placeholder:text-muted-foreground"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
            ) : filtered.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onSelect(o.value); setOpen(false); setSearch(''); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors ${
                  o.value === value ? 'bg-accent/60 font-semibold' : ''
                } ${o.isHeader ? 'text-[10px] font-bold text-muted-foreground uppercase tracking-wide pointer-events-none bg-transparent' : ''}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Object path picker ───────────────────────────────────────────────────────
// Renders a chain: [Object level 0] > [Object level 1] > ... > [Field]
// Each level can optionally pick a sub-relationship to drill into.
// path = array of { relKey, relLabel, objectName } — the traversal chain
// Returns a SOQL field string like "Account__r.Contact__r.Name"
// or for child: "__child__rel__:ChildRel:FieldName"

function ObjectPathPicker({ rootFields, rootParentRels, rootChildRels, value, onChange }) {
  // Parse stored value back into path + fieldName
  const parseValue = (v) => {
    if (!v) return { path: [], fieldName: '' };

    // child: __child__rel__:RelName:FieldName
    if (v.startsWith('__child__rel__:')) {
      const rest = v.slice('__child__rel__:'.length);
      const colon = rest.indexOf(':');
      const relName = rest.slice(0, colon);
      const fn = rest.slice(colon + 1);
      return {
        path: [{ relKey: 'child:' + relName, relLabel: relName, objectName: null }],
        fieldName: fn,
      };
    }
    // parent traversal: Rel1.Rel2.FieldName -> multiple dots
    if (v.includes('.')) {
      const parts = v.split('.');
      const fieldName = parts[parts.length - 1];
      const rels = parts.slice(0, -1);
      const path = rels.map(r => ({ relKey: 'parent:' + r, relLabel: r, objectName: null }));
      return { path, fieldName };
    }
    return { path: [], fieldName: v };
  };

  const { path: initPath, fieldName: initField } = parseValue(value);

  // levels[i] = { meta: {fields, parentRels, childRels} | null, loading: bool }
  // level 0 = root object, level 1+ = sub-objects
  const [levels, setLevels] = useState([{ meta: { fields: rootFields, parentRels: rootParentRels, childRels: rootChildRels }, loading: false }]);
  // selectedRel[i] = the relKey chosen at level i (to drill into level i+1)
  const [selectedRels, setSelectedRels] = useState(initPath.map(p => p.relKey));
  const [selectedField, setSelectedField] = useState(initField);

  // Load meta for a sub-object at a given depth
  const loadLevel = async (depth, relKey) => {
    // Determine objectName from relKey and the parent level's meta
    const parentMeta = levels[depth]?.meta;
    let objectName = null;

    if (relKey.startsWith('parent:')) {
      const relName = relKey.slice('parent:'.length);
      const found = parentMeta?.parentRels?.find(r => r.relationshipName === relName);
      objectName = found?.objectName || relName;
    } else if (relKey.startsWith('child:')) {
      const relName = relKey.slice('child:'.length);
      const found = parentMeta?.childRels?.find(r => r.relationshipName === relName);
      objectName = found?.childSObject || relName;
    }

    if (!objectName) return;

    // Mark loading
    setLevels(prev => {
      const next = prev.slice(0, depth + 1);
      next.push({ meta: null, loading: true });
      return next;
    });

    const meta = await fetchMeta(objectName);

    setLevels(prev => {
      const next = prev.slice(0, depth + 1);
      next.push({ meta, loading: false });
      return next;
    });
  };

  // When root meta changes (object switch), reset
  useEffect(() => {
    setLevels([{ meta: { fields: rootFields, parentRels: rootParentRels, childRels: rootChildRels }, loading: false }]);
    setSelectedRels([]);
    setSelectedField('');
  }, [rootFields]);

  const handleRelSelect = async (depth, relKey) => {
    // Trim path to current depth
    const newRels = [...selectedRels.slice(0, depth), relKey];
    setSelectedRels(newRels);
    setSelectedField('');
    // Remove deeper levels
    setLevels(prev => prev.slice(0, depth + 1));
    // Load next level
    await loadLevel(depth, relKey);
    onChange(''); // clear field until user picks one
  };

  const handleFieldSelect = (fieldName) => {
    setSelectedField(fieldName);
    // Build SOQL path
    let soqlField;
    if (selectedRels.length === 0) {
      soqlField = fieldName;
    } else {
      const lastRel = selectedRels[selectedRels.length - 1];
      if (lastRel.startsWith('child:')) {
        const relName = lastRel.slice('child:'.length);
        soqlField = `__child__rel__:${relName}:${fieldName}`;
      } else {
        // Build dot-path: Rel1__r.Rel2__r.FieldName
        const relPath = selectedRels.map(rk => rk.slice('parent:'.length)).join('.');
        soqlField = `${relPath}.${fieldName}`;
      }
    }
    onChange(soqlField);
  };

  // For each depth, build the relationship options for that level
  const buildRelOptions = (meta) => {
    if (!meta) return [];
    const opts = [];
    if (meta.parentRels?.length) {
      opts.push({ value: '__header_parent__', label: '↗ Parent Lookups', isHeader: true });
      meta.parentRels.forEach(r => opts.push({
        value: 'parent:' + r.relationshipName,
        label: `${r.label} (${r.objectName})`,
      }));
    }
    if (meta.childRels?.length) {
      opts.push({ value: '__header_child__', label: '↙ Child Relationships', isHeader: true });
      meta.childRels.forEach(r => opts.push({
        value: 'child:' + r.relationshipName,
        label: `${r.relationshipName} (${r.childSObject})`,
      }));
    }
    return opts;
  };

  const buildFieldOptions = (meta) => {
    if (!meta) return [];
    return (meta.fields || []).map(f => ({ value: f.name, label: f.label }));
  };

  // Determine which level's fields to show for the field picker
  const activeLevelIdx = selectedRels.length; // 0 = root, 1 = first sub, etc.
  const activeMeta = levels[activeLevelIdx]?.meta;
  const activeLoading = levels[activeLevelIdx]?.loading || false;
  const fieldOptions = buildFieldOptions(activeMeta);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Render each depth level's relationship selector */}
      {levels.map((level, depth) => {
        const relOpts = buildRelOptions(level.meta);
        if (relOpts.length === 0 && depth > 0) return null;
        const currentRel = selectedRels[depth];

        return (
          <div key={depth} className="flex items-center gap-1">
            {depth > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
            <SearchableDropdown
              value={currentRel || ''}
              placeholder={depth === 0 ? 'This Object' : 'Drill into…'}
              options={[
                ...(depth === 0 ? [{ value: '', label: 'This Object' }] : []),
                ...relOpts,
              ]}
              onSelect={(v) => {
                if (v === '') {
                  // Reset to this level
                  const newRels = selectedRels.slice(0, depth);
                  setSelectedRels(newRels);
                  setSelectedField('');
                  setLevels(prev => prev.slice(0, depth + 1));
                  onChange('');
                } else {
                  handleRelSelect(depth, v);
                }
              }}
              loading={level.loading}
              className="w-44"
            />
          </div>
        );
      })}

      {/* Field picker — shown at active level */}
      {activeLevelIdx <= levels.length && (
        <div className="flex items-center gap-1">
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
          <SearchableDropdown
            value={selectedField}
            placeholder="Field…"
            options={fieldOptions}
            onSelect={handleFieldSelect}
            loading={activeLoading}
            className="w-44"
          />
        </div>
      )}
    </div>
  );
}

// ── FilterRow ────────────────────────────────────────────────────────────────
function FilterRow({ condition, fields, relatedObjects, childRelationships, onChange, onRemove }) {
  // Determine field type from the stored soql field
  const getFieldType = () => {
    const f = condition.field;
    if (!f || f.startsWith('__child__rel__:') || f.includes('.')) return 'string';
    const found = fields.find(x => x.name === f);
    return found?.type || 'string';
  };

  const fieldType = getFieldType();
  const operators = getOperators(fieldType);
  const isDate = fieldType === 'date' || fieldType === 'datetime';
  const isBool = fieldType === 'boolean';

  // Root meta for ObjectPathPicker
  const rootMeta = {
    fields: [...fields].sort((a, b) => a.label.localeCompare(b.label)),
    parentRels: [...(relatedObjects || [])].sort((a, b) => a.label.localeCompare(b.label)),
    childRels: [...(childRelationships || [])].sort((a, b) => a.relationshipName.localeCompare(b.relationshipName)),
  };

  return (
    <div className="flex items-start gap-2 flex-wrap">
      {/* Object + field path picker */}
      <ObjectPathPicker
        rootFields={rootMeta.fields}
        rootParentRels={rootMeta.parentRels}
        rootChildRels={rootMeta.childRels}
        value={condition.field}
        onChange={(soqlField) => onChange({ ...condition, field: soqlField, operator: '=', value: '' })}
      />

      {/* Operator */}
      <Select value={condition.operator} onValueChange={v => onChange({ ...condition, operator: v })}>
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
        <Select value={condition.value} onValueChange={v => onChange({ ...condition, value: v })}>
          <SelectTrigger className="w-24 h-8 text-xs"><SelectValue placeholder="Value" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="true" className="text-xs">true</SelectItem>
            <SelectItem value="false" className="text-xs">false</SelectItem>
          </SelectContent>
        </Select>
      ) : isDate ? (
        <div className="flex gap-1">
          <Select value={DATE_LITERALS.includes(condition.value) ? condition.value : '__custom'} onValueChange={v => {
            if (v !== '__custom') onChange({ ...condition, value: v });
          }}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Date literal…" /></SelectTrigger>
            <SelectContent className="max-h-52">
              {DATE_LITERALS.map(l => <SelectItem key={l} value={l} className="text-xs font-mono">{l}</SelectItem>)}
              <SelectItem value="__custom" className="text-xs">Custom date…</SelectItem>
            </SelectContent>
          </Select>
          {!DATE_LITERALS.includes(condition.value) && (
            <Input className="w-32 h-8 text-xs font-mono" placeholder="YYYY-MM-DD"
              value={condition.value} onChange={e => onChange({ ...condition, value: e.target.value })} />
          )}
        </div>
      ) : (
        <Input
          className="w-36 h-8 text-xs font-mono"
          placeholder={condition.operator === 'IN' || condition.operator === 'NOT IN' ? "'A','B'" : 'value'}
          value={condition.value}
          onChange={e => onChange({ ...condition, value: e.target.value })}
        />
      )}

      <button onClick={onRemove} className="text-muted-foreground hover:text-destructive p-1 shrink-0 mt-0.5">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── FilterGroup (recursive) ──────────────────────────────────────────────────
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
  const bgColors = ['bg-accent/20', 'bg-amber-50/50', 'bg-emerald-50/50', 'bg-violet-50/50'];

  return (
    <div className={`rounded-lg border ${borderColors[depth % 4]} ${bgColors[depth % 4]} p-3 space-y-2`}>
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

      {group.conditions.map((cond, idx) => (
        <div key={cond.id || idx}>
          {idx > 0 && (
            <div className="text-[10px] font-bold text-muted-foreground/60 uppercase pl-1 my-1">{group.logic}</div>
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