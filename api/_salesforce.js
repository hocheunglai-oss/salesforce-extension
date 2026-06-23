const DEFAULT_INSTANCE_URL = 'https://fratellicosulich.my.salesforce.com';
const DEFAULT_API_VERSION = 'v59.0';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

export function sendJson(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(data));
}

export function getInstanceUrl() {
  return process.env.SALESFORCE_INSTANCE_URL || DEFAULT_INSTANCE_URL;
}

export function getApiVersion() {
  return process.env.SALESFORCE_API_VERSION || DEFAULT_API_VERSION;
}

export async function getAccessToken() {
  if (process.env.SALESFORCE_ACCESS_TOKEN) return process.env.SALESFORCE_ACCESS_TOKEN;
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  const refreshToken = process.env.SALESFORCE_REFRESH_TOKEN;
  const loginUrl = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Salesforce env vars. Set SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, and SALESFORCE_REFRESH_TOKEN in Vercel.');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Salesforce token refresh failed');

  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + 50 * 60 * 1000;
  return cachedToken;
}

export function cleanRecord(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cleanRecord);
  const { attributes, ...rest } = obj;
  return Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, cleanRecord(value)]));
}

export async function sfRequest(path, { method = 'GET', body } = {}) {
  const accessToken = await getAccessToken();
  const url = `${getInstanceUrl()}/services/data/${getApiVersion()}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errorCode || (Array.isArray(data) && data[0]?.errorCode)) {
    throw new Error(data.message || data[0]?.message || `${method} ${path} failed`);
  }
  return data;
}

export async function sfQuery(soql, { clean = false, limit = 2000, softFail = false } = {}) {
  try {
    let data = await sfRequest(`/query/?q=${encodeURIComponent(soql)}`);
    let records = data.records || [];
    const totalSize = data.totalSize ?? records.length;

    while (data.nextRecordsUrl && records.length < limit) {
      data = await sfRequest(data.nextRecordsUrl.replace(`/services/data/${getApiVersion()}`, ''));
      records = records.concat(data.records || []);
    }

    return { records: clean ? records.map(cleanRecord) : records, totalSize };
  } catch (error) {
    if (softFail) return { records: [], totalSize: 0, error: error.message };
    throw error;
  }
}

export function chunkIds(ids, size = 200) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}
