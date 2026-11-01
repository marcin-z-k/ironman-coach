// Activity detail slide-over: summary metrics, route map, synced pace/HR/cadence/elevation charts,
// execution score, aerobic decoupling, brick analysis, heat correction (EnviroNorm), zones, coach summary.
import { el, esc, fmtDur, fmtKm, fmtDate, paceToStr, round, sportIcon, SPORT_LABEL } from './util.js';
import { load } from './store.js';
import { getStreams, downsample, decoupling, brickSplit } from './streams.js';
import { streamChart } from './charts.js';
import { getZoneModel, plannedDist } from './zones.js';
import { executionScore, heatFactor, getTemp, setTemp, realPower } from './analytics.js';
import { summarise, getSummary } from './analysis.js';
import { fueling, intensityOf } from './nutrition.js';

const ZCOL = ['#5d6678', '#4cc3ff', '#58e39a', '#ffb020', '#ff7a45', '#ff5c6c', '#c44cff'];
const BAND = ['rgba(93,102,120,.10)', 'rgba(76,195,255,.10)', 'rgba(88,227,154,.10)', 'rgba(255,176,32,.10)', 'rgba(255,92,108,.12)'];

export function scoreBadge(sc) {
  if (!sc) return '';
  const c = sc.score >= 85 ? 'good' : sc.score >= 70 ? 'warn' : 'bad';
  return `<span class="pill ${c} score" title="Execution score">${sc.score}%</span>`;
}

function decouplingBadge(d, heat) {
  if (!d) return '';
  const adj = d.pct - (heat - 1) * 100;
  const [cls, lbl, txt] = adj < 5 ? ['good', 'Stable base', 'Excellent aerobic endurance for this distance.'] : adj <= 10 ? ['warn', 'Moderate drift', 'Minor drift. Check fatigue or hydration towards the end.'] : ['bad', 'High drift', 'Significant aerobic decoupling. Build base / fat metabolism with more steady Z2 volume.'];
  return `<div class="an-card"><div class="row between"><div class="card-title" style="margin:0">Aerobic decoupling</div><span class="pill ${cls}">${lbl}</span></div>
    <div class="row" style="gap:14px;align-items:baseline;margin-top:6px"><div class="big mono">${adj.toFixed(1)}%</div><div class="small muted">${d.basis}/HR, 2nd half vs 1st half${heat > 1 ? ` · heat-corrected (raw ${d.pct.toFixed(1)}%)` : ''}</div></div>
    <p class="small muted" style="margin-top:6px">${txt}</p></div>`;
}

export function openActivity(a, ctx, ui) {
  const s = load();
  const planned = ctx.planned;
  const sc = executionScore(a, planned);
  const heat = heatFactor(a);
  const dt = new Date(a.start);
  const pace = a.sport === 'run' ? (a.paceSecKm ? paceToStr(a.paceSecKm) + '/km' : '–') : a.sport === 'swim' ? (a.pace100 ? paceToStr(a.pace100) + '/100m' : '–') : (a.speedKmh ? round(a.speedKmh, 1) + ' km/h' : '–');
  const cad = a.avgCadence ? Math.round(a.sport === 'run' && a.avgCadence < 120 ? a.avgCadence * 2 : a.avgCadence) : null;
  const cards = [
    ['Time', fmtDur(a.movingSec / 60)], ['Distance', a.distanceM ? fmtKm(a.distanceM) : '–'], [a.sport === 'bike' ? 'Avg speed' : 'Avg pace', pace],
    ['Avg HR', a.avgHr ? Math.round(a.avgHr) + ' bpm' : '–'], ['Elevation', a.elev ? Math.round(a.elev) + ' m' : '–'], ['Calories', a.calories ? Math.round(a.calories) + ' kcal' : '–'],
    ['Avg cadence', cad ? cad + (a.sport === 'run' ? ' spm' : ' rpm') : '–'],
  ];
  if (realPower(a) && a.np) cards.push(['Norm. power', a.np + ' W']);
  if (a.load) cards.push(['Load', a.load]);
  const fuel = planned ? fueling(planned.min, intensityOf(planned), getTemp(a)) : null;

  const node = el(`<div class="detail">
    <div class="detail-head">
      <button class="icon-btn" data-close aria-label="Close">✕</button>
      <span class="ico big-ico sport-${a.sport}">${sportIcon(a.sport)}</span>
      <div style="min-width:0"><div class="detail-title">${esc(a.name)}</div><div class="small muted">${fmtDate(a.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${a.location ? ' · ' + esc(a.location) : ''}</div></div>
    </div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin:2px 0 12px">
      ${sc ? `${scoreBadge(sc)}<span class="small muted">execution</span>` : ''}
      ${a.brick ? `<span class="pill accent">Brick run · ${a.brick.gapMin} min after bike</span>` : ''}
      ${a.indoor ? '<span class="pill">Indoor</span>' : ''}${a.race ? '<span class="pill accent">Race</span>' : ''}
      ${planned ? `<span class="pill">Plan: ${esc(planned.title)}</span>` : '<span class="pill">Not in the plan</span>'}
    </div>
    <div class="dmetrics">${cards.map(c => `<div class="metric"><div class="v">${esc(String(c[1]))}</div><div class="k">${c[0]}</div></div>`).join('')}</div>
    <div class="map-wrap" hidden><div class="map"></div></div>
    <div class="charts"><div class="muted small loading">Loading streams…</div></div>
    <div class="an-grid">
      ${sc ? `<div class="an-card"><div class="row between"><div class="card-title" style="margin:0">Execution score</div>${scoreBadge(sc)}</div><div class="exec-bar"><span style="width:${sc.score}%"></span></div><p class="small muted" style="margin-top:6px">${sc.notes.length ? esc(sc.notes.join(' · ')) : 'Done as prescribed.'}${heat > 1 ? ' Heat tolerance applied.' : ''}</p></div>` : ''}
      <div class="decoup"></div>
      <div class="brick"></div>
      <div class="an-card"><div class="card-title">EnviroNorm · heat</div><div class="row" style="gap:10px;align-items:center"><input class="temp-in" type="number" step="1" min="-10" max="45" placeholder="°C" value="${getTemp(a) ?? ''}" style="width:90px"><span class="small muted">${a.avgTemp != null ? `device logged ${Math.round(a.avgTemp)} °C (wrist sensors read high) · ` : ''}above 22 °C, pace/HR metrics get ~1.75% tolerance per 5 °C${heat > 1 ? ` — now <b style="color:var(--warn)">${((heat - 1) * 100).toFixed(1)}%</b>` : ''}.</span></div></div>
      ${fuel && fuel.carbs[1] > 0 ? `<div class="an-card"><div class="card-title">Fuel for this session</div><div class="small"><b>${fuel.carbs[0]}–${fuel.carbs[1]} g carbs/h</b> · ${fuel.fluid[0]}–${fuel.fluid[1]} ml fluid/h · ${fuel.sodium[0]}–${fuel.sodium[1]} mg sodium/h</div><div class="small muted" style="margin-top:4px">${esc(fuel.example)}</div></div>` : ''}
    </div>
    <div class="zones-d"></div>
    <div class="summary"></div>
    <div class="row between" style="margin-top:10px"><button class="btn ghost small" data-redo>↻ Re-analyse</button><a class="small" href="https://intervals.icu/activities/${esc(a.id)}" target="_blank" rel="noopener">Open in intervals.icu ↗</a></div>
  </div>`);

  node.querySelector('[data-close]').onclick = () => ui.closeSheet();
  node.querySelector('.temp-in').onchange = (e) => { setTemp(a, e.target.value === '' ? null : +e.target.value); ui.closeSheet(true); ui.invalidate(); openActivity(a, ctx, ui); };
  // zones
  node.querySelector('.zones-d').innerHTML = zoneBars(a, planned);
  // summary
  const box = node.querySelector('.summary');
  const existing = getSummary(a);
  const fill = r => { const m = { on: ['good', 'On target'], above: ['warn', 'Harder than intended'], below: ['bad', 'Under-delivered'], none: ['', 'Not in the plan'] }[r.verdict] || ['', 'Summary']; box.innerHTML = `<div class="verdict"><span class="dot" style="background:var(--${m[0] || 'muted'})"></span>${m[1]}</div><div>${esc(r.text)}</div><div class="adjust"><b>Change anything?</b> ${esc(r.adjust)}</div><div class="src">${r.source === 'ai' ? 'AI coach' : 'Rule-based'}${r.error ? ' · AI failed: ' + esc(r.error) : ''}</div>`; };
  if (existing && !(existing.source === 'rules' && s.anthropicKey && !existing.error)) fill(existing);
  else { box.innerHTML = '<div class="muted small">Analysing…</div>'; summarise(a, ctx).then(fill); }
  node.querySelector('[data-redo]').onclick = () => { box.innerHTML = '<div class="muted small">Analysing…</div>'; summarise(a, ctx, { force: true }).then(fill); };

  ui.openSheet(node);
  loadStreams(a, node, heat);
  return node;
}

async function loadStreams(a, node, heat) {
  const wrap = node.querySelector('.charts');
  let st;
  try { st = await getStreams(a); } catch (e) { wrap.innerHTML = `<div class="muted small">No stream data from intervals.icu (${esc(e.message)}).</div>`; return; }
  if (!st || !st.n) { wrap.innerHTML = '<div class="muted small">No stream data for this activity.</div>'; return; }
  const ds = downsample(st, 600);
  const t = ds.time.map(v => v - ds.time[0]);
  const group = {};
  const distAt = (sec) => { if (!ds.dist) return ''; let i = t.findIndex(v => v >= sec); if (i < 0) i = t.length - 1; return ds.dist[i] != null ? (ds.dist[i] / 1000).toFixed(2) + ' km' : ''; };
  const charts = [];
  const sp = a.sport;
  if (ds.speed) {
    if (sp === 'run') {
      const y = ds.speed.map(v => v >= 1.4 && v <= 7 ? 1000 / v : null);
      charts.push(['Pace', streamChart({ x: t, y, color: '#58e39a', name: 'Pace', invert: true, fmt: v => paceToStr(v) + '/km', axisFmt: v => paceToStr(v), avg: a.paceSecKm, group, xExtra: distAt }), a.paceSecKm ? paceToStr(a.paceSecKm) + '/km' : '', '#58e39a']);
    } else if (sp === 'swim') {
      const y = ds.speed.map(v => v >= 0.3 && v <= 3 ? 100 / v : null);
      charts.push(['Pace', streamChart({ x: t, y, color: '#4cc3ff', name: 'Pace', invert: true, fmt: v => paceToStr(v) + '/100m', axisFmt: v => paceToStr(v), avg: a.pace100, group, xExtra: distAt }), a.pace100 ? paceToStr(a.pace100) + '/100m' : '', '#4cc3ff']);
    } else {
      const y = ds.speed.map(v => v >= 0 && v <= 25 ? v * 3.6 : null);
      charts.push(['Speed', streamChart({ x: t, y, color: '#ffb020', name: 'Speed', fmt: v => round(v, 1) + ' km/h', avg: a.speedKmh, group, xExtra: distAt }), a.speedKmh ? round(a.speedKmh, 1) + ' km/h' : '', '#ffb020']);
    }
  }
  if (ds.watts && realPower(a)) charts.push(['Power', streamChart({ x: t, y: ds.watts, color: '#ffd166', name: 'Power', fmt: v => Math.round(v) + ' W', avg: a.avgW, group, xExtra: distAt }), a.avgW ? Math.round(a.avgW) + ' W' : '', '#ffd166']);
  if (ds.hr) {
    const z = getZoneModel()[sp === 'run' ? 'run' : 'bike']?.hr;
    const bands = z ? z.slice(0, 5).map((top, i) => ({ y0: i ? z[i - 1] : 40, y1: top, color: BAND[i] })) : [];
    charts.push(['Heart rate', streamChart({ x: t, y: ds.hr.map(v => v > 40 ? v : null), color: '#ff5c6c', name: 'HR', fmt: v => Math.round(v) + ' bpm', avg: a.avgHr, bands, group, xExtra: distAt }), a.avgHr ? Math.round(a.avgHr) + ' bpm' : '', '#ff5c6c']);
  }
  if (ds.cad && ds.cad.some(v => v > 0)) {
    const dbl = sp === 'run' && (a.avgCadence ?? 90) < 120;
    const y = ds.cad.map(v => v > 0 ? (dbl ? v * 2 : v) : null);
    const vals = y.filter(v => v); const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    charts.push(['Cadence', streamChart({ x: t, y, color: '#c48cff', name: 'Cadence', fmt: v => Math.round(v) + (sp === 'run' ? ' spm' : ' rpm'), avg, group, xExtra: distAt }), Math.round(avg) + (sp === 'run' ? ' spm' : ' rpm'), '#c48cff']);
  }
  if (ds.alt && ds.alt.some(v => v != null)) charts.push(['Elevation', streamChart({ x: t, y: ds.alt, color: '#9aa3b2', name: 'Elevation', fmt: v => Math.round(v) + ' m', group, xExtra: distAt }), a.elev ? '+' + Math.round(a.elev) + ' m' : '', '#cfd5df']);
  wrap.innerHTML = '';
  charts.forEach(([title, c, avgTxt, col]) => { const card = el(`<div class="an-card chart-card"><div class="chart-head"><div class="card-title" style="margin:0">${title}</div>${avgTxt ? `<span class="avg-pill" style="--c:${col}"><span>${title === 'Elevation' ? 'gain' : 'avg'}</span>${esc(avgTxt)}</span>` : ''}</div></div>`); card.append(c); wrap.append(card); });
  // decoupling (bike/run > 60 min)
  if ((sp === 'bike' || sp === 'run') && a.movingSec > 3600) {
    const d = decoupling(st, a, realPower(a));
    node.querySelector('.decoup').innerHTML = d ? decouplingBadge(d, heat) : (a.decoupling != null ? decouplingBadge({ pct: a.decoupling, basis: 'intervals.icu' }, heat) : '');
  }
  // brick
  if (a.brick) {
    const b = brickSplit(st);
    node.querySelector('.brick').innerHTML = `<div class="an-card"><div class="row between"><div class="card-title" style="margin:0">Brick run</div><span class="pill accent">${a.brick.gapMin} min transition</span></div>${b ? `<div class="row" style="gap:18px;margin-top:8px"><div><div class="v mono" style="font-size:20px;font-weight:800">${paceToStr(b.first)}</div><div class="small muted">first 3 km</div></div><div><div class="v mono" style="font-size:20px;font-weight:800">${paceToStr(b.rest)}</div><div class="small muted">rest of run</div></div></div><p class="small muted" style="margin-top:6px">${Math.abs(b.diffPct) < 3 ? 'Stable — you found your rhythm straight off the bike.' : b.diffPct > 0 ? `First 3 km ${b.diffPct.toFixed(1)}% slower — heavy legs; more brick runs will shorten this.` : `First 3 km ${Math.abs(b.diffPct).toFixed(1)}% faster — classic too-fast start off the bike. Hold back in the first km on race day.`}</p>` : '<p class="small muted">Run shorter than 4 km — no split analysis.</p>'}</div>`;
  }
  // map
  if (st.latlng && st.latlng.length > 10) drawMap(node.querySelector('.map-wrap'), st.latlng, a.sport);
}

let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  leafletP = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.append(css);
    const js = document.createElement('script'); js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; js.onload = () => res(window.L); js.onerror = rej; document.head.append(js);
  });
  return leafletP;
}
async function drawMap(wrap, latlng, sport) {
  try {
    const L = await loadLeaflet();
    wrap.hidden = false;
    const pts = latlng.filter(p => p && p[0] != null && Math.abs(p[0]) > 0.01);
    const step = Math.max(1, Math.floor(pts.length / 1500));
    const line = pts.filter((_, i) => i % step === 0);
    const map = L.map(wrap.querySelector('.map'), { zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: false, touchZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false, zoomSnap: 0.25 });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors © CARTO' }).addTo(map);
    const col = sport === 'run' ? '#58e39a' : sport === 'bike' ? '#ffb020' : '#4cc3ff';
    L.polyline(line, { color: col, weight: 10, opacity: 0.25 }).addTo(map);
    const pl = L.polyline(line, { color: col, weight: 3.5, opacity: 1 }).addTo(map);
    L.circleMarker(line[0], { radius: 6, color: '#fff', fillColor: '#58e39a', fillOpacity: 1, weight: 2 }).addTo(map);
    L.circleMarker(line[line.length - 1], { radius: 6, color: '#fff', fillColor: '#ff5c6c', fillOpacity: 1, weight: 2 }).addTo(map);
    map.fitBounds(pl.getBounds(), { padding: [18, 18] });
    setTimeout(() => map.invalidateSize(), 350);
  } catch { wrap.hidden = true; }
}

function zoneBar(label, secs) {
  if (!secs || !secs.some(Boolean)) return '';
  const tot = secs.reduce((a, b) => a + (b || 0), 0);
  const segs = secs.map((v, i) => v ? `<span style="flex:${v};background:${ZCOL[Math.min(i, 6)]}" title="Z${i + 1}: ${Math.round(v / 60)} min"></span>` : '').join('');
  const top = secs.map((v, i) => [v, i]).filter(x => x[0] / tot >= 0.08).map(([v, i]) => `Z${i + 1} ${Math.round(v / tot * 100)}%`).join(' · ');
  return `<div class="zrow"><div class="zl">${label}</div><div class="zbar">${segs}</div><div class="zt">${top}</div></div>`;
}
function zoneBars(a, planned) {
  const rows = [];
  if (a.powerZoneSecs && realPower(a)) rows.push(zoneBar('Power', a.powerZoneSecs));
  if (a.paceZoneSecs && a.sport !== 'bike') rows.push(zoneBar(a.sport === 'swim' ? 'Pace' : 'Pace (GAP)', a.paceZoneSecs));
  if (a.hrZoneSecs) rows.push(zoneBar('Heart rate', a.hrZoneSecs));
  if (planned) { const pd = plannedDist(planned.steps); if (pd) rows.push(zoneBar('Planned', pd.secs)); }
  const out = rows.filter(Boolean);
  return out.length ? `<div class="an-card"><div class="card-title">Time in zones</div><div class="zones" style="margin:0">${out.join('')}</div></div>` : '';
}
