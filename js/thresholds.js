// Threshold estimation from recorded activities.
// Bike FTP:   intervals.icu rolling eFTP, per-activity power-model FTP, power at LTHR (HR regression)
// Run pace:   pace at LTHR (HR regression on GAP), hard sustained efforts, races
// Swim CSS:   best hard swim sessions (rough)
// Each method yields a value + weight; combined estimate is a weighted mean with a confidence level.
import { isoDate, addDays, parseDate, round, clamp } from './util.js';
import { getZoneModel } from './zones.js';
import { isHard } from './history.js';
import { hrProportional } from './analytics.js';

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

export function estimateBike(acts, cur, endIso, days = 42, s = {}) {
  // INDOOR FTP: only indoor rides with real (device) power — outdoor estimated watts are not comparable
  const rides = windowActs(acts, endIso, days).filter(a => a.sport === 'bike' && a.movingSec >= 1200 && a.indoor && a.deviceWatts !== false);
  const methods = [];
  const L = getZoneModel().bike.lthr;
  // 1) HR-proportional extrapolation of sustained efforts: FTP = NP · (LTHR − HRrest)/(HR − HRrest)
  //    only rides at ≥ 75% LTHR (short extrapolation), rolling median of the 3 most recent
  if (L) {
    const ex = rides.filter(a => (a.np || a.avgW) && a.avgHr >= 0.75 * L).sort((a, b) => b.date.localeCompare(a.date))
      .map(a => hrProportional(a.np || a.avgW, a.avgHr, s)).filter(v => v && v > cur * 0.6 && v < cur * 1.4).slice(0, 3);
    if (ex.length) methods.push({ key: 'hrprop', label: 'HR-proportional (last rides)', value: Math.round(median(ex)), weight: ex.length >= 2 ? 0.55 : 0.3, detail: `median of ${ex.length} ride${ex.length > 1 ? 's' : ''}` });
  }
  // 2) intervals.icu rolling eFTP — most recent value from an indoor ride
  const withE = rides.filter(a => a.eftp).sort((a, b) => b.date.localeCompare(a.date));
  if (withE.length) methods.push({ key: 'eftp', label: 'intervals.icu eFTP', value: withE[0].eftp, weight: 0.3, detail: `latest, ${withE[0].date}` });
  // 3) per-activity power-model FTP (hard rides only produce a meaningful model)
  const pm = rides.filter(a => a.pmFtp && a.pmFtp > 50 && a.pmFtp < cur * 1.4).sort((a, b) => b.date.localeCompare(a.date)).map(a => a.pmFtp).slice(0, 3);
  if (pm.length) methods.push({ key: 'pm', label: 'Power model (recent rides)', value: Math.round(median(pm)), weight: 0.15, detail: `${pm.length} ride${pm.length > 1 ? 's' : ''}` });
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

export function isOpenWater(a) {
  return /open ?water|openwater/i.test(a.type || '') || /open ?water|freiwasser|see\b|lake|meer|ocean|sea\b|river|fluss/i.test(a.name || '') || (Array.isArray(a.streamTypes) && a.streamTypes.includes('latlng'));
}
export function estimateSwim(acts, cur, endIso, days = 56) {
  // POOL swims only (open water: GPS drift, sighting, breaststroke). Rolling: the 5 most recent pool swims.
  const swims = windowActs(acts, endIso, days).filter(a => a.sport === 'swim' && !isOpenWater(a) && a.pace100 && a.pace100 > 70 && a.pace100 < 240 && a.distanceM >= 800)
    .sort((a, b) => b.date.localeCompare(a.date));
  const methods = [];
  const last = swims.slice(0, 5);
  if (last.length) {
    const hard = last.filter(isHard);
    const v = median(last.map(a => a.pace100 - (isHard(a) ? 5 : 8)));   // session average ≈ CSS + 5 s (hard) / + 8 s (aerobic)
    methods.push({ key: 'pool', label: 'Last pool swims', value: Math.round(v), weight: 0.3, detail: `${last.length} pool swim${last.length > 1 ? 's' : ''}${hard.length ? `, ${hard.length} hard` : ''} · latest ${last[0].date}` });
  }
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
    ftp: estimateBike(acts, s.ftp, endIso, 42, s),
    runThreshold: estimateRun(acts, s.runThreshold, endIso),
    css: estimateSwim(acts, s.css, endIso),
  };
}

// Weekly history of the estimate, for trend lines on the Progress tab.
export function estimateTrend(acts, s, endIso, weeks = 12) {
  // recalculated at every relevant activity (not weekly)
  const from = isoDate(addDays(parseDate(endIso), -7 * weeks));
  const rel = { ftp: a => a.sport === 'bike' && a.indoor, runThreshold: a => a.sport === 'run', css: a => a.sport === 'swim' && !isOpenWater(a) };
  const out = { ftp: [], runThreshold: [], css: [] };
  for (const k of Object.keys(out)) {
    const dates = [...new Set(acts.filter(a => a.date >= from && a.date <= endIso && rel[k](a)).map(a => a.date))].sort();
    for (const d of dates) { const e = k === 'ftp' ? estimateBike(acts, s.ftp, d, 42, s) : k === 'runThreshold' ? estimateRun(acts, s.runThreshold, d) : estimateSwim(acts, s.css, d); out[k].push({ date: d, value: e.value }); }
  }
  return out;
}

// Decide what to apply. Max ±5% per update (smoothing); ignore tiny changes.
export function proposeUpdates(est, s, todayIso = new Date().toISOString().slice(0, 10)) {
  const out = [];
  const held = k => s.holds && s.holds[k] && s.holds[k] >= todayIso;
  const minDelta = { ftp: 3, runThreshold: 3, css: 2 };
  for (const k of ['ftp', 'runThreshold', 'css']) {
    const e = est[k];
    if (held(k)) continue;
    if (!e.value || e.confidence === 'none' || e.confidence === 'low') continue;
    const curV = s[k];
    const capped = clamp(e.value, curV * 0.95, curV * 1.05);
    const to = Math.round(capped);
    if (Math.abs(to - curV) < minDelta[k]) continue;
    out.push({ field: k, from: curV, to, raw: e.value, confidence: e.confidence, methods: e.methods.map(m => m.label).join(', ') });
  }
  return out;
}
