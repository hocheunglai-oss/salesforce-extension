import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
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
  UsersRound,
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
      { to: '/', label: 'Dashboard', moduleId: 'dashboard', icon: LayoutDashboard },
      { to: '/buyer-invoices', label: 'Buyer Invoices', moduleId: 'buyer_invoices', icon: ReceiptText },
      { to: '/incoming-payments', label: 'Incoming Payments', moduleId: 'incoming_payments', icon: Banknote },
      { to: '/cashflow-forecast', label: 'Cashflow', moduleId: 'cashflow_forecast', icon: WalletCards },
    ],
  },
  {
    label: 'Review',
    items: [
      { to: '/review', label: 'Exception Review', moduleId: 'review', icon: ClipboardCheck },
      { to: '/disputes', label: 'Dispute Workflow', moduleId: 'disputes', icon: FileCheck2 },
      { to: '/pnl', label: 'Qlik Validator', moduleId: 'pnl', icon: TrendingUp },
      { to: '/brokers', label: 'Broker Commissions', moduleId: 'brokers', icon: DollarSign },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/report-archive', label: 'Report Archive', moduleId: 'report_archive', icon: History },
      { to: '/account-managers', label: 'Account Managers', moduleId: 'buyers_administrator', icon: UsersRound },
      { to: '/settings', label: 'Settings', moduleId: 'settings', icon: Settings },
      { to: '/audit-trail', label: 'Audit Trail', moduleId: 'admin', icon: History },
      { to: '/admin', label: 'Admin Control', moduleId: 'admin', icon: ShieldCheck },
    ],
  },
];

const VERSION_CHECK_INTERVAL_MS = 60_000;
const SIDEBAR_FIXED_STORAGE_KEY = 'workspace-sidebar-fixed';
const LEGACY_SIDEBAR_HIDDEN_STORAGE_KEY = 'workspace-sidebar-hidden';

export default function Layout() {
  const location = useLocation();
  const { user, logout, hasModuleAccess, authMode } = useAuth();
  const [density, setDensity] = useState(() => localStorage.getItem('table-density') || 'compact');
  const [dirtyState, setDirtyState] = useState({ dirty: false, message: '' });
  const [versionOpen, setVersionOpen] = useState(false);
  const [versionUpdate, setVersionUpdate] = useState(null);
  const [sidebarFixed, setSidebarFixed] = useState(() => localStorage.getItem(SIDEBAR_FIXED_STORAGE_KEY) === 'true');
  const currentBuildIdRef = useRef(null);

  const accessibleGroups = useMemo(() => (
    navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => hasModuleAccess(item.moduleId)),
      }))
      .filter((group) => group.items.length > 0)
  ), [hasModuleAccess]);

  const pageOwnsScroll = location.pathname === '/disputes'
    || location.pathname.startsWith('/disputes/');

  useEffect(() => {
    document.documentElement.dataset.density = density;
    localStorage.setItem('table-density', density);
  }, [density]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_FIXED_STORAGE_KEY, String(sidebarFixed));
    localStorage.removeItem(LEGACY_SIDEBAR_HIDDEN_STORAGE_KEY);
  }, [sidebarFixed]);

  useEffect(() => {
    const onDirtyState = (event) => {
      setDirtyState((prev) => ({
        ...prev,
        [event.detail?.key || 'default']: event.detail || {},
      }));
    };
    window.addEventListener('fcos:dirty-state', onDirtyState);
    return () => window.removeEventListener('fcos:dirty-state', onDirtyState);
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
    <div className="app-workspace-shell relative flex h-screen overflow-hidden">
      <Button
        type="button"
        variant="outline"
        size="icon"
        data-testid="toggle-fixed-sidebar"
        className={cn(
          'top-3 z-[60] h-8 w-7 rounded-md bg-white p-0 shadow-sm transition-[left] duration-200 ease-out',
          sidebarFixed
            ? 'absolute left-[240px]'
            : 'fixed left-0 rounded-l-none border-l-0',
        )}
        onClick={() => setSidebarFixed((fixed) => !fixed)}
        aria-label={sidebarFixed ? 'Use auto-hide sidebar' : 'Keep sidebar open'}
        title={sidebarFixed ? 'Use auto-hide sidebar' : 'Keep sidebar open'}
      >
        {sidebarFixed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </Button>

      <aside
        className={cn(
          'app-workspace-sidebar fixed inset-y-0 left-0 z-50 flex w-[272px] shrink-0 flex-col border-r border-slate-200 bg-white transition-transform duration-200 ease-out',
          sidebarFixed
            ? 'translate-x-0 shadow-xl shadow-slate-900/10 md:relative md:shadow-none'
            : '-translate-x-[260px] shadow-xl shadow-slate-900/10 hover:translate-x-0 focus-within:translate-x-0',
        )}
      >
        <div className={cn(
          'border-b border-slate-200 py-4',
          sidebarFixed ? 'pl-5 pr-12' : 'pl-10 pr-5',
        )}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-950">FCOS</div>
              <div className="truncate text-xs font-medium text-emerald-700">Salesforce connected</div>
            </div>
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
                    end={to === '/'}
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

      <main className={cn('min-w-0 flex-1 bg-slate-50', pageOwnsScroll ? 'flex h-screen flex-col overflow-hidden' : 'overflow-auto')}>
        {versionUpdate && (
          <div className="sticky top-0 z-40 shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-amber-950 shadow-sm">
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
        <div className={cn(pageOwnsScroll && 'min-h-0 flex-1 overflow-hidden')}>
          <Outlet />
        </div>
      </main>

      <Dialog open={versionOpen} onOpenChange={setVersionOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Version Audit Trail
            </DialogTitle>
            <DialogDescription>
              Current release {APP_VERSION}. This audit trail records released app changes.
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
