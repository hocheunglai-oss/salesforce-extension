import { useState, useEffect } from 'react';
import { appClient } from '@/api/appClient';
import { Settings, Search, Loader2, Check, Mail, CircleDollarSign } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ObjectSchemaTree from '@/components/settings/ObjectSchemaTree';
import PageHeader from '@/components/common/PageHeader';
import { readSmtpSettings, saveSmtpSettings } from '@/lib/smtpSettings';
import { RATE_PROVIDER_OPTIONS, readExchangeRateSettings, saveExchangeRateSettings } from '@/lib/exchangeRateSettings';

const SETTINGS_KEY = 'report_builder_config';

async function loadSettingsRecord() {
  const records = await appClient.entities.AppSettings.filter({ key: SETTINGS_KEY });
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
  const [smtpSettings, setSmtpSettings] = useState(readSmtpSettings);
  const [exchangeRateSettings, setExchangeRateSettings] = useState(readExchangeRateSettings);

  // Load schema + settings from DB in parallel
  useEffect(() => {
    Promise.all([
      appClient.functions.invoke('salesforceSchema', {}).then(res => res.data?.objects || []),
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
    appClient.functions.invoke('salesforceObjectFields', { objectName: defaultObject }).then(res => {
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
    saveSmtpSettings(smtpSettings);
    saveExchangeRateSettings(exchangeRateSettings);
    if (settingsRecord) {
      await appClient.entities.AppSettings.update(settingsRecord.id, { key: SETTINGS_KEY, value });
    } else {
      const created = await appClient.entities.AppSettings.create({ key: SETTINGS_KEY, value });
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
      <PageHeader
        icon={Settings}
        eyebrow="Admin / Reporting"
        title="Settings"
        description="Configure report builder access, allowed Salesforce objects, and default query behavior."
        actions={(
          <Button onClick={saveAll} disabled={saving || loading} className="gap-2">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : null}
          {saved ? 'Saved!' : 'Save All Settings'}
          </Button>
        )}
      />

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

      {/* ── Email Sending Account ── */}
      <div className="bg-card rounded-xl border border-border p-5 mb-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-muted p-2 text-muted-foreground">
            <Mail className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Email Sending Account</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Saved SMTP credentials are used by Send Now on the Outstanding Buyer Invoices page. The password is saved in this browser's app settings.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground md:col-span-4">
            <input
              type="checkbox"
              checked={smtpSettings.enabled}
              onChange={(event) => setSmtpSettings((prev) => ({ ...prev, enabled: event.target.checked }))}
            />
            Use this SMTP account for Send Now
          </label>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SMTP Host</Label>
            <Input
              value={smtpSettings.host}
              onChange={(event) => setSmtpSettings((prev) => ({ ...prev, host: event.target.value }))}
              placeholder="smtp.office365.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Port</Label>
            <Input
              type="number"
              value={smtpSettings.port}
              onChange={(event) => setSmtpSettings((prev) => ({ ...prev, port: event.target.value }))}
              placeholder="587"
            />
          </div>
          <label className="flex items-end gap-2 pb-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={smtpSettings.secure}
              onChange={(event) => setSmtpSettings((prev) => ({ ...prev, secure: event.target.checked }))}
            />
            SSL/TLS immediately
          </label>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email Username</Label>
            <Input
              value={smtpSettings.user}
              onChange={(event) => setSmtpSettings((prev) => ({ ...prev, user: event.target.value }))}
              placeholder="info@cosulich.com.hk"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Password / App Password</Label>
            <Input
              type="password"
              value={smtpSettings.password}
              onChange={(event) => setSmtpSettings((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="Saved when you click Save All Settings"
            />
          </div>
        </div>
      </div>

      {/* ── Exchange Rate API ── */}
      <div className="bg-card rounded-xl border border-border p-5 mb-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-muted p-2 text-muted-foreground">
            <CircleDollarSign className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Exchange Rate API</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Used by Broker's Commission to convert USD payable and receivable summaries into CNY.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">USD/CNY Rate Source</Label>
            <Select
              value={exchangeRateSettings.provider}
              onValueChange={(provider) => setExchangeRateSettings((prev) => ({ ...prev, provider }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RATE_PROVIDER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border border-border bg-background/50 p-3 text-xs text-muted-foreground">
            <div><span className="font-semibold text-foreground">API:</span> Frankfurter</div>
            <div><span className="font-semibold text-foreground">Endpoint:</span> /v2/rate/USD/CNY</div>
            <div><span className="font-semibold text-foreground">Date rule:</span> last working day of selected quarter</div>
            <div><span className="font-semibold text-foreground">Auth:</span> no API key</div>
          </div>
        </div>
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
