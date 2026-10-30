// Per-activity analysis: AI summary via Anthropic API (direct from browser, key stays local)
// with a rule-based fallback so the app works without a key.
import { load, getCache, setCache } from './store.js';
import { fmtDur, fmtPace, fmtPace100, fmtKm, round, paceToStr } from './util.js';
import { zones } from './plan.js';

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
    if (a.intensity != null) {
      const pIF = planned.if * 100, diff = a.intensity - pIF;
      if (diff > 10) { lines.push(`Intensity ${a.intensity}% vs ~${Math.round(pIF)}% intended — too hard for this session's purpose.`); if (verdict === 'on') verdict = 'above'; }
      else if (diff < -10 && planned.key) { lines.push(`Intensity ${a.intensity}% vs ~${Math.round(pIF)}% intended — the key stimulus was not reached.`); if (verdict === 'on') verdict = 'below'; }
      else lines.push(`Intensity ${a.intensity}% matches the intent (${Math.round(pIF)}%).`);
    }
  } else {
    lines.push(`Unplanned ${a.sport}: ${fmtDur(durMin)}${a.distanceM ? ', ' + fmtKm(a.distanceM) : ''}.`);
  }

  if (a.sport === 'bike') {
    if (a.np) lines.push(`NP ${a.np} W = ${Math.round(a.np / s.ftp * 100)}% of FTP (IM target ${z.bike.imW} W).`);
    if (a.eftp && a.eftp > s.ftp + 3) { lines.push(`eFTP estimate ${a.eftp} W — above your set FTP ${s.ftp} W.`); adjust = `Raise FTP to ${a.eftp} W in Settings so zones and targets move up.`; }
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

async function aiSummary(a, ctx, rules) {
  const s = load();
  const z = zones(s);
  const planned = ctx.planned;
  const payload = {
    activity: {
      name: a.name, type: a.type, date: a.date, duration_min: round(a.movingSec / 60), distance_km: a.distanceM ? round(a.distanceM / 1000, 2) : null,
      training_load: a.load, intensity_pct: a.intensity, avg_hr: a.avgHr, max_hr: a.maxHr, normalized_power: a.np, avg_power: a.avgW, eftp: a.eftp,
      pace_per_km: a.paceSecKm ? paceToStr(a.paceSecKm) : null, pace_per_100m: a.pace100 ? paceToStr(a.pace100) : null, speed_kmh: a.speedKmh ? round(a.speedKmh, 1) : null,
      elevation_m: a.elev, rpe: a.rpe, feel: a.feel, hr_decoupling_pct: a.decoupling, athlete_notes: a.description?.slice(0, 400) || null,
    },
    planned_session: planned ? { title: planned.title, purpose: planned.note || planned.kind, duration_min: planned.min, target_if: planned.if, key_session: planned.key, steps: planned.steps.map(x => `${x.min} min ${x.text}`) } : null,
    athlete: { ftp_w: s.ftp, run_threshold_pace: paceToStr(s.runThreshold) + '/km', swim_css: paceToStr(s.css) + '/100m', weekly_hours: s.weeklyHours,
      ironman_targets: { bike_w: z.bike.imW, run_pace: paceToStr(z.run.imPace) + '/km', swim_pace: paceToStr(z.swim.imPace) + '/100m' } },
    status: { phase: ctx.phase, weeks_to_race: ctx.weeksLeft, ctl: ctx.wellness?.ctl, atl: ctx.wellness?.atl, form_tsb: ctx.wellness?.tsb, ramp_rate: ctx.wellness?.ramp, compliance_14d_pct: ctx.compliance14 },
    goal: 'Ironman in ' + s.raceDate + ', goal finish under ' + s.goalHours + ' hours',
  };
  const prompt = `You are an experienced Ironman coach reviewing one training session for your athlete. Be specific, numeric and candid, like a good coach's WhatsApp message. No fluff.

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
  return { source: 'ai', verdict: ['on', 'above', 'below'].includes(out.verdict) ? out.verdict : rules.verdict, text: out.summary || rules.text, adjust: out.adjust || rules.adjust, at: Date.now() };
}
