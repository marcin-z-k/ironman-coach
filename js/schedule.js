// Reconciles the plan with what was actually done:
//  • an activity on another day than planned still completes the planned session of that sport
//  • done EARLY (e.g. run on Tue instead of Wed): the session moves to Tue and Tue's planned
//    session moves to the vacated Wed  (a swap)
//  • done LATE (e.g. Wed run done on Thu): the session moves to Thu; Thu's session stays
//  • manual swaps from the UI are applied first
// Afterwards, missed time is partly made up in the remaining sessions of that sport.
import { daysBetween, round } from './util.js';
import { scaleVolume } from './workouts.js';

const sportOf = x => x.sport === 'brick' ? 'run' : x.sport;
const MIN_SESSION_SEC = 900;

export function reconcile(plan, acts, moves = {}, todayIso) {
  const matches = {}; const extras = []; const used = new Set();
  for (const w of plan.weeks) {
    // 1) manual swaps
    for (const x of w.sessions) {
      const m = moves[x.id];
      if (m && m >= w.start && m <= w.end && m !== x.date) { x.movedFrom = x.date; x.date = m; x.manual = true; }
    }
    if (w.start > todayIso) { w.sessions.sort((a, b) => a.date.localeCompare(b.date)); continue; }
    const wActs = acts
      .filter(a => a.date >= w.start && a.date <= w.end && a.date <= todayIso && ['swim', 'bike', 'run'].includes(a.sport))
      .sort((a, b) => a.start.localeCompare(b.start));
    for (const a of wActs) {
      if (used.has(a.id)) continue;
      const dur = a.movingSec / 60;
      const open = w.sessions.filter(x => !matches[x.id] && x.kind !== 'race' && sportOf(x) === a.sport);
      if (!open.length || (a.movingSec < MIN_SESSION_SEC && !open.some(x => x.date === a.date))) { extras.push(a); continue; }
      // one score for all candidates: day distance (doing it late costs a bit more) + duration mismatch
      const score = x => { const dd = daysBetween(a.date, x.date); return (dd === 0 ? 0 : dd > 0 ? dd + 0.01 : 1 + Math.abs(dd)) + Math.abs(x.min - dur) / 15; };
      const S = open.sort((x, y) => score(x) - score(y))[0];
      const D1 = S.date, D2 = a.date;
      matches[S.id] = a; used.add(a.id);
      if (D1 === D2) continue;
      S.movedFrom = D1; S.date = D2; S.auto = true;
      if (D1 > D2) {
        // done early → whatever was planned on D2 (and not done) takes the vacated day
        for (const y of w.sessions) {
          if (y !== S && !matches[y.id] && y.date === D2 && sportOf(y) !== a.sport && y.kind !== 'race') {
            y.movedFrom = D2; y.date = D1; y.auto = true; y.swapWith = S.title;
          }
        }
      }
    }
    w.sessions.sort((a, b) => a.date.localeCompare(b.date));
  }
  return { matches, extras };
}

// Manual swap of two days within a week: every not-yet-done session on day A goes to B and vice versa.
export function swapDays(week, dayA, dayB, matches, moves) {
  const next = { ...moves };
  for (const x of week.sessions) {
    if (matches[x.id] || x.kind === 'race') continue;
    if (x.date === dayA) next[x.id] = dayB;
    else if (x.date === dayB) next[x.id] = dayA;
  }
  // drop moves that point back to the original day
  for (const x of week.sessions) if (next[x.id] === x.origDate) delete next[x.id];
  return next;
}

// Make up part of missed volume: 50% of missed minutes per sport, spread over the remaining sessions of
// that sport this week (max +20% each), the rest into next week (max +10% each).
export function catchUp(plan, matches, todayIso, s) {
  const wi = plan.weeks.findIndex(w => todayIso >= w.start && todayIso <= w.end);
  if (wi < 0) return [];
  const w = plan.weeks[wi], next = plan.weeks[wi + 1];
  const notes = [];
  for (const sport of ['swim', 'bike', 'run']) {
    const missed = w.sessions.filter(x => sportOf(x) === sport && x.date < todayIso && !matches[x.id] && x.kind !== 'race');
    if (!missed.length) continue;
    let budget = 0.5 * missed.reduce((a, x) => a + x.min, 0);
    const label = missed.map(x => x.title).join(', ');
    const spread = (list, cap) => {
      const tot = list.reduce((a, x) => a + x.min, 0);
      for (const x of list) {
        if (budget <= 0) break;
        const add = Math.min(budget * x.min / tot, x.min * cap);
        if (add < 3) continue;
        const before = x.min;
        scaleVolume(x, 1 + add / x.min, s);
        const real = x.min - before;
        if (real > 0) { budget -= real; x.catchUp = { min: real, from: label }; }
      }
    };
    spread(w.sessions.filter(x => sportOf(x) === sport && x.date >= todayIso && !matches[x.id] && x.kind !== 'race'), 0.2);
    if (budget > 3 && next && next.phase !== 'race' && next.phase !== 'taper') spread(next.sessions.filter(x => sportOf(x) === sport), 0.1);
    notes.push({ sport, missedMin: round(missed.reduce((a, x) => a + x.min, 0)), label });
  }
  for (const wk of [w, next]) if (wk) { wk.plannedMin = wk.sessions.reduce((a, x) => a + (x.kind === 'race' ? 0 : x.min), 0); wk.plannedLoad = wk.sessions.reduce((a, x) => a + (x.tss || 0), 0); wk.hours = round(wk.plannedMin / 60, 2); }
  return notes;
}
