// Periodised sub-12 Ironman plan generator.
// Deterministic from settings (race date, thresholds, weekly hours, anchor date) plus an
// adjustment factor from the adaptation engine applied to current/future weeks.
import { isoDate, addDays, startOfWeek, parseDate, paceToStr, clamp, round } from './util.js';
import { refInfo, dowOf } from './history.js';
import { ROLES, finalize, scaleVolume, raceWeek, T } from './workouts.js';
import { goalArchetype, TRI } from './goals.js';
import { getZoneModel, powerRangeStr, paceRangeStr } from './zones.js';

export const PHASES = {
  base:  { label: 'Base',  desc: 'Aerobic foundation, swim technique, sweet-spot strength on the bike.' },
  build: { label: 'Build', desc: 'Raise threshold: bike threshold/VO2, run threshold intervals, longer weekends.' },
  peak:  { label: 'Peak',  desc: 'Race-specific: Ironman power & pace blocks, long bricks, nutrition rehearsal.' },
  taper: { label: 'Taper', desc: 'Volume drops, intensity stays sharp. Arrive fresh.' },
  race:  { label: 'Race week', desc: 'Short openers, rest, then race day.' },
};

export function zones(s) {
  // Power/pace bands come from the athlete's intervals.icu zones (scaled by current FTP / threshold);
  // Ironman-specific bands are fixed fractions because they are not a standard zone.
  const T = s.runThreshold, F = s.ftp, C = s.css;
  const m = getZoneModel();
  const w = (lo, hi) => `${Math.round(F * lo)}–${Math.round(F * hi)} W`;
  const p = (lo, hi) => `${paceToStr(T * lo)}–${paceToStr(T * hi)}/km`;
  const sw = (lo, hi) => `${paceToStr(C + lo)}–${paceToStr(C + hi)}/100m`;
  return {
    bike: { z1: powerRangeStr(F, 1), z2: powerRangeStr(F, 2), z3: powerRangeStr(F, 3), ss: w(m.bike.ss[0] / 100, m.bike.ss[1] / 100), z4: powerRangeStr(F, 4), z5: powerRangeStr(F, 5), im: w(0.70, 0.76), imW: Math.round(F * 0.73) },
    run: { easy: paceRangeStr('run', T, 2), steady: paceRangeStr('run', T, 3), im: p(1.13, 1.18), thr: paceRangeStr('run', T, 4), vo2: paceRangeStr('run', T, 5), imPace: Math.round(T * 1.155), easyPace: Math.round(T * 1.25) },
    swim: { easy: sw(6, 12), css: sw(-1, 2), im: sw(3, 7), fast: sw(-6, -2), imPace: C + 5 },
  };
}

function phaseFor(wtg, totalWeeks) {
  if (wtg <= 0) return 'race';
  if (wtg <= 2) return 'taper';
  if (wtg <= 10) return 'peak';
  if (wtg <= 24 || totalWeeks <= 26) return 'build';
  return 'base';
}

export const DEFAULT_TEMPLATE = [
  { dow: 1, role: 'swim-technique' },
  { dow: 2, role: 'run-intervals' },
  { dow: 3, role: 'swim-endurance' },
  { dow: 4, role: 'bike-power' },
  { dow: 4, role: 'run-brick' },
  { dow: 5, role: 'run-long' },
  { dow: 6, role: 'bike-long' },
];

// adjust: { factor, fromWeek, intensityCap }   opts: { acts, focus: {swim,bike,run} multipliers from fromWeek }
export function generatePlan(s, adjust = { factor: 1, fromWeek: 0, intensityCap: null }, opts = {}) {
  const acts = opts.acts || [];
  const focus = opts.focus || { swim: 1, bike: 1, run: 1 };
  const arch = goalArchetype(s);   // null → the athlete's own default Ironman plan (unchanged)
  const template = (arch ? arch.template : (s.weekTemplate && s.weekTemplate.length ? s.weekTemplate : DEFAULT_TEMPLATE)).filter(t => ROLES[t.role]);
  const anchor = startOfWeek(parseDate(s.planStart || isoDate(new Date())));
  const race = parseDate(s.raceDate);
  const raceWeekStart = startOfWeek(race);
  const totalWeeks = Math.round((raceWeekStart - anchor) / (7 * 86400000));
  if (totalWeeks < 0) return { weeks: [], totalWeeks: 0, anchor: isoDate(anchor), raceDate: s.raceDate, template };
  const taperStart = Math.max(1, totalWeeks - 2);
  const longBase = longRideBase(acts, isoDate(anchor));
  const weeks = [];
  let keyAlt = 0;
  for (let i = 0; i <= totalWeeks; i++) {
    const wtg = totalWeeks - i;
    const phase = phaseFor(wtg, totalWeeks);
    const recovery = phase !== 'taper' && phase !== 'race' && i % 4 === 3;
    const p = taperStart > 1 ? clamp(i / (taperStart - 1), 0, 1) : 1;
    const start = addDays(anchor, i * 7);
    const dates = Array.from({ length: 7 }, (_, d) => isoDate(addDays(start, d)));
    const weekStart = dates[0];
    const applies = i >= adjust.fromWeek;
    const intensityCap = applies ? adjust.intensityCap : null;
    let sessions = [];
    if (phase === 'race') {
      const g = s.planSource === 'goal' ? s.goal : null;
      const sports = g && g.type !== 'triathlon' ? new Set([g.type]) : new Set(template.map(t => ROLES[t.role].sport));
      sessions = raceWeek(dates, s, s.raceDate).filter(([, x]) => sports.has(x.sport) && (!x.brickOnly || !g || g.type === 'triathlon')).map(([dow, sess]) => ({ ...finalize(sess, s), dow, date: dates[dow], origDate: dates[dow], id: `${weekStart}-${dow}-${sess.sport}-${sess.kind}` }));
      const ri = dates.indexOf(s.raceDate);
      if (ri >= 0) sessions.push({ sport: 'brick', kind: 'race', title: s.raceName || 'Race day', min: Math.round((s.goalHours || 12) * 60), tss: 0, if: 0.7, key: true, dow: ri, date: s.raceDate, origDate: s.raceDate, id: `${weekStart}-race`,
        steps: raceSteps(s, arch) });
    } else {
      const taperMult = phase === 'taper' ? (wtg === 2 ? 0.85 : 0.7) : 1;
      const recMult = recovery ? 0.72 : 1;
      for (const t of template) {
        const R = ROLES[t.role];
        const vol = taperMult * recMult * (t.vol ?? 1) * (applies ? adjust.factor * (focus[R.sport] || 1) : 1);
        const ctx = { s, phase, p, easyOnly: recovery || intensityCap === 'easy', vol, keyAlt, wtg, longBase, pk: arch?.pk };
        const sess = finalize(R.build(ctx), s);
        if (phase === 'taper') sess.title = sess.title + ' (taper)';
        sess.role = t.role; sess.dow = t.dow; sess.date = dates[t.dow]; sess.origDate = dates[t.dow];
        sess.id = `${weekStart}-${t.dow}-${t.role}`;
        sess.ref = refInfo(refFor(acts, R.sport, t.dow, t.role, weekStart));
        sessions.push(sess);
      }
      if (phase === 'build' || phase === 'peak') keyAlt++;
    }
    sessions.sort((a, b) => a.date.localeCompare(b.date));
    const plannedMin = sessions.reduce((a, x) => a + (x.kind === 'race' ? 0 : x.min || 0), 0);
    weeks.push({ index: i, wtg, start: weekStart, end: dates[6], dates, phase, recovery, hours: round(plannedMin / 60, 2), sessions,
      plannedLoad: sessions.reduce((a, x) => a + (x.tss || 0), 0), plannedMin });
  }
  return { weeks, totalWeeks, anchor: isoDate(anchor), raceDate: s.raceDate, zones: zones(s), template, longBase,
    baseHours: weeks[0] ? weeks[0].hours : 0 };
}

function raceSteps(s, arch) {
  const g = s.planSource === 'goal' ? s.goal : null;
  if (g && g.type !== 'triathlon') {
    const what = g.type === 'run' ? `Run ${g.runKm} km` : g.type === 'bike' ? `Ride ${g.bikeKm} km${g.bikeHm ? ' / ' + g.bikeHm + ' hm' : ''}` : `Swim ${g.swimM} m`;
    return [{ kind: 'steady', min: Math.round((s.goalHours || 3) * 60), zone: 3, target: g.type === 'swim' ? null : T.hr(3), text: `${what} — start controlled, even effort, fuel early` }];
  }
  if (g && g.tri && g.tri !== 'full') {
    const t = TRI[g.tri], H = (s.goalHours || 5) * 60;
    return [{ kind: 'steady', min: Math.round(H * 0.17), zone: 3, text: `Swim ${t.swim} m — strong but controlled` }, { kind: 'steady', min: Math.round(H * 0.5), zone: 3, target: T.hr(3), text: `Bike ${t.bike} km — even effort, eat and drink` }, { kind: 'steady', min: Math.round(H * 0.33), zone: 3, target: T.hr(3), text: `Run ${t.run} km — settle in, push the second half` }];
  }
  return [{ kind: 'steady', min: 90, zone: 2, text: 'Swim 3.8 km — calm, steady rhythm, sight every 6–8 strokes' }, { kind: 'steady', min: 390, zone: 2, target: s.outdoorPower ? T.power(0.68, 0.75) : T.hr(2), text: 'Bike 180 km — hold back the first hour, eat every 20 min' }, { kind: 'steady', min: 300, zone: 2, target: T.hr(2), text: 'Run 42.2 km — run/walk from the start (9:1), walk every aid station' }];
}

// Typical long-ride length before the plan started (median of the weekly longest outdoor ride, last 8 weeks).
function longRideBase(acts, beforeIso) {
  const from = isoDate(addDays(parseDate(beforeIso), -56));
  const rides = acts.filter(a => a.sport === 'bike' && !a.indoor && a.date >= from && a.date < beforeIso);
  const byWeek = {};
  for (const a of rides) { const w = isoDate(startOfWeek(parseDate(a.date))); byWeek[w] = Math.max(byWeek[w] || 0, a.movingSec / 60); }
  const v = Object.values(byWeek).sort((a, b) => a - b);
  return v.length >= 2 ? Math.round(v[v.length >> 1]) : null;
}

function refFor(acts, sport, dow, role, beforeIso) {
  const from = isoDate(addDays(parseDate(beforeIso), -56));
  const c = acts.filter(a => a.sport === sport && a.date >= from && a.date < beforeIso);
  if (!c.length) return null;
  if (role.endsWith('long')) return [...c].sort((a, b) => b.movingSec - a.movingSec || b.date.localeCompare(a.date))[0];
  const same = c.filter(a => dowOf(a.date) === dow).sort((a, b) => b.date.localeCompare(a.date));
  return same[0] || null;
}

export { scaleVolume };
export function weekForDate(plan, iso) { return plan.weeks.find(w => iso >= w.start && iso <= w.end) || null; }
export function sessionsOn(plan, iso) { const w = weekForDate(plan, iso); return w ? w.sessions.filter(x => x.date === iso) : []; }
