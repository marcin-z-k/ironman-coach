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
  const daysAgo = Math.round((Date.now() - new Date(a.date).getTime()) / 86400000);
  const runWalk = run && daysAgo >= 33 && daysAgo <= 37;      // demo: a run/walk session ~5 weeks ago
  const iw = (i) => { if (!(bike && a.indoor)) return null; const m = i / 60; if (m < 10) return 0.72; const k = (m - 10) % 16; return m > n / 60 - 8 ? 0.6 : k < 12 ? 1.22 : 0.68; };
  let walkUntil = -1, nextWalkAt = 2200;
  for (let i = 0; i < n; i++) {
    const f = i / n;
    const wave = Math.sin(i / 400) * 0.06 + (r() - 0.5) * 0.08;
    let v = vAvg * (1 + wave - (run ? 0.04 * f : 0));
    if (runWalk) { if (d >= nextWalkAt && walkUntil < i) { walkUntil = i + 180; nextWalkAt = d + 2200; } if (i < walkUntil) v = 1.4 + (r() - 0.5) * 0.2; }
    if (r() < 0.002) v = 0.3;                                  // occasional GPS drop
    const pw = iw(i);
    const target = pw != null ? 92 + 0.42 * (a.np || 120) * pw + 6 * f : hrAvg - 8 + 16 * f + (a.name.match(/interval|sweet|threshold/i) ? Math.sin(i / 300) * 10 : 0);
    h += (target - h) * 0.02 + (r() - 0.5);
    el += (r() - 0.5) * (run ? 0.4 : 0.8) + Math.sin(i / 900) * 0.15;
    d += v;
    head += (r() - 0.5) * 0.05;
    if (!swim && !a.indoor) { lat += Math.cos(head) * v / 111000; lng += Math.sin(head) * v / 70000; latlng.push([+lat.toFixed(6), +lng.toFixed(6)]); }
    time.push(i); hr.push(Math.round(h)); speed.push(+v.toFixed(2)); dist.push(Math.round(d));
    cad.push(Math.round(run ? 168 + (r() - 0.5) * 8 : bike ? 86 + (r() - 0.5) * 10 : 0)); alt.push(+el.toFixed(1));
    if (bike) watts.push(a.indoor ? Math.round((a.np || 120) * (iw(i) ?? 1) * (1 + (r() - 0.5) * 0.06)) : null);
  }
  return { n, time, hr, speed, cad: swim ? null : cad, alt: swim || a.indoor ? null : alt, dist, watts: bike && a.indoor ? watts : null, temp: null, latlng: latlng.length ? latlng : null };
}

// ---- running vs walking --------------------------------------------------------------
// Walking = slower than 9:00/km (speed < 1.852 m/s) for MORE than 2 minutes in a row.
// Shorter slow stretches (GPS loss under trees, traffic lights) still count as running.
const WALK_V = 1000 / 540, WALK_MIN_SEC = 120;
export function runMask(st) {
  if (!st?.speed) return null;
  const n = st.n, mask = new Array(n).fill(true);
  let i = 0;
  while (i < n) {
    if ((st.speed[i] ?? 0) < WALK_V) {
      let j = i; while (j < n && (st.speed[j] ?? 0) < WALK_V) j++;
      const dur = (st.time[j - 1] ?? j - 1) - (st.time[i] ?? i);
      if (dur > WALK_MIN_SEC) for (let k = i; k < j; k++) mask[k] = false;
      i = j;
    } else i++;
  }
  return mask;
}
// Longest stretch (km) run without a walk break.
export function longestContinuousRun(st) {
  const mask = runMask(st);
  if (!mask || !st.dist) return null;
  let best = 0, start = null;
  for (let i = 0; i <= st.n; i++) {
    const on = i < st.n && mask[i];
    if (on && start == null) start = i;
    if (!on && start != null) { best = Math.max(best, (st.dist[i - 1] ?? 0) - (st.dist[start] ?? 0)); start = null; }
  }
  const walkSec = mask.reduce((a, m, i) => a + (m ? 0 : 1), 0);
  return { km: best / 1000, walkMin: Math.round(walkSec / 60) };
}

// Easy (Z2) pace for ONE run — every run gets a value:
//  1) median pace of 30-s windows with HR in Z2 (running only, after 3 min)          → 'z2'
//  2) else: pace↔HR regression over the run's 30-s windows, read off at mid-Z2 HR     → 'regression'
export function z2PaceRun(st, z) {
  if (!st?.hr || !st.speed || !z) return null;
  const mask = runMask(st);
  const lo = z[0], hi = z[1], mid = (lo + hi) / 2;
  const win = [];
  for (let i = 0; i + 30 <= st.n; i += 30) {
    if ((st.time[i] ?? i) < 180) continue;
    let vs = 0, hs = 0, c = 0;
    for (let k = i; k < i + 30; k++) { if (!mask[k] || !st.hr[k] || st.speed[k] < WALK_V || st.speed[k] > 6.5) continue; vs += st.speed[k]; hs += st.hr[k]; c++; }
    if (c >= 20) win.push([hs / c, vs / c]);
  }
  if (!win.length) return null;
  const inZ2 = win.filter(w => w[0] > lo && w[0] <= hi).map(w => 1000 / w[1]);
  if (inZ2.length >= 4) return { pace: median(inZ2), src: 'z2', n: inZ2.length };
  if (win.length >= 6) {
    const n = win.length, mx = win.reduce((a, w) => a + w[0], 0) / n, my = win.reduce((a, w) => a + w[1], 0) / n;
    let sxy = 0, sxx = 0; for (const [x, y] of win) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
    const spread = Math.max(...win.map(w => w[0])) - Math.min(...win.map(w => w[0]));
    let v;
    if (sxx > 0 && spread >= 6 && sxy > 0) v = my + sxy / sxx * (mid - mx);
    else v = my * (1 - 0.006 * (mx - mid));          // ~0.6 % speed per bpm
    if (v > WALK_V && v < 6.5) return { pace: 1000 / v, src: 'regression', n };
  }
  return null;
}

// ---- power–duration on steady stretches -------------------------------------------------
// best mean of `vals` over `sec` seconds, only within stretches where ok[i] is true
export function bestWindow(vals, ok, sec) {
  let best = null, sum = 0, len = 0, start = 0;
  for (let i = 0; i < vals.length; i++) {
    if (!ok[i] || vals[i] == null) { sum = 0; len = 0; start = i + 1; continue; }
    sum += vals[i]; len++;
    if (len > sec) { sum -= vals[start]; start++; len--; }
    if (len === sec) best = best == null ? sum / sec : Math.max(best, sum / sec);
  }
  return best;
}
// mean of `vals` over the same window position helper: HR in the best window
export function bestWindowWith(vals, other, ok, sec) {
  let best = null, bestO = null, sum = 0, so = 0, len = 0, start = 0;
  for (let i = 0; i < vals.length; i++) {
    if (!ok[i] || vals[i] == null) { sum = 0; so = 0; len = 0; start = i + 1; continue; }
    sum += vals[i]; so += other?.[i] || 0; len++;
    if (len > sec) { sum -= vals[start]; so -= other?.[start] || 0; start++; len--; }
    if (len === sec && (best == null || sum / sec > best)) { best = sum / sec; bestO = so / sec; }
  }
  return best == null ? null : { mean: best, other: bestO };
}
// best `sec`-long stretch where at least `minFrac` of samples are usable; mean over the usable ones.
// (Outdoor rides: short climbs, junctions or GPS gaps inside the window don't void it.)
export function bestWindowFrac(vals, other, ok, sec, minFrac = 0.6) {
  let best = null, bestO = null, sum = 0, so = 0, cnt = 0, cntO = 0;
  const use = (i) => ok[i] && vals[i] != null;
  for (let i = 0; i < vals.length; i++) {
    if (use(i)) { sum += vals[i]; cnt++; if (other?.[i]) { so += other[i]; cntO++; } }
    const j = i - sec;
    if (j >= 0 && use(j)) { sum -= vals[j]; cnt--; if (other?.[j]) { so -= other[j]; cntO--; } }
    if (i >= sec - 1 && cnt >= sec * minFrac && (best == null || sum / cnt > best)) { best = sum / cnt; bestO = cntO ? so / cntO : null; }
  }
  return best == null ? null : { mean: best, other: bestO };
}
// steady 3-min blocks: [avg output, avg HR of the last 2 min] (skip first 10 min — HR lag / warm-up)
export function steadyBlocks(out, hr, time, ok, blockSec = 180, cvMax = 0.15) {
  const res = [];
  for (let i = 0; i + blockSec <= out.length; i += blockSec) {
    if ((time?.[i] ?? i) < 600) continue;
    const seg = [], hseg = [];
    for (let k = i; k < i + blockSec; k++) { if (!ok[k] || out[k] == null || !hr?.[k]) continue; seg.push(out[k]); if (k >= i + 60) hseg.push(hr[k]); }
    if (seg.length < blockSec * 0.85 || hseg.length < 60) continue;
    const m = seg.reduce((a, b) => a + b, 0) / seg.length;
    const cv = Math.sqrt(seg.reduce((a, b) => a + (b - m) ** 2, 0) / seg.length) / m;
    if (cv > cvMax || m <= 0) continue;
    res.push([hseg.reduce((a, b) => a + b, 0) / hseg.length, m]);
  }
  return res;
}

// Longest pool/open-water swim without a real break. Short pauses at the wall (goggles, waiting for
// others, turning) don't count — only a pause longer than BREAK_SEC does.
export const SWIM_BREAK_SEC = 120;
export function longestContinuousSwim(st) {
  if (!st?.dist || !st.time || st.n < 60) return null;
  let best = 0, segStart = st.dist[0] || 0, lastMoveT = st.time[0], lastMoveD = st.dist[0] || 0;
  for (let i = 1; i < st.n; i++) {
    const t = st.time[i], d = st.dist[i];
    if (d == null || t == null) continue;
    if (d - lastMoveD >= 3) {                       // moved (≥ 3 m since the last movement)
      if (t - lastMoveT > SWIM_BREAK_SEC) segStart = lastMoveD;     // the pause before this was a real break
      lastMoveT = t; lastMoveD = d;
      best = Math.max(best, d - segStart);
    }
  }
  return best > 0 ? Math.round(best) : null;
}
