import { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical, X, Plus, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export default function ColumnSelector({ fields, selectedFields, onChange, loading }) {
  const [search, setSearch] = useState('');

  const available = fields.filter(
    f => !['IsDeleted', 'SystemModstamp'].includes(f.name) && !selectedFields.includes(f.name)
  ).filter(f => !search || f.label.toLowerCase().includes(search.toLowerCase()) || f.name.toLowerCase().includes(search.toLowerCase()));

  const selectedMeta = selectedFields
    .map(name => fields.find(f => f.name === name))
    .filter(Boolean);

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const { source, destination, draggableId } = result;

    // Reorder within selected
    if (source.droppableId === 'selected' && destination.droppableId === 'selected') {
      const next = [...selectedFields];
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      onChange(next);
      return;
    }

    // Add from available to selected
    if (source.droppableId === 'available' && destination.droppableId === 'selected') {
      const next = [...selectedFields];
      next.splice(destination.index, 0, draggableId);
      onChange(next);
      return;
    }

    // Remove from selected back to available
    if (source.droppableId === 'selected' && destination.droppableId === 'available') {
      onChange(selectedFields.filter(f => f !== draggableId));
    }
  };

  const addField = (name) => onChange([...selectedFields, name]);
  const removeField = (name) => onChange(selectedFields.filter(f => f !== name));

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
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              placeholder="Search fields…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-7 h-7 text-xs"
            />
          </div>
          <Droppable droppableId="available" isDropDisabled={false}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`min-h-24 max-h-52 overflow-y-auto rounded-lg border p-2 space-y-1 transition-colors ${
                  snapshot.isDraggingOver ? 'bg-muted/60 border-primary/30' : 'bg-muted/20 border-border'
                }`}
              >
                {available.map((f, idx) => (
                  <Draggable key={f.name} draggableId={f.name} index={idx}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs cursor-grab select-none transition-colors ${
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
                {selectedMeta.map((f, idx) => (
                  <Draggable key={f.name} draggableId={f.name} index={idx}>
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
                          <span className="truncate font-medium">{f.label}</span>
                        </div>
                        <button
                          onClick={() => removeField(f.name)}
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