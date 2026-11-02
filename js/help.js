// "?" help: what it is · how it is calculated · what to do with it.
// Attached automatically to every card / widget whose key or title is listed here.
export const HELP = {
  rings: { t: 'This week', what: 'How much of this week\'s planned swim, bike and run time you have done.', how: 'Completed minutes ÷ planned minutes per discipline. An activity done on a different day still counts for the session it replaces.', act: 'Aim to close all three by Sunday. A ring far behind at mid-week: shift sessions rather than doubling up.' },
  readiness: { t: 'Readiness', what: 'How ready your body is for hard training right now (0–100).', how: 'Weighted from device readiness (25 %), sleep (25 %), HRV vs your 28-day baseline (20 %), resting HR vs baseline (10 %) and form/TSB (20 %). After each activity today it drops by load × 0.3, fading with a ~18 h time constant.', act: '≥ 70: key sessions OK. 45–70: train, but don\'t add extra intensity. < 45: easy or rest — the plan reschedules.' },
  sleep: { t: 'Sleep', what: 'Last night\'s sleep score (or hours if your device gives no score).', how: 'From your watch via intervals.icu. The trend page adds sleep need, sleep debt and weekly averages.', act: 'Ironman training needs 7.5–9 h. Two short nights in a row → drop intensity.' },
  fitness: { t: 'Fitness (CTL)', what: 'Chronic training load — what your body is used to.', how: '42-day exponentially weighted average of daily training load (TSS).', act: 'Build 3–6 points per week. Sub-12 Ironman athletes usually peak around 80–100.' },
  fatigue: { t: 'Fatigue (ATL)', what: 'Acute training load from roughly the last week.', how: '7-day exponentially weighted average of daily training load.', act: 'Should exceed Fitness in build weeks and fall below it in recovery weeks.' },
  form: { t: 'Form (TSB)', what: 'Freshness: fitness minus fatigue.', how: 'TSB = CTL − ATL (yesterday\'s values).', act: '−10 to −30: productive training. Below −30: overreaching risk. Race day: +5 to +25.' },
  vo2max: { t: 'VO2max', what: 'Your aerobic ceiling (ml O₂ per kg per minute).', how: 'From your device; otherwise estimated from eFTP and weight (10.8 × FTP/0.75 ÷ kg + 7).', act: 'Ironman speed depends more on how much of it you can sustain — threshold and durability matter more.' },
  hrv: { t: 'HRV', what: 'Overnight heart-rate variability (rMSSD).', how: 'Compared with your own 28-day baseline (band = ±1 SD).', act: 'Several days below the band: fatigue, illness or stress — swap intensity for easy work.' },
  rhr: { t: 'Resting HR', what: 'Morning / overnight resting heart rate.', how: 'Compared with your 28-day baseline.', act: '+5 bpm or more above baseline often precedes illness or reflects accumulated fatigue — go easy.' },
  recovery: { t: 'Recovery', what: 'Readiness right now, hours until you\'re ready for the next hard session, and tonight\'s sleep need.', how: 'Recovery time per activity of the last 72 h = load × 0.20–0.50 h (higher for higher intensity), ×1.2 after short sleep, ×1.15 with low HRV, ×1.1 when TSB < −25, minus the hours since. Sleep need: see Sleep coach.', act: 'Follow the tips: refuel carbs + protein, rehydrate with salt, sleep the target. Keep sessions easy while recovery time is > 24 h.' },
  sleepcoach: { t: 'Sleep coach', what: 'How long you should sleep tonight.', how: 'Baseline (Settings, default 8 h) + (today\'s load − 50) ÷ 100 h (max +1.5 h) + ¼ of the last 7 nights\' shortfall (max +1 h). Each night\'s need also includes the previous day\'s load.', act: 'Go to bed early enough to hit the target; a 20-min nap helps repay debt. Green bars = need met.' },
  sleepstats: { t: 'Sleep statistics', what: 'Your sleep over time.', how: 'Average hours and sleep score over 7 and 30 nights; weekly averages for the last 12 weeks.', act: 'Look for weeks below ~7.5 h — they often line up with poor sessions or illness.' },
  carb: { t: 'Race fuelling', what: 'Carb loading for the last days before the race.', how: '2 days at 8–10 g carbs per kg body weight; race breakfast 2–3 g/kg 3–4 h before the start.', act: 'Use low-fibre foods (rice, white bread, juice) so the stomach stays calm.' },
  simulator: { t: 'Projected finish', what: 'Predicted finish time for your main race with sliders to play "what if".', how: 'Swim: pool pace with fade beyond your continuous-swim distance (+8 % per doubling, 25 s per stop), wetsuit −5 %. Bike: speed of your long outdoor rides × (FTP change)^⅓. Run: easy pace +6 % off the bike up to your continuous-run distance, then run/walk at 1.35× easy pace. Transitions 12 min.', act: 'Move a slider to see which discipline buys the most time. Your values stay until you press Estimate.' },
  'tg-easy': { t: 'Easy Running Pace', what: 'Your pace at zone-2 heart rate — the pace an Ironman marathon is built on.', how: 'For each run: median pace of the parts with HR in zone 2 (warm-up, walking and GPS drop-outs ignored, heat-corrected). Current = median of your last 5 runs. Ring: 0 % = your first logged runs, 100 % = target 6:00/km. Status compares you with a straight line from that start to race day (±3 %).', act: 'Improve it with lots of easy running. Behind: more easy volume, fewer junk-pace runs.' },
  'tg-runThreshold': { t: 'Run Threshold Pace', what: 'The fastest pace you can hold for about an hour.', how: 'Weighted from your easy pace at Z2 (easy pace × the mid pace-zone-2 fraction), speed at threshold HR (regression), hard sustained runs and race results. Target = the threshold that matches the 5:30–6:00/km easy-pace goal.', act: 'Raise it with threshold intervals and tempo runs; it also lifts your easy pace.' },
  'tg-ftp': { t: 'Indoor Cycling FTP', what: 'The highest power you could hold for about an hour on the trainer.', how: 'Steady efforts ≥ 5 min: watts ÷ %FTP of the HR in their second half (Z2 start 56 %, Z2 top 75 %, LTHR 100 %) — median of your best 3 (60 %); zone-2 blocks, 80th percentile (25 %); watts at LTHR line (15 %). Target = indoor FTP needed for your outdoor race target.', act: 'Raise it with sweet-spot and threshold work. Behind: add one structured session per week.' },
  'tg-css': { t: 'Swim CSS', what: 'Critical swim speed — your sustainable threshold pace per 100 m.', how: 'From a CSS test (400 m + 200 m all-out) if you log one; otherwise from your last 5 pool swims. Target 1:52–2:00/100m allows a 1:15–1:20 Ironman swim.', act: 'Do a CSS test every 6–8 weeks for an accurate value; build with CSS intervals.' },
  load: { t: 'Load management', what: 'Whether your training load is rising safely.', how: 'Ramp rate = CTL change per week; monotony (Foster) = average daily load ÷ its standard deviation over 7 days; grey zone = share of time in Z3.', act: 'Ramp ≤ 5/week is safe, 6–8 caution, > 8 injury risk. Monotony > 2.0: vary hard and easy days. Grey zone > 25 %: easy days too hard.' },
  pmc: { t: 'Performance management', what: 'Fitness, fatigue and form from history to race day.', how: 'CTL (42-day) and ATL (7-day) exponential averages of daily load; TSB = CTL − ATL. Dashed future = your planned sessions.', act: 'The taper should bring race-day form into the blue band (+15 to +30) while keeping fitness high.' },
  tiz: { t: 'Time in zone', what: 'How your weekly training time spreads over the intensity zones.', how: 'HR zones for runs, power zones for indoor rides (HR for outdoor), summed per week.', act: 'Ironman: ~80 % in zones 1–2. Too much zone 3 makes you tired without making you faster.' },
  split: { t: 'Discipline split', what: 'Share of your training time per discipline over the last 4 weeks.', how: 'Minutes per sport ÷ total; compared with typical Ironman targets (swim ~15–20 %, bike ~45–55 %, run ~25–35 %).', act: 'A discipline far below target is usually the one holding your race time back.' },
  coupling: { t: 'Bike FTP · indoor ↔ outdoor', what: 'How your indoor (trainer) FTP relates to your outdoor FTP.', how: 'Outdoor FTP from long outdoor rides: average speed adjusted for climbing → power (air ½·ρ·CdA·v³ + rolling + climbing) → zone-2 power → divided by 65–75 % by heart rate. Ratio = outdoor ÷ indoor.', act: 'Train indoors toward the "indoor target" — that is what 230 W outdoors means on your trainer.' },
  volume: { t: 'Weekly hours', what: 'Planned vs completed training hours per week.', how: 'Sum of planned session durations vs moving time of your activities.', act: 'Missing weeks repeatedly? Lower the plan\'s weekly hours in Settings rather than chasing.' },
  secondary: { t: 'Race predictors', what: 'Reference times for standard distances — not linked to your goal or plan.', how: 'Run: threshold pace × distance factor (5 k 0.97, 10 k 1.0, half 1.05, marathon 1.12) with run/walk beyond your continuous-run limit. Bike: outdoor FTP × 0.97·t^−0.17, flat-road physics. Swim: pool pace with fade. Triathlon: full race model (shown only if you swim, bike and run).', act: 'Use them to pick B-races or check your fitness — they never change your training.' },
  road: { t: 'Road to race', what: 'Your plan week by week until race day.', how: 'Periodised base → build → peak → taper, a recovery week every 4th week, adapted to missed sessions and to the discipline that needs most work.', act: 'Tap a week to see its sessions; move sessions to other days when life gets in the way.' },
  'race-summary': { t: 'Race Day plan', what: 'Your realistic race-day execution plan.', how: 'Built from your current estimates (not your goal time) so the plan is finishable: predicted swim, bike and run plus transitions.', act: 'Train with the plan\'s power, pace and fueling in your last long sessions.' },
  'race-pacing': { t: 'Pacing strategy', what: 'Target power and pace per section.', how: 'Bike: outdoor FTP × IF (0.95·0.97·t^−0.17 ≈ 0.68–0.72 for 6 h), 93 % for the first 20 km, 97 % for the last 30 km, HR cap = top of bike zone 2. Run: first 10 km 10 s/km slower than race pace, race pace up to your continuous-run distance, then run/walk.', act: 'Stick to it even if you feel great early — Ironman is won by whoever slows down least.' },
  'race-fuel': { t: 'Fueling plan', what: 'When to take each gel, drink and salt capsule.', how: 'Bike 85 g carbs/h, 600 ml/h, 600 mg sodium/h; run 60 g/h, 500 ml/h, 500 mg/h. Carbs from your bottles first, gels for the rest, salt capsules for missing sodium. Gel/bottle sizes from Settings. Supported races use aid stations (bike 20 km, run 2.5 km).', act: 'Practise exactly this in long sessions (gut training) — never try new fuel on race day.' },
  'race-export': { t: 'Take it to your watch', what: 'Exports of the race plan.', how: '.FIT workouts with one distance-based step per fueling point and your power/pace targets; printable race card.', act: 'Load the workouts a week before and test them in a long session.' },
  'Aerobic decoupling': { what: 'How much your heart rate drifted relative to pace/power during the session.', how: 'Pa:HR = (output ÷ HR) first half vs second half. < 5 % = aerobically well conditioned for that duration.', act: 'Above 5 % on long easy sessions: keep building aerobic volume at that duration before adding intensity.' },
  'Brick run': { what: 'How your run off the bike went.', how: 'A run starting ≤ 90 min after a ride: first 3 km pace vs the rest.', act: 'A very slow first 3 km: practise more brick runs and pace the bike a little easier.' },
  'EnviroNorm · heat': { what: 'Heat-corrected performance.', how: '≈ 1.5–2 % slower per 5 °C above 22 °C; enter the temperature if your device didn\'t record it.', act: 'Don\'t judge hot-day sessions by raw pace.' },
  'Execution score': { what: 'How well you hit the planned session.', how: 'Duration, intensity (TSS/IF) and time in the target zone compared with the plan.', act: 'Low scores on key sessions: targets may be too high — the app adjusts thresholds from your data.' },
  'Fuel for this session': { what: 'Carbs, fluid and sodium for this session.', how: 'By duration and intensity; sessions over 2 h follow the progressive gut-training targets.', act: 'Practise these amounts — it trains your gut for race day.' },
  'Time in zones': { what: 'Time spent in each intensity zone in this session.', how: 'HR zones (runs, outdoor rides) or power zones (indoor rides) from your intervals.icu settings.', act: 'Easy sessions should be almost all zone 1–2.' },
  Pace: { what: 'Pace over the session (min/km or /100 m).', how: 'From the speed stream; GPS drop-outs and stops filtered. Tap or hover for exact values; the pill shows the average.', act: 'Even or slightly faster second half = well paced.' },
  'Heart rate': { what: 'Heart rate over the session.', how: 'From your HR sensor; zones from your intervals.icu settings.', act: 'Rising HR at the same pace (drift) late in long sessions shows where endurance ends.' },
  Cadence: { what: 'Steps (run) or pedal revolutions (bike) per minute.', how: 'From your watch/sensor.', act: 'Run ~165–180 spm reduces loading; cadence dropping late = fatigue.' },
  Elevation: { what: 'Altitude profile.', how: 'Barometric or GPS altitude; the pill shows total gain.', act: 'Compare pace/HR on climbs with flat sections.' },
  Power: { what: 'Power over the session (watts).', how: 'From your power meter / smart trainer.', act: 'Steady power = good pacing; spikes cost energy on long rides.' },
  Speed: { what: 'Speed over the session.', how: 'From GPS or speed sensor.', act: 'Compare with power/HR to see wind and terrain effects.' },
  'Coach notes': { what: 'Short coaching summary of the session.', how: 'Rule-based analysis (or AI if you added a key) of intensity, decoupling and execution.', act: 'Follow the suggestions in the next similar session.' },
};

// card title → key (for cards without an explicit data-help-key)
const TITLE_MAP = [[/^This week/, 'rings'], [/^Load management/, 'load'], [/^Performance management/, 'pmc'], [/^Time in zone · weekly/, 'tiz'], [/^Discipline split/, 'split'], [/^Bike FTP · indoor/, 'coupling'], [/^Weekly hours/, 'volume'], [/^Projected finish/, 'simulator'], [/^Road to/, 'road'], [/^Race fuelling/, 'carb'], [/^Hours slept/, 'sleep']];
export function helpKeyFor(node) {
  if (node.dataset.helpKey) return node.dataset.helpKey;
  if (node.classList.contains('widget')) return node.dataset.k;
  if (node.classList.contains('sim')) return 'simulator';
  const t = node.querySelector('.card-title')?.textContent.trim() || '';
  for (const [re, k] of TITLE_MAP) if (re.test(t)) return k;
  if (HELP[t]) return t;
  return null;
}

const escH = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function showHelp(key) {
  const H = HELP[key]; if (!H) return;
  document.querySelector('.help-ov')?.remove();
  const ov = document.createElement('div');
  ov.className = 'help-ov';
  ov.innerHTML = `<div class="help-box" role="dialog" aria-modal="true" aria-label="${escH(H.t || key)}"><button class="help-x" aria-label="Close">×</button>
    <h3>${escH(H.t || key)}</h3>
    <div class="help-sec"><b>What it is</b><p>${escH(H.what)}</p></div>
    <div class="help-sec"><b>How it is calculated</b><p>${escH(H.how)}</p></div>
    <div class="help-sec"><b>What it means for you</b><p>${escH(H.act)}</p></div></div>`;
  const close = () => ov.remove();
  ov.onclick = (e) => { if (e.target === ov) close(); };
  ov.querySelector('.help-x').onclick = close;
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  document.body.append(ov);
}
export function attachHelp(root) {
  if (!root?.querySelectorAll) return;
  for (const n of root.querySelectorAll('.card, .widget, .an-card')) {
    if (n.querySelector(':scope > .help-btn')) continue;
    const k = helpKeyFor(n);
    if (!k || !HELP[k]) continue;
    const b = document.createElement('span');
    b.className = 'help-btn'; b.setAttribute('role', 'button'); b.tabIndex = 0; b.setAttribute('aria-label', 'What is this?'); b.textContent = '?';
    const open = (e) => { e.stopPropagation(); e.preventDefault(); showHelp(k); };
    b.onclick = open; b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); };
    n.classList.add('has-help');
    n.append(b);
  }
}
