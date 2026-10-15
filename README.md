# Taekwondo Timer

Offline PWA that runs the 6 month training plan and the daily GTG sets on an iPhone.
No backend, no accounts, no analytics. All state is in `localStorage` (keys start with `tkd.`).

## Plan data

`training-plan.md` and `gtg-plan.md` are the source of truth (transcribed from the two PDFs).
`npm run parse` turns them into `src/plan.json`, which is committed. Re-run it after editing
either markdown file. The parser stops with an error on any row it does not understand.

Interpretation choices the parser makes:

- Days are numbered 1 to 7 (Mon = Day 1 ... Sun = Day 7).
- Week 4 halves sets, rounds, EMOM minutes and sprint reps, rounded up. Tests, warm-ups and the
  Day 7 10 min block are not halved.
- Rest: jumps and strength 2 min, contrast 3 min, tricks 90 s (upper end of 60 to 90 s),
  flexibility none. On Days 2 and 5 only "Fast kicks to ball" gets trick rest. Spins
  (360, 480, 540, 720, tornado) count as tricks even on power days.
- Rest also runs after the last set of an exercise, before the next one. Every rest can be skipped.
- "Calf raise, tibialis raise 3×12 each" and "Pike lift, straddle lift" run as supersets.
- GTG deload (week 4) keeps the first 4 slots of the day, which still covers A, B, C and D.
- GTG uses the plan day of the session you trained today, so finishing Day 1 at 19:30 does not
  switch the evening slots to Day 2's column.

## Completions and progress

- **Mark as completed** logs the current plan day for today's date with `manual: true`, all of its
  exercises done and no timer data, then advances like a finished session. **Undo last completion**
  removes the newest completion (manual or timed) and returns to that day. Test log entries are kept.
- Progress counts a "session" as a completed Day 1 to 6; Day 7 is GTG only. Plan days completed
  counts distinct days, so redoing a day does not count twice.
- A calendar date is active (streaks, heatmap) when a plan day was completed on it, or when all of
  that date's GTG slots were done. The heatmap half fill means "all GTG slots, no session".
- Last 7 and 28 days compare sessions with 6 planned per 7 days, counted from the first logged day
  so the first weeks are not shown as missed.
- Month goals come from each month's `Target:` line (first sentence, split on commas). Ticks are
  stored under `tkd.goals`.
- Saved data carries a schema number (`tkd.schema`); `src/lib/migrate.ts` upgrades older data in
  place on launch.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173/taekwondo-timer/
npm run build    # type check + production build in dist/
npm run preview  # serve dist/ to test the service worker
```

To try it on your phone over Wi-Fi: `npm run dev -- --host` and open the Network URL.
Wake Lock and the service worker need HTTPS, so test those on the deployed site.

## Deploy to GitHub Pages

1. Create a GitHub repository (for example `taekwondo-timer`) and push this folder to its
   `main` branch.
2. In the repository: Settings > Pages > Build and deployment > Source: **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds and publishes on every push to `main`.
   The site is at `https://<user>.github.io/<repo>/`.

## Install on iPhone

Open the site in Safari, tap Share, then **Add to Home Screen**. Open it once while online so it
caches itself; after that it works offline. New versions install the next time you open the app
online (never in the middle of a session).

Beeps use Web Audio, which iOS mutes when the ring/silent switch is on silent. Use **Test sound**
on the Train screen to check.
