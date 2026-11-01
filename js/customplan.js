// Custom training plans: JSON format "ironman-coach-plan/v1" — import (validate + convert), export,
// and the downloadable AI-coach prompt that makes another AI produce exactly this format.
import { isoDate, addDays, startOfWeek, parseDate, paceToStr, strToPace, round } from './util.js';
import { finalize, T, flatten, ftpFor } from './workouts.js';
import { hrZoneOf } from './zones.js';
import { zones } from './plan.js';

export const FORMAT = 'ironman-coach-plan/v1';
const KIND_IN = { warmup: 'wu', work: 'work', interval: 'work', recovery: 'rec', rest: 'rec', cooldown: 'cd', steady: 'steady', drill: 'drill', walk: 'walk' };
const KIND_OUT = { wu: 'warmup', work: 'work', rec: 'recovery', cd: 'cooldown', steady: 'steady', drill: 'drill', walk: 'walk' };
const SPORT_IN = s => { const x = String(s || '').toLowerCase(); if (/swim/.test(x)) return 'swim'; if (/bike|ride|cycl|rad/.test(x)) return 'bike'; if (/run|lauf/.test(x)) return 'run'; if (/strength|kraft|gym|weights|mobility|yoga/.test(x)) return 'strength'; if (/rest|off|ruhe/.test(x)) return 'rest'; return null; };
const PHASES = ['base', 'build', 'peak', 'taper', 'race'];

// ---------------------------------------------------------------- parse helpers
export function extractJson(text) {
  const t = String(text || '').trim();
  // prefer a fenced block that parses and contains "weeks"; fall back to the outermost {...}
  const blocks = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m => m[1]);
  for (const b of blocks) { try { const j = JSON.parse(b.slice(b.indexOf('{'), b.lastIndexOf('}') + 1)); if (j && j.weeks) return j; } catch {} }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('No JSON object found');
  return JSON.parse(t.slice(a, b + 1));
}

function paceSec(v) { if (v == null) return null; if (typeof v === 'number') return v; const s = strToPace(String(v).replace(/\/.*$/, '').trim()); return s || null; }

function convTarget(t, s, sport, path, errs) {
  if (!t) return null;
  const type = String(t.type || '').toLowerCase();
  if (type === 'power') {
    let lo = +t.low, hi = +(t.high ?? t.low);
    if (t.unit === 'watts' || lo > 200) { const F = ftpFor(s, t.indoor ?? true); lo /= F; hi /= F; }   // absolute watts
    else if (lo > 3) { lo /= 100; hi /= 100; }                                                      // percent of FTP
    if (!(lo > 0 && hi > 0)) { errs.push(`${path}: power target needs low/high`); return null; }
    return T.power(Math.min(lo, hi), Math.max(lo, hi));
  }
  if (type === 'hr') {
    if (t.zone) return T.hr(Math.max(1, Math.min(5, Math.round(+t.zone))));
    if (t.low && t.high) { const z = hrZoneOf(sport === 'swim' ? 'run' : sport, (+t.low + +t.high) / 2) || 2; return T.hr(Math.min(5, z)); }
    errs.push(`${path}: hr target needs zone or low/high bpm`); return null;
  }
  if (type === 'pace') {
    const a = paceSec(t.low), b = paceSec(t.high ?? t.low);
    if (!a || !b) { errs.push(`${path}: pace target needs "m:ss" per km`); return null; }
    return T.pace(Math.min(a, b) / s.runThreshold, Math.max(a, b) / s.runThreshold);
  }
  if (type === 'swim_pace' || type === 'swimpace') {
    const a = paceSec(t.low), b = paceSec(t.high ?? t.low);
    if (!a || !b) { errs.push(`${path}: swim_pace needs "m:ss" per 100 m`); return null; }
    return T.swim(Math.min(a, b) - s.css, Math.max(a, b) - s.css);
  }
  errs.push(`${path}: unknown target type "${t.type}"`); return null;
}

function convSteps(arr, s, sport, path, errs, depth = 0) {
  const out = [];
  (arr || []).forEach((st, i) => {
    const p = `${path}.steps[${i}]`;
    if (st && st.repeat) {
      if (depth > 0) { errs.push(`${p}: nested repeats are not supported`); return; }
      const inner = convSteps(st.steps, s, sport, p, errs, depth + 1);
      if (inner.length) out.push({ repeat: Math.max(1, Math.round(+st.repeat)), steps: inner });
      return;
    }
    const min = st.durationMin != null ? +st.durationMin : st.durationSec != null ? +st.durationSec / 60 : null;
    const dist = st.distanceM != null ? +st.distanceM : null;
    if (!(min > 0) && !(dist > 0)) { errs.push(`${p}: needs durationMin, durationSec or distanceM`); return; }
    const step = { kind: KIND_IN[String(st.type || 'steady').toLowerCase()] || 'steady', zone: Math.max(1, Math.min(5, Math.round(+st.zone || 2))), text: String(st.text || st.description || '').slice(0, 200) || 'Steady' };
    if (dist > 0 && sport === 'swim') step.dist = Math.round(dist); else if (min > 0) step.min = round(min, 2); else { step.min = round(dist / 1000 * (sport === 'run' ? s.runThreshold * 1.2 : 120) / 60, 1); }
    const tg = convTarget(st.target, s, sport, p, errs);
    if (tg) step.target = tg;
    out.push(step);
  });
  return out;
}

// ---------------------------------------------------------------- import
export function importPlan(input, s) {
  const docs = (Array.isArray(input) ? input : [input]).map(d => typeof d === 'string' ? extractJson(d) : d);
  const errs = [], warns = [];
  const weeksIn = [];
  let meta = null;
  for (const d of docs) {
    if (!d || typeof d !== 'object') { errs.push('Not a JSON object'); continue; }
    if (d.format && d.format !== FORMAT) warns.push(`format "${d.format}" — expected "${FORMAT}", trying anyway`);
    if (!Array.isArray(d.weeks)) { errs.push('Missing "weeks" array'); continue; }
    meta ||= d;
    weeksIn.push(...d.weeks);
  }
  if (!weeksIn.length) return { ok: false, errors: errs.length ? errs : ['No weeks found'], warnings: warns };
  // flatten to dated sessions
  const sessions = [];
  weeksIn.forEach((w, wi) => {
    const wStart = w.start ? isoDate(parseDate(w.start)) : null;
    (w.days || []).forEach((day, di) => {
      const date = day.date ? isoDate(parseDate(day.date)) : wStart ? isoDate(addDays(parseDate(wStart), di)) : null;
      if (!date || date === 'NaN-NaN-NaN') { errs.push(`weeks[${wi}].days[${di}]: missing or invalid date`); return; }
      (day.sessions || []).forEach((x, si) => {
        const path = `weeks[${wi}].days[${di}].sessions[${si}]`;
        const sport = SPORT_IN(x.sport);
        if (!sport) { errs.push(`${path}: unknown sport "${x.sport}"`); return; }
        if (sport === 'rest') return;
        let steps = convSteps(x.steps, s, sport, path, errs);
        if (!steps.length) {
          const min = +x.durationMin || 0, dist = +x.distanceM || 0;
          if (!min && !dist) { warns.push(`${path}: no steps and no duration — skipped`); return; }
          steps = [sport === 'swim' && dist ? { kind: 'steady', dist, zone: +x.zone || 2, text: x.title || 'Swim' } : { kind: 'steady', min: min || 30, zone: +x.zone || 2, text: x.title || 'Steady', ...(sport !== 'swim' && sport !== 'strength' ? { target: T.hr(+x.zone || 2) } : {}) }];
        }
        sessions.push({ date, phase: PHASES.includes(w.phase) ? w.phase : null, recovery: !!w.recovery, wFocus: w.focus || '',
          raw: { sport, title: String(x.title || 'Session').slice(0, 80), indoor: !!x.indoor, key: !!x.key, focus: x.focus || '', note: [x.fueling ? `Fuel: ${x.fueling}` : '', x.notes || ''].filter(Boolean).join(' · '), steps } });
      });
    });
  });
  if (!sessions.length) return { ok: false, errors: errs.length ? errs : ['No sessions found'], warnings: warns };
  // group into Monday weeks
  sessions.sort((a, b) => a.date.localeCompare(b.date));
  const first = isoDate(startOfWeek(parseDate(sessions[0].date)));
  const last = sessions[sessions.length - 1].date;
  const raceDate = meta?.goal?.raceDate ? isoDate(parseDate(meta.goal.raceDate)) : last;
  const end = raceDate > last ? raceDate : last;
  const weeks = [];
  for (let ws = first, i = 0; ws <= end; ws = isoDate(addDays(parseDate(ws), 7)), i++) {
    const dates = Array.from({ length: 7 }, (_, d) => isoDate(addDays(parseDate(ws), d)));
    const inW = sessions.filter(x => x.date >= ws && x.date <= dates[6]);
    const sess = inW.map((x, k) => {
      const o = finalize({ ...x.raw, kind: x.raw.key ? 'key' : 'session', steps: x.raw.steps }, s);
      const dow = dates.indexOf(x.date);
      return { ...o, role: `custom-${o.sport}`, dow, date: x.date, origDate: x.date, id: `${ws}-${dow}-c${k}`, custom: true };
    });
    const phase = inW.find(x => x.phase)?.phase || (dates.includes(raceDate) ? 'race' : 'base');
    const plannedMin = sess.reduce((a, x) => a + x.min, 0);
    weeks.push({ index: i, wtg: 0, start: ws, end: dates[6], dates, phase, recovery: inW.some(x => x.recovery), hours: round(plannedMin / 60, 2), sessions: sess, plannedLoad: sess.reduce((a, x) => a + x.tss, 0), plannedMin, focus: inW[0]?.wFocus || '' });
  }
  weeks.forEach(w => { w.wtg = weeks.length - 1 - w.index; });
  if (raceDate && !sessions.some(x => x.date === raceDate)) {
    const w = weeks.find(x => raceDate >= x.start && raceDate <= x.end);
    if (w) w.sessions.push({ sport: 'brick', kind: 'race', title: meta?.goal?.raceName || 'Race day', min: 0, tss: 0, if: 0.7, key: true, steps: [], dow: w.dates.indexOf(raceDate), date: raceDate, origDate: raceDate, id: `${w.start}-race` });
  }
  return {
    ok: errs.length === 0 || sessions.length > 0, errors: errs, warnings: warns,
    plan: { weeks, totalWeeks: weeks.length - 1, anchor: first, raceDate, template: [], custom: true, name: meta?.name || 'Imported plan', zones: zones(s), baseHours: weeks[0]?.hours || 0 },
    meta: { name: meta?.name, goal: meta?.goal || null, athlete: meta?.athlete || null, sessions: sessions.length, weeks: weeks.length },
  };
}

// ---------------------------------------------------------------- export (same format)
function tgtOut(t, s, x) {
  if (!t) return undefined;
  if (t.type === 'power') return { type: 'power', low: round(t.lo, 2), high: round(t.hi, 2), unit: 'ftp_fraction', watts: [Math.round(ftpFor(s, x.indoor) * t.lo), Math.round(ftpFor(s, x.indoor) * t.hi)] };
  if (t.type === 'hr') return { type: 'hr', zone: t.zone };
  if (t.type === 'pace') return { type: 'pace', low: paceToStr(s.runThreshold * t.lo), high: paceToStr(s.runThreshold * t.hi) };
  if (t.type === 'swim') return { type: 'swim_pace', low: paceToStr(s.css + t.lo), high: paceToStr(s.css + t.hi) };
  return undefined;
}
function stepsOut(steps, s, x) {
  return steps.map(st => st.repeat ? { repeat: st.repeat, steps: stepsOut(st.steps, s, x) } : {
    type: KIND_OUT[st.kind] || 'steady', ...(st.dist ? { distanceM: st.dist } : { durationMin: st.min }), zone: st.zone || 2, ...(st.target ? { target: tgtOut(st.target, s, x) } : {}), text: st.text,
  });
}
export function exportPlan(plan, s, name = 'Ironman Coach plan') {
  return {
    format: FORMAT, name,
    goal: { type: s.goal?.type || 'triathlon', distance: s.goal?.tri || 'full', raceName: s.raceName, raceDate: s.raceDate, goalTime: s.goalHours ? `${s.goalHours}h` : undefined },
    athlete: { ftpIndoorW: s.ftp, runThresholdPace: paceToStr(s.runThreshold), cssPer100m: paceToStr(s.css), weightKg: s.weightKg },
    weeks: plan.weeks.map(w => ({
      week: w.index + 1, start: w.start, phase: w.phase, recovery: !!w.recovery,
      days: w.dates.map(d => ({ date: d, sessions: w.sessions.filter(x => x.date === d && x.kind !== 'race').map(x => ({
        sport: x.sport, title: x.title, indoor: !!x.indoor, key: !!x.key, durationMin: x.min, ...(x.dist ? { distanceM: x.dist } : {}),
        focus: x.focus || undefined, notes: x.note || undefined, steps: stepsOut(x.steps, s, x) })) })),
    })),
  };
}

// ---------------------------------------------------------------- AI coach prompt
export function aiCoachPrompt() {
  return `# AI Endurance Coach — Custom Training Plan for the "Ironman Coach" app

You are my personal endurance coach (triathlon, running, cycling, swimming). Your job: interview me, build a complete, periodised training plan that leads me safely to my race, and finally export it as JSON that my training app ("Ironman Coach") can import. Work in the phases below, in order. Do not skip the interview and do not invent data I have not given you — ask instead.

---

## Phase 1 — Interview (ask, then wait for my answers)

Ask in short rounds of 3–6 questions. Summarise what you learned after each round. Cover:

**1. Goal**
- What am I training for?
  - **Triathlon:** Sprint (750 m / 20 km / 5 km), Olympic (1.5 / 40 / 10), Middle / 70.3 (1.9 / 90 / 21.1), Full / Ironman (3.8 / 180 / 42.2).
  - **Running:** exact distance in km (5 k, 10 k, half, marathon, or any custom/ultra distance, e.g. 98.6 km), road or trail, elevation gain.
  - **Cycling:** exact distance in km **and** elevation gain in metres (e.g. a Stoneman), road / gravel / MTB.
  - **Swimming:** distance in metres, pool or open water, wetsuit or not.
- Race name, **race date**, goal (just finish / target time), and any secondary races before it.

**2. Current fitness**
- Recent results (races, time trials) with dates.
- Bike: FTP (indoor and outdoor separately if they differ; do I have a power meter outdoors? smart trainer / app such as MyWhoosh or Zwift?).
- Run: threshold pace or a recent 5 k / 10 k time; current easy pace and the heart rate it is at.
- Swim: CSS or a 400 m + 200 m time trial; how far I can swim **without stopping**.
- Heart rate: resting HR, max HR, lactate-threshold HR, or my HR zones (bpm limits Z1–Z5).
- Current weekly training hours and the longest recent session in each sport.

**3. Availability & constraints**
- Hours per week available now and at peak; which **days are fixed** for which sport; maximum session length per weekday.
- Indoor-only periods (winter, trainer cap e.g. 3 h), pool access, travel, work/shift patterns.
- Injuries or pain (e.g. shoulder, knee, Achilles), illness, anything a coach must respect.
- Strength/mobility preferences.

**4. Existing plan**
- "Do you have a current or previous training plan? Paste it or upload it."

**5. Fueling**
- What I eat/drink in training, gut problems, sweat rate / heat.

Before building, show a compact **athlete profile** and ask me to confirm or correct it.

---

## Phase 2 — Integrate my existing plan (if I gave you one)

- Analyse it: weekly structure, volume per sport, key sessions, progression, what worked and what didn't.
- **Keep** what works (my preferred days, sessions I like and complete, proven volumes).
- **Integrate and adapt** it into the periodised framework below instead of starting from zero: fix overload jumps, missing recovery weeks, missing race-specific work, missing taper.
- Tell me in a few bullet points what you kept, what you changed and why.
- If I have no plan, build from scratch.

---

## Phase 3 — Plan design rules

- **Start** on the next Monday; **end** on race day. Every week until race day.
- **Periodisation:** base → build → peak → taper (2–3 weeks, volume −30 to −50 %, keep some intensity) → race week.
- Every **3rd or 4th week is a recovery week** (≈ −30 % volume).
- Increase weekly volume by **≤ 10 %** per week; long sessions grow gradually toward goal-specific peaks (e.g. Ironman: long ride 5–6 h, long run 2.5–3 h with run/walk; marathon: 30–35 km; swim: continuous distance ≥ race distance).
- **Intensity distribution ≈ 80/20**: most work in Z1–Z2, 1–2 quality sessions per sport per week; avoid "grey zone" (Z3) creep in base.
- Triathlon: include **brick runs** after bike sessions from build phase on.
- Respect fixed days, max session lengths, indoor caps and injuries from the interview.
- Every session gets **structured steps** (warm-up, main set with intervals and recoveries, cool-down) with **targets**:
  - bike: power as a fraction of FTP (indoor sessions use indoor FTP), or HR zone outdoors without a power meter;
  - run: absolute pace per km (intervals/tempo) or HR zone (easy/long runs);
  - swim: pace per 100 m or distance-based sets; drills for technique.
- Every session ≥ 60 min gets **fueling guidance** (carbs g/h, fluid ml/h): ~30–60 g/h for 1–2.5 h, 60–90 g/h above 2.5 h or at race intensity; practise race nutrition in long sessions.
- Include race-week openers and a race-day plan (pacing + fueling).

---

## Phase 4 — Output for me (readable)

1. A short overview: phases with dates, weekly hours per week (table), key progressions.
2. The **complete day-by-day plan for every single week up to race day** (rest days included): date, sport, title, duration, structured steps with targets, fueling.

---

## Phase 5 — JSON export for the app (exact format)

At the very end output the **entire plan** as JSON in **one** \`\`\`json code block, following this format exactly:

- Valid JSON only: double quotes, no comments, no trailing commas, no "..." placeholders.
- Dates ISO \`YYYY-MM-DD\`. Weeks start on **Monday**. **Every week has all 7 days**; a rest day has \`"sessions": []\`.
- \`goal.type\`: \`"triathlon" | "run" | "bike" | "swim"\`; \`goal.distance\`: triathlon \`"sprint" | "olympic" | "70.3" | "full"\`, run = km as a number (e.g. 98.6), bike = km as a number plus \`goal.elevationM\`, swim = metres as a number.
- \`sport\`: \`"swim" | "bike" | "run" | "strength"\`.
- \`steps[].type\`: \`"warmup" | "work" | "recovery" | "cooldown" | "steady" | "drill" | "walk"\`.
- Each step has **either** \`durationMin\` (number, minutes; decimals allowed, e.g. 0.5 = 30 s) **or** \`distanceM\` (swim sets), plus \`zone\` (1–5) and \`text\`.
- Repeats: \`{ "repeat": 4, "steps": [ ...work step..., ...recovery step... ] }\` (no nested repeats).
- \`target\` (optional) is one of:
  - \`{ "type": "power", "low": 0.88, "high": 0.94 }\` — fraction of FTP
  - \`{ "type": "hr", "zone": 2 }\`
  - \`{ "type": "pace", "low": "5:10", "high": "5:20" }\` — min:sec per km (low = faster)
  - \`{ "type": "swim_pace", "low": "1:55", "high": "2:00" }\` — min:sec per 100 m
- Steps of a session should add up to its \`durationMin\`.
- If the plan is too long for one message: split it into **parts**. Each part is a complete JSON document with the same top-level fields, \`"part": n, "parts": total\`, and a consecutive subset of \`weeks\`. Continue in your next message exactly where you stopped. I will import all parts together.

Example (one week shortened to two days — the real export must contain all weeks and all days):

\`\`\`json
{
  "format": "${FORMAT}",
  "name": "70.3 Lake Race 2027 — Anna",
  "goal": { "type": "triathlon", "distance": "70.3", "raceName": "Lake Race 70.3", "raceDate": "2027-06-20", "goalTime": "5:45" },
  "athlete": { "ftpIndoorW": 210, "ftpOutdoorW": 225, "runThresholdPace": "4:55", "cssPer100m": "1:45", "lthr": 172, "maxHr": 190, "hrZonesBpm": [138, 152, 162, 172, 190] },
  "weeks": [
    {
      "week": 1, "start": "2026-11-02", "phase": "base", "recovery": false, "focus": "Aerobic base, swim technique",
      "days": [
        { "date": "2026-11-02", "sessions": [] },
        { "date": "2026-11-03", "sessions": [
          { "sport": "bike", "title": "Sweet spot 3x12", "indoor": true, "key": true, "durationMin": 65,
            "focus": "Raise sustainable power", "fueling": "30-40 g carbs/h, 500 ml/h",
            "steps": [
              { "type": "warmup", "durationMin": 12, "zone": 2, "target": { "type": "power", "low": 0.5, "high": 0.7 }, "text": "Progressive warm-up" },
              { "repeat": 3, "steps": [
                { "type": "work", "durationMin": 12, "zone": 4, "target": { "type": "power", "low": 0.88, "high": 0.94 }, "text": "Sweet spot, seated" },
                { "type": "recovery", "durationMin": 4, "zone": 1, "target": { "type": "power", "low": 0.5, "high": 0.55 }, "text": "Easy spin" }
              ] },
              { "type": "cooldown", "durationMin": 5, "zone": 1, "text": "Easy" }
            ] },
          { "sport": "run", "title": "Brick run", "durationMin": 20,
            "steps": [ { "type": "steady", "durationMin": 20, "zone": 2, "target": { "type": "hr", "zone": 2 }, "text": "Off the bike, settle into Z2" } ] }
        ] }
      ]
    }
  ]
}
\`\`\`

Before you output the JSON, check: every week from the start Monday to race day is present, every week has 7 days, every session has steps with durations or distances, targets use the formats above, and the JSON is valid.

**Start now with Phase 1 — ask me your first questions.**
`;
}

// Map the JSON goal block to the app's goal settings
export function goalFromMeta(g) {
  if (!g) return null;
  const t = String(g.type || '').toLowerCase();
  const d = g.distance;
  if (/tri/.test(t)) { const x = String(d || 'full').toLowerCase(); const tri = /sprint/.test(x) ? 'sprint' : /olymp/.test(x) ? 'olympic' : /70|half|middle|mittel/.test(x) ? '70.3' : 'full'; return { type: 'triathlon', tri }; }
  if (/run|lauf|marathon/.test(t)) return { type: 'run', runKm: +d || +g.distanceKm || 42.195 };
  if (/bike|cycl|ride|rad/.test(t)) return { type: 'bike', bikeKm: +d || +g.distanceKm || 100, bikeHm: +g.elevationM || +g.elevation || 0 };
  if (/swim/.test(t)) return { type: 'swim', swimM: +d || +g.distanceM || 3800 };
  return null;
}
