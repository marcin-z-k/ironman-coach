// Several races and performance goals.
//
// Race:  { id, name, date, type, tri, km, m, hm, surface, level, days, goalTime (sec | null) }
//   type: 'triathlon' (tri: sprint | olympic | 70.3 | full) · 'run' (km, hm) · 'bike' (km, hm, surface)
//         · 'swim' (m) · 'stoneman-mtb' / 'stoneman-road' (level gold | silver | bronze = 1 | 2 | 3 days)
// Performance goal: { id, metric: 'ftp' | 'runThreshold' | 'easy' | 'css', target, date }
//
// PRIORITY — from how hard each race is for YOU right now (no manual A/B/C):
//   difficulty D = the largest of
//     · distance ÷ what you currently manage, per discipline in the race:
//         run km ÷ max(longest recent run, continuous-run distance) · bike km per day ÷ longest
//         recent ride (min 60 km) · swim m ÷ continuous-swim distance
//     · predicted time ÷ target time (when you set one)
//     · race duration (per day) ÷ your longest recent session; triathlon run ×1.3 (Full) / ×1.15 (70.3)
//       because it is run on tired legs; every ratio capped at 6
//   races within 15 % of the hardest one → A (equally important) · 50–85 % → B · below → C
import { isoDate, today as todayDate } from './util.js';
import { predict } from './predict.js';
import { TRI, goalLabel } from './goals.js';

export const STONEMAN = {
  'stoneman-mtb': { label: 'Stoneman Miriquidi MTB', km: 162, hm: 4400, surface: 'mtb' },
  'stoneman-road': { label: 'Stoneman Miriquidi Road', km: 290, hm: 4900, surface: 'road' },
};
export const LEVEL_DAYS = { gold: 1, silver: 2, bronze: 3 };
export const RACE_TYPES = {
  'tri-sprint': 'Triathlon · Sprint', 'tri-olympic': 'Triathlon · Olympic', 'tri-70.3': 'Triathlon · 70.3', 'tri-full': 'Triathlon · Full',
  run: 'Running race', bike: 'Cycling race / ride', swim: 'Swim race', 'stoneman-mtb': 'Stoneman Miriquidi MTB', 'stoneman-road': 'Stoneman Miriquidi Road',
};
export const typeKey = (r) => r.type === 'triathlon' ? `tri-${r.tri || 'full'}` : r.type;
export const fmtGoalTime = (sec) => sec ? `${Math.floor(sec / 3600)}:${String(Math.round(sec % 3600 / 60)).padStart(2, '0')}` : '';
export const parseGoalTime = (t) => { if (t == null || t === '') return null; if (typeof t === 'number') return t > 100 ? t : t * 3600; const m = String(t).match(/^(\d+)(?::(\d{1,2}))?(?::(\d{1,2}))?\s*h?$/); if (!m) return null; return (+m[1]) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)); };

// race → the app's goal object (used by the predictor and Race Day)
export function goalOf(r) {
  if (r.type === 'triathlon') return { type: 'triathlon', tri: r.tri || 'full' };
  if (r.type === 'run') return { type: 'run', runKm: +r.km || 42.195, runHm: +r.hm || 0 };
  if (r.type === 'swim') return { type: 'swim', swimM: +r.m || 3800 };
  const st = STONEMAN[r.type];
  const days = st ? (LEVEL_DAYS[r.level || 'gold'] || 1) : (+r.days || 1);
  const km = st ? st.km : (+r.km || 100), hm = st ? st.hm : (+r.hm || 0);
  return { type: 'bike', bikeKm: Math.round(km / days * 10) / 10, bikeHm: Math.round(hm / days), surface: st ? st.surface : (r.surface || 'road'), days, totalKm: km, totalHm: hm };
}
export const raceLabel = (r) => STONEMAN[r.type] ? `${STONEMAN[r.type].label} · ${(r.level || 'gold')[0].toUpperCase() + (r.level || 'gold').slice(1)}` : goalLabel(goalOf(r));

// settings as seen by one race (predictor / Race Day / simulator)
export function sFor(s, r) {
  if (!r) return s;
  return { ...s, planSource: 'goal', goal: goalOf(r), raceDate: r.date, raceName: r.name, goalHours: r.goalTime ? r.goalTime / 3600 : (r.primary ? s.goalHours : null) };
}

// prediction incl. multi-day (Stoneman Silver / Bronze: per-day distance × days)
export function predictRace(b, s, r, d = {}) {
  const sr = sFor(s, r);
  const p = predict(b, sr, d);
  const days = sr.goal.days || 1;
  return { ...p, days, perDaySec: p.totalSec, totalSec: p.totalSec * days };
}

export function upcomingRaces(s, iso = isoDate(todayDate())) {
  const list = (s.races || []).filter(r => r.date >= iso).sort((a, b) => a.date.localeCompare(b.date));
  return list;
}

export function difficulty(r, b, s) {
  const g = goalOf(r);
  const parts = [];
  const cap = x => Math.min(6, x);
  const fat = g.type === 'triathlon' ? ({ full: 1.3, '70.3': 1.15 }[g.tri] || 1.05) : 1;       // run off the bike = on tired legs
  if (g.type === 'run' || g.type === 'triathlon') { const km = g.type === 'run' ? g.runKm + (g.runHm || 0) / 100 : TRI[g.tri].run; parts.push(['run', cap(km * fat / Math.max(5, b.runLongestKm || 0, b.runCont || 0))]); }
  if (g.type === 'bike' || g.type === 'triathlon') { const km = g.type === 'bike' ? g.bikeKm * (1 + (g.bikeHm || 0) / g.bikeKm / 25) : TRI[g.tri].bike; parts.push(['bike', cap(km / Math.max(60, b.bikeLongestKm || 0))]); }
  if (g.type === 'swim' || g.type === 'triathlon') { const m = g.type === 'swim' ? g.swimM : TRI[g.tri].swim; parts.push(['swim', cap(m / Math.max(400, b.swimCont || 0))]); }
  // duration: race hours (per day) ÷ your longest recent session (h)
  let hrs = null; try { hrs = predictRace(b, s, r).perDaySec / 3600; } catch {}
  const longH = Math.max(1, b.longestSessionH || ((b.bikeLongestKm || 60) / Math.max(15, b.bikeKmh || 25)));
  if (hrs) parts.push(['duration', cap(hrs / longH)]);
  parts.sort((x, y) => y[1] - x[1]);
  let D = parts[0][1], why = parts[0];
  let tgt = null;
  if (r.goalTime) { const p = predictRace(b, s, r); tgt = p.totalSec / r.goalTime; if (tgt > D) { D = tgt; why = ['time', tgt]; } }
  return { D, why, parts, tgt };
}

export function priorities(s, b) {
  const list = upcomingRaces(s);
  if (!list.length) return {};
  const ds = list.map(r => ({ r, ...difficulty(r, b, s) }));
  const max = Math.max(...ds.map(x => x.D));
  const out = {};
  for (const x of ds) {
    const rel = x.D / max;
    const prio = rel >= 0.85 ? 'A' : rel >= 0.5 ? 'B' : 'C';
    const what = x.why[0] === 'time' ? `predicted ${Math.round(x.tgt * 100)} % of your target time` : x.why[0] === 'duration' ? `${Math.round(x.why[1] * 10) / 10}× your longest recent session` : `${Math.round(x.why[1] * 10) / 10}× your current ${x.why[0]} capacity`;
    out[x.r.id] = { prio, D: x.D, rel, reason: list.length < 2 ? what : prio === 'A' ? (ds.filter(y => y.D / max >= 0.85).length > 1 ? `similar difficulty to your other main race(s) — equally important (${what})` : `hardest for you right now (${what})`) : `easier for you than your main race (${what}) — short taper only` };
  }
  return out;
}

// the race the default views follow: the next A race (else the next race)
export function primaryRace(s, b) {
  const list = upcomingRaces(s);
  if (!list.length) return null;
  const pr = b ? priorities(s, b) : {};
  return list.find(r => pr[r.id]?.prio === 'A') || list[0];
}

// performance goal for a metric (nearest future one)
export function perfGoalFor(s, metric, iso = isoDate(todayDate())) {
  return (s.perfGoals || []).filter(g => g.metric === metric && g.date >= iso).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

// from the plan JSON
export function racesFromMeta(meta) {
  const raw = Array.isArray(meta?.races) && meta.races.length ? meta.races : meta?.goal ? [meta.goal] : [];
  const out = [];
  raw.forEach((g, i) => {
    const t = String(g.type || '').toLowerCase(), d = g.distance;
    const date = g.date || g.raceDate; if (!date) return;
    const base = { id: `r${i}-${date}`, name: g.name || g.raceName || `Race ${i + 1}`, date: String(date).slice(0, 10), goalTime: parseGoalTime(g.goalTime) };
    if (/stoneman/.test(t) || /stoneman/i.test(base.name)) {
      const road = /road|rennrad/i.test(t + ' ' + base.name + ' ' + (g.surface || ''));
      out.push({ ...base, type: road ? 'stoneman-road' : 'stoneman-mtb', level: String(g.level || 'gold').toLowerCase().replace(/[^a-z]/g, '') || 'gold' });
    } else if (/tri/.test(t)) { const x = String(d || 'full').toLowerCase(); out.push({ ...base, type: 'triathlon', tri: /sprint/.test(x) ? 'sprint' : /olymp/.test(x) ? 'olympic' : /70|half|middle|mittel/.test(x) ? '70.3' : 'full' }); }
    else if (/run|lauf|marathon|trail/.test(t)) out.push({ ...base, type: 'run', km: +d || +g.distanceKm || 42.195, hm: +g.elevationM || 0 });
    else if (/bike|cycl|ride|rad|gravel|mtb/.test(t)) out.push({ ...base, type: 'bike', km: +d || +g.distanceKm || 100, hm: +g.elevationM || 0, surface: /mtb|mountain/.test(t + (g.surface || '')) ? 'mtb' : /gravel/.test(t + (g.surface || '')) ? 'gravel' : 'road', days: +g.days || 1 });
    else if (/swim/.test(t)) out.push({ ...base, type: 'swim', m: +d || +g.distanceM || 3800 });
  });
  return out;
}
export function perfGoalsFromMeta(meta) {
  const M = { ftp: 'ftp', ftpindoor: 'ftp', indoorftp: 'ftp', runthreshold: 'runThreshold', threshold: 'runThreshold', thresholdpace: 'runThreshold', easy: 'easy', easypace: 'easy', css: 'css', swimcss: 'css' };
  const toVal = (metric, v) => metric === 'ftp' ? +v : typeof v === 'number' ? v : (() => { const m = String(v).match(/^(\d+):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; })();
  return (meta?.performanceGoals || []).map((g, i) => { const metric = M[String(g.metric || '').toLowerCase().replace(/[^a-z]/g, '')]; const target = metric ? toVal(metric, g.target) : null; return metric && target && g.date ? { id: `g${i}-${g.date}`, metric, target, date: String(g.date).slice(0, 10) } : null; }).filter(Boolean);
}
