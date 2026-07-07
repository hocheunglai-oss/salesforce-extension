export const USER_TYPES = [
  { id: 'administrator', label: 'Administrator' },
  { id: 'manager', label: 'Manager' },
  { id: 'finance', label: 'Finance' },
  { id: 'operations', label: 'Operations' },
  { id: 'viewer', label: 'Viewer' },
];

export const APP_MODULES = [
  { id: 'dashboard', label: 'Dashboard', path: '/', sortOrder: 10 },
  { id: 'review', label: 'Exception Review', path: '/review', sortOrder: 20 },
  { id: 'disputes', label: 'Dispute Management', path: '/disputes', sortOrder: 30 },
  { id: 'buyer_invoices', label: 'Outstanding Buyer Invoices', path: '/buyer-invoices', sortOrder: 40 },
  { id: 'reports', label: 'Report Builder', path: '/reports', sortOrder: 50 },
  { id: 'pnl', label: 'Stem P&L', path: '/pnl', sortOrder: 60 },
  { id: 'brokers', label: "Broker's Commission", path: '/brokers', sortOrder: 70 },
  { id: 'report_archive', label: 'Reports Archive', path: '/report-archive', sortOrder: 75 },
  { id: 'explorer', label: 'Data Explorer', path: '/explorer', sortOrder: 80 },
  { id: 'settings', label: 'Settings', path: '/settings', sortOrder: 90 },
  { id: 'admin', label: 'Admin Control', path: '/admin', sortOrder: 100 },
];

export const FULL_ACCESS = Object.fromEntries(APP_MODULES.map((module) => [module.id, true]));

export function moduleLabel(moduleId) {
  return APP_MODULES.find((module) => module.id === moduleId)?.label || moduleId;
}
