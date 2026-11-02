// Workout export: Garmin .FIT workout file, Zwift .ZWO, and intervals.icu workout text
// (sent to the intervals.icu calendar, which forwards planned workouts to connected devices).
import { load } from './store.js';
import { flatten, ftpFor, stepMin, pctToZone } from './workouts.js';
import { singleFtp } from './virtualpower.js';
import { hrRange } from './zones.js';
import { paceToStr, round } from './util.js';

// Garmin's FIT SDK license does not allow redistributing it here, so it is loaded from npm CDNs at runtime.
const FIT_URLS = ['https://cdn.jsdelivr.net/npm/@garmin/fitsdk@21.218.0/+esm', 'https://unpkg.com/@garmin/fitsdk@21.218.0/src/index.js'];
export async function loadFit() {
  let last;
  for (const u of FIT_URLS) { try { return await import(u); } catch (e) { last = e; } }
  throw new Error('could not load the Garmin FIT library (offline?)');
}
const safeName = (t) => t.replace(/[^\w\-× ]+/g, '').replace(/×/g, 'x').trim().slice(0, 40) || 'workout';

export function download(bytes, filename, mime) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

// ---- FIT -------------------------------------------------------------------
function fitIntensity(k) { return k === 'wu' ? 'warmup' : k === 'cd' ? 'cooldown' : (k === 'rec' || k === 'walk') ? 'rest' : 'active'; }
function fitTarget(st, sess, s) {
  const t = st.target;
  if (!t) return { targetType: 'open', targetValue: 0 };
  if (t.type === 'power' && singleFtp(s)) { const r = hrRange('bike', pctToZone((t.lo + t.hi) / 2)); if (r) return { targetType: 'heartRate', targetValue: 0, customTargetValueLow: 100 + (r[0] || r[1] - 25), customTargetValueHigh: 100 + r[1] }; }
  if (t.type === 'power') { const F = ftpFor(s, sess.indoor); return { targetType: 'power', targetValue: 0, customTargetValueLow: 1000 + Math.round(F * t.lo), customTargetValueHigh: 1000 + Math.round(F * t.hi) }; }
  if (t.type === 'hr') {
    const r = hrRange(sess.sport === 'brick' ? 'run' : sess.sport, t.zone);
    if (!r) return { targetType: 'heartRate', targetValue: t.zone };
    const lo = r[0] === 0 ? r[1] - 25 : r[0];
    return { targetType: 'heartRate', targetValue: 0, customTargetValueLow: 100 + lo, customTargetValueHigh: 100 + r[1] };
  }
  if (t.type === 'pace') { const T = s.runThreshold; return { targetType: 'speed', targetValue: 0, customTargetValueLow: Math.round(1000 / (T * t.hi) * 1000), customTargetValueHigh: Math.round(1000 / (T * t.lo) * 1000) }; }
  return { targetType: 'open', targetValue: 0 };
}

export async function exportFit(sess) {
  const s = load();
  const { Encoder, Profile } = await loadFit();
  const enc = new Encoder();
  const sport = sess.sport === 'bike' ? 'cycling' : sess.sport === 'swim' ? 'swimming' : 'running';
  const subSport = sess.sport === 'bike' ? (sess.indoor ? 'indoorCycling' : 'road') : sess.sport === 'swim' ? 'lapSwimming' : 'street';
  const msgs = [];
  const add = (st) => {
    const dur = st.dist ? { durationType: 'distance', durationValue: Math.round(st.dist * 100) } : { durationType: 'time', durationValue: Math.round(st.min * 60 * 1000) };
    msgs.push({ wktStepName: (st.label || st.text || '').slice(0, 30), notes: (st.text || '').slice(0, 50), intensity: fitIntensity(st.kind), ...dur, ...fitTarget(st, sess, s) });
  };
  for (const st of sess.steps) {
    if (st.repeat) {
      const first = msgs.length;
      st.steps.forEach(add);
      msgs.push({ durationType: 'repeatUntilStepsCmplt', durationValue: first, targetType: 'open', targetValue: st.repeat, intensity: 'active' });
    } else add(st);
  }
  enc.onMesg(Profile.MesgNum.FILE_ID, { type: 'workout', manufacturer: 'development', product: 0, timeCreated: new Date(), serialNumber: Math.floor(Math.random() * 1e9) });
  enc.onMesg(Profile.MesgNum.WORKOUT, { wktName: safeName(sess.title).slice(0, 30), sport, subSport, numValidSteps: msgs.length, ...(sess.sport === 'swim' ? { poolLength: 25, poolLengthUnit: 'metric' } : {}) });
  msgs.forEach((m, i) => enc.onMesg(Profile.MesgNum.WORKOUT_STEP, { messageIndex: i, ...m }));
  const bytes = enc.close();
  download(bytes, `${sess.date}-${safeName(sess.title)}.fit`, 'application/octet-stream');
}

// ---- ZWO (Zwift, bike) -----------------------------------------------------
const HR_TO_PWR = { 1: 0.55, 2: 0.68, 3: 0.8, 4: 0.92, 5: 1.02 };
function pw(st) { const t = st.target; if (t?.type === 'power') return [t.lo, t.hi]; const z = HR_TO_PWR[st.zone || 2]; return [z - 0.03, z + 0.03]; }
const xml = (v) => String(v).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
export function exportZwo(sess) {
  const lines = [];
  const one = (st) => {
    const sec = Math.round(st.min * 60), [lo, hi] = pw(st);
    if (st.kind === 'wu') return `<Warmup Duration="${sec}" PowerLow="${lo.toFixed(2)}" PowerHigh="${hi.toFixed(2)}"><textevent timeoffset="0" message="${xml(st.text)}"/></Warmup>`;
    if (st.kind === 'cd') return `<Cooldown Duration="${sec}" PowerLow="${hi.toFixed(2)}" PowerHigh="${lo.toFixed(2)}"/>`;
    return `<SteadyState Duration="${sec}" Power="${((lo + hi) / 2).toFixed(2)}"><textevent timeoffset="0" message="${xml(st.text)}"/></SteadyState>`;
  };
  for (const st of sess.steps) {
    if (st.repeat && st.steps.length === 2) {
      const [on, off] = st.steps; const [a, b] = pw(on), [c, d] = pw(off);
      lines.push(`<IntervalsT Repeat="${st.repeat}" OnDuration="${Math.round(on.min * 60)}" OffDuration="${Math.round(off.min * 60)}" OnPower="${((a + b) / 2).toFixed(2)}" OffPower="${((c + d) / 2).toFixed(2)}"/>`);
    } else if (st.repeat) { for (let i = 0; i < st.repeat; i++) st.steps.forEach(x => lines.push(one(x))); }
    else lines.push(one(st));
  }
  const doc = `<workout_file>\n  <author>Ironman Coach</author>\n  <name>${xml(sess.title)}</name>\n  <description>${xml(sess.focus || '')}</description>\n  <sportType>bike</sportType>\n  <tags/>\n  <workout>\n    ${lines.join('\n    ')}\n  </workout>\n</workout_file>\n`;
  download(new Blob([doc], { type: 'application/xml' }), `${sess.date}-${safeName(sess.title)}.zwo`);
}

// ---- intervals.icu workout text ---------------------------------------------
function durTxt(st) {
  if (st.dist) return `${st.dist}mtr`;
  const sec = Math.round(st.min * 60);
  if (sec < 60) return `${sec}s`;
  if (sec % 60) return `${Math.floor(sec / 60)}m${sec % 60}`;
  return sec >= 3600 && sec % 3600 === 0 ? `${sec / 3600}h` : `${sec / 60}m`;
}
function tgtTxt(st, sess, s) {
  const t = st.target;
  if (!t) return sess.sport === 'run' ? `Z${Math.min(5, st.zone || 2)} HR` : '';
  if (t.type === 'power' && singleFtp(s)) return `Z${pctToZone((t.lo + t.hi) / 2)} HR`;
  if (t.type === 'power') return `${Math.round(t.lo * 100)}-${Math.round(t.hi * 100)}%`;
  if (t.type === 'hr') return `Z${t.zone} HR`;
  if (t.type === 'pace') return `${Math.round(100 / t.hi)}-${Math.round(100 / t.lo)}% Pace`;
  if (t.type === 'swim') return `${paceToStr(s.css + (t.lo + t.hi) / 2)}/100m pace`;
  return '';
}
export function intervalsText(sess) {
  const s = load();
  const out = [];
  if (sess.focus) out.push(sess.focus, '');
  const line = (st) => `- ${st.kind === 'drill' ? 'Drill ' : st.kind === 'walk' ? 'Walk ' : ''}${durTxt(st)} ${tgtTxt(st, sess, s)}`.trimEnd();
  let prev = null;
  for (const st of sess.steps) {
    if (st.repeat) { out.push('', `${st.repeat}x`); st.steps.forEach(x => out.push(line(x))); out.push(''); }
    else {
      if (st.kind === 'wu') out.push('Warmup');
      else if (st.kind === 'cd') out.push('', 'Cooldown');
      else if (prev && prev.kind === 'wu') out.push('', 'Main set');
      out.push(line(st));
    }
    prev = st;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function icuEvent(sess) {
  const type = sess.sport === 'bike' ? (sess.indoor ? 'VirtualRide' : 'Ride') : sess.sport === 'swim' ? 'Swim' : 'Run';
  return { category: 'WORKOUT', start_date_local: `${sess.date}T00:00:00`, type, name: sess.title, description: intervalsText(sess), external_id: `ironman-coach-${sess.id}`, moving_time: Math.round(sess.min * 60), ...(sess.dist ? { distance: sess.dist } : {}) };
}
