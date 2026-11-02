// Readiness (live), recovery time + tips, sleep coach.
// Inputs: intervals.icu wellness (sleep, HRV, resting HR, CTL/ATL, device readiness) and activities.
import { isoDate, addDays, parseDate, clamp, round } from './util.js';
import { load } from './store.js';

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const hoursSince = (iso, now) => (now - new Date(iso)) / 3600000;

// ---------------------------------------------------------------------------------------------
// READINESS — morning value from recovery markers, then lowered by what you did today.
//   components (each 0–100), weights renormalised over what's available:
//     device readiness (Garmin etc.)  0.25   as reported
//     sleep                            0.25   sleep score, or hours: 5 h → 0, 8 h → 100
//     HRV vs your 28-day baseline       0.20   50 + (HRV/baseline − 1)·250
//     resting HR vs baseline            0.10   50 − (RHR − baseline)·8
//     form (TSB = CTL − ATL)            0.20   60 + 2·TSB
//   live: − today's strain = Σ load·0.3·e^(−h/18) over today's activities (h = hours since), max −45
// ---------------------------------------------------------------------------------------------
export function readiness(well, acts, now = new Date()) {
  const today = isoDate(now);
  const w = [...well].reverse().find(x => x.date <= today);
  if (!w) return null;
  const idx = well.indexOf(w);
  const prior = well.slice(Math.max(0, idx - 28), idx);
  const base = k => { const v = prior.map(x => x[k]).filter(x => x != null); return v.length >= 5 ? mean(v) : null; };
  const parts = [];
  if (w.readiness != null) parts.push({ k: 'Device readiness', v: w.readiness, w: 0.25, raw: `${w.readiness}` });
  if (w.sleepScore != null) parts.push({ k: 'Sleep', v: w.sleepScore, w: 0.25, raw: `score ${w.sleepScore}${w.sleepSecs ? ` · ${round(w.sleepSecs / 3600, 1)} h` : ''}` });
  else if (w.sleepSecs) parts.push({ k: 'Sleep', v: clamp((w.sleepSecs / 3600 - 5) / 3 * 100, 0, 100), w: 0.25, raw: `${round(w.sleepSecs / 3600, 1)} h` });
  const hb = base('hrv'); if (w.hrv != null && hb) parts.push({ k: 'HRV', v: clamp(50 + (w.hrv / hb - 1) * 250, 0, 100), w: 0.2, raw: `${Math.round(w.hrv)} ms vs ${Math.round(hb)} baseline` });
  const rb = base('restingHR'); if (w.restingHR != null && rb) parts.push({ k: 'Resting HR', v: clamp(50 - (w.restingHR - rb) * 8, 0, 100), w: 0.1, raw: `${w.restingHR} bpm vs ${Math.round(rb)}` });
  const lw = well[idx - 1] || w;      // load state going INTO today
  if (lw.ctl != null && lw.atl != null) parts.push({ k: 'Form (TSB)', v: clamp(60 + (lw.ctl - lw.atl) * 2, 0, 100), w: 0.2, raw: `${round(lw.ctl - lw.atl)}` });
  if (!parts.length) return null;
  const ws = parts.reduce((a, p) => a + p.w, 0);
  const morning = Math.round(parts.reduce((a, p) => a + p.v * p.w, 0) / ws);
  // today's strain
  const todays = acts.filter(a => a.date === today && a.load);
  let strain = 0;
  for (const a of todays) { const end = new Date(new Date(a.start).getTime() + (a.elapsedSec || a.movingSec || 0) * 1000); strain += a.load * 0.3 * Math.exp(-Math.max(0, (now - end) / 3600000) / 18); }
  strain = Math.min(45, strain);
  const now_ = clamp(Math.round(morning - strain), 0, 100);
  return { morning, now: now_, strain: Math.round(strain), parts, date: w.date, todays: todays.length, stale: w.date !== today };
}

// ---------------------------------------------------------------------------------------------
// RECOVERY TIME — hours until you're ready for the next hard session.
//   per activity of the last 72 h:  need = load × r(IF)   r = 0.20 (IF < 0.70) · 0.28 (< 0.80) · 0.38 (< 0.90) · 0.50
//   × 1.2 if last night < 6.5 h sleep · × 1.15 if HRV below 88 % of baseline · × 1.1 if TSB < −25
//   remaining = largest (need − hours since it ended) + ½ of the others' remainders, max 96 h
// ---------------------------------------------------------------------------------------------
export function recoveryHours(well, acts, now = new Date()) {
  const from = isoDate(addDays(now, -3));
  const recent = acts.filter(a => a.date >= from && a.load && a.start).sort((x, y) => x.start.localeCompare(y.start));
  const w = well[well.length - 1] || {};
  const prior = well.slice(-29, -1);
  const hb = mean(prior.map(x => x.hrv).filter(x => x != null));
  let mod = 1; const why = [];
  if (w.sleepSecs && w.sleepSecs < 6.5 * 3600) { mod *= 1.2; why.push('short sleep'); }
  if (w.hrv && hb && w.hrv < 0.88 * hb) { mod *= 1.15; why.push('HRV below baseline'); }
  if (w.ctl != null && w.atl != null && w.ctl - w.atl < -25) { mod *= 1.1; why.push('deep fatigue (TSB)'); }
  const rem = [];
  for (const a of recent) {
    const IF = (a.intensity || 70) / 100;
    const r = IF < 0.7 ? 0.2 : IF < 0.8 ? 0.28 : IF < 0.9 ? 0.38 : 0.5;
    const end = new Date(new Date(a.start).getTime() + (a.elapsedSec || a.movingSec || 0) * 1000);
    const left = a.load * r * mod - Math.max(0, (now - end) / 3600000);
    if (left > 0) rem.push({ left, a });
  }
  rem.sort((x, y) => y.left - x.left);
  const hours = rem.length ? Math.min(96, Math.round(rem[0].left + 0.5 * rem.slice(1).reduce((s, x) => s + x.left, 0))) : 0;
  return { hours, from: rem[0]?.a || null, mod, why };
}

// ---------------------------------------------------------------------------------------------
// SLEEP COACH — tonight's need:
//   base 8 h (endurance athletes in heavy training: 8–10 h; Settings → sleep baseline)
//   + strain: (today's load − 50) / 100 h, 0 … +1.5 h        (150 TSS → +1 h)
//   + debt: ¼ of the last 7 nights' shortfall vs. each night's need, max +1 h
// ---------------------------------------------------------------------------------------------
const strainH = (L) => clamp((L - 50) / 100, 0, 1.5);
export function sleepCoach(well, acts, now = new Date()) {
  const s = load();
  const base = s.sleepBaseH || 8;
  const loadOn = (iso) => acts.filter(a => a.date === iso).reduce((t, a) => t + (a.load || 0), 0);
  const today = isoDate(now);
  const nights = [];
  for (let i = 7; i >= 1; i--) {
    const d = isoDate(addDays(now, -i + 1));          // wellness on date d = the night before d
    const w = well.find(x => x.date === d);
    const need = base + strainH(loadOn(isoDate(addDays(parseDate(d), -1))));
    nights.push({ date: d, slept: w?.sleepSecs ? w.sleepSecs / 3600 : null, need, score: w?.sleepScore ?? null });
  }
  const known = nights.filter(n => n.slept != null);
  const debt = known.reduce((t, n) => t + Math.max(0, n.need - n.slept), 0);
  const tLoad = loadOn(today);
  const add = strainH(tLoad), repay = Math.min(1, debt / 4);
  const need = base + add + repay;
  return { need, base, add, repay, debt, tLoad, nights, avg7: known.length ? mean(known.map(n => n.slept)) : null, met: known.filter(n => n.slept >= n.need - 0.25).length, known: known.length };
}
export const fmtH = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };

// ---------------------------------------------------------------------------------------------
// TIPS — chosen from the current state (sport-science consensus: ISSN / IOC statements).
// ---------------------------------------------------------------------------------------------
export function recoveryTips(rd, rec, sc) {
  const kg = load().weightKg || 75;
  const t = [];
  const big = sc.tLoad >= 120;
  if (rec.hours >= 36) t.push(['Next 24 h easy', 'Keep tomorrow in zone 1–2 or rest. A hard session before you have recovered adds fatigue, not fitness.']);
  else if (rec.hours >= 12) t.push(['Light movement', '20–30 min easy spin or walk increases blood flow without adding load.']);
  if (sc.tLoad > 0) t.push(['Refuel carbs', `${big ? `About ${Math.round(kg * 1.0)}–${Math.round(kg * 1.2)} g of carbohydrate per hour for the first 4 h after long sessions` : `A carb-rich meal within 2 h`} — refills glycogen fastest.`]);
  t.push(['Protein', `${Math.round(kg * 0.3)}–${Math.round(kg * 0.4)} g protein every 3–4 h, plus ~40 g (e.g. quark/casein) before bed for overnight muscle repair.`]);
  if (sc.tLoad >= 80) t.push(['Rehydrate', 'Drink ~1.5 L for every kg you lost in the session, with some salt (sodium helps you keep the fluid).']);
  t.push(['Sleep', `Tonight's target ${fmtH(sc.need)}${sc.debt > 1 ? ` — you're ${fmtH(sc.debt)} short over the last week` : ''}. Sleep is when most adaptation happens.`]);
  if (rec.why.includes('HRV below baseline')) t.push(['Stress check', 'HRV is below your baseline: skip intensity, keep caffeine early, and wind down 30–60 min before bed.']);
  if (rd && rd.now < 45) t.push(['Low readiness', 'Swap a key session for an easy one or a rest day; your plan will reschedule it.']);
  return t;
}
