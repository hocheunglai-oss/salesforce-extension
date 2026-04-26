import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical, X, Plus, Search, Loader2, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';

// ── Key encoding ─────────────────────────────────────────────────────────────
// "FieldName"                     → main field
// "Rel__r.FieldName"              → parent lookup
// "__child__:childRel:fieldName"  → child field (direct)
// "__child__:childRel:Lookup__r.fieldName" → child's child (lookup inside child)

function parseField(name) {
  if (name.startsWith('__child__:')) {
    const rest = name.slice('__child__:'.length);
    const colonIdx = rest.indexOf(':');
    const rel = rest.slice(0, colonIdx);
    const field = rest.slice(colonIdx + 1);
    const dot = field.indexOf('.');
    if (dot !== -1) {
      return { kind: 'child', rel, field, lookupRel: field.slice(0, dot), lookupField: field.slice(dot + 1), name };
    }
    return { kind: 'child', rel, field, name };
  }
  const dot = name.indexOf('.');
  if (dot !== -1) return { kind: 'parent', rel: name.slice(0, dot), field: name.slice(dot + 1), name };
  return { kind: 'main', name };
}

// Build the actual SOQL token for a selected field
export function toSoqlToken(name) {
  const p = parseField(name);
  if (p.kind === 'child') return `(SELECT ${p.field} FROM ${p.rel})`;
  return name;
}

export default function ColumnSelector({
  fields,
  selectedFields,
  onChange,
  loading,
  relatedObjects = [],
  childRelationships = [],
}) {
  const [search, setSearch] = useState('');
  // activeSource: '__main__' | relationshipName
  const [activeSource, setActiveSource] = useState('__main__');
  // For child tabs: which lookup sub-tab is active. '__direct__' = direct fields of the child object
  const [activeChildLookup, setActiveChildLookup] = useState('__direct__');
  const [relFieldsCache, setRelFieldsCache] = useState({}); // objectName → fields[]
  const [loadingRel, setLoadingRel] = useState(false);

  const sources = [
    { id: '__main__', label: 'Main Fields', objectName: null, kind: 'main' },
    ...relatedObjects.map(r => ({ id: r.relationshipName, label: r.label || r.relationshipName, objectName: r.objectName, kind: 'parent' })),
    ...childRelationships.map(r => ({ id: r.relationshipName, label: r.childSObject, objectName: r.childSObject, kind: 'child' })),
  ];

  const activeSourceMeta = sources.find(s => s.id === activeSource);

  // Load fields for any non-main object by objectName
  const ensureFieldsLoaded = (objectName) => {
    if (!objectName || relFieldsCache[objectName]) return;
    setLoadingRel(true);
    base44.functions.invoke('salesforceObjectFields', { objectName }).then(res => {
      const f = (res.data?.fields || []).filter(x => !['IsDeleted', 'SystemModstamp'].includes(x.name));
      setRelFieldsCache(prev => ({ ...prev, [objectName]: f }));
      setLoadingRel(false);
    });
  };

  useEffect(() => {
    if (activeSource === '__main__') return;
    ensureFieldsLoaded(activeSourceMeta?.objectName);
  }, [activeSource]);

  // When switching to a child source, also load the lookup sub-object if one is selected
  useEffect(() => {
    if (activeSourceMeta?.kind !== 'child') return;
    if (activeChildLookup === '__direct__') return;
    // activeChildLookup is a reference field name on the child object
    const childFields = relFieldsCache[activeSourceMeta.objectName] || [];
    const refField = childFields.find(f => f.name === activeChildLookup);
    const refObject = refField?.referenceTo?.[0];
    if (refObject) ensureFieldsLoaded(refObject);
  }, [activeChildLookup, relFieldsCache[activeSourceMeta?.objectName]]);

  // Reset child lookup tab when switching source
  useEffect(() => {
    setActiveChildLookup('__direct__');
    setSearch('');
  }, [activeSource]);

  // The child object's fields (direct)
  const childDirectFields = activeSourceMeta?.kind === 'child'
    ? (relFieldsCache[activeSourceMeta.objectName] || [])
    : [];

  // Reference fields on the child object → available as sub-tabs
  const childLookupFields = childDirectFields.filter(f => f.type === 'reference' && f.relationshipName);

  // Current lookup sub-object name (for child's child)
  const currentChildLookupRefObject = (() => {
    if (activeSourceMeta?.kind !== 'child' || activeChildLookup === '__direct__') return null;
    const refField = childDirectFields.find(f => f.name === activeChildLookup);
    return refField?.referenceTo?.[0] || null;
  })();

  // The field name token inside the subquery for the active panel
  // direct → just fieldName; child's child → Lookup__r.fieldName
  const makeKey = (rawFieldName) => {
    if (activeSource === '__main__') return rawFieldName;
    if (activeSourceMeta?.kind === 'child') {
      if (activeChildLookup === '__direct__') {
        return `__child__:${activeSource}:${rawFieldName}`;
      }
      // child's child: use relationshipName of the lookup field
      const refField = childDirectFields.find(f => f.name === activeChildLookup);
      const relName = refField?.relationshipName || activeChildLookup.replace(/__c$/i, '__r');
      return `__child__:${activeSource}:${relName}.${rawFieldName}`;
    }
    return `${activeSource}.${rawFieldName}`; // parent
  };

  // Pool of available fields to show
  const available = (() => {
    let pool;
    if (activeSource === '__main__') {
      pool = fields.filter(f => !['IsDeleted', 'SystemModstamp'].includes(f.name));
    } else if (activeSourceMeta?.kind === 'child') {
      if (activeChildLookup === '__direct__') {
        pool = childDirectFields;
      } else {
        // child's child fields
        pool = currentChildLookupRefObject
          ? (relFieldsCache[currentChildLookupRefObject] || [])
          : [];
      }
    } else {
      pool = relFieldsCache[activeSourceMeta?.objectName] || [];
    }
    return pool
      .filter(f => !selectedFields.includes(makeKey(f.name)))
      .filter(f => !search || f.label.toLowerCase().includes(search.toLowerCase()) || f.name.toLowerCase().includes(search.toLowerCase()));
  })();

  // Resolve display label for a selected field key
  const resolveLabel = (fieldKey) => {
    const p = parseField(fieldKey);
    if (p.kind === 'main') {
      return fields.find(f => f.name === fieldKey)?.label || fieldKey;
    }
    if (p.kind === 'parent') {
      const relObj = relatedObjects.find(r => r.relationshipName === p.rel);
      const relFields = relFieldsCache[relObj?.objectName] || [];
      const fieldLabel = relFields.find(f => f.name === p.field)?.label || p.field;
      return `${relObj?.label || p.rel} › ${fieldLabel}`;
    }
    if (p.kind === 'child') {
      const childObj = childRelationships.find(r => r.relationshipName === p.rel);
      const childObjName = childObj?.childSObject || p.rel;
      const childFields = relFieldsCache[childObjName] || [];
      if (p.field.includes('.')) {
        // child's child
        const [lookupRelName, subFieldName] = p.field.split('.');
        // Find the reference field by relationshipName
        const refField = childFields.find(f => f.relationshipName === lookupRelName);
        const refObjName = refField?.referenceTo?.[0];
        const subFields = refObjName ? (relFieldsCache[refObjName] || []) : [];
        const subLabel = subFields.find(f => f.name === subFieldName)?.label || subFieldName;
        return `${childObjName} › ${refField?.label || lookupRelName} › ${subLabel}`;
      }
      const fieldLabel = childFields.find(f => f.name === p.field)?.label || p.field;
      return `${childObjName} › ${fieldLabel}`;
    }
    return fieldKey;
  };

  const addField = (rawName) => onChange([...selectedFields, makeKey(rawName)]);
  const removeField = (key) => onChange(selectedFields.filter(f => f !== key));

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const { source, destination } = result;
    if (source.droppableId === 'selected' && destination.droppableId === 'selected') {
      const next = [...selectedFields];
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      onChange(next);
    }
  };

  const kindBadge = (key) => {
    const p = parseField(key);
    if (p.kind === 'parent') return <span className="text-[9px] px-1 rounded bg-blue-100 text-blue-600 shrink-0">lookup</span>;
    if (p.kind === 'child') {
      if (p.field?.includes('.')) return <span className="text-[9px] px-1 rounded bg-fuchsia-100 text-fuchsia-600 shrink-0">child›child</span>;
      return <span className="text-[9px] px-1 rounded bg-purple-100 text-purple-600 shrink-0">child</span>;
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex gap-2 flex-wrap">
        {[...Array(8)].map((_, i) => <div key={i} className="h-7 w-24 bg-muted animate-pulse rounded" />)}
      </div>
    );
  }

  const hasTabs = sources.length > 1;
  const isChildSource = activeSourceMeta?.kind === 'child';

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4">
        {/* Available fields panel */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Available ({available.length})
          </p>

          {/* Level-1 source tabs */}
          {hasTabs && (
            <div className="flex flex-wrap gap-1 mb-2">
              {sources.map(src => (
                <button
                  key={src.id}
                  onClick={() => setActiveSource(src.id)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                    activeSource === src.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : src.kind === 'child'
                        ? 'bg-purple-50 text-purple-600 border-purple-200 hover:border-purple-400'
                        : 'bg-muted/40 text-muted-foreground border-border hover:border-primary/40'
                  }`}
                >
                  {src.label}
                  {src.kind === 'child' && <span className="ml-1 text-[9px] opacity-60">↙</span>}
                </button>
              ))}
            </div>
          )}

          {/* Level-2 sub-tabs: direct fields + lookup fields of the child object */}
          {isChildSource && childLookupFields.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2 pl-2 border-l-2 border-purple-200">
              <button
                onClick={() => setActiveChildLookup('__direct__')}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                  activeChildLookup === '__direct__'
                    ? 'bg-purple-500 text-white border-purple-500'
                    : 'bg-purple-50 text-purple-600 border-purple-200 hover:border-purple-400'
                }`}
              >
                Direct fields
              </button>
              {childLookupFields.map(f => (
                <button
                  key={f.name}
                  onClick={() => setActiveChildLookup(f.name)}
                  className={`flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                    activeChildLookup === f.name
                      ? 'bg-fuchsia-500 text-white border-fuchsia-500'
                      : 'bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200 hover:border-fuchsia-400'
                  }`}
                >
                  <ChevronRight className="w-2.5 h-2.5" />
                  {f.label}
                </button>
              ))}
            </div>
          )}

          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              placeholder="Search fields…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-7 h-7 text-xs"
            />
          </div>

          {loadingRel ? (
            <div className="min-h-24 rounded-lg border bg-muted/20 border-border flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Droppable droppableId="available" isDropDisabled>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`min-h-24 max-h-52 overflow-y-auto rounded-lg border p-2 space-y-1 transition-colors ${
                    snapshot.isDraggingOver ? 'bg-muted/60 border-primary/30' : 'bg-muted/20 border-border'
                  }`}
                >
                  {available.map((f, idx) => (
                    <Draggable key={f.name} draggableId={`avail-${f.name}`} index={idx} isDragDisabled>
                      {(provided) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className="flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs select-none bg-card border border-border hover:border-primary/30 hover:bg-accent/30 transition-colors cursor-default"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate text-foreground">{f.label}</span>
                            <span className="text-[9px] text-muted-foreground/60 shrink-0">{f.type}</span>
                          </div>
                          <button
                            onClick={() => addField(f.name)}
                            className="ml-1 text-muted-foreground hover:text-primary shrink-0"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                  {available.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      {search ? 'No matching fields' : 'All fields selected'}
                    </p>
                  )}
                </div>
              )}
            </Droppable>
          )}
        </div>

        {/* Selected fields (orderable via drag) */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Selected & Order ({selectedFields.length})
          </p>
          {hasTabs && <div className="mb-2 h-[26px]" />}
          {isChildSource && childLookupFields.length > 0 && <div className="mb-2 h-[26px]" />}
          <div className="mb-2 h-7" />
          <Droppable droppableId="selected">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`min-h-24 max-h-52 overflow-y-auto rounded-lg border p-2 space-y-1 transition-colors ${
                  snapshot.isDraggingOver ? 'bg-accent/40 border-primary/40' : 'bg-accent/10 border-primary/20'
                }`}
              >
                {selectedFields.map((fieldKey, idx) => (
                  <Draggable key={fieldKey} draggableId={`sel-${idx}`} index={idx}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs select-none transition-colors ${
                          snapshot.isDragging
                            ? 'bg-primary text-primary-foreground shadow-md'
                            : 'bg-primary/10 border border-primary/20 text-foreground'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div {...provided.dragHandleProps} className="cursor-grab">
                            <GripVertical className="w-3 h-3 text-primary/60 shrink-0" />
                          </div>
                          <span className="text-[10px] font-bold text-primary/50 w-4 shrink-0">{idx + 1}</span>
                          <span className="truncate font-medium">{resolveLabel(fieldKey)}</span>
                          {kindBadge(fieldKey)}
                        </div>
                        <button
                          onClick={() => removeField(fieldKey)}
                          className={`ml-1 shrink-0 ${snapshot.isDragging ? 'text-white/70 hover:text-white' : 'text-muted-foreground hover:text-destructive'}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
                {selectedFields.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">Click + to add fields</p>
                )}
              </div>
            )}
          </Droppable>
        </div>
      </div>
    </DragDropContext>
  );
}