// Pure date/data logic for Trained. No DOM, no storage, no clock reads:
// callers pass `today` ('YYYY-MM-DD', local) in, so everything is deterministic.
// All dates are LOCAL calendar dates, never UTC.

export const PALETTE = [
  '#2dbfb7', // teal (original accent)
  '#e8b339', // amber
  '#5b8def', // blue
  '#a98bf0', // violet
  '#e873a6', // pink
  '#ef7d4a', // orange
  '#9bcb4b', // lime
  '#b8bcc6'  // light grey
];

export const MAX_CATEGORIES = 8;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ---------- dates ---------- */
export function pad(n) { return String(n).padStart(2, '0'); }

export function toLocalDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function parseDate(str) {
  const p = str.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

// True only for real calendar dates in YYYY-MM-DD form (rejects 2026-02-31).
export function isValidDate(str) {
  if (typeof str !== 'string' || !DATE_RE.test(str)) return false;
  return toLocalDate(parseDate(str)) === str;
}

export function addDays(str, n) {
  const p = str.split('-').map(Number);
  return toLocalDate(new Date(p[0], p[1] - 1, p[2] + n));
}

export function dateDiffDays(fromStr, toStr) {
  // Math.round absorbs the 23h/25h days either side of a DST change.
  return Math.round((parseDate(toStr) - parseDate(fromStr)) / 86400000);
}

export function weekdayAbbrev(str) { return WEEKDAYS[parseDate(str).getDay()]; }

export function mondayOf(str) {
  const day = parseDate(str).getDay(); // 0 Sun .. 6 Sat
  return addDays(str, day === 0 ? -6 : 1 - day);
}

export function formatDateNice(str, today) {
  if (str === today) return 'Today';
  if (str === addDays(today, -1)) return 'Yesterday';
  const d = parseDate(str);
  return WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
}

/* ---------- sessions ---------- */
// One entry per day going forward. Legacy data may hold several sessions on a
// date: the LAST one in array order is the one shown. Returns {session, index} or null.
export function entryForDate(sessions, date) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].date === date) return { session: sessions[i], index: i };
  }
  return null;
}

// The one entry per date that the app treats as real (last in array order wins).
// Legacy duplicates stay in storage but never count anywhere, so the list and
// the history grid always agree.
export function effectiveSessions(sessions) {
  const byDate = new Map();
  for (const s of sessions) byDate.set(s.date, s);
  return Array.from(byDate.values());
}

export function lastSessionDate(sessions, categoryId) {
  let last = null;
  for (const s of sessions) {
    if (s.categoryId === categoryId && (!last || s.date > last)) last = s.date;
  }
  return last;
}

// Null if never trained. sortRows passes effectiveSessions() so shadowed duplicates don't count.
export function daysSince(sessions, categoryId, today) {
  const last = lastSessionDate(sessions, categoryId);
  return last ? dateDiffDays(last, today) : null;
}

// Stalest first; never-trained first of all. Stable: ties keep category order.
export function sortRows(categories, sessions, today) {
  const eff = effectiveSessions(sessions);
  const rows = categories.map((cat, index) => ({ cat, index, daysSince: daysSince(eff, cat.id, today) }));
  rows.sort((a, b) => {
    if (a.daysSince === null && b.daysSince === null) return a.index - b.index;
    if (a.daysSince === null) return -1;
    if (b.daysSince === null) return 1;
    return (b.daysSince - a.daysSince) || (a.index - b.index);
  });
  return rows;
}

// Distinct trained dates in the last `n` days, today included.
export function trainedDaysInLast(sessions, today, n = 28) {
  const start = addDays(today, -(n - 1));
  const seen = new Set();
  for (const s of sessions) {
    if (s.date >= start && s.date <= today) seen.add(s.date);
  }
  return seen.size;
}

// Written log: the shown entry per date within the last `n` days (today
// included), newest first.
export function recentLog(sessions, today, n = 28) {
  const start = addDays(today, -(n - 1));
  return effectiveSessions(sessions)
    .filter((s) => s.date >= start && s.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/* ---------- history grid ---------- */
// Monday-first weeks (rows) ending with the week that contains `today`.
// Cells after today are still returned; callers render them blank.
export function gridDates(today, weeks = 8) {
  const firstMonday = addDays(mondayOf(today), -7 * (weeks - 1));
  const rows = [];
  for (let w = 0; w < weeks; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) row.push(addDays(firstMonday, w * 7 + d));
    rows.push(row);
  }
  return rows;
}

// Month names covered by the grid up to today, in order: ['Aug','Sep','Oct'].
export function monthSpan(rows, today) {
  const out = [];
  for (const row of rows) {
    for (const ds of row) {
      if (ds > today) continue;
      const m = parseDate(ds).getMonth();
      if (!out.length || out[out.length - 1].m !== m) out.push({ m, short: MONTHS[m], long: MONTHS_LONG[m] });
    }
  }
  return out;
}

/* ---------- colours ---------- */
export function isHexColor(c) { return typeof c === 'string' && HEX_RE.test(c); }

export function defaultColor(index) { return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length]; }

// Explicit category.color wins (if a safe hex); otherwise by position.
export function colorFor(cat, index) {
  return cat && isHexColor(cat.color) ? cat.color : defaultColor(index);
}

// First palette colour no category is currently using (falls back to position).
export function nextFreeColor(categories) {
  const used = new Set(categories.map((c, i) => colorFor(c, i).toLowerCase()));
  for (const p of PALETTE) if (!used.has(p)) return p;
  return defaultColor(categories.length);
}

export function firstLetter(name) {
  const ch = Array.from(String(name || '').trim())[0];
  return ch ? ch.toUpperCase() : '?';
}

/* ---------- backup / restore ---------- */
function monthYear(date) {
  const d = parseDate(date);
  return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

export function summarizeState(st) {
  const n = st.sessions.length;
  const c = st.categories.length;
  let range = '';
  if (n) {
    let min = st.sessions[0].date, max = min;
    for (const s of st.sessions) { if (s.date < min) min = s.date; if (s.date > max) max = s.date; }
    const a = monthYear(min), b = monthYear(max);
    range = ', ' + (a === b ? a : a + ' to ' + b);
  }
  return n + ' session' + (n === 1 ? '' : 's') + range + ' · ' + c + ' categor' + (c === 1 ? 'y' : 'ies');
}

// Validate backup JSON text. Returns {ok:true, state, summary} or {ok:false, error}.
export function validateBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'That file is not valid JSON.' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'That file is not a Trained backup.' };
  if (data.schemaVersion !== 1) return { ok: false, error: 'Unsupported backup version.' };
  if (!Array.isArray(data.categories) || !Array.isArray(data.sessions)) return { ok: false, error: 'Backup is missing its categories or sessions.' };
  if (data.weights !== undefined && !Array.isArray(data.weights)) return { ok: false, error: 'Backup has a malformed weights list.' };
  for (const c of data.categories) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string') {
      return { ok: false, error: 'Backup has a category without an id or name.' };
    }
  }
  for (const s of data.sessions) {
    if (!s || typeof s !== 'object' || !isValidDate(s.date)) return { ok: false, error: 'Backup has a session with a bad date.' };
    if (typeof s.categoryId !== 'string') return { ok: false, error: 'Backup has a session without a category.' };
  }
  const st = Object.assign({}, data, { weights: data.weights || [] });
  return { ok: true, state: st, summary: summarizeState(st) };
}
