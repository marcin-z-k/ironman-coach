// Per-activity analysis: AI summary via Anthropic API (direct from browser, key stays local)
// with a rule-based fallback so the app works without a key.
import { load, getCache, setCache } from './store.js';
import { fmtDur, fmtPace, fmtPace100, fmtKm, round, paceToStr } from './util.js';
import { zones } from './plan.js';
import { collapse, plannedDist, hrRangeStr, getZoneModel } from './zones.js';

function cacheKey(a) { return `sum:${a.id}`; }

export function getSummary(a) { return getCache(cacheKey(a)); }

export async function summarise(a, ctx, { force = false } = {}) {
  const existing = getCache(cacheKey(a));
  if (existing && !force && !(existing.source === 'rules' && load().anthropicKey)) return existing;
  const rules = ruleSummary(a, ctx);
  const s = load();
  if (!s.anthropicKey) { setCache(cacheKey(a), rules); return rules; }
  try {
    const ai = await aiSummary(a, ctx, rules);
    setCache(cacheKey(a), ai);
    return ai;
  } catch (e) {
    const out = { ...rules, error: e.message };
    setCache(cacheKey(a), out);
    return out;
  }
}

// Compare time-in-zone with what the planned session asked for. Bike: power zones first;
// run: pace (GAP) zones; HR zones always as the physiological check.
export function zoneIntensity(a, planned) {
  const pd = plannedDist(planned.steps);
  const primary = a.sport === 'bike' ? a.powerZoneSecs : a.sport === 'run' ? a.paceZoneSecs : null;
  const pz = collapse(primary), hz = collapse(a.hrZoneSecs);
  const act = pz || hz;
  if (!pd || !act) return null;
  const src = pz ? (a.sport === 'bike' ? 'power' : 'pace') : 'HR';
  const pct = v => Math.round(v * 100);
  const sport = a.sport === 'bike' ? 'bike' : 'run';
  const easyPlan = pd.hard < 0.05 && pd.mod < 0.15;
  const hrNote = hz && pz ? ` HR: ${pct(hz.easy)}% Z1–2, ${pct(hz.hard)}% Z4+.` : '';
  if (easyPlan) {
    const above = act.mod + act.hard;
    if (above > 0.2) return { verdict: 'above', text: `${pct(above)}% of the time above Z2 by ${src} on an easy session.${hrNote}`, adjust: `Keep easy sessions in Z1–2${hrRangeStr(sport, 2) ? ` (HR ${hrRangeStr(sport, 2)})` : ''}; easy days make the key days work.` };
    return { verdict: 'on', text: `${pct(act.easy)}% in Z1–2 by ${src} — easy as intended.${hrNote}` };
  }
  const planHard = pd.hard + pd.mod * 0.5, actHard = act.hard + act.mod * 0.5;
  const planMin = Math.round(pd.total * pd.hard / 60), actMin = Math.round(act.total * act.hard / 60);
  if (actHard < planHard * 0.6) return { verdict: 'below', text: `Only ${actMin} min in Z4+ by ${src} vs ~${planMin} min planned — the key stimulus was missed.${hrNote}`, adjust: planned.key ? 'Repeat this session in the next 1–2 days if you feel fresh; do not stack it onto another key day.' : null };
  if (actHard > planHard * 1.6 + 0.1) return { verdict: 'above', text: `${actMin} min in Z4+ by ${src} vs ~${planMin} min planned — harder than prescribed.${hrNote}`, adjust: 'Stick to the prescribed zones; extra intensity costs recovery for the next key session.' };
  return { verdict: 'on', text: `${actMin} min in Z4+ by ${src} vs ~${planMin} min planned — on target.${hrNote}` };
}

export function ruleSummary(a, ctx) {
  const s = load();
  const z = zones(s);
  const planned = ctx.planned; // matched planned session or null
  const lines = [];
  let verdict = 'on';
  let adjust = 'None — keep following the plan.';
  const durMin = a.movingSec / 60;

  if (planned) {
    const ratio = durMin / planned.min;
    if (ratio < 0.75) { verdict = 'below'; lines.push(`${fmtDur(durMin)} done vs ${fmtDur(planned.min)} planned (${Math.round(ratio * 100)}%).`); }
    else if (ratio > 1.3) { if (planned.key || ratio > 1.6) verdict = 'above'; lines.push(`${fmtDur(durMin)} — ${Math.round((ratio - 1) * 100)}% longer than the planned ${fmtDur(planned.min)}.`); }
    else lines.push(`Duration on plan: ${fmtDur(durMin)} vs ${fmtDur(planned.min)} planned.`);
    const zi = zoneIntensity(a, planned);
    if (zi) {
      lines.push(zi.text);
      if (zi.verdict !== 'on' && verdict === 'on') verdict = zi.verdict;
      if (zi.adjust) adjust = zi.adjust;
    } else if (a.intensity != null) {
      const pIF = planned.if * 100, diff = a.intensity - pIF;
      if (diff > 10) { lines.push(`Intensity ${a.intensity}% vs ~${Math.round(pIF)}% intended — too hard for this session's purpose.`); if (verdict === 'on') verdict = 'above'; }
      else if (diff < -10 && planned.key) { lines.push(`Intensity ${a.intensity}% vs ~${Math.round(pIF)}% intended — the key stimulus was not reached.`); if (verdict === 'on') verdict = 'below'; }
      else lines.push(`Intensity ${a.intensity}% matches the intent (${Math.round(pIF)}%).`);
    }
  } else {
    verdict = 'none';
    lines.push(`Unplanned ${a.sport}: ${fmtDur(durMin)}${a.distanceM ? ', ' + fmtKm(a.distanceM) : ''}.`);
    const hz = collapse(a.hrZoneSecs);
    if (hz) lines.push(`HR: ${Math.round(hz.easy * 100)}% Z1–2, ${Math.round(hz.mod * 100)}% Z3, ${Math.round(hz.hard * 100)}% Z4+.`);
  }
  // HR vs output cross-check: easy power/pace but high HR → fatigue, heat or dehydration
  const outD = collapse(a.sport === 'bike' ? a.powerZoneSecs : a.paceZoneSecs), hrD = collapse(a.hrZoneSecs);
  if (outD && hrD && a.movingSec > 1800) {
    if (hrD.easy < outD.easy - 0.25) lines.push(`HR ran ${Math.round((outD.easy - hrD.easy) * 100)} points higher in zones than ${a.sport === 'bike' ? 'power' : 'pace'} — heat, dehydration or fatigue.`);
    else if (hrD.easy > outD.easy + 0.25 && outD.hard > 0.15) lines.push(`HR stayed low relative to ${a.sport === 'bike' ? 'power' : 'pace'} — a sign your threshold may be set too low.`);
  }

  if (a.sport === 'bike') {
    if (a.np) lines.push(`NP ${a.np} W = ${Math.round(a.np / s.ftp * 100)}% of FTP (IM target ${z.bike.imW} W).`);
    if (a.eftp && a.eftp > s.ftp + 3) { lines.push(`eFTP estimate ${a.eftp} W — above your set FTP ${s.ftp} W.`); adjust = (load().thresholdSource || 'auto') === 'auto' ? `The app will raise FTP toward ${a.eftp} W automatically (max 5% per update).` : `Consider raising FTP to ${a.eftp} W so zones and targets move up.`; }
    if (a.decoupling != null && a.decoupling > 7) lines.push(`HR drift ${round(a.decoupling, 1)}% — aerobic durability still developing.`);
  }
  if (a.sport === 'run' && a.paceSecKm) {
    const rel = a.paceSecKm / s.runThreshold;
    lines.push(`Avg ${fmtPace(a.paceSecKm)} = ${Math.round(rel * 100)}% of threshold pace (IM pace ${paceToStr(z.run.imPace)}).`);
    if (planned && planned.kind === 'easy' && rel < 1.12) { lines.push('Easy run ran too fast — easy days must stay easy to absorb the key sessions.'); adjust = `Slow easy runs to ${z.run.easy}.`; if (verdict === 'on') verdict = 'above'; }
  }
  if (a.sport === 'swim' && a.pace100) {
    lines.push(`Avg ${fmtPace100(a.pace100)} vs CSS ${fmtPace100(s.css)}.`);
    if (planned?.kind === 'css' && a.pace100 < s.css - 3) { adjust = `CSS seems faster than set — retest and update to ~${paceToStr(Math.round(a.pace100))}.`; }
  }
  if (a.rpe != null && a.rpe >= 8 && planned && planned.if < 0.75) { lines.push(`RPE ${a.rpe}/10 for an easy session suggests accumulated fatigue.`); adjust = 'Take tomorrow easy; if RPE stays high, skip the next key session.'; }
  if (ctx.wellness?.tsb != null && ctx.wellness.tsb < -25) adjust = `Form is ${ctx.wellness.tsb}: keep the next 2–3 days aerobic only.`;

  return { source: 'rules', verdict, text: lines.join(' '), adjust, at: Date.now() };
}

const pctArr = (arr) => { if (!arr || !arr.some(Boolean)) return null; const t = arr.reduce((x, y) => x + (y || 0), 0); return arr.map(v => Math.round((v || 0) / t * 100)); };
function zoneSummary() {
  const m = getZoneModel();
  return { bike_hr_zone_tops_bpm: m.bike.hr, bike_lthr: m.bike.lthr, run_hr_zone_tops_bpm: m.run.hr, run_lthr: m.run.lthr, power_zone_tops_pct_ftp: m.bike.power, run_pace_zone_tops_pct_threshold_speed: m.run.pace };
}

async function aiSummary(a, ctx, rules) {
  const s = load();
  const z = zones(s);
  const planned = ctx.planned;
  const payload = {
    activity: {
      name: a.name, type: a.type, date: a.date, duration_min: round(a.movingSec / 60), distance_km: a.distanceM ? round(a.distanceM / 1000, 2) : null,
      training_load: a.load, intensity_pct: a.intensity, avg_hr: a.avgHr, max_hr: a.maxHr, normalized_power: a.np, avg_power: a.avgW, eftp: a.eftp,
      pace_per_km: a.paceSecKm ? paceToStr(a.paceSecKm) : null, pace_per_100m: a.pace100 ? paceToStr(a.pace100) : null, speed_kmh: a.speedKmh ? round(a.speedKmh, 1) : null,
      elevation_m: a.elev, rpe: a.rpe, feel: a.feel, hr_decoupling_pct: a.decoupling,
      time_in_zones_pct: { hr: pctArr(a.hrZoneSecs), power: pctArr(a.powerZoneSecs), pace: pctArr(a.paceZoneSecs) }, gap_pace_per_km: a.gapSecKm ? paceToStr(a.gapSecKm) : null, activity_power_model_ftp: a.pmFtp, athlete_notes: a.description?.slice(0, 400) || null,
    },
    planned_session: planned ? { title: planned.title, purpose: planned.note || planned.kind, duration_min: planned.min, target_if: planned.if, key_session: planned.key, steps: planned.steps.map(x => `${x.min} min Z${x.zone} ${x.text}`),
      based_on_previous: planned.ref && planned.ref.id !== a.id ? { date: planned.ref.date, name: planned.ref.name, duration_min: planned.ref.min, np: planned.ref.np, pace_per_km: planned.ref.paceSecKm ? paceToStr(planned.ref.paceSecKm) : null, intensity_pct: planned.ref.intensity } : null } : null,
    athlete: { zones: zoneSummary(), ftp_w: s.ftp, run_threshold_pace: paceToStr(s.runThreshold) + '/km', swim_css: paceToStr(s.css) + '/100m', weekly_hours: s.weeklyHours,
      ironman_targets: { bike_w: z.bike.imW, run_pace: paceToStr(z.run.imPace) + '/km', swim_pace: paceToStr(z.swim.imPace) + '/100m' } },
    status: { phase: ctx.phase, weeks_to_race: ctx.weeksLeft, ctl: ctx.wellness?.ctl, atl: ctx.wellness?.atl, form_tsb: ctx.wellness?.tsb, ramp_rate: ctx.wellness?.ramp, compliance_14d_pct: ctx.compliance14 },
    goal: 'Ironman in ' + s.raceDate + ', goal finish under ' + s.goalHours + ' hours',
  };
  const prompt = `You are an experienced Ironman coach reviewing one training session for your athlete. Be specific, numeric and candid, like a good coach's WhatsApp message. No fluff.
Judge intensity primarily from time in the athlete's own zones (power for bike, GAP pace for run, HR as the physiological check) against what the planned steps prescribe (each step has a zone 1–5). Mention HR vs power/pace mismatches.

Data (JSON):
${JSON.stringify(payload)}

Respond with ONLY a JSON object:
{"verdict":"on"|"above"|"below",  // on = did what the session was for; above = harder/longer than intended; below = under-delivered
 "summary":"2-3 sentences: how the athlete performed vs the session's purpose and vs their Ironman targets. Mention concrete numbers.",
 "adjust":"One sentence: what (if anything) to change in training or settings as a result. Say 'Nothing to change.' if nothing."}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': s.anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: s.anthropicModel || 'claude-sonnet-5-5', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) { let m = `Anthropic API ${res.status}`; try { const j = await res.json(); m += ': ' + (j.error?.message || ''); } catch {} throw new Error(m); }
  const j = await res.json();
  const text = (j.content || []).map(c => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Unexpected AI response');
  const out = JSON.parse(m[0]);
  return { source: 'ai', verdict: !planned ? 'none' : ['on', 'above', 'below'].includes(out.verdict) ? out.verdict : rules.verdict, text: out.summary || rules.text, adjust: out.adjust || rules.adjust, at: Date.now() };
}
