import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';

const STORAGE_PREFIX = 'salesforce_extension';

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

async function invoke(name, payload = {}) {
  const headers = { 'content-type': 'application/json' };
  if (isSupabaseConfigured) {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) headers.authorization = `Bearer ${data.session.access_token}`;
  }
  const res = await fetch(`/api/functions/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return { data: { error: data.error || `Request failed: ${res.status}` } };
  }

  return { data };
}

export const appClient = {
  functions: { invoke },
  entities: {
    AppSettings: createEntityStore('app_settings'),
    SavedReport: createEntityStore('saved_reports'),
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
      if (isSupabaseConfigured) await supabase.auth.signOut();
    },
    redirectToLogin() {},
  },
};
