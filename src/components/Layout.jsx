import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, PanelLeftClose, PanelLeftOpen, Settings, TrendingUp, DollarSign, ClipboardCheck, ReceiptText, AlertTriangle, ListFilter, ShieldCheck, LogOut, History, RefreshCw, FileCheck2, Banknote, WalletCards } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { APP_VERSION, APP_VERSION_HISTORY } from '@/lib/appVersion';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const navItems = [
  {
    to: '/',
    label: 'Dashboard',
    moduleId: 'dashboard',
    icon: LayoutDashboard,
    children: [
      { to: '/#filtered-stems', label: 'Filtered STEMs', icon: ListFilter, hash: '#filtered-stems' },
    ],
  },
  { to: '/review', label: 'Exception Review', icon: ClipboardCheck, moduleId: 'review' },
  { to: '/disputes', label: 'Dispute Management', icon: AlertTriangle, moduleId: 'disputes' },
  { to: '/disputes-beta', label: 'Dispute Beta', icon: FileCheck2, moduleId: 'disputes' },
  { to: '/buyer-invoices', label: 'Outstanding Buyer Invoices', icon: ReceiptText, moduleId: 'buyer_invoices' },
  { to: '/incoming-payments', label: 'Incoming Payment', icon: Banknote, moduleId: 'incoming_payments' },
  { to: '/cashflow-forecast', label: 'Cashflow Forecast', icon: WalletCards, moduleId: 'cashflow_forecast' },
  { to: '/pnl', label: 'Dashboard and Qlik Validator Tool', icon: TrendingUp, moduleId: 'pnl' },
  { to: '/brokers', label: "Broker's Commission", icon: DollarSign, moduleId: 'brokers' },
  { to: '/report-archive', label: 'Reports Archive', icon: History, moduleId: 'report_archive' },
  { to: '/settings', label: 'Settings', icon: Settings, moduleId: 'settings' },
  { to: '/admin', label: 'Admin Control', icon: ShieldCheck, moduleId: 'admin' },
];
const VERSION_CHECK_INTERVAL_MS = 60_000;

export default function Layout() {
  const location = useLocation();
  const { user, logout, hasModuleAccess, authMode } = useAuth();
  const [collapsed, setCollapsed] = useState(true);
  const [dockHoverIndex, setDockHoverIndex] = useState(null);
  const [density, setDensity] = useState(() => localStorage.getItem('table-density') || 'compact');
  const [dirtyState, setDirtyState] = useState({ dirty: false, message: '' });
  const [versionOpen, setVersionOpen] = useState(false);
  const [versionUpdate, setVersionUpdate] = useState(null);
  const currentBuildIdRef = useRef(null);

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
    if (!location.hash) return undefined;
    const targetId = decodeURIComponent(location.hash.slice(1));
    const timeout = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(timeout);
  }, [location.hash, location.pathname]);

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
        if (latestBuildId !== currentBuildIdRef.current) {
          setVersionUpdate(latest);
        }
      } catch {
        // Version checks must never interrupt normal app usage.
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
  const scrollToHashTarget = (to) => {
    const [, hash] = String(to).split('#');
    if (!hash) return;
    window.setTimeout(() => {
      document.getElementById(decodeURIComponent(hash))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };
  const handleSidebarNavigation = (event, to) => {
    const [pathname = '/'] = String(to).split('#');
    const targetPathname = pathname || '/';
    const samePage = targetPathname === location.pathname;
    if (samePage || !unsaved) {
      scrollToHashTarget(to);
      return;
    }
    const leave = window.confirm(`${unsaved.message || 'You have unsaved changes.'}\n\nChoose Cancel to stay and save changes, or OK to leave without saving.`);
    if (!leave) event.preventDefault();
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
  const accessibleNavItems = navItems.filter((item) => hasModuleAccess(item.moduleId));
  const collapsedNavEntries = accessibleNavItems.flatMap((item) => {
    const parentEntry = {
      key: item.to,
      to: item.to,
      label: item.label,
      Icon: item.icon,
      isChild: false,
      isActive: item.to === '/'
        ? location.pathname === '/' && !location.hash
        : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`),
    };
    const childEntries = item.children?.length && location.pathname === item.to
      ? item.children.map((child) => ({
        key: child.to,
        to: child.to,
        label: child.label,
        Icon: child.icon,
        isChild: true,
        isActive: location.pathname === item.to && location.hash === child.hash,
      }))
      : [];
    return [parentEntry, ...childEntries];
  });
  const dockScale = (index) => {
    if (!collapsed || dockHoverIndex == null) return 1;
    const distance = Math.abs(index - dockHoverIndex);
    if (distance === 0) return 1.38;
    if (distance === 1) return 1.18;
    if (distance === 2) return 1.07;
    return 1;
  };
  const dockTranslate = (scale) => (scale > 1 ? Math.round((scale - 1) * 18) : 0);

  return (
    <div className="app-shell flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className={cn('glass-sidebar relative z-50 flex flex-col shrink-0 overflow-visible transition-all duration-200', collapsed ? 'w-16' : 'w-60')}>
        {/* Logo + collapse button */}
        <div className={cn('flex items-center border-b border-sidebar-border', collapsed ? 'px-2 py-4 justify-center' : 'px-5 py-5 justify-between')}>
          {!collapsed && (
            <div>
              <div className="text-sm font-semibold text-sidebar-foreground font-dm">FCBHK</div>
              <div className="text-xs text-sidebar-foreground/50">Salesforce Extension</div>
            </div>
          )}
          <button
            onClick={() => {
              if (!confirmLeaveWithUnsavedChanges()) return;
              setCollapsed(c => !c);
            }}
            className="text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Nav */}
        {collapsed ? (
          <nav
            className="flex-1 overflow-visible px-2 py-4"
            onMouseLeave={() => setDockHoverIndex(null)}
            aria-label="Collapsed navigation"
          >
            <div className="flex flex-col items-center gap-2 overflow-visible">
              {collapsedNavEntries.map(({ key, to, label, Icon, isActive, isChild }, index) => {
                const scale = dockScale(index);
                return (
                  <Link
                    key={key}
                    to={to}
                    title={label}
                    aria-label={label}
                    onMouseEnter={() => setDockHoverIndex(index)}
                    onFocus={() => setDockHoverIndex(index)}
                    onBlur={() => setDockHoverIndex(null)}
                    onClick={(event) => handleSidebarNavigation(event, to)}
                    className="group/dock relative flex h-11 w-11 items-center justify-center overflow-visible rounded-2xl outline-none"
                    style={{
                      transform: `translateX(${dockTranslate(scale)}px) scale(${scale})`,
                      transformOrigin: 'left center',
                      transition: 'transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1)',
                      zIndex: Math.round(scale * 100),
                    }}
                  >
                    <span
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-2xl border shadow-sm transition-colors duration-150',
                        isChild ? 'h-8 w-8 rounded-xl' : '',
                        isActive
                          ? 'border-white/20 bg-white/15 text-sidebar-primary ring-1 ring-white/15'
                          : 'border-white/10 bg-white/5 text-sidebar-foreground/70 group-hover/dock:border-white/20 group-hover/dock:bg-white/12 group-hover/dock:text-sidebar-foreground'
                      )}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', isChild && 'h-3.5 w-3.5')} />
                    </span>
                    <span className="pointer-events-none absolute left-[calc(100%+14px)] top-1/2 z-[999] -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-lg border border-white/10 bg-slate-950/95 px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-xl backdrop-blur transition-all duration-150 group-hover/dock:translate-x-0 group-hover/dock:opacity-100 group-focus-visible/dock:translate-x-0 group-focus-visible/dock:opacity-100">
                      {label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </nav>
        ) : (
          <nav className="flex-1 px-2 py-4 space-y-0.5">
            {accessibleNavItems.map(({ to, label, icon: Icon, children }) => {
            const showChildren = children?.length && location.pathname === to;
            return (
              <div key={to} className="space-y-0.5">
                <NavLink
                  to={to}
                  end={to === '/'}
                  title={collapsed ? label : undefined}
                  onClick={(event) => handleSidebarNavigation(event, to)}
                  className={({ isActive }) => cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                    collapsed ? 'justify-center px-2' : '',
                    isActive
                      ? 'bg-white/10 text-sidebar-primary shadow-sm ring-1 ring-white/10'
                      : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {!collapsed && label}
                </NavLink>
                {showChildren && (
                  <div className={cn('space-y-0.5', collapsed ? 'pt-0.5' : 'ml-5 border-l border-sidebar-border/70 pl-2')}>
                    {children.map(({ to: childTo, label: childLabel, icon: ChildIcon, hash }) => {
                      const isActive = location.pathname === '/' && location.hash === hash;
                      return (
                        <Link
                          key={childTo}
                          to={childTo}
                          title={collapsed ? childLabel : undefined}
                          onClick={(event) => handleSidebarNavigation(event, childTo)}
                          className={cn(
                            'flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition-all duration-150',
                            collapsed ? 'justify-center px-2' : '',
                            isActive
                              ? 'bg-white/10 text-sidebar-primary shadow-sm ring-1 ring-white/10'
                              : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                          )}
                        >
                          <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                          {!collapsed && childLabel}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
            })}
          </nav>
        )}

        {/* Footer */}
        <div className={cn('py-4 border-t border-sidebar-border space-y-3', collapsed ? 'flex flex-col items-center px-2' : 'px-4')}>
          {!collapsed && user && (
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div className="truncate text-xs font-semibold text-sidebar-foreground">{user.full_name || user.email}</div>
              <div className="truncate text-[11px] text-sidebar-foreground/45">{user.email}</div>
              {authMode === 'local' && <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">Local admin mode</div>}
            </div>
          )}
          <button
            onClick={() => {
              if (!confirmLeaveWithUnsavedChanges()) return;
              setDensity(d => d === 'compact' ? 'comfort' : 'compact');
            }}
            className={cn(
              'rounded-md border border-white/10 bg-white/5 text-xs font-medium text-sidebar-foreground/70 shadow-sm transition-colors hover:bg-white/10 hover:text-sidebar-foreground',
              collapsed ? 'w-8 h-8' : 'w-full px-3 py-2'
            )}
            title={`Table view: ${density === 'compact' ? 'Compact' : 'Comfort'}`}
          >
            {collapsed ? (density === 'compact' ? 'C' : 'Co') : `${density === 'compact' ? 'Compact' : 'Comfort'} view`}
          </button>
          <button
            type="button"
            onClick={() => setVersionOpen(true)}
            className={cn(
              'rounded-md border border-white/10 bg-white/5 font-semibold text-sidebar-foreground/70 shadow-sm transition-colors hover:bg-white/10 hover:text-sidebar-foreground',
              collapsed ? 'h-8 w-10 px-0 text-[9px]' : 'w-full px-3 py-2 text-xs'
            )}
            title={`Version ${APP_VERSION}`}
          >
            {APP_VERSION}
          </button>
          <button
            onClick={() => {
              if (!confirmLeaveWithUnsavedChanges()) return;
              logout();
            }}
            className={cn(
              'rounded-md border border-white/10 bg-white/5 text-xs font-medium text-sidebar-foreground/70 shadow-sm transition-colors hover:bg-white/10 hover:text-sidebar-foreground',
              collapsed ? 'w-8 h-8 flex items-center justify-center' : 'w-full px-3 py-2 flex items-center justify-center gap-2'
            )}
            title="Sign out"
          >
            {collapsed ? <LogOut className="h-3.5 w-3.5" /> : <><LogOut className="h-3.5 w-3.5" /> Sign out</>}
          </button>
          {collapsed ? (
            <span className="inline-block w-2 h-2 rounded-full bg-green-400" title="Connected to Salesforce" />
          ) : (
            <div className="text-xs text-sidebar-foreground/40">
              Connected to Salesforce
              <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-green-400 align-middle" />
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {versionUpdate && (
          <div className="sticky top-0 z-40 border-b border-amber-200 bg-amber-50 px-4 py-2 text-amber-950 shadow-sm">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-semibold">New version available</span>
                <span className="ml-2 text-amber-800">
                  Version {versionUpdate.version || APP_VERSION} is ready. Refresh to load the latest app.
                </span>
              </div>
              <Button size="sm" onClick={updateToLatestVersion} className="gap-2 bg-amber-600 text-white hover:bg-amber-700">
                <RefreshCw className="h-3.5 w-3.5" />
                Update Now
              </Button>
            </div>
          </div>
        )}
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
              Current version {APP_VERSION}. This log records released app changes.
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
