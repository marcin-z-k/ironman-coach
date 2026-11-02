// Secondary race predictors — read-only references from your logged activities.
// They never change your goal, plan or targets.
//   Run:   your run threshold → race pace by distance (same model as the main prediction:
//          5 k 0.97×, 10 k 1.0×, half 1.05×, marathon 1.12× threshold; walk breaks beyond the
//          distance you can run continuously)
//   Bike:  outdoor FTP × sustainable intensity for the duration, IF = 0.97·t^−0.17 (t in h:
//          1 h 0.97 · 2.5 h 0.83 · 5 h 0.74), speed on flat road from power (CdA 0.35, Crr 0.005)
//   Swim:  pool pace with fade beyond your continuous-swim distance (no wetsuit)
//   Triathlon (only when you have swims, rides AND runs): the full race model for each format
import { predict } from './predict.js';
import { ftpCoupling, flatSpeedFor } from './analytics.js';
import { TRI } from './goals.js';

const RUN = [['5 km', 5], ['10 km', 10], ['Half marathon', 21.0975], ['Marathon', 42.195]];
const BIKE = [['20 km TT', 20], ['40 km TT', 40], ['90 km', 90], ['180 km', 180]];
const SWIM = [['400 m', 400], ['1500 m', 1500], ['1.9 km', 1900], ['3.8 km', 3800]];

export function availableCategories(acts) {
  const has = sp => acts.some(a => a.sport === sp);
  const c = [];
  if (has('run')) c.push('run');
  if (has('bike')) c.push('bike');
  if (has('swim')) c.push('swim');
  if (has('run') && has('bike') && has('swim')) c.push('tri');
  return c;
}

export function secondaryPredictions(cat, b, s, acts) {
  const sGoal = (goal) => ({ ...s, planSource: 'goal', goal });
  if (cat === 'run') return RUN.map(([label, km]) => { const p = predict(b, sGoal({ type: 'run', runKm: km }), {}); return { label, sec: p.runSec, pace: p.runSec / km, unit: '/km', note: p.run.walkKm > 0 ? `incl. ${Math.round(p.run.walkKm * 10) / 10} km run/walk` : '' }; });
  if (cat === 'swim') return SWIM.map(([label, m]) => { const p = predict(b, sGoal({ type: 'swim', swimM: m }), { wetsuit: false }); return { label, sec: p.swimSec, pace: p.swimSec / (m / 100), unit: '/100m', note: p.swim.cont < m ? `${Math.max(0, Math.floor(m / p.swim.cont - 1))} short stops` : '' }; });
  if (cat === 'bike' || cat.startsWith('bike_')) {
    const c = ftpCoupling(acts, s);
    const ftp = (s.outdoorPower && s.ftpOutdoor) || c.outdoorNow || s.ftpOutdoor || Math.round(s.ftp * 1.1);
    const m = (s.weightKg || 75) + 9;
    const list = cat === 'bike' ? BIKE : [['', +cat.slice(5)]];
    return list.map(([label, km]) => {
      let t = km / 30;                                    // hours, iterate
      let P = 0, v = 0;
      for (let i = 0; i < 8; i++) { const IF = Math.min(1.0, 0.97 * Math.pow(Math.max(0.3, t), -0.17)); P = ftp * IF; v = flatSpeedFor(P, m); t = km * 1000 / v / 3600; }
      return { label, sec: t * 3600, kmh: Math.round(v * 36) / 10, unit: 'km/h', note: `${Math.round(P)} W (${Math.round(P / ftp * 100)} % of ${ftp} W ${c.single ? 'FTP' : 'outdoor FTP'}), flat` };
    });
  }
  if (cat === 'tri') {
    // shorter formats are raced harder: bike at the duration-based intensity (−3 % to save the legs),
    // run at the stand-alone race pace for that distance +5 % off the bike — whichever is faster
    // than the long-distance model (which is used as is for the full distance)
    const bikeRef = (km) => secondaryPredictions('bike_' + km, b, s, acts)[0];
    return Object.entries(TRI).map(([k, t]) => {
      const p = predict(b, sGoal({ type: 'triathlon', tri: k }), { wetsuit: true });
      let bike = p.bikeSec, run = p.runSec;
      if (k !== 'full') {
        const br = bikeRef(t.bike); if (br) bike = Math.min(bike, br.sec / 0.97 ** (1 / 3));
        const rr = predict(b, sGoal({ type: 'run', runKm: t.run }), {}); run = Math.min(run, rr.runSec * 1.05);
      }
      const tot = p.swimSec + bike + run + p.transSec;
      return { label: t.label, sec: tot, note: `swim ${fmt(p.swimSec)} · bike ${fmt(bike)} · run ${fmt(run)}` };
    });
  }
  return [];
}
export const CAT_LABEL = { run: 'Running', bike: 'Cycling', swim: 'Swimming', tri: 'Triathlon' };
function fmt(sec) { const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.round(sec % 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; }
export const fmtRace = fmt;
