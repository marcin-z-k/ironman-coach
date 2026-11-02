// Local persistence: settings, cached data, AI summaries. Everything stays in this browser.
const KEY = 'ironman-coach:v1';

export const DEFAULTS = {
  athleteId: '',
  apiKey: '',
  anthropicKey: '',
  anthropicModel: 'claude-sonnet-5-5',
  corsProxy: '',            // optional, e.g. https://my-proxy.workers.dev/?url=
  raceDate: '2027-08-15',
  raceName: 'Ironman 2027',
  goalHours: 12,
  weeklyHours: 9.5,
  ftp: 150,                 // W — INDOOR (trainer) FTP, used for indoor power targets
  ftpOutdoor: null,         // W — outdoor FTP (only meaningful with an outdoor power meter)
  outdoorPower: false,      // power meter on the outdoor bike?
  trainerType: 'unknown',   // indoor trainer without power: fluid | magnetic | wind | unknown (virtual power curve)
  swimContinuous: null,     // m you can swim without stopping (null = from your swims)
  runContinuous: null,      // km you can run without walking (null = from longest run)
  weekTemplate: null,       // null = default fixed week
  moves: {},                // manual day swaps {sessionId: date}
  holds: {},
  manualHr: null,           // { enabled, tops: [z1..z5 bpm], lthr }
  raceTargetW: 230,         // outdoor race FTP target
  ftpCoupling: null,        // { ratio, outdoor, indoor, date, source } outdoor/indoor FTP ratio                // {field: isoDate} manual threshold edits protected until date
  runThreshold: 340,        // s/km  (5:40)
  css: 110,                 // s/100m (1:50)
  weightKg: 75,
  longBikeDay: 6,           // 0=Sun .. 6=Sat
  longRunDay: 0,
  planStart: null,          // ISO date the plan was anchored on (first launch)
  autoThresholds: true,     // legacy
  thresholdSource: 'auto',  // auto | suggest | intervals | manual
  thresholdLog: [],         // [{date, field, from, to, source}]
  lastIcu: null,            // thresholds last seen in intervals.icu sport settings
  planFromHistory: true,    // build weekly structure from last 8 weeks of activities
  demo: false,
};

let state = null;

export function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    if (!state.mig2) { if (state.swimContinuous === 600) state.swimContinuous = null; state.mig2 = true; }   // 600 was only the old default
  } catch { state = { ...DEFAULTS }; }
  return state;
}

// Settings that are the same on every device of an account (synced via intervals.icu).
export const LOCAL_ONLY = new Set(['athleteId', 'apiKey', 'anthropicKey', 'anthropicModel', 'corsProxy', 'demo', 'mig2', 'restHr', 'updatedAt', 'syncedAt']);
let onChange = null;
export function setOnChange(fn) { onChange = fn; }
export function save(patch = {}, { silent = false } = {}) {
  const shared = Object.keys(patch).some(k => !LOCAL_ONLY.has(k));
  if (shared && !silent) patch = { ...patch, updatedAt: Date.now() };
  state = { ...load(), ...patch };
  if (shared && !silent) try { onChange?.(); } catch {}
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  if ('athleteId' in patch || 'apiKey' in patch) backupCredentials();
  return state;
}

export function isConfigured() {
  const s = load();
  return s.demo || (s.athleteId && s.apiKey);
}

// Generic cached blobs (activities, wellness, summaries)
export function getCache(name) {
  try { const r = localStorage.getItem(`${KEY}:${name}`); return r ? JSON.parse(r) : null; } catch { return null; }
}
export function setCache(name, value) {
  try { localStorage.setItem(`${KEY}:${name}`, JSON.stringify(value)); } catch {}
}
export function clearAll() {
  idbSet('cred', null);
  try {
    Object.keys(localStorage).filter(k => k.startsWith(KEY)).forEach(k => localStorage.removeItem(k));
  } catch {}
  state = null;
}

// ---- credential persistence --------------------------------------------------
// localStorage can be wiped (Safari's 7-day rule, "clear on close", home-screen app vs browser).
// Credentials are mirrored into IndexedDB and the browser is asked for persistent storage.
const IDB = 'ironman-coach', STORE = 'kv';
function idb() {
  return new Promise((res, rej) => {
    try { const r = indexedDB.open(IDB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }
    catch (e) { rej(e); }
  });
}
export async function idbSet(key, val) { try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch {} }
export async function idbGet(key) { try { const db = await idb(); return await new Promise((res) => { const r = db.transaction(STORE).objectStore(STORE).get(key); r.onsuccess = () => res(r.result ?? null); r.onerror = () => res(null); }); } catch { return null; } }

export function storageWorks() {
  try { localStorage.setItem(KEY + ':probe', '1'); localStorage.removeItem(KEY + ':probe'); return true; } catch { return false; }
}
export async function backupCredentials() {
  const s = load();
  if (s.athleteId && s.apiKey) await idbSet('cred', { athleteId: s.athleteId, apiKey: s.apiKey, anthropicKey: s.anthropicKey || '' });
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
}
export async function restoreCredentials() {
  const s = load();
  if (s.athleteId && s.apiKey) return false;
  const c = await idbGet('cred');
  if (c?.athleteId && c?.apiKey) { save({ athleteId: c.athleteId, apiKey: c.apiKey, anthropicKey: s.anthropicKey || c.anthropicKey || '' }); return true; }
  // Chrome / Android password manager (Credential Management API)
  try {
    if (window.PasswordCredential && navigator.credentials) {
      const cred = await navigator.credentials.get({ password: true, mediation: 'optional' });
      if (cred && cred.id && cred.password) { save({ athleteId: cred.id, apiKey: cred.password }); return true; }
    }
  } catch {}
  return false;
}
export async function rememberInPasswordManager() {
  const s = load();
  try {
    if (window.PasswordCredential && navigator.credentials && s.athleteId && s.apiKey) {
      await navigator.credentials.store(new PasswordCredential({ id: s.athleteId, password: s.apiKey, name: 'intervals.icu (Ironman Coach)' }));
    }
  } catch {}
}
