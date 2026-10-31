import { load, save, isConfigured, clearAll, restoreCredentials, backupCredentials, rememberInPasswordManager } from './store.js';
import { fetchAll, cached, thresholdsFromAthlete, pushEvents } from './icu.js';
import { buildZoneModel, setZoneModel } from './zones.js';
import { estimateAll, proposeUpdates } from './thresholds.js';
import { renderTrend } from './health.js';
import { analyse } from './adapt.js';
import { swapDays } from './schedule.js';
import { renderToday, renderPlan, renderActivities, renderProgress, renderSettings, renderSetup } from './ui.js';
import { exportFit, exportZwo, icuEvent } from './export.js';
import { isoDate, addDays } from './util.js';
import { prefetch } from './streams.js';
import { renderFuelSheet } from './ui.js';

const view = document.getElementById('view');
const syncStatus = document.getElementById('syncStatus');
const btnRefresh = document.getElementById('btnRefresh');
const TABS = ['today', 'plan', 'activities', 'progress', 'settings'];
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let data = cached();
setZoneModel(buildZoneModel(data?.athlete || null));
let A = null;
let syncing = false;
let keepScrollY = null;

const sheet = document.getElementById('sheet');
const sheetPanel = sheet.querySelector('.sheet-panel');
function openSheet(node) {
  sheetPanel.innerHTML = ''; sheetPanel.append(node); sheetPanel.scrollTop = 0;
  sheet.hidden = false; document.body.classList.add('noscroll');
  requestAnimationFrame(() => sheet.classList.add('open'));
}
function closeSheet(instant) {
  sheet.classList.remove('open'); document.body.classList.remove('noscroll');
  if (instant) { sheet.hidden = true; return; }
  setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 320);
}
sheet.querySelector('.sheet-backdrop').onclick = () => closeSheet();
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

// Load HR/speed streams of recent runs in the background (for the Z2 easy-pace chart and predictor).
let streamsBusy = false;
async function loadRunStreams() {
  if (streamsBusy || !data?.activities) return;
  const from = isoDate(addDays(new Date(), -140));
  const runs = data.activities.filter(a => a.sport === 'run' && a.date >= from && a.avgHr && a.movingSec >= 1200);
  if (!runs.length) return;
  streamsBusy = true;
  try {
    await prefetch(runs, (d, n) => { ui.streamsLoading = d < n ? `${d}/${n}` : null; if (ui.tab === 'progress' && (d === n || d % 5 === 0)) { ui.keepScroll(); render(); } });
  } finally { streamsBusy = false; ui.streamsLoading = null; A = null; if (sheet.hidden) { ui.keepScroll(); render(); } }
}

const ui = {
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today',
  trendRange: 30, selectedDate: null,
  openWeeks: new Set(), openWeeksTouched: false, openSess: new Set(), openActs: new Set(),
  pending: [],
  openSheet, closeSheet,
  rerender: () => render(),
  invalidate: () => { A = null; render(); },
  keepScroll: () => { keepScrollY = window.scrollY; },
  setTab: (t) => setTab(t),
  toast: (m, bad) => toast(m, bad),
  confirm: (msg) => { try { return window.confirm(msg); } catch { return true; } },
  reset: () => { clearAll(); data = null; A = null; setTab('settings'); toast('Local data cleared'); },
  applyPending: () => { applyUpdates(ui.pending, 'activity estimate'); ui.pending = []; A = null; render(); },
  openTrend: (k) => { location.hash = 'trend-' + k; },
  closeTrend: () => { history.length > 1 && location.hash.startsWith('#trend-') ? history.back() : setTab('today'); },
  swap: (week, a, b) => {
    const s = load();
    save({ moves: swapDays(week, a, b, A.matches, s.moves || {}) });
    toast('Days swapped'); ui.keepScroll(); A = null; render();
  },
  undoMove: (x) => { const m = { ...(load().moves || {}) }; delete m[x.id]; save({ moves: m }); ui.keepScroll(); A = null; render(); },
  exportFit: async (x, btn) => {
    const t = btn.textContent; btn.textContent = '…';
    try { await exportFit(x); } catch (e) { toast('FIT export failed: ' + e.message, true); } finally { btn.textContent = t; }
  },
  exportZwo: (x) => { try { exportZwo(x); } catch (e) { toast('ZWO export failed: ' + e.message, true); } },
  send: async (list, btn) => {
    if (!list.length) { toast('Nothing left to send this week'); return; }
    const t = btn.textContent; btn.textContent = 'Sending…'; btn.disabled = true;
    try {
      await pushEvents(list.map(icuEvent));
      toast(`${list.length} workout${list.length > 1 ? 's' : ''} sent to your intervals.icu calendar${load().demo ? ' (demo)' : ''} — it syncs them to your connected devices`);
    } catch (e) {
      toast(e.status === 403 ? 'intervals.icu refused the write — check the API key' : `Send failed: ${e.message}`, true);
    } finally { btn.textContent = t; btn.disabled = false; }
  },
};

function toast(msg, bad = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, bad ? 6000 : 3000);
}

function compute() {
  const s = load();
  if (!s.planStart) save({ planStart: isoDate(new Date()) });
  A = analyse(load(), data || { activities: [], wellness: [] });
}

function setTab(t) {
  ui.tab = t;
  if (location.hash.slice(1) !== t) history.replaceState(null, '', '#' + t);
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  keepScrollY = null;
  render();
  window.scrollTo({ top: 0 });
}

function animate(node, fresh) {
  if (reduceMotion) { node.querySelectorAll('[data-count]').forEach(e => e.textContent = e.dataset.count); return; }
  if (fresh) [...node.children].forEach((c, i) => { c.classList.add('rise'); c.style.setProperty('--i', Math.min(i, 12)); });
  node.querySelectorAll('.widget').forEach((w, i) => { w.classList.add('rise'); w.style.setProperty('--i', i + 2); });
  node.querySelectorAll('[data-count]').forEach(e => {
    const to = +e.dataset.count; if (!isFinite(to)) return;
    const t0 = performance.now(), dur = 900;
    const step = (now) => { const f = Math.min(1, (now - t0) / dur); const v = Math.round(to * (1 - Math.pow(1 - f, 3))); e.textContent = v; if (f < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

function render() {
  const fresh = keepScrollY == null;
  view.innerHTML = '';
  const trendKey = location.hash.startsWith('#trend-') ? location.hash.slice(7) : null;
  let node;
  if (trendKey && isConfigured()) { if (!A) compute(); node = renderTrend(trendKey, A, data, ui); }
  else if (!isConfigured()) {
    node = renderSetup(() => { save({ demo: true }); sync(); }, (id, key) => { save({ athleteId: id, apiKey: key, demo: false }); toast('Connecting…'); sync(true); });
  } else {
    if (!A) compute();
    ui.data = data;
    switch (ui.tab) {
      case 'plan': node = renderPlan(A, ui); break;
      case 'activities': node = renderActivities(A, ui, data); break;
      case 'progress': node = renderProgress(A, ui, data); break;
      case 'settings': node = renderSettings(ui, onSave); break;
      default: node = renderToday(A, ui);
    }
  }
  view.append(node);
  animate(node, fresh);
  if (keepScrollY != null) { window.scrollTo({ top: keepScrollY }); keepScrollY = null; }
  updateStatus();
}

function updateStatus() {
  if (syncing) { syncStatus.textContent = 'Syncing…'; return; }
  if (!data?.fetchedAt) { syncStatus.textContent = ''; return; }
  const mins = Math.round((Date.now() - data.fetchedAt) / 60000);
  syncStatus.textContent = (data.demo ? 'Demo · ' : '') + (mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`);
}

function onSave() { A = null; toast('Saved'); sync(true).then(() => { if (isConfigured()) setTab('today'); }); }

function applyUpdates(list, source) {
  if (!list.length) return;
  const s = load();
  const patch = {}; const log = [...(s.thresholdLog || [])];
  for (const u of list) { patch[u.field] = u.to; log.unshift({ date: isoDate(new Date()), field: u.field, from: u.from, to: u.to, source: u.source || source, detail: u.methods || '' }); }
  save({ ...patch, thresholdLog: log.slice(0, 40) });
  const lbl = { ftp: 'indoor FTP', ftpOutdoor: 'outdoor FTP', runThreshold: 'run threshold', css: 'CSS' };
  toast(`Updated ${list.map(u => lbl[u.field]).join(', ')} (${source})`);
}

function updateThresholds() {
  const s = load();
  const mode = s.thresholdSource || 'auto';
  const todayIso = isoDate(new Date());
  const held = k => s.holds?.[k] && s.holds[k] >= todayIso;
  // 1) values from intervals.icu sport settings: follow always in 'intervals' mode, otherwise only when they
  //    changed there (e.g. after a test). Values you typed in Settings are held for 4 weeks.
  const icu = data?.athlete ? thresholdsFromAthlete(data.athlete) : {};
  const icuChanges = [];
  for (const k of ['ftp', 'ftpOutdoor', 'runThreshold', 'css']) {
    if (!icu[k] || (held(k) && mode !== 'intervals')) continue;
    const changedInIcu = !s.lastIcu || (s.lastIcu[k] && s.lastIcu[k] !== icu[k]);
    if ((mode === 'intervals' || changedInIcu) && icu[k] !== s[k]) icuChanges.push({ field: k, from: s[k], to: icu[k], source: 'intervals.icu settings' });
  }
  save({ lastIcu: icu });
  if (mode !== 'manual') applyUpdates(icuChanges, 'intervals.icu settings');
  if (mode === 'intervals' || mode === 'manual') return;
  // 2) estimates from recent activities (respecting holds)
  const est = estimateAll(data.activities || [], load(), todayIso);
  const props = proposeUpdates(est, load(), todayIso).filter(p => !icuChanges.some(c => c.field === p.field));
  if (mode === 'auto') applyUpdates(props, 'activity estimate');
  else ui.pending = props;
}

async function sync(fromLogin = false) {
  if (!isConfigured() || syncing) { render(); return; }
  syncing = true; btnRefresh.classList.add('spin'); updateStatus();
  try {
    data = await fetchAll({ days: 150 });
    setZoneModel(buildZoneModel(data.athlete));
    updateThresholds();
    loadRunStreams();
    A = null;
    if (!load().demo) { backupCredentials(); if (fromLogin) rememberInPasswordManager(); }
  } catch (e) {
    let msg = e.message;
    if (e.status === 401 || e.status === 403) msg = 'intervals.icu rejected the credentials — check athlete ID (starts with "i") and API key.';
    else if (e instanceof TypeError) msg = 'Could not reach intervals.icu from the browser (network or CORS). Try again, or set a CORS proxy in Settings → Advanced.';
    toast(msg, true);
    console.warn(e);
  } finally {
    syncing = false; btnRefresh.classList.remove('spin');
    render();
  }
}

document.querySelectorAll('.tab').forEach(b => b.onclick = () => setTab(b.dataset.tab));
btnRefresh.onclick = () => sync();
document.getElementById('btnFuel').onclick = () => openSheet(renderFuelSheet(ui));
window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t.startsWith('trend-')) { keepScrollY = null; render(); window.scrollTo({ top: 0 }); return; } if (TABS.includes(t)) { if (t !== ui.tab) setTab(t); else render(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && data?.fetchedAt && Date.now() - data.fetchedAt > 30 * 60000) sync(); });

(async function boot() {
  if (location.hash.startsWith('#trend-')) render(); else setTab(ui.tab);
  const restored = await restoreCredentials();
  if (restored) { toast('Signed in'); render(); }
  if (isConfigured()) { backupCredentials(); if (!data || restored || Date.now() - (data.fetchedAt || 0) > 10 * 60000) sync(); else loadRunStreams(); }
})();
