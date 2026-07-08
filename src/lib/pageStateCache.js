const memoryCache = new Map();

function fallbackValue(fallback) {
  return typeof fallback === 'function' ? fallback() : fallback;
}

export function readPageState(key, fallback = {}) {
  if (!key) return fallbackValue(fallback);
  if (memoryCache.has(key)) return memoryCache.get(key);
  try {
    const raw = window.sessionStorage.getItem(`salesforce_extension:page_state:${key}`);
    if (!raw) return fallbackValue(fallback);
    const parsed = JSON.parse(raw);
    memoryCache.set(key, parsed);
    return parsed;
  } catch {
    return fallbackValue(fallback);
  }
}

export function writePageState(key, value) {
  if (!key) return;
  memoryCache.set(key, value);
  try {
    window.sessionStorage.setItem(`salesforce_extension:page_state:${key}`, JSON.stringify(value));
  } catch {
    // Keep the in-memory copy even when browser storage quota is exceeded.
  }
}

export function clearPageState(key) {
  if (!key) return;
  memoryCache.delete(key);
  try {
    window.sessionStorage.removeItem(`salesforce_extension:page_state:${key}`);
  } catch {
    // Ignore browser storage failures.
  }
}
