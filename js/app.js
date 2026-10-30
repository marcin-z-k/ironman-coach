import { load, save, isConfigured, clearAll } from './store.js';
import { fetchAll, cached, thresholdsFromAthlete } from './icu.js';
import { buildZoneModel, setZoneModel } from './zones.js';
import { estimateAll, proposeUpdates } from './thresholds.js';
import { renderTrend } from './health.js';
import { analyse } from './adapt.js';
import { renderToday, renderPlan, renderActivities, renderProgress, renderSettings, renderSetup } from './ui.js';
import { isoDate } from './util.js';

const view = document.getElementById('view');
const syncStatus = document.getElementById('syncStatus');
const btnRefresh = document.getElementById('btnRefresh');
const TABS = ['today', 'plan', 'activities', 'progress', 'settings'];

const ui = {
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today',
  trendRange: 30,
  selectedDate: null,
  openWeeks: new Set(), openWeeksTouched: false,
  openActs: new Set(),
  rerender: () => render(),
  setTab: (t) => setTab(t),
  confirm: (msg) => window.confirm ? safeConfirm(msg) : true,
  reset: () => { clearAll(); data = null; A = null; setTab('settings'); toast('Local data cleared'); },
};
let data = cached();
if (data?.athlete) setZoneModel(buildZoneModel(data.athlete));
ui.pending = [];
ui.applyPending = () => { applyUpdates(ui.pending, 'activity estimate'); ui.pending = []; A = null; render(); };
let A = null;
let syncing = false;

function safeConfirm(msg) { try { return window.confirm(msg); } catch { return true; } }

function toast(msg, bad = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, bad ? 6000 : 2500);
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
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  view.innerHTML = '';
  const trendKey = location.hash.startsWith('#trend-') ? location.hash.slice(7) : null;
  if (trendKey && isConfigured()) { if (!A) compute(); view.append(renderTrend(trendKey, A, data, ui)); updateStatus(); return; }
  if (!isConfigured() && ui.tab !== 'settings') {
    view.append(renderSetup(() => { save({ demo: true }); sync(); }));
    view.append(renderSettings(ui, onSave));
    return;
  }
  if (!A) compute();
  ui.data = data;
  let node;
  switch (ui.tab) {
    case 'plan': node = renderPlan(A, ui); break;
    case 'activities': node = renderActivities(A, ui, data); break;
    case 'progress': node = renderProgress(A, ui, data); break;
    case 'settings': node = renderSettings(ui, onSave); break;
    default: node = renderToday(A, ui);
  }
  view.append(node);
  updateStatus();
}

function updateStatus() {
  if (syncing) { syncStatus.textContent = 'Syncing…'; return; }
  if (!data?.fetchedAt) { syncStatus.textContent = ''; return; }
  const mins = Math.round((Date.now() - data.fetchedAt) / 60000);
  syncStatus.textContent = (data.demo ? 'Demo · ' : '') + (mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`);
}

function onSave() { A = null; toast('Saved'); sync().then(() => { if (isConfigured()) setTab('today'); }); }

function applyUpdates(list, source) {
  if (!list.length) return;
  const s = load();
  const patch = {}; const log = [...(s.thresholdLog || [])];
  for (const u of list) { patch[u.field] = u.to; log.unshift({ date: isoDate(new Date()), field: u.field, from: u.from, to: u.to, source: u.source || source, detail: u.methods || '' }); }
  save({ ...patch, thresholdLog: log.slice(0, 40) });
  const lbl = { ftp: 'FTP', runThreshold: 'run threshold', css: 'CSS' };
  toast(`Updated ${list.map(u => lbl[u.field]).join(', ')} (${source})`);
}

function updateThresholds() {
  const s = load();
  const mode = s.thresholdSource || 'auto';
  // 1) Values set in intervals.icu (e.g. after a test). In 'intervals' mode always follow them;
  //    in 'auto'/'suggest' adopt them only when they changed since the last sync.
  const icu = data?.athlete ? thresholdsFromAthlete(data.athlete) : {};
  const icuChanges = [];
  for (const k of ['ftp', 'runThreshold', 'css']) {
    if (!icu[k]) continue;
    const changedInIcu = !s.lastIcu || (s.lastIcu[k] && s.lastIcu[k] !== icu[k]); // first sync seeds from intervals.icu
    if ((mode === 'intervals' || changedInIcu) && icu[k] !== s[k]) icuChanges.push({ field: k, from: s[k], to: icu[k], source: 'intervals.icu settings' });
  }
  save({ lastIcu: icu });
  if (mode !== 'manual') applyUpdates(icuChanges, 'intervals.icu settings');
  if (mode === 'intervals' || mode === 'manual' || data?.demo && false) return;
  // 2) Estimates from recent activities
  const est = estimateAll(data.activities || [], load(), isoDate(new Date()));
  const props = proposeUpdates(est, load()).filter(p => !icuChanges.some(c => c.field === p.field));
  if (mode === 'auto') applyUpdates(props, 'activity estimate');
  else ui.pending = props;
}

async function sync() {
  if (!isConfigured() || syncing) { render(); return; }
  syncing = true; btnRefresh.classList.add('spin'); updateStatus();
  try {
    data = await fetchAll({ days: 120 });
    setZoneModel(buildZoneModel(data.athlete));
    updateThresholds();
    A = null;
  } catch (e) {
    const s = load();
    let msg = e.message;
    if (e.status === 401 || e.status === 403) msg = 'intervals.icu rejected the credentials — check athlete ID (starts with "i") and API key.';
    else if (e instanceof TypeError) msg = 'Could not reach intervals.icu from the browser (network or CORS). Try again, or set a CORS proxy in Settings → Advanced.';
    toast(msg, true);
    console.warn(e);
    if (!data && !s.demo) data = null;
  } finally {
    syncing = false; btnRefresh.classList.remove('spin');
    render();
  }
}

document.querySelectorAll('.tab').forEach(b => b.onclick = () => setTab(b.dataset.tab));
btnRefresh.onclick = () => sync();
window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t.startsWith('trend-')) { render(); window.scrollTo({ top: 0 }); return; } if (TABS.includes(t)) { if (t !== ui.tab) setTab(t); else render(); } });
ui.openTrend = (k) => { location.hash = 'trend-' + k; };
ui.closeTrend = () => { history.length > 1 && location.hash.startsWith('#trend-') ? history.back() : setTab('today'); };
document.addEventListener('visibilitychange', () => { if (!document.hidden && data?.fetchedAt && Date.now() - data.fetchedAt > 30 * 60000) sync(); });

if (location.hash.startsWith('#trend-')) render(); else setTab(ui.tab);
if (isConfigured() && (!data || Date.now() - (data.fetchedAt || 0) > 10 * 60000)) sync();
