// Goal tracking for the four target metrics (easy pace, run threshold, indoor FTP, swim CSS):
//   target  — the goal value (edge of the goal band you need to reach)
//   baseline— your level in your FIRST logged activities (all intervals.icu history; computed once,
//             stored in settings, synced across devices)
//   progress— 0 % = baseline, 100 % = target:  (baseline − current) / (baseline − target)
//   status  — vs. a straight line from baseline (its date) to target (race day):
//             expected(today) = baseline + (target − baseline) · elapsed / total
//             Ahead > 3 % better than expected · Behind > 3 % worse · otherwise On Track
import { isoDate, addDays, parseDate, clamp } from './util.js';
import { getZoneModel } from './zones.js';
import { easyPaceSeries, ftpCoupling } from './analytics.js';
import { estimateRun, estimateBike, estimateSwim } from './thresholds.js';

export const KEYS = ['easy', 'runThreshold', 'ftp', 'css'];
export const LOWER_BETTER = { easy: true, runThreshold: true, ftp: false, css: true };

export function targets(s, acts) {
  const pz = getZoneModel().run.pace, zf = ((pz?.[0] || 77.5) + (pz?.[1] || 87.7)) / 200;
  const cp = ftpCoupling(acts, s);
  const it = cp.single ? (s.raceTargetW || 230) : (cp.indoorTarget || Math.round((s.raceTargetW || 230) / 1.15));
  return {
    easy: { target: 360, band: [330, 360] },                                   // 5:30–6:00/km
    runThreshold: { target: Math.round(360 * zf), band: [Math.round(330 * zf), Math.round(360 * zf)] },
    ftp: { target: it, band: [it, Math.round(it * 1.04)] },                     // indoor FTP for the outdoor race target
    css: { target: s.cssTarget || 120, band: [(s.cssTarget || 120) - 8, s.cssTarget || 120] },   // Settings → CSS target (default 2:00/100m)
  };
}

const median = a => { const v = a.filter(x => x != null).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; };
export function easyNow(acts, endIso) { const p = easyPaceSeries(acts, 42, endIso).slice(-5).map(x => x.y); return p.length >= 2 ? median(p) : null; }

// first 42-day window (stepping 14 days from your first activity of that sport) that gives a value
export function computeBaseline(acts, s) {
  const out = { v: 1, at: isoDate(new Date()) };
  const first = (f) => acts.filter(f).map(a => a.date).sort()[0];
  const spec = {
    easy: [a => a.sport === 'run', end => easyNow(acts, end)],
    runThreshold: [a => a.sport === 'run', end => estimateRun(acts, s.runThreshold, end).value],
    ftp: [a => a.sport === 'bike' && a.indoor, end => estimateBike(acts, s.ftp, end, 42, s).value],
    css: [a => a.sport === 'swim', end => estimateSwim(acts, s.css, end).value],
  };
  for (const [k, [f, est]] of Object.entries(spec)) {
    const d0 = first(f); if (!d0) continue;
    for (let i = 0; i < 12; i++) {
      const end = isoDate(addDays(parseDate(d0), 42 + 14 * i));
      if (end > out.at) break;
      let v = null; try { v = est(end); } catch {}
      if (v) { out[k] = { value: Math.round(v), date: d0 }; break; }
    }
    // old rides have no second-by-second data cached → fall back to summary values
    if (!out[k] && k === 'ftp') {
      const early = acts.filter(f).filter(a => a.date <= isoDate(addDays(parseDate(d0), 42)) && a.eftp).map(a => a.eftp);
      const firstLog = (s.thresholdLog || []).filter(l => l.field === 'ftp').map(l => ({ d: l.date, v: l.from })).sort((x, y) => x.d.localeCompare(y.d))[0];
      if (early.length) out[k] = { value: Math.round(median(early)), date: d0, src: 'intervals.icu eFTP of your first rides' };
      else if (firstLog?.v) out[k] = { value: Math.round(firstLog.v), date: firstLog.d, src: 'first FTP in your change history' };
    }
  }
  return out;
}

export function progress(key, cur, base, target) {
  if (cur == null || base == null || target == null || base === target) return null;
  const p = LOWER_BETTER[key] ? (base - cur) / (base - target) : (cur - base) / (target - base);
  return clamp(p, 0, 1);
}

export function expectedAt(base, baseDate, target, raceDate, iso) {
  const t0 = parseDate(baseDate).getTime(), t1 = parseDate(raceDate).getTime(), t = parseDate(iso).getTime();
  const f = clamp((t - t0) / Math.max(1, t1 - t0), 0, 1);
  return base + (target - base) * f;
}

export function status(key, cur, base, baseDate, target, raceDate, iso = isoDate(new Date())) {
  if (cur == null || base == null || !baseDate) return null;
  const exp = expectedAt(base, baseDate, target, raceDate, iso);
  const better = LOWER_BETTER[key] ? (exp - cur) / exp : (cur - exp) / exp;    // + = better than expected
  const reached = LOWER_BETTER[key] ? cur <= target : cur >= target;
  if (reached) return { label: 'Goal reached', cls: 'good', exp, better };
  return better > 0.03 ? { label: 'Ahead of Plan', cls: 'good', exp, better } : better < -0.03 ? { label: 'Behind', cls: 'bad', exp, better } : { label: 'On Track', cls: 'track', exp, better };
}

// expected-path points for a chart x-range (two ends of a straight line)
export function pathPts(base, baseDate, target, raceDate, fromIso, toIso) {
  return [fromIso, toIso].map(x => ({ x, y: Math.round(expectedAt(base, baseDate, target, raceDate, x) * 10) / 10 }));
}
