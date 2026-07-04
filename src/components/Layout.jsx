import { useEffect, useState } from 'react';
import { Outlet, Link, NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, FileBarChart2, Database, PanelLeftClose, PanelLeftOpen, Settings, TrendingUp, DollarSign, ClipboardCheck, ReceiptText, AlertTriangle, ListFilter, ShieldCheck, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';

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
  { to: '/buyer-invoices', label: 'Outstanding Buyer Invoices', icon: ReceiptText, moduleId: 'buyer_invoices' },
  { to: '/reports', label: 'Report Builder', icon: FileBarChart2, moduleId: 'reports' },
  { to: '/pnl', label: 'Stem P&L', icon: TrendingUp, moduleId: 'pnl' },
  { to: '/brokers', label: "Broker's Commission", icon: DollarSign, moduleId: 'brokers' },
  { to: '/explorer', label: 'Data Explorer', icon: Database, moduleId: 'explorer' },
  { to: '/settings', label: 'Settings', icon: Settings, moduleId: 'settings' },
  { to: '/admin', label: 'Admin Control', icon: ShieldCheck, moduleId: 'admin' },
];

export default function Layout() {
  const location = useLocation();
  const { user, logout, hasModuleAccess, authMode } = useAuth();
  const [collapsed, setCollapsed] = useState(true);
  const [density, setDensity] = useState(() => localStorage.getItem('table-density') || 'compact');
  const [dirtyState, setDirtyState] = useState({ dirty: false, message: '' });

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

  return (
    <div className="app-shell flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className={cn('glass-sidebar flex flex-col shrink-0 transition-all duration-200', collapsed ? 'w-14' : 'w-60')}>
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
        <nav className="flex-1 px-2 py-4 space-y-0.5">
          {navItems.filter((item) => hasModuleAccess(item.moduleId)).map(({ to, label, icon: Icon, children }) => {
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
        <Outlet />
      </main>
    </div>
  );
}
