// Synthetic intervals.icu-like data so the app can be explored without credentials.
import { isoDate, addDays } from './util.js';

function rng(seed) { let x = seed; return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; }; }

export function demoAthlete() {
  return { id: 'i00000', name: 'Demo athlete', sportSettings: [
    { types: ['Ride', 'VirtualRide'], ftp: 182 },
    { types: ['Run'], threshold_pace: 1000 / 338 },
    { types: ['Swim'], threshold_pace: 100 / 109 },
  ] };
}

export function demoActivities(days = 120) {
  const r = rng(42);
  const out = [];
  const t = new Date(); t.setHours(0, 0, 0, 0);
  for (let d = days; d >= 1; d--) {
    const date = addDays(t, -d);
    const dow = date.getDay(); // 0 Sun
    const iso = isoDate(date);
    const skip = r() < 0.12;
    const mk = (type, name, min, extra) => out.push({ id: `${iso}-${type}`, type, name, start_date_local: `${iso}T${String(6 + Math.floor(r() * 12)).padStart(2, '0')}:30:00`, moving_time: Math.round(min * 60), ...extra });
    if (skip) continue;
    switch (dow) {
      case 1: mk('Swim', 'Technique swim', 45 + r() * 10, { distance: 2000 + r() * 400, icu_training_load: 35, icu_intensity: 68 }); break;
      case 2: mk('Ride', 'Sweet spot 3x12', 65 + r() * 10, { distance: 32000, icu_training_load: 70 + r() * 15, icu_intensity: 82 + r() * 6, icu_weighted_avg_watts: 158 + r() * 12, average_heartrate: 150, icu_eftp: 178 + Math.round((days - d) / 20 + r() * 4) }); break;
      case 3: mk('Run', 'Tempo run', 55 + r() * 10, { distance: 9500 + r() * 1500, icu_training_load: 60 + r() * 10, icu_intensity: 78 + r() * 8, average_heartrate: 158 }); mk('Swim', 'Aerobic swim', 40, { distance: 1900, icu_training_load: 30, icu_intensity: 65 }); break;
      case 4: mk('Ride', 'Endurance ride', 60 + r() * 15, { distance: 28000, icu_training_load: 45 + r() * 10, icu_intensity: 64 + r() * 6, icu_weighted_avg_watts: 120 + r() * 10, average_heartrate: 135, decoupling: 3 + r() * 6 }); break;
      case 5: mk('Swim', 'CSS 12x100', 50, { distance: 2400, icu_training_load: 50, icu_intensity: 80 }); mk('Run', 'Easy run', 35 + r() * 10, { distance: 5500 + r() * 800, icu_training_load: 30, icu_intensity: 64 + r() * 12, average_heartrate: 140, icu_rpe: 3 }); break;
      case 6: mk('Ride', 'Long ride', 150 + r() * 40, { distance: 75000 + r() * 15000, icu_training_load: 130 + r() * 30, icu_intensity: 66 + r() * 5, icu_weighted_avg_watts: 125 + r() * 10, average_heartrate: 138, decoupling: 4 + r() * 5 }); break;
      case 0: mk('Run', 'Long run', 80 + r() * 25, { distance: 13500 + r() * 3500, icu_training_load: 85 + r() * 20, icu_intensity: 70 + r() * 6, average_heartrate: 148, icu_rpe: 5 }); break;
    }
  }
  return out;
}

export function demoWellness(days = 120) {
  const acts = demoActivities(days);
  const loadByDate = {};
  for (const a of acts) loadByDate[a.start_date_local.slice(0, 10)] = (loadByDate[a.start_date_local.slice(0, 10)] || 0) + (a.icu_training_load || 0);
  const r = rng(7);
  const out = [];
  let ctl = 38, atl = 40;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  for (let d = days; d >= 0; d--) {
    const iso = isoDate(addDays(t, -d));
    const L = loadByDate[iso] || 0;
    ctl += (L - ctl) / 42; atl += (L - atl) / 7;
    out.push({ id: iso, ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), rampRate: +((L - ctl) / 42 * 7).toFixed(1), restingHR: Math.round(48 + r() * 5 + (atl - ctl) / 8), hrv: Math.round(68 + r() * 12 - (atl - ctl) / 4), sleepSecs: Math.round((6.4 + r() * 1.6) * 3600) });
  }
  return out;
}
