import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';

const STORAGE_PREFIX = 'fcos';
const DEFAULT_FUNCTION_CACHE_TTL_MS = 30_000;
const functionResponseCache = new Map();

const storage = {
  get(key, fallback) {
    try {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}:${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    window.localStorage.setItem(`${STORAGE_PREFIX}:${key}`, JSON.stringify(value));
  },
};

function now() {
  return new Date().toISOString();
}

function cloneJson(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function functionCacheKey(name, payload) {
  return `${name}:${stableStringify(payload || {})}`;
}

function createEntityStore(name) {
  const read = () => storage.get(name, []);
  const write = (records) => storage.set(name, records);

  return {
    async list(sort = '-updated_date', limit = 100) {
      const records = read();
      const desc = sort.startsWith('-');
      const field = desc ? sort.slice(1) : sort;
      return records
        .slice()
        .sort((a, b) => {
          const av = a[field] || '';
          const bv = b[field] || '';
          return desc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
        })
        .slice(0, limit);
    },
    async filter(criteria = {}) {
      return read().filter((record) =>
        Object.entries(criteria).every(([key, value]) => record[key] === value)
      );
    },
    async create(payload) {
      const record = {
        ...payload,
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        created_date: now(),
        updated_date: now(),
      };
      write([record, ...read()]);
      return record;
    },
    async update(id, payload) {
      let updated = null;
      const records = read().map((record) => {
        if (record.id !== id) return record;
        updated = { ...record, ...payload, updated_date: now() };
        return updated;
      });
      write(records);
      return updated;
    },
    async delete(id) {
      write(read().filter((record) => record.id !== id));
      return true;
    },
  };
}

async function invoke(name, payload = {}, options = {}) {
  const cacheKey = options.cacheKey || (options.cache ? functionCacheKey(name, payload) : null);
  if (cacheKey && !options.force && functionResponseCache.has(cacheKey)) {
    const cached = functionResponseCache.get(cacheKey);
    const ttlMs = Math.max(0, Number(options.cacheTtlMs ?? DEFAULT_FUNCTION_CACHE_TTL_MS));
    if (Date.now() - cached.cachedAtMs <= ttlMs) {
      return {
        data: cloneJson(cached.data),
        meta: { cached: true, cachedAt: cached.updatedAt },
      };
    }
    functionResponseCache.delete(cacheKey);
  }

  const headers = { 'content-type': 'application/json' };
  if (isSupabaseConfigured) {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) headers.authorization = `Bearer ${data.session.access_token}`;
  }
  let res;
  try {
    res = await fetch(`/api/functions/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return { data: { error: error?.message || 'Network request failed. Check your connection and try again.' } };
  }
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return { data: { error: data.error || `Request failed: ${res.status}` } };
  }

  const fetchedAt = now();
  if (cacheKey) {
    functionResponseCache.set(cacheKey, { data: cloneJson(data), updatedAt: fetchedAt, cachedAtMs: Date.now() });
  }

  return { data, meta: cacheKey ? { cached: false, cachedAt: fetchedAt } : undefined };
}

function clearFunctionCache() {
  functionResponseCache.clear();
}

export const appClient = {
  functions: { invoke, clearCache: clearFunctionCache },
  entities: {
    AppSettings: createEntityStore('app_settings'),
  },
  auth: {
    async me() {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        return data.user;
      }
      return {
        id: 'local-admin',
        full_name: 'Vincent',
        email: 'vincent@cosulich.com.hk',
        role: 'admin',
      };
    },
    async logout() {
      clearFunctionCache();
      if (isSupabaseConfigured) await supabase.auth.signOut();
    },
    redirectToLogin() {},
  },
};
