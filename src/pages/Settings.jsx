import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Settings, Search, Loader2, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const STORAGE_KEY = 'report_builder_allowed_objects';

export function getAllowedObjects() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? JSON.parse(v) : null; // null = all allowed
  } catch { return null; }
}

export default function SettingsPage() {
  const [allObjects, setAllObjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [allowed, setAllowed] = useState(null); // null = all

  // Report Builder defaults
  const [defaultObject, setDefaultObject] = useState(() => localStorage.getItem('rb_default_object') || 'stem__c');
  const [defaultOrderBy, setDefaultOrderBy] = useState(() => localStorage.getItem('rb_default_orderby') || 'KeyStem__c');
  const [defaultLimit, setDefaultLimit] = useState(() => localStorage.getItem('rb_default_limit') || '100');
  const [rbFields, setRbFields] = useState([]);
  const [rbFieldsLoading, setRbFieldsLoading] = useState(false);
  const [rbSaved, setRbSaved] = useState(false);

  useEffect(() => {
    setAllowed(getAllowedObjects());
    base44.functions.invoke('salesforceSchema', {}).then(res => {
      setAllObjects(res.data?.objects || []);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!defaultObject) return;
    setRbFieldsLoading(true);
    base44.functions.invoke('salesforceObjectFields', { objectName: defaultObject }).then(res => {
      setRbFields((res.data?.fields || []).filter(f => f.sortable));
      setRbFieldsLoading(false);
    });
  }, [defaultObject]);

  const saveRbDefaults = () => {
    localStorage.setItem('rb_default_object', defaultObject);
    localStorage.setItem('rb_default_orderby', defaultOrderBy);
    localStorage.setItem('rb_default_limit', defaultLimit);
    setRbSaved(true);
    setTimeout(() => setRbSaved(false), 1500);
  };

  const filtered = allObjects.filter(o =>
    !search || o.label.toLowerCase().includes(search.toLowerCase()) || o.name.toLowerCase().includes(search.toLowerCase())
  );

  const isAllowed = (name) => allowed === null || allowed.includes(name);

  const toggle = (name) => {
    if (allowed === null) {
      // Start from all selected, then remove this one
      const next = allObjects.map(o => o.name).filter(n => n !== name);
      setAllowed(next);
    } else if (allowed.includes(name)) {
      const next = allowed.filter(n => n !== name);
      setAllowed(next.length === 0 ? [name] : next); // prevent empty
    } else {
      const next = [...allowed, name];
      // If all selected, revert to null
      setAllowed(next.length === allObjects.length ? null : next);
    }
  };

  const selectAll = () => setAllowed(null);
  const deselectAll = () => setAllowed(allObjects.slice(0, 1).map(o => o.name));

  const save = () => {
    if (allowed === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allowed));
    }
    // Show brief feedback
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const [saved, setSaved] = useState(false);

  const allowedCount = allowed === null ? allObjects.length : allowed.length;

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <Settings className="w-4 h-4" />
        <span>Settings</span>
      </div>
      <h1 className="text-2xl font-bold text-foreground font-dm tracking-tight mb-6">Settings</h1>

      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-foreground">Report Builder — Allowed Objects</h2>
          <span className="text-xs text-muted-foreground">{allowedCount} of {allObjects.length} enabled</span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Choose which Salesforce objects appear in the Report Builder object selector.
        </p>

        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search objects…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          <Button variant="outline" size="sm" onClick={selectAll} className="text-xs h-8">All</Button>
          <Button variant="outline" size="sm" onClick={deselectAll} className="text-xs h-8">None</Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading objects…
          </div>
        ) : (
          <div className="border border-border rounded-lg divide-y divide-border max-h-[420px] overflow-y-auto">
            {filtered.map(obj => {
              const on = isAllowed(obj.name);
              return (
                <button
                  key={obj.name}
                  onClick={() => toggle(obj.name)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-muted/30 transition-colors ${on ? '' : 'opacity-50'}`}
                >
                  <div>
                    <span className="text-sm font-medium text-foreground">{obj.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{obj.name}</span>
                  </div>
                  <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${on ? 'bg-primary border-primary' : 'border-border'}`}>
                    {on && <Check className="w-3 h-3 text-white" />}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button onClick={save} className="gap-2" disabled={loading}>
            {saved ? <Check className="w-3.5 h-3.5" /> : null}
            {saved ? 'Saved!' : 'Save Settings'}
          </Button>
        </div>
      </div>

      {/* Report Builder Defaults */}
      <div className="bg-card rounded-xl border border-border p-5 mt-6">
        <h2 className="text-sm font-semibold text-foreground mb-1">Report Builder — Defaults</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Set the default Salesforce object, sort order, and row limit used when opening the Report Builder.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Default Object</label>
            {loading ? (
              <div className="h-9 rounded-md border border-input bg-muted animate-pulse" />
            ) : (
              <Select value={defaultObject} onValueChange={v => { setDefaultObject(v); setDefaultOrderBy(''); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {allObjects.map(o => <SelectItem key={o.name} value={o.name}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Default Order By</label>
            {rbFieldsLoading ? (
              <div className="h-9 rounded-md border border-input bg-muted animate-pulse" />
            ) : (
              <Select value={defaultOrderBy} onValueChange={setDefaultOrderBy}>
                <SelectTrigger><SelectValue placeholder="Select field…" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {rbFields.map(f => <SelectItem key={f.name} value={f.name}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Default Row Limit</label>
            <Select value={defaultLimit} onValueChange={setDefaultLimit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[25, 50, 100, 200, 500, 1000, 2000].map(n => (
                  <SelectItem key={n} value={String(n)}>{n} rows</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={saveRbDefaults} className="gap-2">
            {rbSaved ? <Check className="w-3.5 h-3.5" /> : null}
            {rbSaved ? 'Saved!' : 'Save Defaults'}
          </Button>
        </div>
      </div>
    </div>
  );
}