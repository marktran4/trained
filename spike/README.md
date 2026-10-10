# Shortcut spike (HABITS-SPEC.md → Health ingest)

Throwaway. Answers three questions before any habits code gets written:

1. **Handoff:** when a Shortcut opens a URL, does the data land in the *installed* home-screen
   app, or only in Safari? (Expected, unconfirmed: Safari only, because iOS keeps a web app's storage separate.)
2. **Fallback:** if not, does a one-tap "Paste from Shortcut" in the installed app work?
3. **Sleep data:** does Shortcuts expose the Watch's stages (Core / Deep / REM) separately from
   "In Bed", and does more than one source write sleep (double-count risk)?

Live at **https://marktran4.github.io/trained/spike/**. It's a separate home-screen app ("Spike")
with its own storage and its own pass-through service worker, so it never touches Trained's data
or cache. Data rides in the URL hash, which browsers never send to the server. Delete the
`spike/` folder from the `marktran4/trained` repo when done.

## 1. Install the test app

Safari → open the link above → Share → **Add to Home Screen** → name it **Spike**.

## 2. Quick test (2 minutes, no Health)

New Shortcut, 4 actions:

1. **Text**: `hello`
2. **Copy to Clipboard** (input: Text)
3. **Text**: `https://marktran4.github.io/trained/spike/#ingest=hello`
4. **Open URLs** (input: the second Text)

Run it. Note where it opens (Safari = amber badge, Spike app = teal). Then open the **Spike icon**
and read the verdict. Tap **Paste from Shortcut** too.

## 3. Sleep test (about 8 minutes)

New Shortcut "Spike Sleep":

1. **Find Health Samples** → Type **Sleep Analysis**, filter **Start Date is in the last 1 days**,
   Sort by **Start Date**, **Oldest First**, no limit.
2. **Repeat with Each** (input: Health Samples). Inside the repeat:
   1. **Format Date** → Date = *Repeat Item* → tap it → **Start Date**. Date Format **ISO 8601**,
      Include ISO 8601 Time **on**.
   2. **Format Date** → same, but *Repeat Item* → **End Date**.
   3. **Text**: `[Repeat Item → Value]|[Formatted Date]|[Formatted Date 2]|[Repeat Item → Duration]|[Repeat Item → Source]`
      (tap each variable to choose the property; if a property isn't offered, leave that slot empty
      but keep the `|` separators)
3. After **End Repeat**: **Combine Text** → Repeat Results, separator **Custom** `;;`
4. **Copy to Clipboard** (input: Combined Text)
5. **URL Encode** (input: Combined Text)
6. **Text**: `https://marktran4.github.io/trained/spike/#ingest=` then the **URL Encoded Text** variable
7. **Open URLs** (input: that Text)

Run it in the morning (it reads the last 24 hours). Then open the Spike app: read the verdict,
tap Paste, and screenshot the verdict plus the sleep table. The page shows, per source:
time asleep (Core + Deep + REM + unspecified), whether stages are split, and the raw lines.

## What each result means for the build

| Result | Build decision |
|---|---|
| Verdict PASS (URL entry written in the app) | URL handoff. Fully automatic each morning. |
| URL lands in Safari only, Paste works | Shortcut copies; Trained gets a one-tap "Sync from Health" paste button. |
| Paste also fails | Manual good/short tap; Shortcut only shows the hours as a notification. |
| Stages split (Core/Deep/REM) | Metric stays "time asleep", as specced. |
| No stage split, only "Asleep" | Use "Asleep" total. If only "In Bed": revisit the 7.5h bar. |
| Two sources (Watch + iPhone) | Ingest counts one source only (the Watch). |

## Optional: runs

Add a second Shortcut later with **Find Workouts** → Type Running, last 7 days, to confirm
workouts are readable the same way. Not needed to decide the handoff.
