const V2_PAGE_COPY = {
  Dashboard: {
    eyebrow: 'Review',
    title: 'Dashboard',
    description: 'Filter STEMs, review KPIs, and inspect records.',
  },
  'Outstanding Buyer Invoices': {
    eyebrow: 'Collection',
    title: 'Buyer Invoices',
    description: 'Track overdue and due buyer invoices.',
  },
  'Incoming Payment': {
    eyebrow: 'Receipts',
    title: 'Incoming Payments',
    description: 'Review buyer receipts, supplier refunds, and CIA invoices.',
  },
  'Cashflow Forecast': {
    eyebrow: 'Forecast',
    title: 'Cashflow',
    description: 'Forecast buyer receipts and supplier payments.',
  },
  "Broker's Commission": {
    eyebrow: 'Commissions',
    title: 'Broker Commissions',
    description: 'Review broker commission rows, summaries, and XLS exports.',
  },
  'Dispute Management': {
    eyebrow: 'Disputes',
    title: 'Dispute Management',
    description: 'Track disputed STEMs and supporting documents.',
  },
  'Dispute Beta': {
    eyebrow: 'Disputes',
    title: 'Dispute Workflow',
    description: 'Manage trader actions, approvals, and settlement P&L.',
  },
  'Exception Review': {
    eyebrow: 'Review',
    title: 'Exception Review',
    description: 'Find STEMs that need finance or reporting checks.',
  },
  'Dashboard and Qlik Validator Tool': {
    eyebrow: 'Validation',
    title: 'Qlik Validator',
    description: 'Compare dashboard calculations with Qlik reference values.',
  },
  'Reports Archive': {
    eyebrow: 'Reports',
    title: 'Report Archive',
    description: 'Find exported XLS reports and audit file actions.',
  },
  Settings: {
    eyebrow: 'System',
    title: 'Settings',
    description: 'Manage senders, integrations, documents, and health checks.',
  },
  'Universal Audit Trail': {
    eyebrow: 'Audit',
    title: 'Audit Trail',
    description: 'Review administrator and workflow events.',
  },
  'Admin Control': {
    eyebrow: 'Access',
    title: 'Admin Control',
    description: 'Manage users, roles, and page access.',
  },
};

export function getV2PageCopy({ title, eyebrow, description }) {
  const copy = V2_PAGE_COPY[title] || {};
  return {
    eyebrow: copy.eyebrow ?? eyebrow,
    title: copy.title ?? title,
    description: copy.description ?? description,
  };
}
