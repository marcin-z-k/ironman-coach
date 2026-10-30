// Adaptation engine: compares executed vs planned training, reads fatigue/wellness
// and decides how the plan should change (volume factor, intensity cap, today's tweak).
import { isoDate, addDays, today, daysBetween, round, clamp } from './util.js';
import { generatePlan, weekForDate } from './plan.js';

// Match executed activities to planned sessions (same day + sport; closest duration).
export function matchSessions(plan, activities) {
  const byDate = {};
  for (const a of activities) (byDate[a.date] ||= []).push(a);
  const matches = {}; // sessionId -> activity
  const used = new Set();
  for (const w of plan.weeks) for (const s of w.sessions) {
    const cands = (byDate[s.date] || []).filter(a => !used.has(a.id) && (a.sport === s.sport || (s.sport === 'brick')));
    if (!cands.length) continue;
    cands.sort((a, b) => Math.abs(a.movingSec / 60 - s.min) - Math.abs(b.movingSec / 60 - s.min));
    matches[s.id] = cands[0]; used.add(cands[0].id);
  }
  return matches;
}

export function latestWellness(wellness) {
  const withLoad = wellness.filter(w => w.ctl != null);
  const last = withLoad[withLoad.length - 1] || null;
  const recent = wellness.slice(-14);
  const avg = (k, n = 7) => { const v = recent.slice(-n).map(w => w[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const baseline = (k) => { const v = wellness.slice(-28, -7).map(w => w[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const lastW = wellness[wellness.length - 1] || {};
  return {
    ctl: last?.ctl ?? null, atl: last?.atl ?? null, ramp: last?.ramp ?? null,
    tsb: last ? round(last.ctl - last.atl, 1) : null,
    hrv: lastW.hrv ?? avg('hrv', 3), hrvBase: baseline('hrv'),
    rhr: lastW.restingHR ?? avg('restingHR', 3), rhrBase: baseline('restingHR'),
    sleepH: lastW.sleepSecs ? round(lastW.sleepSecs / 3600, 1) : null,
    date: lastW.date,
  };
}

export function analyse(settings, data) {
  const base = generatePlan(settings);           // un-adjusted reference
  const acts = data?.activities || [];
  const well = data?.wellness || [];
  const t = today();
  const tIso = isoDate(t);
  const w = latestWellness(well);
  const matches = matchSessions(base, acts);

  // Compliance over last 7 / 14 days (planned sessions in the past, excluding today)
  const window = (days) => {
    const from = isoDate(addDays(t, -days));
    let planned = 0, done = 0, plannedN = 0, doneN = 0, keyMissed = 0;
    for (const wk of base.weeks) for (const s of wk.sessions) {
      if (s.date < from || s.date >= tIso) continue;
      planned += s.tss; plannedN++;
      const m = matches[s.id];
      if (m) { done += m.load ?? Math.round((m.movingSec / 3600) * 50); doneN++; } else if (s.key) keyMissed++;
    }
    // unplanned extra activities count toward load
    const extra = acts.filter(a => a.date >= from && a.date < tIso && !Object.values(matches).some(x => x.id === a.id)).reduce((s, a) => s + (a.load || 0), 0);
    return { planned, done: done + extra, plannedN, doneN, keyMissed, ratio: planned ? (done + extra) / planned : null };
  };
  const c7 = window(7), c14 = window(14);

  // Readiness flags
  const flags = [];
  if (w.tsb != null && w.tsb < -30) flags.push({ level: 'bad', text: `Form ${w.tsb}: deep fatigue (ATL far above CTL).` });
  else if (w.tsb != null && w.tsb < -20) flags.push({ level: 'warn', text: `Form ${w.tsb}: you are carrying fatigue.` });
  if (w.ramp != null && w.ramp > 7) flags.push({ level: 'warn', text: `Fitness ramping at ${round(w.ramp, 1)}/week — above the safe 5–7 range.` });
  if (w.hrv && w.hrvBase && w.hrv < w.hrvBase * 0.88) flags.push({ level: 'warn', text: `HRV ${round(w.hrv)} is ${Math.round((1 - w.hrv / w.hrvBase) * 100)}% below your 3-week baseline.` });
  if (w.rhr && w.rhrBase && w.rhr > w.rhrBase + 5) flags.push({ level: 'warn', text: `Resting HR ${Math.round(w.rhr)} is elevated (baseline ${Math.round(w.rhrBase)}).` });
  if (w.sleepH != null && w.sleepH < 6) flags.push({ level: 'warn', text: `Only ${w.sleepH} h sleep last night.` });
  if (c14.ratio != null && c14.ratio < 0.7 && c14.plannedN >= 6) flags.push({ level: 'warn', text: `Only ${Math.round(c14.ratio * 100)}% of planned load done over 14 days.` });
  if (c14.ratio != null && c14.ratio > 1.3 && c14.plannedN >= 6) flags.push({ level: 'warn', text: `${Math.round(c14.ratio * 100)}% of planned load — you are doing more than the plan asks.` });
  if (c7.keyMissed >= 2) flags.push({ level: 'warn', text: `${c7.keyMissed} key sessions missed this week.` });

  // Decide plan adjustment (applies from current week onwards)
  let factor = 1, intensityCap = null, reason = '';
  const fatigue = (w.tsb != null && w.tsb < -30) || flags.filter(f => f.level !== 'good').length >= 3;
  const tired = (w.tsb != null && w.tsb < -20) || (w.ramp != null && w.ramp > 7);
  if (fatigue) { factor = 0.8; intensityCap = 'easy'; reason = 'Fatigue is high — this week is reduced by 20% and intensity is removed until form recovers.'; }
  else if (c14.ratio != null && c14.plannedN >= 6 && c14.ratio < 0.7) { factor = 0.9; reason = 'Compliance has been low — volume is stepped down 10% so the plan stays realistic; it ramps back when you hit 90%+.'; }
  else if (tired) { factor = 0.9; reason = 'You are carrying fatigue — volume trimmed 10% this week, key sessions stay in.'; }
  else if (c14.ratio != null && c14.plannedN >= 8 && c14.ratio >= 0.95 && c14.ratio <= 1.25 && (w.tsb == null || w.tsb > -15) && (w.ramp == null || w.ramp < 6)) {
    factor = 1.05; reason = 'Two solid weeks, fresh enough — volume raised 5% to keep progressing toward sub-12.';
  }
  const currentWeek = weekForDate(base, tIso);
  const plan = generatePlan(settings, { factor, fromWeek: currentWeek ? currentWeek.index : 0, intensityCap });
  const planMatches = matchSessions(plan, acts);

  // Today's recommendation
  const todays = plan.weeks.flatMap(wk => wk.sessions).filter(s => s.date === tIso);
  let todayNote = null;
  if (todays.length) {
    const lowReadiness = flags.some(f => /HRV|Resting HR|sleep/.test(f.text));
    if (lowReadiness && !fatigue && todays.some(s => s.key && s.if >= 0.8)) {
      todayNote = { level: 'warn', text: 'Low readiness markers today. If the key session feels hard in the warm-up, switch to the endurance alternative — fitness is built on consistency, not heroics.' };
    } else if (c7.keyMissed >= 1 && !todays.some(s => s.key)) {
      todayNote = { level: 'warn', text: 'A key session was missed this week. Today is a good day to slot it in if you are fresh; otherwise let it go and don\'t stack.' };
    }
  }

  // Goal projection
  const goal = goalProjection(settings, acts, data?.athlete);

  return { plan, base, matches: planMatches, wellness: w, compliance: { c7, c14 }, flags, adjustment: { factor, intensityCap, reason }, todayNote, goal, todayIso: tIso };
}

// Sub-12 target model: swim 1:15 + T1 6 + bike 6:00 + T2 4 + run 4:20 ≈ 11:45.
export function goalProjection(s, acts, athlete) {
  const weeksLeft = Math.max(0, daysBetween(today(), s.raceDate) / 7);
  const targets = {
    css: 108,           // 1:48/100m -> 1:55 race pace -> ~1:13 swim
    ftp: Math.round(bikeTargetFtp(s.weightKg || 75)),
    runThreshold: 313,  // 5:13/km threshold -> 6:05 IM pace -> 4:17 marathon
  };
  const cur = { css: s.css, ftp: s.ftp, runThreshold: s.runThreshold };
  // Trend from recent eFTP values on rides if intervals.icu exposes them
  const eftps = acts.filter(a => a.sport === 'bike' && a.eftp).map(a => ({ d: a.date, v: a.eftp }));
  const eftpNow = eftps.length ? Math.max(...eftps.slice(0, 10).map(x => x.v)) : null;

  const pct = (c, t, lowerBetter) => lowerBetter ? clamp((1 - (c - t) / (c * 0.25)) , 0, 1) : clamp(c / t, 0, 1);
  const rows = [
    { key: 'swim', label: 'Swim CSS', cur: cur.css, target: targets.css, unit: 'pace100', lowerBetter: true },
    { key: 'bike', label: 'Bike FTP', cur: eftpNow || cur.ftp, target: targets.ftp, unit: 'w', lowerBetter: false },
    { key: 'run', label: 'Run threshold', cur: cur.runThreshold, target: targets.runThreshold, unit: 'pace', lowerBetter: true },
  ].map(r => ({ ...r, progress: r.lowerBetter ? clamp(1 - Math.max(0, r.cur - r.target) / Math.max(1, r.cur * 0.2), 0, 1) : clamp(r.cur / r.target, 0, 1) }));

  // Predicted splits from current numbers
  const pred = predictSplits(cur, eftpNow, s.weightKg || 75);
  return { weeksLeft: round(weeksLeft, 0), targets, rows, pred, eftpNow };
}

// Very rough physics: flat course, 30 km/h needs ~185 W for a 75 kg rider on a TT bike at CdA 0.25.
function bikeTargetFtp(kg) { const needW = 168 + (kg - 75) * 1.0; return needW / 0.73; } // ~6:00 bike on that model

export function predictSplits(cur, eftp, kg) {
  const ftp = eftp || cur.ftp;
  const raceW = ftp * 0.73;
  // speed from power on flat: P = 0.5*rho*CdA*v^3 + Crr*m*g*v (age-grouper TT: CdA .30, Crr .005),
  // then +8% for a typical (rolling, windy, non-drafting) Ironman course.
  let v = 8; for (let i = 0; i < 40; i++) { const f = 0.5 * 1.2 * 0.30 * v ** 3 + 0.005 * (kg + 9) * 9.81 * v - raceW * 0.975; const df = 1.5 * 1.2 * 0.30 * v ** 2 + 0.005 * (kg + 9) * 9.81; v -= f / df; }
  v = v / 1.08;
  const bikeSec = 180000 / v;
  const swimSec = 3800 / 100 * (cur.css + 6);
  const runSec = 42195 / 1000 * cur.runThreshold * 1.155 * 1.03; // +3% aid-station/fade allowance
  const transitions = 10 * 60;
  return { swimSec, bikeSec, runSec, transitions, totalSec: swimSec + bikeSec + runSec + transitions, raceW: Math.round(raceW), kmh: round(v * 3.6, 1) };
}
