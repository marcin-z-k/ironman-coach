// Health widgets (home screen) and trend pages: readiness, sleep, fitness, fatigue, form,
// VO2max, HRV, resting HR. Data from intervals.icu wellness; readiness is computed when the
// device doesn't provide one; VO2max is estimated from eFTP when no device value exists.
import { el, esc, fmtDate, round, clamp, isoDate, addDays, parseDate } from './util.js';
import { load } from './store.js';

const h = (x) => el(x);
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : 0; };

// ---- series ---------------------------------------------------------------
function computedReadiness(well) {
  const out = [];
  for (let i = 0; i < well.length; i++) {
    const w = well[i];
    const prior = well.slice(Math.max(0, i - 28), i);
    const base = k => { const v = prior.map(x => x[k]).filter(x => x != null); return v.length >= 5 ? mean(v) : null; };
    const parts = [];
    const hb = base('hrv'); if (w.hrv != null && hb) parts.push([clamp(50 + (w.hrv / hb - 1) * 250, 0, 100), 0.3]);
    const rb = base('restingHR'); if (w.restingHR != null && rb) parts.push([clamp(50 - (w.restingHR - rb) * 8, 0, 100), 0.2]);
    if (w.sleepScore != null) parts.push([w.sleepScore, 0.25]); else if (w.sleepSecs) parts.push([clamp((w.sleepSecs / 3600 - 5) / 3 * 100, 0, 100), 0.25]);
    if (w.ctl != null && w.atl != null) parts.push([clamp(60 + (w.ctl - w.atl) * 2, 0, 100), 0.25]);
    if (parts.length >= 2) { const ws = parts.reduce((a, p) => a + p[1], 0); out.push({ date: w.date, v: Math.round(parts.reduce((a, p) => a + p[0] * p[1], 0) / ws) }); }
  }
  return out;
}

function vo2FromEftp(acts) {
  const kg = load().weightKg || 75;
  const byDate = {};
  acts.filter(a => a.sport === 'bike' && a.eftp).forEach(a => { byDate[a.date] = Math.max(byDate[a.date] || 0, a.eftp); });
  return Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0])).map(([date, e]) => ({ date, v: round(10.8 * (e / 0.75) / kg + 7, 1) }));
}

const pick = (well, f) => well.map(w => ({ date: w.date, v: f(w) })).filter(p => p.v != null && isFinite(p.v));

export const METRICS = {
  readiness: {
    label: 'Readiness', unit: '', better: 1, color: '#58e39a',
    series(well) { const dev = pick(well, w => w.readiness); return dev.length >= 5 ? { pts: dev, note: 'From your device via intervals.icu' } : { pts: computedReadiness(well), note: 'Calculated: HRV and resting HR vs your 4-week baseline, sleep, and form' }; },
    status: v => v >= 70 ? ['good', 'High'] : v >= 50 ? ['', 'Moderate'] : ['bad', 'Low'],
    about: 'How ready your body is to absorb hard training today. High: go ahead with key sessions. Low: keep it aerobic or rest.',
  },
  sleep: {
    label: 'Sleep', unit: '', better: 1, color: '#9b8cff',
    series(well) { const sc = pick(well, w => w.sleepScore); if (sc.length >= 5) return { pts: sc, note: 'Sleep score', sub: pick(well, w => w.sleepSecs ? round(w.sleepSecs / 3600, 1) : null) }; return { pts: pick(well, w => w.sleepSecs ? round(w.sleepSecs / 3600, 1) : null), note: 'Hours slept (no sleep score from your device)', unit: 'h' }; },
    status: (v, u) => u === 'h' ? (v >= 7.5 ? ['good', 'Good'] : v >= 6.5 ? ['', 'Fair'] : ['bad', 'Short']) : (v >= 80 ? ['good', 'Good'] : v >= 60 ? ['', 'Fair'] : ['bad', 'Poor']),
    about: 'Sleep is where adaptation happens. Ironman volume needs 7.5–9 h. Two short nights in a row are a reason to drop intensity.',
  },
  fitness: {
    label: 'Fitness', unit: 'CTL', better: 1, color: '#4cc3ff',
    series: well => ({ pts: pick(well, w => w.ctl != null ? round(w.ctl, 1) : null), note: '42-day weighted training load' }),
    status: (v, u, pts) => { const prev = pts.length > 7 ? pts[pts.length - 8].v : null; const r = prev != null ? v - prev : 0; return r > 7 ? ['warn', `+${round(r, 1)}/wk fast`] : r > 1 ? ['good', `+${round(r, 1)}/wk`] : r < -3 ? ['bad', `${round(r, 1)}/wk`] : ['', 'Stable']; },
    about: 'Chronic training load: what your body is used to. For a sub-12 Ironman most age-groupers peak around 80–100. Build by 3–6 points per week.',
  },
  fatigue: {
    label: 'Fatigue', unit: 'ATL', better: 0, color: '#ff5c6c',
    series: well => ({ pts: pick(well, w => w.atl != null ? round(w.atl, 1) : null), note: '7-day weighted training load' }),
    status: (v, u, pts, well) => { const l = well[well.length - 1]; const r = l?.ctl ? v / l.ctl : 1; return r > 1.4 ? ['bad', 'Very high'] : r > 1.15 ? ['warn', 'High'] : ['', 'Normal']; },
    about: 'Acute training load from the last week. It should rise above Fitness in build weeks and fall below it in recovery weeks.',
  },
  form: {
    label: 'Form', unit: 'TSB', better: 1, color: '#ffb020',
    series: well => ({ pts: pick(well, w => w.ctl != null && w.atl != null ? round(w.ctl - w.atl, 1) : null), note: 'Fitness minus fatigue' }),
    status: v => v > 5 ? ['good', 'Fresh'] : v > -10 ? ['', 'Neutral'] : v > -30 ? ['good', 'Optimal training'] : ['bad', 'Overreaching'],
    about: 'Between −10 and −30 is the productive training zone. Below −30 risks overreaching. Aim for +5 to +15 on race day.',
    bands: [[-30, -10, 'rgba(88,227,154,.08)'], [-80, -30, 'rgba(255,92,108,.07)']],
  },
  vo2max: {
    label: 'VO2max', unit: 'ml/kg/min', better: 1, color: '#ff8f6a',
    series(well, acts) { const d = pick(well, w => w.vo2max); return d.length >= 2 ? { pts: d, note: 'From your device via intervals.icu' } : { pts: vo2FromEftp(acts), note: 'Estimated from your eFTP and weight (no device value)', est: true }; },
    status: (v, u, pts) => { const old = pts.find(p => p.date >= isoDate(addDays(new Date(), -35))); const d = old ? v - old.v : 0; return d > 0.4 ? ['good', `+${round(d, 1)} in 30 d`] : d < -0.4 ? ['bad', `${round(d, 1)} in 30 d`] : ['', 'Stable']; },
    about: 'Aerobic ceiling. Ironman performance depends more on how much of it you can sustain (threshold) than on VO2max itself.',
  },
  hrv: {
    label: 'HRV', unit: 'ms', better: 1, color: '#58e39a',
    series: well => ({ pts: pick(well, w => w.hrv), note: 'Overnight HRV (rMSSD)', baseline: true }),
    status: (v, u, pts) => { const b = mean(pts.slice(-29, -1).map(p => p.v)); if (!b) return ['', '']; const r = v / b; return r < 0.88 ? ['bad', 'Below baseline'] : r > 1.1 ? ['good', 'Above baseline'] : ['good', 'Normal']; },
    about: 'Compared with your own 4-week baseline. Several days below the band signals fatigue, illness or stress.',
  },
  rhr: {
    label: 'Rest HR', unit: 'bpm', better: 0, color: '#ff5c6c',
    series: well => ({ pts: pick(well, w => w.restingHR), note: 'Morning / overnight resting heart rate', baseline: true }),
    status: (v, u, pts) => { const b = mean(pts.slice(-29, -1).map(p => p.v)); if (!b) return ['', '']; return v > b + 5 ? ['bad', 'Elevated'] : v < b - 3 ? ['good', 'Low'] : ['good', 'Normal']; },
    about: 'An increase of 5+ bpm over your baseline often precedes illness or reflects accumulated fatigue.',
  },
};
export const WIDGETS = ['readiness', 'sleep', 'fitness', 'fatigue', 'form', 'vo2max', 'hrv', 'rhr'];

function latest(pts, maxAgeDays = 4) {
  const p = pts[pts.length - 1];
  if (!p) return null;
  const age = (Date.now() - parseDate(p.date).getTime()) / 86400000;
  return age <= maxAgeDays + 1 ? p : { ...p, stale: true };
}

function spark(pts, color, w = 120, hgt = 32) {
  const p = pts.slice(-14);
  if (p.length < 2) return '';
  const vs = p.map(x => x.v); const mn = Math.min(...vs), mx = Math.max(...vs), r = mx - mn || 1;
  const d = p.map((x, i) => `${i ? 'L' : 'M'}${(i / (p.length - 1) * w).toFixed(1)},${(hgt - 3 - (x.v - mn) / r * (hgt - 6)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${hgt}" class="spark" preserveAspectRatio="none"><path class="draw" pathLength="1" d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function fmtVal(key, v, unit) {
  if (v == null) return '–';
  if (key === 'form') return (v > 0 ? '+' : '') + round(v);
  if (unit === 'h') return round(v, 1) + 'h';
  return key === 'vo2max' ? round(v, 1) : round(v);
}

export function renderWidgets(data, ui) {
  const well = data?.wellness || [];
  const acts = data?.activities || [];
  const grid = h('<div class="widgets"></div>');
  for (const key of WIDGETS) {
    const M = METRICS[key];
    const ser = M.series(well, acts);
    const p = latest(ser.pts, key === 'vo2max' ? 30 : 4);
    const unit = ser.unit || M.unit;
    const st = p ? M.status(p.v, ser.unit, ser.pts, well) : ['', ''];
    const prev7 = mean(ser.pts.slice(-8, -1).map(x => x.v));
    let delta = '';
    if (p && prev7 != null && key !== 'vo2max') {
      const d = p.v - prev7; const good = M.better ? d >= 0 : d <= 0;
      if (Math.abs(d) >= (unit === 'h' ? 0.2 : 1)) delta = `<span class="${good ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${round(Math.abs(d), unit === 'h' ? 1 : 0)}</span>`;
    }
    const sub = key === 'sleep' && ser.sub && ser.sub.length ? `${ser.sub[ser.sub.length - 1].v} h` : unit && unit !== 'h' && key !== 'vo2max' ? unit : '';
    const w = h(`<button class="widget" data-k="${key}" aria-label="${M.label} trend">
      <div class="w-top"><span class="w-label">${M.label}</span>${ser.est ? '<span class="w-tag">est.</span>' : ''}</div>
      <div class="w-val"><span class="v">${p ? fmtVal(key, p.v, unit) : '–'}</span><span class="u">${esc(sub)}</span></div>
      <div class="w-meta"><span class="w-st ${st[0]}">${p ? esc(st[1]) : 'No data'}${p?.stale ? ' · ' + fmtDate(p.date, { day: 'numeric', month: 'short' }) : ''}</span>${delta}</div>
      ${spark(ser.pts, M.color)}
    </button>`);
    w.onclick = () => ui.openTrend(key);
    grid.append(w);
  }
  return grid;
}

// ---- trend page -----------------------------------------------------------
export function renderTrend(key, A, data, ui) {
  const M = METRICS[key];
  const root = h('<div class="stack" style="gap:12px"></div>');
  if (!M) { root.append(h('<div class="empty"><h2>Unknown metric</h2></div>')); return root; }
  const well = data?.wellness || [];
  const ser = M.series(well, data?.activities || []);
  const unit = ser.unit || M.unit;
  const range = ui.trendRange || 30;
  const from = isoDate(addDays(new Date(), -range));
  const pts = ser.pts.filter(p => p.date >= from);
  const vals = pts.map(p => p.v);
  const p = latest(ser.pts, 400);
  const st = p ? M.status(p.v, ser.unit, ser.pts, well) : ['', ''];

  const head = h(`<div class="row between" style="padding:0 2px"><button class="btn ghost" id="back">‹ Back</button><span class="pill">${esc(ser.note)}</span></div>`);
  head.querySelector('#back').onclick = () => ui.closeTrend();
  root.append(head);

  const card = h(`<div class="card hero">
    <div class="card-title">${M.label}${unit && unit !== 'h' ? ' · ' + unit : ''}</div>
    <div class="row between"><div class="big mono" style="color:${M.color}">${p ? fmtVal(key, p.v, unit) : '–'}</div><span class="pill ${st[0]}">${esc(st[1] || '')}</span></div>
    <div class="small muted" style="margin-top:4px">${p ? 'Latest: ' + fmtDate(p.date, { weekday: 'short', day: 'numeric', month: 'short' }) : ''}</div>
    <div class="chips" style="margin:14px 0 6px">${[7, 30, 90, 180].map(r => `<button class="chip ${r === range ? 'on' : ''}" data-r="${r}">${r} d</button>`).join('')}</div>
    <div class="chart-wrap"></div>
    <div class="trend-stats">
      <div class="metric"><div class="v">${vals.length ? fmtVal(key, mean(vals), unit) : '–'}</div><div class="k">Average</div></div>
      <div class="metric"><div class="v">${vals.length ? fmtVal(key, Math.min(...vals), unit) : '–'}</div><div class="k">Low</div></div>
      <div class="metric"><div class="v">${vals.length ? fmtVal(key, Math.max(...vals), unit) : '–'}</div><div class="k">High</div></div>
      <div class="metric"><div class="v">${vals.length > 1 ? changeStr(key, vals, unit, M) : '–'}</div><div class="k">Change</div></div>
    </div>
  </div>`);
  card.querySelectorAll('.chip').forEach(b => b.onclick = () => { ui.trendRange = +b.dataset.r; ui.rerender(); });
  card.querySelector('.chart-wrap').append(trendChart(pts, M, ser, range, key));
  root.append(card);

  if (key === 'sleep' && ser.sub?.length && ser.unit !== 'h') {
    const hrs = ser.sub.filter(x => x.date >= from);
    const c = h(`<div class="card"><div class="card-title">Hours slept</div></div>`);
    c.append(trendChart(hrs, { color: '#9b8cff' }, { unit: 'h' }, range, 'sleepHours'));
    root.append(c);
  }
  if (['fitness', 'fatigue', 'form'].includes(key)) {
    const rel = h('<div class="row" style="gap:8px"></div>');
    ['fitness', 'fatigue', 'form'].filter(k => k !== key).forEach(k => { const b = h(`<button class="btn secondary small" style="flex:1">${METRICS[k].label} ›</button>`); b.onclick = () => ui.openTrend(k); rel.append(b); });
    root.append(rel);
  }
  root.append(h(`<div class="card"><div class="card-title">What it means</div><p class="muted" style="line-height:1.5;font-size:14px">${esc(M.about)}</p></div>`));
  return root;
}

function changeStr(key, vals, unit, M) {
  const d = vals[vals.length - 1] - vals[0];
  const s = (d > 0 ? '+' : d < 0 ? '−' : '') + (unit === 'h' || key === 'vo2max' ? round(Math.abs(d), 1) : round(Math.abs(d)));
  const good = M.better ? d >= 0 : d <= 0;
  return `<span style="color:var(--${Math.abs(d) < 0.5 ? 'text' : good ? 'good' : 'bad'})">${s}</span>`;
}

function trendChart(pts, M, ser, range, key) {
  const W = 460, H = 220, pad = { l: 34, r: 8, t: 10, b: 24 };
  const wrap = h('<div class="trend-chart"></div>');
  if (pts.length < 2) { wrap.append(h('<div class="muted small" style="padding:30px 0;text-align:center">Not enough data in this range.</div>')); return wrap; }
  const t0 = parseDate(isoDate(addDays(new Date(), -range))).getTime(), t1 = parseDate(isoDate(new Date())).getTime();
  const X = d => pad.l + (parseDate(d).getTime() - t0) / (t1 - t0 || 1) * (W - pad.l - pad.r);
  const vs = pts.map(p => p.v);
  let mn = Math.min(...vs), mx = Math.max(...vs);
  if (key === 'form') { mn = Math.min(mn, -35); mx = Math.max(mx, 10); }
  const padY = (mx - mn) * 0.12 || 1; mn -= padY; mx += padY;
  const Y = v => pad.t + (1 - (v - mn) / (mx - mn)) * (H - pad.t - pad.b);
  let svg = '';
  // bands (form zones) and personal baseline band (HRV / RHR)
  for (const [lo, hi, col] of M.bands || []) svg += `<rect x="${pad.l}" width="${W - pad.l - pad.r}" y="${Y(Math.min(hi, mx))}" height="${Math.max(0, Y(Math.max(lo, mn)) - Y(Math.min(hi, mx)))}" fill="${col}"/>`;
  if (ser.baseline && vs.length >= 7) {
    const all = (ser.pts || []).slice(-28).map(p => p.v); const m = mean(all), s = sd(all);
    svg += `<rect x="${pad.l}" width="${W - pad.l - pad.r}" y="${Y(Math.min(mx, m + s))}" height="${Math.max(0, Y(Math.max(mn, m - s)) - Y(Math.min(mx, m + s)))}" fill="rgba(255,255,255,.05)"/><line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(m)}" y2="${Y(m)}" stroke="rgba(255,255,255,.18)" stroke-dasharray="4 4"/>`;
  }
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) { const v = mn + (mx - mn) * i / ticks; svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#20252e"/><text x="${pad.l - 6}" y="${Y(v) + 4}" fill="#5d6678" font-size="11" text-anchor="end">${Math.abs(mx - mn) < 10 ? round(v, 1) : Math.round(v)}</text>`; }
  if (key === 'form') svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="#5d6678"/>`;
  // rolling 7-day average for noisy daily metrics
  if (['readiness', 'sleep', 'hrv', 'rhr', 'sleepHours'].includes(key) && pts.length > 7) {
    const ra = pts.map((p, i) => ({ date: p.date, v: mean(pts.slice(Math.max(0, i - 6), i + 1).map(x => x.v)) }));
    svg += `<path class="draw" pathLength="1" d="${ra.map((p, i) => `${i ? 'L' : 'M'}${X(p.date).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${M.color}" stroke-width="3" opacity=".9"/>`;
    svg += pts.map(p => `<circle cx="${X(p.date).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${range > 90 ? 1.6 : 2.6}" fill="${M.color}" opacity=".45"/>`).join('');
  } else {
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.date).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
    svg += `<path d="${line} L${X(pts[pts.length - 1].date).toFixed(1)},${H - pad.b} L${X(pts[0].date).toFixed(1)},${H - pad.b} Z" fill="${M.color}" opacity=".08"/>`;
    svg += `<path class="draw" pathLength="1" d="${line}" fill="none" stroke="${M.color}" stroke-width="2.5" stroke-linejoin="round"/>`;
    if (pts.length <= 40) svg += pts.map(p => `<circle cx="${X(p.date).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="2.5" fill="${M.color}"/>`).join('');
  }
  const lbl = [0, 0.5, 1].map(f => { const d = isoDate(new Date(t0 + (t1 - t0) * f)); return `<text x="${X(d)}" y="${H - 7}" fill="#5d6678" font-size="11" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${fmtDate(d, { day: 'numeric', month: 'short' })}</text>`; }).join('');
  wrap.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}">${svg}${lbl}<line class="cursor" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" stroke="#9aa3b2" stroke-width="1" visibility="hidden"/></svg><div class="tip" hidden></div>`;
  // tap / hover readout
  const svgEl = wrap.querySelector('svg'), tip = wrap.querySelector('.tip'), cur = wrap.querySelector('.cursor');
  const show = (ev) => {
    const r = svgEl.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width * W;
    let best = pts[0]; for (const p of pts) if (Math.abs(X(p.date) - x) < Math.abs(X(best.date) - x)) best = p;
    cur.setAttribute('x1', X(best.date)); cur.setAttribute('x2', X(best.date)); cur.setAttribute('visibility', 'visible');
    tip.hidden = false; tip.textContent = `${fmtDate(best.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtVal(key, best.v, ser.unit)}`;
  };
  svgEl.addEventListener('pointermove', show); svgEl.addEventListener('pointerdown', show);
  svgEl.addEventListener('pointerleave', () => { tip.hidden = true; cur.setAttribute('visibility', 'hidden'); });
  return wrap;
}
