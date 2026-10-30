import { load, save, isConfigured, clearAll } from './store.js';
import { fetchAll, cached, thresholdsFromAthlete } from './icu.js';
import { analyse } from './adapt.js';
import { renderToday, renderPlan, renderActivities, renderProgress, renderSettings, renderSetup } from './ui.js';
import { isoDate } from './util.js';

const view = document.getElementById('view');
const syncStatus = document.getElementById('syncStatus');
const btnRefresh = document.getElementById('btnRefresh');
const TABS = ['today', 'plan', 'activities', 'progress', 'settings'];

const ui = {
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today',
  selectedDate: null,
  openWeeks: new Set(), openWeeksTouched: false,
  openActs: new Set(),
  rerender: () => render(),
  setTab: (t) => setTab(t),
  confirm: (msg) => window.confirm ? safeConfirm(msg) : true,
  reset: () => { clearAll(); data = null; A = null; setTab('settings'); toast('Local data cleared'); },
};
let data = cached();
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
  if (!isConfigured() && ui.tab !== 'settings') {
    view.append(renderSetup(() => { save({ demo: true }); sync(); }));
    view.append(renderSettings(ui, onSave));
    return;
  }
  if (!A) compute();
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

async function sync() {
  if (!isConfigured() || syncing) { render(); return; }
  syncing = true; btnRefresh.classList.add('spin'); updateStatus();
  try {
    data = await fetchAll({ days: 120 });
    const s = load();
    if (s.autoThresholds && data.athlete) {
      const t = thresholdsFromAthlete(data.athlete);
      const changed = Object.keys(t).filter(k => t[k] && t[k] !== s[k]);
      if (changed.length) { save(t); toast(`Thresholds updated from intervals.icu: ${changed.join(', ')}`); }
    }
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
window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (TABS.includes(t) && t !== ui.tab) setTab(t); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && data?.fetchedAt && Date.now() - data.fetchedAt > 30 * 60000) sync(); });

setTab(ui.tab);
if (isConfigured() && (!data || Date.now() - (data.fetchedAt || 0) > 10 * 60000)) sync();
