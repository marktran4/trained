// Pure habit logic for Trained (HABITS-SPEC.md). No DOM, no storage, no clock reads:
// callers pass `today` ('YYYY-MM-DD', local). Dates are LOCAL calendar dates.
import { addDays, dateDiffDays, mondayOf, isValidDate, toLocalDate, isHexColor } from './logic.js';

export const HABIT_TYPES = ['abstain', 'limit', 'frequency', 'rate'];
export const TYPE_LABEL = { abstain: 'Quit', limit: 'Limit', frequency: 'Weekly', rate: 'Sleep' };
// Habit colours sit apart from the gym palette's first five so cards and tiles don't share a colour.
export const HABIT_PALETTE = ['#ef7d4a', '#b8bcc6', '#8f96a3', '#9bcb4b', '#9fd8e8', '#d9c39a'];
export const DEFAULT_TARGETS = {
  abstain: null,
  limit: { max: 3, windowDays: 365 },
  frequency: { perWeek: 2, weeksPerYear: 46, minMinutes: 10 },
  rate: { minHours: 7.5, ratePct: 90 }
};
export const YEAR_DAYS = 364; // a goal year is 52 Monday-first weeks

/* ---------- goal year ---------- */
// The goal year starts on a Monday and runs 52 weeks; after that it rolls on to the
// next 52 weeks, so "this goal year" always means the current one.
export function goalYear(start, today) {
  if (!isValidDate(start)) return null;
  start = mondayOf(start);
  if (today < start) return { start, end: addDays(start, YEAR_DAYS - 1), before: true, elapsed: 0, weekIndex: -1, completedWeeks: 0, yearNumber: 1 };
  const k = Math.floor(dateDiffDays(start, today) / YEAR_DAYS);
  const s = addDays(start, k * YEAR_DAYS);
  const elapsed = dateDiffDays(s, today) + 1; // days so far, today included
  const weekIndex = Math.floor((elapsed - 1) / 7);
  return { start: s, end: addDays(s, YEAR_DAYS - 1), before: false, elapsed, weekIndex, completedWeeks: weekIndex, yearNumber: k + 1 };
}

const uniqSorted = (dates) => Array.from(new Set(dates)).sort();

/* ---------- abstain (quit) ---------- */
// `dates`: slip dates. Clean run = whole days after the last slip, up to today.
export function abstainStats(dates, today, gy) {
  const ds = uniqSorted(dates.filter((d) => d <= today));
  if (!ds.length) return { since: null, longest: null, cleanPct: null, last: null, slipsThisYear: 0, currentIsLongest: false };
  const last = ds[ds.length - 1];
  const since = dateDiffDays(last, today);
  let longest = since;
  for (let i = 1; i < ds.length; i++) longest = Math.max(longest, dateDiffDays(ds[i - 1], ds[i]) - 1);
  let cleanPct = null, slipsThisYear = 0;
  if (gy && !gy.before) {
    slipsThisYear = ds.filter((d) => d >= gy.start).length;
    cleanPct = Math.round((gy.elapsed - slipsThisYear) / gy.elapsed * 100);
  }
  return { since, longest, cleanPct, last, slipsThisYear, currentIsLongest: since >= longest };
}

/* ---------- limit ---------- */
// Rolling window: a use on day D counts until D + windowDays - 1, and "frees up" on D + windowDays.
export function limitStats(dates, today, target) {
  const max = (target && target.max) || 3, win = (target && target.windowDays) || 365;
  const ds = dates.filter((d) => d <= today).sort();
  const within = ds.filter((d) => dateDiffDays(d, today) < win);
  const last = ds.length ? ds[ds.length - 1] : null;
  return {
    used: within.length, max,
    since: last ? dateDiffDays(last, today) : null,
    last,
    nextFree: within.length ? addDays(within[0], win) : null,
    ok: within.length <= max
  };
}

/* ---------- frequency (runs) ---------- */
// Runs per day: a Health run and a manual tap on the same day are usually the same
// run, so the day counts max(health, manual), not the sum.
export function runsPerDay(logs, minMinutes = 0) {
  const h = new Map(), m = new Map();
  for (const l of logs) {
    if (l.source === 'health') {
      if (l.minutes != null && l.minutes < minMinutes) continue;
      h.set(l.date, (h.get(l.date) || 0) + 1);
    } else m.set(l.date, (m.get(l.date) || 0) + 1);
  }
  const out = new Map();
  for (const d of new Set([...h.keys(), ...m.keys()])) out.set(d, Math.max(h.get(d) || 0, m.get(d) || 0));
  return out;
}

export function frequencyStats(logs, today, gy, target) {
  const t = Object.assign({}, DEFAULT_TARGETS.frequency, target || {});
  const perDay = runsPerDay(logs.filter((l) => l.date <= today), t.minMinutes);
  const weekCount = (monday) => { let n = 0; for (let i = 0; i < 7; i++) n += perDay.get(addDays(monday, i)) || 0; return n; };
  const thisWeek = weekCount(mondayOf(today));
  if (!gy || gy.before) return { thisWeek, weeksHit: 0, weeksCounted: 0, paceNeed: 0, ok: null, maxPossible: t.weeksPerYear, perWeek: t.perWeek, weeksPerYear: t.weeksPerYear, weeks: [] };
  const weeks = [];
  for (let w = 0; w <= gy.weekIndex; w++) weeks.push(weekCount(addDays(gy.start, w * 7)));
  // A week counts as soon as it's hit (it can't be un-hit without removing a run), or as a
  // miss once its Sunday has ended. Pace only looks at finished weeks. (Mark, 2026-10-11)
  const done = gy.completedWeeks;
  const currentHit = (weeks[gy.weekIndex] || 0) >= t.perWeek;
  const weeksHit = weeks.slice(0, done).filter((n) => n >= t.perWeek).length + (currentHit ? 1 : 0);
  const weeksCounted = done + (currentHit ? 1 : 0);
  const paceNeed = Math.ceil(done * t.weeksPerYear / 52);
  return { thisWeek, weeksHit, weeksCounted, paceNeed, ok: weeksHit >= paceNeed, maxPossible: weeksHit + (52 - weeksCounted), perWeek: t.perWeek, weeksPerYear: t.weeksPerYear, weeks };
}

/* ---------- rate (sleep) ---------- */
// A night is good / short / null (no data). A manual override beats Health minutes.
export function nightResult(n, minMinutes) {
  if (!n) return null;
  if (n.override === 'good' || n.override === 'short') return n.override;
  if (typeof n.asleepMin === 'number') return n.asleepMin >= minMinutes ? 'good' : 'short';
  return null;
}

export function rateStats(nights, today, gy, target) {
  const t = Object.assign({}, DEFAULT_TARGETS.rate, target || {});
  const minMin = Math.round(t.minHours * 60);
  const byDate = new Map(nights.map((n) => [n.date, n]));
  const window = (from, days) => {
    let good = 0, known = 0;
    for (let i = 0; i < days; i++) {
      const r = nightResult(byDate.get(addDays(from, i)), minMin);
      if (r) { known++; if (r === 'good') good++; }
    }
    return { pct: known ? Math.round(good / known * 100) : null, nodata: days - known, known };
  };
  const year = gy && !gy.before ? window(gy.start, gy.elapsed) : { pct: null, nodata: 0, known: 0 };
  const d30 = window(addDays(today, -29), 30);
  const lastNight = byDate.get(today) || null;
  return {
    pct: year.pct, nodata: year.nodata, d30: d30.pct,
    last: lastNight, lastResult: nightResult(lastNight, minMin),
    ok: year.pct == null ? null : year.pct >= t.ratePct,
    minMinutes: minMin, ratePct: t.ratePct
  };
}

/* ---------- Health payload (from the iOS Shortcut, via the clipboard) ---------- */
// Lines joined by ";;" (or newlines). Sleep: "Value|Start|End|Duration|Source".
// Runs: "RUN|Start|End|Duration|Source". Start/End ideally ISO 8601.
export function toDateTime(s) {
  if (!s) return null;
  let d = new Date(s);
  if (!isNaN(d)) return d;
  d = new Date(String(s).replace(/\s+at\s+/i, ' ').replace(/(\d)\s*(am|pm)/i, '$1 $2'));
  return isNaN(d) ? null : d;
}

export function durationMinutes(s) {
  if (s == null || s === '') return null;
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/))) return m[3] != null ? +m[1] * 60 + +m[2] + +m[3] / 60 : +m[1] * 60 + +m[2];
  const h = s.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/i), mi = s.match(/(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)\b/i);
  if (h || mi) return (h ? +h[1] * 60 : 0) + (mi ? +mi[1] : 0);
  if (/^\d+(\.\d+)?$/.test(s)) return +s > 1000 ? +s / 60 : +s; // a big bare number is seconds
  return null;
}

export function sleepStage(v) {
  const x = String(v || '').toLowerCase();
  if (x.includes('in bed') || x === 'inbed') return 'inbed';
  if (x.includes('awake')) return 'awake';
  if (x.includes('core')) return 'core';
  if (x.includes('deep')) return 'deep';
  if (x.includes('rem')) return 'rem';
  if (x.includes('asleep') || x.includes('unspecified')) return 'asleep';
  return null;
}

// Returns { nights: [{date, asleepMin, source, hasStages}], runs: [{date, minutes, ext}], samples, ignored }.
// Night = the date you wake: a sample starting 6pm..2pm belongs to the night ending that
// morning; samples starting 2pm..6pm are naps and don't count.
export function parseHealthPayload(raw) {
  const out = { nights: [], runs: [], samples: 0, ignored: 0 };
  if (typeof raw !== 'string') return out;
  const per = new Map(); // date -> source -> {stages:min, unspecified:min}
  for (const line of raw.split(/;;|\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const p = line.split('|').map((x) => x.trim());
    if (p.length < 2) { out.ignored++; continue; }
    const start = toDateTime(p[1]), end = toDateTime(p[2]);
    let min = start && end ? (end - start) / 60000 : durationMinutes(p[3]);
    const source = p[4] || 'Health';
    if (/^run(ning)?$/i.test(p[0])) {
      if (!start) { out.ignored++; continue; }
      out.samples++;
      out.runs.push({ date: toLocalDate(start), minutes: min == null ? null : Math.round(min), ext: start.toISOString() });
      continue;
    }
    const st = sleepStage(p[0]);
    if (!st) { out.ignored++; continue; }
    out.samples++;
    if (st === 'inbed' || st === 'awake' || !start || min == null || min <= 0) continue;
    const h = start.getHours();
    if (h >= 14 && h < 18) continue; // nap
    const date = toLocalDate(new Date(start.getTime() + 6 * 3600000));
    if (!per.has(date)) per.set(date, new Map());
    const bySrc = per.get(date);
    if (!bySrc.has(source)) bySrc.set(source, { stages: 0, unspecified: 0 });
    bySrc.get(source)[st === 'asleep' ? 'unspecified' : 'stages'] += min;
  }
  for (const [date, bySrc] of per) {
    // One source per night, never a sum (Watch + iPhone would double-count).
    // A source with real stages wins; within a source, stages replace "unspecified".
    let best = null;
    for (const [source, v] of bySrc) {
      const hasStages = v.stages > 0;
      const total = hasStages ? v.stages : v.unspecified;
      if (!best || (hasStages && !best.hasStages) || (hasStages === best.hasStages && total > best.asleepMin)) best = { date, asleepMin: Math.round(total), source, hasStages };
    }
    out.nights.push(best);
  }
  out.nights.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

// Merge parsed Health data into copies of the lists. Idempotent: re-syncing the same
// payload changes nothing. Overrides survive; manual runs are kept.
export function applyHealth(parsed, sleepNights, habitLogs, runHabitId, today, makeId) {
  const nights = sleepNights.map((n) => Object.assign({}, n));
  const logs = habitLogs.slice();
  let nightsChanged = 0, runsAdded = 0;
  for (const n of parsed.nights) {
    if (n.date > today) continue;
    const ex = nights.find((x) => x.date === n.date);
    if (ex) {
      if (ex.asleepMin !== n.asleepMin) { ex.asleepMin = n.asleepMin; ex.source = 'health'; nightsChanged++; }
    } else { nights.push({ date: n.date, asleepMin: n.asleepMin, source: 'health' }); nightsChanged++; }
  }
  if (runHabitId) {
    for (const r of parsed.runs) {
      if (r.date > today) continue;
      if (logs.some((l) => l.habitId === runHabitId && l.ext === r.ext)) continue;
      const log = { id: makeId(), habitId: runHabitId, date: r.date, source: 'health', ext: r.ext };
      if (r.minutes != null) log.minutes = r.minutes;
      logs.push(log);
      runsAdded++;
    }
  }
  return { sleepNights: nights, habitLogs: logs, nightsChanged, runsAdded };
}

/* ---------- display helpers ---------- */
// Past a year: "1y 12" (the unit line adds "days").
export function yearsDays(n) { return n >= 365 ? Math.floor(n / 365) + 'y ' + (n % 365) : String(n); }
export function hoursText(min) { return (Math.round(min / 6) / 10).toFixed(1) + 'h'; }

/* ---------- validation (backup / restore) ---------- */
export function validateHabitData(data) {
  if (data.habits !== undefined) {
    if (!Array.isArray(data.habits)) return 'Backup has a malformed habits list.';
    for (const h of data.habits) {
      if (!h || typeof h.id !== 'string' || !h.id || typeof h.name !== 'string' || !HABIT_TYPES.includes(h.type)) return 'Backup has a habit without an id, name or type.';
      if (h.color !== undefined && !isHexColor(h.color)) return 'Backup has a habit with a bad colour.';
    }
  }
  if (data.habitLogs !== undefined) {
    if (!Array.isArray(data.habitLogs)) return 'Backup has a malformed habit log.';
    for (const l of data.habitLogs) if (!l || typeof l.habitId !== 'string' || !isValidDate(l.date)) return 'Backup has a habit log entry with a bad date.';
  }
  if (data.sleepNights !== undefined) {
    if (!Array.isArray(data.sleepNights)) return 'Backup has a malformed sleep list.';
    for (const n of data.sleepNights) if (!n || !isValidDate(n.date)) return 'Backup has a sleep night with a bad date.';
  }
  if (data.goalYearStart !== undefined && data.goalYearStart !== null && !isValidDate(data.goalYearStart)) return 'Backup has a bad goal-year start.';
  return null;
}

export function summarizeHabits(st) {
  const n = Array.isArray(st.habits) ? st.habits.length : 0;
  if (!n) return '';
  const logs = Array.isArray(st.habitLogs) ? st.habitLogs.length : 0;
  const nights = Array.isArray(st.sleepNights) ? st.sleepNights.length : 0;
  return n + ' habit' + (n === 1 ? '' : 's') + ', ' + logs + ' habit log' + (logs === 1 ? '' : 's') + ', ' + nights + ' night' + (nights === 1 ? '' : 's');
}
