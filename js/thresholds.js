// Threshold estimation from recorded activities.
// Bike FTP:   intervals.icu rolling eFTP, per-activity power-model FTP, power at LTHR (HR regression)
// Run pace:   pace at LTHR (HR regression on GAP), hard sustained efforts, races
// Swim CSS:   best hard swim sessions (rough)
// Each method yields a value + weight; combined estimate is a weighted mean with a confidence level.
import { isoDate, addDays, parseDate, round, clamp } from './util.js';
import { getZoneModel } from './zones.js';
import { isHard } from './history.js';

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function linreg(pts) {
  const n = pts.length; if (n < 5) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (sxx === 0 || syy === 0) return null;
  const b = sxy / sxx, a = my - b * mx, r = sxy / Math.sqrt(sxx * syy);
  const xs = pts.map(p => p[0]);
  return { a, b, r, spread: Math.max(...xs) - Math.min(...xs), n };
}

function windowActs(acts, endIso, days) {
  const from = isoDate(addDays(parseDate(endIso), -days));
  return acts.filter(a => a.date > from && a.date <= endIso);
}

export function estimateBike(acts, cur, endIso, days = 42) {
  const rides = windowActs(acts, endIso, days).filter(a => a.sport === 'bike' && a.movingSec >= 1200);
  const methods = [];
  // 1) intervals.icu rolling eFTP — most recent value
  const withE = rides.filter(a => a.eftp).sort((a, b) => b.date.localeCompare(a.date));
  if (withE.length) methods.push({ key: 'eftp', label: 'intervals.icu eFTP', value: withE[0].eftp, weight: 0.45, detail: `latest, ${withE[0].date}` });
  // 2) per-activity power-model FTP — median of the top 3 (only hard rides produce a meaningful model)
  const pm = rides.filter(a => a.pmFtp && a.pmFtp > 50).map(a => a.pmFtp).sort((a, b) => b - a).slice(0, 3);
  if (pm.length) methods.push({ key: 'pm', label: 'Power model (best rides)', value: Math.round(median(pm)), weight: pm.length >= 2 ? 0.3 : 0.15, detail: `${pm.length} ride${pm.length > 1 ? 's' : ''}` });
  // 3) HR regression: NP vs avg HR on steady rides, read off at bike LTHR
  const L = getZoneModel().bike.lthr;
  if (L) {
    const pts = rides.filter(a => a.np && a.avgHr && (a.vi == null || a.vi < 1.15)).map(a => [a.avgHr, a.np]);
    const r = linreg(pts);
    if (r && r.b > 0 && r.r > 0.5 && r.spread >= 8) {
      const v = r.a + r.b * L;
      if (v > cur * 0.7 && v < cur * 1.35) methods.push({ key: 'hr', label: `Power at LTHR ${L} bpm`, value: Math.round(v), weight: r.r > 0.75 ? 0.25 : 0.12, detail: `${r.n} steady rides, r=${round(r.r, 2)}` });
    }
  }
  return combine(methods, cur, 'W');
}

export function estimateRun(acts, cur, endIso, days = 42) {
  const runs = windowActs(acts, endIso, days).filter(a => a.sport === 'run' && a.movingSec >= 1200 && a.distanceM > 2000);
  const methods = [];
  const pace = a => a.gapSecKm || a.paceSecKm;
  const L = getZoneModel().run.lthr;
  // 1) HR regression: speed vs HR, read off at run LTHR → threshold pace
  if (L) {
    const pts = runs.filter(a => a.avgHr && pace(a)).map(a => [a.avgHr, 1000 / pace(a)]); // speed m/s
    const r = linreg(pts);
    if (r && r.b > 0 && r.r > 0.5 && r.spread >= 8) {
      const v = 1000 / (r.a + r.b * L);
      if (v > cur * 0.75 && v < cur * 1.3) methods.push({ key: 'hr', label: `Pace at LTHR ${L} bpm`, value: Math.round(v), weight: r.r > 0.75 ? 0.4 : 0.2, detail: `${r.n} runs, r=${round(r.r, 2)}` });
    }
  }
  // 2) hard sustained efforts (avg HR ≥ 94% LTHR, 20–70 min) — duration-corrected
  if (L) {
    const hard = runs.filter(a => a.avgHr >= 0.94 * L && a.movingSec <= 4200 && pace(a)).map(a => {
      const m = a.movingSec / 60; const f = m <= 25 ? 1.03 : m <= 45 ? 1.0 : 0.98;
      return pace(a) * f * (a.avgHr < L ? 1 - (L - a.avgHr) / L * 0.8 : 1);
    });
    if (hard.length) { const best = [...hard].sort((a, b) => a - b).slice(0, 3); methods.push({ key: 'effort', label: 'Hard sustained runs', value: Math.round(median(best)), weight: hard.length >= 2 ? 0.3 : 0.15, detail: `median of best ${best.length} of ${hard.length}` }); }
  }
  // 3) races: convert race pace to threshold pace
  const races = runs.filter(a => a.race && pace(a)).map(a => {
    const km = a.distanceM / 1000; const f = km < 7 ? 1.06 : km < 12 ? 1.03 : km < 25 ? 0.985 : 0.95;
    return pace(a) * f;
  });
  if (races.length) methods.push({ key: 'race', label: 'Race result', value: Math.round(Math.min(...races)), weight: 0.45, detail: `${races.length} race${races.length > 1 ? 's' : ''}` });
  return combine(methods, cur, 's/km', true);
}

export function estimateSwim(acts, cur, endIso, days = 56) {
  const swims = windowActs(acts, endIso, days).filter(a => a.sport === 'swim' && a.pace100 && a.distanceM >= 1000);
  const methods = [];
  const hard = swims.filter(a => isHard(a)).map(a => a.pace100 - 5); // session avg incl. warm-up ≈ CSS + 5 s
  if (hard.length) methods.push({ key: 'sets', label: 'Hard/CSS sessions', value: Math.round(Math.min(...hard)), weight: 0.3, detail: `${hard.length} session${hard.length > 1 ? 's' : ''}` });
  const fast = swims.map(a => a.pace100 - 8).sort((a, b) => a - b).slice(0, 2); // aerobic sessions ≈ CSS + 8 s
  if (fast.length && !hard.length) methods.push({ key: 'aero', label: 'Fastest steady swims', value: Math.round(median(fast)), weight: 0.15, detail: `${fast.length} swims` });
  // Detect a CSS test (e.g. activity named "CSS test" / "400 200 test") — the only reliable source.
  const test = swims.filter(a => /css.?test|400.*200|200.*400|swim.?test/i.test(a.name)).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (test && test.description) {
    const m = test.description.match(/400\D*(\d+):(\d{2}).*?200\D*(\d+):(\d{2})/i);
    if (m) { const t400 = +m[1] * 60 + +m[2], t200 = +m[3] * 60 + +m[4]; return combine([{ key: 'test', label: 'CSS test', value: Math.round((t400 - t200) / 2), weight: 1, detail: test.date }], cur, 's/100m', true); }
  }
  const r = combine(methods, cur, 's/100m', true);
  // Session averages include warm-up, drills and slower sets, so never trust them enough to auto-apply.
  if (r.confidence === 'high' || r.confidence === 'medium') r.confidence = 'low';
  r.hint = 'Rough only. For a real CSS: swim 400 m and 200 m all-out, name it "CSS test" and put the times in the description (e.g. "400 7:20, 200 3:30").';
  return r;
}

function combine(methods, cur, unit, lowerIsBetter = false) {
  if (!methods.length) return { value: null, confidence: 'none', methods, unit, cur };
  const wsum = methods.reduce((a, m) => a + m.weight, 0);
  const value = methods.reduce((a, m) => a + m.value * m.weight, 0) / wsum;
  const spread = methods.length > 1 ? (Math.max(...methods.map(m => m.value)) - Math.min(...methods.map(m => m.value))) / value : 0;
  const confidence = wsum >= 0.55 && spread < 0.08 ? 'high' : wsum >= 0.3 && spread < 0.12 ? 'medium' : 'low';
  return { value: Math.round(value), confidence, methods, unit, cur, lowerIsBetter };
}

export function estimateAll(acts, s, endIso) {
  return {
    ftp: estimateBike(acts, s.ftp, endIso),
    runThreshold: estimateRun(acts, s.runThreshold, endIso),
    css: estimateSwim(acts, s.css, endIso),
  };
}

// Weekly history of the estimate, for trend lines on the Progress tab.
export function estimateTrend(acts, s, endIso, weeks = 12) {
  const out = { ftp: [], runThreshold: [], css: [] };
  for (let i = weeks - 1; i >= 0; i--) {
    const d = isoDate(addDays(parseDate(endIso), -7 * i));
    const e = estimateAll(acts, s, d);
    for (const k of Object.keys(out)) out[k].push({ date: d, value: e[k].value });
  }
  return out;
}

// Decide what to apply. Max ±5% per update (smoothing); ignore tiny changes.
export function proposeUpdates(est, s) {
  const out = [];
  const minDelta = { ftp: 3, runThreshold: 3, css: 2 };
  for (const k of ['ftp', 'runThreshold', 'css']) {
    const e = est[k];
    if (!e.value || e.confidence === 'none' || e.confidence === 'low') continue;
    const curV = s[k];
    const capped = clamp(e.value, curV * 0.95, curV * 1.05);
    const to = Math.round(capped);
    if (Math.abs(to - curV) < minDelta[k]) continue;
    out.push({ field: k, from: curV, to, raw: e.value, confidence: e.confidence, methods: e.methods.map(m => m.label).join(', ') });
  }
  return out;
}
