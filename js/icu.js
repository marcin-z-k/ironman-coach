// intervals.icu API client. Basic auth: user "API_KEY", password = your API key.
import { load, getCache, setCache } from './store.js';
import { demoActivities, demoWellness, demoAthlete } from './demo.js';
import { isoDate, addDays } from './util.js';

const BASE = 'https://intervals.icu/api/v1';

function authHeader(apiKey) {
  return 'Basic ' + btoa(`API_KEY:${apiKey}`);
}

async function get(path, params = {}) {
  const s = load();
  const qs = new URLSearchParams(params).toString();
  let url = `${BASE}/athlete/${encodeURIComponent(s.athleteId)}${path}${qs ? '?' + qs : ''}`;
  if (s.corsProxy) url = s.corsProxy + encodeURIComponent(url);
  const res = await fetch(url, { headers: { Authorization: authHeader(s.apiKey), Accept: 'application/json' } });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg += ` ${j.error || j.message || ''}`; } catch {}
    const e = new Error(`intervals.icu ${msg}`.trim());
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// Older activities (for the all-history baseline of the goal rings).
export async function fetchActivitiesRange(oldest, newest) {
  if (load().demo) return [];
  return ((await get('/activities', { oldest, newest })) || []).map(normalizeActivity).filter(Boolean);
}

export async function fetchAll({ days = 150, wellnessDays = 200 } = {}) {
  const s = load();
  const today = new Date();
  const oldest = isoDate(addDays(today, -days));
  const wOldest = isoDate(addDays(today, -wellnessDays));
  const newest = isoDate(addDays(today, 1));

  if (s.demo) {
    const data = { athlete: demoAthlete(),
      activities: demoActivities(days).map(normalizeActivity).filter(Boolean).sort((a, b) => b.start.localeCompare(a.start)),
      wellness: demoWellness(wellnessDays).map(normalizeWellness), fetchedAt: Date.now(), demo: true };
    setCache('data', data);
    return data;
  }

  const [athlete, activities, wellness] = await Promise.all([
    get('', {}).catch(() => null),
    get('/activities', { oldest, newest }),
    get('/wellness', { oldest: wOldest, newest }).catch(() => []),
  ]);
  const data = {
    athlete,
    activities: (activities || []).map(normalizeActivity).filter(Boolean).sort((a, b) => b.start.localeCompare(a.start)),
    wellness: (wellness || []).map(normalizeWellness).sort((a, b) => a.date.localeCompare(b.date)),
    fetchedAt: Date.now(),
  };
  setCache('data', data);
  return data;
}

export function cached() { return getCache('data'); }

export function sportOf(type = '') {
  const t = type.toLowerCase();
  if (t.includes('swim')) return 'swim';
  if (t.includes('ride') || t.includes('bike') || t.includes('cycl') || t === 'virtualride') return 'bike';
  if (t.includes('run')) return 'run';
  if (t.includes('walk') || t.includes('hike')) return 'walk';   // counts for load, not for run analytics
  if (t.includes('weight') || t.includes('strength') || t.includes('workout') || t.includes('yoga')) return 'strength';
  return 'other';
}

// Plausible ranges; anything else is a pause / GPS error and is ignored.
export function sanePace(sport, secKm) {
  if (secKm == null || !isFinite(secKm)) return null;
  return sport === 'run' ? (secKm >= 150 && secKm <= 840 ? secKm : null) : secKm;
}

export function normalizeActivity(a) {
  if (!a || !a.start_date_local) return null;
  const sport = sportOf(a.type);
  const moving = a.moving_time || a.elapsed_time || 0;
  const dist = a.distance || 0;
  return {
    id: String(a.id),
    name: a.name || a.type,
    type: a.type,
    sport,
    start: a.start_date_local,            // "2026-10-28T06:30:00"
    date: a.start_date_local.slice(0, 10),
    movingSec: moving,
    distanceM: dist,
    load: (a.icu_training_load ?? a.training_load) != null ? Math.round(a.icu_training_load ?? a.training_load) : null,
    intensity: a.icu_intensity != null ? Math.round(a.icu_intensity) : null,  // IF as % (e.g. 78)
    avgHr: a.average_heartrate ?? null,
    maxHr: a.max_heartrate ?? null,
    avgW: a.average_watts != null ? Math.round(a.average_watts) : null,
    np: a.icu_weighted_avg_watts != null ? Math.round(a.icu_weighted_avg_watts) : null,
    avgSpeed: a.average_speed ?? (moving ? dist / moving : null), // m/s
    elev: a.total_elevation_gain ?? null,
    rpe: a.icu_rpe ?? null,
    feel: a.feel ?? null,
    ftp: a.icu_ftp ?? null,
    eftp: (a.icu_eftp ?? a.eftp) != null ? Math.round(a.icu_eftp ?? a.eftp) : null,
    decoupling: a.decoupling ?? null,
    pmFtp: a.icu_pm_ftp_watts ?? a.icu_pm_ftp ?? null,           // FTP from this activity's power model
    race: !!a.race,
    trainer: !!a.trainer,
    indoor: !!a.trainer || /virtual/i.test(a.type || ''),
    deviceWatts: a.device_watts ?? null,               // false = estimated (e.g. Strava) power
    vi: a.icu_variability_index ?? null,
    // intervals.icu 'gap' is a SPEED in m/s (older docs say sec/m) — handle both, drop GPS nonsense
    gapSecKm: sanePace(sport, a.gap ? (a.gap > 1 ? 1000 / a.gap : a.gap * 1000) : null),
    elapsedSec: a.elapsed_time ?? moving,
    calories: a.calories ?? null,
    avgCadence: a.average_cadence ?? null,
    avgTemp: a.average_temp ?? null,
    location: a.location || a.locality || null,
    streamTypes: a.stream_types || null,
    hrZoneSecs: Array.isArray(a.icu_hr_zone_times) ? a.icu_hr_zone_times : null,
    powerZoneSecs: Array.isArray(a.icu_zone_times) ? a.icu_zone_times.filter(z => /^Z\d$/.test(z.id)).sort((x, y) => x.id.localeCompare(y.id)).map(z => z.secs) : null,
    paceZoneSecs: Array.isArray(a.gap_zone_times) && a.use_gap_zone_times !== false && a.gap_zone_times.some(Boolean) ? a.gap_zone_times : (Array.isArray(a.pace_zone_times) ? a.pace_zone_times : null),
    lthr: a.lthr ?? null,
    efficiency: a.icu_efficiency_factor ?? null,
    description: a.description || '',
    paceSecKm: sanePace(sport, sport === 'run' && moving && dist ? moving / (dist / 1000) : null),
    pace100: sport === 'swim' && moving && dist ? moving / (dist / 100) : null,
    speedKmh: sport === 'bike' && moving && dist ? (dist / 1000) / (moving / 3600) : null,
  };
}

export function normalizeWellness(w) {
  return {
    date: w.id || w.date,
    ctl: w.ctl ?? null,
    atl: w.atl ?? null,
    ramp: w.rampRate ?? null,
    restingHR: w.restingHR ?? null,
    hrv: w.hrv ?? null,
    sleepSecs: w.sleepSecs ?? null,
    sleepScore: w.sleepScore ?? null,
    readiness: w.readiness ?? null,
    soreness: w.soreness ?? null,
    fatigue: w.fatigue ?? null,
    weight: w.weight ?? null,
    vo2max: w.vo2max ?? null,
    sleepQuality: w.sleepQuality ?? null,
    avgSleepingHR: w.avgSleepingHR ?? null,
    spO2: w.spO2 ?? null,
    stress: w.stress ?? null,
  };
}

// Pull thresholds from athlete profile sport settings when available.
export function thresholdsFromAthlete(athlete) {
  // Ride: indoor_ftp → indoor FTP; ftp → outdoor FTP (indoor FTP is never seeded from the outdoor value)
  const out = {};
  const list = athlete?.sportSettings || [];
  for (const ss of list) {
    const types = (ss.types || []).map(t => t.toLowerCase());
    if (types.some(t => t.includes('ride'))) {
      if (ss.indoor_ftp) out.ftp = Math.round(ss.indoor_ftp);
      if (ss.ftp) out.ftpOutdoor = Math.round(ss.ftp);
    }
    if (types.some(t => t === 'run') && ss.threshold_pace) out.runThreshold = Math.round(1000 / ss.threshold_pace);
    if (types.some(t => t.includes('swim')) && ss.threshold_pace) out.css = Math.round(100 / ss.threshold_pace);
  }
  return out;
}

// Upsert planned workouts into the intervals.icu calendar (matched by external_id).
export async function pushEvents(events) {
  const s = load();
  if (s.demo) { await new Promise(r => setTimeout(r, 400)); return events.map((e, i) => ({ id: i, ...e })); }
  let url = `${BASE}/athlete/${encodeURIComponent(s.athleteId)}/events/bulk?upsert=true`;
  if (s.corsProxy) url = s.corsProxy + encodeURIComponent(url);
  const res = await fetch(url, { method: 'POST', headers: { Authorization: authHeader(s.apiKey), 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(events) });
  if (!res.ok) { let m = `intervals.icu ${res.status}`; try { const j = await res.json(); m += ' ' + (j.error || j.message || ''); } catch {} const e = new Error(m.trim()); e.status = res.status; throw e; }
  return res.json();
}

// Second-by-second streams for one activity.
export async function fetchStreams(id) {
  const s = load();
  let url = `${BASE}/activity/${encodeURIComponent(id)}/streams?types=time,heartrate,velocity_smooth,cadence,altitude,distance,latlng,watts,temp`;
  if (s.corsProxy) url = s.corsProxy + encodeURIComponent(url);
  const res = await fetch(url, { headers: { Authorization: authHeader(s.apiKey), Accept: 'application/json' } });
  if (!res.ok) { const e = new Error(`streams ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}
