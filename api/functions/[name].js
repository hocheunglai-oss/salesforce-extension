import { chunkIds, cleanRecord, getInstanceUrl, salesforceAuthMode, sendJson, sfDownload, sfQuery, sfRequest } from '../_salesforce.js';
import {
  disputeWorkflowDirectionLabel,
  disputeWorkflowEditableFilename,
  disputeWorkflowFileExtension,
  disputeWorkflowHongKongDateToken,
} from '../_disputeDocuments.js';
import {
  buildDisputePartyRegistry,
  disputeSalesforceIdKey,
  findDisputeParty,
  resolveExtraCostSupplierLookup,
  resolveOriginalSupplierLookup,
} from '../_disputeParties.js';
import { disputeQueueExtraCostProductName } from '../_disputeQueue.js';
import { calculatedBuyerPayTermDate } from '../_buyerInvoiceDates.js';
import { grossMarginPercent } from '../_dashboardMetrics.js';
import { groupPaymentReminderRows } from '../_paymentReminderRouting.js';
import {
  applyBuyerReminderRules,
  buyerReminderAccountType,
  buyerReminderRuleMap,
  canonicalSalesforceAccountId,
  evaluateBuyerReminderSelection,
} from '../_buyerInvoiceReminderRules.js';
import {
  accountNameKey,
  buildAccountManagerRows,
  groupEligibleSalesforceAccounts,
  managerDisplayText,
  normalizeAccountManagerUserIds,
} from '../_accountManagers.js';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { externalActionGates, isExternalActionEnabled, requireExternalActionGate } from '../_externalActionGates.js';
import {
  authenticatedBackboneBridgePayload,
  backboneBridgeConfig,
  backboneBridgeRequest,
  browserSafeBackboneFinanceHandoff,
  browserSafeBackboneTradeProjection,
} from '../_backboneBridge.js';
import {
  EXCEPTION_REVIEW_DATE_BASIS,
  EXCEPTION_SCHEDULE_FIELDS,
  buildExceptionReviewScheduleWhere,
  exceptionScheduleSchemaIssues,
  normalizeExceptionSchedule,
} from '../../src/lib/exceptionReviewSchedule.js';
import {
  DISPUTE_BUYER_CLOSE_REASONS as DISPUTE_BETA_BUYER_CLOSE_REASONS,
  DISPUTE_SUPPLIER_CLOSE_REASONS as DISPUTE_BETA_SUPPLIER_CLOSE_REASONS,
} from '../../src/lib/disputeWorkflowOptions.js';
import {
  hasRecordedFcosClosureWriteback,
  isSalesforceDisputeClosed,
  projectExternalDisputeClosure,
} from '../_disputeWorkflowStatus.js';
import {
  allocateSupplierDispute,
  normalizeSupplierInvoiceExposure,
  resolveSupplierSettlementSchema,
  supplierAllocationFingerprint,
  supplierInstructionRows,
  validSupplierSettlementPayment,
} from '../_disputeSupplierSettlement.js';

async function readBody(req) {
  if (req.method === 'GET') return {};
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  if (typeof req.json === 'function') return req.json().catch(() => ({}));

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const ADMIN_APP_MODULES = [
  { id: 'dashboard', label: 'Dashboard', path: '/', sortOrder: 10 },
  { id: 'review', label: 'Exception Review', path: '/review', sortOrder: 20 },
  { id: 'disputes', label: 'Dispute Workflow', path: '/disputes', sortOrder: 30 },
  { id: 'buyer_invoices', label: 'Outstanding Buyer Invoices', path: '/buyer-invoices', sortOrder: 40 },
  { id: 'incoming_payments', label: 'Incoming Payment', path: '/incoming-payments', sortOrder: 45 },
  { id: 'cashflow_forecast', label: 'Cashflow Forecast', path: '/cashflow-forecast', sortOrder: 47 },
  { id: 'pnl', label: 'Dashboard and Qlik Validator Tool', path: '/pnl', sortOrder: 50 },
  { id: 'brokers', label: "Broker's Commission", path: '/brokers', sortOrder: 70 },
  { id: 'report_archive', label: 'Reports Archive', path: '/report-archive', sortOrder: 75 },
  { id: 'buyers_administrator', label: 'Account Managers', path: '/account-managers', sortOrder: 85 },
  { id: 'settings', label: 'Settings', path: '/settings', sortOrder: 90 },
  { id: 'admin', label: 'Admin Control', path: '/admin', sortOrder: 100 },
];

const ADMIN_MODULE_IDS = new Set(ADMIN_APP_MODULES.map((module) => module.id));
const ADMIN_FULL_ACCESS = Object.fromEntries(ADMIN_APP_MODULES.map((module) => [module.id, true]));
const ADMIN_CAPABILITIES = [
  { id: 'disputes_approve', label: 'Approve Dispute Instructions', description: 'Approve, reject, or return trader dispute instructions.' },
  { id: 'disputes_account', label: 'Settle and Close Disputes', description: 'Record payment instructions, final settlement, and case closure.' },
  { id: 'buyer_invoices_manage', label: 'Manage Buyer Invoice Settings', description: 'Change the shared internal report schedule and template.' },
  { id: 'cashflow_forecast_manage', label: 'Manage Cashflow Settings', description: 'Change forecast assumptions and blocked dates.' },
];
const ADMIN_CAPABILITY_IDS = new Set(ADMIN_CAPABILITIES.map((capability) => capability.id));
const ADMIN_FULL_CAPABILITIES = Object.fromEntries(ADMIN_CAPABILITIES.map((capability) => [capability.id, true]));
const REPORT_ARCHIVE_MODULE_ID = 'report_archive';
const REPORT_ARCHIVE_MANAGE_MODULE_ID = 'report_archive_manage';
const DEFAULT_USER_TYPES = [
  { id: 'administrator', label: 'Administrator', description: 'Full system administration access.', is_system: true, sort_order: 10 },
  { id: 'manager', label: 'Manager', description: 'Operational management access without user administration.', is_system: true, sort_order: 20 },
  { id: 'finance', label: 'Finance', description: 'Finance, invoice, report, and commission review access.', is_system: true, sort_order: 30 },
  { id: 'operations', label: 'Operations', description: 'Operational review and dispute workflow access.', is_system: true, sort_order: 40 },
  { id: 'interoffice', label: 'Interoffice', description: 'Finance-style access with FRATELLI COSULICH buyer-group STEMs excluded from Salesforce data.', is_system: true, sort_order: 45 },
  { id: 'viewer', label: 'Viewer', description: 'Read-only dashboard access.', is_system: true, sort_order: 50 },
];
const FALLBACK_TYPE_PERMISSIONS = {
  administrator: ADMIN_FULL_ACCESS,
  manager: { dashboard: true, review: true, disputes: true, buyer_invoices: true, incoming_payments: true, cashflow_forecast: true, pnl: true, brokers: true, report_archive: true, buyers_administrator: false, settings: true, admin: false },
  finance: { dashboard: true, review: true, disputes: true, buyer_invoices: true, incoming_payments: true, cashflow_forecast: true, pnl: true, brokers: true, report_archive: true, buyers_administrator: false, settings: false, admin: false },
  operations: { dashboard: true, review: true, disputes: true, buyer_invoices: false, incoming_payments: true, cashflow_forecast: false, pnl: true, brokers: false, report_archive: false, buyers_administrator: false, settings: false, admin: false },
  interoffice: { dashboard: true, review: true, disputes: true, buyer_invoices: true, incoming_payments: true, cashflow_forecast: true, pnl: true, brokers: true, report_archive: false, buyers_administrator: false, settings: false, admin: false },
  viewer: { dashboard: true, review: false, disputes: false, buyer_invoices: false, incoming_payments: true, cashflow_forecast: false, pnl: false, brokers: false, report_archive: false, buyers_administrator: false, settings: false, admin: false },
};
const FALLBACK_TYPE_CAPABILITIES = {
  administrator: ADMIN_FULL_CAPABILITIES,
  manager: { disputes_approve: true, disputes_account: false, buyer_invoices_manage: true, cashflow_forecast_manage: true },
  finance: { disputes_approve: false, disputes_account: true, buyer_invoices_manage: true, cashflow_forecast_manage: true },
  operations: { disputes_approve: false, disputes_account: false, buyer_invoices_manage: false, cashflow_forecast_manage: false },
  interoffice: { disputes_approve: false, disputes_account: false, buyer_invoices_manage: false, cashflow_forecast_manage: false },
  viewer: { disputes_approve: false, disputes_account: false, buyer_invoices_manage: false, cashflow_forecast_manage: false },
};
const INTEROFFICE_USER_TYPE_ID = 'interoffice';
const INTEROFFICE_EXCLUDED_BUYER_GROUP = 'FRATELLI COSULICH';

function reportArchiveAccessLevel(value, canView = undefined) {
  if (value === 'full' || value === true) return 'full';
  if (value === 'read') return 'read';
  if (canView === true) return 'full';
  return 'none';
}

function permissionCanView(moduleId, value) {
  if (moduleId === REPORT_ARCHIVE_MODULE_ID) return reportArchiveAccessLevel(value) !== 'none';
  return value === true;
}

function permissionValueFromRow(row) {
  return row?.can_view === true;
}

function normalizedPermissionForModule(moduleId, permissions = {}, fallback = undefined) {
  const raw = Object.prototype.hasOwnProperty.call(permissions, moduleId)
    ? permissions[moduleId]
    : fallback;
  if (moduleId === REPORT_ARCHIVE_MODULE_ID) return reportArchiveAccessLevel(raw);
  return raw === true;
}

function reportArchiveAccessFromRows(rows = [], fallback = false) {
  const reportRow = rows.find((row) => row.module_id === REPORT_ARCHIVE_MODULE_ID);
  const manageRow = rows.find((row) => row.module_id === REPORT_ARCHIVE_MANAGE_MODULE_ID);
  const canViewArchive = reportRow ? reportRow.can_view === true : fallback === true;
  if (!canViewArchive) return 'none';
  if (!manageRow) return 'full';
  return manageRow.can_view === true ? 'full' : 'read';
}

function appError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function redactedRequestUrl(req) {
  try {
    const url = new URL(req?.url || '', 'http://localhost');
    url.searchParams.delete('access_token');
    url.searchParams.delete('token');
    const query = url.searchParams.toString();
    return `${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return String(req?.url || '').replace(/([?&](?:access_token|token)=)[^&]+/gi, '$1[redacted]');
  }
}

function supabaseUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
}

let cachedSupabaseAdmin = null;

function supabaseAdminClient() {
  const url = supabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw appError('Missing Supabase server configuration. Set SUPABASE_URL or VITE_SUPABASE_URL, plus SUPABASE_SERVICE_ROLE_KEY in Vercel.', 500);
  }
  if (!cachedSupabaseAdmin) {
    cachedSupabaseAdmin = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return cachedSupabaseAdmin;
}

function bearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  if (match?.[1]) return match[1];

  try {
    const url = new URL(req?.url || '', 'http://localhost');
    return url.searchParams.get('access_token') || url.searchParams.get('token') || null;
  } catch {
    return null;
  }
}

async function requireAdministrator(req) {
  const context = await requireActiveUser(req);
  if (context.profile.user_type !== 'administrator') {
    throw appError('Administrator access required.', 403);
  }
  return context;
}

function safeSupabaseAdminClient() {
  try {
    return supabaseAdminClient();
  } catch {
    return null;
  }
}

async function requireActiveUser(req) {
  const token = bearerToken(req);
  if (!token) throw appError('Sign-in required.', 401);

  const client = supabaseAdminClient();
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData?.user) throw appError('Invalid or expired session. Sign in again.', 401);

  const { data: profile, error: profileError } = await client
    .from('user_profiles')
    .select('id,email,full_name,user_type,active,use_type_defaults')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw appError('User is not registered.', 403);
  if (!profile.active) throw appError('User is inactive.', 403);

  return { client, authUser: userData.user, profile };
}

async function authContext(body, req, accessContext) {
  const { client, authUser, profile } = accessContext || await requireActiveUser(req);
  let permissionValues;

  if (profile.user_type === 'administrator') {
    permissionValues = ADMIN_FULL_ACCESS;
  } else {
    const permissionQuery = profile.use_type_defaults === false
      ? client
        .from('user_module_permissions')
        .select('module_id,can_view')
        .eq('user_id', profile.id)
      : client
        .from('user_type_module_permissions')
        .select('module_id,can_view')
        .eq('user_type_id', profile.user_type);
    const { data: rows, error } = await permissionQuery;
    if (error) throw error;

    const fallback = profile.use_type_defaults === false
      ? {}
      : (FALLBACK_TYPE_PERMISSIONS[profile.user_type] || {});
    const rawPermissions = { ...fallback };
    for (const row of rows || []) {
      if (ADMIN_MODULE_IDS.has(row.module_id)) rawPermissions[row.module_id] = row.can_view === true;
    }
    rawPermissions[REPORT_ARCHIVE_MODULE_ID] = reportArchiveAccessFromRows(
      rows || [],
      fallback[REPORT_ARCHIVE_MODULE_ID],
    );
    permissionValues = normalizePermissions(profile.user_type, rawPermissions);
  }

  const moduleAccess = Object.fromEntries(ADMIN_APP_MODULES.map((module) => [
    module.id,
    permissionCanView(module.id, permissionValues[module.id]),
  ]));

  return {
    user: {
      id: profile.id,
      full_name: profile.full_name || authUser.user_metadata?.full_name || profile.email || authUser.email,
      email: profile.email || authUser.email,
      role: profile.user_type === 'administrator' ? 'admin' : profile.user_type,
      user_type: profile.user_type,
      use_type_defaults: profile.use_type_defaults !== false,
      active: profile.active === true,
    },
    moduleAccess,
    moduleAccessLevels: {
      [REPORT_ARCHIVE_MODULE_ID]: reportArchiveAccessLevel(permissionValues[REPORT_ARCHIVE_MODULE_ID]),
    },
  };
}

function normalizePermissions(userType, permissions = {}) {
  if (userType === 'administrator') return ADMIN_FULL_ACCESS;
  const normalized = {};
  for (const module of ADMIN_APP_MODULES) {
    normalized[module.id] = normalizedPermissionForModule(module.id, permissions, false);
  }
  return normalized;
}

function slugifyUserTypeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function normalizeUserTypePermissions(userTypeId, permissions = {}) {
  if (userTypeId === 'administrator') return ADMIN_FULL_ACCESS;
  const base = FALLBACK_TYPE_PERMISSIONS[userTypeId] || {};
  const normalized = {};
  for (const module of ADMIN_APP_MODULES) {
    normalized[module.id] = normalizedPermissionForModule(module.id, permissions, base[module.id] ?? false);
  }
  return normalized;
}

function normalizeCapabilities(userTypeId, capabilities = {}) {
  if (userTypeId === 'administrator') return ADMIN_FULL_CAPABILITIES;
  const fallback = FALLBACK_TYPE_CAPABILITIES[userTypeId] || {};
  return Object.fromEntries(ADMIN_CAPABILITIES.map((capability) => [
    capability.id,
    Object.prototype.hasOwnProperty.call(capabilities, capability.id)
      ? capabilities[capability.id] === true
      : fallback[capability.id] === true,
  ]));
}

async function listAccessModel(client) {
  const [typesRes, permissionsRes] = await Promise.all([
    client
      .from('user_types')
      .select('id,label,description,is_system,sort_order,created_at,updated_at')
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true }),
    client
      .from('user_type_module_permissions')
      .select('user_type_id,module_id,can_view'),
  ]);
  if (typesRes.error) throw typesRes.error;
  if (permissionsRes.error) throw permissionsRes.error;

  const userTypes = (typesRes.data?.length ? typesRes.data : DEFAULT_USER_TYPES).map((type) => ({
    ...type,
    label: type.label || type.id,
    description: type.description || '',
    is_system: type.is_system === true,
    sort_order: Number(type.sort_order ?? 100),
  }));
  const typePermissions = Object.fromEntries(userTypes.map((type) => [type.id, normalizeUserTypePermissions(type.id)]));
  const typeCapabilities = Object.fromEntries(userTypes.map((type) => [type.id, normalizeCapabilities(type.id)]));
  const manageRowsByType = {};
  for (const row of permissionsRes.data || []) {
    if (row.module_id === REPORT_ARCHIVE_MANAGE_MODULE_ID) {
      manageRowsByType[row.user_type_id] = row.can_view === true;
      continue;
    }
    if (ADMIN_CAPABILITY_IDS.has(row.module_id)) {
      if (!typeCapabilities[row.user_type_id]) typeCapabilities[row.user_type_id] = normalizeCapabilities(row.user_type_id);
      typeCapabilities[row.user_type_id][row.module_id] = row.can_view === true;
      continue;
    }
    if (!ADMIN_MODULE_IDS.has(row.module_id)) continue;
    if (!typePermissions[row.user_type_id]) typePermissions[row.user_type_id] = normalizeUserTypePermissions(row.user_type_id);
    typePermissions[row.user_type_id][row.module_id] = permissionValueFromRow(row);
  }
  for (const type of userTypes) {
    if (typePermissions[type.id]?.[REPORT_ARCHIVE_MODULE_ID] === true) {
      typePermissions[type.id][REPORT_ARCHIVE_MODULE_ID] = Object.prototype.hasOwnProperty.call(manageRowsByType, type.id)
        ? (manageRowsByType[type.id] ? 'full' : 'read')
        : 'full';
    }
    typePermissions[type.id] = normalizeUserTypePermissions(type.id, typePermissions[type.id]);
    typeCapabilities[type.id] = normalizeCapabilities(type.id, typeCapabilities[type.id]);
  }
  return { userTypes, typePermissions, typeCapabilities };
}

const AUTH_EXEMPT_HANDLERS = new Set([
  'adminBootstrap',
  'outstandingBuyerInvoicesEmailCron',
]);

const HANDLER_MODULE_ACCESS = {
  authContext: [],
  salesforceDashboard: ['dashboard'],
  salesforceDashboardFiltered: ['dashboard', 'review'],
  salesforceTopBuyers: ['dashboard'],
  salesforceStemDetail: ['dashboard', 'review', 'disputes', 'buyer_invoices', 'cashflow_forecast', 'pnl', 'brokers'],
  salesforceStemDocuments: ['dashboard', 'review', 'disputes', 'buyer_invoices', 'cashflow_forecast', 'pnl', 'brokers'],
  salesforceDocumentDownload: ['dashboard', 'review', 'disputes', 'buyer_invoices', 'pnl', 'brokers'],
  exceptionReviewWorkflowList: ['review'],
  exceptionReviewWorkflowSave: ['review'],
  salesforceDisputeStems: ['disputes'],
  disputeBetaList: ['disputes'],
  disputeBetaSaveDraft: ['disputes'],
  disputeBetaSubmitApproval: ['disputes'],
  disputeBetaApprove: ['disputes'],
  disputeBetaReject: ['disputes'],
  disputeBetaMarkExecuted: ['disputes'],
  disputeBetaClose: ['disputes'],
  disputeWorkflowList: ['disputes'],
  disputeWorkflowSaveDraft: ['disputes'],
  disputeWorkflowSubmitApproval: ['disputes'],
  disputeWorkflowApprove: ['disputes'],
  disputeWorkflowReject: ['disputes'],
  disputeWorkflowAccountingUpdate: ['disputes'],
  disputeWorkflowSupplierInstructionUpdate: ['disputes'],
  disputeWorkflowSupplierOffsetOptions: ['disputes'],
  disputeWorkflowSupplierAmountAmend: ['disputes'],
  disputeWorkflowUploadDocument: ['disputes'],
  disputeWorkflowDocuments: ['disputes'],
  disputeWorkflowMarkExecuted: ['disputes'],
  disputeWorkflowClose: ['disputes'],
  salesforceBuyerInvoicesDue: ['buyer_invoices'],
  buyerInvoiceCollectionList: ['buyer_invoices'],
  buyerInvoiceCollectionSave: ['buyer_invoices'],
  buyerInvoiceCollectionEventCreate: ['buyer_invoices'],
  buyerInvoiceEmailSettingsGet: ['buyer_invoices'],
  buyerInvoiceEmailSettingsSave: ['buyer_invoices'],
  buyerInvoiceReminderRulesList: ['buyer_invoices'],
  buyerInvoiceReminderRuleSave: ['buyer_invoices'],
  buyerInvoiceReminderRuleRemove: ['buyer_invoices'],
  buyerInvoicePaymentReminderPrepare: ['buyer_invoices'],
  buyerInvoicePaymentReminderSend: ['buyer_invoices'],
  outstandingBuyerInvoicesEmailReport: ['buyer_invoices'],
  incomingPaymentsList: ['incoming_payments'],
  incomingPaymentEmailReport: ['incoming_payments'],
  incomingPaymentInterestInvoiceRequest: ['incoming_payments'],
  incomingPaymentSettingsGet: ['incoming_payments'],
  incomingPaymentSettingsSave: ['incoming_payments'],
  incomingPaymentAllocationConfirm: ['incoming_payments'],
  cashflowForecast: ['cashflow_forecast'],
  cashflowBuyerPaymentPerformance: ['cashflow_forecast'],
  cashflowSettingsGet: ['cashflow_forecast'],
  cashflowSettingsSave: ['cashflow_forecast'],
  cashflowHolidayCalendar: ['cashflow_forecast'],
  stemPnl: ['pnl'],
  salesforceBrokerRegister: ['brokers'],
  frankfurterUsdCnyRate: ['brokers'],
  reportExportCreate: ['brokers', 'report_archive'],
  reportExportsList: ['report_archive'],
  reportExportRename: ['report_archive'],
  reportExportDelete: ['report_archive'],
  reportExportDownload: ['report_archive'],
  buyersAdministratorList: ['buyers_administrator'],
  buyersAdministratorSave: ['buyers_administrator'],
  accountManagersList: ['buyers_administrator'],
  accountManagersSave: ['buyers_administrator'],
  accountManagersSaveNote: ['buyers_administrator'],
  accountManagersRetrySync: ['buyers_administrator'],
  systemHealth: ['settings'],
  backboneBridgeIdentity: ['settings'],
  backboneTradeProjection: ['dashboard', 'review', 'disputes', 'buyer_invoices', 'incoming_payments', 'cashflow_forecast', 'pnl', 'brokers'],
  backboneFinanceHandoffs: ['review'],
  backboneFinanceHandoffDetail: ['review'],
  salesforceSchema: ['admin'],
  salesforceObjectFields: ['admin'],
  salesforceFullSchema: ['admin'],
  salesforceQuery: ['dashboard'],
  salesforceDescribeChildren: ['admin'],
  adminUsersList: ['admin'],
  adminAuditLogs: ['admin'],
  adminUserSave: ['admin'],
  adminUserDelete: ['admin'],
  adminUserTypeSave: ['admin'],
  adminUserTypeDelete: ['admin'],
  universalAuditTrail: ['admin'],
};

async function userHasAnyModuleAccess(client, profile, moduleIds) {
  if (!moduleIds?.length) return true;
  if (profile?.user_type === 'administrator') return true;

  const validModuleIds = moduleIds.filter((moduleId) => ADMIN_MODULE_IDS.has(moduleId));
  if (!validModuleIds.length) return false;

  if (profile?.use_type_defaults === false) {
    const { data, error } = await client
      .from('user_module_permissions')
      .select('module_id,can_view')
      .eq('user_id', profile.id)
      .in('module_id', validModuleIds);
    if (error) throw error;
    return (data || []).some((row) => row.can_view === true);
  }

  const { data, error } = await client
    .from('user_type_module_permissions')
    .select('module_id,can_view')
    .eq('user_type_id', profile.user_type)
    .in('module_id', validModuleIds);
  if (error) throw error;
  if ((data || []).length) return (data || []).some((row) => row.can_view === true);

  const fallback = FALLBACK_TYPE_PERMISSIONS[profile?.user_type] || {};
  return validModuleIds.some((moduleId) => fallback[moduleId] === true);
}

async function userHasCapability(client, profile, capabilityId) {
  if (!ADMIN_CAPABILITY_IDS.has(capabilityId)) return false;
  if (profile?.user_type === 'administrator') return true;

  const { data: userPermission, error: userError } = await client
    .from('user_module_permissions')
    .select('can_view')
    .eq('user_id', profile?.id)
    .eq('module_id', capabilityId)
    .maybeSingle();
  if (userError) throw userError;
  if (userPermission) return userPermission.can_view === true;

  const { data: typePermission, error: typeError } = await client
    .from('user_type_module_permissions')
    .select('can_view')
    .eq('user_type_id', profile?.user_type)
    .eq('module_id', capabilityId)
    .maybeSingle();
  if (typeError) throw typeError;
  if (typePermission) return typePermission.can_view === true;

  return FALLBACK_TYPE_CAPABILITIES[profile?.user_type]?.[capabilityId] === true;
}

async function requireCapability(client, profile, capabilityId, message) {
  if (!await userHasCapability(client, profile, capabilityId)) {
    throw appError(message || 'You do not have permission for this action.', 403);
  }
}

async function reportArchiveAccessForUser(client, profile) {
  if (profile?.user_type === 'administrator') return 'full';
  if (profile?.use_type_defaults === false) {
    const { data, error } = await client
      .from('user_module_permissions')
      .select('module_id,can_view')
      .eq('user_id', profile.id)
      .in('module_id', [REPORT_ARCHIVE_MODULE_ID, REPORT_ARCHIVE_MANAGE_MODULE_ID]);
    if (error) throw error;
    return reportArchiveAccessFromRows(data || []);
  }

  const { data, error } = await client
    .from('user_type_module_permissions')
    .select('module_id,can_view')
    .eq('user_type_id', profile?.user_type)
    .in('module_id', [REPORT_ARCHIVE_MODULE_ID, REPORT_ARCHIVE_MANAGE_MODULE_ID]);
  if (error) throw error;

  const fallback = FALLBACK_TYPE_PERMISSIONS[profile?.user_type] || {};
  return reportArchiveAccessFromRows(data || [], fallback[REPORT_ARCHIVE_MODULE_ID]);
}

async function requireReportArchiveFullAccess(client, profile) {
  const accessLevel = await reportArchiveAccessForUser(client, profile);
  if (accessLevel !== 'full') {
    throw appError('Full Reports Archive access is required for this action.', 403);
  }
}

function isInterofficeAccess(accessContext) {
  return accessContext?.profile?.user_type === INTEROFFICE_USER_TYPE_ID;
}

function fieldNameSetFrom(input) {
  if (!input) return new Set();
  if (input instanceof Set) return input;
  return new Set(input.map((field) => (typeof field === 'string' ? field : field?.name)).filter(Boolean));
}

function combineWhereConditions(conditions = []) {
  return conditions.filter(Boolean).map((condition) => `(${condition})`).join(' AND ');
}

let cachedAccountFieldNameSet = null;

async function accountFieldNameSet() {
  if (cachedAccountFieldNameSet) return cachedAccountFieldNameSet;
  const describe = await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({ fields: [] }));
  cachedAccountFieldNameSet = fieldNameSetFrom(describe.fields || []);
  return cachedAccountFieldNameSet;
}

async function interofficeStemAccessCondition(accessContext, stemFields = null, accountFields = null) {
  if (!isInterofficeAccess(accessContext)) return '';
  const stemFieldNames = stemFields ? fieldNameSetFrom(stemFields) : fieldNameSetFrom((await salesforceObjectFields({ objectName: 'stem__c' }).catch(() => ({ fields: [] }))).fields || []);
  if (!stemFieldNames.has('Account__c')) return '';
  const accountFieldNames = accountFields ? fieldNameSetFrom(accountFields) : await accountFieldNameSet();
  const escapedGroup = escapeSoql(INTEROFFICE_EXCLUDED_BUYER_GROUP);
  const conditions = [];
  if (accountFieldNames.has('Group_Name__c')) {
    conditions.push(`(Account__r.Group_Name__c = null OR Account__r.Group_Name__c != '${escapedGroup}')`);
  }
  if (accountFieldNames.has('ParentId')) {
    conditions.push(`(Account__r.Parent.Name = null OR Account__r.Parent.Name != '${escapedGroup}')`);
  }
  return combineWhereConditions(conditions);
}

async function requireInterofficeStemAccess(stemId, accessContext) {
  const condition = await interofficeStemAccessCondition(accessContext);
  if (!condition || !stemId) return;
  const rows = await queryRows(`
    SELECT Id
    FROM stem__c
    WHERE Id = '${escapeSoql(stemId)}' AND ${condition}
    LIMIT 1
  `, { limit: 1, softFail: true });
  if (!rows.length) throw appError('This STEM is not available for Interoffice users.', 403);
}

async function requireHandlerAccess(name, req) {
  if (AUTH_EXEMPT_HANDLERS.has(name)) return null;
  const context = await requireActiveUser(req);
  const allowed = await userHasAnyModuleAccess(context.client, context.profile, HANDLER_MODULE_ACCESS[name] || []);
  if (!allowed) throw appError('You do not have access to this module.', 403);
  return context;
}

const EXCEPTION_REVIEW_STATUSES = ['Open', 'Acknowledged', 'In Progress', 'Resolved', 'Dismissed'];
const EXCEPTION_REVIEW_DEPARTMENTS = ['Unassigned', 'Trading', 'Operations', 'Accounting', 'Management'];
const EXCEPTION_REVIEW_PRIORITIES = ['High', 'Medium', 'Low'];

function serializeExceptionReviewItem(row) {
  if (!row) return null;
  return {
    stemId: row.stem_id,
    status: row.status,
    department: row.department,
    ownerUserId: row.owner_user_id || null,
    ownerName: row.owner_name || '',
    priority: row.priority,
    dueDate: row.due_date || null,
    latestNote: row.latest_note || '',
    resolutionNote: row.resolution_note || '',
    lastEventAt: row.last_event_at || null,
    lastUpdatedByEmail: row.last_updated_by_email || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function serializeExceptionReviewEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    stemId: row.stem_id,
    eventType: row.event_type,
    status: row.status || null,
    department: row.department || null,
    ownerName: row.owner_name || '',
    priority: row.priority || null,
    dueDate: row.due_date || null,
    note: row.note || '',
    actorEmail: row.actor_email || null,
    createdAt: row.created_at || null,
  };
}

async function exceptionReviewWorkflowList(body = {}, req = null, accessContext = null) {
  const context = accessContext || await requireActiveUser(req);
  const { client } = context;
  const stemIds = [...new Set((Array.isArray(body.stemIds) ? body.stemIds : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))].slice(0, 500);
  await Promise.all(stemIds.map((stemId) => requireInterofficeStemAccess(stemId, context)));

  const [itemsResult, eventsResult, ownersResult] = await Promise.all([
    stemIds.length
      ? client.from('exception_review_items').select('*').in('stem_id', stemIds)
      : Promise.resolve({ data: [], error: null }),
    stemIds.length
      ? client.from('exception_review_events').select('*').in('stem_id', stemIds).order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    client.from('user_profiles').select('id,email,full_name,user_type').eq('active', true).order('full_name'),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (eventsResult.error) throw eventsResult.error;
  if (ownersResult.error) throw ownersResult.error;

  const eventsByStem = {};
  for (const row of eventsResult.data || []) {
    if (!eventsByStem[row.stem_id]) eventsByStem[row.stem_id] = [];
    eventsByStem[row.stem_id].push(serializeExceptionReviewEvent(row));
  }
  const byStemId = Object.fromEntries((itemsResult.data || []).map((row) => [row.stem_id, {
    ...serializeExceptionReviewItem(row),
    events: eventsByStem[row.stem_id] || [],
  }]));
  return {
    byStemId,
    ownerOptions: (ownersResult.data || []).map((owner) => ({
      id: owner.id,
      name: owner.full_name || owner.email,
      email: owner.email,
      userType: owner.user_type,
    })),
    statuses: EXCEPTION_REVIEW_STATUSES,
    departments: EXCEPTION_REVIEW_DEPARTMENTS,
    priorities: EXCEPTION_REVIEW_PRIORITIES,
  };
}

async function exceptionReviewWorkflowSave(body = {}, req = null, accessContext = null) {
  const context = accessContext || await requireActiveUser(req);
  const { client, profile } = context;
  const stemId = String(body.stemId || '').trim();
  if (!stemId) throw appError('STEM is required.', 400);
  await requireInterofficeStemAccess(stemId, context);
  const status = EXCEPTION_REVIEW_STATUSES.includes(body.status) ? body.status : 'Open';
  const department = EXCEPTION_REVIEW_DEPARTMENTS.includes(body.department) ? body.department : 'Unassigned';
  const priority = EXCEPTION_REVIEW_PRIORITIES.includes(body.priority) ? body.priority : 'High';
  const ownerUserId = String(body.ownerUserId || '').trim() || null;
  let ownerName = '';
  if (ownerUserId) {
    const { data: owner, error: ownerError } = await client
      .from('user_profiles')
      .select('id,email,full_name,active')
      .eq('id', ownerUserId)
      .eq('active', true)
      .maybeSingle();
    if (ownerError) throw ownerError;
    if (!owner) throw appError('The selected owner is no longer active.', 400);
    ownerName = owner.full_name || owner.email;
  }
  const latestNote = String(body.latestNote || '').trim();
  const resolutionNote = String(body.resolutionNote || '').trim();
  if ((status === 'Resolved' || status === 'Dismissed') && !resolutionNote) {
    throw appError('A resolution note is required before resolving or dismissing an exception.', 400);
  }
  const { data, error } = await client.rpc('save_exception_review_item', {
    p_stem_id: stemId,
    p_updates: {
      status,
      department,
      owner_user_id: ownerUserId,
      owner_name: ownerName,
      priority,
      due_date: body.dueDate || null,
      latest_note: latestNote,
      resolution_note: resolutionNote,
    },
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_updated_at: body.expectedUpdatedAt || null,
  });
  if (error) {
    if (/changed after it was opened/i.test(error.message || '')) throw appError(error.message, 409);
    throw error;
  }
  return {
    item: serializeExceptionReviewItem(data?.item),
    event: serializeExceptionReviewEvent(data?.event),
  };
}

async function sanitizeManagedUserPayload(client, body = {}) {
  const email = String(body.email || '').trim().toLowerCase();
  const fullName = String(body.full_name || body.fullName || '').trim();
  const { userTypes, typePermissions, typeCapabilities } = await listAccessModel(client);
  const typeIds = new Set(userTypes.map((type) => type.id));
  const userType = typeIds.has(body.user_type) ? body.user_type : 'viewer';
  const active = body.active !== false;
  const password = String(body.password || '');
  const id = body.id ? String(body.id) : null;
  const useTypeDefaults = userType === 'administrator' ? true : body.use_type_defaults !== false;

  if (!email || !email.includes('@')) throw appError('Valid email is required.', 400);
  if (!id && password.length < 8) throw appError('Password must be at least 8 characters.', 400);
  if (id && password && password.length < 8) throw appError('New password must be at least 8 characters.', 400);

  return {
    id,
    email,
    full_name: fullName || email,
    user_type: userType,
    active,
    password,
    use_type_defaults: useTypeDefaults,
    permissions: useTypeDefaults
      ? normalizePermissions(userType, typePermissions[userType] || {})
      : normalizePermissions(userType, body.permissions || {}),
    capabilities: useTypeDefaults
      ? normalizeCapabilities(userType, typeCapabilities[userType] || {})
      : normalizeCapabilities(userType, body.capabilities || {}),
  };
}

async function findAuthUserByEmail(client, email) {
  const target = String(email || '').toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = (data?.users || []).find((user) => String(user.email || '').toLowerCase() === target);
    if (found) return found;
    if (!data?.users?.length || data.users.length < 1000) break;
  }
  return null;
}

async function writeAdminAudit(client, actor, action, targetUserId, targetEmail, metadata = {}) {
  const row = {
    actor_user_id: actor?.id || null,
    actor_email: actor?.email || null,
    action,
    target_user_id: targetUserId || null,
    target_email: targetEmail || null,
    metadata,
  };
  const { error } = await client.from('admin_audit_logs').insert(row);
  if (error) console.error('Failed to write admin audit log', error.message);
}

async function ensureReportArchiveManageModule(client) {
  const { error } = await client
    .from('app_modules')
    .upsert({
      id: REPORT_ARCHIVE_MANAGE_MODULE_ID,
      label: 'Reports Archive Management',
      path: '/report-archive',
      sort_order: 76,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
  if (error) throw error;
}

async function persistManagedUser(client, body, actor = null) {
  const payload = await sanitizeManagedUserPayload(client, body);
  let authUser = null;
  const isUpdate = Boolean(payload.id);

  if (isUpdate) {
    const updatePayload = {
      email: payload.email,
      user_metadata: { full_name: payload.full_name },
      app_metadata: { user_type: payload.user_type },
    };
    if (payload.password) updatePayload.password = payload.password;
    const { data, error } = await client.auth.admin.updateUserById(payload.id, updatePayload);
    if (error) throw error;
    authUser = data.user;
  } else {
    const existing = await findAuthUserByEmail(client, payload.email);
    if (existing) {
      authUser = existing;
      const updatePayload = {
        user_metadata: { full_name: payload.full_name },
        app_metadata: { user_type: payload.user_type },
      };
      if (payload.password) updatePayload.password = payload.password;
      const { error } = await client.auth.admin.updateUserById(existing.id, updatePayload);
      if (error) throw error;
    } else {
      const { data, error } = await client.auth.admin.createUser({
        email: payload.email,
        password: payload.password,
        email_confirm: true,
        user_metadata: { full_name: payload.full_name },
        app_metadata: { user_type: payload.user_type },
      });
      if (error) throw error;
      authUser = data.user;
    }
  }

  if (!authUser?.id) throw appError('Supabase did not return a user id.', 500);

  const nowIso = new Date().toISOString();
  const { error: profileError } = await client
    .from('user_profiles')
    .upsert({
      id: authUser.id,
      email: payload.email,
      full_name: payload.full_name,
      user_type: payload.user_type,
      active: payload.active,
      use_type_defaults: payload.use_type_defaults,
      updated_at: nowIso,
    }, { onConflict: 'id' });
  if (profileError) throw profileError;

  const { error: deletePermissionError } = await client
    .from('user_module_permissions')
    .delete()
    .eq('user_id', authUser.id);
  if (deletePermissionError) throw deletePermissionError;

  if (!payload.use_type_defaults) {
    await ensureReportArchiveManageModule(client);
    const permissionRows = ADMIN_APP_MODULES.map((module) => ({
      user_id: authUser.id,
      module_id: module.id,
      can_view: permissionCanView(module.id, payload.permissions[module.id]),
      updated_at: nowIso,
    }));
    permissionRows.push({
      user_id: authUser.id,
      module_id: REPORT_ARCHIVE_MANAGE_MODULE_ID,
      can_view: reportArchiveAccessLevel(payload.permissions[REPORT_ARCHIVE_MODULE_ID]) === 'full',
      updated_at: nowIso,
    });
    permissionRows.push(...ADMIN_CAPABILITIES.map((capability) => ({
      user_id: authUser.id,
      module_id: capability.id,
      can_view: payload.capabilities[capability.id] === true,
      updated_at: nowIso,
    })));
    const { error: insertPermissionError } = await client
      .from('user_module_permissions')
      .insert(permissionRows);
    if (insertPermissionError) throw insertPermissionError;
  }

  await writeAdminAudit(client, actor, isUpdate ? 'user_updated' : 'user_created', authUser.id, payload.email, {
    user_type: payload.user_type,
    active: payload.active,
    use_type_defaults: payload.use_type_defaults,
    modules: Object.entries(payload.permissions)
      .filter(([moduleId, value]) => permissionCanView(moduleId, value))
      .map(([moduleId]) => moduleId),
    access_levels: {
      [REPORT_ARCHIVE_MODULE_ID]: reportArchiveAccessLevel(payload.permissions[REPORT_ARCHIVE_MODULE_ID]),
    },
    capabilities: Object.entries(payload.capabilities).filter(([, allowed]) => allowed).map(([id]) => id),
  });

  return {
    id: authUser.id,
    email: payload.email,
    full_name: payload.full_name,
    user_type: payload.user_type,
    active: payload.active,
    use_type_defaults: payload.use_type_defaults,
    permissions: payload.permissions,
    capabilities: payload.capabilities,
  };
}

async function adminUsersList(body, req) {
  const { client } = await requireAdministrator(req);
  const { userTypes, typePermissions, typeCapabilities } = await listAccessModel(client);
  const { data: profiles, error: profileError } = await client
    .from('user_profiles')
    .select('id,email,full_name,user_type,active,use_type_defaults,created_at,updated_at')
    .order('created_at', { ascending: false });
  if (profileError) throw profileError;

  const userIds = (profiles || []).map((profile) => profile.id);
  let permissionRows = [];
  if (userIds.length) {
    const { data, error } = await client
      .from('user_module_permissions')
      .select('user_id,module_id,can_view')
      .in('user_id', userIds);
    if (error) throw error;
    permissionRows = data || [];
  }

  const permissionsByUser = {};
  const capabilitiesByUser = {};
  const manageRowsByUser = {};
  for (const row of permissionRows) {
    if (row.module_id === REPORT_ARCHIVE_MANAGE_MODULE_ID) {
      manageRowsByUser[row.user_id] = row.can_view === true;
      continue;
    }
    if (ADMIN_CAPABILITY_IDS.has(row.module_id)) {
      if (!capabilitiesByUser[row.user_id]) capabilitiesByUser[row.user_id] = {};
      capabilitiesByUser[row.user_id][row.module_id] = row.can_view === true;
      continue;
    }
    if (!ADMIN_MODULE_IDS.has(row.module_id)) continue;
    if (!permissionsByUser[row.user_id]) permissionsByUser[row.user_id] = {};
    permissionsByUser[row.user_id][row.module_id] = permissionValueFromRow(row);
  }
  for (const [userId, permissions] of Object.entries(permissionsByUser)) {
    if (permissions[REPORT_ARCHIVE_MODULE_ID] === true) {
      permissions[REPORT_ARCHIVE_MODULE_ID] = Object.prototype.hasOwnProperty.call(manageRowsByUser, userId)
        ? (manageRowsByUser[userId] ? 'full' : 'read')
        : 'full';
    }
  }

  const users = (profiles || []).map((profile) => ({
    ...profile,
    type_label: userTypes.find((type) => type.id === profile.user_type)?.label || profile.user_type,
    use_type_defaults: profile.user_type === 'administrator' ? true : profile.use_type_defaults !== false,
    permissions: profile.user_type === 'administrator'
      ? ADMIN_FULL_ACCESS
      : profile.use_type_defaults !== false
        ? normalizePermissions(profile.user_type, typePermissions[profile.user_type] || {})
        : normalizePermissions(profile.user_type, permissionsByUser[profile.id] || {}),
    capabilities: profile.user_type === 'administrator'
      ? ADMIN_FULL_CAPABILITIES
      : profile.use_type_defaults !== false
        ? normalizeCapabilities(profile.user_type, typeCapabilities[profile.user_type] || {})
        : normalizeCapabilities(profile.user_type, capabilitiesByUser[profile.id] || {}),
  }));
  return { users, modules: ADMIN_APP_MODULES, capabilities: ADMIN_CAPABILITIES, userTypes, typePermissions, typeCapabilities };
}

async function adminAuditLogs(body, req) {
  const { client } = await requireAdministrator(req);
  const limit = Math.max(10, Math.min(Number(body.limit) || 100, 500));
  const { data, error } = await client
    .from('admin_audit_logs')
    .select('id,created_at,actor_user_id,actor_email,action,target_user_id,target_email,metadata')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return { logs: data || [] };
}

function auditTableUnavailable(error) {
  return error?.code === '42P01' || /does not exist/i.test(error?.message || '');
}

async function safeAuditRows(promise, mapper) {
  const { data, error } = await promise;
  if (error) {
    if (auditTableUnavailable(error)) return [];
    throw error;
  }
  return (data || []).map(mapper);
}

function compactAuditSummary(parts = []) {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(' · ') || '—';
}

function normalizedAuditAction(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

async function universalAuditTrail(body, req) {
  const { client } = await requireAdministrator(req);
  const limit = Math.max(25, Math.min(Number(body.limit) || 300, 1000));
  const sourceFilter = String(body.source || 'all').trim();
  const keyword = String(body.keyword || '').trim().toLowerCase();
  const queryLimit = Math.max(100, Math.min(limit, 1000));

  const [adminRows, collectionRows, reportRows, interestRows, disputeRows, internalEmailRows] = await Promise.all([
    safeAuditRows(
      client
        .from('admin_audit_logs')
        .select('id,created_at,actor_email,action,target_user_id,target_email,metadata')
        .order('created_at', { ascending: false })
        .limit(queryLimit),
      (row) => ({
        id: `admin:${row.id}`,
        source: 'Admin Control',
        module: 'Admin',
        action: normalizedAuditAction(row.action),
        createdAt: row.created_at,
        actor: row.actor_email || 'System',
        target: row.target_email || row.target_user_id || '—',
        summary: compactAuditSummary([row.target_email || row.target_user_id, row.metadata?.user_type, row.metadata?.type_id]),
        metadata: row.metadata || {},
      })),
    safeAuditRows(
      client
        .from('buyer_invoice_collection_events')
        .select('id,stem_id,event_type,status,owner_name,note,next_follow_up_date,promised_payment_date,promised_amount,actor_email,created_at')
        .order('created_at', { ascending: false })
        .limit(queryLimit),
      (row) => ({
        id: `collection:${row.id}`,
        source: 'Buyer Invoice Collection',
        module: 'Outstanding Buyer Invoices',
        action: normalizedAuditAction(row.event_type),
        createdAt: row.created_at,
        actor: row.actor_email || 'System',
        target: row.stem_id || '—',
        summary: compactAuditSummary([row.status, row.owner_name, row.note, row.next_follow_up_date, row.promised_payment_date]),
        metadata: {
          status: row.status,
          ownerName: row.owner_name,
          note: row.note,
          nextFollowUpDate: row.next_follow_up_date,
          promisedPaymentDate: row.promised_payment_date,
          promisedAmount: row.promised_amount,
        },
      })),
    safeAuditRows(
      client
        .from('report_export_events')
        .select('id,report_export_id,event_type,actor_email,previous_file_name,new_file_name,metadata,created_at')
        .order('created_at', { ascending: false })
        .limit(queryLimit),
      (row) => ({
        id: `report:${row.id}`,
        source: 'Reports Archive',
        module: 'Reports Archive',
        action: normalizedAuditAction(row.event_type),
        createdAt: row.created_at,
        actor: row.actor_email || 'System',
        target: row.new_file_name || row.previous_file_name || row.report_export_id || '—',
        summary: compactAuditSummary([row.previous_file_name, row.new_file_name, row.metadata?.reportType || row.metadata?.report_type]),
        metadata: row.metadata || {},
      })),
    safeAuditRows(
      client
        .from('incoming_payment_interest_notifications')
        .select('id,payment_id,payment_name,stem_id,stem_name,buyer_name,buyer_group_name,delay_days,amount,currency,recipient_email,email_subject,actor_email,actor_name,metadata,sent_at,created_at')
        .order('sent_at', { ascending: false })
        .limit(queryLimit),
      (row) => ({
        id: `interest:${row.id}`,
        source: 'Late Payment Interest',
        module: 'Incoming Payment',
        action: row.metadata?.resent === true ? 'Interest Request Resent' : 'Interest Request Sent',
        createdAt: row.sent_at || row.created_at,
        actor: row.actor_email || row.actor_name || 'System',
        target: row.stem_name || row.stem_id || row.payment_name || row.payment_id || '—',
        summary: compactAuditSummary([row.buyer_name, row.recipient_email, row.delay_days != null ? `${row.delay_days} delay days` : '', row.email_subject]),
        metadata: row.metadata || {},
      })),
    safeAuditRows(
      client
        .from('dispute_beta_events')
        .select('id,stem_id,event_type,note,metadata,actor_email,created_at')
        .order('created_at', { ascending: false })
        .limit(queryLimit),
      (row) => ({
        id: `dispute:${row.id}`,
        source: 'Dispute Workflow',
        module: 'Dispute Workflow',
        action: normalizedAuditAction(row.event_type),
        createdAt: row.created_at,
        actor: row.actor_email || 'System',
        target: row.stem_id || '—',
        summary: compactAuditSummary([row.note, row.metadata?.workflowStatus, row.metadata?.approvalStatus]),
        metadata: row.metadata || {},
      })),
    safeAuditRows(
      client
        .from('buyer_invoice_email_runs')
        .select('id,run_key,schedule_time,status,rows_count,totals,error,provider_result,created_at,completed_at')
        .order('created_at', { ascending: false })
        .limit(queryLimit),
      (row) => ({
        id: `internal-email:${row.id}`,
        source: 'Internal Daily Report',
        module: 'Outstanding Buyer Invoices',
        action: normalizedAuditAction(row.status),
        createdAt: row.completed_at || row.created_at,
        actor: 'System',
        target: row.run_key || row.schedule_time || '—',
        summary: compactAuditSummary([row.schedule_time, row.rows_count != null ? `${row.rows_count} rows` : '', row.error]),
        metadata: {
          totals: row.totals || {},
          providerResult: row.provider_result || {},
        },
      })),
  ]);

  let rows = [
    ...adminRows,
    ...collectionRows,
    ...reportRows,
    ...interestRows,
    ...disputeRows,
    ...internalEmailRows,
  ].filter((row) => row.createdAt);

  if (sourceFilter && sourceFilter !== 'all') rows = rows.filter((row) => row.source === sourceFilter);
  if (keyword) {
    rows = rows.filter((row) => [
      row.source,
      row.module,
      row.action,
      row.actor,
      row.target,
      row.summary,
      JSON.stringify(row.metadata || {}),
    ].join(' ').toLowerCase().includes(keyword));
  }

  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const sources = [...new Set(rows.map((row) => row.source))].sort((a, b) => a.localeCompare(b));
  return { rows: rows.slice(0, limit), sources, total: rows.length };
}

async function adminUserSave(body, req) {
  const { client, profile } = await requireAdministrator(req);
  const user = await persistManagedUser(client, body, profile);
  return { user };
}

async function adminUserDelete(body, req) {
  const { client, authUser, profile } = await requireAdministrator(req);
  const userId = String(body.id || '');
  if (!userId) throw appError('User id is required.', 400);
  if (userId === authUser.id) throw appError('You cannot delete your own administrator account.', 400);

  const { data: target, error: targetError } = await client
    .from('user_profiles')
    .select('id,email,user_type')
    .eq('id', userId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw appError('User not found.', 404);

  const { error: deleteError } = await client.auth.admin.deleteUser(userId);
  if (deleteError) throw deleteError;

  await writeAdminAudit(client, profile, 'user_deleted', target.id, target.email, {
    user_type: target.user_type,
  });
  return { deleted: true, id: userId };
}

async function adminUserTypeSave(body, req) {
  const { client, profile } = await requireAdministrator(req);
  const existingId = body.id ? String(body.id) : null;
  const label = String(body.label || '').trim();
  const id = slugifyUserTypeId(existingId || label);
  if (!id) throw appError('User type name is required.', 400);
  if (!label) throw appError('User type label is required.', 400);

  const { data: existing, error: existingError } = await client
    .from('user_types')
    .select('id,is_system,sort_order')
    .eq('id', id)
    .maybeSingle();
  if (existingError) throw existingError;

  const sortOrder = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : existing?.sort_order ?? 100;
  const userType = {
    id,
    label,
    description: String(body.description || '').trim(),
    is_system: existing?.is_system === true,
    sort_order: sortOrder,
    updated_at: new Date().toISOString(),
  };
  const { error: typeError } = await client
    .from('user_types')
    .upsert(userType, { onConflict: 'id' });
  if (typeError) throw typeError;

  const permissions = normalizeUserTypePermissions(id, body.permissions || {});
  const capabilities = normalizeCapabilities(id, body.capabilities || {});
  await ensureReportArchiveManageModule(client);
  const { error: deletePermissionError } = await client
    .from('user_type_module_permissions')
    .delete()
    .eq('user_type_id', id);
  if (deletePermissionError) throw deletePermissionError;
  const { error: insertPermissionError } = await client
    .from('user_type_module_permissions')
    .insert([
      ...ADMIN_APP_MODULES.map((module) => ({
        user_type_id: id,
        module_id: module.id,
        can_view: permissionCanView(module.id, permissions[module.id]),
        updated_at: new Date().toISOString(),
      })),
      {
        user_type_id: id,
        module_id: REPORT_ARCHIVE_MANAGE_MODULE_ID,
        can_view: reportArchiveAccessLevel(permissions[REPORT_ARCHIVE_MODULE_ID]) === 'full',
        updated_at: new Date().toISOString(),
      },
      ...ADMIN_CAPABILITIES.map((capability) => ({
        user_type_id: id,
        module_id: capability.id,
        can_view: capabilities[capability.id] === true,
        updated_at: new Date().toISOString(),
      })),
    ]);
  if (insertPermissionError) throw insertPermissionError;

  await writeAdminAudit(client, profile, existing ? 'user_type_updated' : 'user_type_created', null, id, {
    label,
    modules: Object.entries(permissions)
      .filter(([moduleId, value]) => permissionCanView(moduleId, value))
      .map(([moduleId]) => moduleId),
    access_levels: {
      [REPORT_ARCHIVE_MODULE_ID]: reportArchiveAccessLevel(permissions[REPORT_ARCHIVE_MODULE_ID]),
    },
    capabilities: Object.entries(capabilities).filter(([, allowed]) => allowed).map(([capabilityId]) => capabilityId),
  });

  return { userType: { ...userType, permissions, capabilities } };
}

async function adminUserTypeDelete(body, req) {
  const { client, profile } = await requireAdministrator(req);
  const id = String(body.id || '').trim();
  if (!id) throw appError('User type id is required.', 400);
  if (id === 'administrator') throw appError('Administrator user type cannot be deleted.', 400);

  const { data: userType, error: typeError } = await client
    .from('user_types')
    .select('id,label,is_system')
    .eq('id', id)
    .maybeSingle();
  if (typeError) throw typeError;
  if (!userType) throw appError('User type not found.', 404);

  const { count, error: assignedError } = await client
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('user_type', id);
  if (assignedError) throw assignedError;
  if (count > 0) throw appError('This user type is assigned to users. Reassign those users before deleting it.', 400);

  const { error: deleteError } = await client
    .from('user_types')
    .delete()
    .eq('id', id);
  if (deleteError) throw deleteError;

  await writeAdminAudit(client, profile, 'user_type_deleted', null, id, {
    label: userType.label,
  });
  return { deleted: true, id };
}

async function adminBootstrap(body = {}) {
  const expectedSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!expectedSecret) throw appError('Missing ADMIN_BOOTSTRAP_SECRET in Vercel.', 500);
  if (String(body.bootstrapSecret || '') !== expectedSecret) throw appError('Invalid bootstrap secret.', 403);

  const client = supabaseAdminClient();
  const email = body.email || process.env.INITIAL_ADMIN_EMAIL;
  const password = body.password || process.env.INITIAL_ADMIN_PASSWORD;
  const fullName = body.full_name || body.fullName || 'Administrator';
  const user = await persistManagedUser(client, {
    email,
    password,
    full_name: fullName,
    user_type: 'administrator',
    active: true,
    permissions: ADMIN_FULL_ACCESS,
  }, { id: null, email: 'bootstrap' });

  return { bootstrapped: true, user: { id: user.id, email: user.email, full_name: user.full_name, user_type: user.user_type } };
}

function accountManagerStorageError(error) {
  const message = String(error?.message || '');
  if (error?.code === '42P01' || error?.code === 'PGRST205' || /account_manager_(?:groups|assignments|notes).*does not exist/i.test(message)) {
    return appError('Account Manager storage is not ready. Apply the latest Supabase migration and try again.', 503);
  }
  if (error?.code === 'PGRST202' || /(?:save|finalize)_account_manager/i.test(message) && /schema cache|could not find/i.test(message)) {
    return appError('Account Manager storage is not ready. Refresh the Supabase schema cache after applying the latest migration.', 503);
  }
  return error;
}

function accountManagerProfile(profile = {}) {
  return {
    id: profile.id,
    fullName: profile.full_name || profile.email || 'Unknown user',
    email: profile.email || '',
    userType: profile.user_type || '',
    active: profile.active === true,
  };
}

const ACCOUNT_MANAGER_ACCOUNT_FIELDS = [
  'Id',
  'Name',
  'Company_Code__c',
  'RecordType.Name',
  'ParentId',
  'Parent.Name',
  'Parent.Company_Code__c',
  'Buyer_Payment_Term__c',
  'Supplier_Payment_Term__c',
  'Is_Broker__c',
  'Inactive_Suspended__c',
  'Account_Manager__c',
];

let cachedAccountManagerSchema = null;

async function accountManagerSchema() {
  if (cachedAccountManagerSchema) return cachedAccountManagerSchema;
  const describe = await sfRequest('/sobjects/Account/describe/');
  const fieldsByName = new Map((describe.fields || []).map((field) => [field.name, field]));
  const requiredFields = [
    ['ParentId', 'reference'],
    ['Company_Code__c', 'string'],
    ['Buyer_Payment_Term__c', null],
    ['Supplier_Payment_Term__c', null],
    ['Is_Broker__c', 'boolean'],
    ['Inactive_Suspended__c', 'boolean'],
    ['Account_Manager__c', 'string'],
  ];

  for (const [fieldName, expectedType] of requiredFields) {
    const field = fieldsByName.get(fieldName);
    if (!field || expectedType && field.type !== expectedType) {
      throw appError(`Salesforce Account.${fieldName} is missing or has an incompatible type. Account Managers is unavailable until the schema is corrected.`, 503);
    }
  }

  const parentField = fieldsByName.get('ParentId');
  if (!parentField.referenceTo?.includes('Account')) {
    throw appError('Salesforce Account.ParentId is not an Account lookup. Account Managers is unavailable until the schema is corrected.', 503);
  }

  const managerField = fieldsByName.get('Account_Manager__c');
  if (managerField.updateable !== true) {
    throw appError('Salesforce Account.Account_Manager__c is not writable. Account Managers is unavailable until field access is corrected.', 503);
  }
  if (Number(managerField.length || 0) < 255) {
    throw appError(`Salesforce Account.Account_Manager__c supports only ${Number(managerField.length || 0)} characters. Increase it to 255 before using Account Managers.`, 503);
  }

  cachedAccountManagerSchema = { managerFieldLength: Number(managerField.length || 0) };
  return cachedAccountManagerSchema;
}

function accountManagerResponse({ salesforceGroup, groupRow = {}, managers = [] }) {
  const status = groupRow.salesforce_sync_status || 'synced';
  return {
    accountNameKey: salesforceGroup.accountNameKey,
    accountName: salesforceGroup.accountName,
    clKeys: salesforceGroup.clKeys || [],
    roles: salesforceGroup.roles,
    salesforceAccountCount: (salesforceGroup.directSalesforceAccountIds || salesforceGroup.salesforceAccountIds).length,
    isGroupAccount: salesforceGroup.isGroupAccount === true,
    parentAccounts: salesforceGroup.parentAccounts || [],
    parentGroupNames: salesforceGroup.parentGroupNames || [],
    childAccountCount: Number(salesforceGroup.childAccountCount || 0),
    childAccountNames: salesforceGroup.childAccountNames || [],
    propagateToChildren: salesforceGroup.isGroupAccount === true && groupRow.propagate_to_children === true,
    managers,
    managerCount: managers.length,
    assignmentSource: 'direct',
    inheritedFromGroupName: '',
    revision: Number(groupRow.revision || 0),
    updatedAt: groupRow.updated_at || null,
    updatedByEmail: groupRow.updated_by_email || null,
    salesforceSyncStatus: status,
    salesforceSyncError: groupRow.salesforce_sync_error || null,
    salesforceSyncedAt: groupRow.salesforce_synced_at || null,
    salesforceActive: true,
    buyerAccountKey: salesforceGroup.accountNameKey,
    buyerAccountId: salesforceGroup.salesforceAccountIds[0],
    buyerName: salesforceGroup.accountName,
    traders: managers,
    traderCount: managers.length,
  };
}

async function currentEligibleAccountGroup(body = {}, {
  includeGroupChildren = true,
  enforceSalesforceWriteLimit = true,
} = {}) {
  await accountManagerSchema();
  let requestedName = String(body.accountName || body.buyerName || '').trim();
  const legacyAccountId = String(body.buyerAccountId || '').trim();

  if (!requestedName && legacyAccountId) {
    const legacyRows = await queryRows(`
      SELECT Id, Name
      FROM Account
      WHERE Id = '${escapeSoql(legacyAccountId)}'
      LIMIT 1
    `, { limit: 1 });
    requestedName = String(legacyRows[0]?.Name || '').trim();
  }
  if (!requestedName) throw appError('Account name is required.', 400);

  const rows = await queryRows(`
    SELECT ${ACCOUNT_MANAGER_ACCOUNT_FIELDS.join(', ')}
    FROM Account
    WHERE Name = '${escapeSoql(requestedName)}'
      AND Inactive_Suspended__c = false
      AND (Is_Broker__c = true OR Buyer_Payment_Term__c != null)
    ORDER BY Id ASC
    LIMIT 200
  `, { limit: 200 });
  const requestedKey = String(body.accountNameKey || body.buyerAccountKey || accountNameKey(requestedName));
  const group = groupEligibleSalesforceAccounts(rows).find((candidate) => candidate.accountNameKey === requestedKey);
  if (!group) {
    throw appError('This Account name no longer has an active Buyer, Buyer & Supplier, or Broker record. Refresh the page and review the latest Salesforce data.', 409);
  }
  group.directSalesforceAccountIds = group.salesforceAccountIds.slice();
  if (group.isGroupAccount && includeGroupChildren) {
    const parentIds = group.directSalesforceAccountIds.map((id) => `'${escapeSoql(id)}'`).join(',');
    const childResult = await queryResult(`
      SELECT ${ACCOUNT_MANAGER_ACCOUNT_FIELDS.join(', ')}
      FROM Account
      WHERE ParentId IN (${parentIds})
      ORDER BY Name ASC, Id ASC
    `, { limit: 5000 });
    if (Number(childResult.totalSize || 0) > (childResult.records || []).length) {
      throw appError('This GROUP has more than 5,000 direct child Accounts and cannot be updated safely.', 409);
    }

    const childRecords = childResult.records || [];
    const childGroups = groupEligibleSalesforceAccounts(childRecords);
    const childAccountsByKey = new Map();
    for (const record of childRecords) {
      const accountName = String(record.Name || '').trim();
      const childKey = accountNameKey(accountName);
      if (childKey && childKey !== group.accountNameKey && !childAccountsByKey.has(childKey)) {
        childAccountsByKey.set(childKey, { accountNameKey: childKey, accountName });
      }
    }
    group.childAccounts = [...childAccountsByKey.values()]
      .sort((left, right) => left.accountName.localeCompare(right.accountName, undefined, { sensitivity: 'base' }));
    group.childAccountNameKeys = group.childAccounts.map((account) => account.accountNameKey);
    group.childAccountNames = [...new Set(childGroups.map((child) => child.accountName))];
    group.childAccountCount = childRecords.length;
    group.salesforceAccountIds = [...new Set([
      ...group.directSalesforceAccountIds,
      ...childRecords.map((record) => String(record.Id || '').trim()).filter(Boolean),
    ])];
    if (enforceSalesforceWriteLimit && group.salesforceAccountIds.length > 200) {
      throw appError(`This GROUP contains ${group.salesforceAccountIds.length} Account records, which exceeds the 200-record all-or-none Salesforce update limit.`, 409);
    }
  }
  return group;
}

async function finalizeAccountManagerSync(client, groupRow, status, error, profile) {
  const result = await client.rpc('finalize_account_manager_sync', {
    p_account_name_key: groupRow.account_name_key,
    p_revision: groupRow.revision,
    p_sync_status: status,
    p_sync_error: error || null,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
  });
  if (result.error) throw accountManagerStorageError(result.error);
  return result.data || groupRow;
}

async function syncAccountManagerToSalesforce(client, groupRow, profile) {
  try {
    const records = (groupRow.salesforce_account_ids || []).map((accountId) => ({
      attributes: { type: 'Account' },
      Id: accountId,
      Account_Manager__c: groupRow.salesforce_manager_text || null,
    }));
    if (!records.length) throw new Error('No active eligible Salesforce Accounts were found for synchronization.');

    const result = await sfRequest('/composite/sobjects', {
      method: 'PATCH',
      body: { allOrNone: true, records },
    });
    const failures = (Array.isArray(result) ? result : []).filter((item) => item?.success !== true);
    if (failures.length) {
      const message = failures.flatMap((item) => item.errors || []).map((item) => item.message).filter(Boolean).join('; ');
      throw new Error(message || 'Salesforce rejected the Account Manager update.');
    }

    return {
      groupRow: await finalizeAccountManagerSync(client, groupRow, 'synced', null, profile),
      syncError: null,
    };
  } catch (error) {
    const message = String(error?.message || 'Salesforce Account Manager synchronization failed.').slice(0, 2000);
    let failedRow = { ...groupRow, salesforce_sync_status: 'failed', salesforce_sync_error: message };
    try {
      failedRow = await finalizeAccountManagerSync(client, groupRow, 'failed', message, profile);
    } catch (finalizeError) {
      failedRow.salesforce_sync_error = `${message} Sync status could not be finalized: ${finalizeError.message}`.slice(0, 2000);
    }
    return { groupRow: failedRow, syncError: message };
  }
}

async function accountManagersList(body = {}, req = null, accessContext = null) {
  const client = accessContext?.client || supabaseAdminClient();
  await accountManagerSchema();
  const [salesforceAccountResult, groupsResult, assignmentsResult, profilesResult, notesResult] = await Promise.all([
    queryResult(`
      SELECT ${ACCOUNT_MANAGER_ACCOUNT_FIELDS.join(', ')}
      FROM Account
      WHERE Inactive_Suspended__c = false
        AND (Is_Broker__c = true OR Buyer_Payment_Term__c != null)
      ORDER BY Name ASC
    `, { limit: 10000 }),
    client
      .from('account_manager_groups')
      .select('account_name_key,account_name,salesforce_account_ids,account_roles,salesforce_manager_text,propagate_to_children,salesforce_sync_status,salesforce_sync_error,salesforce_synced_at,revision,updated_at,updated_by_email'),
    client
      .from('account_manager_assignments')
      .select('account_name_key,manager_user_id,assignment_order'),
    client
      .from('user_profiles')
      .select('id,email,full_name,user_type,active')
      .order('full_name', { ascending: true }),
    client
      .from('account_manager_notes')
      .select('account_name_key,account_name,account_note,source_group_account_name_key,source_group_account_name,revision,updated_at,updated_by_email'),
  ]);

  for (const result of [groupsResult, assignmentsResult, profilesResult, notesResult]) {
    if (result.error) throw accountManagerStorageError(result.error);
  }
  const salesforceAccounts = salesforceAccountResult.records || [];
  if (Number(salesforceAccountResult.totalSize || 0) > salesforceAccounts.length) {
    throw appError('The active Salesforce Account directory exceeds 10,000 records. Narrow the server query before managing assignments.', 503);
  }

  const profiles = profilesResult.data || [];
  const accounts = buildAccountManagerRows({
    salesforceAccounts,
    managedGroups: groupsResult.data || [],
    assignments: assignmentsResult.data || [],
    profiles,
    accountNotes: notesResult.data || [],
  });
  return {
    accounts,
    buyers: accounts,
    users: profiles.map(accountManagerProfile),
  };
}

async function accountManagersSaveNote(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || {};
  if (!client || !profile) throw appError('Sign-in required.', 401);

  const requestedPropagation = body.propagateToChildren === true;
  const salesforceGroup = await currentEligibleAccountGroup(body, {
    includeGroupChildren: requestedPropagation,
    enforceSalesforceWriteLimit: false,
  });
  const propagateToChildren = salesforceGroup.isGroupAccount && requestedPropagation;
  const accountNote = String(body.accountNote ?? body.note ?? '').trim();
  if (Array.from(accountNote).length > 255) {
    throw appError('Account note cannot exceed 255 characters.', 400);
  }

  const rpcName = propagateToChildren
    ? 'save_account_manager_note_family'
    : 'save_account_manager_note';
  const rpcPayload = {
    p_account_name_key: salesforceGroup.accountNameKey,
    p_account_name: salesforceGroup.accountName,
    p_account_note: accountNote,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: Number(body.expectedRevision ?? body.noteRevision ?? 0),
  };
  if (propagateToChildren) {
    const childAccounts = salesforceGroup.childAccounts || [];
    let childNotes = [];
    if (childAccounts.length) {
      const childNotesResult = await client
        .from('account_manager_notes')
        .select('account_name_key,revision')
        .in('account_name_key', childAccounts.map((account) => account.accountNameKey));
      if (childNotesResult.error) throw accountManagerStorageError(childNotesResult.error);
      childNotes = childNotesResult.data || [];
    }
    const revisionsByKey = new Map(childNotes.map((note) => [note.account_name_key, Number(note.revision || 0)]));
    rpcPayload.p_child_accounts = childAccounts.map((account) => ({
      accountNameKey: account.accountNameKey,
      accountName: account.accountName,
      expectedRevision: revisionsByKey.get(account.accountNameKey) || 0,
    }));
  }
  const { data, error } = await client.rpc(rpcName, rpcPayload);
  if (error) {
    const storageError = accountManagerStorageError(error);
    if (storageError !== error) throw storageError;
    if (/changed after it was opened/i.test(error.message || '')) throw appError(error.message, 409);
    if (/required|cannot exceed 255|active FCOS user/i.test(error.message || '')) throw appError(error.message, 400);
    throw error;
  }

  return {
    note: {
      accountNameKey: salesforceGroup.accountNameKey,
      accountName: salesforceGroup.accountName,
      accountNote: data?.account_note || '',
      noteRevision: Number(data?.revision || 0),
      noteUpdatedAt: data?.updated_at || null,
      noteUpdatedByEmail: data?.updated_by_email || null,
      noteSourceGroupAccountNameKey: data?.source_group_account_name_key || null,
      noteSourceGroupAccountName: data?.source_group_account_name || '',
    },
    propagatedChildCount: propagateToChildren ? (salesforceGroup.childAccounts || []).length : 0,
  };
}

async function accountManagersSave(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || {};
  if (!client || !profile) throw appError('Sign-in required.', 401);

  let managerUserIds;
  try {
    managerUserIds = normalizeAccountManagerUserIds(body.managerUserIds || body.traderUserIds || []);
  } catch (error) {
    throw appError(error.message, 400);
  }

  const requestedPropagation = body.propagateToChildren !== false;
  const salesforceGroup = await currentEligibleAccountGroup(body, {
    includeGroupChildren: requestedPropagation,
  });
  const propagateToChildren = salesforceGroup.isGroupAccount && requestedPropagation;
  let selectedProfiles = [];
  if (managerUserIds.length) {
    const { data, error } = await client
      .from('user_profiles')
      .select('id,email,full_name,user_type,active')
      .in('id', managerUserIds);
    if (error) throw error;
    const profilesById = new Map((data || []).map((candidate) => [candidate.id, candidate]));
    selectedProfiles = managerUserIds.map((userId) => profilesById.get(userId)).filter(Boolean);
    if (selectedProfiles.length !== managerUserIds.length || selectedProfiles.some((candidate) => candidate.active !== true)) {
      throw appError('Every assigned manager must be an active FCOS user.', 400);
    }
  }

  const managerText = managerDisplayText(selectedProfiles);
  const schema = await accountManagerSchema();
  if (managerText.length > schema.managerFieldLength) {
    throw appError(`Selected manager names exceed the Salesforce ${schema.managerFieldLength}-character limit.`, 400);
  }

  const rpcName = salesforceGroup.isGroupAccount
    ? 'save_account_manager_group_with_scope'
    : 'save_account_manager_group';
  const rpcPayload = {
    p_account_name_key: salesforceGroup.accountNameKey,
    p_account_name: salesforceGroup.accountName,
    p_salesforce_account_ids: salesforceGroup.salesforceAccountIds,
    p_account_roles: salesforceGroup.roles,
    p_salesforce_manager_text: managerText || null,
    p_manager_user_ids: managerUserIds,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_revision: Number(body.expectedRevision ?? body.revision ?? 0),
  };
  if (salesforceGroup.isGroupAccount) {
    rpcPayload.p_child_account_name_keys = salesforceGroup.childAccountNameKeys || [];
    rpcPayload.p_propagate_to_children = propagateToChildren;
  }
  const { data, error } = await client.rpc(rpcName, rpcPayload);
  if (error) {
    const storageError = accountManagerStorageError(error);
    if (storageError !== error) throw storageError;
    if (/changed after it was opened/i.test(error.message || '')) throw appError(error.message, 409);
    if (/required|at most three|same manager|active FCOS user|exceeds 255/i.test(error.message || '')) throw appError(error.message, 400);
    throw error;
  }

  const syncResult = await syncAccountManagerToSalesforce(client, data || {}, profile);
  const managers = selectedProfiles.map(accountManagerProfile);
  const account = accountManagerResponse({ salesforceGroup, groupRow: syncResult.groupRow, managers });
  return { account, buyer: account, syncError: syncResult.syncError };
}

async function accountManagersRetrySync(body = {}, req = null, accessContext = null) {
  const { client } = accessContext || {};
  if (!client) throw appError('Sign-in required.', 401);
  const key = String(body.accountNameKey || '').trim();
  if (!/^[a-f0-9]{64}$/.test(key)) throw appError('A valid Account name key is required.', 400);

  const [groupResult, assignmentResult] = await Promise.all([
    client
      .from('account_manager_groups')
      .select('account_name_key,account_name,propagate_to_children,revision')
      .eq('account_name_key', key)
      .maybeSingle(),
    client
      .from('account_manager_assignments')
      .select('manager_user_id,assignment_order')
      .eq('account_name_key', key)
      .order('assignment_order', { ascending: true }),
  ]);
  if (groupResult.error) throw accountManagerStorageError(groupResult.error);
  if (assignmentResult.error) throw accountManagerStorageError(assignmentResult.error);
  if (!groupResult.data) throw appError('This Account Manager assignment no longer exists.', 404);

  return accountManagersSave({
    accountNameKey: key,
    accountName: groupResult.data.account_name,
    managerUserIds: (assignmentResult.data || []).map((row) => row.manager_user_id),
    expectedRevision: groupResult.data.revision,
    propagateToChildren: groupResult.data.propagate_to_children === true,
  }, req, accessContext);
}

const buyersAdministratorList = accountManagersList;
const buyersAdministratorSave = accountManagersSave;

const BUYER_REMINDER_RULE_SELECT = 'salesforce_account_id,account_name,account_type,parent_salesforce_account_id,policy,note,inherit_to_children,revision,updated_by_email,created_at,updated_at';
const BUYER_REMINDER_ACCOUNT_FIELDS = [
  'Id',
  'Name',
  'Company_Code__c',
  'RecordType.Name',
  'ParentId',
  'Parent.Name',
  'Parent.Company_Code__c',
  'Buyer_Payment_Term__c',
  'Supplier_Payment_Term__c',
  'Is_Broker__c',
  'Inactive_Suspended__c',
];

function buyerReminderStorageError(error) {
  const message = String(error?.message || '');
  if (
    error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /buyer_invoice_reminder_rules.*does not exist/i.test(message)
  ) {
    return appError('Buyer Invoice reminder rule storage is not ready. Apply the latest Supabase migration and try again.', 503);
  }
  if (
    error?.code === 'PGRST202'
    || /buyer_invoice_reminder_rule/i.test(message) && /schema cache|could not find/i.test(message)
  ) {
    return appError('Buyer Invoice reminder rule storage is not ready. Refresh the Supabase schema cache after applying the latest migration.', 503);
  }
  return error;
}

async function loadBuyerInvoiceReminderRules({ required = false, client = null } = {}) {
  const supabase = client || safeSupabaseAdminClient();
  if (!supabase) {
    if (required) throw appError('Buyer Invoice reminder rule storage is unavailable. External payment reminders are disabled.', 503);
    return { available: false, rules: [], error: 'storage_unavailable' };
  }

  const { data, error } = await supabase
    .from('buyer_invoice_reminder_rules')
    .select(BUYER_REMINDER_RULE_SELECT);
  if (error) {
    if (required) throw buyerReminderStorageError(error);
    console.error('[buyerInvoiceReminderRules] storage unavailable', { code: error.code, message: error.message });
    return { available: false, rules: [], error: 'storage_unavailable' };
  }
  return { available: true, rules: data || [], error: null };
}

let cachedBuyerReminderAccountSchema = null;

async function buyerReminderAccountSchema() {
  if (cachedBuyerReminderAccountSchema) return cachedBuyerReminderAccountSchema;
  const describe = await sfRequest('/sobjects/Account/describe/');
  const fieldsByName = new Map((describe.fields || []).map((field) => [field.name, field]));
  const requiredFields = [
    ['RecordTypeId', 'reference'],
    ['ParentId', 'reference'],
    ['Company_Code__c', 'string'],
    ['Buyer_Payment_Term__c', null],
    ['Supplier_Payment_Term__c', null],
    ['Is_Broker__c', 'boolean'],
    ['Inactive_Suspended__c', 'boolean'],
  ];
  for (const [fieldName, expectedType] of requiredFields) {
    const field = fieldsByName.get(fieldName);
    if (!field || expectedType && field.type !== expectedType) {
      throw appError(`Salesforce Account.${fieldName} is missing or has an incompatible type. Reminder Rules is unavailable until the schema is corrected.`, 503);
    }
  }
  if (!fieldsByName.get('ParentId')?.referenceTo?.includes('Account')) {
    throw appError('Salesforce Account.ParentId is not an Account lookup. Reminder Rules is unavailable until the schema is corrected.', 503);
  }
  cachedBuyerReminderAccountSchema = true;
  return true;
}

function buyerReminderAccountSnapshot(account = {}) {
  const accountId = canonicalSalesforceAccountId(account.Id);
  const parentAccountId = canonicalSalesforceAccountId(account.ParentId);
  const accountType = buyerReminderAccountType(account);
  return {
    accountId,
    accountName: String(account.Name || '').trim(),
    clKey: String(account.Company_Code__c || '').trim(),
    accountType,
    accountTypeLabel: accountType === 'group'
      ? 'GROUP'
      : accountType === 'buyer_supplier'
        ? 'Buyer & Supplier'
        : 'Buyer',
    parentAccountId: parentAccountId || null,
    parentAccountName: String(account.Parent?.Name || '').trim(),
    parentClKey: String(account.Parent?.Company_Code__c || '').trim(),
    isGroup: accountType === 'group',
  };
}

function isActiveBuyerReminderAccount(account = {}) {
  return account.Inactive_Suspended__c === false
    && Boolean(buyerReminderAccountType(account))
    && Boolean(String(account.Company_Code__c || '').trim());
}

async function loadBuyerReminderAccountDirectory() {
  await buyerReminderAccountSchema();
  const result = await queryResult(`
    SELECT ${BUYER_REMINDER_ACCOUNT_FIELDS.join(', ')}
    FROM Account
    WHERE Inactive_Suspended__c = false
      AND Is_Broker__c = false
      AND Company_Code__c != null
      AND (Buyer_Payment_Term__c != null OR RecordType.Name = 'Group')
    ORDER BY Name ASC, Id ASC
  `, { limit: 10000 });
  const records = (result.records || []).filter(isActiveBuyerReminderAccount);
  if (Number(result.totalSize || 0) > records.length) {
    throw appError('The active Buyer Account directory exceeds 10,000 records. Narrow the Salesforce directory before managing reminder rules.', 503);
  }
  return records;
}

async function currentBuyerReminderAccount(accountId, { includeChildren = false } = {}) {
  await buyerReminderAccountSchema();
  const canonicalId = canonicalSalesforceAccountId(accountId);
  if (!canonicalId) throw appError('A valid Salesforce Account ID is required.', 400);
  const records = await queryRows(`
    SELECT ${BUYER_REMINDER_ACCOUNT_FIELDS.join(', ')}
    FROM Account
    WHERE Id = '${escapeSoql(canonicalId)}'
    LIMIT 1
  `, { limit: 1 });
  const account = records[0];
  if (!account || !isActiveBuyerReminderAccount(account)) {
    throw appError('This Account is no longer an active Buyer, Buyer & Supplier, or GROUP Account with a CL Key. Refresh Reminder Rules.', 409);
  }

  const snapshot = buyerReminderAccountSnapshot(account);
  let children = [];
  if (includeChildren && snapshot.isGroup) {
    const result = await queryResult(`
      SELECT ${BUYER_REMINDER_ACCOUNT_FIELDS.join(', ')}
      FROM Account
      WHERE ParentId = '${escapeSoql(canonicalId)}'
        AND Inactive_Suspended__c = false
        AND Is_Broker__c = false
        AND Company_Code__c != null
        AND (Buyer_Payment_Term__c != null OR RecordType.Name = 'Group')
      ORDER BY Name ASC, Id ASC
    `, { limit: 10000 });
    children = (result.records || []).filter(isActiveBuyerReminderAccount);
    if (Number(result.totalSize || 0) > children.length) {
      throw appError('This GROUP has more than 10,000 eligible direct child Accounts and cannot be updated safely.', 409);
    }
  }
  return { account, snapshot, children };
}

function serializeBuyerReminderRule(rule = null) {
  if (!rule) return null;
  return {
    accountId: canonicalSalesforceAccountId(rule.salesforce_account_id || rule.accountId),
    accountName: rule.account_name || rule.accountName || '',
    accountType: rule.account_type || rule.accountType || '',
    parentAccountId: canonicalSalesforceAccountId(rule.parent_salesforce_account_id || rule.parentAccountId) || null,
    policy: rule.policy === 'overdue_only' ? 'overdue_only' : 'standard',
    note: rule.note || '',
    inheritToChildren: rule.inherit_to_children === true || rule.inheritToChildren === true,
    revision: Number(rule.revision || 0),
    updatedAt: rule.updated_at || rule.updatedAt || null,
    updatedByEmail: rule.updated_by_email || rule.updatedByEmail || null,
  };
}

async function buyerInvoiceReminderRulesList(body = {}, req = null, accessContext = null) {
  const client = accessContext?.client || supabaseAdminClient();
  const [salesforceAccounts, stored] = await Promise.all([
    loadBuyerReminderAccountDirectory(),
    loadBuyerInvoiceReminderRules({ required: true, client }),
  ]);
  const ruleMap = buyerReminderRuleMap(stored.rules);
  const snapshots = salesforceAccounts.map(buyerReminderAccountSnapshot);
  const childrenByParent = new Map();
  for (const account of snapshots) {
    if (!account.parentAccountId) continue;
    if (!childrenByParent.has(account.parentAccountId)) childrenByParent.set(account.parentAccountId, []);
    childrenByParent.get(account.parentAccountId).push(account);
  }

  const accounts = snapshots.map((account) => {
    const directRule = ruleMap.get(account.accountId) || null;
    const parentRule = ruleMap.get(account.parentAccountId);
    const inheritedRule = !directRule && parentRule?.inheritToChildren ? parentRule : null;
    const effectiveRule = directRule || inheritedRule || null;
    const availableGroupRule = parentRule?.inheritToChildren ? parentRule : null;
    const children = childrenByParent.get(account.accountId) || [];
    const childOverrideCount = children.filter((child) => ruleMap.has(child.accountId)).length;
    return {
      ...account,
      policy: effectiveRule?.policy || 'standard',
      note: effectiveRule?.note || '',
      source: directRule ? 'direct' : inheritedRule ? 'group' : 'default',
      sourceAccountId: inheritedRule?.accountId || directRule?.accountId || null,
      sourceAccountName: inheritedRule?.accountName || directRule?.accountName || '',
      hasDirectRule: Boolean(directRule),
      canUseGroupRule: Boolean(directRule && availableGroupRule),
      availableGroupRule: serializeBuyerReminderRule(availableGroupRule),
      directRule: serializeBuyerReminderRule(directRule),
      revision: Number(directRule?.revision || 0),
      inheritToChildren: directRule?.inheritToChildren === true,
      childCount: children.length,
      eligibleChildCount: children.length,
      childOverrideCount,
      updatedAt: (directRule || inheritedRule)?.updatedAt || null,
      updatedByEmail: (directRule || inheritedRule)?.updatedByEmail || null,
    };
  }).sort((left, right) => (
    Number(right.isGroup) - Number(left.isGroup)
    || left.accountName.localeCompare(right.accountName, undefined, { sensitivity: 'base' })
    || left.accountId.localeCompare(right.accountId)
  ));

  return { accounts };
}

async function buyerInvoiceReminderRuleSave(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || {};
  if (!client || !profile) throw appError('Sign-in required.', 401);
  const policy = body.policy === 'overdue_only' ? 'overdue_only' : body.policy === 'standard' ? 'standard' : '';
  if (!policy) throw appError('Reminder policy must be Standard or Overdue only.', 400);
  const note = String(body.note || '').trim();
  if (Array.from(note).length > 255) throw appError('Reminder rule note cannot exceed 255 characters.', 400);

  const requestedScope = String(body.groupScope || body.scope || 'group_only');
  if (!['group_only', 'group_children'].includes(requestedScope)) {
    throw appError('GROUP scope must be GROUP only or GROUP + children.', 400);
  }
  const replaceChildOverrides = body.replaceChildOverrides === true;
  const includeChildren = requestedScope === 'group_children';
  const { snapshot, children } = await currentBuyerReminderAccount(body.accountId, { includeChildren: true });
  if (!snapshot.isGroup && (includeChildren || replaceChildOverrides)) {
    throw appError('Only GROUP Accounts can apply a reminder rule to child Accounts.', 400);
  }
  if (replaceChildOverrides && !includeChildren) {
    throw appError('Replace direct child overrides is available only with GROUP + children.', 400);
  }

  const expectedRevision = Number(body.expectedRevision || 0);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw appError('Reminder rule revision is invalid. Refresh Reminder Rules.', 400);
  }
  const { data, error } = await client.rpc('save_buyer_invoice_reminder_rule', {
    p_salesforce_account_id: snapshot.accountId,
    p_account_name: snapshot.accountName,
    p_account_type: snapshot.accountType,
    p_parent_salesforce_account_id: snapshot.parentAccountId,
    p_policy: policy,
    p_note: note,
    p_inherit_to_children: snapshot.isGroup && includeChildren,
    p_replace_child_overrides: replaceChildOverrides,
    p_child_account_ids: includeChildren
      ? children.map((child) => canonicalSalesforceAccountId(child.Id)).filter(Boolean)
      : [],
    p_expected_revision: expectedRevision,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
  });
  if (error) {
    const storageError = buyerReminderStorageError(error);
    if (storageError !== error) throw storageError;
    if (/changed after it was opened/i.test(error.message || '')) throw appError(error.message, 409);
    if (/required|eligible|policy|cannot exceed|only GROUP|active FCOS/i.test(error.message || '')) throw appError(error.message, 400);
    throw error;
  }
  return {
    saved: true,
    rule: serializeBuyerReminderRule(data),
    replacedChildOverrideCount: Number(data?.replaced_child_override_count || 0),
  };
}

async function buyerInvoiceReminderRuleRemove(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || {};
  if (!client || !profile) throw appError('Sign-in required.', 401);
  const { snapshot } = await currentBuyerReminderAccount(body.accountId);
  const expectedRevision = Number(body.expectedRevision || 0);
  if (!Number.isInteger(expectedRevision) || expectedRevision <= 0) {
    throw appError('A current direct reminder rule revision is required.', 400);
  }
  const { data, error } = await client.rpc('remove_buyer_invoice_reminder_rule', {
    p_salesforce_account_id: snapshot.accountId,
    p_expected_revision: expectedRevision,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
  });
  if (error) {
    const storageError = buyerReminderStorageError(error);
    if (storageError !== error) throw storageError;
    if (/changed after it was opened/i.test(error.message || '')) throw appError(error.message, 409);
    if (/required|active FCOS/i.test(error.message || '')) throw appError(error.message, 400);
    throw error;
  }
  return data || { removed: true, accountId: snapshot.accountId };
}

const REPORT_EXPORT_MAX_BYTES = 15 * 1024 * 1024;
const REPORT_EXPORT_MIME_TYPE = 'application/vnd.ms-excel';
const REPORT_TYPE_LABELS = {
  broker_commission: "Broker's Commission",
};
const REPORT_EXPORT_SELECT = 'id,report_type,report_label,file_name,mime_type,size_bytes,checksum_sha256,drive_file_id,drive_web_view_link,drive_web_content_link,status,exported_by,exported_by_email,deleted_by,deleted_by_email,metadata,error_message,created_at,updated_at,deleted_at';

function reportTypeLabel(reportType) {
  return REPORT_TYPE_LABELS[reportType] || String(reportType || 'Report').replaceAll('_', ' ');
}

function safeReportFileName(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 180);
  if (!cleaned) throw appError('File name is required.', 400);
  return cleaned.toLowerCase().endsWith('.xls') ? cleaned : `${cleaned}.xls`;
}

function decodeBase64File(value) {
  const raw = String(value || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s/g, '');
  if (!raw) throw appError('XLS content is required.', 400);
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) throw appError('XLS content is empty.', 400);
  if (buffer.length > REPORT_EXPORT_MAX_BYTES) throw appError('XLS file is too large. Maximum size is 15 MB.', 413);
  return buffer;
}

function checksumSha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function serializeReportEvent(row = {}) {
  return {
    id: row.id,
    reportExportId: row.report_export_id,
    eventType: row.event_type,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    previousFileName: row.previous_file_name,
    newFileName: row.new_file_name,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

function serializeReportExport(row = {}, events = []) {
  return {
    id: row.id,
    reportType: row.report_type,
    reportLabel: row.report_label || reportTypeLabel(row.report_type),
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    checksumSha256: row.checksum_sha256,
    driveFileId: row.drive_file_id,
    driveWebViewLink: row.drive_web_view_link,
    driveWebContentLink: row.drive_web_content_link,
    status: row.status,
    exportedBy: row.exported_by,
    exportedByEmail: row.exported_by_email,
    deletedBy: row.deleted_by,
    deletedByEmail: row.deleted_by_email,
    metadata: row.metadata || {},
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    events: events.map(serializeReportEvent),
  };
}

async function writeReportExportEvent(client, reportExportId, eventType, actor, payload = {}) {
  const { error } = await client.from('report_export_events').insert({
    report_export_id: reportExportId,
    event_type: eventType,
    actor_user_id: actor?.id || null,
    actor_email: actor?.email || null,
    previous_file_name: payload.previousFileName || null,
    new_file_name: payload.newFileName || null,
    metadata: payload.metadata || {},
  });
  if (error) console.error('Failed to write report export event', error.message);
}

function googleDriveConfig() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const folderId = process.env.GOOGLE_DRIVE_REPORT_FOLDER_ID;
  if (!clientId || !clientSecret || !refreshToken || !folderId) {
    throw appError('Missing Google Drive env vars. Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN, and GOOGLE_DRIVE_REPORT_FOLDER_ID in Vercel.', 500);
  }
  return { clientId, clientSecret, refreshToken, folderId };
}

async function googleDriveAccessToken() {
  requireExternalActionGate('google_drive');
  const { clientId, clientSecret, refreshToken } = googleDriveConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw appError(data.error_description || data.error || 'Google Drive token refresh failed.', 502);
  if (!data.access_token) throw appError('Google Drive token refresh did not return an access token.', 502);
  return data.access_token;
}

async function googleDriveFetch(url, options = {}) {
  const accessToken = await googleDriveAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || errorData.error_description || errorData.error || `Google Drive request failed: ${response.status}`;
    throw appError(message, 502);
  }
  return response;
}

async function googleDriveUploadFile({ fileName, mimeType, buffer }) {
  const { folderId } = googleDriveConfig();
  const boundary = `fcos-${Date.now()}`;
  const metadata = {
    name: fileName,
    mimeType,
    parents: [folderId],
  };
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`, 'utf8'),
    Buffer.from(`--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`, 'utf8'),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
  const fields = encodeURIComponent('id,name,mimeType,size,webViewLink,webContentLink,createdTime,modifiedTime');
  const response = await googleDriveFetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${fields}`, {
    method: 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return response.json();
}

async function googleDriveRenameFile(fileId, fileName) {
  const fields = encodeURIComponent('id,name,mimeType,size,webViewLink,webContentLink,modifiedTime');
  const response = await googleDriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${fields}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: fileName }),
  });
  return response.json();
}

async function googleDriveTrashFile(fileId) {
  const fields = encodeURIComponent('id,name,trashed,modifiedTime');
  const response = await googleDriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${fields}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
  return response.json();
}

async function googleDriveRestoreFile(fileId) {
  const fields = encodeURIComponent('id,name,trashed,modifiedTime');
  const response = await googleDriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${fields}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trashed: false }),
  });
  return response.json();
}

async function googleDriveDownloadFile(fileId) {
  const response = await googleDriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
  return Buffer.from(await response.arrayBuffer());
}

async function reportExportCreate(body, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  requireExternalActionGate('google_drive');
  const reportType = String(body.reportType || body.report_type || 'xls_report').trim().toLowerCase();
  const fileName = safeReportFileName(body.fileName || body.file_name);
  const mimeType = String(body.mimeType || body.mime_type || REPORT_EXPORT_MIME_TYPE);
  if (mimeType !== REPORT_EXPORT_MIME_TYPE && !mimeType.includes('excel')) throw appError('Only XLS report files are supported.', 400);

  const buffer = decodeBase64File(body.contentBase64 || body.content_base64);
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  const nowIso = new Date().toISOString();
  const checksum = checksumSha256(buffer);
  const insertPayload = {
    report_type: reportType,
    report_label: body.reportLabel || body.report_label || reportTypeLabel(reportType),
    file_name: fileName,
    mime_type: REPORT_EXPORT_MIME_TYPE,
    size_bytes: buffer.length,
    checksum_sha256: checksum,
    status: 'uploading',
    exported_by: profile.id,
    exported_by_email: profile.email,
    metadata,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const { data: inserted, error: insertError } = await client
    .from('report_exports')
    .insert(insertPayload)
    .select(REPORT_EXPORT_SELECT)
    .single();
  if (insertError) throw insertError;

  let driveFile = null;
  try {
    driveFile = await googleDriveUploadFile({ fileName, mimeType: REPORT_EXPORT_MIME_TYPE, buffer });
    const updatePayload = {
      drive_file_id: driveFile.id || null,
      drive_web_view_link: driveFile.webViewLink || null,
      drive_web_content_link: driveFile.webContentLink || null,
      status: 'active',
      error_message: null,
      updated_at: new Date().toISOString(),
    };
    const { data: updated, error: updateError } = await client
      .from('report_exports')
      .update(updatePayload)
      .eq('id', inserted.id)
      .select(REPORT_EXPORT_SELECT)
      .single();
    if (updateError) throw updateError;
    await writeReportExportEvent(client, updated.id, 'exported', profile, {
      newFileName: fileName,
      metadata: { driveFileId: driveFile.id, rowCount: metadata.rowCount, sizeBytes: buffer.length },
    });
    return { report: serializeReportExport(updated, []) };
  } catch (error) {
    const message = error.message || 'Google Drive upload failed.';
    if (driveFile?.id) {
      await googleDriveTrashFile(driveFile.id).catch((cleanupError) => {
        console.error('Failed to clean up orphaned Google Drive report', cleanupError.message);
      });
    }
    const { data: failed } = await client
      .from('report_exports')
      .update({
        status: 'failed',
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', inserted.id)
      .select(REPORT_EXPORT_SELECT)
      .maybeSingle();
    await writeReportExportEvent(client, inserted.id, 'upload_failed', profile, {
      newFileName: fileName,
      metadata: { error: message, rowCount: metadata.rowCount, sizeBytes: buffer.length },
    });
    const failure = appError(`Google Drive upload failed: ${message}`, error.status || 502);
    failure.report = failed;
    throw failure;
  }
}

async function reportExportsList(body, req, accessContext = null) {
  const { client } = accessContext || await requireActiveUser(req);
  const includeDeleted = body.includeDeleted === true || body.include_deleted === true;
  const limit = Math.max(10, Math.min(Number(body.limit) || 200, 500));
  let query = client
    .from('report_exports')
    .select(REPORT_EXPORT_SELECT)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (!includeDeleted) query = query.eq('status', 'active');
  const { data: rows, error } = await query;
  if (error) throw error;

  const ids = (rows || []).map((row) => row.id);
  let eventsByReport = {};
  if (ids.length) {
    const { data: events, error: eventsError } = await client
      .from('report_export_events')
      .select('id,report_export_id,event_type,actor_user_id,actor_email,previous_file_name,new_file_name,metadata,created_at')
      .in('report_export_id', ids)
      .order('created_at', { ascending: false });
    if (eventsError) throw eventsError;
    eventsByReport = (events || []).reduce((acc, event) => {
      if (!acc[event.report_export_id]) acc[event.report_export_id] = [];
      acc[event.report_export_id].push(event);
      return acc;
    }, {});
  }

  return {
    reports: (rows || []).map((row) => serializeReportExport(row, eventsByReport[row.id] || [])),
  };
}

async function loadReportExportForAction(client, id) {
  const { data, error } = await client
    .from('report_exports')
    .select(REPORT_EXPORT_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw appError('Report export not found.', 404);
  if (data.status !== 'active') throw appError('Only active report exports can be managed.', 400);
  if (!data.drive_file_id) throw appError('This report has no Google Drive file id.', 400);
  return data;
}

async function reportExportRename(body, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  requireExternalActionGate('google_drive');
  await requireReportArchiveFullAccess(client, profile);
  const id = String(body.id || '').trim();
  if (!id) throw appError('Report export id is required.', 400);
  const fileName = safeReportFileName(body.fileName || body.file_name);
  const current = await loadReportExportForAction(client, id);
  const driveFile = await googleDriveRenameFile(current.drive_file_id, fileName);
  const { data: updated, error } = await client
    .from('report_exports')
    .update({
      file_name: driveFile.name || fileName,
      drive_web_view_link: driveFile.webViewLink || current.drive_web_view_link,
      drive_web_content_link: driveFile.webContentLink || current.drive_web_content_link,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(REPORT_EXPORT_SELECT)
    .single();
  if (error) {
    await googleDriveRenameFile(current.drive_file_id, current.file_name).catch((rollbackError) => {
      console.error('Failed to roll back Google Drive report rename', rollbackError.message);
    });
    throw error;
  }
  await writeReportExportEvent(client, id, 'renamed', profile, {
    previousFileName: current.file_name,
    newFileName: updated.file_name,
  });
  return { report: serializeReportExport(updated, []) };
}

async function reportExportDelete(body, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  requireExternalActionGate('google_drive');
  await requireReportArchiveFullAccess(client, profile);
  const id = String(body.id || '').trim();
  if (!id) throw appError('Report export id is required.', 400);
  const current = await loadReportExportForAction(client, id);
  await googleDriveTrashFile(current.drive_file_id);
  const nowIso = new Date().toISOString();
  const { data: updated, error } = await client
    .from('report_exports')
    .update({
      status: 'deleted',
      deleted_at: nowIso,
      deleted_by: profile.id,
      deleted_by_email: profile.email,
      updated_at: nowIso,
    })
    .eq('id', id)
    .select(REPORT_EXPORT_SELECT)
    .single();
  if (error) {
    await googleDriveRestoreFile(current.drive_file_id).catch((rollbackError) => {
      console.error('Failed to restore Google Drive report after archive delete failure', rollbackError.message);
    });
    throw error;
  }
  await writeReportExportEvent(client, id, 'deleted', profile, {
    previousFileName: current.file_name,
    metadata: { driveFileId: current.drive_file_id },
  });
  return { report: serializeReportExport(updated, []) };
}

async function reportExportDownload(body, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  requireExternalActionGate('google_drive');
  const id = String(body.id || '').trim();
  if (!id) throw appError('Report export id is required.', 400);
  const current = await loadReportExportForAction(client, id);
  const buffer = await googleDriveDownloadFile(current.drive_file_id);
  await writeReportExportEvent(client, id, 'downloaded', profile, {
    newFileName: current.file_name,
    metadata: { sizeBytes: buffer.length },
  });
  return {
    id: current.id,
    fileName: current.file_name,
    mimeType: current.mime_type || REPORT_EXPORT_MIME_TYPE,
    contentBase64: buffer.toString('base64'),
  };
}

async function buyerInvoiceCollectionList(body, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  const stemIds = Array.isArray(body.stemIds)
    ? body.stemIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  await Promise.all(stemIds.map((stemId) => requireInterofficeStemAccess(stemId, { client, profile })));
  const map = await loadBuyerInvoiceCollectionMap(stemIds);
  return {
    items: Object.values(map).map((entry) => entry.item).filter(Boolean),
    events: Object.values(map).flatMap((entry) => entry.events || []),
    byStemId: map,
  };
}

async function persistBuyerInvoiceCollection(body, req, eventOverride = null, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  const stemId = String(body.stemId || body.stem_id || '').trim();
  if (!stemId) throw appError('stemId is required.', 400);
  await requireInterofficeStemAccess(stemId, { client, profile });

  const updates = normalizeCollectionUpdates(body.updates || body, profile);
  const eventInput = eventOverride || body.event || {};
  const eventPayload = {
    event_type: normalizeEventType(eventInput.eventType || eventInput.event_type || collectionEventTypeFromChanges(updates)),
    status: Object.prototype.hasOwnProperty.call(updates, 'status') ? updates.status : eventInput.status || null,
    owner_name: Object.prototype.hasOwnProperty.call(updates, 'owner_name') ? updates.owner_name : eventInput.ownerName || eventInput.owner_name || null,
    note: Object.prototype.hasOwnProperty.call(updates, 'latest_note') ? updates.latest_note : eventInput.note || null,
    next_follow_up_date: Object.prototype.hasOwnProperty.call(updates, 'next_follow_up_date') ? updates.next_follow_up_date : dateOrNull(eventInput.nextFollowUpDate || eventInput.next_follow_up_date),
    promised_payment_date: Object.prototype.hasOwnProperty.call(updates, 'promised_payment_date') ? updates.promised_payment_date : dateOrNull(eventInput.promisedPaymentDate || eventInput.promised_payment_date),
    promised_amount: Object.prototype.hasOwnProperty.call(updates, 'promised_amount') ? updates.promised_amount : decimalOrNull(eventInput.promisedAmount || eventInput.promised_amount),
  };
  const expectedUpdatedAt = body.expectedUpdatedAt || body.expected_updated_at || null;
  const { data, error } = await client.rpc('save_buyer_invoice_collection', {
    p_stem_id: stemId,
    p_updates: updates,
    p_event: eventPayload,
    p_actor_user_id: profile.id,
    p_actor_email: profile.email,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) throw error;
  const item = data?.item;
  const event = data?.event;
  if (!item || !event) throw appError('Collection save did not return the updated workflow state.', 500);

  return { item: serializeCollectionItem(item), event: serializeCollectionEvent(event) };
}

async function buyerInvoiceCollectionSave(body, req, accessContext = null) {
  return persistBuyerInvoiceCollection(body, req, null, accessContext);
}

async function buyerInvoiceCollectionEventCreate(body, req, accessContext = null) {
  const event = body.event || {};
  const updates = {};
  if (event.status) updates.status = event.status;
  if (event.ownerName || event.owner_name) updates.ownerName = event.ownerName || event.owner_name;
  if (event.note) updates.latestNote = event.note;
  if (Object.prototype.hasOwnProperty.call(event, 'nextFollowUpDate') || Object.prototype.hasOwnProperty.call(event, 'next_follow_up_date')) {
    updates.nextFollowUpDate = event.nextFollowUpDate || event.next_follow_up_date;
  }
  if (Object.prototype.hasOwnProperty.call(event, 'promisedPaymentDate') || Object.prototype.hasOwnProperty.call(event, 'promised_payment_date')) {
    updates.promisedPaymentDate = event.promisedPaymentDate || event.promised_payment_date;
  }
  if (Object.prototype.hasOwnProperty.call(event, 'promisedAmount') || Object.prototype.hasOwnProperty.call(event, 'promised_amount')) {
    updates.promisedAmount = event.promisedAmount ?? event.promised_amount;
  }
  return persistBuyerInvoiceCollection({ ...body, updates }, req, event, accessContext);
}

async function salesforceSchema() {
  const data = await sfRequest('/sobjects/');
  const objects = (data.sobjects || [])
    .filter((o) => o.queryable)
    .map((o) => ({ name: o.name, label: o.label, queryable: o.queryable, custom: o.custom }));
  return { objects };
}

async function salesforceObjectFields(body) {
  const { objectName } = body;
  if (!objectName) throw new Error('objectName required');
  const data = await sfRequest(`/sobjects/${encodeURIComponent(objectName)}/describe/`);
  const fields = (data.fields || []).map((f) => ({
    name: f.name,
    label: f.label,
    type: f.type,
    filterable: f.filterable,
    sortable: f.sortable,
    groupable: f.groupable,
    aggregatable: f.aggregatable,
    custom: f.custom,
    length: f.length || 0,
    updateable: f.updateable === true,
    createable: f.createable === true,
    nillable: f.nillable === true,
    relationshipName: f.relationshipName || null,
    referenceTo: f.referenceTo || [],
  }));
  const childRelationships = (data.childRelationships || [])
    .filter((r) => r.relationshipName && r.childSObject)
    .map((r) => ({ relationshipName: r.relationshipName, childSObject: r.childSObject, field: r.field }));
  return { objectName, label: data.label, fields, childRelationships };
}

async function salesforceQuery(body, req = null, accessContext = null) {
  if (isInterofficeAccess(accessContext)) throw appError('Raw Salesforce query is not available for Interoffice users.', 403);
  if (!body.soql) throw new Error('soql query required');
  const result = await sfQuery(body.soql, { clean: true, limit: 2000 });
  return { records: result.records, totalSize: result.totalSize, fetched: result.records.length };
}

async function salesforceFullSchema() {
  const list = await salesforceSchema();
  const objects = await Promise.all(
    list.objects.slice(0, 2000).map(async (object) => {
      try {
        return { ...object, ...(await salesforceObjectFields({ objectName: object.name })) };
      } catch {
        return object;
      }
    })
  );
  return { objects };
}

async function salesforceDashboard(body = {}, req = null, accessContext = null) {
  const describe = await salesforceObjectFields({ objectName: 'stem__c' });
  const fieldNames = describe.fields.map((f) => f.name);
  const interofficeCondition = await interofficeStemAccessCondition(accessContext, fieldNames);
  const whereClause = interofficeCondition ? `WHERE ${interofficeCondition}` : '';
  const hasStatus = fieldNames.includes('Status__c');
  const hasType = fieldNames.includes('Type__c');
  const hasAmount = fieldNames.includes('Amount__c');
  const profitField = ['Profit__c', 'Net_Profit__c', 'Gross_Profit__c', 'Total_Profit__c', 'ProfitAmount__c'].find((f) => fieldNames.includes(f)) || null;
  const usefulFields = ['Id', 'Name', 'CreatedDate'];
  if (hasStatus) usefulFields.push('Status__c');
  if (hasType) usefulFields.push('Type__c');
  if (hasAmount) usefulFields.push('Amount__c');
  if (fieldNames.includes('OwnerId')) usefulFields.push('OwnerId');

  const [totalRes, statusRes, typeRes, recentRes, accountRes, amountRes, profitRes] = await Promise.all([
    sfQuery(`SELECT COUNT(Id) total FROM stem__c ${whereClause}`, { softFail: true }),
    hasStatus ? sfQuery(`SELECT Status__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Status__c`, { softFail: true }) : { records: [] },
    hasType ? sfQuery(`SELECT Type__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Type__c`, { softFail: true }) : { records: [] },
    sfQuery(`SELECT ${usefulFields.join(', ')} FROM stem__c ${whereClause} ORDER BY CreatedDate DESC LIMIT 20`, { clean: true, softFail: true }),
    sfQuery('SELECT COUNT(Id) total FROM Account', { softFail: true }),
    hasAmount ? sfQuery(`SELECT SUM(Amount__c) total FROM stem__c ${whereClause}`, { softFail: true }) : { records: [] },
    profitField ? sfQuery(`SELECT SUM(${profitField}) total FROM stem__c ${whereClause}`, { softFail: true }) : { records: [] },
  ]);

  return {
    stemTotal: totalRes.records?.[0]?.total ?? totalRes.totalSize ?? 0,
    accountTotal: accountRes.records?.[0]?.total ?? 0,
    totalAmount: amountRes.records?.[0]?.total ?? null,
    totalProfit: profitRes.records?.[0]?.total ?? null,
    profitField,
    stemByStatus: (statusRes.records || []).map((r) => ({ label: r.val || 'Unknown', value: r.total })),
    stemByType: (typeRes.records || []).map((r) => ({ label: r.val || 'Unknown', value: r.total })),
    recentStems: recentRes.records || [],
    availableFields: fieldNames,
    hasStatus,
    hasType,
    hasAmount,
  };
}

async function salesforceDashboardFiltered(body) {
  const { where, trendYear } = body;
  const currentYear = Number(trendYear) || new Date().getFullYear();
  const describe = await salesforceObjectFields({ objectName: 'stem__c' });
  const fieldNames = describe.fields.map((f) => f.name);
  const whereClause = where ? `WHERE ${where}` : '';
  const buyerField = fieldNames.includes('Buyer_Name__c') ? 'Buyer_Name__c' : fieldNames.includes('Buyer__c') ? 'Buyer__c' : null;
  const buyerAmountField = fieldNames.includes('Total_Invoice_Amount__c') ? 'Total_Invoice_Amount__c' : null;
  const supplierAmountField = fieldNames.includes('Total_Invoiced_Amount_From_Suppliers__c') ? 'Total_Invoiced_Amount_From_Suppliers__c' : null;
  const totalCostsField = fieldNames.includes('Costs_Total__c') ? 'Costs_Total__c' : null;
  const expectedDeliveryField = fieldNames.includes('Expected_Delivery_Date__c') ? 'Expected_Delivery_Date__c' : null;
  const plFields = ['Id', 'Name', 'CreatedDate'];
  if (fieldNames.includes('Delivery_Date__c')) plFields.push('Delivery_Date__c');
  if (expectedDeliveryField) plFields.push(expectedDeliveryField);
  if (fieldNames.includes('ETA_Start_Date__c')) plFields.push('ETA_Start_Date__c');
  if (buyerField) plFields.push(buyerField);
  if (buyerAmountField) plFields.push(buyerAmountField);
  if (supplierAmountField) plFields.push(supplierAmountField);
  if (totalCostsField) plFields.push(totalCostsField);
  if (fieldNames.includes('QLIK_STEM_Line_Item_Total_Cost__c')) plFields.push('QLIK_STEM_Line_Item_Total_Cost__c');
  if (fieldNames.includes('QLIK_Costs_Total_Cost__c')) plFields.push('QLIK_Costs_Total_Cost__c');
  if (fieldNames.includes('KeyStem__c')) plFields.push('KeyStem__c');
  if (fieldNames.includes('Port__c')) plFields.push('Port__c', 'Port__r.Name', 'Port__r.Country__c');

  const [totalRes, recentRes, buyerRes, supplierRes, costsRes, monthlyRes] = await Promise.all([
    sfQuery(`SELECT COUNT(Id) total FROM stem__c ${whereClause}`, { softFail: true }),
    sfQuery(`SELECT ${plFields.join(', ')} FROM stem__c ${whereClause} ORDER BY Delivery_Date__c DESC NULLS LAST, CreatedDate DESC LIMIT 3000`, { clean: true, limit: 3000, softFail: true }),
    buyerAmountField ? sfQuery(`SELECT SUM(${buyerAmountField}) total FROM stem__c ${whereClause}`, { softFail: true }) : { records: [] },
    supplierAmountField ? sfQuery(`SELECT SUM(${supplierAmountField}) total FROM stem__c ${whereClause}`, { softFail: true }) : { records: [] },
    totalCostsField ? sfQuery(`SELECT SUM(${totalCostsField}) total FROM stem__c ${whereClause}`, { softFail: true }) : { records: [] },
    sfQuery(`SELECT Id, Delivery_Date__c${expectedDeliveryField ? `, ${expectedDeliveryField}` : ''}${buyerField ? `, ${buyerField}` : ''}${buyerAmountField ? `, ${buyerAmountField}` : ''}${supplierAmountField ? `, ${supplierAmountField}` : ''} FROM stem__c WHERE (Delivery_Date__c >= ${currentYear}-01-01 AND Delivery_Date__c <= ${currentYear}-12-31)${expectedDeliveryField ? ` OR (Delivery_Date__c = null AND ${expectedDeliveryField} >= ${currentYear}-01-01 AND ${expectedDeliveryField} <= ${currentYear}-12-31)` : ''} LIMIT 3000`, { clean: true, limit: 3000, softFail: true }),
  ]);

  const bf = buyerAmountField || 'Total_Invoice_Amount__c';
  const sf = supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c';
  const recentRows = recentRes.records || [];
  const recentStemIds = recentRows.map((stem) => stem.Id).filter(Boolean);
  const supplierLineTotalByStem = {};

  for (const chunk of chunkIds(recentStemIds)) {
    const ids = chunk.map((id) => `'${id}'`).join(',');
    const lineItems = await sfQuery(
      `SELECT STEM__c, Total_Cost__c, Cancelled__c FROM STEM_Line_Item__c WHERE STEM__c IN (${ids}) LIMIT 5000`,
      { clean: true, limit: 5000, softFail: true }
    );

    for (const item of lineItems.records || []) {
      if (!item.STEM__c || item.Cancelled__c) continue;
      supplierLineTotalByStem[item.STEM__c] = (supplierLineTotalByStem[item.STEM__c] || 0) + (item.Total_Cost__c || 0);
    }
  }

  const supplierBaseForStem = (stem) => {
    const invoiceTotal = stem[sf] ?? 0;
    return invoiceTotal || supplierLineTotalByStem[stem.Id] || null;
  };

  const recentStems = recentRows.map((stem) => ({
    ...stem,
    [sf]: supplierBaseForStem(stem),
  }));
  const totalBuyer = buyerRes.records?.[0]?.total ?? 0;
  const totalSupplier = recentStems.reduce((sum, stem) => sum + (stem[sf] || 0), 0);
  const totalCosts = costsRes.records?.[0]?.total ?? 0;
  const totalProfit = totalBuyer - totalSupplier;
  const monthlyNetPnl = Array.from({ length: 12 }, (_, idx) => ({ month: idx + 1, label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][idx], netPnl: 0, turnover: 0 }));
  for (const stem of monthlyRes.records || []) {
    const month = Number(String(stem.Delivery_Date__c || stem.Expected_Delivery_Date__c || '').split('-')[1]);
    if (month >= 1 && month <= 12) {
      const turnover = Number(stem[bf] || 0);
      monthlyNetPnl[month - 1].turnover += turnover;
      monthlyNetPnl[month - 1].netPnl += turnover - Number(stem[sf] || 0);
    }
  }
  for (const item of monthlyNetPnl) item.grossMarginPct = grossMarginPercent(item.netPnl, item.turnover);

  return {
    stemTotal: totalRes.records?.[0]?.total ?? recentStems.length,
    accountCount: null,
    totalAmount: totalBuyer,
    totalBuyer,
    turnoverTotal: totalBuyer,
    totalSupplier,
    totalCosts,
    totalProfit,
    disputedCount: 0,
    totalBrokerCommissions: 0,
    stemByStatus: [],
    stemByType: [],
    recentStems,
    monthlyNetPnl,
    monthlyBuyerNetPnl: monthlyNetPnl,
    monthlyBuyerNames: [],
    topBuyersByNetPnl: [],
    availableFields: fieldNames,
    buyerAmountField,
    supplierAmountField,
    totalCostsField,
    buyerNameField: buyerField,
  };
}

async function stemPnl(body) {
  const { where, limit = 500 } = body;
  const whereClause = where ? `WHERE ${where}` : '';
  const stems = await sfQuery(`
    SELECT Id, KeyStem__c, Name, Delivery_Date__c, Account__r.Name,
           Total_Invoice_Amount__c, Total_Invoiced_Amount_From_Suppliers__c, QLIK_Total_Profit__c
    FROM stem__c
    ${whereClause}
    ORDER BY Delivery_Date__c DESC
    LIMIT ${Number(limit) || 500}
  `, { clean: true, limit: 3000 });

  const rows = stems.records.map((s) => {
    const buyer = s.Total_Invoice_Amount__c ?? 0;
    const supplier = s.Total_Invoiced_Amount_From_Suppliers__c ?? 0;
    const grossProfit = buyer - supplier;
    return {
      Id: s.Id,
      Key: s.KeyStem__c,
      Name: s.Name,
      Delivery_Date: s.Delivery_Date__c,
      Buyer: s.Account__r?.Name ?? null,
      Buyer_Invoice: buyer || null,
      Supplier_Invoice: supplier || null,
      Total_Broker_Comm: null,
      Gross_Profit: buyer && supplier ? grossProfit : null,
      Net_Profit: buyer && supplier ? grossProfit : null,
      Margin_Pct: buyer && supplier ? (grossProfit / buyer) * 100 : null,
      Qlik_Total_Profit: s.QLIK_Total_Profit__c ?? null,
    };
  });
  const complete = rows.filter((r) => r.Buyer_Invoice && r.Supplier_Invoice);
  return {
    rows,
    totals: {
      count: rows.length,
      complete: complete.length,
      Buyer_Invoice: complete.reduce((sum, r) => sum + (r.Buyer_Invoice || 0), 0),
      Supplier_Invoice: complete.reduce((sum, r) => sum + (r.Supplier_Invoice || 0), 0),
      Total_Broker_Comm: 0,
      Gross_Profit: complete.reduce((sum, r) => sum + (r.Gross_Profit || 0), 0),
      Net_Profit: complete.reduce((sum, r) => sum + (r.Net_Profit || 0), 0),
      Qlik_Net_Profit: rows.reduce((sum, r) => sum + (r.Qlik_Total_Profit || 0), 0),
    },
  };
}

async function salesforceStemDetail(body) {
  const { stemId, updates, childObject, childId, childUpdates } = body;
  if (!stemId) throw new Error('stemId required');
  let actualStemId = stemId;
  if (stemId.length < 15) {
    const lookup = await sfQuery(`SELECT Id FROM stem__c WHERE KeyStem__c = '${String(stemId).replace(/'/g, "\\'")}' LIMIT 1`, { clean: true });
    if (!lookup.records.length) throw new Error(`STEM with KeyStem__c '${stemId}' not found`);
    actualStemId = lookup.records[0].Id;
  }
  if (childObject && childId && childUpdates && Object.keys(childUpdates).length) {
    await sfRequest(`/sobjects/${childObject}/${childId}`, { method: 'PATCH', body: childUpdates });
  }
  if (updates && Object.keys(updates).length) {
    await sfRequest(`/sobjects/stem__c/${actualStemId}`, { method: 'PATCH', body: updates });
  }
  const [record, lineItems, extraCosts, buyerBrokers] = await Promise.all([
    sfRequest(`/sobjects/stem__c/${actualStemId}`).then(cleanRecord),
    sfQuery(`SELECT Id, Name, Product__c, Product__r.Name, Product__r.Family, Supplier_Name__c, BDN_Company__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Subtotal_Sell_At__c, Subtotal_Buy_At__c, Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Payment_Term__c, BDN_Number__c, Quantity_in_MT__c, Is_Quantity_Range__c, Cancelled__c, Buyers_Brokers_Commission_Per_Unit__c, Commission_Cost__c, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c, Suppliers_Brokers_Commission_Lumpsum__c, Offer_Line_Item__r.UnitPrice, Offer_Line_Item__r.Supplier_Unit_Price__c FROM STEM_Line_Item__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { clean: true, softFail: true }),
    sfQuery(`SELECT Id, Name, Description__c, Product2Id__c, Product2Id__r.Name, Supplier_Name__c, Quantity__c, Unit_Price__c, Unit_Cost__c, Line_Total__c, Line_Total_Buy__c, Supplier_Invoice__c, Supplier_Issued__c, Payment_Term__c, Cancelled__c FROM STEM_Extra_Cost__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { clean: true, softFail: true }),
    sfQuery(`SELECT Id, Buyer_Broker__c, Refcode_Index__c, Exported__c, Commission_Lumpsum__c, STEM_Line_Item__r.Id FROM STEM_Buyer_Broker__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { clean: true, softFail: true }),
  ]);
  return { record, lineItems: lineItems.records || [], extraCosts: extraCosts.records || [], buyerBrokers: buyerBrokers.records || [] };
}

async function salesforceDescribeChildren(body) {
  const { objectType, recordId } = body;
  if (!objectType || !recordId) throw new Error('objectType and recordId required');
  const record = await sfRequest(`/sobjects/${objectType}/${recordId}`);
  return cleanRecord(record);
}

async function salesforceTopBuyers(body = {}, req = null, accessContext = null) {
  const interofficeCondition = await interofficeStemAccessCondition(accessContext);
  const whereClause = interofficeCondition ? `WHERE ${interofficeCondition}` : '';
  const rows = await sfQuery(`SELECT Account__r.Name buyer, SUM(Total_Invoice_Amount__c) total FROM stem__c ${whereClause} GROUP BY Account__r.Name ORDER BY SUM(Total_Invoice_Amount__c) DESC LIMIT 10`, { clean: true, softFail: true });
  return { buyers: (rows.records || []).map((r) => ({ name: r.buyer || 'Unknown', total: r.total || 0 })) };
}

async function salesforceBrokerRegister(body) {
  const limit = Math.min(Number(body.limit) || 2000, 3000);
  const stems = await sfQuery(`SELECT Id, Name, Delivery_Date__c, Payment_Date__c, Buyer_Pay_Term_Date__c FROM stem__c ORDER BY Delivery_Date__c DESC NULLS LAST LIMIT ${limit}`, { clean: true, limit });
  const stemMap = Object.fromEntries(stems.records.map((stem) => [stem.Id, stem]));
  const rows = [];
  for (const chunk of chunkIds(stems.records.map((stem) => stem.Id))) {
    const ids = chunk.map((id) => `'${id}'`).join(',');
    const lineItems = await sfQuery(`SELECT Id, Name, STEM__c, Product__r.Name, Product__r.Family, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c, Quantity_Delivered_Per_BDN__c, Quantity__c, Quantity_in_MT__c, Buyers_Broker__c, Buyer_Broker__c, Buyers_Brokers_Commission_Per_Unit__c, Buyers_Brokers_Commission_Lumpsum__c, Cancelled__c FROM STEM_Line_Item__c WHERE STEM__c IN (${ids}) LIMIT 5000`, { clean: true, softFail: true });
    for (const item of lineItems.records || []) {
      const stem = stemMap[item.STEM__c];
      if (!stem || item.Cancelled__c) continue;
      const qty = financialQuantity(item, !!stem.Delivery_Date__c);
      const supplierAmount = Number(item.Suppliers_Brokers_Commission_Per_Unit__c || 0) * Number(qty || 0);
      const buyerAmount = Number(item.Buyers_Brokers_Commission_Lumpsum__c || 0) || Number(item.Buyers_Brokers_Commission_Per_Unit__c || 0) * Number(qty || 0);
      if (item.Supplier_Broker__c && supplierAmount) rows.push({ id: `supplier-${item.Id}`, stemId: item.STEM__c, stemName: stem.Name, productName: item.Product__r?.Name || item.Name, deliveryDate: stem.Delivery_Date__c, brokerType: 'Supplier Broker', brokerName: item.Supplier_Broker__c, commissionAmount: supplierAmount });
      const buyerBrokerId = item.Buyers_Broker__c || item.Buyer_Broker__c;
      if (buyerBrokerId && buyerAmount) rows.push({ id: `buyer-${item.Id}`, stemId: item.STEM__c, stemName: stem.Name, productName: item.Product__r?.Name || item.Name, deliveryDate: stem.Delivery_Date__c, brokerType: 'Buyer Broker', brokerName: buyerBrokerId, commissionAmount: buyerAmount, paymentDate: stem.Payment_Date__c || null });
    }
  }
  return { rows };
}

async function queryRows(soql, { limit = 5000, softFail = false } = {}) {
  const result = await sfQuery(soql, { clean: true, limit, softFail });
  return result.records || [];
}

async function queryResult(soql, { limit = 5000, softFail = false } = {}) {
  return sfQuery(soql, { clean: true, limit, softFail });
}

function brokerAmount(value, qty) {
  return Number(value || 0) * Number(qty || 0);
}

function paymentDelayDays(paymentDate, dueDate) {
  if (!paymentDate || !dueDate) return null;
  const payment = new Date(paymentDate);
  const due = new Date(dueDate);
  if (Number.isNaN(payment.getTime()) || Number.isNaN(due.getTime())) return null;
  return Math.round((payment - due) / 86400000);
}

function escapeSoql(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function supplierMatchKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^[*]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function dateOnly(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function latestDate(values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function prpspDisplayStatus(rawStatus, uploadDate) {
  const status = String(rawStatus || '').trim();
  const uploadLabel = uploadDate ? prettyDate(uploadDate) : null;
  if (!status) return 'Not required';
  if (status === 'A - w/ Agreement (Payment Conditional)') {
    return uploadLabel ? `Conditional-Sent on ${uploadLabel}` : 'Conditional-Not Sent';
  }
  if ([
    'B - w/ Agreement (Payment Unconditional)',
    'C - w/o Agreement (Payment Received)',
    'D - w/o Agreement (Payment NOT Received)',
  ].includes(status)) {
    return uploadLabel ? `Not Conditional-Sent on ${uploadLabel}` : 'Not Conditional-Not Sent';
  }
  if (status === 'Sent') return uploadLabel ? `Sent on ${uploadLabel}` : 'Sent';
  return status;
}

function daysBetween(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to - from) / 86400000);
}

function isBeforeCashflowForecastStart(dateString) {
  return Boolean(dateString && String(dateString).slice(0, 10) < CASHFLOW_FORECAST_START_DATE);
}

const FRANKFURTER_PROVIDER_DETAILS = {
  blended: {
    key: 'blended',
    label: 'Frankfurter blended rate',
    rateType: 'blended provider rate',
  },
  ECB: {
    key: 'ECB',
    label: 'European Central Bank',
    rateType: 'reference rate',
  },
};

function normalizeFrankfurterProvider(provider) {
  const key = String(provider || 'blended').trim().toUpperCase();
  if (!key || key === 'BLENDED' || key === 'DEFAULT') return 'blended';
  return FRANKFURTER_PROVIDER_DETAILS[key] ? key : 'blended';
}

function previousIsoDate(dateString) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return dateOnly(date);
}

async function fetchFrankfurterRate(date, provider) {
  const url = new URL('https://api.frankfurter.dev/v2/rate/USD/CNY');
  url.searchParams.set('date', date);
  if (provider !== 'blended') url.searchParams.set('providers', provider);
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Frankfurter request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function frankfurterUsdCnyRate(body) {
  const provider = normalizeFrankfurterProvider(body.provider);
  const requestedDate = dateOnly(body.date || new Date());
  if (!requestedDate) throw new Error('Valid date required');

  const today = dateOnly(new Date());
  let probeDate = requestedDate > today ? today : requestedDate;
  let lastError = null;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    try {
      const rate = await fetchFrankfurterRate(probeDate, provider);
      const providerDetails = FRANKFURTER_PROVIDER_DETAILS[provider];
      return {
        source: 'Frankfurter API',
        apiUrl: 'https://api.frankfurter.dev/v2/rate/USD/CNY',
        requestedDate,
        date: rate.date,
        base: rate.base,
        quote: rate.quote,
        rate: rate.rate,
        provider,
        providerLabel: providerDetails.label,
        rateType: providerDetails.rateType,
      };
    } catch (error) {
      lastError = error;
      if (error.status && ![404, 422].includes(error.status)) break;
      probeDate = previousIsoDate(probeDate);
    }
  }
  throw new Error(lastError?.message || 'Unable to fetch USD/CNY exchange rate');
}

function earliestDate(values) {
  return values.filter(Boolean).sort()[0] || null;
}

function splitBuyerTraderNames(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function traderEmailLookupKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

const MIN_BUYER_INVOICE_DUE_DATE = '2026-01-01';
const CASHFLOW_FORECAST_START_DATE = '2026-01-01';
const INVOICE_TABLE_TOKEN_PATTERN = /\{\{\s*invoiceTable\s*\}\}/i;
const DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS = {
  enabled: true,
  from: 'Fratelli Cosulich <info@cosulich.com.hk>',
  to: ['bt@cosulich.com.hk'],
  cc: ['lousia@cosulich.com.hk', 'laureen@cosulich.com.hk'],
  daysAhead: 7,
  subject: 'Outstanding Buyer Invoices Report',
  intro: '<h2>Outstanding Buyer Invoices</h2><p>Please find below the latest overdue buyer invoices and buyer invoices due in {{daysAhead}} days.</p><p>Report window: {{reportStart}} to {{reportEnd}}. Overdue invoices are always included.</p>',
  includeSummary: true,
  includeTable: true,
  buyerTraders: [],
  weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  sendTimes: ['08:00', '14:00'],
  paymentReminderRecipientFieldPath: '',
  paymentReminderCc: [],
  paymentReminderBcc: [],
  paymentReminderSubject: 'Payment Reminder - {{buyerName}} - Outstanding Buyer Invoices',
  paymentReminderBody: '<p>Dear {{primaryRecipientName}},</p><p>Please find below the outstanding buyer invoices for your attention.</p><p>{{invoiceTable}}</p><p>This reminder includes overdue invoices and invoices due within {{daysAhead}} days. Please arrange payment or let us know the expected payment date.</p><p><strong>Late payment interest warning:</strong> where payment remains overdue, a late payment interest charge of <strong>2.00% per month</strong> may apply.</p><p>Regards,<br>Fratelli Cosulich</p>',
};
const BUYER_INVOICE_COLLECTION_STATUSES = [
  'Not Started',
  'Reminder Sent',
  'Awaiting Buyer Reply',
  'Promise to Pay',
  'Escalated',
  'Paid / Closed',
  'On Hold',
];
const BUYER_INVOICE_EVENT_TYPES = ['update', 'status_change', 'note', 'follow_up', 'promise', 'owner_change'];
const DISPUTE_BETA_WORKFLOW_STATUSES = ['Draft', 'Pending Approval', 'Revision Requested', 'Rejected', 'Approved - Pending Accounting', 'Accounting In Progress', 'Settled - Ready to Close', 'Closed'];
const DISPUTE_BETA_APPROVAL_STATUSES = ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Revision Requested'];
const DISPUTE_BETA_EXECUTION_STATUSES = ['Pending Accounting', 'Instruction Issued', 'Settled', 'Not Required'];
const DISPUTE_BETA_ACTION_LABELS = {
  hold_supplier_payment: 'Hold supplier payment',
  pay_full_supplier_invoice: 'Pay full supplier invoice amount',
  deduct_specific_amount: 'Deduct specific amount',
  resolve_supplier_dispute: 'Resolve supplier dispute',
  issue_buyer_credit_note: 'Issue credit note to buyer',
  close_supplier_dispute: 'Close dispute with supplier',
  close_buyer_dispute: 'Close dispute with buyer',
};
const DISPUTE_BETA_BALANCE_PAYMENT_INSTRUCTIONS = ['No Balance Payment', 'Pay Immediately', 'Pay with next supplier invoice'];
const DISPUTE_WORKFLOW_DOCUMENT_TYPES = new Set([
  'settlement_agreement',
  'buyer_credit_note',
  'supplier_credit_note',
  'payment_instruction',
  'proof_of_payment',
  'correspondence',
  'other_support',
]);
const DISPUTE_WORKFLOW_MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
const DISPUTE_WORKFLOW_DOCUMENT_DIRECTIONS = new Set(['from_supplier', 'to_supplier', 'from_buyer', 'to_buyer']);
const DISPUTE_BETA_CASE_SELECT = 'id,stem_id,stem_name,buyer_name,supplier_names,current_salesforce_status,workflow_status,approval_status,latest_note,submitted_by,submitted_by_email,submitted_at,approved_by,approved_by_email,approved_at,rejected_by,rejected_by_email,rejected_at,rejection_reason,closed_by,closed_by_email,closed_at,settlement_financials,settlement_pnl,salesforce_writeback_status,salesforce_writeback_error,created_at,updated_at';
const DISPUTE_WORKFLOW_PARTY_SELECT = 'id,case_id,stem_id,account_id,account_key,account_name,roles,source_types,source_record_ids,payment_terms,products,cancelled_source_only,created_by,created_by_email,updated_by,updated_by_email,created_at,updated_at';
const DISPUTE_BETA_ACTION_SELECT = 'id,case_id,stem_id,party_id,party_side,action_type,action_label,amount,special_sell_price,special_buy_price,quantity,quantity_unit,close_reason,balance_payment_instruction,description,requires_attachment,execution_status,instruction_reference,instruction_date,instruction_amount,settlement_reference,settlement_date,settlement_amount,accounting_note,accounting_by,accounting_by_email,accounting_at,executed_by,executed_by_email,executed_at,execution_note,created_by,created_by_email,updated_by,updated_by_email,created_at,updated_at';
const DISPUTE_SUPPLIER_INSTRUCTION_SELECT = 'id,case_id,action_id,party_id,stem_id,instruction_type,recovery_method,source_supplier_invoice_id,source_supplier_invoice_name,source_stem_id,target_supplier_invoice_id,target_supplier_invoice_name,target_stem_id,currency_iso_code,planned_amount,allocated_amount,source_invoice_amount_snapshot,source_payable_balance_snapshot,source_paid_amount_snapshot,target_invoice_amount_snapshot,target_payable_amount_snapshot,source_invoice_snapshot,source_stem_snapshot,target_invoice_snapshot,target_stem_snapshot,payment_snapshot,allocation_fingerprint,status,matched_salesforce_payment_id,matching_payment_snapshot,instruction_reference,instruction_date,instruction_amount,settlement_reference,settlement_date,settlement_amount,accounting_note,revision,created_by,created_by_email,updated_by,updated_by_email,created_at,updated_at,acknowledged_by,acknowledged_by_email,acknowledged_at,settled_by,settled_by_email,settled_at';
const DISPUTE_SUPPLIER_INSTRUCTION_STATUSES = new Set([
  'Provisional Hold',
  'Hold Acknowledged',
  'Pending Accounting',
  'Instruction Issued',
  'Settled',
  'Not Required',
  'Superseded',
]);
const DISPUTE_BETA_EVENT_SELECT = 'id,case_id,action_id,stem_id,event_type,note,metadata,actor_user_id,actor_email,created_at';
const DISPUTE_WORKFLOW_DOCUMENT_SELECT = 'id,case_id,action_id,supplier_instruction_id,party_id,party_side,stem_id,party_name,party_account_id,document_direction,document_type,original_filename,requested_filename,smart_filename,upload_status,content_type,file_extension,content_size,salesforce_content_version_id,salesforce_content_document_id,salesforce_linked_record_id,salesforce_url,uploaded_by,uploaded_by_email,created_at';

function canonicalDisputeBetaCloseReason(value, allowed = []) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return allowed.find((reason) => reason.toLowerCase() === raw.toLowerCase()) || raw;
}

function normalizedUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, '');
}

function buyerInvoiceAppUrl(settings = {}) {
  return normalizedUrl(settings.appUrl)
    || normalizedUrl(process.env.BUYER_INVOICE_REPORT_APP_URL)
    || normalizedUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL)
    || normalizedUrl(process.env.VERCEL_URL)
    || 'https://fcos.fcuno.com';
}

function buyerInvoiceFilterUrl(settings, report, buyerTrader) {
  const url = new URL('/buyer-invoices', buyerInvoiceAppUrl(settings));
  url.searchParams.set('daysAhead', String(settings.daysAhead ?? report.daysAhead ?? DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.daysAhead));
  if (buyerTrader) url.searchParams.set('buyerTrader', buyerTrader);
  return url.toString();
}

function incomingPaymentAppUrl(settings = {}) {
  return normalizedUrl(settings.appUrl)
    || normalizedUrl(process.env.INCOMING_PAYMENT_REPORT_APP_URL)
    || normalizedUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL)
    || normalizedUrl(process.env.VERCEL_URL)
    || 'https://fcos.fcuno.com';
}

function incomingPaymentFilterUrl(settings, report) {
  const url = new URL('/incoming-payments', incomingPaymentAppUrl(settings));
  if (report.dateFrom) url.searchParams.set('dateFrom', String(report.dateFrom));
  if (report.dateTo) url.searchParams.set('dateTo', String(report.dateTo));
  if (report.search) url.searchParams.set('search', String(report.search));
  return url.toString();
}

function incomingPaymentStemUrl(settings = {}, stemId) {
  const url = new URL('/incoming-payments', incomingPaymentAppUrl(settings));
  if (stemId) url.searchParams.set('stemId', String(stemId));
  return url.toString();
}

function serverEmailDeliveryStatus() {
  const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
  const enabled = isExternalActionEnabled('email_delivery');
  return {
    hasServerProvider: hasSmtp && enabled,
    configured: hasSmtp,
    enabled,
    provider: hasSmtp ? 'smtp' : 'none',
    sender: hasSmtp ? maskValue(process.env.SMTP_USER) : null,
    scope: hasSmtp ? 'shared_server' : 'none',
  };
}

function maskValue(value, visibleStart = 3, visibleEnd = 3) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) {
    const [name, domain] = raw.split('@');
    const maskedName = name.length <= 2 ? `${name[0] || ''}***` : `${name.slice(0, 2)}***`;
    return `${maskedName}@${domain}`;
  }
  if (raw.length <= visibleStart + visibleEnd) return '***';
  return `${raw.slice(0, visibleStart)}***${raw.slice(-visibleEnd)}`;
}

function configuredEnv(names) {
  return Object.fromEntries(names.map((name) => [name, Boolean(process.env[name])]));
}

function missingEnv(names) {
  return names.filter((name) => !process.env[name]);
}

function jwtExpiresAt(token) {
  try {
    const [, payload] = String(token || '').split('.');
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

function addSecondsIso(seconds) {
  const amount = Number(seconds);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return new Date(Date.now() + amount * 1000).toISOString();
}

async function timedCheck(run) {
  const startedAt = Date.now();
  try {
    const details = await run();
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      details: details || {},
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error.message || 'Health check failed',
    };
  }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error_description || data.error?.message || data.message || `Request failed: ${response.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function healthRow(base, result = null) {
  const checkedAt = new Date().toISOString();
  if (!base.configured) {
    return {
      ...base,
      status: 'not_configured',
      checkedAt,
      latencyMs: null,
      error: null,
    };
  }
  if (!result) {
    return {
      ...base,
      status: 'configured',
      checkedAt,
      latencyMs: null,
      error: null,
    };
  }
  return {
    ...base,
    status: result.ok ? (base.warning ? 'warning' : 'online') : 'error',
    checkedAt,
    latencyMs: result.latencyMs,
    error: result.error || null,
    details: { ...(base.details || {}), ...(result.details || {}) },
  };
}

async function salesforceHealthRow() {
  const authMode = salesforceAuthMode();
  const usesJwt = authMode === 'jwt';
  const usesRefreshToken = authMode === 'refresh_token';
  const usesAccessToken = authMode === 'access_token';
  const isMisconfigured = authMode === 'misconfigured';
  const required = usesJwt
    ? ['SALESFORCE_JWT_CLIENT_ID', 'SALESFORCE_JWT_USERNAME', 'SALESFORCE_JWT_PRIVATE_KEY']
    : usesRefreshToken
      ? ['SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET', 'SALESFORCE_REFRESH_TOKEN']
      : isMisconfigured
        ? ['SALESFORCE_JWT_CLIENT_ID', 'SALESFORCE_JWT_USERNAME', 'SALESFORCE_JWT_PRIVATE_KEY', 'SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET', 'SALESFORCE_REFRESH_TOKEN']
        : ['SALESFORCE_ACCESS_TOKEN'];
  const configured = authMode !== 'missing' && !isMisconfigured;
  const result = isMisconfigured ? {
    ok: false,
    latencyMs: null,
    error: 'Salesforce OAuth env vars are missing or blank.',
  } : configured ? await timedCheck(async () => {
    const limits = await sfRequest('/limits');
    return {
      apiVersion: process.env.SALESFORCE_API_VERSION || 'v59.0',
      instanceUrl: getInstanceUrl(),
      limitsChecked: Boolean(limits),
    };
  }) : null;
  return healthRow({
    id: 'salesforce',
    name: 'Salesforce REST API',
    category: 'Salesforce',
    purpose: 'Dashboard, STEM details, documents, invoices, brokers, disputes, and payments.',
    scope: 'server',
    provider: 'Salesforce',
    endpoint: getInstanceUrl(),
    authType: usesJwt ? 'OAuth JWT bearer' : usesRefreshToken ? 'OAuth refresh token' : usesAccessToken ? 'Temporary access token' : isMisconfigured ? 'OAuth misconfigured' : 'OAuth',
    configured: configured || isMisconfigured,
    configuredEnv: configuredEnv([
      'SALESFORCE_JWT_CLIENT_ID',
      'SALESFORCE_JWT_USERNAME',
      'SALESFORCE_JWT_PRIVATE_KEY',
      'SALESFORCE_CLIENT_ID',
      'SALESFORCE_CLIENT_SECRET',
      'SALESFORCE_REFRESH_TOKEN',
      'SALESFORCE_ACCESS_TOKEN',
      'SALESFORCE_INSTANCE_URL',
      'SALESFORCE_LOGIN_URL',
      'SALESFORCE_API_VERSION',
    ]),
    missingEnv: usesJwt || usesRefreshToken ? [] : missingEnv(required),
    tokenExpiry: usesJwt
      ? 'JWT bearer issues short-lived access tokens on demand. Long-term validity depends on the Connected App certificate and user access.'
      : usesRefreshToken
        ? 'Refresh token expiry is not exposed by Salesforce; access tokens are refreshed on demand.'
        : usesAccessToken
          ? 'Temporary access token expiry is not exposed to the app.'
          : null,
    warning: isMisconfigured || (usesAccessToken && !usesRefreshToken),
    notes: usesJwt
      ? ['Preferred durable mode. Rotate the Connected App certificate before it expires.']
      : isMisconfigured
        ? ['Salesforce OAuth variables exist but at least one required value is blank. The temporary access-token fallback is intentionally blocked until durable auth is fixed.']
      : usesAccessToken && !usesRefreshToken
        ? ['Using SALESFORCE_ACCESS_TOKEN fallback. Replace with JWT bearer or refresh-token OAuth env vars for durable production use.']
        : ['Connected app refresh-token policy controls long-term validity.'],
  }, result);
}

async function supabaseHealthRow() {
  const required = ['SUPABASE_SERVICE_ROLE_KEY'];
  const hasUrl = Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const configured = hasUrl && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const result = configured ? await timedCheck(async () => {
    const client = supabaseAdminClient();
    const { error: authError } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (authError) throw authError;
    const { count, error: profileError } = await client
      .from('user_profiles')
      .select('id', { count: 'exact', head: true });
    if (profileError) throw profileError;
    return {
      userProfilesCount: count ?? null,
    };
  }) : null;
  return healthRow({
    id: 'supabase',
    name: 'Supabase Auth and Database',
    category: 'Database',
    purpose: 'User access control, collection workflow, email schedules, report archive audit, dispute workflow, cashflow settings, and universal audit trail.',
    scope: 'server',
    provider: 'Supabase',
    endpoint: hasUrl ? maskValue(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, 18, 8) : null,
    authType: 'Service role key',
    configured,
    configuredEnv: {
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      VITE_SUPABASE_URL: Boolean(process.env.VITE_SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
    missingEnv: [
      ...(hasUrl ? [] : ['SUPABASE_URL or VITE_SUPABASE_URL']),
      ...missingEnv(required),
    ],
    tokenExpiry: jwtExpiresAt(process.env.SUPABASE_SERVICE_ROLE_KEY) || 'No expiry claim exposed.',
    notes: ['Service role key is never sent to the browser.'],
  }, result);
}

async function backboneBridgeHealthRow(accessContext) {
  const config = backboneBridgeConfig();
  const result = config.configured ? await timedCheck(async () => {
    const response = await backboneBridgeRequest(authenticatedBackboneBridgePayload(
      { operation: 'identity.resolve' },
      accessContext,
    ));
    return {
      schemaVersion: response.schemaVersion,
      identityLinked: Boolean(response.identity?.userId),
      officeCodes: response.identity?.officeCodes || [],
      roles: response.identity?.roles || [],
      mode: response.authority?.mode || null,
      credentialVersion: response.bridgeCredentialVersion,
    };
  }) : null;
  return healthRow({
    id: 'fcos-backbone-bridge',
    name: 'FCOS Backbone Shared Boundary',
    category: 'Shared Platform',
    purpose: 'Resolves the current FCOS user to Backbone and reads scoped trade projections and audit without changing FCOS live operations.',
    scope: 'server',
    provider: 'FCOS Backbone',
    endpoint: `${config.baseUrl}/api/fcos/v1/bridge`,
    authType: 'Timestamped HMAC with one-time request id',
    details: {
      credentialRotation: 'Backbone reports only the accepted credential label after a valid signed request.',
    },
    configured: config.configured,
    configuredEnv: {
      FCOS_BACKBONE_URL: Boolean(process.env.FCOS_BACKBONE_URL),
      FCOS_BACKBONE_BRIDGE_SECRET: Boolean(process.env.FCOS_BACKBONE_BRIDGE_SECRET),
    },
    missingEnv: config.configured ? [] : ['FCOS_BACKBONE_BRIDGE_SECRET'],
    tokenExpiry: 'Each signed request expires after five minutes and its request id cannot be replayed.',
    notes: [
      'Read-only shadow boundary. Salesforce and the dedicated FCOS Supabase project remain live during parallel operation.',
      'During a rotation window, credentialVersion should return primary before the previous Backbone secret is removed.',
    ],
  }, result);
}

async function googleDriveHealthRow() {
  const required = ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN', 'GOOGLE_DRIVE_REPORT_FOLDER_ID'];
  const configured = missingEnv(required).length === 0;
  const gateEnabled = isExternalActionEnabled('google_drive');
  const result = configured && gateEnabled ? await timedCheck(async () => {
    const { clientId, clientSecret, refreshToken, folderId } = googleDriveConfig();
    const token = await fetchJsonWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });
    if (!token.access_token) throw new Error('Google OAuth did not return an access token.');
    const fields = encodeURIComponent('id,name,mimeType,trashed');
    const folder = await fetchJsonWithTimeout(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    return {
      accessTokenExpiresAt: addSecondsIso(token.expires_in),
      folderName: folder.name || null,
      folderId: maskValue(folder.id, 6, 4),
      folderTrashed: folder.trashed === true,
    };
  }) : null;
  const row = healthRow({
    id: 'google-drive',
    name: 'Google Drive Report Archive',
    category: 'Reports',
    purpose: 'Stores exported XLS reports and supports archive rename, download, open, and delete actions.',
    scope: 'server',
    provider: 'Google Drive API',
    endpoint: 'https://www.googleapis.com/drive/v3',
    authType: 'OAuth refresh token',
    configured,
    configuredEnv: configuredEnv(required),
    missingEnv: missingEnv(required),
    tokenExpiry: configured ? 'Refresh token expiry is not exposed by Google; short-lived access-token expiry is checked live.' : null,
    details: { gateEnabled },
    notes: gateEnabled
      ? ['Files are uploaded as XLS files, not converted to Google Sheets.']
      : ['Google Drive has been paused by its emergency control. The legacy archive path remains intact.'],
  }, result);
  return gateEnabled ? row : { ...row, status: 'disabled', latencyMs: null, error: null };
}

function externalActionGateHealthRow() {
  const gates = externalActionGates();
  const unexpected = Object.values(gates).filter((gate) => (
    gate.expectedState === 'live' ? !gate.enabled : gate.enabled
  ));
  return {
    id: 'external-action-gates',
    name: 'External action gates',
    category: 'Safety',
    purpose: 'Keeps established FCOS integrations live while retaining emergency controls and UAT gates for new side effects.',
    scope: 'server',
    provider: 'FCOS',
    endpoint: null,
    authType: 'Deployment-controlled operational controls',
    configured: true,
    status: unexpected.length ? 'warning' : 'online',
    checkedAt: new Date().toISOString(),
    latencyMs: null,
    error: null,
    tokenExpiry: 'Not applicable.',
    details: Object.fromEntries(Object.values(gates).map((gate) => [
      gate.label,
      `${gate.enabled ? 'Enabled' : 'Disabled'} (${gate.expectedState === 'live' ? 'existing live function' : 'UAT gated'})`,
    ])),
    notes: unexpected.length
      ? [`Review unexpected connector state: ${unexpected.map((gate) => gate.label).join(', ')}.`]
      : ['Existing Salesforce, Google Drive, and email functions are live. New bank and payment-promotion actions remain UAT gated.'],
  };
}

async function frankfurterHealthRow() {
  const result = await timedCheck(async () => {
    const data = await fetchJsonWithTimeout('https://api.frankfurter.dev/v2/rate/USD/CNY?date=2024-01-02');
    return {
      sampleDate: data.date,
      base: data.base,
      quote: data.quote,
      rateAvailable: Number.isFinite(Number(data.rate)),
    };
  });
  return healthRow({
    id: 'frankfurter',
    name: 'Frankfurter USD/CNY API',
    category: 'Exchange Rate',
    purpose: "Broker's Commission CNY conversion. API mid-rate is reduced by 0.2% to estimate bank buy rate.",
    scope: 'public',
    provider: 'Frankfurter',
    endpoint: 'https://api.frankfurter.dev/v2/rate/USD/CNY',
    authType: 'No API key',
    configured: true,
    tokenExpiry: 'Not applicable.',
  }, result);
}

async function nagerHealthRow() {
  const year = new Date().getUTCFullYear();
  const result = await timedCheck(async () => {
    const data = await fetchJsonWithTimeout(`https://date.nager.at/api/v4/Holidays/SG/${year}`);
    return {
      sampleCountry: 'SG',
      sampleYear: year,
      holidayCount: Array.isArray(data) ? data.length : null,
    };
  });
  return healthRow({
    id: 'nager-date',
    name: 'Nager.Date Holiday API',
    category: 'Cashflow Forecast',
    purpose: 'Weekend, Singapore public holiday, and US holiday blocking for cashflow forecast dates.',
    scope: 'public',
    provider: 'Nager.Date',
    endpoint: 'https://date.nager.at/api/v4/Holidays',
    authType: 'No API key',
    configured: true,
    tokenExpiry: 'Not applicable.',
    notes: ['Holiday results are cached in Supabase when available.'],
  }, result);
}

async function smtpHealthRow() {
  const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'];
  const configured = missingEnv(required).length === 0;
  const result = configured ? await timedCheck(async () => {
    const nodemailer = await import('nodemailer');
    const createTransport = nodemailer.createTransport || nodemailer.default?.createTransport;
    if (!createTransport) throw new Error('SMTP email library failed to load.');
    const port = Number(process.env.SMTP_PORT || 587);
    const transporter = createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE != null ? process.env.SMTP_SECURE === 'true' : port === 465,
      connectionTimeout: 7000,
      greetingTimeout: 7000,
      socketTimeout: 10000,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
    await transporter.verify();
    return {
      host: process.env.SMTP_HOST,
      port,
      user: maskValue(process.env.SMTP_USER),
    };
  }) : null;
  return healthRow({
    id: 'server-smtp',
    name: 'Shared Server SMTP Sender',
    category: 'Email',
    purpose: 'Shared sender for every External Payment Reminder, plus scheduled and server-generated email delivery.',
    scope: 'server',
    provider: 'SMTP',
    endpoint: process.env.SMTP_HOST || null,
    authType: 'SMTP username/password',
    configured,
    configuredEnv: configuredEnv(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_SECURE']),
    missingEnv: missingEnv(required),
    tokenExpiry: 'Not applicable.',
    details: { deliveryGateEnabled: isExternalActionEnabled('email_delivery') },
    notes: ['This check verifies login only; it does not send an email. The emergency delivery control is reported separately.'],
  }, result);
}

function cronHealthRow() {
  const configured = Boolean(process.env.CRON_SECRET);
  return healthRow({
    id: 'vercel-cron',
    name: 'Vercel Cron Protection',
    category: 'Scheduling',
    purpose: 'Protects the retained scheduled Outstanding Buyer Invoices email path; delivery can be paused by its emergency control.',
    scope: 'server',
    provider: 'Vercel Cron',
    endpoint: '/api/functions/outstandingBuyerInvoicesEmailCron',
    authType: 'Bearer CRON_SECRET',
    configured,
    configuredEnv: configuredEnv(['CRON_SECRET']),
    missingEnv: configured ? [] : ['CRON_SECRET'],
    tokenExpiry: 'Not applicable.',
    details: { deliveryGateEnabled: isExternalActionEnabled('email_delivery') },
  });
}

function vercelRuntimeHealthRow() {
  const configured = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
  return healthRow({
    id: 'vercel-runtime',
    name: 'Vercel Runtime',
    category: 'Hosting',
    purpose: 'Hosts the React app and serverless API functions.',
    scope: 'server',
    provider: 'Vercel',
    endpoint: process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || null,
    authType: 'Deployment environment',
    configured,
    details: {
      environment: process.env.VERCEL_ENV || null,
      region: process.env.VERCEL_REGION || process.env.AWS_REGION || null,
    },
    tokenExpiry: 'Not applicable.',
  });
}

function googleFontsHealthRow() {
  return healthRow({
    id: 'google-fonts',
    name: 'Google Fonts',
    category: 'Frontend Asset',
    purpose: 'Loads Inter and DM Sans web fonts from the CSS import.',
    scope: 'browser',
    provider: 'Google Fonts',
    endpoint: 'https://fonts.googleapis.com',
    authType: 'No API key',
    configured: true,
    tokenExpiry: 'Not applicable.',
    notes: ['Loaded by the browser as a frontend asset, not through the server API.'],
  });
}

async function systemHealth(_body, _req, accessContext) {
  const profile = accessContext?.profile;
  const rows = await Promise.all([
    salesforceHealthRow(),
    supabaseHealthRow(),
    profile ? backboneBridgeHealthRow(accessContext) : Promise.resolve(healthRow({
      id: 'fcos-backbone-bridge',
      name: 'FCOS Backbone Shared Boundary',
      category: 'Shared Platform',
      purpose: 'Resolves FCOS identities and reads Backbone projections.',
      scope: 'server',
      provider: 'FCOS Backbone',
      endpoint: null,
      authType: 'Timestamped HMAC',
      configured: false,
      missingEnv: ['Active FCOS profile'],
    })),
    googleDriveHealthRow(),
    frankfurterHealthRow(),
    nagerHealthRow(),
    smtpHealthRow(),
  ]);
  rows.push(externalActionGateHealthRow(), cronHealthRow(), vercelRuntimeHealthRow(), googleFontsHealthRow());
  const summary = rows.reduce((acc, row) => {
    acc.total += 1;
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, { total: 0 });
  return {
    generatedAt: new Date().toISOString(),
    summary,
    externalActionGates: externalActionGates(),
    rows,
  };
}

async function backboneBridgeIdentity(_body, req, accessContext = null) {
  const context = accessContext || await requireActiveUser(req);
  return backboneBridgeRequest(authenticatedBackboneBridgePayload(
    { operation: 'identity.resolve' },
    context,
  ));
}

async function backboneTradeProjection(body, req, accessContext = null) {
  const context = accessContext || await requireActiveUser(req);
  const operation = String(body.operation || 'trade.find');
  if (!['trade.find', 'trade.changes', 'audit.list'].includes(operation)) {
    throw appError('Unsupported FCOS Backbone read operation.', 400);
  }
  const payload = authenticatedBackboneBridgePayload({ ...body, operation }, context);
  const response = await backboneBridgeRequest(payload);
  return browserSafeBackboneTradeProjection(response);
}

async function backboneFinanceHandoffs(body = {}, req, accessContext = null) {
  const context = accessContext || await requireActiveUser(req);
  const limit = body.limit == null ? 50 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw appError('Finance handoff limit must be between 1 and 100.', 400);
  }
  return backboneBridgeRequest(authenticatedBackboneBridgePayload(
    { operation: 'finance.handoffs', limit },
    context,
  ));
}

async function backboneFinanceHandoffDetail(body = {}, req, accessContext = null) {
  const context = accessContext || await requireActiveUser(req);
  const handoffId = String(body.handoffId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(handoffId)) {
    throw appError('A valid Finance handoff is required.', 400);
  }
  const response = await backboneBridgeRequest(authenticatedBackboneBridgePayload(
    { operation: 'finance.handoff.detail', handoffId },
    context,
  ));
  return browserSafeBackboneFinanceHandoff(response);
}

function isSafeSalesforceFieldPath(value) {
  const parts = String(value || '').trim().split('.').filter(Boolean);
  if (!parts.length || parts.length > 4) return false;
  return parts.every((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part));
}

function normalizeSalesforceFieldPath(value) {
  const raw = String(value || '').trim();
  return isSafeSalesforceFieldPath(raw) ? raw : '';
}

function numericValue(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numericValue(value);
    if (number != null) return number;
  }
  return null;
}

function litersPerMetricTon(item) {
  const family = String(item['Product__r']?.Family || item['Product2Id__r']?.Family || '').toUpperCase();
  const productName = String(item['Product__r']?.Name || item['Product2Id__r']?.Name || item.Name || item.Description__c || '').toUpperCase();
  if (family.includes('LSMGO') || family.includes('MGO') || productName.includes('LSMGO') || productName.includes('MGO') || productName.includes('DIESEL')) return 1200;
  if (family.includes('VLSFO') || productName.includes('VLSFO')) return 1030;
  if (family.includes('HSFO') || productName.includes('HSFO')) return 1030;
  return null;
}

function dashboardProductFamily(item) {
  const family = String(item['Product__r']?.Family || item['Product2Id__r']?.Family || '').toUpperCase();
  const productName = String(item['Product__r']?.Name || item['Product2Id__r']?.Name || item.Name || item.Description__c || '').toUpperCase();
  const text = `${family} ${productName}`;
  if (text.includes('LSMGO') || text.includes('MGO') || text.includes('DIESEL') || /\bDMA\b/.test(text) || /\bDMB\b/.test(text)) return 'LSMGO';
  if (text.includes('VLSFO')) return 'VLSFO';
  if (text.includes('HSFO')) return 'HSFO';
  if (text.includes('RMG') || text.includes('RME') || text.includes('RMK')) {
    if (/3\.?5|380CST|180CST|500CST/.test(text) && !/0\.5|0\.50|0\.1|0\.10|0\.05/.test(text)) return 'HSFO';
    return 'VLSFO';
  }
  return family || productName || 'Unspecified';
}

function deliveredQuantityInMt(item) {
  const delivered = firstNumber(item.Quantity_Delivered_Per_BDN__c);
  if (delivered == null) return null;
  const litersPerMt = litersPerMetricTon(item);
  if (!litersPerMt) return delivered;
  const quantityInMt = firstNumber(item.Quantity_in_MT__c);
  const looksLikeLiters = quantityInMt != null && quantityInMt > 0
    ? delivered > quantityInMt * 20
    : delivered >= litersPerMt * 50;
  return looksLikeLiters ? delivered / litersPerMt : delivered;
}

function financialQuantity(item, stemHasDelivery, maxField = 'Quantity_Max__c') {
  if (stemHasDelivery) {
    return firstNumber(deliveredQuantityInMt(item), item.Quantity__c, item.Quantity_in_MT__c) || 0;
  }
  const min = firstNumber(item.Quantity__c, item.Quantity_in_MT__c, item.Quantity_Delivered_Per_BDN__c);
  const max = firstNumber(item[maxField]);
  if (item.Is_Quantity_Range__c && min != null && max != null) return (min + max) / 2;
  return min || 0;
}

function formatQuantityLabel(value, unit = 'MT') {
  return `${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unit}`;
}

function lineItemQuantityLabel(item, stemHasDelivery) {
  if (stemHasDelivery) return formatQuantityLabel(financialQuantity(item, true));
  const min = firstNumber(item.Quantity__c, item.Quantity_in_MT__c, item.Quantity_Delivered_Per_BDN__c);
  const max = firstNumber(item.Quantity_Max__c);
  if (item.Is_Quantity_Range__c && min != null && max != null) {
    return `${Number(min).toLocaleString('en-US', { maximumFractionDigits: 3 })}-${Number(max).toLocaleString('en-US', { maximumFractionDigits: 3 })} MT`;
  }
  return formatQuantityLabel(financialQuantity(item, false));
}

function lineSellAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return item.Total_Price__c ?? 0;
  const unit = firstNumber(item.Price_Per_Unit__c, item.Unit_Sell_At__c, item['Offer_Line_Item__r']?.UnitPrice);
  const qty = financialQuantity(item, false);
  return unit != null ? unit * qty : (item.Total_Price__c ?? 0);
}

function lineBuyAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return item.Total_Cost__c ?? 0;
  const unit = firstNumber(item.Cost_Per_Unit__c, item.Unit_Buy_At__c, item.Unit_Cost__c, item['Offer_Line_Item__r']?.Supplier_Unit_Price__c);
  const qty = financialQuantity(item, false);
  return unit != null ? unit * qty : (item.Total_Cost__c ?? 0);
}

function extraSellAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return item.Line_Total__c ?? 0;
  const unit = firstNumber(item.Unit_Price__c);
  const qty = financialQuantity(item, false, 'Quantity_Range_Max__c');
  return unit != null ? unit * qty : (item.Line_Total__c ?? 0);
}

function extraBuyAmount(item, stemHasDelivery) {
  if (stemHasDelivery) return item.Line_Total_Buy__c ?? 0;
  const unit = firstNumber(item.Unit_Cost__c);
  const qty = financialQuantity(item, false, 'Quantity_Range_Max__c');
  return unit != null ? unit * qty : (item.Line_Total_Buy__c ?? 0);
}

function supplierBrokerCommission(item, stemHasDelivery) {
  return (item.Suppliers_Brokers_Commission_Per_Unit__c ?? 0) * financialQuantity(item, stemHasDelivery);
}

function buyerBrokerCommission(item, stemHasDelivery) {
  const qty = financialQuantity(item, stemHasDelivery);
  const buyerPerUnitTotal = (item.Buyers_Brokers_Commission_Per_Unit__c ?? 0) * qty;
  const suppBrokerPerUnit = item.Suppliers_Brokers_Commission_Per_Unit__c ?? 0;
  if (suppBrokerPerUnit !== 0 || item.Buyers_Brokers_Commission_Per_Unit__c != null) return buyerPerUnitTotal;
  return item.Commission_Cost__c ?? buyerPerUnitTotal;
}

function formatStemName(stem) {
  const parts = [stem.KeyStem__c, stem['Vessel__r']?.Name, stem['Port__r']?.Name].filter(Boolean);
  return parts.length ? parts.join(' - ') : stem.Name;
}

function parseEmailList(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string') return fallback;
  const parsed = value.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function uniqueEmailList(...values) {
  const seen = new Set();
  const emails = [];
  const addValue = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) addValue(item);
      return;
    }
    if (typeof value !== 'string') return;
    for (const email of value.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean)) {
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      emails.push(email);
    }
  };
  for (const value of values) addValue(value);
  return emails;
}

function uniqueTextList(values = []) {
  const seen = new Set();
  const items = [];
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(text);
  }
  return items;
}

function normalizedFieldToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function fieldMatchesAny(field, exactTokens = [], includeTokens = []) {
  const values = [field?.name, field?.label].map(normalizedFieldToken).filter(Boolean);
  if (values.some((value) => exactTokens.includes(value))) return true;
  return values.some((value) => includeTokens.some((token) => value.includes(token)));
}

function accountInvoiceFormatFields(accountFields = []) {
  return accountFields
    .filter((field) => {
      const token = normalizedFieldToken(`${field?.name || ''} ${field?.label || ''}`);
      return fieldMatchesAny(field, [
        'invoiceformat',
        'invoiceformatc',
        'invoiceemailsetting',
        'invoiceemailsettingc',
        'invoiceemailformat',
        'invoiceemailformatc',
        'invoiceemailrouting',
        'invoiceemailroutingc',
      ], [
        'invoiceformat',
        'invoiceemailsetting',
        'invoiceemailformat',
        'invoiceemailrouting',
        'brokerinvoiceformat',
        'brokerinvoiceemail',
      ])
        || (token.includes('invoiceemail') && ['picklist', 'multipicklist', 'string'].includes(field?.type));
    })
    .map((field) => field.name);
}

function accountBrokerEmailFields(accountFields = []) {
  const excluded = (field) => {
    const token = normalizedFieldToken(`${field?.name || ''} ${field?.label || ''}`);
    return token.includes('invoice') || token.includes('accounts') || token.includes('accounting');
  };
  return accountFields
    .filter((field) => {
      if (excluded(field)) return false;
      const token = normalizedFieldToken(`${field?.name || ''} ${field?.label || ''}`);
      return fieldMatchesAny(field, [
        'email',
        'emailc',
        'emailaddress',
        'emailaddressc',
        'brokeremail',
        'brokeremailc',
        'brokeremailaddress',
        'brokeremailaddressc',
      ])
        || field.type === 'email'
        || token.includes('email')
        || token.includes('mail');
    })
    .map((field) => field.name);
}

function emailTokensFromValue(value) {
  if (Array.isArray(value)) return value.flatMap(emailTokensFromValue);
  return [...String(value || '').matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
    .map((match) => match[0]);
}

function routingFormatValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const text = raw.toLowerCase().replace(/[./_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (
    text.includes('buyer only')
    || text.includes('broker only')
    || /^to broker\b/.test(text)
    || text.includes('buyer c o broker')
    || text.includes('buyer co broker')
    || text.includes('buyer cc broker')
    || text.includes('cc broker')
    || text.includes('copy broker')
    || text.includes('c o broker')
  ) {
    return raw;
  }
  return null;
}

function buyerBrokerRoutingMode(format, brokerEmails = []) {
  const raw = String(format || '').trim();
  const text = raw.toLowerCase().replace(/[./_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const hasBrokerEmail = uniqueEmailList(brokerEmails).length > 0;
  if (!raw) {
    return {
      mode: 'buyer_only',
      label: 'Buyer Only',
      warnings: ['Broker invoice/email format is blank; broker email is not automatically added to BCC.'],
    };
  }
  if (text.includes('buyer only')) {
    return { mode: 'buyer_only', label: raw, warnings: [] };
  }
  if (text.includes('broker only') || /^to broker\b/.test(text)) {
    return {
      mode: 'broker_only',
      label: raw,
      warnings: hasBrokerEmail ? [] : [`Broker email is missing for ${raw}; enter the broker email manually before sending.`],
    };
  }
  if (
    text.includes('buyer c o broker')
    || text.includes('buyer co broker')
    || text.includes('buyer cc broker')
    || text.includes('cc broker')
    || text.includes('copy broker')
    || text.includes('c o broker')
  ) {
    return {
      mode: 'buyer_cc_broker',
      label: raw,
      warnings: hasBrokerEmail ? [] : [`Broker email is missing for ${raw}; buyer remains the recipient and broker CC is blank.`],
    };
  }
  return {
    mode: 'buyer_only',
    label: raw,
    warnings: [`Unknown broker invoice/email format "${raw}"; broker email is not automatically added to BCC.`],
  };
}

function combineBuyerBrokerRouting(details = []) {
  if (!details.length) {
    return {
      buyerBrokerNames: '',
      buyerBrokerInvoiceFormats: '',
      buyerBrokerEmails: '',
      buyerBrokerRoutingMode: 'buyer_only',
      buyerBrokerRoutingWarnings: [],
      buyerBrokerDetails: [],
    };
  }
  const warnings = [];
  const brokerEmails = [];
  const buyerOnlyBrokerEmails = [];
  const modes = [];
  for (const detail of details) {
    const routing = buyerBrokerRoutingMode(detail.invoiceFormat, detail.emails);
    modes.push(routing.mode);
    warnings.push(...routing.warnings.map((warning) => `${detail.name || 'Buyer broker'}: ${warning}`));
    if (routing.mode !== 'buyer_only') {
      brokerEmails.push(...(detail.emails || []));
    } else if (/\bbuyer\s+only\b/i.test(String(routing.label || detail.invoiceFormat || ''))) {
      buyerOnlyBrokerEmails.push(...(detail.emails || []));
    }
  }
  const validModes = modes.filter((mode) => mode !== 'buyer_only');
  const routingMode = validModes.includes('broker_only') && !validModes.includes('buyer_cc_broker')
    ? 'broker_only'
    : validModes.includes('buyer_cc_broker')
      ? 'buyer_cc_broker'
      : 'buyer_only';
  if (new Set(validModes).size > 1) {
    warnings.push('Multiple buyer broker routing formats found on this invoice; buyer with broker copied is used.');
  }
  return {
    buyerBrokerNames: uniqueTextList(details.map((detail) => detail.name)).join(', '),
    buyerBrokerInvoiceFormats: uniqueTextList(details.map((detail) => detail.invoiceFormat)).join(', '),
    buyerBrokerEmails: uniqueEmailList(routingMode === 'buyer_only' ? buyerOnlyBrokerEmails : brokerEmails).join(', '),
    buyerBrokerRoutingMode: routingMode,
    buyerBrokerRoutingWarnings: warnings,
    buyerBrokerDetails: details.map((detail) => ({
      brokerId: detail.id,
      name: detail.name,
      invoiceFormat: detail.invoiceFormat || null,
      emails: detail.emails || [],
      routingMode: buyerBrokerRoutingMode(detail.invoiceFormat, detail.emails).mode,
    })),
  };
}

function parseStringList(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string') return fallback;
  const parsed = value.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function normalizeCollectionStatus(value) {
  const status = String(value || '').trim();
  return BUYER_INVOICE_COLLECTION_STATUSES.includes(status) ? status : 'Not Started';
}

function dateOrNull(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : raw;
}

function decimalOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeEventType(value) {
  const type = String(value || '').trim();
  return BUYER_INVOICE_EVENT_TYPES.includes(type) ? type : 'update';
}

function collectionEventTypeFromChanges(changes) {
  if (Object.prototype.hasOwnProperty.call(changes, 'status')) return 'status_change';
  if (Object.prototype.hasOwnProperty.call(changes, 'owner_name')) return 'owner_change';
  if (Object.prototype.hasOwnProperty.call(changes, 'promised_payment_date') || Object.prototype.hasOwnProperty.call(changes, 'promised_amount')) return 'promise';
  if (Object.prototype.hasOwnProperty.call(changes, 'next_follow_up_date')) return 'follow_up';
  if (Object.prototype.hasOwnProperty.call(changes, 'latest_note')) return 'note';
  return 'update';
}

function serializeCollectionItem(row) {
  if (!row) return null;
  return {
    stemId: row.stem_id,
    status: row.status || 'Not Started',
    ownerUserId: row.owner_user_id || null,
    ownerName: row.owner_name || '',
    latestNote: row.latest_note || '',
    nextFollowUpDate: row.next_follow_up_date || null,
    promisedPaymentDate: row.promised_payment_date || null,
    promisedAmount: row.promised_amount == null ? null : Number(row.promised_amount),
    lastEventAt: row.last_event_at || null,
    lastUpdatedBy: row.last_updated_by || null,
    lastUpdatedByEmail: row.last_updated_by_email || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function serializeCollectionEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    stemId: row.stem_id,
    eventType: row.event_type || 'update',
    status: row.status || null,
    ownerName: row.owner_name || null,
    note: row.note || null,
    nextFollowUpDate: row.next_follow_up_date || null,
    promisedPaymentDate: row.promised_payment_date || null,
    promisedAmount: row.promised_amount == null ? null : Number(row.promised_amount),
    actorUserId: row.actor_user_id || null,
    actorEmail: row.actor_email || null,
    createdAt: row.created_at || null,
  };
}

async function loadBuyerInvoiceCollectionMap(stemIds = []) {
  const ids = [...new Set((stemIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const client = safeSupabaseAdminClient();
  if (!client) return {};

  try {
    const [itemsRes, eventsRes] = await Promise.all([
      client
        .from('buyer_invoice_collection_items')
        .select('stem_id,status,owner_user_id,owner_name,latest_note,next_follow_up_date,promised_payment_date,promised_amount,last_event_at,last_updated_by,last_updated_by_email,created_at,updated_at')
        .in('stem_id', ids),
      client
        .from('buyer_invoice_collection_events')
        .select('id,stem_id,event_type,status,owner_name,note,next_follow_up_date,promised_payment_date,promised_amount,actor_user_id,actor_email,created_at')
        .in('stem_id', ids)
        .order('created_at', { ascending: false })
        .limit(Math.max(100, Math.min(ids.length * 20, 2000))),
    ]);
    if (itemsRes.error) throw itemsRes.error;
    if (eventsRes.error) throw eventsRes.error;

    const map = {};
    for (const item of itemsRes.data || []) {
      map[item.stem_id] = { item: serializeCollectionItem(item), events: [] };
    }
    for (const event of eventsRes.data || []) {
      if (!map[event.stem_id]) map[event.stem_id] = { item: null, events: [] };
      map[event.stem_id].events.push(serializeCollectionEvent(event));
    }
    return map;
  } catch (error) {
    console.error('Failed to load buyer invoice collection metadata', error.message);
    return {};
  }
}

function normalizeCollectionUpdates(updates = {}, profile = {}) {
  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(updates, 'status')) normalized.status = normalizeCollectionStatus(updates.status);
  if (Object.prototype.hasOwnProperty.call(updates, 'ownerName') || Object.prototype.hasOwnProperty.call(updates, 'owner_name')) {
    normalized.owner_name = String(updates.ownerName ?? updates.owner_name ?? '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'latestNote') || Object.prototype.hasOwnProperty.call(updates, 'latest_note')) {
    normalized.latest_note = String(updates.latestNote ?? updates.latest_note ?? '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'nextFollowUpDate') || Object.prototype.hasOwnProperty.call(updates, 'next_follow_up_date')) {
    normalized.next_follow_up_date = dateOrNull(updates.nextFollowUpDate ?? updates.next_follow_up_date);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'promisedPaymentDate') || Object.prototype.hasOwnProperty.call(updates, 'promised_payment_date')) {
    normalized.promised_payment_date = dateOrNull(updates.promisedPaymentDate ?? updates.promised_payment_date);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'promisedAmount') || Object.prototype.hasOwnProperty.call(updates, 'promised_amount')) {
    normalized.promised_amount = decimalOrNull(updates.promisedAmount ?? updates.promised_amount);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'ownerUserId') || Object.prototype.hasOwnProperty.call(updates, 'owner_user_id')) {
    normalized.owner_user_id = updates.ownerUserId || updates.owner_user_id || null;
  } else if (normalized.owner_name && profile?.full_name && normalized.owner_name === profile.full_name) {
    normalized.owner_user_id = profile.id;
  }
  return normalized;
}

function normalizeBuyerInvoiceEmailSettings(input = {}, defaults = DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS) {
  const reminderBody = String(input.paymentReminderBody ?? defaults.paymentReminderBody)
    .replace(/Dear\s+\{\{\s*buyerName\s*\}\}/i, 'Dear {{primaryRecipientName}}')
    .replace(/To\s+\{\{\s*buyerName\s*\}\}/i, 'To {{primaryRecipientName}}');
  return {
    ...defaults,
    ...input,
    enabled: input.enabled ?? defaults.enabled,
    from: String(input.from ?? defaults.from),
    to: parseEmailList(input.to, defaults.to),
    cc: parseEmailList(input.cc, defaults.cc),
    daysAhead: Math.max(0, Math.min(Number(input.daysAhead ?? defaults.daysAhead) || defaults.daysAhead, 365)),
    subject: String(input.subject ?? defaults.subject),
    intro: String(input.intro ?? defaults.intro),
    includeSummary: input.includeSummary ?? defaults.includeSummary,
    includeTable: input.includeTable ?? defaults.includeTable,
    buyerTraders: parseStringList(input.buyerTraders, defaults.buyerTraders),
    weekdays: parseStringList(input.weekdays, defaults.weekdays),
    sendTimes: parseStringList(input.sendTimes, defaults.sendTimes),
    appUrl: input.appUrl || defaults.appUrl,
    paymentReminderRecipientFieldPath: normalizeSalesforceFieldPath(input.paymentReminderRecipientFieldPath ?? defaults.paymentReminderRecipientFieldPath),
    paymentReminderCc: parseEmailList(input.paymentReminderCc, defaults.paymentReminderCc),
    paymentReminderBcc: parseEmailList(input.paymentReminderBcc, defaults.paymentReminderBcc),
    paymentReminderSubject: String(input.paymentReminderSubject ?? defaults.paymentReminderSubject),
    paymentReminderBody: reminderBody,
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function money(value) {
  if (value == null || value === '') return '-';
  return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function prettyDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function resolveViaQuery(objectType, id, nameField = 'Name') {
  if (!id) return null;
  try {
    const rows = await queryRows(`SELECT ${nameField} FROM ${objectType} WHERE Id = '${escapeSoql(id)}' LIMIT 1`, { softFail: true });
    return rows[0]?.[nameField] ?? null;
  } catch {
    return null;
  }
}

const DOCUMENT_SOURCE_GROUPS = [
  'Direct STEM',
  'Invoices to Buyer',
  'Invoices from Suppliers',
  'Contracts and Compliance',
  'Dispute / Support',
  'Product Line Attachments',
  'Extra Cost',
  'Broker',
  'Email',
  'Other Related',
];

const SALESFORCE_ID_RE = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

function isSalesforceId(value) {
  return typeof value === 'string' && SALESFORCE_ID_RE.test(value);
}

function cleanDownloadFilename(value, fallback = 'salesforce-document') {
  return String(value || fallback)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || fallback;
}

const DOCUMENT_MIME_TYPES = {
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  eml: 'message/rfc822',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  msg: 'application/vnd.ms-outlook',
  pdf: 'application/pdf',
  png: 'image/png',
  txt: 'text/plain',
  webp: 'image/webp',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function documentContentType(filename, salesforceContentType) {
  const rawType = String(salesforceContentType || '').trim().toLowerCase();
  const genericTypes = new Set(['', 'application/octet-stream', 'application/octetstream', 'binary/octet-stream']);
  if (!genericTypes.has(rawType)) return salesforceContentType;
  const extension = String(filename || '').split('.').pop()?.toLowerCase();
  return DOCUMENT_MIME_TYPES[extension] || 'application/octet-stream';
}

function inferStemFieldSourceGroup(fieldName) {
  const lower = String(fieldName || '').toLowerCase();
  if (lower.includes('supplier') && lower.includes('invoice')) return 'Invoices from Suppliers';
  if (lower.includes('invoice') || lower.includes('factoring')) return 'Invoices to Buyer';
  if (lower.includes('nomination')) return 'Contracts and Compliance';
  if (lower.includes('dispute')) return 'Dispute / Support';
  if (lower.includes('email') || lower.includes('mail')) return 'Email';
  return null;
}

function addRelatedRecord(records, seen, { id, sourceGroup, sourceLabel, sourceObject, name }) {
  if (!isSalesforceId(id) || seen.has(id)) return;
  seen.add(id);
  records.push({
    id,
    sourceGroup: DOCUMENT_SOURCE_GROUPS.includes(sourceGroup) ? sourceGroup : 'Other Related',
    sourceLabel: sourceLabel || sourceGroup || 'Related Record',
    sourceObject: sourceObject || null,
    name: name || sourceLabel || id,
  });
}

async function resolveStemId(stemId, accessContext = null) {
  if (!stemId) throw new Error('stemId required');
  if (isSalesforceId(stemId)) {
    await requireInterofficeStemAccess(stemId, accessContext);
    return stemId;
  }
  const lookup = await queryRows(`SELECT Id FROM stem__c WHERE KeyStem__c = '${escapeSoql(stemId)}' LIMIT 1`, { softFail: true });
  if (!lookup.length) throw new Error(`STEM with KeyStem__c '${stemId}' not found`);
  await requireInterofficeStemAccess(lookup[0].Id, accessContext);
  return lookup[0].Id;
}

async function namesByIds(objectName, ids) {
  const uniqueIds = [...new Set(ids.filter(isSalesforceId))];
  const names = {};
  if (!uniqueIds.length) return names;
  for (const chunk of chunkIds(uniqueIds)) {
    const inList = chunk.map((id) => `'${id}'`).join(',');
    const rows = await queryRows(`SELECT Id, Name FROM ${objectName} WHERE Id IN (${inList}) LIMIT 200`, { limit: 200, softFail: true });
    for (const row of rows) names[row.Id] = row.Name || row.Id;
  }
  return names;
}

async function recordsLinkedToStemByLookup(objectName, stemId, sourceGroup, sourceLabel) {
  let describe;
  try {
    describe = await salesforceObjectFields({ objectName });
  } catch {
    return [];
  }
  const fields = describe.fields || [];
  const nameField = fields.some((field) => field.name === 'Name') ? 'Name' : null;
  const lookupFields = fields.filter((field) => {
    const referenceTargets = (field.referenceTo || []).map((target) => String(target).toLowerCase());
    return field.type === 'reference'
      && (
        referenceTargets.includes('stem__c')
        || field.name.toLowerCase() === 'stem__c'
        || String(field.relationshipName || '').toLowerCase() === 'stem__r'
      );
  });
  const records = [];
  const seen = new Set();
  for (const field of lookupFields) {
    const selectFields = ['Id', nameField].filter(Boolean).join(', ');
    const rows = await queryRows(`SELECT ${selectFields} FROM ${objectName} WHERE ${field.name} = '${stemId}' LIMIT 200`, { limit: 200, softFail: true });
    for (const row of rows) {
      addRelatedRecord(records, seen, {
        id: row.Id,
        sourceGroup,
        sourceLabel,
        sourceObject: objectName,
        name: row.Name || sourceLabel,
      });
    }
  }
  return records;
}

function buildContentVersionFilename(document, version) {
  const title = document?.Title || version?.Title || 'Salesforce File';
  const extension = version?.FileExtension || '';
  if (!extension || title.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) return cleanDownloadFilename(title);
  return cleanDownloadFilename(`${title}.${extension}`);
}

async function salesforceStemDocuments(body = {}, req = null, accessContext = null) {
  const actualStemId = await resolveStemId(body.stemId, accessContext);
  const record = await sfRequest(`/sobjects/stem__c/${actualStemId}`).then(cleanRecord);
  const relatedRecords = [];
  const seenRecordIds = new Set();

  addRelatedRecord(relatedRecords, seenRecordIds, {
    id: actualStemId,
    sourceGroup: 'Direct STEM',
    sourceLabel: 'STEM',
    sourceObject: 'stem__c',
    name: record.Name || record.KeyStem__c || actualStemId,
  });

  for (const [fieldName, value] of Object.entries(record || {})) {
    const sourceGroup = inferStemFieldSourceGroup(fieldName);
    if (!sourceGroup || !isSalesforceId(value)) continue;
    addRelatedRecord(relatedRecords, seenRecordIds, {
      id: value,
      sourceGroup,
      sourceLabel: fieldName.replace(/__c$/i, '').replace(/_/g, ' '),
      sourceObject: null,
      name: fieldName,
    });
  }

  const [lineItems, extraCosts, buyerBrokers] = await Promise.all([
    queryRows(`SELECT Id, Name, Supplier_Invoice__c, Supplier_Name__c, Product__r.Name FROM STEM_Line_Item__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC LIMIT 500`, { limit: 500, softFail: true }),
    queryRows(`SELECT Id, Name, Supplier_Invoice__c, Supplier_Name__c, Description__c FROM STEM_Extra_Cost__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC LIMIT 500`, { limit: 500, softFail: true }),
    queryRows(`SELECT Id, Refcode_Index__c, Buyer_Broker__c FROM STEM_Buyer_Broker__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC LIMIT 500`, { limit: 500, softFail: true }),
  ]);

  const supplierInvoiceIds = [
    ...lineItems.map((row) => row.Supplier_Invoice__c),
    ...extraCosts.map((row) => row.Supplier_Invoice__c),
  ].filter(isSalesforceId);
  const supplierInvoiceNames = await namesByIds('Supplier_Invoice__c', supplierInvoiceIds);

  for (const item of lineItems) {
    addRelatedRecord(relatedRecords, seenRecordIds, {
      id: item.Id,
      sourceGroup: 'Product Line Attachments',
      sourceLabel: item['Product__r']?.Name || item.Name || 'Product Line',
      sourceObject: 'STEM_Line_Item__c',
      name: item.Name || item['Product__r']?.Name,
    });
    if (item.Supplier_Invoice__c) {
      addRelatedRecord(relatedRecords, seenRecordIds, {
        id: item.Supplier_Invoice__c,
        sourceGroup: 'Invoices from Suppliers',
        sourceLabel: item.Supplier_Name__c || 'Supplier Invoice',
        sourceObject: 'Supplier_Invoice__c',
        name: supplierInvoiceNames[item.Supplier_Invoice__c] || item.Supplier_Name__c || 'Supplier Invoice',
      });
    }
  }

  for (const cost of extraCosts) {
    addRelatedRecord(relatedRecords, seenRecordIds, {
      id: cost.Id,
      sourceGroup: 'Extra Cost',
      sourceLabel: cost.Name || cost.Description__c || 'Extra Cost',
      sourceObject: 'STEM_Extra_Cost__c',
      name: cost.Name || cost.Description__c,
    });
    if (cost.Supplier_Invoice__c) {
      addRelatedRecord(relatedRecords, seenRecordIds, {
        id: cost.Supplier_Invoice__c,
        sourceGroup: 'Invoices from Suppliers',
        sourceLabel: cost.Supplier_Name__c || 'Supplier Invoice',
        sourceObject: 'Supplier_Invoice__c',
        name: supplierInvoiceNames[cost.Supplier_Invoice__c] || cost.Supplier_Name__c || 'Supplier Invoice',
      });
    }
  }

  for (const broker of buyerBrokers) {
    addRelatedRecord(relatedRecords, seenRecordIds, {
      id: broker.Id,
      sourceGroup: 'Broker',
      sourceLabel: broker.Refcode_Index__c || 'Buyer Broker',
      sourceObject: 'STEM_Buyer_Broker__c',
      name: broker.Refcode_Index__c || 'Buyer Broker',
    });
  }

  const lookupRelatedGroups = await Promise.all([
    recordsLinkedToStemByLookup('Supplier_Invoice__c', actualStemId, 'Invoices from Suppliers', 'Supplier Invoice'),
    recordsLinkedToStemByLookup('Invoice__c', actualStemId, 'Invoices to Buyer', 'Buyer / Factoring Invoice'),
    recordsLinkedToStemByLookup('Nomination__c', actualStemId, 'Contracts and Compliance', 'Nomination'),
    recordsLinkedToStemByLookup('EmailMessage', actualStemId, 'Email', 'Email'),
  ]);
  for (const related of lookupRelatedGroups.flat()) {
    addRelatedRecord(relatedRecords, seenRecordIds, related);
  }

  const recordMap = Object.fromEntries(relatedRecords.map((related) => [related.id, related]));
  const relatedIds = relatedRecords.map((related) => related.id);
  let contentLinks = [];
  let attachments = [];
  for (const chunk of chunkIds(relatedIds, 150)) {
    const inList = chunk.map((id) => `'${id}'`).join(',');
    const [linksChunk, attachmentsChunk] = await Promise.all([
      queryRows(`SELECT ContentDocumentId, LinkedEntityId, ShareType, Visibility FROM ContentDocumentLink WHERE LinkedEntityId IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true }),
      queryRows(`SELECT Id, ParentId, Name, ContentType, BodyLength, CreatedDate, LastModifiedDate, Owner.Name FROM Attachment WHERE ParentId IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true }),
    ]);
    contentLinks = contentLinks.concat(linksChunk);
    attachments = attachments.concat(attachmentsChunk);
  }

  const contentDocumentIds = [...new Set(contentLinks.map((link) => link.ContentDocumentId).filter(isSalesforceId))];
  let contentDocuments = [];
  for (const chunk of chunkIds(contentDocumentIds, 150)) {
    const inList = chunk.map((id) => `'${id}'`).join(',');
    const rows = await queryRows(`SELECT Id, Title, FileType, ContentSize, CreatedDate, LastModifiedDate, LatestPublishedVersionId, Owner.Name FROM ContentDocument WHERE Id IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true });
    contentDocuments = contentDocuments.concat(rows);
  }
  const documentMap = Object.fromEntries(contentDocuments.map((document) => [document.Id, document]));

  const versionIds = [...new Set(contentDocuments.map((document) => document.LatestPublishedVersionId).filter(isSalesforceId))];
  let contentVersions = [];
  for (const chunk of chunkIds(versionIds, 150)) {
    const inList = chunk.map((id) => `'${id}'`).join(',');
    const rows = await queryRows(`SELECT Id, ContentDocumentId, Title, FileExtension, FileType, ContentSize, CreatedDate FROM ContentVersion WHERE Id IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true });
    contentVersions = contentVersions.concat(rows);
  }
  const versionByDocumentId = Object.fromEntries(contentVersions.map((version) => [version.ContentDocumentId, version]));

  const documents = [];
  const seenDocuments = new Set();
  for (const link of contentLinks) {
    const document = documentMap[link.ContentDocumentId];
    if (!document?.LatestPublishedVersionId) continue;
    const related = recordMap[link.LinkedEntityId] || {};
    const version = versionByDocumentId[document.Id];
    const fileName = buildContentVersionFilename(document, version);
    const key = `content-${document.Id}-${link.LinkedEntityId}`;
    if (seenDocuments.has(key)) continue;
    seenDocuments.add(key);
    documents.push({
      key,
      id: document.Id,
      contentDocumentId: document.Id,
      versionId: document.LatestPublishedVersionId,
      title: document.Title || version?.Title || fileName,
      fileName,
      fileType: version?.FileType || document.FileType || 'File',
      fileExtension: version?.FileExtension || '',
      contentSize: version?.ContentSize || document.ContentSize || null,
      createdDate: document.CreatedDate || version?.CreatedDate || null,
      lastModifiedDate: document.LastModifiedDate || null,
      ownerName: document['Owner']?.Name || null,
      sourceGroup: related.sourceGroup || 'Other Related',
      sourceLabel: related.sourceLabel || related.name || 'Related Record',
      sourceObject: related.sourceObject || null,
      sourceRecordId: link.LinkedEntityId,
      downloadUrl: `/api/functions/salesforceDocumentDownload?kind=contentVersion&id=${encodeURIComponent(document.LatestPublishedVersionId)}&filename=${encodeURIComponent(fileName)}`,
      salesforceUrl: `${getInstanceUrl()}/${document.Id}`,
    });
  }

  for (const attachment of attachments) {
    const related = recordMap[attachment.ParentId] || {};
    const fileName = cleanDownloadFilename(attachment.Name || 'Attachment');
    documents.push({
      key: `attachment-${attachment.Id}`,
      id: attachment.Id,
      attachmentId: attachment.Id,
      title: attachment.Name || 'Attachment',
      fileName,
      fileType: attachment.ContentType || 'Attachment',
      fileExtension: fileName.includes('.') ? fileName.split('.').pop() : '',
      contentSize: attachment.BodyLength || null,
      createdDate: attachment.CreatedDate || null,
      lastModifiedDate: attachment.LastModifiedDate || null,
      ownerName: attachment['Owner']?.Name || null,
      sourceGroup: related.sourceGroup || 'Other Related',
      sourceLabel: related.sourceLabel || related.name || 'Related Record',
      sourceObject: related.sourceObject || null,
      sourceRecordId: attachment.ParentId,
      downloadUrl: `/api/functions/salesforceDocumentDownload?kind=attachment&id=${encodeURIComponent(attachment.Id)}&filename=${encodeURIComponent(fileName)}`,
      salesforceUrl: `${getInstanceUrl()}/${attachment.Id}`,
    });
  }

  documents.sort((a, b) => String(b.createdDate || '').localeCompare(String(a.createdDate || '')));
  const groups = DOCUMENT_SOURCE_GROUPS.map((group) => ({
    sourceGroup: group,
    count: documents.filter((document) => document.sourceGroup === group).length,
  })).filter((group) => group.count > 0);

  return {
    stemId: actualStemId,
    stemName: record.Name || record.KeyStem__c || actualStemId,
    documents,
    groups,
    sourceGroups: DOCUMENT_SOURCE_GROUPS,
    relatedRecordCount: relatedRecords.length,
  };
}

async function salesforceDocumentDownload(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const kind = url.searchParams.get('kind');
  const id = url.searchParams.get('id');
  const filename = cleanDownloadFilename(url.searchParams.get('filename') || 'salesforce-document');
  if (!isSalesforceId(id)) return sendJson(res, { error: 'Valid document id required' }, 400);
  const path = kind === 'attachment'
    ? `/sobjects/Attachment/${encodeURIComponent(id)}/Body`
    : `/sobjects/ContentVersion/${encodeURIComponent(id)}/VersionData`;
  const file = await sfDownload(path);
  const asciiFilename = filename.replace(/[^\x20-\x7E]/g, '_');
  res.statusCode = 200;
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', documentContentType(filename, file.contentType));
  res.setHeader('content-disposition', `inline; filename="${asciiFilename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.end(file.buffer);
}

async function salesforceDashboardFilteredFull(body, req = null, accessContext = null) {
  const {
    where,
    trendYear,
    disputeOnly,
    portCountry,
    companyKeyword,
    companyFilterMode,
    dateBasis,
    dateWindows,
  } = body;
  const currentYear = Number(trendYear) || new Date().getFullYear();
  const describe = await salesforceObjectFields({ objectName: 'stem__c' });
  const fieldNames = describe.fields.map((f) => f.name);
  if (dateBasis && dateBasis !== EXCEPTION_REVIEW_DATE_BASIS) {
    throw new Error(`Unsupported dashboard date basis: ${dateBasis}`);
  }
  const exceptionScheduleMode = dateBasis === EXCEPTION_REVIEW_DATE_BASIS;
  const missingScheduleFields = exceptionScheduleMode ? exceptionScheduleSchemaIssues(fieldNames) : [];
  if (missingScheduleFields.length) {
    throw new Error(`Exception Review Schedule schema error: missing Salesforce STEM fields ${missingScheduleFields.join(', ')}.`);
  }
  const effectiveWhere = exceptionScheduleMode
    ? buildExceptionReviewScheduleWhere(dateWindows)
    : where;
  const accountDescribe = fieldNames.includes('Account__c')
    ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({ fields: [] }))
    : { fields: [] };
  const accountFieldNames = (accountDescribe.fields || []).map((field) => field.name);
  const interofficeCondition = await interofficeStemAccessCondition(accessContext, fieldNames, accountFieldNames);

  const hasStatus = fieldNames.includes('Status__c');
  const hasType = fieldNames.includes('Type__c');
  const hasDispute = fieldNames.includes('Dispute__c');
  const hasDisputeStatus = fieldNames.includes('Dispute_Status__c');
  const hasDisputeType = fieldNames.includes('Dispute_Type__c');
  const hasDisputeParticular = fieldNames.includes('Dispute_Particular__c');
  const accountField = fieldNames.includes('Account__c') ? 'Account__c' : fieldNames.includes('AccountId') ? 'AccountId' : null;
  const buyerAmountField = fieldNames.includes('Total_Invoice_Amount__c') ? 'Total_Invoice_Amount__c' : null;
  const supplierAmountField = fieldNames.includes('Total_Invoiced_Amount_From_Suppliers__c') ? 'Total_Invoiced_Amount_From_Suppliers__c' : null;
  const totalCostsField = fieldNames.includes('Costs_Total__c') ? 'Costs_Total__c' : null;
  const buyerNameField = fieldNames.includes('Buyer_Name__c') ? 'Buyer_Name__c' : fieldNames.includes('Buyer__c') ? 'Buyer__c' : null;
  const expectedDeliveryField = fieldNames.includes('Expected_Delivery_Date__c') ? 'Expected_Delivery_Date__c' : null;
  const disputeCondition = disputeOnly
    ? hasDisputeStatus
      ? "Dispute_Status__c != 'No Dispute' AND Dispute_Status__c != null"
      : hasDispute
        ? 'Dispute__c = true'
        : ''
    : '';
  const normalizedPortCountry = String(portCountry || '').trim();
  const portCountryLike = normalizedPortCountry ? `%${escapeSoql(normalizedPortCountry)}%` : '';
  const portCountryCondition = normalizedPortCountry
    ? `(Port__r.Country__c LIKE '${portCountryLike}' OR Port__r.Name LIKE '${portCountryLike}')`
    : '';
  const normalizedCompanyKeyword = String(companyKeyword || '').trim();
  const companyMode = companyFilterMode === 'supplier' ? 'supplier' : 'buyer';
  const companyLike = normalizedCompanyKeyword ? `%${escapeSoql(normalizedCompanyKeyword)}%` : '';
  const supplierCompanyFilterActive = Boolean(normalizedCompanyKeyword && companyMode === 'supplier');
  const companyMatches = (name) => !normalizedCompanyKeyword
    || String(name || '').toLowerCase().includes(normalizedCompanyKeyword.toLowerCase());
  const companyCondition = normalizedCompanyKeyword
    ? companyMode === 'supplier'
      ? `Id IN (SELECT STEM__c FROM STEM_Line_Item__c WHERE Supplier_Name__c LIKE '${companyLike}' AND Cancelled__c = false)`
      : buyerNameField
        ? [
            `${buyerNameField} LIKE '${companyLike}'`,
            accountField ? `Account__r.Group_Name__c LIKE '${companyLike}'` : '',
            accountField ? `Account__r.Parent.Name LIKE '${companyLike}'` : '',
          ].filter(Boolean).join(' OR ')
        : ''
    : '';
  const baseWhereConditions = [effectiveWhere, companyCondition, interofficeCondition].filter(Boolean);
  const baseWhere = combineWhereConditions(baseWhereConditions);
  const combinedWhere = combineWhereConditions([...baseWhereConditions, disputeCondition]);
  const whereClause = combinedWhere ? `WHERE ${combinedWhere}` : '';
  const monthlyDateCondition = `(Delivery_Date__c >= ${currentYear}-01-01 AND Delivery_Date__c <= ${currentYear}-12-31)${expectedDeliveryField ? ` OR (Delivery_Date__c = null AND ${expectedDeliveryField} >= ${currentYear}-01-01 AND ${expectedDeliveryField} <= ${currentYear}-12-31)` : ''}`;
  const monthlyWhere = combineWhereConditions([monthlyDateCondition, disputeCondition, portCountryCondition, companyCondition, interofficeCondition]);
  const monthlyWhereClause = monthlyWhere ? `WHERE ${monthlyWhere}` : '';

  const plFields = ['Id', 'Name', 'CreatedDate'];
  if (fieldNames.includes('Delivery_Date__c')) plFields.push('Delivery_Date__c');
  if (expectedDeliveryField) plFields.push(expectedDeliveryField);
  if (fieldNames.includes('ETA_Start_Date__c')) plFields.push('ETA_Start_Date__c');
  if (buyerNameField) plFields.push(buyerNameField);
  if (accountField) {
    if (accountFieldNames.includes('Group_Name__c')) plFields.push('Account__r.Group_Name__c');
    if (accountFieldNames.includes('ParentId')) plFields.push('Account__r.Parent.Name');
  }
  if (hasDisputeStatus) plFields.push('Dispute_Status__c');
  if (hasDispute) plFields.push('Dispute__c');
  if (hasDisputeType) plFields.push('Dispute_Type__c');
  if (hasDisputeParticular) plFields.push('Dispute_Particular__c');
  if (buyerAmountField) plFields.push(buyerAmountField);
  if (supplierAmountField) plFields.push(supplierAmountField);
  if (totalCostsField) plFields.push(totalCostsField);
  if (fieldNames.includes('QLIK_STEM_Line_Item_Total_Cost__c')) plFields.push('QLIK_STEM_Line_Item_Total_Cost__c');
  if (fieldNames.includes('QLIK_Costs_Total_Cost__c')) plFields.push('QLIK_Costs_Total_Cost__c');
  if (fieldNames.includes('KeyStem__c')) plFields.push('KeyStem__c');
  if (fieldNames.includes('Port__c')) plFields.push('Port__c', 'Port__r.Name', 'Port__r.Country__c');
  if (exceptionScheduleMode) {
    for (const field of EXCEPTION_SCHEDULE_FIELDS) {
      if (!plFields.includes(field)) plFields.push(field);
    }
  }

  const queries = [
    queryResult(`SELECT COUNT(Id) total FROM stem__c ${whereClause}`, { softFail: true }),
    hasStatus ? queryResult(`SELECT Status__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Status__c`, { softFail: true }) : Promise.resolve({ records: [] }),
    hasType ? queryResult(`SELECT Type__c val, COUNT(Id) total FROM stem__c ${whereClause} GROUP BY Type__c`, { softFail: true }) : Promise.resolve({ records: [] }),
    queryResult(`SELECT ${plFields.join(', ')} FROM stem__c ${whereClause} ORDER BY Delivery_Date__c DESC NULLS LAST, CreatedDate DESC LIMIT 3000`, { limit: 3000, softFail: true }),
    hasDisputeStatus
      ? queryResult(`SELECT COUNT(Id) total FROM stem__c WHERE Dispute_Status__c != 'No Dispute' AND Dispute_Status__c != null${baseWhere ? ` AND (${baseWhere})` : ''}`, { softFail: true })
      : hasDispute
        ? queryResult(`SELECT COUNT(Id) total FROM stem__c WHERE Dispute__c = true${baseWhere ? ` AND (${baseWhere})` : ''}`, { softFail: true })
        : Promise.resolve({ records: [] }),
    accountField ? queryResult(`SELECT ${accountField} acct, COUNT(Id) cnt FROM stem__c ${whereClause} GROUP BY ${accountField}`, { softFail: true }) : Promise.resolve({ records: [] }),
    buyerAmountField ? queryResult(`SELECT SUM(${buyerAmountField}) total FROM stem__c ${whereClause}`, { softFail: true }) : Promise.resolve({ records: [] }),
    supplierAmountField ? queryResult(`SELECT SUM(${supplierAmountField}) total FROM stem__c ${whereClause}`, { softFail: true }) : Promise.resolve({ records: [] }),
    totalCostsField ? queryResult(`SELECT SUM(${totalCostsField}) total FROM stem__c ${whereClause}`, { softFail: true }) : Promise.resolve({ records: [] }),
    queryResult(`SELECT Id, Delivery_Date__c, ${buyerAmountField || 'Total_Invoice_Amount__c'}, ${supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c'}, ${totalCostsField || 'Costs_Total__c'}, QLIK_STEM_Line_Item_Total_Cost__c, QLIK_Costs_Total_Cost__c FROM stem__c ${whereClause} LIMIT 3000`, { limit: 3000, softFail: true }),
    queryResult(`SELECT Id, Delivery_Date__c${expectedDeliveryField ? `, ${expectedDeliveryField}` : ''}, ${buyerNameField ? `${buyerNameField}, ` : ''}${buyerAmountField || 'Total_Invoice_Amount__c'}, ${supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c'}, QLIK_STEM_Line_Item_Total_Cost__c, QLIK_Costs_Total_Cost__c FROM stem__c ${monthlyWhereClause} LIMIT 3000`, { limit: 3000, softFail: true }),
  ];

  const results = await Promise.allSettled(queries);
  const getValue = (result) => result.status === 'fulfilled' ? result.value : { records: [], totalSize: 0 };
  const totalRes = getValue(results[0]);
  const statusRes = getValue(results[1]);
  const typeRes = getValue(results[2]);
  const recentRes = getValue(results[3]);
  const disputedRes = getValue(results[4]);
  const accountsRes = getValue(results[5]);
  const allStemsRes = getValue(results[9]);
  const monthlyStemsRes = getValue(results[10]);

  const allStemIds = [...new Set([
    ...(allStemsRes.records || []).map((s) => s.Id),
    ...(monthlyStemsRes.records || []).map((s) => s.Id),
  ])];
  const stemById = {};
  for (const stem of [...(allStemsRes.records || []), ...(monthlyStemsRes.records || [])]) stemById[stem.Id] = stem;
  const monthlyMonthByStem = {};
  for (const stem of monthlyStemsRes.records || []) {
    const effectiveDate = stem.Delivery_Date__c || stem.Expected_Delivery_Date__c;
    const month = Number(String(effectiveDate || '').split('-')[1]);
    if (stem.Id && month >= 1 && month <= 12) monthlyMonthByStem[stem.Id] = month;
  }

  let lineItems = [];
  let buyerBrokers = [];
  let extraCosts = [];
  if (allStemIds.length > 0) {
    const [lineItemChunks, buyerBrokerChunks, extraCostChunks] = await Promise.all([
      Promise.all(chunkIds(allStemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${id}'`).join(',');
        return queryRows(`SELECT STEM__c, Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Cancelled__c, Supplier_Name__c, Buyers_Brokers_Commission_Per_Unit__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c, Product__r.Name, Product__r.Family, Price_Per_Unit__c, Cost_Per_Unit__c, Unit_Sell_At__c, Unit_Buy_At__c, Unit_Cost__c, Subtotal_Sell_At__c, Subtotal_Buy_At__c, Commission_Cost__c, Suppliers_Brokers_Commission_Per_Unit__c, Supplier_Broker__r.Name, Buyers_Broker__r.Name, Offer_Line_Item__r.UnitPrice, Offer_Line_Item__r.Supplier_Unit_Price__c FROM STEM_Line_Item__c WHERE STEM__c IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true });
      })),
      Promise.all(chunkIds(allStemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${id}'`).join(',');
        return queryRows(`SELECT STEM__c, Commission_Lumpsum__c FROM STEM_Buyer_Broker__c WHERE STEM__c IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true });
      })),
      Promise.all(chunkIds(allStemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${id}'`).join(',');
        return queryRows(`SELECT STEM__c, Supplier_Name__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_in_MT__c, Quantity_Range_Max__c, Is_Quantity_Range__c, Unit_Price__c, Unit_Cost__c, Line_Total__c, Line_Total_Buy__c, Supplier_Invoice__c, Cancelled__c FROM STEM_Extra_Cost__c WHERE STEM__c IN (${inList}) LIMIT 2000`, { limit: 2000, softFail: true });
      })),
    ]);
    lineItems = lineItemChunks.flat();
    buyerBrokers = buyerBrokerChunks.flat();
    extraCosts = extraCostChunks.flat();
  }

  const lineItemSellByStem = {};
  const extraCostSellByStem = {};
  const extraCostBuyByStem = {};
  const invoicedExtraCostBuyByStem = {};
  const sellOnlyExtraSellByStem = {};
  for (const ec of extraCosts) {
    if (!ec.STEM__c || ec.Cancelled__c) continue;
    const stemHasDelivery = !!stemById[ec.STEM__c]?.Delivery_Date__c;
    const buy = extraBuyAmount(ec, stemHasDelivery);
    const sell = extraSellAmount(ec, stemHasDelivery);
    extraCostSellByStem[ec.STEM__c] = (extraCostSellByStem[ec.STEM__c] || 0) + sell;
    if (ec.Supplier_Invoice__c) invoicedExtraCostBuyByStem[ec.STEM__c] = (invoicedExtraCostBuyByStem[ec.STEM__c] || 0) + buy;
    if (!ec.Supplier_Invoice__c) extraCostBuyByStem[ec.STEM__c] = (extraCostBuyByStem[ec.STEM__c] || 0) + buy;
    if (!ec.Supplier_Invoice__c && buy === 0 && sell > 0) sellOnlyExtraSellByStem[ec.STEM__c] = (sellOnlyExtraSellByStem[ec.STEM__c] || 0) + sell;
  }

  const supplierLineBuyByStem = {};
  const uninvoicedSupplierLineBuyByStem = {};
  const hasSupplierInvoiceByStem = {};
  const brokerByStem = {};
  const filteredStemIds = new Set((allStemsRes.records || []).map((stem) => stem.Id));
  const productFamilyQuantityByName = {};
  const monthlyProductVolumeByFamily = {
    HSFO: Array(12).fill(0),
    VLSFO: Array(12).fill(0),
    LSMGO: Array(12).fill(0),
  };
  const supplierNamesByStem = {};
  const supplierNamesInFilteredStems = new Set();
  const supplierWeightByStem = {};
  const supplierInvoiceAmountByStem = {};
  const unassignedExtraCostBuyByStem = {};
  const productQuantitiesByStem = {};
  const stemsWithUncancelledLineProductItems = new Set();
  const addSupplierInvoiceAmount = (stemId, supplierName, amount) => {
    if (!stemId) return;
    const numericAmount = Number(amount || 0);
    if (!Number.isFinite(numericAmount) || numericAmount === 0) return;
    const name = String(supplierName || '').trim() || 'Unspecified Supplier';
    if (!supplierInvoiceAmountByStem[stemId]) supplierInvoiceAmountByStem[stemId] = {};
    supplierInvoiceAmountByStem[stemId][name] = (supplierInvoiceAmountByStem[stemId][name] || 0) + numericAmount;
  };
  for (const li of lineItems) {
    const id = li.STEM__c;
    if (!id || li.Cancelled__c) continue;
    stemsWithUncancelledLineProductItems.add(id);
    const stemHasDelivery = !!stemById[id]?.Delivery_Date__c;
    const lineSell = lineSellAmount(li, stemHasDelivery);
    const lineBuy = lineBuyAmount(li, stemHasDelivery);
    const productName = li['Product__r']?.Name || li.Name || 'Unspecified';
    const supplierName = String(li.Supplier_Name__c || '').trim();
    addSupplierInvoiceAmount(id, supplierName, lineBuy);
    const supplierMatchesCompanyFilter = !supplierCompanyFilterActive || companyMatches(supplierName);
    if (supplierMatchesCompanyFilter) {
      if (!productQuantitiesByStem[id]) productQuantitiesByStem[id] = [];
      productQuantitiesByStem[id].push({
        productName,
        quantityLabel: lineItemQuantityLabel(li, stemHasDelivery),
        unitOfMeasure: 'MT',
      });
    }
    if (supplierName) {
      if (!supplierNamesByStem[id]) supplierNamesByStem[id] = new Set();
      supplierNamesByStem[id].add(supplierName);
      if (supplierMatchesCompanyFilter) {
        if (filteredStemIds.has(id)) supplierNamesInFilteredStems.add(supplierName);
        if (!supplierWeightByStem[id]) supplierWeightByStem[id] = {};
        const supplierWeight = Math.abs(lineSell) || Math.abs(lineBuy) || financialQuantity(li, stemHasDelivery) || 1;
        supplierWeightByStem[id][supplierName] = (supplierWeightByStem[id][supplierName] || 0) + supplierWeight;
      }
    }
    if (filteredStemIds.has(id) && supplierMatchesCompanyFilter) {
      const family = dashboardProductFamily(li);
      productFamilyQuantityByName[family] = (productFamilyQuantityByName[family] || 0) + financialQuantity(li, stemHasDelivery);
    }
    const monthlyFamily = dashboardProductFamily(li);
    const monthlyMonth = monthlyMonthByStem[id];
    if (monthlyMonth && monthlyProductVolumeByFamily[monthlyFamily] && supplierMatchesCompanyFilter) {
      monthlyProductVolumeByFamily[monthlyFamily][monthlyMonth - 1] += financialQuantity(li, stemHasDelivery);
    }
    lineItemSellByStem[id] = (lineItemSellByStem[id] || 0) + lineSell;
    supplierLineBuyByStem[id] = (supplierLineBuyByStem[id] || 0) + lineBuy;
    if (!li.Supplier_Invoice__c) {
      uninvoicedSupplierLineBuyByStem[id] = (uninvoicedSupplierLineBuyByStem[id] || 0) + lineBuy;
    }
    if (li.Supplier_Invoice__c) hasSupplierInvoiceByStem[id] = true;

    if (!brokerByStem[id]) brokerByStem[id] = { buyerComm: 0, suppCommPerUnit: 0, suppBrokerName: null, buyerBrokerName: null };
    brokerByStem[id].buyerComm += buyerBrokerCommission(li, stemHasDelivery);
    brokerByStem[id].suppCommPerUnit += supplierBrokerCommission(li, stemHasDelivery);
    if (!brokerByStem[id].suppBrokerName && li['Supplier_Broker__r']?.Name) brokerByStem[id].suppBrokerName = li['Supplier_Broker__r'].Name;
    if (!brokerByStem[id].buyerBrokerName && li['Buyers_Broker__r']?.Name) brokerByStem[id].buyerBrokerName = li['Buyers_Broker__r'].Name;
  }
  for (const ec of extraCosts) {
    if (!ec.STEM__c || ec.Cancelled__c) continue;
    const stemHasDelivery = !!stemById[ec.STEM__c]?.Delivery_Date__c;
    const buy = extraBuyAmount(ec, stemHasDelivery);
    const supplierName = String(ec.Supplier_Name__c || '').trim();
    if (supplierName) {
      addSupplierInvoiceAmount(ec.STEM__c, supplierName, buy);
      if (!supplierNamesByStem[ec.STEM__c]) supplierNamesByStem[ec.STEM__c] = new Set();
      supplierNamesByStem[ec.STEM__c].add(supplierName);
      if (filteredStemIds.has(ec.STEM__c) && (!supplierCompanyFilterActive || companyMatches(supplierName))) {
        supplierNamesInFilteredStems.add(supplierName);
      }
    } else {
      unassignedExtraCostBuyByStem[ec.STEM__c] = (unassignedExtraCostBuyByStem[ec.STEM__c] || 0) + buy;
    }
  }
  for (const bb of buyerBrokers) {
    if (!bb.STEM__c) continue;
    if (!brokerByStem[bb.STEM__c]) brokerByStem[bb.STEM__c] = { buyerComm: 0, suppCommPerUnit: 0, suppBrokerName: null, buyerBrokerName: null };
    brokerByStem[bb.STEM__c].buyerComm += bb.Commission_Lumpsum__c ?? 0;
  }

  const bf = buyerAmountField || 'Total_Invoice_Amount__c';
  const sf2 = supplierAmountField || 'Total_Invoiced_Amount_From_Suppliers__c';
  const cf = totalCostsField || 'Costs_Total__c';

  const calculateStem = (stem) => {
    const calculatedBuyer = (lineItemSellByStem[stem.Id] || 0) + (extraCostSellByStem[stem.Id] || 0);
    const buyer = !stem.Delivery_Date__c && calculatedBuyer > 0 ? calculatedBuyer : stem[bf];
    const invoicedSupplier = stem[sf2] ?? 0;
    const supplierLineBuy = supplierLineBuyByStem[stem.Id] || 0;
    const uninvoicedSupplierLineBuy = uninvoicedSupplierLineBuyByStem[stem.Id] || 0;
    const supplierBase = invoicedSupplier + (hasSupplierInvoiceByStem[stem.Id] ? uninvoicedSupplierLineBuy : supplierLineBuy);
    const extraCostBuy = extraCostBuyByStem[stem.Id] || 0;
    const rawSupplier = supplierBase + extraCostBuy;
    const unmatchedSellOnlyExtra = hasSupplierInvoiceByStem[stem.Id]
      ? Math.max(0, (sellOnlyExtraSellByStem[stem.Id] || 0) - (invoicedExtraCostBuyByStem[stem.Id] || 0))
      : 0;
    const qlikSupplierCost = stem.QLIK_STEM_Line_Item_Total_Cost__c != null || stem.QLIK_Costs_Total_Cost__c != null
      ? (stem.QLIK_STEM_Line_Item_Total_Cost__c || 0) + (stem.QLIK_Costs_Total_Cost__c || 0)
      : null;
    const supplierOverstatement = qlikSupplierCost == null ? 0 : rawSupplier - qlikSupplierCost;
    const supplier = unmatchedSellOnlyExtra > 0 && supplierOverstatement > 0 && supplierOverstatement <= unmatchedSellOnlyExtra + 0.05
      ? qlikSupplierCost
      : rawSupplier;
    const buyerComm = brokerByStem[stem.Id]?.buyerComm || 0;
    const suppCommPerUnit = brokerByStem[stem.Id]?.suppCommPerUnit || 0;
    const brokerCommissions = buyerComm + suppCommPerUnit;
    return { buyer, supplier, extraCostBuy, buyerComm, suppCommPerUnit, brokerCommissions, netPnl: buyer != null ? buyer - supplier - brokerCommissions : null };
  };

  const allocateStemPnlToSuppliers = (stem, netPnl) => {
    if (netPnl == null) return [];
    const weights = supplierWeightByStem[stem.Id] || {};
    const entries = Object.entries(weights).filter(([name]) => name);
    if (!entries.length) return [];
    const totalWeight = entries.reduce((sum, [, weight]) => sum + Math.max(Number(weight) || 0, 0), 0);
    if (totalWeight <= 0) {
      const equalShare = netPnl / entries.length;
      return entries.map(([name]) => ({ name, netPnl: equalShare }));
    }
    return entries.map(([name, weight]) => ({
      name,
      netPnl: netPnl * (Math.max(Number(weight) || 0, 0) / totalWeight),
    }));
  };

  const recentStems = (recentRes.records || []).map((stem) => {
    const calc = calculateStem(stem);
    const supplierNames = [...(supplierNamesByStem[stem.Id] || [])].sort();
    const productQuantities = productQuantitiesByStem[stem.Id] || [];
    const buyerAccount = stem['Account__r'] || {};
    const buyerGroup = buyerAccount.Group_Name__c || buyerAccount.Parent?.Name || null;
    const port = stem['Port__r'] || {};
    const supplierAmountMap = { ...(supplierInvoiceAmountByStem[stem.Id] || {}) };
    if (unassignedExtraCostBuyByStem[stem.Id]) {
      supplierAmountMap['Unassigned Extra Costs'] = (supplierAmountMap['Unassigned Extra Costs'] || 0) + unassignedExtraCostBuyByStem[stem.Id];
    }
    let supplierInvoiceAmountList = Object.entries(supplierAmountMap)
      .map(([supplierName, amount]) => ({ supplierName, amount: Number(amount || 0) }))
      .filter((item) => item.amount !== 0)
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName));
    const supplierListTotal = supplierInvoiceAmountList.reduce((sum, item) => sum + item.amount, 0);
    const supplierDiff = Number(calc.supplier || 0) - supplierListTotal;
    if (Math.abs(supplierDiff) > 0.05) {
      if (!supplierInvoiceAmountList.length) {
        supplierInvoiceAmountList = [{ supplierName: 'Supplier Invoice Amount', amount: Number(calc.supplier || 0) }];
      } else {
        const denominator = supplierInvoiceAmountList.reduce((sum, item) => sum + Math.abs(item.amount), 0) || supplierInvoiceAmountList.length;
        supplierInvoiceAmountList = supplierInvoiceAmountList.map((item) => {
          const ratio = denominator === supplierInvoiceAmountList.length
            ? 1 / supplierInvoiceAmountList.length
            : Math.abs(item.amount) / denominator;
          return { ...item, amount: item.amount + supplierDiff * ratio };
        });
      }
    }
    return {
      ...stem,
      [bf]: calc.buyer ?? null,
      [sf2]: calc.supplier || null,
      _Buyer_Group: buyerGroup,
      _Port_Name: port.Name || null,
      _Port_Country: port.Country__c || null,
      _Exception_Schedule: exceptionScheduleMode ? normalizeExceptionSchedule(stem) : null,
      _Supplier_Name_List: supplierNames,
      _Supplier_Names: supplierNames.join(', ') || null,
      _Supplier_Invoice_Amount_List: supplierInvoiceAmountList,
      _Has_Uncancelled_Line_Product_Item: stemsWithUncancelledLineProductItems.has(stem.Id),
      _Product_Quantity_List: productQuantities,
      _Product_Quantities: productQuantities.map((item) => `${item.productName} ${item.quantityLabel}`).join(', ') || null,
      _buyerBrokerName: brokerByStem[stem.Id]?.buyerBrokerName || null,
      _buyerBrokerComm: calc.buyerComm || null,
      _suppBrokerName: brokerByStem[stem.Id]?.suppBrokerName || null,
      _suppBrokerComm: calc.suppCommPerUnit || null,
      __buyerCommCalc: calc.buyerComm,
      __suppCommPerUnitCalc: calc.suppCommPerUnit,
      __extraCostBuyCalc: calc.extraCostBuy,
      __netPnlCalc: calc.netPnl,
    };
  });

  let totalProfit = 0;
  let totalInvoicedProfit = 0;
  let totalBuyer = 0;
  let totalSupplier = 0;
  let totalCosts = 0;
  let totalBrokerCommissions = 0;
  for (const stem of allStemsRes.records || []) {
    const calc = calculateStem(stem);
    if (calc.buyer == null) continue;
    totalProfit += calc.netPnl || 0;
    if (stem.Delivery_Date__c) totalInvoicedProfit += calc.netPnl || 0;
    totalBuyer += calc.buyer;
    totalSupplier += calc.supplier;
    totalBrokerCommissions += calc.brokerCommissions;
    totalCosts += stem[cf] ?? 0;
  }

  const buyerPnlMap = {};
  for (const stem of recentStems) {
    const buyerName = stem[buyerNameField] || null;
    if (buyerName && buyerName.toUpperCase().includes('COSULICH')) continue;
    if (!buyerName || stem[bf] == null || stem.__netPnlCalc == null) continue;
    buyerPnlMap[buyerName] = (buyerPnlMap[buyerName] || 0) + stem.__netPnlCalc;
  }
  const topBuyersByNetPnl = Object.entries(buyerPnlMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, pnl]) => ({ name, netPnl: pnl }));
  const supplierPnlMap = {};
  for (const stem of allStemsRes.records || []) {
    const calc = calculateStem(stem);
    if (calc.buyer == null || calc.netPnl == null) continue;
    for (const allocation of allocateStemPnlToSuppliers(stem, calc.netPnl)) {
      supplierPnlMap[allocation.name] = (supplierPnlMap[allocation.name] || 0) + allocation.netPnl;
    }
  }
  const topSuppliersByNetPnl = Object.entries(supplierPnlMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, pnl]) => ({ name, netPnl: pnl }));

  const monthlyTotals = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, netPnl: 0, turnover: 0 }));
  const buyerMonthTotals = {};
  const supplierMonthTotals = {};
  for (const stem of monthlyStemsRes.records || []) {
    const effectiveDate = stem.Delivery_Date__c || stem.Expected_Delivery_Date__c;
    if (!effectiveDate) continue;
    const calc = calculateStem(stem);
    if (calc.buyer == null) continue;
    const month = Number(String(effectiveDate).split('-')[1]);
    if (!month || month < 1 || month > 12) continue;
    monthlyTotals[month - 1].turnover += Number(calc.buyer || 0);
    monthlyTotals[month - 1].netPnl += calc.netPnl || 0;
    if (buyerNameField && stem[buyerNameField] && !String(stem[buyerNameField]).toUpperCase().includes('COSULICH')) {
      const buyerName = stem[buyerNameField];
      if (!buyerMonthTotals[buyerName]) buyerMonthTotals[buyerName] = Array(12).fill(0);
      buyerMonthTotals[buyerName][month - 1] += calc.netPnl || 0;
    }
    for (const allocation of allocateStemPnlToSuppliers(stem, calc.netPnl)) {
      if (!supplierMonthTotals[allocation.name]) supplierMonthTotals[allocation.name] = Array(12).fill(0);
      supplierMonthTotals[allocation.name][month - 1] += allocation.netPnl || 0;
    }
  }
  const monthlyNetPnl = monthlyTotals.map((item) => ({
    month: item.month,
    label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][item.month - 1],
    netPnl: item.netPnl,
    turnover: item.turnover,
    grossMarginPct: grossMarginPercent(item.netPnl, item.turnover),
  }));
  const monthlyBuyerNames = Object.entries(buyerMonthTotals)
    .map(([name, months]) => ({ name, total: months.reduce((sum, value) => sum + value, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((item) => item.name);
  const monthlyBuyerNetPnl = monthlyNetPnl.map((item, idx) => {
    const row = { month: item.month, label: item.label };
    for (const buyerName of monthlyBuyerNames) row[buyerName] = buyerMonthTotals[buyerName]?.[idx] || 0;
    return row;
  });
  const monthlySupplierNames = Object.entries(supplierMonthTotals)
    .map(([name, months]) => ({ name, total: months.reduce((sum, value) => sum + value, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((item) => item.name);
  const monthlySupplierNetPnl = monthlyNetPnl.map((item, idx) => {
    const row = { month: item.month, label: item.label };
    for (const supplierName of monthlySupplierNames) row[supplierName] = supplierMonthTotals[supplierName]?.[idx] || 0;
    return row;
  });
  const productFamilyQuantities = Object.entries(productFamilyQuantityByName)
    .map(([family, quantity]) => ({ family, quantity, unitOfMeasure: 'MT' }))
    .sort((a, b) => b.quantity - a.quantity);
  const monthlyProductVolumes = monthlyNetPnl.map((item, idx) => ({
    month: item.month,
    label: item.label,
    HSFO: monthlyProductVolumeByFamily.HSFO[idx] || 0,
    VLSFO: monthlyProductVolumeByFamily.VLSFO[idx] || 0,
    LSMGO: monthlyProductVolumeByFamily.LSMGO[idx] || 0,
    grossMarginPct: item.grossMarginPct,
  }));

  return {
    stemTotal: totalRes.records?.[0]?.total ?? 0,
    accountCount: accountsRes.records ? accountsRes.records.filter((r) => r.acct != null).length : null,
    buyerAccountCount: accountsRes.records ? accountsRes.records.filter((r) => r.acct != null).length : null,
    supplierAccountCount: supplierNamesInFilteredStems.size,
    totalBuyer,
    totalSupplier,
    totalBrokerCommissions,
    totalProfit,
    totalInvoicedProfit,
    disputedCount: disputedRes.records?.[0]?.total ?? 0,
    stemByStatus: (statusRes.records || []).map((r) => ({ label: r.val || 'Unknown', value: r.total })),
    stemByType: (typeRes.records || []).map((r) => ({ label: r.val || 'Unknown', value: r.total })),
    recentStems,
    totalCosts,
    buyerAmountField,
    supplierAmountField,
    totalCostsField,
    accountField,
    topBuyersByNetPnl,
    topSuppliersByNetPnl,
    monthlyNetPnl,
    monthlyBuyerNetPnl,
    monthlyBuyerNames,
    monthlySupplierNetPnl,
    monthlySupplierNames,
    monthlyNetPnlYear: currentYear,
    productFamilyQuantities,
    monthlyProductVolumes,
    dateBasis: exceptionScheduleMode ? EXCEPTION_REVIEW_DATE_BASIS : null,
  };
}

async function stemPnlFull(body, req = null, accessContext = null) {
  const { where, limit = 500 } = body;
  const interofficeCondition = await interofficeStemAccessCondition(accessContext);
  const combinedWhere = combineWhereConditions([where, interofficeCondition]);
  const whereClause = combinedWhere ? `WHERE ${combinedWhere}` : '';
  const stems = await queryRows(`
    SELECT Id, KeyStem__c, Name, Delivery_Date__c, Expected_Delivery_Date__c,
           Account__r.Name,
           Total_Invoice_Amount__c,
           Total_Invoiced_Amount_From_Suppliers__c,
           QLIK_STEM_Line_Item_Total_Cost__c,
           QLIK_Costs_Total_Cost__c,
           QLIK_Total_Profit__c
    FROM stem__c
    ${whereClause}
    ORDER BY Delivery_Date__c DESC NULLS LAST, CreatedDate DESC
    LIMIT ${Number(limit) || 500}
  `, { limit: Math.max(Number(limit) || 500, 500) });

  if (!stems.length) {
    return { rows: [], totals: { count: 0, complete: 0, Buyer_Invoice: 0, Supplier_Invoice: 0, Costs: 0, Total_Broker_Comm: 0, Gross_Profit: 0, Net_Profit: 0 } };
  }

  const stemIds = stems.map((s) => s.Id);
  const idChunks = chunkIds(stemIds);
  const [lineItemArrays, buyerBrokerArrays, extraCostArrays] = await Promise.all([
    Promise.all(idChunks.map((chunk) => {
      const inList = chunk.map((id) => `'${id}'`).join(',');
      return queryRows(`
        SELECT Id, STEM__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c,
               Product__r.Name, Product__r.Family,
               Price_Per_Unit__c, Cost_Per_Unit__c, Unit_Sell_At__c, Unit_Buy_At__c, Unit_Cost__c,
               Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Cancelled__c,
               Buyers_Brokers_Commission_Per_Unit__c,
               Buyers_Brokers_Commission_Lumpsum__c,
               Commission_Cost__c,
               Suppliers_Brokers_Commission_Per_Unit__c,
               Supplier_Broker__r.Name,
               Offer_Line_Item__r.UnitPrice,
               Offer_Line_Item__r.Supplier_Unit_Price__c
        FROM STEM_Line_Item__c
        WHERE STEM__c IN (${inList})
        LIMIT 2000
      `, { limit: 2000, softFail: true });
    })),
    Promise.all(idChunks.map(() => Promise.resolve([]))),
    Promise.all(idChunks.map((chunk) => {
      const inList = chunk.map((id) => `'${id}'`).join(',');
      return queryRows(`
        SELECT STEM__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_in_MT__c,
               Quantity_Range_Max__c, Is_Quantity_Range__c,
               Unit_Price__c, Unit_Cost__c, Line_Total__c, Line_Total_Buy__c,
               Supplier_Invoice__c, Cancelled__c
        FROM STEM_Extra_Cost__c
        WHERE STEM__c IN (${inList})
        LIMIT 5000
      `, { limit: 5000, softFail: true });
    })),
  ]);

  const lineItems = lineItemArrays.flat();
  const buyerBrokerItems = buyerBrokerArrays.flat();
  const extraCosts = extraCostArrays.flat();
  const stemById = Object.fromEntries(stems.map((stem) => [stem.Id, stem]));
  const byId = {};
  const initStem = (id) => {
    if (!byId[id]) byId[id] = { suppBrokerComm: 0, buyerBrokerComm: 0, extraCostSell: 0, extraCostBuy: 0, invoicedExtraCostBuy: 0, sellOnlyExtraSell: 0, buyerLineSell: 0, supplierLineBuy: 0, uninvoicedSupplierLineBuy: 0, hasSupplierInvoice: false, suppBrokerName: null };
  };

  for (const li of lineItems) {
    const id = li.STEM__c;
    if (!id) continue;
    initStem(id);
    if (li.Cancelled__c) continue;
    const stemHasDelivery = !!stemById[id]?.Delivery_Date__c;
    const lineSell = lineSellAmount(li, stemHasDelivery);
    const lineBuy = lineBuyAmount(li, stemHasDelivery);
    byId[id].buyerLineSell += lineSell;
    byId[id].supplierLineBuy += lineBuy;
    if (!li.Supplier_Invoice__c) byId[id].uninvoicedSupplierLineBuy += lineBuy;
    if (li.Supplier_Invoice__c) byId[id].hasSupplierInvoice = true;
    byId[id].suppBrokerComm += supplierBrokerCommission(li, stemHasDelivery);
    byId[id].buyerBrokerComm += buyerBrokerCommission(li, stemHasDelivery);
    if (!byId[id].suppBrokerName && li['Supplier_Broker__r']?.Name) byId[id].suppBrokerName = li['Supplier_Broker__r'].Name;
  }
  for (const bb of buyerBrokerItems) {
    if (!bb.STEM__c) continue;
    initStem(bb.STEM__c);
    byId[bb.STEM__c].buyerBrokerComm += bb.Commission_Lumpsum__c ?? 0;
  }
  for (const ec of extraCosts) {
    if (!ec.STEM__c || ec.Cancelled__c) continue;
    initStem(ec.STEM__c);
    const stemHasDelivery = !!stemById[ec.STEM__c]?.Delivery_Date__c;
    const buy = extraBuyAmount(ec, stemHasDelivery);
    const sell = extraSellAmount(ec, stemHasDelivery);
    byId[ec.STEM__c].extraCostSell += sell;
    if (ec.Supplier_Invoice__c) byId[ec.STEM__c].invoicedExtraCostBuy += buy;
    if (!ec.Supplier_Invoice__c) byId[ec.STEM__c].extraCostBuy += buy;
    if (!ec.Supplier_Invoice__c && buy === 0 && sell > 0) byId[ec.STEM__c].sellOnlyExtraSell += sell;
  }

  const rows = stems.map((s) => {
    const agg = byId[s.Id] || {};
    const calculatedBuyer = (agg.buyerLineSell ?? 0) + (agg.extraCostSell ?? 0);
    const buyer = !s.Delivery_Date__c && calculatedBuyer > 0 ? calculatedBuyer : (s.Total_Invoice_Amount__c ?? 0);
    const supplierBase = (s.Total_Invoiced_Amount_From_Suppliers__c ?? 0) + (agg.hasSupplierInvoice ? (agg.uninvoicedSupplierLineBuy ?? 0) : (agg.supplierLineBuy ?? 0));
    const rawSupplier = supplierBase + (agg.extraCostBuy ?? 0);
    const unmatchedSellOnlyExtra = agg.hasSupplierInvoice ? Math.max(0, (agg.sellOnlyExtraSell ?? 0) - (agg.invoicedExtraCostBuy ?? 0)) : 0;
    const qlikSupplierCost = s.QLIK_STEM_Line_Item_Total_Cost__c != null || s.QLIK_Costs_Total_Cost__c != null
      ? (s.QLIK_STEM_Line_Item_Total_Cost__c || 0) + (s.QLIK_Costs_Total_Cost__c || 0)
      : null;
    const supplierOverstatement = qlikSupplierCost == null ? 0 : rawSupplier - qlikSupplierCost;
    const supplier = unmatchedSellOnlyExtra > 0 && supplierOverstatement > 0 && supplierOverstatement <= unmatchedSellOnlyExtra + 0.05
      ? qlikSupplierCost
      : rawSupplier;
    const suppBrokerComm = agg.suppBrokerComm ?? 0;
    const buyerBrokerComm = agg.buyerBrokerComm ?? 0;
    const totalBroker = suppBrokerComm + buyerBrokerComm;
    const grossProfit = buyer - supplier;
    const netProfit = grossProfit - totalBroker;
    return {
      Id: s.Id,
      Key: s.KeyStem__c,
      Name: s.Name,
      Delivery_Date: s.Delivery_Date__c,
      Expected_Delivery_Date: s.Expected_Delivery_Date__c,
      Buyer: s['Account__r']?.Name ?? null,
      Buyer_Invoice: buyer || null,
      Supplier_Invoice: supplier || null,
      Supplier_Broker_Name: agg.suppBrokerName || null,
      Supplier_Broker_Comm: suppBrokerComm !== 0 ? suppBrokerComm : null,
      Buyer_Broker_Comm: buyerBrokerComm !== 0 ? buyerBrokerComm : null,
      Total_Broker_Comm: totalBroker !== 0 ? totalBroker : null,
      Gross_Profit: buyer && supplier ? grossProfit : null,
      Net_Profit: buyer && supplier ? netProfit : null,
      Margin_Pct: buyer && supplier ? (netProfit / buyer) * 100 : null,
      Qlik_Total_Profit: s.QLIK_Total_Profit__c ?? null,
    };
  });
  const complete = rows.filter((r) => r.Buyer_Invoice && r.Supplier_Invoice);
  return {
    rows,
    totals: {
      count: rows.length,
      complete: complete.length,
      Buyer_Invoice: complete.reduce((sum, r) => sum + (r.Buyer_Invoice ?? 0), 0),
      Supplier_Invoice: complete.reduce((sum, r) => sum + (r.Supplier_Invoice ?? 0), 0),
      Total_Broker_Comm: complete.reduce((sum, r) => sum + (r.Total_Broker_Comm ?? 0), 0),
      Gross_Profit: complete.reduce((sum, r) => sum + (r.Gross_Profit ?? 0), 0),
      Net_Profit: complete.reduce((sum, r) => sum + (r.Net_Profit ?? 0), 0),
      Qlik_Net_Profit: rows.reduce((sum, r) => sum + (r.Qlik_Total_Profit ?? 0), 0),
    },
  };
}

async function salesforceBuyerInvoicesDue(body, req = null, accessContext = null) {
  const daysAhead = Math.max(0, Math.min(Number(body.daysAhead) || 7, 365));
  const receivableThreshold = Math.max(0, Number(body.receivableThreshold ?? body.receivable_threshold ?? 50) || 0);
  const rowLimit = 10000;
  const today = dateOnly(new Date());
  const dueThrough = addDays(today, daysAhead);
  const describe = await salesforceObjectFields({ objectName: 'stem__c' });
  const fieldNames = describe.fields.map((f) => f.name);
  const accountDescribe = fieldNames.includes('Account__c')
    ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({ fields: [] }))
    : { fields: [] };
  const accountFieldNames = (accountDescribe.fields || []).map((field) => field.name);
  const interofficeCondition = await interofficeStemAccessCondition(accessContext, fieldNames, accountFieldNames);
  const brokerInvoiceFormatFields = accountInvoiceFormatFields(accountDescribe.fields || []);
  const brokerEmailFields = accountBrokerEmailFields(accountDescribe.fields || []);

  const dueFields = ['Invoice_Due_Date__c', 'Buyer_Pay_Term_Date__c', 'Due_Date__c'].filter((field) => fieldNames.includes(field));
  if (!dueFields.length) return { rows: [], today, dueThrough, daysAhead };

  const fields = ['Id', 'Name'];
  for (const field of dueFields) fields.push(field);
  if (fieldNames.includes('KeyStem__c')) fields.push('KeyStem__c');
  if (fieldNames.includes('Delivery_Date__c')) fields.push('Delivery_Date__c');
  if (fieldNames.includes('Delivery_Date_Or_Expected__c')) fields.push('Delivery_Date_Or_Expected__c');
  if (fieldNames.includes('Expected_Delivery_Date__c')) fields.push('Expected_Delivery_Date__c');
  if (fieldNames.includes('Payment_Term__c')) fields.push('Payment_Term__c');
  if (fieldNames.includes('Vessel__c')) fields.push('Vessel__r.Name');
  if (fieldNames.includes('Port__c')) fields.push('Port__r.Name');
  if (fieldNames.includes('Buyer_Name__c')) fields.push('Buyer_Name__c');
  if (fieldNames.includes('Buyer__c')) fields.push('Buyer__c');
  if (fieldNames.includes('Total_Invoice_Amount__c')) fields.push('Total_Invoice_Amount__c');
  if (fieldNames.includes('Receivable_Balance__c')) fields.push('Receivable_Balance__c');
  if (fieldNames.includes('PSPRS__c')) fields.push('PSPRS__c');
  if (fieldNames.includes('Account__c')) {
    fields.push('Account__c', 'Account__r.Name');
    if (accountFieldNames.includes('Group_Name__c')) fields.push('Account__r.Group_Name__c');
    if (accountFieldNames.includes('ParentId')) fields.push('Account__r.ParentId', 'Account__r.Parent.Name');
    if (accountFieldNames.includes('Accounts_Email__c')) fields.push('Account__r.Accounts_Email__c');
  }
  if (fieldNames.includes('Payment_Date__c')) fields.push('Payment_Date__c');

  const storedDueCondition = dueFields
    .map((field) => `(${field} != null AND ${field} >= ${MIN_BUYER_INVOICE_DUE_DATE} AND ${field} <= ${dueThrough})`)
    .join(' OR ');
  const calculatedDueDateConditions = [
    fieldNames.includes('Delivery_Date__c') ? `Delivery_Date__c != null AND Delivery_Date__c <= ${dueThrough}` : '',
    fieldNames.includes('Delivery_Date_Or_Expected__c') ? `Delivery_Date_Or_Expected__c != null AND Delivery_Date_Or_Expected__c <= ${dueThrough}` : '',
    fieldNames.includes('Expected_Delivery_Date__c') ? `Expected_Delivery_Date__c != null AND Expected_Delivery_Date__c <= ${dueThrough}` : '',
  ].filter(Boolean);
  const calculatedDueCondition = fieldNames.includes('Payment_Term__c') && calculatedDueDateConditions.length
    ? `(Payment_Term__c != null AND (${calculatedDueDateConditions.map((condition) => `(${condition})`).join(' OR ')}))`
    : '';
  const dueCondition = [storedDueCondition, calculatedDueCondition].filter(Boolean).join(' OR ');
  const outstandingConditions = [];
  if (fieldNames.includes('Payment_Date__c')) outstandingConditions.push('Payment_Date__c = null');
  if (fieldNames.includes('Receivable_Balance__c')) outstandingConditions.push(`Receivable_Balance__c >= ${receivableThreshold}`);
  const whereParts = [`(${dueCondition})`, ...outstandingConditions];
  if (interofficeCondition) whereParts.push(interofficeCondition);

  const stems = await queryRows(`
    SELECT ${[...new Set(fields)].join(', ')}
    FROM stem__c
    WHERE ${whereParts.join(' AND ')}
    ORDER BY ${dueFields[0]} ASC NULLS LAST, Name ASC
    LIMIT ${rowLimit}
  `, { limit: rowLimit, softFail: true });

  const stemIds = stems.map((stem) => stem.Id);
  const traderByStem = {};
  const traderEmailByName = {};
  const prpspUploadDateByStem = {};
  const buyerBrokerDetailsByStem = {};
  if (stemIds.length) {
    const [nominationArrays, supplierInvoiceArrays, brokerLineItemArrays, buyerBrokerArrays] = await Promise.all([
      Promise.all(chunkIds(stemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        return queryRows(`
          SELECT Id, Name, STEM__c, Buyer_Supplier_Trader__c, BT_ST_Email_Address__c
          FROM Nomination__c
          WHERE STEM__c IN (${inList}) AND Buyer_Supplier_Trader__c != null
          ORDER BY CreatedDate ASC
          LIMIT 5000
        `, { limit: 5000, softFail: true });
      })),
      Promise.all(chunkIds(stemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        return queryRows(`
          SELECT Id, STEM__c, PSPRS_Upload_Date__c
          FROM Supplier_Invoice__c
          WHERE STEM__c IN (${inList}) AND PSPRS_Upload_Date__c != null
          LIMIT 5000
        `, { limit: 5000, softFail: true });
      })),
      Promise.all(chunkIds(stemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        return queryRows(`
          SELECT Id, STEM__c, Buyers_Broker__c, Buyer_Broker__c, Cancelled__c
          FROM STEM_Line_Item__c
          WHERE STEM__c IN (${inList})
          LIMIT 5000
        `, { limit: 5000, softFail: true });
      })),
      Promise.all(chunkIds(stemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        return queryRows(`
          SELECT Id, STEM__c, Buyer_Broker__c
          FROM STEM_Buyer_Broker__c
          WHERE STEM__c IN (${inList})
          LIMIT 5000
        `, { limit: 5000, softFail: true });
      })),
    ]);

    for (const nomination of nominationArrays.flat()) {
      if (!nomination.STEM__c || !nomination.Buyer_Supplier_Trader__c) continue;
      if (!traderByStem[nomination.STEM__c]) traderByStem[nomination.STEM__c] = { buyer: [], all: [], buyerEmails: [], allEmails: [], emailByName: {} };
      const name = String(nomination.Name || '');
      const value = nomination.Buyer_Supplier_Trader__c;
      const emails = uniqueEmailList(nomination.BT_ST_Email_Address__c);
      const traderKey = traderEmailLookupKey(value);
      if (!traderByStem[nomination.STEM__c].all.includes(value)) traderByStem[nomination.STEM__c].all.push(value);
      for (const email of emails) {
        if (!traderByStem[nomination.STEM__c].allEmails.some((item) => item.toLowerCase() === email.toLowerCase())) {
          traderByStem[nomination.STEM__c].allEmails.push(email);
        }
      }
      if (traderKey && emails.length) {
        traderByStem[nomination.STEM__c].emailByName[traderKey] = uniqueEmailList(
          traderByStem[nomination.STEM__c].emailByName[traderKey] || [],
          emails,
        );
        traderEmailByName[traderKey] = uniqueEmailList(traderEmailByName[traderKey] || [], emails);
      }
      if (name.startsWith('Confirmation to ') && !traderByStem[nomination.STEM__c].buyer.includes(value)) {
        traderByStem[nomination.STEM__c].buyer.push(value);
      }
      if (name.startsWith('Confirmation to ')) {
        for (const email of emails) {
          if (!traderByStem[nomination.STEM__c].buyerEmails.some((item) => item.toLowerCase() === email.toLowerCase())) {
            traderByStem[nomination.STEM__c].buyerEmails.push(email);
          }
        }
      }
    }

    for (const invoice of supplierInvoiceArrays.flat()) {
      if (!invoice.STEM__c || !invoice.PSPRS_Upload_Date__c) continue;
      prpspUploadDateByStem[invoice.STEM__c] = latestDate([
        prpspUploadDateByStem[invoice.STEM__c],
        invoice.PSPRS_Upload_Date__c,
      ]);
    }

    const brokerLinksByStem = {};
    const addBrokerLink = (stemId, brokerId) => {
      if (!stemId || !brokerId) return;
      if (!brokerLinksByStem[stemId]) brokerLinksByStem[stemId] = [];
      if (!brokerLinksByStem[stemId].some((id) => String(id).slice(0, 15) === String(brokerId).slice(0, 15))) {
        brokerLinksByStem[stemId].push(brokerId);
      }
    };
    for (const item of brokerLineItemArrays.flat()) {
      if (item.Cancelled__c) continue;
      addBrokerLink(item.STEM__c, item.Buyers_Broker__c || item.Buyer_Broker__c);
    }
    for (const broker of buyerBrokerArrays.flat()) {
      addBrokerLink(broker.STEM__c, broker.Buyer_Broker__c);
    }

    const brokerIds = [...new Set(Object.values(brokerLinksByStem).flat().filter(Boolean))];
    const brokerAccountMap = {};
    if (brokerIds.length) {
      const brokerAccountFields = ['Id', 'Name'];
      brokerAccountFields.push(...brokerInvoiceFormatFields, ...brokerEmailFields);
      if (accountFieldNames.includes('Hidden_Broker__c')) brokerAccountFields.push('Hidden_Broker__c');
      if (accountFieldNames.includes('Hidden_Broker_Company__c')) brokerAccountFields.push('Hidden_Broker_Company__c');
      const brokerAccountChunks = await Promise.all(chunkIds(brokerIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        return queryRows(`
          SELECT ${[...new Set(brokerAccountFields)].join(', ')}
          FROM Account
          WHERE Id IN (${inList})
          LIMIT 5000
        `, { limit: 5000, softFail: true });
      }));
      for (const account of brokerAccountChunks.flat()) {
        if (account.Hidden_Broker__c === true || account.Hidden_Broker_Company__c === true) continue;
        const detail = {
          id: account.Id,
          name: account.Name || account.Id,
          invoiceFormat: brokerInvoiceFormatFields.map((field) => routingFormatValue(account[field])).find(Boolean) || null,
          emails: uniqueEmailList(...brokerEmailFields.flatMap((field) => emailTokensFromValue(account[field]))),
        };
        brokerAccountMap[account.Id] = detail;
        brokerAccountMap[String(account.Id).slice(0, 15)] = detail;
      }
    }
    for (const [stemId, ids] of Object.entries(brokerLinksByStem)) {
      buyerBrokerDetailsByStem[stemId] = ids
        .map((id) => brokerAccountMap[id] || brokerAccountMap[String(id).slice(0, 15)] || null)
        .filter(Boolean);
    }
  }

  const hasBuyerTraderFilter = Object.prototype.hasOwnProperty.call(body, 'buyerTraders');
  const selectedBuyerTradersInput = Array.isArray(body.buyerTraders)
    ? body.buyerTraders
    : splitBuyerTraderNames(body.buyerTraders);

  const allRows = stems
    .map((stem) => {
      const dueDate = calculatedBuyerPayTermDate(stem)
        || stem.Invoice_Due_Date__c
        || stem.Due_Date__c
        || stem.Buyer_Pay_Term_Date__c
        || earliestDate(dueFields.map((field) => stem[field]));
      if (!dueDate || dueDate > dueThrough) return null;
      if (dueDate < MIN_BUYER_INVOICE_DUE_DATE) return null;
      if (stem.KeyStem__c && stem.KeyStem__c.startsWith('T')) return null;
      if (stem.Receivable_Balance__c != null && Number(stem.Receivable_Balance__c) < receivableThreshold) return null;
      const daysUntilDue = daysBetween(today, dueDate);
      const account = stem['Account__r'] || {};
      const traderInfo = traderByStem[stem.Id] || {};
      const buyerTraderEmails = traderInfo.buyerEmails?.length ? traderInfo.buyerEmails : traderInfo.allEmails || [];
      const paymentReminderRecipients = uniqueEmailList(account.Accounts_Email__c, buyerTraderEmails);
      const prpspUploadDate = prpspUploadDateByStem[stem.Id] || null;
      const rawPsprsStatus = stem.PSPRS__c || null;
      const brokerRouting = combineBuyerBrokerRouting(buyerBrokerDetailsByStem[stem.Id] || []);
      return {
        id: stem.Id,
        stemId: stem.Id,
        stemName: formatStemName(stem),
        keyStem: stem.KeyStem__c || null,
        buyerAccountId: stem.Account__c || null,
        buyerParentAccountId: account.ParentId || null,
        buyerGroupName: account.Group_Name__c || account.Parent?.Name || null,
        buyerName: stem.Buyer_Name__c || account.Name || stem.Buyer__c || null,
        invoiceAmount: stem.Total_Invoice_Amount__c ?? null,
        receivableBalance: stem.Receivable_Balance__c ?? null,
        buyerInvoiceDueDate: dueDate,
        deliveryDate: stem.Delivery_Date__c || null,
        buyerTraderInCharge: (traderInfo.buyer?.length ? traderInfo.buyer : traderInfo.all || []).join(', ') || null,
        buyerAccountsEmail: account.Accounts_Email__c || null,
        buyerTraderEmail: buyerTraderEmails.join(', ') || null,
        buyerTraderEmailByName: traderInfo.emailByName || {},
        paymentReminderRecipient: paymentReminderRecipients.join(', ') || null,
        paymentReminderRecipients,
        ...brokerRouting,
        prpspStatus: prpspDisplayStatus(rawPsprsStatus, prpspUploadDate),
        prpspUploadDate,
        rawPsprsStatus,
        daysUntilDue,
        status: daysUntilDue == null ? 'Due' : daysUntilDue < 0 ? 'Overdue' : daysUntilDue === 0 ? 'Due Today' : 'Due Soon',
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.buyerInvoiceDueDate !== b.buyerInvoiceDueDate) return a.buyerInvoiceDueDate.localeCompare(b.buyerInvoiceDueDate);
      return String(a.stemName || '').localeCompare(String(b.stemName || ''));
    });

  const [collectionMap, reminderRulesState] = await Promise.all([
    loadBuyerInvoiceCollectionMap(allRows.map((row) => row.stemId)),
    loadBuyerInvoiceReminderRules(),
  ]);
  const rowsWithCollection = allRows.map((row) => {
    const collection = collectionMap[row.stemId] || {};
    const paymentHandlerName = collection.item?.ownerName || splitBuyerTraderNames(row.buyerTraderInCharge)[0] || '';
    const paymentHandlerEmail = uniqueEmailList(
      row.buyerTraderEmailByName?.[traderEmailLookupKey(paymentHandlerName)] || [],
      traderEmailByName[traderEmailLookupKey(paymentHandlerName)] || [],
    );
    const paymentReminderRecipients = uniqueEmailList(
      row.paymentReminderRecipients || [],
      row.buyerAccountsEmail || '',
      row.buyerTraderEmail || '',
      paymentHandlerEmail,
    );
    return {
      ...row,
      paymentHandlerName,
      paymentHandlerEmail: paymentHandlerEmail.join(', ') || null,
      paymentReminderRecipient: paymentReminderRecipients.join(', ') || null,
      paymentReminderRecipients,
      collection: collection.item || null,
      collectionEvents: collection.events || [],
    };
  });
  const rowsWithReminderRules = applyBuyerReminderRules(
    rowsWithCollection,
    reminderRulesState.rules,
    reminderRulesState.available,
  );

  const buyerTraderOptions = [...new Set(rowsWithReminderRules.flatMap((row) => splitBuyerTraderNames(row.buyerTraderInCharge)))].sort((a, b) => a.localeCompare(b));
  const selectedBuyerTraders = selectedBuyerTradersInput
    .map((name) => String(name || '').trim())
    .filter((name) => buyerTraderOptions.includes(name));
  const activeBuyerTraders = hasBuyerTraderFilter ? selectedBuyerTraders : buyerTraderOptions;
  const activeBuyerTraderSet = new Set(activeBuyerTraders);
  const rows = hasBuyerTraderFilter && !activeBuyerTraderSet.size
    ? []
    : activeBuyerTraderSet.size && activeBuyerTraderSet.size < buyerTraderOptions.length
    ? rowsWithReminderRules.filter((row) => splitBuyerTraderNames(row.buyerTraderInCharge).some((name) => activeBuyerTraderSet.has(name)))
    : rowsWithReminderRules;

  return {
    rows,
    today,
    dueThrough,
    daysAhead,
    receivableThreshold,
    buyerTraderOptions,
    selectedBuyerTraders: activeBuyerTraders,
    hasBuyerTraderFilter,
    paymentReminderRulesAvailable: reminderRulesState.available,
  };
}

const INCOMING_PAYMENT_SETTINGS_ID = 'default';
const DEFAULT_INCOMING_PAYMENT_SETTINGS = {
  fullyPaidThreshold: 50,
};

function serializeIncomingPaymentSettings(row = null) {
  return {
    fullyPaidThreshold: Number(row?.fully_paid_threshold ?? DEFAULT_INCOMING_PAYMENT_SETTINGS.fullyPaidThreshold),
    updatedAt: row?.updated_at || null,
    updatedByEmail: row?.updated_by_email || null,
  };
}

async function loadIncomingPaymentSettings() {
  const client = safeSupabaseAdminClient();
  if (!client) return serializeIncomingPaymentSettings(null);
  const { data, error } = await client
    .from('incoming_payment_settings')
    .select('id,fully_paid_threshold,updated_by_email,updated_at')
    .eq('id', INCOMING_PAYMENT_SETTINGS_ID)
    .maybeSingle();
  if (error) return serializeIncomingPaymentSettings(null);
  return serializeIncomingPaymentSettings(data);
}

async function incomingPaymentSettingsGet(body, req, accessContext = null) {
  if (!accessContext) await requireActiveUser(req);
  return { settings: await loadIncomingPaymentSettings() };
}

async function incomingPaymentSettingsSave(body, req) {
  const { client, profile } = await requireAdministrator(req);
  const threshold = Number(body.fullyPaidThreshold ?? body.fully_paid_threshold ?? DEFAULT_INCOMING_PAYMENT_SETTINGS.fullyPaidThreshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1000000) {
    throw appError('Fully paid threshold must be a number between 0 and 1,000,000.', 400);
  }
  const payload = {
    id: INCOMING_PAYMENT_SETTINGS_ID,
    fully_paid_threshold: Number(threshold.toFixed(2)),
    updated_by: profile.id,
    updated_by_email: profile.email,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from('incoming_payment_settings')
    .upsert(payload, { onConflict: 'id' })
    .select('id,fully_paid_threshold,updated_by_email,updated_at')
    .single();
  if (error) throw error;
  return { settings: serializeIncomingPaymentSettings(data) };
}

const CASHFLOW_SETTINGS_ID = 'default';
const CASHFLOW_HOLIDAY_SOURCE = 'nager.date';
const DEFAULT_CASHFLOW_SETTINGS = {
  horizonDays: 90,
  lookbackMonths: 12,
  minBuyerSamples: 3,
  minGroupSamples: 5,
};

function clampInteger(value, fallback, min, max) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function serializeCashflowSettings(row = null) {
  return {
    horizonDays: clampInteger(row?.horizon_days, DEFAULT_CASHFLOW_SETTINGS.horizonDays, 1, 365),
    lookbackMonths: clampInteger(row?.lookback_months, DEFAULT_CASHFLOW_SETTINGS.lookbackMonths, 1, 36),
    minBuyerSamples: clampInteger(row?.min_buyer_samples, DEFAULT_CASHFLOW_SETTINGS.minBuyerSamples, 1, 100),
    minGroupSamples: clampInteger(row?.min_group_samples, DEFAULT_CASHFLOW_SETTINGS.minGroupSamples, 1, 100),
    updatedAt: row?.updated_at || null,
    updatedByEmail: row?.updated_by_email || null,
  };
}

async function loadCashflowSettings() {
  const client = safeSupabaseAdminClient();
  if (!client) return serializeCashflowSettings(null);
  const { data, error } = await client
    .from('cashflow_forecast_settings')
    .select('id,horizon_days,lookback_months,min_buyer_samples,min_group_samples,updated_by_email,updated_at')
    .eq('id', CASHFLOW_SETTINGS_ID)
    .maybeSingle();
  if (error) return serializeCashflowSettings(null);
  return serializeCashflowSettings(data);
}

function serializeCashflowHolidayOverride(row) {
  return {
    id: row.id,
    date: row.holiday_date,
    countryCode: row.country_code || 'MANUAL',
    name: row.name || 'Manual blocked date',
    isBlocked: row.is_blocked !== false,
    note: row.note || null,
    updatedAt: row.updated_at || row.created_at || null,
    updatedByEmail: row.updated_by_email || row.created_by_email || null,
  };
}

async function loadCashflowHolidayOverrides(years = []) {
  const client = safeSupabaseAdminClient();
  if (!client) return [];
  let query = client
    .from('cashflow_holiday_overrides')
    .select('id,holiday_date,country_code,name,is_blocked,note,created_by_email,created_at,updated_by_email,updated_at')
    .order('holiday_date', { ascending: true });
  const normalizedYears = [...new Set(years.map((year) => Number(year)).filter(Number.isFinite))];
  if (normalizedYears.length) {
    const from = `${Math.min(...normalizedYears)}-01-01`;
    const to = `${Math.max(...normalizedYears)}-12-31`;
    query = query.gte('holiday_date', from).lte('holiday_date', to);
  }
  const { data, error } = await query;
  if (error) return [];
  return (data || []).map(serializeCashflowHolidayOverride);
}

function cashflowHolidayIsBlocking(holiday) {
  const types = holiday?.types || holiday?.holidayTypes || [];
  if (Array.isArray(types) && types.length) {
    return types.some((type) => ['public', 'bank'].includes(String(type).toLowerCase()));
  }
  return true;
}

async function fetchNagerHolidays(countryCode, year) {
  const response = await fetch(`https://date.nager.at/api/v4/Holidays/${encodeURIComponent(countryCode)}/${encodeURIComponent(year)}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw appError(`Holiday API returned ${response.status} for ${countryCode} ${year}.`, 502);
  const rows = await response.json();
  return (Array.isArray(rows) ? rows : [])
    .filter(cashflowHolidayIsBlocking)
    .map((holiday) => ({
      date: holiday.date,
      localName: holiday.localName || holiday.name || 'Holiday',
      name: holiday.name || holiday.localName || 'Holiday',
      countryCode,
      types: holiday.types || holiday.holidayTypes || [],
      source: CASHFLOW_HOLIDAY_SOURCE,
    }))
    .filter((holiday) => holiday.date);
}

async function cashflowCachedHolidays(countryCode, year, warnings = []) {
  const client = safeSupabaseAdminClient();
  const cacheSelect = 'id,country_code,calendar_year,source,holidays,fetched_at,expires_at,error_message';
  if (client) {
    const { data: cached } = await client
      .from('cashflow_holiday_cache')
      .select(cacheSelect)
      .eq('country_code', countryCode)
      .eq('calendar_year', year)
      .eq('source', CASHFLOW_HOLIDAY_SOURCE)
      .maybeSingle();
    const notExpired = cached?.expires_at && new Date(cached.expires_at).getTime() > Date.now();
    if (cached?.holidays && notExpired) {
      return { holidays: cached.holidays, fetchedAt: cached.fetched_at, fromCache: true };
    }
    try {
      const holidays = await fetchNagerHolidays(countryCode, year);
      const expiresAt = new Date();
      expiresAt.setUTCDate(expiresAt.getUTCDate() + 30);
      await client
        .from('cashflow_holiday_cache')
        .upsert({
          country_code: countryCode,
          calendar_year: year,
          source: CASHFLOW_HOLIDAY_SOURCE,
          holidays,
          fetched_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
          error_message: null,
        }, { onConflict: 'country_code,calendar_year,source' });
      return { holidays, fetchedAt: new Date().toISOString(), fromCache: false };
    } catch (error) {
      warnings.push(error.message);
      if (cached?.holidays) return { holidays: cached.holidays, fetchedAt: cached.fetched_at, fromCache: true, error: error.message };
      return { holidays: [], fetchedAt: null, fromCache: false, error: error.message };
    }
  }

  try {
    return { holidays: await fetchNagerHolidays(countryCode, year), fetchedAt: new Date().toISOString(), fromCache: false };
  } catch (error) {
    warnings.push(error.message);
    return { holidays: [], fetchedAt: null, fromCache: false, error: error.message };
  }
}

function yearsBetween(dateFrom, dateTo) {
  const fromYear = Number(String(dateFrom).slice(0, 4));
  const toYear = Number(String(dateTo).slice(0, 4));
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) return [Number(dateOnly(new Date()).slice(0, 4))];
  const years = [];
  for (let year = fromYear; year <= toYear; year += 1) years.push(year);
  return years;
}

async function loadCashflowHolidayData(years, warnings = []) {
  const normalizedYears = [...new Set((years || []).map((year) => Number(year)).filter(Number.isFinite))].sort();
  const countries = ['SG', 'US'];
  const holidayRows = [];
  const statuses = [];
  for (const year of normalizedYears) {
    for (const countryCode of countries) {
      const result = await cashflowCachedHolidays(countryCode, year, warnings);
      holidayRows.push(...(result.holidays || []));
      statuses.push({
        countryCode,
        year,
        source: CASHFLOW_HOLIDAY_SOURCE,
        fetchedAt: result.fetchedAt,
        fromCache: result.fromCache,
        error: result.error || null,
      });
    }
  }
  const overrides = await loadCashflowHolidayOverrides(normalizedYears);
  const blockedMap = new Map();
  for (const holiday of holidayRows) {
    if (!holiday.date) continue;
    const current = blockedMap.get(holiday.date) || [];
    current.push({
      date: holiday.date,
      countryCode: holiday.countryCode,
      name: holiday.name || holiday.localName || 'Holiday',
      source: holiday.source || CASHFLOW_HOLIDAY_SOURCE,
    });
    blockedMap.set(holiday.date, current);
  }
  for (const override of overrides) {
    if (!override.date) continue;
    const current = blockedMap.get(override.date) || [];
    if (override.isBlocked) {
      current.push({
        date: override.date,
        countryCode: override.countryCode,
        name: override.name,
        source: 'manual',
        overrideId: override.id,
      });
      blockedMap.set(override.date, current);
    } else {
      blockedMap.delete(override.date);
    }
  }
  return {
    holidays: [...blockedMap.values()].flat().sort((a, b) => String(a.date).localeCompare(String(b.date))),
    overrides,
    statuses,
    blockedMap,
  };
}

function cashflowBusinessDayAdjustment(originalDate, blockedMap) {
  let current = originalDate;
  let firstReason = null;
  for (let guard = 0; guard < 30; guard += 1) {
    const day = new Date(`${current}T00:00:00.000Z`).getUTCDay();
    const holidayReasons = blockedMap.get(current) || [];
    const weekend = day === 0 || day === 6;
    if (!weekend && !holidayReasons.length) {
      return {
        date: current,
        note: firstReason ? `Moved from ${originalDate} due to ${firstReason}` : null,
      };
    }
    if (!firstReason) {
      if (holidayReasons.length) {
        firstReason = holidayReasons.map((item) => `${item.countryCode} ${item.name}`).join(', ');
      } else {
        firstReason = 'weekend';
      }
    }
    current = addDays(current, 1);
  }
  return { date: originalDate, note: null };
}

function cashflowWeightedDelay(samples) {
  const today = dateOnly(new Date());
  let weightedTotal = 0;
  let weightTotal = 0;
  const recent = [];
  for (const sample of samples) {
    const age = Math.max(0, daysBetween(sample.paymentDate, today) ?? 0);
    const weight = Math.pow(0.5, age / 90);
    weightedTotal += Number(sample.delayDays || 0) * weight;
    weightTotal += weight;
    if (age <= 90) recent.push(sample);
  }
  if (!weightTotal) return 0;
  const weighted = weightedTotal / weightTotal;
  if (recent.length >= Math.min(3, samples.length)) {
    const recentAverage = recent.reduce((sum, sample) => sum + Number(sample.delayDays || 0), 0) / recent.length;
    return Math.round((weighted * 0.7) + (recentAverage * 0.3));
  }
  return Math.round(weighted);
}

function cashflowDelayModel(samples, level, minSamples) {
  const usable = samples.filter((sample) => Number.isFinite(Number(sample.delayDays)));
  if (!usable.length) return null;
  const delay = Math.max(-15, Math.min(120, cashflowWeightedDelay(usable)));
  return {
    level,
    predictedDelayDays: delay,
    sampleCount: usable.length,
    minSamples,
    confidence: usable.length >= minSamples * 2 ? 'High' : usable.length >= minSamples ? 'Medium' : 'Low',
  };
}

function cashflowBuildDelayModels(samples, settings) {
  const byBuyer = new Map();
  const byGroup = new Map();
  for (const sample of samples) {
    if (sample.buyerAccountId) {
      if (!byBuyer.has(sample.buyerAccountId)) byBuyer.set(sample.buyerAccountId, []);
      byBuyer.get(sample.buyerAccountId).push(sample);
    }
    if (sample.buyerGroupName) {
      if (!byGroup.has(sample.buyerGroupName)) byGroup.set(sample.buyerGroupName, []);
      byGroup.get(sample.buyerGroupName).push(sample);
    }
  }
  const buyerModels = {};
  for (const [id, rows] of byBuyer.entries()) {
    const model = cashflowDelayModel(rows, 'Buyer', settings.minBuyerSamples);
    if (model) buyerModels[id] = model;
  }
  const groupModels = {};
  for (const [name, rows] of byGroup.entries()) {
    const model = cashflowDelayModel(rows, 'Buyer Group', settings.minGroupSamples);
    if (model) groupModels[name] = model;
  }
  const globalModel = cashflowDelayModel(samples, 'Global', 1) || {
    level: 'Default',
    predictedDelayDays: 0,
    sampleCount: 0,
    minSamples: 1,
    confidence: 'Low',
  };
  return { buyerModels, groupModels, globalModel };
}

function cashflowSelectDelayModel(row, models, settings) {
  const buyerModel = row.buyerAccountId ? models.buyerModels[row.buyerAccountId] : null;
  if (buyerModel && buyerModel.sampleCount >= settings.minBuyerSamples) return buyerModel;
  const groupModel = row.buyerGroupName ? models.groupModels[row.buyerGroupName] : null;
  if (groupModel && groupModel.sampleCount >= settings.minGroupSamples) return groupModel;
  return models.globalModel;
}

function cashflowPaymentText(payment, fields = []) {
  return fields
    .map((field) => payment?.[field])
    .concat([payment?.Name, payment?.RecordType?.Name, payment?.RecordType?.DeveloperName])
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

async function cashflowBuyerPaymentSamples({ lookbackMonths, accessContext = null }) {
  const today = dateOnly(new Date());
  const lookbackStart = [addDays(today, -Math.max(1, Number(lookbackMonths || 12)) * 31), CASHFLOW_FORECAST_START_DATE].sort().at(-1);
  const paymentDescribe = await salesforceObjectFields({ objectName: 'Payment__c' }).catch(() => ({ fields: [] }));
  const paymentFields = paymentDescribe.fields || [];
  const paymentFieldNames = new Set(paymentFields.map((field) => field.name));
  const paymentFieldByName = Object.fromEntries(paymentFields.map((field) => [field.name, field]));
  if (!paymentFieldNames.size) return { samples: [], warnings: ['Payment__c is not queryable.'] };
  const dateField = firstAvailableField(paymentFieldNames, ['Date__c', 'Payment_Date__c', 'Received_Date__c', 'Paid_Date__c', 'CreatedDate']);
  const amountField = firstAvailableField(paymentFieldNames, [
    'Amount__c',
    'Payment_Amount__c',
    'Paid_Amount__c',
    'Received_Amount__c',
    'Total_Amount__c',
    'Amount_Paid__c',
    'Payment_Value__c',
    'Actual_Amount__c',
  ]);
  if (!dateField || !amountField) return { samples: [], warnings: ['Payment__c date or amount field was not found.'] };
  const supplierInvoiceLookupFields = incomingPaymentSupplierInvoiceFields(paymentFields);
  const referenceFields = incomingPaymentReferenceFields(paymentFields);
  const statusFields = selectedFields(paymentFieldNames, ['Status__c', 'Payment_Status__c']);
  const typeFields = selectedFields(paymentFieldNames, ['Type__c', 'Payment_Type__c']);
  const directionFields = incomingPaymentDirectionFields(paymentFields);
  const dateType = paymentFieldByName[dateField]?.type || null;
  const payments = await queryRows(`
    SELECT ${[...new Set([
      'Id',
      ...selectedFields(paymentFieldNames, ['Name', 'CreatedDate', 'STEM__c', 'CurrencyIsoCode', 'Currency__c', 'RecordTypeId']),
      paymentFieldNames.has('RecordTypeId') ? 'RecordType.Name' : null,
      paymentFieldNames.has('RecordTypeId') ? 'RecordType.DeveloperName' : null,
      dateField,
      amountField,
      ...supplierInvoiceLookupFields,
      ...referenceFields,
      ...statusFields,
      ...typeFields,
      ...directionFields,
    ].filter(Boolean))].join(', ')}
    FROM Payment__c
    WHERE ${dateField} >= ${soqlDateValue(dateField, dateType, lookbackStart, false)}
    ORDER BY ${dateField} DESC NULLS LAST
    LIMIT 10000
  `, { limit: 10000, softFail: true });
  const eligiblePayments = payments
    .filter((payment) => payment.STEM__c)
    .filter((payment) => !incomingPaymentIsReceivableRemittance(payment, [...referenceFields, ...directionFields, ...typeFields, ...statusFields]))
    .filter((payment) => !incomingPaymentSupplierInvoiceId(payment, supplierInvoiceLookupFields));
  const stemIds = [...new Set(eligiblePayments.map((payment) => payment.STEM__c).filter(Boolean))];
  if (!stemIds.length) return { samples: [], warnings: [] };

  const stemDescribe = await salesforceObjectFields({ objectName: 'stem__c' }).catch(() => ({ fields: [] }));
  const stemFieldNames = new Set((stemDescribe.fields || []).map((field) => field.name));
  const accountDescribe = stemFieldNames.has('Account__c')
    ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({ fields: [] }))
    : { fields: [] };
  const accountFieldNames = new Set((accountDescribe.fields || []).map((field) => field.name));
  const interofficeCondition = await interofficeStemAccessCondition(accessContext, stemFieldNames, accountFieldNames);
  const stemSelectFields = [
    'Id',
    'Name',
    ...selectedFields(stemFieldNames, [
      'KeyStem__c',
      'Buyer_Name__c',
      'Buyer__c',
      'Account__c',
      'Payment_Term__c',
      'Invoice_Due_Date__c',
      'Buyer_Pay_Term_Date__c',
      'Due_Date__c',
      'Delivery_Date__c',
      'Delivery_Date_Or_Expected__c',
      'Expected_Delivery_Date__c',
    ]),
  ];
  if (stemFieldNames.has('Account__c')) {
    stemSelectFields.push('Account__r.Name');
    if (accountFieldNames.has('Group_Name__c')) stemSelectFields.push('Account__r.Group_Name__c');
    if (accountFieldNames.has('ParentId')) stemSelectFields.push('Account__r.Parent.Name');
  }
  const stemMap = {};
  for (const chunk of chunkIds(stemIds)) {
    const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
    const stemWhere = combineWhereConditions([`Id IN (${inList})`, interofficeCondition]);
    const rows = await queryRows(`
      SELECT ${[...new Set(stemSelectFields)].join(', ')}
      FROM stem__c
      WHERE ${stemWhere}
      LIMIT 5000
    `, { limit: 5000, softFail: true });
    for (const stem of rows) stemMap[stem.Id] = stem;
  }

  const textFields = [...referenceFields, ...directionFields, ...typeFields, ...statusFields];
  const samples = [];
  for (const payment of eligiblePayments) {
    const stem = stemMap[payment.STEM__c];
    if (!stem) continue;
    if (isBeforeCashflowForecastStart(stem.Delivery_Date__c)) continue;
    const amount = incomingPaymentNumber(payment[amountField]);
    if (amount == null || amount <= 0) continue;
    const text = cashflowPaymentText(payment, textFields);
    if (/(bank\s*charge|broker|commission|payable|supplier)/i.test(text)) continue;
    if (incomingPaymentLooksBankCharge(payment, { referenceFields, directionFields, typeFields, statusFields })) continue;
    const type = incomingPaymentTypeFromContext(payment, {
      amount,
      stem,
      supplierInvoice: null,
      supplierInvoiceFields: supplierInvoiceLookupFields,
      directionFields,
      typeFields,
      statusFields,
    });
    if (type !== 'Buyer Payment') continue;
    const dueDate = calculatedBuyerPayTermDate(stem)
      || stem.Invoice_Due_Date__c
      || stem.Due_Date__c
      || stem.Buyer_Pay_Term_Date__c
      || null;
    const paymentDate = dateOnly(payment[dateField] || payment.CreatedDate);
    if (!dueDate || !paymentDate) continue;
    if (isBeforeCashflowForecastStart(paymentDate)) continue;
    const account = stem['Account__r'] || {};
    samples.push({
      paymentId: payment.Id,
      stemId: stem.Id,
      stemName: formatStemName(stem),
      buyerAccountId: stem.Account__c || null,
      buyerName: incomingPaymentBuyerName(stem),
      buyerGroupName: account.Group_Name__c || account.Parent?.Name || incomingPaymentBuyerName(stem),
      dueDate,
      paymentDate,
      delayDays: daysBetween(dueDate, paymentDate),
      amount,
    });
  }
  return { samples, warnings: [] };
}

function cashflowBucketKey(date, bucket = 'daily') {
  if (bucket === 'monthly') return String(date || '').slice(0, 7);
  if (bucket === 'weekly') {
    const value = new Date(`${date}T00:00:00.000Z`);
    const day = value.getUTCDay() || 7;
    value.setUTCDate(value.getUTCDate() - day + 1);
    return dateOnly(value);
  }
  return date;
}

function cashflowBucketLabel(key, bucket = 'daily') {
  if (!key) return '—';
  if (bucket === 'monthly') return key;
  if (bucket === 'weekly') return `Week of ${key}`;
  return key;
}

function cashflowSummarizeRows(rows, bucket = 'daily') {
  const totals = {
    buyerReceipts: 0,
    supplierPayments: 0,
    netCashflow: 0,
    overdueRiskReceipts: 0,
    rowCount: rows.length,
  };
  const buckets = new Map();
  const today = dateOnly(new Date());
  for (const row of rows) {
    const amount = Number(row.amount || 0);
    if (row.direction === 'inflow') {
      totals.buyerReceipts += amount;
      if (row.sourceDueDate && row.sourceDueDate < today) totals.overdueRiskReceipts += amount;
    } else {
      totals.supplierPayments += amount;
    }
    const key = cashflowBucketKey(row.forecastDate, bucket);
    if (!buckets.has(key)) buckets.set(key, { bucket: key, label: cashflowBucketLabel(key, bucket), inflow: 0, outflow: 0, net: 0 });
    const current = buckets.get(key);
    if (row.direction === 'inflow') current.inflow += amount;
    if (row.direction === 'outflow') current.outflow += amount;
    current.net = current.inflow - current.outflow;
  }
  totals.netCashflow = totals.buyerReceipts - totals.supplierPayments;
  return {
    totals,
    buckets: [...buckets.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))),
  };
}

async function cashflowSupplierInvoiceRows({ dateTo, blockedMap, accessContext = null }) {
  const warnings = [];
  const today = dateOnly(new Date());
  const describe = await salesforceObjectFields({ objectName: 'Supplier_Invoice__c' }).catch(() => ({ fields: [] }));
  const fields = describe.fields || [];
  const fieldNames = new Set(fields.map((field) => field.name));
  if (!fieldNames.size) return { rows: [], warnings: ['Supplier_Invoice__c is not queryable.'] };
  const fieldByName = Object.fromEntries(fields.map((field) => [field.name, field]));
  const stemField = firstAvailableField(fieldNames, ['STEM__c', 'Stem__c']);
  const dueDateField = firstAvailableField(fieldNames, ['Invoice_Due_Date__c', 'Due_Date__c', 'Payment_Due_Date__c', 'Pay_Term_Date__c', 'Supplier_Pay_Term_Date__c']);
  const payableField = firstAvailableField(fieldNames, ['Payable_Balance__c', 'Balance__c', 'Actual_Balance__c', 'Outstanding_Balance__c']);
  const amountField = firstAvailableField(fieldNames, ['Invoice_Amount__c', 'Calculated_Amount__c', 'Amount__c', 'Total_Amount__c']);
  const paidDateField = firstAvailableField(fieldNames, ['Payment_Date__c', 'Paid_Date__c', 'Date_Paid__c']);
  const supplierFields = selectedFields(fieldNames, ['Supplier__c', 'Expected_Supplier__c', 'Substitute_Supplier__c']);
  const supplierRelationships = supplierFields.map((field) => fieldByName[field]?.relationshipName).filter(Boolean);
  if (!stemField || !dueDateField || (!payableField && !amountField)) {
    return { rows: [], warnings: ['Supplier invoice STEM, due date, or amount fields were not found.'] };
  }
  const selectFields = [
    'Id',
    'Name',
    stemField,
    dueDateField,
    payableField,
    amountField,
    paidDateField,
    ...selectedFields(fieldNames, ['Supplier_Name__c', 'CurrencyIsoCode', 'Currency__c']),
    ...supplierFields,
    ...supplierRelationships.map((relationship) => `${relationship}.Name`),
  ].filter(Boolean);
  const whereParts = [
    `${dueDateField} != null`,
    `${dueDateField} <= ${dateTo}`,
  ];
  if (paidDateField) whereParts.push(`${paidDateField} = null`);
  const invoices = await queryRows(`
    SELECT ${[...new Set(selectFields)].join(', ')}
    FROM Supplier_Invoice__c
    WHERE ${whereParts.join(' AND ')}
    ORDER BY ${dueDateField} ASC NULLS LAST
    LIMIT 10000
  `, { limit: 10000, softFail: true });
  const stemIds = [...new Set(invoices.map((invoice) => invoice[stemField]).filter(Boolean))];
  const stemMap = {};
  if (stemIds.length) {
    const stemDescribe = await salesforceObjectFields({ objectName: 'stem__c' }).catch(() => ({ fields: [] }));
    const stemFieldNames = new Set((stemDescribe.fields || []).map((field) => field.name));
    const accountDescribe = stemFieldNames.has('Account__c')
      ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({ fields: [] }))
      : { fields: [] };
    const accountFieldNames = new Set((accountDescribe.fields || []).map((field) => field.name));
    const interofficeCondition = await interofficeStemAccessCondition(accessContext, stemFieldNames, accountFieldNames);
    const stemSelectFields = [
      'Id',
      'Name',
      ...selectedFields(stemFieldNames, ['KeyStem__c', 'Delivery_Date__c']),
    ];
    if (stemFieldNames.has('Vessel__c')) stemSelectFields.push('Vessel__r.Name');
    if (stemFieldNames.has('Port__c')) stemSelectFields.push('Port__r.Name');
    for (const chunk of chunkIds(stemIds)) {
      const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
      const stemWhere = combineWhereConditions([`Id IN (${inList})`, interofficeCondition]);
      const stems = await queryRows(`
        SELECT ${[...new Set(stemSelectFields)].join(', ')}
        FROM stem__c
        WHERE ${stemWhere}
        LIMIT 5000
      `, { limit: 5000, softFail: true });
      for (const stem of stems) stemMap[stem.Id] = stem;
    }
  }
  const rows = [];
  for (const invoice of invoices) {
    const amount = Number(payableField ? invoice[payableField] : invoice[amountField]);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const sourceDueDate = invoice[dueDateField];
    if (!sourceDueDate) continue;
    const originalDate = sourceDueDate < today ? today : sourceDueDate;
    const adjusted = cashflowBusinessDayAdjustment(originalDate, blockedMap);
    const stem = stemMap[invoice[stemField]] || null;
    if (isInterofficeAccess(accessContext) && invoice[stemField] && !stem) continue;
    if (isBeforeCashflowForecastStart(stem?.Delivery_Date__c)) continue;
    const counterparty = supplierRelationships.map((relationship) => invoice[relationship]?.Name).find(Boolean)
      || invoice.Supplier_Name__c
      || supplierFields.map((field) => invoice[field]).find(Boolean)
      || invoice.Name
      || 'Supplier';
    rows.push({
      id: `supplier-${invoice.Id}`,
      forecastDate: adjusted.date,
      originalDate,
      direction: 'outflow',
      type: 'Supplier Payment',
      stemId: invoice[stemField] || null,
      stemName: stem ? formatStemName(stem) : invoice[stemField] || null,
      counterparty,
      buyerGroup: null,
      amount,
      currency: invoice.CurrencyIsoCode || invoice.Currency__c || 'USD',
      sourceDueDate,
      predictedDelayDays: 0,
      modelLevel: 'Contractual due date',
      sampleCount: null,
      confidence: 'Certain',
      holidayAdjustment: adjusted.note,
      sourceRecordId: invoice.Id,
      sourceRecordName: invoice.Name || null,
    });
  }
  return { rows, warnings };
}

async function cashflowBuyerReceiptRows({ dateTo, settings, models, blockedMap, receivableThreshold, accessContext = null }) {
  const today = dateOnly(new Date());
  const daysAhead = Math.max(0, Math.min(daysBetween(today, dateTo) ?? settings.horizonDays, 365));
  const invoiceData = await salesforceBuyerInvoicesDue({ daysAhead, receivableThreshold }, null, accessContext);
  const rows = [];
  for (const invoice of invoiceData.rows || []) {
    if (isBeforeCashflowForecastStart(invoice.deliveryDate)) continue;
    const amount = Number(invoice.receivableBalance || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const dueDate = invoice.buyerInvoiceDueDate;
    if (!dueDate) continue;
    const model = cashflowSelectDelayModel(invoice, models, settings);
    const predictedDate = addDays(dueDate, model.predictedDelayDays || 0);
    const originalDate = predictedDate < today ? today : predictedDate;
    const adjusted = cashflowBusinessDayAdjustment(originalDate, blockedMap);
    rows.push({
      id: `buyer-${invoice.stemId}`,
      forecastDate: adjusted.date,
      originalDate,
      direction: 'inflow',
      type: 'Buyer Receipt',
      stemId: invoice.stemId,
      stemName: invoice.stemName,
      counterparty: invoice.buyerName || 'Buyer',
      buyerGroup: invoice.buyerGroupName || invoice.buyerName || null,
      amount,
      currency: 'USD',
      sourceDueDate: dueDate,
      predictedDelayDays: model.predictedDelayDays,
      modelLevel: model.level,
      sampleCount: model.sampleCount,
      confidence: model.confidence,
      holidayAdjustment: adjusted.note,
      buyerAccountId: invoice.buyerAccountId || null,
      status: invoice.status || null,
    });
  }
  return rows;
}

function cashflowPerformanceRows(samples, models) {
  const buyerRows = Object.entries(models.buyerModels || {}).map(([buyerAccountId, model]) => {
    const sample = samples.find((row) => row.buyerAccountId === buyerAccountId) || {};
    return {
      id: `buyer-${buyerAccountId}`,
      level: 'Buyer',
      name: sample.buyerName || buyerAccountId,
      buyerGroup: sample.buyerGroupName || null,
      predictedDelayDays: model.predictedDelayDays,
      sampleCount: model.sampleCount,
      confidence: model.confidence,
    };
  });
  const groupRows = Object.entries(models.groupModels || {}).map(([groupName, model]) => ({
    id: `group-${groupName}`,
    level: 'Buyer Group',
    name: groupName,
    buyerGroup: groupName,
    predictedDelayDays: model.predictedDelayDays,
    sampleCount: model.sampleCount,
    confidence: model.confidence,
  }));
  return [...buyerRows, ...groupRows]
    .sort((a, b) => {
      if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .slice(0, 50);
}

async function cashflowForecast(body, req = null, accessContext = null) {
  const warnings = [];
  const settings = await loadCashflowSettings();
  const today = dateOnly(new Date());
  const dateFrom = dateOnly(body.dateFrom || body.date_from || today);
  const dateTo = dateOnly(body.dateTo || body.date_to || addDays(today, settings.horizonDays));
  const bucket = ['daily', 'weekly', 'monthly'].includes(String(body.bucket || '').toLowerCase())
    ? String(body.bucket).toLowerCase()
    : 'daily';
  const holidayData = await loadCashflowHolidayData(yearsBetween(dateFrom, addDays(dateTo, 14)), warnings);
  const incomingSettings = await loadIncomingPaymentSettings();
  const receivableThreshold = Number(incomingSettings.fullyPaidThreshold ?? DEFAULT_INCOMING_PAYMENT_SETTINGS.fullyPaidThreshold);
  const buyerSamplesData = await cashflowBuyerPaymentSamples({ lookbackMonths: settings.lookbackMonths, accessContext });
  warnings.push(...(buyerSamplesData.warnings || []));
  const models = cashflowBuildDelayModels(buyerSamplesData.samples || [], settings);
  const [buyerRows, supplierData] = await Promise.all([
    cashflowBuyerReceiptRows({ dateTo, settings, models, blockedMap: holidayData.blockedMap, receivableThreshold, accessContext }),
    cashflowSupplierInvoiceRows({ dateTo, blockedMap: holidayData.blockedMap, accessContext }),
  ]);
  warnings.push(...(supplierData.warnings || []));
  const rows = [...buyerRows, ...(supplierData.rows || [])]
    .filter((row) => row.forecastDate >= dateFrom && row.forecastDate <= dateTo)
    .sort((a, b) => {
      if (a.forecastDate !== b.forecastDate) return a.forecastDate.localeCompare(b.forecastDate);
      if (a.direction !== b.direction) return a.direction.localeCompare(b.direction);
      return String(a.counterparty || '').localeCompare(String(b.counterparty || ''));
    });
  const summary = cashflowSummarizeRows(rows, bucket);
  const canManageSettings = accessContext
    ? await userHasCapability(accessContext.client, accessContext.profile, 'cashflow_forecast_manage')
    : false;
  return {
    dateFrom,
    dateTo,
    bucket,
    rows,
    buckets: summary.buckets,
    totals: summary.totals,
    performance: cashflowPerformanceRows(buyerSamplesData.samples || [], models),
    settings,
    incomingPaymentSettings: incomingSettings,
    holidays: holidayData.holidays,
    holidayOverrides: holidayData.overrides,
    holidaySourceStatus: holidayData.statuses,
    warnings: [...new Set(warnings.filter(Boolean))],
    capabilities: { canManageSettings },
  };
}

async function cashflowBuyerPaymentPerformance(body, req = null, accessContext = null) {
  const baseSettings = await loadCashflowSettings();
  const settings = {
    ...baseSettings,
    lookbackMonths: clampInteger(body.lookbackMonths, baseSettings.lookbackMonths, 1, 36),
  };
  const data = await cashflowBuyerPaymentSamples({ lookbackMonths: settings.lookbackMonths, accessContext });
  const models = cashflowBuildDelayModels(data.samples || [], settings);
  return {
    settings,
    samples: data.samples || [],
    performance: cashflowPerformanceRows(data.samples || [], models),
    warnings: data.warnings || [],
  };
}

async function cashflowSettingsGet(body, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  const today = dateOnly(new Date());
  const settings = await loadCashflowSettings();
  const years = Array.isArray(body.years) && body.years.length
    ? body.years
    : yearsBetween(today, addDays(today, settings.horizonDays + 14));
  const holidayData = await loadCashflowHolidayData(years, []);
  return {
    settings,
    holidayOverrides: holidayData.overrides,
    holidaySourceStatus: holidayData.statuses,
    capabilities: { canManageSettings: await userHasCapability(client, profile, 'cashflow_forecast_manage') },
  };
}

async function cashflowSettingsSave(body, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  await requireCapability(client, profile, 'cashflow_forecast_manage', 'Cashflow settings management permission is required.');
  if (body.overrideAction === 'add') {
    const date = dateOnly(body.date || body.holidayDate);
    if (!date) throw appError('Blocked date is required.', 400);
    const countryCode = String(body.countryCode || 'MANUAL').trim().toUpperCase().slice(0, 12) || 'MANUAL';
    const payload = {
      holiday_date: date,
      country_code: countryCode,
      name: String(body.name || 'Manual blocked date').trim() || 'Manual blocked date',
      is_blocked: body.isBlocked !== false,
      note: body.note ? String(body.note).trim() : null,
      updated_by: profile.id,
      updated_by_email: profile.email,
      updated_at: new Date().toISOString(),
      created_by: profile.id,
      created_by_email: profile.email,
    };
    const { error } = await client
      .from('cashflow_holiday_overrides')
      .upsert(payload, { onConflict: 'holiday_date,country_code' });
    if (error) throw error;
    return cashflowSettingsGet({}, req);
  }
  if (body.overrideAction === 'delete') {
    const id = body.id || body.overrideId;
    if (!id) throw appError('Override id is required.', 400);
    const { error } = await client.from('cashflow_holiday_overrides').delete().eq('id', id);
    if (error) throw error;
    return cashflowSettingsGet({}, req);
  }
  const payload = {
    id: CASHFLOW_SETTINGS_ID,
    horizon_days: clampInteger(body.horizonDays ?? body.horizon_days, DEFAULT_CASHFLOW_SETTINGS.horizonDays, 1, 365),
    lookback_months: clampInteger(body.lookbackMonths ?? body.lookback_months, DEFAULT_CASHFLOW_SETTINGS.lookbackMonths, 1, 36),
    min_buyer_samples: clampInteger(body.minBuyerSamples ?? body.min_buyer_samples, DEFAULT_CASHFLOW_SETTINGS.minBuyerSamples, 1, 100),
    min_group_samples: clampInteger(body.minGroupSamples ?? body.min_group_samples, DEFAULT_CASHFLOW_SETTINGS.minGroupSamples, 1, 100),
    updated_by: profile.id,
    updated_by_email: profile.email,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from('cashflow_forecast_settings')
    .upsert(payload, { onConflict: 'id' })
    .select('id,horizon_days,lookback_months,min_buyer_samples,min_group_samples,updated_by_email,updated_at')
    .single();
  if (error) throw error;
  return { settings: serializeCashflowSettings(data), holidayOverrides: await loadCashflowHolidayOverrides() };
}

async function cashflowHolidayCalendar(body, req) {
  await requireActiveUser(req);
  const today = dateOnly(new Date());
  const years = Array.isArray(body.years) && body.years.length ? body.years : [Number(today.slice(0, 4))];
  const warnings = [];
  const data = await loadCashflowHolidayData(years, warnings);
  return {
    holidays: data.holidays,
    holidayOverrides: data.overrides,
    holidaySourceStatus: data.statuses,
    warnings,
  };
}

function incomingPaymentNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstAvailableField(fieldNames, candidates) {
  return candidates.find((field) => fieldNames.has(field)) || null;
}

function soqlDateValue(dateField, dateType, isoDate, endOfDay = false) {
  if (!isoDate) return null;
  if (dateField === 'CreatedDate' || dateType === 'datetime') {
    return `${isoDate}T${endOfDay ? '23:59:59' : '00:00:00'}Z`;
  }
  return isoDate;
}

function soqlHongKongDateTimeValue(isoDate, endOfDay = false) {
  if (!isoDate) return null;
  const localTime = endOfDay ? '23:59:59.999' : '00:00:00.000';
  return new Date(`${isoDate}T${localTime}+08:00`).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function selectedFields(fieldNames, fields) {
  return fields.filter((field) => field && fieldNames.has(field));
}

function incomingPaymentReferenceFields(paymentFields = []) {
  const fieldNames = new Set(paymentFields.map((field) => field.name));
  const exactFields = [
    'Bank_Reference__c',
    'Reference__c',
    'Payment_Reference__c',
    'Transaction_Reference__c',
    'Description__c',
    'Remarks__c',
  ].filter((field) => fieldNames.has(field));
  const allowedTypes = new Set(['string', 'textarea', 'picklist', 'email', 'phone', 'url']);
  const dynamicFields = paymentFields
    .filter((field) => (
      field?.name &&
      field.name !== 'Name' &&
      !field.name.endsWith('__c__r') &&
      allowedTypes.has(field.type) &&
      fieldMatchesAny(field, [
        'bankreference',
        'bankreferencec',
        'paymentreference',
        'paymentreferencec',
        'transactionreference',
        'transactionreferencec',
        'reference',
        'referencec',
        'description',
        'descriptionc',
        'remarks',
        'remarksc',
        'narration',
        'narrationc',
        'paymentdetails',
        'paymentdetailsc',
        'receiptreference',
        'receiptreferencec',
      ], [
        'bankref',
        'reference',
        'transaction',
        'remittance',
        'description',
        'remark',
        'narration',
        'receipt',
        'cheque',
        'check',
        'details',
        'payer',
        'payor',
      ])
    ))
    .map((field) => field.name);
  return uniqueTextList([...exactFields, ...dynamicFields]).slice(0, 10);
}

function incomingPaymentSupplierInvoiceFields(paymentFields = []) {
  const fieldNames = new Set(paymentFields.map((field) => field.name));
  const exactFields = ['Supplier_Invoice__c'].filter((field) => fieldNames.has(field));
  const dynamicFields = paymentFields
    .filter((field) => {
      if (!field?.name || field.name === 'Name') return false;
      if (field.type !== 'reference') return false;
      const referenceTo = Array.isArray(field.referenceTo) ? field.referenceTo : [];
      return referenceTo.includes('Supplier_Invoice__c')
        || fieldMatchesAny(field, [
          'supplierinvoice',
          'supplierinvoicec',
          'supplierinvoiceid',
          'supplierinvoiceidc',
        ], [
          'supplierinvoice',
          'supplierinv',
          'vendorinvoice',
        ]);
    })
    .map((field) => field.name);
  return uniqueTextList([...exactFields, ...dynamicFields]).slice(0, 8);
}

function incomingPaymentDirectionFields(paymentFields = []) {
  const fieldNames = new Set(paymentFields.map((field) => field.name));
  const exactFields = [
    'Type__c',
    'Payment_Type__c',
    'Status__c',
    'Payment_Status__c',
    'Direction__c',
    'Payment_Direction__c',
    'Category__c',
    'Payment_Category__c',
    'Payable_Receivable__c',
    'AP_AR__c',
    'Payer__c',
    'Payor__c',
    'Payee__c',
    'From__c',
    'To__c',
    'Supplier__c',
    'Vendor__c',
    'Account__c',
  ].filter((field) => fieldNames.has(field));
  const allowedTypes = new Set(['string', 'textarea', 'picklist', 'reference']);
  const dynamicFields = paymentFields
    .filter((field) => (
      field?.name &&
      field.name !== 'Name' &&
      allowedTypes.has(field.type) &&
      fieldMatchesAny(field, [
        'paymenttype',
        'paymenttypec',
        'paymentdirection',
        'paymentdirectionc',
        'direction',
        'directionc',
        'payablereceivable',
        'payablereceivablec',
        'apar',
        'aparc',
        'supplier',
        'supplierc',
        'vendor',
        'vendorc',
        'payee',
        'payeec',
        'payer',
        'payerc',
        'payor',
        'payorc',
      ], [
        'paymenttype',
        'direction',
        'payable',
        'receivable',
        'supplier',
        'vendor',
        'payee',
        'payer',
        'payor',
        'payfrom',
        'payto',
        'recipient',
        'beneficiary',
        'party',
      ])
    ))
    .map((field) => field.name);
  return uniqueTextList([...exactFields, ...dynamicFields]).slice(0, 20);
}

function incomingPaymentSupplierInvoiceId(payment, supplierInvoiceFields = []) {
  return supplierInvoiceFields
    .map((field) => payment?.[field])
    .find((value) => isSalesforceId(value)) || null;
}

function incomingPaymentLooksSupplierSide(payment, {
  supplierInvoiceFields = [],
  directionFields = [],
  typeFields = [],
  statusFields = [],
} = {}) {
  if (incomingPaymentSupplierInvoiceId(payment, supplierInvoiceFields)) return true;
  const fields = uniqueTextList([...directionFields, ...typeFields, ...statusFields]);
  const hasSupplierLookup = fields.some((field) => {
    const value = payment?.[field];
    if (value == null || value === '') return false;
    const fieldToken = normalizedFieldToken(field);
    if (fieldToken.includes('buyersupplier')) return false;
    return fieldToken.includes('supplier') || fieldToken.includes('vendor') || fieldToken.includes('supplierinvoice');
  });
  if (hasSupplierLookup) return true;
  const valueToken = normalizedFieldToken(fields
    .filter((field) => payment?.[field] != null && payment[field] !== '')
    .map((field) => payment[field])
    .join(' '));
  if (!valueToken) return false;
  const supplierSignals = [
    'supplierinvoice',
    'supplierpayment',
    'supplierrefund',
    'vendor',
    'payable',
    'accountspayable',
    'outgoing',
    'paymenttosupplier',
    'tosupplier',
    'fromsupplier',
    'supplieraccount',
    'supplierc',
    'suppliername',
  ];
  const hasSupplierSignal = supplierSignals.some((signal) => valueToken.includes(signal));
  if (!hasSupplierSignal) return false;
  const mixedBuyerSupplierOnly = valueToken.includes('buyersupplier')
    && !['supplierinvoice', 'supplierpayment', 'supplierrefund', 'paymenttosupplier', 'payable', 'vendor'].some((signal) => valueToken.includes(signal));
  return !mixedBuyerSupplierOnly;
}

function incomingPaymentLooksBankCharge(payment, {
  referenceFields = [],
  directionFields = [],
  typeFields = [],
  statusFields = [],
} = {}) {
  if (payment?.Id === 'a0Sfu00000FsN0c' || String(payment?.Id || '').startsWith('a0Sfu00000FsN0c')) return true;
  const fields = uniqueTextList([...referenceFields, ...directionFields, ...typeFields, ...statusFields, 'Name']);
  const valueToken = normalizedFieldToken(fields
    .filter((field) => payment?.[field] != null && payment[field] !== '')
    .map((field) => payment[field])
    .join(' '));
  if (!valueToken) return false;
  return [
    'bankcharge',
    'bankcharges',
    'bankfee',
    'bankfees',
    'remittancecharge',
    'remittancefee',
    'transfercharge',
    'transferfee',
  ].some((signal) => valueToken.includes(signal));
}

function incomingPaymentLooksBuyerSide(payment, {
  referenceFields = [],
  directionFields = [],
  typeFields = [],
  statusFields = [],
} = {}) {
  const fields = uniqueTextList([...referenceFields, ...directionFields, ...typeFields, ...statusFields, 'Name']);
  const valueToken = normalizedFieldToken(fields
    .filter((field) => payment?.[field] != null && payment[field] !== '')
    .map((field) => payment[field])
    .join(' '));
  if (!valueToken) return false;
  return [
    'buyerpayment',
    'buyerreceipt',
    'paymentfrombuyer',
    'frombuyer',
    'customerpayment',
    'customerreceipt',
    'receivable',
    'accountsreceivable',
  ].some((signal) => valueToken.includes(signal));
}

function incomingPaymentLooksStemPayableCalculation(payment, {
  amount,
  payableAmounts = [],
  referenceFields = [],
  directionFields = [],
  typeFields = [],
  statusFields = [],
  allowBlankSignal = false,
} = {}) {
  if (amount == null || amount <= 0) return false;
  const matchesPayableAmount = payableAmounts
    .filter((value) => value != null && Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0)
    .some((value) => amountNearlyEqual(amount, value, 1));
  if (!matchesPayableAmount) return false;
  if (incomingPaymentLooksBuyerSide(payment, { referenceFields, directionFields, typeFields, statusFields })) return false;

  const fields = uniqueTextList([...referenceFields, ...directionFields, ...typeFields, ...statusFields, 'Name']);
  const valueToken = normalizedFieldToken(fields
    .filter((field) => payment?.[field] != null && payment[field] !== '')
    .map((field) => payment[field])
    .join(' '));
  if (!valueToken) return allowBlankSignal;
  return true;
}

function stemPayableAmountCandidates({ stem = {}, lineItems = [], extraCosts = [] } = {}) {
  const stemHasDelivery = !!stem.Delivery_Date__c;
  const activeLineItems = lineItems.filter((item) => !item.Cancelled__c);
  const activeExtraCosts = extraCosts.filter((item) => !item.Cancelled__c);
  const supplierInvoiceTotal = numericValue(stem.Total_Invoiced_Amount_From_Suppliers__c) ?? 0;
  const supplierLineBuyTotal = activeLineItems.reduce((sum, item) => sum + lineBuyAmount(item, stemHasDelivery), 0);
  const uninvoicedSupplierLineBuyTotal = activeLineItems.reduce((sum, item) => item.Supplier_Invoice__c ? sum : sum + lineBuyAmount(item, stemHasDelivery), 0);
  const supplierExtraBuyTotal = activeExtraCosts.reduce((sum, item) => sum + extraBuyAmount(item, stemHasDelivery), 0);
  const uninvoicedSupplierExtraBuyTotal = activeExtraCosts.reduce((sum, item) => item.Supplier_Invoice__c ? sum : sum + extraBuyAmount(item, stemHasDelivery), 0);
  const hasSupplierInvoiceLines = activeLineItems.some((item) => item.Supplier_Invoice__c);
  const calculatedSupplierInvoice = supplierInvoiceTotal + (hasSupplierInvoiceLines ? uninvoicedSupplierLineBuyTotal : supplierLineBuyTotal);
  return [
    calculatedSupplierInvoice,
    calculatedSupplierInvoice + supplierExtraBuyTotal,
    calculatedSupplierInvoice + uninvoicedSupplierExtraBuyTotal,
    supplierLineBuyTotal,
    uninvoicedSupplierLineBuyTotal,
    supplierExtraBuyTotal,
    uninvoicedSupplierExtraBuyTotal,
    supplierLineBuyTotal + supplierExtraBuyTotal,
    uninvoicedSupplierLineBuyTotal + uninvoicedSupplierExtraBuyTotal,
    supplierInvoiceTotal,
    numericValue(stem.Payable_Balance__c),
    numericValue(stem.Total_Costs__c),
    numericValue(stem.Total_Cost__c),
    numericValue(stem.Total_Cost_Amount__c),
    ...activeLineItems.map((item) => lineBuyAmount(item, stemHasDelivery)),
    ...activeExtraCosts.map((item) => extraBuyAmount(item, stemHasDelivery)),
  ].filter((value) => value != null && Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0);
}

function incomingPaymentTypeFromContext(payment, { amount, stem, supplierInvoice, supplierInvoiceFields, directionFields, typeFields, statusFields }) {
  const supplierSide = supplierInvoice || incomingPaymentLooksSupplierSide(payment, {
    supplierInvoiceFields,
    directionFields,
    typeFields,
    statusFields,
  });
  if (supplierSide) return amount != null && amount < 0 ? 'Supplier Refund' : 'Supplier Payment';
  if (stem && (amount == null || amount >= 0)) return 'Buyer Payment';
  return 'Unmatched';
}

function amountNearlyEqual(left, right, tolerance = 0.05) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(Math.abs(a) - Math.abs(b)) <= tolerance;
}

function paymentSearchToken(payment, fields = []) {
  return normalizedFieldToken(uniqueTextList([...fields, 'Name'])
    .filter((field) => payment?.[field] != null && payment[field] !== '')
    .map((field) => payment[field])
    .join(' '));
}

function addBrokerCommissionGroup(groupsByStem, group) {
  if (!group?.stemId || !group.brokerType || !group.amount) return;
  const key = [
    group.stemId,
    group.brokerType,
    group.brokerId || group.brokerName || 'unknown',
  ].join('::');
  if (!groupsByStem[group.stemId]) groupsByStem[group.stemId] = [];
  const existing = groupsByStem[group.stemId].find((item) => item.key === key);
  if (existing) {
    existing.amount += Number(group.amount || 0);
    return;
  }
  groupsByStem[group.stemId].push({
    key,
    stemId: group.stemId,
    brokerId: group.brokerId || null,
    brokerName: group.brokerName || group.brokerId || group.brokerType,
    brokerType: group.brokerType,
    side: group.side,
    amount: Number(group.amount || 0),
  });
}

function buildBrokerCommissionGroups({ stemMap = {}, lineItems = [], buyerBrokers = [], accountMap = {} } = {}) {
  const groupsByStem = {};
  const buyerBrokersByStem = {};
  for (const broker of buyerBrokers) {
    if (!broker.STEM__c) continue;
    if (!buyerBrokersByStem[broker.STEM__c]) buyerBrokersByStem[broker.STEM__c] = [];
    buyerBrokersByStem[broker.STEM__c].push(broker);
  }

  for (const item of lineItems) {
    if (!item.STEM__c || item.Cancelled__c) continue;
    const stem = stemMap[item.STEM__c];
    if (!stem) continue;
    const qty = financialQuantity(item, !!stem.Delivery_Date__c);
    const supplierAmount = brokerAmount(item.Suppliers_Brokers_Commission_Per_Unit__c, qty);
    if (item.Supplier_Broker__c && supplierAmount !== 0) {
      addBrokerCommissionGroup(groupsByStem, {
        stemId: item.STEM__c,
        brokerId: item.Supplier_Broker__c,
        brokerName: accountMap[item.Supplier_Broker__c] || accountMap[String(item.Supplier_Broker__c).slice(0, 15)] || item.Supplier_Broker__c,
        brokerType: 'Supplier Broker',
        side: 'supplier',
        amount: supplierAmount,
      });
    }

    const buyerBrokerId = item.Buyers_Broker__c || item.Buyer_Broker__c;
    const hasSupplierBrokerUnit = Number(item.Suppliers_Brokers_Commission_Per_Unit__c || 0) !== 0;
    const buyerPerUnitAmount = brokerAmount(item.Buyers_Brokers_Commission_Per_Unit__c, qty);
    const buyerLumpsumAmount = Number(item.Buyers_Brokers_Commission_Lumpsum__c || 0);
    const buyerAmount = buyerLumpsumAmount || buyerPerUnitAmount;
    if (buyerBrokerId && buyerAmount !== 0) {
      addBrokerCommissionGroup(groupsByStem, {
        stemId: item.STEM__c,
        brokerId: buyerBrokerId,
        brokerName: accountMap[buyerBrokerId] || accountMap[String(buyerBrokerId).slice(0, 15)] || buyerBrokerId,
        brokerType: 'Buyer Broker',
        side: 'buyer',
        amount: buyerAmount,
      });
    }

    const secondaryAmount = !hasSupplierBrokerUnit && item.Commission_Cost__c != null
      ? Number(item.Commission_Cost__c || 0) - buyerPerUnitAmount
      : 0;
    const secondaryBrokers = (buyerBrokersByStem[item.STEM__c] || []).filter((broker) => {
      if (!broker.Buyer_Broker__c) return true;
      if (!buyerBrokerId) return true;
      return String(broker.Buyer_Broker__c).slice(0, 15) !== String(buyerBrokerId).slice(0, 15);
    });
    if (secondaryAmount > 0 && secondaryBrokers.length > 0) {
      for (const broker of secondaryBrokers) {
        addBrokerCommissionGroup(groupsByStem, {
          stemId: item.STEM__c,
          brokerId: broker.Buyer_Broker__c || null,
          brokerName: accountMap[broker.Buyer_Broker__c] || accountMap[String(broker.Buyer_Broker__c || '').slice(0, 15)] || broker.Buyer_Broker__c || 'Secondary Buyer Broker',
          brokerType: 'Secondary Buyer Broker',
          side: 'buyer',
          amount: secondaryAmount,
        });
      }
    }
  }
  return groupsByStem;
}

function findBrokerCommissionPaymentMatch(payment, amount, groups = [], textFields = []) {
  if (!groups.length || amount == null) return null;
  const amountMatches = groups.filter((group) => amountNearlyEqual(amount, group.amount));
  if (!amountMatches.length) return null;
  if (amountMatches.length === 1) return amountMatches[0];
  const token = paymentSearchToken(payment, textFields);
  if (token) {
    const textMatch = amountMatches.find((group) => normalizedFieldToken(group.brokerName) && token.includes(normalizedFieldToken(group.brokerName)));
    if (textMatch) return textMatch;
  }
  return amountMatches[0];
}

function incomingPaymentReference(payment, referenceFields = []) {
  const value = referenceFields
    .map((field) => payment[field])
    .find((item) => item != null && item !== '');
  return value == null ? null : String(value).trim() || null;
}

function generatedPaymentName(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  return /^pay(?:ment)?[-_\s]?\d+$/i.test(text)
    || /^p[-_\s]?\d+$/i.test(text)
    || /^[a-z]{0,4}\d{5,}$/i.test(text)
    || /^[a-z0-9]{15,18}$/i.test(text);
}

function incomingPaymentDisplayName({ payment, referenceFields = [], stem, supplierInvoice, type }) {
  const reference = incomingPaymentReference(payment, referenceFields);
  if (reference) return reference;

  const rawName = String(payment?.Name || '').trim();
  if (rawName && !generatedPaymentName(rawName)) return rawName;

  if (supplierInvoice?.Name) {
    return `${type === 'Supplier Refund' ? 'Supplier refund' : 'Supplier payment'} - ${supplierInvoice.Name}`;
  }
  if (stem) {
    return `${type === 'Buyer Payment' ? 'Buyer payment' : 'Payment'} - ${formatStemName(stem)}`;
  }
  return rawName || payment?.Id || 'Payment';
}

function incomingPaymentBuyerGroup(stem) {
  const account = stem?.['Account__r'] || {};
  return account.Group_Name__c || account.Parent?.Name || stem?.Buyer_Name__c || account.Name || stem?.Buyer__c || null;
}

function incomingPaymentBuyerName(stem) {
  const account = stem?.['Account__r'] || {};
  return stem?.Buyer_Name__c || account.Name || stem?.Buyer__c || null;
}

function incomingPaymentStatus({ type, amount, stem, supplierInvoice, threshold }) {
  if (!stem && !supplierInvoice) return { label: 'Needs review', tone: 'amber' };
  if (type === 'Bank Charge') return { label: 'Bank charge', tone: 'amber' };
  if (type === 'Supplier Refund') return { label: 'Supplier refund', tone: 'green' };
  if (type === 'Supplier Payment') return { label: 'Supplier payment', tone: 'slate' };
  const receivable = incomingPaymentNumber(stem?.Receivable_Balance__c);
  if (receivable != null && receivable < 0) return { label: 'Overpaid / available balance', tone: 'purple' };
  if (receivable != null && Math.abs(receivable) <= threshold) return { label: 'Fully paid', tone: 'green' };
  if (amount == null) return { label: 'Amount missing', tone: 'amber' };
  return { label: 'Partially paid', tone: 'blue' };
}

function incomingPaymentBankChargeTarget(charge, rows = []) {
  if (!charge?.stemId || charge.type !== 'Buyer Payment') return null;
  const chargeAmount = Math.abs(Number(charge.amount || 0));
  if (!Number.isFinite(chargeAmount) || chargeAmount <= 0 || chargeAmount > 1000) return null;
  const chargeDate = dateOnly(charge.paymentDate);
  const chargeCreatedDate = dateOnly(charge.createdDate);
  const candidates = rows
    .filter((row) => {
      if (!row || row.id === charge.id || row.paymentId === charge.paymentId) return false;
      if (row.type !== 'Buyer Payment' || row.stemId !== charge.stemId) return false;
      if (charge.currency && row.currency && charge.currency !== row.currency) return false;
      const targetAmount = Math.abs(Number(row.amount || 0));
      if (!Number.isFinite(targetAmount) || targetAmount <= chargeAmount) return false;
      if (targetAmount < chargeAmount * 10) return false;
      const targetDate = dateOnly(row.paymentDate);
      const targetCreatedDate = dateOnly(row.createdDate);
      return (chargeDate && targetDate && chargeDate === targetDate)
        || (chargeCreatedDate && targetCreatedDate && chargeCreatedDate === targetCreatedDate);
    })
    .sort((a, b) => Math.abs(Number(b.amount || 0)) - Math.abs(Number(a.amount || 0)));
  return candidates[0] || null;
}

function attachBankChargeToPayment(target, charge) {
  if (!target || !charge) return;
  if (!Array.isArray(target.bankCharges)) target.bankCharges = [];
  target.bankCharges.push({
    id: charge.id,
    paymentId: charge.paymentId,
    paymentDate: charge.paymentDate,
    amount: Math.abs(Number(charge.amount || 0)),
    currency: charge.currency,
    reference: charge.reference,
    paymentName: charge.paymentDisplayName || charge.paymentName || charge.salesforcePaymentName || charge.paymentId,
  });
  target.bankChargeTotal = (target.bankChargeTotal || 0) + Math.abs(Number(charge.amount || 0));
}

function incomingPaymentRecordTypeToken(payment) {
  return normalizedFieldToken([
    payment?.RecordTypeId,
    payment?.RecordType?.DeveloperName,
    payment?.RecordType?.Name,
  ].filter(Boolean).join(' '));
}

function incomingPaymentIsRemittanceRecord(payment, fields = []) {
  const token = incomingPaymentRecordTypeToken(payment);
  if (token.includes('remittance')) return true;
  return uniqueTextList(fields).some((field) => {
    const valueToken = normalizedFieldToken(payment?.[field]);
    return valueToken.includes('receivableremittance')
      || valueToken.includes('remittancereceivable')
      || valueToken.includes('payableremittance')
      || valueToken.includes('remittancepayable');
  });
}

const incomingPaymentIsReceivableRemittance = incomingPaymentIsRemittanceRecord;

function supplierInvoicePartyName(invoice, supplierRelationships = []) {
  return invoice?.Supplier_Name__c
    || invoice?.['Supplier__r']?.Name
    || invoice?.['Expected_Supplier__r']?.Name
    || invoice?.['Substitute_Supplier__r']?.Name
    || supplierRelationships.map((relationship) => invoice?.[relationship]?.Name).find(Boolean)
    || null;
}

async function incomingBuyerCiaInvoices({ threshold = 50, accessContext = null } = {}) {
  const describe = await salesforceObjectFields({ objectName: 'stem__c' }).catch(() => ({ fields: [] }));
  const fields = describe.fields || [];
  const fieldNames = new Set(fields.map((field) => field.name));
  if (!fieldNames.has('Payment_Term__c')) return [];

  const accountDescribe = fieldNames.has('Account__c')
    ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({ fields: [] }))
    : { fields: [] };
  const accountFieldNames = new Set((accountDescribe.fields || []).map((field) => field.name));
  const interofficeCondition = await interofficeStemAccessCondition(accessContext, fieldNames, accountFieldNames);
  const selectFields = [
    'Id',
    'Name',
    ...selectedFields(fieldNames, [
      'KeyStem__c',
      'Buyer_Name__c',
      'Buyer__c',
      'Account__c',
      'Payment_Term__c',
      'Total_Invoice_Amount__c',
      'Receivable_Balance__c',
      'Payment_Date__c',
      'Delivery_Date__c',
      'Expected_Delivery_Date__c',
    ]),
  ];
  if (fieldNames.has('Vessel__c')) selectFields.push('Vessel__r.Name');
  if (fieldNames.has('Port__c')) selectFields.push('Port__r.Name');
  if (fieldNames.has('Account__c')) {
    selectFields.push('Account__r.Name');
    if (accountFieldNames.has('Group_Name__c')) selectFields.push('Account__r.Group_Name__c');
    if (accountFieldNames.has('ParentId')) selectFields.push('Account__r.Parent.Name');
  }

  const whereParts = ["Payment_Term__c LIKE '%CIA%'"];
  if (fieldNames.has('Receivable_Balance__c')) whereParts.push(`Receivable_Balance__c >= ${Number(threshold || 0)}`);
  if (fieldNames.has('Payment_Date__c')) whereParts.push('Payment_Date__c = null');
  if (fieldNames.has('Delivery_Date__c')) whereParts.push('(Delivery_Date__c = null OR Delivery_Date__c >= 2026-01-01)');
  if (interofficeCondition) whereParts.push(interofficeCondition);
  const orderBy = fieldNames.has('Delivery_Date__c')
    ? 'Delivery_Date__c DESC NULLS LAST, CreatedDate DESC'
    : 'CreatedDate DESC';

  const stems = await queryRows(`
    SELECT ${[...new Set(selectFields)].join(', ')}
    FROM stem__c
    WHERE ${whereParts.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT 1000
  `, { limit: 1000, softFail: true });
  const stemIds = stems.map((stem) => stem.Id).filter(Boolean);
  if (!stemIds.length) return [];

  const traderByStem = {};
  const [nominationArrays, lineItemArrays, extraCostArrays] = await Promise.all([
    Promise.all(chunkIds(stemIds).map((chunk) => {
      const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
      return queryRows(`
        SELECT Id, Name, STEM__c, Buyer_Supplier_Trader__c
        FROM Nomination__c
        WHERE STEM__c IN (${inList}) AND Buyer_Supplier_Trader__c != null
        ORDER BY CreatedDate ASC
        LIMIT 5000
      `, { limit: 5000, softFail: true });
    })),
    Promise.all(chunkIds(stemIds).map((chunk) => {
      const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
      return queryRows(`
        SELECT STEM__c, Total_Price__c, Cancelled__c, Quantity__c, Quantity_Delivered_Per_BDN__c,
               Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c,
               Price_Per_Unit__c, Unit_Sell_At__c, Offer_Line_Item__r.UnitPrice
        FROM STEM_Line_Item__c
        WHERE STEM__c IN (${inList})
        LIMIT 5000
      `, { limit: 5000, softFail: true });
    })),
    Promise.all(chunkIds(stemIds).map((chunk) => {
      const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
      return queryRows(`
        SELECT STEM__c, Line_Total__c, Cancelled__c, Quantity__c, Quantity_Delivered_Per_BDN__c,
               Quantity_in_MT__c, Quantity_Range_Max__c, Is_Quantity_Range__c, Unit_Price__c
        FROM STEM_Extra_Cost__c
        WHERE STEM__c IN (${inList})
        LIMIT 5000
      `, { limit: 5000, softFail: true });
    })),
  ]);

  for (const nomination of nominationArrays.flat()) {
    if (!nomination.STEM__c || !nomination.Buyer_Supplier_Trader__c) continue;
    if (!traderByStem[nomination.STEM__c]) traderByStem[nomination.STEM__c] = { buyer: [], all: [] };
    if (!traderByStem[nomination.STEM__c].all.includes(nomination.Buyer_Supplier_Trader__c)) {
      traderByStem[nomination.STEM__c].all.push(nomination.Buyer_Supplier_Trader__c);
    }
    if (String(nomination.Name || '').startsWith('Confirmation to ') && !traderByStem[nomination.STEM__c].buyer.includes(nomination.Buyer_Supplier_Trader__c)) {
      traderByStem[nomination.STEM__c].buyer.push(nomination.Buyer_Supplier_Trader__c);
    }
  }

  const calculatedByStem = {};
  for (const item of lineItemArrays.flat()) {
    if (!item.STEM__c || item.Cancelled__c) continue;
    const stem = stems.find((row) => row.Id === item.STEM__c);
    calculatedByStem[item.STEM__c] = (calculatedByStem[item.STEM__c] || 0) + lineSellAmount(item, !!stem?.Delivery_Date__c);
  }
  for (const item of extraCostArrays.flat()) {
    if (!item.STEM__c || item.Cancelled__c) continue;
    const stem = stems.find((row) => row.Id === item.STEM__c);
    calculatedByStem[item.STEM__c] = (calculatedByStem[item.STEM__c] || 0) + extraSellAmount(item, !!stem?.Delivery_Date__c);
  }

  return stems.map((stem) => {
    const account = stem['Account__r'] || {};
    const traderInfo = traderByStem[stem.Id] || {};
    const calculatedAmount = calculatedByStem[stem.Id] > 0
      ? calculatedByStem[stem.Id]
      : incomingPaymentNumber(stem.Total_Invoice_Amount__c);
    return {
      id: stem.Id,
      stemId: stem.Id,
      stemName: formatStemName(stem),
      keyStem: stem.KeyStem__c || null,
      buyerName: incomingPaymentBuyerName(stem),
      buyerGroupName: account.Group_Name__c || account.Parent?.Name || incomingPaymentBuyerName(stem),
      buyerTrader: (traderInfo.buyer?.length ? traderInfo.buyer : traderInfo.all || []).join(', ') || null,
      paymentTerms: stem.Payment_Term__c || null,
      calculatedAmount,
      receivableBalance: incomingPaymentNumber(stem.Receivable_Balance__c),
      deliveryDate: stem.Delivery_Date__c || null,
    };
  });
}

async function incomingPaymentsList(body, req = null, accessContext = null) {
  const settings = await loadIncomingPaymentSettings();
  const threshold = Number(settings.fullyPaidThreshold ?? DEFAULT_INCOMING_PAYMENT_SETTINGS.fullyPaidThreshold);
  const today = dateOnly(new Date());
  const dateFrom = dateOnly(body.dateFrom || body.date_from || today);
  const dateTo = dateOnly(body.dateTo || body.date_to || today);
  const limit = Math.max(100, Math.min(Number(body.limit) || 5000, 10000));

  const paymentDescribe = await salesforceObjectFields({ objectName: 'Payment__c' }).catch(() => ({ fields: [] }));
  const paymentFields = paymentDescribe.fields || [];
  const paymentFieldNames = new Set(paymentFields.map((field) => field.name));
  const paymentFieldByName = Object.fromEntries(paymentFields.map((field) => [field.name, field]));
  if (!paymentFieldNames.size) return { rows: [], availableBalances: [], summary: {}, settings, schemaWarnings: ['Payment__c is not queryable.'] };

  const dateField = firstAvailableField(paymentFieldNames, ['Date__c', 'Payment_Date__c', 'Received_Date__c', 'Paid_Date__c', 'CreatedDate']);
  const amountField = firstAvailableField(paymentFieldNames, [
    'Amount__c',
    'Payment_Amount__c',
    'Paid_Amount__c',
    'Received_Amount__c',
    'Total_Amount__c',
    'Amount_Paid__c',
    'Payment_Value__c',
    'Actual_Amount__c',
  ]);
  const referenceFields = incomingPaymentReferenceFields(paymentFields);
  const statusFields = selectedFields(paymentFieldNames, ['Status__c', 'Payment_Status__c']);
  const typeFields = selectedFields(paymentFieldNames, ['Type__c', 'Payment_Type__c']);
  const supplierInvoiceLookupFields = incomingPaymentSupplierInvoiceFields(paymentFields);
  const directionFields = incomingPaymentDirectionFields(paymentFields);
  const paymentSelectFields = [
    'Id',
    ...selectedFields(paymentFieldNames, ['Name', 'RecordTypeId', 'CreatedDate', 'LastModifiedDate', 'STEM__c', 'CurrencyIsoCode', 'Currency__c']),
    paymentFieldNames.has('RecordTypeId') ? 'RecordType.Name' : null,
    paymentFieldNames.has('RecordTypeId') ? 'RecordType.DeveloperName' : null,
    ...supplierInvoiceLookupFields,
    dateField,
    amountField,
    ...referenceFields,
    ...statusFields,
    ...typeFields,
    ...directionFields,
  ].filter(Boolean);

  const filterDateField = paymentFieldNames.has('CreatedDate') ? 'CreatedDate' : dateField;
  const filterDateType = paymentFieldByName[filterDateField]?.type || null;
  const filterDateValue = (isoDate, endOfDay = false) => (
    filterDateField === 'CreatedDate'
      ? soqlHongKongDateTimeValue(isoDate, endOfDay)
      : soqlDateValue(filterDateField, filterDateType, isoDate, endOfDay)
  );
  const whereParts = [];
  if (filterDateField && dateFrom) whereParts.push(`${filterDateField} >= ${filterDateValue(dateFrom, false)}`);
  if (filterDateField && dateTo) whereParts.push(`${filterDateField} <= ${filterDateValue(dateTo, true)}`);
  const orderBy = filterDateField ? `${filterDateField} DESC NULLS LAST${filterDateField !== 'CreatedDate' ? ', CreatedDate DESC' : ''}` : 'CreatedDate DESC';
  const payments = await queryRows(`
    SELECT ${[...new Set(paymentSelectFields)].join(', ')}
    FROM Payment__c
    ${whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''}
    ORDER BY ${orderBy}
    LIMIT ${limit}
  `, { limit, softFail: true });

  const eligiblePayments = payments.filter((payment) => !incomingPaymentIsReceivableRemittance(payment, [...referenceFields, ...directionFields, ...typeFields, ...statusFields]));
  const directStemIds = eligiblePayments.map((payment) => payment.STEM__c).filter(Boolean);
  const supplierInvoiceIds = eligiblePayments
    .map((payment) => incomingPaymentSupplierInvoiceId(payment, supplierInvoiceLookupFields))
    .filter(Boolean);
  const supplierInvoiceDescribe = supplierInvoiceIds.length
    ? await salesforceObjectFields({ objectName: 'Supplier_Invoice__c' }).catch(() => ({ fields: [] }))
    : { fields: [] };
  const supplierInvoiceFields = supplierInvoiceDescribe.fields || [];
  const supplierInvoiceFieldNames = new Set(supplierInvoiceFields.map((field) => field.name));
  const supplierInvoiceFieldByName = Object.fromEntries(supplierInvoiceFields.map((field) => [field.name, field]));
  const supplierInvoicePayableField = firstAvailableField(supplierInvoiceFieldNames, ['Payable_Balance__c', 'Balance__c', 'Actual_Balance__c', 'Outstanding_Balance__c']);
  const supplierInvoiceAmountField = firstAvailableField(supplierInvoiceFieldNames, ['Invoice_Amount__c', 'Calculated_Amount__c', 'Amount__c', 'Total_Amount__c']);
  const supplierInvoiceSupplierFields = selectedFields(supplierInvoiceFieldNames, ['Supplier__c', 'Expected_Supplier__c', 'Substitute_Supplier__c']);
  const supplierInvoiceSupplierRelationships = supplierInvoiceSupplierFields
    .map((field) => supplierInvoiceFieldByName[field]?.relationshipName)
    .filter(Boolean);
  const supplierInvoiceMap = {};
  if (supplierInvoiceIds.length && supplierInvoiceFieldNames.size) {
    const supplierInvoiceSelectFields = [
      'Id',
      'Name',
      ...selectedFields(supplierInvoiceFieldNames, ['STEM__c', 'Supplier_Name__c']),
      supplierInvoiceAmountField,
      supplierInvoicePayableField,
      ...supplierInvoiceSupplierFields,
      ...supplierInvoiceSupplierRelationships.map((relationship) => `${relationship}.Name`),
    ].filter(Boolean);
    const invoiceChunks = await Promise.all(chunkIds([...new Set(supplierInvoiceIds)]).map((chunk) => {
      const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
      return queryRows(`
        SELECT ${[...new Set(supplierInvoiceSelectFields)].join(', ')}
        FROM Supplier_Invoice__c
        WHERE Id IN (${inList})
        LIMIT 5000
      `, { limit: 5000, softFail: true });
    }));
    for (const invoice of invoiceChunks.flat()) supplierInvoiceMap[invoice.Id] = invoice;
  }

  const stemIds = [...new Set([
    ...directStemIds,
    ...Object.values(supplierInvoiceMap).map((invoice) => invoice.STEM__c).filter(Boolean),
  ])];
  const stemDescribe = stemIds.length
    ? await salesforceObjectFields({ objectName: 'stem__c' }).catch(() => ({ fields: [] }))
    : { fields: [] };
  const stemFields = stemDescribe.fields || [];
  const stemFieldNames = new Set(stemFields.map((field) => field.name));
  const accountDescribe = stemFieldNames.has('Account__c')
    ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({ fields: [] }))
    : { fields: [] };
  const accountFieldNames = new Set((accountDescribe.fields || []).map((field) => field.name));
  const interofficeCondition = await interofficeStemAccessCondition(accessContext, stemFieldNames, accountFieldNames);
  const stemSelectFields = [
    'Id',
    'Name',
    ...selectedFields(stemFieldNames, [
      'KeyStem__c',
      'Buyer_Name__c',
      'Buyer__c',
      'Account__c',
      'Total_Invoice_Amount__c',
      'Total_Invoiced_Amount_From_Suppliers__c',
      'Receivable_Balance__c',
      'Payable_Balance__c',
      'Total_Costs__c',
      'Total_Cost__c',
      'Total_Cost_Amount__c',
      'Payment_Date__c',
      'Payment_Term__c',
      'Invoice_Due_Date__c',
      'Buyer_Pay_Term_Date__c',
      'Due_Date__c',
      'Delivery_Date__c',
      'Delivery_Date_Or_Expected__c',
      'Expected_Delivery_Date__c',
    ]),
  ];
  if (stemFieldNames.has('Vessel__c')) stemSelectFields.push('Vessel__r.Name');
  if (stemFieldNames.has('Port__c')) stemSelectFields.push('Port__r.Name');
  if (stemFieldNames.has('Account__c')) {
    stemSelectFields.push('Account__r.Name');
    if (accountFieldNames.has('Group_Name__c')) stemSelectFields.push('Account__r.Group_Name__c');
    if (accountFieldNames.has('ParentId')) stemSelectFields.push('Account__r.Parent.Name');
  }
  const stemMap = {};
  if (stemIds.length && stemFieldNames.size) {
    const stemChunks = await Promise.all(chunkIds(stemIds).map((chunk) => {
      const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
      const stemWhere = combineWhereConditions([`Id IN (${inList})`, interofficeCondition]);
      return queryRows(`
        SELECT ${[...new Set(stemSelectFields)].join(', ')}
        FROM stem__c
        WHERE ${stemWhere}
        LIMIT 5000
      `, { limit: 5000, softFail: true });
    }));
    for (const stem of stemChunks.flat()) stemMap[stem.Id] = stem;
  }
  let brokerCommissionGroupsByStem = {};
  let lineItemsByStem = {};
  let extraCostsByStem = {};
  if (stemIds.length) {
    const [lineItemChunks, buyerBrokerChunks, extraCostChunks] = await Promise.all([
      Promise.all(chunkIds(stemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        return queryRows(`
          SELECT Id, STEM__c, Cancelled__c, Quantity__c, Quantity_Delivered_Per_BDN__c,
                 Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c,
                 Cost_Per_Unit__c, Unit_Buy_At__c, Unit_Cost__c, Total_Cost__c,
                 Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c,
                 Buyers_Broker__c, Buyer_Broker__c, Buyers_Brokers_Commission_Per_Unit__c,
                 Buyers_Brokers_Commission_Lumpsum__c, Commission_Cost__c, Supplier_Invoice__c,
                 Offer_Line_Item__r.Supplier_Unit_Price__c
          FROM STEM_Line_Item__c
          WHERE STEM__c IN (${inList})
          LIMIT 5000
        `, { limit: 5000, softFail: true });
      })),
      Promise.all(chunkIds(stemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        return queryRows(`
          SELECT Id, STEM__c, Buyer_Broker__c
          FROM STEM_Buyer_Broker__c
          WHERE STEM__c IN (${inList})
          LIMIT 5000
        `, { limit: 5000, softFail: true });
      })),
      Promise.all(chunkIds(stemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        return queryRows(`
          SELECT Id, STEM__c, Cancelled__c, Quantity__c, Quantity_Delivered_Per_BDN__c,
                 Quantity_in_MT__c, Quantity_Range_Max__c, Is_Quantity_Range__c,
                 Unit_Cost__c, Line_Total_Buy__c, Supplier_Invoice__c
          FROM STEM_Extra_Cost__c
          WHERE STEM__c IN (${inList})
          LIMIT 5000
        `, { limit: 5000, softFail: true });
      })),
    ]);
    const brokerLineItems = lineItemChunks.flat();
    const brokerRows = buyerBrokerChunks.flat();
    const extraCostRows = extraCostChunks.flat();
    lineItemsByStem = brokerLineItems.reduce((acc, item) => {
      if (!item.STEM__c) return acc;
      if (!acc[item.STEM__c]) acc[item.STEM__c] = [];
      acc[item.STEM__c].push(item);
      return acc;
    }, {});
    extraCostsByStem = extraCostRows.reduce((acc, item) => {
      if (!item.STEM__c) return acc;
      if (!acc[item.STEM__c]) acc[item.STEM__c] = [];
      acc[item.STEM__c].push(item);
      return acc;
    }, {});
    const brokerAccountIds = [...new Set([
      ...brokerLineItems.map((item) => item.Supplier_Broker__c).filter(Boolean),
      ...brokerLineItems.map((item) => item.Buyers_Broker__c || item.Buyer_Broker__c).filter(Boolean),
      ...brokerRows.map((item) => item.Buyer_Broker__c).filter(Boolean),
    ])];
    const accountMap = await namesByIds('Account', brokerAccountIds);
    for (const [id, name] of Object.entries(accountMap)) accountMap[String(id).slice(0, 15)] = name;
    brokerCommissionGroupsByStem = buildBrokerCommissionGroups({
      stemMap,
      lineItems: brokerLineItems,
      buyerBrokers: brokerRows,
      accountMap,
    });
  }

  const availableStemKeys = new Set();
  const availableBalancesByGroup = {};
  const allRows = eligiblePayments.map((payment) => {
    const supplierInvoiceId = incomingPaymentSupplierInvoiceId(payment, supplierInvoiceLookupFields);
    const supplierInvoice = supplierInvoiceId ? supplierInvoiceMap[supplierInvoiceId] || null : null;
    const stemId = payment.STEM__c || supplierInvoice?.STEM__c || null;
    const stem = stemId ? stemMap[stemId] || null : null;
    if (stemId && !stem) return null;
    const amount = amountField ? incomingPaymentNumber(payment[amountField]) : null;
    const brokerCommissionMatch = stem?.Id
      ? findBrokerCommissionPaymentMatch(payment, amount, brokerCommissionGroupsByStem[stem.Id] || [], [...referenceFields, ...directionFields, ...typeFields, ...statusFields])
      : null;
    const bankCharge = incomingPaymentLooksBankCharge(payment, {
      referenceFields,
      directionFields,
      typeFields,
      statusFields,
    });
    const payableCalculation = stem?.Id
      ? incomingPaymentLooksStemPayableCalculation(payment, {
        amount,
        payableAmounts: stemPayableAmountCandidates({
          stem,
          lineItems: lineItemsByStem[stem.Id] || [],
          extraCosts: extraCostsByStem[stem.Id] || [],
        }),
        referenceFields,
        directionFields,
        typeFields,
        statusFields,
        allowBlankSignal: !stem.Delivery_Date__c,
      })
      : false;
    const type = brokerCommissionMatch
      ? 'Broker Commission'
      : bankCharge
      ? 'Bank Charge'
      : payableCalculation
      ? 'Supplier Payment'
      : incomingPaymentTypeFromContext(payment, {
        amount,
        stem,
        supplierInvoice,
        supplierInvoiceFields: supplierInvoiceLookupFields,
        directionFields,
        typeFields,
        statusFields,
      });
    let incomingAmount = amount;
    if (type.startsWith('Supplier')) {
      incomingAmount = type === 'Supplier Refund' && amount != null ? Math.abs(amount) : amount;
    }
    const paymentDate = dateField ? payment[dateField] || null : payment.CreatedDate || null;
    const buyerInvoiceDueDate = type === 'Buyer Payment' && stem
      ? calculatedBuyerPayTermDate(stem)
        || stem.Invoice_Due_Date__c
        || stem.Due_Date__c
        || stem.Buyer_Pay_Term_Date__c
        || null
      : null;
    const delayDays = type === 'Buyer Payment' && buyerInvoiceDueDate && paymentDate
      ? daysBetween(buyerInvoiceDueDate, dateOnly(paymentDate))
      : null;
    const status = incomingPaymentStatus({ type, amount, stem, supplierInvoice, threshold });
    const receivable = incomingPaymentNumber(stem?.Receivable_Balance__c);
    const buyerName = incomingPaymentBuyerName(stem);
    const buyerGroupName = incomingPaymentBuyerGroup(stem);
    const partyName = type.startsWith('Supplier')
      ? supplierInvoicePartyName(supplierInvoice, supplierInvoiceSupplierRelationships)
      : buyerName;
    if (stem?.Id && receivable != null && receivable < 0) {
      const key = stem.Id;
      if (!availableStemKeys.has(key)) {
        availableStemKeys.add(key);
        const groupKey = buyerGroupName || buyerName || 'Ungrouped buyer';
        if (!availableBalancesByGroup[groupKey]) {
          availableBalancesByGroup[groupKey] = {
            buyerGroupName: groupKey,
            buyerNames: new Set(),
            totalAvailableBalance: 0,
            stems: [],
          };
        }
        if (buyerName) availableBalancesByGroup[groupKey].buyerNames.add(buyerName);
        availableBalancesByGroup[groupKey].totalAvailableBalance += Math.abs(receivable);
        availableBalancesByGroup[groupKey].stems.push({
          stemId: stem.Id,
          stemName: formatStemName(stem),
          buyerName,
          availableBalance: Math.abs(receivable),
          receivableBalance: receivable,
          paymentDate: stem.Payment_Date__c || payment[dateField] || payment.CreatedDate || null,
        });
      }
    }
    return {
      id: payment.Id,
      paymentId: payment.Id,
      paymentName: incomingPaymentDisplayName({ payment, referenceFields, stem, supplierInvoice, type }),
      paymentDisplayName: incomingPaymentDisplayName({ payment, referenceFields, stem, supplierInvoice, type }),
      salesforcePaymentName: payment.Name || null,
      paymentRecordTypeName: payment.RecordType?.Name || null,
      paymentRecordTypeDeveloperName: payment.RecordType?.DeveloperName || null,
      paymentDate,
      createdDate: payment.CreatedDate || null,
      invoiceDueDate: buyerInvoiceDueDate,
      delayDays,
      paymentTerms: type === 'Buyer Payment' ? stem?.Payment_Term__c || null : null,
      type,
      isIncoming: type === 'Buyer Payment' || type === 'Supplier Refund',
      isBankCharge: type === 'Bank Charge',
      amount,
      incomingAmount,
      currency: payment.CurrencyIsoCode || payment.Currency__c || 'USD',
      reference: incomingPaymentReference(payment, referenceFields),
      salesforceStatus: statusFields.map((field) => payment[field]).find(Boolean) || null,
      salesforceType: typeFields.map((field) => payment[field]).find(Boolean) || null,
      stemId,
      stemName: stem ? formatStemName(stem) : null,
      keyStem: stem?.KeyStem__c || null,
      buyerName,
      buyerGroupName,
      supplierInvoiceId: supplierInvoice?.Id || supplierInvoiceId || null,
      supplierInvoiceName: supplierInvoice?.Name || null,
      supplierName: supplierInvoicePartyName(supplierInvoice, supplierInvoiceSupplierRelationships),
      partyName,
      invoiceAmount: incomingPaymentNumber(stem?.Total_Invoice_Amount__c),
      receivableBalance: receivable,
      payableBalance: supplierInvoicePayableField ? incomingPaymentNumber(supplierInvoice?.[supplierInvoicePayableField]) : incomingPaymentNumber(stem?.Payable_Balance__c),
      supplierInvoiceAmount: supplierInvoiceAmountField ? incomingPaymentNumber(supplierInvoice?.[supplierInvoiceAmountField]) : null,
      status: status.label,
      statusTone: status.tone,
      paymentObjectAmountField: amountField,
      paymentObjectSupplierInvoiceFields: supplierInvoiceLookupFields,
      brokerCommissionMatch,
    };
  }).filter(Boolean);
  const rows = allRows
    .filter((row) => row.type !== 'Supplier Payment' && row.type !== 'Bank Charge' && row.type !== 'Broker Commission')
    .map((row) => ({ ...row, bankCharges: [] }));
  const ungroupedBankCharges = [];
  for (const charge of allRows.filter((row) => row.type === 'Bank Charge')) {
    const chargeDate = dateOnly(charge.paymentDate);
    const candidates = rows
      .filter((row) => row.type === 'Buyer Payment' && row.stemId && row.stemId === charge.stemId)
      .sort((a, b) => {
        const aSameDate = dateOnly(a.paymentDate) === chargeDate ? 1 : 0;
        const bSameDate = dateOnly(b.paymentDate) === chargeDate ? 1 : 0;
        if (aSameDate !== bSameDate) return bSameDate - aSameDate;
        return Math.abs(Number(b.amount || 0)) - Math.abs(Number(a.amount || 0));
      });
    const target = candidates[0] || null;
    if (target) {
      attachBankChargeToPayment(target, charge);
    } else {
      ungroupedBankCharges.push(charge);
    }
  }
  const implicitBankChargeIds = new Set();
  for (const charge of rows) {
    const target = incomingPaymentBankChargeTarget(charge, rows);
    if (!target) continue;
    attachBankChargeToPayment(target, charge);
    implicitBankChargeIds.add(charge.id || charge.paymentId);
  }
  const displayRows = rows.filter((row) => !implicitBankChargeIds.has(row.id || row.paymentId));
  displayRows.push(...ungroupedBankCharges);

  const interestNotificationMap = await loadIncomingPaymentInterestNotificationMap(displayRows.map((row) => row.paymentId || row.id));
  const rowsWithInterestNotifications = displayRows.map((row) => {
    const notification = interestNotificationMap[row.paymentId || row.id] || null;
    return {
      ...row,
      interestInvoiceNotification: notification,
      interestInvoiceNotificationSent: notification?.deliveryStatus === 'sent',
      interestInvoiceNotificationPending: ['sending', 'uncertain'].includes(notification?.deliveryStatus),
    };
  });

  const includedIncomingRows = rowsWithInterestNotifications.filter((row) => row.isIncoming);
  const buyerCiaInvoices = await incomingBuyerCiaInvoices({ threshold, accessContext });
  const availableBalances = Object.values(availableBalancesByGroup)
    .map((group) => ({
      buyerGroupName: group.buyerGroupName,
      buyerNames: [...group.buyerNames].sort((a, b) => a.localeCompare(b)),
      totalAvailableBalance: group.totalAvailableBalance,
      stems: group.stems.sort((a, b) => String(b.paymentDate || '').localeCompare(String(a.paymentDate || ''))),
    }))
    .sort((a, b) => b.totalAvailableBalance - a.totalAvailableBalance);

  return {
    rows: rowsWithInterestNotifications,
    buyerCiaInvoices,
    availableBalances,
    settings,
    dateFrom,
    dateTo,
    schema: {
      paymentDateField: dateField,
      paymentFilterDateField: filterDateField,
      paymentAmountField: amountField,
      paymentReferenceFields: referenceFields,
      paymentSupplierInvoiceFields: supplierInvoiceLookupFields,
      supplierInvoicePayableField,
      supplierInvoiceAmountField,
    },
    schemaWarnings: [
      amountField ? null : 'No amount-like field was found on Payment__c.',
      dateField ? null : 'No date-like field was found on Payment__c.',
      'Supplier-invoice-linked negative payments are classified as supplier refunds. Confirm if Salesforce uses the opposite sign.',
    ].filter(Boolean),
    summary: {
      totalRows: rowsWithInterestNotifications.length,
      incomingRows: includedIncomingRows.length,
      totalIncomingAmount: includedIncomingRows.reduce((sum, row) => sum + Math.abs(Number(row.incomingAmount || 0)), 0),
      buyerPaymentTotal: rowsWithInterestNotifications.filter((row) => row.type === 'Buyer Payment').reduce((sum, row) => sum + Math.abs(Number(row.incomingAmount || 0)), 0),
      supplierRefundTotal: rowsWithInterestNotifications.filter((row) => row.type === 'Supplier Refund').reduce((sum, row) => sum + Math.abs(Number(row.incomingAmount || 0)), 0),
      unmatchedCount: rowsWithInterestNotifications.filter((row) => row.type === 'Unmatched' || row.status === 'Needs review').length,
      fullyPaidCount: rowsWithInterestNotifications.filter((row) => row.status === 'Fully paid').length,
      availableBalanceTotal: availableBalances.reduce((sum, group) => sum + Number(group.totalAvailableBalance || 0), 0),
      availableBalanceCount: availableBalances.reduce((sum, group) => sum + (group.stems?.length || 0), 0),
    },
  };
}

async function incomingPaymentAllocationConfirm(body, req) {
  await requireAdministrator(req);
  const buyerGroupName = String(body.buyerGroupName || body.buyer_group_name || '').trim();
  if (!buyerGroupName) throw appError('Buyer group is required.', 400);
  throw appError('Salesforce payment allocation write-back is not enabled yet. Confirm the Salesforce object and fields for applying available buyer balances to another STEM.', 501);
}

const INCOMING_PAYMENT_INTEREST_RECIPIENT = 'louisa@cosulich.com.hk';
const INCOMING_PAYMENT_INTEREST_NOTIFICATION_FIELDS = [
  'id',
  'payment_id',
  'payment_name',
  'stem_id',
  'stem_name',
  'buyer_name',
  'buyer_group_name',
  'received_date',
  'payment_created_date',
  'delay_days',
  'amount',
  'currency',
  'receivable_balance',
  'recipient_email',
  'email_subject',
  'email_message_id',
  'email_provider',
  'actor_user_id',
  'actor_email',
  'actor_name',
  'metadata',
  'delivery_status',
  'last_attempt_at',
  'last_error',
  'sent_at',
  'created_at',
  'updated_at',
].join(',');

function incomingPaymentDbNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
}

function incomingPaymentDbDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializeIncomingPaymentInterestNotification(row = null) {
  if (!row) return null;
  return {
    id: row.id,
    paymentId: row.payment_id,
    paymentName: row.payment_name,
    stemId: row.stem_id,
    stemName: row.stem_name,
    buyerName: row.buyer_name,
    buyerGroupName: row.buyer_group_name,
    receivedDate: row.received_date,
    paymentCreatedDate: row.payment_created_date,
    delayDays: row.delay_days,
    amount: incomingPaymentNumber(row.amount),
    currency: row.currency,
    receivableBalance: incomingPaymentNumber(row.receivable_balance),
    recipientEmail: row.recipient_email,
    emailSubject: row.email_subject,
    emailMessageId: row.email_message_id,
    emailProvider: row.email_provider,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    actorName: row.actor_name,
    metadata: row.metadata || {},
    deliveryStatus: row.delivery_status || 'sent',
    lastAttemptAt: row.last_attempt_at || null,
    lastError: row.last_error || null,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

function incomingPaymentInterestTableUnavailable(error) {
  return error?.code === '42P01' || /incoming_payment_interest_notifications/i.test(error?.message || '');
}

async function loadIncomingPaymentInterestNotificationMap(paymentIds = []) {
  const client = safeSupabaseAdminClient();
  if (!client) return {};
  const ids = [...new Set(paymentIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return {};
  const notifications = {};
  for (const chunk of chunkIds(ids, 500)) {
    const { data, error } = await client
      .from('incoming_payment_interest_notifications')
      .select(INCOMING_PAYMENT_INTEREST_NOTIFICATION_FIELDS)
      .in('payment_id', chunk);
    if (error) {
      if (!incomingPaymentInterestTableUnavailable(error)) {
        console.error('Failed to load incoming payment interest notifications', error.message);
      }
      return {};
    }
    for (const row of data || []) notifications[row.payment_id] = serializeIncomingPaymentInterestNotification(row);
  }
  return notifications;
}

async function fetchIncomingPaymentInterestNotification(client, paymentId) {
  const { data, error } = await client
    .from('incoming_payment_interest_notifications')
    .select(INCOMING_PAYMENT_INTEREST_NOTIFICATION_FIELDS)
    .eq('payment_id', paymentId)
    .maybeSingle();
  if (error) {
    if (incomingPaymentInterestTableUnavailable(error)) {
      throw appError('Missing Supabase table incoming_payment_interest_notifications. Run the latest Supabase migration before requesting late payment interest invoices.', 500);
    }
    throw error;
  }
  return serializeIncomingPaymentInterestNotification(data);
}

function incomingPaymentInterestRateField(accountFields = []) {
  const allowedTypes = new Set(['double', 'percent', 'currency', 'int', 'string', 'picklist']);
  const matches = accountFields
    .filter((field) => (
      field?.name &&
      allowedTypes.has(field.type) &&
      fieldMatchesAny(field, [
        'latepaymentinterestrate',
        'latepaymentinterestratec',
        'paymentinterestrate',
        'paymentinterestratec',
        'overdueinterestrate',
        'overdueinterestratec',
        'interestrate',
        'interestratec',
        'financechargerate',
        'financechargeratec',
      ], [
        'latepaymentinterest',
        'overdueinterest',
        'interestrate',
        'financecharge',
      ])
    ));
  return matches[0] || null;
}

function parseIncomingPaymentInterestRate(value) {
  if (value == null || value === '') return null;
  const match = String(value).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.abs(number) > 1 ? number / 100 : number;
}

function incomingPaymentInterestRateLabel(rateDecimal) {
  if (rateDecimal == null) return '-';
  return `${(Number(rateDecimal) * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% per month`;
}

function interestFormulaText(balance, rateDecimal, days) {
  return `${money(balance)} x ${incomingPaymentInterestRateLabel(rateDecimal)} x ${days} / 30`;
}

async function incomingPaymentInterestCalculation(body = {}, accessContext = null) {
  const stemId = String(body.stemId || body.stem_id || '').trim();
  if (!isSalesforceId(stemId)) throw appError('Valid stemId is required for late payment interest calculation.', 400);
  await requireInterofficeStemAccess(stemId, accessContext);

  const [stemDescribe, paymentDescribe] = await Promise.all([
    salesforceObjectFields({ objectName: 'stem__c' }).catch(() => ({ fields: [] })),
    salesforceObjectFields({ objectName: 'Payment__c' }).catch(() => ({ fields: [] })),
  ]);
  const stemFields = stemDescribe.fields || [];
  const stemFieldNames = new Set(stemFields.map((field) => field.name));
  const paymentFields = paymentDescribe.fields || [];
  const paymentFieldNames = new Set(paymentFields.map((field) => field.name));
  if (!paymentFieldNames.size) throw appError('Payment__c is not queryable, so interest cannot be calculated.', 500);

  const accountDescribe = stemFieldNames.has('Account__c')
    ? await salesforceObjectFields({ objectName: 'Account' }).catch(() => ({ fields: [] }))
    : { fields: [] };
  const accountFields = accountDescribe.fields || [];
  const accountFieldNames = new Set(accountFields.map((field) => field.name));
  const interestField = incomingPaymentInterestRateField(accountFields);

  const stemSelectFields = [
    'Id',
    'Name',
    ...selectedFields(stemFieldNames, [
      'KeyStem__c',
      'Buyer_Name__c',
      'Buyer__c',
      'Account__c',
      'Total_Invoice_Amount__c',
      'Receivable_Balance__c',
      'Payment_Term__c',
      'Invoice_Due_Date__c',
      'Buyer_Pay_Term_Date__c',
      'Due_Date__c',
      'Delivery_Date__c',
      'Delivery_Date_Or_Expected__c',
      'Expected_Delivery_Date__c',
    ]),
  ];
  if (stemFieldNames.has('Vessel__c')) stemSelectFields.push('Vessel__r.Name');
  if (stemFieldNames.has('Port__c')) stemSelectFields.push('Port__r.Name');
  if (stemFieldNames.has('Account__c')) {
    stemSelectFields.push('Account__r.Name');
    if (accountFieldNames.has('Group_Name__c')) stemSelectFields.push('Account__r.Group_Name__c');
    if (accountFieldNames.has('ParentId')) stemSelectFields.push('Account__r.Parent.Name');
    if (interestField?.name) stemSelectFields.push(`Account__r.${interestField.name}`);
  }

  const stemRows = await queryRows(`
    SELECT ${[...new Set(stemSelectFields)].join(', ')}
    FROM stem__c
    WHERE Id = '${escapeSoql(stemId)}'
    LIMIT 1
  `, { limit: 1, softFail: true });
  const stem = stemRows[0];
  if (!stem) throw appError('STEM was not found in Salesforce.', 404);

  const dateField = firstAvailableField(paymentFieldNames, ['Date__c', 'Payment_Date__c', 'Received_Date__c', 'Paid_Date__c', 'CreatedDate']);
  const amountField = firstAvailableField(paymentFieldNames, [
    'Amount__c',
    'Payment_Amount__c',
    'Paid_Amount__c',
    'Received_Amount__c',
    'Total_Amount__c',
    'Amount_Paid__c',
    'Payment_Value__c',
    'Actual_Amount__c',
  ]);
  if (!dateField || !amountField) throw appError('Payment date or amount field was not found on Payment__c.', 500);

  const referenceFields = incomingPaymentReferenceFields(paymentFields);
  const statusFields = selectedFields(paymentFieldNames, ['Status__c', 'Payment_Status__c']);
  const typeFields = selectedFields(paymentFieldNames, ['Type__c', 'Payment_Type__c']);
  const directionFields = incomingPaymentDirectionFields(paymentFields);
  const supplierInvoiceLookupFields = incomingPaymentSupplierInvoiceFields(paymentFields);
  const paymentSelectFields = [
    'Id',
    ...selectedFields(paymentFieldNames, ['Name', 'RecordTypeId', 'CreatedDate', 'LastModifiedDate', 'STEM__c', 'CurrencyIsoCode', 'Currency__c']),
    paymentFieldNames.has('RecordTypeId') ? 'RecordType.Name' : null,
    paymentFieldNames.has('RecordTypeId') ? 'RecordType.DeveloperName' : null,
    ...supplierInvoiceLookupFields,
    dateField,
    amountField,
    ...referenceFields,
    ...statusFields,
    ...typeFields,
    ...directionFields,
  ].filter(Boolean);

  const [lineItems, buyerBrokers, payments] = await Promise.all([
    queryRows(`
      SELECT Id, STEM__c, Cancelled__c, Quantity__c, Quantity_Delivered_Per_BDN__c,
             Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c,
             Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c,
             Buyers_Broker__c, Buyer_Broker__c, Buyers_Brokers_Commission_Per_Unit__c,
             Buyers_Brokers_Commission_Lumpsum__c, Commission_Cost__c
      FROM STEM_Line_Item__c
      WHERE STEM__c = '${escapeSoql(stemId)}'
      LIMIT 5000
    `, { limit: 5000, softFail: true }),
    queryRows(`
      SELECT Id, STEM__c, Buyer_Broker__c
      FROM STEM_Buyer_Broker__c
      WHERE STEM__c = '${escapeSoql(stemId)}'
      LIMIT 5000
    `, { limit: 5000, softFail: true }),
    queryRows(`
      SELECT ${[...new Set(paymentSelectFields)].join(', ')}
      FROM Payment__c
      WHERE STEM__c = '${escapeSoql(stemId)}'
      ORDER BY ${dateField} ASC NULLS LAST, CreatedDate ASC
      LIMIT 5000
    `, { limit: 5000, softFail: true }),
  ]);

  const brokerAccountIds = [...new Set([
    ...lineItems.map((item) => item.Supplier_Broker__c).filter(Boolean),
    ...lineItems.map((item) => item.Buyers_Broker__c || item.Buyer_Broker__c).filter(Boolean),
    ...buyerBrokers.map((item) => item.Buyer_Broker__c).filter(Boolean),
  ])];
  const brokerAccountMap = await namesByIds('Account', brokerAccountIds);
  for (const [id, name] of Object.entries(brokerAccountMap)) brokerAccountMap[String(id).slice(0, 15)] = name;
  const brokerGroups = buildBrokerCommissionGroups({
    stemMap: { [stem.Id]: stem },
    lineItems,
    buyerBrokers,
    accountMap: brokerAccountMap,
  })[stem.Id] || [];

  const buyerPayments = payments
    .filter((payment) => !incomingPaymentIsReceivableRemittance(payment, [...referenceFields, ...directionFields, ...typeFields, ...statusFields]))
    .map((payment) => {
      const amount = incomingPaymentNumber(payment[amountField]);
      const paymentDate = payment[dateField] || payment.CreatedDate || null;
      const brokerCommissionMatch = findBrokerCommissionPaymentMatch(payment, amount, brokerGroups, [...referenceFields, ...directionFields, ...typeFields, ...statusFields]);
      const type = brokerCommissionMatch
        ? 'Broker Commission'
        : incomingPaymentLooksBankCharge(payment, { referenceFields, directionFields, typeFields, statusFields })
          ? 'Bank Charge'
          : incomingPaymentTypeFromContext(payment, {
              amount,
              stem,
              supplierInvoice: null,
              supplierInvoiceFields: supplierInvoiceLookupFields,
              directionFields,
              typeFields,
              statusFields,
            });
      return {
        id: payment.Id,
        name: incomingPaymentDisplayName({ payment, referenceFields, stem, supplierInvoice: null, type }),
        amount,
        paymentDate,
        dateOnly: dateOnly(paymentDate),
        type,
      };
    })
    .filter((payment) => payment.type === 'Buyer Payment' && payment.amount != null && payment.amount > 0 && payment.dateOnly)
    .sort((a, b) => String(a.dateOnly).localeCompare(String(b.dateOnly)) || String(a.id).localeCompare(String(b.id)));

  const rawDueDate = calculatedBuyerPayTermDate(stem)
    || stem.Invoice_Due_Date__c
    || stem.Due_Date__c
    || stem.Buyer_Pay_Term_Date__c
    || null;
  const dueDate = dateOnly(rawDueDate);
  if (!dueDate) throw appError('Buyer invoice due date is missing, so late payment interest cannot be calculated.', 400);

  const rawRate = interestField?.name ? stem['Account__r']?.[interestField.name] : null;
  const monthlyRate = parseIncomingPaymentInterestRate(rawRate) ?? 0.02;
  const rateWarning = rawRate == null || rawRate === ''
    ? 'Buyer account interest rate was not found; defaulted to 2.00% per month.'
    : null;
  const invoiceAmount = incomingPaymentNumber(stem.Total_Invoice_Amount__c)
    ?? incomingPaymentNumber(body.invoiceAmount)
    ?? (buyerPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) + Math.max(0, Number(body.receivableBalance || 0)));
  if (!invoiceAmount || invoiceAmount <= 0) throw appError('Buyer invoice amount is missing, so late payment interest cannot be calculated.', 400);

  const today = dateOnly(new Date());
  let balance = invoiceAmount;
  let lastDate = dueDate;
  const segments = [];
  const paymentSchedule = [];
  for (const payment of buyerPayments) {
    const paymentAmount = Math.min(Number(payment.amount || 0), Math.max(0, balance));
    if (payment.dateOnly <= dueDate) {
      balance = Math.max(0, balance - paymentAmount);
      paymentSchedule.push({ ...payment, balanceAfter: balance, note: 'Paid on/before due date' });
      continue;
    }
    if (balance > 0 && payment.dateOnly > lastDate) {
      const days = Math.max(0, daysBetween(lastDate, payment.dateOnly));
      if (days > 0) {
        const interest = balance * monthlyRate * (days / 30);
        segments.push({
          fromDate: lastDate,
          toDate: payment.dateOnly,
          balance,
          days,
          rateDecimal: monthlyRate,
          interest,
          formula: interestFormulaText(balance, monthlyRate, days),
        });
      }
    }
    balance = Math.max(0, balance - paymentAmount);
    paymentSchedule.push({ ...payment, balanceAfter: balance, note: paymentAmount < Number(payment.amount || 0) ? 'Payment exceeds remaining balance' : '' });
    lastDate = payment.dateOnly;
  }
  const currentReceivable = incomingPaymentNumber(stem.Receivable_Balance__c);
  if (currentReceivable != null && currentReceivable >= 0) balance = Math.min(balance, currentReceivable);
  if (balance > 0 && today > lastDate) {
    const days = Math.max(0, daysBetween(lastDate, today));
    if (days > 0) {
      const interest = balance * monthlyRate * (days / 30);
      segments.push({
        fromDate: lastDate,
        toDate: today,
        balance,
        days,
        rateDecimal: monthlyRate,
        interest,
        formula: interestFormulaText(balance, monthlyRate, days),
        note: 'Current unpaid balance to request date',
      });
    }
  }

  const totalInterest = segments.reduce((sum, segment) => sum + Number(segment.interest || 0), 0);
  return {
    stem,
    buyerName: incomingPaymentBuyerName(stem),
    buyerGroupName: incomingPaymentBuyerGroup(stem),
    stemName: formatStemName(stem),
    dueDate,
    invoiceAmount,
    receivableBalance: currentReceivable,
    interestRateField: interestField ? { name: interestField.name, label: interestField.label || interestField.name } : null,
    rawInterestRate: rawRate,
    monthlyRate,
    rateWarning,
    paymentSchedule,
    segments,
    totalInterest,
  };
}

function incomingPaymentInterestCalculationHtml(calculation) {
  const segmentRows = (calculation.segments || []).map((segment) => `
    <tr>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;white-space:nowrap">${prettyDate(segment.fromDate)} to ${prettyDate(segment.toDate)}</td>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;white-space:nowrap">${money(segment.balance)}</td>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;white-space:nowrap">${segment.days}</td>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px">${escapeHtml(segment.formula)}</td>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;font-weight:700;white-space:nowrap">${money(segment.interest)}</td>
    </tr>`).join('');
  const paymentRows = (calculation.paymentSchedule || []).map((payment) => `
    <tr>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;white-space:nowrap">${prettyDate(payment.paymentDate)}</td>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px">${escapeHtml(payment.name || payment.id || '-')}</td>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;white-space:nowrap">${money(payment.amount)}</td>
      <td style="border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:right;white-space:nowrap">${money(payment.balanceAfter)}</td>
    </tr>`).join('');
  return `
    <div style="margin-top:16px">
      <h3 style="margin:0 0 8px;font-size:15px">Late Payment Interest Calculation</h3>
      ${calculation.rateWarning ? `<p style="margin:0 0 8px;color:#92400e;font-weight:600">${escapeHtml(calculation.rateWarning)}</p>` : ''}
      <p style="margin:0 0 8px;color:#667085">Formula: Outstanding Balance x Monthly Interest Rate x Overdue Days / 30.</p>
      <table style="border-collapse:collapse;width:100%;max-width:860px;font-size:12px;margin-bottom:12px">
        <tbody>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px;width:210px">Buyer invoice amount</th><td style="padding:5px 8px;font-weight:700">${money(calculation.invoiceAmount)}</td></tr>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px">Buyer invoice due date</th><td style="padding:5px 8px">${prettyDate(calculation.dueDate)}</td></tr>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px">Account interest rate</th><td style="padding:5px 8px">${incomingPaymentInterestRateLabel(calculation.monthlyRate)}${calculation.interestRateField ? ` (${escapeHtml(calculation.interestRateField.label)})` : ''}</td></tr>
          <tr><th style="text-align:left;color:#667085;padding:5px 8px">Calculated interest total</th><td style="padding:5px 8px;font-size:15px;font-weight:800;color:#1f2937">${money(calculation.totalInterest)}</td></tr>
        </tbody>
      </table>
      <table style="border-collapse:collapse;width:100%;max-width:960px;font-size:12px;margin-bottom:12px">
        <thead><tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px"><th style="text-align:left;padding:7px 8px">Period</th><th style="text-align:right;padding:7px 8px">Balance</th><th style="text-align:right;padding:7px 8px">Days</th><th style="text-align:left;padding:7px 8px">Formula</th><th style="text-align:right;padding:7px 8px">Interest</th></tr></thead>
        <tbody>${segmentRows || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#667085">No overdue interest segment was calculated.</td></tr>'}</tbody>
      </table>
      <table style="border-collapse:collapse;width:100%;max-width:860px;font-size:12px">
        <thead><tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px"><th style="text-align:left;padding:7px 8px">Payment Date</th><th style="text-align:left;padding:7px 8px">Payment</th><th style="text-align:right;padding:7px 8px">Amount</th><th style="text-align:right;padding:7px 8px">Balance After</th></tr></thead>
        <tbody>${paymentRows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#667085">No buyer payments were found for this STEM.</td></tr>'}</tbody>
      </table>
    </div>`;
}

function incomingPaymentInterestCalculationText(calculation) {
  return [
    'Late Payment Interest Calculation',
    `Formula: Outstanding Balance x Monthly Interest Rate x Overdue Days / 30`,
    calculation.rateWarning || '',
    `Buyer invoice amount: ${money(calculation.invoiceAmount)}`,
    `Buyer invoice due date: ${prettyDate(calculation.dueDate)}`,
    `Account interest rate: ${incomingPaymentInterestRateLabel(calculation.monthlyRate)}${calculation.interestRateField ? ` (${calculation.interestRateField.label})` : ''}`,
    `Calculated interest total: ${money(calculation.totalInterest)}`,
    '',
    'Interest segments:',
    ...((calculation.segments || []).map((segment) => `${prettyDate(segment.fromDate)} to ${prettyDate(segment.toDate)} | ${segment.formula} = ${money(segment.interest)}`)),
    '',
    'Buyer payment schedule:',
    ...((calculation.paymentSchedule || []).map((payment) => `${prettyDate(payment.paymentDate)} | ${payment.name || payment.id || '-'} | Payment ${money(payment.amount)} | Balance after ${money(payment.balanceAfter)}`)),
  ].filter((line) => line !== '').join('\n');
}

const INCOMING_PAYMENT_INTEREST_CALCULATION_TABLE_PATTERN = /\{\{\s*interestCalculationTable\s*\}\}/i;
const INCOMING_PAYMENT_INTEREST_STEM_LINK_TOKEN_PATTERN = /\{\{\s*stemLink\s*\}\}/i;
const DEFAULT_INCOMING_PAYMENT_INTEREST_TEMPLATE = {
  to: INCOMING_PAYMENT_INTEREST_RECIPIENT,
  cc: '{{requesterEmail}}',
  bcc: '',
  subject: 'Late Payment Interest Invoice Request - {{stemName}}',
  body: '<h2>Late Payment Interest Invoice Request</h2><p>{{requestedBy}} is requesting Louisa to issue a late payment interest invoice for the following delayed buyer payment.</p><p>Buyer: {{buyerName}}<br>Group: {{buyerGroupName}}<br>STEM: {{stemName}}</p><p>{{stemLink}}</p><p>Payment: {{paymentName}}<br>Received date: {{receivedDate}}<br>Payment terms delay: {{delayDays}}<br>Payment amount: {{paymentAmount}}<br>Receivable balance: {{receivableBalance}}<br>Calculated interest total: {{interestTotal}}</p><p>{{interestCalculationTable}}</p>',
};

function incomingPaymentInterestTemplate(input = {}) {
  return {
    to: String(input.to ?? DEFAULT_INCOMING_PAYMENT_INTEREST_TEMPLATE.to),
    cc: String(input.cc ?? DEFAULT_INCOMING_PAYMENT_INTEREST_TEMPLATE.cc),
    bcc: String(input.bcc ?? DEFAULT_INCOMING_PAYMENT_INTEREST_TEMPLATE.bcc),
    subject: String(input.subject || DEFAULT_INCOMING_PAYMENT_INTEREST_TEMPLATE.subject),
    body: String(input.body || input.intro || DEFAULT_INCOMING_PAYMENT_INTEREST_TEMPLATE.body),
  };
}

function renderIncomingPaymentInterestTemplate(value, context) {
  return String(value || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(context, key) ? context[key] : match
  ));
}

function replaceIncomingPaymentInterestToken(source, pattern, replacement) {
  return String(source || '')
    .replace(new RegExp(`<p\\b[^>]*>\\s*${pattern.source}\\s*<\\/p>`, 'i'), replacement)
    .replace(pattern, replacement);
}

function incomingPaymentInterestStemLinkHtml(url) {
  return `<p style="margin:0 0 14px"><a href="${escapeHtml(url)}" style="display:inline-block;border-radius:8px;background:#1f2937;color:#ffffff;text-decoration:none;font-weight:700;padding:9px 13px">Link to STEM</a></p>`;
}

function incomingPaymentInterestStemLinkText(url) {
  return `Link to STEM: ${url}`;
}

function buildIncomingPaymentInterestEmail(body, profile, calculation) {
  const requestedBy = profile?.full_name || profile?.email || 'Logged-in user';
  const paymentName = String(body.paymentName || body.paymentDisplayName || body.salesforcePaymentName || body.paymentId || '').trim();
  const stemName = calculation?.stemName || String(body.stemName || '').trim();
  const buyerName = calculation?.buyerName || String(body.buyerName || body.partyName || '').trim();
  const buyerGroupName = calculation?.buyerGroupName || String(body.buyerGroupName || '').trim();
  const receivedDate = prettyDate(body.paymentDate || body.receivedDate);
  const insertedDate = body.createdDate && dateOnly(body.createdDate) !== dateOnly(body.paymentDate || body.receivedDate)
    ? prettyDate(body.createdDate)
    : '';
  const delayLabel = body.delayDays == null ? '-' : `${Number(body.delayDays).toLocaleString()} Days`;
  const context = {
    requestedBy,
    requesterEmail: profile?.email || '',
    buyerName: buyerName || '-',
    buyerGroupName: buyerGroupName || '-',
    stemName: stemName || '-',
    paymentName: paymentName || body.paymentId || '-',
    receivedDate,
    insertedDate,
    delayDays: delayLabel,
    paymentAmount: money(body.amount),
    receivableBalance: money(calculation?.receivableBalance ?? body.receivableBalance),
    invoiceAmount: money(calculation?.invoiceAmount ?? body.invoiceAmount),
    invoiceDueDate: calculation?.dueDate ? prettyDate(calculation.dueDate) : '-',
    interestRate: incomingPaymentInterestRateLabel(calculation?.monthlyRate),
    interestRateField: calculation?.interestRateField?.label || calculation?.interestRateField?.name || '',
    interestTotal: money(calculation?.totalInterest),
  };
  const template = incomingPaymentInterestTemplate(body.template || body.interestTemplate || {});
  const stemUrl = incomingPaymentStemUrl({ appUrl: body.appUrl }, calculation?.stem?.Id || body.stemId);
  const to = uniqueEmailList(renderIncomingPaymentInterestTemplate(template.to, context));
  const cc = uniqueEmailList(renderIncomingPaymentInterestTemplate(template.cc, context));
  const bcc = uniqueEmailList(renderIncomingPaymentInterestTemplate(template.bcc, context));
  const subject = renderIncomingPaymentInterestTemplate(template.subject, context);
  const bodyContent = renderIncomingPaymentInterestTemplate(template.body, context);
  const bodyText = hasHtmlMarkup(bodyContent) ? htmlToPlainText(bodyContent) : bodyContent;
  const calculationHtml = calculation ? incomingPaymentInterestCalculationHtml(calculation) : '';
  const calculationText = calculation ? incomingPaymentInterestCalculationText(calculation) : '';
  const htmlBody = replaceIncomingPaymentInterestToken(
    emailContentHtml(bodyContent),
    INCOMING_PAYMENT_INTEREST_STEM_LINK_TOKEN_PATTERN,
    incomingPaymentInterestStemLinkHtml(stemUrl),
  )
    .replace(/<p\b[^>]*>\s*\{\{\s*interestCalculationTable\s*\}\}\s*<\/p>/i, calculationHtml)
    .replace(INCOMING_PAYMENT_INTEREST_CALCULATION_TABLE_PATTERN, calculationHtml);
  const textBody = replaceIncomingPaymentInterestToken(
    bodyText,
    INCOMING_PAYMENT_INTEREST_STEM_LINK_TOKEN_PATTERN,
    incomingPaymentInterestStemLinkText(stemUrl),
  ).replace(INCOMING_PAYMENT_INTEREST_CALCULATION_TABLE_PATTERN, calculationText);
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#1f2937;line-height:1.45">
      ${htmlBody}
    </div>`;
  return { to, cc, bcc, subject, html, text: textBody };
}

async function incomingPaymentInterestInvoiceRequest(body = {}, req = null, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  const paymentId = String(body.paymentId || body.payment_id || '').trim();
  if (!paymentId) throw appError('paymentId is required.', 400);

  const delayDays = Number(body.delayDays ?? body.delay_days);
  if (!Number.isFinite(delayDays) || delayDays <= 3) {
    throw appError('Late payment interest invoice request is only available for buyer payments delayed more than 3 days.', 400);
  }

  const existing = await fetchIncomingPaymentInterestNotification(client, paymentId);
  const forceResend = body.force === true || body.confirmResend === true || body.allowResend === true;
  if (existing && !forceResend) {
    const deliveryUncertain = ['sending', 'uncertain'].includes(existing.deliveryStatus);
    return { sent: false, alreadySent: existing.deliveryStatus === 'sent', deliveryUncertain, requiresConfirmation: true, notification: existing };
  }

  const calculation = await incomingPaymentInterestCalculation({ ...body, delayDays, paymentId }, accessContext);
  const email = buildIncomingPaymentInterestEmail({ ...body, delayDays, paymentId }, profile, calculation);
  const from = String(body.from || DEFAULT_INCOMING_PAYMENT_EMAIL_SETTINGS.from);
  const hasServerSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
  if (!hasServerSmtp) {
    throw appError('The shared server email sender is not configured. Ask an administrator to check Settings > System Health.', 400);
  }
  const smtpFrom = smtpAuthenticatedFromAddress({ user: process.env.SMTP_USER }, from) || from;
  const recipients = email.to;
  if (!recipients.length) {
    throw appError('Late payment interest request recipient is not configured. Add at least one To recipient in the template.', 400);
  }
  const attemptAt = new Date().toISOString();
  const payload = {
    payment_id: paymentId,
    payment_name: String(body.paymentName || body.paymentDisplayName || body.salesforcePaymentName || '').trim() || null,
    stem_id: String(body.stemId || '').trim() || null,
    stem_name: calculation.stemName || String(body.stemName || '').trim() || null,
    buyer_name: calculation.buyerName || String(body.buyerName || body.partyName || '').trim() || null,
    buyer_group_name: calculation.buyerGroupName || String(body.buyerGroupName || '').trim() || null,
    received_date: incomingPaymentDbDate(body.paymentDate || body.receivedDate),
    payment_created_date: incomingPaymentDbDate(body.createdDate),
    delay_days: Math.trunc(delayDays),
    amount: incomingPaymentDbNumber(body.amount),
    currency: String(body.currency || 'USD').trim() || 'USD',
    receivable_balance: incomingPaymentDbNumber(calculation.receivableBalance ?? body.receivableBalance),
    recipient_email: uniqueEmailList(recipients, email.cc, email.bcc).join(', '),
    email_subject: email.subject,
    email_message_id: null,
    email_provider: 'smtp',
    actor_user_id: profile.id,
    actor_email: profile.email,
    actor_name: profile.full_name || profile.email || null,
    delivery_status: 'sending',
    last_attempt_at: attemptAt,
    last_error: null,
    sent_at: null,
    updated_at: attemptAt,
    metadata: {
      source: 'incoming_payment',
      delayThresholdDays: 3,
      requestedAtTimezone: 'Asia/Hong_Kong',
      resent: Boolean(existing),
      resendCount: Number(existing?.metadata?.resendCount || 0) + (existing ? 1 : 0),
      previousRequest: existing ? {
        sentAt: existing.sentAt || null,
        actorEmail: existing.actorEmail || null,
        recipientEmail: existing.recipientEmail || null,
        emailSubject: existing.emailSubject || null,
      } : null,
      interestCalculation: {
        invoiceAmount: calculation.invoiceAmount,
        dueDate: calculation.dueDate,
        interestRateField: calculation.interestRateField,
        rawInterestRate: calculation.rawInterestRate,
        monthlyRate: calculation.monthlyRate,
        rateWarning: calculation.rateWarning,
        totalInterest: calculation.totalInterest,
        segments: calculation.segments,
        paymentSchedule: calculation.paymentSchedule,
      },
    },
  };

  const reserveQuery = existing
    ? client
      .from('incoming_payment_interest_notifications')
      .update(payload)
      .eq('payment_id', paymentId)
    : client
      .from('incoming_payment_interest_notifications')
      .insert(payload);
  const { data: reserved, error: reserveError } = await reserveQuery
    .select(INCOMING_PAYMENT_INTEREST_NOTIFICATION_FIELDS)
    .single();
  if (reserveError) throw reserveError;

  let result;
  try {
    result = await sendWithSmtp({
      from: smtpFrom,
      to: recipients,
      cc: email.cc,
      bcc: email.bcc,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  } catch (error) {
    await client
      .from('incoming_payment_interest_notifications')
      .update({ delivery_status: 'failed', last_error: error.message, updated_at: new Date().toISOString() })
      .eq('payment_id', paymentId);
    throw error;
  }

  const sentAt = new Date().toISOString();
  const { data, error } = await client
    .from('incoming_payment_interest_notifications')
    .update({
      delivery_status: 'sent',
      email_message_id: result.id || result.messageId || null,
      sent_at: sentAt,
      last_error: null,
      updated_at: sentAt,
    })
    .eq('payment_id', paymentId)
    .select(INCOMING_PAYMENT_INTEREST_NOTIFICATION_FIELDS)
    .single();
  if (error) {
    await client
      .from('incoming_payment_interest_notifications')
      .update({ delivery_status: 'uncertain', last_error: `Email sent but tracking update failed: ${error.message}`, updated_at: new Date().toISOString() })
      .eq('payment_id', paymentId);
    return {
      sent: true,
      trackingWarning: 'Email was sent, but FCOS could not finalize its delivery record. Do not resend until an administrator reconciles it.',
      to: recipients,
      notification: { ...serializeIncomingPaymentInterestNotification(reserved), deliveryStatus: 'uncertain' },
    };
  }
  return {
    sent: true,
    alreadySent: Boolean(existing),
    resent: Boolean(existing),
    to: recipients,
    notification: serializeIncomingPaymentInterestNotification(data),
  };
}

const INCOMING_PAYMENT_RECEIVABLE_TABLE_TOKEN_PATTERN = /\{\{\s*receivablePaymentsTable\s*\}\}/i;
const INCOMING_PAYMENT_BUYER_CIA_TABLE_TOKEN_PATTERN = /\{\{\s*buyerCiaInvoicesTable\s*\}\}/i;
const INCOMING_PAYMENT_LATE_INTEREST_LINK_TOKEN_PATTERNS = [
  /\{\{\s*requestLatePaymentInterestInvoiceLink\s*\}\}/i,
  /\{\{\s*latePaymentInterestLink\s*\}\}/i,
];
const DEFAULT_INCOMING_PAYMENT_EMAIL_SETTINGS = {
  from: 'Fratelli Cosulich <info@cosulich.com.hk>',
  to: ['bt@cosulich.com.hk'],
  cc: [],
  bcc: [],
  appUrl: '',
  subject: 'Incoming Payment Report - {{dateFrom}} to {{dateTo}}',
  intro: '<h2>Incoming Payment Report</h2><p>Please find below the receivable payments and Buyer CIA invoices for the selected filters.</p><p>Payment created date range: {{dateFrom}} to {{dateTo}}.<br>Incoming total: {{incomingTotal}}.</p><p>{{receivablePaymentsTable}}</p><p>{{buyerCiaInvoicesTable}}</p>',
  includeReceivablePayments: true,
  includeBuyerCiaInvoices: true,
};

function incomingPaymentEmailSettings(input = {}) {
  const defaults = {
    ...DEFAULT_INCOMING_PAYMENT_EMAIL_SETTINGS,
    from: process.env.INCOMING_PAYMENT_REPORT_FROM || DEFAULT_INCOMING_PAYMENT_EMAIL_SETTINGS.from,
    to: parseEmailList(process.env.INCOMING_PAYMENT_REPORT_TO, DEFAULT_INCOMING_PAYMENT_EMAIL_SETTINGS.to),
    cc: parseEmailList(process.env.INCOMING_PAYMENT_REPORT_CC, DEFAULT_INCOMING_PAYMENT_EMAIL_SETTINGS.cc),
    bcc: parseEmailList(process.env.INCOMING_PAYMENT_REPORT_BCC, DEFAULT_INCOMING_PAYMENT_EMAIL_SETTINGS.bcc),
  };
  return {
    ...defaults,
    ...input,
    from: String(input.from ?? defaults.from),
    to: parseEmailList(input.to, defaults.to),
    cc: parseEmailList(input.cc, defaults.cc),
    bcc: parseEmailList(input.bcc, defaults.bcc),
    appUrl: String(input.appUrl ?? defaults.appUrl ?? ''),
    subject: String(input.subject ?? defaults.subject),
    intro: String(input.intro ?? defaults.intro),
    includeReceivablePayments: input.includeReceivablePayments ?? defaults.includeReceivablePayments,
    includeBuyerCiaInvoices: input.includeBuyerCiaInvoices ?? defaults.includeBuyerCiaInvoices,
  };
}

function incomingPaymentSearchMatches(row, search, fields) {
  const query = String(search || '').trim().toLowerCase();
  if (!query) return true;
  return fields.some((field) => String(row?.[field] || '').toLowerCase().includes(query));
}

function renderIncomingPaymentTemplate(value, context = {}) {
  let output = String(value || '');
  for (const [key, replacement] of Object.entries(context)) {
    output = output.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), String(replacement ?? ''));
  }
  return output;
}

function incomingPaymentReportSummary(rows = []) {
  const incomingRows = rows.filter((row) => row.isIncoming);
  return {
    incomingRows: incomingRows.length,
    totalIncomingAmount: incomingRows.reduce((sum, row) => sum + Math.abs(Number(row.incomingAmount || 0)), 0),
    buyerPaymentTotal: rows.filter((row) => row.type === 'Buyer Payment').reduce((sum, row) => sum + Math.abs(Number(row.incomingAmount || 0)), 0),
    supplierRefundTotal: rows.filter((row) => row.type === 'Supplier Refund').reduce((sum, row) => sum + Math.abs(Number(row.incomingAmount || 0)), 0),
    unmatchedCount: rows.filter((row) => row.type === 'Unmatched' || row.status === 'Needs review').length,
  };
}

function incomingPaymentInsertedNote(row) {
  if (!row?.paymentDate || !row?.createdDate) return '';
  if (dateOnly(row.paymentDate) === dateOnly(row.createdDate)) return '';
  return `Inserted on ${prettyDate(row.createdDate)}`;
}

function incomingPaymentTermsValue(row) {
  return row?.type === 'Buyer Payment' ? row.paymentTerms || '-' : 'N/A';
}

function incomingPaymentDelayValue(row) {
  if (row?.type !== 'Buyer Payment') return 'N/A';
  return row.delayDays == null ? '-' : Number(row.delayDays).toLocaleString();
}

function incomingPaymentAmountText(row) {
  const bankCharges = (row?.bankCharges || []).map((charge) => `Bank Charge ${money(charge.amount)}`);
  return [money(row?.amount), ...bankCharges].join(' / ');
}

function incomingPaymentReceivableTableHtml(rows = []) {
  const tableRows = rows.map((row) => {
    const cell = 'border-bottom:1px solid #e5e7eb;padding:7px 8px;vertical-align:top';
    const amountLines = [
      escapeHtml(money(row.amount)),
      ...(row.bankCharges || []).map((charge) => `<span style="display:block;color:#92400e;font-weight:600">Bank Charge ${escapeHtml(money(charge.amount))}</span>`),
    ].join('');
    return `
      <tr>
        <td style="${cell};white-space:nowrap">${prettyDate(row.paymentDate)}${incomingPaymentInsertedNote(row) ? `<span style="display:block;color:#92400e;font-size:11px;font-weight:600">Inserted on ${prettyDate(row.createdDate)}</span>` : ''}</td>
        <td style="${cell};white-space:nowrap;text-align:right">${escapeHtml(incomingPaymentTermsValue(row))}</td>
        <td style="${cell};white-space:nowrap;text-align:right">${escapeHtml(incomingPaymentDelayValue(row))}</td>
        <td style="${cell};min-width:160px">${escapeHtml(row.partyName || '-')}</td>
        <td style="${cell};min-width:140px">${escapeHtml(row.buyerGroupName || '-')}</td>
        <td style="${cell};min-width:180px;font-weight:600">${escapeHtml(row.stemName || '-')}</td>
        <td style="${cell};white-space:nowrap;text-align:right;font-weight:600">${amountLines}</td>
        <td style="${cell};white-space:nowrap;text-align:right">${money(row.receivableBalance)}</td>
      </tr>`;
  }).join('');
  return `
    <div style="margin:14px 0 18px">
      <div style="font-size:13px;font-weight:700;margin:0 0 8px;color:#1f2937">Receivable Payments (${rows.length.toLocaleString()})</div>
      <div style="overflow-x:auto;border:1px solid #d9e2ef;border-radius:10px">
        <table style="border-collapse:collapse;width:auto;min-width:1040px;font-size:12px;line-height:1.3">
          <thead>
            <tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px;letter-spacing:.04em">
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Received Date</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Terms</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Delay</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">From</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Group</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">STEM</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Amount</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Receivable</th>
            </tr>
          </thead>
          <tbody>${tableRows || '<tr><td colspan="8" style="padding:16px;text-align:center;color:#667085">No receivable payments found for the selected filters.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function incomingPaymentBuyerCiaTableHtml(rows = []) {
  const tableRows = rows.map((row) => {
    const cell = 'border-bottom:1px solid #e5e7eb;padding:7px 8px;vertical-align:top';
    return `
      <tr>
        <td style="${cell};min-width:180px;font-weight:600">${escapeHtml(row.buyerName || '-')}</td>
        <td style="${cell};min-width:140px">${escapeHtml(row.buyerGroupName || '-')}</td>
        <td style="${cell};min-width:130px">${escapeHtml(row.buyerTrader || '-')}</td>
        <td style="${cell};min-width:180px;font-weight:600">${escapeHtml(row.stemName || '-')}</td>
        <td style="${cell};white-space:nowrap;text-align:right">${money(row.calculatedAmount)}</td>
        <td style="${cell};white-space:nowrap;text-align:right;font-weight:600">${money(row.receivableBalance)}</td>
        <td style="${cell};white-space:nowrap">${prettyDate(row.deliveryDate)}</td>
      </tr>`;
  }).join('');
  return `
    <div style="margin:14px 0 18px">
      <div style="font-size:13px;font-weight:700;margin:0 0 8px;color:#1f2937">Buyer CIA Invoices (${rows.length.toLocaleString()})</div>
      <div style="overflow-x:auto;border:1px solid #d9e2ef;border-radius:10px">
        <table style="border-collapse:collapse;width:auto;min-width:900px;font-size:12px;line-height:1.3">
          <thead>
            <tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px;letter-spacing:.04em">
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Buyer</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Group</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Buyer Trader</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">STEM</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Calculated Amount</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Receivable Balance</th>
              <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Delivery Date</th>
            </tr>
          </thead>
          <tbody>${tableRows || '<tr><td colspan="7" style="padding:16px;text-align:center;color:#667085">No Buyer CIA invoices found for the selected filters.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function incomingPaymentReceivableTableText(rows = []) {
  if (!rows.length) return 'Receivable Payments: none';
  return [
    `Receivable Payments (${rows.length})`,
    'Received Date | Terms | Delay | From | Group | STEM | Amount | Receivable',
    ...rows.map((row) => `${prettyDate(row.paymentDate)}${incomingPaymentInsertedNote(row) ? ` (${incomingPaymentInsertedNote(row)})` : ''} | ${incomingPaymentTermsValue(row)} | ${incomingPaymentDelayValue(row)} | ${row.partyName || '-'} | ${row.buyerGroupName || '-'} | ${row.stemName || '-'} | ${incomingPaymentAmountText(row)} | ${money(row.receivableBalance)}`),
  ].join('\n');
}

function incomingPaymentBuyerCiaTableText(rows = []) {
  if (!rows.length) return 'Buyer CIA Invoices: none';
  return [
    `Buyer CIA Invoices (${rows.length})`,
    ...rows.map((row) => `${row.buyerName || '-'} | ${row.buyerGroupName || '-'} | ${row.buyerTrader || '-'} | ${row.stemName || '-'} | Calculated ${money(row.calculatedAmount)} | Receivable ${money(row.receivableBalance)} | Delivery ${prettyDate(row.deliveryDate)}`),
  ].join('\n');
}

function replaceIncomingPaymentToken(source, pattern, replacement) {
  return String(source || '')
    .replace(new RegExp(`<p\\b[^>]*>\\s*${pattern.source}\\s*<\\/p>`, 'i'), replacement)
    .replace(pattern, replacement);
}

function injectIncomingPaymentTables(content, settings, receivableTable, buyerCiaTable) {
  let output = String(content || '');
  const hasReceivableToken = INCOMING_PAYMENT_RECEIVABLE_TABLE_TOKEN_PATTERN.test(output);
  const hasBuyerCiaToken = INCOMING_PAYMENT_BUYER_CIA_TABLE_TOKEN_PATTERN.test(output);
  output = replaceIncomingPaymentToken(output, INCOMING_PAYMENT_RECEIVABLE_TABLE_TOKEN_PATTERN, settings.includeReceivablePayments ? receivableTable : '');
  output = replaceIncomingPaymentToken(output, INCOMING_PAYMENT_BUYER_CIA_TABLE_TOKEN_PATTERN, settings.includeBuyerCiaInvoices ? buyerCiaTable : '');
  if (settings.includeReceivablePayments && !hasReceivableToken) output += receivableTable;
  if (settings.includeBuyerCiaInvoices && !hasBuyerCiaToken) output += buyerCiaTable;
  return output;
}

function injectIncomingPaymentLateInterestLink(content, replacement) {
  let output = String(content || '');
  for (const pattern of INCOMING_PAYMENT_LATE_INTEREST_LINK_TOKEN_PATTERNS) {
    output = replaceIncomingPaymentToken(output, pattern, replacement);
  }
  return output;
}

function incomingPaymentLateInterestLinkHtml(url) {
  return `<p style="margin:0 0 14px"><a href="${escapeHtml(url)}" style="display:inline-block;border-radius:8px;background:#FF2800;color:#ffffff;text-decoration:none;font-weight:700;padding:9px 13px">Late Payment Interest Invoice</a></p>`;
}

function incomingPaymentLateInterestLinkText(url) {
  return `Late Payment Interest Invoice: ${url}`;
}

function buildIncomingPaymentEmail(report, settings) {
  const summary = report.summary || incomingPaymentReportSummary(report.rows || []);
  const lateInterestUrl = incomingPaymentFilterUrl(settings, report);
  const incomingRows = Number(summary.incomingRows || 0);
  const needsReviewCount = Number(summary.unmatchedCount || 0);
  const context = {
    dateFrom: prettyDate(report.dateFrom),
    dateTo: prettyDate(report.dateTo),
    today: prettyDate(dateOnly(new Date())),
    paymentCount: (report.rows || []).length.toLocaleString(),
    receivablePaymentCount: (report.rows || []).length.toLocaleString(),
    buyerCiaCount: (report.buyerCiaInvoices || []).length.toLocaleString(),
    incomingTotal: money(summary.totalIncomingAmount),
    buyerPaymentTotal: money(summary.buyerPaymentTotal),
    supplierRefundTotal: money(summary.supplierRefundTotal),
    needsReviewCount: String(needsReviewCount),
    keyword: report.search || '',
  };
  const subject = renderIncomingPaymentTemplate(settings.subject, context);
  const content = renderIncomingPaymentTemplate(settings.intro, context);
  const contentText = hasHtmlMarkup(content) ? htmlToPlainText(content) : content;
  const summaryHtml = `
    <table role="presentation" style="border-collapse:collapse;margin:18px 0;width:100%;max-width:720px">
      <tr>
        <td style="border:1px solid #d9e2ef;border-radius:8px 0 0 8px;padding:12px;background:#f6fef9">
          <div style="font-size:12px;color:#667085;text-transform:uppercase;letter-spacing:.04em">Incoming Total</div>
          <div style="font-size:20px;font-weight:700;color:#059669">${money(summary.totalIncomingAmount)}</div>
          <div style="margin-top:4px;font-size:12px;color:#667085">Buyer Payments ${money(summary.buyerPaymentTotal)} · Supplier Refunds ${money(summary.supplierRefundTotal)} · ${incomingRows.toLocaleString()} records</div>
        </td>
        <td style="border:1px solid #d9e2ef;border-left:0;border-radius:0 8px 8px 0;padding:12px;background:#fffbeb">
          <div style="font-size:12px;color:#667085;text-transform:uppercase;letter-spacing:.04em">Needs Review</div>
          <div style="font-size:20px;font-weight:700;color:#d97706">${needsReviewCount.toLocaleString()}</div>
          <div style="margin-top:4px;font-size:12px;color:#667085">Unmatched or incomplete payments</div>
        </td>
      </tr>
    </table>`;
  const contentHtml = injectIncomingPaymentLateInterestLink(
    emailContentHtml(content),
    incomingPaymentLateInterestLinkHtml(lateInterestUrl),
  );
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#1f2937;line-height:1.45">
      ${summaryHtml}
      ${injectIncomingPaymentTables(
        contentHtml,
        settings,
        incomingPaymentReceivableTableHtml(report.rows || []),
        incomingPaymentBuyerCiaTableHtml(report.buyerCiaInvoices || []),
      )}
    </div>`;
  const textContent = injectIncomingPaymentTables(
    [
      `Incoming Total: ${money(summary.totalIncomingAmount)}`,
      `Buyer Payments: ${money(summary.buyerPaymentTotal)}`,
      `Supplier Refunds: ${money(summary.supplierRefundTotal)}`,
      `Incoming Records: ${incomingRows.toLocaleString()}`,
      `Needs Review: ${needsReviewCount.toLocaleString()}`,
      '',
      injectIncomingPaymentLateInterestLink(contentText, incomingPaymentLateInterestLinkText(lateInterestUrl)),
    ].join('\n'),
    settings,
    `\n\n${incomingPaymentReceivableTableText(report.rows || [])}\n\n`,
    `\n\n${incomingPaymentBuyerCiaTableText(report.buyerCiaInvoices || [])}\n\n`,
  );
  return { subject, html, text: textContent, summary };
}

async function incomingPaymentEmailReport(body = {}, req = null, accessContext = null) {
  if (!accessContext) await requireActiveUser(req);
  const settings = incomingPaymentEmailSettings(body.settings || body);
  const source = await incomingPaymentsList({
    dateFrom: body.dateFrom,
    dateTo: body.dateTo,
    limit: body.limit || 5000,
  }, null, accessContext);
  const search = String(body.search || '').trim();
  const rows = (source.rows || []).filter((row) => incomingPaymentSearchMatches(row, search, [
    'partyName',
    'stemName',
    'keyStem',
    'buyerName',
    'buyerGroupName',
    'supplierName',
    'supplierInvoiceName',
  ]));
  const buyerCiaInvoices = (source.buyerCiaInvoices || []).filter((row) => incomingPaymentSearchMatches(row, search, [
    'buyerName',
    'buyerGroupName',
    'buyerTrader',
    'stemName',
    'keyStem',
  ]));
  const report = {
    ...source,
    rows,
    buyerCiaInvoices,
    search,
    summary: incomingPaymentReportSummary(rows),
  };
  const email = buildIncomingPaymentEmail(report, settings);
  const reportMeta = {
    dateFrom: report.dateFrom,
    dateTo: report.dateTo,
    search,
    receivableRows: rows.length,
    buyerCiaRows: buyerCiaInvoices.length,
    summary: email.summary,
  };
  if (body.preview || body.dryRun) {
    return {
      sent: false,
      preview: true,
      settings,
      report: reportMeta,
      email: { subject: email.subject, html: email.html, text: email.text, summary: email.summary },
    };
  }
  if (!settings.to.length) throw appError('At least one To recipient is required before sending the Incoming Payment report.', 400);
  const smtpFrom = smtpAuthenticatedFromAddress({ user: process.env.SMTP_USER }, settings.from) || settings.from;
  const result = await sendWithSmtp({
    from: smtpFrom,
    to: settings.to,
    cc: settings.cc,
    bcc: settings.bcc,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  return {
    sent: true,
    id: result.id,
    to: settings.to,
    cc: settings.cc,
    bcc: settings.bcc,
    subject: email.subject,
    report: reportMeta,
    rows: rows.length,
    buyerCiaRows: buyerCiaInvoices.length,
    email: { subject: email.subject, html: email.html, text: email.text, summary: email.summary },
  };
}

function buyerInvoiceEmailSettings(input = {}) {
  const hasBuyerTraderFilter = Object.prototype.hasOwnProperty.call(input, 'buyerTraders');
  const defaults = {
    ...DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS,
    from: process.env.BUYER_INVOICE_REPORT_FROM || DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.from,
    to: parseEmailList(process.env.BUYER_INVOICE_REPORT_TO, DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.to),
    cc: parseEmailList(process.env.BUYER_INVOICE_REPORT_CC, DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.cc),
    appUrl: buyerInvoiceAppUrl(),
    daysAhead: Number(process.env.BUYER_INVOICE_REPORT_DAYS_AHEAD || DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.daysAhead),
    subject: process.env.BUYER_INVOICE_REPORT_SUBJECT || DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.subject,
    intro: process.env.BUYER_INVOICE_REPORT_INTRO || DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.intro,
    weekdays: parseStringList(process.env.BUYER_INVOICE_REPORT_WEEKDAYS, DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.weekdays),
    sendTimes: parseStringList(process.env.BUYER_INVOICE_REPORT_SEND_TIMES, DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.sendTimes),
  };
  return {
    ...normalizeBuyerInvoiceEmailSettings(input, defaults),
    hasBuyerTraderFilter,
  };
}

function serializeBuyerInvoiceEmailSettingsRow(row, fallbackSettings = null) {
  const settings = normalizeBuyerInvoiceEmailSettings(row?.settings || fallbackSettings || {});
  return {
    settings,
    meta: {
      lastPreviewAt: row?.last_preview_at || null,
      lastPreviewRowCount: row?.last_preview_row_count ?? null,
      lastSentAt: row?.last_sent_at || null,
      lastSentRowCount: row?.last_sent_row_count ?? null,
      lastError: row?.last_error || null,
      updatedByEmail: row?.updated_by_email || null,
      updatedAt: row?.updated_at || null,
      nextScheduledRun: nextBuyerInvoiceScheduleRun(settings),
    },
  };
}

async function loadStoredBuyerInvoiceEmailSettings() {
  const client = safeSupabaseAdminClient();
  if (!client) return serializeBuyerInvoiceEmailSettingsRow(null);
  try {
    const { data, error } = await client
      .from('buyer_invoice_email_settings')
      .select('id,settings,last_preview_at,last_preview_row_count,last_sent_at,last_sent_row_count,last_error,updated_by_email,updated_at')
      .eq('id', 'default')
      .maybeSingle();
    if (error) throw error;
    return serializeBuyerInvoiceEmailSettingsRow(data);
  } catch (error) {
    console.error('Failed to load buyer invoice email settings', error.message);
    return serializeBuyerInvoiceEmailSettingsRow(null);
  }
}

async function saveStoredBuyerInvoiceEmailSettings(settings, profile = null) {
  const client = supabaseAdminClient();
  const normalized = normalizeBuyerInvoiceEmailSettings(settings);
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from('buyer_invoice_email_settings')
    .upsert({
      id: 'default',
      settings: normalized,
      updated_by: profile?.id || null,
      updated_by_email: profile?.email || null,
      updated_at: nowIso,
    }, { onConflict: 'id' })
    .select('id,settings,last_preview_at,last_preview_row_count,last_sent_at,last_sent_row_count,last_error,updated_by_email,updated_at')
    .single();
  if (error) throw error;
  return serializeBuyerInvoiceEmailSettingsRow(data);
}

async function updateBuyerInvoiceEmailSettingsMeta(patch = {}) {
  const client = safeSupabaseAdminClient();
  if (!client) return;
  const { error } = await client
    .from('buyer_invoice_email_settings')
    .upsert({ id: 'default', ...patch, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) console.error('Failed to update buyer invoice email settings metadata', error.message);
}

async function buyerInvoiceEmailSettingsGet(body, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  return {
    ...await loadStoredBuyerInvoiceEmailSettings(),
    capabilities: { canManageSettings: await userHasCapability(client, profile, 'buyer_invoices_manage') },
  };
}

async function buyerInvoiceEmailSettingsSave(body, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  await requireCapability(client, profile, 'buyer_invoices_manage', 'Buyer invoice shared settings management permission is required.');
  return saveStoredBuyerInvoiceEmailSettings(body.settings || body, profile);
}

function hongKongScheduleParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Hong_Kong',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return {
    weekday: value('weekday'),
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}`,
    minuteOfDay: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

function scheduleMinuteOfDay(time) {
  const match = String(time || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function buyerInvoiceScheduledWindow(settings, date = new Date()) {
  const now = hongKongScheduleParts(date);
  const weekdays = new Set((settings.weekdays || []).map((day) => String(day).slice(0, 3).toLowerCase()));
  if (!weekdays.has(String(now.weekday).slice(0, 3).toLowerCase())) return null;
  for (const time of settings.sendTimes || []) {
    const scheduleMinute = scheduleMinuteOfDay(time);
    if (scheduleMinute == null) continue;
    const diff = now.minuteOfDay - scheduleMinute;
    if (diff >= 0 && diff < 5) {
      const scheduleTime = String(time).trim().padStart(5, '0');
      return {
        date: now.date,
        time: scheduleTime,
        runKey: `buyer-invoices:${now.date}:${scheduleTime}`,
      };
    }
  }
  return null;
}

function isBuyerInvoiceReportDue(settings, date = new Date()) {
  return Boolean(buyerInvoiceScheduledWindow(settings, date));
}

function nextBuyerInvoiceScheduleRun(settings, fromDate = new Date()) {
  const weekdays = new Set((settings.weekdays || []).map((day) => String(day).slice(0, 3).toLowerCase()));
  const sendTimes = (settings.sendTimes || [])
    .map((time) => String(time).trim().padStart(5, '0'))
    .filter((time) => scheduleMinuteOfDay(time) != null)
    .sort();
  if (!weekdays.size || !sendTimes.length) return null;

  const now = hongKongScheduleParts(fromDate);
  for (let offset = 0; offset < 14; offset += 1) {
    const probe = hongKongScheduleParts(new Date(fromDate.getTime() + offset * 86400000));
    if (!weekdays.has(String(probe.weekday).slice(0, 3).toLowerCase())) continue;
    for (const time of sendTimes) {
      if (offset === 0 && scheduleMinuteOfDay(time) <= now.minuteOfDay) continue;
      return `${probe.date} ${time} HKT`;
    }
  }
  return null;
}

function overdueSeverity(daysUntilDue) {
  if (daysUntilDue == null || Number(daysUntilDue) > 0) return null;
  const overdueDays = Math.abs(Number(daysUntilDue));
  if (overdueDays >= 14) return 'red';
  if (overdueDays >= 7) return 'orange';
  return 'yellow';
}

function overdueDisplayValue(daysUntilDue) {
  if (daysUntilDue == null) return '-';
  const overdue = -Number(daysUntilDue);
  const value = Object.is(overdue, -0) ? 0 : overdue;
  return value.toLocaleString();
}

function overdueEmailStyles(daysUntilDue, prpspStatus) {
  const severity = overdueSeverity(daysUntilDue);
  const styles = {
    red: { row: 'background:#fee2e2', border: '#fca5a5', text: '#991b1b', pill: 'background:#fecaca;border-color:#f87171;color:#7f1d1d' },
    orange: { row: 'background:#fed7aa', border: '#fb923c', text: '#9a3412', pill: 'background:#fdba74;border-color:#f97316;color:#7c2d12' },
    yellow: { row: 'background:#fde68a', border: '#facc15', text: '#854d0e', pill: 'background:#fcd34d;border-color:#eab308;color:#713f12' },
  };
  const base = styles[severity] || { row: '', border: '#e5e7eb', text: '#2563eb', pill: 'background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8' };
  return prpspStatus === 'Conditional-Not Sent'
    ? { ...base, row: 'background:#e9d5ff', border: '#c084fc' }
    : base;
}

function renderBuyerInvoiceEmailContent(template, report, settings) {
  return String(template || DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.intro)
    .replaceAll('{{reportStart}}', prettyDate(report.today))
    .replaceAll('{{reportEnd}}', prettyDate(report.dueThrough))
    .replaceAll('{{daysAhead}}', String(settings.daysAhead ?? report.daysAhead ?? DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.daysAhead));
}

function emailContentHtml(content) {
  if (hasHtmlMarkup(content)) return sanitizeReminderHtml(content);
  const blocks = String(content || '').split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (!blocks.length) return '';
  return blocks.map((block, index) => {
    const html = escapeHtml(block).replaceAll('\n', '<br>');
    if (index === 0) return `<h2 style="margin:0 0 6px;font-size:20px">${html}</h2>`;
    return `<p style="margin:0 0 14px;color:#667085">${html}</p>`;
  }).join('');
}

function buyerTraderFilterHtml(report, settings) {
  const options = report.buyerTraderOptions || [];
  if (!options.length) return '';
  const selected = new Set(report.hasBuyerTraderFilter ? (report.selectedBuyerTraders || []) : options);
  const allActive = selected.size === options.length;
  const allUrl = buyerInvoiceFilterUrl(settings, report, null);
  const allChip = `<a href="${escapeHtml(allUrl)}" style="display:inline-block;text-decoration:none;border:1px solid ${allActive ? '#2563eb' : '#d9e2ef'};border-radius:6px;padding:4px 10px;margin:0 6px 6px 0;font-size:12px;font-weight:600;${allActive ? 'background:#2563eb;color:#fff' : 'background:#f8fafc;color:#2563eb'}">All</a>`;
  const chips = options.map((name) => {
    const active = selected.has(name);
    const url = buyerInvoiceFilterUrl(settings, report, name);
    return `<a href="${escapeHtml(url)}" style="display:inline-block;text-decoration:none;border:1px solid ${active ? '#2563eb' : '#d9e2ef'};border-radius:6px;padding:4px 10px;margin:0 6px 6px 0;font-size:12px;font-weight:600;${active ? 'background:#2563eb;color:#fff' : 'background:#f8fafc;color:#2563eb'}">${escapeHtml(name)}</a>`;
  }).join('');
  return `
    <div style="margin:0 0 12px">
      <div style="font-size:11px;color:#667085;text-transform:uppercase;letter-spacing:.04em;font-weight:700;margin-bottom:6px">Open filtered view by Buyer Trader / Payment Handler</div>
      <div>${allChip}${chips}</div>
    </div>`;
}

function buildBuyerInvoiceReportEmail(report, settings) {
  const rows = report.rows || [];
  const overdue = rows.filter((row) => row.status === 'Overdue');
  const dueSoon = rows.filter((row) => row.status !== 'Overdue');
  const dueSoonLabel = `Due in ${Number(settings.daysAhead || report.daysAhead || 7).toLocaleString()} Days`;
  const content = renderBuyerInvoiceEmailContent(settings.intro, report, settings);
  const totals = {
    overdueCount: overdue.length,
    overdueReceivable: overdue.reduce((sum, row) => sum + Number(row.receivableBalance || 0), 0),
    dueSoonCount: dueSoon.length,
    dueSoonReceivable: dueSoon.reduce((sum, row) => sum + Number(row.receivableBalance || 0), 0),
  };
  const subject = `${settings.subject} - ${prettyDate(report.today)}`;
  const summaryHtml = settings.includeSummary ? `
    <table role="presentation" style="border-collapse:collapse;margin:18px 0;width:100%;max-width:620px">
      <tr>
        <td style="border:1px solid #d9e2ef;border-radius:8px 0 0 8px;padding:12px;background:#fff7f7">
          <div style="font-size:12px;color:#667085;text-transform:uppercase;letter-spacing:.04em">Overdue</div>
          <div style="font-size:20px;font-weight:700;color:#dc2626">${money(totals.overdueReceivable)} (${totals.overdueCount})</div>
        </td>
        <td style="border:1px solid #d9e2ef;border-left:0;border-radius:0 8px 8px 0;padding:12px;background:#f7fbff">
          <div style="font-size:12px;color:#667085;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(dueSoonLabel)}</div>
          <div style="font-size:20px;font-weight:700;color:#2563eb">${money(totals.dueSoonReceivable)} (${totals.dueSoonCount})</div>
        </td>
      </tr>
    </table>` : '';
  const tableRows = rows.map((row) => {
    const severity = overdueEmailStyles(row.daysUntilDue, row.prpspStatus);
    const cellStyle = `border-bottom:1px solid ${severity.border};padding:8px 10px`;
    return `
    <tr style="${severity.row}">
      <td style="${cellStyle};font-weight:600;white-space:nowrap">${escapeHtml(row.stemName)}</td>
      <td style="${cellStyle};min-width:180px">${escapeHtml(row.buyerName || '-')}</td>
      <td style="${cellStyle};min-width:150px">${escapeHtml(row.buyerBrokerNames || '-')}</td>
      <td style="${cellStyle};text-align:right;white-space:nowrap">${money(row.invoiceAmount)}</td>
      <td style="${cellStyle};text-align:right;font-weight:600;white-space:nowrap">${money(row.receivableBalance)}</td>
      <td style="${cellStyle};white-space:nowrap">${prettyDate(row.buyerInvoiceDueDate)}</td>
      <td style="${cellStyle};min-width:140px">${escapeHtml(row.buyerTraderInCharge || '-')}</td>
      <td style="${cellStyle};min-width:160px">${escapeHtml(row.paymentHandlerName || row.collection?.ownerName || '-')}</td>
      <td style="${cellStyle};min-width:160px">${escapeHtml(row.prpspStatus || '-')}</td>
      <td style="${cellStyle}">
        <span style="display:inline-block;border:1px solid;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:600;white-space:nowrap;${severity.pill}">${escapeHtml(row.status)}</span>
      </td>
      <td style="${cellStyle};text-align:right;font-weight:600;color:${severity.text};white-space:nowrap">${overdueDisplayValue(row.daysUntilDue)}</td>
    </tr>`;
  }).join('');
  const tableHtml = settings.includeTable ? `
    ${buyerTraderFilterHtml(report, settings)}
    <div style="max-height:420px;overflow:auto;border:1px solid #d9e2ef;border-radius:10px">
      <table style="border-collapse:collapse;width:100%;min-width:1260px;font-size:13px">
        <thead>
          <tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px;letter-spacing:.04em">
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Stem</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Buyer</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Buyer Broker</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:right;position:sticky;top:0;background:#f8fafc">Invoice Amount</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:right;position:sticky;top:0;background:#f8fafc">Receivable Balance</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Due Date</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Buyer Trader</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Payment Collection Handler</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">PSPRS</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:left;position:sticky;top:0;background:#f8fafc">Status</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:8px 10px;text-align:right;position:sticky;top:0;background:#f8fafc">Overdue</th>
          </tr>
        </thead>
        <tbody>${tableRows || '<tr><td colspan="11" style="padding:18px;text-align:center;color:#667085">No outstanding buyer invoices found.</td></tr>'}</tbody>
      </table>
    </div>` : '';
  const contentHtml = emailContentHtml(content);
  const hasAttentionMarker = /for your attention\./i.test(contentHtml);
  const contentText = hasHtmlMarkup(content) ? htmlToPlainText(content) : content;
  const reportBodyHtml = hasAttentionMarker && tableHtml
    ? `${insertAfterAttentionSentence(contentHtml, tableHtml)}${summaryHtml}`
    : `${contentHtml}${summaryHtml}${tableHtml}`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#1f2937;line-height:1.45">
      ${reportBodyHtml}
    </div>`;
  const tableText = rows.map((row) => `${row.stemName} | ${row.buyerName || '-'} | Buyer Broker ${row.buyerBrokerNames || '-'} | Receivable Balance ${money(row.receivableBalance)} | Due ${prettyDate(row.buyerInvoiceDueDate)} | Buyer Trader ${row.buyerTraderInCharge || '-'} | Payment Collection Handler ${row.paymentHandlerName || row.collection?.ownerName || '-'} | PSPRS ${row.prpspStatus || '-'} | ${row.status} | Overdue ${overdueDisplayValue(row.daysUntilDue)}`).join('\n');
  const introText = hasAttentionMarker && tableText
    ? insertAfterAttentionSentence(contentText, `\n\n${tableText}\n\n`)
    : contentText;
  const textLines = [
    introText,
    `Overdue: ${money(totals.overdueReceivable)} (${totals.overdueCount})`,
    `${dueSoonLabel}: ${money(totals.dueSoonReceivable)} (${totals.dueSoonCount})`,
    `Open all invoices: ${buyerInvoiceFilterUrl(settings, report, null)}`,
    ...((report.buyerTraderOptions || []).map((name) => `Open ${name}: ${buyerInvoiceFilterUrl(settings, report, name)}`)),
    '',
    ...(hasAttentionMarker ? [] : rows.map((row) => `${row.stemName} | ${row.buyerName || '-'} | Buyer Broker ${row.buyerBrokerNames || '-'} | Receivable Balance ${money(row.receivableBalance)} | Due ${prettyDate(row.buyerInvoiceDueDate)} | Buyer Trader ${row.buyerTraderInCharge || '-'} | Payment Collection Handler ${row.paymentHandlerName || row.collection?.ownerName || '-'} | PSPRS ${row.prpspStatus || '-'} | ${row.status} | Overdue ${overdueDisplayValue(row.daysUntilDue)}`)),
  ];
  return { subject, html, text: textLines.join('\n'), totals };
}

function reminderCandidateKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isFratelliCosulichBuyerGroup(value) {
  return /\bfratelli\s+cosulich\b/i.test(String(value || ''));
}

function isPaymentReminderCandidate(row, selected) {
  if (!row || !selected) return false;
  if (row.stemId === selected.stemId) return true;
  const selectedBuyer = reminderCandidateKey(selected.buyerName);
  const rowBuyer = reminderCandidateKey(row.buyerName);
  if (selectedBuyer && rowBuyer && selectedBuyer === rowBuyer) return true;
  const selectedGroup = reminderCandidateKey(selected.buyerGroupName);
  if (isFratelliCosulichBuyerGroup(selectedGroup)) return false;
  const rowGroup = reminderCandidateKey(row.buyerGroupName);
  return Boolean(selectedGroup && rowGroup && selectedGroup === rowGroup);
}

function rowBuyerReminderRecipients(row) {
  return uniqueEmailList(
    row?.paymentReminderRecipients || [],
    row?.paymentReminderRecipient || '',
    row?.buyerAccountsEmail || '',
    row?.buyerTraderEmail || '',
    row?.paymentHandlerEmail || '',
  );
}

function rowBrokerReminderEmails(row) {
  return uniqueEmailList(row?.buyerBrokerEmails || '');
}

function paymentReminderRowRouting(row) {
  const buyerRecipients = rowBuyerReminderRecipients(row);
  const brokerEmails = rowBrokerReminderEmails(row);
  const brokerNames = uniqueTextList(String(row?.buyerBrokerNames || '').split(','));
  const mode = row?.buyerBrokerRoutingMode || 'buyer_only';
  if (mode === 'broker_only') {
    return {
      mode,
      to: brokerEmails,
      cc: [],
      bcc: [],
      primaryRecipientName: brokerNames[0] || row?.buyerBrokerNames || 'Broker',
      warnings: row?.buyerBrokerRoutingWarnings || [],
    };
  }
  if (mode === 'buyer_cc_broker') {
    return {
      mode,
      to: buyerRecipients,
      cc: brokerEmails,
      bcc: [],
      primaryRecipientName: row?.buyerName || 'Customer',
      warnings: row?.buyerBrokerRoutingWarnings || [],
    };
  }
  return {
    mode: 'buyer_only',
    to: buyerRecipients,
    cc: [],
    bcc: brokerEmails,
    primaryRecipientName: row?.buyerName || 'Customer',
    warnings: row?.buyerBrokerRoutingWarnings || [],
  };
}

function paymentReminderRoutingForRows(rows = []) {
  const resultGroups = groupPaymentReminderRows(rows, paymentReminderRowRouting);
  return {
    groups: resultGroups,
    to: uniqueEmailList(...resultGroups.map((group) => group.to)),
    cc: uniqueEmailList(...resultGroups.map((group) => group.cc)),
    bcc: uniqueEmailList(...resultGroups.map((group) => group.bcc)),
    warnings: uniqueTextList(resultGroups.flatMap((group) => group.warnings)),
  };
}

function paymentReminderRecipients(rows) {
  return paymentReminderRoutingForRows(rows).to;
}

function paymentReminderTemplateContext(report, rows, selected, routing = null) {
  const totalReceivable = (rows || []).reduce((sum, row) => sum + Number(row.receivableBalance || 0), 0);
  const selectedRow = selected || {};
  const brokerRows = rows?.length ? rows : [selectedRow];
  const routingInfo = routing || paymentReminderRoutingForRows(rows || []).groups[0] || null;
  return {
    stemName: selectedRow.stemName || '',
    keyStem: selectedRow.keyStem || '',
    buyerName: selectedRow.buyerName || 'Customer',
    primaryRecipientName: routingInfo?.primaryRecipientName || selectedRow.buyerName || 'Customer',
    buyerGroupName: selectedRow.buyerGroupName || '',
    invoiceAmount: money(selectedRow.invoiceAmount),
    receivableBalance: money(selectedRow.receivableBalance),
    buyerInvoiceDueDate: prettyDate(selectedRow.buyerInvoiceDueDate),
    buyerTraderInCharge: selectedRow.buyerTraderInCharge || '',
    buyerAccountsEmail: selectedRow.buyerAccountsEmail || '',
    buyerTraderEmail: selectedRow.buyerTraderEmail || '',
    paymentHandlerName: selectedRow.paymentHandlerName || selectedRow.collection?.ownerName || '',
    paymentHandlerEmail: selectedRow.paymentHandlerEmail || '',
    buyerBrokerNames: uniqueTextList(brokerRows.map((row) => row.buyerBrokerNames)).join(', '),
    buyerBrokerEmails: uniqueEmailList(...brokerRows.map((row) => row.buyerBrokerEmails || '')).join(', '),
    buyerBrokerInvoiceFormats: uniqueTextList(brokerRows.map((row) => row.buyerBrokerInvoiceFormats)).join(', '),
    toRecipients: routingInfo ? routingInfo.to.join(', ') : paymentReminderRecipients(rows).join(', '),
    psprsStatus: selectedRow.prpspStatus || '',
    overdue: overdueDisplayValue(selectedRow.daysUntilDue),
    invoiceStatus: selectedRow.status || '',
    daysAhead: String(report.daysAhead ?? DEFAULT_BUYER_INVOICE_EMAIL_SETTINGS.daysAhead),
    today: prettyDate(report.today),
    dueThrough: prettyDate(report.dueThrough),
    invoiceCount: String((rows || []).length),
    totalReceivable: money(totalReceivable),
  };
}

function renderPaymentReminderTemplate(template, context) {
  const values = context || {};
  return String(template || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  ));
}

function renderPaymentReminderEmailList(value, context) {
  const raw = Array.isArray(value) ? value.join(', ') : String(value || '');
  return parseEmailList(renderPaymentReminderTemplate(raw, context), []);
}

function hasHtmlMarkup(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ''));
}

function sanitizeReminderHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

function htmlToPlainText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function paymentReminderContentHtml(content) {
  const html = hasHtmlMarkup(content)
    ? sanitizeReminderHtml(content)
    : String(content || '').split(/\n{2,}/).map((block) => `<p>${escapeHtml(block.trim()).replaceAll('\n', '<br>')}</p>`).join('');
  const matches = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  const paragraphs = matches.length
    ? matches.map((match) => match[1])
    : html.split(/<br\s*\/?>|\n{2,}/i).map((block) => escapeHtml(block.trim()));
  return paragraphs
    .map((inner) => inner.trim())
    .filter((inner) => htmlToPlainText(inner).trim())
    .map((inner) => {
      const text = htmlToPlainText(inner).replace(/\s+/g, ' ').trim().toLowerCase();
      let margin = '0 0 12px';
      if (/^to\s+/.test(text)) margin = '0 0 3px';
      else if (/^attn\b/.test(text)) margin = '0 0 18px';
      else if (/^regards,?/.test(text)) margin = '24px 0 3px';
      else if (/^fratelli\s+cosulich/.test(text)) margin = '0';
      return `<p style="margin:${margin};padding:0;color:#1f2937;line-height:1.35;text-align:left">${inner}</p>`;
    })
    .join('');
}

function insertAfterAttentionSentence(content, insertContent) {
  const source = String(content || '');
  const marker = /for your attention\./i.exec(source);
  if (!marker) return `${source}${insertContent}`;
  const afterMarker = marker.index + marker[0].length;
  const rest = source.slice(afterMarker);
  const paragraphClose = /<\/p>/i.exec(rest);
  if (paragraphClose && paragraphClose.index < 300) {
    const insertAt = afterMarker + paragraphClose.index + paragraphClose[0].length;
    return `${source.slice(0, insertAt)}${insertContent}${source.slice(insertAt)}`;
  }
  return `${source.slice(0, afterMarker)}\n\n${insertContent}${source.slice(afterMarker)}`;
}

function insertInvoiceTable(content, insertContent) {
  const source = String(content || '');
  if (INVOICE_TABLE_TOKEN_PATTERN.test(source)) {
    return source
      .replace(new RegExp(`<p\\b[^>]*>\\s*${INVOICE_TABLE_TOKEN_PATTERN.source}\\s*<\\/p>`, 'i'), insertContent)
      .replace(INVOICE_TABLE_TOKEN_PATTERN, insertContent);
  }
  return insertAfterAttentionSentence(source, insertContent);
}

function buildBuyerInvoicePaymentReminderEmail(report, settings, selected, rows, overrides = {}, routing = null) {
  const selectedRows = rows || [];
  const context = paymentReminderTemplateContext(report, selectedRows, selected, routing);
  const subject = renderPaymentReminderTemplate(overrides.subject || settings.paymentReminderSubject, context);
  const body = renderPaymentReminderTemplate(overrides.body || settings.paymentReminderBody, context);
  const tableRows = selectedRows.map((row) => {
    const severity = overdueEmailStyles(row.daysUntilDue, row.prpspStatus);
    const cellStyle = `border-bottom:1px solid ${severity.border};padding:7px 8px;vertical-align:top`;
    const nowrapCellStyle = `${cellStyle};white-space:nowrap`;
    return `
    <tr style="${severity.row}">
      <td style="${cellStyle};font-weight:600;min-width:150px">${escapeHtml(row.stemName)}</td>
      <td style="${cellStyle};min-width:110px">${escapeHtml(row.buyerName || '-')}</td>
      <td style="${nowrapCellStyle};text-align:right">${money(row.invoiceAmount)}</td>
      <td style="${nowrapCellStyle};text-align:right;font-weight:600">${money(row.receivableBalance)}</td>
      <td style="${nowrapCellStyle}">${prettyDate(row.buyerInvoiceDueDate)}</td>
      <td style="${cellStyle};min-width:84px">${escapeHtml(row.buyerTraderInCharge || '-')}</td>
      <td style="${cellStyle};min-width:86px">${escapeHtml(row.prpspStatus || '-')}</td>
      <td style="${nowrapCellStyle}">
        <span style="display:inline-block;border:1px solid;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:600;white-space:nowrap;${severity.pill}">${escapeHtml(row.status)}</span>
      </td>
      <td style="${nowrapCellStyle};text-align:right;font-weight:600;color:${severity.text}">${overdueDisplayValue(row.daysUntilDue)}</td>
    </tr>`;
  }).join('');
  const tableHtml = `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #d9e2ef;border-radius:10px;margin:14px 0 16px;max-width:100%">
      <table style="border-collapse:collapse;width:auto;min-width:100%;max-width:none;font-size:12px;line-height:1.25;table-layout:auto">
        <thead>
          <tr style="background:#f8fafc;color:#667085;text-transform:uppercase;font-size:11px;letter-spacing:.04em">
	            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Stem</th>
	            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Buyer</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Invoice</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Receivable</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Due Date</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Trader</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">PSPRS</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:left;white-space:nowrap">Status</th>
            <th style="border-bottom:1px solid #d9e2ef;padding:7px 8px;text-align:right;white-space:nowrap">Overdue</th>
          </tr>
        </thead>
        <tbody>${tableRows || '<tr><td colspan="9" style="padding:18px;text-align:center;color:#667085">No invoices selected.</td></tr>'}</tbody>
      </table>
    </div>`;
  const bodyHtml = paymentReminderContentHtml(body);
  const htmlWithTable = insertInvoiceTable(bodyHtml, tableHtml);
  const invoiceText = selectedRows.map((row) => `${row.stemName} | ${row.buyerName || '-'} | Receivable Balance ${money(row.receivableBalance)} | Due ${prettyDate(row.buyerInvoiceDueDate)} | PSPRS ${row.prpspStatus || '-'} | ${row.status} | Overdue ${overdueDisplayValue(row.daysUntilDue)} | Buyer Trader ${row.buyerTraderInCharge || '-'}`).join('\n');
  const bodyText = hasHtmlMarkup(body) ? htmlToPlainText(body) : body;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#1f2937;line-height:1.45">
      ${htmlWithTable}
    </div>`;
  const text = insertInvoiceTable(bodyText, `\n\n${invoiceText}\n\n`);
  return { subject, body, html, text };
}

async function loadBuyerInvoicePaymentReminderContext(body = {}, accessContext = null) {
  const stored = await loadStoredBuyerInvoiceEmailSettings();
  const settings = {
    ...buyerInvoiceEmailSettings(stored.settings),
    hasBuyerTraderFilter: (stored.settings.buyerTraders || []).length > 0,
  };
  const report = await salesforceBuyerInvoicesDue({
    daysAhead: body.daysAhead ?? settings.daysAhead,
  }, null, accessContext);
  if (report.paymentReminderRulesAvailable !== true) {
    throw appError('Buyer Invoice reminder rules are temporarily unavailable. External payment reminders are disabled until storage is restored.', 503);
  }
  const stemId = String(body.stemId || body.stem_id || '').trim();
  const selected = report.rows.find((row) => row.stemId === stemId);
  if (!selected) throw appError('Selected invoice is no longer in the current outstanding invoice window.', 404);
  const candidates = report.rows
    .filter((row) => isPaymentReminderCandidate(row, selected))
    .sort((a, b) => {
      if (a.buyerInvoiceDueDate !== b.buyerInvoiceDueDate) return a.buyerInvoiceDueDate.localeCompare(b.buyerInvoiceDueDate);
      return String(a.stemName || '').localeCompare(String(b.stemName || ''));
    });
  return { settings, report, selected, candidates };
}

async function buyerInvoicePaymentReminderPrepare(body, req, accessContext = null) {
  if (!accessContext) await requireActiveUser(req);
  const { settings, report, selected, candidates } = await loadBuyerInvoicePaymentReminderContext(body, accessContext);
  if (selected.paymentReminderEligible !== true) {
    throw appError(selected.paymentReminderBlockingReason || 'This invoice is not eligible for an external payment reminder.', 409);
  }
  const eligibleCandidates = candidates.filter((row) => row.paymentReminderEligible === true);
  const routing = paymentReminderRoutingForRows(eligibleCandidates);
  const firstGroup = routing.groups.find((group) => group.rows.some((row) => row.stemId === selected.stemId))
    || routing.groups[0]
    || { key: 'default', rows: eligibleCandidates, to: [], cc: [], bcc: [], primaryRecipientName: selected.buyerName || 'Customer', mode: 'buyer_only', warnings: [] };
  const firstSelected = firstGroup.rows.find((row) => row.stemId === selected.stemId) || firstGroup.rows[0] || selected;
  const email = buildBuyerInvoicePaymentReminderEmail(report, settings, firstSelected, firstGroup.rows, {}, firstGroup);
  const preparedGroups = routing.groups.map((group) => {
    const groupSelected = group.rows.find((row) => row.stemId === selected.stemId) || group.rows[0] || selected;
    const groupContext = paymentReminderTemplateContext(report, group.rows, groupSelected, group);
    return {
      mode: group.mode,
      key: group.key,
      to: group.to,
      cc: uniqueEmailList(group.cc, renderPaymentReminderEmailList(settings.paymentReminderCc, groupContext)),
      bcc: uniqueEmailList(group.bcc, renderPaymentReminderEmailList(settings.paymentReminderBcc, groupContext)),
      primaryRecipientName: group.primaryRecipientName,
      warnings: group.warnings,
      stemIds: group.rows.map((row) => row.stemId),
    };
  });
  const firstPreparedGroup = preparedGroups.find((group) => group.key === firstGroup.key)
    || preparedGroups[0]
    || { to: firstGroup.to, cc: firstGroup.cc, bcc: firstGroup.bcc };
  return {
    selected,
    candidates,
    to: firstPreparedGroup.to,
    allTo: routing.to,
    cc: firstPreparedGroup.cc,
    bcc: firstPreparedGroup.bcc,
    autoBcc: firstPreparedGroup.bcc,
    subject: settings.paymentReminderSubject,
    body: settings.paymentReminderBody,
    preview: { html: email.html, text: email.text },
    routingGroups: preparedGroups,
    routingWarnings: routing.warnings,
    settings: {
      paymentReminderToSource: 'Buyer account/trader/payment handler plus buyer broker Account.Email by Invoice Format',
      emailDelivery: serverEmailDeliveryStatus(),
      from: settings.from,
      daysAhead: report.daysAhead,
      paymentReminderCc: settings.paymentReminderCc,
      paymentReminderBcc: settings.paymentReminderBcc,
    },
  };
}

async function buyerInvoicePaymentReminderSend(body, req, accessContext = null) {
  if (!accessContext) await requireActiveUser(req);
  const { settings, report, selected, candidates } = await loadBuyerInvoicePaymentReminderContext(body, accessContext);
  const selectedStemIds = new Set((Array.isArray(body.invoiceStemIds) ? body.invoiceStemIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean));
  if (!selectedStemIds.size) throw appError('Select at least one invoice to include in the payment reminder.', 400);
  const selection = evaluateBuyerReminderSelection(candidates, [...selectedStemIds]);
  if (selection.unknownStemIds.length) {
    throw appError('The selected invoice list is stale or does not belong to this buyer reminder. Reopen the preview and review the current invoices.', 409);
  }
  if (selection.restrictedRows.length) {
    throw appError(
      selection.restrictedRows[0].paymentReminderBlockingReason
        || 'One or more selected invoices are no longer eligible for an external payment reminder. Reopen the preview.',
      409,
    );
  }
  const rows = selection.rows;

  const routing = paymentReminderRoutingForRows(rows);
  if (!routing.groups.length) throw appError('No payment reminder recipient group could be built.', 400);
  if (!Array.isArray(body.recipientBatches)) {
    throw appError('Reviewed email recipient fields are required. Reopen the payment reminder preview and confirm each email batch before sending.', 400);
  }
  const reviewedRecipientBatches = new Map(body.recipientBatches
    .filter((batch) => batch?.key)
    .map((batch) => [batch.key, batch]));
  const sharedSmtp = { user: process.env.SMTP_USER };
  const configuredFrom = process.env.PAYMENT_REMINDER_FROM || settings.from;
  const smtpFrom = smtpAuthenticatedFromAddress(sharedSmtp, configuredFrom) || configuredFrom;
  const sendResults = [];
  const collectionResults = [];
  const collectionWarnings = [];
  for (const group of routing.groups) {
    const groupSelected = group.rows.find((row) => row.stemId === selected.stemId) || group.rows[0] || selected;
    const reviewedBatch = reviewedRecipientBatches.get(group.key);
    if (!reviewedBatch) {
      throw appError(`Reviewed recipient fields are missing for ${group.primaryRecipientName || 'recipient group'}. Reopen the preview and confirm recipients before sending.`, 400);
    }
    const to = uniqueEmailList(reviewedBatch.to || '');
    const effectiveGroup = { ...group, to };
    const cc = uniqueEmailList(reviewedBatch.cc || '');
    const bcc = uniqueEmailList(reviewedBatch.bcc || '');
    if (!to.length) throw appError(`Payment reminder recipient is required for ${group.primaryRecipientName || 'recipient group'}.`, 400);
    const email = buildBuyerInvoicePaymentReminderEmail(report, settings, groupSelected, group.rows, {
      subject: body.subject,
      body: body.body,
    }, effectiveGroup);
    let result;
    try {
      const delivery = await sendWithSmtpSendAsFallback({
        smtp: sharedSmtp,
        from: smtpFrom,
        to,
        cc,
        bcc,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      result = delivery.result;
    } catch (error) {
      console.error('[buyerInvoicePaymentReminderSend] email provider failed', {
        message: error.message,
        provider: 'smtp',
        sharedServerSender: true,
        hasSmtpEnv: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD),
        toCount: to.length,
        ccCount: cc.length,
        bccCount: bcc.length,
        rows: group.rows.length,
        routingMode: group.mode,
      });
      throw error;
    }
    sendResults.push({ result, to, cc, bcc, subject: email.subject, rows: group.rows.length, mode: group.mode });

    const note = [
      `Payment reminder sent to ${to.join(', ')}${cc.length ? ` (cc ${cc.join(', ')})` : ''}${bcc.length ? ` (bcc ${bcc.join(', ')})` : ''}.`,
      `Subject: ${email.subject}`,
      `Routing: ${group.mode}`,
      `Included invoices: ${group.rows.length}`,
    ].join('\n');
    for (const row of group.rows) {
      const currentStatus = row.collection?.status || 'Not Started';
      const nextStatus = currentStatus === 'Not Started' ? 'Reminder Sent' : currentStatus;
      const ownerName = row.collection?.ownerName || splitBuyerTraderNames(row.buyerTraderInCharge)[0] || '';
      try {
        const collectionResult = await persistBuyerInvoiceCollection({
          stemId: row.stemId,
          expectedUpdatedAt: row.collection?.updatedAt || null,
          updates: {
            status: nextStatus,
            ownerName,
            latestNote: note,
          },
          event: {
            eventType: currentStatus === 'Not Started' ? 'status_change' : 'note',
            status: nextStatus,
            ownerName,
            note,
          },
        }, req, null, accessContext);
        collectionResults.push(collectionResult);
      } catch (error) {
        collectionWarnings.push({ stemId: row.stemId, error: error.message });
      }
    }
  }

  return {
    sent: true,
    id: sendResults[0]?.result?.id || sendResults[0]?.result?.messageId || null,
    emails: sendResults.length,
    batches: sendResults.map((item) => ({
      to: item.to,
      cc: item.cc,
      bcc: item.bcc,
      subject: item.subject,
      rows: item.rows,
      mode: item.mode,
    })),
    to: uniqueEmailList(...sendResults.map((item) => item.to)),
    cc: uniqueEmailList(...sendResults.map((item) => item.cc)),
    bcc: uniqueEmailList(...sendResults.map((item) => item.bcc)),
    subject: sendResults[0]?.subject || null,
    rows: rows.length,
    collectionResults,
    collectionWarnings,
  };
}

async function sendWithSmtp({ smtp = {}, from, to, cc, bcc, subject, html, text }) {
  requireExternalActionGate('email_delivery');
  const host = smtp.host || process.env.SMTP_HOST;
  const port = Number(smtp.port || process.env.SMTP_PORT || 587);
  const user = smtp.user || process.env.SMTP_USER;
  const pass = smtp.password || smtp.pass || process.env.SMTP_PASSWORD;
  const secure = smtp.secure != null
    ? smtp.secure === true || smtp.secure === 'true'
    : process.env.SMTP_SECURE != null
      ? process.env.SMTP_SECURE === 'true'
      : port === 465;
  if (!host || !user || !pass) {
    throw new Error('Missing SMTP credentials. Enter SMTP host, username, and password, or configure SMTP_HOST, SMTP_USER, and SMTP_PASSWORD in Vercel.');
  }
  const nodemailer = await import('nodemailer');
  const createTransport = nodemailer.createTransport || nodemailer.default?.createTransport;
  if (!createTransport) throw new Error('SMTP email library failed to load.');
  const transporter = createTransport({
    host,
    port,
    secure: Boolean(secure),
    auth: { user, pass },
  });
  const result = await transporter.sendMail({ from, to, cc, bcc, subject, html, text });
  return { id: result.messageId, accepted: result.accepted, rejected: result.rejected };
}

function smtpAddressParts(value) {
  const raw = String(value || '').trim();
  if (!raw) return { name: '', email: '' };
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const name = email ? raw.replace(email, '').replace(/[<>()"]/g, '').trim() : '';
  return { name, email };
}

function smtpAuthenticatedFromAddress(smtp = {}, requestedFrom = '') {
  const authenticatedEmail = smtpAddressParts(smtp.user).email;
  if (!authenticatedEmail) return '';
  const requested = smtpAddressParts(requestedFrom);
  return requested.name ? `${requested.name} <${authenticatedEmail}>` : authenticatedEmail;
}

function isSmtpSendAsDenied(error) {
  return /SendAsDenied|MapiExceptionSendAsDenied|not allowed to send as/i.test(String(error?.message || error || ''));
}

function smtpSendAsDeniedError(smtp = {}, requestedFrom = '') {
  const authenticatedEmail = smtpAddressParts(smtp.user).email || 'the authenticated SMTP mailbox';
  const requestedEmail = smtpAddressParts(requestedFrom).email || 'the configured From address';
  return appError(`Microsoft 365 rejected ${requestedEmail} as the sender. Use ${authenticatedEmail} as From Email or grant that mailbox Send As permission.`, 400);
}

async function sendWithSmtpSendAsFallback(options) {
  try {
    return { result: await sendWithSmtp(options), from: options.from, sendAsFallback: false };
  } catch (error) {
    if (!isSmtpSendAsDenied(error)) throw error;
    const authenticatedFrom = smtpAuthenticatedFromAddress(options.smtp, options.from);
    const requestedEmail = smtpAddressParts(options.from).email.toLowerCase();
    const authenticatedEmail = smtpAddressParts(authenticatedFrom).email.toLowerCase();
    if (!authenticatedFrom || !authenticatedEmail || requestedEmail === authenticatedEmail) {
      throw smtpSendAsDeniedError(options.smtp, options.from);
    }
    try {
      return {
        result: await sendWithSmtp({ ...options, from: authenticatedFrom }),
        from: authenticatedFrom,
        sendAsFallback: true,
      };
    } catch (retryError) {
      if (isSmtpSendAsDenied(retryError)) throw smtpSendAsDeniedError(options.smtp, authenticatedFrom);
      throw retryError;
    }
  }
}

async function startBuyerInvoiceEmailRun(window) {
  const client = safeSupabaseAdminClient();
  if (!client) return { allowed: true, run: null };
  const { data, error } = await client
    .from('buyer_invoice_email_runs')
    .insert({
      run_key: window.runKey,
      schedule_time: window.time,
      status: 'running',
    })
    .select('id,run_key,status,created_at')
    .single();
  if (error?.code === '23505') return { allowed: false, duplicate: true };
  if (error) throw error;
  return { allowed: true, run: data };
}

async function finishBuyerInvoiceEmailRun(runKey, patch = {}) {
  const client = safeSupabaseAdminClient();
  if (!client || !runKey) return;
  const { error } = await client
    .from('buyer_invoice_email_runs')
    .update({
      ...patch,
      completed_at: new Date().toISOString(),
    })
    .eq('run_key', runKey);
  if (error) console.error('Failed to update buyer invoice email run', error.message);
}

function requireCronAuthorization(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw appError('Missing CRON_SECRET in Vercel.', 500);
  const header = req?.headers?.authorization || req?.headers?.Authorization || '';
  if (String(header) !== `Bearer ${secret}`) throw appError('Unauthorized cron request.', 401);
}

async function outstandingBuyerInvoicesEmailReport(body = {}, req = null, accessContext = null) {
  if (!body.scheduled) await requireActiveUser(req);
  const hasExplicitSettings = Boolean(body.settings) || ['from', 'to', 'cc', 'daysAhead', 'subject', 'intro', 'includeSummary', 'includeTable', 'buyerTraders', 'weekdays', 'sendTimes', 'appUrl']
    .some((key) => Object.prototype.hasOwnProperty.call(body, key));
  const stored = hasExplicitSettings ? null : await loadStoredBuyerInvoiceEmailSettings();
  const explicitSettings = hasExplicitSettings ? buyerInvoiceEmailSettings(body.settings || body) : null;
  if (explicitSettings && (body.settings || body).hasBuyerTraderFilter === false) explicitSettings.hasBuyerTraderFilter = false;
  const settings = hasExplicitSettings
    ? explicitSettings
    : {
        ...buyerInvoiceEmailSettings(stored.settings),
        hasBuyerTraderFilter: (stored.settings.buyerTraders || []).length > 0,
      };
  if (!body.preview && !body.dryRun && !body.force && !isBuyerInvoiceReportDue(settings)) {
    return {
      sent: false,
      skipped: true,
      reason: 'Current Hong Kong time is outside the configured report schedule.',
      schedule: { weekdays: settings.weekdays, sendTimes: settings.sendTimes, now: hongKongScheduleParts() },
    };
  }
  const reportPayload = { daysAhead: settings.daysAhead };
  if (settings.hasBuyerTraderFilter) reportPayload.buyerTraders = settings.buyerTraders;
  const report = await salesforceBuyerInvoicesDue(reportPayload, null, accessContext);
  const email = buildBuyerInvoiceReportEmail(report, settings);
  if (body.preview || body.dryRun) {
    await updateBuyerInvoiceEmailSettingsMeta({
      last_preview_at: new Date().toISOString(),
      last_preview_row_count: report.rows.length,
      last_error: null,
    });
    return {
      sent: false,
      preview: true,
      settings: { ...settings, to: settings.to, cc: settings.cc },
      report: {
        rows: report.rows,
        today: report.today,
        dueThrough: report.dueThrough,
        daysAhead: report.daysAhead,
        buyerTraderOptions: report.buyerTraderOptions,
        selectedBuyerTraders: report.selectedBuyerTraders,
        hasBuyerTraderFilter: report.hasBuyerTraderFilter,
      },
      email: { subject: email.subject, html: email.html, text: email.text, totals: email.totals },
    };
  }
  const smtpFrom = smtpAuthenticatedFromAddress({ user: process.env.SMTP_USER }, settings.from) || settings.from;
  let result;
  try {
    result = await sendWithSmtp({
      from: smtpFrom,
      to: settings.to,
      cc: settings.cc,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  } catch (error) {
    await updateBuyerInvoiceEmailSettingsMeta({ last_error: error.message });
    throw error;
  }
  await updateBuyerInvoiceEmailSettingsMeta({
    last_sent_at: new Date().toISOString(),
    last_sent_row_count: report.rows.length,
    last_error: null,
  });
  return {
    sent: true,
    id: result.id,
    to: settings.to,
    cc: settings.cc,
    subject: email.subject,
    rows: report.rows.length,
    totals: email.totals,
  };
}

async function outstandingBuyerInvoicesEmailCron(body, req) {
  requireCronAuthorization(req);
  if (!isExternalActionEnabled('email_delivery')) {
    return {
      sent: false,
      skipped: true,
      gated: true,
      reason: 'Scheduled email delivery has been paused by an emergency operational control.',
    };
  }
  const stored = await loadStoredBuyerInvoiceEmailSettings();
  const settings = {
    ...buyerInvoiceEmailSettings(stored.settings),
    hasBuyerTraderFilter: (stored.settings.buyerTraders || []).length > 0,
  };
  if (settings.enabled === false) return { sent: false, skipped: true, reason: 'Email schedule is disabled.' };

  const window = buyerInvoiceScheduledWindow(settings);
  if (!window) {
    return {
      sent: false,
      skipped: true,
      reason: 'Current Hong Kong time is outside the configured report schedule.',
      schedule: { weekdays: settings.weekdays, sendTimes: settings.sendTimes, now: hongKongScheduleParts() },
    };
  }

  const run = await startBuyerInvoiceEmailRun(window);
  if (!run.allowed) return { sent: false, skipped: true, duplicate: true, runKey: window.runKey };

  try {
    const result = await outstandingBuyerInvoicesEmailReport({ settings, force: true, scheduled: true });
    await finishBuyerInvoiceEmailRun(window.runKey, {
      status: 'sent',
      rows_count: result.rows,
      totals: result.totals || {},
      provider_result: { id: result.id || null, to: result.to || [], cc: result.cc || [], subject: result.subject || null },
    });
    return { ...result, scheduled: true, runKey: window.runKey };
  } catch (error) {
    await finishBuyerInvoiceEmailRun(window.runKey, {
      status: 'failed',
      error: error.message,
    });
    throw error;
  }
}

async function salesforceDisputeStems(body, req = null, accessContext = null) {
  const limit = Math.max(100, Math.min(Number(body.limit) || 5000, 10000));
  const requestedStemId = isSalesforceId(String(body.stemId || '').trim()) ? String(body.stemId).trim() : null;
  const describe = await salesforceObjectFields({ objectName: 'stem__c' });
  const fieldNames = describe.fields.map((f) => f.name);
  const interofficeCondition = await interofficeStemAccessCondition(accessContext, fieldNames);
  const hasDispute = fieldNames.includes('Dispute__c');
  const hasDisputeStatus = fieldNames.includes('Dispute_Status__c');
  if (!hasDispute && !hasDisputeStatus) return { rows: [] };
  const supplierInvoiceDescribe = await salesforceObjectFields({ objectName: 'Supplier_Invoice__c' }).catch(() => ({ fields: [] }));
  const supplierInvoiceFields = supplierInvoiceDescribe.fields || [];
  const supplierInvoiceFieldNames = supplierInvoiceFields.map((f) => f.name);
  const supplierInvoiceFieldByName = Object.fromEntries(supplierInvoiceFields.map((field) => [field.name, field]));
  const paymentDescribe = await salesforceObjectFields({ objectName: 'Payment__c' }).catch(() => ({ fields: [] }));
  const paymentFields = paymentDescribe.fields || [];
  const paymentFieldNames = new Set(paymentFields.map((field) => field.name));
  const supplierSettlementSchema = resolveSupplierSettlementSchema({
    supplierInvoiceFields,
    paymentFields,
  });
  const supplierInvoicePayableField = supplierSettlementSchema.invoicePayableField;
  const supplierInvoiceAmountFields = supplierSettlementSchema.invoiceAmountField
    ? [supplierSettlementSchema.invoiceAmountField]
    : [];
  const supplierInvoiceDueDateFields = supplierSettlementSchema.invoiceDueDateFields;
  const supplierInvoiceDateFields = supplierSettlementSchema.invoiceDateFields;
  const supplierInvoiceStatusFields = supplierSettlementSchema.invoiceStatusFields;
  const supplierInvoiceSupplierFields = supplierSettlementSchema.supplierAccountFields;
  const supplierInvoiceSupplierNameRelationships = supplierInvoiceSupplierFields
    .map((field) => supplierInvoiceFieldByName[field]?.relationshipName)
    .filter(Boolean);
  const lineItemDescribe = await salesforceObjectFields({ objectName: 'STEM_Line_Item__c' }).catch(() => ({ fields: [] }));
  const originalSupplierLookup = resolveOriginalSupplierLookup(lineItemDescribe.fields || []);
  const originalSupplierRelationship = originalSupplierLookup.relationshipName || 'Original_Supplier__r';
  const extraCostDescribe = await salesforceObjectFields({ objectName: 'STEM_Extra_Cost__c' }).catch(() => ({ fields: [] }));
  const extraCostFields = extraCostDescribe.fields || [];
  const extraCostFieldNames = new Set(extraCostFields.map((field) => field.name));
  const extraCostSupplierLookup = resolveExtraCostSupplierLookup(extraCostFields);
  const extraCostSupplierField = extraCostSupplierLookup.fieldName;
  const extraCostSupplierRelationship = extraCostSupplierLookup.relationshipName;

  const fields = ['Id', 'Name', 'CreatedDate', 'LastModifiedDate'];
  for (const field of [
    'KeyStem__c',
    'Delivery_Date__c',
    'Expected_Delivery_Date__c',
    'ETA_Start_Date__c',
    'Buyer_Pay_Term_Date__c',
    'Invoice_Due_Date__c',
    'Due_Date__c',
    'Buyer_Name__c',
    'Buyer__c',
    'Account__c',
    'Dispute__c',
    'Dispute_Status__c',
    'Total_Invoice_Amount__c',
    'Total_Invoiced_Amount_From_Suppliers__c',
    'Payable_Balance__c',
    'Receivable_Balance__c',
    'QLIK_STEM_Line_Item_Total_Cost__c',
    'QLIK_Costs_Total_Cost__c',
  ]) {
    if (fieldNames.includes(field)) fields.push(field);
  }
  if (fieldNames.includes('Vessel__c')) fields.push('Vessel__r.Name');
  if (fieldNames.includes('Port__c')) fields.push('Port__r.Name');
  if (fieldNames.includes('Account__c')) fields.push('Account__r.Name');

  const activeDisputeStatusCondition = "(Dispute_Status__c != null AND Dispute_Status__c != 'No Dispute' AND Dispute_Status__c != 'No Disputes' AND Dispute_Status__c != 'no dispute' AND Dispute_Status__c != 'no disputes')";
  const disputeCondition = hasDisputeStatus
    ? activeDisputeStatusCondition
    : 'Dispute__c = true';
  const stemWhere = combineWhereConditions([
    disputeCondition,
    interofficeCondition,
    requestedStemId ? `Id = '${escapeSoql(requestedStemId)}'` : '',
  ]);
  const rows = await queryRows(`
    SELECT ${[...new Set(fields)].join(', ')}
    FROM stem__c
    WHERE ${stemWhere}
    ORDER BY LastModifiedDate DESC
    LIMIT ${limit}
  `, { limit, softFail: true });

  const stemIds = rows.map((stem) => stem.Id).filter(Boolean);
  const lineItemsByStem = {};
  const extraCostsByStem = {};
  const supplierInvoicesByStem = {};
  const supplierInvoicePayableByStem = {};
  const supplierPaymentsByInvoice = {};

  if (stemIds.length) {
    const [lineItemArrays, extraCostArrays, supplierInvoiceArrays] = await Promise.all([
      Promise.all(chunkIds(stemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        return queryRows(`
          SELECT Id, STEM__c, Product__r.Name, Supplier_Name__c,
                 ${originalSupplierLookup.valid ? `Original_Supplier__c, ${originalSupplierRelationship}.Name,` : ''}
                 Payment_Term__c, Quantity__c, Quantity_Delivered_Per_BDN__c,
                 Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c,
                 Price_Per_Unit__c, Cost_Per_Unit__c, Unit_Sell_At__c, Unit_Buy_At__c, Unit_Cost__c,
                 Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Cancelled__c,
                 Offer_Line_Item__r.UnitPrice, Offer_Line_Item__r.Supplier_Unit_Price__c
          FROM STEM_Line_Item__c
          WHERE STEM__c IN (${inList})
          ORDER BY STEM__c, CreatedDate ASC
          LIMIT 5000
        `, { limit: 5000, softFail: true });
      })),
      Promise.all(chunkIds(stemIds).map((chunk) => {
        const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
        const extraCostSelectFields = [
          'Id', 'STEM__c', 'Supplier_Name__c', 'Quantity__c', 'Quantity_Delivered_Per_BDN__c',
          'Quantity_in_MT__c', 'Quantity_Range_Max__c', 'Is_Quantity_Range__c',
          'Unit_Price__c', 'Unit_Cost__c', 'Line_Total__c', 'Line_Total_Buy__c',
          'Supplier_Invoice__c', 'Cancelled__c',
          extraCostFieldNames.has('Payment_Term__c') ? 'Payment_Term__c' : null,
          extraCostFieldNames.has('Product2Id__c') ? 'Product2Id__r.Name' : null,
          extraCostSupplierLookup.valid ? extraCostSupplierField : null,
          extraCostSupplierLookup.valid && extraCostSupplierRelationship ? `${extraCostSupplierRelationship}.Name` : null,
        ].filter(Boolean);
        return queryRows(`
          SELECT ${[...new Set(extraCostSelectFields)].join(', ')}
          FROM STEM_Extra_Cost__c
          WHERE STEM__c IN (${inList})
          LIMIT 5000
        `, { limit: 5000, softFail: true });
      })),
      supplierInvoiceFieldNames.includes('STEM__c')
        ? Promise.all(chunkIds(stemIds).map((chunk) => {
            const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
            const supplierInvoiceSelectFields = [
              'STEM__c',
              'Id',
              'Name',
              'CreatedDate',
              'LastModifiedDate',
              ...supplierInvoiceAmountFields,
              ...supplierInvoiceDueDateFields,
              ...supplierInvoiceDateFields,
              ...supplierInvoiceStatusFields,
              supplierInvoicePayableField,
              supplierInvoiceFieldNames.includes('CurrencyIsoCode') ? 'CurrencyIsoCode' : null,
              supplierInvoiceFieldNames.includes('Supplier_Name__c') ? 'Supplier_Name__c' : null,
              ...supplierInvoiceSupplierFields,
              ...supplierInvoiceSupplierNameRelationships.map((relationship) => `${relationship}.Name`),
            ].filter(Boolean);
            return queryRows(`
              SELECT ${[...new Set(supplierInvoiceSelectFields)].join(', ')}
              FROM Supplier_Invoice__c
              WHERE STEM__c IN (${inList})
              LIMIT 5000
            `, { limit: 5000, softFail: true });
          }))
        : Promise.resolve([]),
    ]);

    for (const item of lineItemArrays.flat()) {
      if (!item.STEM__c) continue;
      if (!lineItemsByStem[item.STEM__c]) lineItemsByStem[item.STEM__c] = [];
      lineItemsByStem[item.STEM__c].push(item);
    }
    for (const item of extraCostArrays.flat()) {
      if (!item.STEM__c) continue;
      if (!extraCostsByStem[item.STEM__c]) extraCostsByStem[item.STEM__c] = [];
      extraCostsByStem[item.STEM__c].push(item);
    }
    for (const invoice of supplierInvoiceArrays.flat()) {
      if (!invoice.STEM__c) continue;
      if (!supplierInvoicesByStem[invoice.STEM__c]) supplierInvoicesByStem[invoice.STEM__c] = [];
      supplierInvoicesByStem[invoice.STEM__c].push(invoice);
      if (supplierInvoicePayableField == null) continue;
      supplierInvoicePayableByStem[invoice.STEM__c] = (supplierInvoicePayableByStem[invoice.STEM__c] || 0) + Number(invoice[supplierInvoicePayableField] || 0);
    }

    const supplierInvoiceIds = supplierInvoiceArrays.flat().map((invoice) => invoice.Id).filter(isSalesforceId);
    if (supplierInvoiceIds.length && supplierSettlementSchema.paymentSupplierInvoiceFields.length && supplierSettlementSchema.paymentAmountField) {
      const paymentSelectFields = [
        'Id',
        paymentFieldNames.has('Name') ? 'Name' : null,
        paymentFieldNames.has('CreatedDate') ? 'CreatedDate' : null,
        paymentFieldNames.has('CurrencyIsoCode') ? 'CurrencyIsoCode' : null,
        supplierSettlementSchema.paymentAmountField,
        supplierSettlementSchema.paymentDateField,
        ...supplierSettlementSchema.paymentSupplierInvoiceFields,
        ...supplierSettlementSchema.paymentStatusFields,
      ].filter(Boolean);
      await Promise.all(supplierSettlementSchema.paymentSupplierInvoiceFields.map(async (lookupField) => {
        const paymentChunks = await Promise.all(chunkIds(supplierInvoiceIds).map((chunk) => {
          const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
          return queryRows(`
            SELECT ${[...new Set(paymentSelectFields)].join(', ')}
            FROM Payment__c
            WHERE ${lookupField} IN (${inList})
            ORDER BY ${supplierSettlementSchema.paymentDateField || 'CreatedDate'} DESC NULLS LAST
            LIMIT 5000
          `, { limit: 5000, softFail: true });
        }));
        for (const payment of paymentChunks.flat()) {
          if (!validSupplierSettlementPayment(payment, supplierSettlementSchema.paymentStatusFields)) continue;
          const invoiceId = payment[lookupField];
          if (!isSalesforceId(invoiceId)) continue;
          if (!supplierPaymentsByInvoice[invoiceId]) supplierPaymentsByInvoice[invoiceId] = [];
          if (supplierPaymentsByInvoice[invoiceId].some((existing) => existing.id === payment.Id)) continue;
          supplierPaymentsByInvoice[invoiceId].push({
            id: payment.Id,
            name: payment.Name || payment.Id,
            amount: Number(payment[supplierSettlementSchema.paymentAmountField] || 0),
            date: payment[supplierSettlementSchema.paymentDateField] || payment.CreatedDate || null,
            currencyIsoCode: payment.CurrencyIsoCode || 'USD',
            status: supplierSettlementSchema.paymentStatusFields.map((field) => payment[field]).find(Boolean) || null,
          });
        }
      }));
    }

  }

  return {
    rows: rows
      .filter((stem) => !hasDisputeStatus || !['no dispute', 'no disputes'].includes(String(stem.Dispute_Status__c || '').toLowerCase()))
      .map((stem) => {
        const stemHasDelivery = !!stem.Delivery_Date__c;
        const lineItems = lineItemsByStem[stem.Id] || [];
        const extraCosts = extraCostsByStem[stem.Id] || [];
        const supplierInvoices = supplierInvoicesByStem[stem.Id] || [];
        const supplierNames = new Set();
        const productNames = new Set();
        const supplierProductPairs = [];
        const supplierProductPairKeys = new Set();
        const supplierInvoiceProductRowsById = new Map();
        const uninvoicedExtraCostProductRows = [];
        const supplierLineBuyByAccount = new Map();
        const uninvoicedSupplierLineBuyByAccount = new Map();
        let lineSellTotal = 0;
        let supplierLineBuy = 0;
        let uninvoicedSupplierLineBuy = 0;
        let extraSellTotal = 0;
        let extraCostBuy = 0;
        let invoicedExtraCostBuy = 0;
        let sellOnlyExtraSell = 0;
        let hasSupplierInvoice = false;

        for (const item of lineItems) {
          if (item.Cancelled__c) continue;
          const originalSupplierAccountId = item.Original_Supplier__c || null;
          const originalSupplierAccountKey = disputeSalesforceIdKey(originalSupplierAccountId);
          const originalSupplierName = item[originalSupplierRelationship]?.Name || item.Supplier_Name__c || originalSupplierAccountId || null;
          if (originalSupplierName) supplierNames.add(originalSupplierName);
          const productName = item['Product__r']?.Name;
          if (productName) productNames.add(productName);
          const quantityLabel = lineItemQuantityLabel(item, stemHasDelivery);
          if (item.Supplier_Invoice__c) {
            const invoiceRows = supplierInvoiceProductRowsById.get(item.Supplier_Invoice__c) || [];
            invoiceRows.push({
              productName: productName || item.Name || 'Product',
              quantityLabel,
              supplierName: originalSupplierName,
              supplierAccountId: originalSupplierAccountId,
              paymentTerm: item.Payment_Term__c || null,
            });
            supplierInvoiceProductRowsById.set(item.Supplier_Invoice__c, invoiceRows);
          }
          if (originalSupplierName || productName) {
            const pairKey = `${originalSupplierAccountKey || originalSupplierName || ''}\u0000${productName || ''}`;
            if (!supplierProductPairKeys.has(pairKey)) {
              supplierProductPairKeys.add(pairKey);
              supplierProductPairs.push({
                supplierName: originalSupplierName,
                supplierAccountId: originalSupplierAccountId,
                productName: productName || null,
              });
            }
          }
          lineSellTotal += lineSellAmount(item, stemHasDelivery);
          const buy = lineBuyAmount(item, stemHasDelivery);
          supplierLineBuy += buy;
          if (originalSupplierAccountKey) {
            const supplierLine = supplierLineBuyByAccount.get(originalSupplierAccountKey) || {
              accountId: originalSupplierAccountId,
              supplierName: originalSupplierName,
              amount: 0,
            };
            supplierLine.amount += buy;
            supplierLineBuyByAccount.set(originalSupplierAccountKey, supplierLine);
          }
          if (item.Supplier_Invoice__c) {
            hasSupplierInvoice = true;
          } else {
            uninvoicedSupplierLineBuy += buy;
            if (originalSupplierAccountKey) {
              const supplierLine = uninvoicedSupplierLineBuyByAccount.get(originalSupplierAccountKey) || {
                accountId: originalSupplierAccountId,
                supplierName: originalSupplierName,
                amount: 0,
              };
              supplierLine.amount += buy;
              uninvoicedSupplierLineBuyByAccount.set(originalSupplierAccountKey, supplierLine);
            }
          }
        }

        for (const item of extraCosts) {
          if (item.Cancelled__c) continue;
          const productName = disputeQueueExtraCostProductName(item);
          const supplierAccountId = extraCostSupplierField ? item[extraCostSupplierField] : null;
          const supplierAccountKey = disputeSalesforceIdKey(supplierAccountId);
          const supplierName = (extraCostSupplierRelationship ? item[extraCostSupplierRelationship]?.Name : null)
            || item.Supplier_Name__c
            || supplierAccountId
            || null;
          if (productName) productNames.add(productName);
          if (supplierName || productName) {
            const pairKey = `${supplierAccountKey || supplierName || ''}\u0000${productName || ''}`;
            if (!supplierProductPairKeys.has(pairKey)) {
              supplierProductPairKeys.add(pairKey);
              supplierProductPairs.push({
                supplierName,
                supplierAccountId,
                productName,
              });
            }
          }
          if (productName) {
            const productRow = {
              productName,
              quantityLabel: null,
              supplierName,
              supplierAccountId,
              paymentTerm: item.Payment_Term__c || null,
              sourceType: 'extra_cost',
              sourceRecordId: item.Id,
            };
            if (item.Supplier_Invoice__c) {
              const invoiceRows = supplierInvoiceProductRowsById.get(item.Supplier_Invoice__c) || [];
              invoiceRows.push(productRow);
              supplierInvoiceProductRowsById.set(item.Supplier_Invoice__c, invoiceRows);
            } else {
              uninvoicedExtraCostProductRows.push({
                supplierInvoiceId: null,
                invoiceName: null,
                ...productRow,
                dueDate: null,
                productQuantityLabel: [productRow.productName, productRow.quantityLabel].filter(Boolean).join(' - '),
              });
            }
          }
          const buy = extraBuyAmount(item, stemHasDelivery);
          const sell = extraSellAmount(item, stemHasDelivery);
          extraSellTotal += sell;
          if (item.Supplier_Invoice__c) {
            invoicedExtraCostBuy += buy;
          } else {
            extraCostBuy += buy;
            if (buy === 0 && sell > 0) sellOnlyExtraSell += sell;
          }
        }

        const supplierBase = Number(stem.Total_Invoiced_Amount_From_Suppliers__c || 0)
          + (hasSupplierInvoice ? uninvoicedSupplierLineBuy : supplierLineBuy);
        const rawSupplier = supplierBase + extraCostBuy;
        const unmatchedSellOnlyExtra = hasSupplierInvoice ? Math.max(0, sellOnlyExtraSell - invoicedExtraCostBuy) : 0;
        const qlikSupplierCost = stem.QLIK_STEM_Line_Item_Total_Cost__c != null || stem.QLIK_Costs_Total_Cost__c != null
          ? (stem.QLIK_STEM_Line_Item_Total_Cost__c || 0) + (stem.QLIK_Costs_Total_Cost__c || 0)
          : null;
        const supplierOverstatement = qlikSupplierCost == null ? 0 : rawSupplier - qlikSupplierCost;
        const calculatedSupplierInvoice = unmatchedSellOnlyExtra > 0 && supplierOverstatement > 0 && supplierOverstatement <= unmatchedSellOnlyExtra + 0.05
          ? qlikSupplierCost
          : rawSupplier;
        const calculatedBuyerInvoice = lineSellTotal + extraSellTotal;
        const buyerInvoiceAmount = !stem.Delivery_Date__c && calculatedBuyerInvoice > 0
          ? calculatedBuyerInvoice
          : stem.Total_Invoice_Amount__c;
        const stemBasePnl = buyerInvoiceAmount == null ? null : Number(buyerInvoiceAmount || 0) - Number(calculatedSupplierInvoice || 0);
        const supplierInvoicePayable = supplierInvoicePayableByStem[stem.Id];
        const payableBalance = stem.Payable_Balance__c ?? (supplierInvoicePayable != null ? supplierInvoicePayable : null);
        const supplierFinanceByAccount = new Map();
        const supplierInvoiceDueRows = [];
        const supplierInvoiceExposureRows = [];
        const addSupplierFinanceByAccount = (accountId, supplierName, invoiceAmount = 0, supplierPayableBalance = 0) => {
          const accountKey = disputeSalesforceIdKey(accountId);
          if (!accountKey) return;
          const current = supplierFinanceByAccount.get(accountKey) || {
            accountId,
            accountKey,
            supplierName: supplierName || accountId,
            supplierInvoiceAmount: 0,
            payableBalance: 0,
          };
          current.supplierInvoiceAmount += Number(invoiceAmount || 0);
          current.payableBalance += Number(supplierPayableBalance || 0);
          supplierFinanceByAccount.set(accountKey, current);
        };
        for (const invoice of supplierInvoices) {
          const supplierAccountField = supplierInvoiceSupplierFields.find((field) => invoice[field]);
          const supplierAccountId = supplierAccountField ? invoice[supplierAccountField] : null;
          const supplierAccountRelationship = supplierAccountField ? supplierInvoiceFieldByName[supplierAccountField]?.relationshipName : null;
          const supplierName = (supplierAccountRelationship ? invoice[supplierAccountRelationship]?.Name : null)
            || invoice['Supplier__r']?.Name
            || invoice.Supplier_Name__c
            || invoice['Expected_Supplier__r']?.Name
            || invoice['Substitute_Supplier__r']?.Name
            || supplierInvoiceSupplierNameRelationships.map((relationship) => invoice[relationship]?.Name).find(Boolean)
            || null;
          const invoiceAmountField = supplierInvoiceAmountFields.find((field) => invoice[field] != null);
          const invoiceAmount = invoiceAmountField ? Number(invoice[invoiceAmountField] || 0) : 0;
          const supplierPayableBalance = supplierInvoicePayableField ? Number(invoice[supplierInvoicePayableField] || 0) : 0;
          addSupplierFinanceByAccount(supplierAccountId, supplierName, invoiceAmount, supplierPayableBalance);
          const dueDateField = supplierInvoiceDueDateFields.find((field) => invoice[field]);
          const dueDate = dueDateField ? invoice[dueDateField] : null;
          const invoiceDateField = supplierInvoiceDateFields.find((field) => invoice[field]);
          const invoiceDate = invoiceDateField ? invoice[invoiceDateField] : invoice.CreatedDate || null;
          const invoiceStatus = supplierInvoiceStatusFields.map((field) => invoice[field]).find(Boolean) || null;
          const paymentRows = supplierPaymentsByInvoice[invoice.Id] || [];
          const positivePayments = paymentRows.filter((payment) => Number(payment.amount) > 0)
            .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
          const supplierRefunds = Math.abs(paymentRows.filter((payment) => Number(payment.amount) < 0)
            .reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
          const exposure = normalizeSupplierInvoiceExposure({
            supplierInvoiceId: invoice.Id,
            invoiceName: invoice.Name,
            sourceStemId: stem.Id,
            supplierAccountId,
            supplierName,
            currencyIsoCode: invoice.CurrencyIsoCode || 'USD',
            dueDate,
            invoiceDate,
            createdDate: invoice.CreatedDate || null,
            invoiceAmount,
            payableBalance: supplierPayableBalance,
            status: invoiceStatus,
            payments: paymentRows,
          });
          const netPaymentAudit = positivePayments - supplierRefunds;
          const expectedPaid = Math.max(0, exposure.invoiceAmount - exposure.payableBalance);
          const exposureWarnings = [...exposure.warnings];
          if (!disputeSalesforceIdKey(supplierAccountId)) {
            exposureWarnings.push('Supplier invoice has no valid supplier Account lookup.');
          }
          if (paymentRows.length && Math.abs(expectedPaid - netPaymentAudit) > 0.05) {
            exposureWarnings.push('Payment records do not reconcile to the current payable balance; Finance confirmation is required.');
          }
          supplierInvoiceExposureRows.push({
            ...exposure,
            payments: paymentRows,
            positivePayments,
            supplierRefunds,
            netPaymentAudit,
            status: invoiceStatus,
            warnings: [...new Set(exposureWarnings)],
          });
          const productRows = supplierInvoiceProductRowsById.get(invoice.Id) || [];
          if (productRows.length) {
            for (const productRow of productRows) {
              supplierInvoiceDueRows.push({
                supplierInvoiceId: invoice.Id || null,
                invoiceName: invoice.Name || null,
                supplierName: productRow.supplierName || supplierName,
                supplierAccountId: productRow.supplierAccountId || supplierAccountId,
                paymentTerm: productRow.paymentTerm || null,
                dueDate,
                productName: productRow.productName,
                quantityLabel: productRow.quantityLabel,
                productQuantityLabel: [productRow.productName, productRow.quantityLabel].filter(Boolean).join(' - '),
              });
            }
          } else {
            supplierInvoiceDueRows.push({
              supplierInvoiceId: invoice.Id || null,
              invoiceName: invoice.Name || null,
              supplierName,
              supplierAccountId,
              paymentTerm: null,
              dueDate,
              productName: null,
              quantityLabel: null,
              productQuantityLabel: null,
            });
          }
        }
        supplierInvoiceDueRows.push(...uninvoicedExtraCostProductRows);
        const supplierPaymentDueDatesByAccount = new Map();
        for (const dueRow of supplierInvoiceDueRows) {
          const accountKey = disputeSalesforceIdKey(dueRow.supplierAccountId);
          if (!accountKey || !dueRow.dueDate) continue;
          const dueDates = supplierPaymentDueDatesByAccount.get(accountKey) || new Set();
          dueDates.add(dueRow.dueDate);
          supplierPaymentDueDatesByAccount.set(accountKey, dueDates);
        }
        const paymentDueDatesForAccount = (accountKey) => [...(supplierPaymentDueDatesByAccount.get(accountKey) || [])].sort();
        const supplementalLineBuyByAccount = (hasSupplierInvoice || supplierInvoices.length)
          ? uninvoicedSupplierLineBuyByAccount
          : supplierLineBuyByAccount;
        for (const supplierLine of supplementalLineBuyByAccount.values()) {
          addSupplierFinanceByAccount(supplierLine.accountId, supplierLine.supplierName, supplierLine.amount, 0);
        }
        const disputePartyRegistry = buildDisputePartyRegistry({
          stem,
          lineItems,
          extraCosts,
          originalSupplierRelationship,
          extraCostSupplierField,
          extraCostSupplierRelationship,
          schemaIssues: [originalSupplierLookup.issue, extraCostSupplierLookup.issue],
        });
        const supplierCandidateRows = disputePartyRegistry.suppliers.map((party) => {
          const finance = supplierFinanceByAccount.get(party.accountKey);
          const paymentDueDates = paymentDueDatesForAccount(party.accountKey);
          const invoices = supplierInvoiceExposureRows.filter((invoice) => disputeSalesforceIdKey(invoice.supplierAccountId) === party.accountKey);
          return {
            ...party,
            supplierName: party.name,
            status: null,
            description: null,
            supplierInvoiceAmount: finance?.supplierInvoiceAmount ?? null,
            paymentDueDate: paymentDueDates[0] || null,
            paymentDueDates,
            payableBalance: finance?.payableBalance ?? null,
            invoices,
          };
        });
        const disputedSupplierKeys = new Set(disputePartyRegistry.suppliers.map((party) => party.accountKey));
        const supplierFinanceOnlyRows = [...supplierFinanceByAccount.values()]
          .filter((finance) => !disputedSupplierKeys.has(finance.accountKey))
          .map((finance) => {
            const paymentDueDates = paymentDueDatesForAccount(finance.accountKey);
            return {
              accountId: finance.accountId,
              accountKey: finance.accountKey,
              supplierName: finance.supplierName,
              status: null,
              supplierInvoiceAmount: finance.supplierInvoiceAmount,
              paymentDueDate: paymentDueDates[0] || null,
              paymentDueDates,
              payableBalance: finance.payableBalance,
              invoices: supplierInvoiceExposureRows.filter((invoice) => disputeSalesforceIdKey(invoice.supplierAccountId) === finance.accountKey),
            };
          });
        const supplierFinanceRowsAll = [...supplierCandidateRows, ...supplierFinanceOnlyRows];
        const supplierFinanceRows = supplierCandidateRows.length
          ? supplierCandidateRows
          : supplierFinanceOnlyRows;
        const buyerFinanceRow = {
          buyerName: disputePartyRegistry.buyer?.name || stem.Buyer_Name__c || stem['Account__r']?.Name || stem.Buyer__c || null,
          buyerInvoiceAmount: buyerInvoiceAmount ?? null,
          paymentDueDate: stem.Invoice_Due_Date__c || stem.Due_Date__c || stem.Buyer_Pay_Term_Date__c || null,
          receivableBalance: stem.Receivable_Balance__c ?? null,
          disputeRows: [],
          status: null,
          description: null,
        };

        return {
          ...stem,
          Total_Invoice_Amount__c: buyerInvoiceAmount ?? stem.Total_Invoice_Amount__c ?? null,
          Total_Invoiced_Amount_From_Suppliers__c: calculatedSupplierInvoice || stem.Total_Invoiced_Amount_From_Suppliers__c || null,
          _Supplier_Names: [...supplierNames].sort().join(', ') || null,
          _Product_Names: [...productNames].sort().join(', ') || null,
          _Supplier_Product_Pairs: supplierProductPairs,
          _Buyer_Disputes: [],
          _Buyer_Dispute_Rows: [],
          _Buyer_Finance_Row: buyerFinanceRow,
          _Supplier_Disputes: [],
          _Supplier_Dispute_Rows: supplierFinanceRows,
          _Supplier_Finance_Rows_All: supplierFinanceRowsAll,
          _Dispute_Parties: disputePartyRegistry,
          _Buyer_Invoice_Due_Date: stem.Invoice_Due_Date__c || stem.Due_Date__c || stem.Buyer_Pay_Term_Date__c || null,
          _Supplier_Invoice_Due_Rows: supplierInvoiceDueRows,
          _Supplier_Invoice_Exposure_Rows: supplierInvoiceExposureRows,
          _Supplier_Settlement_Schema: supplierSettlementSchema,
          _Stem_Base_Pnl: stemBasePnl,
          _Buyer_Dispute_Label: null,
          _Supplier_Dispute_Label: null,
          _Supplier_Invoice_Split_Label: supplierFinanceRows.map((dispute) => dispute.supplierInvoiceAmount).join('\n') || null,
          _Payable_Balance_Split_Label: supplierFinanceRows.map((dispute) => dispute.payableBalance).join('\n') || null,
          _Payable_Balance: payableBalance,
          _Display_Name: formatStemName(stem),
          _Buyer_Name: stem.Buyer_Name__c || stem['Account__r']?.Name || stem.Buyer__c || null,
          _Effective_Date: stem.Delivery_Date__c || stem.Expected_Delivery_Date__c || null,
        };
      }),
  };
}

function serializeDisputeWorkflowParty(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id || row.caseId,
    stemId: row.stem_id || row.stemId,
    accountId: row.account_id || row.accountId,
    accountKey: row.account_key || row.accountKey,
    name: row.account_name || row.name || row.account_id || row.accountId,
    roles: Array.isArray(row.roles) ? row.roles : [],
    sourceTypes: Array.isArray(row.source_types) ? row.source_types : (row.sourceTypes || []),
    sourceRecordIds: Array.isArray(row.source_record_ids) ? row.source_record_ids : (row.sourceRecordIds || []),
    paymentTerms: Array.isArray(row.payment_terms) ? row.payment_terms : (row.paymentTerms || []),
    products: Array.isArray(row.products) ? row.products : [],
    cancelledSourceOnly: row.cancelled_source_only === true || row.cancelledSourceOnly === true,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

function disputeRegistryWithSelection(registry, partyRows = []) {
  const selected = [];
  const issues = [...(registry?.issues || [])];
  const candidateByKey = new Map((registry?.candidates || []).map((candidate) => [candidate.accountKey, candidate]));
  for (const row of partyRows) {
    const stored = serializeDisputeWorkflowParty(row);
    const candidate = candidateByKey.get(stored.accountKey);
    if (!candidate) {
      issues.push({
        code: 'selected_account_stale',
        message: `${stored.name} is no longer the buyer or a supplier on this STEM.`,
        recordIds: stored.sourceRecordIds,
        details: { accountId: stored.accountId },
      });
      continue;
    }
    selected.push({ ...candidate, id: stored.id, caseId: stored.caseId, selected: true });
  }
  const candidateSchemaValid = registry?.candidateSchemaValid === true;
  const selectionValid = selected.length > 0 && !issues.some((item) => item.code === 'selected_account_stale');
  return {
    ...registry,
    candidateSchemaValid,
    selectionValid,
    valid: candidateSchemaValid && selectionValid,
    selected,
    issues,
  };
}

function assertValidDisputeParties(stem, partyRows = []) {
  const registry = disputeRegistryWithSelection(stem?._Dispute_Parties, partyRows);
  if (!stem?._Dispute_Parties) throw appError('Salesforce dispute party candidates could not be resolved.', 502);
  if (registry.valid) return registry;
  const messages = registry.issues.map((item) => item.message).filter(Boolean);
  if (!registry.selectionValid && !messages.length) messages.push('Select at least one disputed Account.');
  throw appError(`Correct the dispute party selection before continuing: ${messages.join(' ')}`, 400);
}

async function loadCurrentDisputeStem(stemId, accessContext) {
  const result = await salesforceDisputeStems({ stemId, limit: 100 }, null, accessContext);
  const stem = (result.rows || []).find((row) => disputeSalesforceIdKey(row.Id) === disputeSalesforceIdKey(stemId));
  if (!stem) throw appError('The disputed stem could not be found in the current Salesforce dispute queue.', 404);
  return stem;
}

function canonicalDisputeActionTarget(input, partySide, registry) {
  const accountId = String(input.partyAccountId || input.party_account_id || '').trim();
  if (!accountId) throw appError('A Salesforce party Account ID is required for every dispute action.', 400);
  const candidate = findDisputeParty(registry, partySide, accountId);
  const party = (registry?.selected || []).find((selected) => selected.accountKey === candidate?.accountKey);
  if (!candidate || !party) throw appError(`The selected ${partySide} Account is not selected for this dispute. Refresh and select the party again.`, 400);
  return party;
}

function normalizeDisputeBetaStatus(value, allowed, fallback) {
  const raw = String(value || '').trim();
  return allowed.includes(raw) ? raw : fallback;
}

async function disputeWorkflowCapabilities(client, profile = {}) {
  const [isApprover, isAccounting] = await Promise.all([
    userHasCapability(client, profile, 'disputes_approve'),
    userHasCapability(client, profile, 'disputes_account'),
  ]);
  return {
    role: profile.user_type || 'user',
    canPrepare: true,
    canApprove: isApprover,
    canAccount: isAccounting,
    canClose: isAccounting,
    canViewAllRules: true,
  };
}

function disputeBetaCaseFromStem(stem = {}) {
  return {
    stem_id: stem.Id,
    stem_name: stem._Display_Name || stem.Name || stem.KeyStem__c || stem.Id,
    buyer_name: stem._Buyer_Name || stem.Buyer_Name__c || null,
    supplier_names: stem._Supplier_Names || null,
    current_salesforce_status: stem.Dispute_Status__c || null,
  };
}

function legacyClosedDisputeCase(stem = {}) {
  const salesforceStatus = String(stem.Dispute_Status__c || '').trim();
  if (!isSalesforceDisputeClosed(salesforceStatus)) return null;
  return {
    id: null,
    stemId: stem.Id,
    stemName: stem._Display_Name || stem.Name || stem.KeyStem__c || stem.Id,
    buyerName: stem._Buyer_Name || stem.Buyer_Name__c || '',
    supplierNames: stem._Supplier_Names || '',
    currentSalesforceStatus: salesforceStatus,
    workflowStatus: 'Closed',
    approvalStatus: 'Approved',
    latestNote: 'Closed in Salesforce before FCOS workflow tracking.',
    settlementFinancials: {},
    settlementPnl: 0,
    salesforceWritebackStatus: 'legacy',
    legacyReadOnly: true,
  };
}

function serializeDisputeBetaCase(row) {
  if (!row) return null;
  return {
    id: row.id,
    stemId: row.stem_id,
    stemName: row.stem_name || '',
    buyerName: row.buyer_name || '',
    supplierNames: row.supplier_names || '',
    currentSalesforceStatus: row.current_salesforce_status || '',
    workflowStatus: row.workflow_status || 'Draft',
    approvalStatus: row.approval_status || 'Draft',
    latestNote: row.latest_note || '',
    submittedBy: row.submitted_by || null,
    submittedByEmail: row.submitted_by_email || null,
    submittedAt: row.submitted_at || null,
    approvedBy: row.approved_by || null,
    approvedByEmail: row.approved_by_email || null,
    approvedAt: row.approved_at || null,
    rejectedBy: row.rejected_by || null,
    rejectedByEmail: row.rejected_by_email || null,
    rejectedAt: row.rejected_at || null,
    rejectionReason: row.rejection_reason || null,
    closedBy: row.closed_by || null,
    closedByEmail: row.closed_by_email || null,
    closedAt: row.closed_at || null,
    settlementFinancials: row.settlement_financials || {},
    settlementPnl: Number(row.settlement_pnl || 0),
    salesforceWritebackStatus: row.salesforce_writeback_status || 'not_started',
    salesforceWritebackError: row.salesforce_writeback_error || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function serializeDisputeSupplierInstruction(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    actionId: row.action_id,
    partyId: row.party_id,
    stemId: row.stem_id,
    instructionType: row.instruction_type,
    instructionLabel: row.instruction_type === 'withhold_unpaid' ? 'Do not pay' : 'Get back paid amount',
    recoveryMethod: row.recovery_method || null,
    sourceSupplierInvoiceId: row.source_supplier_invoice_id,
    sourceSupplierInvoiceName: row.source_supplier_invoice_name || '',
    sourceStemId: row.source_stem_id || row.stem_id,
    targetSupplierInvoiceId: row.target_supplier_invoice_id || null,
    targetSupplierInvoiceName: row.target_supplier_invoice_name || '',
    targetStemId: row.target_stem_id || null,
    currencyIsoCode: row.currency_iso_code || 'USD',
    plannedAmount: Number(row.planned_amount || 0),
    allocatedAmount: Number(row.allocated_amount || 0),
    sourceInvoiceAmountSnapshot: Number(row.source_invoice_amount_snapshot || 0),
    sourcePayableBalanceSnapshot: Number(row.source_payable_balance_snapshot || 0),
    sourcePaidAmountSnapshot: Number(row.source_paid_amount_snapshot || 0),
    targetInvoiceAmountSnapshot: row.target_invoice_amount_snapshot == null ? null : Number(row.target_invoice_amount_snapshot),
    targetPayableAmountSnapshot: row.target_payable_amount_snapshot == null ? null : Number(row.target_payable_amount_snapshot),
    sourceInvoiceSnapshot: row.source_invoice_snapshot || {},
    sourceStemSnapshot: row.source_stem_snapshot || {},
    targetInvoiceSnapshot: row.target_invoice_snapshot || {},
    targetStemSnapshot: row.target_stem_snapshot || {},
    paymentSnapshot: row.payment_snapshot || {},
    allocationFingerprint: row.allocation_fingerprint || '',
    status: row.status || 'Pending Accounting',
    matchedSalesforcePaymentId: row.matched_salesforce_payment_id || null,
    matchingPaymentSnapshot: row.matching_payment_snapshot || {},
    instructionReference: row.instruction_reference || '',
    instructionDate: row.instruction_date || null,
    instructionAmount: row.instruction_amount == null ? null : Number(row.instruction_amount),
    settlementReference: row.settlement_reference || '',
    settlementDate: row.settlement_date || null,
    settlementAmount: row.settlement_amount == null ? null : Number(row.settlement_amount),
    accountingNote: row.accounting_note || '',
    revision: Number(row.revision || 1),
    acknowledgedBy: row.acknowledged_by || null,
    acknowledgedByEmail: row.acknowledged_by_email || null,
    acknowledgedAt: row.acknowledged_at || null,
    settledBy: row.settled_by || null,
    settledByEmail: row.settled_by_email || null,
    settledAt: row.settled_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function serializeDisputeBetaAction(row, partyMap = new Map(), instructionRows = []) {
  if (!row) return null;
  const party = partyMap.get(row.party_id) || null;
  const actionType = row.action_type;
  const supplierInstructions = instructionRows
    .filter((instruction) => instruction.action_id === row.id && instruction.status !== 'Superseded')
    .map(serializeDisputeSupplierInstruction);
  const invoiceAllocationMap = new Map();
  for (const instruction of supplierInstructions) {
    const existing = invoiceAllocationMap.get(instruction.sourceSupplierInvoiceId) || {
      supplierInvoiceId: instruction.sourceSupplierInvoiceId,
      invoiceName: instruction.sourceSupplierInvoiceName,
      amount: instruction.allocatedAmount,
    };
    existing.amount = Math.max(existing.amount, instruction.allocatedAmount);
    invoiceAllocationMap.set(instruction.sourceSupplierInvoiceId, existing);
  }
  const closeReason = actionType === 'close_supplier_dispute'
    ? canonicalDisputeBetaCloseReason(row.close_reason, DISPUTE_BETA_SUPPLIER_CLOSE_REASONS)
    : actionType === 'close_buyer_dispute'
      ? canonicalDisputeBetaCloseReason(row.close_reason, DISPUTE_BETA_BUYER_CLOSE_REASONS)
      : row.close_reason;
  return {
    id: row.id,
    caseId: row.case_id,
    stemId: row.stem_id,
    partyId: row.party_id,
    partySide: row.party_side,
    partyType: row.party_side,
    partyName: party?.account_name || party?.name || '',
    partyAccountId: party?.account_id || party?.accountId || null,
    partyKey: party?.account_id ? `account:${party.account_id}` : party?.accountId ? `account:${party.accountId}` : null,
    partyRoles: party?.roles || [],
    actionType,
    actionLabel: row.action_label || DISPUTE_BETA_ACTION_LABELS[actionType] || actionType,
    amount: row.amount == null ? null : Number(row.amount),
    disputeAmount: row.amount == null ? null : Number(row.amount),
    currencyIsoCode: supplierInstructions[0]?.currencyIsoCode || 'USD',
    invoiceAllocations: [...invoiceAllocationMap.values()],
    supplierInstructions,
    totalDoNotPay: supplierInstructions
      .filter((instruction) => instruction.instructionType === 'withhold_unpaid')
      .reduce((sum, instruction) => sum + instruction.plannedAmount, 0),
    totalGetBackPaid: supplierInstructions
      .filter((instruction) => instruction.instructionType === 'get_back_paid')
      .reduce((sum, instruction) => sum + instruction.plannedAmount, 0),
    supplierDisputeAmountRequired: row.party_side === 'supplier' && row.amount == null,
    supplierInstructionConversionRequired: row.party_side === 'supplier'
      && row.amount != null
      && row.action_type !== 'resolve_supplier_dispute',
    specialSellPrice: row.special_sell_price == null ? null : Number(row.special_sell_price),
    specialBuyPrice: row.special_buy_price == null ? null : Number(row.special_buy_price),
    quantity: row.quantity == null ? null : Number(row.quantity),
    quantityUnit: row.quantity_unit || 'MT',
    closeReason: closeReason || null,
    balancePaymentInstruction: row.balance_payment_instruction || null,
    description: row.description || '',
    requiresAttachment: row.requires_attachment === true,
    accountingStatus: row.execution_status || 'Pending Accounting',
    executionStatus: row.execution_status || 'Pending Accounting',
    instructionReference: row.instruction_reference || '',
    instructionDate: row.instruction_date || null,
    instructionAmount: row.instruction_amount == null ? null : Number(row.instruction_amount),
    settlementReference: row.settlement_reference || '',
    settlementDate: row.settlement_date || null,
    settlementAmount: row.settlement_amount == null ? null : Number(row.settlement_amount),
    accountingNote: row.accounting_note || '',
    accountingBy: row.accounting_by || null,
    accountingByEmail: row.accounting_by_email || null,
    accountingAt: row.accounting_at || null,
    executedBy: row.executed_by || null,
    executedByEmail: row.executed_by_email || null,
    executedAt: row.executed_at || null,
    executionNote: row.execution_note || null,
    createdBy: row.created_by || null,
    createdByEmail: row.created_by_email || null,
    updatedBy: row.updated_by || null,
    updatedByEmail: row.updated_by_email || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function serializeDisputeWorkflowDocument(row) {
  if (!row) return null;
  const fileName = row.smart_filename || row.original_filename || 'Dispute document';
  const versionId = row.salesforce_content_version_id;
  return {
    id: row.id,
    caseId: row.case_id,
    actionId: row.action_id || null,
    supplierInstructionId: row.supplier_instruction_id || null,
    partyId: row.party_id,
    stemId: row.stem_id,
    partySide: row.party_side,
    partyType: row.party_side,
    partyName: row.party_name || '',
    partyAccountId: row.party_account_id || null,
    documentDirection: row.document_direction,
    documentType: row.document_type,
    originalFileName: row.original_filename,
    requestedFileName: row.requested_filename || fileName,
    fileName,
    smartFileName: fileName,
    contentType: row.content_type || 'application/octet-stream',
    fileExtension: row.file_extension || '',
    contentSize: Number(row.content_size || 0),
    contentVersionId: versionId,
    contentDocumentId: row.salesforce_content_document_id || null,
    linkedRecordId: row.salesforce_linked_record_id,
    linkedRecordIds: row.salesforce_linked_record_id ? [row.salesforce_linked_record_id] : [],
    uploadStatus: row.upload_status || 'complete',
    salesforceUrl: row.salesforce_url || null,
    downloadUrl: `/api/functions/salesforceDocumentDownload?kind=contentVersion&id=${encodeURIComponent(versionId)}&filename=${encodeURIComponent(fileName)}`,
    uploadedBy: row.uploaded_by || null,
    uploadedByEmail: row.uploaded_by_email || null,
    createdAt: row.created_at || null,
  };
}

function serializeDisputeBetaEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    actionId: row.action_id || null,
    stemId: row.stem_id,
    eventType: row.event_type,
    note: row.note || '',
    metadata: row.metadata || {},
    actorUserId: row.actor_user_id || null,
    actorEmail: row.actor_email || null,
    createdAt: row.created_at || null,
  };
}

function disputeBetaActionPartyType(actionType, inputPartyType) {
  if (actionType === 'issue_buyer_credit_note' || actionType === 'close_buyer_dispute') return 'buyer';
  if (actionType === 'hold_supplier_payment' || actionType === 'pay_full_supplier_invoice' || actionType === 'deduct_specific_amount' || actionType === 'resolve_supplier_dispute' || actionType === 'close_supplier_dispute') return 'supplier';
  return String(inputPartyType || '').toLowerCase() === 'buyer' ? 'buyer' : 'supplier';
}

function normalizeDisputeBetaAction(input = {}, caseRow, profile = {}, registry) {
  const actionType = String(input.actionType || input.action_type || '').trim();
  if (!DISPUTE_BETA_ACTION_LABELS[actionType]) throw appError('Valid dispute workflow action type is required.', 400);
  const partySide = disputeBetaActionPartyType(actionType, input.partySide || input.party_side || input.partyType || input.party_type);
  const party = canonicalDisputeActionTarget(input, partySide, registry);
  const amount = decimalOrNull(input.amount);
  if (actionType === 'deduct_specific_amount' && amount == null) throw appError('Deduction amount is required.', 400);
  if (actionType === 'resolve_supplier_dispute' && (amount == null || amount < 0)) throw appError('Supplier dispute amount is required.', 400);
  if (actionType === 'resolve_supplier_dispute' && amount === 0 && !String(input.description || '').trim()) {
    throw appError('Explain why no supplier recovery is required when the dispute amount is zero.', 400);
  }
  if (actionType === 'issue_buyer_credit_note' && amount == null) throw appError('Credit note amount is required.', 400);
  const closeReasonInput = String(input.closeReason || input.close_reason || '').trim();
  const closeReason = actionType === 'close_supplier_dispute'
    ? canonicalDisputeBetaCloseReason(closeReasonInput, DISPUTE_BETA_SUPPLIER_CLOSE_REASONS)
    : actionType === 'close_buyer_dispute'
      ? canonicalDisputeBetaCloseReason(closeReasonInput, DISPUTE_BETA_BUYER_CLOSE_REASONS)
      : (closeReasonInput || null);
  if (actionType === 'close_supplier_dispute' && !DISPUTE_BETA_SUPPLIER_CLOSE_REASONS.includes(closeReason)) {
    throw appError('Valid supplier close reason is required.', 400);
  }
  if (actionType === 'close_buyer_dispute' && !DISPUTE_BETA_BUYER_CLOSE_REASONS.includes(closeReason)) {
    throw appError('Valid buyer close reason is required.', 400);
  }
  const balancePaymentInstruction = String(input.balancePaymentInstruction || input.balance_payment_instruction || '').trim() || null;
  if (balancePaymentInstruction && !DISPUTE_BETA_BALANCE_PAYMENT_INSTRUCTIONS.includes(balancePaymentInstruction)) {
    throw appError('Valid balance payment instruction is required.', 400);
  }
  const currencyIsoCode = String(input.currencyIsoCode || input.currency_iso_code || 'USD').trim().toUpperCase() || 'USD';
  if (actionType === 'resolve_supplier_dispute' && !/^[A-Z]{3}$/.test(currencyIsoCode)) {
    throw appError('Supplier dispute currency must be a three-letter ISO code.', 400);
  }

  return {
    stem_id: caseRow.stem_id,
    party_id: party.id,
    party_side: partySide,
    party_account_key: party.accountKey,
    action_type: actionType,
    action_label: DISPUTE_BETA_ACTION_LABELS[actionType],
    amount,
    special_sell_price: decimalOrNull(input.specialSellPrice ?? input.special_sell_price),
    special_buy_price: decimalOrNull(input.specialBuyPrice ?? input.special_buy_price),
    quantity: decimalOrNull(input.quantity),
    quantity_unit: String(input.quantityUnit || input.quantity_unit || 'MT').trim() || 'MT',
    close_reason: closeReason,
    balance_payment_instruction: balancePaymentInstruction,
    description: String(input.description || '').trim(),
    requires_attachment: Boolean(input.requiresAttachment ?? input.requires_attachment),
    execution_status: normalizeDisputeBetaStatus(input.accountingStatus || input.executionStatus || input.execution_status, DISPUTE_BETA_EXECUTION_STATUSES, 'Pending Accounting'),
    currency_iso_code: currencyIsoCode,
    invoice_allocations: Array.isArray(input.invoiceAllocations || input.invoice_allocations)
      ? (input.invoiceAllocations || input.invoice_allocations)
      : [],
    updated_by: profile.id,
    updated_by_email: profile.email,
  };
}

function prepareSupplierSettlementAction(action, currentStem) {
  if (action.action_type !== 'resolve_supplier_dispute') return action;
  const schema = currentStem?._Supplier_Settlement_Schema;
  if (!schema?.valid) {
    throw appError(`Supplier payment automation is unavailable: ${(schema?.issues || ['Salesforce invoice/payment schema is incomplete.']).join(' ')}`, 400);
  }
  const accountKey = disputeSalesforceIdKey(action.party_account_key);
  const invoices = (currentStem?._Supplier_Invoice_Exposure_Rows || [])
    .filter((invoice) => disputeSalesforceIdKey(invoice.supplierAccountId) === accountKey);
  const invalidInvoices = invoices.filter((invoice) => (invoice.warnings || []).some((warning) => /no valid supplier Account lookup|negative|exceeds its invoice amount/i.test(warning)));
  if (invalidInvoices.length) {
    throw appError('Correct the supplier invoice Account or payable balance in Salesforce before saving this supplier resolution.', 400);
  }
  const allocation = allocateSupplierDispute({
    invoices,
    disputeAmount: action.amount,
    currencyIsoCode: action.currency_iso_code,
    invoiceAllocations: action.invoice_allocations,
  });
  return {
    ...action,
    invoice_allocations: allocation.allocations.map((item) => ({
      supplier_invoice_id: item.supplierInvoiceId,
      amount: item.allocatedAmount,
    })),
    supplier_allocation: allocation,
    supplier_instructions: supplierInstructionRows(allocation).map((instruction) => ({
      ...instruction,
      source_stem_id: currentStem.Id,
      source_stem_snapshot: {
        stemId: currentStem.Id,
        stemName: currentStem._Display_Name || currentStem.Name || currentStem.KeyStem__c || '',
        deliveryDate: currentStem.Delivery_Date__c || null,
      },
    })),
  };
}

function calculateDisputeBetaSettlement(actions = []) {
  let buyerImpact = 0;
  let supplierImpact = 0;
  let buyerCreditNoteImpact = 0;
  let supplierCreditNoteImpact = 0;
  const lines = [];

  for (const action of actions) {
    const amount = Number(action.amount ?? action.amount_cents ?? 0) || 0;
    if (action.action_type === 'issue_buyer_credit_note' || action.actionType === 'issue_buyer_credit_note') {
      buyerImpact -= amount;
      lines.push({ label: action.action_label || action.actionLabel || 'Buyer credit note', impact: -amount });
    }
    if (action.action_type === 'deduct_specific_amount' || action.actionType === 'deduct_specific_amount') {
      supplierImpact += amount;
      lines.push({ label: action.action_label || action.actionLabel || 'Supplier deduction', impact: amount });
    }
    if (action.action_type === 'resolve_supplier_dispute' || action.actionType === 'resolve_supplier_dispute') {
      supplierImpact += amount;
      lines.push({ label: action.action_label || action.actionLabel || 'Supplier dispute resolution', impact: amount });
    }

    const buyerCreditNote = Number(action.special_sell_price ?? action.specialSellPrice);
    if (Number.isFinite(buyerCreditNote) && buyerCreditNote > 0) {
      const impact = -buyerCreditNote;
      buyerCreditNoteImpact += impact;
      lines.push({
        label: 'Buyer agreed credit note',
        buyerCreditNote,
        impact,
      });
    }

    const supplierCreditNote = Number(action.special_buy_price ?? action.specialBuyPrice);
    if (Number.isFinite(supplierCreditNote) && supplierCreditNote > 0) {
      const impact = supplierCreditNote;
      supplierCreditNoteImpact += impact;
      lines.push({
        label: 'Supplier agreed credit note',
        supplierCreditNote,
        impact,
      });
    }
  }

  const settlementPnl = buyerImpact + supplierImpact + buyerCreditNoteImpact + supplierCreditNoteImpact;
  return {
    buyerImpact,
    supplierImpact,
    buyerCreditNoteImpact,
    supplierCreditNoteImpact,
    specialPricePnl: buyerCreditNoteImpact + supplierCreditNoteImpact,
    settlementPnl,
    lines,
  };
}

async function loadDisputeBetaWorkflowMap(client, stemIds = []) {
  const ids = [...new Set(stemIds.filter(Boolean))];
  if (!ids.length) return {};
  const [casesRes, partiesRes, actionsRes, instructionsRes, eventsRes, documentsRes] = await Promise.all([
    client
      .from('dispute_beta_cases')
      .select(DISPUTE_BETA_CASE_SELECT)
      .in('stem_id', ids),
    client
      .from('dispute_workflow_parties')
      .select(DISPUTE_WORKFLOW_PARTY_SELECT)
      .in('stem_id', ids)
      .order('created_at', { ascending: true }),
    client
      .from('dispute_beta_actions')
      .select(DISPUTE_BETA_ACTION_SELECT)
      .in('stem_id', ids)
      .order('created_at', { ascending: true }),
    client
      .from('dispute_workflow_supplier_instructions')
      .select(DISPUTE_SUPPLIER_INSTRUCTION_SELECT)
      .in('stem_id', ids)
      .order('created_at', { ascending: true }),
    client
      .from('dispute_beta_events')
      .select(DISPUTE_BETA_EVENT_SELECT)
      .in('stem_id', ids)
      .order('created_at', { ascending: false })
      .limit(Math.max(100, Math.min(ids.length * 25, 2500))),
    client
      .from('dispute_workflow_documents')
      .select(DISPUTE_WORKFLOW_DOCUMENT_SELECT)
      .in('stem_id', ids)
      .eq('upload_status', 'complete')
      .order('created_at', { ascending: false }),
  ]);
  if (casesRes.error) throw casesRes.error;
  if (partiesRes.error) throw partiesRes.error;
  if (actionsRes.error) throw actionsRes.error;
  if (instructionsRes.error) throw instructionsRes.error;
  if (eventsRes.error) throw eventsRes.error;
  if (documentsRes.error) throw documentsRes.error;

  const map = {};
  for (const row of casesRes.data || []) {
    map[row.stem_id] = { case: serializeDisputeBetaCase(row), parties: [], actions: [], supplierInstructions: [], events: [], documents: [] };
  }
  const partyById = new Map();
  for (const row of partiesRes.data || []) {
    partyById.set(row.id, row);
    if (!map[row.stem_id]) map[row.stem_id] = { case: null, parties: [], actions: [], supplierInstructions: [], events: [], documents: [] };
    map[row.stem_id].parties.push(serializeDisputeWorkflowParty(row));
  }
  for (const row of instructionsRes.data || []) {
    if (!map[row.stem_id]) map[row.stem_id] = { case: null, parties: [], actions: [], supplierInstructions: [], events: [], documents: [] };
    map[row.stem_id].supplierInstructions.push(serializeDisputeSupplierInstruction(row));
  }
  for (const row of actionsRes.data || []) {
    if (!map[row.stem_id]) map[row.stem_id] = { case: null, parties: [], actions: [], supplierInstructions: [], events: [], documents: [] };
    map[row.stem_id].actions.push(serializeDisputeBetaAction(row, partyById, instructionsRes.data || []));
  }
  for (const row of eventsRes.data || []) {
    if (!map[row.stem_id]) map[row.stem_id] = { case: null, parties: [], actions: [], supplierInstructions: [], events: [], documents: [] };
    map[row.stem_id].events.push(serializeDisputeBetaEvent(row));
  }
  for (const row of documentsRes.data || []) {
    if (!map[row.stem_id]) map[row.stem_id] = { case: null, parties: [], actions: [], supplierInstructions: [], events: [], documents: [] };
    map[row.stem_id].documents.push(serializeDisputeWorkflowDocument(row));
  }
  return map;
}

async function writeDisputeBetaEvent(client, caseRow, eventType, profile, payload = {}) {
  const { error } = await client.from('dispute_beta_events').insert({
    case_id: caseRow.id,
    action_id: payload.actionId || null,
    stem_id: caseRow.stem_id,
    event_type: eventType,
    note: payload.note || null,
    metadata: payload.metadata || {},
    actor_user_id: profile?.id || null,
    actor_email: profile?.email || null,
  });
  if (error) throw error;
}

function assertSalesforceDisputeIsOpen(stem = {}) {
  if (!isSalesforceDisputeClosed(stem.Dispute_Status__c)) return;
  throw appError(
    `This dispute is already ${String(stem.Dispute_Status__c).trim()} in Salesforce. FCOS has locked the workflow; refresh the Dispute Workflow queue to synchronize it.`,
    409,
  );
}

function projectExternallyClosedDisputeWorkflows(stems = [], workflowMap = {}) {
  for (const stem of stems) {
    const workflow = workflowMap[stem.Id];
    const projection = projectExternalDisputeClosure(workflow?.case, stem);
    if (projection) workflow.case = { ...workflow.case, ...projection };
  }
}

async function loadDisputeWorkflowParties(client, caseId) {
  const { data, error } = await client
    .from('dispute_workflow_parties')
    .select(DISPUTE_WORKFLOW_PARTY_SELECT)
    .eq('case_id', caseId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

function disputePartyRowMap(partyRows = []) {
  return new Map(partyRows.map((party) => [party.id, party]));
}

async function loadDisputeWorkflowActions(client, caseId) {
  const [partyRows, actionsResult, instructionsResult] = await Promise.all([
    loadDisputeWorkflowParties(client, caseId),
    client
      .from('dispute_beta_actions')
      .select(DISPUTE_BETA_ACTION_SELECT)
      .eq('case_id', caseId)
      .order('created_at', { ascending: true }),
    client
      .from('dispute_workflow_supplier_instructions')
      .select(DISPUTE_SUPPLIER_INSTRUCTION_SELECT)
      .eq('case_id', caseId)
      .order('created_at', { ascending: true }),
  ]);
  if (actionsResult.error) throw actionsResult.error;
  if (instructionsResult.error) throw instructionsResult.error;
  const instructionRows = instructionsResult.data || [];
  return {
    partyRows,
    actionRows: actionsResult.data || [],
    instructionRows,
    supplierInstructions: instructionRows.map(serializeDisputeSupplierInstruction),
    actions: (actionsResult.data || []).map((row) => serializeDisputeBetaAction(row, disputePartyRowMap(partyRows), instructionRows)),
  };
}

function storedSupplierInvoiceAllocations(instructionRows = []) {
  const allocations = new Map();
  for (const instruction of instructionRows.filter((row) => row.status !== 'Superseded')) {
    const id = instruction.source_supplier_invoice_id;
    if (!id) continue;
    allocations.set(id, Math.max(
      Number(allocations.get(id) || 0),
      Number(instruction.allocated_amount || 0),
    ));
  }
  return [...allocations].map(([supplierInvoiceId, amount]) => ({ supplierInvoiceId, amount }));
}

function currentSupplierActionAllocation(action, partyRows, instructionRows, currentStem) {
  const party = disputePartyRowMap(partyRows).get(action.party_id);
  if (!party) throw appError('Supplier resolution has no selected Account.', 400);
  const accountKey = disputeSalesforceIdKey(party.account_id);
  const actionInstructions = instructionRows.filter((instruction) => instruction.action_id === action.id && instruction.status !== 'Superseded');
  const currencyIsoCode = actionInstructions[0]?.currency_iso_code || 'USD';
  const invoices = (currentStem?._Supplier_Invoice_Exposure_Rows || [])
    .filter((invoice) => disputeSalesforceIdKey(invoice.supplierAccountId) === accountKey);
  if (!currentStem?._Supplier_Settlement_Schema?.valid) {
    throw appError(`Supplier payment automation is unavailable: ${(currentStem?._Supplier_Settlement_Schema?.issues || []).join(' ')}`, 409);
  }
  return allocateSupplierDispute({
    invoices,
    disputeAmount: action.amount,
    currencyIsoCode,
    invoiceAllocations: storedSupplierInvoiceAllocations(actionInstructions),
  });
}

function supplierInstructionStateChanged(currentRows = [], allocation = {}) {
  const activeRows = currentRows.filter((row) => row.status !== 'Superseded');
  const currentFingerprint = activeRows.map((row) => row.allocation_fingerprint).find(Boolean);
  if (currentFingerprint) return currentFingerprint !== allocation.fingerprint;
  const currentShape = activeRows
    .map((row) => `${row.source_supplier_invoice_id}:${row.instruction_type}:${Number(row.planned_amount || 0).toFixed(2)}`)
    .sort();
  const nextShape = supplierInstructionRows(allocation)
    .map((row) => `${row.source_supplier_invoice_id}:${row.instruction_type}:${Number(row.planned_amount || 0).toFixed(2)}`)
    .sort();
  return JSON.stringify(currentShape) !== JSON.stringify(nextShape);
}

function assertSupplierAllocationsCurrent(actions, partyRows, instructionRows, currentStem) {
  for (const action of actions.filter((row) => row.action_type === 'resolve_supplier_dispute')) {
    const allocation = currentSupplierActionAllocation(action, partyRows, instructionRows, currentStem);
    const actionInstructions = instructionRows.filter((instruction) => instruction.action_id === action.id);
    if (supplierInstructionStateChanged(actionInstructions, allocation)) {
      throw appError('Supplier invoice payment data changed. Save the draft again to review the updated Do not pay and Get back paid amount allocation.', 409);
    }
  }
}

async function reconcileApprovedSupplierInstructions(client, caseRow, partyRows, actionRows, instructionRows, currentStem, profile) {
  if (caseRow.approval_status !== 'Approved' || caseRow.workflow_status === 'Closed') {
    return { changed: false, instructionRows };
  }
  const reconciliations = [];
  for (const action of actionRows.filter((row) => row.action_type === 'resolve_supplier_dispute')) {
    const allocation = currentSupplierActionAllocation(action, partyRows, instructionRows, currentStem);
    const currentRows = instructionRows.filter((instruction) => instruction.action_id === action.id);
    if (!supplierInstructionStateChanged(currentRows, allocation)) continue;
    const sourceStemSnapshot = {
      stemId: currentStem.Id,
      stemName: currentStem._Display_Name || currentStem.Name || currentStem.KeyStem__c || '',
      deliveryDate: currentStem.Delivery_Date__c || null,
    };
    reconciliations.push({
      action_id: action.id,
      instructions: supplierInstructionRows(allocation).map((desired) => ({
        ...desired,
        party_id: action.party_id,
        source_stem_id: caseRow.stem_id,
        source_stem_snapshot: sourceStemSnapshot,
        allocation_fingerprint: allocation.fingerprint,
      })),
      note: `Supplier payment changed. Do not pay is now ${allocation.totalDoNotPay.toFixed(2)} ${allocation.currencyIsoCode}; get back paid amount is ${allocation.totalGetBackPaid.toFixed(2)} ${allocation.currencyIsoCode}.`,
      metadata: {
        disputeAmount: allocation.disputeAmount,
        totalDoNotPay: allocation.totalDoNotPay,
        totalGetBackPaid: allocation.totalGetBackPaid,
        allocationFingerprint: allocation.fingerprint,
      },
    });
  }
  if (!reconciliations.length) {
    if (
      caseRow.salesforce_writeback_status === 'failed'
      && ['Approved - Pending Accounting', 'Accounting In Progress', 'Settled - Ready to Close'].includes(caseRow.workflow_status)
    ) {
      await writeDisputeWorkflowStatusToSalesforce(client, caseRow, profile, caseRow.workflow_status);
      return { changed: false, writebackRetried: true, instructionRows };
    }
    return { changed: false, writebackRetried: false, instructionRows };
  }
  const { error: reconciliationError } = await client.rpc('reconcile_dispute_supplier_instructions', {
    p_case_id: caseRow.id,
    p_reconciliations: reconciliations,
    p_actor: { id: profile.id, email: profile.email },
  });
  if (reconciliationError) throw reconciliationError;
  const updatedCase = await getDisputeBetaCase(client, caseRow.id);
  await writeDisputeWorkflowStatusToSalesforce(client, updatedCase, profile, 'Accounting In Progress');
  const { data, error } = await client
    .from('dispute_workflow_supplier_instructions')
    .select(DISPUTE_SUPPLIER_INSTRUCTION_SELECT)
    .eq('case_id', caseRow.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return { changed: true, writebackRetried: false, instructionRows: data || [] };
}

async function loadDisputeWorkflowDocuments(client, caseId) {
  const { data, error } = await client
    .from('dispute_workflow_documents')
    .select(DISPUTE_WORKFLOW_DOCUMENT_SELECT)
    .eq('case_id', caseId)
    .eq('upload_status', 'complete')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function loadDisputeWorkflowEvents(client, caseId, limit = 100) {
  const { data, error } = await client
    .from('dispute_beta_events')
    .select(DISPUTE_BETA_EVENT_SELECT)
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

function missingRequiredDisputeDocuments(actions = [], documents = []) {
  const actionIdsWithDocuments = new Set(documents.map((document) => document.action_id).filter(Boolean));
  return actions.filter((action) => action.requires_attachment === true && !actionIdsWithDocuments.has(action.id));
}

async function assertRequiredDisputeDocuments(client, actions = []) {
  const caseId = actions[0]?.case_id;
  const documents = caseId ? await loadDisputeWorkflowDocuments(client, caseId) : [];
  if (!actions.some((action) => action.requires_attachment === true)) return documents;
  const missing = missingRequiredDisputeDocuments(actions, documents);
  if (missing.length) {
    const labels = missing.map((action) => `${action.action_label || action.action_type} (${action.party_side})`);
    throw appError(`Upload the required document for: ${labels.join(', ')}.`, 400);
  }
  return documents;
}

async function patchDisputeWorkflowStatusInSalesforce(caseRow, salesforceStatus) {
  const currentRows = await queryRows(`
    SELECT Id, Dispute_Status__c, LastModifiedDate
    FROM stem__c
    WHERE Id = '${escapeSoql(caseRow.stem_id)}'
    LIMIT 1
  `);
  const currentStem = currentRows[0];
  if (!currentStem) throw appError('The disputed STEM no longer exists in Salesforce.', 404);

  if (isSalesforceDisputeClosed(currentStem.Dispute_Status__c)) {
    const continuingRecordedClose = isSalesforceDisputeClosed(salesforceStatus)
      && isSalesforceDisputeClosed(caseRow.current_salesforce_status)
      && caseRow.salesforce_writeback_status === 'success';
    if (continuingRecordedClose) return;
    assertSalesforceDisputeIsOpen(currentStem);
  }

  const ifUnmodifiedSince = currentStem.LastModifiedDate
    ? new Date(currentStem.LastModifiedDate).toUTCString()
    : null;
  try {
    await sfRequest(`/sobjects/stem__c/${encodeURIComponent(caseRow.stem_id)}`, {
      method: 'PATCH',
      body: { Dispute_Status__c: salesforceStatus },
      headers: ifUnmodifiedSince ? { 'If-Unmodified-Since': ifUnmodifiedSince } : undefined,
    });
  } catch (error) {
    if (error.status === 412) {
      throw appError('Salesforce changed while FCOS was saving this workflow. Refresh the Dispute Workflow queue and try again.', 409);
    }
    throw error;
  }
}

async function recordDisputeWorkflowSalesforceWriteback(
  client,
  caseRow,
  profile,
  salesforceStatus,
  writebackStatus = 'success',
  writebackError = null,
) {
  const { data: updatedCase, error } = await client
    .from('dispute_beta_cases')
    .update({
      current_salesforce_status: writebackStatus === 'success' ? salesforceStatus : caseRow.current_salesforce_status,
      salesforce_writeback_status: writebackStatus,
      salesforce_writeback_error: writebackError,
      updated_at: new Date().toISOString(),
    })
    .eq('id', caseRow.id)
    .select(DISPUTE_BETA_CASE_SELECT)
    .single();
  if (error) throw error;
  await writeDisputeBetaEvent(client, updatedCase, 'salesforce_writeback', profile, {
    note: writebackStatus === 'success'
      ? `Salesforce dispute status updated to ${salesforceStatus}.`
      : `Salesforce dispute status update to ${salesforceStatus} failed.`,
    metadata: { salesforceStatus, error: writebackError },
  });
  return updatedCase;
}

async function writeDisputeWorkflowStatusToSalesforce(client, caseRow, profile, salesforceStatus, options = {}) {
  let writebackStatus = 'success';
  let writebackError = null;
  let writebackFailure = null;
  try {
    await patchDisputeWorkflowStatusInSalesforce(caseRow, salesforceStatus);
  } catch (error) {
    writebackStatus = 'failed';
    writebackError = error.message;
    writebackFailure = error;
  }
  const updatedCase = await recordDisputeWorkflowSalesforceWriteback(
    client,
    caseRow,
    profile,
    salesforceStatus,
    writebackStatus,
    writebackError,
  );
  if (options.required && writebackStatus === 'failed') {
    if (writebackFailure?.status) throw writebackFailure;
    throw appError(`Salesforce dispute status could not be updated: ${writebackError}`, 502);
  }
  return updatedCase;
}

async function upsertDisputeBetaCase(client, stem, extra = {}) {
  const nowIso = new Date().toISOString();
  const casePayload = {
    ...disputeBetaCaseFromStem(stem),
    latest_note: String(extra.latestNote ?? extra.latest_note ?? '').trim(),
    updated_at: nowIso,
  };
  if (extra.workflowStatus) casePayload.workflow_status = normalizeDisputeBetaStatus(extra.workflowStatus, DISPUTE_BETA_WORKFLOW_STATUSES, 'Draft');
  if (extra.approvalStatus) casePayload.approval_status = normalizeDisputeBetaStatus(extra.approvalStatus, DISPUTE_BETA_APPROVAL_STATUSES, 'Draft');
  const { data, error } = await client
    .from('dispute_beta_cases')
    .upsert(casePayload, { onConflict: 'stem_id' })
    .select(DISPUTE_BETA_CASE_SELECT)
    .single();
  if (error) throw error;
  return data;
}

async function getDisputeBetaCase(client, caseIdOrStemId) {
  const value = String(caseIdOrStemId || '').trim();
  if (!value) throw appError('caseId or stemId is required.', 400);
  const query = client
    .from('dispute_beta_cases')
    .select(DISPUTE_BETA_CASE_SELECT);
  const { data, error } = isSalesforceId(value)
    ? await query.eq('stem_id', value).maybeSingle()
    : await query.eq('id', value).maybeSingle();
  if (error) throw error;
  if (!data) throw appError('Dispute Workflow case not found.', 404);
  return data;
}

function selectedPartyRowsFromAccounts(registry, accountIds = []) {
  const selectedKeys = new Set(accountIds.map(disputeSalesforceIdKey).filter(Boolean));
  const candidateByKey = new Map((registry?.candidates || []).map((candidate) => [candidate.accountKey, candidate]));
  const invalidKeys = [...selectedKeys].filter((key) => !candidateByKey.has(key));
  if (invalidKeys.length) throw appError('One or more selected Accounts are no longer eligible for this STEM.', 400);
  if (!selectedKeys.size) throw appError('Select at least one disputed Account before saving.', 400);
  return [...selectedKeys].map((key) => {
    const candidate = candidateByKey.get(key);
    return {
      id: null,
      case_id: null,
      stem_id: null,
      account_id: candidate.accountId,
      account_key: candidate.accountKey,
      account_name: candidate.name,
      roles: candidate.roles,
      source_types: candidate.sourceTypes,
      source_record_ids: candidate.sourceRecordIds,
      payment_terms: candidate.paymentTerms,
      products: candidate.products,
      cancelled_source_only: candidate.cancelledSourceOnly,
    };
  });
}

function validateStoredDisputeActions(actions, partyRows, registry) {
  const partyById = disputePartyRowMap(partyRows);
  const seen = new Set();
  for (const action of actions || []) {
    const party = partyById.get(action.party_id);
    if (!party) throw appError(`Action ${action.action_label || action.id} has no selected disputed Account.`, 400);
    const candidate = findDisputeParty(registry, action.party_side, party.account_id);
    if (!candidate) throw appError(`${party.account_name} is no longer eligible on the ${action.party_side} side.`, 400);
    const key = `${party.account_key}:${action.party_side}`;
    if (seen.has(key)) throw appError(`Only one ${action.party_side} action may be added for ${party.account_name}.`, 400);
    seen.add(key);
  }
  return actions || [];
}

function supplierActionsMissingDisputeAmount(actions = []) {
  return actions.filter((action) => action.party_side === 'supplier' && action.amount == null);
}

function assertSupplierDisputeAmounts(actions = []) {
  const missing = supplierActionsMissingDisputeAmount(actions);
  if (missing.length) {
    throw appError('Supplier dispute amount required. Record an amount, or explicitly enter zero with a no-recovery explanation, before this workflow can progress.', 409);
  }
  const legacy = actions.filter((action) => action.party_side === 'supplier' && action.action_type !== 'resolve_supplier_dispute');
  if (legacy.length) {
    throw appError('Convert each legacy supplier action into invoice-level Finance instructions before this workflow can progress.', 409);
  }
}

async function disputeBetaList(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  const salesforceData = await salesforceDisputeStems({ limit: body.limit || 10000 }, null, accessContext || { client, profile });
  const rows = salesforceData.rows || [];
  let [workflowMap, capabilities] = await Promise.all([
    loadDisputeBetaWorkflowMap(client, rows.map((row) => row.Id)),
    disputeWorkflowCapabilities(client, profile),
  ]);
  let reconciled = false;
  const reconciliationErrors = new Map();
  for (const stem of rows) {
    const workflow = workflowMap[stem.Id];
    if (
      workflow?.case?.approvalStatus !== 'Approved'
      || workflow.case.workflowStatus === 'Closed'
      || !workflow.actions.some((action) => action.actionType === 'resolve_supplier_dispute')
      || !stem._Supplier_Settlement_Schema?.valid
    ) continue;
    try {
      const caseRow = await getDisputeBetaCase(client, workflow.case.id);
      const stored = await loadDisputeWorkflowActions(client, caseRow.id);
      const result = await reconcileApprovedSupplierInstructions(
        client,
        caseRow,
        stored.partyRows,
        stored.actionRows,
        stored.instructionRows,
        stem,
        profile,
      );
      reconciled = reconciled || result.changed || result.writebackRetried;
    } catch (error) {
      reconciliationErrors.set(stem.Id, error.message || 'Supplier payment reconciliation failed.');
    }
  }
  if (reconciled) {
    workflowMap = await loadDisputeBetaWorkflowMap(client, rows.map((row) => row.Id));
  }
  for (const [stemId, error] of reconciliationErrors) {
    if (workflowMap[stemId]) workflowMap[stemId].reconciliationError = error;
  }
  projectExternallyClosedDisputeWorkflows(rows, workflowMap);
  return {
    isDisputeAdmin: capabilities.canApprove,
    isDisputeAccounting: capabilities.canAccount,
    capabilities,
    requiredSalesforceFieldsMissing: true,
    fieldWarning: 'Disputed Accounts, approval, accounting, documents, and audit state are stored in Supabase. Salesforce receives only the high-level STEM Dispute Status.',
    rows: rows.map((row) => {
      const workflow = workflowMap[row.Id] || { case: null, parties: [], actions: [], supplierInstructions: [], events: [], documents: [] };
      if (!workflow.case) workflow.case = legacyClosedDisputeCase(row);
      return {
        ...row,
        _Dispute_Parties: disputeRegistryWithSelection(row._Dispute_Parties, workflow.parties),
        _Dispute_Workflow: workflow,
      };
    }),
  };
}

async function disputeBetaSaveDraft(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  const stem = body.stem || {};
  const stemId = stem.Id || body.stemId;
  if (!stemId) throw appError('stemId is required.', 400);
  const [currentStem, existingCaseResult] = await Promise.all([
    loadCurrentDisputeStem(stemId, accessContext || { client, profile }),
    client
      .from('dispute_beta_cases')
      .select(DISPUTE_BETA_CASE_SELECT)
      .eq('stem_id', stemId)
      .maybeSingle(),
  ]);
  assertSalesforceDisputeIsOpen(currentStem);
  const candidateRegistry = currentStem._Dispute_Parties;
  if (!candidateRegistry?.candidateSchemaValid) {
    const messages = (candidateRegistry?.issues || []).map((item) => item.message).filter(Boolean);
    throw appError(`Correct the Salesforce Account sources before continuing: ${messages.join(' ')}`, 400);
  }
  if (existingCaseResult.error) throw existingCaseResult.error;
  const existingCase = existingCaseResult.data;
  if (existingCase && !['Draft', 'Rejected', 'Revision Requested'].includes(existingCase.workflow_status)) {
    throw appError('Trader instructions are locked after submission. Request a revision before editing them.', 400);
  }
  const selectedPartyRows = selectedPartyRowsFromAccounts(candidateRegistry, body.selectedPartyAccountIds || []);
  if (existingCase) {
    const selectedAccountKeys = new Set(selectedPartyRows.map((party) => party.account_key));
    const [storedPartiesResult, storedDocumentsResult] = await Promise.all([
      client
        .from('dispute_workflow_parties')
        .select('id,account_key,account_name')
        .eq('case_id', existingCase.id),
      client
        .from('dispute_workflow_documents')
        .select('party_id')
        .eq('case_id', existingCase.id),
    ]);
    if (storedPartiesResult.error) throw storedPartiesResult.error;
    if (storedDocumentsResult.error) throw storedDocumentsResult.error;
    const documentedPartyIds = new Set((storedDocumentsResult.data || []).map((document) => document.party_id).filter(Boolean));
    const documentedRemovedParties = (storedPartiesResult.data || []).filter((party) => (
      !selectedAccountKeys.has(party.account_key) && documentedPartyIds.has(party.id)
    ));
    if (documentedRemovedParties.length) {
      const names = documentedRemovedParties.map((party) => party.account_name || party.account_key).join(', ');
      throw appError(`Keep ${names} selected because dispute documents are already linked to the Account.`, 400);
    }
  }
  const registry = disputeRegistryWithSelection(candidateRegistry, selectedPartyRows);
  const caseInput = { id: existingCase?.id || null, stem_id: stemId };
  const normalizedActions = (body.actions || []).map((action) => prepareSupplierSettlementAction({
    id: String(action.id || '').trim() || null,
    ...normalizeDisputeBetaAction(action, caseInput, profile, registry),
  }, currentStem));
  const seenActionSides = new Set();
  for (const action of normalizedActions) {
    const key = `${action.party_account_key}:${action.party_side}`;
    if (seenActionSides.has(key)) throw appError('Only one action per selected Account side is allowed.', 400);
    seenActionSides.add(key);
  }
  const financials = calculateDisputeBetaSettlement(normalizedActions);
  await patchDisputeWorkflowStatusInSalesforce(existingCase || { stem_id: stemId }, 'Open - Trader Review');
  const casePayload = {
    ...disputeBetaCaseFromStem(currentStem),
    current_salesforce_status: 'Open - Trader Review',
    workflow_status: 'Draft',
    approval_status: 'Draft',
    latest_note: String(body.latestNote || '').trim(),
    settlement_financials: financials,
    settlement_pnl: financials.settlementPnl,
  };
  const { data: savedCaseId, error: saveError } = await client.rpc('save_dispute_workflow_draft', {
    p_case: casePayload,
    p_parties: selectedPartyRows.map((party) => ({
      account_id: party.account_id,
      account_key: party.account_key,
      account_name: party.account_name,
      roles: party.roles,
      source_types: party.source_types,
      source_record_ids: party.source_record_ids,
      payment_terms: party.payment_terms,
      products: party.products,
      cancelled_source_only: party.cancelled_source_only,
    })),
    p_actions: normalizedActions,
    p_actor: { id: profile.id, email: profile.email },
    p_event_note: body.latestNote || 'Draft saved.',
  });
  if (saveError) throw saveError;
  const updatedCase = await getDisputeBetaCase(client, savedCaseId || stemId);
  const workflowPromise = loadDisputeWorkflowActions(client, updatedCase.id);
  const documentsPromise = loadDisputeWorkflowDocuments(client, updatedCase.id);
  const statusPromise = recordDisputeWorkflowSalesforceWriteback(
    client,
    updatedCase,
    profile,
    'Open - Trader Review',
  );
  const [{ partyRows, actions, supplierInstructions }, documents, statusCase] = await Promise.all([
    workflowPromise,
    documentsPromise,
    statusPromise,
  ]);
  const events = await loadDisputeWorkflowEvents(client, updatedCase.id);
  return {
    case: serializeDisputeBetaCase(statusCase),
    parties: partyRows.map(serializeDisputeWorkflowParty),
    actions,
    supplierInstructions,
    events: events.map(serializeDisputeBetaEvent),
    documents: documents.map(serializeDisputeWorkflowDocument),
  };
}

async function disputeBetaSubmitApproval(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  const caseRow = await getDisputeBetaCase(client, body.caseId || body.stemId);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  assertSalesforceDisputeIsOpen(currentStem);
  const { partyRows, actionRows, instructionRows, actions: serializedActions } = await loadDisputeWorkflowActions(client, caseRow.id);
  const registry = assertValidDisputeParties(currentStem, partyRows);
  const actions = validateStoredDisputeActions(actionRows, partyRows, registry);
  if (!actions?.length) throw appError('Add at least one trader action before submitting for approval.', 400);
  assertSupplierDisputeAmounts(actions);
  assertSupplierAllocationsCurrent(actions, partyRows, instructionRows, currentStem);
  if (!['Draft', 'Rejected', 'Revision Requested'].includes(caseRow.workflow_status)) {
    throw appError('Only draft, rejected, or revision-requested cases can be submitted.', 400);
  }
  await assertRequiredDisputeDocuments(client, actions);
  await patchDisputeWorkflowStatusInSalesforce(caseRow, 'Pending Approval');
  const nowIso = new Date().toISOString();
  const { data: updatedCase, error } = await client
    .from('dispute_beta_cases')
    .update({
      workflow_status: 'Pending Approval',
      approval_status: 'Pending Approval',
      submitted_by: profile.id,
      submitted_by_email: profile.email,
      submitted_at: nowIso,
      latest_note: String(body.note || caseRow.latest_note || '').trim(),
      updated_at: nowIso,
    })
    .eq('id', caseRow.id)
    .select(DISPUTE_BETA_CASE_SELECT)
    .single();
  if (error) throw error;
  await writeDisputeBetaEvent(client, updatedCase, 'submitted', profile, { note: body.note || 'Submitted for dispute administrator approval.' });
  const statusCase = await recordDisputeWorkflowSalesforceWriteback(client, updatedCase, profile, 'Pending Approval');
  const documents = await loadDisputeWorkflowDocuments(client, caseRow.id);
  return {
    case: serializeDisputeBetaCase(statusCase),
    parties: partyRows.map(serializeDisputeWorkflowParty),
    actions: serializedActions,
    documents: documents.map(serializeDisputeWorkflowDocument),
  };
}

async function disputeBetaApprove(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  await requireCapability(client, profile, 'disputes_approve', 'Dispute approval permission is required.', 403);
  const caseRow = await getDisputeBetaCase(client, body.caseId || body.stemId);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  if (caseRow.approval_status !== 'Pending Approval') throw appError('Only pending Dispute Workflow cases can be approved.', 400);
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  assertSalesforceDisputeIsOpen(currentStem);
  const { partyRows, actionRows, instructionRows } = await loadDisputeWorkflowActions(client, caseRow.id);
  const registry = assertValidDisputeParties(currentStem, partyRows);
  const actions = validateStoredDisputeActions(actionRows, partyRows, registry);
  assertSupplierDisputeAmounts(actions);
  assertSupplierAllocationsCurrent(actions, partyRows, instructionRows, currentStem);
  await assertRequiredDisputeDocuments(client, actions || []);
  const salesforceStatus = 'Approved - Pending Accounting';
  const { error: pendingError } = await client
    .from('dispute_beta_cases')
    .update({
      salesforce_writeback_status: 'not_started',
      salesforce_writeback_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', caseRow.id);
  if (pendingError) throw pendingError;
  try {
    await patchDisputeWorkflowStatusInSalesforce(caseRow, salesforceStatus);
  } catch (error) {
    await recordDisputeWorkflowSalesforceWriteback(
      client,
      caseRow,
      profile,
      salesforceStatus,
      'failed',
      error.message,
    );
    throw error;
  }
  const { error: approvalError } = await client.rpc('approve_dispute_workflow_case', {
    p_case_id: caseRow.id,
    p_actor: { id: profile.id, email: profile.email },
    p_note: body.note || 'Approved by dispute administrator.',
    p_salesforce_status: salesforceStatus,
  });
  if (approvalError) throw approvalError;
  let updatedCase = await getDisputeBetaCase(client, caseRow.id);
  if (updatedCase.workflow_status !== salesforceStatus) {
    updatedCase = await writeDisputeWorkflowStatusToSalesforce(
      client,
      updatedCase,
      profile,
      updatedCase.workflow_status,
    );
  }
  const accountingState = await loadDisputeWorkflowActions(client, caseRow.id);
  const documents = await loadDisputeWorkflowDocuments(client, caseRow.id);
  return {
    case: serializeDisputeBetaCase(updatedCase),
    parties: partyRows.map(serializeDisputeWorkflowParty),
    actions: accountingState.actions,
    supplierInstructions: accountingState.supplierInstructions,
    documents: documents.map(serializeDisputeWorkflowDocument),
    writebackResults: [],
  };
}

async function disputeBetaReject(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  await requireCapability(client, profile, 'disputes_approve', 'Dispute approval permission is required.', 403);
  const caseRow = await getDisputeBetaCase(client, body.caseId || body.stemId);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  assertSalesforceDisputeIsOpen(currentStem);
  if (caseRow.approval_status !== 'Pending Approval') throw appError('Only pending Dispute Workflow cases can be rejected or returned for revision.', 400);
  const revisionRequested = Boolean(body.revisionRequested);
  const reason = String(body.reason || '').trim();
  if (!reason) throw appError(revisionRequested ? 'Revision reason is required.' : 'Rejection reason is required.', 400);
  const salesforceStatus = revisionRequested ? 'Revision Requested' : 'Rejected';
  await patchDisputeWorkflowStatusInSalesforce(caseRow, salesforceStatus);
  const nowIso = new Date().toISOString();
  const { data: updatedCase, error } = await client
    .from('dispute_beta_cases')
    .update({
      workflow_status: revisionRequested ? 'Revision Requested' : 'Rejected',
      approval_status: revisionRequested ? 'Revision Requested' : 'Rejected',
      rejected_by: profile.id,
      rejected_by_email: profile.email,
      rejected_at: nowIso,
      rejection_reason: reason,
      updated_at: nowIso,
    })
    .eq('id', caseRow.id)
    .select(DISPUTE_BETA_CASE_SELECT)
    .single();
  if (error) throw error;
  await writeDisputeBetaEvent(client, updatedCase, revisionRequested ? 'revision_requested' : 'rejected', profile, {
    note: reason,
  });
  const statusCase = await recordDisputeWorkflowSalesforceWriteback(client, updatedCase, profile, salesforceStatus);
  return { case: serializeDisputeBetaCase(statusCase) };
}

async function disputeWorkflowDocuments(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  const caseRow = await getDisputeBetaCase(client, body.caseId || body.stemId);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const documents = await loadDisputeWorkflowDocuments(client, caseRow.id);
  return { documents: documents.map(serializeDisputeWorkflowDocument) };
}

async function disputeWorkflowUploadDocument(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  requireExternalActionGate('salesforce_write');
  const caseRow = await getDisputeBetaCase(client, body.caseId || body.stemId);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  assertSalesforceDisputeIsOpen(currentStem);
  const partyRows = await loadDisputeWorkflowParties(client, caseRow.id);
  const registry = assertValidDisputeParties(currentStem, partyRows);
  const storedWorkflow = await loadDisputeWorkflowActions(client, caseRow.id);
  validateStoredDisputeActions(storedWorkflow.actionRows, partyRows, registry);
  if (caseRow.approval_status === 'Approved') {
    const reconciliation = await reconcileApprovedSupplierInstructions(
      client,
      caseRow,
      partyRows,
      storedWorkflow.actionRows,
      storedWorkflow.instructionRows,
      currentStem,
      profile,
    );
    if (reconciliation.changed) {
      throw appError('Supplier payments changed. FCOS updated the accounting plan; reopen the document upload and link it to the revised instruction.', 409);
    }
  } else {
    assertSupplierAllocationsCurrent(
      storedWorkflow.actionRows,
      partyRows,
      storedWorkflow.instructionRows,
      currentStem,
    );
  }
  const canEdit = ['Draft', 'Rejected', 'Revision Requested'].includes(caseRow.workflow_status);
  const [canApproveDocuments, canAccountDocuments] = await Promise.all([
    userHasCapability(client, profile, 'disputes_approve'),
    userHasCapability(client, profile, 'disputes_account'),
  ]);
  if (!canEdit && !canApproveDocuments && !canAccountDocuments) {
    throw appError('Only accounting or administrators can add documents after trader submission.', 403);
  }

  const actionId = String(body.actionId || '').trim() || null;
  const supplierInstructionId = String(body.supplierInstructionId || '').trim() || null;
  let action = null;
  if (actionId) {
    const { data, error } = await client
      .from('dispute_beta_actions')
      .select(DISPUTE_BETA_ACTION_SELECT)
      .eq('id', actionId)
      .eq('case_id', caseRow.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw appError('The selected workflow action was not found.', 404);
    action = data;
  }
  let supplierInstruction = null;
  if (supplierInstructionId) {
    const { data, error } = await client
      .from('dispute_workflow_supplier_instructions')
      .select(DISPUTE_SUPPLIER_INSTRUCTION_SELECT)
      .eq('id', supplierInstructionId)
      .eq('case_id', caseRow.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw appError('The selected supplier instruction was not found.', 404);
    supplierInstruction = data;
    if (action && supplierInstruction.action_id !== action.id) {
      throw appError('The supplier instruction does not belong to the selected action.', 400);
    }
    if (!action) {
      const { data: linkedAction, error: linkedActionError } = await client
        .from('dispute_beta_actions')
        .select(DISPUTE_BETA_ACTION_SELECT)
        .eq('id', supplierInstruction.action_id)
        .eq('case_id', caseRow.id)
        .maybeSingle();
      if (linkedActionError) throw linkedActionError;
      action = linkedAction;
    }
  }
  const partyId = String(body.partyId || action?.party_id || '').trim();
  const partyRow = partyRows.find((party) => party.id === partyId);
  if (!partyRow) throw appError('Select a saved disputed Account before uploading a document.', 400);
  const partySide = String(body.partySide || action?.party_side || '').trim().toLowerCase();
  if (!['buyer', 'supplier'].includes(partySide)) throw appError('Select the buyer or supplier side for this document.', 400);
  const party = findDisputeParty(registry, partySide, partyRow.account_id);
  if (!party || !(registry.selected || []).some((selected) => selected.accountKey === party.accountKey)) {
    throw appError('The selected Account side is no longer valid for this STEM.', 400);
  }
  if (action && (action.party_id !== partyRow.id || action.party_side !== partySide)) {
    throw appError('The selected action does not belong to this Account side.', 400);
  }

  const documentType = String(body.documentType || '').trim();
  if (!DISPUTE_WORKFLOW_DOCUMENT_TYPES.has(documentType)) throw appError('Valid document type is required.', 400);
  const documentDirection = String(body.documentDirection || '').trim().toLowerCase();
  if (!DISPUTE_WORKFLOW_DOCUMENT_DIRECTIONS.has(documentDirection)) throw appError('Select a valid document direction.', 400);
  if (!documentDirection.endsWith(`_${partySide}`)) throw appError(`Document direction must match the ${partySide} side.`, 400);
  const originalFileName = String(body.originalFileName || '').trim();
  if (!originalFileName) throw appError('Document filename is required.', 400);
  const rawBase64 = String(body.base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!rawBase64) throw appError('Document content is required.', 400);
  const buffer = Buffer.from(rawBase64, 'base64');
  if (!buffer.length) throw appError('Document content is empty or invalid.', 400);
  if (buffer.length > DISPUTE_WORKFLOW_MAX_DOCUMENT_BYTES) throw appError('Document is too large. Maximum size is 3 MB.', 413);

  const partyName = party.name;
  const linkedRecordId = caseRow.stem_id;
  const extension = disputeWorkflowFileExtension(originalFileName);
  if (!extension) throw appError('The selected document must have a filename extension.', 400);
  const directionLabel = disputeWorkflowDirectionLabel(documentDirection);
  const suggestedBaseName = `${disputeWorkflowHongKongDateToken()} ${directionLabel}`;
  const requestedInput = String(body.requestedFileName || '').replace(new RegExp(`\\.${extension}$`, 'i'), '');
  const requestedBaseName = disputeWorkflowEditableFilename(requestedInput, suggestedBaseName);
  const contentType = String(body.contentType || 'application/octet-stream').trim() || 'application/octet-stream';
  let documentRow = null;
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const smartFileName = `${requestedBaseName}${suffix ? `-${suffix}` : ''}.${extension}`;
    const { data, error } = await client
      .from('dispute_workflow_documents')
      .insert({
        case_id: caseRow.id,
        action_id: action?.id || actionId,
        supplier_instruction_id: supplierInstructionId,
        party_id: partyRow.id,
        party_side: partySide,
        stem_id: caseRow.stem_id,
        party_name: partyName,
        party_account_id: party.accountId,
        document_direction: documentDirection,
        document_type: documentType,
        original_filename: originalFileName,
        requested_filename: `${requestedBaseName}.${extension}`,
        smart_filename: smartFileName,
        upload_status: 'pending',
        content_type: contentType,
        file_extension: extension,
        content_size: buffer.length,
        salesforce_content_version_id: null,
        salesforce_linked_record_id: linkedRecordId,
        uploaded_by: profile.id,
        uploaded_by_email: profile.email,
      })
      .select(DISPUTE_WORKFLOW_DOCUMENT_SELECT)
      .single();
    if (!error) {
      documentRow = data;
      break;
    }
    if (error.code !== '23505') throw error;
  }
  if (!documentRow) throw appError('A unique document filename could not be reserved.', 409);

  const smartFileName = documentRow.smart_filename;
  const title = smartFileName.slice(0, -(extension.length + 1));
  let contentVersionId = null;
  let contentDocumentId = null;

  try {
    const contentVersion = await sfRequest('/sobjects/ContentVersion', {
      method: 'POST',
      body: {
        Title: title,
        PathOnClient: `/${smartFileName}`,
        VersionData: buffer.toString('base64'),
        FirstPublishLocationId: linkedRecordId,
      },
    });
    contentVersionId = contentVersion?.id;
    if (!isSalesforceId(contentVersionId)) throw appError('Salesforce did not return a ContentVersion id.', 502);
    const versionRows = await queryRows(`SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = '${escapeSoql(contentVersionId)}' LIMIT 1`, { softFail: true });
    contentDocumentId = versionRows[0]?.ContentDocumentId || null;
    if (!isSalesforceId(contentDocumentId)) throw appError('Salesforce did not return a ContentDocument id.', 502);
    const salesforceUrl = `${getInstanceUrl()}/lightning/r/ContentDocument/${contentDocumentId}/view`;
    const { data: completedDocument, error: documentError } = await client
      .from('dispute_workflow_documents')
      .update({
        upload_status: 'complete',
        salesforce_content_version_id: contentVersionId,
        salesforce_content_document_id: contentDocumentId,
        salesforce_url: salesforceUrl,
      })
      .eq('id', documentRow.id)
      .eq('upload_status', 'pending')
      .select(DISPUTE_WORKFLOW_DOCUMENT_SELECT)
      .single();
    if (documentError) throw documentError;
    documentRow = completedDocument;
  } catch (error) {
    if (contentDocumentId) await sfRequest(`/sobjects/ContentDocument/${encodeURIComponent(contentDocumentId)}`, { method: 'DELETE' }).catch(() => null);
    else if (contentVersionId) await sfRequest(`/sobjects/ContentVersion/${encodeURIComponent(contentVersionId)}`, { method: 'DELETE' }).catch(() => null);
    await client.from('dispute_workflow_documents').delete().eq('id', documentRow.id);
    throw error;
  }
  await writeDisputeBetaEvent(client, caseRow, 'document_uploaded', profile, {
    actionId,
    note: `${smartFileName} uploaded to Salesforce.`,
    metadata: { documentId: documentRow.id, documentType, documentDirection, partySide, partyName, partyAccountId: party.accountId, supplierInstructionId, contentVersionId: documentRow.salesforce_content_version_id, linkedRecordIds: [linkedRecordId] },
  });
  return { document: serializeDisputeWorkflowDocument(documentRow) };
}

async function supplierOffsetInvoiceOptions({
  supplierAccountId,
  currencyIsoCode,
  excludeInvoiceIds = [],
  accessContext = null,
} = {}) {
  if (!isSalesforceId(supplierAccountId)) throw appError('Valid supplier Account is required.', 400);
  const [invoiceDescribe, paymentDescribe] = await Promise.all([
    salesforceObjectFields({ objectName: 'Supplier_Invoice__c' }),
    salesforceObjectFields({ objectName: 'Payment__c' }).catch(() => ({ fields: [] })),
  ]);
  const invoiceFields = invoiceDescribe.fields || [];
  const invoiceFieldNames = new Set(invoiceFields.map((field) => field.name));
  const invoiceFieldByName = Object.fromEntries(invoiceFields.map((field) => [field.name, field]));
  const schema = resolveSupplierSettlementSchema({
    supplierInvoiceFields: invoiceFields,
    paymentFields: paymentDescribe.fields || [],
  });
  if (!schema.valid) {
    throw appError(`Supplier offset options are unavailable: ${schema.issues.join(' ')}`, 409);
  }
  const relationships = schema.supplierAccountFields
    .map((field) => invoiceFieldByName[field]?.relationshipName)
    .filter(Boolean);
  const selectFields = [
    'Id',
    'Name',
    'CreatedDate',
    invoiceFieldNames.has('STEM__c') ? 'STEM__c' : null,
    invoiceFieldNames.has('CurrencyIsoCode') ? 'CurrencyIsoCode' : null,
    schema.invoiceAmountField,
    schema.invoicePayableField,
    ...schema.invoiceDueDateFields,
    ...schema.invoiceDateFields,
    ...schema.invoiceStatusFields,
    ...schema.supplierAccountFields,
    ...relationships.map((relationship) => `${relationship}.Name`),
  ].filter(Boolean);
  const accountCondition = schema.supplierAccountFields
    .map((field) => `${field} = '${escapeSoql(supplierAccountId)}'`)
    .join(' OR ');
  const rows = await queryRows(`
    SELECT ${[...new Set(selectFields)].join(', ')}
    FROM Supplier_Invoice__c
    WHERE (${accountCondition})
    ORDER BY CreatedDate ASC
    LIMIT 2000
  `, { limit: 2000, softFail: true });
  const excluded = new Set(excludeInvoiceIds.map((id) => String(id).slice(0, 15)));
  const options = [];
  for (const invoice of rows) {
    if (excluded.has(String(invoice.Id || '').slice(0, 15))) continue;
    if (invoice.STEM__c) {
      const allowed = await requireInterofficeStemAccess(invoice.STEM__c, accessContext).then(() => true).catch(() => false);
      if (!allowed) continue;
    }
    const supplierField = schema.supplierAccountFields.find((field) => invoice[field]);
    if (disputeSalesforceIdKey(invoice[supplierField]) !== disputeSalesforceIdKey(supplierAccountId)) continue;
    const dueDate = schema.invoiceDueDateFields.map((field) => invoice[field]).find(Boolean) || null;
    const invoiceDate = schema.invoiceDateFields.map((field) => invoice[field]).find(Boolean) || invoice.CreatedDate || null;
    const status = schema.invoiceStatusFields.map((field) => invoice[field]).find(Boolean) || null;
    const statusToken = String(status || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (['closed', 'paid', 'cancelled', 'canceled', 'void', 'rejected'].some((token) => statusToken.includes(token))) continue;
    const exposure = normalizeSupplierInvoiceExposure({
      supplierInvoiceId: invoice.Id,
      invoiceName: invoice.Name,
      sourceStemId: invoice.STEM__c,
      supplierAccountId: invoice[supplierField],
      supplierName: relationships.map((relationship) => invoice[relationship]?.Name).find(Boolean) || '',
      currencyIsoCode: invoice.CurrencyIsoCode || 'USD',
      dueDate,
      invoiceDate,
      createdDate: invoice.CreatedDate,
      invoiceAmount: invoice[schema.invoiceAmountField],
      payableBalance: invoice[schema.invoicePayableField],
      status,
    });
    if (exposure.payableBalance <= 0.01 || exposure.currencyIsoCode !== currencyIsoCode) continue;
    options.push({
      supplierInvoiceId: exposure.supplierInvoiceId,
      invoiceName: exposure.invoiceName,
      stemId: invoice.STEM__c || null,
      currencyIsoCode: exposure.currencyIsoCode,
      invoiceAmount: exposure.invoiceAmount,
      payableBalance: exposure.payableBalance,
      dueDate: exposure.dueDate,
      invoiceDate: exposure.invoiceDate,
      status,
    });
  }
  return options;
}

async function disputeWorkflowSupplierOffsetOptions(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  await requireCapability(client, profile, 'disputes_account', 'Dispute accounting permission is required for supplier offset options.');
  const instructionId = String(body.instructionId || '').trim();
  const { data: instruction, error } = await client
    .from('dispute_workflow_supplier_instructions')
    .select(DISPUTE_SUPPLIER_INSTRUCTION_SELECT)
    .eq('id', instructionId)
    .maybeSingle();
  if (error) throw error;
  if (!instruction) throw appError('Supplier instruction not found.', 404);
  if (instruction.instruction_type !== 'get_back_paid') throw appError('Only Get back paid amount instructions can use an offset invoice.', 400);
  const caseRow = await getDisputeBetaCase(client, instruction.case_id);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const partyRows = await loadDisputeWorkflowParties(client, caseRow.id);
  const party = partyRows.find((row) => row.id === instruction.party_id);
  if (!party) throw appError('Supplier instruction has no selected Account.', 400);
  const options = await supplierOffsetInvoiceOptions({
    supplierAccountId: party.account_id,
    currencyIsoCode: instruction.currency_iso_code,
    excludeInvoiceIds: [instruction.source_supplier_invoice_id],
    accessContext: accessContext || { client, profile },
  });
  const { data: reservations, error: reservationError } = await client
    .from('dispute_workflow_supplier_instructions')
    .select('id,target_supplier_invoice_id,planned_amount,status,recovery_method')
    .eq('recovery_method', 'future_invoice_offset')
    .not('target_supplier_invoice_id', 'is', null);
  if (reservationError) throw reservationError;
  const reservedByInvoice = new Map();
  for (const reservation of reservations || []) {
    if (reservation.id === instruction.id || ['Not Required', 'Superseded'].includes(reservation.status)) continue;
    const key = String(reservation.target_supplier_invoice_id || '').slice(0, 15);
    reservedByInvoice.set(key, Number(reservedByInvoice.get(key) || 0) + Number(reservation.planned_amount || 0));
  }
  const availableOptions = options
    .map((option) => {
      const reservedAmount = Number(reservedByInvoice.get(String(option.supplierInvoiceId || '').slice(0, 15)) || 0);
      return {
        ...option,
        reservedAmount,
        unreservedPayableBalance: Math.max(0, Number(option.payableBalance || 0) - reservedAmount),
      };
    })
    .filter((option) => option.unreservedPayableBalance + 0.01 >= Number(instruction.planned_amount || 0));
  return { options: availableOptions };
}

async function disputeWorkflowSupplierInstructionUpdate(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  await requireCapability(client, profile, 'disputes_account', 'Dispute accounting permission is required for supplier instructions.');
  const instructionId = String(body.instructionId || '').trim();
  if (!instructionId) throw appError('instructionId is required.', 400);
  const { data: originalInstruction, error: lookupError } = await client
    .from('dispute_workflow_supplier_instructions')
    .select(DISPUTE_SUPPLIER_INSTRUCTION_SELECT)
    .eq('id', instructionId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!originalInstruction) throw appError('Supplier instruction not found.', 404);
  const caseRow = await getDisputeBetaCase(client, originalInstruction.case_id);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  assertSalesforceDisputeIsOpen(currentStem);
  let workflow = await loadDisputeWorkflowActions(client, caseRow.id);
  const registry = assertValidDisputeParties(currentStem, workflow.partyRows);
  validateStoredDisputeActions(workflow.actionRows, workflow.partyRows, registry);
  assertSupplierDisputeAmounts(workflow.actionRows);
  const reconciliation = await reconcileApprovedSupplierInstructions(
    client,
    caseRow,
    workflow.partyRows,
    workflow.actionRows,
    workflow.instructionRows,
    currentStem,
    profile,
  );
  if (reconciliation.changed) workflow = await loadDisputeWorkflowActions(client, caseRow.id);
  const instruction = workflow.instructionRows.find((row) => row.id === instructionId);
  if (!instruction || instruction.status === 'Superseded') {
    throw appError('Supplier payment data changed and this instruction was replaced. Review the updated accounting plan.', 409);
  }
  const requestedRevision = Number(body.revision);
  if (Number.isInteger(requestedRevision) && requestedRevision !== Number(instruction.revision || 1)) {
    throw appError('This supplier instruction changed after it was opened. Refresh and review the latest values.', 409);
  }
  const status = String(body.status || '').trim();
  if (!DISPUTE_SUPPLIER_INSTRUCTION_STATUSES.has(status) || status === 'Superseded') {
    throw appError('Valid supplier instruction status is required.', 400);
  }
  if (caseRow.approval_status !== 'Approved') {
    if (instruction.instruction_type !== 'withhold_unpaid' || status !== 'Hold Acknowledged') {
      throw appError('Before approval, Finance can only acknowledge an immediate Do not pay instruction.', 400);
    }
  }
  const instructionReference = String(body.instructionReference || '').trim();
  const instructionDate = String(body.instructionDate || '').trim() || null;
  const settlementReference = String(body.settlementReference || '').trim();
  const settlementDate = String(body.settlementDate || '').trim() || null;
  const accountingNote = String(body.accountingNote || '').trim();
  if (instructionDate && !/^\d{4}-\d{2}-\d{2}$/.test(instructionDate)) throw appError('Instruction date is invalid.', 400);
  if (settlementDate && !/^\d{4}-\d{2}-\d{2}$/.test(settlementDate)) throw appError('Settlement date is invalid.', 400);
  const recoveryMethod = instruction.instruction_type === 'get_back_paid'
    ? String(body.recoveryMethod || instruction.recovery_method || '').trim() || null
    : null;
  if (instruction.instruction_type === 'get_back_paid' && ['Instruction Issued', 'Settled'].includes(status) && !['cash_refund', 'future_invoice_offset'].includes(recoveryMethod)) {
    throw appError('Choose cash refund or future invoice offset for Get back paid amount.', 400);
  }
  if (status === 'Instruction Issued' && (!instructionDate || (!instructionReference && !accountingNote))) {
    throw appError('Instruction Issued requires an instruction date and a reference or accounting note.', 400);
  }
  if (status === 'Not Required' && !accountingNote) throw appError('Explain why this supplier instruction is not required.', 400);
  const documents = await loadDisputeWorkflowDocuments(client, caseRow.id);
  const hasEvidence = documents.some((document) => (
    document.supplier_instruction_id === instruction.id
    && ['supplier_credit_note', 'settlement_agreement', 'proof_of_payment'].includes(document.document_type)
  ));
  if (status === 'Settled' && (!settlementDate || (!settlementReference && !hasEvidence))) {
    throw appError('Settled requires a settlement date and either an uploaded supplier document or a Finance reference.', 400);
  }
  const plannedAmount = Number(instruction.planned_amount || 0);
  const settlementAmount = decimalOrNull(body.settlementAmount) ?? (status === 'Settled' ? plannedAmount : null);
  if (status === 'Settled' && Math.abs(Number(settlementAmount || 0) - plannedAmount) > 0.01) {
    throw appError('Settlement amount must equal the current supplier instruction amount.', 400);
  }

  const party = workflow.partyRows.find((row) => row.id === instruction.party_id);
  let targetInvoice = null;
  if (recoveryMethod === 'future_invoice_offset') {
    const targetSupplierInvoiceId = String(body.targetSupplierInvoiceId || '').trim();
    if (!targetSupplierInvoiceId) throw appError('Select the supplier invoice that will receive the offset.', 400);
    const options = await supplierOffsetInvoiceOptions({
      supplierAccountId: party?.account_id,
      currencyIsoCode: instruction.currency_iso_code,
      excludeInvoiceIds: [instruction.source_supplier_invoice_id],
      accessContext: accessContext || { client, profile },
    });
    targetInvoice = options.find((option) => String(option.supplierInvoiceId).slice(0, 15) === String(targetSupplierInvoiceId).slice(0, 15));
    if (!targetInvoice) throw appError('The selected offset invoice is no longer eligible for this supplier Account and currency.', 409);
    if (targetInvoice.payableBalance + 0.01 < plannedAmount) throw appError('The selected offset invoice does not have enough payable balance.', 400);
  }
  let matchedPaymentId = null;
  let matchedPayment = null;
  if (recoveryMethod === 'cash_refund' && body.matchedSalesforcePaymentId) {
    const exposure = (currentStem._Supplier_Invoice_Exposure_Rows || [])
      .find((row) => row.supplierInvoiceId === instruction.source_supplier_invoice_id);
    matchedPayment = (exposure?.payments || []).find((row) => (
      row.id === body.matchedSalesforcePaymentId
      && Number(row.amount) < 0
      && Math.abs(Math.abs(Number(row.amount)) - plannedAmount) <= 0.01
      && (row.currencyIsoCode || 'USD') === instruction.currency_iso_code
    ));
    if (!matchedPayment) throw appError('The selected Salesforce refund no longer matches this supplier invoice, currency, and amount.', 409);
    matchedPaymentId = matchedPayment.id;
  }

  const eventType = status === 'Hold Acknowledged'
    ? 'supplier_hold_acknowledged'
    : status === 'Settled'
      ? 'supplier_recovery_settled'
      : recoveryMethod && recoveryMethod !== instruction.recovery_method
        ? 'supplier_recovery_method_selected'
        : 'accounting_updated';
  const eventNote = `${instruction.instruction_type === 'withhold_unpaid' ? 'Do not pay' : 'Get back paid amount'} updated to ${status}.`;
  const instructionValues = {
    status,
    recovery_method: recoveryMethod,
    target_supplier_invoice_id: targetInvoice?.supplierInvoiceId || null,
    target_supplier_invoice_name: targetInvoice?.invoiceName || null,
    target_stem_id: targetInvoice?.stemId || null,
    target_invoice_amount_snapshot: targetInvoice?.invoiceAmount ?? null,
    target_payable_amount_snapshot: targetInvoice?.payableBalance ?? null,
    target_invoice_snapshot: targetInvoice || {},
    target_stem_snapshot: targetInvoice?.stemId ? { stemId: targetInvoice.stemId } : {},
    matched_salesforce_payment_id: matchedPaymentId,
    matching_payment_snapshot: matchedPayment || {},
    instruction_reference: instructionReference || null,
    instruction_date: instructionDate,
    instruction_amount: decimalOrNull(body.instructionAmount) ?? (status === 'Instruction Issued' ? plannedAmount : null),
    settlement_reference: settlementReference || null,
    settlement_date: settlementDate,
    settlement_amount: settlementAmount,
    accounting_note: accountingNote || null,
    event_type: eventType,
    event_note: eventNote,
    event_metadata: {
      supplierInstructionId: instruction.id,
      recoveryMethod,
      targetSupplierInvoiceId: targetInvoice?.supplierInvoiceId || null,
      matchedSalesforcePaymentId: matchedPaymentId,
      plannedAmount,
      currencyIsoCode: instruction.currency_iso_code,
    },
  };
  const { error: updateError } = await client.rpc('update_dispute_supplier_instruction', {
    p_instruction_id: instruction.id,
    p_expected_revision: Number(instruction.revision || 1),
    p_values: instructionValues,
    p_target_payable_amount: targetInvoice?.payableBalance ?? null,
    p_actor: { id: profile.id, email: profile.email },
  });
  if (updateError) {
    if (String(updateError.message || '').includes('revision conflict')) {
      throw appError('This supplier instruction was updated by another user. Refresh and try again.', 409);
    }
    if (String(updateError.message || '').includes('already reserved')) {
      throw appError('The selected offset invoice no longer has enough unreserved payable balance. Refresh the offset options.', 409);
    }
    throw updateError;
  }

  if (caseRow.approval_status !== 'Approved') {
    const refreshed = await loadDisputeWorkflowActions(client, caseRow.id);
    return {
      case: serializeDisputeBetaCase(caseRow),
      parties: refreshed.partyRows.map(serializeDisputeWorkflowParty),
      actions: refreshed.actions,
      supplierInstructions: refreshed.supplierInstructions,
      documents: documents.map(serializeDisputeWorkflowDocument),
    };
  }
  let updatedCase = await getDisputeBetaCase(client, caseRow.id);
  updatedCase = await writeDisputeWorkflowStatusToSalesforce(
    client,
    updatedCase,
    profile,
    updatedCase.workflow_status,
  );
  const refreshed = await loadDisputeWorkflowActions(client, caseRow.id);
  return {
    case: serializeDisputeBetaCase(updatedCase),
    parties: workflow.partyRows.map(serializeDisputeWorkflowParty),
    actions: refreshed.actions,
    supplierInstructions: refreshed.supplierInstructions,
    documents: documents.map(serializeDisputeWorkflowDocument),
  };
}

async function disputeWorkflowSupplierAmountAmend(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  const actionId = String(body.actionId || '').trim();
  const amount = decimalOrNull(body.disputeAmount ?? body.amount);
  const note = String(body.note || body.description || '').trim();
  const currencyIsoCode = String(body.currencyIsoCode || 'USD').trim().toUpperCase();
  if (!actionId) throw appError('actionId is required.', 400);
  if (amount == null || amount < 0) throw appError('Supplier dispute amount must be zero or greater.', 400);
  if (!/^[A-Z]{3}$/.test(currencyIsoCode)) throw appError('Supplier dispute currency must be a three-letter ISO code.', 400);
  if (amount === 0 && !note) throw appError('Explain why no supplier recovery is required.', 400);
  const { data: action, error: actionError } = await client
    .from('dispute_beta_actions')
    .select(DISPUTE_BETA_ACTION_SELECT)
    .eq('id', actionId)
    .maybeSingle();
  if (actionError) throw actionError;
  if (!action || action.party_side !== 'supplier') throw appError('Supplier action not found.', 404);
  const caseRow = await getDisputeBetaCase(client, action.case_id);
  const actorEmail = String(profile.email || '').trim().toLowerCase();
  const responsibleTrader = (
    action.created_by === profile.id
    || caseRow.submitted_by === profile.id
    || [action.created_by_email, caseRow.submitted_by_email]
      .some((email) => String(email || '').trim().toLowerCase() === actorEmail)
  );
  if (profile.user_type !== 'administrator' && !responsibleTrader) {
    throw appError('Only the responsible trader or an administrator can record this supplier dispute amount.', 403);
  }
  if (caseRow.workflow_status === 'Closed') throw appError('Closed disputes cannot be amended.', 400);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  assertSalesforceDisputeIsOpen(currentStem);
  const workflow = await loadDisputeWorkflowActions(client, caseRow.id);
  const registry = assertValidDisputeParties(currentStem, workflow.partyRows);
  validateStoredDisputeActions(workflow.actionRows, workflow.partyRows, registry);
  const partyById = disputePartyRowMap(workflow.partyRows);
  const existingAmount = decimalOrNull(action.amount);
  const commercialAmountChanged = existingAmount == null || Math.abs(existingAmount - amount) > 0.01;
  const editableStage = ['Draft', 'Rejected', 'Revision Requested'].includes(caseRow.workflow_status);
  const amendedStage = editableStage
    ? caseRow.workflow_status
    : commercialAmountChanged
      ? 'Revision Requested'
      : caseRow.approval_status === 'Approved'
        ? 'Accounting In Progress'
        : caseRow.workflow_status;
  const amendedApproval = amendedStage === 'Draft'
    ? 'Draft'
    : amendedStage === 'Revision Requested'
      ? 'Revision Requested'
      : caseRow.approval_status;
  const rpcActions = workflow.actionRows.map((row) => {
    const party = partyById.get(row.party_id);
    const base = {
      ...row,
      party_account_key: party?.account_key,
    };
    if (row.id !== action.id) return base;
    return prepareSupplierSettlementAction({
      ...base,
      action_type: 'resolve_supplier_dispute',
      action_label: DISPUTE_BETA_ACTION_LABELS.resolve_supplier_dispute,
      amount,
      special_buy_price: null,
      description: note || row.description || '',
      currency_iso_code: currencyIsoCode,
      invoice_allocations: Array.isArray(body.invoiceAllocations) ? body.invoiceAllocations : [],
      execution_status: 'Pending Accounting',
    }, currentStem);
  });
  const financials = calculateDisputeBetaSettlement(rpcActions);
  const salesforceStatus = amendedStage === 'Draft' ? 'Open - Trader Review' : amendedStage;
  const casePayload = {
    ...disputeBetaCaseFromStem(currentStem),
    current_salesforce_status: salesforceStatus,
    workflow_status: amendedStage,
    approval_status: amendedApproval,
    latest_note: note || 'Supplier dispute amount recorded.',
    settlement_financials: financials,
    settlement_pnl: financials.settlementPnl,
  };
  const { data: savedCaseId, error: saveError } = await client.rpc('save_dispute_workflow_draft', {
    p_case: casePayload,
    p_parties: workflow.partyRows.map((party) => ({
      account_id: party.account_id,
      account_key: party.account_key,
      account_name: party.account_name,
      roles: party.roles,
      source_types: party.source_types,
      source_record_ids: party.source_record_ids,
      payment_terms: party.payment_terms,
      products: party.products,
      cancelled_source_only: party.cancelled_source_only,
    })),
    p_actions: rpcActions,
    p_actor: { id: profile.id, email: profile.email },
    p_event_note: note || 'Supplier dispute amount recorded.',
  });
  if (saveError) throw saveError;
  const updatedCase = await getDisputeBetaCase(client, savedCaseId || caseRow.id);
  await patchDisputeWorkflowStatusInSalesforce(updatedCase, salesforceStatus);
  const statusCase = await recordDisputeWorkflowSalesforceWriteback(client, updatedCase, profile, salesforceStatus);
  if (amendedStage === 'Revision Requested') {
    await writeDisputeBetaEvent(client, statusCase, 'revision_requested', profile, {
      actionId: action.id,
      note: 'Supplier dispute amount added to an existing workflow; approval is required again.',
      metadata: { disputeAmount: amount, currencyIsoCode },
    });
  } else if (!commercialAmountChanged && action.action_type !== 'resolve_supplier_dispute') {
    await writeDisputeBetaEvent(client, statusCase, 'supplier_payment_reconciled', profile, {
      actionId: action.id,
      note: 'Existing supplier amount converted into invoice-level Finance instructions.',
      metadata: { disputeAmount: amount, currencyIsoCode },
    });
  }
  const refreshed = await loadDisputeWorkflowActions(client, caseRow.id);
  const documents = await loadDisputeWorkflowDocuments(client, caseRow.id);
  return {
    case: serializeDisputeBetaCase(statusCase),
    parties: refreshed.partyRows.map(serializeDisputeWorkflowParty),
    actions: refreshed.actions,
    supplierInstructions: refreshed.supplierInstructions,
    documents: documents.map(serializeDisputeWorkflowDocument),
  };
}

async function disputeWorkflowAccountingUpdate(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  await requireCapability(client, profile, 'disputes_account', 'Dispute accounting permission is required for accounting updates.');
  const actionId = String(body.actionId || '').trim();
  if (!actionId) throw appError('actionId is required.', 400);
  const { data: action, error: actionLookupError } = await client
    .from('dispute_beta_actions')
    .select(DISPUTE_BETA_ACTION_SELECT)
    .eq('id', actionId)
    .maybeSingle();
  if (actionLookupError) throw actionLookupError;
  if (!action) throw appError('Dispute Workflow action not found.', 404);
  if (action.action_type === 'resolve_supplier_dispute') {
    throw appError('Update each supplier invoice instruction instead of the parent supplier resolution.', 400);
  }
  const caseRow = await getDisputeBetaCase(client, action.case_id);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const partyRows = await loadDisputeWorkflowParties(client, caseRow.id);
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  assertSalesforceDisputeIsOpen(currentStem);
  const registry = assertValidDisputeParties(currentStem, partyRows);
  const storedWorkflow = await loadDisputeWorkflowActions(client, caseRow.id);
  validateStoredDisputeActions(storedWorkflow.actionRows, partyRows, registry);
  assertSupplierDisputeAmounts(storedWorkflow.actionRows);
  if (caseRow.approval_status !== 'Approved' || caseRow.workflow_status === 'Closed') {
    throw appError('Accounting can update actions only after approval and before closure.', 400);
  }
  await reconcileApprovedSupplierInstructions(
    client,
    caseRow,
    partyRows,
    storedWorkflow.actionRows,
    storedWorkflow.instructionRows,
    currentStem,
    profile,
  );

  const accountingStatus = normalizeDisputeBetaStatus(body.accountingStatus || body.executionStatus, DISPUTE_BETA_EXECUTION_STATUSES, '');
  if (!accountingStatus) throw appError('Valid accounting status is required.', 400);
  const instructionReference = String(body.instructionReference || '').trim();
  const instructionDate = String(body.instructionDate || '').trim() || null;
  const settlementReference = String(body.settlementReference || '').trim();
  const settlementDate = String(body.settlementDate || '').trim() || null;
  const accountingNote = String(body.accountingNote || body.note || '').trim();
  if (instructionDate && !/^\d{4}-\d{2}-\d{2}$/.test(instructionDate)) throw appError('Instruction date is invalid.', 400);
  if (settlementDate && !/^\d{4}-\d{2}-\d{2}$/.test(settlementDate)) throw appError('Settlement date is invalid.', 400);
  if (accountingStatus === 'Instruction Issued' && (!instructionDate || (!instructionReference && !accountingNote))) {
    throw appError('Instruction Issued requires an instruction date and a reference or accounting note.', 400);
  }
  const documents = await loadDisputeWorkflowDocuments(client, caseRow.id);
  const hasSettlementDocument = documents.some((document) => document.action_id === actionId && [
    'settlement_agreement',
    'buyer_credit_note',
    'supplier_credit_note',
    'proof_of_payment',
  ].includes(document.document_type));
  if (accountingStatus === 'Settled' && (!settlementDate || (!settlementReference && !hasSettlementDocument))) {
    throw appError('Settled requires a settlement date and either a reference or settlement document.', 400);
  }
  if (accountingStatus === 'Not Required' && !accountingNote) {
    throw appError('Explain why accounting is not required.', 400);
  }

  const { data: currentActionRows, error: currentActionsError } = await client
    .from('dispute_beta_actions')
    .select(DISPUTE_BETA_ACTION_SELECT)
    .eq('case_id', caseRow.id)
    .order('created_at', { ascending: true });
  if (currentActionsError) throw currentActionsError;
  const projectedActions = (currentActionRows || []).map((row) => (
    row.id === actionId ? { ...row, execution_status: accountingStatus } : row
  ));
  const allSettled = projectedActions.length > 0 && projectedActions.every((row) => row.execution_status === 'Settled' || row.execution_status === 'Not Required');
  const hasAccountingProgress = projectedActions.some((row) => row.execution_status !== 'Pending Accounting');
  const workflowStatus = allSettled
    ? 'Settled - Ready to Close'
    : hasAccountingProgress
      ? 'Accounting In Progress'
      : 'Approved - Pending Accounting';
  await patchDisputeWorkflowStatusInSalesforce(caseRow, workflowStatus);

  const nowIso = new Date().toISOString();
  const { data: updatedAction, error } = await client
    .from('dispute_beta_actions')
    .update({
      execution_status: accountingStatus,
      instruction_reference: instructionReference || null,
      instruction_date: instructionDate,
      instruction_amount: decimalOrNull(body.instructionAmount),
      settlement_reference: settlementReference || null,
      settlement_date: settlementDate,
      settlement_amount: decimalOrNull(body.settlementAmount),
      accounting_note: accountingNote || null,
      accounting_by: profile.id,
      accounting_by_email: profile.email,
      accounting_at: nowIso,
      executed_by: accountingStatus === 'Settled' ? profile.id : null,
      executed_by_email: accountingStatus === 'Settled' ? profile.email : null,
      executed_at: accountingStatus === 'Settled' ? nowIso : null,
      execution_note: accountingNote || null,
      updated_by: profile.id,
      updated_by_email: profile.email,
      updated_at: nowIso,
    })
    .eq('id', actionId)
    .select(DISPUTE_BETA_ACTION_SELECT)
    .single();
  if (error) throw error;
  await writeDisputeBetaEvent(client, caseRow, 'accounting_updated', profile, {
    actionId,
    note: `${updatedAction.action_label} updated to ${accountingStatus}.`,
    metadata: { accountingStatus, instructionReference, instructionDate, settlementReference, settlementDate },
  });
  const { data: actionRows, error: actionsError } = await client
    .from('dispute_beta_actions')
    .select(DISPUTE_BETA_ACTION_SELECT)
    .eq('case_id', caseRow.id)
    .order('created_at', { ascending: true });
  if (actionsError) throw actionsError;
  const actions = actionRows || [];
  const { data: statusCase, error: caseError } = await client
    .from('dispute_beta_cases')
    .update({ workflow_status: workflowStatus, updated_at: nowIso })
    .eq('id', caseRow.id)
    .select(DISPUTE_BETA_CASE_SELECT)
    .single();
  if (caseError) throw caseError;
  const salesforceCase = await recordDisputeWorkflowSalesforceWriteback(client, statusCase, profile, workflowStatus);
  const partyMap = disputePartyRowMap(partyRows);
  return {
    case: serializeDisputeBetaCase(salesforceCase),
    parties: partyRows.map(serializeDisputeWorkflowParty),
    action: serializeDisputeBetaAction(updatedAction, partyMap),
    actions: (actions || []).map((item) => serializeDisputeBetaAction(item, partyMap)),
    documents: documents.map(serializeDisputeWorkflowDocument),
  };
}

async function disputeBetaMarkExecuted(body = {}, req, accessContext = null) {
  return disputeWorkflowAccountingUpdate({
    ...body,
    accountingStatus: 'Settled',
    settlementDate: body.settlementDate || new Date().toISOString().slice(0, 10),
    settlementReference: body.settlementReference || body.note,
    accountingNote: body.accountingNote || body.note,
  }, req, accessContext);
}

async function disputeBetaClose(body = {}, req, accessContext = null) {
  const { client, profile } = accessContext || await requireActiveUser(req);
  await requireCapability(client, profile, 'disputes_account', 'Dispute accounting permission is required to close a dispute.');
  const caseRow = await getDisputeBetaCase(client, body.caseId || body.stemId);
  await requireInterofficeStemAccess(caseRow.stem_id, accessContext || { client, profile });
  const currentStem = await loadCurrentDisputeStem(caseRow.stem_id, accessContext || { client, profile });
  if (!hasRecordedFcosClosureWriteback(caseRow)) assertSalesforceDisputeIsOpen(currentStem);
  let { partyRows, actionRows, instructionRows } = await loadDisputeWorkflowActions(client, caseRow.id);
  const registry = assertValidDisputeParties(currentStem, partyRows);
  const reconciliation = await reconcileApprovedSupplierInstructions(
    client,
    caseRow,
    partyRows,
    actionRows,
    instructionRows,
    currentStem,
    profile,
  );
  if (reconciliation.changed) {
    const reloaded = await loadDisputeWorkflowActions(client, caseRow.id);
    partyRows = reloaded.partyRows;
    actionRows = reloaded.actionRows;
    instructionRows = reloaded.instructionRows;
    throw appError('Supplier payments changed after approval. FCOS updated the accounting plan; Finance must complete the revised instructions before closure.', 409);
  }
  if (caseRow.approval_status !== 'Approved') throw appError('Only approved Dispute Workflow cases can be closed.', 400);
  if (caseRow.workflow_status !== 'Settled - Ready to Close') throw appError('Complete accounting settlement for every action before closing.', 400);
  const finalNote = String(body.note || '').trim();
  if (!finalNote) throw appError('Final closure note is required.', 400);
  const actions = validateStoredDisputeActions(actionRows, partyRows, registry);
  assertSupplierDisputeAmounts(actions);
  const activeSupplierInstructions = instructionRows.filter((instruction) => instruction.status !== 'Superseded');
  if (activeSupplierInstructions.some((instruction) => !['Settled', 'Not Required'].includes(instruction.status))) {
    throw appError('Every supplier invoice instruction must be Settled or Not Required before closure.', 400);
  }
  if (!(actions || []).length || !(actions || []).every((action) => action.execution_status === 'Settled' || action.execution_status === 'Not Required')) {
    throw appError('Every accounting action must be Settled or Not Required before closure.', 400);
  }
  const documents = await assertRequiredDisputeDocuments(client, actions || []);
  const statusCase = await writeDisputeWorkflowStatusToSalesforce(client, caseRow, profile, 'Closed', { required: true });
  const nowIso = new Date().toISOString();
  const { data: updatedCase, error } = await client
    .from('dispute_beta_cases')
    .update({
      workflow_status: 'Closed',
      latest_note: finalNote,
      current_salesforce_status: 'Closed',
      salesforce_writeback_status: 'success',
      salesforce_writeback_error: null,
      closed_by: profile.id,
      closed_by_email: profile.email,
      closed_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', statusCase.id)
    .select(DISPUTE_BETA_CASE_SELECT)
    .single();
  if (error) throw error;
  await writeDisputeBetaEvent(client, updatedCase, 'closed', profile, { note: finalNote });
  const partyMap = disputePartyRowMap(partyRows);
  return {
    case: serializeDisputeBetaCase(updatedCase),
    parties: partyRows.map(serializeDisputeWorkflowParty),
    actions: (actions || []).map((item) => serializeDisputeBetaAction(item, partyMap)),
    documents: documents.map(serializeDisputeWorkflowDocument),
  };
}

async function salesforceStemDetailFull(body, req = null, accessContext = null) {
  const { stemId, updates, childObject, childId, childUpdates } = body;
  if (!stemId) throw new Error('stemId required');

  let actualStemId = stemId;
  if (stemId.length < 15) {
    const lookup = await queryRows(`SELECT Id FROM stem__c WHERE KeyStem__c = '${escapeSoql(stemId)}' LIMIT 1`, { softFail: true });
    if (!lookup.length) throw new Error(`STEM with KeyStem__c '${stemId}' not found`);
    actualStemId = lookup[0].Id;
  }
  await requireInterofficeStemAccess(actualStemId, accessContext);

  if (childObject && childId && childUpdates && Object.keys(childUpdates).length > 0) {
    await sfRequest(`/sobjects/${childObject}/${childId}`, { method: 'PATCH', body: childUpdates });
  }
  if (updates && Object.keys(updates).length > 0) {
    await sfRequest(`/sobjects/stem__c/${actualStemId}`, { method: 'PATCH', body: updates });
  }

  const [recordRaw, lineItems, extraCosts, buyerBrokers] = await Promise.all([
    sfRequest(`/sobjects/stem__c/${actualStemId}`).then(cleanRecord),
    queryRows(`SELECT Id, Name, STEM__c, Product__c, Product__r.Name, Product__r.Family, Supplier_Name__c, BDN_Company__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_Max__c, Quantity_in_MT__c, Is_Quantity_Range__c, Price_Per_Unit__c, Cost_Per_Unit__c, Unit_Sell_At__c, Unit_Buy_At__c, Unit_Cost__c, Subtotal_Sell_At__c, Subtotal_Buy_At__c, Total_Price__c, Total_Cost__c, Supplier_Invoice__c, Payment_Term__c, BDN_Number__c, Cancelled__c, Buyers_Broker__c, Buyer_Broker__c, Buyers_Brokers_Commission_Per_Unit__c, Buyers_Brokers_Commission_Lumpsum__c, Commission_Cost__c, Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c, Suppliers_Brokers_Commission_Lumpsum__c, Offer_Line_Item__r.UnitPrice, Offer_Line_Item__r.Supplier_Unit_Price__c FROM STEM_Line_Item__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { softFail: true }),
    queryRows(`SELECT Id, Name, Description__c, Product2Id__c, Product2Id__r.Name, Product2Id__r.Family, Supplier_Name__c, Quantity__c, Quantity_Delivered_Per_BDN__c, Quantity_in_MT__c, Quantity_Range_Max__c, Is_Quantity_Range__c, Unit_Price__c, Unit_Cost__c, Line_Total__c, Line_Total_Buy__c, Supplier_Invoice__c, Supplier_Issued__c, Payment_Term__c, Cancelled__c FROM STEM_Extra_Cost__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { softFail: true }),
    queryRows(`SELECT Id, STEM__c, Buyer_Broker__c, Refcode_Index__c, Exported__c, Commission_Lumpsum__c, STEM_Line_Item__r.Id FROM STEM_Buyer_Broker__c WHERE STEM__c = '${actualStemId}' ORDER BY CreatedDate ASC`, { softFail: true }),
  ]);
  const supplierInvoiceIds = [...new Set([
    ...lineItems.map((item) => item.Supplier_Invoice__c),
    ...extraCosts.map((item) => item.Supplier_Invoice__c),
  ].filter(isSalesforceId))];
  const supplierInvoiceNameMap = await namesByIds('Supplier_Invoice__c', supplierInvoiceIds);
  const supplierInvoiceSupplierNameMap = {};
  for (const item of [...lineItems, ...extraCosts]) {
    if (item.Supplier_Invoice__c && item.Supplier_Name__c && !supplierInvoiceSupplierNameMap[item.Supplier_Invoice__c]) {
      supplierInvoiceSupplierNameMap[item.Supplier_Invoice__c] = item.Supplier_Name__c;
    }
  }

  const brokerAccountIds = [...new Set([
    ...lineItems.map((item) => item.Supplier_Broker__c).filter(Boolean),
    ...lineItems.map((item) => item.Buyers_Broker__c || item.Buyer_Broker__c).filter(Boolean),
    ...buyerBrokers.map((item) => item.Buyer_Broker__c).filter(Boolean),
  ])];
  const brokerAccountMap = await namesByIds('Account', brokerAccountIds);
  for (const [id, name] of Object.entries(brokerAccountMap)) brokerAccountMap[String(id).slice(0, 15)] = name;
  const brokerCommissionGroupsByStem = buildBrokerCommissionGroups({
    stemMap: { [actualStemId]: recordRaw },
    lineItems,
    buyerBrokers,
    accountMap: brokerAccountMap,
  });
  const brokerCommissionGroups = brokerCommissionGroupsByStem[actualStemId] || [];
  const stemHasDelivery = !!recordRaw.Delivery_Date__c;
  const payableAmountCandidates = stemPayableAmountCandidates({ stem: recordRaw, lineItems, extraCosts });

  let supplierInvoicePayments = [];
  let buyerInvoicePayments = [];
  const brokerCommissionPaymentMap = new Map();
  const paymentDescribe = await salesforceObjectFields({ objectName: 'Payment__c' }).catch(() => ({ fields: [] }));
  const paymentFields = paymentDescribe.fields || [];
  const paymentFieldNames = new Set(paymentFields.map((field) => field.name));
  const paymentAmountField = [
    'Amount__c',
    'Payment_Amount__c',
    'Paid_Amount__c',
    'Received_Amount__c',
    'Total_Amount__c',
    'Amount_Paid__c',
    'Payment_Value__c',
    'Actual_Amount__c',
  ].find((field) => paymentFieldNames.has(field));
  const paymentDateField = firstAvailableField(paymentFieldNames, ['Date__c', 'Payment_Date__c', 'Received_Date__c', 'Paid_Date__c', 'CreatedDate']);
  const supplierInvoiceLookupFields = incomingPaymentSupplierInvoiceFields(paymentFields);
  const paymentReferenceFields = incomingPaymentReferenceFields(paymentFields);
  const paymentDirectionFields = incomingPaymentDirectionFields(paymentFields);
  const paymentStatusFields = selectedFields(paymentFieldNames, ['Status__c', 'Payment_Status__c']);
  const paymentTypeFields = selectedFields(paymentFieldNames, ['Type__c', 'Payment_Type__c']);
  const paymentSelectFields = [
    'Id',
    paymentFieldNames.has('Name') ? 'Name' : null,
    paymentFieldNames.has('RecordTypeId') ? 'RecordTypeId' : null,
    paymentFieldNames.has('RecordTypeId') ? 'RecordType.Name' : null,
    paymentFieldNames.has('RecordTypeId') ? 'RecordType.DeveloperName' : null,
    paymentFieldNames.has('STEM__c') ? 'STEM__c' : null,
    paymentFieldNames.has('CreatedDate') ? 'CreatedDate' : null,
    paymentDateField,
    ...supplierInvoiceLookupFields,
    paymentAmountField,
    ...paymentReferenceFields,
    ...paymentStatusFields,
    ...paymentTypeFields,
    ...paymentDirectionFields,
  ].filter(Boolean);
  const paymentOrder = paymentDateField ? `${paymentDateField} DESC NULLS LAST, CreatedDate DESC` : 'CreatedDate DESC';
  if (paymentSelectFields.length > 1) {
    const selectedPaymentFields = [...new Set(paymentSelectFields)];
    const paymentDateValue = (payment) => (paymentDateField ? payment[paymentDateField] : null) || payment.Date__c || payment.CreatedDate || null;
    const sortPaymentRows = (rows) => rows.sort((a, b) => String(paymentDateValue(b) || '').localeCompare(String(paymentDateValue(a) || '')));
    const decoratePayment = (payment, supplierInvoiceId = null) => ({
        ...payment,
        Date__c: paymentDateValue(payment),
        _Payment_Amount: paymentAmountField ? payment[paymentAmountField] : null,
        _Payment_Amount_Field: paymentAmountField || null,
        _Supplier_Invoice_Name: supplierInvoiceId
          ? supplierInvoiceNameMap[supplierInvoiceId] || supplierInvoiceId
          : null,
      });
    const supplierPaymentMap = new Map();
    const buyerPaymentMap = new Map();
    const addBrokerCommissionPayment = (payment, brokerMatch) => {
      if (!payment?.Id || !brokerMatch) return;
      supplierPaymentMap.delete(payment.Id);
      buyerPaymentMap.delete(payment.Id);
      if (!brokerCommissionPaymentMap.has(brokerMatch.key)) {
        brokerCommissionPaymentMap.set(brokerMatch.key, {
          ...brokerMatch,
          payments: [],
        });
      }
      brokerCommissionPaymentMap.get(brokerMatch.key).payments.push(decoratePayment(payment));
    };
    const addSupplierPayment = (payment, supplierInvoiceId = null) => {
      if (!payment?.Id) return;
      const invoiceId = supplierInvoiceId || incomingPaymentSupplierInvoiceId(payment, supplierInvoiceLookupFields);
      supplierPaymentMap.set(payment.Id, {
        ...decoratePayment(payment, invoiceId),
        _Supplier_Invoice_Name: invoiceId
          ? supplierInvoiceNameMap[invoiceId] || invoiceId
          : 'Supplier payment',
        _Supplier_Name: invoiceId
          ? supplierInvoiceSupplierNameMap[invoiceId] || supplierInvoiceNameMap[invoiceId] || invoiceId
          : 'Supplier payment',
      });
    };
    const addBuyerPayment = (payment) => {
      if (!payment?.Id) return;
      buyerPaymentMap.set(payment.Id, decoratePayment(payment));
    };

    if (supplierInvoiceIds.length && supplierInvoiceLookupFields.length) {
      await Promise.all(supplierInvoiceLookupFields.map(async (field) => {
        const paymentChunks = await Promise.all(chunkIds(supplierInvoiceIds).map((chunk) => {
          const inList = chunk.map((id) => `'${escapeSoql(id)}'`).join(',');
          return queryRows(`
            SELECT ${selectedPaymentFields.join(', ')}
            FROM Payment__c
            WHERE ${field} IN (${inList})
            ORDER BY ${paymentOrder}
            LIMIT 2000
          `, { limit: 2000, softFail: true });
        }));
        for (const payment of paymentChunks.flat()) addSupplierPayment(payment, payment[field]);
      }));
    }
    if (paymentFieldNames.has('STEM__c')) {
      const stemPayments = await queryRows(`
        SELECT ${selectedPaymentFields.join(', ')}
        FROM Payment__c
        WHERE STEM__c = '${escapeSoql(actualStemId)}'
        ORDER BY ${paymentOrder}
        LIMIT 2000
      `, { limit: 2000, softFail: true });
      for (const payment of stemPayments) {
        if (incomingPaymentIsReceivableRemittance(payment, [...paymentReferenceFields, ...paymentDirectionFields, ...paymentTypeFields, ...paymentStatusFields])) continue;
        const amount = paymentAmountField ? incomingPaymentNumber(payment[paymentAmountField]) : null;
        const brokerCommissionMatch = findBrokerCommissionPaymentMatch(payment, amount, brokerCommissionGroups, [...paymentReferenceFields, ...paymentDirectionFields, ...paymentTypeFields, ...paymentStatusFields]);
        if (brokerCommissionMatch) {
          addBrokerCommissionPayment(payment, brokerCommissionMatch);
          continue;
        }
        const bankCharge = incomingPaymentLooksBankCharge(payment, {
          referenceFields: paymentReferenceFields,
          directionFields: paymentDirectionFields,
          typeFields: paymentTypeFields,
          statusFields: paymentStatusFields,
        });
        if (bankCharge) continue;
        const supplierSide = incomingPaymentLooksSupplierSide(payment, {
          supplierInvoiceFields: supplierInvoiceLookupFields,
          directionFields: paymentDirectionFields,
          typeFields: paymentTypeFields,
          statusFields: paymentStatusFields,
        });
        if (supplierSide) {
          addSupplierPayment(payment);
        } else if (incomingPaymentLooksStemPayableCalculation(payment, {
          amount,
          payableAmounts: payableAmountCandidates,
          referenceFields: paymentReferenceFields,
          directionFields: paymentDirectionFields,
          typeFields: paymentTypeFields,
          statusFields: paymentStatusFields,
          allowBlankSignal: !stemHasDelivery,
        })) {
          continue;
        } else if (amount == null || amount >= 0) {
          addBuyerPayment(payment);
        }
      }
    }
    supplierInvoicePayments = sortPaymentRows([...supplierPaymentMap.values()]);
    buyerInvoicePayments = sortPaymentRows([...buyerPaymentMap.values()]);
  }

  const [vesselName, portName, agentName, accountName, buyerBrokerName, factoringInvoiceName] = await Promise.all([
    recordRaw.Vessel__c ? resolveViaQuery('Vessel__c', recordRaw.Vessel__c, 'Name') : Promise.resolve(null),
    recordRaw.Port__c ? resolveViaQuery('Port__c', recordRaw.Port__c, 'Name') : Promise.resolve(null),
    recordRaw.Agent__c ? resolveViaQuery('Account', recordRaw.Agent__c, 'Name') : Promise.resolve(null),
    recordRaw.Account__c ? resolveViaQuery('Account', recordRaw.Account__c, 'Name') : Promise.resolve(null),
    recordRaw.Buyer_Broker__c ? resolveViaQuery('Account', recordRaw.Buyer_Broker__c, 'Name') : Promise.resolve(null),
    recordRaw.Factoring_Invoice__c ? resolveViaQuery('Invoice__c', recordRaw.Factoring_Invoice__c, 'Name') : Promise.resolve(null),
  ]);

  const buyerBrokersWithNames = await Promise.all(
    buyerBrokers.map(async (bb) => ({
      ...bb,
      _Buyer_Broker_Name: bb.Buyer_Broker__c ? brokerAccountMap[bb.Buyer_Broker__c] || brokerAccountMap[String(bb.Buyer_Broker__c).slice(0, 15)] || await resolveViaQuery('Account', bb.Buyer_Broker__c, 'Name') : null,
    }))
  );

  const supplierBrokerIds = [...new Set(lineItems.map((li) => li.Supplier_Broker__c).filter(Boolean))];
  const supplierBrokerNameMap = {};
  await Promise.all(supplierBrokerIds.map(async (id) => {
    supplierBrokerNameMap[id] = brokerAccountMap[id] || brokerAccountMap[String(id).slice(0, 15)] || await resolveViaQuery('Account', id, 'Name');
  }));

  const lineItemsWithNames = lineItems.map((li) => {
    const calculatedQuantity = financialQuantity(li, stemHasDelivery);
    const calculatedSell = lineSellAmount(li, stemHasDelivery);
    const calculatedBuy = lineBuyAmount(li, stemHasDelivery);
    return {
      ...li,
      _Financial_Quantity: calculatedQuantity,
      _Financial_Quantity_Unit: 'MT',
      ...(!stemHasDelivery ? {
        Total_Price__c: calculatedSell,
        Total_Cost__c: calculatedBuy,
      } : {}),
      _Product_Name: li['Product__r']?.Name ?? null,
      _Supplier_Broker_Name: li.Supplier_Broker__c ? supplierBrokerNameMap[li.Supplier_Broker__c] : null,
    };
  });
  const extraCostsWithNames = extraCosts.map((ec) => {
    const calculatedQuantity = financialQuantity(ec, stemHasDelivery, 'Quantity_Range_Max__c');
    const calculatedSell = extraSellAmount(ec, stemHasDelivery);
    const calculatedBuy = extraBuyAmount(ec, stemHasDelivery);
    return {
      ...ec,
      _Financial_Quantity: calculatedQuantity,
      _Financial_Quantity_Unit: 'MT',
      ...(!stemHasDelivery ? {
        Line_Total__c: calculatedSell,
        Line_Total_Buy__c: calculatedBuy,
      } : {}),
      _Product_Name: ec['Product2Id__r']?.Name ?? null,
    };
  });
  const calculatedLineItemSell = lineItems.reduce((sum, li) => {
    if (li.Cancelled__c) return sum;
    return sum + lineSellAmount(li, stemHasDelivery);
  }, 0);
  const calculatedExtraCostSell = extraCosts.reduce((sum, ec) => {
    if (ec.Cancelled__c) return sum;
    return sum + extraSellAmount(ec, stemHasDelivery);
  }, 0);
  const calculatedUndatedBuyerInvoice = calculatedLineItemSell + calculatedExtraCostSell;
  const shouldUseCalculatedBuyerInvoice = !recordRaw.Delivery_Date__c
    && calculatedUndatedBuyerInvoice > 0;
  const calculatedSupplierInvoice = payableAmountCandidates[0] ?? 0;
  const record = {
    ...recordRaw,
    Total_Invoice_Amount__c: shouldUseCalculatedBuyerInvoice
      ? calculatedUndatedBuyerInvoice
      : recordRaw.Total_Invoice_Amount__c,
    _Supplier_Invoice_Amount: calculatedSupplierInvoice,
    _Buyer_Pay_Term_Date: calculatedBuyerPayTermDate(recordRaw)
      || recordRaw.Invoice_Due_Date__c
      || recordRaw.Buyer_Pay_Term_Date__c,
    _Buyer_Name: recordRaw.Buyer_Name__c || accountName || recordRaw.Buyer__c || null,
    _Vessel_Name: vesselName,
    _Port_Name: portName,
    _Agent_Name: agentName,
    _Account_Name: accountName,
    _Buyer_Broker_Name: buyerBrokerName,
    _Factoring_Invoice_Name: factoringInvoiceName,
  };

  return {
    record,
    lineItems: lineItemsWithNames,
    extraCosts: extraCostsWithNames,
    buyerBrokers: buyerBrokersWithNames,
    supplierInvoicePayments,
    buyerInvoicePayments,
    brokerCommissionPayments: [...brokerCommissionPaymentMap.values()].map((group) => ({
      ...group,
      payments: group.payments.sort((a, b) => String(b.Date__c || '').localeCompare(String(a.Date__c || ''))),
    })),
  };
}

function uniquePresentValues(values) {
  return [...new Set(values.filter((value) => value != null && value !== ''))];
}

function singleOrMixed(values) {
  const unique = uniquePresentValues(values);
  if (!unique.length) return null;
  return unique.length === 1 ? unique[0] : 'Mixed';
}

function latestIsoDate(values) {
  const dates = uniquePresentValues(values).filter((value) => /^\d{4}-\d{2}-\d{2}/.test(String(value)));
  return dates.sort().at(-1) || null;
}

function addBrokerProductQuantity(group, row) {
  const productName = row.productFamily || row.productName || '—';
  const unit = row.quantityUnit || 'MT';
  const key = `${productName}::${unit}`;
  if (!group._productMap.has(key)) {
    group._productMap.set(key, {
      productName,
      productFamily: row.productFamily || productName,
      quantity: 0,
      hasQuantity: false,
      unit,
    });
  }
  const item = group._productMap.get(key);
  const qty = numericValue(row.bdnQuantity);
  if (qty != null) {
    item.quantity += qty;
    item.hasQuantity = true;
  }
}

function combineBrokerCommissionRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const brokerKey = row.brokerId || row.brokerName || '';
    const key = [row.stemId, row.brokerType, brokerKey].join('::');
    if (!groups.has(key)) {
      groups.set(key, {
        ...row,
        id: `${row.brokerType}-${row.stemId}-${brokerKey}`.replace(/\s+/g, '-'),
        commissionAmount: 0,
        _productMap: new Map(),
        _commissionUnitPrices: [],
        _commissionUnitLines: [],
        _paymentDates: [],
        _paymentDateLabels: [],
        _paymentDelays: [],
      });
    }
    const group = groups.get(key);
    group.commissionAmount += Number(row.commissionAmount || 0);
    if (row.commissionUnitPrice != null) group._commissionUnitPrices.push(Number(row.commissionUnitPrice));
    group._commissionUnitLines.push({
      productName: row.productFamily || row.productName || '—',
      value: numericValue(row.commissionUnitPrice),
    });
    if (row.paymentDate) group._paymentDates.push(row.paymentDate);
    if (row.paymentDateLabel) group._paymentDateLabels.push(row.paymentDateLabel);
    if (row.paymentDelay != null) group._paymentDelays.push(Number(row.paymentDelay));
    addBrokerProductQuantity(group, row);
  }

  return [...groups.values()].map((group) => {
    const unitPrices = uniquePresentValues(group._commissionUnitPrices);
    const paymentDates = uniquePresentValues(group._paymentDates);
    const paymentDelays = uniquePresentValues(group._paymentDelays);
    const commissionUnitPriceLines = group._commissionUnitLines.map((item) => ({
      productName: item.productName,
      value: item.value,
      label: item.value != null ? `${money(item.value)} / MT` : '—',
    }));
    const productQuantities = [...group._productMap.values()].map((item) => ({
      productName: item.productName,
      productFamily: item.productFamily || item.productName,
      quantity: item.hasQuantity ? item.quantity : null,
      quantityUnit: item.unit,
      label: item.hasQuantity ? `${item.productName} - ${formatQuantityLabel(item.quantity, item.unit)}` : item.productName,
    }));
    return {
      ...group,
      productName: productQuantities.map((item) => item.productName).join('; '),
      bdnQuantity: productQuantities.length === 1 ? productQuantities[0].quantity : null,
      quantityUnit: productQuantities.length === 1 ? productQuantities[0].quantityUnit : 'MT',
      productQuantities,
      productQuantityLabel: productQuantities.map((item) => item.label).join('; '),
      commissionUnitPrice: unitPrices.length === 1 ? unitPrices[0] : null,
      commissionUnitPriceLines,
      commissionUnitPriceLabel: commissionUnitPriceLines.map((item) => item.label).join('; '),
      paymentDate: paymentDates.length <= 1 ? paymentDates[0] || null : 'Mixed',
      paymentDateSort: latestIsoDate(paymentDates),
      paymentDateLabel: singleOrMixed(group._paymentDateLabels) || group.paymentDateLabel,
      paymentDelay: paymentDelays.length === 1 ? paymentDelays[0] : null,
      paymentDelayLabel: paymentDelays.length > 1 ? 'Mixed' : null,
      _productMap: undefined,
      _commissionUnitPrices: undefined,
      _commissionUnitLines: undefined,
      _paymentDates: undefined,
      _paymentDateLabels: undefined,
      _paymentDelays: undefined,
    };
  });
}

async function salesforceBrokerRegisterFull(body, req = null, accessContext = null) {
  const limit = Math.min(Number(body.limit) || 2000, 3000);
  const interofficeCondition = await interofficeStemAccessCondition(accessContext);
  const whereClause = interofficeCondition ? `WHERE ${interofficeCondition}` : '';
  const stems = await queryRows(`
    SELECT Id, Name, Delivery_Date__c, Payment_Date__c, Buyer_Pay_Term_Date__c
    FROM stem__c
    ${whereClause}
    ORDER BY Delivery_Date__c DESC NULLS LAST
    LIMIT ${limit}
  `, { limit });
  const stemMap = Object.fromEntries(stems.map((stem) => [stem.Id, stem]));
  const stemIds = stems.map((stem) => stem.Id);
  if (!stemIds.length) return { rows: [] };

  const [lineItemChunks, buyerBrokerChunks, buyerPaymentChunks, buyerInvoiceChunks] = await Promise.all([
    Promise.all(chunkIds(stemIds).map((chunk) => {
      const ids = chunk.map((id) => `'${id}'`).join(',');
      return queryRows(`
        SELECT Id, Name, STEM__c, Product__r.Name, Product__r.Family, Supplier_Invoice__c,
               Supplier_Broker__c, Suppliers_Brokers_Commission_Per_Unit__c,
               Quantity_Delivered_Per_BDN__c, Quantity__c, Quantity_in_MT__c, Commission_Cost__c, Cancelled__c,
               Buyers_Broker__c, Buyer_Broker__c, Buyers_Brokers_Commission_Per_Unit__c,
               Buyers_Brokers_Commission_Lumpsum__c
        FROM STEM_Line_Item__c
        WHERE STEM__c IN (${ids})
        LIMIT 5000
      `, { limit: 5000 });
    })),
    Promise.all(chunkIds(stemIds).map((chunk) => {
      const ids = chunk.map((id) => `'${id}'`).join(',');
      return queryRows(`
        SELECT Id, Name, STEM__c, Buyer_Broker__c
        FROM STEM_Buyer_Broker__c
        WHERE STEM__c IN (${ids})
        LIMIT 5000
      `, { limit: 5000 });
    })),
    Promise.all(chunkIds(stemIds).map((chunk) => {
      const ids = chunk.map((id) => `'${id}'`).join(',');
      return queryRows(`
        SELECT STEM__c, Date__c
        FROM Payment__c
        WHERE STEM__c IN (${ids}) AND Supplier_Invoice__c = null
        ORDER BY Date__c DESC
        LIMIT 5000
      `, { limit: 5000 });
    })),
    Promise.all(chunkIds(stemIds).map((chunk) => {
      const ids = chunk.map((id) => `'${id}'`).join(',');
      return queryRows(`
        SELECT STEM__c, Invoice_Due_Date__c
        FROM Invoice__c
        WHERE STEM__c IN (${ids})
        ORDER BY Invoice_Due_Date__c DESC
        LIMIT 5000
      `, { limit: 5000 });
    })),
  ]);

  const lineItems = lineItemChunks.flat();
  const buyerBrokers = buyerBrokerChunks.flat();
  const buyerPayments = buyerPaymentChunks.flat();
  const buyerInvoices = buyerInvoiceChunks.flat();
  const accountIds = [...new Set([
    ...lineItems.map((item) => item.Supplier_Broker__c).filter(Boolean),
    ...lineItems.map((item) => item.Buyers_Broker__c || item.Buyer_Broker__c).filter(Boolean),
    ...buyerBrokers.map((item) => item.Buyer_Broker__c).filter(Boolean),
  ])];

  const accountChunks = await Promise.all(chunkIds(accountIds).map((chunk) => {
    const ids = chunk.map((id) => `'${id}'`).join(',');
    return ids ? queryRows(`SELECT Id, Name, Hidden_Broker__c, Hidden_Broker_Company__c FROM Account WHERE Id IN (${ids})`, { softFail: true }) : Promise.resolve([]);
  }));
  const accountMap = {};
  const accountFlagMap = {};
  for (const account of accountChunks.flat()) {
    const flags = {
      hiddenBrokerIndividual: account.Hidden_Broker__c === true,
      hiddenBrokerCompany: account.Hidden_Broker_Company__c === true,
    };
    accountMap[account.Id] = account.Name;
    accountMap[String(account.Id).slice(0, 15)] = account.Name;
    accountFlagMap[account.Id] = flags;
    accountFlagMap[String(account.Id).slice(0, 15)] = flags;
  }

  const supplierInvoiceIds = [...new Set(lineItems.map((item) => item.Supplier_Invoice__c).filter(Boolean))];
  const paymentDateByInvoice = {};
  const paymentChunks = await Promise.all(chunkIds(supplierInvoiceIds).map((chunk) => {
    const ids = chunk.map((id) => `'${id}'`).join(',');
    return ids ? queryRows(`SELECT Supplier_Invoice__c, Date__c FROM Payment__c WHERE Supplier_Invoice__c IN (${ids}) ORDER BY Date__c DESC`, { softFail: true }) : Promise.resolve([]);
  }));
  for (const payment of paymentChunks.flat()) {
    if (payment.Supplier_Invoice__c && !paymentDateByInvoice[payment.Supplier_Invoice__c]) paymentDateByInvoice[payment.Supplier_Invoice__c] = payment.Date__c;
  }

  const buyerPaymentDateByStem = {};
  for (const payment of buyerPayments) {
    if (payment.STEM__c && !buyerPaymentDateByStem[payment.STEM__c]) buyerPaymentDateByStem[payment.STEM__c] = payment.Date__c;
  }
  const buyerInvoiceDueDateByStem = {};
  for (const invoice of buyerInvoices) {
    if (invoice.STEM__c && !buyerInvoiceDueDateByStem[invoice.STEM__c]) buyerInvoiceDueDateByStem[invoice.STEM__c] = invoice.Invoice_Due_Date__c;
  }

  const buyerBrokersByStem = {};
  for (const item of buyerBrokers) {
    if (!item.STEM__c) continue;
    if (!buyerBrokersByStem[item.STEM__c]) buyerBrokersByStem[item.STEM__c] = [];
    buyerBrokersByStem[item.STEM__c].push(item);
  }

  const rawRows = [];
  for (const item of lineItems) {
    const stem = stemMap[item.STEM__c];
    if (!stem) continue;
    const qty = financialQuantity(item, !!stem.Delivery_Date__c);
    const supplierAmount = item.Cancelled__c ? 0 : brokerAmount(item.Suppliers_Brokers_Commission_Per_Unit__c, qty);
    if (item.Supplier_Broker__c && supplierAmount !== 0) {
      rawRows.push({
        id: `supplier-${item.Id}`,
        stemId: item.STEM__c,
        stemName: stem.Name,
        brokerId: item.Supplier_Broker__c,
        productName: item['Product__r']?.Name || item.Name || '—',
        productFamily: item['Product__r']?.Family || item['Product__r']?.Name || item.Name || '—',
        bdnQuantity: qty || null,
        quantityUnit: 'MT',
        deliveryDate: stem.Delivery_Date__c,
        brokerType: 'Supplier Broker',
        brokerName: accountMap[item.Supplier_Broker__c] || item.Supplier_Broker__c,
        hiddenBrokerIndividual: accountFlagMap[item.Supplier_Broker__c]?.hiddenBrokerIndividual || false,
        hiddenBrokerCompany: accountFlagMap[item.Supplier_Broker__c]?.hiddenBrokerCompany || false,
        commissionUnitPrice: item.Suppliers_Brokers_Commission_Per_Unit__c ?? null,
        commissionAmount: supplierAmount,
        paymentDate: paymentDateByInvoice[item.Supplier_Invoice__c] || null,
        paymentDateLabel: 'Paid Date',
      });
    }

    const buyerBrokerId = item.Buyers_Broker__c || item.Buyer_Broker__c;
    const hasSupplierBrokerUnit = Number(item.Suppliers_Brokers_Commission_Per_Unit__c || 0) !== 0;
    const buyerPerUnitAmount = brokerAmount(item.Buyers_Brokers_Commission_Per_Unit__c, qty);
    const buyerLumpsumAmount = Number(item.Buyers_Brokers_Commission_Lumpsum__c || 0);
    const buyerAmount = buyerLumpsumAmount || buyerPerUnitAmount;
    if (buyerBrokerId && buyerAmount !== 0) {
      rawRows.push({
        id: `buyer-${item.Id}`,
        stemId: item.STEM__c,
        stemName: stem.Name,
        brokerId: buyerBrokerId,
        productName: item['Product__r']?.Name || item.Name || '—',
        productFamily: item['Product__r']?.Family || item['Product__r']?.Name || item.Name || '—',
        bdnQuantity: qty || null,
        quantityUnit: 'MT',
        deliveryDate: stem.Delivery_Date__c,
        brokerType: 'Buyer Broker',
        brokerName: accountMap[buyerBrokerId] || buyerBrokerId,
        hiddenBrokerIndividual: accountFlagMap[buyerBrokerId]?.hiddenBrokerIndividual || false,
        hiddenBrokerCompany: accountFlagMap[buyerBrokerId]?.hiddenBrokerCompany || false,
        commissionUnitPrice: item.Buyers_Brokers_Commission_Per_Unit__c ?? (qty ? buyerAmount / qty : null),
        commissionAmount: buyerAmount,
        paymentDate: stem.Payment_Date__c || buyerPaymentDateByStem[item.STEM__c] || null,
        paymentDateLabel: 'Received Date',
        paymentDelay: paymentDelayDays(stem.Payment_Date__c || buyerPaymentDateByStem[item.STEM__c], buyerInvoiceDueDateByStem[item.STEM__c] || stem.Buyer_Pay_Term_Date__c),
      });
    }

    const secondaryAmount = !hasSupplierBrokerUnit && item.Commission_Cost__c != null ? Number(item.Commission_Cost__c || 0) - buyerPerUnitAmount : 0;
    const secondaryBrokers = (buyerBrokersByStem[item.STEM__c] || []).filter((broker) => {
      if (!broker.Buyer_Broker__c) return true;
      if (!buyerBrokerId) return true;
      return String(broker.Buyer_Broker__c).slice(0, 15) !== String(buyerBrokerId).slice(0, 15);
    });
    if (secondaryAmount > 0 && secondaryBrokers.length > 0) {
      for (const broker of secondaryBrokers) {
        rawRows.push({
          id: `secondary-${item.Id}-${broker.Id}`,
          stemId: item.STEM__c,
          stemName: stem.Name,
          brokerId: broker.Buyer_Broker__c || null,
          productName: item['Product__r']?.Name || item.Name || '—',
          productFamily: item['Product__r']?.Family || item['Product__r']?.Name || item.Name || '—',
          bdnQuantity: qty || null,
          quantityUnit: 'MT',
          deliveryDate: stem.Delivery_Date__c,
          brokerType: 'Secondary Buyer Broker',
          brokerName: accountMap[broker.Buyer_Broker__c] || broker.Buyer_Broker__c || 'Secondary Buyer Broker',
          hiddenBrokerIndividual: accountFlagMap[broker.Buyer_Broker__c]?.hiddenBrokerIndividual || false,
          hiddenBrokerCompany: accountFlagMap[broker.Buyer_Broker__c]?.hiddenBrokerCompany || false,
          commissionUnitPrice: qty ? secondaryAmount / qty : null,
          commissionAmount: secondaryAmount,
          paymentDate: stem.Payment_Date__c || buyerPaymentDateByStem[item.STEM__c] || null,
          paymentDateLabel: 'Received Date',
          paymentDelay: paymentDelayDays(stem.Payment_Date__c || buyerPaymentDateByStem[item.STEM__c], buyerInvoiceDueDateByStem[item.STEM__c] || stem.Buyer_Pay_Term_Date__c),
        });
      }
    }
  }

  const rows = combineBrokerCommissionRows(rawRows);
  rows.sort((a, b) => String(b.deliveryDate || '').localeCompare(String(a.deliveryDate || '')));
  return { rows };
}

const handlers = {
  authContext,
  salesforceSchema,
  salesforceObjectFields,
  salesforceQuery,
  salesforceFullSchema,
  salesforceDashboard,
  salesforceDashboardFiltered: salesforceDashboardFilteredFull,
  salesforceStemDetail: salesforceStemDetailFull,
  salesforceStemDocuments,
  exceptionReviewWorkflowList,
  exceptionReviewWorkflowSave,
  salesforceDescribeChildren,
  salesforceTopBuyers,
  salesforceBrokerRegister: salesforceBrokerRegisterFull,
  salesforceBuyerInvoicesDue,
  buyerInvoiceCollectionList,
  buyerInvoiceCollectionSave,
  buyerInvoiceCollectionEventCreate,
  buyerInvoiceEmailSettingsGet,
  buyerInvoiceEmailSettingsSave,
  buyerInvoiceReminderRulesList,
  buyerInvoiceReminderRuleSave,
  buyerInvoiceReminderRuleRemove,
  buyerInvoicePaymentReminderPrepare,
  buyerInvoicePaymentReminderSend,
  outstandingBuyerInvoicesEmailReport,
  outstandingBuyerInvoicesEmailCron,
  incomingPaymentsList,
  incomingPaymentEmailReport,
  incomingPaymentInterestInvoiceRequest,
  incomingPaymentSettingsGet,
  incomingPaymentSettingsSave,
  incomingPaymentAllocationConfirm,
  cashflowForecast,
  cashflowBuyerPaymentPerformance,
  cashflowSettingsGet,
  cashflowSettingsSave,
  cashflowHolidayCalendar,
  salesforceDisputeStems,
  disputeBetaList,
  disputeBetaSaveDraft,
  disputeBetaSubmitApproval,
  disputeBetaApprove,
  disputeBetaReject,
  disputeBetaMarkExecuted,
  disputeBetaClose,
  disputeWorkflowList: disputeBetaList,
  disputeWorkflowSaveDraft: disputeBetaSaveDraft,
  disputeWorkflowSubmitApproval: disputeBetaSubmitApproval,
  disputeWorkflowApprove: disputeBetaApprove,
  disputeWorkflowReject: disputeBetaReject,
  disputeWorkflowAccountingUpdate,
  disputeWorkflowSupplierInstructionUpdate,
  disputeWorkflowSupplierOffsetOptions,
  disputeWorkflowSupplierAmountAmend,
  disputeWorkflowUploadDocument,
  disputeWorkflowDocuments,
  disputeWorkflowMarkExecuted: disputeBetaMarkExecuted,
  disputeWorkflowClose: disputeBetaClose,
  stemPnl: stemPnlFull,
  frankfurterUsdCnyRate,
  reportExportCreate,
  reportExportsList,
  reportExportRename,
  reportExportDelete,
  reportExportDownload,
  buyersAdministratorList,
  buyersAdministratorSave,
  accountManagersList,
  accountManagersSave,
  accountManagersSaveNote,
  accountManagersRetrySync,
  systemHealth,
  backboneBridgeIdentity,
  backboneTradeProjection,
  backboneFinanceHandoffs,
  backboneFinanceHandoffDetail,
  adminUsersList,
  adminAuditLogs,
  adminUserSave,
  adminUserDelete,
  adminUserTypeSave,
  adminUserTypeDelete,
  universalAuditTrail,
  adminBootstrap,
};

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const name = url.pathname.split('/').pop();
    if (name === 'salesforceDocumentDownload') {
      await requireHandlerAccess(name, req);
      return salesforceDocumentDownload(req, res);
    }
    const fn = handlers[name];
    if (!fn) return sendJson(res, { error: `Unknown function: ${name}` }, 404);
    const accessContext = await requireHandlerAccess(name, req);
    const body = await readBody(req);
    const data = await fn(body, req, accessContext);
    return sendJson(res, data);
  } catch (error) {
    const status = error.status || error.statusCode || 500;
    const logPayload = {
      message: error.message,
      status,
    };
    if (status >= 500) logPayload.stack = error.stack;
    console.error(`[api/functions] ${redactedRequestUrl(req)} failed`, logPayload);
    return sendJson(res, { error: error.message }, status);
  }
}
