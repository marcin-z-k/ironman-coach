// Race Day tab UI.
import { el, esc, fmtSec, paceToStr, fmtDate, daysBetween, today, round } from './util.js';
import { load, save } from './store.js';
import { raceDayPlan, exportRaceFit } from './raceday.js';

const h = (x) => el(x);
export const raceLocked = (s = load()) => !s.raceDayForce && daysBetween(today(), s.raceDate) > 14;

const COL = { gel: '#ff6a3d', salt: '#e8ecf3', drink: '#4cc3ff' };

export function renderRaceDay(A, ui, data) {
  const s = load();
  const acts = data?.activities || [];
  const locked = raceLocked(s);
  const days = daysBetween(today(), s.raceDate);
  const plan = raceDayPlan(A, s, acts);
  const root = h(`<div class="stack race ${locked ? 'race-locked' : ''}" style="gap:12px"></div>`);
  if (locked) root.append(h(`<div class="adjust-banner"><span>🔒</span><div><strong>Race Day unlocks on ${fmtDate(new Date(new Date(s.raceDate) - 14 * 864e5).toISOString().slice(0, 10), { day: 'numeric', month: 'long' })}</strong> — 2 weeks before ${esc(s.raceName)}. This is a preview based on your current fitness; it updates until race week.</div></div>`));
  const wrap = h('<div class="stack" style="gap:12px"></div>');
  root.append(wrap);

  const legs = plan.legs;
  wrap.append(h(`<div class="card hero" data-help-key="race-summary">
    <div class="row between"><div class="card-title" style="margin:0">${esc(s.raceName)} · ${fmtDate(s.raceDate, { day: 'numeric', month: 'short', year: 'numeric' })}</div><span class="pill">${days > 0 ? days + ' days' : days === 0 ? 'Today!' : 'done'}</span></div>
    <div class="big mono" style="margin-top:8px">${fmtSec(plan.total)}</div>
    <div class="small muted">Realistic execution plan from your current fitness — pace to finish strong, not to chase the clock.</div>
    <div class="split" style="margin-top:12px">
      ${legs.swim ? `<div class="metric"><div class="v sport-swim">${fmtSec(legs.swim.sec)}</div><div class="k">Swim · ${paceToStr(legs.swim.pace)}/100m</div></div>` : ''}
      ${legs.bike ? `<div class="metric"><div class="v sport-bike">${fmtSec(legs.bike.sec)}</div><div class="k">Bike · ${round(legs.bike.kmh, 1)} km/h · ${legs.bike.P} W</div></div>` : ''}
      ${legs.run ? `<div class="metric"><div class="v sport-run">${fmtSec(legs.run.sec)}</div><div class="k">Run · ${paceToStr(legs.run.sec / plan.D.run)}/km avg</div></div>` : ''}
      ${plan.trans ? `<div class="metric"><div class="v">${fmtSec(plan.trans)}</div><div class="k">Transitions</div></div>` : ''}
    </div>
    <label class="switch-row" style="margin-top:12px"><span><b>${plan.sup ? 'Supported race' : 'Unsupported race'}</b><span class="hint" style="display:block">${plan.sup ? 'Aid stations: bike every 20 km, run every 2.5 km.' : 'You carry all food and fluids.'}</span></span><input type="checkbox" class="ios" data-sup ${plan.sup ? 'checked' : ''}></label>
  </div>`));
  wrap.querySelector('[data-sup]').onchange = (e) => { save({ raceSupported: e.target.checked }); ui.keepScroll(); ui.rerender(); };

  // pacing
  const pace = h(`<div class="card" data-help-key="race-pacing"><div class="card-title">Pacing strategy</div><div class="stack" style="gap:12px"></div></div>`);
  const pc = pace.querySelector('.stack');
  if (legs.swim) pc.append(h(`<div><b class="sport-swim">Swim</b> <span class="muted small">${paceToStr(legs.swim.pace)}/100m</span><div class="small muted">${esc(legs.swim.note)}</div></div>`));
  if (legs.bike) pc.append(h(`<div><b class="sport-bike">Bike</b> <span class="muted small">${legs.bike.P} W target (${Math.round(legs.bike.IF * 100)} % of ${legs.bike.ftp} W ${legs.bike.ftpLabel || 'outdoor FTP'})${legs.bike.hrCap ? ` · HR cap ${legs.bike.hrCap} bpm` : ''}</span>
    ${legs.bike.segs.map(x => `<div class="seg-row"><span class="mono">${round(x.from)}–${round(x.to)} km</span><b>${x.w} W</b><span class="muted small">${esc(x.label)}</span></div>`).join('')}</div>`));
  if (legs.run) pc.append(h(`<div><b class="sport-run">Run</b>${legs.run.hrCap ? ` <span class="muted small">HR cap ${legs.run.hrCap} bpm for the first half</span>` : ''}
    ${legs.run.segs.map(x => `<div class="seg-row"><span class="mono">${round(x.from, 1)}–${round(x.to, 1)} km</span><b>${paceToStr(x.pace)}/km</b><span class="muted small">${esc(x.label)}</span></div>`).join('')}</div>`));
  wrap.append(pace);

  // fueling chart
  const legKeys = ['bike', 'run'].filter(k => legs[k]);
  if (legKeys.length) {
    const cur = legKeys.includes(ui.raceLeg) ? ui.raceLeg : legKeys[0];
    const L = legs[cur];
    const fc = h(`<div class="card" data-help-key="race-fuel">
      <div class="row between"><div class="card-title" style="margin:0">Fueling plan</div><div class="chips">${legKeys.map(k => `<button class="chip ${k === cur ? 'on' : ''}" data-leg="${k}">${k === 'bike' ? 'Bike' : 'Run'}</button>`).join('')}</div></div>
      <div class="fuel-chart" style="margin-top:10px"></div>
      <div class="legend small muted"><span><i style="background:${COL.gel}"></i>Gel</span><span><i style="background:${COL.drink}"></i>Drink</span><span><i style="background:${COL.salt}"></i>Salt</span>${plan.sup ? '<span><i class="aidl"></i>Aid station</span>' : ''}</div>
      <div class="split" style="margin-top:12px">
        <div class="metric"><div class="v">${L.totals.perHour.carbs} g</div><div class="k">Carbs / h · ${L.totals.carbs} g total</div></div>
        <div class="metric"><div class="v">${L.totals.perHour.fluid} ml</div><div class="k">Fluid / h · ${round(L.totals.fluid / 1000, 1)} L total</div></div>
        <div class="metric"><div class="v">${L.totals.perHour.sodium} mg</div><div class="k">Sodium / h · ${L.totals.sodium} mg total</div></div>
      </div>
      <div class="small" style="margin-top:10px"><b>${plan.sup ? 'Carry' : 'Carry (unsupported)'}:</b> <span class="muted">${L.carry.map(esc).join(' · ')}</span></div>
      <details class="more" style="margin-top:8px"><summary>Every fueling point (${L.events.length})</summary><div class="small muted" style="line-height:1.7;margin-top:6px">${L.events.map(e => `<div><span class="mono">${round(e.km, 1)} km</span>${e.t != null ? ` · ${fmtSec(e.t * 60)}` : ''} — <span style="color:${COL[e.type]}">●</span> ${esc(e.label)}</div>`).join('')}</div></details>
      <div class="small faint" style="margin-top:8px">Course: flat placeholder (no route loaded yet) — fueling points are placed by distance and time.</div>
    </div>`);
    fc.querySelectorAll('[data-leg]').forEach(b => b.onclick = () => { ui.raceLeg = b.dataset.leg; ui.keepScroll(); ui.rerender(); });
    fc.querySelector('.fuel-chart').append(fuelChart(L, cur, plan));
    wrap.append(fc);
  }

  // export
  const ex = h(`<div class="card" data-help-key="race-export"><div class="card-title">Take it to your watch</div>
    <div class="row" style="gap:8px;flex-wrap:wrap">${legKeys.map(k => `<button class="btn secondary small" data-fit="${k}">⤓ ${k === 'bike' ? 'Bike' : 'Run'} .FIT</button>`).join('')}<button class="btn secondary small" data-print>🖨 Race card</button></div>
    <div class="small faint" style="margin-top:8px">.FIT race workouts: each fueling point is a step at its kilometre, with your power/pace target — the watch alerts you there. Import in Garmin Connect (Training → Workouts → Import) or any app that imports .FIT workouts (e.g. COROS Training Hub); for Wahoo use the race card. Without a course file the alerts go by distance, so they work on any route.</div></div>`);
  ex.querySelectorAll('[data-fit]').forEach(b => b.onclick = async () => { try { await exportRaceFit(plan, b.dataset.fit, s); ui.toast('.FIT downloaded'); } catch (e) { ui.toast(e.message, true); } });
  ex.querySelector('[data-print]').onclick = () => printCard(plan, s);
  wrap.append(ex);
  if (locked) wrap.setAttribute('inert', '');
  return root;
}

function fuelChart(L, leg, plan) {
  const W = 460, H = 210, pad = { l: 40, r: 10, t: 14, b: 24 };
  const dist = leg === 'bike' ? plan.D.bike : plan.D.run;
  const X = km => pad.l + km / dist * (W - pad.l - pad.r);
  const val = (km) => { const sg = L.segs.find(x => km >= x.from && km <= x.to) || L.segs[L.segs.length - 1]; return leg === 'bike' ? sg.w : sg.pace; };
  const vs = L.segs.map(x => leg === 'bike' ? x.w : x.pace);
  let mn = Math.min(...vs), mx = Math.max(...vs); const pd = (mx - mn) * 0.6 || mx * 0.08; mn -= pd; mx += pd;
  const elevTop = H - pad.b - 26;                                      // bottom strip = elevation (flat)
  const Y = v => { const f = (v - mn) / (mx - mn); return pad.t + (leg === 'run' ? f : 1 - f) * (elevTop - pad.t - 6); };
  const fmtV = v => leg === 'bike' ? `${Math.round(v)} W` : `${paceToStr(v)}/km`;
  let svg = '';
  for (let i = 0; i <= 2; i++) { const v = mn + (mx - mn) * i / 2; svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#20252e"/><text x="${pad.l - 5}" y="${Y(v) + 4}" fill="#5d6678" font-size="10" text-anchor="end">${leg === 'bike' ? Math.round(v) : paceToStr(v)}</text>`; }
  svg += `<rect x="${pad.l}" y="${elevTop}" width="${W - pad.l - pad.r}" height="${H - pad.b - elevTop}" fill="rgba(255,255,255,.05)"/><line x1="${pad.l}" x2="${W - pad.r}" y1="${elevTop + 10}" y2="${elevTop + 10}" stroke="rgba(255,255,255,.25)"/><text x="${W - pad.r - 4}" y="${elevTop + 22}" fill="#5d6678" font-size="9.5" text-anchor="end">elevation · flat placeholder</text>`;
  for (const a of L.aid) svg += `<line x1="${X(a.km)}" x2="${X(a.km)}" y1="${pad.t}" y2="${H - pad.b}" stroke="rgba(255,255,255,.08)" stroke-dasharray="3 3"/>`;
  let d = '';
  for (const sg of L.segs) { const v = leg === 'bike' ? sg.w : sg.pace; d += `${d ? 'L' : 'M'}${X(sg.from).toFixed(1)},${Y(v).toFixed(1)} L${X(sg.to).toFixed(1)},${Y(v).toFixed(1)} `; }
  svg += `<path class="draw" pathLength="1" d="${d}" fill="none" stroke="${leg === 'bike' ? '#ffb020' : '#58e39a'}" stroke-width="2.6"/>`;
  const rowY = { gel: 0, drink: 7, salt: -7 };
  for (const e of L.events) svg += `<circle cx="${X(e.km).toFixed(1)}" cy="${(Y(val(e.km)) + (rowY[e.type] || 0)).toFixed(1)}" r="${e.type === 'gel' ? 4.2 : 3}" fill="${COL[e.type]}" stroke="#0e1116" stroke-width="1"/>`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => `<text x="${X(dist * f)}" y="${H - 7}" fill="#5d6678" font-size="10" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${round(dist * f)} km</text>`).join('');
  const wrap = h('<div class="lc"></div>');
  wrap.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}">${svg}${ticks}<line class="cursor" y1="${pad.t}" y2="${H - pad.b}" stroke="#9aa3b2" visibility="hidden"/></svg><div class="tip" hidden></div>`;
  const sv = wrap.querySelector('svg'), tip = wrap.querySelector('.tip'), cur = wrap.querySelector('.cursor');
  const show = (ev) => {
    const r = sv.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width * W;
    const km = Math.max(0, Math.min(dist, (x - pad.l) / (W - pad.l - pad.r) * dist));
    const near = L.events.filter(e => Math.abs(e.km - km) <= dist / 40);
    cur.setAttribute('x1', X(km)); cur.setAttribute('x2', X(km)); cur.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<div class="th">${round(km, 1)} km · ${fmtV(val(km))}</div>${near.length ? near.map(e => `<div class="tr"><span class="dot" style="background:${COL[e.type]}"></span>${esc(e.label)}<b>${round(e.km, 1)} km</b></div>`).join('') : '<div class="tr faint">no fueling here</div>'}`;
  };
  sv.addEventListener('pointermove', show); sv.addEventListener('pointerdown', show);
  sv.addEventListener('pointerleave', () => { tip.hidden = true; cur.setAttribute('visibility', 'hidden'); });
  return wrap;
}

function printCard(plan, s) {
  const L = plan.legs;
  const rows = (leg) => L[leg] ? L[leg].events.filter(e => leg === 'run' || e.type !== 'drink').map(e => `<tr><td>${round(e.km, 1)} km</td><td>${e.t != null ? fmtSec(e.t * 60) : ''}</td><td>${esc(e.label)}</td></tr>`).join('') : '';
  const segs = (leg) => L[leg] ? L[leg].segs.map(x => `<tr><td>${round(x.from, 1)}–${round(x.to, 1)} km</td><td>${leg === 'bike' ? x.w + ' W' : paceToStr(x.pace) + '/km'}</td><td>${esc(x.label)}</td></tr>`).join('') : '';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Race card · ${esc(s.raceName)}</title><style>body{font:13px -apple-system,Segoe UI,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 6px}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #ddd;padding:4px 6px;vertical-align:top}td:first-child{white-space:nowrap;font-variant-numeric:tabular-nums}</style></head><body>
    <h1>${esc(s.raceName)} — ${esc(s.raceDate)}</h1><div>Planned finish ${fmtSec(plan.total)} · ${plan.sup ? 'supported' : 'unsupported'}</div>
    ${L.swim ? `<h2>Swim · ${fmtSec(L.swim.sec)} · ${paceToStr(L.swim.pace)}/100m</h2><div>${esc(L.swim.note)}</div>` : ''}
    ${L.bike ? `<h2>Bike · ${fmtSec(L.bike.sec)} · ${L.bike.P} W${L.bike.hrCap ? ` · HR ≤ ${L.bike.hrCap}` : ''}</h2><table>${segs('bike')}</table><h2>Bike fueling (${L.bike.totals.perHour.carbs} g/h · ${L.bike.totals.perHour.fluid} ml/h · ${L.bike.totals.perHour.sodium} mg/h) — drink ~${Math.round(L.bike.totals.perHour.fluid / 4)} ml every 15 min</h2><table>${rows('bike')}</table>` : ''}
    ${L.run ? `<h2>Run · ${fmtSec(L.run.sec)}</h2><table>${segs('run')}</table><h2>Run fueling (${L.run.totals.perHour.carbs} g/h · ${L.run.totals.perHour.sodium} mg/h)</h2><table>${rows('run')}</table>` : ''}
    <script>window.onload=()=>window.print()<\/script></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(url, '_blank');
}
