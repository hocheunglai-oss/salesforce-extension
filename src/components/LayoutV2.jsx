import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  Banknote,
  ClipboardCheck,
  DollarSign,
  FileCheck2,
  History,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  RefreshCw,
  Settings,
  ShieldCheck,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { APP_VERSION, APP_VERSION_HISTORY } from '@/lib/appVersion';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const navGroups = [
  {
    label: 'Daily Work',
    items: [
      { to: '/v2', label: 'Dashboard', moduleId: 'dashboard', icon: LayoutDashboard },
      { to: '/v2/buyer-invoices', label: 'Buyer Invoices', moduleId: 'buyer_invoices', icon: ReceiptText },
      { to: '/v2/incoming-payments', label: 'Incoming Payments', moduleId: 'incoming_payments', icon: Banknote },
      { to: '/v2/cashflow-forecast', label: 'Cashflow', moduleId: 'cashflow_forecast', icon: WalletCards },
    ],
  },
  {
    label: 'Review',
    items: [
      { to: '/v2/review', label: 'Exception Review', moduleId: 'review', icon: ClipboardCheck },
      { to: '/v2/disputes', label: 'Disputes', moduleId: 'disputes', icon: AlertTriangle },
      { to: '/v2/disputes-beta', label: 'Dispute Workflow', moduleId: 'disputes', icon: FileCheck2 },
      { to: '/v2/pnl', label: 'Qlik Validator', moduleId: 'pnl', icon: TrendingUp },
      { to: '/v2/brokers', label: 'Broker Commissions', moduleId: 'brokers', icon: DollarSign },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/v2/report-archive', label: 'Report Archive', moduleId: 'report_archive', icon: History },
      { to: '/v2/settings', label: 'Settings', moduleId: 'settings', icon: Settings },
      { to: '/v2/audit-trail', label: 'Audit Trail', moduleId: 'admin', icon: History },
      { to: '/v2/admin', label: 'Admin Control', moduleId: 'admin', icon: ShieldCheck },
    ],
  },
];

const VERSION_CHECK_INTERVAL_MS = 60_000;

function toV1Path(location) {
  const pathname = location.pathname.replace(/^\/v2/, '') || '/';
  return `${pathname}${location.search}${location.hash}`;
}

export default function LayoutV2() {
  const location = useLocation();
  const { user, logout, hasModuleAccess, authMode } = useAuth();
  const [density, setDensity] = useState(() => localStorage.getItem('table-density') || 'compact');
  const [dirtyState, setDirtyState] = useState({ dirty: false, message: '' });
  const [versionOpen, setVersionOpen] = useState(false);
  const [versionUpdate, setVersionUpdate] = useState(null);
  const currentBuildIdRef = useRef(null);

  const accessibleGroups = useMemo(() => (
    navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => hasModuleAccess(item.moduleId)),
      }))
      .filter((group) => group.items.length > 0)
  ), [hasModuleAccess]);

  const activeItem = useMemo(() => {
    const allItems = accessibleGroups.flatMap((group) => group.items);
    return allItems
      .slice()
      .sort((a, b) => b.to.length - a.to.length)
      .find((item) => item.to === '/v2'
        ? location.pathname === '/v2'
        : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));
  }, [accessibleGroups, location.pathname]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    localStorage.setItem('table-density', density);
  }, [density]);

  useEffect(() => {
    const onDirtyState = (event) => {
      setDirtyState((prev) => ({
        ...prev,
        [event.detail?.key || 'default']: event.detail || {},
      }));
    };
    window.addEventListener('salesforce-extension:dirty-state', onDirtyState);
    return () => window.removeEventListener('salesforce-extension:dirty-state', onDirtyState);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkVersion = async () => {
      try {
        const response = await fetch(`/app-version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const latest = await response.json();
        const latestBuildId = latest?.buildId || latest?.commit || latest?.version;
        if (!latestBuildId || cancelled) return;
        if (!currentBuildIdRef.current) {
          currentBuildIdRef.current = latestBuildId;
          return;
        }
        if (latestBuildId !== currentBuildIdRef.current) setVersionUpdate(latest);
      } catch {
        // Background version checks must not interrupt work.
      }
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') checkVersion();
    };

    checkVersion();
    const interval = window.setInterval(checkVersion, VERSION_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', checkWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', checkWhenVisible);
    };
  }, []);

  const unsaved = Object.values(dirtyState).find((state) => state?.dirty);
  const confirmLeaveWithUnsavedChanges = () => {
    if (!unsaved) return true;
    return window.confirm(`${unsaved.message || 'You have unsaved changes.'}\n\nChoose Cancel to stay and save changes, or OK to leave without saving.`);
  };
  const handleNavigation = (event) => {
    if (!unsaved) return;
    if (!confirmLeaveWithUnsavedChanges()) event.preventDefault();
  };
  const updateToLatestVersion = async () => {
    if (!confirmLeaveWithUnsavedChanges()) return;
    try {
      if ('caches' in window) {
        const cacheNames = await window.caches.keys();
        await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
      }
    } finally {
      window.location.reload();
    }
  };

  return (
    <div className="v2-shell flex h-screen overflow-hidden">
      <aside className="v2-sidebar flex w-[272px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-950">FCBHK v2</div>
              <div className="truncate text-xs text-slate-500">Salesforce Analytics Hub</div>
            </div>
            <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-700">
              V2
            </span>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-5 overflow-auto px-3 py-4">
          {accessibleGroups.map((group) => (
            <section key={group.label}>
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/v2'}
                    onClick={handleNavigation}
                    className={({ isActive }) => cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{label}</span>
                  </NavLink>
                ))}
              </div>
            </section>
          ))}
        </nav>

        <div className="space-y-3 border-t border-slate-200 p-3">
          {user && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="truncate text-xs font-semibold text-slate-900">{user.full_name || user.email}</div>
              <div className="truncate text-[11px] text-slate-500">{user.email}</div>
              {authMode === 'local' && <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600">Local admin mode</div>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" onClick={() => setDensity((value) => value === 'compact' ? 'comfort' : 'compact')}>
              {density === 'compact' ? 'Compact' : 'Comfort'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setVersionOpen(true)}>
              {APP_VERSION}
            </Button>
          </div>
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link to={toV1Path(location)} onClick={handleNavigation}>Open v1</Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              if (!confirmLeaveWithUnsavedChanges()) return;
              logout();
            }}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto bg-slate-50">
        {versionUpdate && (
          <div className="sticky top-0 z-40 border-b border-amber-200 bg-amber-50 px-4 py-2 text-amber-950 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-semibold">New version available</span>
                <span className="ml-2 text-amber-800">Version {versionUpdate.version || APP_VERSION} is ready.</span>
              </div>
              <Button size="sm" onClick={updateToLatestVersion} className="gap-2 bg-amber-600 text-white hover:bg-amber-700">
                <RefreshCw className="h-3.5 w-3.5" />
                Update Now
              </Button>
            </div>
          </div>
        )}
        <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-5 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Version 2 Workspace</div>
              <div className="truncate text-sm font-semibold text-slate-900">{activeItem?.label || 'Workspace'}</div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="hidden rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 font-medium text-emerald-700 md:inline">
                Salesforce connected
              </span>
              <Button asChild variant="outline" size="sm">
                <Link to={toV1Path(location)} onClick={handleNavigation}>v1</Link>
              </Button>
            </div>
          </div>
        </div>
        <Outlet />
      </main>

      <Dialog open={versionOpen} onOpenChange={setVersionOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Version Audit Trail
            </DialogTitle>
            <DialogDescription>
              Current release {APP_VERSION}. v2 is a separate workspace shell using the same data and calculations.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[62vh] space-y-4 overflow-auto pr-1">
            {APP_VERSION_HISTORY.map((entry) => (
              <section key={entry.version} className="rounded-lg border border-border bg-card/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Version {entry.version}</div>
                    <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{entry.title}</div>
                  </div>
                  <div className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground">
                    {entry.releasedAt}
                  </div>
                </div>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {entry.changes.map((change) => (
                    <li key={change} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{change}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
