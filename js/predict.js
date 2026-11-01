// Race-time model that includes fatigue/fade, built from the athlete's own activities.
//  Swim: session pace + continuous-swim limit. Beyond the distance you can swim without stopping,
//        pace fades (+8% per doubling) and you lose ~25 s per forced stop. Wetsuit −5%.
//  Bike: average speed of your long OUTDOOR rides (the speed you can actually hold), +2% race-day,
//        fade if 180 km is longer than your long rides. FTP changes scale speed ∝ power^(1/3).
//  Run:  easy pace at Z2 HR (+6% off the bike) up to the distance you can run continuously,
//        then run/walk at ~1.35× easy pace. Threshold changes shift easy pace 1:1.
import { isoDate, addDays, round, clamp } from './util.js';
import { hrZoneOf } from './zones.js';
import { easyPaceSeries, continuousRun, continuousSwim } from './analytics.js';
import { raceDistances } from './goals.js';

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const since = (acts, days) => { const f = isoDate(addDays(new Date(), -days)); return acts.filter(a => a.date >= f); };

export function baseline(acts, s) {
  const out = { notes: {} };
  // swim
  const swims = since(acts, 56).filter(a => a.sport === 'swim' && a.pace100 && a.distanceM >= 800);
  const sp = swims.map(a => a.pace100).filter(p => p >= 70 && p <= 240);
  out.swimPace = sp.length ? Math.round(median(sp)) : s.css + 12;
  const cs = continuousSwim(acts, 56);
  out.swimContInfo = cs;
  out.swimCont = clamp(Math.round((s.swimContinuous || (cs ? cs.m : 400)) / 50) * 50, 100, 10000);
  out.notes.swimCont = s.swimContinuous ? 'your Settings value' : cs ? `recency-weighted average of your last ${cs.swims} pool swims (longest distance without a pause > 2 min each: ${cs.list.map(r => `${r.m} m`).join(', ')}; weight halves every 2 weeks)` : 'no swim data — 400 m assumed';
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
  const eps = easyPaceSeries(acts, 42).slice(-8).map(p => p.y);
  const runs = since(acts, 42).filter(a => a.sport === 'run' && (a.gapSecKm || a.paceSecKm) && a.movingSec >= 1500);
  out.runEasy = eps.length >= 2 ? Math.round(median(eps)) : runs.length ? Math.round(median(runs.map(a => a.gapSecKm || a.paceSecKm)) * 1.03) : Math.round(s.runThreshold * 1.28);
  out.runEasy = clamp(out.runEasy, 240, 720);
  out.notes.run = eps.length >= 2 ? `median Z2-HR pace of your last ${eps.length} runs` : 'recent runs (no Z2 data yet)';
  const longRuns = since(acts, 56).filter(a => a.sport === 'run' && a.distanceM > 0 && (a.paceSecKm || a.gapSecKm)).map(a => a.distanceM / 1000);
  out.runLongestKm = longRuns.length ? round(Math.max(...longRuns), 1) : 10;
  // continuous running = longest stretch without walking (> 2 min slower than 9:00/km), +10 % race-day boost
  const cr = continuousRun(acts, 56);
  out.runContInfo = cr;
  out.runCont = clamp(round(s.runContinuous || (cr ? cr.km * 1.1 : Math.min(out.runLongestKm, 8)), 1), 3, 42.2);
  out.notes.runCont = s.runContinuous ? 'your Settings value' : cr ? `longest stretch without walking: ${cr.km} km (${cr.run.date})${cr.withWalk ? ` · ${cr.withWalk} recent run${cr.withWalk > 1 ? 's' : ''} with walk breaks` : ''}` : 'no run data';
  return out;
}

// d: deltas from the simulator { ftp: W, css: s/100m, thr: s/km, swimCont: m, runCont: km, wetsuit: bool }
export function predict(b, s, d = {}) {
  const D = raceDistances(s);
  // swim
  const swimPace = clamp(b.swimPace + (d.css || 0), 75, 240);
  const cont = clamp(d.swimCont ?? b.swimCont, 100, 10000);
  let swimSec = 0, fade = 1, stops = 0;
  const wetsuit = d.wetsuit ?? !!D.tri;
  if (D.swim) {
    fade = cont >= D.swim ? 1.02 : 1 + 0.08 * Math.log2(D.swim / cont);
    stops = cont >= D.swim ? 0 : Math.floor(D.swim / cont - 1) * 25;
    swimSec = D.swim / 100 * swimPace * fade * (wetsuit ? 0.95 : 1) + stops;
  }
  // bike
  const ftp0 = s.ftp, ftp1 = Math.max(60, s.ftp + (d.ftp || 0));
  let kmh = b.bikeKmh * Math.pow(ftp1 / ftp0, 1 / 3) * 1.02, bikeSec = 0;
  if (D.bike) {
    if (b.bikeLongestKm && b.bikeLongestKm < D.bike) kmh *= 1 - 0.03 * Math.log2(D.bike / Math.max(60, b.bikeLongestKm));
    bikeSec = D.bike / kmh * 3600 + (D.hm || 0) / 700 * 3600 * 0.45;    // climbing: ~700 m/h VAM, part of it already in the speed
  }
  // run
  let runSec = 0, easy = clamp(b.runEasy + (d.thr || 0), 240, 720), runPace = 0, walkPace = 0;
  const runCont = Math.min(D.run || 42.195, clamp(d.runCont ?? b.runCont, 3, 400));
  if (D.run) {
    if (D.fresh) {   // stand-alone run: race pace from threshold by distance
      const thr = clamp(s.runThreshold + (d.thr || 0), 200, 600), km = D.run;
      const f = km <= 5 ? 0.97 : km <= 10 ? 1.0 : km <= 21.1 ? 1.05 : km <= 42.2 ? 1.12 : 1.25 + Math.min(0.35, (km - 42.2) / 300);
      runPace = thr * f; walkPace = Math.max(runPace * 1.35, easy * 1.3);
    } else { runPace = easy * 1.06 * 1.03; walkPace = easy * 1.35; }   // off the bike + drift; run/walk beyond the limit
    runSec = Math.min(runCont, D.run) * runPace + Math.max(0, D.run - runCont) * walkPace;
  }
  const trans = (D.trans || 0) * 60;
  return {
    D, swimSec, bikeSec, runSec, transSec: trans, totalSec: swimSec + bikeSec + runSec + trans,
    swim: { pace: swimPace, effPace: D.swim ? swimSec / (D.swim / 100) : 0, cont, fade, stops, wetsuit },
    bike: { kmh: round(kmh, 1), ftp: ftp1 },
    run: { easy, runPace, walkPace, runCont, walkKm: round(Math.max(0, (D.run || 0) - runCont), 1) },
  };
}
