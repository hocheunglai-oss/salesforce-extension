import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, Loader2, RefreshCw, Search, X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

// Layout: grid of cards
const CARD_W = 200;
const CARD_H = 160;
const H_GAP = 80;
const V_GAP = 60;

function layoutObjects(objects) {
  const cols = Math.ceil(Math.sqrt(objects.length * 1.4));
  return objects.map((obj, i) => ({
    name: obj.name,
    x: (i % cols) * (CARD_W + H_GAP) + 40,
    y: Math.floor(i / cols) * (CARD_H + V_GAP) + 40,
  }));
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

export default function SchemaExplorer() {
  const [schemaData, setSchemaData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedObj, setSelectedObj] = useState(null);

  // Canvas transform state
  const [zoom, setZoom] = useState(0.7);
  const [pan, setPan] = useState({ x: 40, y: 40 });

  // Positions map: { name: {x, y} }
  const [positions, setPositions] = useState({});

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const canvasSizeRef = useRef({ w: 0, h: 0 });

  // Interaction refs (avoid re-renders during mouse move)
  const stateRef = useRef({ zoom: 0.7, pan: { x: 40, y: 40 }, positions: {}, dragging: null, panning: null });

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await base44.functions.invoke('salesforceFullSchema', {});
    if (res.data?.error) {
      setError(res.data.error);
    } else {
      setSchemaData(res.data);
      const layout = layoutObjects(res.data.objects);
      const pos = {};
      layout.forEach(l => { pos[l.name] = { x: l.x, y: l.y }; });
      setPositions(pos);
      stateRef.current.positions = pos;
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Sync state into ref
  useEffect(() => { stateRef.current.zoom = zoom; }, [zoom]);
  useEffect(() => { stateRef.current.pan = pan; }, [pan]);
  useEffect(() => { stateRef.current.positions = positions; }, [positions]);

  // Filtered objects
  const filteredObjects = useMemo(() =>
    schemaData?.objects?.filter(o =>
      !search || o.label.toLowerCase().includes(search.toLowerCase()) || o.name.toLowerCase().includes(search.toLowerCase())
    ) || [],
    [schemaData, search]
  );

  const visibleSet = useMemo(() => new Set(filteredObjects.map(o => o.name)), [filteredObjects]);

  const edges = useMemo(() => {
    const seen = new Set();
    return (schemaData?.edges || []).filter(e => {
      if (!visibleSet.has(e.from) || !visibleSet.has(e.to) || e.from === e.to) return false;
      const key = [e.from, e.to].sort().join('||');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [schemaData, visibleSet]);

  const objMap = useMemo(() =>
    Object.fromEntries((schemaData?.objects || []).map(o => [o.name, o])),
    [schemaData]
  );

  const selectedObjData = useMemo(() =>
    selectedObj ? objMap[selectedObj] : null,
    [selectedObj, objMap]
  );

  const highlightSet = useMemo(() => {
    if (!selectedObj) return null;
    const s = new Set([selectedObj]);
    (schemaData?.edges || []).forEach(e => {
      if (e.from === selectedObj) s.add(e.to);
      if (e.to === selectedObj) s.add(e.from);
    });
    return s;
  }, [selectedObj, schemaData]);

  const drawFnRef = useRef(null);

  // Throttled draw via rAF — always calls latest drawImmediate via ref
  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      drawFnRef.current?.();
    });
  }, []);

  const draw = useCallback(() => scheduleDraw(), [scheduleDraw]);

  // Canvas draw (immediate, called inside rAF)
  const drawImmediate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { zoom: z, pan: p, positions: pos } = stateRef.current;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;

    // Only resize backing store when dimensions actually change
    if (canvasSizeRef.current.w !== W * dpr || canvasSizeRef.current.h !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvasSizeRef.current = { w: W * dpr, h: H * dpr };
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, H);

    // Dot grid
    ctx.fillStyle = '#1e293b';
    const gridSpacing = 30 * z;
    const offsetX = (p.x % gridSpacing + gridSpacing) % gridSpacing;
    const offsetY = (p.y % gridSpacing + gridSpacing) % gridSpacing;
    for (let gx = offsetX; gx < W; gx += gridSpacing) {
      for (let gy = offsetY; gy < H; gy += gridSpacing) {
        ctx.beginPath();
        ctx.arc(gx, gy, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(z, z);

    // Draw edges
    edges.forEach(e => {
      const fp = pos[e.from];
      const tp = pos[e.to];
      if (!fp || !tp) return;
      const isHi = highlightSet && highlightSet.has(e.from) && highlightSet.has(e.to);
      const isDim = highlightSet && !isHi;
      ctx.globalAlpha = isDim ? 0.08 : isHi ? 0.9 : 0.35;
      ctx.strokeStyle = isHi ? '#3b82f6' : '#475569';
      ctx.lineWidth = isHi ? 2 / z : 1 / z;
      ctx.setLineDash(isHi ? [] : [5, 4]);
      const fx = fp.x + CARD_W / 2;
      const fy = fp.y + CARD_H / 2;
      const tx = tp.x + CARD_W / 2;
      const ty = tp.y + CARD_H / 2;
      const cx = (fx + tx) / 2;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.bezierCurveTo(cx, fy, cx, ty, tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      // Arrow head
      if (isHi) {
        const angle = Math.atan2(ty - fy, tx - fx);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - 8 / z * Math.cos(angle - 0.4), ty - 8 / z * Math.sin(angle - 0.4));
        ctx.lineTo(tx - 8 / z * Math.cos(angle + 0.4), ty - 8 / z * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;

    // Draw cards
    filteredObjects.forEach(obj => {
      const p2 = pos[obj.name];
      if (!p2) return;
      const isCustom = obj.custom;
      const isSelected = selectedObj === obj.name;
      const isDimmed = !!(highlightSet && !highlightSet.has(obj.name));

      ctx.globalAlpha = isDimmed ? 0.12 : 1;

      // Card shadow
      ctx.shadowColor = isSelected ? 'rgba(59,130,246,0.5)' : 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = isSelected ? 16 : 8;

      // Card background
      ctx.fillStyle = isCustom ? '#1e3a5f' : '#1a2e1a';
      ctx.beginPath();
      ctx.roundRect(p2.x, p2.y, CARD_W, CARD_H, 8);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Card border
      ctx.strokeStyle = isSelected ? '#f59e0b' : isCustom ? '#3b82f6' : '#22c55e';
      ctx.lineWidth = isSelected ? 2 / z : 1 / z;
      ctx.beginPath();
      ctx.roundRect(p2.x, p2.y, CARD_W, CARD_H, 8);
      ctx.stroke();

      // Header bg
      ctx.fillStyle = isCustom ? '#2563eb' : '#16a34a';
      ctx.beginPath();
      ctx.roundRect(p2.x, p2.y, CARD_W, 32, [8, 8, 0, 0]);
      ctx.fill();

      // Header label
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 12px "DM Sans", sans-serif`;
      ctx.textBaseline = 'middle';
      const labelText = obj.label.length > 20 ? obj.label.slice(0, 18) + '…' : obj.label;
      ctx.fillText(labelText, p2.x + 10, p2.y + 16);

      // Custom badge
      if (isCustom) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.roundRect(p2.x + CARD_W - 46, p2.y + 8, 36, 14, 3);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('custom', p2.x + CARD_W - 28, p2.y + 15);
        ctx.textAlign = 'left';
      }

      // Fields list
      const maxFields = 5;
      const shownFields = obj.fields.slice(0, maxFields);
      shownFields.forEach((f, fi) => {
        const fy = p2.y + 38 + fi * 20;
        if (fi % 2 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.03)';
          ctx.fillRect(p2.x, fy, CARD_W, 20);
        }
        // dot
        ctx.fillStyle = f.type === 'reference' ? '#f59e0b' : '#64748b';
        ctx.beginPath();
        ctx.arc(p2.x + 10, fy + 10, 3, 0, Math.PI * 2);
        ctx.fill();
        // field label
        ctx.fillStyle = isCustom ? '#e2e8f0' : '#d1fae5';
        ctx.font = '10px monospace';
        ctx.textBaseline = 'middle';
        const fname = f.label.length > 18 ? f.label.slice(0, 16) + '…' : f.label;
        ctx.fillText(fname, p2.x + 18, fy + 10);
        // type
        ctx.fillStyle = '#64748b';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'right';
        const typeText = f.type === 'reference' ? (f.referenceTo?.[0] || 'ref') : f.type;
        ctx.fillText(typeText.slice(0, 10), p2.x + CARD_W - 6, fy + 10);
        ctx.textAlign = 'left';
      });

      // More fields indicator
      if (obj.fields.length > maxFields) {
        ctx.fillStyle = '#64748b';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`+${obj.fields.length - maxFields} more`, p2.x + CARD_W / 2, p2.y + CARD_H - 8);
        ctx.textAlign = 'left';
      }

      ctx.globalAlpha = 1;
    });

    ctx.restore();
  }, [filteredObjects, edges, highlightSet, selectedObj]);

  // Keep drawFnRef up to date so scheduleDraw always calls the latest version
  useEffect(() => { drawFnRef.current = drawImmediate; });

  // Redraw whenever data/state changes
  useEffect(() => { scheduleDraw(); }, [scheduleDraw, drawImmediate, zoom, pan, positions]);

  // Resize observer
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      canvasSizeRef.current = { w: 0, h: 0 }; // force resize
      scheduleDraw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scheduleDraw]);

  // Hit-test: find which card was clicked (in world space)
  const hitTest = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { zoom: z, pan: p, positions: pos } = stateRef.current;
    const wx = (clientX - rect.left - p.x) / z;
    const wy = (clientY - rect.top - p.y) / z;
    for (const [name, cp] of Object.entries(pos)) {
      if (wx >= cp.x && wx <= cp.x + CARD_W && wy >= cp.y && wy <= cp.y + CARD_H) {
        return name;
      }
    }
    return null;
  }, []);

  // Mouse handlers
  const onMouseDown = useCallback((e) => {
    const hit = hitTest(e.clientX, e.clientY);
    if (hit) {
      const { zoom: z, pan: p, positions: pos } = stateRef.current;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      stateRef.current.dragging = {
        name: hit,
        startX: (e.clientX - rect.left - p.x) / z - pos[hit].x,
        startY: (e.clientY - rect.top - p.y) / z - pos[hit].y,
        moved: false,
      };
    } else {
      stateRef.current.panning = { startX: e.clientX - stateRef.current.pan.x, startY: e.clientY - stateRef.current.pan.y };
    }
  }, [hitTest]);

  const onMouseMove = useCallback((e) => {
    const { dragging, panning, zoom: z, pan: p, positions: pos } = stateRef.current;
    if (dragging) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const nx = (e.clientX - rect.left - p.x) / z - dragging.startX;
      const ny = (e.clientY - rect.top - p.y) / z - dragging.startY;
      stateRef.current.positions = { ...pos, [dragging.name]: { x: nx, y: ny } };
      dragging.moved = true;
      dragging.lastX = nx;
      dragging.lastY = ny;
      scheduleDraw();
    } else if (panning) {
      const newPan = { x: e.clientX - panning.startX, y: e.clientY - panning.startY };
      stateRef.current.pan = newPan;
      scheduleDraw();
    }
  }, [scheduleDraw]);

  const onMouseUp = useCallback((e) => {
    const { dragging } = stateRef.current;
    if (dragging) {
      if (!dragging.moved) {
        // Click: select/deselect
        setSelectedObj(prev => prev === dragging.name ? null : dragging.name);
      } else {
        // Commit position to React state
        const newPos = { ...stateRef.current.positions };
        setPositions(newPos);
      }
      stateRef.current.dragging = null;
    } else if (stateRef.current.panning) {
      setPan({ ...stateRef.current.pan });
      stateRef.current.panning = null;
    }
  }, []);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const newZ = Math.min(2.5, Math.max(0.15, stateRef.current.zoom * (1 - e.deltaY * 0.001)));
    stateRef.current.zoom = newZ;
    setZoom(newZ);
    scheduleDraw();
  }, [scheduleDraw]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const fitToScreen = () => {
    const newPan = { x: 40, y: 40 };
    const newZoom = 0.7;
    stateRef.current.pan = newPan;
    stateRef.current.zoom = newZoom;
    setPan(newPan);
    setZoom(newZoom);
    scheduleDraw();
  };

  return (
    <div className="flex h-full flex-col" ref={containerRef}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-card shrink-0 flex-wrap">
        <h1 className="text-sm font-semibold text-foreground font-dm">Schema Explorer</h1>
        <div className="relative w-52">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search objects…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {schemaData && (
          <span className="text-xs text-muted-foreground">
            {filteredObjects.length} objects · {edges.length} relationships
          </span>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { const nz = Math.min(2.5, zoom + 0.1); stateRef.current.zoom = nz; setZoom(nz); scheduleDraw(); }}><ZoomIn className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { const nz = Math.max(0.15, zoom - 0.1); stateRef.current.zoom = nz; setZoom(nz); scheduleDraw(); }}><ZoomOut className="w-3.5 h-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fitToScreen}><Maximize2 className="w-3.5 h-3.5" /></Button>
          <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 h-8">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Reload
          </Button>
        </div>
      </div>

      {error && (
        <div className="m-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm">Loading Salesforce schema…</p>
          <p className="text-xs opacity-60">This may take 15–30 seconds</p>
        </div>
      )}

      {!loading && schemaData && (
        <div className="flex flex-1 overflow-hidden">
          {/* Canvas */}
          <div className="flex-1 relative overflow-hidden">
            <canvas
              ref={canvasRef}
              className="w-full h-full"
              style={{ cursor: stateRef.current.dragging ? 'grabbing' : 'grab', display: 'block' }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
            />
            {/* Legend overlay */}
            <div className="absolute top-3 left-3 flex gap-3 bg-slate-900/80 backdrop-blur rounded-lg px-3 py-2 text-xs pointer-events-none text-slate-300">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-600 inline-block" />Custom</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-600 inline-block" />Standard</span>
            </div>
            {selectedObj && (
              <div className="absolute top-3 right-3 text-xs text-slate-400 bg-slate-900/80 backdrop-blur rounded-lg px-2 py-1 pointer-events-none">
                Click card to deselect
              </div>
            )}
          </div>

          {/* Detail panel */}
          {selectedObjData && (
            <div className="w-72 border-l border-border bg-card overflow-y-auto shrink-0">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{selectedObjData.custom ? 'Custom Object' : 'Standard Object'}</p>
                  <h3 className="text-sm font-semibold text-foreground">{selectedObjData.label}</h3>
                  <p className="text-xs font-mono text-muted-foreground mt-0.5">{selectedObjData.name}</p>
                </div>
                <button onClick={() => setSelectedObj(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Fields ({selectedObjData.fields.length})
                </p>
                <div className="space-y-0.5">
                  {selectedObjData.fields.map(f => (
                    <div key={f.name} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{f.label}</p>
                        <p className="text-[10px] font-mono text-muted-foreground truncate">{f.name}</p>
                      </div>
                      <div className="text-right ml-2 shrink-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${f.type === 'reference' ? 'bg-amber-100 text-amber-700' : 'bg-muted text-muted-foreground'}`}>
                          {f.type}
                        </span>
                        {f.type === 'reference' && f.referenceTo?.[0] && (
                          <p className="text-[9px] text-muted-foreground mt-0.5">→ {f.referenceTo[0]}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {(() => {
                  const related = [...new Set(
                    (schemaData?.edges || [])
                      .filter(e => e.from === selectedObjData.name || e.to === selectedObjData.name)
                      .flatMap(e => [e.from, e.to])
                      .filter(n => n !== selectedObjData.name)
                  )];
                  if (!related.length) return null;
                  return (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        Related Objects ({related.length})
                      </p>
                      <div className="space-y-1">
                        {related.map(name => {
                          const o = objMap[name];
                          return (
                            <button key={name} onClick={() => setSelectedObj(name)}
                              className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-xs">
                              <span className="font-medium text-foreground">{o?.label || name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}