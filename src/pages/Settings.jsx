import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Settings, Search, Loader2, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ObjectSchemaTree from '@/components/settings/ObjectSchemaTree';

const SETTINGS_KEY = 'report_builder_config';

async function loadSettingsRecord() {
  const records = await base44.entities.AppSettings.filter({ key: SETTINGS_KEY });
  return records[0] || null;
}

export default function SettingsPage() {
  const [allObjects, setAllObjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState('');
  const [settingsRecord, setSettingsRecord] = useState(null); // DB record

  // allowedMap: { [objectName]: true | false | { fields: {...}, children: {...} } }
  const [allowedMap, setAllowedMap] = useState({});

  // Report Builder defaults (also stored in DB)
  const [defaultObject, setDefaultObject] = useState('stem__c');
  const [defaultOrderBy, setDefaultOrderBy] = useState('KeyStem__c');
  const [defaultLimit, setDefaultLimit] = useState('100');
  const [rbFields, setRbFields] = useState([]);
  const [rbFieldsLoading, setRbFieldsLoading] = useState(false);

  // Load schema + settings from DB in parallel
  useEffect(() => {
    Promise.all([
      base44.functions.invoke('salesforceSchema', {}).then(res => res.data?.objects || []),
      loadSettingsRecord(),
    ]).then(([objects, record]) => {
      setAllObjects(objects);
      if (record) {
        setSettingsRecord(record);
        const v = record.value || {};
        setAllowedMap(v.allowedMap || {});
        setDefaultObject(v.defaultObject || 'stem__c');
        setDefaultOrderBy(v.defaultOrderBy || 'KeyStem__c');
        setDefaultLimit(String(v.defaultLimit || 100));
      }
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

  const saveAll = async () => {
    setSaving(true);
    const value = {
      allowedMap,
      defaultObject,
      defaultOrderBy,
      defaultLimit: Number(defaultLimit),
    };
    if (settingsRecord) {
      await base44.entities.AppSettings.update(settingsRecord.id, { key: SETTINGS_KEY, value });
    } else {
      const created = await base44.entities.AppSettings.create({ key: SETTINGS_KEY, value });
      setSettingsRecord(created);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const filteredObjects = allObjects.filter(o =>
    !search || o.label.toLowerCase().includes(search.toLowerCase()) || o.name.toLowerCase().includes(search.toLowerCase())
  );

  const enabledCount = Object.values(allowedMap).filter(v => v !== false).length +
    allObjects.filter(o => allowedMap[o.name] === undefined).length; // default true

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <Settings className="w-4 h-4" />
        <span>Settings</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground font-dm tracking-tight">Settings</h1>
        <Button onClick={saveAll} disabled={saving || loading} className="gap-2">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : null}
          {saved ? 'Saved!' : 'Save All Settings'}
        </Button>
      </div>

      {/* ── Allowed Objects & Fields ── */}
      <div className="bg-card rounded-xl border border-border p-5 mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-foreground">Report Builder — Allowed Objects & Fields</h2>
          {!loading && (
            <span className="text-xs text-muted-foreground">{enabledCount} of {allObjects.length} objects enabled</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Expand any object to configure which fields and child objects are accessible. Drill down into child objects to configure grandchildren, and so on.
        </p>

        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter objects…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          <Button
            variant="outline" size="sm" className="text-xs h-8 shrink-0"
            onClick={() => {
              const next = { ...allowedMap };
              filteredObjects.forEach(o => { next[o.name] = true; });
              setAllowedMap(next);
            }}
          >All</Button>
          <Button
            variant="outline" size="sm" className="text-xs h-8 shrink-0"
            onClick={() => {
              const next = { ...allowedMap };
              filteredObjects.forEach(o => { next[o.name] = false; });
              setAllowedMap(next);
            }}
          >None</Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading schema…
          </div>
        ) : (
          <ObjectSchemaTree
            allObjects={filteredObjects}
            allowedMap={allowedMap}
            onChange={setAllowedMap}
          />
        )}
      </div>

      {/* ── Report Builder Defaults ── */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h2 className="text-sm font-semibold text-foreground mb-1">Report Builder — Defaults</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Default Salesforce object, sort field, and row limit when opening the Report Builder.
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
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={saveAll} disabled={saving || loading} className="gap-2">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : null}
          {saved ? 'Saved!' : 'Save All Settings'}
        </Button>
      </div>
    </div>
  );
}