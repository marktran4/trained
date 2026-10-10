// Habit cards, sheets and settings (HABITS-SPEC.md, main screen G2). DOM only;
// the maths lives in habits.js. app.js owns state, storage, undo and the gym.
import { addDays, mondayOf, isValidDate, parseDate } from './logic.js';
import {
  HABIT_TYPES, TYPE_LABEL, HABIT_PALETTE, DEFAULT_TARGETS, goalYear, abstainStats, limitStats,
  frequencyStats, rateStats, nightResult, parseHealthPayload, applyHealth, yearsDays, hoursText
} from './habits.js';
import { PALETTE } from './logic.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayMonth = (d) => { const x = parseDate(d); return x.getDate() + ' ' + MONTHS[x.getMonth()]; };
const wdDayMonth = (d) => WD[parseDate(d).getDay()] + ' ' + dayMonth(d);
const MAX_HABITS = 8;
const INK = '#0b0b0b', NEEDLE = '#ffffff', TRACK = 'rgba(11,11,11,.18)', MINOR = 'rgba(11,11,11,.4)';

export function initHabits(ctx) {
  const { getState, save, rerender, showToast, askConfirm, snapState, escapeHtml, today, genId, openSettings } = ctx;
  const $ = (id) => document.getElementById(id);
  const habitsEl = $('habits');
  const sheet = $('habitSheet'), sheetBody = $('habitSheetBody'), overlay = $('habitOverlay');
  const revealed = new Set(); // discreet habits shown this session only
  let sheetFor = null, sheetStep = 'main';

  /* ---------- state access ---------- */
  const st = () => getState();
  const habits = () => (Array.isArray(st().habits) ? st().habits : []);
  const logsFor = (id) => (st().habitLogs || []).filter((l) => l.habitId === id);
  const habitById = (id) => habits().find((h) => h.id === id);
  const target = (h) => Object.assign({}, DEFAULT_TARGETS[h.type] || {}, h.target || {});
  const gy = () => goalYear(st().goalYearStart, today());
  const runHabit = () => habits().find((h) => h.type === 'frequency') || null;
  function ensureLists() {
    const s = st();
    if (!Array.isArray(s.habits)) s.habits = [];
    if (!Array.isArray(s.habitLogs)) s.habitLogs = [];
    if (!Array.isArray(s.sleepNights)) s.sleepNights = [];
  }
  function commit(msg, snap) { save(); rerender(); if (msg) showToast(msg, snap); }

  /* ---------- gauge ---------- */
  function arc(cx, cy, r, a0, a1) {
    const p = (a) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2);
  }
  // arc = progress; ticks [{f, color, w}]; segs {n, on} for the limit gauge.
  function gauge({ frac = 0, ticks = [], segs = null }) {
    const cx = 80, cy = 76, r = 58, A0 = 135, SW = 270, w = 12;
    const ang = (f) => A0 + SW * Math.max(0, Math.min(1, f));
    const at = (f, rad) => { const a = ang(f) * Math.PI / 180; return [(cx + rad * Math.cos(a)).toFixed(2), (cy + rad * Math.sin(a)).toFixed(2)]; };
    let s = '<svg viewBox="0 4 160 120" aria-hidden="true">';
    if (segs) {
      const g = 8, each = (SW - g * (segs.n - 1)) / segs.n;
      for (let i = 0; i < segs.n; i++) { const a = A0 + i * (each + g); s += '<path d="' + arc(cx, cy, r, a, a + each) + '" style="fill:none;stroke:' + (i < segs.on ? INK : TRACK) + ';stroke-width:' + w + '"/>'; }
    } else {
      s += '<path d="' + arc(cx, cy, r, A0, A0 + SW) + '" style="fill:none;stroke:' + TRACK + ';stroke-width:' + w + ';stroke-linecap:round"/>';
      if (frac > 0) s += '<path d="' + arc(cx, cy, r, A0, ang(frac)) + '" style="fill:none;stroke:' + INK + ';stroke-width:' + w + ';stroke-linecap:round"/>';
      for (let i = 0; i <= 10; i++) { const [x1, y1] = at(i / 10, r - 13), [x2, y2] = at(i / 10, r - 9); s += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" style="stroke:' + MINOR + ';stroke-width:1.2"/>'; }
    }
    for (const t of ticks) { const [x1, y1] = at(t.f, r - 16), [x2, y2] = at(t.f, r + 8); s += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" style="stroke:' + t.color + ';stroke-width:' + (t.w || 3) + ';stroke-linecap:round"/>'; }
    return s + '</svg>';
  }

  /* ---------- card models ---------- */
  function model(h) {
    const t = today(), g = gy(), tg = target(h);
    const dates = logsFor(h.id).map((l) => l.date);
    if (h.type === 'abstain') {
      const s = abstainStats(dates, t, g);
      if (s.since == null) return { ok: null, num: '–', unit: 'no slips<br>logged', ctx: 'Tap to log your last one and start the count', gauge: gauge({}), dcap: 'of 1 year' };
      const best = s.currentIsLongest ? 'Best run yet' : 'Best ' + s.longest + 'd';
      return { ok: null, num: yearsDays(s.since), unit: (s.since === 1 ? 'day' : 'days') + '<br>clean', ctx: best + (s.cleanPct != null ? ' · ' + s.cleanPct + '% clean this year' : ''), gauge: gauge({ frac: s.since / 365 }), dcap: 'of 1 year' };
    }
    if (h.type === 'limit') {
      const s = limitStats(dates, t, tg);
      const ctx = 'Last 12 months' + (s.since != null ? ' · ' + s.since + 'd since' : '') + (s.nextFree ? ' · frees up ' + dayMonth(s.nextFree) : '');
      return { ok: s.ok, num: String(s.used), unit: 'of ' + s.max + '<br>used', ctx, gauge: gauge({ segs: { n: Math.min(Math.max(s.max, 1), 8), on: Math.min(s.used, s.max) } }), dcap: '12 months' };
    }
    if (h.type === 'frequency') {
      const s = frequencyStats(logsFor(h.id), t, g, tg);
      if (!g || g.before) return { ok: null, num: String(s.thisWeek), unit: 'of ' + s.perWeek + '<br>this week', ctx: g ? 'Goal year starts ' + dayMonth(g.start) : 'Set the goal-year start in settings', gauge: gauge({}), dcap: 'weeks of 52', more: true };
      return {
        ok: s.ok, num: String(s.weeksHit), unit: 'of ' + s.completedWeeks + '<br>weeks hit',
        ctx: s.thisWeek + ' of ' + s.perWeek + ' this week · pace needs ' + s.paceNeed,
        gauge: gauge({ frac: s.weeksHit / 52, ticks: [{ f: s.weeksPerYear / 52, color: INK }, { f: s.paceNeed / 52, color: NEEDLE, w: 4 }] }),
        dcap: 'weeks of 52', more: true
      };
    }
    const s = rateStats(st().sleepNights || [], t, g, tg);
    const last = s.last ? (s.last.override ? (s.last.override === 'good' ? 'marked good' : 'marked short') : (typeof s.last.asleepMin === 'number' ? hoursText(s.last.asleepMin) : 'no data')) : 'not synced';
    const parts = ['Last night ' + last];
    if (s.d30 != null) parts.push('30 days ' + s.d30 + '%');
    if (g && !g.before && s.nodata) parts.push(s.nodata + ' no data');
    return {
      ok: s.ok, num: s.pct == null ? '–' : s.pct + '%', unit: 'of nights<br>' + tg.minHours + 'h+', ctx: parts.join(' · '),
      gauge: gauge({ frac: s.pct == null ? 0 : (s.pct - 70) / 30, ticks: [{ f: (tg.ratePct - 70) / 30, color: INK }] }),
      dcap: '70 to 100%'
    };
  }

  /* ---------- render ---------- */
  function render() {
    const list = habits();
    const g = gy(), t = today();
    $('headDate').textContent = (g && !g.before ? 'Wk ' + (g.weekIndex + 1) + ' · ' : '') + wdDayMonth(t);
    if (!list.length) {
      habitsEl.innerHTML = '<div class="hhidden" role="button" tabindex="0" data-setup="1"><span class="hlabel">Habits</span><span>None yet · set up in settings</span></div>';
      return;
    }
    habitsEl.innerHTML = list.map((h) => {
      const name = escapeHtml(h.name);
      if (h.discreet && !revealed.has(h.id)) {
        return '<div class="hhidden" role="button" tabindex="0" data-reveal="' + escapeHtml(h.id) + '" aria-label="' + name + ', hidden. Tap to show."><span class="hlabel">' + name + '</span><span>Hidden · tap to show</span></div>';
      }
      const m = model(h);
      const tag = m.ok == null ? '' : '<span class="htag">' + (m.ok ? 'On track' : 'Behind') + '</span>';
      const more = m.more ? '<button type="button" class="hmore" data-more="' + escapeHtml(h.id) + '" aria-label="' + name + ': history and earlier days">&hellip;</button>' : '';
      return '<div class="hcard" role="button" tabindex="0" data-habit="' + escapeHtml(h.id) + '" style="background:' + h.color + '" aria-label="' + name + '">' +
        '<div class="htop"><span class="hlabel">' + name + '</span><span class="hright">' + more + tag + '</span></div>' +
        '<div class="hbody"><div class="hleft"><div class="hnum">' + m.num + '<small>' + m.unit + '</small></div><div class="hctx">' + m.ctx + '</div></div>' +
        '<div class="hdial">' + m.gauge + '<div class="hdcap">' + m.dcap + '</div></div></div></div>';
    }).join('') + '<div class="hlegend"><span><i class="arc"></i>arc = progress</span><span><i class="needle"></i>white = pace for today</span><span><i class="goal"></i>black tick = goal</span></div>';
  }

  function activate(el) {
    if (el.dataset.setup) { openSettings(); return; }
    if (el.dataset.reveal) { revealed.add(el.dataset.reveal); render(); return; }
    if (el.dataset.more) { openSheet(el.dataset.more, 'main'); return; }
    const h = habitById(el.dataset.habit);
    if (!h) return;
    if (h.type === 'frequency') logRun(h, today());
    else openSheet(h.id, 'main');
  }
  habitsEl.addEventListener('click', (e) => {
    const el = e.target.closest('[data-more]') || e.target.closest('[data-reveal],[data-habit],[data-setup]');
    if (el) { e.stopPropagation(); activate(el); }
  });
  habitsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('button')) return;
    const el = e.target.closest('[data-reveal],[data-habit],[data-setup]');
    if (el) { e.preventDefault(); activate(el); }
  });

  /* ---------- logging ---------- */
  function addLog(h, date, extra) {
    ensureLists();
    const snap = snapState();
    st().habitLogs.push(Object.assign({ id: genId(), habitId: h.id, date, source: 'manual' }, extra || {}));
    return snap;
  }
  function logRun(h, date) {
    const snap = addLog(h, date);
    commit('Run logged ' + (date === today() ? 'for today' : wdDayMonth(date)), snap);
  }
  function removeLog(id) {
    const snap = snapState();
    st().habitLogs = st().habitLogs.filter((l) => l.id !== id);
    commit('Removed', snap);
  }

  /* ---------- sheets ---------- */
  function openSheet(id, step) {
    sheetFor = id; sheetStep = step || 'main';
    renderSheet();
    overlay.classList.add('show'); sheet.classList.add('show');
    const first = sheet.querySelector('button'); if (first) first.focus({ preventScroll: true });
  }
  function closeSheet() { overlay.classList.remove('show'); sheet.classList.remove('show'); sheetFor = null; }
  overlay.addEventListener('click', closeSheet);

  const btn = (act, label, cls, extra) => '<button type="button" class="btn ' + (cls || '') + '" data-act="' + act + '"' + (extra || '') + '>' + label + '</button>';
  function recentList(h, n) {
    const logs = logsFor(h.id).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, n);
    if (!logs.length) return '';
    return '<div class="label">Recent</div><div class="hlist">' + logs.map((l) =>
      '<div class="hlistrow"><span>' + wdDayMonth(l.date) + (l.source === 'health' ? ' <em>Health' + (l.minutes ? ', ' + l.minutes + ' min' : '') + '</em>' : '') + '</span>' +
      '<button type="button" class="textbtn danger" data-act="remove" data-id="' + escapeHtml(l.id) + '">Remove</button></div>').join('') + '</div>';
  }
  function dateField() {
    const t = today();
    return '<input type="date" id="habitDate" max="' + t + '" value="' + addDays(t, -1) + '" aria-label="Day">';
  }

  function renderSheet() {
    const h = habitById(sheetFor);
    if (!h && sheetFor !== '__sleep') { closeSheet(); return; }
    const t = today(), g = gy();
    if (sheetFor === '__sleep' || h.type === 'rate') return renderSleepSheet(h);
    let html = '<h3>' + escapeHtml(h.name) + '</h3>';
    if (h.type === 'abstain' || h.type === 'limit') {
      const verb = h.type === 'abstain' ? 'slip' : 'use';
      const dates = logsFor(h.id).map((l) => l.date);
      const warn = h.type === 'abstain'
        ? 'This resets the counter to 0. Your best run and % clean stay.'
        : (() => { const s = limitStats(dates, t, target(h)); return 'That makes ' + (s.used + 1) + ' of ' + s.max + ' in the last 12 months.'; })();
      if (sheetStep === 'confirm') {
        html += '<p class="sheetbody">' + warn + '</p><div class="sheetactions">' + btn('back', 'Cancel') + btn('confirm', 'Log a ' + verb, 'solid-danger') + '</div>';
      } else if (sheetStep === 'date') {
        html += '<div class="label">Which day?</div>' + dateField() + '<p class="sheetbody">' + warn + '</p><div class="sheetactions">' + btn('back', 'Cancel') + btn('confirmdate', 'Log a ' + verb, 'solid-danger') + '</div>';
      } else {
        html += '<ul class="hstats">';
        if (h.type === 'abstain') {
          const s = abstainStats(dates, t, g);
          html += s.since == null ? '<li>No slips logged yet. Log your last one on an earlier day to start the count.</li>'
            : '<li><b>' + s.since + '</b> ' + (s.since === 1 ? 'day' : 'days') + ' clean</li><li>' + (s.currentIsLongest ? 'Best run yet' : 'Best run ' + s.longest + ' days') + '</li>' +
              (s.cleanPct != null ? '<li>' + s.cleanPct + '% clean days this goal year</li>' : '') + '<li>Last slip ' + wdDayMonth(s.last) + '</li>';
        } else {
          const s = limitStats(dates, t, target(h));
          html += '<li><b>' + s.used + ' of ' + s.max + '</b> used in the last 12 months</li>' +
            (s.since != null ? '<li>' + s.since + ' days since last</li>' : '<li>None logged</li>') +
            (s.nextFree ? '<li>Next one frees up ' + wdDayMonth(s.nextFree) + '</li>' : '');
        }
        html += '</ul>' + btn('ask', 'Log a ' + verb, 'wide danger') + btn('date', 'Log a ' + verb + ' on an earlier day', 'wide') +
          (h.discreet ? btn('hide', 'Hide again', 'wide') : '') + recentList(h, 6) + btn('close', 'Close', 'wide ghost');
      }
    } else if (h.type === 'frequency') {
      const s = frequencyStats(logsFor(h.id), t, g, target(h));
      if (sheetStep === 'date') {
        html += '<div class="label">Which day?</div>' + dateField() + '<div class="sheetactions">' + btn('back', 'Cancel') + btn('rundate', 'Log a run', 'primary') + '</div>';
      } else {
        html += '<ul class="hstats"><li><b>' + s.thisWeek + ' of ' + s.perWeek + '</b> this week</li>' +
          (g && !g.before ? '<li>' + s.weeksHit + ' of ' + s.completedWeeks + ' weeks hit · pace needs ' + s.paceNeed + ' · goal ' + s.weeksPerYear + ' of 52</li><li>Still reachable: up to ' + s.maxPossible + '</li>' : '') + '</ul>' +
          btn('runtoday', 'Log a run today', 'wide primary') + btn('date', 'Log a run on an earlier day', 'wide') + recentList(h, 8) + btn('close', 'Close', 'wide ghost');
      }
    }
    sheetBody.innerHTML = html;
  }

  function renderSleepSheet(h) {
    const t = today(), tg = h ? target(h) : DEFAULT_TARGETS.rate;
    const minMin = Math.round(tg.minHours * 60);
    const s = rateStats(st().sleepNights || [], t, gy(), tg);
    const byDate = new Map((st().sleepNights || []).map((n) => [n.date, n]));
    let html = '<h3>' + escapeHtml(h ? h.name : 'Sleep') + '</h3><ul class="hstats">' +
      (s.pct != null ? '<li><b>' + s.pct + '%</b> of nights ' + tg.minHours + 'h+ this goal year (goal ' + tg.ratePct + '%)</li>' : '') +
      (s.d30 != null ? '<li>Last 30 days ' + s.d30 + '%</li>' : '') +
      (s.nodata ? '<li>' + s.nodata + ' nights with no data, left out of the %</li>' : '') + '</ul>' +
      btn('sync', 'Sync from Health', 'wide primary') +
      '<textarea id="pasteBox" class="pastebox" placeholder="Long-press here and tap Paste" hidden></textarea>' +
      '<div class="label">Last 7 nights</div><div class="hlist">';
    for (let i = 0; i < 7; i++) {
      const d = addDays(t, -i), n = byDate.get(d), r = nightResult(n, minMin);
      const hrs = n && typeof n.asleepMin === 'number' ? hoursText(n.asleepMin) : 'no data';
      const ov = n && n.override;
      html += '<div class="hlistrow night"><span>' + wdDayMonth(d) + ' <em class="' + (r || 'none') + '">' + hrs + (ov ? ' · marked ' + ov : '') + '</em></span><span class="seg mini">' +
        '<button type="button" data-act="ov" data-date="' + d + '" data-v="good"' + (ov === 'good' ? ' class="on"' : '') + '>Good</button>' +
        '<button type="button" data-act="ov" data-date="' + d + '" data-v="short"' + (ov === 'short' ? ' class="on"' : '') + '>Short</button>' +
        (ov ? '<button type="button" data-act="ov" data-date="' + d + '" data-v="">Clear</button>' : '') + '</span></div>';
    }
    html += '</div><details class="howto"><summary>Set up the Health Shortcut</summary>' + SHORTCUT_HELP + '</details>' + btn('close', 'Close', 'wide ghost');
    sheetBody.innerHTML = html;
  }

  sheetBody.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, h = habitById(sheetFor);
    if (act === 'close') return closeSheet();
    if (act === 'back') { sheetStep = 'main'; return renderSheet(); }
    if (act === 'ask') { sheetStep = 'confirm'; return renderSheet(); }
    if (act === 'date') { sheetStep = 'date'; return renderSheet(); }
    if (act === 'hide') { revealed.delete(sheetFor); closeSheet(); return render(); }
    if (act === 'remove') { removeLog(b.dataset.id); return renderSheet(); }
    if (act === 'sync') return syncFromClipboard();
    if (act === 'ov') {
      ensureLists();
      const snap = snapState(), date = b.dataset.date, v = b.dataset.v;
      let n = st().sleepNights.find((x) => x.date === date);
      if (!n) { n = { date, asleepMin: null, source: 'manual' }; st().sleepNights.push(n); }
      if (v) n.override = v; else delete n.override;
      commit(v ? 'Marked ' + v : 'Cleared', snap);
      return renderSheet();
    }
    if (!h) return;
    if (act === 'confirm') {
      const snap = addLog(h, today());
      closeSheet();
      return commit(h.type === 'abstain' ? 'Slip logged' : 'Use logged', snap);
    }
    if (act === 'confirmdate' || act === 'rundate') {
      const d = $('habitDate').value;
      if (!isValidDate(d) || d > today()) { $('habitDate').focus(); return; }
      const snap = addLog(h, d);
      closeSheet();
      return commit((h.type === 'frequency' ? 'Run' : h.type === 'abstain' ? 'Slip' : 'Use') + ' logged for ' + wdDayMonth(d), snap);
    }
    if (act === 'runtoday') { closeSheet(); return logRun(h, today()); }
  });
  sheetBody.addEventListener('paste', (e) => {
    if (e.target.id !== 'pasteBox') return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (text) { e.preventDefault(); ingest(text); }
  });

  /* ---------- Health sync (clipboard) ---------- */
  // The spike (2026-10-10) showed a Shortcut's URL never reaches the installed app,
  // but a paste does. So: the Shortcut copies, this reads the clipboard on a tap.
  function ingest(text) {
    const parsed = parseHealthPayload(text);
    if (!parsed.samples) { showToast('No Health data on the clipboard. Run the Shortcut first.'); return false; }
    ensureLists();
    const snap = snapState();
    const rh = runHabit();
    const res = applyHealth(parsed, st().sleepNights, st().habitLogs, rh ? rh.id : null, today(), genId);
    if (!res.nightsChanged && !res.runsAdded) { showToast('Already up to date'); return true; }
    st().sleepNights = res.sleepNights;
    st().habitLogs = res.habitLogs;
    const t = today(), lastN = res.sleepNights.find((n) => n.date === t);
    const bits = [];
    if (lastN && typeof lastN.asleepMin === 'number') bits.push('last night ' + hoursText(lastN.asleepMin));
    else if (res.nightsChanged) bits.push(res.nightsChanged + ' night' + (res.nightsChanged === 1 ? '' : 's'));
    if (res.runsAdded) bits.push(res.runsAdded + ' run' + (res.runsAdded === 1 ? '' : 's'));
    commit('Synced · ' + bits.join(' · '), snap);
    if (sheet.classList.contains('show')) renderSheet();
    return true;
  }
  function showPasteBox() {
    if (!sheet.classList.contains('show') || sheetStep !== 'main') openSleep();
    const box = $('pasteBox');
    if (box) { box.hidden = false; box.focus(); }
    showToast('Tap the box, then Paste');
  }
  function syncFromClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.readText) return showPasteBox();
    navigator.clipboard.readText().then((text) => { if (!ingest(text || '')) { /* toast already explains */ } }).catch(showPasteBox);
  }
  function openSleep() {
    const h = habits().find((x) => x.type === 'rate');
    openSheet(h ? h.id : '__sleep', 'main');
  }

  /* ---------- settings: habits ---------- */
  const listEl = $('habitList');
  let colorOpen = null;

  function targetInputs(h) {
    const t = target(h), id = escapeHtml(h.id);
    const num = (key, val, label, min, max, step) => '<label class="tnum">' + label + '<input type="number" inputmode="decimal" data-target="' + key + '" data-id="' + id + '" value="' + val + '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '"></label>';
    if (h.type === 'limit') return num('max', t.max, 'Max in 12 months', 0, 50);
    if (h.type === 'frequency') return num('perWeek', t.perWeek, 'Runs a week', 1, 14) + num('weeksPerYear', t.weeksPerYear, 'Weeks of 52', 1, 52) + num('minMinutes', t.minMinutes, 'Min. minutes (Health)', 0, 120);
    if (h.type === 'rate') return num('minHours', t.minHours, 'Hours asleep', 4, 12, 0.25) + num('ratePct', t.ratePct, '% of nights', 1, 100);
    return '';
  }

  function renderSettings() {
    const list = habits();
    listEl.innerHTML = list.map((h, i) => {
      const id = escapeHtml(h.id);
      let html = '<div class="catblock habitblock"><div class="catrow">' +
        '<button type="button" class="colorbtn" data-hcolor="' + id + '" aria-label="Colour for ' + escapeHtml(h.name) + '"><i style="background:' + h.color + '"></i></button>' +
        '<input type="text" class="catname" value="' + escapeHtml(h.name) + '" data-hname="' + id + '" maxlength="20" aria-label="Habit name">' +
        '<button type="button" class="catdel" data-hdel="' + id + '" aria-label="Delete ' + escapeHtml(h.name) + '">&#10005;</button></div>';
      if (colorOpen === h.id) {
        html += '<div class="palette">' + HABIT_PALETTE.concat(PALETTE).filter((c, j, a) => a.indexOf(c) === j).map((p) =>
          '<button type="button" data-hsetcolor="' + p + '" data-id="' + id + '"' + (p === h.color ? ' class="on"' : '') + ' aria-label="Colour ' + p + '"><i style="background:' + p + '"></i></button>').join('') + '</div>';
      }
      html += '<div class="habitmeta"><span class="typechip">' + TYPE_LABEL[h.type] + '</span>' +
        '<label class="check"><input type="checkbox" data-hdiscreet="' + id + '"' + (h.discreet ? ' checked' : '') + '> Discreet</label>' +
        '<span class="moves"><button type="button" class="textbtn" data-hmove="-1" data-id="' + id + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move up">&uarr;</button>' +
        '<button type="button" class="textbtn" data-hmove="1" data-id="' + id + '"' + (i === list.length - 1 ? ' disabled' : '') + ' aria-label="Move down">&darr;</button></span></div>' +
        '<div class="targets">' + targetInputs(h) + '</div></div>';
      return html;
    }).join('') || '<p class="fineprint">No habits yet. Names stay on this phone only.</p>';
    const sel = $('newHabitType');
    const hasSleep = list.some((h) => h.type === 'rate');
    sel.querySelector('option[value="rate"]').disabled = hasSleep;
    if (hasSleep && sel.value === 'rate') sel.value = 'abstain';
    const full = list.length >= MAX_HABITS;
    $('addHabit').disabled = full; $('newHabitName').disabled = full;
    $('goalStart').value = st().goalYearStart || '';
    const g = gy();
    $('goalNote').textContent = g ? 'Goal year ' + (g.yearNumber > 1 ? g.yearNumber + ' ' : '') + 'runs ' + dayMonth(g.start) + ' to ' + dayMonth(g.end) + '.' : 'Set when you add your first habit.';
  }

  listEl.addEventListener('change', (e) => {
    const s = snapState();
    const nameEl = e.target.closest('[data-hname]');
    if (nameEl) {
      const h = habitById(nameEl.dataset.hname); if (!h) return;
      const v = nameEl.value.trim();
      if (!v) { nameEl.value = h.name; return; }
      h.name = v.slice(0, 20); save(); rerender(); return;
    }
    const disc = e.target.closest('[data-hdiscreet]');
    if (disc) { const h = habitById(disc.dataset.hdiscreet); if (h) { h.discreet = disc.checked; revealed.delete(h.id); save(); rerender(); } return; }
    const tEl = e.target.closest('[data-target]');
    if (tEl) {
      const h = habitById(tEl.dataset.id); if (!h) return;
      const v = Number(tEl.value), min = Number(tEl.min), max = Number(tEl.max);
      if (!isFinite(v) || v < min || v > max) { tEl.value = target(h)[tEl.dataset.target]; return; }
      h.target = Object.assign({}, target(h), { [tEl.dataset.target]: v });
      commit('Target updated', s);
    }
  });
  listEl.addEventListener('click', async (e) => {
    const tog = e.target.closest('[data-hcolor]');
    if (tog) { colorOpen = colorOpen === tog.dataset.hcolor ? null : tog.dataset.hcolor; return renderSettings(); }
    const setc = e.target.closest('[data-hsetcolor]');
    if (setc) { const h = habitById(setc.dataset.id); if (h) { h.color = setc.dataset.hsetcolor; colorOpen = null; save(); rerender(); renderSettings(); } return; }
    const mv = e.target.closest('[data-hmove]');
    if (mv) {
      const arr = st().habits, i = arr.findIndex((h) => h.id === mv.dataset.id), j = i + Number(mv.dataset.hmove);
      if (i < 0 || j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      save(); rerender(); return renderSettings();
    }
    const del = e.target.closest('[data-hdel]');
    if (del) {
      const h = habitById(del.dataset.hdel); if (!h) return;
      const n = logsFor(h.id).length;
      const ok = await askConfirm('Delete ' + h.name + '?', (n ? 'Its ' + n + ' log entr' + (n === 1 ? 'y goes' : 'ies go') + ' too. ' : '') + (h.type === 'rate' ? 'Sleep nights are kept. ' : '') + 'You can Undo straight after.', 'Delete');
      if (!ok) return;
      const snap = snapState();
      st().habits = st().habits.filter((x) => x.id !== h.id);
      st().habitLogs = (st().habitLogs || []).filter((l) => l.habitId !== h.id);
      commit('Deleted ' + h.name, snap);
      renderSettings();
    }
  });
  $('addHabit').addEventListener('click', () => {
    const name = $('newHabitName').value.trim();
    const type = $('newHabitType').value;
    if (!name || !HABIT_TYPES.includes(type) || habits().length >= MAX_HABITS) { $('newHabitName').focus(); return; }
    if (type === 'rate' && habits().some((h) => h.type === 'rate')) return;
    ensureLists();
    const snap = snapState();
    const used = new Set(habits().map((h) => h.color));
    const color = HABIT_PALETTE.find((c) => !used.has(c)) || HABIT_PALETTE[habits().length % HABIT_PALETTE.length];
    const h = { id: genId(), type, name: name.slice(0, 20), color, discreet: false };
    if (DEFAULT_TARGETS[type]) h.target = Object.assign({}, DEFAULT_TARGETS[type]);
    st().habits.push(h);
    if (!st().goalYearStart) st().goalYearStart = mondayOf(today());
    $('newHabitName').value = '';
    commit('Added ' + h.name, snap);
    renderSettings();
  });
  $('goalStart').addEventListener('change', (e) => {
    const v = e.target.value;
    if (!isValidDate(v)) { e.target.value = st().goalYearStart || ''; return; }
    const snap = snapState();
    st().goalYearStart = mondayOf(v);
    commit('Goal year starts ' + wdDayMonth(st().goalYearStart), snap);
    renderSettings();
  });

  $('syncBtn').addEventListener('click', syncFromClipboard);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.classList.contains('show')) closeSheet(); });

  return {
    render,
    renderSettings,
    refreshSheet() { if (sheet.classList.contains('show')) renderSheet(); }
  };
}

const SHORTCUT_HELP =
  '<ol class="howtolist">' +
  '<li>Shortcuts app, new Shortcut "Trained Sync".</li>' +
  '<li><b>Find Health Samples</b>: Type Sleep Analysis, Start Date is in the last 1 days, sort Start Date oldest first.</li>' +
  '<li><b>Repeat with Each</b>: two <b>Format Date</b> actions (Repeat Item → Start Date, then End Date; ISO 8601, include time), then <b>Text</b>: <code>Value|Start|End|Duration|Source</code> using the Repeat Item properties and the two dates. Then <b>Add to Variable</b> "Lines".</li>' +
  '<li><b>Find Workouts</b>: Type Running, Start Date in the last 7 days. <b>Repeat with Each</b> the same way, but the Text starts with <code>RUN|</code> instead of the Value. Add to Variable "Lines".</li>' +
  '<li><b>Combine Text</b>: Lines, Custom separator <code>;;</code>. <b>Copy to Clipboard</b>.</li>' +
  '<li><b>Show Notification</b>: "Copied. Open Trained and tap sync."</li>' +
  '<li>Automation tab: run it when your wake-up alarm is stopped.</li>' +
  '</ol><p class="fineprint">Then in Trained, tap the sync button at the top. iOS asks once to allow Paste.</p>';
