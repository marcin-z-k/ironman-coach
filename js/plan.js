// Periodised sub-12 Ironman plan generator.
// Deterministic from settings (race date, thresholds, weekly hours, anchor date) plus an
// adjustment factor from the adaptation engine applied to current/future weeks.
import { isoDate, addDays, startOfWeek, parseDate, paceToStr, clamp, round } from './util.js';

export const PHASES = {
  base:  { label: 'Base',  desc: 'Aerobic foundation, swim technique, sweet-spot strength on the bike.' },
  build: { label: 'Build', desc: 'Raise threshold: bike threshold/VO2, run threshold intervals, longer weekends.' },
  peak:  { label: 'Peak',  desc: 'Race-specific: Ironman power & pace blocks, long bricks, nutrition rehearsal.' },
  taper: { label: 'Taper', desc: 'Volume drops, intensity stays sharp. Arrive fresh.' },
  race:  { label: 'Race week', desc: 'Short openers, rest, then race day.' },
};

export function zones(s) {
  const T = s.runThreshold, F = s.ftp, C = s.css;
  const w = (lo, hi) => `${Math.round(F * lo)}–${Math.round(F * hi)} W`;
  const p = (lo, hi) => `${paceToStr(T * hi)}–${paceToStr(T * lo)}/km`;
  const sw = (lo, hi) => `${paceToStr(C + lo)}–${paceToStr(C + hi)}/100m`;
  return {
    bike: { z1: w(0.45, 0.55), z2: w(0.56, 0.75), z3: w(0.76, 0.87), ss: w(0.88, 0.94), z4: w(0.95, 1.05), z5: w(1.06, 1.2), im: w(0.70, 0.76), imW: Math.round(F * 0.73) },
    run: { easy: p(1.18, 1.32), steady: p(1.08, 1.14), im: p(1.13, 1.18), thr: p(0.98, 1.02), vo2: p(0.91, 0.95), imPace: Math.round(T * 1.155), easyPace: Math.round(T * 1.25) },
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

export function generatePlan(s, adjust = { factor: 1, fromWeek: 0, intensityCap: null }) {
  const anchor = startOfWeek(parseDate(s.planStart || isoDate(new Date())));
  const race = parseDate(s.raceDate);
  const raceWeekStart = startOfWeek(race);
  const totalWeeks = Math.round((raceWeekStart - anchor) / (7 * 86400000));
  if (totalWeeks < 0) return { weeks: [], totalWeeks: 0, anchor: isoDate(anchor), raceDate: s.raceDate };

  const taperStart = Math.max(1, totalWeeks - 2);
  const H0 = s.weeklyHours || 9.5;
  const cap = clamp(H0 * 1.5, H0, 15);
  const z = zones(s);
  const weeks = [];
  let keyAlt = 0;

  for (let i = 0; i <= totalWeeks; i++) {
    const wtg = totalWeeks - i;
    const phase = phaseFor(wtg, totalWeeks);
    const recovery = phase !== 'taper' && phase !== 'race' && i % 4 === 3;
    const prog = taperStart > 1 ? clamp(i / (taperStart - 1), 0, 1) : 1;
    let hours = Math.min(cap, H0 * (1 + 0.45 * prog));
    if (recovery) hours *= 0.65;
    if (phase === 'taper') hours = (wtg === 2 ? 0.65 : 0.5) * Math.min(cap, H0 * 1.45);
    if (phase === 'race') hours = 0.3 * H0;
    if (i >= adjust.fromWeek) hours *= adjust.factor;
    hours = round(hours, 2);

    const start = addDays(anchor, i * 7);
    const dates = Array.from({ length: 7 }, (_, d) => isoDate(addDays(start, d)));
    const intensityCap = i >= adjust.fromWeek ? adjust.intensityCap : null;
    const sessions = buildWeek({ s, z, phase, recovery, hours, dates, keyAlt, wtg, intensityCap, raceDate: s.raceDate });
    if (phase === 'build' || phase === 'peak') keyAlt++;
    weeks.push({ index: i, wtg, start: dates[0], end: dates[6], dates, phase, recovery, hours, sessions,
      plannedLoad: sessions.reduce((a, x) => a + (x.tss || 0), 0), plannedMin: sessions.reduce((a, x) => a + (x.min || 0), 0) });
  }
  return { weeks, totalWeeks, anchor: isoDate(anchor), raceDate: s.raceDate, zones: z };
}

function buildWeek({ s, z, phase, recovery, hours, dates, keyAlt, wtg, intensityCap, raceDate }) {
  const total = hours * 60;
  const split = phase === 'base' ? { swim: .19, bike: .49, run: .32 } : { swim: .16, bike: .52, run: .32 };
  const S = total * split.swim, B = total * split.bike, R = total * split.run;
  const easyOnly = recovery || intensityCap === 'easy';
  const out = [];
  const push = (dayIdx, sess) => { if (sess && sess.min >= 15) out.push({ ...sess, date: dates[dayIdx], id: `${dates[dayIdx]}-${sess.sport}-${sess.kind}` }); };

  if (phase === 'race') {
    push(0, swim('easy', 30, z, s));
    push(1, bike('openers', 45, z, s));
    push(2, run('strides', 30, z, s));
    push(3, swim('openers', 20, z, s));
    push(4, bike('openers', 30, z, s));
    const raceIdx = dates.indexOf(raceDate);
    if (raceIdx >= 0) out.push({ sport: 'brick', kind: 'race', title: s.raceName || 'Race day', min: Math.round((s.goalHours || 12) * 60), tss: 0, if: 0.7, key: true, date: dates[raceIdx], id: `${dates[raceIdx]}-race`,
      steps: [{ min: 75, zone: 2, text: `Swim 3.8 km — relaxed, ~${paceToStr(z.swim.imPace)}/100m` }, { min: 360, zone: 2, text: `Bike 180 km — hold ${z.bike.imW} W (${z.bike.im}), eat every 20 min` }, { min: 250, zone: 2, text: `Run 42.2 km — start at ${paceToStr(z.run.imPace)}/km, walk aid stations if needed` }] });
    return out;
  }

  // Long-day orientation: default Sat long bike / Sun long run. Flip if user prefers.
  const flip = (s.longBikeDay === 0 && s.longRunDay === 6);
  const SAT = flip ? 6 : 5, SUN = flip ? 5 : 6;

  // Monday — swim endurance/technique
  push(0, swim(phase === 'base' ? 'technique' : 'endurance', S * 0.40, z, s));
  // Tuesday — bike key
  let bikeKey = 'sweetspot';
  if (phase === 'build') bikeKey = keyAlt % 2 ? 'vo2' : 'threshold';
  if (phase === 'peak') bikeKey = 'racepower';
  if (phase === 'taper') bikeKey = 'openers';
  push(1, bike(easyOnly ? 'endurance' : bikeKey, B * 0.25, z, s, true));
  // Wednesday — run key + swim
  let runKey = 'tempo';
  if (phase === 'build') runKey = 'threshold';
  if (phase === 'peak') runKey = 'impace';
  if (phase === 'taper') runKey = 'strides';
  push(2, run(easyOnly ? 'easy' : runKey, R * 0.35, z, s, true));
  push(2, swim('endurance', S * 0.30, z, s));
  // Thursday — bike endurance (+tempo in build/peak)
  push(3, bike(!easyOnly && (phase === 'build' || phase === 'peak') ? 'tempo' : 'endurance', B * 0.20, z, s));
  // Friday — swim key + easy run
  push(4, swim(easyOnly ? 'endurance' : 'css', S * 0.30, z, s, true));
  push(4, run('easy', R * 0.20, z, s));
  // Saturday — long bike (+ brick)
  const brick = !easyOnly && phase !== 'base';
  push(SAT, bike(easyOnly ? 'long' : (phase === 'peak' ? 'longim' : phase === 'build' ? 'longss' : 'long'), B * 0.55, z, s, true));
  if (brick) push(SAT, run('brick', R * 0.10, z, s));
  // Sunday — long run
  push(SUN, run(easyOnly ? 'longeasy' : (phase === 'peak' ? 'longim' : phase === 'build' ? 'longfinish' : 'longeasy'), R * (brick ? 0.35 : 0.45), z, s, true));
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---- session builders -------------------------------------------------------
function sess(sport, kind, title, min, IF, steps, key = false, note = '') {
  min = Math.round(min);
  steps = steps.filter(x => x.min > 0).map(x => ({ ...x, min: Math.round(x.min) }));
  return { sport, kind, title, min, if: IF, tss: Math.round((min / 60) * IF * IF * 100), steps, key, note };
}
function fill(min, wu, cd, work, rest, minReps = 2, maxReps = 12) {
  const main = Math.max(0, min - wu - cd);
  const reps = clamp(Math.floor(main / (work + rest)), minReps, maxReps);
  const used = wu + cd + reps * (work + rest);
  const easyExtra = Math.max(0, min - used);
  return { reps, easyExtra };
}

function bike(kind, min, z, s, key = false) {
  const F = s.ftp;
  const W = (lo, hi) => `${Math.round(F * lo)}–${Math.round(F * hi)} W`;
  switch (kind) {
    case 'endurance':
      return sess('bike', kind, 'Endurance ride', min, 0.65, [
        { min: 10, zone: 1, text: 'Easy spin to warm up' },
        { min: min - 15, zone: 2, text: `Steady Z2, ${z.bike.z2}. Smooth cadence 85–95.` },
        { min: 5, zone: 1, text: 'Easy spin' }], key);
    case 'tempo': {
      const main = Math.max(20, min - 25);
      return sess('bike', kind, 'Tempo ride', min, 0.78, [
        { min: 15, zone: 1, text: 'Warm up, build to Z2' },
        { min: main, zone: 3, text: `Continuous tempo, ${z.bike.z3}. Stay aero.` },
        { min: 10, zone: 1, text: 'Easy spin' }], key);
    }
    case 'sweetspot': {
      const { reps, easyExtra } = fill(min, 15, 10, 12, 4, 2, 5);
      return sess('bike', kind, `Sweet spot ${reps}×12 min`, min, 0.84, [
        { min: 15, zone: 1, text: 'Warm up, include 3×1 min fast cadence' },
        ...Array.from({ length: reps }, () => ({ min: 12, zone: 4, text: `12 min @ ${z.bike.ss} (88–94% FTP)`, rest: 4 })),
        { min: 10 + easyExtra, zone: 1, text: 'Cool down' }], key, 'Sweet spot builds FTP with manageable fatigue.');
    }
    case 'threshold': {
      const { reps, easyExtra } = fill(min, 15, 10, 10, 5, 2, 4);
      return sess('bike', kind, `Threshold ${reps}×10 min`, min, 0.88, [
        { min: 15, zone: 1, text: 'Warm up, 2×2 min at threshold' },
        ...Array.from({ length: reps }, () => ({ min: 10, zone: 4, text: `10 min @ ${z.bike.z4} (95–105% FTP)`, rest: 5 })),
        { min: 10 + easyExtra, zone: 1, text: 'Cool down' }], key, 'Raises FTP directly — the limiter for a sub-12 bike split.');
    }
    case 'vo2': {
      const { reps, easyExtra } = fill(min, 15, 10, 4, 4, 4, 6);
      return sess('bike', kind, `VO2max ${reps}×4 min`, min, 0.9, [
        { min: 15, zone: 1, text: 'Warm up progressively' },
        ...Array.from({ length: reps }, () => ({ min: 4, zone: 5, text: `4 min @ ${z.bike.z5} (106–120% FTP)`, rest: 4 })),
        { min: 10 + easyExtra, zone: 1, text: 'Cool down' }], key);
    }
    case 'racepower': {
      const { reps, easyExtra } = fill(min, 15, 10, 20, 5, 2, 3);
      return sess('bike', kind, `Race power ${reps}×20 min`, min, 0.8, [
        { min: 15, zone: 1, text: 'Warm up' },
        ...Array.from({ length: reps }, () => ({ min: 20, zone: 3, text: `20 min @ ${z.bike.im} — Ironman power, aero position, practice fuelling`, rest: 5 })),
        { min: 10 + easyExtra, zone: 1, text: 'Cool down' }], key);
    }
    case 'long':
      return sess('bike', kind, 'Long ride', min, 0.67, [
        { min: 15, zone: 1, text: 'Easy start' },
        { min: min - 25, zone: 2, text: `Z2 ${z.bike.z2}. Eat 60–90 g carbs/h, drink to thirst.` },
        { min: 10, zone: 1, text: 'Easy finish' }], key, 'Durability first — the long ride is the backbone of Ironman training.');
    case 'longss': {
      const reps = min >= 180 ? 3 : 2;
      return sess('bike', kind, `Long ride + ${reps}×20 sweet spot`, min, 0.72, [
        { min: 20, zone: 1, text: 'Easy start' },
        { min: Math.round((min - 30 - reps * 30) / 2), zone: 2, text: `Z2 ${z.bike.z2}` },
        ...Array.from({ length: reps }, () => ({ min: 20, zone: 4, text: `20 min @ ${z.bike.ss}`, rest: 10 })),
        { min: Math.round((min - 30 - reps * 30) / 2), zone: 2, text: `Z2 ${z.bike.z2}, stay fuelled` },
        { min: 10, zone: 1, text: 'Easy finish' }], key);
    }
    case 'longim': {
      const block = Math.round((min - 40) / 3);
      return sess('bike', kind, 'Long ride — Ironman power', min, 0.74, [
        { min: 20, zone: 1, text: 'Easy start' },
        { min: block, zone: 3, text: `${z.bike.im} (IM power), aero` , rest: 10 },
        { min: block, zone: 3, text: `${z.bike.im} (IM power), practice race nutrition`, rest: 10 },
        { min: block - 20, zone: 3, text: `${z.bike.im} — hold form when tired` },
        { min: 10, zone: 1, text: 'Easy finish' }], key, 'Rehearse race power, position and fuelling.');
    }
    case 'openers':
      return sess('bike', kind, 'Openers', min, 0.7, [
        { min: 15, zone: 1, text: 'Easy spin' },
        { min: 3, zone: 4, text: `3 min @ ${z.bike.z4}`, rest: 3 },
        { min: 3, zone: 4, text: `3 min @ ${z.bike.z4}`, rest: 3 },
        { min: 1, zone: 5, text: `1 min @ ${W(1.1, 1.2)}` },
        { min: Math.max(5, min - 28), zone: 1, text: 'Easy spin home' }], key);
    default: return bike('endurance', min, z, s, key);
  }
}

function run(kind, min, z, s, key = false) {
  const T = s.runThreshold;
  const P = f => paceToStr(T * f);
  switch (kind) {
    case 'easy':
      return sess('run', kind, 'Easy run', min, 0.65, [{ min, zone: 2, text: `Conversational, ${z.run.easy}. Form over speed.` }], key);
    case 'tempo': {
      const main = clamp(Math.round(min * 0.45), 15, 35);
      return sess('run', kind, `Tempo run ${main} min`, min, 0.8, [
        { min: 15, zone: 1, text: `Warm up ${z.run.easy}` },
        { min: main, zone: 3, text: `Tempo ${z.run.steady}` },
        { min: Math.max(5, min - 15 - main), zone: 1, text: 'Cool down' }], key);
    }
    case 'threshold': {
      const { reps, easyExtra } = fill(min, 15, 10, 6, 2, 3, 6);
      return sess('run', kind, `Threshold ${reps}×6 min`, min, 0.87, [
        { min: 15, zone: 1, text: 'Warm up + 4 strides' },
        ...Array.from({ length: reps }, () => ({ min: 6, zone: 4, text: `6 min @ ${z.run.thr} (threshold)`, rest: 2 })),
        { min: 10 + easyExtra, zone: 1, text: 'Cool down' }], key, 'Pushes threshold pace down — the lever for the marathon split.');
    }
    case 'impace': {
      const { reps, easyExtra } = fill(min, 15, 10, 15, 3, 2, 3);
      return sess('run', kind, `Ironman pace ${reps}×15 min`, min, 0.78, [
        { min: 15, zone: 1, text: 'Warm up' },
        ...Array.from({ length: reps }, () => ({ min: 15, zone: 3, text: `15 min @ ${z.run.im} (IM pace)`, rest: 3 })),
        { min: 10 + easyExtra, zone: 1, text: 'Cool down' }], key);
    }
    case 'brick':
      return sess('run', kind, 'Brick run', min, 0.75, [{ min, zone: 3, text: `Straight off the bike: settle into ${z.run.im} within 1 km.` }], key, 'Teaches your legs to run on bike fatigue.');
    case 'longeasy':
      return sess('run', kind, 'Long run', min, 0.68, [{ min, zone: 2, text: `${z.run.easy}. Fuel every 30 min like race day.` }], key);
    case 'longfinish': {
      const fin = clamp(Math.round(min * 0.25), 15, 30);
      return sess('run', kind, `Long run, fast finish ${fin} min`, min, 0.72, [
        { min: min - fin - 5, zone: 2, text: `${z.run.easy}` },
        { min: fin, zone: 3, text: `Finish at ${z.run.im} (IM pace)` },
        { min: 5, zone: 1, text: 'Walk/jog' }], key);
    }
    case 'longim': {
      const blk = clamp(Math.round(min * 0.25), 20, 40);
      return sess('run', kind, `Long run 2×${blk} min IM pace`, min, 0.74, [
        { min: 15, zone: 2, text: 'Easy start' },
        { min: blk, zone: 3, text: `${z.run.im} (IM pace)`, rest: 5 },
        { min: Math.max(0, min - 25 - 2 * blk), zone: 2, text: 'Easy' },
        { min: blk, zone: 3, text: `${z.run.im} (IM pace), race nutrition` },
        { min: 5, zone: 1, text: 'Walk/jog' }], key);
    }
    case 'strides':
      return sess('run', kind, 'Easy run + strides', min, 0.68, [
        { min: min - 8, zone: 2, text: `${z.run.easy}` },
        { min: 8, zone: 4, text: `6×20 s strides @ ~${P(0.9)}/km, walk back` }], key);
    default: return run('easy', min, z, s, key);
  }
}

function swim(kind, min, z, s, key = false) {
  const C = s.css;
  const m100 = f => Math.round(min * 60 / (C + f)); // metres possible at pace in session
  switch (kind) {
    case 'technique':
      return sess('swim', kind, 'Technique swim', min, 0.6, [
        { min: Math.round(min * .25), zone: 1, text: '400 easy swim + 4×50 drill (catch-up, fist, 6-1-6)' },
        { min: Math.round(min * .55), zone: 2, text: `Main: 8×100 as 25 drill / 75 swim, ${z.swim.easy}; 15 s rest` },
        { min: Math.round(min * .20), zone: 1, text: '200 easy, focus on long exhale' }], key);
    case 'endurance':
      return sess('swim', kind, 'Aerobic swim', min, 0.68, [
        { min: Math.round(min * .2), zone: 1, text: '300 easy + 4×50 build' },
        { min: Math.round(min * .65), zone: 2, text: `Main: 3×400 (or 6×200) @ ${z.swim.im} (IM pace), 20 s rest — bilateral breathing` },
        { min: Math.round(min * .15), zone: 1, text: '200 easy' }], key);
    case 'css': {
      const reps = clamp(Math.round((min - 15) * 60 / (C + 15)), 8, 20);
      return sess('swim', kind, `CSS ${reps}×100`, min, 0.8, [
        { min: 10, zone: 1, text: '400 easy + 4×50 build' },
        { min: min - 15, zone: 4, text: `${reps}×100 @ ${z.swim.css} (CSS), 15 s rest. Even splits.` },
        { min: 5, zone: 1, text: '200 easy' }], key, 'CSS sets move your threshold pace.');
    }
    case 'openers':
      return sess('swim', kind, 'Swim openers', min, 0.65, [{ min, zone: 2, text: `400 easy, 4×50 fast @ ${z.swim.fast}, 200 easy` }], key);
    case 'easy':
    default:
      return sess('swim', kind, 'Easy swim', min, 0.6, [{ min, zone: 1, text: `Continuous easy, ${z.swim.easy}; ~${m100(10)} m` }], key);
  }
}

// --- helpers used by the UI ---------------------------------------------------
export function weekForDate(plan, iso) { return plan.weeks.find(w => iso >= w.start && iso <= w.end) || null; }
export function sessionsOn(plan, iso) { const w = weekForDate(plan, iso); return w ? w.sessions.filter(x => x.date === iso) : []; }
