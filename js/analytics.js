// Training analytics: execution score, heat correction, bricks, load management, discipline split,
// indoor/outdoor FTP coupling. Pure functions on normalised activities / wellness.
import { load, getCache, setCache } from './store.js';
import { collapse, plannedDist, getZoneModel, hrZoneOf } from './zones.js';
import { cachedStreams, z2Pace } from './streams.js';
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
export function outdoorRidePower(a, s) {
  const m = (s.weightKg || 75) + 9;
  const st = cachedStreams(a.id);
  if (st?.speed && st.hr && st.n > 600) {
    const vs = [], hs = [];
    for (let i = 0; i < st.n; i++) { const v = st.speed[i], h = st.hr[i]; if (v > 3 && v < 20 && h > 60) { vs.push(v); hs.push(h); } }
    if (vs.length > 600) {
      const v = median(vs), hr = median(hs);
      // average positive grade from the altitude stream (smoothed over ~200 m)
      let climb = 0, dist = 0;
      if (st.alt && st.dist) { let lastA = st.alt[0], lastD = st.dist[0]; for (let i = 1; i < st.n; i++) { if (st.dist[i] - lastD >= 200) { const dh = st.alt[i] - lastA; if (dh > 0) climb += dh; dist += st.dist[i] - lastD; lastA = st.alt[i]; lastD = st.dist[i]; } } }
      const sinA = dist > 0 ? Math.min(0.08, climb / dist / 2) : 0;   // half the route climbs, the other half descends
      return { P: physicsPower(v, sinA, m), hr, v, src: 'streams' };
    }
  }
  if (!a.distanceM || !a.movingSec || !a.avgHr) return null;
  const v = a.distanceM / a.movingSec;
  const sinA = Math.min(0.08, (a.elev || 0) / a.distanceM / 2);
  return { P: physicsPower(v, sinA, m), hr: a.avgHr, v, src: 'averages' };
}
export function outdoorFtpEstimate(acts, s) {
  const from = isoDate(addDays(new Date(), -70));
  const est = [];
  for (const a of acts) {
    if (a.sport !== 'bike' || a.indoor || a.date < from || a.movingSec < 3600 || !a.avgHr) continue;
    const r = outdoorRidePower(a, s);
    if (!r || r.v < 5 || r.v > 14) continue;
    const ftp = hrProportional(r.P, r.hr, s);
    if (!ftp || ftp < 80 || ftp > 400) continue;
    est.push({ ftp, P: r.P, date: a.date, src: r.src });
  }
  if (est.length < 2) return null;
  est.sort((x, y) => y.date.localeCompare(x.date));
  const recent = est.slice(0, 5);   // rolling: last 5 qualifying rides
  return { ftp: Math.round(median(recent.map(e => e.ftp))), avgP: Math.round(median(recent.map(e => e.P))), n: recent.length, fromStreams: recent.filter(e => e.src === 'streams').length };
}

export function ftpCoupling(acts, s) {
  const target = s.raceTargetW || 230;
  let c = s.ftpCoupling;
  const est = outdoorFtpEstimate(acts, s);
  if (s.outdoorPower && s.ftpOutdoor) c = { ratio: s.ftpOutdoor / s.ftp, outdoor: s.ftpOutdoor, indoor: s.ftp, source: 'power meter' };
  else if (!c && est) c = { ratio: clamp(est.ftp / s.ftp, 0.8, 1.6), outdoor: est.ftp, indoor: s.ftp, date: isoDate(new Date()), source: 'speed + HR physics estimate' };
  if (!c) return { target, est, ratio: null };
  const outdoorNow = Math.round(s.ftp * c.ratio);
  const indoorTarget = Math.round(target / c.ratio);
  return { target, est, ratio: c.ratio, calib: c, outdoorNow, indoorTarget, progress: s.ftp / indoorTarget };
}

// ---- easy pace at Z2 HR (per run) ---------------------------------------------------
// Preferred: median pace of the stream samples inside HR Z2 (first 5 min and GPS outliers dropped).
// Fallback (no streams yet): whole-run pace if the average HR is in Z2. Heat-corrected (EnviroNorm).
export function easyPaceSeries(acts, days = 120) {
  const from = isoDate(addDays(new Date(), -days));
  const out = [];
  for (const a of acts) {
    if (a.sport !== 'run' || a.date < from || a.movingSec < 1200) continue;
    const st = cachedStreams(a.id);
    const z = st ? z2Pace(st) : null;
    let pace = z?.pace ?? null, src = 'z2 samples';
    if (pace == null && !st) {
      const p = a.gapSecKm || a.paceSecKm;
      if (p && a.avgHr && hrZoneOf('run', a.avgHr) === 2) { pace = p; src = 'run average'; }
    }
    if (pace == null || pace < 240 || pace > 720) continue;
    out.push({ x: a.date, y: Math.round(pace / heatFactor(a)), id: a.id, src });
  }
  return out.sort((a, b) => a.x.localeCompare(b.x));
}
