// Synthetic intervals.icu-like data so the app can be explored without credentials.
import { isoDate, addDays } from './util.js';

function rng(seed) { let x = seed; return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; }; }

export function demoAthlete() {
  return { id: 'i00000', name: 'Demo athlete', sportSettings: [
    { types: ['Ride', 'VirtualRide'], ftp: 182, lthr: 162, max_hr: 184, hr_zones: [131, 145, 152, 161, 166, 171, 184], power_zones: [55, 75, 90, 105, 120, 150, 999], sweet_spot_min: 84, sweet_spot_max: 97 },
    { types: ['Run'], threshold_pace: 1000 / 338, lthr: 168, max_hr: 189, hr_zones: [137, 150, 157, 166, 171, 176, 189], pace_zones: [77.5, 87.7, 94.3, 100, 103.4, 111.5, 999] },
    { types: ['Swim'], threshold_pace: 100 / 109 },
  ] };
}

function zt(min, dist) { const t = min * 60; const tot = dist.reduce((a, b) => a + b, 0); return dist.map(x => Math.round(t * x / tot)); }
function pz(min, dist) { return zt(min, dist).map((secs, i) => ({ id: 'Z' + (i + 1), secs })); }

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
    if (d === 23) { mk('Run', 'Dresden 10k', 54, { distance: 10000, race: true, average_heartrate: 171, icu_training_load: 80, icu_intensity: 98, pace_zone_times: zt(54, [0, 1, 4, 30, 19, 0, 0]), icu_hr_zone_times: zt(54, [0, 1, 3, 20, 30, 0, 0]) }); continue; }
    if (skip) continue;
    switch (dow) {
      case 1: mk('Swim', 'Technique swim', 45 + r() * 10, { distance: 2000 + r() * 400, icu_training_load: 35, icu_intensity: 68 }); break;
      case 2: { const m = 65 + r() * 10; mk('Ride', 'Sweet spot 3x12', m, { distance: 32000, icu_training_load: 70 + r() * 15, icu_intensity: 82 + r() * 6, icu_weighted_avg_watts: 158 + r() * 12, average_heartrate: 148 + r() * 6, icu_eftp: 176 + Math.round((days - d) / 12 + r() * 3), icu_pm_ftp_watts: 180 + Math.round((days - d) / 14 + r() * 6), icu_variability_index: 1.08, icu_zone_times: pz(m, [10, 18, 12, 36, 4, 0, 0]), icu_hr_zone_times: zt(m, [12, 16, 22, 30, 4, 0, 0]) }); break; }
      case 3: { const m = 55 + r() * 10; const dist = 9500 + r() * 1500; mk('Run', 'Tempo run', m, { distance: dist, gap: m * 60 / dist * 0.99, icu_training_load: 60 + r() * 10, icu_intensity: 78 + r() * 8, average_heartrate: 156 + r() * 6, pace_zone_times: zt(m, [6, 18, 30, 6, 0, 0, 0]), gap_zone_times: zt(m, [6, 18, 30, 6, 0, 0, 0]), icu_hr_zone_times: zt(m, [5, 14, 26, 14, 1, 0, 0]) }); } mk('Swim', 'Aerobic swim', 40, { distance: 1900, icu_training_load: 30, icu_intensity: 65 }); break;
      case 4: { const m = 60 + r() * 15; const hot = r() < 0.3; mk('Ride', 'Endurance ride', m, { distance: 28000, icu_training_load: 45 + r() * 10, icu_intensity: 64 + r() * 6, icu_weighted_avg_watts: 118 + r() * 12, average_heartrate: 128 + r() * 10 + (hot ? 10 : 0), decoupling: 3 + r() * 6, icu_variability_index: 1.04, icu_zone_times: pz(m, [12, 56, 6, 1, 0, 0, 0]), icu_hr_zone_times: hot ? zt(m, [8, 26, 30, 10, 0, 0, 0]) : zt(m, [20, 48, 6, 1, 0, 0, 0]) }); break; }
      case 5: mk('Swim', 'CSS 12x100', 50, { distance: 2400, icu_training_load: 50, icu_intensity: 80 }); { const m = 35 + r() * 10; const fast = r() < 0.35; mk('Run', 'Easy run', m, { distance: 5500 + r() * 800 + (fast ? 700 : 0), icu_training_load: 30, icu_intensity: 64 + r() * 12, average_heartrate: fast ? 152 : 140 + r() * 4, icu_rpe: 3, pace_zone_times: fast ? zt(m, [4, 12, 18, 3, 0, 0, 0]) : zt(m, [8, 28, 2, 0, 0, 0, 0]), icu_hr_zone_times: fast ? zt(m, [3, 12, 18, 4, 0, 0, 0]) : zt(m, [10, 26, 2, 0, 0, 0, 0]) }); } break;
      case 6: { const m = 150 + r() * 40; mk('Ride', 'Long ride', m, { distance: 75000 + r() * 15000, icu_training_load: 130 + r() * 30, icu_intensity: 66 + r() * 5, icu_weighted_avg_watts: 122 + r() * 14, average_heartrate: 132 + r() * 10, decoupling: 4 + r() * 5, icu_variability_index: 1.06, icu_eftp: 176 + Math.round((days - d) / 12 + r() * 3), icu_zone_times: pz(m, [20, 120, 22, 4, 0, 0, 0]), icu_hr_zone_times: zt(m, [30, 110, 22, 4, 0, 0, 0]) }); break; }
      case 0: { const m = 80 + r() * 25; const dist = 13500 + r() * 3500; mk('Run', 'Long run', m, { distance: dist, gap: m * 60 / dist * 0.98, icu_training_load: 85 + r() * 20, icu_intensity: 70 + r() * 6, average_heartrate: 144 + r() * 8, icu_rpe: 5, pace_zone_times: zt(m, [10, 70, 12, 1, 0, 0, 0]), icu_hr_zone_times: zt(m, [8, 62, 20, 3, 0, 0, 0]) }); break; }
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
