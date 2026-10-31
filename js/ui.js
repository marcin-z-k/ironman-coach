import { isoDate, addDays, startOfWeek, today, fmtDur, fmtSec, fmtPace, fmtPace100, fmtKm, fmtDate, paceToStr, strToPace, el, esc, sportIcon, SPORT_LABEL, round, daysBetween, parseDate, clamp } from './util.js';
import { PHASES, DEFAULT_TEMPLATE } from './plan.js';
import { load, save, DEFAULTS, storageWorks } from './store.js';
import { summarise, getSummary, ruleSummary } from './analysis.js';
import { renderWidgets } from './health.js';
import { hrRangeStr, hrZoneOf, plannedDist, getZoneModel } from './zones.js';
import { estimateAll, estimateTrend } from './thresholds.js';
import { describeTarget, fmtMin, ROLES } from './workouts.js';
import { predict } from './predict.js';
import { lineChart, barChart } from './charts.js';

const h = (html) => el(html);
const sportOf = x => x.sport === 'brick' ? 'run' : x.sport;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const COL = { swim: '#4cc3ff', bike: '#ffb020', run: '#58e39a' };

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
  const order = [['swim', 46], ['bike', 34], ['run', 22]];
  const C = r => 2 * Math.PI * r;
  const rings = order.map(([sp, r]) => {
    const p = v[sp].plan ? v[sp].done / v[sp].plan : 0;
    return `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${COL[sp]}" stroke-opacity=".16" stroke-width="10"/>
      <circle class="ring" data-p="${Math.min(1, p)}" cx="60" cy="60" r="${r}" fill="none" stroke="${COL[sp]}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C(r).toFixed(2)}" stroke-dashoffset="${C(r).toFixed(2)}" transform="rotate(-90 60 60)"/>`;
  }).join('');
  const rows = order.map(([sp]) => {
    const p = v[sp].plan ? v[sp].done / v[sp].plan : 0;
    return `<div class="ring-row"><span class="ring-ico sport-${sp}">${sportIcon(sp)}</span><div class="ring-txt"><div class="ring-name">${SPORT_LABEL[sp]}</div><div class="ring-h"><b>${round(v[sp].done / 60, 1)}</b> / ${round(v[sp].plan / 60, 1)} h</div></div><div class="ring-pct" style="color:${COL[sp]}"><span data-count="${Math.round(p * 100)}">0</span>%</div></div>`;
  }).join('');
  const card = h(`<button class="card rings-card" aria-label="This week by discipline"><svg viewBox="0 0 120 120" class="rings">${rings}</svg><div class="ring-legend"><div class="card-title" style="margin-bottom:6px">This week</div>${rows}</div></button>`);
  card.onclick = () => ui.setTab('plan');
  requestAnimationFrame(() => requestAnimationFrame(() => card.querySelectorAll('.ring').forEach((c, i) => {
    const len = +c.getAttribute('stroke-dasharray');
    c.style.transitionDelay = `${150 + i * 140}ms`;
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
    ${stepsHtml(x, s)}
    ${x.note ? `<p class="small muted" style="margin-top:12px">${esc(x.note)}</p>` : ''}
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

// ================================================================ PLAN
export function renderPlan(A, ui) {
  const root = h('<div class="stack" style="gap:12px"></div>');
  const plan = A.plan;
  const counts = {}; plan.weeks.forEach(w => counts[w.phase] = (counts[w.phase] || 0) + 1);
  const order = ['base', 'build', 'peak', 'taper', 'race'];
  const tmpl = plan.template.map(t => `${DOW[t.dow]} ${ROLES[t.role].label.replace(/^\w+ – /, '').toLowerCase()} ${ROLES[t.role].sport}`).join(' · ');
  root.append(h(`<div class="card"><div class="card-title">Road to ${esc(load().raceName)}</div>
    <div class="row between"><div class="big">${plan.totalWeeks + 1} <span class="small muted" style="font-weight:600">weeks</span></div><div class="small muted" style="text-align:right">${fmtDate(plan.anchor)} → ${fmtDate(plan.raceDate, { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
    <div class="phase-bar">${order.filter(p => counts[p]).map(p => `<span class="phase-${p}" style="flex:${counts[p]}"></span>`).join('')}</div>
    <div class="phase-legend">${order.filter(p => counts[p]).map(p => `<span><span class="dot phase-${p}" style="margin-right:4px"></span>${PHASES[p].label} ${counts[p]}w</span>`).join('')}</div>
    <div class="ref" style="margin-top:12px"><div class="faint small">Your fixed week (change in Settings)</div><div class="small">${esc(tmpl)}</div></div>
    <div class="small muted" style="margin-top:10px;line-height:1.5">Days stay fixed; duration, intensity and focus change. Swim builds to 3.8 km continuous, long run to 3 h (run/walk), long ride to 5½ h with strong blocks. If you train on another day, that session counts and the days swap automatically.</div>
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
  const all = data?.activities || [];
  ui.actLimit ||= 25;
  const acts = all.slice(0, ui.actLimit);
  if (!acts.length) { root.append(h('<div class="empty"><h2>No activities yet</h2><p>Sync with intervals.icu to see your sessions here, each with a coach summary.</p></div>')); return root; }
  const s = load();
  if (!s.anthropicKey) root.append(h('<div class="small muted" style="padding:0 4px">Summaries are rule-based. Add an Anthropic API key in Settings for AI coach feedback.</div>'));
  const byAct = {}; for (const [sid, a] of Object.entries(A.matches)) byAct[a.id] = sid;
  const allSess = A.plan.weeks.flatMap(w => w.sessions);
  const plannedFor = (a) => { const sid = byAct[a.id]; return sid ? allSess.find(x => x.id === sid) || null : null; };
  let lastDate = null;
  acts.forEach(a => {
    if (a.date !== lastDate) { root.append(h(`<div class="date-sep">${a.date === A.todayIso ? 'Today' : fmtDate(a.date, { weekday: 'long', day: 'numeric', month: 'long' })}</div>`)); lastDate = a.date; }
    const planned = plannedFor(a);
    const open = ui.openActs.has(a.id);
    const movedNote = planned && planned.origDate !== a.date ? ` <span class="faint">(planned ${fmtDate(planned.origDate, { weekday: 'short' })})</span>` : '';
    const card = h(`<div class="act">
      <div class="act-head"><span class="ico sport-${a.sport}">${sportIcon(a.sport)}</span>
        <div><div class="name">${esc(a.name)}${a.indoor ? ' <span class="pill" style="padding:0 6px;font-size:10px">indoor</span>' : ''}</div><div class="sub">${fmtDur(a.movingSec / 60)}${a.distanceM ? ' · ' + fmtKm(a.distanceM) : ''}${a.load ? ' · load ' + a.load : ''}${planned ? ` · <span class="muted">plan: ${esc(planned.title)}</span>${movedNote}` : (a.date < A.plan.anchor ? '' : ' · unplanned')}</div></div>
        <div class="right">${summaryBadge(getSummary(a) || ruleSummary(a, { planned, wellness: A.wellness }))}</div></div>
      ${open ? actDetail(a, planned) : ''}
    </div>`);
    card.querySelector('.act-head').onclick = () => { if (ui.openActs.has(a.id)) ui.openActs.delete(a.id); else ui.openActs.add(a.id); ui.keepScroll(); ui.rerender(); };
    if (open) {
      const box = card.querySelector('.summary');
      const ctx = { planned, wellness: A.wellness, phase: (A.plan.weeks.find(w => a.date >= w.start && a.date <= w.end) || {}).phase, weeksLeft: A.goal.weeksLeft, compliance14: A.compliance.c14.ratio != null ? Math.round(A.compliance.c14.ratio * 100) : null };
      const existing = getSummary(a);
      if (existing && !(existing.source === 'rules' && s.anthropicKey && !existing.error)) fillSummary(box, existing);
      else { box.innerHTML = '<div class="muted small">Analysing…</div>'; summarise(a, ctx).then(r => { fillSummary(box, r); const b = card.querySelector('.right'); if (b) b.innerHTML = summaryBadge(r); }); }
      const redo = card.querySelector('[data-redo]'); if (redo) redo.onclick = (e) => { e.stopPropagation(); box.innerHTML = '<div class="muted small">Analysing…</div>'; summarise(a, ctx, { force: true }).then(r => fillSummary(box, r)); };
    }
    root.append(card);
  });
  if (all.length > acts.length) { const more = h(`<button class="btn secondary">Show more (${all.length - acts.length})</button>`); more.onclick = () => { ui.actLimit += 25; ui.keepScroll(); ui.rerender(); }; root.append(more); }
  return root;
}
function summaryBadge(sm) { if (!sm) return '<span class="pill">…</span>'; const m = { on: ['good', 'On target'], above: ['warn', 'Too hard'], below: ['bad', 'Under'], none: ['', 'No plan'] }[sm.verdict] || ['', '']; return `<span class="pill ${m[0]}">${m[1]}</span>`; }
function actDetail(a, planned) {
  const s = load();
  const cells = [];
  const realPower = a.deviceWatts !== false && (a.indoor || s.outdoorPower);
  if (a.avgHr) cells.push(['Avg HR', Math.round(a.avgHr)]);
  if (a.np && realPower) cells.push(['NP', a.np + ' W']);
  if (a.paceSecKm) cells.push(['Pace', fmtPace(a.paceSecKm).replace('/km', '')]);
  if (a.pace100) cells.push(['Pace', fmtPace100(a.pace100).replace('/100m', '')]);
  if (a.speedKmh) cells.push(['Speed', round(a.speedKmh, 1) + ' km/h']);
  if (a.intensity != null) cells.push(['IF', a.intensity + '%']);
  if (a.elev) cells.push(['Climb', Math.round(a.elev) + ' m']);
  if (a.rpe != null) cells.push(['RPE', a.rpe]);
  if (a.decoupling != null) cells.push(['Drift', round(a.decoupling, 1) + '%']);
  return `<div class="act-stats">${cells.slice(0, 8).map(c => `<div class="metric"><div class="v">${c[1]}</div><div class="k">${c[0]}</div></div>`).join('')}</div>
    ${zoneBars(a, planned, realPower)}
    ${planned ? `<div class="small muted" style="margin-top:10px">Planned: <b>${esc(planned.title)}</b> · ${fmtDur(planned.min)} · ${Math.round(planned.if * 100)}% · load ${planned.tss}</div>` : ''}
    <div class="summary"></div>
    <div class="row between" style="margin-top:8px"><button class="btn ghost small" data-redo>↻ Re-analyse</button><a class="small" href="https://intervals.icu/activities/${esc(a.id)}" target="_blank" rel="noopener">Open in intervals.icu ↗</a></div>`;
}
const ZCOL = ['#5d6678', '#4cc3ff', '#58e39a', '#ffb020', '#ff7a45', '#ff5c6c', '#c44cff'];
function zoneBar(label, secs) {
  if (!secs || !secs.some(Boolean)) return '';
  const tot = secs.reduce((a, b) => a + (b || 0), 0);
  const segs = secs.map((v, i) => v ? `<span style="flex:${v};background:${ZCOL[Math.min(i, 6)]}" title="Z${i + 1}: ${Math.round(v / 60)} min"></span>` : '').join('');
  const top = secs.map((v, i) => [v, i]).filter(x => x[0] / tot >= 0.08).map(([v, i]) => `Z${i + 1} ${Math.round(v / tot * 100)}%`).join(' · ');
  return `<div class="zrow"><div class="zl">${label}</div><div class="zbar">${segs}</div><div class="zt">${top}</div></div>`;
}
function zoneBars(a, planned, realPower) {
  const rows = [];
  if (a.powerZoneSecs && realPower) rows.push(zoneBar('Power', a.powerZoneSecs));
  if (a.paceZoneSecs && a.sport !== 'bike') rows.push(zoneBar(a.sport === 'swim' ? 'Pace' : 'Pace (GAP)', a.paceZoneSecs));
  if (a.hrZoneSecs) rows.push(zoneBar('Heart rate', a.hrZoneSecs));
  if (planned) { const pd = plannedDist(planned.steps); if (pd) rows.push(zoneBar('Planned', pd.secs)); }
  const out = rows.filter(Boolean);
  return out.length ? `<div class="zones">${out.join('')}</div>` : '';
}
function fillSummary(box, r) {
  const m = { on: ['good', 'On target'], above: ['warn', 'Harder than intended'], below: ['bad', 'Under-delivered'], none: ['', 'Not in the plan'] }[r.verdict] || ['', 'Summary'];
  box.innerHTML = `<div class="verdict"><span class="dot" style="background:var(--${m[0] || 'muted'})"></span>${m[1]}</div><div>${esc(r.text)}</div><div class="adjust"><b>Change anything?</b> ${esc(r.adjust)}</div><div class="src">${r.source === 'ai' ? 'AI coach' : 'Rule-based'}${r.error ? ' · AI failed: ' + esc(r.error) : ''}</div>`;
}

// ================================================================ PROGRESS
export function renderProgress(A, ui, data) {
  const root = h('<div class="stack" style="gap:12px"></div>');
  root.append(simulatorCard(A, ui));
  root.append(pmcCard(A, data, ui));
  root.append(thresholdCard(data, ui));
  const ep = easyPaceCard(data);
  if (ep) root.append(ep);
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
    <div class="row between"><div class="card-title" style="margin:0">Projected finish</div><button class="btn ghost small" data-reset>Reset</button></div>
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
      ${slider('swimCont', 'Continuous swim', 100, 4000, 100)}
      ${slider('runCont', 'Continuous run', 3, 42.2, 0.2)}
      <label class="toggle"><input type="checkbox" data-k="wetsuit" ${d.wetsuit ? 'checked' : ''}> Wetsuit swim</label>
    </div>
    <details class="more" style="margin-top:10px"><summary>How this is calculated</summary><div class="small muted" style="line-height:1.55">
      <b>Swim</b> — your session pace (${esc(b.notes.swim)}). Beyond the distance you can swim without stopping, pace fades ~8% per doubling and each forced stop costs ~25 s. Wetsuit −5%.<br>
      <b>Bike</b> — speed of your long outdoor rides (${esc(b.notes.bike)}), +2% race day. FTP changes scale speed with the cube root of power.<br>
      <b>Run</b> — easy pace at Z2 HR (${esc(b.notes.run)}), +6% off the bike, for the distance you can run continuously (your longest recent run ${b.runLongestKm} km × 1.25); after that run/walk at 1.35× easy pace.<br>
      <b>Transitions</b> 12 min.</div></details>
  </div>`);
  const out = k => card.querySelector(`[data-o="${k}"]`);
  const update = () => {
    const p = predict(b, s, d);
    out('total').textContent = fmtSec(p.totalSec);
    const diff = p.totalSec - goal;
    out('total').className = 'big mono ' + (diff <= 0 ? 'sport-run' : 'sport-bike');
    out('gap').textContent = diff <= 0 ? `${fmtSec(-diff)} under goal` : `${fmtSec(diff)} over goal`;
    out('gap').className = 'pill ' + (diff <= 0 ? 'good' : 'warn');
    out('swim').textContent = fmtSec(p.swimSec);
    out('swimk').textContent = `Swim · ${paceToStr(p.swim.effPace)}/100m avg${p.swim.cont < 3800 ? ` · ${Math.floor(3800 / p.swim.cont - 1)} stops` : ''}`;
    out('bike').textContent = fmtSec(p.bikeSec);
    out('bikek').textContent = `Bike · ${p.bike.kmh} km/h`;
    out('run').textContent = fmtSec(p.runSec);
    out('runk').textContent = p.run.walkKm > 0 ? `Run ${round(p.run.runCont, 0)} km @ ${paceToStr(p.run.runPace)} + run/walk ${p.run.walkKm} km` : `Run · ${paceToStr(p.run.runPace)}/km`;
    out('trans').textContent = fmtSec(p.transSec);
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
      swimCont: d.swimCont >= 3800 ? 'full 3.8 km' : `${d.swimCont} m`, runCont: d.runCont >= 42.2 ? 'full marathon' : `${round(d.runCont, 1)} km`,
    };
    for (const k in lab) { const e = card.querySelector(`[data-v="${k}"]`); if (e) e.textContent = lab[k]; }
  };
  card.querySelectorAll('input[type=range]').forEach(inp => { inp.value = d[inp.dataset.k]; inp.oninput = () => { d[inp.dataset.k] = +inp.value; update(); }; });
  card.querySelector('[data-k="wetsuit"]').onchange = (e) => { d.wetsuit = e.target.checked; update(); };
  card.querySelector('[data-reset]').onclick = () => { ui.sim = null; ui.keepScroll(); ui.rerender(); };
  update();
  return card;
}
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
function easyPaceCard(data) {
  const runs = (data?.activities || []).filter(a => a.sport === 'run' && a.avgHr && (a.gapSecKm || a.paceSecKm) && a.movingSec >= 1500 && hrZoneOf('run', a.avgHr) <= 2);
  if (runs.length < 3) return null;
  const byWeek = {};
  for (const a of runs) { const w = isoDate(startOfWeek(parseDate(a.date))); (byWeek[w] ||= []).push(a.gapSecKm || a.paceSecKm); }
  const pts = Object.entries(byWeek).sort().map(([x, v]) => ({ x, y: round(v.sort((a, b) => a - b)[v.length >> 1]) }));
  const card = h(`<div class="card"><div class="card-title">Easy pace at Z2 heart rate</div><div class="small muted" style="margin:-4px 0 8px">Your focus: from 7:00–7:30 toward 5:30–7:00/km at the same easy heart rate. Weekly median of runs with average HR in Z2.</div></div>`);
  card.append(lineChart({ height: 170, invert: true, yFmt: v => paceToStr(v), bands: [{ y0: 330, y1: 420, color: 'rgba(88,227,154,.07)', label: 'target' }], series: [{ name: 'Easy pace', color: '#58e39a', pts, dots: true, fmt: v => paceToStr(v) + '/km' }] }));
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
      <div class="card-title">intervals.icu</div>
      <div class="grid2">
        <div class="field"><label for="athleteId">Athlete ID</label><input id="athleteId" name="username" value="${esc(s.athleteId)}" placeholder="i123456" autocomplete="username" autocapitalize="off" spellcheck="false"></div>
        <div class="field"><label for="apiKey">API key</label><input id="apiKey" name="password" type="password" value="${esc(s.apiKey)}" placeholder="from Settings → Developer" autocomplete="current-password"></div>
      </div>
      <div class="field"><div class="hint">Stored on this device (and offered to your browser's password manager) — sent only to intervals.icu.</div></div>

      <div class="card-title" style="margin-top:8px">Bike</div>
      <div class="grid2">
        <div class="field"><label>Indoor FTP (trainer), W</label><input name="ftp" type="number" min="60" max="500" value="${s.ftp}"><div class="hint">Your indoor Z2 = ${Math.round(s.ftp * 0.56)}–${Math.round(s.ftp * 0.75)} W.</div></div>
        <div class="field"><label>Outdoor FTP, W (power meter only)</label><input name="ftpOutdoor" type="number" min="60" max="500" value="${s.ftpOutdoor || ''}" placeholder="—"></div>
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
  const form = root.querySelector('form');
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
      planStart: fd.get('planStart') || s.planStart || today,
    };
    if (patch.athleteId && /^\d+$/.test(patch.athleteId)) patch.athleteId = 'i' + patch.athleteId;
    // manual threshold edits: keep them for 4 weeks and log them
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
