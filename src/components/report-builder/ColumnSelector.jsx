import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical, X, Search, Loader2, ChevronRight, ChevronDown, Plus, Columns } from 'lucide-react';
import { Input } from '@/components/ui/input';

// ── Key encoding ─────────────────────────────────────────────────────────────
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
  const [activeSource, setActiveSource] = useState('__main__');
  const [activeChildLookup, setActiveChildLookup] = useState('__direct__');
  const [relFieldsCache, setRelFieldsCache] = useState({});
  const [loadingRel, setLoadingRel] = useState(false);

  const sources = [
    { id: '__main__', label: 'Main', objectName: null, kind: 'main' },
    ...relatedObjects.map(r => ({ id: r.relationshipName, label: r.label || r.relationshipName, objectName: r.objectName, kind: 'parent' })),
    ...childRelationships.map(r => ({ id: r.relationshipName, label: r.childSObject, objectName: r.childSObject, kind: 'child' })),
  ];

  const activeSourceMeta = sources.find(s => s.id === activeSource);

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

  useEffect(() => {
    if (activeSourceMeta?.kind !== 'child') return;
    if (activeChildLookup === '__direct__') return;
    const childFields = relFieldsCache[activeSourceMeta.objectName] || [];
    const refField = childFields.find(f => f.name === activeChildLookup);
    const refObject = refField?.referenceTo?.[0];
    if (refObject) ensureFieldsLoaded(refObject);
  }, [activeChildLookup, relFieldsCache[activeSourceMeta?.objectName]]);

  useEffect(() => {
    setActiveChildLookup('__direct__');
    setSearch('');
  }, [activeSource]);

  const childDirectFields = activeSourceMeta?.kind === 'child'
    ? (relFieldsCache[activeSourceMeta.objectName] || [])
    : [];

  const childLookupFields = childDirectFields.filter(f => f.type === 'reference' && f.relationshipName);

  const currentChildLookupRefObject = (() => {
    if (activeSourceMeta?.kind !== 'child' || activeChildLookup === '__direct__') return null;
    const refField = childDirectFields.find(f => f.name === activeChildLookup);
    return refField?.referenceTo?.[0] || null;
  })();

  const makeKey = (rawFieldName) => {
    if (activeSource === '__main__') return rawFieldName;
    if (activeSourceMeta?.kind === 'child') {
      if (activeChildLookup === '__direct__') return `__child__:${activeSource}:${rawFieldName}`;
      const refField = childDirectFields.find(f => f.name === activeChildLookup);
      const relName = refField?.relationshipName || activeChildLookup.replace(/__c$/i, '__r');
      return `__child__:${activeSource}:${relName}.${rawFieldName}`;
    }
    return `${activeSource}.${rawFieldName}`;
  };

  const available = (() => {
    let pool;
    if (activeSource === '__main__') {
      pool = fields.filter(f => !['IsDeleted', 'SystemModstamp'].includes(f.name));
    } else if (activeSourceMeta?.kind === 'child') {
      pool = activeChildLookup === '__direct__'
        ? childDirectFields
        : (currentChildLookupRefObject ? (relFieldsCache[currentChildLookupRefObject] || []) : []);
    } else {
      pool = relFieldsCache[activeSourceMeta?.objectName] || [];
    }
    return pool
      .filter(f => !selectedFields.includes(makeKey(f.name)))
      .filter(f => !search || f.label.toLowerCase().includes(search.toLowerCase()) || f.name.toLowerCase().includes(search.toLowerCase()));
  })();

  const resolveLabel = (fieldKey) => {
    const p = parseField(fieldKey);
    if (p.kind === 'main') return fields.find(f => f.name === fieldKey)?.label || fieldKey;
    if (p.kind === 'parent') {
      const relObj = relatedObjects.find(r => r.relationshipName === p.rel);
      const relFields = relFieldsCache[relObj?.objectName] || [];
      return `${relObj?.label || p.rel} › ${relFields.find(f => f.name === p.field)?.label || p.field}`;
    }
    if (p.kind === 'child') {
      const childObj = childRelationships.find(r => r.relationshipName === p.rel);
      const childObjName = childObj?.childSObject || p.rel;
      const childFields = relFieldsCache[childObjName] || [];
      if (p.field.includes('.')) {
        const [lookupRelName, subFieldName] = p.field.split('.');
        const refField = childFields.find(f => f.relationshipName === lookupRelName);
        const refObjName = refField?.referenceTo?.[0];
        const subLabel = refObjName ? (relFieldsCache[refObjName] || []).find(f => f.name === subFieldName)?.label || subFieldName : subFieldName;
        return `${childObjName} › ${refField?.label || lookupRelName} › ${subLabel}`;
      }
      return `${childObjName} › ${childFields.find(f => f.name === p.field)?.label || p.field}`;
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
    if (p.kind === 'parent') return <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 shrink-0 font-medium">↑ lookup</span>;
    if (p.kind === 'child') {
      if (p.field?.includes('.')) return <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-600 shrink-0 font-medium">↙↙</span>;
      return <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 shrink-0 font-medium">↙ child</span>;
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="flex gap-2 flex-wrap">
          {[...Array(12)].map((_, i) => <div key={i} className="h-7 w-24 bg-muted animate-pulse rounded" />)}
        </div>
      </div>
    );
  }

  const hasTabs = sources.length > 1;
  const isChildSource = activeSourceMeta?.kind === 'child';

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-6">

        {/* ── LEFT: Field Browser ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">

          {/* Source tabs */}
          {hasTabs && (
            <div className="flex flex-wrap gap-1">
              {sources.map(src => (
                <button
                  key={src.id}
                  onClick={() => setActiveSource(src.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-all ${
                    activeSource === src.id
                      ? src.kind === 'child'
                        ? 'bg-purple-500 text-white border-purple-500'
                        : 'bg-primary text-primary-foreground border-primary'
                      : src.kind === 'child'
                        ? 'text-purple-600 border-purple-200 bg-purple-50 hover:bg-purple-100'
                        : 'text-muted-foreground border-border bg-muted/30 hover:bg-muted'
                  }`}
                >
                  {src.label}
                  {src.kind === 'child' && activeSource !== src.id && <span className="ml-1 opacity-50">↙</span>}
                </button>
              ))}
            </div>
          )}

          {/* Child sub-tabs */}
          {isChildSource && childLookupFields.length > 0 && (
            <div className="flex flex-wrap gap-1 pl-3 border-l-2 border-purple-200">
              <button
                onClick={() => setActiveChildLookup('__direct__')}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                  activeChildLookup === '__direct__'
                    ? 'bg-purple-400 text-white border-purple-400'
                    : 'text-purple-500 border-purple-200 bg-purple-50 hover:bg-purple-100'
                }`}
              >
                Direct
              </button>
              {childLookupFields.map(f => (
                <button
                  key={f.name}
                  onClick={() => setActiveChildLookup(f.name)}
                  className={`flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                    activeChildLookup === f.name
                      ? 'bg-fuchsia-500 text-white border-fuchsia-500'
                      : 'text-fuchsia-600 border-fuchsia-200 bg-fuchsia-50 hover:bg-fuchsia-100'
                  }`}
                >
                  <ChevronRight className="w-2.5 h-2.5" />
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search fields…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>

          {/* Field list */}
          {loadingRel ? (
            <div className="h-48 rounded-lg border border-border flex items-center justify-center bg-muted/10">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Droppable droppableId="available" isDropDisabled>
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="min-h-40 max-h-72 overflow-y-auto rounded-lg border border-border bg-muted/10"
                >
                  {available.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-xs gap-1">
                      <Columns className="w-5 h-5 opacity-30" />
                      {search ? 'No matching fields' : 'All fields selected'}
                    </div>
                  ) : (
                    available.map((f, idx) => (
                      <Draggable key={f.name} draggableId={`avail-${f.name}`} index={idx} isDragDisabled>
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            onClick={() => addField(f.name)}
                            className="group flex items-center justify-between px-3 py-2 text-xs border-b border-border/40 last:border-b-0 hover:bg-accent/50 transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-foreground truncate">{f.label}</span>
                              <span className="text-[10px] text-muted-foreground/50 shrink-0 hidden group-hover:inline">{f.type}</span>
                            </div>
                            <Plus className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary shrink-0 opacity-0 group-hover:opacity-100 transition-all" />
                          </div>
                        )}
                      </Draggable>
                    ))
                  )}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          )}

          <p className="text-[10px] text-muted-foreground text-center">
            Click a field to add it → then drag to reorder
          </p>
        </div>

        {/* ── RIGHT: Selected columns (ordered) ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Selected Columns
            </span>
            <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {selectedFields.length}
            </span>
          </div>

          <Droppable droppableId="selected">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`min-h-40 max-h-72 overflow-y-auto rounded-lg border transition-colors ${
                  snapshot.isDraggingOver
                    ? 'border-primary/50 bg-accent/20'
                    : selectedFields.length === 0
                      ? 'border-dashed border-border bg-muted/10'
                      : 'border-primary/20 bg-accent/5'
                }`}
              >
                {selectedFields.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-xs gap-1">
                    <Columns className="w-5 h-5 opacity-30" />
                    No columns selected
                  </div>
                ) : (
                  selectedFields.map((fieldKey, idx) => (
                    <Draggable key={fieldKey} draggableId={`sel-${fieldKey}`} index={idx}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`group flex items-center gap-2 px-3 py-2 text-xs border-b border-border/30 last:border-b-0 transition-colors ${
                            snapshot.isDragging
                              ? 'bg-primary text-primary-foreground rounded-lg shadow-lg border-none'
                              : 'hover:bg-accent/40'
                          }`}
                        >
                          {/* Drag handle */}
                          <div {...provided.dragHandleProps} className="cursor-grab shrink-0">
                            <GripVertical className={`w-3.5 h-3.5 ${snapshot.isDragging ? 'text-primary-foreground/70' : 'text-muted-foreground/40 group-hover:text-muted-foreground'}`} />
                          </div>
                          {/* Index */}
                          <span className={`text-[10px] font-bold w-4 shrink-0 ${snapshot.isDragging ? 'text-primary-foreground/60' : 'text-muted-foreground/40'}`}>
                            {idx + 1}
                          </span>
                          {/* Label */}
                          <span className={`flex-1 min-w-0 font-medium break-words ${snapshot.isDragging ? 'text-primary-foreground' : 'text-foreground'}`}>
                            {resolveLabel(fieldKey)}
                          </span>
                          {/* Kind badge */}
                          {!snapshot.isDragging && kindBadge(fieldKey)}
                          {/* Remove */}
                          <button
                            onClick={() => removeField(fieldKey)}
                            className={`shrink-0 ml-auto ${snapshot.isDragging ? 'text-primary-foreground/70' : 'text-muted-foreground/0 group-hover:text-muted-foreground hover:text-destructive'} transition-colors`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </Draggable>
                  ))
                )}
                {provided.placeholder}
              </div>
            )}
          </Droppable>

          {selectedFields.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors text-center"
            >
              Clear all
            </button>
          )}
        </div>

      </div>
    </DragDropContext>
  );
}