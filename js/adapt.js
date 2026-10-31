// Adaptation engine:
//  1. plan from the fixed weekly template → reconcile with what was done (day swaps, manual moves)
//  2. compliance + wellness → volume factor / intensity cap (fatigue)
//  3. per-discipline focus: disciplines where sessions under-deliver get up to +12% time
//  4. missed sessions → part of the time is made up in the remaining sessions (catch-up)
import { isoDate, addDays, today, daysBetween, round, clamp } from './util.js';
import { generatePlan, weekForDate } from './plan.js';
import { reconcile, catchUp } from './schedule.js';
import { zoneIntensity } from './analysis.js';
import { baseline, predict } from './predict.js';
import { load } from './store.js';

export function latestWellness(wellness) {
  const withLoad = wellness.filter(w => w.ctl != null);
  const last = withLoad[withLoad.length - 1] || null;
  const recent = wellness.slice(-14);
  const avg = (k, n = 7) => { const v = recent.slice(-n).map(w => w[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const base = (k) => { const v = wellness.slice(-28, -7).map(w => w[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const lastW = wellness[wellness.length - 1] || {};
  return {
    ctl: last?.ctl ?? null, atl: last?.atl ?? null, ramp: last?.ramp ?? null,
    tsb: last ? round(last.ctl - last.atl, 1) : null,
    hrv: lastW.hrv ?? avg('hrv', 3), hrvBase: base('hrv'),
    rhr: lastW.restingHR ?? avg('restingHR', 3), rhrBase: base('restingHR'),
    sleepH: lastW.sleepSecs ? round(lastW.sleepSecs / 3600, 1) : null,
    date: lastW.date,
  };
}

const sportOf = x => x.sport === 'brick' ? 'run' : x.sport;

function disciplineFocus(plan, matches, tIso) {
  const from = isoDate(addDays(new Date(), -21));
  const out = {}, detail = {};
  for (const sp of ['swim', 'bike', 'run']) {
    let n = 0, below = 0; const why = [];
    for (const w of plan.weeks) for (const x of w.sessions) {
      if (sportOf(x) !== sp || x.date < from || x.date >= tIso || x.kind === 'race') continue;
      const a = matches[x.id]; if (!a) continue;
      n++;
      const short = a.movingSec / 60 < x.min * 0.75;
      const zi = zoneIntensity(a, x);
      if (short || zi?.verdict === 'below') { below++; why.push(x.title); }
    }
    const rate = n >= 2 ? below / n : 0;
    out[sp] = round(1 + Math.min(0.12, 0.25 * rate), 2);
    detail[sp] = { n, below, sessions: why };
  }
  return { mult: out, detail };
}

export function analyse(settings, data) {
  const acts = data?.activities || [];
  const well = data?.wellness || [];
  const t = today(), tIso = isoDate(t);
  const moves = settings.moves || {};
  const w = latestWellness(well);

  // 1) reference plan + reconciliation
  const base = generatePlan(settings, undefined, { acts });
  const r0 = reconcile(base, acts, moves, tIso);

  // 2) compliance (planned load vs done, past days only)
  const window = (days) => {
    const from = isoDate(addDays(t, -days));
    let planned = 0, done = 0, plannedN = 0, doneN = 0, keyMissed = 0;
    for (const wk of base.weeks) for (const s of wk.sessions) {
      if (s.date < from || s.date >= tIso || s.kind === 'race') continue;
      planned += s.tss; plannedN++;
      const m = r0.matches[s.id];
      if (m) { done += m.load ?? Math.round((m.movingSec / 3600) * 50); doneN++; } else if (s.key) keyMissed++;
    }
    const extra = r0.extras.filter(a => a.date >= from && a.date < tIso).reduce((s, a) => s + (a.load || 0), 0);
    return { planned, done: done + extra, plannedN, doneN, keyMissed, ratio: planned ? (done + extra) / planned : null };
  };
  const c7 = window(7), c14 = window(14);

  const flags = [];
  if (w.tsb != null && w.tsb < -30) flags.push({ level: 'bad', text: `Form ${w.tsb}: deep fatigue (ATL far above CTL).` });
  else if (w.tsb != null && w.tsb < -20) flags.push({ level: 'warn', text: `Form ${w.tsb}: you are carrying fatigue.` });
  if (w.ramp != null && w.ramp > 7) flags.push({ level: 'warn', text: `Fitness ramping at ${round(w.ramp, 1)}/week — above the safe 5–7 range.` });
  if (w.hrv && w.hrvBase && w.hrv < w.hrvBase * 0.88) flags.push({ level: 'warn', text: `HRV ${round(w.hrv)} is ${Math.round((1 - w.hrv / w.hrvBase) * 100)}% below your 3-week baseline.` });
  if (w.rhr && w.rhrBase && w.rhr > w.rhrBase + 5) flags.push({ level: 'warn', text: `Resting HR ${Math.round(w.rhr)} is elevated (baseline ${Math.round(w.rhrBase)}).` });
  if (w.sleepH != null && w.sleepH < 6) flags.push({ level: 'warn', text: `Only ${w.sleepH} h sleep last night.` });
  if (c14.ratio != null && c14.ratio < 0.7 && c14.plannedN >= 6) flags.push({ level: 'warn', text: `Only ${Math.round(c14.ratio * 100)}% of planned load done over 14 days.` });
  if (c14.ratio != null && c14.ratio > 1.3 && c14.plannedN >= 6) flags.push({ level: 'warn', text: `${Math.round(c14.ratio * 100)}% of planned load — you are doing more than the plan asks.` });

  let factor = 1, intensityCap = null, reason = '';
  const fatigue = (w.tsb != null && w.tsb < -30) || flags.filter(f => f.level !== 'good').length >= 3;
  const tired = (w.tsb != null && w.tsb < -20) || (w.ramp != null && w.ramp > 7);
  if (fatigue) { factor = 0.8; intensityCap = 'easy'; reason = 'Fatigue is high — this week is reduced by 20% and intensity is removed until form recovers.'; }
  else if (tired) { factor = 0.9; reason = 'You are carrying fatigue — volume trimmed 10% this week, key sessions stay in.'; }
  else if (c14.ratio != null && c14.plannedN >= 8 && c14.ratio >= 0.95 && c14.ratio <= 1.25 && (w.tsb == null || w.tsb > -15) && (w.ramp == null || w.ramp < 6)) {
    factor = 1.05; reason = 'Two solid weeks, fresh enough — volume raised 5% to keep progressing.';
  }

  // 3) discipline focus
  const focus = disciplineFocus(base, r0.matches, tIso);

  // final plan
  const currentWeek = weekForDate(base, tIso);
  const plan = generatePlan(settings, { factor, fromWeek: currentWeek ? currentWeek.index : 0, intensityCap }, { acts, focus: focus.mult });
  const { matches, extras } = reconcile(plan, acts, moves, tIso);
  // 4) catch-up for missed sessions
  const caught = catchUp(plan, matches, tIso, settings);

  // today's note
  const todays = plan.weeks.flatMap(wk => wk.sessions).filter(s => s.date === tIso);
  let todayNote = null;
  const lowReadiness = flags.some(f => /HRV|Resting HR|sleep/.test(f.text));
  if (todays.length && lowReadiness && !fatigue && todays.some(s => s.key && s.if >= 0.8)) todayNote = { level: 'warn', text: 'Low readiness markers today. If the key session feels hard in the warm-up, switch to an easy version — consistency beats heroics.' };

  const b = baseline(acts, settings);
  const goal = { weeksLeft: Math.max(0, Math.round(daysBetween(t, settings.raceDate) / 7)), base: b, pred: predict(b, settings) };

  return { plan, base, matches, extras, wellness: w, compliance: { c7, c14 }, flags, adjustment: { factor, intensityCap, reason }, focus, caught, todayNote, goal, todayIso: tIso };
}
