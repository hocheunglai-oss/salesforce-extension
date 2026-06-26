import { useEffect, useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, FileBarChart2, Database, PanelLeftClose, PanelLeftOpen, Settings, TrendingUp, DollarSign, ClipboardCheck, ReceiptText, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/review', label: 'Exception Review', icon: ClipboardCheck },
  { to: '/disputes', label: 'Dispute Management', icon: AlertTriangle },
  { to: '/buyer-invoices', label: 'Outstanding Buyer Invoices', icon: ReceiptText },
  { to: '/reports', label: 'Report Builder', icon: FileBarChart2 },
  { to: '/pnl', label: 'Stem P&L', icon: TrendingUp },
  { to: '/brokers', label: "Broker's Commission", icon: DollarSign },
  { to: '/explorer', label: 'Data Explorer', icon: Database },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout() {
  const [collapsed, setCollapsed] = useState(true);
  const [density, setDensity] = useState(() => localStorage.getItem('table-density') || 'compact');

  useEffect(() => {
    document.documentElement.dataset.density = density;
    localStorage.setItem('table-density', density);
  }, [density]);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className={cn('bg-sidebar flex flex-col shrink-0 transition-all duration-200', collapsed ? 'w-14' : 'w-60')}>
        {/* Logo + collapse button */}
        <div className={cn('flex items-center border-b border-sidebar-border', collapsed ? 'px-2 py-4 justify-center' : 'px-5 py-5 justify-between')}>
          {!collapsed && (
            <div>
              <div className="text-sm font-semibold text-sidebar-foreground font-dm">FCBHK</div>
              <div className="text-xs text-sidebar-foreground/50">Salesforce Extension</div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              title={collapsed ? label : undefined}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                collapsed ? 'justify-center px-2' : '',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-primary'
                  : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!collapsed && label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className={cn('py-4 border-t border-sidebar-border space-y-3', collapsed ? 'flex flex-col items-center px-2' : 'px-4')}>
          <button
            onClick={() => setDensity(d => d === 'compact' ? 'comfort' : 'compact')}
            className={cn(
              'rounded-md border border-sidebar-border text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors',
              collapsed ? 'w-8 h-8' : 'w-full px-3 py-2'
            )}
            title={`Table view: ${density === 'compact' ? 'Compact' : 'Comfort'}`}
          >
            {collapsed ? (density === 'compact' ? 'C' : 'Co') : `${density === 'compact' ? 'Compact' : 'Comfort'} view`}
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
