// Activity streams: fetch + cache (IndexedDB) + analysis on second-by-second data.
import { load, idbGet, idbSet } from './store.js';
import { fetchStreams } from './icu.js';
import { getZoneModel } from './zones.js';

const mem = new Map();

function normalize(raw) {
  const by = {};
  for (const st of raw || []) by[st.type] = st;
  const pick = k => by[k]?.data || null;
  let latlng = null;
  if (by.latlng?.data) {
    const d = by.latlng.data, d2 = by.latlng.data2;
    latlng = Array.isArray(d[0]) ? d : d2 ? d.map((lat, i) => [lat, d2[i]]) : null;
  }
  const time = pick('time');
  const n = time?.length || pick('heartrate')?.length || pick('velocity_smooth')?.length || 0;
  return { n, time: time || Array.from({ length: n }, (_, i) => i), hr: pick('heartrate'), speed: pick('velocity_smooth'), cad: pick('cadence'), alt: pick('altitude'), dist: pick('distance'), watts: pick('watts'), temp: pick('temp'), latlng };
}

export function cachedStreams(id) { return mem.get(id) || null; }

export async function getStreams(a) {
  if (mem.has(a.id)) return mem.get(a.id);
  const key = 'st:' + a.id;
  let st = await idbGet(key);
  if (!st) {
    if (load().demo) st = demoStreams(a);
    else { st = normalize(await fetchStreams(a.id)); }
    if (st && st.n) idbSet(key, st);
  }
  mem.set(a.id, st);
  return st;
}

// Fetch streams for many activities with limited concurrency.
export async function prefetch(acts, onProgress, conc = 3) {
  const todo = acts.filter(a => !mem.has(a.id));
  let i = 0, done = 0;
  const worker = async () => { while (i < todo.length) { const a = todo[i++]; try { await getStreams(a); } catch { mem.set(a.id, null); } done++; onProgress?.(done, todo.length); } };
  await Promise.all(Array.from({ length: conc }, worker));
}

// ---- analysis ------------------------------------------------------------------
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Aerobic decoupling: (output/HR) first half vs second half. Output = power if real, else speed.
export function decoupling(st, a, usePower) {
  if (!st?.hr || st.n < 600) return null;
  const out = usePower && st.watts ? st.watts : st.speed;
  if (!out) return null;
  const valid = [];
  for (let i = 0; i < st.n; i++) {
    const h = st.hr[i], o = out[i];
    if (!h || h < 60 || o == null) continue;
    if (!usePower && (o < (a.sport === 'run' ? 1.4 : 2.5))) continue;   // stopped / walking / GPS drop
    if (usePower && o <= 0) continue;                                   // coasting
    valid.push([o, h]);
  }
  if (valid.length < 600) return null;
  const skip = Math.min(600, Math.floor(valid.length * 0.1));           // skip warm-up
  const v = valid.slice(skip);
  const half = v.length >> 1;
  const r = arr => mean(arr.map(x => x[0])) / mean(arr.map(x => x[1]));
  const r1 = r(v.slice(0, half)), r2 = r(v.slice(half));
  return { pct: (r1 - r2) / r1 * 100, basis: usePower && st.watts ? 'power' : 'speed' };
}

// Median pace (s/km) of samples inside run HR zone 2, ignoring the first 5 min and GPS outliers.
export function z2Pace(st) {
  const z = getZoneModel().run.hr;
  if (!st?.hr || !st.speed || !z) return null;
  const lo = z[0], hi = z[1];
  const paces = [];
  for (let i = 0; i < st.n; i++) {
    if ((st.time[i] ?? i) < 300) continue;
    const h = st.hr[i], v = st.speed[i];
    if (h > lo && h <= hi && v >= 1.4 && v <= 6.5) paces.push(1000 / v);
  }
  return paces.length >= 300 ? { pace: median(paces), secs: paces.length } : null;
}

// Brick run: pace over the first 3 km vs the rest.
export function brickSplit(st) {
  if (!st?.dist || !st.time || st.n < 300) return null;
  const total = st.dist[st.n - 1];
  if (!total || total < 4000) return null;
  let i3 = st.dist.findIndex(d => d >= 3000);
  if (i3 < 0) return null;
  const t3 = st.time[i3] - st.time[0], tEnd = st.time[st.n - 1] - st.time[i3];
  const p1 = t3 / 3, p2 = tEnd / ((total - 3000) / 1000);
  return { first: p1, rest: p2, diffPct: (p1 - p2) / p2 * 100 };
}

export function downsample(st, maxPts = 500) {
  const step = Math.max(1, Math.ceil(st.n / maxPts));
  const idx = []; for (let i = 0; i < st.n; i += step) idx.push(i);
  const take = arr => arr ? idx.map(i => arr[i]) : null;
  return { n: idx.length, idx, time: take(st.time), hr: take(st.hr), speed: take(st.speed), cad: take(st.cad), alt: take(st.alt), dist: take(st.dist), watts: take(st.watts) };
}

// ---- demo ---------------------------------------------------------------------
function rng(seed) { let x = seed; return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; }; }
export function demoStreams(a) {
  const n = Math.min(a.movingSec, 6 * 3600);
  const r = rng([...a.id].reduce((s, c) => s + c.charCodeAt(0), 0));
  const run = a.sport === 'run', bike = a.sport === 'bike', swim = a.sport === 'swim';
  const vAvg = a.distanceM && a.movingSec ? a.distanceM / a.movingSec : run ? 2.4 : 8;
  const hrAvg = a.avgHr || (run ? 145 : 130);
  const time = [], hr = [], speed = [], cad = [], alt = [], dist = [], watts = [], latlng = [];
  let d = 0, h = hrAvg - 25, el = 120, lat = 51.05, lng = 13.74, head = r() * 6.28;
  for (let i = 0; i < n; i++) {
    const f = i / n;
    const wave = Math.sin(i / 400) * 0.06 + (r() - 0.5) * 0.08;
    let v = vAvg * (1 + wave - (run ? 0.04 * f : 0));
    if (r() < 0.002) v = 0.3;                                  // occasional GPS drop
    const target = hrAvg - 8 + 16 * f + (a.name.match(/interval|sweet|threshold/i) ? Math.sin(i / 300) * 10 : 0);
    h += (target - h) * 0.02 + (r() - 0.5);
    el += (r() - 0.5) * (run ? 0.4 : 0.8) + Math.sin(i / 900) * 0.15;
    d += v;
    head += (r() - 0.5) * 0.05;
    if (!swim && !a.indoor) { lat += Math.cos(head) * v / 111000; lng += Math.sin(head) * v / 70000; latlng.push([+lat.toFixed(6), +lng.toFixed(6)]); }
    time.push(i); hr.push(Math.round(h)); speed.push(+v.toFixed(2)); dist.push(Math.round(d));
    cad.push(Math.round(run ? 168 + (r() - 0.5) * 8 : bike ? 86 + (r() - 0.5) * 10 : 0)); alt.push(+el.toFixed(1));
    if (bike) watts.push(a.indoor ? Math.round((a.np || 120) * (1 + wave)) : null);
  }
  return { n, time, hr, speed, cad: swim ? null : cad, alt: swim || a.indoor ? null : alt, dist, watts: bike && a.indoor ? watts : null, temp: null, latlng: latlng.length ? latlng : null };
}
