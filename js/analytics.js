// Training analytics: execution score, heat correction, bricks, load management, discipline split,
// indoor/outdoor FTP coupling. Pure functions on normalised activities / wellness.
import { load, getCache, setCache } from './store.js';
import { collapse, plannedDist, getZoneModel, hrZoneOf } from './zones.js';
import { cachedStreams, z2PaceRun, longestContinuousRun, bestWindowWith, bestWindowFrac, runMask } from './streams.js';
import { isoDate, addDays, startOfWeek, parseDate, round, clamp } from './util.js';

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length) : 0; };
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---- EnviroNorm: heat correction ---------------------------------------------------
export function getTemp(a) { const t = (getCache('temps') || {})[a.id]; return t != null ? t : null; }
export function setTemp(a, t) { const m = getCache('temps') || {}; if (t == null || t === '') delete m[a.id]; else m[a.id] = +t; setCache('temps', m); }
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
// Per-sample power from speed on FLAT road (|grade| ≤ 1.5 %), stops and GPS spikes excluded.
export function flatPowerSeries(st, m) {
  if (!st?.speed || st.n < 600) return null;
  const P = new Array(st.n).fill(null), ok = new Array(st.n).fill(false);
  // grade over ~100 m
  const grade = new Array(st.n).fill(null);
  if (st.alt && st.dist) { let j = 0; for (let i = 0; i < st.n; i++) { while (j < i && st.dist[i] - st.dist[j] > 100) j++; const dd = st.dist[i] - st.dist[j]; if (dd >= 50) grade[i] = (st.alt[i] - st.alt[j]) / dd; } }
  for (let i = 0; i < st.n; i++) {
    const v = st.speed[i];
    if (!(v > 4 && v < 18)) continue;
    if (grade[i] != null && Math.abs(grade[i]) > 0.015) continue;
    P[i] = physicsPower(v, 0, m); ok[i] = true;
  }
  return { P, ok };
}
// Outdoor FTP (no power meter), time-based:
//   best power you held on flat stretches for 20 / 40 / 60 min (from speed, CdA 0.35)
//   → FTP ≈ P20·0.95 / P40·0.98 / P60·1.00 (highest), with a small, capped HR correction when the
//   effort was clearly below threshold HR (+¼ of the HR-reserve gap, max +5 %).
export function outdoorFtpEstimate(acts, s) {
  const from = isoDate(addDays(new Date(), -70));
  const L = getZoneModel().bike.lthr, R = s.restHr || 55;
  const m = (s.weightKg || 75) + 9;
  const rides = [];
  for (const a of acts) {
    if (a.sport !== 'bike' || a.indoor || a.date < from || a.movingSec < 1800) continue;
    const st = cachedStreams(a.id);
    const fp = flatPowerSeries(st, m);
    if (!fp) continue;
    let best = null;
    for (const [sec, k] of [[1200, 0.95], [2400, 0.98], [3600, 1.0]]) {
      const w = bestWindowFrac(fp.P, st.hr, fp.ok, sec, 0.6);
      if (!w) continue;
      let ftp = w.mean * k;
      if (L && w.other && w.other > R + 20 && w.other < L) ftp *= 1 + Math.min(0.05, 0.25 * ((L - R) / (w.other - R) - 1));
      if (!best || ftp > best.ftp) best = { ftp, P: w.mean, hr: Math.round(w.other), min: sec / 60 };
    }
    if (best && best.ftp > 70 && best.ftp < 400) rides.push({ ...best, date: a.date });
  }
  if (!rides.length) return null;
  rides.sort((x, y) => y.ftp - x.ftp);
  const top = rides.slice(0, 3);
  return { ftp: Math.round(median(top.map(r => r.ftp))), avgP: Math.round(median(top.map(r => r.P))), n: rides.length, best: top[0], method: 'flat speed held 20–60 min' };
}

export function ftpCoupling(acts, s) {
  const target = s.raceTargetW || 230;
  // Only a value YOU entered freezes the ratio; automatic estimates are recalculated on every sync.
  let c = s.ftpCoupling?.source === 'your outdoor FTP' ? s.ftpCoupling : null;
  const est = outdoorFtpEstimate(acts, s);
  if (s.outdoorPower && s.ftpOutdoor) c = { ratio: s.ftpOutdoor / s.ftp, outdoor: s.ftpOutdoor, indoor: s.ftp, source: 'power meter' };
  else if (!c && est) c = { ratio: clamp(est.ftp / s.ftp, 0.7, 1.6), outdoor: est.ftp, indoor: s.ftp, date: isoDate(new Date()), source: `flat-road speed you held ${est.best.min} min (${Math.round(est.best.P)} W at ${est.best.hr} bpm)` };
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
