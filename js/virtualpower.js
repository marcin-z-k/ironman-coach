// ONE-FTP MODE for athletes without any power meter, and FTP tracking from indoor rides that only
// record heart rate, duration and distance ("virtual power").
//
// Single-FTP mode: active while no ride has ever had real power (device watts). Then there is just
// one "FTP" (no indoor/outdoor split). Once a power meter shows up (indoor or outdoor), the app goes
// back to separate indoor and outdoor FTPs for good (s.powerSeen).
//
// Virtual power on a trainer (fluid trainers: P = A·v + B·v³ — Kurt Kinetic; the distance error of
// a wheel sensor is a constant factor, so only RELATIVE changes are needed):
//   1  indoor ride without power = bike, no GPS track, no real watts, distance > 1 km
//   2  virtual speed per 5-min block (after the first 10 min): v = Δdistance / Δtime   (km/h)
//   3  relative power  R(v):  fluid/wind 3.26·v + 0.0046·v³ · magnetic 4.0·v + 0.06·v² · unknown v^1.7
//   4  per ride  I = median over blocks of R(v) ÷ %FTP(HR of the block's 2nd half)
//      (only blocks at or above mid zone 2; %FTP: Z2 start 56 %, Z2 top 75 %, LTHR 100 %)
//      no streams → whole ride: average speed and average HR
//   5  calibration: scale = FTP_anchor ÷ median(I of indoor rides within ±21 days of the anchor)
//      anchor = FTP from your long outdoor rides (else the FTP in use at your first indoor rides)
//   6  FTP(t) = scale × Ĩ(t), Ĩ = recency-weighted mean of the last 5 rides' I (weight 0.5^(days/14))
//      re-anchored whenever a newer outdoor estimate exists
import { isoDate, addDays, parseDate } from './util.js';
import { cachedStreams } from './streams.js';
import { hrToFtpPct, outdoorFtpEstimate } from './analytics.js';

const median = a => { const v = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const MIN_PCT = 0.655;

export const hasRealPower = (a) => a.sport === 'bike' && a.deviceWatts !== false && (a.np > 0 || a.avgW > 0);
export const singleFtp = (s) => !s.powerSeen && !s.outdoorPower;

export function isVirtualRide(a) {
  if (a.sport !== 'bike' || !(a.distanceM > 1000) || !(a.movingSec >= 1200)) return false;
  if (hasRealPower(a)) return false;
  if (Array.isArray(a.streamTypes) && a.streamTypes.includes('latlng')) return false;
  return !!a.indoor || !Array.isArray(a.streamTypes) || !a.streamTypes.includes('latlng');
}

export const TRAINERS = { unknown: 'Not sure', fluid: 'Fluid', magnetic: 'Magnetic', wind: 'Wind / fan' };
export function curve(kmh, type = 'unknown') {
  if (type === 'fluid' || type === 'wind') return 3.26 * kmh + 0.0046 * kmh ** 3;
  if (type === 'magnetic') return 4.0 * kmh + 0.06 * kmh ** 2;
  return Math.pow(kmh, 1.7);
}

// one ride → index I (or null)
export function rideIndex(a, type) {
  const st = cachedStreams(a.id);
  const out = [];
  if (st?.dist && st.hr && st.time && st.n > 900) {
    const B = 300;
    let i = 0; while (i < st.n && st.time[i] < 600) i++;
    for (; i + B < st.n; i += B) {
      const dd = (st.dist[i + B] ?? 0) - (st.dist[i] ?? 0), dt = (st.time[i + B] ?? 0) - (st.time[i] ?? 0);
      if (!(dt > 0) || dt > B * 1.3 || dd <= 0) continue;              // pauses
      const kmh = dd / dt * 3.6; if (kmh < 8 || kmh > 70) continue;
      let hs = 0, hc = 0; for (let k = i + B / 2; k < i + B; k++) if (st.hr[k]) { hs += st.hr[k]; hc++; }
      if (hc < B / 4) continue;
      const pct = hrToFtpPct(hs / hc); if (!pct || pct < MIN_PCT) continue;
      out.push(curve(kmh, type) / pct);
    }
    if (out.length >= 2) return { I: median(out), n: out.length, src: 'blocks' };
  }
  if (a.avgHr && a.distanceM && a.movingSec) {
    const pct = hrToFtpPct(a.avgHr); if (!pct || pct < MIN_PCT) return null;
    return { I: curve(a.distanceM / a.movingSec * 3.6, type) / pct, n: 1, src: 'whole ride' };
  }
  return null;
}

export function rideIndices(acts, type, fromIso, toIso) {
  return acts.filter(a => a.date >= fromIso && a.date <= toIso && isVirtualRide(a))
    .map(a => { const r = rideIndex(a, type); return r ? { ...r, date: a.date, id: a.id } : null; }).filter(Boolean)
    .sort((x, y) => y.date.localeCompare(x.date));
}

// recency-weighted index at a date (last 5 rides within 8 weeks)
export function indexAt(acts, type, endIso) {
  const list = rideIndices(acts, type, isoDate(addDays(parseDate(endIso), -56)), endIso).slice(0, 5);
  if (!list.length) return null;
  const end = parseDate(endIso);
  let sw = 0, s = 0;
  for (const r of list) { const w = Math.pow(0.5, Math.max(0, (end - parseDate(r.date)) / 864e5) / 14); sw += w; s += w * r.I; }
  return { I: s / sw, n: list.length, last: list[0].date, list };
}

// calibration (stored in settings, synced)
export function calibrate(acts, s) {
  const type = s.trainerType || 'unknown';
  const out = outdoorFtpEstimate(acts, s);
  const outDate = out?.rides?.length ? out.rides.map(r => r.date).sort()[out.rides.length >> 1] : null;
  const cur = s.vpCal;
  const needs = !cur || cur.type !== type || (outDate && (cur.source !== 'outdoor rides' || outDate > isoDate(addDays(parseDate(cur.anchorDate), 14))));
  if (!needs) return cur;
  let anchorFtp, anchorDate, source, win;
  if (out && outDate) {
    anchorFtp = out.ftp; anchorDate = outDate; source = 'outdoor rides';
    win = rideIndices(acts, type, isoDate(addDays(parseDate(outDate), -21)), isoDate(addDays(parseDate(outDate), 21)));
    if (win.length < 2) win = rideIndices(acts, type, outDate, isoDate(new Date())).slice(-3);        // first indoor rides after
  } else {
    const all = rideIndices(acts, type, '2000-01-01', isoDate(new Date()));
    if (!all.length) return cur || null;
    win = all.slice(-3); anchorFtp = s.ftp; anchorDate = win[win.length - 1].date; source = 'FTP in use at your first indoor rides';
  }
  const Iref = median(win.map(r => r.I));
  if (!Iref) return cur || null;
  return { scale: anchorFtp / Iref, Iref, anchorFtp, anchorDate, source, type, n: win.length, at: isoDate(new Date()) };
}

// FTP estimate for one-FTP mode (used by estimateBike)
export function virtualFtp(acts, s, endIso) {
  const cal = s.vpCal; if (!cal) return null;
  const type = cal.type || s.trainerType || 'unknown';
  const ix = indexAt(acts, type, endIso);
  const out = endIso >= isoDate(new Date()) ? outdoorFtpEstimate(acts, s) : null;
  const outLast = out?.rides?.length ? out.rides.map(r => r.date).sort().pop() : null;
  if (out && (!ix || outLast > ix.last)) return { value: out.ftp, conf: out.n >= 2 ? 'medium' : 'low', detail: `long outdoor rides (${out.n}) are more recent than your indoor rides`, label: 'Long outdoor rides' };
  if (!ix) return null;
  const v = cal.scale * ix.I;
  return { value: v, conf: ix.n >= 3 ? 'medium' : 'low', label: 'Indoor speed at heart rate', improvement: ix.I / cal.Iref - 1,
    detail: `${ix.n} indoor ride${ix.n > 1 ? 's' : ''} · ${ix.I / cal.Iref - 1 >= 0 ? '+' : ''}${Math.round((ix.I / cal.Iref - 1) * 1000) / 10} % since calibration (${cal.anchorDate}, ${cal.anchorFtp} W from ${cal.source})` };
}
