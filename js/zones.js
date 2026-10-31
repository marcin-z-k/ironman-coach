// Athlete zone model built from intervals.icu sport settings (HR zones in bpm, power zones in
// % of FTP, pace zones in % of threshold speed). Falls back to intervals.icu's default model.
import { paceToStr } from './util.js';
import { load } from './store.js';

const DEF_POWER = [55, 75, 90, 105, 120, 150, 999];
const DEF_PACE = [77.5, 87.7, 94.3, 100, 103.4, 111.5, 999];
const DEF_SWIM = [80, 90, 95, 100, 104, 108, 999];

let MODEL = defaultModel();

function defaultModel() {
  return {
    bike: { power: DEF_POWER, hr: null, lthr: null, maxHr: null, ss: [88, 94], source: 'default' },
    run: { pace: DEF_PACE, hr: null, lthr: null, maxHr: null, source: 'default' },
    swim: { pace: DEF_SWIM, hr: null, lthr: null, maxHr: null, source: 'default' },
  };
}

export function buildZoneModel(athlete) {
  const m = defaultModel();
  for (const ss of athlete?.sportSettings || []) {
    const types = (ss.types || []).map(t => String(t).toLowerCase());
    const sport = types.some(t => t.includes('swim')) ? 'swim' : types.some(t => t.includes('ride')) ? 'bike' : types.some(t => t === 'run' || t.includes('run')) ? 'run' : null;
    if (!sport || m[sport].source === 'intervals') continue;
    const z = m[sport];
    if (Array.isArray(ss.hr_zones) && ss.hr_zones.length >= 3) z.hr = ss.hr_zones.map(Number);
    if (ss.lthr) z.lthr = Math.round(ss.lthr);
    if (ss.max_hr) z.maxHr = Math.round(ss.max_hr);
    if (sport === 'bike' && Array.isArray(ss.power_zones) && ss.power_zones.length >= 3) z.power = ss.power_zones.map(Number);
    if (sport === 'bike' && ss.sweet_spot_min && ss.sweet_spot_max) z.ss = [ss.sweet_spot_min, ss.sweet_spot_max];
    if (sport !== 'bike' && Array.isArray(ss.pace_zones) && ss.pace_zones.length >= 3) z.pace = ss.pace_zones.map(Number);
    if (sport === 'bike' && ss.ftp) z.ftp = Math.round(ss.ftp);
    if (sport !== 'bike' && ss.threshold_pace) z.thresholdSpeed = ss.threshold_pace; // m/s
    z.source = 'intervals';
  }
  // Manual HR zones from Settings override everything (tops of Z1..Z5 in bpm)
  const man = load().manualHr;
  if (man?.enabled && Array.isArray(man.tops) && man.tops.length === 5 && man.tops.every(v => v > 40)) {
    for (const sp of ['run', 'bike']) { m[sp].hr = [...man.tops]; m[sp].lthr = man.lthr || man.tops[3]; m[sp].maxHr = man.tops[4]; m[sp].hrManual = true; }
    return m;
  }
  // If only one sport has HR zones, reuse them (better than nothing) but flag it.
  const withHr = ['run', 'bike'].find(s => m[s].hr);
  for (const s of ['run', 'bike']) if (!m[s].hr && withHr) { m[s].hr = m[withHr].hr; m[s].lthr ||= m[withHr].lthr; m[s].maxHr ||= m[withHr].maxHr; m[s].hrBorrowed = withHr; }
  return m;
}

export function setZoneModel(m) { MODEL = m || defaultModel(); }
export function getZoneModel() { return MODEL; }

// zone n is 1-based; returns [lo, hi] in the zone's own unit
function bounds(tops, n) {
  const i = Math.max(1, Math.min(n, tops.length)) - 1;
  return [i === 0 ? 0 : tops[i - 1], tops[i]];
}

export function powerRange(ftp, n) {
  const [lo, hi] = bounds(MODEL.bike.power, n);
  return [Math.round(ftp * lo / 100), hi >= 999 ? null : Math.round(ftp * hi / 100)];
}
export function powerRangeStr(ftp, n) {
  const [lo, hi] = powerRange(ftp, n);
  return hi == null ? `>${lo} W` : lo === 0 ? `<${hi} W` : `${lo}–${hi} W`;
}
// pace zones are % of threshold SPEED. Returns [slowSecKm, fastSecKm]
export function paceRange(sport, thrSec, n) {
  const [lo, hi] = bounds(MODEL[sport].pace, n);
  return [lo === 0 ? null : thrSec / (lo / 100), hi >= 999 ? null : thrSec / (hi / 100)];
}
export function paceRangeStr(sport, thrSec, n, unit = '/km') {
  const [slow, fast] = paceRange(sport, thrSec, n);
  if (slow == null) return `slower than ${paceToStr(fast)}${unit}`;
  if (fast == null) return `faster than ${paceToStr(slow)}${unit}`;
  return `${paceToStr(fast)}–${paceToStr(slow)}${unit}`;
}
export function hrRange(sport, n) {
  const z = MODEL[sport === 'brick' ? 'run' : sport];
  if (!z?.hr) return null;
  const [lo, hi] = bounds(z.hr, n);
  return [Math.round(lo), Math.round(hi)];
}
export function hrRangeStr(sport, n) {
  const r = hrRange(sport, n);
  if (!r) return null;
  return r[0] === 0 ? `<${r[1]} bpm` : `${r[0]}–${r[1]} bpm`;
}
export function hrZoneOf(sport, bpm) {
  const z = MODEL[sport]?.hr; if (!z || !bpm) return null;
  const i = z.findIndex(t => bpm <= t); return i < 0 ? z.length : i + 1;
}
export function lthr(sport) { return MODEL[sport]?.lthr || null; }

// Collapse a time-in-zone array into easy (Z1–2) / moderate (Z3) / hard (Z4+) shares.
export function collapse(secs) {
  if (!Array.isArray(secs) || !secs.length) return null;
  const tot = secs.reduce((a, b) => a + (b || 0), 0);
  if (tot < 60) return null;
  const easy = (secs[0] || 0) + (secs[1] || 0), mod = secs[2] || 0, hard = tot - easy - mod;
  return { easy: easy / tot, mod: mod / tot, hard: hard / tot, total: tot, secs };
}
// Same for a planned session's steps (zone 1..5 per step, rests are easy)
function flat(steps) { const o = []; for (const st of steps || []) { if (st.repeat) for (let i = 0; i < st.repeat; i++) o.push(...flat(st.steps)); else o.push(st); } return o; }
export function plannedDist(steps) {
  const arr = [0, 0, 0, 0, 0];
  for (const s of flat(steps)) { const w = s.min != null ? s.min : (s.dist || 0) / 50; arr[Math.min(5, s.zone || 2) - 1] += w; if (s.rest) arr[0] += s.rest; }
  return collapse(arr.map(m => m * 60));
}
