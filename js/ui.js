import { isoDate, addDays, startOfWeek, today, fmtDur, fmtSec, fmtPace, fmtPace100, fmtKm, fmtDate, paceToStr, strToPace, el, esc, sportIcon, SPORT_LABEL, round, daysBetween, parseDate, clamp } from './util.js';
import { PHASES, DEFAULT_TEMPLATE } from './plan.js';
import { load, save, DEFAULTS, storageWorks } from './store.js';
import { summarise, getSummary, ruleSummary } from './analysis.js';
import { renderWidgets } from './health.js';
import { hrRangeStr, hrZoneOf, plannedDist, getZoneModel } from './zones.js';
import { estimateAll, estimateTrend } from './thresholds.js';
import { describeTarget, fmtMin, ROLES, myWhoosh } from './workouts.js';
import { TRI, goalLabel } from './goals.js';
import { predict } from './predict.js';
import { lineChart, barChart } from './charts.js';
import { openActivity, scoreBadge } from './detail.js';
import { executionScore, tagBricks, weeklyTiz, rampRate, monotony, greyZone, disciplineSplit, IM_TARGET, ftpCoupling, easyPaceSeries } from './analytics.js';
import { fueling, intensityOf, carbLoading } from './nutrition.js';

const h = (html) => el(html);
const sportOf = x => x.sport === 'brick' ? 'run' : x.sport;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const COL = { swim: '#38c6ff', bike: '#ffb020', run: '#3dffa0' };
const COL2 = { swim: '#7b6bff', bike: '#ff5e3a', run: '#00d4c8' };

// ================================================================ TODAY
export function renderToday(A, ui) {
  const root = h('<div class="stack" style="gap:14px"></div>');
  const sel = ui.selectedDate || A.todayIso;
  const weekStart = isoDate(startOfWeek(parseDate(sel)));
  const week = A.plan.weeks.find(w => w.start === weekStart);
  const s = load();
  const daysLeft = daysBetween(today(), s.raceDate);
  root.append(h(`<div class="row between" style="padding:2px 4px">
    <div><div class="small muted">${esc(s.raceName)}</div><div style="font-weight:800;font-size:22px;letter-spacing:-.02em"><span data-count="${daysLeft}">${daysLeft}</span> days to go</div></div>
    ${week ? `<span class="pill accent">${PHASES[week.phase].label}${week.recovery ? ' · recovery' : ''} · wk ${week.index + 1}/${A.plan.totalWeeks + 1}</span>` : ''}
  </div>`));

  root.append(renderRings(A, ui, week));
  if (daysLeft >= 0 && daysLeft < 14) root.append(carbCard(s, daysLeft));
  root.append(renderWidgets(ui.data, ui));

  if (ui.pending?.length) {
    const lbl = { ftp: 'Indoor FTP', runThreshold: 'Run threshold', css: 'Swim CSS' };
    const f = (k, v) => k === 'ftp' ? v + ' W' : paceToStr(v) + (k === 'css' ? '/100m' : '/km');
    const b = h(`<div class="adjust-banner good"><span>↗</span><div style="flex:1"><strong>New threshold estimate from your activities.</strong> ${ui.pending.map(u => `${lbl[u.field]} ${f(u.field, u.from)} → <b>${f(u.field, u.to)}</b>`).join(' · ')}<div style="margin-top:8px"><button class="btn small">Apply</button></div></div></div>`);
    b.querySelector('button').onclick = () => ui.applyPending();
    root.append(b);
  }

  // week strip
  const strip = h('<div class="weekstrip"></div>');
  for (let i = 0; i < 7; i++) {
    const iso = isoDate(addDays(parseDate(weekStart), i));
    const sessions = week ? week.sessions.filter(x => x.date === iso) : [];
    const dots = sessions.map(x => { const done = A.matches[x.id]; const missed = !done && iso < A.todayIso; return `<span class="dot bg-${sportOf(x)} ${done ? 'done' : ''} ${missed ? 'missed' : ''}"></span>`; }).join('');
    const day = h(`<button class="day ${iso === A.todayIso ? 'today' : ''} ${iso === sel ? 'selected' : ''}"><span class="dow">${DOW[i].slice(0, 2)}</span><span class="num">${parseDate(iso).getDate()}</span><span class="dots">${dots || '<span class="dot" style="background:transparent"></span>'}</span></button>`);
    day.onclick = () => { ui.selectedDate = iso; ui.rerender(); };
    strip.append(day);
  }
  const nav = h(`<div class="row between"><button class="btn ghost" data-nav="-1">‹ Prev week</button><button class="btn ghost small" data-nav="0">Today</button><button class="btn ghost" data-nav="1">Next week ›</button></div>`);
  nav.querySelectorAll('button').forEach(b => b.onclick = () => { const n = +b.dataset.nav; ui.selectedDate = n === 0 ? A.todayIso : isoDate(addDays(parseDate(weekStart), n * 7)); ui.rerender(); });
  root.append(strip, nav);

  // plan adjustments
  const banners = [];
  if (A.adjustment.factor !== 1 || A.adjustment.intensityCap) banners.push([A.adjustment.factor > 1 ? 'good' : (A.adjustment.intensityCap ? 'bad' : ''), A.adjustment.factor > 1 ? '▲' : '▼', `<strong>Plan adjusted ${A.adjustment.factor > 1 ? '+' : ''}${Math.round((A.adjustment.factor - 1) * 100)}%.</strong> ${esc(A.adjustment.reason)}`]);
  for (const sp of ['swim', 'bike', 'run']) {
    const m = A.focus?.mult?.[sp] || 1, d = A.focus?.detail?.[sp];
    if (m > 1.01) banners.push(['', '◎', `<strong>More ${SPORT_LABEL[sp].toLowerCase()} time (+${Math.round((m - 1) * 100)}%).</strong> ${d.below} of your last ${d.n} ${SPORT_LABEL[sp].toLowerCase()} sessions fell short — the plan shifts focus there.`]);
  }
  for (const c of A.caught || []) banners.push(['', '↻', `<strong>Catching up ${fmtDur(c.missedMin * 0.5)} of ${SPORT_LABEL[c.sport].toLowerCase()}.</strong> Missed: ${esc(c.label)}. Spread over your remaining ${SPORT_LABEL[c.sport].toLowerCase()} sessions (max +20% each).`]);
  if (sel === A.todayIso && A.todayNote) banners.push([A.todayNote.level, '!', esc(A.todayNote.text)]);
  banners.forEach(([lvl, ic, txt]) => root.append(h(`<div class="adjust-banner ${lvl}"><span>${ic}</span><div>${txt}</div></div>`)));

  // selected day
  const sessions = week ? week.sessions.filter(x => x.date === sel) : [];
  const label = sel === A.todayIso ? 'Today' : fmtDate(sel, { weekday: 'long', day: 'numeric', month: 'long' });
  if (!sessions.length) root.append(h(`<div class="card hero session-hero"><div class="label">${esc(label)}</div><h1>Rest day</h1><p class="muted">Recovery is training. Sleep, eat well, some shoulder mobility if you like.</p></div>`));
  else sessions.forEach((x, i) => root.append(sessionCard(x, A, ui, { label: i === 0 ? label : null, week })));

  if (A.flags.length) root.append(h(`<div class="card"><div class="card-title">Coach notes</div><div class="stack small">${A.flags.map(f => `<div class="row" style="align-items:flex-start;gap:8px"><span class="dot" style="margin-top:5px;background:var(--${f.level === 'bad' ? 'bad' : 'warn'})"></span><span class="muted">${esc(f.text)}</span></div>`).join('')}</div></div>`));
  return root;
}

// ---- rings (Stamina-style) ---------------------------------------------------
function weekVolume(A, data, week) {
  const out = { swim: { plan: 0, done: 0 }, bike: { plan: 0, done: 0 }, run: { plan: 0, done: 0 } };
  if (!week) return out;
  for (const x of week.sessions) if (out[sportOf(x)] && x.kind !== 'race') out[sportOf(x)].plan += x.min;
  for (const a of data?.activities || []) if (a.date >= week.start && a.date <= week.end && out[a.sport]) out[a.sport].done += a.movingSec / 60;
  return out;
}
export function renderRings(A, ui, week) {
  const v = weekVolume(A, ui.data, week);
  const R = 40, C = 2 * Math.PI * R;
  const circle = (sp) => {
    const p = v[sp].plan ? v[sp].done / v[sp].plan : 0;
    const id = 'rg-' + sp;
    return `<div class="ring3">
      <svg viewBox="0 0 100 100" class="ring3-svg">
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${COL[sp]}"/><stop offset="1" stop-color="${COL2[sp]}"/></linearGradient>
        <filter id="${id}-g" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        <circle cx="50" cy="50" r="${R}" fill="none" stroke="${COL[sp]}" stroke-opacity=".14" stroke-width="9"/>
        <circle class="ring" data-p="${Math.min(1, p)}" cx="50" cy="50" r="${R}" fill="none" stroke="url(#${id})" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}" transform="rotate(-90 50 50)" filter="url(#${id}-g)"/>
      </svg>
      <div class="ring3-mid"><span class="ring3-ico" style="color:${COL[sp]}">${sportIcon(sp)}</span><span class="ring3-pct"><span data-count="${Math.round(p * 100)}">0</span>%</span></div>
      <div class="ring3-lbl"><b>${round(v[sp].done / 60, 1)}</b><span> / ${round(v[sp].plan / 60, 1)} h</span></div>
      <div class="ring3-name" style="color:${COL[sp]}">${SPORT_LABEL[sp]}</div>
    </div>`;
  };
  const card = h(`<button class="card rings-card3" aria-label="This week by discipline"><div class="card-title" style="margin-bottom:10px">This week</div><div class="ring3-row">${['swim', 'bike', 'run'].map(circle).join('')}</div></button>`);
  card.onclick = () => ui.setTab('plan');
  requestAnimationFrame(() => requestAnimationFrame(() => card.querySelectorAll('.ring').forEach((c, i) => {
    const len = +c.getAttribute('stroke-dasharray');
    c.style.transitionDelay = `${150 + i * 160}ms`;
    c.setAttribute('stroke-dashoffset', (len * (1 - +c.dataset.p)).toFixed(2));
  })));
  return card;
}

// ---- session card (detail) ---------------------------------------------------
function refMetric(r) {
  if (r.sport === 'bike') return r.np ? `NP ${r.np} W` : r.distanceM && r.min ? `${round(r.distanceM / 1000 / (r.min / 60), 1)} km/h` : '';
  if (r.sport === 'run') return r.paceSecKm ? fmtPace(r.paceSecKm) : '';
  if (r.sport === 'swim') return r.pace100 ? fmtPace100(r.pace100) : '';
  return '';
}
function refBlock(x) {
  if (!x.ref) return '';
  const r = x.ref;
  const bits = [fmtDur(r.min), r.distanceM ? fmtKm(r.distanceM) : '', refMetric(r)].filter(Boolean).join(' · ');
  const d = Math.round(x.min - r.min);
  return `<div class="ref"><div class="faint small">Last time · ${fmtDate(r.date)}</div><div><b>${esc(r.name)}</b> — ${bits}</div><div class="small" style="margin-top:4px">This time: <b>${Math.abs(d) < 5 ? 'same duration' : (d > 0 ? '+' : '−') + fmtDur(Math.abs(d))}</b>${x.dist && r.distanceM ? ` · ${x.dist} m vs ${Math.round(r.distanceM)} m` : ''}</div></div>`;
}
function stepRow(st, x, s) {
  const ctx = { s, sport: x.sport, indoor: x.indoor };
  const amt = st.dist ? `${st.dist} m` : fmtMin(st.min);
  const tg = describeTarget(st.target, ctx);
  const sp = sportOf(x);
  const hrExtra = st.target?.type === 'power' || st.target?.type === 'pace' ? hrRangeStr(sp, st.zone) : null;
  return `<div class="step"><span class="bar z${st.zone || 2}"></span><span>${esc(st.text)}${tg ? `<span class="tchip ${st.target.type}">${esc(tg)}</span>` : ''}${hrExtra ? `<span class="hrchip">♥ ${esc(hrExtra)}</span>` : ''}</span><span class="t">${amt}</span></div>`;
}
function stepsHtml(x, s) {
  return `<div class="steps">${x.steps.map(st => st.repeat
    ? `<div class="block"><div class="block-h">${st.repeat}×</div>${st.steps.map(c => stepRow(c, x, s)).join('')}</div>`
    : stepRow(st, x, s)).join('')}</div>`;
}
export function sessionCard(x, A, ui, opts = {}) {
  const s = load();
  const done = A.matches[x.id];
  const missed = !done && x.date < A.todayIso && x.kind !== 'race';
  const pills = [];
  if (done) pills.push(`<span class="pill good">✓ Done${done.date !== x.origDate ? ' ' + fmtDate(done.date, { weekday: 'short' }) : ''} · ${fmtDur(done.movingSec / 60)}${done.load ? ' · ' + done.load + ' load' : ''}</span>`);
  else if (missed) pills.push('<span class="pill bad">Missed</span>');
  if (x.movedFrom && x.movedFrom !== x.date) pills.push(`<span class="pill">↔ ${x.manual ? 'moved' : x.swapWith ? 'swapped' : 'moved'} from ${fmtDate(x.movedFrom, { weekday: 'short' })}</span>`);
  if (x.catchUp) pills.push(`<span class="pill accent">+${x.catchUp.min} min catch-up</span>`);
  if (x.indoor) pills.push('<span class="pill">Indoor</span>');
  const card = h(`<div class="card hero session-hero ${opts.compact ? 'compact' : ''}">
    ${opts.label ? `<div class="label">${esc(opts.label)}${x.key ? ' · key session' : ''}</div>` : `<div class="label sport-${sportOf(x)}">${SPORT_LABEL[x.sport]}${x.key ? ' · key session' : ''}</div>`}
    <div class="row between" style="align-items:flex-start"><h1>${esc(x.title)}</h1><span class="ico big-ico sport-${sportOf(x)}">${sportIcon(x.sport)}</span></div>
    ${pills.length ? `<div class="row" style="flex-wrap:wrap;gap:6px">${pills.join('')}</div>` : ''}
    ${x.focus ? `<div class="focus">${esc(x.focus)}</div>` : ''}
    <div class="session-meta">
      <div class="metric"><div class="v">${fmtDur(x.min)}</div><div class="k">Duration</div></div>
      ${x.dist ? `<div class="metric"><div class="v">${(x.dist / 1000).toFixed(1)} km</div><div class="k">Distance</div></div>` : ''}
      <div class="metric"><div class="v">${x.tss}</div><div class="k">Load</div></div>
      <div class="metric"><div class="v">${Math.round(x.if * 100)}%</div><div class="k">Intensity</div></div>
    </div>
    ${refBlock(x)}
    ${mwBlock(x)}
    ${stepsHtml(x, s)}
    ${x.note ? `<p class="small muted" style="margin-top:12px">${esc(x.note)}</p>` : ''}
    ${fuelLine(x)}
    ${x.kind !== 'race' ? `<div class="actions">
      <button class="btn secondary small" data-act="fit">⤓ .FIT</button>
      ${x.sport === 'bike' ? '<button class="btn secondary small" data-act="zwo">⤓ .ZWO</button>' : ''}
      <button class="btn secondary small" data-act="send">⇪ Send to device</button>
      ${!done && x.date >= A.todayIso ? '<button class="btn secondary small" data-act="swap">↔ Swap day</button>' : ''}
      ${x.manual ? '<button class="btn ghost small" data-act="undo">Undo move</button>' : ''}
    </div><div class="swap-row" hidden></div>` : ''}
  </div>`);
  card.querySelectorAll('[data-act]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const act = b.dataset.act;
    if (act === 'fit') ui.exportFit(x, b);
    if (act === 'zwo') ui.exportZwo(x);
    if (act === 'send') ui.send([x], b);
    if (act === 'undo') ui.undoMove(x);
    if (act === 'swap') {
      const row = card.querySelector('.swap-row');
      const week = opts.week || A.plan.weeks.find(w => x.date >= w.start && x.date <= w.end);
      if (!row.hidden) { row.hidden = true; return; }
      row.innerHTML = `<div class="small muted" style="margin-bottom:6px">Swap ${fmtDate(x.date, { weekday: 'long' })} with:</div><div class="chips">${week.dates.map((d, i) => d >= A.todayIso && d !== x.date ? `<button class="chip" data-d="${d}">${DOW[i]} ${parseDate(d).getDate()}</button>` : '').join('')}</div>`;
      row.querySelectorAll('[data-d]').forEach(c => c.onclick = () => ui.swap(week, x.date, c.dataset.d));
      row.hidden = false;
    }
  });
  return card;
}

function mwBlock(x) {
  const m = myWhoosh(x);
  if (!m) return '';
  return `<div class="mw"><div class="mw-h"><span class="mw-badge">MyWhoosh</span>${m.name ? `<b>${esc(m.name)}</b><span class="faint small"> · ${m.fit === 'match' ? 'matches' : 'closest library workout'}</span>` : '<b>Free Ride · ERG</b>'}</div>${m.what ? `<div class="small muted">${esc(m.what)}</div>` : ''}${m.manual ? `<div class="small" style="margin-top:4px">${esc(m.manual)}</div>` : ''}</div>`;
}

function fuelLine(x) {
  if (x.kind === 'race' || x.sport === 'swim') return '';
  const f = fueling(x.min, intensityOf(x));
  if (!f.carbs[1]) return '';
  return `<div class="fuel-line"><span>⛽</span><span><b>${f.carbs[0]}–${f.carbs[1]} g carbs/h</b> (${f.total[0]}–${f.total[1]} g total) · ${f.fluid[0]}–${f.fluid[1]} ml/h</span></div>`;
}

function carbCard(s, daysLeft) {
  const c = carbLoading(s.weightKg, daysLeft, s.goalHours || 12);
  const rows = c.plan.filter(p => p.d <= Math.min(daysLeft, 4)).map(p => `<div class="cl-row ${p.d <= 2 ? 'hot' : ''}"><div class="cl-d">${p.label}</div><div><b>${p.grams[0]}–${p.grams[1]} g</b> carbs <span class="faint">(${p.gkg[0]}–${p.gkg[1]} g/kg)</span><div class="small muted">${esc(p.text)}</div></div></div>`).join('');
  return h(`<div class="card hero carb"><div class="row between"><div class="card-title" style="margin:0">Race fuelling · ${daysLeft} days to go</div><span class="pill accent">Taper mode</span></div>
    <div class="stack" style="gap:8px;margin-top:10px">${rows}</div>
    <div class="ref" style="margin-top:12px"><div class="small"><b>In the race:</b> bike ${c.race.bike[0]}–${c.race.bike[1]} g/h (≈${c.race.bikeTotal[0]}–${c.race.bikeTotal[1]} g), run ${c.race.run[0]}–${c.race.run[1]} g/h (≈${c.race.runTotal[0]}–${c.race.runTotal[1]} g). Only products you have trained with.</div></div>
    <div class="small faint" style="margin-top:8px">Based on ${s.weightKg} kg body weight. General sports-nutrition ranges — adjust to what your gut tolerates.</div></div>`);
}

export function renderFuelSheet(ui) {
  const st = ui.fuelCalc ||= { min: 120, intensity: 'easy', temp: '' };
  const node = h(`<div class="detail"><div class="detail-head"><button class="icon-btn" data-close>✕</button><div class="detail-title">Fueling calculator</div></div>
    <div class="form">
      <div class="sl"><div class="row between small"><span class="muted">Duration</span><b data-v="min"></b></div><input type="range" min="30" max="420" step="15" data-k="min" value="${st.min}"></div>
      <div class="field"><label>Intensity</label><div class="chips">${[['easy', 'Easy Z1–2'], ['steady', 'Steady / race pace'], ['hard', 'Hard intervals']].map(([k, l]) => `<button class="chip ${st.intensity === k ? 'on' : ''}" data-i="${k}">${l}</button>`).join('')}</div></div>
      <div class="field"><label>Temperature (optional, °C)</label><input type="number" data-k="temp" value="${st.temp}" placeholder="e.g. 26" style="max-width:140px"></div>
    </div>
    <div class="fuel-out"></div></div>`);
  const out = node.querySelector('.fuel-out');
  const upd = () => {
    const f = fueling(st.min, st.intensity, st.temp === '' ? null : +st.temp);
    node.querySelector('[data-v="min"]').textContent = fmtDur(st.min);
    out.innerHTML = `<div class="fuel-big"><div><div class="big mono" style="color:var(--accent)">${f.carbs[0]}–${f.carbs[1]}</div><div class="small muted">g carbs per hour</div></div><div><div class="big mono">${f.total[0]}–${f.total[1]}</div><div class="small muted">g total</div></div></div>
      <div class="dmetrics" style="margin-top:12px"><div class="metric"><div class="v">${f.fluid[0]}–${f.fluid[1]}</div><div class="k">ml fluid / h</div></div><div class="metric"><div class="v">${f.sodium[0]}–${f.sodium[1]}</div><div class="k">mg sodium / h</div></div></div>
      <p class="small" style="margin-top:12px">${esc(f.example)}</p>${f.note ? `<p class="small muted" style="margin-top:6px">${esc(f.note)}</p>` : ''}
      <p class="small faint" style="margin-top:10px">General ranges; build up high carb rates gradually in training.</p>`;
  };
  node.querySelector('[data-k="min"]').oninput = (e) => { st.min = +e.target.value; upd(); };
  node.querySelector('[data-k="temp"]').oninput = (e) => { st.temp = e.target.value; upd(); };
  node.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { st.intensity = b.dataset.i; node.querySelectorAll('[data-i]').forEach(x => x.classList.toggle('on', x === b)); upd(); });
  node.querySelector('[data-close]').onclick = () => ui.closeSheet();
  upd();
  return node;
}

// ================================================================ PLAN
export function renderPlan(A, ui) {
  const root = h('<div class="stack" style="gap:12px"></div>');
  const plan = A.plan;
  const counts = {}; plan.weeks.forEach(w => counts[w.phase] = (counts[w.phase] || 0) + 1);
  const order = ['base', 'build', 'peak', 'taper', 'race'];
  const ps = load();
  const srcPill = ps.planSource === 'custom' ? `Imported · ${esc(ps.customName || 'plan')}` : ps.planSource === 'goal' ? esc(goalLabel(ps.goal)) : 'Default plan';
  root.append(h(`<div class="card"><div class="row between"><div class="card-title" style="margin:0">Road to ${esc(load().raceName)}</div><span class="pill ${ps.planSource && ps.planSource !== 'default' ? 'accent' : ''}">${srcPill}${ps.indoorMode ? ' · indoor' : ''}</span></div><div style="height:10px"></div>
    <div class="row between"><div class="big">${plan.totalWeeks + 1} <span class="small muted" style="font-weight:600">weeks</span></div><div class="small muted" style="text-align:right">${fmtDate(plan.anchor)} → ${fmtDate(plan.raceDate, { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
    <div class="phase-bar">${order.filter(p => counts[p]).map(p => `<span class="phase-${p}" style="flex:${counts[p]}"></span>`).join('')}</div>
    <div class="phase-legend">${order.filter(p => counts[p]).map(p => `<span><span class="dot phase-${p}" style="margin-right:4px"></span>${PHASES[p].label} ${counts[p]}w</span>`).join('')}</div>
  </div>`));

  const list = h('<div class="stack" style="gap:8px"></div>');
  const cur = plan.weeks.find(w => A.todayIso >= w.start && A.todayIso <= w.end);
  plan.weeks.forEach(w => {
    const isCur = cur && w.index === cur.index;
    const open = ui.openWeeks.has(w.index) || (isCur && !ui.openWeeksTouched);
    const by = { swim: 0, bike: 0, run: 0 }; w.sessions.forEach(x => { if (by[sportOf(x)] != null && x.kind !== 'race') by[sportOf(x)] += x.min; });
    const card = h(`<div class="week-card" id="week-${w.index}">
      <div class="week-head ${isCur ? 'current' : ''}">
        <div><div class="t">Week ${w.index + 1} <span class="muted" style="font-weight:500">· ${fmtDate(w.start, { day: 'numeric', month: 'short' })}</span> ${isCur ? '<span class="pill accent" style="margin-left:6px">now</span>' : ''}</div>
          <div class="s"><span class="dot phase-${w.phase}" style="margin-right:4px"></span>${PHASES[w.phase].label}${w.recovery ? ' · recovery' : ''} · ${w.wtg} wk to race</div></div>
        <div style="text-align:right"><div class="h">${w.hours.toFixed(1)} h</div><div class="small muted"><span class="sport-swim">${round(by.swim / 60, 1)}</span> · <span class="sport-bike">${round(by.bike / 60, 1)}</span> · <span class="sport-run">${round(by.run / 60, 1)}</span></div></div>
      </div>
      ${open ? `<div class="week-body"></div>` : ''}
    </div>`);
    if (open) {
      const body = card.querySelector('.week-body');
      w.sessions.forEach(x => {
        const row = h(sessionRow(x, A.matches[x.id], A.todayIso));
        const isOpen = ui.openSess.has(x.id);
        row.onclick = () => { if (ui.openSess.has(x.id)) ui.openSess.delete(x.id); else ui.openSess.add(x.id); ui.keepScroll(); ui.rerender(); };
        body.append(row);
        if (isOpen) body.append(sessionCard(x, A, ui, { compact: true, week: w }));
      });
      if (w.end >= A.todayIso && w.phase !== 'race') {
        const send = h(`<button class="btn secondary small" style="align-self:flex-start;margin-top:4px">⇪ Send this week to intervals.icu</button>`);
        send.onclick = (e) => { e.stopPropagation(); ui.send(w.sessions.filter(x => !A.matches[x.id] && x.date >= A.todayIso && x.kind !== 'race'), send); };
        body.append(send);
      }
    }
    card.querySelector('.week-head').onclick = () => { ui.openWeeksTouched = true; if (ui.openWeeks.has(w.index)) ui.openWeeks.delete(w.index); else ui.openWeeks.add(w.index); ui.keepScroll(); ui.rerender(); };
    list.append(card);
  });
  root.append(list);
  if (cur && !ui.openWeeksTouched) requestAnimationFrame(() => { const e = root.querySelector(`#week-${cur.index}`); if (e) e.scrollIntoView({ block: 'start' }); });
  return root;
}

function sessionRow(x, done, todayIso) {
  const missed = !done && x.date < todayIso && x.kind !== 'race';
  const moved = x.movedFrom && x.movedFrom !== x.date ? ` · <span class="faint">↔ from ${fmtDate(x.movedFrom, { weekday: 'short' })}</span>` : '';
  return `<div class="session-item ${done ? 'done' : ''} ${missed ? 'missed' : ''}">
    <span class="ico sport-${sportOf(x)}">${sportIcon(x.sport)}</span>
    <div><div class="name">${esc(x.title)}${x.key ? ' <span class="pill accent" style="padding:1px 7px;font-size:10px">key</span>' : ''}</div><div class="sub">${fmtDate(x.date)} · ${fmtDur(x.min)}${x.dist ? ' · ' + (x.dist / 1000).toFixed(1) + ' km' : ''}${x.catchUp ? ` · <span class="sport-brick">+${x.catchUp.min} min</span>` : ''}${moved}${done ? ` · <span class="sport-run">done ${fmtDur(done.movingSec / 60)}</span>` : missed ? ' · <span class="sport-brick">missed</span>' : ''}</div></div>
    <div class="right">${Math.round(x.if * 100)}%</div></div>`;
}

// ================================================================ ACTIVITIES
export function renderActivities(A, ui, data) {
  const root = h('<div class="stack" style="gap:10px"></div>');
  const all = tagBricks(data?.activities || []);
  ui.actLimit ||= 25;
  const acts = all.slice(0, ui.actLimit);
  if (!acts.length) { root.append(h('<div class="empty"><h2>No activities yet</h2><p>Sync with intervals.icu to see your sessions here.</p></div>')); return root; }
  const byAct = {}; for (const [sid, a] of Object.entries(A.matches)) byAct[a.id] = sid;
  const allSess = A.plan.weeks.flatMap(w => w.sessions);
  const plannedFor = (a) => { const sid = byAct[a.id]; return sid ? allSess.find(x => x.id === sid) || null : null; };
  let lastDate = null;
  acts.forEach(a => {
    if (a.date !== lastDate) { root.append(h(`<div class="date-sep">${a.date === A.todayIso ? 'Today' : fmtDate(a.date, { weekday: 'long', day: 'numeric', month: 'long' })}</div>`)); lastDate = a.date; }
    const planned = plannedFor(a);
    const sc = executionScore(a, planned);
    const movedNote = planned && planned.origDate !== a.date ? ` <span class="faint">(planned ${fmtDate(planned.origDate, { weekday: 'short' })})</span>` : '';
    const card = h(`<button class="act act-btn">
      <div class="act-head"><span class="ico sport-${a.sport}">${sportIcon(a.sport)}</span>
        <div style="min-width:0"><div class="name">${esc(a.name)}${a.brick ? ' <span class="pill accent tiny">Brick run</span>' : ''}${a.indoor ? ' <span class="pill tiny">indoor</span>' : ''}</div><div class="sub">${fmtDur(a.movingSec / 60)}${a.distanceM ? ' · ' + fmtKm(a.distanceM) : ''}${a.sport === 'run' && a.paceSecKm ? ' · ' + paceToStr(a.paceSecKm) + '/km' : ''}${a.avgHr ? ' · ♥ ' + Math.round(a.avgHr) : ''}${planned ? ` · <span class="muted">${esc(planned.title)}</span>${movedNote}` : ''}</div></div>
        <div class="right badges">${sc ? scoreBadge(sc) : ''}${summaryBadge(getSummary(a) || ruleSummary(a, { planned, wellness: A.wellness }))}</div></div>
    </button>`);
    card.onclick = () => {
      const ctx = { planned, wellness: A.wellness, phase: (A.plan.weeks.find(w => a.date >= w.start && a.date <= w.end) || {}).phase, weeksLeft: A.goal.weeksLeft, compliance14: A.compliance.c14.ratio != null ? Math.round(A.compliance.c14.ratio * 100) : null };
      openActivity(a, ctx, ui);
    };
    root.append(card);
  });
  if (all.length > acts.length) { const more = h(`<button class="btn secondary">Show more (${all.length - acts.length})</button>`); more.onclick = () => { ui.actLimit += 25; ui.keepScroll(); ui.rerender(); }; root.append(more); }
  return root;
}
function summaryBadge(sm) { if (!sm) return '<span class="pill">…</span>'; const m = { on: ['good', 'On target'], above: ['warn', 'Too hard'], below: ['bad', 'Under'], none: ['', 'No plan'] }[sm.verdict] || ['', '']; return `<span class="pill ${m[0]}">${m[1]}</span>`; }
// ================================================================ PROGRESS
export function renderProgress(A, ui, data) {
  const root = h('<div class="stack" style="gap:12px"></div>');
  const acts = data?.activities || [];
  root.append(simulatorCard(A, ui));
  root.append(loadCard(acts, data?.wellness || []));
  root.append(pmcCard(A, data, ui));
  root.append(tizCard(acts, ui));
  root.append(splitCard(acts));
  root.append(couplingCard(acts, ui));
  root.append(easyPaceCard(data, ui));
  root.append(thresholdCard(data, ui));
  root.append(volumeCard(A, data));
  return root;
}

// ---- what-if race simulator -----------------------------------------------------
function simulatorCard(A, ui) {
  const s = load();
  const b = A.goal.base;
  const d = ui.sim ||= { ftp: 0, css: 0, thr: 0, swimCont: b.swimCont, runCont: round(b.runCont, 1), wetsuit: true };
  const goal = (s.goalHours || 12) * 3600;
  const card = h(`<div class="card hero sim">
    <div class="row between"><div class="card-title" style="margin:0">Projected finish · ${esc(goalLabel(s.planSource === 'goal' || s.planSource === 'custom' ? s.goal : null))}</div><button class="btn ghost small" data-reset>Reset</button></div>
    <div class="row between" style="margin-top:6px"><div class="big mono" data-o="total"></div><span class="pill" data-o="gap"></span></div>
    <div class="splitbar" data-o="bar"><span class="sw"></span><span class="bk"></span><span class="rn"></span><span class="tr"></span><i class="goal"></i></div>
    <div class="split" style="margin-top:12px">
      <div class="metric"><div class="v sport-swim" data-o="swim"></div><div class="k" data-o="swimk"></div></div>
      <div class="metric"><div class="v sport-bike" data-o="bike"></div><div class="k" data-o="bikek"></div></div>
      <div class="metric"><div class="v sport-run" data-o="run"></div><div class="k" data-o="runk"></div></div>
      <div class="metric"><div class="v" data-o="trans"></div><div class="k">Transitions</div></div>
    </div>
    <div class="sliders">
      ${slider('ftp', 'Bike FTP', -30, 80, 1)}
      ${slider('css', 'Swim CSS / pace', -20, 15, 1)}
      ${slider('thr', 'Run threshold', -90, 30, 1)}
      ${slider('swimCont', 'Continuous swim', 100, Math.max(4000, D0g(s).swim), 100)}
      ${slider('runCont', 'Continuous run', 3, Math.max(42.2, D0g(s).run), 0.2)}
      <label class="toggle"><input type="checkbox" data-k="wetsuit" ${d.wetsuit ? 'checked' : ''}> Wetsuit swim</label>
    </div>
    <details class="more" style="margin-top:10px"><summary>How this is calculated</summary><div class="small muted" style="line-height:1.55">
      <b>Swim</b> — your session pace (${esc(b.notes.swim)}). Beyond the distance you can swim without stopping, pace fades ~8% per doubling and each forced stop costs ~25 s. Wetsuit −5%.<br>
      <b>Bike</b> — speed of your long outdoor rides (${esc(b.notes.bike)}), +2% race day. FTP changes scale speed with the cube root of power.<br>
      <b>Run</b> — easy pace at Z2 HR (${esc(b.notes.run)}), +6% off the bike, for the distance you can run continuously (your longest recent run ${b.runLongestKm} km × 1.25); after that run/walk at 1.35× easy pace.<br>
      <b>Transitions</b> 12 min.</div></details>
  </div>`);
  const out = k => card.querySelector(`[data-o="${k}"]`);
  const D0 = predict(b, s, d).D;
  if (!D0.swim) { card.querySelector('[data-o="swim"]').closest('.metric').remove(); card.querySelector('[data-k="css"]').closest('.sl').remove(); card.querySelector('[data-k="swimCont"]').closest('.sl').remove(); card.querySelector('[data-k="wetsuit"]').closest('label').remove(); }
  if (!D0.bike) { card.querySelector('[data-o="bike"]').closest('.metric').remove(); card.querySelector('[data-k="ftp"]').closest('.sl').remove(); }
  if (!D0.run) { card.querySelector('[data-o="run"]').closest('.metric').remove(); card.querySelector('[data-k="thr"]').closest('.sl').remove(); card.querySelector('[data-k="runCont"]').closest('.sl').remove(); }
  if (!D0.trans) card.querySelector('[data-o="trans"]').closest('.metric').remove();
  const update = () => {
    const p = predict(b, s, d);
    out('total').textContent = fmtSec(p.totalSec);
    const diff = p.totalSec - goal;
    out('total').className = 'big mono ' + (diff <= 0 ? 'sport-run' : 'sport-bike');
    out('gap').textContent = diff <= 0 ? `${fmtSec(-diff)} under goal` : `${fmtSec(diff)} over goal`;
    out('gap').className = 'pill ' + (diff <= 0 ? 'good' : 'warn');
    const set = (k, v) => { const e = out(k); if (e) e.textContent = v; };
    set('swim', fmtSec(p.swimSec));
    if (out('swimk')) out('swimk').textContent = `Swim · ${paceToStr(p.swim.effPace)}/100m avg${p.swim.cont < 3800 ? ` · ${Math.floor(3800 / p.swim.cont - 1)} stops` : ''}`;
    set('bike', fmtSec(p.bikeSec));
    set('bikek', `Bike · ${p.bike.kmh} km/h${p.D.hm ? ` · ${p.D.hm} hm` : ''}`);
    set('run', fmtSec(p.runSec));
    if (out('runk')) out('runk').textContent = p.run.walkKm > 0 ? `Run ${round(p.run.runCont, 0)} km @ ${paceToStr(p.run.runPace)} + run/walk ${p.run.walkKm} km` : `Run · ${paceToStr(p.run.runPace)}/km`;
    set('trans', fmtSec(p.transSec));
    const bar = out('bar'), tot = Math.max(p.totalSec, goal);
    bar.querySelector('.sw').style.width = (p.swimSec / tot * 100) + '%';
    bar.querySelector('.bk').style.width = (p.bikeSec / tot * 100) + '%';
    bar.querySelector('.rn').style.width = (p.runSec / tot * 100) + '%';
    bar.querySelector('.tr').style.width = (p.transSec / tot * 100) + '%';
    bar.querySelector('.goal').style.left = (goal / tot * 100) + '%';
    const lab = {
      ftp: `${s.ftp + d.ftp} W ${sign(d.ftp, ' W')}`,
      css: `CSS ${paceToStr(s.css + d.css)} · pace ${paceToStr(b.swimPace + d.css)}`,
      thr: `${paceToStr(s.runThreshold + d.thr)}/km · easy ${paceToStr(b.runEasy + d.thr)}`,
      swimCont: d.swimCont >= (D0.swim || 3800) ? `full ${((D0.swim || 3800) / 1000).toFixed(1)} km` : `${d.swimCont} m`, runCont: d.runCont >= (D0.run || 42.2) ? `full ${D0.run || 42.2} km` : `${round(d.runCont, 1)} km`,
    };
    for (const k in lab) { const e = card.querySelector(`[data-v="${k}"]`); if (e) e.textContent = lab[k]; }
  };
  card.querySelectorAll('input[type=range]').forEach(inp => { inp.value = d[inp.dataset.k]; inp.oninput = () => { d[inp.dataset.k] = +inp.value; update(); }; });
  const ws = card.querySelector('[data-k="wetsuit"]'); if (ws) ws.onchange = (e) => { d.wetsuit = e.target.checked; update(); };
  card.querySelector('[data-reset]').onclick = () => { ui.sim = null; ui.keepScroll(); ui.rerender(); };
  update();
  return card;
}
const D0g = (s) => predict({ swimPace: 120, swimCont: 600, bikeKmh: 28, runEasy: 400, runCont: 10, notes: {} }, s, {}).D;
function sign(v, u) { return v === 0 ? '' : `(${v > 0 ? '+' : '−'}${Math.abs(v)}${u})`; }
function slider(k, label, min, max, step) {
  return `<div class="sl"><div class="row between small"><span class="muted">${label}</span><b data-v="${k}"></b></div><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}"></div>`;
}

// ---- PMC ---------------------------------------------------------------------
function pmcCard(A, data, ui) {
  const s = load();
  const well = (data?.wellness || []).filter(w => w.ctl != null && w.atl != null);
  const card = h(`<div class="card"><div class="row between"><div class="card-title" style="margin:0">Performance management</div><div class="chips">${['12w', 'all'].map(r => `<button class="chip ${(ui.pmcRange || '12w') === r ? 'on' : ''}" data-r="${r}">${r === '12w' ? '12 wk + plan' : 'All'}</button>`).join('')}</div></div><div class="pmc-wrap" style="margin-top:10px"></div><div class="pmc-sum small muted" style="margin-top:6px"></div></div>`);
  card.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { ui.pmcRange = b.dataset.r; ui.keepScroll(); ui.rerender(); });
  if (well.length < 5) { card.querySelector('.pmc-wrap').append(h('<div class="muted small">Needs a few weeks of intervals.icu data.</div>')); return card; }
  const from = (ui.pmcRange || '12w') === '12w' ? isoDate(addDays(new Date(), -84)) : well[0].date;
  const past = well.filter(w => w.date >= from);
  // projection with planned load
  const loadBy = {};
  for (const w of A.plan.weeks) for (const x of w.sessions) {
    if (x.date < A.todayIso || A.matches[x.id]) continue;
    const L = x.kind === 'race' ? 0 : x.tss || 0;
    loadBy[x.date] = (loadBy[x.date] || 0) + L;
  }
  const last = well[well.length - 1];
  let ctl = last.ctl, atl = last.atl;
  const fut = [{ x: last.date, ctl, atl, tsb: ctl - atl }];
  for (let d = addDays(parseDate(last.date), 1); isoDate(d) <= s.raceDate; d = addDays(d, 1)) {
    const iso = isoDate(d); const L = loadBy[iso] || 0;
    // form on race morning = yesterday's fitness − fatigue
    ctl += (L - ctl) / 42; atl += (L - atl) / 7;
    fut.push({ x: iso, ctl: round(ctl, 1), atl: round(atl, 1), tsb: round(ctl - atl, 1) });
  }
  const pts = k => past.map(w => ({ x: w.date, y: round(k === 'tsb' ? w.ctl - w.atl : w[k], 1) })).concat(fut.slice(1).map(f => ({ x: f.x, y: f[k] })));
  const chart = lineChart({
    height: 240, zero: true, today: A.todayIso,
    markers: [{ x: s.raceDate, label: 'Race', color: '#ff6a3d' }],
    bands: [{ y0: -30, y1: -10, color: 'rgba(88,227,154,.06)', label: 'productive' }, { y0: 15, y1: 30, color: 'rgba(76,195,255,.07)', label: 'race-day target' }],
    series: [
      { name: 'Fitness (CTL)', color: '#4cc3ff', pts: pts('ctl'), futureFrom: last.date, area: true, width: 2.6 },
      { name: 'Fatigue (ATL)', color: '#ff5c6c', pts: pts('atl'), futureFrom: last.date, width: 1.8 },
      { name: 'Form (TSB)', color: '#ffb020', pts: pts('tsb'), futureFrom: last.date, width: 1.8, fmt: v => (v > 0 ? '+' : '') + round(v) },
    ],
  });
  card.querySelector('.pmc-wrap').append(chart);
  const race = fut[fut.length - 1], peak = fut.reduce((a, f) => f.ctl > a.ctl ? f : a, fut[0]);
  card.querySelector('.pmc-sum').innerHTML = `<span class="dot" style="background:#4cc3ff"></span> Fitness ${round(last.ctl)} → peak <b>${round(peak.ctl)}</b> (${fmtDate(peak.x, { day: 'numeric', month: 'short' })}) · race-day form <b style="color:${race.tsb >= 0 ? 'var(--good)' : 'var(--warn)'}">${race.tsb > 0 ? '+' : ''}${round(race.tsb)}</b> after the taper. Dashed = projected from the plan.`;
  return card;
}

// ---- thresholds ----------------------------------------------------------------
function thresholdCard(data, ui) {
  const s = load();
  const acts = data?.activities || [];
  const todayIso = isoDate(new Date());
  const est = estimateAll(acts, s, todayIso);
  const trend = estimateTrend(acts, s, todayIso, 12);
  const lbl = { ftp: ['Indoor FTP', 'bike', '#ffb020'], runThreshold: ['Run threshold', 'run', '#58e39a'], css: ['Swim CSS', 'swim', '#4cc3ff'] };
  const fmt = (k, v) => v == null ? '–' : k === 'ftp' ? `${Math.round(v)} W` : `${paceToStr(v)}${k === 'css' ? '/100m' : '/km'}`;
  const conf = { high: 'good', medium: '', low: 'warn', none: '' };
  const card = h(`<div class="card"><div class="card-title">Thresholds · estimated from your activities</div></div>`);
  for (const k of Object.keys(lbl)) {
    const e = est[k];
    const held = s.holds?.[k] && s.holds[k] >= todayIso;
    const row = h(`<div class="th-row"><div class="row between"><div><div class="sport-${lbl[k][1]}" style="font-weight:700">${lbl[k][0]}</div><div class="small muted">in use <b style="color:var(--text)">${fmt(k, s[k])}</b> · estimate <b style="color:var(--text)">${fmt(k, e.value)}</b>${held ? ` · <span class="sport-bike">your value kept until ${fmtDate(s.holds[k], { day: 'numeric', month: 'short' })}</span>` : ''}</div></div><span class="pill ${conf[e.confidence]}">${e.confidence === 'none' ? 'no data' : e.confidence}</span></div>
      <div class="th-chart"></div>
      ${e.hint ? `<div class="small" style="color:var(--warn)">${esc(e.hint)}</div>` : ''}
      ${e.methods.length ? `<div class="small faint">${e.methods.map(m => `${esc(m.label)}: ${fmt(k, m.value)} <span class="faint">(${esc(m.detail)})</span>`).join(' · ')}</div>` : '<div class="small faint">Not enough suitable activities in the last 6 weeks.</div>'}</div>`);
    const pts = trend[k].filter(p => p.value != null).map(p => ({ x: p.date, y: p.value }));
    if (pts.length >= 2) row.querySelector('.th-chart').append(lineChart({ height: 120, invert: k !== 'ftp', yFmt: v => fmt(k, v).replace('/100m', '').replace('/km', ''), series: [{ name: 'Estimate', color: lbl[k][2], pts, dots: true, fmt: v => fmt(k, v) }, { name: 'In use', color: '#9aa3b2', pts: pts.map(p => ({ x: p.x, y: s[k] })), dash: true, width: 1.2, fmt: v => fmt(k, v) }] }));
    card.append(row);
  }
  const log = (s.thresholdLog || []).slice(0, 8);
  const lab2 = { ...Object.fromEntries(Object.entries(lbl).map(([k, v]) => [k, v[0]])), ftpOutdoor: 'Outdoor FTP' };
  if (log.length) card.append(h(`<details class="more" style="margin-top:10px"><summary>Change history (${(s.thresholdLog || []).length})</summary><div class="stack small muted">${log.map(l => `<div>${fmtDate(l.date)} · ${lab2[l.field] || l.field} ${fmt(l.field === 'ftpOutdoor' ? 'ftp' : l.field, l.from)} → <b style="color:var(--text)">${fmt(l.field === 'ftpOutdoor' ? 'ftp' : l.field, l.to)}</b> <span class="faint">(${esc(l.source)})</span></div>`).join('')}</div></details>`));
  card.append(h(`<div class="small faint" style="margin-top:8px">Indoor FTP is estimated from indoor rides with real power only. Outdoor rides without a power meter are judged by heart rate and speed. A value you type in Settings is kept for 4 weeks before estimates may change it.</div>`));
  return card;
}

// ---- easy pace at Z2 HR (run focus 2) ---------------------------------------------
function easyPaceCard(data, ui) {
  const pts = easyPaceSeries(data?.activities || [], 140);
  const card = h(`<div class="card"><div class="row between"><div class="card-title" style="margin:0">Easy pace at Z2 heart rate</div>${ui.streamsLoading ? `<span class="pill">reading HR data… ${ui.streamsLoading}</span>` : ''}</div>
    <div class="small muted" style="margin:6px 0 8px">Median pace of the parts of each run where your HR was in zone 2 (first 5 min and GPS drop-outs ignored, heat-corrected). Goal: 5:30–6:00/km.</div></div>`);
  if (pts.length < 2) { card.append(h('<div class="muted small">Needs a few runs with heart rate.</div>')); return card; }
  const roll = pts.map((p, i) => { const w = pts.slice(Math.max(0, i - 4), i + 1).map(x => x.y).sort((a, b) => a - b); return { x: p.x, y: w[w.length >> 1] }; });
  const now = roll[roll.length - 1].y, then = roll.find(p => p.x >= isoDate(addDays(new Date(), -56)))?.y;
  card.append(h(`<div class="row" style="gap:18px;margin-bottom:6px"><div><div class="big mono" style="font-size:28px;color:var(--run)">${paceToStr(now)}<span class="small muted">/km</span></div><div class="small muted">now (last 5 runs)</div></div>${then ? `<div><div style="font-size:20px;font-weight:800;color:${then - now > 0 ? 'var(--good)' : 'var(--muted)'}">${then - now > 0 ? '−' : '+'}${Math.abs(Math.round(then - now))} s</div><div class="small muted">vs 8 weeks ago</div></div>` : ''}</div>`));
  card.append(lineChart({ height: 180, invert: true, today: A_TODAY(), yFmt: v => paceToStr(v), bands: [{ y0: 330, y1: 360, color: 'rgba(88,227,154,.09)', label: 'goal' }],
    series: [{ name: 'Run', color: 'rgba(61,255,160,.55)', pts, dots: true, width: 0.01, fmt: v => paceToStr(v) + '/km' }, { name: 'Trend (5-run median)', color: '#3dffa0', pts: roll, width: 2.6, fmt: v => paceToStr(v) + '/km' }] }));
  return card;
}
const A_TODAY = () => isoDate(new Date());

// ---- load management: ramp rate, monotony/strain, grey zone ------------------------------
function loadCard(acts, wellness) {
  const rr = rampRate(wellness), mono = monotony(acts), gz = greyZone(acts);
  const card = h(`<div class="card"><div class="card-title">Load management</div><p class="lm-explain"><b style="color:#38c6ff">Fitness (CTL)</b> = your 6-week training load — what your body is adapted to. <b style="color:#ff5c6c">Fatigue (ATL)</b> = your last-week load. <b style="color:#ffb020">Form (TSB)</b> = fitness − fatigue: negative while you build, positive when you are fresh for a race.</p><div class="lm-grid"></div><div class="lm-extra"></div></div>`);
  const grid = card.querySelector('.lm-grid');
  if (rr) grid.append(h(`<div class="metric lm"><div class="row between"><div class="k">Ramp rate</div><span class="pill ${rr.level[0]} tiny">${rr.level[1]}</span></div><div class="v">${rr.value > 0 ? '+' : ''}${rr.value} <span class="small muted">CTL/wk</span></div><div class="small faint">≤5 optimal · 6–8 demanding · >8 risk</div></div>`));
  grid.append(h(`<div class="metric lm"><div class="row between"><div class="k">Monotony (Foster)</div><span class="pill ${mono.high ? 'bad' : 'good'} tiny">${mono.high ? 'High' : 'OK'}</span></div><div class="v">${mono.monotony > 9 ? '—' : mono.monotony}</div><div class="small faint">strain ${mono.strain} · daily load ${mono.mean} ± ${mono.sd}</div></div>`));
  const extra = card.querySelector('.lm-extra');
  if (gz?.high) extra.append(h(`<div class="adjust-banner"><span>!</span><div><strong>High Zone-3 share (${Math.round(gz.share * 100)}% this week).</strong> Avoid the grey zone — keep base training strictly in Z1/Z2.</div></div>`));
  if (mono.high) extra.append(h(`<div class="adjust-banner bad"><span>!</span><div><strong>Training monotony ${mono.monotony} (&gt; 2.0).</strong> Every day looks the same — make easy days easier and hard days harder, or add a real rest day.</div></div>`));
  if (rr && rr.value > 8) extra.append(h(`<div class="adjust-banner bad"><span>!</span><div><strong>Fitness rising ${rr.value} CTL/week.</strong> High risk of injury or overtraining — the plan will trim volume next week.</div></div>`));
  if (rr?.series?.length > 2) { const c = lineChart({ height: 120, zero: true, bands: [{ y0: 5, y1: 8, color: 'rgba(255,176,32,.08)' }, { y0: 8, y1: 30, color: 'rgba(255,92,108,.08)' }], series: [{ name: 'Ramp (CTL/wk)', color: '#38c6ff', pts: rr.series, dots: true, fmt: v => (v > 0 ? '+' : '') + v }] }); extra.append(c); }
  const days = mono.days;
  extra.append(barChart({ height: 110, cats: days.map(d => ({ label: fmtDate(d.d, { weekday: 'short' }).slice(0, 2), title: fmtDate(d.d) })), yFmt: v => String(Math.round(v)), series: [{ name: 'Load', color: '#ff6a3d', values: days.map(d => d.load) }] }));
  return card;
}

// ---- time in zone (weekly stacked) ----------------------------------------------------
function tizCard(acts, ui) {
  const kind = ui.tizKind || 'hr';
  const weeks = weeklyTiz(acts, 10, kind);
  const card = h(`<div class="card"><div class="row between"><div class="card-title" style="margin:0">Time in zone · weekly</div><div class="chips">${[['hr', 'Heart rate'], ['power', 'Power']].map(([k, l]) => `<button class="chip ${kind === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div></div><div style="margin-top:10px"></div></div>`);
  card.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { ui.tizKind = b.dataset.k; ui.keepScroll(); ui.rerender(); });
  const cols = ['#5d6678', '#38c6ff', '#3dffa0', '#ffb020', '#ff5c6c'];
  card.lastElementChild.append(barChart({ stacked: true, height: 190, yFmt: v => `${round(v, 1)} h`,
    cats: weeks.map(w => ({ label: fmtDate(w.week, { day: 'numeric', month: 'numeric' }), title: `Week of ${fmtDate(w.week, { day: 'numeric', month: 'short' })}` })),
    series: [0, 1, 2, 3, 4].map(i => ({ name: `Z${i + 1}`, color: cols[i], values: weeks.map(w => w.z[i]) })) }));
  const cur = weeks[weeks.length - 1];
  if (cur.total > 0) card.append(h(`<div class="small muted" style="margin-top:6px">This week: ${[0, 1, 2, 3, 4].map(i => `<span style="color:${cols[i]}">Z${i + 1} ${Math.round(cur.z[i] / cur.total * 100)}%</span>`).join(' · ')}${kind === 'power' ? ' (indoor rides with real power)' : ''}</div>`));
  return card;
}

// ---- discipline split ------------------------------------------------------------------
function splitCard(acts) {
  const d = disciplineSplit(acts, 28);
  const bar = (share, label) => `<div class="split-row"><div class="small muted" style="width:44px">${label}</div><div class="split-bar">${['swim', 'bike', 'run'].map(sp => `<span style="flex:${Math.max(0.001, share[sp])};background:${COL[sp]}" title="${SPORT_LABEL[sp]} ${Math.round(share[sp] * 100)}%"></span>`).join('')}</div></div>`;
  const tgt = `<div class="split-row"><div class="small muted" style="width:44px">Target</div><div class="split-bar target">${['swim', 'bike', 'run'].map(sp => `<span style="flex:${(IM_TARGET[sp][0] + IM_TARGET[sp][1]) / 2};background:${COL[sp]}"></span>`).join('')}</div></div>`;
  return h(`<div class="card"><div class="card-title">Discipline split · last 4 weeks</div>
    ${bar(d.share, 'Time')}${bar(d.loadShare, 'Load')}${tgt}
    <div class="row small" style="gap:14px;flex-wrap:wrap;margin-top:8px">${['swim', 'bike', 'run'].map(sp => `<span><span class="dot" style="background:${COL[sp]}"></span> ${SPORT_LABEL[sp]} <b>${Math.round(d.share[sp] * 100)}%</b> <span class="faint">${round(d.hours[sp], 1)} h · target ${Math.round(IM_TARGET[sp][0] * 100)}–${Math.round(IM_TARGET[sp][1] * 100)}%</span></span>`).join('')}</div>
    ${d.recs.length ? `<div class="stack small" style="margin-top:10px;gap:6px">${d.recs.map(r => `<div class="row" style="align-items:flex-start;gap:8px"><span class="dot" style="margin-top:5px;background:var(--warn)"></span><span class="muted">${esc(r)}</span></div>`).join('')}</div>` : '<div class="small muted" style="margin-top:10px">Balanced for Ironman.</div>'}
  </div>`);
}

// ---- indoor / outdoor FTP coupling -------------------------------------------------------
function couplingCard(acts, ui) {
  const s = load();
  const c = ftpCoupling(acts, s);
  const card = h(`<div class="card"><div class="row between"><div class="card-title" style="margin:0">Bike FTP · indoor ↔ outdoor</div><button class="btn ghost small" data-recal>Recalibrate</button></div></div>`);
  card.querySelector('[data-recal]').onclick = () => { save({ ftpCoupling: null }); ui.toast('Recalibrating outdoor/indoor ratio'); ui.invalidate(); };
  if (!c.ratio) { card.append(h(`<div class="small muted" style="margin-top:8px">Needs at least two outdoor rides ≥ 1 h with heart rate (or an outdoor FTP in Settings) to calibrate.</div>`)); return card; }
  const pct = Math.round((c.ratio - 1) * 100);
  card.append(h(`<div><div class="dmetrics" style="margin-top:10px">
      <div class="metric"><div class="v" style="color:var(--bike)">${s.ftp} W</div><div class="k">Indoor FTP</div></div>
      <div class="metric"><div class="v">${c.outdoorNow} W</div><div class="k">Outdoor FTP (${pct >= 0 ? '+' : ''}${pct}%)</div></div>
      <div class="metric"><div class="v" style="color:var(--accent)">${c.target} W</div><div class="k">Race target outdoor</div></div>
    </div>
    <div style="margin-top:14px"><div class="row between small"><span>Indoor target to reach ${c.target} W outdoors: <b>${c.indoorTarget} W</b></span><b>${Math.round(c.progress * 100)}%</b></div>
      <div class="progress glow"><span style="width:${Math.min(100, c.progress * 100)}%"></span></div>
      <div class="small faint" style="margin-top:6px">${c.indoorTarget - s.ftp > 0 ? `${c.indoorTarget - s.ftp} W to go on the trainer.` : 'Target reached!'} Ratio calibrated ${c.calib.date ? fmtDate(c.calib.date, { day: 'numeric', month: 'short' }) + ' ' : ''}from ${esc(c.calib.source)}${c.est ? ` · current outdoor estimate from ${c.est.n} rides: ${c.est.ftp} W (avg ${c.est.avgP} W on those rides)` : ''}. As indoor FTP rises, the outdoor value scales with the same ratio.</div></div>
    ${c.ratio > 1.4 && c.calib.source !== 'your outdoor FTP' ? `<div class="adjust-banner" style="margin-top:10px"><span>!</span><div><strong>Outdoor estimate is ${Math.round((c.ratio - 1) * 100)}% above indoor.</strong> Speed-based estimates run high when you ride in a group (drafting) or with tailwind. If it looks wrong, enter your outdoor FTP baseline in Settings.</div></div>` : ''}</div>`));
  return card;
}

// ---- weekly hours ----------------------------------------------------------------
function volumeCard(A, data) {
  const weeks = A.plan.weeks.filter(w => { const d = daysBetween(w.start, A.todayIso); return d >= -42 && d <= 56; });
  const acts = data?.activities || [];
  const cats = weeks.map(w => ({ label: String(w.index + 1), title: `Week ${w.index + 1} · ${fmtDate(w.start, { day: 'numeric', month: 'short' })} · ${PHASES[w.phase].label}${w.recovery ? ' (recovery)' : ''}` }));
  const planned = weeks.map(w => round(w.plannedMin / 60, 1));
  const done = weeks.map(w => round(acts.filter(a => a.date >= w.start && a.date <= w.end).reduce((s, a) => s + a.movingSec / 3600, 0), 1));
  const curIdx = weeks.findIndex(w => A.todayIso >= w.start && A.todayIso <= w.end);
  const card = h(`<div class="card"><div class="card-title">Weekly hours · planned vs done</div></div>`);
  card.append(barChart({ cats, height: 170, yFmt: v => `${round(v, 1)} h`, dim: i => weeks[i].start > A.todayIso,
    series: [{ name: 'Planned', color: '#3a4352', values: planned, colors: planned.map((_, i) => i === curIdx ? '#ff6a3d' : '#3a4352') }, { name: 'Done', color: '#58e39a', values: done }] }));
  return card;
}

// ================================================================ SETTINGS
export function renderSettings(ui, onSave) {
  const s = load();
  const tmpl = s.weekTemplate && s.weekTemplate.length ? s.weekTemplate : DEFAULT_TEMPLATE;
  const roleOpts = (sel) => `<option value="">—</option>` + Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${r.label}</option>`).join('');
  const dayRows = DOW.map((d, i) => { const r = tmpl.filter(t => t.dow === i); return `<div class="dayrow"><span class="dl">${d}</span><select name="t${i}a">${roleOpts(r[0]?.role)}</select><select name="t${i}b">${roleOpts(r[1]?.role)}</select></div>`; }).join('');
  const root = h(`<div class="stack" style="gap:12px">
    ${storageWorks() ? '' : '<div class="adjust-banner bad"><span>!</span><div><strong>This browser blocks storage</strong> (private mode or "block all cookies"). Settings and login are lost when you close the app. Use normal browsing mode.</div></div>'}
    <form class="card form" id="settingsForm" autocomplete="on">
      <div class="card-title">Training plan</div>
      <div class="seg" role="radiogroup">${[['default', 'Default plan', 'Ironman · fixed week'], ['goal', 'My goal', 'pick a race type'], ['custom', 'Imported', s.customName ? esc(s.customName) : 'JSON from your AI']].map(([v, l, sub]) => `<label class="seg-opt ${(s.planSource || 'default') === v ? 'on' : ''}"><input type="radio" name="planSource" value="${v}" ${(s.planSource || 'default') === v ? 'checked' : ''} ${v === 'custom' && !s.customName ? 'disabled' : ''}><b>${l}</b><span>${sub}</span></label>`).join('')}</div>
      <div class="goalbox" ${(s.planSource || 'default') === 'goal' ? '' : 'hidden'}>
        <div class="grid2">
          <div class="field"><label>Discipline</label><select name="goalType">${[['triathlon', 'Triathlon'], ['run', 'Running'], ['bike', 'Cycling'], ['swim', 'Swimming']].map(([v, l]) => `<option value="${v}" ${(s.goal?.type || 'triathlon') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field g-tri"><label>Distance</label><select name="goalTri">${Object.entries(TRI).map(([k, t]) => `<option value="${k}" ${(s.goal?.tri || 'full') === k ? 'selected' : ''}>${t.label} (${t.swim / 1000} / ${t.bike} / ${t.run} km)</option>`).join('')}</select></div>
          <div class="field g-run"><label>Distance (km)</label><input name="goalRunKm" type="number" step="any" min="1" value="${s.goal?.runKm ?? 42.195}"></div>
          <div class="field g-bike"><label>Distance (km)</label><input name="goalBikeKm" type="number" step="any" min="5" value="${s.goal?.bikeKm ?? 100}"></div>
          <div class="field g-bike"><label>Elevation gain (hm)</label><input name="goalBikeHm" type="number" step="10" min="0" value="${s.goal?.bikeHm ?? 0}"></div>
          <div class="field g-swim"><label>Distance (m)</label><input name="goalSwimM" type="number" step="50" min="100" value="${s.goal?.swimM ?? 3800}"></div>
        </div>
        <div class="hint">Your default plan stays untouched — switch back any time. All sports you log still count for fitness and load.</div>
      </div>
      <label class="switch-row"><span><b>Indoor Trainer Mode</b><span class="hint" style="display:block">Long rides on the trainer (MyWhoosh): capped at 3 h, more quality per minute.</span></span><input type="checkbox" class="ios" name="indoorMode" ${s.indoorMode ? 'checked' : ''}></label>

      <div class="card-title" style="margin-top:8px">intervals.icu</div>
      <div class="grid2">
        <div class="field"><label for="athleteId">Athlete ID</label><input id="athleteId" name="username" value="${esc(s.athleteId)}" placeholder="i123456" autocomplete="username" autocapitalize="off" spellcheck="false"></div>
        <div class="field"><label for="apiKey">API key</label><input id="apiKey" name="password" type="password" value="${esc(s.apiKey)}" placeholder="from Settings → Developer" autocomplete="current-password"></div>
      </div>
      <div class="field"><div class="hint">Stored on this device (and offered to your browser's password manager) — sent only to intervals.icu.</div></div>

      <div class="card-title" style="margin-top:8px">Bike</div>
      <div class="grid2">
        <div class="field"><label>Indoor FTP (trainer), W</label><input name="ftp" type="number" min="60" max="500" value="${s.ftp}"><div class="hint">Your indoor Z2 = ${Math.round(s.ftp * 0.56)}–${Math.round(s.ftp * 0.75)} W.</div></div>
        <div class="field"><label>Outdoor FTP baseline, W</label><input name="ftpOutdoor" type="number" min="60" max="500" value="${s.ftpOutdoor || ''}" placeholder="auto"><div class="hint">Blank = estimated from speed + HR. Sets the indoor↔outdoor ratio.</div></div>
        <div class="field"><label>Race target outdoor FTP, W</label><input name="raceTargetW" type="number" min="100" max="500" value="${s.raceTargetW || 230}"></div>
      </div>
      <div class="field"><label class="toggle"><input type="checkbox" name="outdoorPower" ${s.outdoorPower ? 'checked' : ''}> I have a power meter on my outdoor bike</label><div class="hint">Off: outdoor rides are prescribed and judged by heart rate; estimated (Strava) watts are ignored.</div></div>

      <div class="card-title" style="margin-top:8px">Run & swim</div>
      <div class="grid2">
        <div class="field"><label>Run threshold pace (min/km)</label><input name="runThreshold" value="${paceToStr(s.runThreshold)}" placeholder="5:40"></div>
        <div class="field"><label>Swim CSS (min/100m)</label><input name="css" value="${paceToStr(s.css)}" placeholder="1:50"></div>
        <div class="field"><label>Longest swim without stopping (m)</label><input name="swimContinuous" type="number" min="50" max="5000" step="50" value="${s.swimContinuous || 600}"></div>
        <div class="field"><label>Longest run without walking (km)</label><input name="runContinuous" type="number" min="1" max="42.2" step="0.5" value="${s.runContinuous || ''}" placeholder="auto"></div>
        <div class="field"><label>Weight (kg)</label><input name="weightKg" type="number" min="40" max="150" value="${s.weightKg}"></div>
      </div>
      <div class="field"><label>How thresholds are updated</label><select name="thresholdSource">
        <option value="auto" ${s.thresholdSource === 'auto' ? 'selected' : ''}>Automatically from my activities (recommended)</option>
        <option value="suggest" ${s.thresholdSource === 'suggest' ? 'selected' : ''}>Suggest from my activities, I confirm</option>
        <option value="intervals" ${s.thresholdSource === 'intervals' ? 'selected' : ''}>Always use my intervals.icu sport settings</option>
        <option value="manual" ${s.thresholdSource === 'manual' ? 'selected' : ''}>Manual only</option></select>
        <div class="hint">A value you change here is kept for 4 weeks, then estimates may adjust it again (max ±5% per update). ${zoneInfo()}</div></div>

      <div class="card-title" style="margin-top:8px">Heart-rate zones</div>
      <div class="field"><label class="toggle"><input type="checkbox" name="hrManual" ${s.manualHr?.enabled ? 'checked' : ''}> Use my own HR zones (instead of intervals.icu)</label>
        <div class="hrz">${[1, 2, 3, 4, 5].map(i => `<div class="field"><label>Z${i} up to</label><input name="hrz${i}" type="number" min="60" max="230" value="${s.manualHr?.tops?.[i - 1] ?? ''}" placeholder="${getZoneModel().run.hr?.[i - 1] ?? ''}"></div>`).join('')}<div class="field"><label>LTHR</label><input name="hrLthr" type="number" min="100" max="220" value="${s.manualHr?.lthr ?? ''}" placeholder="${getZoneModel().run.lthr ?? ''}"></div></div>
        <div class="hint">Upper limit (bpm) of each zone; Z5 = max HR. Applied to all workout targets, analysis and charts.</div></div>

      <div class="card-title" style="margin-top:8px">Weekly schedule (fixed days)</div>
      <div class="field"><div class="hint" style="margin:0 0 8px">Up to two sessions per day. Durations and intensity are planned for you; the days stay as set here.</div>${dayRows}</div>

      <div class="card-title" style="margin-top:8px">Race & goal</div>
      <div class="grid2">
        <div class="field"><label>Race name</label><input name="raceName" value="${esc(s.raceName)}"></div>
        <div class="field"><label>Race date</label><input name="raceDate" type="date" value="${esc(s.raceDate)}"></div>
        <div class="field"><label>Goal time (hours)</label><input name="goalHours" type="number" step="0.25" min="8" max="17" value="${s.goalHours}"></div>
      </div>

      <div class="card-title" style="margin-top:8px">AI coach (optional)</div>
      <div class="field"><label>Anthropic API key</label><input name="anthropicKey" type="password" value="${esc(s.anthropicKey)}" placeholder="sk-ant-…" autocomplete="off"><div class="hint">Enables Claude-written summaries per activity, called directly from your browser.</div></div>
      <div class="field"><label>Model</label><input name="anthropicModel" value="${esc(s.anthropicModel)}"></div>

      <details class="more"><summary>Advanced</summary>
        <div class="field"><label>CORS proxy prefix (only if intervals.icu blocks browser requests)</label><input name="corsProxy" value="${esc(s.corsProxy)}" placeholder="https://your-worker.workers.dev/?url="></div>
        <div class="field"><label>Plan anchor date</label><input name="planStart" type="date" value="${esc(s.planStart || '')}"><div class="hint">The Monday of this week is week 1.</div></div>
        <div class="field"><label class="toggle"><input type="checkbox" name="demo" ${s.demo ? 'checked' : ''}> Demo mode (synthetic data, no API calls)</label></div>
        <button class="btn secondary small" type="button" id="btnMoves">Reset all day swaps</button>
      </details>
      <button class="btn" type="submit">Save & sync</button>
      <button class="btn secondary" type="button" id="btnReset">Clear all local data</button>
    </form>
  </div>`);
  root.querySelector('form').after(h(`<div class="card"><div class="card-title">Plans & sharing</div>
    <div class="stack" style="gap:8px">
      <button class="btn secondary" type="button" data-pa="prompt">⤓ Download AI Coach Prompt for Custom Plan</button>
      <div class="hint">Give this file to any AI (ChatGPT, Claude, Gemini…). It interviews you, builds a day-by-day plan up to race day and ends with JSON you can import here.</div>
      <button class="btn secondary" type="button" data-pa="import">⇪ Import plan (JSON from your AI)</button>
      <button class="btn secondary" type="button" data-pa="export">⤓ Export current plan (JSON)</button>
      <button class="btn ghost" type="button" data-pa="reset">↺ Reset to default plan</button>
    </div></div>`));
  root.querySelectorAll('[data-pa]').forEach(b => b.onclick = () => ui.planAction(b.dataset.pa));
  const form = root.querySelector('form');
  const syncGoal = () => {
    const src = form.querySelector('[name=planSource]:checked')?.value;
    form.querySelectorAll('.seg-opt').forEach(o => o.classList.toggle('on', o.querySelector('input').checked));
    form.querySelector('.goalbox').hidden = src !== 'goal';
    const t = form.querySelector('[name=goalType]').value;
    form.querySelectorAll('.g-tri,.g-run,.g-bike,.g-swim').forEach(el => { el.hidden = !el.classList.contains('g-' + t); });
  };
  form.querySelectorAll('[name=planSource],[name=goalType]').forEach(i => i.onchange = syncGoal);
  syncGoal();
  form.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const today = isoDate(new Date());
    const tpl = [];
    for (let i = 0; i < 7; i++) for (const k of ['a', 'b']) { const r = fd.get(`t${i}${k}`); if (r) tpl.push({ dow: i, role: r }); }
    const patch = {
      athleteId: fd.get('username').trim(), apiKey: fd.get('password').trim(), anthropicKey: fd.get('anthropicKey').trim(), anthropicModel: fd.get('anthropicModel').trim() || DEFAULTS.anthropicModel,
      corsProxy: fd.get('corsProxy').trim(), raceName: fd.get('raceName').trim() || 'Ironman', raceDate: fd.get('raceDate'), goalHours: +fd.get('goalHours') || 12,
      ftp: +fd.get('ftp') || s.ftp, ftpOutdoor: +fd.get('ftpOutdoor') || null, outdoorPower: fd.get('outdoorPower') === 'on',
      weightKg: +fd.get('weightKg') || 75, runThreshold: strToPace(fd.get('runThreshold')) || s.runThreshold, css: strToPace(fd.get('css')) || s.css,
      swimContinuous: +fd.get('swimContinuous') || 600, runContinuous: +fd.get('runContinuous') || null,
      thresholdSource: fd.get('thresholdSource'), demo: fd.get('demo') === 'on', weekTemplate: tpl.length ? tpl : null,
      planSource: fd.get('planSource') || 'default', indoorMode: fd.get('indoorMode') === 'on',
      goal: fd.get('planSource') === 'custom' ? s.goal : { type: fd.get('goalType'), tri: fd.get('goalTri'), runKm: +fd.get('goalRunKm') || 42.195, bikeKm: +fd.get('goalBikeKm') || 100, bikeHm: +fd.get('goalBikeHm') || 0, swimM: +fd.get('goalSwimM') || 3800 },
      planStart: fd.get('planStart') || s.planStart || today,
    };
    if (patch.athleteId && /^\d+$/.test(patch.athleteId)) patch.athleteId = 'i' + patch.athleteId;
    // manual threshold edits: keep them for 4 weeks and log them
    const tops = [1, 2, 3, 4, 5].map(i => +fd.get('hrz' + i) || null);
    patch.manualHr = { enabled: fd.get('hrManual') === 'on' && tops.every(Boolean), tops: tops.every(Boolean) ? tops : (s.manualHr?.tops || null), lthr: +fd.get('hrLthr') || null };
    if (fd.get('hrManual') === 'on' && !tops.every(Boolean)) ui.toast('Fill in all five zone limits to use manual HR zones', true);
    patch.raceTargetW = +fd.get('raceTargetW') || 230;
    if (!patch.outdoorPower && patch.ftpOutdoor !== s.ftpOutdoor) patch.ftpCoupling = patch.ftpOutdoor ? { ratio: patch.ftpOutdoor / patch.ftp, outdoor: patch.ftpOutdoor, indoor: patch.ftp, date: today, source: 'your outdoor FTP' } : null;
    const holds = { ...(s.holds || {}) }, log = [...(s.thresholdLog || [])];
    for (const k of ['ftp', 'ftpOutdoor', 'runThreshold', 'css']) {
      if (patch[k] && patch[k] !== s[k]) { holds[k] = isoDate(addDays(new Date(), 28)); log.unshift({ date: today, field: k, from: s[k], to: patch[k], source: 'you, in Settings' }); }
    }
    save({ ...patch, holds, thresholdLog: log.slice(0, 40) });
    onSave();
  };
  root.querySelector('#btnReset').onclick = () => { if (ui.confirm('Clear all local data including keys and cached summaries?')) ui.reset(); };
  root.querySelector('#btnMoves').onclick = () => { save({ moves: {} }); ui.toast('Day swaps reset'); ui.invalidate(); };
  return root;
}

function zoneInfo() {
  const m = getZoneModel();
  const part = (sp, name) => { const z = m[sp]; return `${name}: ${z.source === 'intervals' ? 'your intervals.icu zones' : 'default zones'}${z.lthr ? `, LTHR ${z.lthr}` : ''}${z.hr ? '' : ', no HR zones'}`; };
  return `Zones — ${part('bike', 'Bike')} · ${part('run', 'Run')}.`;
}

export function renderSetup(onDemo, onLogin) {
  const s = load();
  const root = h(`<div class="stack" style="gap:14px">
    <div class="card hero" style="padding:24px"><div class="label" style="color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Welcome</div>
      <h1 style="font-size:28px;margin:8px 0 10px">Your adaptive road to a sub-12 Ironman</h1>
      <p class="muted" style="line-height:1.5">Sign in with your intervals.icu athlete ID and API key (intervals.icu → Settings → Developer Settings). Your browser can save them like a password.</p>
      <form id="login" class="form" style="margin-top:16px" autocomplete="on">
        <div class="field"><label for="l-user">Athlete ID</label><input id="l-user" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="i123456" value="${esc(s.athleteId)}" required></div>
        <div class="field"><label for="l-pass">API key</label><input id="l-pass" name="password" type="password" autocomplete="current-password" value="${esc(s.apiKey)}" required></div>
        <button class="btn" type="submit">Connect</button>
      </form>
      <button class="btn secondary" style="margin-top:10px" id="btnDemo">Explore with demo data</button>
    </div>
  </div>`);
  root.querySelector('#btnDemo').onclick = onDemo;
  root.querySelector('#login').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    let id = fd.get('username').trim(); if (/^\d+$/.test(id)) id = 'i' + id;
    onLogin(id, fd.get('password').trim());
  };
  return root;
}
