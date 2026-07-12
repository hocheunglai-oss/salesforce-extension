import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  FileText,
  Loader2,
  Mail,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/common/PageHeader';
import DraftNotice from '@/components/common/DraftNotice';
import StateBlock from '@/components/common/StateBlock';
import { appClient } from '@/api/appClient';
import { RATE_PROVIDER_OPTIONS, readExchangeRateSettings, saveExchangeRateSettings } from '@/lib/exchangeRateSettings';
import { DOCUMENT_SOURCE_GROUPS, readDocumentSettings, saveDocumentSettings } from '@/lib/documentSettings';
import { clearDraft, readDraft, sameDraftValue, useDraftAutosave } from '@/lib/draftAutosave';

const SETTINGS_DRAFT_KEY = 'settings:page';
const SETTINGS_TAB_KEY = 'settings:active-tab';

const SETTINGS_TABS = [
  { id: 'email', label: 'Email Senders', icon: Mail },
  { id: 'exchange', label: 'Exchange Rate', icon: CircleDollarSign },
  { id: 'documents', label: 'STEM Documents', icon: FileText },
  { id: 'health', label: 'System Health', icon: Activity },
];

function validSettingsTab(value) {
  return SETTINGS_TABS.some((tab) => tab.id === value) ? value : 'email';
}

function settingsSnapshot() {
  return {
    exchangeRateSettings: readExchangeRateSettings(),
    documentSettings: readDocumentSettings(),
  };
}

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

const STATUS_META = {
  online: {
    label: 'Online',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: CheckCircle2,
  },
  configured: {
    label: 'Configured',
    className: 'border-sky-200 bg-sky-50 text-sky-700',
    icon: ShieldCheck,
  },
  warning: {
    label: 'Warning',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
    icon: AlertTriangle,
  },
  not_configured: {
    label: 'Not configured',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
    icon: Clock,
  },
  error: {
    label: 'Error',
    className: 'border-red-200 bg-red-50 text-red-700',
    icon: XCircle,
  },
};

function formatHealthDate(value) {
  if (!value) return '—';
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Hong_Kong',
  }).format(date);
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.not_configured;
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={`gap-1.5 whitespace-nowrap ${meta.className}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

function KeyValueList({ items }) {
  const rows = Object.entries(items || {}).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!rows.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {rows.map(([key, value]) => (
        <span key={key} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground">{key.replace(/([A-Z])/g, ' $1')}:</span>{' '}
          {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
        </span>
      ))}
    </div>
  );
}

function SystemHealthPanel() {
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');

  const rows = useMemo(() => health?.rows || [], [health?.rows]);

  const summary = useMemo(() => rows.reduce((acc, row) => {
    acc.total += 1;
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, { total: 0 }), [rows]);

  const loadHealth = async () => {
    setLoading(true);
    setError('');
    const res = await appClient.functions.invoke('systemHealth', {}, { cache: false });
    if (res.data?.error) {
      setError(res.data.error);
    } else {
      setHealth(res.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadHealth();
  }, []);

  return (
    <SettingsPanel
      icon={Activity}
      title="System Health"
      description="Live status of server-side APIs, the shared email sender, external tools, and token expiry notes."
      meta={health?.generatedAt ? `Last checked ${formatHealthDate(health.generatedAt)}` : null}
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid gap-2 sm:grid-cols-5">
          {[
            ['Total', summary.total, 'border-slate-200 bg-slate-50 text-slate-700'],
            ['Online', summary.online || 0, STATUS_META.online.className],
            ['Warning', summary.warning || 0, STATUS_META.warning.className],
            ['Error', summary.error || 0, STATUS_META.error.className],
            ['Not Configured', summary.not_configured || 0, STATUS_META.not_configured.className],
          ].map(([label, value, className]) => (
            <div key={label} className={`rounded-lg border px-3 py-2 ${className}`}>
              <div className="text-[11px] font-semibold uppercase tracking-wide">{label}</div>
              <div className="text-lg font-bold">{value}</div>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" onClick={loadHealth} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh Health
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !rows.length ? (
        <StateBlock icon={Loader2} title="Checking system health" description="Testing configured APIs and external services." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="max-h-[62vh] overflow-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Service</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Scope</th>
                  <th className="px-3 py-2 font-semibold">Auth</th>
                  <th className="px-3 py-2 font-semibold">Token Expiry</th>
                  <th className="px-3 py-2 text-right font-semibold">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {rows.map((row) => {
                  const expiry = row.details?.accessTokenExpiresAt || row.tokenExpiry;
                  return (
                    <tr key={row.id} className="align-top hover:bg-muted/40">
                      <td className="max-w-md px-3 py-3">
                        <div className="flex items-start gap-2">
                          <Server className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="font-semibold text-foreground">{row.name}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">{row.category} · {row.provider}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{row.purpose}</div>
                            {row.endpoint && <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{row.endpoint}</div>}
                            {row.error && <div className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{row.error}</div>}
                            {row.missingEnv?.length ? (
                              <div className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
                                Missing: {row.missingEnv.join(', ')}
                              </div>
                            ) : null}
                            <KeyValueList items={row.details} />
                            {row.notes?.length ? (
                              <div className="mt-2 space-y-1">
                                {row.notes.map((note) => (
                                  <div key={note} className="text-[11px] text-muted-foreground">{note}</div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3"><StatusBadge status={row.status} /></td>
                      <td className="px-3 py-3 text-xs capitalize text-muted-foreground">{row.scope || 'server'}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{row.authType || '—'}</td>
                      <td className="max-w-xs px-3 py-3 text-xs text-muted-foreground">{formatHealthDate(expiry)}</td>
                      <td className="px-3 py-3 text-right text-xs text-muted-foreground">
                        {row.latencyMs != null ? `${row.latencyMs} ms` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SettingsPanel>
  );
}

export default function SettingsPage() {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exchangeRateSettings, setExchangeRateSettings] = useState(readExchangeRateSettings);
  const [documentSettings, setDocumentSettings] = useState(readDocumentSettings);
  const [baseSettings, setBaseSettings] = useState(settingsSnapshot);
  const [draftRestoredAt, setDraftRestoredAt] = useState(null);
  const [activeTab, setActiveTab] = useState(() => validSettingsTab(localStorage.getItem(SETTINGS_TAB_KEY)));

  useEffect(() => {
    const base = settingsSnapshot();
    const draft = readDraft(SETTINGS_DRAFT_KEY);
    const next = draft?.data && !sameDraftValue(draft.data, base)
      ? { ...base, ...draft.data }
      : base;
    setExchangeRateSettings(next.exchangeRateSettings || base.exchangeRateSettings);
    setDocumentSettings(next.documentSettings || base.documentSettings);
    setBaseSettings(base);
    setDraftRestoredAt(draft?.data && !sameDraftValue(next, base) ? draft.updatedAt : null);
  }, []);

  const settingsDraftValue = useMemo(() => ({
    exchangeRateSettings,
    documentSettings,
  }), [documentSettings, exchangeRateSettings]);
  const settingsDirty = Boolean(baseSettings && !sameDraftValue(settingsDraftValue, baseSettings));
  useDraftAutosave(SETTINGS_DRAFT_KEY, settingsDraftValue, {
    enabled: true,
    dirty: settingsDirty,
    message: 'Autosaved Settings draft. Save or discard it before leaving.',
  });

  const changeTab = (tab) => {
    const next = validSettingsTab(tab);
    setActiveTab(next);
    localStorage.setItem(SETTINGS_TAB_KEY, next);
  };

  const saveAll = async () => {
    setSaving(true);
    saveExchangeRateSettings(exchangeRateSettings);
    saveDocumentSettings(documentSettings);
    const savedValue = {
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
      setExchangeRateSettings(baseSettings.exchangeRateSettings || readExchangeRateSettings());
      setDocumentSettings(baseSettings.documentSettings || readDocumentSettings());
    }
    setDraftRestoredAt(null);
  };

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
        eyebrow="Admin"
        title="Settings"
        description="Configure email senders, exchange rates, and STEM document behavior."
        actions={(
          <Button onClick={saveAll} disabled={saving} className="gap-2">
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

        <TabsContent value="email" className="mt-0">
          <SettingsPanel
            icon={Mail}
            title="Shared Email Sender"
            description="All internal reports, late-interest requests, and external payment reminders use one centrally managed server mailbox."
          >
            <div className="flex items-start gap-3 py-2">
              <Server className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <h3 className="text-sm font-semibold text-foreground">Central SMTP sender</h3>
                <p className="mt-1 text-sm text-muted-foreground">Every user sends through the same mailbox and sender identity.</p>
                <p className="mt-1 text-xs text-muted-foreground">Credentials are stored only in Vercel. Connection status is available in System Health.</p>
              </div>
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

        <TabsContent value="health" className="mt-0">
          <SystemHealthPanel />
        </TabsContent>
      </Tabs>

      <div className="mt-4 flex justify-end rounded-xl border border-border bg-card/70 p-3">
        <Button onClick={saveAll} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
          {saved ? 'Saved!' : 'Save All Settings'}
        </Button>
      </div>
    </div>
  );
}
