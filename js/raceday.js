// Race Day: realistic pacing + fueling plan, fueling chart, device export, printable race card.
//
// PACING (from your CURRENT estimates, so the plan is finishable even if the time goal is ambitious)
//   Swim  — predicted pool pace with fade beyond your continuous-swim distance, wetsuit −5 %.
//   Bike  — outdoor FTP × IF, IF = 0.95 · 0.97 · t^−0.17 (t = predicted bike hours; ≈ 0.68–0.72 for
//           5.5–6.5 h, keeps legs for the run). Settle-in first 20 km at 93 %, last 30 km at 97 %.
//           HR cap: top of your bike zone 2. Speed from your long outdoor rides.
//   Run   — first 10 km 10 s/km slower than your race pace, then race pace up to the distance you can
//           run continuously, then run/walk (walk ~1 min through each aid station).
// FUELING
//   Bike  — 85 g carbs/h (your gut-training target 80–90), 600 ml fluid/h, 600 mg sodium/h.
//           Carbs from your bottles first (bottle size / carbs / sodium from Settings), gels for the
//           rest, salt capsules for the sodium still missing. Start after 20 min, stop 15 min before T2.
//   Run   — 60 g carbs/h (50–70) mostly gels, 500 ml/h, 500 mg sodium/h.
//   Supported: drinks at aid stations (bike every 20 km, run every 2.5 km). Unsupported: you carry all.
// Course: no route loaded yet → flat placeholder profile (distance only).
import { predict } from './predict.js';
import { ftpCoupling, hrZone2 } from './analytics.js';
import { getZoneModel } from './zones.js';
import { GUT } from './nutrition.js';
import { loadFit, download } from './export.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mid = a => (a[0] + a[1]) / 2;

export function raceDayPlan(A, s, acts) {
  const b = A.goal.base;
  const p = predict(b, s, { wetsuit: true });
  const D = p.D;
  const sup = s.raceSupported !== false;
  const gel = s.gelCarbs || 25, gelNa = s.gelSodium ?? 50;
  const btlMl = s.bottleMl || 750, btlC = s.bottleCarbs ?? 60, btlNa = s.bottleSodium ?? 300, cap = s.saltCapMg || 250;
  const out = { D, p, sup, legs: {} };

  // ---- swim
  if (D.swim) out.legs.swim = { sec: p.swimSec, pace: p.swim.effPace, note: Math.floor(D.swim / p.swim.cont - 1) >= 1 ? `Expect ${Math.floor(D.swim / p.swim.cont - 1)} short breaks (backstroke / sculling, 20–30 s) — calm, long strokes.` : 'Start wide, find feet to draft, steady effort; ease into it for the first 200 m.' };

  // ---- bike
  if (D.bike) {
    const ftp = (s.outdoorPower && s.ftpOutdoor) || ftpCoupling(acts, s).outdoorNow || s.ftpOutdoor || Math.round(s.ftp * 1.1);
    const ftpLabel = ftpCoupling(acts, s).single ? 'FTP' : 'outdoor FTP';
    const hrs = p.bikeSec / 3600;
    const IF = clamp(0.95 * 0.97 * Math.pow(Math.max(0.5, hrs), -0.17), 0.6, 0.9);
    const P = ftp * IF, kmh = D.bike / hrs, z2 = hrZone2();
    const s1 = Math.min(20, D.bike * 0.12), s3 = Math.max(s1, D.bike - Math.min(30, D.bike * 0.17));
    const segs = [
      { from: 0, to: s1, w: Math.round(P * 0.93), label: 'Settle in — let HR come down after the swim' },
      { from: s1, to: s3, w: Math.round(P), label: 'Steady — same watts uphill and on the flat, ease off downhill' },
      { from: s3, to: D.bike, w: Math.round(P * 0.97), label: 'Spin a little easier, prepare legs for the run' },
    ].filter(x => x.to > x.from);
    const fuel = fuelEvents('bike', hrs * 60, kmh, { carbsH: mid(GUT.bike.to), fluidH: 600, naH: 600, gel, gelNa, btlMl, btlC, btlNa, cap, sup, aidKm: 20, dist: D.bike });
    out.legs.bike = { sec: p.bikeSec, kmh, ftp, ftpLabel, IF, P: Math.round(P), hrCap: z2 ? z2[1] : null, segs, ...fuel };
  }

  // ---- run
  if (D.run) {
    const rp = p.run.runPace, cont = Math.min(D.run, p.run.runCont), wp = p.run.walkPace;
    const segs = [];
    const e1 = Math.min(10, cont);
    segs.push({ from: 0, to: e1, pace: rp + 10, label: 'Hold back — 10 s/km slower than race pace' });
    if (cont > e1) segs.push({ from: e1, to: cont, pace: rp, label: 'Race pace, walk only through aid stations' });
    if (D.run > cont) segs.push({ from: cont, to: D.run, pace: wp, label: 'Run/walk: run between aid stations, walk 1 min through each' });
    const sec = segs.reduce((t, x) => t + (x.to - x.from) * x.pace, 0);
    const zr = getZoneModel().run.hr;
    const fuel = fuelEvents('run', sec / 60, D.run / (sec / 3600), { carbsH: mid(GUT.run.to), fluidH: 500, naH: 500, gel, gelNa, btlMl: 500, btlC: 0, btlNa: 0, cap, sup, aidKm: 2.5, dist: D.run, paceSegs: segs });
    out.legs.run = { sec, segs, hrCap: zr?.[1] || null, ...fuel };
  }
  out.trans = p.transSec;
  out.total = (out.legs.swim?.sec || 0) + (out.legs.bike?.sec || 0) + (out.legs.run?.sec || 0) + out.trans;
  return out;
}

// time (min into leg) → km, using pace segments for the run or constant speed for the bike
function kmAt(tMin, kmh, segs) {
  if (!segs) return kmh * tMin / 60;
  let t = tMin * 60;
  for (const sg of segs) { const d = (sg.to - sg.from) * sg.pace; if (t <= d) return sg.from + t / sg.pace; t -= d; }
  return segs[segs.length - 1].to;
}

function fuelEvents(leg, min, kmh, o) {
  const ev = [];
  const fluidH = o.fluidH;
  // carbs from drink (bike only — your bottle mix)
  const drinkCH = o.btlC ? fluidH / o.btlMl * o.btlC : 0;
  const drinkNaH = o.btlC || o.btlNa ? fluidH / o.btlMl * o.btlNa : 0;
  const gelCH = Math.max(0, o.carbsH - drinkCH);
  const gelEvery = gelCH > 0 ? o.gel / gelCH * 60 : null;                  // min
  const naFromGels = gelEvery ? 60 / gelEvery * o.gelNa : 0;
  const naMissing = Math.max(0, o.naH - drinkNaH - naFromGels);
  const saltEvery = naMissing > 50 ? o.cap / naMissing * 60 : null;
  const start = 20, stop = min - 15;
  const at = (t) => kmAt(t, kmh, o.paceSegs);
  if (gelEvery) for (let t = start, i = 1; t <= stop; t += gelEvery, i++) ev.push({ t, km: at(t), type: 'gel', label: `Gel ${i} (${o.gel} g)`, g: o.gel, mg: o.gelNa });
  if (saltEvery) for (let t = start + 30, i = 1; t <= stop; t += saltEvery, i++) ev.push({ t, km: at(t), type: 'salt', label: `Salt capsule ${i} (${o.cap} mg)`, mg: o.cap });
  if (leg === 'bike' || !o.sup) for (let t = 15; t <= min - 5; t += 15) ev.push({ t, km: at(t), type: 'drink', label: leg === 'bike' ? `Drink ~${Math.round(fluidH / 4)} ml${o.btlC ? ` (≈${Math.round(drinkCH / 4)} g carbs)` : ''}` : `Sip ~${Math.round(fluidH / 4)} ml from your flask`, ml: fluidH / 4, g: leg === 'bike' ? drinkCH / 4 : 0 });
  const aid = [];
  if (o.sup) for (let k = o.aidKm; k < o.dist - 0.5; k += o.aidKm) aid.push({ km: k, label: leg === 'bike' ? 'Aid station: swap bottle' : 'Aid station: 1–2 cups water, sponge, walk ~1 min' });
  if (o.sup && leg === 'run') for (const a of aid) ev.push({ t: null, km: a.km, type: 'drink', label: a.label, ml: 200 });
  ev.sort((x, y) => x.km - y.km);
  const hrs = min / 60;
  const gels = ev.filter(e => e.type === 'gel').length, caps = ev.filter(e => e.type === 'salt').length;
  const bottles = leg === 'bike' ? Math.ceil(fluidH * hrs / o.btlMl) : 0;
  const totals = { carbs: Math.round(gels * o.gel + drinkCH * hrs), fluid: Math.round(fluidH * hrs), sodium: Math.round(drinkNaH * hrs + gels * o.gelNa + caps * o.cap), gels, caps, bottles,
    perHour: { carbs: Math.round(o.carbsH), fluid: fluidH, sodium: o.naH } };
  const carry = leg === 'bike'
    ? (o.sup ? [`${gels} gels`, caps ? `${caps} salt capsules` : null, `2 bottles of your mix at the start, then ${Math.max(0, bottles - 2)} from aid stations (every ${o.aidKm} km)`] : [`${gels} gels`, caps ? `${caps} salt capsules` : null, `${bottles} bottles of your mix (${bottles > 3 ? 'more than you can carry — plan special-needs/refill stops' : 'on the bike'})`])
    : (o.sup ? [`${gels} gels (belt/pockets)`, caps ? `${caps} salt capsules` : null, 'water and cola at aid stations'] : [`${gels} gels`, caps ? `${caps} salt capsules` : null, `${Math.ceil(fluidH * hrs / 500)} × 500 ml flasks (plan refills)`]);
  return { events: ev, aid, totals, carry: carry.filter(Boolean), gelEvery, saltEvery };
}

// ---- FIT export: one workout per leg, distance-based steps; each fueling item is its own step,
// so the watch alerts you at the right kilometre (works without a course/GPS track).
export async function exportRaceFit(plan, leg, s) {
  const L = plan.legs[leg]; if (!L) return;
  const { Encoder, Profile } = await loadFit();
  const enc = new Encoder();
  const marks = L.events.filter(e => e.type !== 'drink' || leg === 'run').map(e => ({ km: e.km, label: e.label }));
  // merge items closer than 300 m
  const pts = [];
  for (const m of marks) { const last = pts[pts.length - 1]; if (last && m.km - last.km < 0.3) last.label += ' + ' + m.label.replace(/ \(.*\)/, ''); else pts.push({ ...m }); }
  const cuts = [...new Set([0, ...L.segs.map(x => x.to), ...pts.map(x => x.km)])].filter(k => k >= 0).sort((a, b) => a - b);
  const steps = [];
  for (let i = 0; i < cuts.length - 1 && steps.length < 48; i++) {
    const a = cuts[i], bkm = cuts[i + 1]; if (bkm - a < 0.05) continue;
    const seg = L.segs.find(x => a >= x.from - 1e-6 && a < x.to) || L.segs[L.segs.length - 1];
    const ev = pts.find(x => Math.abs(x.km - a) < 1e-6);
    const name = (ev ? ev.label : seg.label).slice(0, 50);
    const target = leg === 'bike'
      ? { targetType: 'power', targetValue: 0, customTargetValueLow: 1000 + Math.round(seg.w * 0.95), customTargetValueHigh: 1000 + Math.round(seg.w * 1.05) }
      : { targetType: 'speed', targetValue: 0, customTargetValueLow: Math.round(1000 / (seg.pace + 10) * 1000), customTargetValueHigh: Math.round(1000 / Math.max(180, seg.pace - 10) * 1000) };
    steps.push({ wktStepName: name.slice(0, 30), notes: name, intensity: 'active', durationType: 'distance', durationValue: Math.round((bkm - a) * 1000 * 100), ...target });
  }
  enc.onMesg(Profile.MesgNum.FILE_ID, { type: 'workout', manufacturer: 'development', product: 0, timeCreated: new Date(), serialNumber: Math.floor(Math.random() * 1e9) });
  enc.onMesg(Profile.MesgNum.WORKOUT, { wktName: `Race ${leg}`.slice(0, 30), sport: leg === 'bike' ? 'cycling' : 'running', subSport: leg === 'bike' ? 'road' : 'street', numValidSteps: steps.length });
  steps.forEach((m, i) => enc.onMesg(Profile.MesgNum.WORKOUT_STEP, { messageIndex: i, ...m }));
  download(enc.close(), `race-day-${leg}.fit`, 'application/octet-stream');
}
