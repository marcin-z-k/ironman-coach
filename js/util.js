export function isoDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear(), m = String(x.getMonth() + 1).padStart(2, '0'), day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parseDate(iso) { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(d, n) { const x = new Date(d instanceof Date ? d.getTime() : parseDate(d).getTime()); x.setDate(x.getDate() + n); return x; }
export function daysBetween(a, b) { return Math.round((parseDate(isoDate(b)) - parseDate(isoDate(a))) / 86400000); }
export function startOfWeek(d) { const x = new Date(d instanceof Date ? d : parseDate(d)); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); x.setHours(0, 0, 0, 0); return x; } // Monday
export function today() { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }

export function fmtDur(min) {
  if (min == null) return '–';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h && m) return `${h}h ${String(m).padStart(2, '0')}`;
  if (h) return `${h}h`;
  return `${m} min`;
}
export function fmtSec(sec) {
  if (sec == null) return '–';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtPace(secKm) { if (!secKm || !isFinite(secKm)) return '–'; return `${paceToStr(secKm)}/km`; }
export function fmtPace100(sec) { if (!sec || !isFinite(sec)) return '–'; return `${paceToStr(sec)}/100m`; }
export function fmtKm(m) { return m == null ? '–' : `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km`; }
export function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) { return parseDate(iso).toLocaleDateString('en-GB', opts); }
export function paceToStr(secKm) { const t = Math.round(secKm); const m = Math.floor(t / 60), s = t % 60; return `${m}:${String(s).padStart(2, '0')}`; }
export function strToPace(str) { const [m, s = 0] = String(str).split(':').map(Number); return (m || 0) * 60 + (s || 0); }
export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
export function round(v, d = 0) { const p = 10 ** d; return Math.round(v * p) / p; }
export function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export const SPORT_LABEL = { swim: 'Swim', bike: 'Bike', run: 'Run', strength: 'Strength', rest: 'Rest', brick: 'Brick', other: 'Other' };
export function sportIcon(sport) {
  const S = (inner) => `<svg viewBox="0 0 24 24" class="sico" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  switch (sport) {
    case 'swim': return S('<circle cx="17" cy="6.5" r="1.8"/><path d="M4 12.5l4.2-3.4 3.3 2.6 4.2-1.9"/><path d="M2.5 17c1.4 0 2-.9 3.3-.9s1.9.9 3.3.9 2-.9 3.3-.9 1.9.9 3.3.9 2-.9 3.3-.9 1.9.9 3 .9"/><path d="M2.5 20.5c1.4 0 2-.9 3.3-.9s1.9.9 3.3.9 2-.9 3.3-.9 1.9.9 3.3.9 2-.9 3.3-.9 1.9.9 3 .9" opacity=".55"/>');
    case 'bike': return S('<circle cx="5.5" cy="16.5" r="3.6"/><circle cx="18.5" cy="16.5" r="3.6"/><path d="M5.5 16.5l3.6-7h6.6l2.8 7"/><path d="M9.1 9.5l3.4 7h-7"/><path d="M12.5 16.5l3.2-7"/><path d="M7.6 6.8h3.2"/><path d="M15.7 9.5l-.9-3.1h2.6"/>');
    case 'run': return S('<circle cx="15.5" cy="4.3" r="1.9"/><path d="M13.6 8.2l-2.6 5 3.4 2.6-1.4 5.4"/><path d="M11 13.2l-2.6 2.6H4.8"/><path d="M8.6 9.6l2.7-1.6 2.3.2 2.2 3 2.9.7"/>');
    case 'strength': return S('<path d="M6 7v10M18 7v10M3.5 9.5v5M20.5 9.5v5M6 12h12"/>');
    case 'rest': return S('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>');
    case 'brick': return S('<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>');
    default: return S('<circle cx="12" cy="12" r="6"/>');
  }
}
