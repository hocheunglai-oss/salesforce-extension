import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical, X, Plus, Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';

// Parse a selected field name: "Rel__r.FieldName" → {isRelated: true, rel, field} or {isRelated: false}
function parseField(name) {
  const dot = name.indexOf('.');
  if (dot === -1) return { isRelated: false, name };
  return { isRelated: true, rel: name.slice(0, dot), field: name.slice(dot + 1), name };
}

export default function ColumnSelector({ fields, selectedFields, onChange, loading, relatedObjects = [] }) {
  const [search, setSearch] = useState('');
  const [activeSource, setActiveSource] = useState('__main__');
  const [relFieldsCache, setRelFieldsCache] = useState({}); // { relationshipName: [{name, label, type}] }
  const [loadingRel, setLoadingRel] = useState(false);

  // Load related object fields when tab switches
  useEffect(() => {
    if (activeSource === '__main__') return;
    const rel = relatedObjects.find(r => r.relationshipName === activeSource);
    if (!rel || relFieldsCache[activeSource]) return;
    setLoadingRel(true);
    base44.functions.invoke('salesforceObjectFields', { objectName: rel.objectName }).then(res => {
      const f = (res.data?.fields || []).filter(x => !['IsDeleted', 'SystemModstamp'].includes(x.name));
      setRelFieldsCache(prev => ({ ...prev, [activeSource]: f }));
      setLoadingRel(false);
    });
  }, [activeSource]);

  // Build the pool of available fields for the current source tab
  const currentRelPrefix = activeSource !== '__main__' ? `${activeSource}.` : '';

  const mainAvailable = activeSource === '__main__'
    ? fields
        .filter(f => !['IsDeleted', 'SystemModstamp'].includes(f.name) && !selectedFields.includes(f.name))
        .filter(f => !search || f.label.toLowerCase().includes(search.toLowerCase()) || f.name.toLowerCase().includes(search.toLowerCase()))
    : [];

  const relAvailable = activeSource !== '__main__'
    ? (relFieldsCache[activeSource] || [])
        .filter(f => !selectedFields.includes(`${currentRelPrefix}${f.name}`))
        .filter(f => !search || f.label.toLowerCase().includes(search.toLowerCase()) || f.name.toLowerCase().includes(search.toLowerCase()))
    : [];

  const available = activeSource === '__main__' ? mainAvailable : relAvailable;

  // Resolve label for a selected field (handles both main and related)
  const resolveLabel = (fieldName) => {
    const parsed = parseField(fieldName);
    if (!parsed.isRelated) {
      return fields.find(f => f.name === fieldName)?.label || fieldName;
    }
    const relFields = relFieldsCache[parsed.rel] || [];
    const relObj = relatedObjects.find(r => r.relationshipName === parsed.rel);
    const fieldLabel = relFields.find(f => f.name === parsed.field)?.label || parsed.field;
    const relLabel = relObj?.label || parsed.rel;
    return `${relLabel} › ${fieldLabel}`;
  };

  const addField = (rawName) => {
    const fullName = activeSource !== '__main__' ? `${currentRelPrefix}${rawName}` : rawName;
    onChange([...selectedFields, fullName]);
  };

  const removeField = (name) => onChange(selectedFields.filter(f => f !== name));

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const { source, destination, draggableId } = result;
    if (source.droppableId === 'selected' && destination.droppableId === 'selected') {
      const next = [...selectedFields];
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      onChange(next);
    }
  };

  const sources = [
    { id: '__main__', label: 'stem__c' },
    ...relatedObjects.map(r => ({ id: r.relationshipName, label: r.label || r.relationshipName })),
  ];

  if (loading) {
    return (
      <div className="flex gap-2 flex-wrap">
        {[...Array(8)].map((_, i) => <div key={i} className="h-7 w-24 bg-muted animate-pulse rounded" />)}
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4">
        {/* Available fields */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Available ({available.length})
          </p>

          {/* Source tabs */}
          {relatedObjects.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {sources.map(src => (
                <button
                  key={src.id}
                  onClick={() => { setActiveSource(src.id); setSearch(''); }}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                    activeSource === src.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/40 text-muted-foreground border-border hover:border-primary/40'
                  }`}
                >
                  {src.label}
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
            <Droppable droppableId="available" isDropDisabled={activeSource !== '__main__'}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`min-h-24 max-h-52 overflow-y-auto rounded-lg border p-2 space-y-1 transition-colors ${
                    snapshot.isDraggingOver ? 'bg-muted/60 border-primary/30' : 'bg-muted/20 border-border'
                  }`}
                >
                  {available.map((f, idx) => (
                    <Draggable key={f.name} draggableId={f.name} index={idx} isDragDisabled={activeSource !== '__main__'}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs select-none transition-colors ${
                            activeSource !== '__main__' ? 'cursor-default' : 'cursor-grab'
                          } ${
                            snapshot.isDragging
                              ? 'bg-primary/10 border border-primary/30 shadow-sm'
                              : 'bg-card border border-border hover:border-primary/30 hover:bg-accent/30'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <GripVertical className="w-3 h-3 text-muted-foreground/50 shrink-0" />
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
                    <p className="text-xs text-muted-foreground text-center py-4">All fields selected</p>
                  )}
                </div>
              )}
            </Droppable>
          )}
        </div>

        {/* Selected fields (orderable) */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Selected & Order ({selectedFields.length})
          </p>
          <Droppable droppableId="selected">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`min-h-24 max-h-52 overflow-y-auto rounded-lg border p-2 space-y-1 transition-colors ${
                  snapshot.isDraggingOver ? 'bg-accent/40 border-primary/40' : 'bg-accent/10 border-primary/20'
                }`}
              >
                {selectedFields.map((fieldName, idx) => (
                  <Draggable key={fieldName} draggableId={fieldName} index={idx}>
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
                          <span className="truncate font-medium">{resolveLabel(fieldName)}</span>
                        </div>
                        <button
                          onClick={() => removeField(fieldName)}
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
                  <p className="text-xs text-muted-foreground text-center py-4">Drag fields here or click +</p>
                )}
              </div>
            )}
          </Droppable>
        </div>
      </div>
    </DragDropContext>
  );
}