export const APP_VERSION = '2.0.25';

export const APP_VERSION_HISTORY = [
  {
    version: '2.0.25',
    releasedAt: '2026-07-22',
    title: 'Selectable GROUP update scope',
    changes: [
      'Added GROUP-only and GROUP-and-children choices when editing Account managers.',
      'Added the same explicit scope choices for Account notes, with atomic child-note replacement.',
      'Updated Account Managers methodology and row feedback to explain inheritance, Salesforce writes, and copied notes.',
    ],
  },
  {
    version: '2.0.24',
    releasedAt: '2026-07-22',
    title: 'Account notes and GROUP-first directory',
    changes: [
      'Moved active GROUP Accounts to the top of the Account Managers directory.',
      'Added independent 255-character Account notes with inline editing, attribution, and note-aware search.',
      'Kept child Account notes separate from GROUP manager propagation and Salesforce synchronization.',
    ],
  },
  {
    version: '2.0.23',
    releasedAt: '2026-07-22',
    title: 'Account manager priority and GROUP coverage',
    changes: [
      'Added drag-and-drop manager priority with stable unsaved rows for second and third assignments.',
      'Added GROUP Account confirmation, child-account propagation, inherited assignments, and group-aware search.',
      'Added an Account Managers methodology guide beside Refresh.',
    ],
  },
  {
    version: '2.0.22',
    releasedAt: '2026-07-22',
    title: 'Account Manager administration',
    changes: [
      'Replaced Buyers Administrator with Account Managers for active Buyer, Buyer & Supplier, and Broker Account names.',
      'Added responsive inline zero-to-three manager editing, manager-name filters, Salesforce synchronization, and explicit Save and Cancel controls.',
      'Expanded legacy manager initials in Salesforce, replaced Sam Yip with Vincent Lee, and seeded the active assignments in FCOS.',
    ],
  },
  {
    version: '2.0.21',
    releasedAt: '2026-07-22',
    title: 'Explicit buyer trader selection',
    changes: [
      'Changed Add Trader to open an empty selection instead of automatically choosing the first active user.',
      'Disabled assignment saving until every added trader slot contains a deliberately selected active FCOS user.',
      'Kept zero-trader saves available when no assignment rows have been added.',
    ],
  },
  {
    version: '2.0.20',
    releasedAt: '2026-07-22',
    title: 'Complete buyer directory pagination',
    changes: [
      'Changed Buyers Administrator to fetch the complete Salesforce buyer Account set without the 2,000-row aggregate ceiling.',
      'Paginated the buyer table at 100 rows per page for faster rendering and easier navigation.',
      'Focused the directory columns on buyer identity, trader ownership, update history, and management actions.',
    ],
  },
  {
    version: '2.0.19',
    releasedAt: '2026-07-22',
    title: 'Buyer trader administration',
    changes: [
      'Added a Buyers Administrator page for assigning zero to three internal traders to each Salesforce buyer Account.',
      'Kept same-name buyer Accounts separate by Salesforce Account ID and revalidated buyer usage before every save.',
      'Added atomic assignment saves, active-user checks, edit-conflict protection, and administrator audit events.',
    ],
  },
  {
    version: '2.0.18',
    releasedAt: '2026-07-16',
    title: 'Sidebar display modes',
    changes: [
      'Restored the left-edge hover rail as the default auto-hide sidebar mode.',
      'Changed the arrow control to pin or unpin the sidebar with page space reserved while pinned.',
      'Persisted the selected auto-hide or fixed sidebar mode across browser sessions.',
    ],
  },
  {
    version: '2.0.17',
    releasedAt: '2026-07-16',
    title: 'Explicit sidebar visibility',
    changes: [
      'Added a sidebar header control that completely hides the navigation drawer and its edge rail.',
      'Added a compact top-left arrow to restore the sidebar when it is hidden.',
      'Persisted the sidebar visibility preference across browser sessions.',
    ],
  },
  {
    version: '2.0.16',
    releasedAt: '2026-07-16',
    title: 'Consolidated payment reminder batches',
    changes: [
      'Grouped payment reminder batches by buyer Account ID, buyer broker Account IDs, and broker routing mode.',
      'Merged and deduplicated invoice-specific trader and collection-handler recipients within each buyer and broker group.',
      'Kept different buyer Accounts, broker Accounts, and routing instructions in separate email batches.',
    ],
  },
  {
    version: '2.0.15',
    releasedAt: '2026-07-15',
    title: 'Monthly gross margin trends',
    changes: [
      'Added monthly Gross Margin % to the Gross Profit trend with a dedicated percentage axis.',
      'Added the same Gross Margin % trend to the stacked monthly product-volume chart.',
      'Calculated each monthly margin from the matching monthly Gross Profit and Turnover totals.',
    ],
  },
  {
    version: '2.0.14',
    releasedAt: '2026-07-15',
    title: 'Correct buyer invoice due dates',
    changes: [
      'Corrected buyer invoice payment-term dates to count the delivery date as day one.',
      'Applied the corrected due date consistently to invoice lists, reminders, cashflow, incoming payments, late-interest calculations, and stem details.',
    ],
  },
  {
    version: '2.0.13',
    releasedAt: '2026-07-13',
    title: 'Faster dispute draft saves',
    changes: [
      'Updated only the active dispute queue row after Save Draft instead of reloading the full Salesforce queue.',
      'Parallelized independent Salesforce and Supabase draft checks while preserving party revalidation and status writeback.',
      'Refreshed the current case audit trail directly from the save response.',
    ],
  },
  {
    version: '2.0.12',
    releasedAt: '2026-07-10',
    title: 'Focused dispute queue products',
    changes: [
      'Excluded Transport, Undercharge, and Adjustment extra-cost categories from the Dispute Workflow queue.',
      'Removed quantities from extra-cost product labels while retaining quantities for normal STEM product line items.',
    ],
  },
  {
    version: '2.0.11',
    releasedAt: '2026-07-10',
    title: 'Extra-cost products in dispute queue',
    changes: [
      'Added STEM extra-cost product names and quantities to the Dispute Workflow queue product column.',
      'Matched invoiced extra-cost products to their supplier invoice due-date rows.',
      'Kept uninvoiced extra-cost products visible with their supplier details.',
    ],
  },
  {
    version: '2.0.10',
    releasedAt: '2026-07-10',
    title: 'Dispute dates and document drop zone',
    changes: [
      'Removed Salesforce Account IDs from the user-facing dispute workflow while retaining Account-ID validation internally.',
      'Added drag-and-drop document selection to the Salesforce dispute document upload modal.',
      'Added delivery, buyer payment due, and supplier payment due dates to the workflow header and financial exposure section.',
    ],
  },
  {
    version: '2.0.9',
    releasedAt: '2026-07-10',
    title: 'Supabase-owned dispute parties',
    changes: [
      'Moved disputed Account selection and workflow instructions into Supabase without using the Salesforce Dispute object.',
      'Included buyer, line-item supplier, and extra-cost supplier Accounts, including cancelled sources, with Account-ID deduplication.',
      'Added account-first Salesforce document uploads with editable date-and-direction names and automatic duplicate suffixes.',
    ],
  },
  {
    version: '2.0.8',
    releasedAt: '2026-07-10',
    title: 'Dispute document upload access',
    changes: [
      'Added a visible party-aware document upload control inside the Manage Dispute Workflow modal.',
      'Made document upload save new trader actions automatically before opening the Salesforce upload form.',
      'Limited supplier Account ID suffixes to same-name supplier collisions instead of showing them on every queue row.',
    ],
  },
  {
    version: '2.0.7',
    releasedAt: '2026-07-10',
    title: 'Account-ID dispute parties',
    changes: [
      'Changed dispute buyer and supplier identity to Salesforce Account IDs, including separate handling for same-name supplier accounts.',
      'Added Salesforce structure validation using STEM line-item Original Supplier lookups and blocked extra-cost-only or inconsistent dispute parties.',
      'Made workflow actions and documents party-aware, with server-derived writeback targets and multi-record Salesforce document links.',
    ],
  },
  {
    version: '2.0.6',
    releasedAt: '2026-07-10',
    title: 'Shared external reminder sender',
    changes: [
      'Changed External Payment Reminders to use one centrally managed server SMTP sender for every user.',
      'Removed browser-specific External Payment Reminder credentials and ignored legacy per-user SMTP overrides in the API.',
      'Added automatic cleanup of previously stored browser reminder credentials and settings drafts.',
    ],
  },
  {
    version: '2.0.5',
    releasedAt: '2026-07-10',
    title: 'External reminder sender fallback',
    changes: [
      'Changed blank External Payment Reminder From Email settings to use the authenticated SMTP username instead of the shared info mailbox.',
      'Added a safe Microsoft 365 Send As fallback that retries from the authenticated mailbox only after a confirmed SendAsDenied rejection.',
      'Replaced long Microsoft SMTP diagnostics with a concise sender-permission message when the authenticated mailbox is also rejected.',
    ],
  },
  {
    version: '2.0.4',
    releasedAt: '2026-07-10',
    title: 'Dispute collaboration and settlement',
    changes: [
      'Redesigned the dispute lifecycle around trader preparation, approval, accounting settlement, and guarded final closure.',
      'Added Salesforce-first dispute document uploads with party-aware smart filenames, evidence checks, and in-app preview.',
      'Added visible workflow rules for every role while keeping approval and accounting actions permission-controlled.',
    ],
  },
  {
    version: '2.0.3',
    releasedAt: '2026-07-10',
    title: 'Dispute Workflow wording',
    changes: [
      'Removed preview wording from the Dispute Workflow page, audit labels, release notes, and workflow messages.',
      'Made /disputes the canonical Dispute Workflow route while redirecting legacy dispute links.',
      'Added Dispute Workflow API aliases while keeping the old endpoints available for compatibility.',
    ],
  },
  {
    version: '2.0.2',
    releasedAt: '2026-07-09',
    title: 'Dispute workflow cleanup',
    changes: [
      'Removed the retired Dispute Management page from navigation and routed old dispute links to Dispute Workflow.',
      'Removed old-only dispute document mutation and party-edit endpoints while keeping Dispute Workflow APIs unchanged.',
      'Changed the disputes access module label and path to Dispute Workflow.',
    ],
  },
  {
    version: '2.0.1',
    releasedAt: '2026-07-09',
    title: 'V2 version sequence',
    changes: [
      'Started the next release sequence at V2.0.1 for FCOS releases going forward.',
      'Kept the existing version audit trail visible for reference.',
    ],
  },
  {
    version: '1.0.60',
    releasedAt: '2026-07-09',
    title: 'FCOS custom domain',
    changes: [
      'Changed generated app links and scheduled report endpoints to fcos.fcuno.com.',
      'Attached and verified the fcos.fcuno.com custom domain in Vercel.',
      'Prepared the old deployment aliases for removal after custom-domain verification.',
    ],
  },
  {
    version: '1.0.59',
    releasedAt: '2026-07-09',
    title: 'FCOS production domain',
    changes: [
      'Changed the production app identity and generated report links to FCOS.',
      'Renamed internal app storage, autosave, and event prefixes to FCOS.',
      'Updated package metadata, documentation, and server fallback URLs to the FCOS app identity.',
    ],
  },
  {
    version: '1.0.58',
    releasedAt: '2026-07-09',
    title: 'FCOS shell branding',
    changes: [
      'Renamed the app brand to FCOS across the browser title, manifest, login screen, sidebar, favicon label, and XLS report metadata.',
      'Changed the sidebar into an auto-hide left-edge drawer so the pages use the full browser width by default.',
      'Removed the workspace header banner and moved the Salesforce connection status into the sidebar header.',
    ],
  },
  {
    version: '1.0.57',
    releasedAt: '2026-07-09',
    title: 'Single workspace routing',
    changes: [
      'Removed the old workspace shell and made the current interface the only active app surface.',
      'Redirected legacy workspace URLs to canonical routes so existing bookmarks continue to open.',
      'Removed visible workspace switching labels from navigation and version dialogs.',
    ],
  },
  {
    version: '1.0.56',
    releasedAt: '2026-07-09',
    title: 'Browser document scroll lock',
    changes: [
      'Locked the browser document to the viewport so app pages cannot scroll into blank space.',
      'Kept scrolling inside the app layouts and route-owned table areas.',
    ],
  },
  {
    version: '1.0.55',
    releasedAt: '2026-07-09',
    title: 'Dispute workflow outer scroll lock',
    changes: [
      'Stopped the Dispute Workflow route from using the outer workspace scroll container.',
      'Made Dispute Workflow fill its route area exactly so only the queue table scrolls.',
      'Applied the same route-level scroll containment to the Dispute Workflow entry point.',
    ],
  },
  {
    version: '1.0.54',
    releasedAt: '2026-07-09',
    title: 'Dispute workflow page scroll containment',
    changes: [
      'Changed Dispute Workflow to a viewport-contained layout so the page itself does not keep scrolling.',
      'Moved scrolling responsibility to the Dispute Workflow Queue table area only.',
    ],
  },
  {
    version: '1.0.53',
    releasedAt: '2026-07-09',
    title: 'Dispute workflow modal scroll fix',
    changes: [
      'Constrained the Dispute Workflow manage modal to the browser height.',
      'Pinned the modal header, summary, and footer while limiting scrolling to the modal body.',
    ],
  },
  {
    version: '1.0.52',
    releasedAt: '2026-07-09',
    title: 'Dispute queue delivery date cutoff',
    changes: [
      'Hardcoded Dispute Management queue to exclude STEMs with Delivery Date before 1 Jan 2026.',
      'Applied the same hardcoded Delivery Date cutoff to Dispute Workflow queue while keeping blank delivery-date STEMs visible.',
    ],
  },
  {
    version: '1.0.51',
    releasedAt: '2026-07-09',
    title: 'Cashflow forecast methodology sheet',
    changes: [
      'Added a Methodology button to Cashflow Forecast next to Refresh.',
      'Added a floating explanation sheet covering buyer receipt prediction, supplier payment assumptions, business-day adjustment, holiday handling, and forecast limitations.',
    ],
  },
  {
    version: '1.0.50',
    releasedAt: '2026-07-09',
    title: 'Workspace shell',
    changes: [
      'Added unified navigation, simplified module names, and a cleaner operational layout.',
      'Applied page header, table, card, and control styling without changing Salesforce calculations or API payloads.',
      'Kept route compatibility while the workspace design was introduced.',
    ],
  },
  {
    version: '1.0.49',
    releasedAt: '2026-07-09',
    title: 'Payable remittance payment filter',
    changes: [
      'Excluded Payment__c Payable Remittance records from Incoming Payment receivable rows.',
      'Applied the same remittance filter to Stem Detail Payment from Buyer rows so payable remittance aggregates are not shown as buyer receipts.',
    ],
  },
  {
    version: '1.0.48',
    releasedAt: '2026-07-09',
    title: 'Salesforce OAuth configuration guard',
    changes: [
      'Blocked silent fallback to expired temporary Salesforce access tokens when durable OAuth variables are present but blank.',
      'Updated System Health to report blank Salesforce OAuth variables as a configuration error.',
    ],
  },
  {
    version: '1.0.47',
    releasedAt: '2026-07-09',
    title: 'Durable Salesforce authentication',
    changes: [
      'Added Salesforce OAuth JWT bearer authentication as the preferred permanent server-to-server auth mode.',
      'Updated System Health to show JWT bearer, refresh-token, or temporary access-token mode with expiry-risk notes.',
    ],
  },
  {
    version: '1.0.46',
    releasedAt: '2026-07-09',
    title: 'Receivable remittance payment filter',
    changes: [
      'Expanded Payment__c receivable-remittance detection beyond record type so remittance rows are not shown as buyer payments.',
      'Applied the same filter to Incoming Payment, Stem Detail payment dates, cashflow payment samples, and late-payment interest calculations.',
    ],
  },
  {
    version: '1.0.45',
    releasedAt: '2026-07-09',
    title: 'Incoming payment email KPI cards',
    changes: [
      'Updated the Incoming Payment report email summary to use the same card-style KPI layout as the Outstanding Buyer Invoices email.',
      'Added matching plain-text summary lines for email clients that do not render HTML.',
    ],
  },
  {
    version: '1.0.44',
    releasedAt: '2026-07-09',
    title: 'Rich text email templates',
    changes: [
      'Converted all email content editors to rich text format.',
      'Preserved rich HTML for outgoing internal reports, external reminders, incoming payment reports, and late payment interest request emails.',
    ],
  },
  {
    version: '1.0.43',
    releasedAt: '2026-07-09',
    title: 'Payment column alignment',
    changes: [
      'Right-aligned Terms and Delay in Receivable Payments.',
      'Right-aligned Overdue values in Outstanding Buyer Invoices, reminder previews, and related email tables.',
    ],
  },
  {
    version: '1.0.42',
    releasedAt: '2026-07-09',
    title: 'Interoffice data restriction',
    changes: [
      'Added the Interoffice user type with operational finance access and no default Settings, Admin, or Reports Archive access.',
      'Applied server-side exclusion of FRATELLI COSULICH buyer-group STEMs to dashboard KPIs, charts, tables, invoice reports, incoming payments, cashflow, disputes, broker commissions, and stem detail access.',
    ],
  },
  {
    version: '1.0.41',
    releasedAt: '2026-07-09',
    title: 'Payment table email alignment',
    changes: [
      'Left-aligned Delay and Overdue values and removed the Days suffix from Overdue column displays.',
      'Updated Incoming Payment report emails to use the current Receivable Payments table order while excluding only the Interest Invoice action column.',
    ],
  },
  {
    version: '1.0.40',
    releasedAt: '2026-07-09',
    title: 'Settings system health',
    changes: [
      'Added a System Health tab inside Settings to show Salesforce, Supabase, Google Drive, exchange-rate, holiday, SMTP, Vercel, and browser sender status.',
      'Added redacted server-side health checks with token expiry notes where providers expose them.',
      'Separated server SMTP status from browser-local Internal and External Payment Reminder sender configuration.',
    ],
  },
  {
    version: '1.0.39',
    releasedAt: '2026-07-09',
    title: 'Universal audit trail and receivable table cleanup',
    changes: [
      'Added an administrator-only Universal Audit Trail page covering admin changes, collection events, report archive actions, dispute workflow events, internal report runs, and late payment interest requests.',
      'Allowed late payment interest invoice requests to be sent again after user confirmation.',
      'Removed the Receivable Payments Status column, tightened Terms and Delay columns, and removed the Days suffix from Delay values.',
    ],
  },
  {
    version: '1.0.38',
    releasedAt: '2026-07-08',
    title: 'Cashflow forecast date floor',
    changes: [
      'Excluded buyer payment performance before 1 Jan 2026 from Cashflow Forecast modelling.',
      'Excluded receivable and payable forecast rows for STEMs delivered before 1 Jan 2026.',
    ],
  },
  {
    version: '1.0.37',
    releasedAt: '2026-07-08',
    title: 'Internal report footer alignment',
    changes: [
      'Moved the Outstanding Buyer Invoices internal daily report template controls immediately to the left of Close.',
    ],
  },
  {
    version: '1.0.36',
    releasedAt: '2026-07-08',
    title: 'Cashflow forecast',
    changes: [
      'Added Cashflow Forecast with buyer receipt prediction, supplier payment outflows, and daily/weekly/monthly buckets.',
      'Added Nager.Date holiday blocking with cache and manual blocked-date overrides for weekend, Singapore, and US holiday adjustments.',
    ],
  },
  {
    version: '1.0.35',
    releasedAt: '2026-07-08',
    title: 'Late payment STEM link token',
    changes: [
      'Added a Link to STEM variable for late payment interest request email templates.',
      'Linked late payment interest request emails back to Incoming Payment with the relevant STEM detail opened.',
    ],
  },
  {
    version: '1.0.34',
    releasedAt: '2026-07-08',
    title: 'Email modal workflow alignment',
    changes: [
      'Moved external payment reminder template actions to the footer immediately before Close.',
      'Redesigned the Incoming Payment report email modal into the same step workflow used by external payment reminders.',
    ],
  },
  {
    version: '1.0.33',
    releasedAt: '2026-07-08',
    title: 'Remove report builder and data explorer',
    changes: [
      'Removed Report Builder and Data Explorer routes, navigation items, access modules, and unused page/component code.',
      'Renamed Stem P&L Report to Dashboard and Qlik Validator Tool across navigation and page headings.',
    ],
  },
  {
    version: '1.0.32',
    releasedAt: '2026-07-08',
    title: 'External payment reminder modal redesign',
    changes: [
      'Redesigned the external payment reminder modal into a three-step workflow for invoice selection, recipient review, and email preview.',
      'Simplified reminder wording and changed the modal to a neutral solid style with status-only color accents.',
    ],
  },
  {
    version: '1.0.31',
    releasedAt: '2026-07-08',
    title: 'Exclude receivable remittance from payments',
    changes: [
      'Excluded Payment__c records with Receivable Remittance record type from Incoming Payment receivable payment rows.',
      'Applied the same exclusion to Stem Detail buyer payment dates and late-payment interest calculation inputs.',
    ],
  },
  {
    version: '1.0.30',
    releasedAt: '2026-07-08',
    title: 'Incoming payment bank charge grouping',
    changes: [
      'Restored bank-charge grouping for small same-STEM payments that are not explicitly labelled as bank charges in Salesforce.',
      'Attached inferred bank charges underneath the related larger buyer payment amount instead of showing them as separate receivable payment rows.',
    ],
  },
  {
    version: '1.0.29',
    releasedAt: '2026-07-08',
    title: 'Incoming payment payable exclusion',
    changes: [
      'Excluded STEM payable-calculation rows from the Incoming Payment Receivable Payments table.',
      'Reused the same payable amount guard from Stem Detail so calculated supplier/payable amounts are not treated as receivable payments.',
    ],
  },
  {
    version: '1.0.28',
    releasedAt: '2026-07-08',
    title: 'Stem detail payment labels and payable exclusion',
    changes: [
      'Renamed Stem Detail payment sections to Payment from Buyer, Supplier Side, and Payment to Supplier.',
      'Strengthened Stem Detail payment classification so calculated payable rows are excluded from buyer payment dates.',
    ],
  },
  {
    version: '1.0.27',
    releasedAt: '2026-07-08',
    title: 'Stem detail buyer receipt classification',
    changes: [
      'Stopped Stem Detail from showing STEM-linked calculated payable amounts as buyer invoice received dates.',
      'Added a payable-amount guard so undelivered STEM supplier cost calculations are not treated as buyer receipts.',
    ],
  },
  {
    version: '1.0.26',
    releasedAt: '2026-07-08',
    title: 'Incoming payment empty table behavior',
    changes: [
      'Removed data-table column headers from empty Buyer CIA Invoices and Available Buyer Balances sections.',
      'Changed both empty sections to use compact one-row empty messages instead of tall table empty states.',
    ],
  },
  {
    version: '1.0.25',
    releasedAt: '2026-07-08',
    title: 'Available buyer balances table height behavior',
    changes: [
      'Changed Incoming Payment Available Buyer Balances table to auto-fit up to five records.',
      'Enabled scrolling for the Available Buyer Balances table only when more than five records are visible.',
    ],
  },
  {
    version: '1.0.24',
    releasedAt: '2026-07-08',
    title: 'Buyer CIA table height behavior',
    changes: [
      'Changed Incoming Payment Buyer CIA Invoices table to auto-fit up to five visible records.',
      'Enabled scrolling for the Buyer CIA Invoices table only when more than five records are visible.',
    ],
  },
  {
    version: '1.0.23',
    releasedAt: '2026-07-08',
    title: 'Late payment interest link styling',
    changes: [
      'Renamed the incoming payment report hyperlink button to Late Payment Interest Invoice.',
      'Changed the hyperlink button background to Ferrari red.',
    ],
  },
  {
    version: '1.0.22',
    releasedAt: '2026-07-08',
    title: 'Reminder template variable drag-and-drop',
    changes: [
      'Replaced the Insert invoice table button in External payment reminder with the draggable invoice table variable.',
      'Allowed payment reminder variables to be dragged into the email content editor while editing the template.',
    ],
  },
  {
    version: '1.0.21',
    releasedAt: '2026-07-08',
    title: 'External reminder preview cleanup',
    changes: [
      'Changed the payment reminder modal title to External payment reminder.',
      'Improved Buyer-only routing badge color and alignment in related invoice selection.',
      'Added saved CC and BCC template fields while keeping To as final review-only routing.',
      'Changed the reminder preview to show actual To, Cc, Bcc, Subject, and selected invoice rows.',
    ],
  },
  {
    version: '1.0.20',
    releasedAt: '2026-07-08',
    title: 'Settings email sender tabs',
    changes: [
      'Changed Settings > Email Senders to use separate tabs for Internal and External Payment Reminder SMTP accounts.',
      'Preserved the existing Save All Settings and autosaved draft behavior for both sender accounts.',
    ],
  },
  {
    version: '1.0.19',
    releasedAt: '2026-07-08',
    title: 'Email template cleanup',
    changes: [
      'Removed the duplicate Payment Reminder Template button from Outstanding Buyer Invoices.',
      'Renamed the internal report action to Outstanding Buyer Invoices - Internal Daily Report.',
      'Fixed the internal daily report modal layout so footer actions remain visible.',
      'Added editable To, Cc, and Bcc fields to the Late Payment Interest Request email template.',
    ],
  },
  {
    version: '1.0.18',
    releasedAt: '2026-07-08',
    title: 'SMTP-only email delivery',
    changes: [
      'Removed the third-party API delivery path from server email sending.',
      'Changed all internal, external reminder, scheduled report, and late payment interest emails to use SMTP only.',
      'Updated email configuration messages to point users to saved SMTP senders or Vercel SMTP environment variables.',
    ],
  },
  {
    version: '1.0.17',
    releasedAt: '2026-07-08',
    title: 'Email reminder workflow refinement',
    changes: [
      'Added Payment Collection Handler to the Outstanding Buyer Invoices internal email reminder table and plain-text output.',
      'Changed late payment interest requests to fall back to the system-wide SMTP sender when no Internal browser SMTP sender is saved.',
      'Redesigned the external payment reminder modal so related invoice selection remains on top and email review/preview are split side by side.',
      'Added explicit edit, save, and cancel template controls inside the external payment reminder modal.',
    ],
  },
  {
    version: '1.0.16',
    releasedAt: '2026-07-08',
    title: 'Email template preview alignment',
    changes: [
      'Renamed Email Sender settings to Internal and External Payment Reminder.',
      'Added an editable Late Payment Interest Request email template with sample preview in Incoming Payment.',
      'Changed late payment interest requests to use the saved Internal sender only.',
      'Reworked the Outstanding Buyer Invoices internal reminder into a modal with editable settings, generated preview, save/cancel, and send controls.',
      'Added Save Template inside manual payment reminder preview so edited reminder content can be reused.',
    ],
  },
  {
    version: '1.0.15',
    releasedAt: '2026-07-08',
    title: 'Late payment interest calculation',
    changes: [
      'Changed late payment interest request emails to send to Louisa and the requesting user.',
      'Added buyer account interest-rate lookup for late payment interest calculation.',
      'Added partial-payment interest calculation details and formula to the request email.',
    ],
  },
  {
    version: '1.0.14',
    releasedAt: '2026-07-08',
    title: 'Incoming payment report action link',
    changes: [
      'Added a Request Late Payment Interest Invoice email template token for Incoming Payment reports.',
      'Rendered the token as a captioned hyperlink to the Incoming Payment page with the report date and keyword filters applied.',
      'Preserved email-link query filters through login before opening Incoming Payment.',
    ],
  },
  {
    version: '1.0.13',
    releasedAt: '2026-07-08',
    title: 'Notification close fix',
    changes: [
      'Fixed notification close buttons so dismissed toasts are removed immediately instead of staying visible.',
      'Made the toast container non-interactive except for the notification itself so no overlay blocks the close button.',
    ],
  },
  {
    version: '1.0.12',
    releasedAt: '2026-07-08',
    title: 'Incoming payment notification fixes',
    changes: [
      'Changed late payment interest requests to require a saved SMTP sender instead of falling through to missing server email configuration.',
      'Improved the missing sender message so users know to configure Settings > Email Senders.',
      'Raised the notification layer and made toast close buttons always visible and clickable.',
    ],
  },
  {
    version: '1.0.11',
    releasedAt: '2026-07-08',
    title: 'Incoming payment interest request workflow',
    changes: [
      'Matched Inserted On payment date styling with the bank charge amber treatment on screen and in email tables.',
      'Added Incoming Payment KPI variables as draggable email template tokens.',
      'Added a late payment interest invoice request button for buyer payments delayed more than 3 days.',
      'Recorded each interest invoice request in Supabase so requested buttons stay disabled after refresh.',
    ],
  },
  {
    version: '1.0.10',
    releasedAt: '2026-07-08',
    title: 'Incoming payment created-date filters',
    changes: [
      'Changed Incoming Payment filters to use Payment CreatedDate on a Hong Kong date basis.',
      'Added Inserted On details below Received Date when the created date differs from the received date.',
      'Widened the Incoming Payment email preview while keeping the template editor fixed-width.',
      'Reworked the Incoming Payment email template editor with drag-and-drop table tokens plus explicit edit, save, and cancel actions.',
    ],
  },
  {
    version: '1.0.9',
    releasedAt: '2026-07-08',
    title: 'Incoming payment sender reuse',
    changes: [
      'Changed Incoming Payment report sending to reuse the saved app email sender chain.',
      'Uses Internal Email Reminder Sender first and Payment Reminder Sender as fallback before server-side SMTP.',
      'Shows which saved sender was used after a successful Incoming Payment report send.',
    ],
  },
  {
    version: '1.0.8',
    releasedAt: '2026-07-08',
    title: 'Incoming payment email error visibility',
    changes: [
      'Made Incoming Payment report send failures show a visible toast and modal error.',
      'Separated Previewing and Sending button states in the Incoming Payment report email modal.',
      'Hardened API calls so network failures return visible errors instead of leaving pages stuck.',
    ],
  },
  {
    version: '1.0.7',
    releasedAt: '2026-07-08',
    title: 'Incoming payment email report',
    changes: [
      'Simplified Incoming Payment KPIs by moving Buyer Payments and Supplier Refunds into the Incoming Total card.',
      'Removed the Incoming Payment CSV export action.',
      'Added an Incoming Payment report email workflow with editable recipients, template, preview, and inline Receivable Payments and Buyer CIA Invoices tables.',
      'Preserved Incoming Payment filters and loaded data when switching pages through a reusable page-state cache.',
    ],
  },
  {
    version: '1.0.6',
    releasedAt: '2026-07-08',
    title: 'Broker commission payment split',
    changes: [
      'Excluded broker commission payments from Receivable Payments.',
      'Added buyer, secondary buyer, and supplier broker commission paid-date tables in Stem Detail.',
      'Changed Supplier Invoice Paid Dates to show Supplier instead of Supplier Invoice.',
      'Renamed Buyer Pay Term Date to Buyer Invoice Due Date in Stem Detail.',
    ],
  },
  {
    version: '1.0.5',
    releasedAt: '2026-07-08',
    title: 'Dock-style collapsed sidebar',
    changes: [
      'Changed the collapsed sidebar into a dock-style navigation with hover magnification.',
      'Added visible hover labels beside collapsed navigation icons.',
      'Kept the expanded sidebar navigation behavior unchanged.',
    ],
  },
  {
    version: '1.0.4',
    releasedAt: '2026-07-08',
    title: 'Stem payment and bank charge refinement',
    changes: [
      'Grouped bank charge payments underneath their related Receivable Payments amount line.',
      'Moved supplier paid dates and buyer received dates into the Stem Detail financial panel.',
      'Removed the meaningless payment-name column from Stem Detail payment date tables.',
      'Added receivable and payable balances to Stem Detail financials and removed less useful total fields.',
    ],
  },
  {
    version: '1.0.3',
    releasedAt: '2026-07-08',
    title: 'Incoming payment source correction',
    changes: [
      'Filtered Buyer CIA Invoices to exclude STEMs with delivery dates before 1 Jan 2026.',
      'Corrected Receivable Payments so positive supplier-side payments are not shown as buyer receipts.',
      'Separated Stem Detail supplier paid dates from buyer received dates using supplier-side payment classification.',
    ],
  },
  {
    version: '1.0.2',
    releasedAt: '2026-07-08',
    title: 'Receivable payment cleanup and CIA monitor',
    changes: [
      'Excluded outgoing supplier payments from Incoming Payment unless the supplier payment amount is negative as a supplier refund.',
      'Renamed Salesforce Payment Records to Receivable Payments and simplified columns around status, received date, payment terms, delay, sender, group, STEM, amount, and receivable balance.',
      'Added Buyer CIA Invoices to monitor unpaid CIA buyer invoice STEMs with buyer, group, buyer trader, STEM, calculated amount, receivable balance, and delivery date.',
      'Added an administrator-only reusable drag-and-drop column ordering component and applied it to the Incoming Payment tables.',
    ],
  },
  {
    version: '1.0.1',
    releasedAt: '2026-07-08',
    title: 'Incoming Payment table workflow',
    changes: [
      'Made Incoming Payment rows open Stem Detail when a linked STEM exists.',
      'Removed the Payment Details column and reordered payment records around type, dates, delay, sender, group, and STEM.',
      'Added buyer invoice due date and payment delay for buyer payments.',
      'Changed the default Incoming Payment filters to today-to-today and all payment types.',
    ],
  },
  {
    version: '1.0.0.22',
    releasedAt: '2026-07-08',
    title: 'Incoming Payment display refinement',
    changes: [
      'Changed Incoming Payment records to show meaningful payment details from reference, description, remittance, bank, and transaction fields.',
      'Kept the raw Salesforce payment name as secondary text only when it differs from the payment details.',
      'Updated Incoming Payment CSV export to include both payment details and Salesforce payment name.',
    ],
  },
  {
    version: '1.0.0.21',
    releasedAt: '2026-07-08',
    title: 'Incoming Payment workspace',
    changes: [
      'Added an Incoming Payment page for buyer payments received and supplier refunds from Salesforce Payment__c records.',
      'Added buyer-group available balance tracking based on overpaid STEM receivable balances.',
      'Added a global fully paid threshold setting with administrator-only editing.',
      'Added conservative administrator-only allocation preparation that blocks Salesforce write-back until target allocation fields are confirmed.',
    ],
  },
  {
    version: '1.0.0.20',
    releasedAt: '2026-07-08',
    title: 'Dispute Workflow queue readability',
    changes: [
      'Combined buyer and buyer invoice due date into one two-line queue column.',
      'Moved product and quantity details into a separate Products column between buyer and supplier details.',
      'Grouped supplier invoice due details so supplier names are not repeated for every product line.',
      'Moved delivery date under the STEM name to reduce queue table width.',
    ],
  },
  {
    version: '1.0.0.19',
    releasedAt: '2026-07-08',
    title: 'Dispute Workflow queue and P&L labels',
    changes: [
      'Renamed Dispute Workflow settlement labels to Dispute P&L and added STEM P&L including dispute impact to the manage modal header.',
      'Removed duplicate receivable display from the Dispute Workflow manage modal header.',
      'Added delivery date, buyer invoice due date, and supplier invoice due/product quantity details to the Dispute Workflow queue.',
      'Capitalized Dispute Workflow close reason labels while preserving compatibility with previously saved lowercase values.',
    ],
  },
  {
    version: '1.0.0.18',
    releasedAt: '2026-07-08',
    title: 'Dispute Workflow settlement refinement',
    changes: [
      'Dispute Workflow now treats buyer and supplier settlement credit notes as lump-sum amounts instead of unit-price spreads.',
      'The manage modal now shows buyer receivable and every supplier invoice/payable row even when that party is not under dispute.',
      'Dispute Workflow queue rows now open the standard Stem Detail modal, while Manage opens the workflow modal.',
    ],
  },
  {
    version: '1.0.0.17',
    releasedAt: '2026-07-07',
    title: 'Dispute Workflow',
    changes: [
      'Added a separate Dispute Workflow page while keeping the existing Dispute Management page unchanged.',
      'Added Supabase-backed trader actions, dispute administrator approval, execution tracking, audit events, and settlement P&L.',
      'Approved workflow actions write back only summary status, description, and deduction amount to existing Salesforce dispute records.',
    ],
  },
  {
    version: '1.0.0.16',
    releasedAt: '2026-07-07',
    title: 'Payment reminder prepare fix',
    changes: [
      'Fixed the payment reminder prepare error caused by an obsolete recipient-template variable.',
      'Payment reminder previews continue to use editable per-batch To, CC, and BCC fields.',
    ],
  },
  {
    version: '1.0.0.15',
    releasedAt: '2026-07-07',
    title: 'Explicit reminder batch recipients',
    changes: [
      'Outstanding payment reminder preview now shows editable To, CC, and BCC fields for every selected email batch.',
      'Payment reminder sending now uses only the final reviewed recipient fields shown in the preview.',
      'The server now rejects payment reminder sends without reviewed recipient batches to prevent hidden automatic routing.',
    ],
  },
  {
    version: '1.0.0.14',
    releasedAt: '2026-07-07',
    title: 'Broker routing warning in preview',
    changes: [
      'Payment reminder email preview now shows broker routing warnings before sending.',
      'Blank or unknown broker invoice/email formats now explicitly warn that broker email is not automatically added to BCC.',
    ],
  },
  {
    version: '1.0.0.13',
    releasedAt: '2026-07-07',
    title: 'Buyer-only broker email retention',
    changes: [
      'Explicit Buyer Only broker reminder routing now keeps broker email addresses so they can be added to automatic BCC.',
      'Blank or unknown broker invoice formats continue to avoid silent broker BCC routing.',
    ],
  },
  {
    version: '1.0.0.12',
    releasedAt: '2026-07-07',
    title: 'Buyer-only reminder broker BCC',
    changes: [
      'Broker-only outstanding payment reminders no longer automatically BCC the broker email address.',
      'Buyer-only outstanding payment reminders now automatically BCC broker email addresses when buyer broker routing data is present.',
    ],
  },
  {
    version: '1.0.0.11',
    releasedAt: '2026-07-07',
    title: 'Broker-only reminder BCC',
    changes: [
      'Broker-only outstanding payment reminders now automatically add broker email addresses to BCC for the matching email batch.',
      'Payment reminder preview now shows automatic Broker BCC recipients in the batch summary.',
    ],
  },
  {
    version: '1.0.0.10',
    releasedAt: '2026-07-07',
    title: 'Reports Archive access levels',
    changes: [
      'Added Read Only and Full Access levels for Reports Archive in Admin Control.',
      'Read-only archive users can view audit history, open Drive files, and download XLS reports.',
      'Rename and delete actions now require Full Access and are enforced by the server.',
    ],
  },
  {
    version: '1.0.0.9',
    releasedAt: '2026-07-07',
    title: 'Google Drive archive setup',
    changes: [
      'Completed Google Drive OAuth production setup for archived XLS exports.',
      'Fixed notification close buttons so XLS archive success and failure messages can be dismissed.',
    ],
  },
  {
    version: '1.0.0.8',
    releasedAt: '2026-07-06',
    title: 'Dashboard table auto-fit',
    changes: [
      'Filtered STEMs now auto-fits to the remaining browser height when analytics are hidden.',
      'The dashboard table scrolls internally so the browser window does not need vertical scrolling in hidden analytics mode.',
    ],
  },
  {
    version: '1.0.0.7',
    releasedAt: '2026-07-06',
    title: 'Dashboard analytics toggle',
    changes: [
      'Added a dashboard Show analytics / Hide analytics toggle.',
      'Dashboard KPIs and chart areas are hidden by default while the filtered STEM table remains visible.',
      'Analytics visibility is saved locally without refreshing Salesforce data.',
    ],
  },
  {
    version: '1.0.0.6',
    releasedAt: '2026-07-06',
    title: 'Dashboard KPI wording fix',
    changes: [
      'Fixed Turnover KPI display by falling back to the existing buyer invoice total when needed.',
      'Updated dashboard KPI notes for Turnover, Gross Profit Total, Gross Margin, and Product Volume.',
    ],
  },
  {
    version: '1.0.0.5',
    releasedAt: '2026-07-06',
    title: 'Broker routing and commission exclusions',
    changes: [
      'Outstanding buyer invoice reminders no longer route to hidden broker individual or hidden broker company accounts.',
      'Added broker commission row inclusion checkboxes so selected rows can be excluded from totals.',
      'Broker summary, page summary, CNY summary, and XLS export now use only included broker commission rows.',
    ],
  },
  {
    version: '1.0.0.4',
    releasedAt: '2026-07-06',
    title: 'Dashboard KPI and payment details',
    changes: [
      'Added Turnover KPI to the dashboard using filtered buyer invoice total.',
      'Standardized the Product Volume KPI layout with the other dashboard KPI cards.',
      'Added a wide-view toggle for the dashboard Filtered STEMs table.',
      'Added supplier invoice paid dates and buyer invoice received dates to Stem Detail.',
    ],
  },
  {
    version: '1.0.0.3',
    releasedAt: '2026-07-06',
    title: 'Buyer broker reminder routing',
    changes: [
      'Added buyer broker routing metadata to Outstanding Buyer Invoices.',
      'Payment reminders now route buyer-only, broker-only, or buyer-with-broker-copied based on Salesforce broker Invoice Format.',
      'Broker reminders use the broker Account email field, not broker invoice email or accounts email.',
      'Added routing details and warnings to the payment reminder selection workflow.',
    ],
  },
  {
    version: '1.0.0.2',
    releasedAt: '2026-07-06',
    title: 'Live update notification',
    changes: [
      'Added top-of-app notification when a newer Vercel deployment is available.',
      'Added Update Now action to clear browser caches and refresh the app to the latest deployment.',
      'Added build metadata generation so open browser sessions can detect new deployments.',
    ],
  },
  {
    version: '1.0.0.1',
    releasedAt: '2026-07-06',
    title: 'Operational analytics baseline',
    changes: [
      'Added version audit trail access from the main app sidebar.',
      'Added dashboard monthly volume view with HSFO, VLSFO, and LSMGO stacked by month.',
      'Updated dashboard port filtering so the same search box matches both port country and port name.',
      'Added grouped copy selection for outstanding buyer invoices by buyer and buyer group.',
      'Included recent broker commission, dispute management, document management, payment reminder, and collection workflow improvements in this baseline release.',
    ],
  },
];
