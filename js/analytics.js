// Training analytics: execution score, heat correction, bricks, load management, discipline split,
// indoor/outdoor FTP coupling. Pure functions on normalised activities / wellness.
import { load, save, getCache, setCache } from './store.js';
import { collapse, plannedDist, getZoneModel, hrZoneOf } from './zones.js';
import { cachedStreams, z2PaceRun, longestContinuousRun, bestWindowWith, bestWindowFrac, runMask, steadyBlocks, longestContinuousSwim } from './streams.js';
import { isoDate, addDays, startOfWeek, parseDate, round, clamp } from './util.js';

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length) : 0; };
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---- EnviroNorm: heat correction ---------------------------------------------------
export function getTemp(a) { const t = (getCache('temps') || {})[a.id]; return t != null ? t : null; }
export function setTemp(a, t) { const m = getCache('temps') || {}; if (t == null || t === '') delete m[a.id]; else m[a.id] = +t; setCache('temps', m); save({ tempsAt: Date.now() }); }
// ~1.75% per 5 °C above 22 °C
export function heatFactor(a) { const t = getTemp(a); return t != null && t > 22 ? 1 + 0.0175 * (t - 22) / 5 : 1; }

// ---- execution score (0–100) --------------------------------------------------------
export function realPower(a) { return a.sport === 'bike' && a.deviceWatts !== false && (a.indoor || load().outdoorPower); }
export function executionScore(a, planned) {
  if (!planned || planned.kind === 'race') return null;
  const ratio = a.movingSec / 60 / planned.min;
  const durScore = ratio >= 1 ? Math.max(0, 1 - (ratio - 1) * 0.8) : Math.max(0, 1 - (1 - ratio) * 1.2);
  const heat = heatFactor(a) - 1;
  const pd = plannedDist(planned.steps);
  const prim = a.sport === 'bike' ? (realPower(a) ? a.powerZoneSecs : a.hrZoneSecs) : a.sport === 'run' ? (a.paceZoneSecs || a.hrZoneSecs) : null;
  const ad = collapse(prim);
  const notes = [];
  let score, overshoot = 0;
  if (pd && ad) {
    const overlap = Math.min(pd.easy, ad.easy) + Math.min(pd.mod, ad.mod) + Math.min(pd.hard, ad.hard);
    overshoot = Math.max(0, (ad.mod + ad.hard) - (pd.mod + pd.hard) - 0.1 - heat * 2);
    score = 100 * (0.35 * durScore + 0.65 * overlap) - overshoot * 60;
    if (overshoot > 0.05) notes.push(`${Math.round((ad.mod + ad.hard) * 100)}% above Z2 vs ${Math.round((pd.mod + pd.hard) * 100)}% planned`);
    if (pd.hard > 0.1 && ad.hard < pd.hard * 0.6) notes.push('intervals not hit');
  } else {
    score = 100 * durScore;
    if (a.intensity != null && a.intensity > planned.if * 100 + 10) { score -= 15; notes.push('intensity above plan'); }
  }
  if (ratio < 0.8) notes.push(`${Math.round(ratio * 100)}% of planned time`);
  if (ratio > 1.25) notes.push(`${Math.round(ratio * 100)}% of planned time`);
  return { score: Math.round(clamp(score, 0, 100)), notes };
}

// ---- brick detection ------------------------------------------------------------------
export function tagBricks(acts) {
  const rides = acts.filter(a => a.sport === 'bike');
  for (const a of acts) {
    if (a.sport !== 'run') continue;
    const st = new Date(a.start).getTime();
    const prev = rides.find(b => { const end = new Date(b.start).getTime() + (b.elapsedSec || b.movingSec) * 1000; return st >= end - 60000 && st - end <= 90 * 60000; });
    if (prev) { const end = new Date(prev.start).getTime() + (prev.elapsedSec || prev.movingSec) * 1000; a.brick = { bikeId: prev.id, gapMin: Math.max(0, Math.round((st - end) / 60000)) }; }
  }
  return acts;
}

// ---- weekly time in zone ------------------------------------------------------------
export function weeklyTiz(acts, weeks = 10, kind = 'hr') {
  const out = [];
  const start = startOfWeek(new Date());
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = isoDate(addDays(start, -7 * i)), we = isoDate(addDays(parseDate(ws), 6));
    const z = [0, 0, 0, 0, 0];
    for (const a of acts) {
      if (a.date < ws || a.date > we) continue;
      const arr = kind === 'power' ? (realPower(a) ? a.powerZoneSecs : null) : a.hrZoneSecs;
      if (!arr) continue;
      arr.forEach((v, j) => { z[Math.min(4, j)] += (v || 0) / 3600; });
    }
    out.push({ week: ws, z: z.map(v => round(v, 2)), total: round(z.reduce((s, v) => s + v, 0), 2) });
  }
  return out;
}

// ---- load management --------------------------------------------------------------
export function rampRate(wellness) {
  const w = wellness.filter(x => x.ctl != null);
  if (w.length < 8) return null;
  const last = w[w.length - 1];
  const weekAgo = w.find(x => x.date >= isoDate(addDays(parseDate(last.date), -7)));
  const series = [];
  for (let i = 7; i < w.length; i += 1) if ((w.length - 1 - i) % 7 === 0) series.push({ x: w[i].date, y: round(w[i].ctl - w[i - 7].ctl, 1) });
  const v = round(last.ctl - (weekAgo?.ctl ?? last.ctl), 1);
  const lvl = v <= 5 ? ['good', 'Optimal build'] : v <= 8 ? ['warn', 'Demanding build'] : ['bad', 'High injury / overtraining risk'];
  return { value: v, level: lvl, series: series.slice(-16) };
}

export function monotony(acts, endIso = isoDate(new Date())) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = isoDate(addDays(parseDate(endIso), -i));
    days.push({ d, load: acts.filter(a => a.date === d).reduce((s, a) => s + (a.load || 0), 0) });
  }
  const loads = days.map(x => x.load);
  const m = mean(loads), s = sd(loads);
  const mono = s > 0 ? m / s : (m > 0 ? 9.9 : 0);
  return { days, mean: round(m), sd: round(s), monotony: round(mono, 2), strain: Math.round(loads.reduce((a, b) => a + b, 0) * mono), high: mono > 2 };
}

export function greyZone(acts) {
  const cur = weeklyTiz(acts, 1, 'hr')[0];
  if (!cur || cur.total < 1) return null;
  const share = cur.z[2] / cur.total;
  return { share, high: share > 0.25 };
}

// ---- discipline split ----------------------------------------------------------------
export const IM_TARGET = { swim: [0.10, 0.20], bike: [0.45, 0.55], run: [0.30, 0.40] };
export function disciplineSplit(acts, days = 28) {
  const from = isoDate(addDays(new Date(), -days));
  const t = { swim: 0, bike: 0, run: 0 }, l = { swim: 0, bike: 0, run: 0 };
  for (const a of acts) if (a.date >= from && t[a.sport] != null) { t[a.sport] += a.movingSec / 3600; l[a.sport] += a.load || 0; }
  const tt = t.swim + t.bike + t.run || 1, lt = l.swim + l.bike + l.run || 1;
  const share = { swim: t.swim / tt, bike: t.bike / tt, run: t.run / tt };
  const recs = [];
  if (share.bike < IM_TARGET.bike[0]) recs.push(`Bike is ${Math.round(share.bike * 100)}% of your time (target 45–55%). The bike is the longest leg — lengthen the Sunday ride first.`);
  if (share.swim < IM_TARGET.swim[0]) recs.push(`Swim is ${Math.round(share.swim * 100)}% (target 10–20%). Protect both swim days; build distance, not intensity.`);
  if (share.run > IM_TARGET.run[1]) recs.push(`Run is ${Math.round(share.run * 100)}% (target 30–40%). High run share raises injury risk — move time to the bike.`);
  if (share.swim > IM_TARGET.swim[1]) recs.push(`Swim is ${Math.round(share.swim * 100)}% — more than the race needs; shift time to bike/run.`);
  return { hours: t, load: l, share, loadShare: { swim: l.swim / lt, bike: l.bike / lt, run: l.run / lt }, recs };
}

// ---- dual FTP coupling ----------------------------------------------------------------
// Outdoor FTP without a power meter (physics):
//   P_air   = ½·ρ·CdA·v³              (ρ 1.225 kg/m³, CdA 0.35 — road bike, hoods)
//   P_roll  = Crr·m·g·v·cos α         (Crr 0.005, m = rider + 9 kg bike)
//   P_slope = m·g·v·sin α             (α from GPS elevation; descents add nothing — you coast)
// v and HR are MEDIANS of moving samples (filters stops and GPS spikes). Then threshold power is
// extrapolated proportionally in heart-rate reserve:  FTP = P · (LTHR − HRrest) / (HRmedian − HRrest).
const RHO = 1.225, CDA = 0.35, CRR = 0.005, G = 9.81, ETA = 0.97;
export function hrProportional(P, hr, s, sport = 'bike') {
  const L = getZoneModel()[sport]?.lthr, R = s.restHr || 55;
  if (!L || !hr || hr <= R + 15) return null;
  return P * (L - R) / (hr - R);
}
function physicsPower(v, sinA, m) {
  const cos = Math.sqrt(1 - sinA * sinA);
  return Math.max(0, 0.5 * RHO * CDA * v ** 3 + CRR * m * G * v * cos + m * G * v * sinA) / ETA;
}
// ---- heart rate → % of FTP --------------------------------------------------------
// Anchors: top of HR zone 1 (= start of Z2) ↔ 56 % FTP, top of HR Z2 ↔ 75 % FTP, LTHR ↔ 100 % FTP
// (classic HR zones vs. power zones). Linear in between, extrapolated a little above LTHR.
export function hrToFtpPct(hr) {
  const zm = getZoneModel().bike, L = zm.lthr;
  if (!L || !hr) return null;
  const z = zm.hr;
  const lo = z?.[0] && z[0] < L ? z[0] : 0.81 * L, hi = z?.[1] && z[1] < L && z[1] > lo ? z[1] : 0.89 * L;
  if (hr < lo - 3) return null;                     // below Z2: too loose a relationship
  if (hr <= hi) return 0.56 + 0.19 * (hr - lo) / (hi - lo);
  return Math.min(1.08, 0.75 + 0.25 * (hr - hi) / (L - hi));
}
export const hrZone2 = () => { const zm = getZoneModel().bike, L = zm.lthr; if (!L) return null; const z = zm.hr; const lo = z?.[0] && z[0] < L ? z[0] : 0.81 * L, hi = z?.[1] && z[1] < L && z[1] > lo ? z[1] : 0.89 * L; return [Math.round(lo), Math.round(hi)]; };

// Two FTP readings from one power + HR recording:
//  z2   — your zone-2 watts: steady blocks where HR sat in Z2, each scaled up by its %FTP (median)
//  held — the most watts you held for 20 / 40 / 60 min, scaled by the HR you held them at
export function ftpReadings(P, hr, time, ok, { blockSec = 180, cvMax = 0.15, frac = 0.85 } = {}) {
  if (!P || !hr) return null;
  const z2 = hrZone2(); let z2ftp = null, z2w = null, nb = 0;
  if (z2) {
    const blocks = steadyBlocks(P, hr, time, ok, blockSec, cvMax).filter(([h]) => h >= z2[0] - 2 && h <= z2[1] + 2);
    nb = blocks.length;
    if (nb >= 3) { z2ftp = median(blocks.map(([h, w]) => w / hrToFtpPct(h))); z2w = median(blocks.map(([, w]) => w)); }
  }
  const held = [];
  for (const sec of [1200, 2400, 3600]) {
    const w = bestWindowFrac(P, hr, ok, sec, frac); if (!w || !w.other) continue;
    if (z2 && w.other < z2[1]) continue;              // only real efforts (HR above zone 2) — easy windows are covered by z2
    const pct = hrToFtpPct(w.other); if (!pct) continue;
    held.push({ ftp: w.mean / pct, P: w.mean, hr: Math.round(w.other), min: sec / 60 });
  }
  const h = held.length ? held.sort((x, y) => x.ftp - y.ftp)[held.length >> 1] : null;   // median of the durations
  return { z2: z2ftp, z2w, nb, held: h };
}

// Per-sample power from speed WITH the real gradient (altitude change over ~200 m), so false-flat
// descents no longer count as your power. Stops and GPS spikes excluded; coasting = 0 W.
export function gradedPowerSeries(st, m) {
  if (!st?.speed || !st.alt || !st.dist || st.n < 600) return null;
  const P = new Array(st.n).fill(null), ok = new Array(st.n).fill(false);
  let j = 0, k = 0;
  for (let i = 0; i < st.n; i++) {
    while (j < i && st.dist[i] - st.dist[j] > 100) j++;
    if (k < i) k = i; while (k < st.n - 1 && st.dist[k] - st.dist[i] < 100) k++;
    const dd = st.dist[k] - st.dist[j];
    const v = st.speed[i];
    if (!(v > 3 && v < 18) || dd < 120) continue;
    const g = (st.alt[k] - st.alt[j]) / dd;
    if (!(Math.abs(g) <= 0.015)) continue;           // near-flat only (≤ 1.5 %) — and that gradient IS counted
    P[i] = physicsPower(v, g / Math.sqrt(1 + g * g), m); ok[i] = true;
  }
  return { P, ok };
}
export const flatPowerSeries = gradedPowerSeries;

// Outdoor FTP (no power meter) from your LONG outdoor rides (≥ 2.5 h, last 6 months — winter-proof).
// Long rides are ridden at a consistent zone-2 effort, so each one gives a clean zone-2 power:
//   1. average moving speed, adjusted for the climbing: average power =
//        air (½·ρ·CdA·v³, the wind resistance grows with the cube of speed) + rolling (Crr·m·g·v)
//        + climbing (m·g·elevation gain / moving time, half of it given back on the descents)
//      → "gradient-adjusted flat speed" = the flat speed that needs that same power
//   2. zone-2 power → FTP: divided by the %FTP that matches the ride's average HR in your HR zones
//      (start of Z2 = 56 %, top of Z2 = 75 %, LTHR = 100 %), kept between 65 and 75 %
//      (no usable HR → 68 %, a typical long-ride intensity)
// Median of the up to 4 longest recent rides.
export const LONG_RIDE_SEC = 2.5 * 3600;
function flatSpeedFor(P, m) { let lo = 1, hi = 20; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (physicsPower(mid, 0, m) > P) hi = mid; else lo = mid; } return lo; }
export function outdoorFtpEstimate(acts, s) {
  const from = isoDate(addDays(new Date(), -183));
  const m = (s.weightKg || 75) + 9;
  const long = acts.filter(a => a.sport === 'bike' && !a.indoor && a.date >= from && a.movingSec >= LONG_RIDE_SEC && a.distanceM > 40000)
    .sort((x, y) => y.movingSec - x.movingSec || y.date.localeCompare(x.date)).slice(0, 4);
  const rides = [];
  for (const a of long) {
    const v = a.distanceM / a.movingSec;
    if (!(v > 4 && v < 14)) continue;
    const gain = a.elev ?? null;
    const climbW = gain ? 0.5 * m * G * gain / a.movingSec / ETA : 0;
    const P = physicsPower(v, 0, m) + climbW;
    const pctHr = a.avgHr ? hrToFtpPct(a.avgHr) : null;
    const pct = clamp(pctHr ?? 0.68, 0.65, 0.75);
    rides.push({ date: a.date, name: a.name, km: Math.round(a.distanceM / 1000), kmh: round(v * 3.6, 1), gain, P, adjKmh: round(flatSpeedFor(P, m) * 3.6, 1), hr: a.avgHr ? Math.round(a.avgHr) : null, pct, ftp: P / pct });
  }
  if (!rides.length) return null;
  const ftp = Math.round(median(rides.map(r => r.ftp)));
  const z2w = Math.round(median(rides.map(r => r.P)));
  return { ftp, n: rides.length, used: rides.length, rides, z2w, z2kmh: round(median(rides.map(r => r.adjKmh)), 1), pct: round(median(rides.map(r => r.pct)), 2), method: 'long rides: gradient-adjusted average speed → zone-2 power → FTP' };
}

export function isOpenWater(a) {
  return /open ?water|openwater/i.test(a.type || '') || /open ?water|freiwasser|see\b|lake|meer|ocean|sea\b|river|fluss/i.test(a.name || '') || (Array.isArray(a.streamTypes) && a.streamTypes.includes('latlng'));
}
// Continuous swim (POOL swims only):
//   per swim  cᵢ = longest distance without a pause > 2 min (wall stops, goggles, waiting don't count)
//   last 6 pool swims within `days`, weight wᵢ = 0.5^(days ago / 14)  (halves every 2 weeks)
//   estimate = Σ wᵢ·cᵢ / Σ wᵢ, rounded to 50 m
export function continuousSwim(acts, days = 56) {
  const now = new Date(), from = isoDate(addDays(now, -days));
  const list = [];
  const swims = acts.filter(a => a.sport === 'swim' && a.date >= from && a.distanceM > 100 && !isOpenWater(a)).sort((x, y) => y.date.localeCompare(x.date));
  for (const a of swims) {
    let m = longestContinuousSwim(cachedStreams(a.id)), src = 'lengths';
    if (m == null && a.elapsedSec && a.movingSec && a.elapsedSec - a.movingSec <= 120) { m = a.distanceM; src = 'no long pauses'; }
    if (m == null) continue;
    const age = Math.max(0, (now - parseDate(a.date)) / 864e5);
    list.push({ date: a.date, name: a.name, m: Math.round(m), age: Math.round(age), w: Math.pow(0.5, age / 14), src });
    if (list.length >= 6) break;
  }
  if (!list.length) return null;
  const sw = list.reduce((x, r) => x + r.w, 0);
  const est = Math.round(list.reduce((x, r) => x + r.w * r.m, 0) / sw / 50) * 50;
  return { m: Math.max(50, est), swims: list.length, list, date: list[0].date };
}

export function ftpCoupling(acts, s) {
  const target = s.raceTargetW || 230;
  // Only a value YOU entered freezes the ratio; automatic estimates are recalculated on every sync.
  let c = s.ftpCoupling?.source === 'your outdoor FTP' ? s.ftpCoupling : null;
  const est = outdoorFtpEstimate(acts, s);
  if (s.outdoorPower && s.ftpOutdoor) c = { ratio: s.ftpOutdoor / s.ftp, outdoor: s.ftpOutdoor, indoor: s.ftp, source: 'power meter' };
  else if (!c && est) c = { ratio: clamp(est.ftp / s.ftp, 0.7, 1.6), outdoor: est.ftp, indoor: s.ftp, date: isoDate(new Date()), source: `${est.n} long ride${est.n > 1 ? 's' : ''}: ${est.z2kmh} km/h gradient-adjusted ≈ ${est.z2w} W zone-2 power = ${Math.round(est.pct * 100)}% of FTP` };
  if (!c) return { target, est, ratio: null };
  const outdoorNow = Math.round(s.ftp * c.ratio);
  const indoorTarget = Math.round(target / c.ratio);
  return { target, est, ratio: c.ratio, calib: c, outdoorNow, indoorTarget, progress: s.ftp / indoorTarget };
}

// ---- easy pace at Z2 HR (per run) ---------------------------------------------------
// One value for EVERY run ≥ 10 min:
//  streams → median pace of Z2-HR windows (walking > 2 min at > 9:00/km excluded), or the run's own
//            pace↔HR line read at mid-Z2 when it barely touched Z2 (e.g. a short hard run)
//  no streams → average pace corrected to mid-Z2 HR (~0.6 % per bpm)
// Heat-corrected (EnviroNorm).
export function easyPaceSeries(acts, days = 120, endIso = isoDate(new Date())) {
  const from = isoDate(addDays(parseDate(endIso), -days));
  const z = getZoneModel().run.hr;
  const out = [];
  for (const a of acts) {
    if (a.sport !== 'run' || a.date < from || a.date > endIso || a.movingSec < 600) continue;
    const st = cachedStreams(a.id);
    let r = st ? z2PaceRun(st, z) : null;
    if (!r && !st) {
      const p = a.gapSecKm || a.paceSecKm;
      if (p && a.avgHr && z) { const mid = (z[0] + z[1]) / 2; r = { pace: p * (1 + 0.006 * (a.avgHr - mid)), src: 'average' }; }
    }
    if (!r || r.pace < 240 || r.pace > 720) continue;
    out.push({ x: a.date, y: Math.round(r.pace / heatFactor(a)), id: a.id, src: r.src, name: a.name });
  }
  return out.sort((a, b) => a.x.localeCompare(b.x));
}
// rolling easy pace = median of the last 5 runs
export function easyPaceNow(acts, endIso) {
  const pts = easyPaceSeries(acts, 120, endIso).slice(-5).map(p => p.y);
  return pts.length ? median(pts) : null;
}

// ---- how far can the athlete run without walking -----------------------------------------
export function continuousRun(acts, days = 56) {
  const from = isoDate(addDays(new Date(), -days));
  const res = [];
  for (const a of acts) {
    if (a.sport !== 'run' || a.date < from || a.movingSec < 600) continue;
    const st = cachedStreams(a.id);
    if (st) { const c = longestContinuousRun(st); if (c) res.push({ km: c.km, walkMin: c.walkMin, date: a.date, name: a.name, src: 'streams' }); }
    else if (a.distanceM && a.paceSecKm && a.paceSecKm < 540) res.push({ km: a.distanceM / 1000 * 0.9, walkMin: null, date: a.date, name: a.name, src: 'average' });
  }
  if (!res.length) return null;
  const best = res.reduce((m, r) => r.km > m.km ? r : m, res[0]);
  return { km: Math.round(best.km * 10) / 10, run: best, runs: res.length, withWalk: res.filter(r => r.walkMin > 2).length };
}
