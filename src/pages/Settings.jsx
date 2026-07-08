import { useState, useEffect, useMemo } from 'react';
import { appClient } from '@/api/appClient';
import { Settings, Search, Loader2, Check, Mail, CircleDollarSign, FileText, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ObjectSchemaTree from '@/components/settings/ObjectSchemaTree';
import PageHeader from '@/components/common/PageHeader';
import DraftNotice from '@/components/common/DraftNotice';
import {
  readPaymentReminderSmtpSettings,
  readSmtpSettings,
  savePaymentReminderSmtpSettings,
  saveSmtpSettings,
} from '@/lib/smtpSettings';
import { RATE_PROVIDER_OPTIONS, readExchangeRateSettings, saveExchangeRateSettings } from '@/lib/exchangeRateSettings';
import { DOCUMENT_SOURCE_GROUPS, readDocumentSettings, saveDocumentSettings } from '@/lib/documentSettings';
import { clearDraft, readDraft, sameDraftValue, useDraftAutosave } from '@/lib/draftAutosave';

const SETTINGS_KEY = 'report_builder_config';
const SETTINGS_DRAFT_KEY = 'settings:page';
const SETTINGS_TAB_KEY = 'settings:active-tab';

const SETTINGS_TABS = [
  { id: 'access', label: 'Salesforce Access', icon: ShieldCheck },
  { id: 'email', label: 'Email Senders', icon: Mail },
  { id: 'exchange', label: 'Exchange Rate', icon: CircleDollarSign },
  { id: 'documents', label: 'STEM Documents', icon: FileText },
  { id: 'defaults', label: 'Report Defaults', icon: SlidersHorizontal },
];

function SettingsPanel({ title, description, icon: Icon, meta, children }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <div className="mt-0.5 rounded-lg bg-muted p-2 text-muted-foreground">
              <Icon className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {meta && <div className="shrink-0 text-xs text-muted-foreground">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

async function loadSettingsRecord() {
  const records = await appClient.entities.AppSettings.filter({ key: SETTINGS_KEY });
  return records[0] || null;
}

function SmtpAccountCard({ title, description, settings, onChange, enableLabel }) {
  const patch = (updates) => onChange((prev) => ({ ...prev, ...updates }));

  return (
    <div className="rounded-xl border border-border bg-background/50 p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-muted p-2 text-muted-foreground">
          <Mail className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            For Microsoft 365, if From Email differs from Email Username, the username mailbox must have Send As permission for that From Email.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground md:col-span-4">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => patch({ enabled: event.target.checked })}
          />
          {enableLabel}
        </label>
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sender Name</Label>
          <Input
            value={settings.fromName || ''}
            onChange={(event) => patch({ fromName: event.target.value })}
            placeholder="Fratelli Cosulich"
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">From Email</Label>
          <Input
            value={settings.fromEmail || ''}
            onChange={(event) => patch({ fromEmail: event.target.value })}
            placeholder="collections@cosulich.com.hk"
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SMTP Host</Label>
          <Input
            value={settings.host}
            onChange={(event) => patch({ host: event.target.value })}
            placeholder="smtp.office365.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Port</Label>
          <Input
            type="number"
            value={settings.port}
            onChange={(event) => patch({ port: event.target.value })}
            placeholder="587"
          />
        </div>
        <label className="flex items-end gap-2 pb-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={settings.secure}
            onChange={(event) => patch({ secure: event.target.checked })}
          />
          SSL/TLS immediately
        </label>
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email Username</Label>
          <Input
            value={settings.user}
            onChange={(event) => patch({ user: event.target.value })}
            placeholder="email@cosulich.com.hk"
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Password / App Password</Label>
          <Input
            type="password"
            value={settings.password}
            onChange={(event) => patch({ password: event.target.value })}
            placeholder="Saved when you click Save All Settings"
          />
        </div>
      </div>
    </div>
  );
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
  const [paymentReminderSmtpSettings, setPaymentReminderSmtpSettings] = useState(readPaymentReminderSmtpSettings);
  const [exchangeRateSettings, setExchangeRateSettings] = useState(readExchangeRateSettings);
  const [documentSettings, setDocumentSettings] = useState(readDocumentSettings);
  const [baseSettings, setBaseSettings] = useState(null);
  const [draftRestoredAt, setDraftRestoredAt] = useState(null);
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem(SETTINGS_TAB_KEY) || 'access');

  const settingsDraftValue = useMemo(() => ({
    allowedMap,
    defaultObject,
    defaultOrderBy,
    defaultLimit,
    smtpSettings,
    paymentReminderSmtpSettings,
    exchangeRateSettings,
    documentSettings,
  }), [allowedMap, defaultLimit, defaultObject, defaultOrderBy, documentSettings, exchangeRateSettings, paymentReminderSmtpSettings, smtpSettings]);
  const settingsDirty = Boolean(baseSettings && !sameDraftValue(settingsDraftValue, baseSettings));
  useDraftAutosave(SETTINGS_DRAFT_KEY, settingsDraftValue, {
    enabled: !loading,
    dirty: settingsDirty,
    message: 'Autosaved Settings draft. Save or discard it before leaving.',
  });

  const changeTab = (tab) => {
    setActiveTab(tab);
    localStorage.setItem(SETTINGS_TAB_KEY, tab);
  };

  // Load schema + settings from DB in parallel
  useEffect(() => {
    Promise.all([
      appClient.functions.invoke('salesforceSchema', {}, { cache: true }).then(res => res.data?.objects || []),
      loadSettingsRecord(),
    ]).then(([objects, record]) => {
      setAllObjects(objects);
      if (record) {
        setSettingsRecord(record);
        const v = record.value || {};
        const base = {
          allowedMap: v.allowedMap || {},
          defaultObject: v.defaultObject || 'stem__c',
          defaultOrderBy: v.defaultOrderBy || 'KeyStem__c',
          defaultLimit: String(v.defaultLimit || 100),
          smtpSettings: readSmtpSettings(),
          paymentReminderSmtpSettings: readPaymentReminderSmtpSettings(),
          exchangeRateSettings: readExchangeRateSettings(),
          documentSettings: readDocumentSettings(),
        };
        const draft = readDraft(SETTINGS_DRAFT_KEY);
        const next = draft?.data && !sameDraftValue(draft.data, base)
          ? { ...base, ...draft.data }
          : base;
        setAllowedMap(next.allowedMap || {});
        setDefaultObject(next.defaultObject || 'stem__c');
        setDefaultOrderBy(next.defaultOrderBy || 'KeyStem__c');
        setDefaultLimit(String(next.defaultLimit || 100));
        setSmtpSettings(next.smtpSettings || base.smtpSettings);
        setPaymentReminderSmtpSettings(next.paymentReminderSmtpSettings || base.paymentReminderSmtpSettings);
        setExchangeRateSettings(next.exchangeRateSettings || base.exchangeRateSettings);
        setDocumentSettings(next.documentSettings || base.documentSettings);
        setBaseSettings(base);
        setDraftRestoredAt(draft?.data && !sameDraftValue(next, base) ? draft.updatedAt : null);
      } else {
        const base = {
          allowedMap: {},
          defaultObject: 'stem__c',
          defaultOrderBy: 'KeyStem__c',
          defaultLimit: '100',
          smtpSettings: readSmtpSettings(),
          paymentReminderSmtpSettings: readPaymentReminderSmtpSettings(),
          exchangeRateSettings: readExchangeRateSettings(),
          documentSettings: readDocumentSettings(),
        };
        const draft = readDraft(SETTINGS_DRAFT_KEY);
        const next = draft?.data && !sameDraftValue(draft.data, base)
          ? { ...base, ...draft.data }
          : base;
        setAllowedMap(next.allowedMap || {});
        setDefaultObject(next.defaultObject || 'stem__c');
        setDefaultOrderBy(next.defaultOrderBy || 'KeyStem__c');
        setDefaultLimit(String(next.defaultLimit || 100));
        setSmtpSettings(next.smtpSettings || base.smtpSettings);
        setPaymentReminderSmtpSettings(next.paymentReminderSmtpSettings || base.paymentReminderSmtpSettings);
        setExchangeRateSettings(next.exchangeRateSettings || base.exchangeRateSettings);
        setDocumentSettings(next.documentSettings || base.documentSettings);
        setBaseSettings(base);
        setDraftRestoredAt(draft?.data && !sameDraftValue(next, base) ? draft.updatedAt : null);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!defaultObject) return;
    setRbFieldsLoading(true);
    appClient.functions.invoke('salesforceObjectFields', { objectName: defaultObject }, { cache: true }).then(res => {
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
    savePaymentReminderSmtpSettings(paymentReminderSmtpSettings);
    saveExchangeRateSettings(exchangeRateSettings);
    saveDocumentSettings(documentSettings);
    if (settingsRecord) {
      await appClient.entities.AppSettings.update(settingsRecord.id, { key: SETTINGS_KEY, value });
    } else {
      const created = await appClient.entities.AppSettings.create({ key: SETTINGS_KEY, value });
      setSettingsRecord(created);
    }
    const savedValue = {
      allowedMap,
      defaultObject,
      defaultOrderBy,
      defaultLimit,
      smtpSettings,
      paymentReminderSmtpSettings,
      exchangeRateSettings,
      documentSettings,
    };
    setBaseSettings(savedValue);
    clearDraft(SETTINGS_DRAFT_KEY);
    setDraftRestoredAt(null);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const discardSettingsDraft = () => {
    clearDraft(SETTINGS_DRAFT_KEY);
    if (baseSettings) {
      setAllowedMap(baseSettings.allowedMap || {});
      setDefaultObject(baseSettings.defaultObject || 'stem__c');
      setDefaultOrderBy(baseSettings.defaultOrderBy || 'KeyStem__c');
      setDefaultLimit(String(baseSettings.defaultLimit || 100));
      setSmtpSettings(baseSettings.smtpSettings || readSmtpSettings());
      setPaymentReminderSmtpSettings(baseSettings.paymentReminderSmtpSettings || readPaymentReminderSmtpSettings());
      setExchangeRateSettings(baseSettings.exchangeRateSettings || readExchangeRateSettings());
      setDocumentSettings(baseSettings.documentSettings || readDocumentSettings());
    }
    setDraftRestoredAt(null);
  };

  const filteredObjects = allObjects.filter(o =>
    !search || o.label.toLowerCase().includes(search.toLowerCase()) || o.name.toLowerCase().includes(search.toLowerCase())
  );

  const enabledCount = Object.values(allowedMap).filter(v => v !== false).length +
    allObjects.filter(o => allowedMap[o.name] === undefined).length; // default true

  const toggleDocumentSourceGroup = (group) => {
    setDocumentSettings((prev) => {
      const current = new Set(prev.relevantSourceGroups || []);
      if (current.has(group)) current.delete(group);
      else current.add(group);
      return { ...prev, relevantSourceGroups: [...current] };
    });
  };

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8">
      <PageHeader
        icon={Settings}
        eyebrow="Admin / Reporting"
        title="Settings"
        description="Configure application modules without scrolling through unrelated settings."
        actions={(
          <Button onClick={saveAll} disabled={saving || loading} className="gap-2">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
            {saved ? 'Saved!' : 'Save All Settings'}
          </Button>
        )}
      />

      <DraftNotice restoredAt={draftRestoredAt} label="Settings draft restored" onDiscard={discardSettingsDraft} className="mb-6" />

      <Tabs value={activeTab} onValueChange={changeTab} className="space-y-4">
        <div className="rounded-2xl border border-border bg-card/70 p-2">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
            {SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="h-9 gap-2 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <TabsContent value="access" className="mt-0">
          <SettingsPanel
            icon={ShieldCheck}
            title="Report Builder Access"
            description="Choose which Salesforce objects, fields, and child objects are available to reporting users."
            meta={!loading ? `${enabledCount} of ${allObjects.length} objects enabled` : null}
          >
            <div className="mb-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Filter objects..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <Button
                variant="outline" size="sm" className="h-8 shrink-0 text-xs"
                onClick={() => {
                  const next = { ...allowedMap };
                  filteredObjects.forEach(o => { next[o.name] = true; });
                  setAllowedMap(next);
                }}
              >All</Button>
              <Button
                variant="outline" size="sm" className="h-8 shrink-0 text-xs"
                onClick={() => {
                  const next = { ...allowedMap };
                  filteredObjects.forEach(o => { next[o.name] = false; });
                  setAllowedMap(next);
                }}
              >None</Button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading schema...
              </div>
            ) : (
              <div className="max-h-[calc(100vh-330px)] min-h-[420px] overflow-auto rounded-lg border border-border bg-background/40 p-2">
                <ObjectSchemaTree
                  allObjects={filteredObjects}
                  allowedMap={allowedMap}
                  onChange={setAllowedMap}
                />
              </div>
            )}
          </SettingsPanel>
        </TabsContent>

        <TabsContent value="email" className="mt-0">
          <SettingsPanel
            icon={Mail}
            title="Email Senders"
            description="Manage sender accounts for internal AR reports and customer-facing payment reminders."
          >
            <div className="space-y-4">
              <SmtpAccountCard
                title="Internal"
                description="Used by internal reports and late payment interest request emails. The password is saved in this browser's app settings."
                settings={smtpSettings}
                onChange={setSmtpSettings}
                enableLabel="Use this SMTP account for Internal emails"
              />

              <SmtpAccountCard
                title="External Payment Reminder"
                description="Used only by customer-facing payment reminder emails. Keep this separate from the internal report sender."
                settings={paymentReminderSmtpSettings}
                onChange={setPaymentReminderSmtpSettings}
                enableLabel="Use this SMTP account for External Payment Reminder emails"
              />
            </div>
          </SettingsPanel>
        </TabsContent>

        <TabsContent value="exchange" className="mt-0">
          <SettingsPanel
            icon={CircleDollarSign}
            title="Exchange Rate API"
            description="Used by Broker's Commission to convert USD payable and receivable summaries into CNY."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">USD/CNY Mid-Rate Source</Label>
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
                <div><span className="font-semibold text-foreground">Source:</span> Frankfurter API</div>
                <div><span className="font-semibold text-foreground">Rate treatment:</span> API rate is mid-rate</div>
                <div><span className="font-semibold text-foreground">Bank buy rate:</span> mid-rate less 0.2%</div>
                <div><span className="font-semibold text-foreground">Date rule:</span> latest available rate on or before quarter end</div>
                <div><span className="font-semibold text-foreground">Auth:</span> no API key</div>
              </div>
            </div>
          </SettingsPanel>
        </TabsContent>

        <TabsContent value="documents" className="mt-0">
          <SettingsPanel
            icon={FileText}
            title="STEM Documents"
            description="Choose which discovered Salesforce document sources are relevant for Stem Detail and dispute document browsing."
          >
            <label className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={documentSettings.showOnlyRelevant}
                onChange={(event) => setDocumentSettings((prev) => ({ ...prev, showOnlyRelevant: event.target.checked }))}
              />
              Show only relevant document sources by default
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              {DOCUMENT_SOURCE_GROUPS.map((group) => {
                const checked = documentSettings.relevantSourceGroups?.includes(group);
                return (
                  <label key={group} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm">
                    <span className="font-medium text-foreground">{group}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDocumentSourceGroup(group)}
                    />
                  </label>
                );
              })}
            </div>
          </SettingsPanel>
        </TabsContent>

        <TabsContent value="defaults" className="mt-0">
          <SettingsPanel
            icon={SlidersHorizontal}
            title="Report Builder Defaults"
            description="Set the default Salesforce object, sort field, and row limit when opening the Report Builder."
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Default Object</label>
                {loading ? (
                  <div className="h-9 animate-pulse rounded-md border border-input bg-muted" />
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
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Default Order By</label>
                {rbFieldsLoading ? (
                  <div className="h-9 animate-pulse rounded-md border border-input bg-muted" />
                ) : (
                  <Select value={defaultOrderBy} onValueChange={setDefaultOrderBy}>
                    <SelectTrigger><SelectValue placeholder="Select field..." /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {rbFields.map(f => <SelectItem key={f.name} value={f.name}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Default Row Limit</label>
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
          </SettingsPanel>
        </TabsContent>
      </Tabs>

      <div className="mt-4 flex justify-end rounded-xl border border-border bg-card/70 p-3">
        <Button onClick={saveAll} disabled={saving || loading} className="gap-2">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
          {saved ? 'Saved!' : 'Save All Settings'}
        </Button>
      </div>
    </div>
  );
}
