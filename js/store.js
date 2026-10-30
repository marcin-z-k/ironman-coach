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
  ftp: 180,                 // W
  runThreshold: 340,        // s/km  (5:40)
  css: 110,                 // s/100m (1:50)
  weightKg: 75,
  longBikeDay: 6,           // 0=Sun .. 6=Sat
  longRunDay: 0,
  planStart: null,          // ISO date the plan was anchored on (first launch)
  autoThresholds: true,
  demo: false,
};

let state = null;

export function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch { state = { ...DEFAULTS }; }
  return state;
}

export function save(patch = {}) {
  state = { ...load(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
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
  try {
    Object.keys(localStorage).filter(k => k.startsWith(KEY)).forEach(k => localStorage.removeItem(k));
  } catch {}
  state = null;
}
