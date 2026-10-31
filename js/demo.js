// Synthetic intervals.icu-like data so the app can be explored without credentials.
import { isoDate, addDays } from './util.js';

function rng(seed) { let x = seed; return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; }; }

export function demoAthlete() {
  return { id: 'i00000', name: 'Demo athlete', sportSettings: [
    { types: ['Ride', 'VirtualRide'], ftp: 180, indoor_ftp: 150, lthr: 162, max_hr: 184, hr_zones: [131, 145, 152, 161, 166, 171, 184], power_zones: [55, 75, 90, 105, 120, 150, 999], sweet_spot_min: 84, sweet_spot_max: 97 },
    { types: ['Run'], threshold_pace: 1000 / 338, lthr: 168, max_hr: 189, hr_zones: [137, 150, 157, 166, 171, 176, 189], pace_zones: [77.5, 87.7, 94.3, 100, 103.4, 111.5, 999] },
    { types: ['Swim'], threshold_pace: 100 / 109 },
  ] };
}

function zt(min, dist) { const t = min * 60; const tot = dist.reduce((a, b) => a + b, 0); return dist.map(x => Math.round(t * x / tot)); }
function pz(min, dist) { return zt(min, dist).map((secs, i) => ({ id: 'Z' + (i + 1), secs })); }

export function demoActivities(days = 120) {
  // Mirrors the athlete's fixed week: Tue swim · Wed interval run · Thu swim · Fri indoor bike + run ·
  // Sat long run · Sun outdoor long ride (no power meter). This week: ran on Tue instead of Wed, swam Wed.
  const r = rng(42);
  const out = [];
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const dowMon = (t.getDay() + 6) % 7;
  const weekStart = addDays(t, -dowMon);
  for (let d = days; d >= 1; d--) {
    const date = addDays(t, -d);
    const iso = isoDate(date);
    let dow = date.getDay(); // 0 Sun
    const thisWeek = date >= weekStart;
    if (thisWeek && dow === 2) dow = 3;        // Tue: did the Wednesday run
    else if (thisWeek && dow === 3) dow = 2;   // Wed: did the Tuesday swim
    const prog = (days - d) / days;
    const mk = (type, name, min, extra) => out.push({ id: `${iso}-${type}-${out.length}`, type, name, start_date_local: `${iso}T${String(6 + Math.floor(r() * 12)).padStart(2, '0')}:${String(10 + out.length % 40).padStart(2, '0')}:00`, moving_time: Math.round(min * 60), ...extra });
    if (!thisWeek && r() < 0.1) continue;
    if (d === 23) { mk('Run', 'Dresden 10k', 61, { distance: 10000, race: true, average_heartrate: 171, icu_training_load: 80, icu_intensity: 98, pace_zone_times: zt(61, [0, 1, 4, 30, 19, 0, 0]), icu_hr_zone_times: zt(61, [0, 1, 3, 20, 30, 0, 0]) }); continue; }
    switch (dow) {
      case 2: { const m = 44 + r() * 8; mk('Swim', 'Technique swim', m, { distance: 2000, icu_training_load: 35, icu_intensity: 66 }); break; }
      case 3: { const m = 58 + r() * 6; const pace = 400 - prog * 25 + r() * 15; mk('Run', 'Intervals 6x3', m, { distance: Math.round(m * 60 / pace * 1000), gap: pace / 1000 * 0.99, icu_training_load: 62 + r() * 10, icu_intensity: 80 + r() * 6, average_heartrate: 156 + r() * 6, pace_zone_times: zt(m, [10, 20, 8, 18, 4, 0, 0]), icu_hr_zone_times: zt(m, [8, 18, 14, 16, 4, 0, 0]) }); break; }
      case 4: { const m = 45 + r() * 8; mk('Swim', 'Swim 2k', m, { distance: 2000, icu_training_load: 38, icu_intensity: 70 }); break; }
      case 5: {
        const m = 60;
        mk('VirtualRide', 'Zwift sweet spot', m, { trainer: true, device_watts: true, distance: 30000, icu_training_load: 68 + r() * 10, icu_intensity: 80 + r() * 6, icu_weighted_avg_watts: Math.round(118 + prog * 8 + r() * 6), average_heartrate: 146 + r() * 6, icu_eftp: Math.round(146 + prog * 8 + r() * 3), icu_pm_ftp_watts: Math.round(150 + prog * 8 + r() * 5), icu_variability_index: 1.07, icu_zone_times: pz(m, [8, 18, 10, 22, 2, 0, 0]), icu_hr_zone_times: zt(m, [10, 18, 16, 14, 2, 0, 0]) });
        const rm = 28 + r() * 6; const pace = 440 - prog * 20 + r() * 20;
        mk('Run', 'Brick run', rm, { distance: Math.round(rm * 60 / pace * 1000), gap: pace / 1000, icu_training_load: 28, icu_intensity: 70, average_heartrate: 148 + r() * 5, pace_zone_times: zt(rm, [6, 20, 4, 0, 0, 0, 0]), icu_hr_zone_times: zt(rm, [4, 18, 8, 0, 0, 0, 0]) });
        break;
      }
      case 6: { const m = 88 + r() * 8; const pace = 435 - prog * 18 + r() * 15; const fast = r() < 0.3; mk('Run', 'Long run', m, { distance: Math.round(m * 60 / pace * 1000), gap: pace / 1000 * 0.98, icu_training_load: 85 + r() * 15, icu_intensity: 70 + r() * 5, average_heartrate: fast ? 156 : 145 + r() * 6, icu_rpe: 6, pace_zone_times: zt(m, [12, 62, 12, 2, 0, 0, 0]), icu_hr_zone_times: fast ? zt(m, [6, 40, 34, 8, 0, 0, 0]) : zt(m, [10, 62, 14, 2, 0, 0, 0]) }); break; }
      case 0: { const m = 240 + r() * 70; const kmh = 27.5 + prog * 1.2 + r() * 1.5; mk('Ride', 'Sunday long ride', m, { trainer: false, device_watts: false, distance: Math.round(m / 60 * kmh * 1000), icu_training_load: 170 + r() * 40, icu_intensity: 68 + r() * 5, icu_weighted_avg_watts: Math.round(160 + r() * 20), average_heartrate: 132 + r() * 8, decoupling: 4 + r() * 5, icu_zone_times: pz(m, [30, 150, 50, 10, 0, 0, 0]), icu_hr_zone_times: zt(m, [40, 170, 30, 4, 0, 0, 0]) }); break; }
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
    out.push({ id: iso, ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), rampRate: +((L - ctl) / 42 * 7).toFixed(1), restingHR: Math.round(48 + r() * 5 + (atl - ctl) / 8), hrv: Math.round(68 + r() * 12 - (atl - ctl) / 4), sleepSecs: Math.round((6.4 + r() * 1.6) * 3600), sleepScore: Math.round(62 + r() * 30), vo2max: d % 7 === 0 ? +(47 + (days - d) / days * 1.6 + r() * 0.4).toFixed(1) : null });
  }
  return out;
}
