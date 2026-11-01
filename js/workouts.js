// Structured workouts built around the athlete's goals:
//  swim  – swim 3.8–4 km continuously without form breaking down (left shoulder), technique first
//  run   – (1) lower easy pace from 7:00–7:30 to 5:30–7:00/km at Z2 HR (priority), (2) be able to run 42 km
//  bike  – raise sustainable average power over long distances
// Steps: { kind: 'wu'|'work'|'rec'|'cd'|'steady'|'drill'|'walk', min?, dist?, zone, target?, text, label? }
// Blocks: { repeat: n, steps: [...] }
import { paceToStr, round, clamp } from './util.js';
import { hrRangeStr } from './zones.js';

const ZIF = [0, 0.55, 0.68, 0.8, 0.92, 1.05];
const lerp = (a, b, p) => a + (b - a) * p;
const r5 = v => Math.max(5, Math.round(v / 5) * 5);
const r100 = v => Math.max(100, Math.round(v / 100) * 100);

export const T = {
  power: (lo, hi) => ({ type: 'power', lo, hi }),
  hr: (zone) => ({ type: 'hr', zone }),
  pace: (lo, hi) => ({ type: 'pace', lo, hi }),        // multipliers of run threshold sec/km (lo = faster)
  swim: (lo, hi) => ({ type: 'swim', lo, hi }),        // seconds relative to CSS per 100 m
};

export function ftpFor(s, indoor) { return indoor ? s.ftp : (s.ftpOutdoor || s.ftp); }

export function flatten(steps) {
  const out = [];
  for (const st of steps || []) {
    if (st.repeat) for (let i = 0; i < st.repeat; i++) out.push(...flatten(st.steps));
    else out.push(st);
  }
  return out;
}

function swimMin(st, s) {
  const off = st.zone <= 1 ? 16 : st.zone === 2 ? 9 : st.zone === 3 ? 4 : 0;
  return (st.dist / 100) * (s.css + off) / 60 * (st.kind === 'drill' ? 1.25 : 1.08);
}
export function stepMin(st, s) { return st.min != null ? st.min : st.dist ? swimMin(st, s) : 0; }

export function describeTarget(t, ctx) {
  if (!t) return '';
  const { s, sport, indoor } = ctx;
  if (t.type === 'power') { const F = ftpFor(s, indoor); return `${Math.round(F * t.lo)}–${Math.round(F * t.hi)} W`; }
  if (t.type === 'hr') { const r = hrRangeStr(sport === 'brick' ? 'run' : sport, t.zone); return r ? `HR Z${t.zone} ${r}` : `HR Z${t.zone}`; }
  if (t.type === 'pace') return `${paceToStr(s.runThreshold * t.lo)}–${paceToStr(s.runThreshold * t.hi)}/km`;
  if (t.type === 'swim') return `${paceToStr(s.css + t.lo)}–${paceToStr(s.css + t.hi)}/100m`;
  return '';
}

// Finalise a session: totals, load, intensity.
export function finalize(sess, s) {
  const flat = flatten(sess.steps);
  let min = 0, tss = 0, dist = 0;
  for (const st of flat) { const m = stepMin(st, s); min += m; tss += (m / 60) * ZIF[st.zone || 2] ** 2 * 100; if (st.dist) dist += st.dist; }
  sess.min = Math.round(min);
  sess.tss = Math.round(tss);
  sess.if = min ? round(Math.sqrt(tss / (min / 60) / 100), 2) : 0.6;
  if (dist) sess.dist = dist;
  return sess;
}

// Scale a session's volume without changing its intensity: stretch the steady/easy parts (or swim main set).
export function scaleVolume(sess, factor, s) {
  if (Math.abs(factor - 1) < 0.01) return sess;
  const before = sess.min;
  const scaleable = (st) => !st.repeat && (st.kind === 'steady' || st.kind === 'cd' || st.kind === 'wu');
  const target = sess.steps.filter(scaleable);
  const main = target.sort((a, b) => stepMin(b, s) - stepMin(a, s))[0];
  if (!main) return sess;
  const extra = before * (factor - 1);
  if (main.dist) main.dist = r100(main.dist + extra / (stepMin(main, s) / main.dist));
  else main.min = Math.max(5, Math.round(main.min + extra));
  return finalize(sess, s);
}

// ---------------------------------------------------------------- builders
// ctx: { s, phase, p (0..1 progression), easyOnly, vol (volume multiplier), keyAlt, wtg }

export function swimTechnique(c) {
  const { phase, p, easyOnly, vol } = c; const pk = c.pk || {};
  const D = r100(lerp(pk.swimStart ?? 2000, pk.swimTechMax ?? 3000, p) * vol);
  const mainRep = phase === 'base' || easyOnly ? 200 : phase === 'build' ? 300 : 400;
  const mainDist = Math.max(400, D - 300 - 300 - 200);
  const reps = Math.max(2, Math.round(mainDist / mainRep));
  return {
    sport: 'swim', kind: 'technique', title: `Technique swim ${(D / 1000).toFixed(1)} km`, key: false,
    focus: 'Form that lasts: long relaxed strokes, high-elbow catch, no crossover on the left arm.',
    note: 'No paddles while the left shoulder is sensitive. Sharp pain = stop the set; a dull ache that worsens across sessions needs a physio check.',
    steps: [
      { kind: 'wu', dist: 300, zone: 1, target: T.swim(12, 20), text: 'Easy swim, mix in backstroke to open the shoulders' },
      { repeat: 6, steps: [{ kind: 'drill', dist: 50, zone: 1, text: 'Drill: catch-up / fingertip drag / 6-1-6 side kick (rotate)' }] },
      { repeat: reps, steps: [{ kind: 'work', dist: mainRep, zone: 2, target: T.swim(6, 10), text: `${mainRep} m relaxed, bilateral breathing, count strokes per length — keep the count stable` }] },
      { kind: 'cd', dist: 200, zone: 1, text: 'Easy, long glide' },
    ],
  };
}

export function swimEndurance(c) {
  const { phase, p, easyOnly, vol } = c;
  const pk = c.pk || {};
  const D = r100(lerp(pk.swimStart ?? 2000, pk.swimMax ?? 4200, p) * vol);
  let cont = r100(lerp(pk.contStart ?? 600, pk.swimCont ?? 3800, Math.pow(p, 1.1)) * (easyOnly ? 0.8 : 1));
  cont = Math.max(300, Math.min(cont, D - 400));
  const rest = Math.max(0, D - 300 - cont - 200);
  const steps = [
    { kind: 'wu', dist: 300, zone: 1, target: T.swim(12, 20), text: 'Easy, 4×25 build in the last 100' },
    { kind: 'steady', dist: cont, zone: 2, target: T.swim(7, 12), text: `${cont} m CONTINUOUS at steady effort. If the stroke shortens or the shoulder hurts: stop 20 s at the wall, reset, continue` },
  ];
  if (rest >= 200) steps.push({ repeat: Math.max(1, Math.round(rest / 200)), steps: [{ kind: 'work', dist: 200, zone: phase === 'peak' ? 3 : 2, target: phase === 'peak' ? T.swim(3, 6) : T.swim(6, 10), text: '200 m with perfect form, 20 s rest' }] });
  steps.push({ kind: 'cd', dist: 200, zone: 1, text: 'Easy' });
  return {
    sport: 'swim', kind: 'endurance', title: `Continuous swim ${(cont / 1000).toFixed(1)} km`, key: true,
    focus: `Build the distance you can swim without stopping: ${cont} m this week, ${((pk.swimCont ?? 3800) / 1000).toFixed(1)} km by race peak.`,
    note: 'Pace is secondary — the goal is the same stroke at minute 50 as at minute 5.',
    steps,
  };
}

export function runIntervals(c) {
  const { phase, p, easyOnly, vol, keyAlt } = c; const pk = c.pk || {};
  const total = r5(lerp(pk.intStart ?? 60, pk.intMax ?? 70, p) * vol);
  if (easyOnly) return { sport: 'run', kind: 'easy', title: 'Easy run + strides', key: false, focus: 'Recovery: keep HR in Z2.', steps: [
    { kind: 'steady', min: total - 6, zone: 2, target: T.hr(2), text: 'Easy, conversational' },
    { repeat: 6, steps: [{ kind: 'work', min: 0.33, zone: 5, text: 'Stride 20 s, smooth & quick' }, { kind: 'rec', min: 0.67, zone: 1, text: 'Walk back' }] }] };
  let block, title, focus;
  if (phase === 'base') {
    const reps = clamp(Math.round((total - 25) / 5), 5, 8);
    block = { repeat: reps, steps: [{ kind: 'work', min: 3, zone: 4, target: T.pace(0.98, 1.04), text: '3 min strong (threshold pace)' }, { kind: 'rec', min: 2, zone: 1, target: T.hr(1), text: '2 min easy jog' }] };
    title = `Intervals ${reps}×3 min`; focus = 'Faster running feels easier: raises the speed your easy pace sits under.';
  } else if (phase === 'build') {
    const reps = keyAlt % 2 ? clamp(Math.round((total - 25) / 8), 4, 5) : clamp(Math.round((total - 25) / 4), 6, 10);
    block = keyAlt % 2
      ? { repeat: reps, steps: [{ kind: 'work', min: 6, zone: 4, target: T.pace(0.98, 1.03), text: '6 min at threshold pace' }, { kind: 'rec', min: 2, zone: 1, target: T.hr(1), text: '2 min jog' }] }
      : { repeat: reps, steps: [{ kind: 'work', min: 2, zone: 5, target: T.pace(0.92, 0.96), text: '2 min hard (VO2)' }, { kind: 'rec', min: 2, zone: 1, target: T.hr(1), text: '2 min jog' }] };
    title = keyAlt % 2 ? `Threshold ${reps}×6 min` : `VO2 ${reps}×2 min`; focus = 'Raise threshold so your Z2 pace drops toward 5:30–7:00/km.';
  } else {
    block = { repeat: 2, steps: [{ kind: 'work', min: 15, zone: 3, target: T.hr(3), text: '15 min steady-strong (HR Z3)' }, { kind: 'rec', min: 3, zone: 1, text: '3 min easy' }] };
    title = 'Tempo 2×15 min'; focus = 'Race-specific aerobic strength.';
  }
  const blockMin = flatten([block]).reduce((a, x) => a + x.min, 0);
  return { sport: 'run', kind: 'intervals', title, key: true, focus, steps: [
    { kind: 'wu', min: 15, zone: 2, target: T.hr(2), text: 'Easy warm-up + 4 strides' },
    block,
    { kind: 'cd', min: Math.max(5, total - 15 - blockMin), zone: 2, target: T.hr(2), text: 'Easy cool-down' }] };
}

export function runBrick(c) {
  const { phase, p, easyOnly, vol } = c;
  const pk = c.pk || {};
  const total = r5(lerp(pk.brickStart ?? 30, pk.brickMax ?? 40, p) * vol);
  const z3 = !easyOnly && (phase === 'build' || phase === 'peak') ? 10 : 0;
  const steps = [{ kind: 'steady', min: total - z3, zone: 2, target: T.hr(2), text: 'Straight off the bike (<3 min transition). Short quick steps for the first km, settle into Z2' }];
  if (z3) steps.push({ kind: 'work', min: z3, zone: 3, target: T.hr(3), text: 'Last 10 min at race rhythm (HR Z3)' });
  return { sport: 'run', kind: 'brick', title: `Brick run ${total} min`, key: false, focus: 'Running on tired legs — the Ironman marathon starts like this.', steps };
}

export function runLong(c) {
  const { phase, p, easyOnly, vol } = c;
  const pk = c.pk || {};
  let total = r5(Math.min(pk.runLongMax ?? 180, lerp(Math.min(pk.runLongStart ?? 90, pk.runLongMax ?? 180), pk.runLongMax ?? 180, Math.pow(p, 0.9)) * vol * (easyOnly ? 0.85 : 1)));
  const runWalkFrom = pk.runWalkFrom ?? 150;
  const steps = [];
  let title;
  if (total <= runWalkFrom) {
    if (phase === 'peak' && !easyOnly) {
      const mid = 20;
      steps.push({ kind: 'steady', min: total - 2 * mid - 10, zone: 2, target: T.hr(2), text: 'Easy, HR capped at top of Z2. Walk hills if needed to stay under the cap' });
      steps.push({ repeat: 2, steps: [{ kind: 'work', min: mid, zone: 3, target: T.hr(3), text: '20 min Ironman effort (low Z3)' }, { kind: 'rec', min: 5, zone: 2, target: T.hr(2), text: '5 min easy' }] });
    } else steps.push({ kind: 'steady', min: total, zone: 2, target: T.hr(2), text: 'Easy, HR capped at top of Z2. Walk up steep hills to stay under the cap — time on feet is the goal' });
    title = `Long run ${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`;
  } else {
    const cycles = Math.round(total / 10);
    steps.push({ kind: 'steady', min: 20, zone: 2, target: T.hr(2), text: 'Easy start' });
    steps.push({ repeat: cycles - 2, steps: [{ kind: 'work', min: 9, zone: 2, target: T.hr(2), text: 'Run 9 min, Z2' }, { kind: 'walk', min: 1, zone: 1, text: 'Walk 1 min (eat/drink)' }] });
    title = `Long run/walk ${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`;
  }
  return { sport: 'run', kind: 'long', title, key: true,
    focus: total > runWalkFrom ? 'Race-day strategy rehearsal: 9 min run / 1 min walk keeps you running to 42 km.' : 'Time on feet at low HR — builds the endurance to run 42 km and pulls your easy pace down.',
    note: 'Fuel every 30 min (30–60 g carbs). Same shoes and gels you plan to race with.', steps };
}

export function bikePower(c) {
  const { phase, p, easyOnly, vol, keyAlt, s } = c; const pk = c.pk || {};
  const total = r5(lerp(pk.powerStart ?? 60, pk.powerMax ?? 75, p) * vol);
  const indoor = true;
  if (easyOnly) return { sport: 'bike', kind: 'endurance', indoor, title: 'Endurance ride (indoor)', key: false, focus: 'Recovery spin.', steps: [
    { kind: 'wu', min: 10, zone: 1, target: T.power(0.45, 0.55), text: 'Easy spin' },
    { kind: 'steady', min: total - 15, zone: 2, target: T.power(0.62, 0.72), text: 'Steady Z2, cadence 85–95' },
    { kind: 'cd', min: 5, zone: 1, target: T.power(0.45, 0.55), text: 'Easy' }] };
  let block, title;
  if (phase === 'base') {
    const len = p < 0.15 ? 12 : 15; const reps = clamp(Math.floor((total - 20) / (len + 4)), 2, 4);
    block = { repeat: reps, steps: [{ kind: 'work', min: len, zone: 4, target: T.power(0.88, 0.94), text: `${len} min sweet spot, seated, steady cadence` }, { kind: 'rec', min: 4, zone: 1, target: T.power(0.5, 0.55), text: '4 min easy' }] };
    title = `Sweet spot ${reps}×${len} min`;
  } else if (phase === 'build') {
    if (keyAlt % 2) {
      const reps = clamp(Math.floor((total - 20) / 15), 2, 4);
      block = { repeat: reps, steps: [{ kind: 'work', min: 10, zone: 4, target: T.power(0.95, 1.0), text: '10 min at threshold' }, { kind: 'rec', min: 5, zone: 1, target: T.power(0.5, 0.55), text: '5 min easy' }] };
      title = `Threshold ${reps}×10 min`;
    } else {
      block = { repeat: 3, steps: [
        { kind: 'work', min: 2, zone: 4, target: T.power(0.93, 0.97), text: 'Under: 2 min at 95%' }, { kind: 'work', min: 1, zone: 5, target: T.power(1.03, 1.08), text: 'Over: 1 min at 105%' },
        { kind: 'work', min: 2, zone: 4, target: T.power(0.93, 0.97), text: 'Under' }, { kind: 'work', min: 1, zone: 5, target: T.power(1.03, 1.08), text: 'Over' },
        { kind: 'work', min: 2, zone: 4, target: T.power(0.93, 0.97), text: 'Under' }, { kind: 'work', min: 1, zone: 5, target: T.power(1.03, 1.08), text: 'Over' },
        { kind: 'rec', min: 5, zone: 1, target: T.power(0.5, 0.55), text: '5 min easy' }] };
      title = 'Over-unders 3×9 min';
    }
  } else {
    block = { repeat: 2, steps: [{ kind: 'work', min: 20, zone: 4, target: T.power(0.88, 0.93), text: '20 min upper sweet spot, aero position' }, { kind: 'rec', min: 5, zone: 1, target: T.power(0.5, 0.55), text: '5 min easy' }] };
    title = 'Sustained power 2×20 min';
  }
  const blockMin = flatten([block]).reduce((a, x) => a + x.min, 0);
  return { sport: 'bike', kind: 'power', indoor, title, key: true,
    focus: 'Raise the watts you can hold: sustained efforts just below threshold move your long-ride average up.',
    note: 'Indoor power uses your indoor (trainer) FTP.',
    steps: [
      { kind: 'wu', min: 10, zone: 2, target: T.power(0.5, 0.7), text: 'Progressive warm-up' },
      block,
      { kind: 'cd', min: Math.max(5, total - 10 - blockMin), zone: 1, target: T.power(0.45, 0.6), text: 'Easy spin' }] };
}

export function bikeLong(c) {
  const { phase, p, easyOnly, vol, s, longBase } = c;
  const pk = c.pk || {};
  if (s.indoorMode) return bikeLongIndoor(c);
  const indoor = false;
  const peak = pk.bikeLongMax ?? 330;
  const start = pk.bikeLongMax != null ? Math.min(Math.max(pk.bikeLongStart ?? 90, longBase || 0) || 120, peak) : Math.max(150, longBase || 180);
  const total = r5(lerp(start, peak, p) * vol * (easyOnly ? 0.75 : 1));
  const pw = s.outdoorPower; // power meter outdoors?
  const tz2 = pw ? T.power(0.62, 0.72) : T.hr(2);
  const tStrong = pw ? T.power(0.76, 0.85) : T.hr(3);
  const steps = [{ kind: 'wu', min: 20, zone: 1, target: pw ? T.power(0.5, 0.6) : T.hr(1), text: 'Easy start, spin up' }];
  let title;
  if (easyOnly) { steps.push({ kind: 'steady', min: total - 30, zone: 2, target: tz2, text: 'Steady Z2' }); title = 'Long ride (easy)'; }
  else {
    let [reps, len] = phase === 'base' ? [2, 20] : phase === 'build' ? [3, 30] : phase === 'peak' ? [3, 45] : [2, 15];
    if (pk.bikeLongMax != null) len = Math.max(10, Math.min(len, Math.floor((total - 40) / reps) - 10));
    const between = 10;
    const used = 20 + 10 + reps * (len + between);
    const pre = Math.max(10, Math.round((total - used) / 2));
    steps.push({ kind: 'steady', min: pre, zone: 2, target: tz2, text: 'Z2, eat every 20 min' });
    steps.push({ repeat: reps, steps: [{ kind: 'work', min: len, zone: 3, target: tStrong, text: `${len} min strong-steady${pw ? '' : ' (HR Z3, RPE 6/10)'}${pk.climbing ? ' — on climbs if possible, seated, 70–80 rpm' : ' — this is where average power grows'}` }, { kind: 'rec', min: between, zone: 2, target: tz2, text: `${between} min Z2` }] });
    steps.push({ kind: 'steady', min: Math.max(10, total - used - pre), zone: 2, target: tz2, text: 'Z2 to finish, keep eating' });
    title = `Long ride ${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')} + ${reps}×${len}`;
  }
  steps.push({ kind: 'cd', min: 10, zone: 1, target: pw ? T.power(0.45, 0.55) : T.hr(1), text: 'Easy spin home' });
  return { sport: 'bike', kind: 'long', indoor, title, key: true,
    focus: pk.climbing ? 'Climbing endurance: long steady efforts uphill, seated, smooth cadence.' : 'You already have the distance — now push the average up: strong-steady blocks inside the long ride.',
    note: `${pw ? '' : 'Outdoors without a power meter: ride by heart rate and feel, not estimated watts. '}60–90 g carbs per hour.`, steps };
}

// Indoor Trainer Mode: long ride on the trainer, capped at 3 h, more quality per minute (power targets, indoor FTP).
export function bikeLongIndoor(c) {
  const { phase, p, easyOnly, vol, longBase } = c;
  const pk = c.pk || {};
  const peak = Math.min(180, pk.bikeLongMax ?? 330);
  const start = Math.min(peak, Math.max(90, Math.min(longBase || 120, 150)));
  const total = Math.min(180, r5(lerp(start, peak, p) * vol * (easyOnly ? 0.75 : 1)));
  const steps = [{ kind: 'wu', min: 15, zone: 1, target: T.power(0.5, 0.65), text: 'Progressive warm-up' }];
  let title;
  if (easyOnly) { steps.push({ kind: 'steady', min: total - 25, zone: 2, target: T.power(0.62, 0.72), text: 'Steady Z2, cadence 85–95' }); title = `Indoor endurance ${fmtH(total)}`; }
  else {
    const [reps, len, lo, hi] = phase === 'base' ? [3, 20, 0.76, 0.84] : phase === 'build' ? [3, 30, 0.80, 0.88] : phase === 'peak' ? [3, 40, 0.72, 0.78] : [2, 15, 0.72, 0.78];
    const between = 8;
    const used = 15 + 10 + reps * (len + between);
    const pre = Math.max(10, Math.round((total - used) / 2));
    steps.push({ kind: 'steady', min: pre, zone: 2, target: T.power(0.65, 0.72), text: 'Z2, drink every 10 min (indoors you sweat more)' });
    steps.push({ repeat: reps, steps: [{ kind: 'work', min: len, zone: 3, target: T.power(lo, hi), text: `${len} min ${phase === 'peak' ? 'race power, aero position' : 'tempo / low sweet spot'}` }, { kind: 'rec', min: between, zone: 2, target: T.power(0.6, 0.68), text: `${between} min Z2` }] });
    steps.push({ kind: 'steady', min: Math.max(10, total - used - pre), zone: 2, target: T.power(0.65, 0.72), text: 'Z2 to finish' });
    title = `Indoor long ride ${fmtH(total)} + ${reps}×${len}`;
  }
  steps.push({ kind: 'cd', min: 10, zone: 1, target: T.power(0.45, 0.55), text: 'Easy spin' });
  return { sport: 'bike', kind: 'long', indoor: true, title, key: true,
    focus: 'Indoor long ride: capped at 3 h, so the blocks are a bit harder than outdoors — same training effect in less time.',
    note: 'Trainer mode (MyWhoosh). Fan on, 750 ml+ per hour, 60–90 g carbs per hour.', steps };
}
const fmtH = m => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;

// Extra builders for non-Ironman goals
export function runTempo(c) {
  const { phase, p, easyOnly, vol } = c; const pk = c.pk || {};
  const total = r5(lerp(45, pk.tempoMax ?? 60, p) * vol);
  if (easyOnly) return runEasy(c);
  const main = clamp(Math.round(total * (phase === 'base' ? 0.35 : 0.5)), 15, 40);
  return { sport: 'run', kind: 'tempo', title: `Tempo run ${main} min`, key: true, focus: 'Raise the pace you can hold comfortably-hard for long.', steps: [
    { kind: 'wu', min: 15, zone: 2, target: T.hr(2), text: 'Easy warm-up' },
    { kind: 'work', min: main, zone: 3, target: T.pace(1.04, 1.09), text: 'Steady tempo, controlled breathing' },
    { kind: 'cd', min: Math.max(5, total - 15 - main), zone: 2, target: T.hr(2), text: 'Easy' }] };
}
export function swimCss(c) {
  const { p, easyOnly, vol } = c; const pk = c.pk || {};
  const D = r100(lerp(pk.swimStart ?? 2000, (pk.swimMax ?? 3000) * 0.8, p) * vol);
  const reps = clamp(Math.round((D - 800) / 100), 6, 20);
  return { sport: 'swim', kind: 'css', title: `CSS ${reps}×100`, key: !easyOnly, focus: 'Threshold swim pace — the engine for every distance.', steps: [
    { kind: 'wu', dist: 400, zone: 1, text: 'Easy + 4×50 build' },
    { repeat: reps, steps: [{ kind: 'work', dist: 100, zone: easyOnly ? 2 : 4, target: easyOnly ? T.swim(6, 10) : T.swim(-1, 2), text: '100 m, 15 s rest, even splits' }] },
    { kind: 'cd', dist: 400, zone: 1, text: 'Easy' }] };
}
export function bikeHills(c) {
  const { phase, p, easyOnly, vol } = c; const pk = c.pk || {};
  const total = r5(lerp(60, pk.powerMax ?? 80, p) * vol);
  if (easyOnly) return bikeEasy(c);
  const len = phase === 'base' ? 6 : phase === 'build' ? 8 : 10, reps = clamp(Math.floor((total - 25) / (len + 4)), 3, 6);
  return { sport: 'bike', kind: 'hills', indoor: true, title: `Climbing ${reps}×${len} min`, key: true, focus: 'Sustained climbing power at low cadence.', steps: [
    { kind: 'wu', min: 15, zone: 2, target: T.power(0.5, 0.7), text: 'Progressive warm-up' },
    { repeat: reps, steps: [{ kind: 'work', min: len, zone: 4, target: T.power(0.88, 0.95), text: `${len} min seated climb, 65–75 rpm` }, { kind: 'rec', min: 4, zone: 1, target: T.power(0.5, 0.55), text: 'Easy' }] },
    { kind: 'cd', min: Math.max(5, total - 15 - reps * (len + 4)), zone: 1, target: T.power(0.45, 0.6), text: 'Easy' }] };
}

export function bikeEasy(c) {
  const total = r5(lerp(60, 75, c.p) * c.vol);
  return { sport: 'bike', kind: 'endurance', indoor: true, title: 'Endurance ride', key: false, focus: 'Aerobic volume.', steps: [{ kind: 'steady', min: total, zone: 2, target: T.power(0.62, 0.72), text: 'Steady Z2' }] };
}
export function runEasy(c) {
  const total = r5(lerp(40, 55, c.p) * c.vol);
  return { sport: 'run', kind: 'easy', title: 'Easy run', key: false, focus: 'Aerobic base at Z2 HR.', steps: [{ kind: 'steady', min: total, zone: 2, target: T.hr(2), text: 'Conversational, HR Z2' }] };
}

export const ROLES = {
  'swim-technique': { sport: 'swim', label: 'Swim – technique', build: swimTechnique },
  'swim-endurance': { sport: 'swim', label: 'Swim – continuous', build: swimEndurance },
  'run-intervals': { sport: 'run', label: 'Run – intervals', build: runIntervals },
  'run-long': { sport: 'run', label: 'Run – long', build: runLong },
  'run-easy': { sport: 'run', label: 'Run – easy', build: runEasy },
  'run-brick': { sport: 'run', label: 'Run – brick (after bike)', build: runBrick },
  'bike-power': { sport: 'bike', label: 'Bike – indoor power', build: bikePower },
  'bike-long': { sport: 'bike', label: 'Bike – long (outdoor)', build: bikeLong },
  'bike-easy': { sport: 'bike', label: 'Bike – easy', build: bikeEasy },
  'bike-hills': { sport: 'bike', label: 'Bike – climbing intervals', build: bikeHills },
  'run-tempo': { sport: 'run', label: 'Run – tempo', build: runTempo },
  'swim-css': { sport: 'swim', label: 'Swim – CSS intervals', build: swimCss },
};

// Race week (short openers) + race day
export function raceWeek(dates, s, raceDate) {
  const S = (sport, kind, title, steps, extra = {}) => ({ sport, kind, title, key: false, focus: 'Race week: stay sharp, stay fresh. Nothing new.', steps, ...extra });
  const out = [
    [1, S('swim', 'openers', 'Swim 1.6 km + race pace', [{ kind: 'wu', dist: 400, zone: 1, text: 'Easy' }, { repeat: 4, steps: [{ kind: 'work', dist: 200, zone: 2, target: T.swim(4, 8), text: '200 m race rhythm, sight every 6 strokes' }] }, { kind: 'cd', dist: 400, zone: 1, text: 'Easy' }])],
    [2, S('run', 'openers', 'Run 45 min + race efforts', [{ kind: 'wu', min: 15, zone: 2, target: T.hr(2), text: 'Easy' }, { repeat: 3, steps: [{ kind: 'work', min: 5, zone: 3, target: T.hr(3), text: '5 min race effort' }, { kind: 'rec', min: 3, zone: 1, text: 'Easy' }] }, { kind: 'cd', min: 6, zone: 2, target: T.hr(2), text: 'Easy' }])],
    [3, S('swim', 'openers', 'Swim openers', [{ kind: 'wu', dist: 400, zone: 1, text: 'Easy' }, { repeat: 6, steps: [{ kind: 'work', dist: 50, zone: 3, target: T.swim(-2, 3), text: 'Fast 50, relaxed' }] }, { kind: 'cd', dist: 300, zone: 1, text: 'Easy' }])],
    [4, S('bike', 'openers', 'Bike 60 min + race blocks', [{ kind: 'wu', min: 15, zone: 1, target: T.power(0.5, 0.62), text: 'Easy' }, { repeat: 3, steps: [{ kind: 'work', min: 6, zone: 3, target: T.power(0.72, 0.78), text: '6 min race power' }, { kind: 'rec', min: 4, zone: 1, target: T.power(0.5, 0.55), text: 'Easy' }] }, { kind: 'cd', min: 15, zone: 2, target: T.power(0.55, 0.65), text: 'Easy' }], { indoor: true })],
    [4, S('run', 'openers', 'Run off the bike 15 min', [{ kind: 'steady', min: 15, zone: 2, target: T.hr(2), text: 'Easy, quick feet' }], { brickOnly: true })],
    [5, S('run', 'strides', 'Shake-out 20 min', [{ kind: 'steady', min: 16, zone: 2, target: T.hr(2), text: 'Very easy' }, { repeat: 4, steps: [{ kind: 'work', min: 0.33, zone: 4, text: 'Stride' }, { kind: 'rec', min: 0.67, zone: 1, text: 'Walk' }] }])],
  ];
  return out.filter(([d]) => dates[d] && dates[d] < raceDate);
}

// Human-readable lines (for AI prompt / notes)
export function stepsText(steps, ctx, indent = '') {
  const out = [];
  for (const st of steps) {
    if (st.repeat) { out.push(`${indent}${st.repeat}×`); out.push(...stepsText(st.steps, ctx, indent + '  ')); continue; }
    const amt = st.dist ? `${st.dist} m` : `${fmtMin(st.min)}`;
    const tg = describeTarget(st.target, ctx);
    out.push(`${indent}${amt}${tg ? ' @ ' + tg : ''} — ${st.text}`);
  }
  return out;
}
export function fmtMin(m) { if (m < 1) return `${Math.round(m * 60)} s`; return Number.isInteger(m) ? `${m} min` : `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')} min`; }

// MyWhoosh library matches (only workouts verified to exist in the MyWhoosh library; structure noted so the
// athlete can judge the fit). Anything else → ride the prescribed steps manually in ERG mode.
const MW = {
  ss12: { name: 'Sweetspot 12 minute', what: '≈1 h · 2×12 min @ 88% FTP + 4×1 min high cadence' },
  ss15: { name: 'Sweet Spot 15', what: '≈1 h · 2×15 min @ 88% FTP' },
  ss20: { name: 'Sweetspot 20 minute', what: '≈1 h · 1×20 min sweet spot + 5×1 min' },
  thr: { name: 'Threshold #2', what: '≈1 h · ~35 min at threshold' },
  ou: { name: 'Climbing Fartlek #2', what: '1 h · 3 blocks of over-unders (89% / 104% FTP)' },
  z2: { name: 'Zone 2 Endurance #1', what: '1 h · steady Zone 2' },
  climb: { name: 'Climbing Sustained Threshold #1', what: '≈1 h · 4×5 min @ 90% FTP' },
};
export function myWhoosh(sess) {
  if (sess.sport !== 'bike' || !sess.indoor) return null;
  const t = sess.title || '';
  let m = null, fit = 'close';
  if (/Sweet spot \d+×12/i.test(t)) { m = MW.ss12; fit = /2×12/.test(t) ? 'match' : 'close'; }
  else if (/Sweet spot \d+×15/i.test(t)) { m = MW.ss15; fit = /2×15/.test(t) ? 'match' : 'close'; }
  else if (/Sustained power|2×20/i.test(t)) m = MW.ss20;
  else if (/Threshold \d+×10/i.test(t)) m = MW.thr;
  else if (/Over-unders/i.test(t)) m = MW.ou;
  else if (/Climbing \d+×/i.test(t)) m = MW.climb;
  else if (sess.kind === 'endurance' && sess.min <= 75) { m = MW.z2; fit = 'match'; }
  const diff = m ? Math.round(sess.min - 60) : 0;
  return {
    name: m?.name || null, what: m?.what || '', fit,
    manual: m ? (Math.abs(diff) >= 10 ? (diff > 0 ? `Add ${diff} min Zone 2 at the end (free ride, ERG ${'~'}65% FTP).` : `Stop ${-diff} min early.`) : '') : 'No matching MyWhoosh preset — use Free Ride in ERG mode and set the watts of each step below.',
  };
}
