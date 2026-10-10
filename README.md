# Trained

A dark-mode phone app for a handful of habits plus the gym: how long since the
last slip, uses left in a 12-month limit, weeks you hit your running target, and
nights you slept enough, next to days since each gym category. Not a workout
logger: no sets, reps, exercise weights, plans, rest timer or weight tracking.

**Live app:** https://marktran4.github.io/trained/

## Put it on your phone

1. Open the link above in Safari.
2. Share button, then **Add to Home Screen**.
3. Open it from the home screen icon. It runs full-screen like a normal app.

## What it does

- **Habit cards** (set up in settings; names stay on the phone). Each card is a
  solid colour block: big number, one context line, a gauge on the right, and an
  "On track" / "Behind" tag top-right when the habit has a goal. Gauge: arc =
  progress, white needle = pace for today, black tick = goal.
  - **Quit**: days since the last slip, best run, % clean days this goal year.
    Past a year the number reads "1y 12 days". Tapping the card opens its detail;
    **"Log a slip" is a separate button with a confirm step**, so a mis-tap never
    resets a count. Slips can be backdated (use this to seed the count) or removed.
  - **Limit**: uses in the last 12 months against a max (e.g. 3), days since the
    last one and when the oldest drops out. Same deliberate logging as Quit.
  - **Weekly** (runs): weeks hit out of weeks finished, against a goal of N of 52
    weeks with N runs a week. **Tap the card = log a run today** with Undo; "..."
    opens history, backdating and remove. A week counts as hit the moment it reaches its runs; a short week counts as missed once Sunday ends.
  - **Sleep**: % of nights at or over your hours this goal year, the last 30 days,
    and nights with no data (left out of the %, and shown so gaps can't flatter it).
    Tap for the last 7 nights with Good / Short overrides.
  - **Discreet**: a habit can be flagged discreet; it shows as one striped line
    until tapped, and hides again on the next app open.
- **Sync from Health** (the circular-arrows button top-right): reads what the
  "Trained Sync" Shortcut copied to the clipboard (iOS asks to allow Paste) and
  stores last night's time asleep plus any Watch runs. Re-syncing is harmless.
- **Goal year**: 52 weeks from a Monday you set in settings (defaults to the week
  you add your first habit), then it rolls on to the next 52 weeks.
- **Gym strip**: one colour tile per category, stalest first, big days-since
  number. **Tap a tile to log today** (tap again on the same day to remove).
  **One entry per day**: logging onto a day with a different category asks first.
- **History**: last 8 weeks of gym days as a Monday-first calendar. Tap any day to
  change its category, edit the note, remove it, or log onto it (this is also how
  to backdate a gym session).
- **Undo** on every log, change, remove, override, sync and restore.
- **Settings** (gear): habits (add, rename, colour, discreet, goals, reorder,
  delete), goal-year start, gym categories, **Back up** (JSON via the share sheet)
  and **Restore** (preview, confirm, replace; previous data stashed under
  `trained.v1.pre-restore`). Restoring a backup made before habits existed keeps
  your current habits.
- A red banner appears if the browser refuses to save.

## Health Shortcut ("Trained Sync")

A web app can't read Apple Health, and iOS keeps a home-screen app's storage
apart from Safari's, so a Shortcut opening a URL never reaches the app. The
Shortcut copies the data instead and the app pastes it on one tap.

1. Shortcuts app, new Shortcut "Trained Sync".
2. **Find Health Samples**: Type Sleep Analysis, Start Date is in the last 1 days,
   sort by Start Date, oldest first.
3. **Repeat with Each** (Health Samples):
   - **Format Date**: Repeat Item → Start Date, ISO 8601, include time.
   - **Format Date**: Repeat Item → End Date, ISO 8601, include time.
   - **Text**: `Value|Start|End|Duration|Source` (Repeat Item → Value, the first
     formatted date, the second, Repeat Item → Duration, Repeat Item → Source).
   - **Add to Variable**: Lines.
4. **Find Workouts**: Type Running, Start Date is in the last 7 days. **Repeat with
   Each** the same way, but the Text starts with `RUN|` in place of the Value.
   Add to Variable: Lines.
5. **Combine Text**: Lines, custom separator `;;`. **Copy to Clipboard**.
6. **Show Notification**: "Copied. Open Trained and tap sync."
7. Automation tab → When my alarm is stopped → Run "Trained Sync", don't ask.

Rules the app applies: a sample starting 6pm to 2pm counts toward the night that
ends that morning (2pm to 6pm starts are naps and don't count); time asleep =
Core + Deep + REM (or "Asleep" if stages aren't split), never "In Bed"; if two
sources wrote sleep the same night (Watch and iPhone), one is used, never both,
and the one with real stages wins. Health runs under the Weekly habit's minimum
minutes are ignored; a manual tap and a Health run on the same day count once.

## Dev notes

- Files: `index.html` (markup), `styles.css`, `app.js` (DOM + state + gym, ES
  module), `logic.js` (pure date/data functions, no DOM), `habits.js` (pure habit
  maths and Health payload parsing), `habits-ui.js` (habit cards, sheets, habit
  settings), `bigshoulders-900.woff2` (Big Shoulders Display, SIL Open Font
  License, self-hosted so it works offline), `sw.js` (offline shell,
  cache-first), `manifest.webmanifest` + icons. No framework, no build step.
- Tests live outside the deploy folder: `../test/*.test.js`, run from the
  repo root with `node --test` (needs Node 20+; `package.json` marks it ESM).
- All data lives in one `localStorage` key (`trained.v1`, `schemaVersion: 1`).
  Only optional fields get added: `category.color`, `habits`, `habitLogs`,
  `sleepNights`, `goalYearStart`. `weights` from the old
  weight tab is kept in storage and in backups but never shown. Other keys:
  `trained.v1.lastBackup`, `trained.v1.pre-restore`, `trained.v1.corrupt-backup`.
- All dates are local dates (never UTC). Legacy days with several sessions show
  the last one; days-since still counts all of them.
- Icons are generated by `../make_icons.py` (pure stdlib, no PIL).
- Source of truth lives in `~/side-projects/gym-tracker/`; the `trained` repo is
  just the GitHub Pages deploy target.

## Redeploy

```
python3 deploy.py "commit message"
```
