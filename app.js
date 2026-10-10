import {
  MAX_CATEGORIES, PALETTE, toLocalDate, formatDateNice, isValidDate,
  entryForDate, recentLog, sortRows, trainedDaysInLast, gridDates, monthSpan, colorFor, nextFreeColor,
  firstLetter, remapCategories, validateBackup, summarizeState, dateDiffDays
} from './logic.js';
import { validateHabitData, summarizeHabits } from './habits.js';
import { initHabits } from './habits-ui.js';

const KEY = 'trained.v1';
const BACKUP_KEY = 'trained.v1.lastBackup';
const PRE_RESTORE_KEY = 'trained.v1.pre-restore';

/* ---------- state + storage ---------- */
function defaultState() {
  return {
    schemaVersion: 1,
    categories: [
      { id: 'chest', name: 'Chest' },
      { id: 'shoulders', name: 'Shoulders' },
      { id: 'legs', name: 'Legs' },
      { id: 'cardio', name: 'Cardio' },
      { id: 'back', name: 'Back' }
    ],
    sessions: [],
    weights: []
  };
}

function backupCorruptState(raw) {
  // Unparsable/unexpected data is about to be overwritten by the next save():
  // stash it so it isn't silently lost.
  try { localStorage.setItem(KEY + '.corrupt-backup', raw); } catch (e) { /* best effort */ }
}

function load() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch (e) { return defaultState(); }
  if (!raw) return defaultState();
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { backupCorruptState(raw); return defaultState(); }
  if (!parsed || parsed.schemaVersion !== 1) { backupCorruptState(raw); return defaultState(); }
  parsed.categories = Array.isArray(parsed.categories) ? parsed.categories : [];
  parsed.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
  parsed.weights = Array.isArray(parsed.weights) ? parsed.weights : []; // kept, never shown
  return parsed;
}

let state = load();

const $ = (id) => document.getElementById(id);
const saveBannerEl = $('saveBanner');

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveBannerEl.hidden = true;
    return true;
  } catch (e) {
    saveBannerEl.hidden = false;
    return false;
  }
}

/* ---------- small helpers ---------- */
const today = () => toLocalDate(new Date());
const clone = (v) => JSON.parse(JSON.stringify(v));
const genId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const catIndex = (id) => state.categories.findIndex((c) => c.id === id);
const catById = (id) => state.categories.find((c) => c.id === id);
const catColor = (cat) => colorFor(cat, catIndex(cat.id)); // always a validated #rrggbb

/* ---------- undo + toast ---------- */
let undoSnap = null;
let toastTimer = null;
const toastEl = $('toast');

function showToast(message, snap) {
  undoSnap = snap || null;
  toastEl.innerHTML = '<span>' + escapeHtml(message) + '</span>' + (snap ? '<button type="button" id="undoBtn">Undo</button>' : '');
  toastEl.classList.add('show');
  const btn = $('undoBtn');
  if (btn) btn.addEventListener('click', doUndo);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast() {
  toastEl.classList.remove('show');
  undoSnap = null;
}
function doUndo() {
  if (!undoSnap) return;
  if (undoSnap.kind === 'state') state = clone(undoSnap.data);
  else state.sessions = clone(undoSnap.data);
  undoSnap = null;
  save();
  render();
  if (settingsModal.classList.contains('show')) renderSettings();
  habitsUI.refreshSheet();
  hideToast();
}
const sessionsSnap = () => ({ kind: 'sessions', data: clone(state.sessions) });

// One entry per day: these act on EVERY session on `date`, so a legacy
// same-day duplicate can't survive a change/remove and keep showing in the list.
function clearDay(date) {
  state.sessions = state.sessions.filter((s) => s.date !== date);
}
function setDay(date, catId, note) {
  clearDay(date);
  state.sessions.push(note ? { date, categoryId: catId, note } : { date, categoryId: catId });
}

/* ---------- confirm sheet ---------- */
const confirmSheet = $('confirmSheet');
const confirmOverlay = $('confirmOverlay');
let confirmResolve = null;

function askConfirm(title, body, okLabel) {
  $('confirmTitle').textContent = title;
  $('confirmBody').textContent = body || '';
  $('confirmBody').hidden = !body;
  $('confirmYes').textContent = okLabel || 'OK';
  confirmSheet.classList.add('show');
  confirmOverlay.classList.add('show');
  return new Promise((resolve) => { confirmResolve = resolve; });
}
function closeConfirm(result) {
  confirmSheet.classList.remove('show');
  confirmOverlay.classList.remove('show');
  if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(result); }
}
$('confirmYes').addEventListener('click', () => closeConfirm(true));
$('confirmNo').addEventListener('click', () => closeConfirm(false));
confirmOverlay.addEventListener('click', () => closeConfirm(false));

/* ---------- logging core ---------- */
// Put `catId` on `date`. Asks first if that date already has a different category.
// Returns true if something changed.
async function logOnDate(date, catId, note) {
  const cat = catById(catId);
  if (!cat) return false;
  const t = today();
  const existing = entryForDate(state.sessions, date);
  const when = date === t ? 'today' : formatDateNice(date, t);
  if (!existing) {
    const snap = sessionsSnap();
    const entry = { date, categoryId: catId };
    if (note) entry.note = note;
    state.sessions.push(entry);
    save(); render();
    showToast('Logged ✓', snap);
    return true;
  }
  if (existing.session.categoryId === catId) {
    if (note && note !== existing.session.note) {
      const snap = sessionsSnap();
      existing.session.note = note;
      save(); render();
      showToast('Note saved', snap);
      return true;
    }
    showToast('Already logged ' + when);
    return false;
  }
  const oldCat = catById(existing.session.categoryId);
  const ok = await askConfirm(
    'Change ' + when + ' from ' + (oldCat ? oldCat.name : 'a deleted category') + ' to ' + cat.name + '?',
    '', 'Change'
  );
  if (!ok) return false;
  // re-find: state may have changed while the sheet was open
  const again = entryForDate(state.sessions, date);
  const snap = sessionsSnap();
  setDay(date, catId, note || (again && again.session.note) || '');
  save(); render();
  showToast('Changed to ' + cat.name, snap);
  return true;
}

/* ---------- render: ledger + history ---------- */
const listEl = $('list');
const gridEl = $('grid');
const legendEl = $('legend');
const logEl = $('log');

function render() {
  habitsUI.render();
  renderList();
  renderHistory();
  renderLog();
}

function renderLog() {
  const t = today();
  const items = recentLog(state.sessions, t, 28);
  if (!items.length) {
    logEl.innerHTML = '<p class="empty">Nothing logged in the last 28 days.</p>';
    return;
  }
  logEl.innerHTML = items.map((s) => {
    const cat = catById(s.categoryId);
    const sw = cat ? '<i class="swatch" style="background:' + catColor(cat) + '"></i>' : '<i class="swatch orphan"></i>';
    const name = cat ? escapeHtml(cat.name) : 'Deleted category';
    const note = s.note ? '<span class="lognote">' + escapeHtml(s.note) + '</span>' : '';
    return '<button type="button" class="logrow" data-date="' + s.date + '">' +
      '<span class="logdate">' + formatDateNice(s.date, t) + '</span>' +
      '<span class="logmain">' + sw + '<span class="logname' + (cat ? '' : ' deleted') + '">' + name + '</span>' + note + '</span>' +
    '</button>';
  }).join('');
}

// Gym strip: one colour tile per category, stalest first. Tap = log today.
// Backdating and notes live in the history grid's day sheet.
function renderList() {
  const t = today();
  if (state.categories.length === 0) {
    listEl.innerHTML = '<p class="empty">No categories yet. Add one in settings.</p>';
    return;
  }
  listEl.innerHTML = sortRows(state.categories, state.sessions, t).map((r) => {
    let days, aria;
    if (r.daysSince === null) { days = '–'; aria = 'never trained'; }
    else if (r.daysSince === 0) { days = '✓'; aria = 'trained today'; }
    else { days = String(r.daysSince); aria = r.daysSince + (r.daysSince === 1 ? ' day ago' : ' days ago'); }
    return '<div class="tile" role="button" tabindex="0" data-cat="' + escapeHtml(r.cat.id) + '" style="background:' + catColor(r.cat) + '" aria-label="Log ' + escapeHtml(r.cat.name) + ', ' + aria + '">' +
      '<b>' + days + '</b><span>' + escapeHtml(r.cat.name) + '</span></div>';
  }).join('');
}

function renderHistory() {
  const t = today();
  const rows = gridDates(t, 8);
  const months = monthSpan(rows, t);
  $('histMonths').textContent = months.length === 1 ? months[0].long : months[0].short + ' – ' + months[months.length - 1].short;
  $('count28').textContent = trainedDaysInLast(state.sessions, t, 28) + ' / 28 days';

  let html = '';
  for (const row of rows) {
    for (const ds of row) {
      if (ds > t) { html += '<span class="cell blank"></span>'; continue; }
      const e = entryForDate(state.sessions, ds);
      const isToday = ds === t ? ' today' : '';
      const label = formatDateNice(ds, t);
      if (!e) {
        html += '<button type="button" class="cell' + isToday + '" data-date="' + ds + '" aria-label="' + label + ', nothing logged">' + Number(ds.slice(8)) + '</button>';
      } else {
        const cat = catById(e.session.categoryId);
        if (cat) {
          html += '<button type="button" class="cell on' + isToday + '" data-date="' + ds + '" style="background:' + catColor(cat) + '" aria-label="' + label + ', ' + escapeHtml(cat.name) + '">' + escapeHtml(firstLetter(cat.name)) + '</button>';
        } else {
          html += '<button type="button" class="cell on orphan' + isToday + '" data-date="' + ds + '" aria-label="' + label + ', deleted category">?</button>';
        }
      }
    }
  }
  gridEl.innerHTML = html;
  legendEl.innerHTML = state.categories.map((c) =>
    '<span><i class="swatch" style="background:' + catColor(c) + '"></i>' + escapeHtml(c.name) + '</span>').join('');
}

/* ---------- list interactions ---------- */
async function tapRow(catId) {
  const t = today();
  const existing = entryForDate(state.sessions, t);
  if (existing && existing.session.categoryId === catId) {
    const cat = catById(catId);
    const ok = await askConfirm('Remove today\'s ' + (cat ? cat.name : 'entry') + '?', '', 'Remove');
    if (!ok) return;
    const snap = sessionsSnap();
    clearDay(t);
    save(); render();
    showToast('Removed', snap);
    return;
  }
  await logOnDate(t, catId, '');
}

listEl.addEventListener('click', (e) => {
  const tile = e.target.closest('.tile');
  if (tile) tapRow(tile.getAttribute('data-cat'));
});
listEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const tile = e.target.closest('.tile');
  if (tile) { e.preventDefault(); tapRow(tile.getAttribute('data-cat')); }
});
logEl.addEventListener('click', (e) => {
  const row = e.target.closest('.logrow[data-date]');
  if (row) openDaySheet(row.getAttribute('data-date'));
});
gridEl.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell[data-date]');
  if (cell) openDaySheet(cell.getAttribute('data-date'));
});

/* ---------- shared sheet overlay ---------- */
const overlay = $('overlay');
const daySheet = $('daySheet');

function openSheet(el) { overlay.classList.add('show'); el.classList.add('show'); }
function closeSheets() {
  overlay.classList.remove('show');
  daySheet.classList.remove('show');
  dayDate = null;
}
overlay.addEventListener('click', closeSheets);

/* ---------- day sheet ---------- */
let dayDate = null;
const dayBody = $('dayBody');

function chipsHtml(selectedId) {
  return '<div class="chips">' + state.categories.map((c) =>
    '<button type="button" class="chip' + (c.id === selectedId ? ' on' : '') + '" data-pick="' + escapeHtml(c.id) + '">' +
    '<i class="swatch" style="background:' + catColor(c) + '"></i>' + escapeHtml(c.name) + '</button>').join('') + '</div>';
}

function renderDaySheet() {
  const t = today();
  $('dayTitle').textContent = dayDate === t ? 'Today' : formatDateNice(dayDate, t);
  const e = entryForDate(state.sessions, dayDate);
  if (!e) {
    dayBody.innerHTML =
      '<div class="label">Log onto this day</div>' + chipsHtml(null) +
      '<div class="label">Note (optional)</div>' +
      '<input type="text" id="dayNote" maxlength="60" placeholder="Note" aria-label="Note">' +
      '<div class="dayactions"><button type="button" class="btn" data-act="close">Close</button></div>';
    return;
  }
  const cat = catById(e.session.categoryId);
  const head = cat
    ? '<div class="daycat"><i class="swatch" style="background:' + catColor(cat) + '"></i>' + escapeHtml(cat.name) + '</div>'
    : '<div class="daycat deleted">Deleted category</div>';
  dayBody.innerHTML = head +
    '<div class="label">Note</div>' +
    '<div class="noterow"><input type="text" id="dayNote" maxlength="60" placeholder="Note" value="' + escapeHtml(e.session.note || '') + '" aria-label="Note">' +
    '<button type="button" class="btn" data-act="savenote">Save</button></div>' +
    '<div class="label">Change category</div>' + chipsHtml(e.session.categoryId) +
    '<div class="dayactions"><button type="button" class="btn danger" data-act="remove">Remove</button>' +
    '<button type="button" class="btn" data-act="close">Close</button></div>';
}

function openDaySheet(date) {
  if (!isValidDate(date) || date > today()) return;
  dayDate = date;
  renderDaySheet();
  openSheet(daySheet);
}

dayBody.addEventListener('click', (ev) => {
  const date = dayDate;
  if (!date) return;
  const noteEl = $('dayNote');
  const pick = ev.target.closest('[data-pick]');
  const act = ev.target.closest('[data-act]');
  if (pick) {
    const catId = pick.getAttribute('data-pick');
    const existing = entryForDate(state.sessions, date);
    if (existing && existing.session.categoryId === catId) return;
    const note = noteEl ? noteEl.value.trim().slice(0, 60) : '';
    if (existing) {
      // explicit change inside the day sheet: no extra confirm, Undo covers it
      const snap = sessionsSnap();
      setDay(date, catId, note || existing.session.note || '');
      save(); closeSheets(); render();
      showToast('Changed to ' + catById(catId).name, snap);
    } else {
      closeSheets();
      logOnDate(date, catId, note);
    }
    return;
  }
  if (!act) return;
  const what = act.getAttribute('data-act');
  if (what === 'close') { closeSheets(); return; }
  const existing = entryForDate(state.sessions, date);
  if (what === 'savenote' && existing) {
    const note = noteEl.value.trim().slice(0, 60);
    if ((existing.session.note || '') === note) { closeSheets(); return; }
    const snap = sessionsSnap();
    if (note) existing.session.note = note; else delete existing.session.note;
    save(); closeSheets(); render();
    showToast('Note saved', snap);
  } else if (what === 'remove' && existing) {
    const snap = sessionsSnap();
    clearDay(date);
    save(); closeSheets(); render();
    showToast('Removed', snap);
  }
});

/* ---------- settings ---------- */
const settingsModal = $('settingsModal');
const settingsOverlay = $('settingsOverlay');
const categoryListEl = $('categoryList');
let colorOpenFor = null;

function openSettings() {
  colorOpenFor = null;
  resetRestoreBox();
  renderSettings();
  settingsOverlay.classList.add('show');
  settingsModal.classList.add('show');
}
function closeSettings() {
  settingsOverlay.classList.remove('show');
  settingsModal.classList.remove('show');
  resetRestoreBox();
}
$('settingsBtn').addEventListener('click', openSettings);
$('closeSettings').addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', closeSettings);
$('saveBannerBtn').addEventListener('click', openSettings);

function lastBackupText() {
  let ms = null;
  try { ms = Number(localStorage.getItem(BACKUP_KEY)); } catch (e) { /* ignore */ }
  if (!ms) return 'Never backed up';
  const n = dateDiffDays(toLocalDate(new Date(ms)), today());
  if (n <= 0) return 'Last backup: today';
  return 'Last backup: ' + n + (n === 1 ? ' day ago' : ' days ago');
}

function renderSettings() {
  categoryListEl.innerHTML = state.categories.map((c, i) => {
    const col = colorFor(c, i);
    let h = '<div class="catblock"><div class="catrow">' +
      '<button type="button" class="colorbtn" data-color-toggle="' + escapeHtml(c.id) + '" aria-label="Colour for ' + escapeHtml(c.name) + '"><i style="background:' + col + '"></i></button>' +
      '<input type="text" class="catname" value="' + escapeHtml(c.name) + '" data-id="' + escapeHtml(c.id) + '" maxlength="20" aria-label="Category name">' +
      '<button type="button" class="catdel" data-del="' + escapeHtml(c.id) + '" aria-label="Delete ' + escapeHtml(c.name) + '">&#10005;</button></div>';
    if (colorOpenFor === c.id) {
      h += '<div class="palette">' + PALETTE.map((p) =>
        '<button type="button" data-set-color="' + p + '" data-id="' + escapeHtml(c.id) + '"' + (p.toLowerCase() === col.toLowerCase() ? ' class="on"' : '') + ' aria-label="Colour ' + p + '"><i style="background:' + p + '"></i></button>').join('') + '</div>';
    }
    return h + '</div>';
  }).join('');
  const atCap = state.categories.length >= MAX_CATEGORIES;
  $('catCapNote').textContent = atCap ? 'Max ' + MAX_CATEGORIES + ' categories reached.' : '';
  $('newCat').disabled = atCap;
  $('addCat').disabled = atCap;
  $('backupNote').textContent = lastBackupText();
  habitsUI.renderSettings();
}

categoryListEl.addEventListener('change', (e) => {
  const input = e.target.closest('.catname');
  if (!input) return;
  const cat = catById(input.getAttribute('data-id'));
  if (!cat) return;
  const name = input.value.trim();
  if (!name) { input.value = cat.name; return; }
  cat.name = name.slice(0, 20);
  save(); render();
});
categoryListEl.addEventListener('click', (e) => {
  const tog = e.target.closest('[data-color-toggle]');
  if (tog) {
    const id = tog.getAttribute('data-color-toggle');
    colorOpenFor = colorOpenFor === id ? null : id;
    renderSettings();
    return;
  }
  const setc = e.target.closest('[data-set-color]');
  if (setc) {
    const cat = catById(setc.getAttribute('data-id'));
    if (cat) {
      materializeColors();
      cat.color = setc.getAttribute('data-set-color');
      save(); colorOpenFor = null; renderSettings(); render();
    }
    return;
  }
  const del = e.target.closest('[data-del]');
  if (del) {
    const cat = catById(del.getAttribute('data-del'));
    if (!cat) return;
    if (!window.confirm('Delete ' + cat.name + '? Past sessions stay in your history.')) return;
    materializeColors(); // so remaining categories keep their colour when positions shift
    state.categories = state.categories.filter((c) => c.id !== cat.id);
    colorOpenFor = null;
    save(); renderSettings(); render();
  }
});

// Freeze position-based default colours into category.color (optional field, additive).
function materializeColors() {
  state.categories.forEach((c, i) => { c.color = colorFor(c, i); });
}

$('addCat').addEventListener('click', () => {
  if (state.categories.length >= MAX_CATEGORIES) return;
  const name = $('newCat').value.trim();
  if (!name) return;
  materializeColors();
  state.categories.push({ id: genId(), name: name.slice(0, 20), color: nextFreeColor(state.categories) });
  $('newCat').value = '';
  save(); renderSettings(); render();
});

/* ---------- back up ---------- */
function recordBackup() {
  try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  $('backupNote').textContent = lastBackupText();
}

$('backupBtn').addEventListener('click', async () => {
  const name = 'trained-backup-' + today() + '.json';
  const json = JSON.stringify(state, null, 2);
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      recordBackup();
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return; // user closed the share sheet; not a backup
    // any other share failure: fall through to download
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  recordBackup();
});

/* ---------- restore ---------- */
const restoreFile = $('restoreFile');
const restoreBox = $('restoreBox');
const restoreMsg = $('restoreMsg');
const restoreActions = $('restoreActions');
let pendingRestore = null;

function resetRestoreBox() {
  pendingRestore = null;
  restoreBox.hidden = true;
  restoreActions.hidden = true;
  restoreMsg.textContent = '';
  restoreMsg.className = 'restoremsg';
  restoreFile.value = '';
}

$('restoreBtn').addEventListener('click', () => restoreFile.click());
restoreFile.addEventListener('change', async () => {
  const f = restoreFile.files && restoreFile.files[0];
  if (!f) return;
  restoreBox.hidden = false;
  let text;
  try { text = await f.text(); } catch (e) { text = ''; }
  const res = validateBackup(text);
  const habitErr = res.ok ? validateHabitData(res.state) : null;
  if (habitErr) { res.ok = false; res.error = habitErr; }
  if (!res.ok) {
    pendingRestore = null;
    restoreActions.hidden = true;
    restoreMsg.className = 'restoremsg error';
    restoreMsg.textContent = res.error + ' Nothing was changed.';
  } else {
    pendingRestore = res.state;
    restoreActions.hidden = false;
    restoreMsg.className = 'restoremsg';
    const hs = summarizeHabits(res.state);
    const keep = keepsCurrentHabits(res.state);
    restoreMsg.textContent = res.summary + (hs ? ' · ' + hs : '') + '. This replaces what is on this phone now.' +
      (keep ? ' This backup is from before habits, so your current habits are kept.' : '');
  }
  restoreFile.value = '';
});
$('restoreCancel').addEventListener('click', resetRestoreBox);

// A backup made before habits existed has no `habits` field. Restoring it must not wipe them.
const HABIT_KEYS = ['habits', 'habitLogs', 'sleepNights', 'goalYearStart'];
function keepsCurrentHabits(incoming) {
  return incoming.habits === undefined && Array.isArray(state.habits) && state.habits.length > 0;
}
const fullSummary = (st) => { const h = summarizeHabits(st); return summarizeState(st) + (h ? ' · ' + h : ''); };
$('restoreConfirm').addEventListener('click', async () => {
  if (!pendingRestore) return;
  const incoming = pendingRestore;
  const keep = keepsCurrentHabits(incoming);
  const ok = await askConfirm('Replace your data?', 'Now: ' + fullSummary(state) + '. Backup: ' + summarizeState(incoming) + '.' + (keep ? ' Your current habits are kept.' : ''), 'Replace');
  if (!ok) return;
  const snap = { kind: 'state', data: clone(state) };
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.setItem(PRE_RESTORE_KEY, raw || JSON.stringify(state));
  } catch (e) { /* best effort; in-session Undo still works */ }
  state = {
    schemaVersion: 1,
    categories: incoming.categories,
    sessions: incoming.sessions,
    weights: incoming.weights || []
  };
  // keep any extra top-level fields the backup carried
  for (const k of Object.keys(incoming)) if (!(k in state)) state[k] = incoming[k];
  if (keep) for (const k of HABIT_KEYS) if (snap.data[k] !== undefined) state[k] = clone(snap.data[k]);
  save();
  resetRestoreBox();
  closeSettings();
  render();
  showToast('Restored', snap);
});

/* ---------- lifecycle ---------- */
// Re-render on resume: fixes a stale view after PWA suspend or a midnight rollover.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    render();
    if (dayDate && daySheet.classList.contains('show')) {
      if (dayDate > today()) closeSheets(); else renderDaySheet();
    }
  }
});

/* ---------- one-time category reset (2026-10-10) ---------- */
// Mark asked for his phone's list to become Chest/Shoulders/Legs/Cardio/Back
// with Push/Pull/Full Body gone. Runs once per device (flag key), stashes the
// prior data, and offers Undo. Sessions are untouched.
const CATS_FLAG_KEY = 'trained.v1.cats-reset-2026-10-10';
function migrateCategoriesOnce() {
  try { if (localStorage.getItem(CATS_FLAG_KEY)) return null; } catch (e) { return null; }
  const before = clone(state);
  const next = remapCategories(state.categories, ['Chest', 'Shoulders', 'Legs', 'Cardio', 'Back'], ['Push', 'Pull', 'Full Body'], genId);
  const changed = JSON.stringify(next.map((c) => [c.id, c.name])) !== JSON.stringify(state.categories.map((c) => [c.id, c.name]));
  if (changed) {
    try { localStorage.setItem(KEY + '.pre-categories', JSON.stringify(before)); } catch (e) { /* best effort */ }
    state.categories = next;
    if (!save()) return null; // storage blocked: leave the flag unset so it retries
  }
  try { localStorage.setItem(CATS_FLAG_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  return changed ? before : null;
}
const catsBefore = migrateCategoriesOnce();

const habitsUI = initHabits({
  getState: () => state,
  save,
  rerender: render,
  showToast,
  askConfirm,
  snapState: () => ({ kind: 'state', data: clone(state) }),
  escapeHtml,
  today,
  genId,
  openSettings
});

render();
if (catsBefore) showToast('Categories updated', { kind: 'state', data: catsBefore });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
