// Reusable SVG charts with crosshair + tooltip that lists every series at the hovered date.
import { el, esc, fmtDate, parseDate, isoDate, round } from './util.js';

const DAY = 86400000;
const t = iso => parseDate(iso).getTime();

/**
 * lineChart({
 *   series: [{ name, color, pts: [{x: iso, y}], futureFrom?: iso, area?: bool, width?: n, dash?: bool, fmt?: v=>str }],
 *   height, yFmt, invert (lower value drawn higher), bands: [{y0, y1, color, label}], zero: bool,
 *   markers: [{x: iso, label, color}], today: iso, xRange: [iso, iso], yMin, yMax
 * })
 */
export function lineChart(o) {
  const W = 460, H = o.height || 220, pad = { l: 38, r: 10, t: 14, b: 24 };
  const wrap = el('<div class="lc"></div>');
  const all = o.series.flatMap(s => s.pts);
  if (all.length < 2) { wrap.append(el('<div class="muted small" style="padding:30px 0;text-align:center">Not enough data yet.</div>')); return wrap; }
  const xs = all.map(p => t(p.x));
  const x0 = o.xRange ? t(o.xRange[0]) : Math.min(...xs), x1 = o.xRange ? t(o.xRange[1]) : Math.max(...xs);
  const ys = all.map(p => p.y).concat((o.bands || []).flatMap(b => [b.y0, b.y1]).filter(v => v != null && isFinite(v)));
  let mn = o.yMin ?? Math.min(...ys), mx = o.yMax ?? Math.max(...ys);
  if (o.zero) { mn = Math.min(mn, 0); mx = Math.max(mx, 0); }
  const padY = (mx - mn) * 0.1 || 1; if (o.yMin == null) mn -= padY; if (o.yMax == null) mx += padY;
  const X = ms => pad.l + (ms - x0) / ((x1 - x0) || 1) * (W - pad.l - pad.r);
  const Y = v => { const f = (v - mn) / (mx - mn); return pad.t + (o.invert ? f : 1 - f) * (H - pad.t - pad.b); };
  const fmt = o.yFmt || (v => String(round(v, Math.abs(mx - mn) < 10 ? 1 : 0)));
  let svg = '';
  for (const b of o.bands || []) {
    const ya = Y(Math.max(mn, Math.min(mx, b.y0))), yb = Y(Math.max(mn, Math.min(mx, b.y1)));
    svg += `<rect x="${pad.l}" width="${W - pad.l - pad.r}" y="${Math.min(ya, yb)}" height="${Math.abs(yb - ya)}" fill="${b.color}"/>`;
    if (b.label) svg += `<text x="${W - pad.r - 4}" y="${Math.min(ya, yb) + 12}" fill="#5d6678" font-size="10" text-anchor="end">${esc(b.label)}</text>`;
  }
  for (let i = 0; i <= 4; i++) { const v = mn + (mx - mn) * i / 4; svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#20252e"/><text x="${pad.l - 6}" y="${Y(v) + 4}" fill="#5d6678" font-size="11" text-anchor="end">${esc(fmt(v))}</text>`; }
  if (o.zero && mn < 0) svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="#4a5262"/>`;
  if (o.today && t(o.today) >= x0 && t(o.today) <= x1) svg += `<line x1="${X(t(o.today))}" x2="${X(t(o.today))}" y1="${pad.t}" y2="${H - pad.b}" stroke="#9aa3b2" stroke-dasharray="2 3" opacity=".6"/><text x="${X(t(o.today)) + 4}" y="${pad.t + 10}" fill="#9aa3b2" font-size="10">today</text>`;
  for (const m of o.markers || []) { const mxp = X(t(m.x)); svg += `<line x1="${mxp}" x2="${mxp}" y1="${pad.t}" y2="${H - pad.b}" stroke="${m.color || '#ff6a3d'}" stroke-width="1.5"/><text x="${mxp - 4}" y="${pad.t + 10}" fill="${m.color || '#ff6a3d'}" font-size="10" text-anchor="end" font-weight="700">${esc(m.label)}</text>`; }
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${X(t(p.x)).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  for (const s of o.series) {
    const pts = s.pts.filter(p => p.y != null && isFinite(p.y)).sort((a, b) => a.x.localeCompare(b.x));
    if (pts.length < 2) continue;
    const past = s.futureFrom ? pts.filter(p => p.x <= s.futureFrom) : pts;
    const fut = s.futureFrom ? pts.filter(p => p.x >= s.futureFrom) : [];
    if (s.area && past.length > 1) svg += `<path class="fadein" d="${path(past)} L${X(t(past[past.length - 1].x))},${Y(Math.max(mn, Math.min(mx, 0 > mn ? 0 : mn)))} L${X(t(past[0].x))},${Y(Math.max(mn, Math.min(mx, 0 > mn ? 0 : mn)))} Z" fill="${s.color}" opacity=".1"/>`;
    if (past.length > 1) svg += `<path class="${s.dash ? 'fadein' : 'draw'}" pathLength="1" d="${path(past)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.2}" ${s.dash ? 'stroke-dasharray="4 3"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
    if (fut.length > 1) svg += `<path class="fadein" d="${path(fut)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.2}" stroke-dasharray="5 4" opacity=".75"/>`;
    if (s.dots) svg += pts.map(p => `<circle cx="${X(t(p.x)).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.6" fill="${s.color}"/>`).join('');
  }
  const lbl = [0, 0.5, 1].map(f => { const ms = x0 + (x1 - x0) * f; return `<text x="${X(ms)}" y="${H - 7}" fill="#5d6678" font-size="11" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${fmtDate(isoDate(new Date(ms)), { day: 'numeric', month: 'short' })}</text>`; }).join('');
  wrap.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}">${svg}${lbl}<g class="hover" visibility="hidden"><line class="cx" y1="${pad.t}" y2="${H - pad.b}" stroke="#cfd5df" stroke-width="1"/>${o.series.map((s, i) => `<circle class="cd" data-i="${i}" r="4" fill="${s.color}" stroke="#0b0d11" stroke-width="2"/>`).join('')}</g></svg><div class="tip" hidden></div>`;
  const svgEl = wrap.querySelector('svg'), tip = wrap.querySelector('.tip'), g = wrap.querySelector('.hover');
  const nearest = (pts, ms) => { let best = null, bd = Infinity; for (const p of pts) { const d = Math.abs(t(p.x) - ms); if (d < bd) { bd = d; best = p; } } return bd <= 3.5 * DAY ? best : null; };
  const show = (ev) => {
    const r = svgEl.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width * W;
    const ms = Math.max(x0, Math.min(x1, x0 + (px - pad.l) / (W - pad.l - pad.r) * (x1 - x0)));
    // snap to the nearest actual point of the first series that has one
    let snap = null; for (const s of o.series) { const n = nearest(s.pts, ms); if (n && (!snap || Math.abs(t(n.x) - ms) < Math.abs(t(snap.x) - ms))) snap = n; }
    if (!snap) return;
    const sx = X(t(snap.x));
    g.setAttribute('visibility', 'visible');
    g.querySelector('.cx').setAttribute('x1', sx); g.querySelector('.cx').setAttribute('x2', sx);
    const rows = [];
    o.series.forEach((s, i) => {
      const n = s.pts.find(p => p.x === snap.x) || nearest(s.pts, t(snap.x));
      const c = g.querySelector(`.cd[data-i="${i}"]`);
      if (n && Math.abs(t(n.x) - t(snap.x)) < 1.5 * DAY) { c.setAttribute('cx', X(t(n.x))); c.setAttribute('cy', Y(n.y)); c.setAttribute('visibility', 'visible'); rows.push(`<div class="tr"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}<b>${esc((s.fmt || fmt)(n.y))}</b></div>`); }
      else c.setAttribute('visibility', 'hidden');
    });
    const future = o.series.some(s => s.futureFrom && snap.x > s.futureFrom);
    tip.innerHTML = `<div class="th">${fmtDate(snap.x, { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' })}${future ? ' · planned' : ''}</div>${rows.join('')}`;
    tip.hidden = false;
    const left = sx / W * r.width;
    tip.style.left = Math.min(Math.max(0, left - tip.offsetWidth / 2), r.width - tip.offsetWidth) + 'px';
  };
  svgEl.addEventListener('pointermove', show);
  svgEl.addEventListener('pointerdown', show);
  svgEl.addEventListener('pointerleave', () => { tip.hidden = true; g.setAttribute('visibility', 'hidden'); });
  return wrap;
}

/** barChart({ cats: [{label, title}], series: [{name, color, values, colors?}], height, yFmt, dim: idx=>bool }) */
export function barChart(o) {
  const W = 460, H = o.height || 170, pad = { l: 30, r: 6, t: 10, b: 22 };
  const wrap = el('<div class="lc"></div>');
  const n = o.cats.length, k = o.series.length;
  const mx = Math.max(1, ...o.series.flatMap(s => s.values)) * 1.1;
  const slot = (W - pad.l - pad.r) / n, bw = Math.min(10, slot / (k + 1));
  const Y = v => pad.t + (1 - v / mx) * (H - pad.t - pad.b);
  const fmt = o.yFmt || (v => String(round(v, 1)));
  let svg = '';
  for (let i = 0; i <= 3; i++) { const v = mx * i / 3; svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#20252e"/><text x="${pad.l - 5}" y="${Y(v) + 4}" fill="#5d6678" font-size="10" text-anchor="end">${esc(fmt(v))}</text>`; }
  o.cats.forEach((c, i) => {
    const cx = pad.l + slot * i + slot / 2;
    o.series.forEach((s, j) => {
      const v = s.values[i] || 0, x = cx - (k * bw + (k - 1) * 2) / 2 + j * (bw + 2);
      const col = s.colors?.[i] || s.color;
      svg += `<rect class="grow" style="animation-delay:${i * 25}ms" x="${x.toFixed(1)}" y="${Y(v).toFixed(1)}" width="${bw}" height="${Math.max(0, H - pad.b - Y(v)).toFixed(1)}" rx="2.5" fill="${col}" opacity="${o.dim?.(i) && j > 0 ? .25 : 1}"/>`;
    });
    if (n <= 16 || i % 2 === 0) svg += `<text x="${cx}" y="${H - 7}" fill="#5d6678" font-size="10" text-anchor="middle">${esc(c.label)}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${pad.l + slot * i}" y="${pad.t}" width="${slot}" height="${H - pad.t - pad.b}" fill="transparent"/>`;
  });
  wrap.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}">${svg}<rect class="hl" y="${pad.t}" height="${H - pad.t - pad.b}" width="${slot}" fill="rgba(255,255,255,.05)" visibility="hidden"/></svg><div class="tip" hidden></div>`;
  const svgEl = wrap.querySelector('svg'), tip = wrap.querySelector('.tip'), hl = wrap.querySelector('.hl');
  const show = (i) => {
    const c = o.cats[i];
    hl.setAttribute('x', pad.l + slot * i); hl.setAttribute('visibility', 'visible');
    tip.innerHTML = `<div class="th">${esc(c.title || c.label)}</div>${o.series.map(s => `<div class="tr"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}<b>${esc(fmt(s.values[i] || 0))}</b></div>`).join('')}`;
    tip.hidden = false;
    const r = svgEl.getBoundingClientRect();
    const left = (pad.l + slot * (i + 0.5)) / W * r.width;
    tip.style.left = Math.min(Math.max(0, left - tip.offsetWidth / 2), r.width - tip.offsetWidth) + 'px';
  };
  svgEl.addEventListener('pointermove', (ev) => { const r = svgEl.getBoundingClientRect(); const px = (ev.clientX - r.left) / r.width * W; const i = Math.floor((px - pad.l) / slot); if (i >= 0 && i < n) show(i); });
  svgEl.addEventListener('pointerdown', (ev) => svgEl.dispatchEvent(new PointerEvent('pointermove', ev)));
  svgEl.addEventListener('pointerleave', () => { tip.hidden = true; hl.setAttribute('visibility', 'hidden'); });
  return wrap;
}
