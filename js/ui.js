import { isoDate, addDays, startOfWeek, today, fmtDur, fmtSec, fmtPace, fmtPace100, fmtKm, fmtDate, paceToStr, strToPace, el, esc, sportIcon, SPORT_LABEL, round, daysBetween, parseDate } from './util.js';
import { PHASES, zones } from './plan.js';
import { load, save, DEFAULTS } from './store.js';
import { summarise, getSummary, ruleSummary } from './analysis.js';
import { describeProfile } from './history.js';
import { renderWidgets } from './health.js';
import { hrRangeStr, collapse, plannedDist, getZoneModel } from './zones.js';
import { estimateAll, estimateTrend } from './thresholds.js';

const h = (html) => el(html);

// ---------------------------------------------------------------- TODAY
export function renderToday(A, ui) {
  const root = h('<div class="stack" style="gap:14px"></div>');
  const sel = ui.selectedDate || A.todayIso;
  const weekStart = startOfWeek(parseDate(sel));
  const week = A.plan.weeks.find(w => w.start === isoDate(weekStart));

  // header: countdown + phase
  const s = load();
  const daysLeft = daysBetween(today(), s.raceDate);
  root.append(h(`<div class="row between" style="padding:2px 4px">
    <div><div class="small muted">${esc(s.raceName)}</div><div style="font-weight:800;font-size:22px;letter-spacing:-.02em">${daysLeft} days to go</div></div>
    ${week ? `<span class="pill accent">${PHASES[week.phase].label}${week.recovery ? ' · recovery' : ''} · wk ${week.index + 1}/${A.plan.totalWeeks + 1}</span>` : ''}
  </div>`));

  root.append(renderWidgets(ui.data, ui));
  if (ui.pending?.length) {
    const lbl = { ftp: 'FTP', runThreshold: 'Run threshold', css: 'Swim CSS' };
    const f = (k, v) => k === 'ftp' ? v + ' W' : paceToStr(v) + (k === 'css' ? '/100m' : '/km');
    const b = h(`<div class="adjust-banner good"><span>↗</span><div style="flex:1"><strong>New threshold estimate from your activities.</strong> ${ui.pending.map(u => `${lbl[u.field]} ${f(u.field, u.from)} → <b>${f(u.field, u.to)}</b>`).join(' · ')}<div style="margin-top:8px"><button class="btn small">Apply</button></div></div></div>`);
    b.querySelector('button').onclick = () => ui.applyPending();
    root.append(b);
  }

  // week strip
  const strip = h('<div class="weekstrip"></div>');
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i); const iso = isoDate(d);
    const sessions = week ? week.sessions.filter(x => x.date === iso) : [];
    const dots = sessions.map(x => { const done = A.matches[x.id]; const missed = !done && iso < A.todayIso; return `<span class="dot bg-${x.sport} ${done ? 'done' : ''} ${missed ? 'missed' : ''}"></span>`; }).join('');
    const day = h(`<div class="day ${iso === A.todayIso ? 'today' : ''} ${iso === sel ? 'selected' : ''}" data-date="${iso}"><span class="dow">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'][i]}</span><span class="num">${d.getDate()}</span><span class="dots">${dots || '<span class="dot" style="background:transparent"></span>'}</span></div>`);
    day.onclick = () => { ui.selectedDate = iso; ui.rerender(); };
    strip.append(day);
  }
  const nav = h(`<div class="row between"><button class="btn ghost" data-nav="-1">‹ Prev week</button><button class="btn ghost small" data-nav="0">Today</button><button class="btn ghost" data-nav="1">Next week ›</button></div>`);
  nav.querySelectorAll('button').forEach(b => b.onclick = () => { const n = +b.dataset.nav; ui.selectedDate = n === 0 ? A.todayIso : isoDate(addDays(weekStart, n * 7)); ui.rerender(); });
  root.append(strip, nav);

  // adjustment banner
  if (A.adjustment.factor !== 1 || A.adjustment.intensityCap) {
    const lvl = A.adjustment.factor > 1 ? 'good' : (A.adjustment.intensityCap ? 'bad' : '');
    root.append(h(`<div class="adjust-banner ${lvl}"><span>${A.adjustment.factor > 1 ? '▲' : '▼'}</span><div><strong>Plan adjusted ${A.adjustment.factor > 1 ? '+' : ''}${Math.round((A.adjustment.factor - 1) * 100)}%.</strong> ${esc(A.adjustment.reason)}</div></div>`));
  }
  if (sel === A.todayIso && A.todayNote) root.append(h(`<div class="adjust-banner ${A.todayNote.level}"><span>!</span><div>${esc(A.todayNote.text)}</div></div>`));

  // sessions of selected day
  const sessions = week ? week.sessions.filter(x => x.date === sel) : [];
  const label = sel === A.todayIso ? 'Today' : fmtDate(sel, { weekday: 'long', day: 'numeric', month: 'long' });
  if (!sessions.length) {
    root.append(h(`<div class="card hero session-hero"><div class="label">${esc(label)}</div><h1>Rest day</h1><p class="muted">Recovery is training. Sleep, eat well, light mobility if you like.</p></div>`));
  } else {
    sessions.forEach((x, i) => root.append(sessionHero(x, A.matches[x.id], i === 0 ? label : null, A)));
  }

  // coach notes (readiness flags)
  if (A.flags.length) root.append(h(`<div class="card"><div class="card-title">Coach notes</div><div class="stack small">${A.flags.map(f => `<div class="row" style="align-items:flex-start;gap:8px"><span class="dot" style="margin-top:5px;background:var(--${f.level === 'bad' ? 'bad' : f.level === 'good' ? 'good' : 'warn'})"></span><span class="muted">${esc(f.text)}</span></div>`).join('')}</div></div>`));

  // week progress
  if (week) {
    const doneMin = week.sessions.reduce((a, x) => a + (A.matches[x.id] ? A.matches[x.id].movingSec / 60 : 0), 0);
    const doneLoad = week.sessions.reduce((a, x) => a + (A.matches[x.id]?.load || 0), 0);
    root.append(h(`<div class="card"><div class="card-title">This week</div>
      <div class="row between"><div><div class="big mono">${fmtDur(doneMin)}</div><div class="small muted">of ${fmtDur(week.plannedMin)} planned</div></div>
      <div style="text-align:right"><div style="font-size:22px;font-weight:800">${doneLoad} <span class="small muted">/ ${week.plannedLoad}</span></div><div class="small muted">training load</div></div></div>
      <div class="track" style="margin-top:12px"><span style="width:${Math.min(100, week.plannedMin ? doneMin / week.plannedMin * 100 : 0)}%"></span></div>
      <p class="small muted" style="margin-top:10px">${esc(PHASES[week.phase].desc)}</p></div>`));
  }
  return root;
}

function refMetric(r) {
  if (!r) return '';
  if (r.sport === 'bike') return r.np ? `NP ${r.np} W` : r.avgW ? `${r.avgW} W` : '';
  if (r.sport === 'run') return r.paceSecKm ? fmtPace(r.paceSecKm) : '';
  if (r.sport === 'swim') return r.pace100 ? fmtPace100(r.pace100) : '';
  return '';
}
function refDelta(x) {
  if (!x.ref) return '';
  const d = Math.round(x.min - x.ref.min);
  if (Math.abs(d) < 5) return 'same duration';
  return `${d > 0 ? '+' : '−'}${fmtDur(Math.abs(d))}`;
}
function refBlock(x) {
  if (!x.ref) return x.role === 'brick' ? '<div class="ref"><span class="faint">New element:</span> brick run straight off your long ride.</div>' : (x.habitual === false ? '<div class="ref"><span class="faint">Added:</span> you don\'t usually train this sport on this day — the Ironman build needs it. Move it if it doesn\'t fit.</div>' : '');
  const r = x.ref;
  const bits = [fmtDur(r.min), r.distanceM ? fmtKm(r.distanceM) : '', refMetric(r), r.intensity != null ? `IF ${r.intensity}%` : ''].filter(Boolean).join(' · ');
  return `<div class="ref"><div class="faint small">Based on your ${SPORT_LABEL[r.sport].toLowerCase()} · ${fmtDate(r.date)}</div><div><b>${esc(r.name)}</b> — ${bits}</div><div class="small" style="margin-top:4px">This time: <b>${refDelta(x)}</b>${x.role === 'key' || x.role === 'long' ? ' · ' + esc(progressionHint(x)) : ''}</div></div>`;
}
function progressionHint(x) {
  const r = x.ref; const s = load();
  if (x.sport === 'bike') { const tgt = Math.round(s.ftp * x.if); return r.np ? (tgt > r.np ? `aim ~${tgt} W (vs ${r.np} W)` : `hold ~${tgt} W`) : `aim ~${tgt} W`; }
  if (x.sport === 'run') return x.kind.startsWith('long') ? 'same easy pace, more time on feet' : 'structured intervals instead of steady';
  return 'add structure at CSS pace';
}

function sessionHero(x, done, label, A) {
  const total = x.steps.reduce((a, st) => a + st.min + (st.rest || 0), 0);
  const card = h(`<div class="card hero session-hero">
    ${label ? `<div class="label">${esc(label)}${x.key ? ' · key session' : ''}</div>` : `<div class="label sport-${x.sport}">${SPORT_LABEL[x.sport]}${x.key ? ' · key session' : ''}</div>`}
    <div class="row between"><h1>${esc(x.title)}</h1><span class="ico sport-${x.sport}" style="width:40px;height:40px;display:grid;place-items:center">${sportIcon(x.sport)}</span></div>
    ${done ? `<span class="pill good">✓ Done · ${fmtDur(done.movingSec / 60)}${done.load ? ' · ' + done.load + ' load' : ''}</span>` : (x.date < A.todayIso ? '<span class="pill bad">Missed</span>' : '')}
    <div class="session-meta">
      <div class="metric"><div class="v">${fmtDur(x.min)}</div><div class="k">Duration</div></div>
      <div class="metric"><div class="v">${x.tss}</div><div class="k">Load</div></div>
      <div class="metric"><div class="v">${Math.round(x.if * 100)}%</div><div class="k">Intensity</div></div>
    </div>
    ${refBlock(x)}
    <div class="steps">${x.steps.map(st => { const hr = x.sport !== 'swim' ? hrRangeStr(x.sport === 'brick' ? 'run' : x.sport, st.zone) : null; return `<div class="step"><span class="bar z${st.zone}"></span><span>${esc(st.text)}${st.rest ? ` <span class="faint">· ${st.rest} min easy</span>` : ''}${hr ? `<span class="hrchip">♥ Z${st.zone} ${hr}</span>` : ''}</span><span class="t">${Math.round(st.min)} min</span></div>`; }).join('')}</div>
    ${x.note ? `<p class="small muted" style="margin-top:12px">${esc(x.note)}</p>` : ''}
  </div>`);
  return card;
}

// ---------------------------------------------------------------- PLAN
export function renderPlan(A, ui) {
  const root = h('<div class="stack" style="gap:12px"></div>');
  const plan = A.plan;
  const counts = {}; plan.weeks.forEach(w => counts[w.phase] = (counts[w.phase] || 0) + 1);
  const order = ['base', 'build', 'peak', 'taper', 'race'];
  root.append(h(`<div class="card"><div class="card-title">Road to ${esc(load().raceName)}</div>
    <div class="row between"><div class="big">${plan.totalWeeks + 1} <span class="small muted" style="font-weight:600">weeks</span></div><div class="small muted" style="text-align:right">${fmtDate(plan.anchor)} → ${fmtDate(plan.raceDate, { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
    <div class="phase-bar">${order.filter(p => counts[p]).map(p => `<span class="phase-${p}" style="flex:${counts[p]}"></span>`).join('')}</div>
    <div class="phase-legend">${order.filter(p => counts[p]).map(p => `<span><span class="dot phase-${p}" style="margin-right:4px"></span>${PHASES[p].label} ${counts[p]}w</span>`).join('')}</div>
    ${plan.profile ? `<div class="ref" style="margin-top:12px"><div class="faint small">Built from your last ${plan.profile.nWeeks} weeks in intervals.icu</div><div><b>${(plan.profile.baseMin / 60).toFixed(1)} h/week</b> · ${plan.profile.sessionsPerWeek} sessions · long ride ${fmtDur(plan.profile.sports.bike.longest)} · long run ${fmtDur(plan.profile.sports.run.longest)}</div><div class="small muted" style="margin-top:4px">Your usual days: ${esc(describeProfile(plan.profile))}</div></div>` : `<div class="ref" style="margin-top:12px"><div class="small muted">Not enough recent history yet (needs ~3 weeks of activities) — using a standard template from your Settings hours. It switches to your own pattern automatically once data is there.</div></div>`}
    <div class="small muted" style="margin-top:12px">Same days and sports you already train; durations grow from yours (long ride toward 5 h, long run toward 2 h 20). Every 4th week is a recovery week. Volume ramps from ${plan.baseHours.toFixed(1)} h to a peak of ${Math.max(...plan.weeks.map(w => w.hours)).toFixed(1)} h/week, and fatigue, compliance and new thresholds re-shape what comes next.</div>
  </div>`));

  const list = h('<div class="stack" style="gap:8px"></div>');
  const cur = plan.weeks.find(w => A.todayIso >= w.start && A.todayIso <= w.end);
  plan.weeks.forEach(w => {
    const isCur = cur && w.index === cur.index;
    const open = ui.openWeeks.has(w.index) || (isCur && !ui.openWeeksTouched);
    const bySport = { swim: 0, bike: 0, run: 0 }; w.sessions.forEach(x => { if (bySport[x.sport] != null) bySport[x.sport] += x.min; });
    const card = h(`<div class="week-card" id="week-${w.index}">
      <div class="week-head ${isCur ? 'current' : ''}">
        <div><div class="t">Week ${w.index + 1} <span class="muted" style="font-weight:500">· ${fmtDate(w.start, { day: 'numeric', month: 'short' })}</span> ${isCur ? '<span class="pill accent" style="margin-left:6px">now</span>' : ''}</div>
          <div class="s"><span class="dot phase-${w.phase}" style="margin-right:4px"></span>${PHASES[w.phase].label}${w.recovery ? ' · recovery' : ''} · ${w.wtg} wk to race</div></div>
        <div style="text-align:right"><div class="h">${w.hours.toFixed(1)} h</div><div class="small muted"><span class="sport-swim">${Math.round(bySport.swim / 60 * 10) / 10}</span> · <span class="sport-bike">${Math.round(bySport.bike / 60 * 10) / 10}</span> · <span class="sport-run">${Math.round(bySport.run / 60 * 10) / 10}</span></div></div>
      </div>
      ${open ? `<div class="week-body">${w.sessions.map(x => sessionRow(x, A.matches[x.id], A.todayIso, true)).join('')}</div>` : ''}
    </div>`);
    card.querySelector('.week-head').onclick = () => { ui.openWeeksTouched = true; if (ui.openWeeks.has(w.index)) ui.openWeeks.delete(w.index); else ui.openWeeks.add(w.index); if (isCur && !ui.openWeeks.has(w.index)) ui.openWeeks.delete(w.index); ui.rerender(); };
    card.querySelectorAll('.session-item').forEach(r => r.onclick = () => { ui.selectedDate = r.dataset.date; ui.setTab('today'); });
    list.append(card);
  });
  root.append(list);
  if (cur) requestAnimationFrame(() => { const e = root.querySelector(`#week-${cur.index}`); if (e && !ui.openWeeksTouched) e.scrollIntoView({ block: 'start' }); });
  return root;
}

function sessionRow(x, done, todayIso, withDate = false) {
  const missed = !done && x.date < todayIso;
  return `<div class="session-item ${done ? 'done' : ''} ${missed ? 'missed' : ''}" data-date="${x.date}">
    <span class="ico sport-${x.sport}">${sportIcon(x.sport)}</span>
    <div><div class="name">${esc(x.title)}${x.key ? ' <span class="pill accent" style="padding:1px 7px;font-size:10px">key</span>' : ''}</div><div class="sub">${withDate ? fmtDate(x.date) + ' · ' : ''}${fmtDur(x.min)}${x.ref ? ` <span class="faint">(last time ${fmtDur(x.ref.min)})</span>` : x.habitual === false && x.role !== 'brick' ? ' <span class="faint">(added)</span>' : ''} · load ${x.tss}${done ? ` · <span class="sport-run">done ${fmtDur(done.movingSec / 60)}</span>` : missed ? ' · <span class="sport-brick">missed</span>' : ''}</div></div>
    <div class="right">${Math.round(x.if * 100)}%</div></div>`;
}

// ---------------------------------------------------------------- ACTIVITIES
export function renderActivities(A, ui, data) {
  const root = h('<div class="stack" style="gap:10px"></div>');
  const all = data?.activities || [];
  ui.actLimit ||= 25;
  const acts = all.slice(0, ui.actLimit);
  if (!acts.length) { root.append(h('<div class="empty"><h2>No activities yet</h2><p>Sync with intervals.icu to see your sessions here, each with a coach summary.</p></div>')); return root; }
  const s = load();
  if (!s.anthropicKey) root.append(h('<div class="small muted" style="padding:0 4px">Summaries are rule-based. Add an Anthropic API key in Settings for AI coach feedback.</div>'));
  const matchedBySession = A.matches;
  const plannedFor = (a) => { const sid = Object.keys(matchedBySession).find(k => matchedBySession[k].id === a.id); if (!sid) return null; return A.plan.weeks.flatMap(w => w.sessions).find(x => x.id === sid) || null; };
  let lastDate = null;
  acts.forEach(a => {
    if (a.date !== lastDate) { root.append(h(`<div class="date-sep">${a.date === A.todayIso ? 'Today' : fmtDate(a.date, { weekday: 'long', day: 'numeric', month: 'long' })}</div>`)); lastDate = a.date; }
    const planned = plannedFor(a);
    const open = ui.openActs.has(a.id);
    const card = h(`<div class="act">
      <div class="act-head"><span class="ico sport-${a.sport}">${sportIcon(a.sport)}</span>
        <div><div class="name">${esc(a.name)}</div><div class="sub">${fmtDur(a.movingSec / 60)}${a.distanceM ? ' · ' + fmtKm(a.distanceM) : ''}${a.load ? ' · load ' + a.load : ''}${planned ? ` · <span class="muted">plan: ${esc(planned.title)}</span>` : (a.date < A.plan.anchor ? '' : ' · unplanned')}</div></div>
        <div class="right">${summaryBadge(getSummary(a) || ruleSummary(a, { planned, wellness: A.wellness }))}</div></div>
      ${open ? actDetail(a, planned) : ''}
    </div>`);
    card.querySelector('.act-head').onclick = () => { if (ui.openActs.has(a.id)) ui.openActs.delete(a.id); else ui.openActs.add(a.id); ui.rerender(); };
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
  if (all.length > acts.length) { const more = h(`<button class="btn secondary">Show more (${all.length - acts.length})</button>`); more.onclick = () => { ui.actLimit += 25; ui.rerender(); }; root.append(more); }
  return root;
}
function summaryBadge(sm) { if (!sm) return '<span class="pill">…</span>'; const m = { on: ['good', 'On target'], above: ['warn', 'Too hard'], below: ['bad', 'Under'], none: ['', 'No plan'] }[sm.verdict] || ['', '']; return `<span class="pill ${m[0]}">${m[1]}</span>`; }
function actDetail(a, planned) {
  const cells = [];
  if (a.avgHr) cells.push(['Avg HR', Math.round(a.avgHr)]);
  if (a.np) cells.push(['NP', a.np + ' W']); else if (a.avgW) cells.push(['Avg W', Math.round(a.avgW)]);
  if (a.paceSecKm) cells.push(['Pace', fmtPace(a.paceSecKm).replace('/km', '')]);
  if (a.pace100) cells.push(['Pace', fmtPace100(a.pace100).replace('/100m', '')]);
  if (a.speedKmh) cells.push(['Speed', round(a.speedKmh, 1) + ' km/h']);
  if (a.intensity != null) cells.push(['IF', a.intensity + '%']);
  if (a.elev) cells.push(['Climb', Math.round(a.elev) + ' m']);
  if (a.rpe != null) cells.push(['RPE', a.rpe]);
  if (a.eftp) cells.push(['eFTP', a.eftp + ' W']);
  if (a.decoupling != null) cells.push(['Drift', round(a.decoupling, 1) + '%']);
  return `<div class="act-stats">${cells.slice(0, 8).map(c => `<div class="metric"><div class="v">${c[1]}</div><div class="k">${c[0]}</div></div>`).join('')}</div>
    ${zoneBars(a, planned)}
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
function zoneBars(a, planned) {
  const rows = [];
  if (a.powerZoneSecs) rows.push(zoneBar('Power', a.powerZoneSecs));
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

// ---------------------------------------------------------------- PROGRESS
export function renderProgress(A, ui, data) {
  const root = h('<div class="stack" style="gap:12px"></div>');
  const s = load();
  const g = A.goal;
  const p = g.pred;
  const under = p.totalSec <= s.goalHours * 3600;
  root.append(h(`<div class="card hero"><div class="card-title">Projected finish from current numbers</div>
    <div class="row between"><div class="big mono ${under ? 'sport-run' : 'sport-bike'}">${fmtSec(p.totalSec)}</div><span class="pill ${under ? 'good' : 'warn'}">${under ? 'On track' : `${fmtSec(p.totalSec - s.goalHours * 3600)} over goal`}</span></div>
    <div class="split" style="margin-top:14px">
      <div class="metric"><div class="v sport-swim">${fmtSec(p.swimSec)}</div><div class="k">Swim @ ${paceToStr(s.css + 6)}/100m</div></div>
      <div class="metric"><div class="v sport-bike">${fmtSec(p.bikeSec)}</div><div class="k">Bike @ ${p.raceW} W · ${p.kmh} km/h</div></div>
      <div class="metric"><div class="v sport-run">${fmtSec(p.runSec)}</div><div class="k">Run @ ${paceToStr(Math.round(s.runThreshold * 1.155))}/km</div></div>
      <div class="metric"><div class="v">${fmtSec(p.transitions)}</div><div class="k">Transitions</div></div>
    </div>
    <p class="small muted" style="margin-top:12px">Flat-course model: 73% FTP on the bike, 115% of threshold pace on the run, CSS+6 s in the swim. Real courses, heat and pacing errors add time — the targets below include that margin.</p>
  </div>`));

  root.append(h(`<div class="card"><div class="card-title">Thresholds vs sub-${s.goalHours} targets · ${g.weeksLeft} weeks left</div>
    ${g.rows.map(r => { const fmt = v => r.unit === 'w' ? v + ' W' : r.unit === 'pace' ? paceToStr(v) + '/km' : paceToStr(v) + '/100m'; return `<div class="goal-row"><div class="lbl sport-${r.key}">${r.label}<small>${r.key === 'bike' && g.eftpNow ? 'latest eFTP' : 'current'}</small></div><div class="track"><span style="width:${Math.round(r.progress * 100)}%;background:var(--${r.key})"></span></div><div class="val">${fmt(r.cur)}<small>target ${fmt(r.target)}</small></div></div>`; }).join('')}
  </div>`));

  root.append(thresholdCard(data, ui));
  // fitness chart
  const well = (data?.wellness || []).filter(w => w.ctl != null).slice(-120);
  if (well.length > 5) root.append(fitnessChart(well));
  // weekly volume planned vs actual (last 8 weeks + next 4)
  root.append(volumeChart(A, data));
  return root;
}

function thresholdCard(data, ui) {
  const s = load();
  const acts = data?.activities || [];
  const todayIso = isoDate(new Date());
  const est = estimateAll(acts, s, todayIso);
  const trend = estimateTrend(acts, s, todayIso, 12);
  const lbl = { ftp: ['Bike FTP', 'bike'], runThreshold: ['Run threshold', 'run'], css: ['Swim CSS', 'swim'] };
  const fmt = (k, v) => v == null ? '–' : k === 'ftp' ? `${v} W` : `${paceToStr(v)}${k === 'css' ? '/100m' : '/km'}`;
  const sp = (k) => {
    const pts = trend[k].filter(p => p.value != null); if (pts.length < 2) return '';
    const vs = pts.map(p => p.value), mn = Math.min(...vs), mx = Math.max(...vs), r = mx - mn || 1, inv = k !== 'ftp';
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1) * 100).toFixed(1)},${(inv ? 3 + (p.value - mn) / r * 22 : 25 - (p.value - mn) / r * 22).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 100 28" class="spark" preserveAspectRatio="none" style="height:28px"><path d="${d}" fill="none" stroke="var(--${lbl[k][1]})" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  };
  const conf = { high: 'good', medium: '', low: 'warn', none: '' };
  const rows = Object.keys(lbl).map(k => {
    const e = est[k];
    return `<div class="th-row"><div class="row between"><div><div class="lbl sport-${lbl[k][1]}" style="font-weight:700">${lbl[k][0]}</div><div class="small muted">in use <b style="color:var(--text)">${fmt(k, s[k])}</b> · estimate <b style="color:var(--text)">${fmt(k, e.value)}</b></div></div><span class="pill ${conf[e.confidence]}">${e.confidence === 'none' ? 'no data' : e.confidence + ' confidence'}</span></div>
      ${sp(k)}
      ${e.hint ? `<div class="small" style="color:var(--warn)">${esc(e.hint)}</div>` : ''}
      ${e.methods.length ? `<div class="small faint">${e.methods.map(m => `${esc(m.label)}: ${fmt(k, m.value)} <span class="faint">(${esc(m.detail)})</span>`).join(' · ')}</div>` : '<div class="small faint">Not enough suitable activities in the last 6 weeks.</div>'}</div>`;
  }).join('');
  const log = (s.thresholdLog || []).slice(0, 6);
  return h(`<div class="card"><div class="card-title">Thresholds · estimated from your activities</div>${rows}
    ${log.length ? `<details class="more" style="margin-top:10px"><summary>Change history (${(s.thresholdLog || []).length})</summary><div class="stack small muted">${log.map(l => `<div>${fmtDate(l.date)} · ${lbl[l.field][0]} ${fmt(l.field, l.from)} → <b style="color:var(--text)">${fmt(l.field, l.to)}</b> <span class="faint">(${esc(l.source)})</span></div>`).join('')}</div></details>` : ''}
    <div class="small faint" style="margin-top:8px">12-week trend of the estimate. Mode: ${esc({ auto: 'automatic', suggest: 'suggest & confirm', intervals: 'intervals.icu settings', manual: 'manual' }[s.thresholdSource || 'auto'])} (change in Settings).</div></div>`);
}

function fitnessChart(well) {
  const W = 460, H = 200, pad = { l: 34, r: 10, t: 14, b: 26 };
  const xs = well.map((_, i) => pad.l + i / (well.length - 1) * (W - pad.l - pad.r));
  const maxY = Math.max(...well.map(w => Math.max(w.ctl, w.atl))) * 1.1 || 10;
  const minY = Math.min(0, ...well.map(w => w.ctl - w.atl)) * 1.1;
  const y = v => pad.t + (1 - (v - minY) / (maxY - minY)) * (H - pad.t - pad.b);
  const path = k => well.map((w, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${y(w[k]).toFixed(1)}`).join(' ');
  const tsb = well.map((w, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${y(w.ctl - w.atl).toFixed(1)}`).join(' ');
  const area = `${path('ctl')} L${xs[xs.length - 1].toFixed(1)},${y(0)} L${xs[0].toFixed(1)},${y(0)} Z`;
  const ticks = [0, Math.round(maxY / 2), Math.round(maxY)];
  const labels = [0, Math.floor(well.length / 2), well.length - 1].map(i => `<text x="${xs[i]}" y="${H - 8}" fill="#5d6678" font-size="11" text-anchor="${i === 0 ? 'start' : i === well.length - 1 ? 'end' : 'middle'}">${fmtDate(well[i].date, { day: 'numeric', month: 'short' })}</text>`).join('');
  const last = well[well.length - 1];
  return h(`<div class="card"><div class="card-title">Fitness · fatigue · form (${well.length} days)</div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fitness chart">
      ${ticks.map(t => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="#262c36" stroke-width="1"/><text x="${pad.l - 6}" y="${y(t) + 4}" fill="#5d6678" font-size="11" text-anchor="end">${t}</text>`).join('')}
      <path d="${area}" fill="rgba(76,195,255,.12)"/>
      <path d="${tsb}" fill="none" stroke="#ffb020" stroke-width="1.5" stroke-dasharray="4 3"/>
      <path d="${path('atl')}" fill="none" stroke="#ff5c6c" stroke-width="2"/>
      <path d="${path('ctl')}" fill="none" stroke="#4cc3ff" stroke-width="2.5"/>
      ${labels}
    </svg>
    <div class="row small muted" style="gap:14px;flex-wrap:wrap"><span><span class="dot bg-swim"></span> Fitness ${round(last.ctl)}</span><span><span class="dot" style="background:#ff5c6c"></span> Fatigue ${round(last.atl)}</span><span><span class="dot bg-bike"></span> Form ${round(last.ctl - last.atl)}</span></div>
  </div>`);
}

function volumeChart(A, data) {
  const weeks = A.plan.weeks.filter(w => { const d = daysBetween(w.start, A.todayIso); return d >= -28 && d <= 63; });
  const acts = data?.activities || [];
  const rows = weeks.map(w => ({ w, actual: acts.filter(a => a.date >= w.start && a.date <= w.end).reduce((s, a) => s + a.movingSec / 60, 0) }));
  const max = Math.max(...rows.map(r => Math.max(r.w.plannedMin, r.actual)), 60);
  return h(`<div class="card"><div class="card-title">Weekly hours · planned vs done</div>
    <div class="row" style="align-items:flex-end;gap:6px;height:120px">${rows.map(r => { const cur = A.todayIso >= r.w.start && A.todayIso <= r.w.end; return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;height:100%;justify-content:flex-end" title="Week ${r.w.index + 1}: planned ${fmtDur(r.w.plannedMin)}, done ${fmtDur(r.actual)}">
      <div style="display:flex;gap:2px;align-items:flex-end;height:100%"><span style="display:block;width:7px;height:${r.w.plannedMin / max * 100}%;background:${cur ? 'var(--accent)' : '#2b3240'};border-radius:3px"></span><span style="display:block;width:7px;height:${r.actual / max * 100}%;background:var(--run);border-radius:3px;opacity:${r.w.start > A.todayIso ? .15 : 1}"></span></div>
      <span class="faint" style="font-size:9px">${r.w.index + 1}</span></div>`; }).join('')}</div>
    <div class="row small muted" style="gap:14px;margin-top:8px"><span><span class="dot" style="background:#2b3240"></span> Planned</span><span><span class="dot bg-run"></span> Done</span><span><span class="dot" style="background:var(--accent)"></span> This week</span></div>
  </div>`);
}

// ---------------------------------------------------------------- SETTINGS
export function renderSettings(ui, onSave) {
  const s = load();
  const z = zones(s);
  const root = h(`<div class="stack" style="gap:12px">
    <form class="card form" id="settingsForm">
      <div class="card-title">intervals.icu</div>
      <div class="grid2">
        <div class="field"><label>Athlete ID</label><input name="athleteId" value="${esc(s.athleteId)}" placeholder="i123456" autocomplete="off"></div>
        <div class="field"><label>API key</label><input name="apiKey" type="password" value="${esc(s.apiKey)}" placeholder="from Settings → Developer" autocomplete="off"></div>
      </div>
      <div class="field"><div class="hint">Keys are stored only in this browser (localStorage) and sent only to intervals.icu. Find both under intervals.icu → Settings → Developer Settings.</div></div>
      <div class="field"><label>How thresholds are updated</label><select name="thresholdSource">
        <option value="auto" ${s.thresholdSource === 'auto' ? 'selected' : ''}>Automatically from my activities (recommended)</option>
        <option value="suggest" ${s.thresholdSource === 'suggest' ? 'selected' : ''}>Suggest from my activities, I confirm</option>
        <option value="intervals" ${s.thresholdSource === 'intervals' ? 'selected' : ''}>Always use my intervals.icu sport settings</option>
        <option value="manual" ${s.thresholdSource === 'manual' ? 'selected' : ''}>Manual only</option></select>
        <div class="hint">Estimates use intervals.icu eFTP, power-model FTP, power and pace at your LTHR, hard efforts and races. Max ±5% per update. A new value you set in intervals.icu (e.g. after a test) is always taken over.</div></div>
      <div class="field"><div class="hint">${zoneInfo()}</div></div>
      <div class="field"><label><input type="checkbox" name="planFromHistory" ${s.planFromHistory !== false ? 'checked' : ''} style="width:auto;margin-right:8px">Build the plan from my last 8 weeks (my days, sports and durations)</label><div class="hint">Off = standard template using "Current weekly hours" below.</div></div>

      <div class="card-title" style="margin-top:8px">Race & goal</div>
      <div class="grid2">
        <div class="field"><label>Race name</label><input name="raceName" value="${esc(s.raceName)}"></div>
        <div class="field"><label>Race date</label><input name="raceDate" type="date" value="${esc(s.raceDate)}"></div>
        <div class="field"><label>Goal time (hours)</label><input name="goalHours" type="number" step="0.25" min="8" max="17" value="${s.goalHours}"></div>
        <div class="field"><label>Weekly hours (template fallback)</label><input name="weeklyHours" type="number" step="0.5" min="4" max="20" value="${s.weeklyHours}"></div>
      </div>

      <div class="card-title" style="margin-top:8px">Thresholds</div>
      <div class="grid2">
        <div class="field"><label>Bike FTP (W)</label><input name="ftp" type="number" min="80" max="500" value="${s.ftp}"></div>
        <div class="field"><label>Weight (kg)</label><input name="weightKg" type="number" min="40" max="150" value="${s.weightKg}"></div>
        <div class="field"><label>Run threshold pace (min/km)</label><input name="runThreshold" value="${paceToStr(s.runThreshold)}" placeholder="5:40"></div>
        <div class="field"><label>Swim CSS (min/100m)</label><input name="css" value="${paceToStr(s.css)}" placeholder="1:50"></div>
      </div>
      <div class="field"><div class="hint">Derived race targets: bike ${z.bike.im} · run ${z.run.im} · swim ${z.swim.im}. Easy run ${z.run.easy}.</div></div>
      <div class="grid2">
        <div class="field"><label>Long bike day</label><select name="longBikeDay"><option value="6" ${s.longBikeDay === 6 ? 'selected' : ''}>Saturday</option><option value="0" ${s.longBikeDay === 0 ? 'selected' : ''}>Sunday</option></select></div>
        <div class="field"><label>Long run day</label><select name="longRunDay"><option value="0" ${s.longRunDay === 0 ? 'selected' : ''}>Sunday</option><option value="6" ${s.longRunDay === 6 ? 'selected' : ''}>Saturday</option></select></div>
      </div>

      <div class="card-title" style="margin-top:8px">AI coach (optional)</div>
      <div class="field"><label>Anthropic API key</label><input name="anthropicKey" type="password" value="${esc(s.anthropicKey)}" placeholder="sk-ant-…" autocomplete="off"><div class="hint">Enables Claude-written summaries per activity. Called directly from your browser; the key never leaves this device. Without it, summaries are rule-based.</div></div>
      <div class="field"><label>Model</label><input name="anthropicModel" value="${esc(s.anthropicModel)}"></div>

      <details class="more"><summary>Advanced</summary>
        <div class="field"><label>CORS proxy prefix (only if intervals.icu blocks browser requests)</label><input name="corsProxy" value="${esc(s.corsProxy)}" placeholder="https://your-worker.workers.dev/?url="></div>
        <div class="field"><label>Plan anchor date</label><input name="planStart" type="date" value="${esc(s.planStart || '')}"><div class="hint">The Monday of this week is week 1. Change to re-anchor the periodisation.</div></div>
        <div class="field"><label><input type="checkbox" name="demo" ${s.demo ? 'checked' : ''} style="width:auto;margin-right:8px">Demo mode (synthetic data, no API calls)</label></div>
      </details>
      <button class="btn" type="submit">Save & sync</button>
      <button class="btn secondary" type="button" id="btnReset">Clear all local data</button>
    </form>
    <div class="small faint" style="padding:0 6px;line-height:1.5">Ironman Coach · static app, no server, no tracking. Data: intervals.icu API. Plan logic: periodised sub-12 build with adaptive volume (fatigue, compliance, readiness).</div>
  </div>`);
  const form = root.querySelector('form');
  form.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const patch = {
      athleteId: fd.get('athleteId').trim(), apiKey: fd.get('apiKey').trim(), anthropicKey: fd.get('anthropicKey').trim(), anthropicModel: fd.get('anthropicModel').trim() || DEFAULTS.anthropicModel,
      corsProxy: fd.get('corsProxy').trim(), raceName: fd.get('raceName').trim() || 'Ironman', raceDate: fd.get('raceDate'), goalHours: +fd.get('goalHours') || 12, weeklyHours: +fd.get('weeklyHours') || 9.5,
      ftp: +fd.get('ftp') || 180, weightKg: +fd.get('weightKg') || 75, runThreshold: strToPace(fd.get('runThreshold')) || 340, css: strToPace(fd.get('css')) || 110,
      longBikeDay: +fd.get('longBikeDay'), longRunDay: +fd.get('longRunDay'), thresholdSource: fd.get('thresholdSource'), planFromHistory: fd.get('planFromHistory') === 'on', demo: fd.get('demo') === 'on',
      planStart: fd.get('planStart') || s.planStart || isoDate(new Date()),
    };
    if (patch.athleteId && /^\d+$/.test(patch.athleteId)) patch.athleteId = 'i' + patch.athleteId;
    save(patch);
    onSave();
  };
  root.querySelector('#btnReset').onclick = () => { if (ui.confirm('Clear all local data including keys and cached summaries?')) { ui.reset(); } };
  return root;
}

function zoneInfo() {
  const m = getZoneModel();
  const part = (sp, name) => { const z = m[sp]; return `${name}: ${z.source === 'intervals' ? 'your intervals.icu zones' : 'default zones'}${z.lthr ? `, LTHR ${z.lthr}` : ''}${z.maxHr ? `, max HR ${z.maxHr}` : ''}${z.hr ? '' : ', no HR zones'}${z.hrBorrowed ? ` (HR zones from ${z.hrBorrowed})` : ''}`; };
  return `Zones in use — ${part('bike', 'Bike')} · ${part('run', 'Run')}. Workout targets and activity analysis use these.`;
}

export function renderSetup(onDemo) {
  const root = h(`<div class="stack" style="gap:14px">
    <div class="card hero" style="padding:24px"><div class="label" style="color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Welcome</div>
      <h1 style="font-size:28px;margin:8px 0 10px">Your adaptive road to a sub-12 Ironman</h1>
      <p class="muted" style="line-height:1.5">Connect intervals.icu below. The app builds a periodised plan to your race date, tells you what to do today, and re-shapes the coming weeks from your real training load, fatigue and readiness. Each completed activity gets a coach summary.</p>
      <button class="btn secondary" style="margin-top:16px" id="btnDemo">Explore with demo data first</button>
    </div>
  </div>`);
  root.querySelector('#btnDemo').onclick = onDemo;
  return root;
}
