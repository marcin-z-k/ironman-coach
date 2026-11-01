// Cross-device sync: one copy of the app settings (thresholds, holds, simulator, schedule moves,
// plan source, custom plan, goal…) is kept in YOUR intervals.icu account as a calendar NOTE on
// 1 Jan 2000 (out of the way). Every device logged into the same athlete reads and writes it, so
// all devices show the same values. API key / athlete ID / AI key never leave the device.
import { load, save, LOCAL_ONLY, getCache, setCache } from './store.js';

const BASE = 'https://intervals.icu/api/v1';
const DAY = '2000-01-01';
const NAME = 'Ironman Coach · app settings (sync, do not edit)';
const EXT = 'ironman-coach-sync';
const auth = (k) => 'Basic ' + btoa('API_KEY:' + k);
const url = (s, path) => { const u = `${BASE}/athlete/${encodeURIComponent(s.athleteId)}${path}`; return s.corsProxy ? s.corsProxy + encodeURIComponent(u) : u; };

function payload() {
  const s = load();
  const settings = {};
  for (const [k, v] of Object.entries(s)) if (!LOCAL_ONLY.has(k)) settings[k] = v;
  return { v: 1, updatedAt: s.updatedAt || Date.now(), settings, customPlan: getCache('customPlan') || null, temps: getCache('temps') || null };
}

async function findRemote(s) {
  const res = await fetch(url(s, `/events?oldest=${DAY}&newest=${DAY}`), { headers: { Authorization: auth(s.apiKey), Accept: 'application/json' } });
  if (!res.ok) throw new Error('sync read ' + res.status);
  const list = await res.json();
  const ev = (list || []).find(e => e.external_id === EXT || e.name === NAME);
  if (!ev) return null;
  try { return { ev, data: JSON.parse(ev.description || 'null') }; } catch { return { ev, data: null }; }
}

export async function pushSettings() {
  const s = load();
  if (s.demo || !s.athleteId || !s.apiKey) return false;
  const body = [{ category: 'NOTE', start_date_local: DAY + 'T00:00:00', end_date_local: DAY + 'T00:00:00', name: NAME, external_id: EXT, description: JSON.stringify(payload()) }];
  const res = await fetch(url(s, '/events/bulk?upsert=true'), { method: 'POST', headers: { Authorization: auth(s.apiKey), 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('sync write ' + res.status);
  save({ syncedAt: Date.now() }, { silent: true });
  return true;
}

function apply(data) {
  const s = load();
  const keep = {}; for (const k of LOCAL_ONLY) if (k in s) keep[k] = s[k];
  const next = { ...data.settings, ...keep, updatedAt: data.updatedAt, syncedAt: Date.now() };
  for (const k of Object.keys(s)) if (!LOCAL_ONLY.has(k) && !(k in data.settings)) next[k] = null;
  save(next, { silent: true });
  if ('customPlan' in data) setCache('customPlan', data.customPlan);
  if (data.temps) setCache('temps', data.temps);
}

// Called on every sync. Newer side wins; a device that never synced always takes the account copy.
// returns 'pulled' | 'pushed' | 'same' | 'off'
export async function syncSettings({ force } = {}) {
  const s = load();
  if (s.demo || !s.athleteId || !s.apiKey) return 'off';
  if (force === 'push') { await pushSettings(); return 'pushed'; }
  const r = await findRemote(s);
  const remote = r?.data;
  if (remote?.settings && (force === 'pull' || !s.syncedAt || (remote.updatedAt || 0) > (s.updatedAt || 0))) { apply(remote); return 'pulled'; }
  if (!remote || (s.updatedAt || 0) > (remote.updatedAt || 0)) { await pushSettings(); return 'pushed'; }
  return 'same';
}

let timer = null;
export function schedulePush() { clearTimeout(timer); timer = setTimeout(() => pushSettings().catch(e => console.warn(e)), 2500); }
