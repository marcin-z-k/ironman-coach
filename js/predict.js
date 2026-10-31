// Race-time model that includes fatigue/fade, built from the athlete's own activities.
//  Swim: session pace + continuous-swim limit. Beyond the distance you can swim without stopping,
//        pace fades (+8% per doubling) and you lose ~25 s per forced stop. Wetsuit −5%.
//  Bike: average speed of your long OUTDOOR rides (the speed you can actually hold), +2% race-day,
//        fade if 180 km is longer than your long rides. FTP changes scale speed ∝ power^(1/3).
//  Run:  easy pace at Z2 HR (+6% off the bike) up to the distance you can run continuously,
//        then run/walk at ~1.35× easy pace. Threshold changes shift easy pace 1:1.
import { isoDate, addDays, round, clamp } from './util.js';
import { hrZoneOf } from './zones.js';

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const since = (acts, days) => { const f = isoDate(addDays(new Date(), -days)); return acts.filter(a => a.date >= f); };

export function baseline(acts, s) {
  const out = { notes: {} };
  // swim
  const swims = since(acts, 56).filter(a => a.sport === 'swim' && a.pace100 && a.distanceM >= 800);
  out.swimPace = swims.length ? Math.round(median(swims.map(a => a.pace100))) : s.css + 12;
  out.swimCont = s.swimContinuous || 600;
  out.notes.swim = swims.length ? `median of ${swims.length} swims (8 wk)` : 'CSS + 12 s (no recent swims)';
  // bike — long outdoor rides
  const rides = since(acts, 70).filter(a => a.sport === 'bike' && !a.indoor && a.movingSec >= 2.5 * 3600 && a.distanceM > 0);
  const longest = rides.length ? Math.max(...rides.map(a => a.distanceM / 1000)) : 0;
  if (rides.length) {
    const sp = rides.map(a => a.distanceM / a.movingSec * 3.6).sort((a, b) => b - a).slice(0, 4);
    out.bikeKmh = round(median(sp), 1);
    out.notes.bike = `${rides.length} outdoor rides ≥ 2.5 h (10 wk), longest ${Math.round(longest)} km`;
  } else {
    out.bikeKmh = 27;
    out.notes.bike = 'no long outdoor rides yet — assumed 27 km/h';
  }
  out.bikeLongestKm = longest;
  // run — easy pace at Z2 HR, longest continuous run
  const runs = since(acts, 42).filter(a => a.sport === 'run' && (a.gapSecKm || a.paceSecKm) && a.movingSec >= 1500);
  const z2 = runs.filter(a => a.avgHr && hrZoneOf('run', a.avgHr) <= 2).map(a => a.gapSecKm || a.paceSecKm);
  out.runEasy = z2.length >= 2 ? Math.round(median(z2)) : runs.length ? Math.round(median(runs.map(a => a.gapSecKm || a.paceSecKm)) * 1.03) : Math.round(s.runThreshold * 1.28);
  out.notes.run = z2.length >= 2 ? `median of ${z2.length} runs at Z2 HR (6 wk)` : 'all recent runs (no HR zones)';
  const longRuns = since(acts, 56).filter(a => a.sport === 'run').map(a => a.distanceM / 1000);
  out.runLongestKm = longRuns.length ? round(Math.max(...longRuns), 1) : 10;
  out.runCont = clamp(round((s.runContinuous || out.runLongestKm * 1.25), 1), 5, 42.2);
  return out;
}

// d: deltas from the simulator { ftp: W, css: s/100m, thr: s/km, swimCont: m, runCont: km, wetsuit: bool }
export function predict(b, s, d = {}) {
  // swim
  const swimPace = b.swimPace + (d.css || 0);
  const cont = clamp(d.swimCont ?? b.swimCont, 100, 4000);
  const fade = cont >= 3800 ? 1.02 : 1 + 0.08 * Math.log2(3800 / cont);
  const stops = cont >= 3800 ? 0 : Math.floor(3800 / cont - 1) * 25;
  const wetsuit = d.wetsuit ?? true;
  const swimSec = 38 * swimPace * fade * (wetsuit ? 0.95 : 1) + stops;
  // bike
  const ftp0 = s.ftp, ftp1 = Math.max(60, s.ftp + (d.ftp || 0));
  let kmh = b.bikeKmh * Math.pow(ftp1 / ftp0, 1 / 3) * 1.02;
  if (b.bikeLongestKm && b.bikeLongestKm < 180) kmh *= 1 - 0.03 * Math.log2(180 / Math.max(60, b.bikeLongestKm));
  const bikeSec = 180 / kmh * 3600;
  // run
  const easy = Math.max(240, b.runEasy + (d.thr || 0));
  const runCont = clamp(d.runCont ?? b.runCont, 3, 42.2) >= 42.2 ? 42.195 : clamp(d.runCont ?? b.runCont, 3, 42.2);
  const runPace = easy * 1.06 * 1.03;      // off the bike + drift
  const walkPace = easy * 1.35;           // run/walk
  const runSec = Math.min(runCont, 42.195) * runPace + Math.max(0, 42.195 - runCont) * walkPace;
  const trans = 12 * 60;
  return {
    swimSec, bikeSec, runSec, transSec: trans, totalSec: swimSec + bikeSec + runSec + trans,
    swim: { pace: swimPace, effPace: swimSec / 38, cont, fade, stops, wetsuit },
    bike: { kmh: round(kmh, 1), ftp: ftp1 },
    run: { easy, runPace, walkPace, runCont, walkKm: round(Math.max(0, 42.195 - runCont), 1) },
  };
}
