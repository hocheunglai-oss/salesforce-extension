import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

//Create a client with authentication required
export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});

const originalInvoke = base44.functions.invoke.bind(base44.functions);
const directSalesforceFunctions = new Set([
  'salesforceSchema',
  'salesforceObjectFields',
  'salesforceQuery',
  'salesforceFullSchema',
  'salesforceDashboard',
  'salesforceDashboardFiltered',
  'salesforceStemDetail',
  'salesforceDescribeChildren',
  'salesforceTopBuyers',
  'salesforceBrokerRegister',
  'stemPnl',
]);

base44.functions.invoke = async (name, payload = {}) => {
  if (!directSalesforceFunctions.has(name)) {
    return originalInvoke(name, payload);
  }

  const res = await fetch(`/api/base44/functions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return { data: { error: data.error || `Request failed: ${res.status}` } };
  }

  return { data };
};
