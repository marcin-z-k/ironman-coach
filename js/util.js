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
export function fmtPace(secKm) { if (!secKm || !isFinite(secKm)) return '–'; const m = Math.floor(secKm / 60), s = Math.round(secKm % 60); return `${m}:${String(s).padStart(2, '0')}/km`; }
export function fmtPace100(sec) { if (!sec || !isFinite(sec)) return '–'; const m = Math.floor(sec / 60), s = Math.round(sec % 60); return `${m}:${String(s).padStart(2, '0')}/100m`; }
export function fmtKm(m) { return m == null ? '–' : `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km`; }
export function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) { return parseDate(iso).toLocaleDateString('en-GB', opts); }
export function paceToStr(secKm) { const m = Math.floor(secKm / 60), s = Math.round(secKm % 60); return `${m}:${String(s).padStart(2, '0')}`; }
export function strToPace(str) { const [m, s = 0] = String(str).split(':').map(Number); return (m || 0) * 60 + (s || 0); }
export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
export function round(v, d = 0) { const p = 10 ** d; return Math.round(v * p) / p; }
export function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export const SPORT_LABEL = { swim: 'Swim', bike: 'Bike', run: 'Run', strength: 'Strength', rest: 'Rest', brick: 'Brick', other: 'Other' };
export function sportIcon(sport) {
  switch (sport) {
    case 'swim': return '<svg viewBox="0 0 24 24"><path d="M2 17c1.5 0 2.5 1 4 1s2.5-1 4-1 2.5 1 4 1 2.5-1 4-1 2.5 1 4 1v2c-1.5 0-2.5-1-4-1s-2.5 1-4 1-2.5-1-4-1-2.5 1-4 1-2.5-1-4-1zm14.5-9a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM3 14l5.5-6 4 3.5 2.5-1.6 1.1 1.7-3.9 2.5-3.3-2.9L5 14z"/></svg>';
    case 'bike': return '<svg viewBox="0 0 24 24"><path d="M5.5 12a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm0 7a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zm13-7a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm0 7a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM15 5h3V3h-4l-3 6H8V7H5v2h1.5l1.6 2.6L10.5 9h2.3l1.3 3.5 1.8-.7L14.7 8z"/></svg>';
    case 'run': return '<svg viewBox="0 0 24 24"><path d="M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3a7.2 7.2 0 0 0 5.5 2.5v-2a5.2 5.2 0 0 1-4.5-2.5l-1-1.6a2 2 0 0 0-1.7-.9c-.3 0-.5 0-.8.1L6 8.3V13h2V9.6z"/></svg>';
    case 'strength': return '<svg viewBox="0 0 24 24"><path d="M20.6 8.6 22 7.2 20.8 6l-1.4 1.4-1.4-1.4-1.4 1.4-4.3-4.3-1.4 1.4L12.3 6 6 12.3l-1.4-1.4L3.2 12.3l1.4 1.4-1.4 1.4L4.6 16.5l1.4-1.4 1.4 1.4 1.4-1.4 4.3 4.3 1.4-1.4-1.4-1.4 6.3-6.3 1.4 1.4 1.4-1.4z"/></svg>';
    case 'rest': return '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c0-.5 0-.9-.1-1.3A6.5 6.5 0 0 1 10.3 3.1C10.9 3 11.4 3 12 3z"/></svg>';
    case 'brick': return '<svg viewBox="0 0 24 24"><path d="M3 5h8v6H3zm10 0h8v6h-8zM3 13h8v6H3zm10 0h8v6h-8z"/></svg>';
    default: return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>';
  }
}
