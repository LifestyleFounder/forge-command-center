// js/services/user-settings.js — Persistent settings via KV + localStorage fallback
// ──────────────────────────────────────────────────────────────────────

const ENDPOINT = 'https://anthropic-proxy.dan-a14.workers.dev/settings';
const LOCAL_PREFIX = 'forge-setting-';
let _cache = {};
let _loaded = false;

export async function getAllSettings() {
  // Return cache if already loaded
  if (_loaded) return { ..._cache };

  // Try remote first
  try {
    const res = await fetch(ENDPOINT);
    if (res.ok) {
      const data = await res.json();
      _cache = data || {};
      _loaded = true;
      // Sync to localStorage as backup
      Object.entries(_cache).forEach(([k, v]) => {
        localStorage.setItem(LOCAL_PREFIX + k, JSON.stringify(v));
      });
      return { ..._cache };
    }
  } catch (err) {
    console.warn('[user-settings] Remote fetch failed, using localStorage', err);
  }

  // Fallback: load from localStorage
  _cache = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(LOCAL_PREFIX)) {
      const name = key.slice(LOCAL_PREFIX.length);
      try { _cache[name] = JSON.parse(localStorage.getItem(key)); }
      catch { /* skip corrupted */ }
    }
  }
  _loaded = true;
  return { ..._cache };
}

export async function getSetting(key, defaultValue) {
  if (!_loaded) await getAllSettings();
  return _cache[key] !== undefined ? _cache[key] : defaultValue;
}

export async function setSetting(key, value) {
  _cache[key] = value;
  localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(value));

  // Fire-and-forget remote save
  try {
    fetch(ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
  } catch { /* ignore remote errors */ }
}

export function migrateLegacy() {
  const legacyKeys = {
    'forge-theme': 'theme',
    'forge-anthropic-proxy': 'anthropicProxy',
    'forge-yt-config': 'youtubeConfig',
    'forge-meta-token': 'metaToken',
    'forge-meta-account': 'metaAccount',
  };
  Object.entries(legacyKeys).forEach(([oldKey, newKey]) => {
    const val = localStorage.getItem(oldKey);
    if (val !== null && !localStorage.getItem(LOCAL_PREFIX + newKey)) {
      try {
        const parsed = JSON.parse(val);
        setSetting(newKey, parsed);
      } catch {
        setSetting(newKey, val);
      }
    }
  });
}
