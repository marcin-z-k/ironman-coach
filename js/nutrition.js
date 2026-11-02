// Fueling: training carbs per hour and race-week carb loading (sports-nutrition consensus ranges).
// Individual tolerance varies — high carb rates must be practised in training ("train the gut").
import { round } from './util.js';

// intensity: 'easy' (Z1–2) | 'steady' (Z3 / race pace) | 'hard' (Z4+ intervals)
export function fueling(min, intensity = 'easy', tempC = null) {
  let carbs;
  if (min < 60) carbs = intensity === 'hard' ? [0, 30] : [0, 0];
  else if (min < 90) carbs = { easy: [20, 30], steady: [30, 45], hard: [45, 60] }[intensity];
  else if (min < 150) carbs = { easy: [40, 60], steady: [60, 75], hard: [60, 90] }[intensity];
  else carbs = { easy: [60, 80], steady: [75, 90], hard: [80, 90] }[intensity];
  const hot = tempC != null && tempC > 24;
  const fluid = min < 45 ? [0, 300] : hot ? [600, 900] : [400, 700];
  const sodium = min < 90 ? [0, 300] : hot ? [500, 900] : [300, 600];
  const hours = min / 60;
  const total = [Math.round(carbs[0] * hours), Math.round(carbs[1] * hours)];
  const mid = (carbs[0] + carbs[1]) / 2;
  const example = mid === 0 ? 'Water is enough; eat normally before and after.'
    : `≈ ${round(mid / 25, 1)} gels (25 g) per hour, or ${round(mid / 30, 1)} bottle(s) of 30 g drink mix + bars/bananas.`;
  return { carbs, total, fluid, sodium, example, note: min >= 150 ? 'Above 60 g/h use glucose + fructose (2:1). Start eating in the first 20 min, then every 15–20 min.' : min >= 60 ? 'Start fueling after ~30 min, small amounts every 15–20 min.' : '' };
}

// GUT TRAINING — progressive carbohydrate intake for sessions over 2 h.
// Evidence: the gut adapts to high carb intake within ~2–4 weeks of repeated practice (more SGLT1/
// GLUT5 transport, less malabsorption and fewer GI symptoms — Cox et al. 2010, J Appl Physiol;
// Costa et al. 2017, Appl Physiol Nutr Metab; Jeukendrup 2017, Sports Med "Training the gut").
// Ramp ~10 g/h every 2–3 weeks, from today's comfortable level to the race-day target.
//   race-day targets:  bike 80–90 g/h · run 50–70 g/h
//   start levels:      bike 50–60 g/h · run 30–40 g/h  (until 24 weeks out)
//   linear ramp from 24 weeks out → full target 6 weeks before race day, then held
export const GUT = { bike: { from: [50, 60], to: [80, 90] }, run: { from: [30, 40], to: [50, 70] } };
export function gutTraining(sport, dateIso, raceDate) {
  const g = GUT[sport]; if (!g) return null;
  const weeks = (new Date(raceDate) - new Date(dateIso)) / (7 * 864e5);
  const f = Math.max(0, Math.min(1, (24 - weeks) / (24 - 6)));
  const r5 = v => Math.round(v / 5) * 5;
  const carbs = [r5(g.from[0] + (g.to[0] - g.from[0]) * f), r5(g.from[1] + (g.to[1] - g.from[1]) * f)];
  const stage = f >= 1 ? 'race-day target — practise your race fuel' : f <= 0 ? 'base level — gut training starts 24 weeks out' : `gut training ${Math.round(f * 100)} % of the way to race level`;
  return { carbs, target: g.to, stage, f };
}

export function intensityOf(sess) {
  if (!sess) return 'easy';
  if (sess.if >= 0.85) return 'hard';
  if (sess.if >= 0.74) return 'steady';
  return 'easy';
}

// Carb loading for an Ironman: 2 days at 8–10 g/kg, race breakfast 2–3 g/kg 3–4 h before start.
export function carbLoading(weightKg, daysToRace, goalHours = 12) {
  const w = weightKg || 75;
  const plan = [];
  for (let d = Math.min(13, daysToRace); d >= 0; d--) {
    if (d >= 3) plan.push({ d, label: `${d} days out`, gkg: [5, 7], text: 'Normal training diet — carbs around the sessions.' });
    else if (d >= 1) plan.push({ d, label: d === 1 ? 'Day before' : '2 days out', gkg: [8, 10], text: 'Carb load: rice, pasta, potatoes, bread, juice. Low fibre, low fat, moderate protein. Main meal at lunch the day before.' });
    else plan.push({ d, label: 'Race day', gkg: [2, 3], text: 'Breakfast 3–4 h before the start (white bread, honey, banana, rice). 20–30 g gel 15 min before the swim.' });
  }
  const bikeH = goalHours * 0.5, runH = goalHours * 0.37;
  return {
    plan: plan.map(p => ({ ...p, grams: [Math.round(p.gkg[0] * w), Math.round(p.gkg[1] * w)] })),
    race: { bike: [75, 90], run: [45, 60], bikeTotal: [Math.round(75 * bikeH), Math.round(90 * bikeH)], runTotal: [Math.round(45 * runH), Math.round(60 * runH)] },
  };
}
