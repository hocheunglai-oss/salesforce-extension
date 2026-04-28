import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Calculator, ChevronDown, Loader2, Search } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const AGGREGATE_FNS = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'COUNT_DISTINCT'];

// ── Field cache for sub-object fetching ───────────────────────────────────────
const fieldCache = {};
async function fetchFields(objectName) {
  if (fieldCache[objectName]) return fieldCache[objectName];
  const res = await base44.functions.invoke('salesforceObjectFields', { objectName });
  const fields = res.data?.fields || [];
  fieldCache[objectName] = fields;
  return fields;
}

// ── Searchable field picker with sub-object support ───────────────────────────
function FieldPicker({ value, onChange, mainFields, relatedObjects, allowAllTypes }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeSource, setActiveSource] = useState('__main__');
  const [relFieldsCache, setRelFieldsCache] = useState({});
  const [loadingRel, setLoadingRel] = useState(false);
  const triggerRef = useRef(null);
  const dropRef = useRef(null);

  const numericTypes = ['double', 'currency', 'integer', 'percent'];

  const sources = [
    { id: '__main__', label: 'Main' },
    ...relatedObjects.map(r => ({ id: r.relationshipName, label: r.label || r.objectName, objectName: r.objectName })),
  ];

  useEffect(() => {
    if (activeSource === '__main__') return;
    const src = sources.find(s => s.id === activeSource);
    if (!src?.objectName || relFieldsCache[src.objectName]) return;
    setLoadingRel(true);
    fetchFields(src.objectName).then(f => {
      setRelFieldsCache(prev => ({ ...prev, [src.objectName]: f }));
      setLoadingRel(false);
    }).catch(() => setLoadingRel(false));
  }, [activeSource]);

  const activeObjectName = sources.find(s => s.id === activeSource)?.objectName;
  const pool = activeSource === '__main__'
    ? mainFields
    : (relFieldsCache[activeObjectName] || []);

  const filtered = (allowAllTypes ? pool : pool.filter(f => numericTypes.includes(f.type)))
    .filter(f => !search || f.label.toLowerCase().includes(search.toLowerCase()) || f.name.toLowerCase().includes(search.toLowerCase()));

  // Resolve display label for current value
  const resolveLabel = (v) => {
    if (!v) return null;
    if (v.includes('.')) {
      const [rel, field] = v.split('.');
      const src = relatedObjects.find(r => r.relationshipName === rel);
      const objFields = relFieldsCache[src?.objectName] || [];
      return `${src?.label || rel} › ${objFields.find(f => f.name === field)?.label || field}`;
    }
    return mainFields.find(f => f.name === v)?.label || v;
  };

  const handleSelect = (fieldName) => {
    const soqlField = activeSource === '__main__' ? fieldName : `${activeSource}.${fieldName}`;
    onChange(soqlField);
    setOpen(false);
    setSearch('');
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target) &&
          triggerRef.current && !triggerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Position dropdown
  const [dropStyle, setDropStyle] = useState({});
  const openDropdown = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 280), zIndex: 9999 });
    }
    setOpen(v => !v);
    setSearch('');
  };

  const label = resolveLabel(value);

  return (
    <div className="w-52">
      <button
        ref={triggerRef}
        type="button"
        onClick={openDropdown}
        className="flex h-8 w-full items-center justify-between gap-1 rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm hover:bg-muted/30 transition-colors"
      >
        <span className={`truncate ${label ? 'text-foreground' : 'text-muted-foreground'}`}>
          {label || 'Field…'}
        </span>
        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
      </button>

      {open && createPortal(
        <div ref={dropRef} style={dropStyle} className="bg-popover border border-border rounded-md shadow-xl flex flex-col max-h-72 overflow-hidden">
          {/* Source tabs */}
          {sources.length > 1 && (
            <div className="flex gap-1 p-1.5 border-b border-border flex-wrap shrink-0">
              {sources.map(src => (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => { setActiveSource(src.id); setSearch(''); }}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                    activeSource === src.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'text-muted-foreground border-border bg-muted/30 hover:bg-muted'
                  }`}
                >
                  {src.label}
                </button>
              ))}
            </div>
          )}
          {/* Search */}
          <div className="p-1.5 border-b border-border shrink-0 flex items-center gap-1.5">
            <Search className="w-3 h-3 text-muted-foreground shrink-0" />
            <input
              autoFocus
              className="w-full text-xs bg-transparent outline-none placeholder:text-muted-foreground"
              placeholder="Search fields…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {/* Field list */}
          <div className="overflow-y-auto flex-1">
            {loadingRel ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-foreground">No fields found</div>
            ) : filtered.map(f => (
              <button
                key={f.name}
                type="button"
                onClick={() => handleSelect(f.name)}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between gap-2 ${
                  (activeSource === '__main__' ? f.name : `${activeSource}.${f.name}`) === value
                    ? 'bg-accent/70 font-semibold'
                    : 'hover:bg-accent'
                }`}
              >
                <span className="truncate">{f.label}</span>
                <span className="text-[9px] text-muted-foreground shrink-0">{f.type}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Formula autocomplete input ────────────────────────────────────────────────
function FormulaInput({ value, onChange, fields, relatedObjects = [], childRelationships = [] }) {
  const [suggestions, setSuggestions] = useState([]);
  const [tokenStart, setTokenStart] = useState(0);
  const [dropStyle, setDropStyle] = useState({});
  const [relFieldsCache, setRelFieldsCache] = useState({});
  const inputRef = useRef(null);
  const dropRef = useRef(null);

  // Pre-fetch related fields eagerly so autocomplete is instant
  useEffect(() => {
    relatedObjects.forEach(r => {
      if (!r.objectName || relFieldsCache[r.objectName]) return;
      fetchFields(r.objectName).then(f => {
        setRelFieldsCache(prev => ({ ...prev, [r.objectName]: f }));
      }).catch(() => {});
    });
    childRelationships.forEach(r => {
      if (!r.childSObject || relFieldsCache[r.childSObject]) return;
      fetchFields(r.childSObject).then(f => {
        setRelFieldsCache(prev => ({ ...prev, [r.childSObject]: f }));
      }).catch(() => {});
    });
  }, [relatedObjects, childRelationships]);

  // Build a flat list of all tokens: fn names, main fields, rel.field paths, child fields
  const buildAllTokens = () => {
    const tokens = [];
    // Main fields
    fields.forEach(f => {
      tokens.push({ value: f.name, label: `${f.name} — ${f.label}`, isField: true, sub: null });
    });
    // Parent lookup fields as Rel__r.Field__c
    relatedObjects.forEach(r => {
      const rFields = relFieldsCache[r.objectName] || [];
      rFields.forEach(f => {
        const soql = `${r.relationshipName}.${f.name}`;
        tokens.push({ value: soql, label: `${soql} — ${r.label} › ${f.label}`, isField: true, sub: r.label });
      });
    });
    // Child relationship fields as RelationshipName.Field__c
    childRelationships.forEach(r => {
      const rFields = relFieldsCache[r.childSObject] || [];
      rFields.forEach(f => {
        const soql = `${r.relationshipName}.${f.name}`;
        tokens.push({ value: soql, label: `${soql} — ${r.childSObject} › ${f.label}`, isField: true, sub: r.childSObject });
      });
    });
    return tokens;
  };

  const getActiveToken = (text, cursor) => {
    // Walk back from cursor, allow dots for relationship paths
    let start = cursor;
    while (start > 0 && /[\w.]/.test(text[start - 1])) start--;
    const token = text.slice(start, cursor);
    const before = text.slice(0, start);
    const insideFn = !!before.match(/([A-Z_]+)\($/i);
    return { token, start, insideFn };
  };

  const computeSuggestions = (text, cursor) => {
    const { token, start, insideFn } = getActiveToken(text, cursor);
    setTokenStart(start);
    if (!token) { setSuggestions([]); return; }
    const q = token.toUpperCase();
    const allTokens = buildAllTokens();

    if (insideFn) {
      // Inside fn(...) — suggest fields + rel.fields
      const matches = allTokens
        .filter(t => t.value.toUpperCase().includes(q))
        .slice(0, 14);
      setSuggestions(matches);
    } else {
      // Outside fn — suggest function names first, then fields
      const fnMatches = AGGREGATE_FNS.filter(fn => fn.startsWith(q))
        .map(fn => ({ value: fn + '(', label: fn + '(…)', isFn: true }));
      const fieldMatches = allTokens
        .filter(t => t.value.toUpperCase().startsWith(q))
        .slice(0, 10);
      setSuggestions([...fnMatches, ...fieldMatches].slice(0, 14));
    }
  };

  const positionDropdown = () => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left, minWidth: Math.max(rect.width, 320), zIndex: 9999 });
  };

  const handleChange = (e) => {
    onChange(e.target.value);
    computeSuggestions(e.target.value, e.target.selectionStart);
    positionDropdown();
  };

  const applySuggestion = (suggestion) => {
    const cursor = inputRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, tokenStart);
    const after = value.slice(cursor);
    const newVal = before + suggestion.value + after;
    onChange(newVal);
    setSuggestions([]);
    setTimeout(() => {
      if (inputRef.current) {
        const pos = tokenStart + suggestion.value.length;
        inputRef.current.setSelectionRange(pos, pos);
        inputRef.current.focus();
      }
    }, 0);
  };

  useEffect(() => {
    if (suggestions.length === 0) return;
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setSuggestions([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [suggestions.length]);

  return (
    <div className="flex-1 relative">
      <input
        ref={inputRef}
        className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder="e.g. sum(Total_Invoice__c) - sum(Account__r.Cost__c)"
        value={value}
        onChange={handleChange}
        onKeyDown={e => { if (e.key === 'Escape') setSuggestions([]); }}
        onClick={e => { computeSuggestions(value, e.target.selectionStart); positionDropdown(); }}
        autoComplete="off"
        spellCheck={false}
      />
      {suggestions.length > 0 && createPortal(
        <div ref={dropRef} style={dropStyle} className="bg-popover border border-border rounded-md shadow-xl overflow-hidden max-h-60 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button key={i} type="button" onMouseDown={e => { e.preventDefault(); applySuggestion(s); }}
              className="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-accent transition-colors flex items-center gap-2">
              {s.isFn && <span className="text-[9px] px-1 rounded bg-primary/10 text-primary font-bold uppercase shrink-0">fn</span>}
              {s.isField && <span className={`text-[9px] px-1 rounded font-bold uppercase shrink-0 ${s.sub ? 'bg-blue-100 text-blue-600' : 'bg-muted text-muted-foreground'}`}>{s.sub || 'field'}</span>}
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export default function CalculatedFields({ calcFields, onChange, fields, relatedObjects = [], childRelationships = [] }) {
  const numericFields = fields.filter(f => ['double', 'currency', 'integer', 'percent'].includes(f.type));

  const add = (type = 'aggregate') => {
    onChange([
      ...calcFields,
      type === 'aggregate'
        ? { id: Date.now(), label: '', type: 'aggregate', fn: 'SUM', field: numericFields[0]?.name || '' }
        : { id: Date.now(), label: '', type: 'formula', expr: '' }
    ]);
  };

  const update = (id, patch) => onChange(calcFields.map(c => c.id === id ? { ...c, ...patch } : c));
  const remove = (id) => onChange(calcFields.filter(c => c.id !== id));

  return (
    <div className="space-y-2">
      {calcFields.length === 0 ? (
        <p className="text-xs text-muted-foreground">No calculated fields. Add aggregates like SUM, AVG, COUNT.</p>
      ) : (
        calcFields.map(cf => (
          <div key={cf.id} className="flex items-center gap-2 flex-wrap">
            {cf.type === 'aggregate' ? (
              <>
                <Select value={cf.fn} onValueChange={v => update(cf.id, { fn: v })}>
                  <SelectTrigger className="w-32 h-8 text-xs font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGGREGATE_FNS.map(fn => (
                      <SelectItem key={fn} value={fn} className="text-xs font-mono">{fn}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <span className="text-muted-foreground text-sm">(</span>

                <FieldPicker
                  value={cf.field}
                  onChange={v => update(cf.id, { field: v })}
                  mainFields={cf.fn === 'COUNT' || cf.fn === 'COUNT_DISTINCT' ? fields : numericFields}
                  relatedObjects={relatedObjects}
                  allowAllTypes={cf.fn === 'COUNT' || cf.fn === 'COUNT_DISTINCT'}
                />

                <span className="text-muted-foreground text-sm">)</span>
              </>
            ) : (
              <>
                <span className="text-muted-foreground text-xs font-semibold shrink-0">Formula:</span>
                <FormulaInput
                  value={cf.expr}
                  onChange={v => update(cf.id, { expr: v })}
                  fields={fields}
                  relatedObjects={relatedObjects}
                  childRelationships={childRelationships}
                />
              </>
            )}

            <span className="text-muted-foreground text-xs">as</span>

            <Input
              className="w-32 h-8 text-xs"
              placeholder="label"
              value={cf.label}
              onChange={e => update(cf.id, { label: e.target.value })}
            />

            <button onClick={() => remove(cf.id)} className="text-muted-foreground hover:text-destructive p-1">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))
      )}

      <div className="flex gap-1 mt-2">
        <Button size="sm" variant="ghost" onClick={() => add('aggregate')} className="h-7 text-xs gap-1 text-primary">
          <Plus className="w-3 h-3" /> Aggregate
        </Button>
        <Button size="sm" variant="ghost" onClick={() => add('formula')} className="h-7 text-xs gap-1 text-primary">
          <Plus className="w-3 h-3" /> Formula
        </Button>
      </div>

      {calcFields.length > 0 && (
        <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
          <Calculator className="w-3 h-3" />
          Aggregates run as SOQL GROUP BY. Formulas are computed per-row after fetching (use field names directly).
        </p>
      )}
    </div>
  );
}