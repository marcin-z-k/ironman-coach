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
import { aiCoachPrompt, importPlan, exportPlan, goalFromMeta } from './customplan.js';
import { setCache, getCache, setOnChange } from './store.js';
import { syncSettings, schedulePush } from './sync.js';
import { computeBaseline } from './targets.js';
import { renderRaceDay, raceLocked } from './raceui.js';
import { attachHelp } from './help.js';
import { hasRealPower, singleFtp, calibrate } from './virtualpower.js';
import { fetchActivitiesRange } from './icu.js';
import { el, esc } from './util.js';
import { download } from './export.js';
import { renderFuelSheet } from './ui.js';

const view = document.getElementById('view');
const syncStatus = document.getElementById('syncStatus');
const btnRefresh = document.getElementById('btnRefresh');
const TABS = ['today', 'plan', 'activities', 'progress', 'race', 'settings'];
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
  attachHelp(node); [800, 2500, 6000].forEach(t => setTimeout(() => attachHelp(node), t));   // detail cards that load later
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
  const d70 = isoDate(addDays(new Date(), -70));
  const runs = data.activities.filter(a => (a.sport === 'run' && a.date >= from && a.movingSec >= 600) || (a.sport === 'bike' && a.date >= d70 && a.movingSec >= 1200) || (a.sport === 'swim' && a.date >= isoDate(addDays(new Date(), -56))));
  if (!runs.length) return;
  streamsBusy = true;
  try {
    await prefetch(runs, (d, n) => { ui.streamsLoading = d < n ? `${d}/${n}` : null; if (ui.tab === 'progress' && (d === n || d % 5 === 0)) { ui.keepScroll(); render(); } });
  } finally { streamsBusy = false; ui.streamsLoading = null; try { updateThresholds(); } catch {} A = null; if (sheet.hidden) { ui.keepScroll(); render(); } }
}

function planAction(kind) {
  const s = load();
  if (kind === 'prompt') { download(new Blob([aiCoachPrompt()], { type: 'text/markdown' }), 'ironman-coach-ai-plan-prompt.md'); toast('Prompt downloaded — give it to your AI'); return; }
  if (kind === 'export') { if (!A) compute(); download(new Blob([JSON.stringify(exportPlan(A.plan, s, s.planSource === 'custom' ? (s.customName || 'Imported plan') : `${s.raceName} plan`), null, 1)], { type: 'application/json' }), `ironman-coach-plan-${isoDate(new Date())}.json`); return; }
  if (kind === 'reset') {
    if (!ui.confirm('Switch back to the default plan? Imported plan and goal selection are cleared (your default plan was never changed).')) return;
    setCache('customPlan', null); save({ planSource: 'default', customName: null, moves: {} }); A = null; toast('Back to the default plan'); setTab('today'); return;
  }
  if (kind === 'import') {
    const node = el(`<div class="detail"><div class="detail-head"><button class="icon-btn" data-close>✕</button><div class="detail-title">Import a training plan</div></div>
      <p class="small muted">Choose the JSON file(s) your AI produced (several parts are merged), or paste the AI's whole reply — the JSON is found automatically.</p>
      <input type="file" accept=".json,.txt,.md,application/json,text/plain" multiple class="filein">
      <textarea class="paste" rows="8" placeholder="…or paste here"></textarea>
      <button class="btn" data-go>Check & import</button>
      <div class="imp-out"></div></div>`);
    node.querySelector('[data-close]').onclick = () => closeSheet();
    node.querySelector('[data-go]').onclick = async () => {
      const out = node.querySelector('.imp-out');
      const texts = [];
      for (const f of node.querySelector('.filein').files) texts.push(await f.text());
      const pasted = node.querySelector('.paste').value.trim(); if (pasted) texts.push(pasted);
      if (!texts.length) { out.innerHTML = '<div class="adjust-banner bad"><span>!</span><div>Choose a file or paste the JSON.</div></div>'; return; }
      let r;
      try { r = importPlan(texts, load()); } catch (e) { out.innerHTML = `<div class="adjust-banner bad"><span>!</span><div><b>Not valid JSON.</b> ${esc(e.message)}</div></div>`; return; }
      const list = (arr) => arr.slice(0, 12).map(x => `<li>${esc(x)}</li>`).join('') + (arr.length > 12 ? `<li>…and ${arr.length - 12} more</li>` : '');
      if (!r.plan || !r.meta?.sessions) { out.innerHTML = `<div class="adjust-banner bad"><span>!</span><div><b>Could not import.</b><ul>${list(r.errors)}</ul></div></div>`; return; }
      const docs = texts;
      out.innerHTML = `<div class="adjust-banner ${r.errors.length ? '' : 'good'}"><span>${r.errors.length ? '!' : '✓'}</span><div><b>${esc(r.meta.name || 'Plan')}</b>: ${r.meta.weeks} weeks, ${r.meta.sessions} sessions, race ${esc(r.plan.raceDate)}.${r.errors.length ? `<br>${r.errors.length} problem(s) — those sessions are skipped:<ul>${list(r.errors)}</ul>` : ''}${r.warnings.length ? `<ul>${list(r.warnings)}</ul>` : ''}</div></div><button class="btn" data-use style="margin-top:10px">Use this plan</button>`;
      out.querySelector('[data-use]').onclick = () => {
        setCache('customPlan', docs);
        const g = goalFromMeta(r.meta.goal);
        save({ planSource: 'custom', customName: r.meta.name || 'Imported plan', raceDate: r.plan.raceDate, ...(r.meta.goal?.raceName ? { raceName: r.meta.goal.raceName } : {}), ...(g ? { goal: g } : {}), moves: {} });
        A = null; closeSheet(); toast('Plan imported'); setTab('plan');
      };
    };
    openSheet(node);
  }
}

setOnChange(schedulePush);
const ui = {
  syncAction: async (dir) => { try { const r = await syncSettings({ force: dir }); A = null; toast(r === 'pushed' ? 'This device\'s values are now used on all devices' : 'Loaded the values from your account'); ui.invalidate?.(); render(); } catch (e) { toast('Sync failed: ' + e.message, true); } },
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today',
  trendRange: 30, selectedDate: null,
  openWeeks: new Set(), openWeeksTouched: false, openSess: new Set(), openActs: new Set(),
  pending: [],
  openSheet, closeSheet, planAction,
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
  document.getElementById('btnSettings').classList.toggle('on', t === 'settings');
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
      case 'race': node = renderRaceDay(A, ui, data); break;
      case 'settings': node = renderSettings(ui, onSave); break;
      default: node = renderToday(A, ui);
    }
  }
  view.append(node);
  attachHelp(view);
  const rt = document.querySelector('.tab[data-tab="race"]');
  if (rt) { const s = load(), lk = isConfigured() && raceLocked(s); rt.classList.toggle('locked', lk); rt.hidden = lk && !!s.hideRaceDayIcon; }
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
  const lbl = { ftp: singleFtp(load()) ? 'FTP' : 'indoor FTP', ftpOutdoor: 'outdoor FTP', runThreshold: 'run threshold', css: 'CSS' };
  toast(`Updated ${list.map(u => lbl[u.field]).join(', ')} (${source})`);
}

// One-time repair: the ±5 % step used to apply per update run, so several runs in a row could
// compound (160 → 204 W). Reset to the value before that day + 5 %.
function repairCompounded() {
  const s = load();
  if (s.mig3) return;
  const log = [...(s.thresholdLog || [])], patch = { mig3: true };
  for (const k of ['ftp', 'runThreshold', 'css']) {
    const byDay = {};
    for (const l of log) if (l.field === k && l.source === 'activity estimate') (byDay[l.date] ||= []).push(l);
    for (const [d, list] of Object.entries(byDay)) {
      if (list.length < 2) continue;
      const first = list[list.length - 1], last = list[0];            // log is newest-first
      if (Math.abs(last.to / first.from - 1) > 0.055 && s[k] === last.to) {
        patch[k] = Math.round(first.from * (last.to > first.from ? 1.05 : 0.95));
        log.unshift({ date: isoDate(new Date()), field: k, from: s[k], to: patch[k], source: 'repair', detail: `undid ${list.length} stacked updates from ${d} (max ±5 % per week)` });
      }
    }
  }
  patch.thresholdLog = log.slice(0, 40);
  save(patch);
}

function updateThresholds() {
  repairCompounded();
  // power meter seen once → separate indoor / outdoor FTPs from then on; otherwise one FTP
  if (!load().powerSeen && (data?.activities || []).some(hasRealPower)) save({ powerSeen: true });
  const s = load();
  const mode = s.thresholdSource || 'auto';
  const todayIso = isoDate(new Date());
  const held = k => s.holds?.[k] && s.holds[k] >= todayIso;
  // 1) values from intervals.icu sport settings: follow always in 'intervals' mode, otherwise only when they
  //    changed there (e.g. after a test). Values you typed in Settings are held for 4 weeks.
  const icu = data?.athlete ? thresholdsFromAthlete(data.athlete) : {};
  const icuChanges = [];
  if (singleFtp(s) && !icu.ftp && icu.ftpOutdoor) icu.ftp = icu.ftpOutdoor;          // one FTP: intervals.icu's FTP is it
  for (const k of ['ftp', 'ftpOutdoor', 'runThreshold', 'css']) {
    if (singleFtp(s) && k === 'ftpOutdoor') continue;
    if (!icu[k] || (held(k) && mode !== 'intervals')) continue;
    const changedInIcu = !s.lastIcu || (s.lastIcu[k] && s.lastIcu[k] !== icu[k]);
    if ((mode === 'intervals' || changedInIcu) && icu[k] !== s[k]) icuChanges.push({ field: k, from: s[k], to: icu[k], source: 'intervals.icu settings' });
  }
  save({ lastIcu: icu });
  if (mode !== 'manual') applyUpdates(icuChanges, 'intervals.icu settings');
  if (mode === 'intervals' || mode === 'manual') return;
  if (singleFtp(load())) {
    const prev = load().vpCal, cal = calibrate(data?.activities || [], load());
    if (cal && JSON.stringify(cal) !== JSON.stringify(prev)) {
      save({ vpCal: cal });
      // first calibration from long outdoor rides sets the FTP directly (later changes: ±5 %/week)
      const s0 = load(), held = s0.holds?.ftp && s0.holds.ftp >= isoDate(new Date());
      if (cal.source === 'outdoor rides' && prev?.source !== 'outdoor rides' && !held && Math.abs(cal.anchorFtp - s0.ftp) >= 3)
        applyUpdates([{ field: 'ftp', from: s0.ftp, to: cal.anchorFtp, source: 'calibration from long outdoor rides' }], 'calibration');
    }
  }
  // 2) estimates from recent activities (respecting holds)
  const est = estimateAll(data.activities || [], load(), todayIso);
  const props = proposeUpdates(est, load(), todayIso).filter(p => !icuChanges.some(c => c.field === p.field));
  if (mode === 'auto') applyUpdates(props, 'activity estimate');
  else ui.pending = props;
}

// Goal-ring baseline (0 %): your level in your first logged activities — all intervals.icu history,
// computed once and synced to your other devices.
let baselineBusy = false;
async function ensureBaseline() {
  const s = load();
  if (baselineBusy || !data?.activities || (s.baseline && s.baseline.v === 1)) return;
  baselineBusy = true;
  try {
    const older = await fetchActivitiesRange('2000-01-01', isoDate(addDays(new Date(), -149))).catch(() => []);
    const ids = new Set(data.activities.map(a => a.id));
    const all = data.activities.concat(older.filter(a => !ids.has(a.id)));
    save({ baseline: computeBaseline(all, load()) });
    A = null; render();
  } finally { baselineBusy = false; }
}

async function sync(fromLogin = false) {
  if (!isConfigured() || syncing) { render(); return; }
  syncing = true; btnRefresh.classList.add('spin'); updateStatus();
  try {
    try { const r = await syncSettings(); if (r === 'pulled') A = null; ui.syncState = r; } catch (e) { console.warn('settings sync', e); ui.syncState = 'error'; }
    data = await fetchAll({ days: 150 });
    setZoneModel(buildZoneModel(data.athlete));
    const rhr = (data.wellness || []).map(w => w.restingHR).filter(Boolean).slice(-14);
    if (rhr.length) save({ restHr: Math.round(rhr.sort((a, b) => a - b)[rhr.length >> 1]) });
    updateThresholds();
    ensureBaseline();
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
document.getElementById('btnSettings').onclick = () => setTab('settings');
document.getElementById('btnFuel').onclick = () => openSheet(renderFuelSheet(ui));
window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t.startsWith('trend-')) { keepScrollY = null; render(); window.scrollTo({ top: 0 }); return; } if (TABS.includes(t)) { if (t !== ui.tab) setTab(t); else render(); } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (data?.fetchedAt && Date.now() - data.fetchedAt > 30 * 60000) { sync(); return; }
  if (isConfigured()) syncSettings().then(r => { if (r === 'pulled') { A = null; render(); } }).catch(() => {});
});

// Update check: version.json is fetched uncached; if a newer build is live, offer a reload.
async function checkUpdate() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    const v = (await r.json()).version;
    if (v && window.APP_VERSION && v !== window.APP_VERSION && !document.getElementById('upd')) {
      const b = el(`<button id="upd" class="update-bar">✨ New version available — tap to reload</button>`);
      b.onclick = () => location.reload();
      document.body.append(b);
    }
  } catch {}
}
setInterval(checkUpdate, 5 * 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });

(async function boot() {
  checkUpdate();
  if (location.hash.startsWith('#trend-')) render(); else setTab(ui.tab);
  const restored = await restoreCredentials();
  if (restored) { toast('Signed in'); render(); }
  if (isConfigured()) { backupCredentials(); if (!data || restored || Date.now() - (data.fetchedAt || 0) > 10 * 60000) sync(); else { loadRunStreams(); syncSettings().then(r => { if (r === 'pulled') { A = null; render(); } }).catch(e => console.warn(e)); } }
})();
