// Training-history profile: learns the athlete's real weekly pattern from recorded activities
// (which sport on which weekday, usual durations, long sessions, hard sessions, weekly volume).
// The plan is then built on top of this instead of a generic template.
import { isoDate, addDays, parseDate, daysBetween, clamp } from './util.js';

const CORE = ['swim', 'bike', 'run'];
const HARD_NAME = /(\d+\s*[x×]\s*\d+)|interval|tempo|threshold|sweet|css|vo2|fartlek|hill|race ?pace|ftp|test/i;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const median = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const dowOf = (iso) => (parseDate(iso).getDay() + 6) % 7; // 0 = Mon
export const isHard = (a) => (a.intensity != null && a.intensity >= 78) || HARD_NAME.test(a.name || '');

export function buildProfile(activities, refMondayIso, weeks = 8) {
  const from = isoDate(addDays(parseDate(refMondayIso), -weeks * 7));
  const win = (activities || []).filter(a => a.date >= from && a.date < refMondayIso && CORE.includes(a.sport) && a.movingSec >= 600);
  if (win.length < 8) return null;
  const first = win.reduce((m, a) => a.date < m ? a.date : m, win[0].date);
  const nWeeks = clamp(Math.ceil(daysBetween(first, refMondayIso) / 7), 1, weeks);
  if (nWeeks < 3) return null;

  // weekly totals
  const weekIdx = (iso) => Math.floor(daysBetween(from, iso) / 7);
  const weekTotals = Array(weeks).fill(0);
  win.forEach(a => { weekTotals[weekIdx(a.date)] += a.movingSec / 60; });
  const totals = weekTotals.slice(weeks - nWeeks);
  const baseMin = median(totals.filter(x => x > 0).length >= 2 ? totals.filter(x => x > 0) : totals);

  // slots: (weekday, sport) that recur in at least 40% of weeks; one activity per day+sport (the longest)
  const perDay = {};
  win.forEach(a => { const k = `${a.date}|${a.sport}`; if (!perDay[k] || perDay[k].movingSec < a.movingSec) perDay[k] = a; });
  const bySlot = {};
  Object.values(perDay).forEach(a => { const k = `${dowOf(a.date)}-${a.sport}`; (bySlot[k] ||= []).push(a); });
  let slots = Object.entries(bySlot).map(([k, acts]) => {
    const [dow, sport] = k.split('-');
    acts.sort((x, y) => y.date.localeCompare(x.date));
    return { dow: +dow, sport, freq: acts.length / nWeeks, min: Math.round(median(acts.map(a => a.movingSec / 60))), hard: acts.filter(isHard).length / acts.length, acts: acts.slice(0, 4), synthetic: false };
  }).filter(s => s.freq >= 0.4);

  // per-sport stats
  const sports = {};
  for (const sp of CORE) {
    const a = win.filter(x => x.sport === sp);
    const weeklyMax = Array.from({ length: nWeeks }, (_, i) => {
      const w = a.filter(x => weekIdx(x.date) === weeks - nWeeks + i);
      return w.length ? Math.max(...w.map(x => x.movingSec / 60)) : 0;
    }).filter(Boolean);
    sports[sp] = { perWeek: a.length / nWeeks, weeklyMin: a.reduce((s, x) => s + x.movingSec / 60, 0) / nWeeks, longest: Math.round(median(weeklyMax)) };
  }

  slots = ensureRoles(slots, sports);
  return { baseMin: Math.round(baseMin), nWeeks, from, slots, sports, sessionsPerWeek: Math.round(win.length / nWeeks * 10) / 10 };
}

// Assign roles (long / key / easy) per sport and fill gaps an Ironman build needs.
function ensureRoles(slots, sports) {
  const need = { swim: 2, bike: 3, run: 3 };
  const defMin = { swim: 45, bike: 60, run: 40 };
  const dayLoad = (d) => slots.filter(s => s.dow === d).reduce((a, s) => a + s.min, 0);
  const addSlot = (sport, min, prefer = []) => {
    const free = [0, 1, 2, 3, 4, 5, 6].filter(d => !slots.some(s => s.dow === d && s.sport === sport));
    const pick = prefer.find(d => free.includes(d)) ?? free.sort((a, b) => dayLoad(a) - dayLoad(b))[0];
    if (pick == null) return null;
    const s = { dow: pick, sport, freq: 0, min, hard: 0, acts: [], synthetic: true };
    slots.push(s); return s;
  };

  for (const sp of ['swim', 'bike', 'run']) {
    let mine = slots.filter(s => s.sport === sp);
    // long session (bike & run): the longest habitual slot; add one on the weekend if none is long enough
    if (sp !== 'swim') {
      const longDay = sp === 'bike' ? [5, 6] : [6, 5];
      let long = mine.sort((a, b) => b.min - a.min)[0];
      if (!long || long.min < (sp === 'bike' ? 90 : 60)) long = addSlot(sp, Math.max(sports[sp].longest || 0, sp === 'bike' ? 120 : 70), longDay) || long;
      if (long) long.role = 'long';
    }
    mine = slots.filter(s => s.sport === sp);
    while (mine.length < need[sp]) { const s = addSlot(sp, defMin[sp]); if (!s) break; mine = slots.filter(x => x.sport === sp); }
    const rest = mine.filter(s => s.role !== 'long');
    const key = rest.sort((a, b) => (b.hard - a.hard) || (b.min - a.min))[0];
    if (key) key.role = 'key';
    mine.forEach(s => { if (!s.role) s.role = 'easy'; });
  }
  return slots.sort((a, b) => a.dow - b.dow || CORE.indexOf(a.sport) - CORE.indexOf(b.sport));
}

export function describeProfile(p) {
  if (!p) return '';
  const days = [0, 1, 2, 3, 4, 5, 6].map(d => {
    const s = p.slots.filter(x => x.dow === d && !x.synthetic).map(x => x.sport);
    return s.length ? `${DOW[d]} ${s.join('+')}` : null;
  }).filter(Boolean);
  return days.join(' · ');
}

export function refInfo(a) {
  if (!a) return null;
  return { id: a.id, date: a.date, name: a.name, sport: a.sport, min: Math.round(a.movingSec / 60), distanceM: a.distanceM, np: a.np, avgW: a.avgW, paceSecKm: a.paceSecKm, pace100: a.pace100, intensity: a.intensity, load: a.load, avgHr: a.avgHr };
}
