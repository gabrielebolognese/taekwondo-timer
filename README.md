# Taekwondo Timer

Offline PWA that runs the 6 month training plan and the daily GTG sets on an iPhone.
No accounts, no analytics. All state is in IndexedDB on the phone, with an optional cloud copy on
your own Cloudflare Worker and JSON backup files.

## Plan data

`training-plan.md` and `gtg-plan.md` are the source of truth (transcribed from the two PDFs).
`npm run parse` turns them into `src/plan.json`, which is committed. Re-run it after editing
either markdown file. The parser stops with an error on any row it does not understand.

Interpretation choices the parser makes:

- Days are numbered 1 to 7 (Mon = Day 1 ... Sun = Day 7).
- Week 4 halves sets, rounds, EMOM minutes and sprint reps, rounded up. Tests, warm-ups and the
  Day 7 10 min block are not halved.
- Rest between sets and rounds: jumps and strength 2 min, contrast 3 min, tricks 90 s (upper end
  of 60 to 90 s), flexibility 30 s (the plan says none; the app gives time to reset the position).
  On Days 2 and 5 only "Fast kicks to ball" gets trick rest. Spins (360, 480, 540, 720, tornado)
  count as tricks even on power days.
- Before each exercise there is a rest as long as the longer of the two exercises' rests, and at
  least 90 s between the warm-up and the first exercise (2 min on power days).
- Per side work has a "Switch sides" countdown between left and right: 10 s for holds, 5 s for
  reps. Warm-up items flow into each other without one.
- A session or GTG set starts with a 10 s "Get ready". A timer that follows a countdown starts on
  its own when the countdown ends; one that follows a tapped step gets a 5 s "Get ready" first.
  The phases of a PNF round run back to back. Every countdown can be skipped or extended.
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
  stored under `goals`.
- Saved data carries a schema number (`schema`); `src/lib/migrate.ts` upgrades older data in
  place on launch.

## Storage, sync and backups

- **On the phone.** IndexedDB, database `tkd`, store `state` (through idb-keyval), mirrored in
  memory so screens read it synchronously (`src/lib/storage.ts`). Versions before this one used
  `localStorage` keys starting with `tkd.`: the first launch copies them into IndexedDB, reads them
  back to check, then deletes them. A key already in IndexedDB is never overwritten by a
  `localStorage` leftover. If IndexedDB does not work at all, the app keeps using `localStorage`.
- The app calls `navigator.storage.persist()` on launch; Settings shows "Storage: persistent" or
  "Storage: may be cleared".
- **The training record** is `pos`, `log`, `tests`, `gtg` and `goals` (plus `schema`). That is
  what the cloud copy and backup files hold (`src/lib/record.ts`). The open tab, a session in
  progress and the sync URL and secret stay on the device.
- **Cloud sync** (`src/lib/sync.ts`). Every change to the record stamps `updatedAt` and uploads the
  whole record 2 s later (several quick taps make one upload). When the Worker cannot be reached it
  retries after 5 s, 15 s, 30 s, 1, 2 and 5 min, when the phone comes back online, and when the
  app returns to the screen. On launch and with **Sync now** it compares both copies: if the
  phone has no data it takes the cloud copy; otherwise the copy with the newer `updatedAt` wins.
  The one exception is the first sync of a phone that already has data while the cloud holds
  different data: Settings then asks which copy to keep, so a phone that was only tried out can
  never wipe the real history. The Worker refuses (409) an upload older than what it stores.
- **Backup files.** Export backup writes `tkd-backup-<date>.json` (share sheet on the phone,
  download on a computer). Import backup checks the file, shows what it holds next to what the
  phone has, and replaces the record only after **Replace**. An import counts as a new change, so
  it also becomes the cloud copy. Files contain no URL or secret.

## Cloud backup setup (Cloudflare Worker + KV)

The Worker is in `worker/`: `GET /state` returns `{ data, updatedAt }` and `PUT /state` stores it.
Both need `Authorization: Bearer <SYNC_SECRET>`, anything else gets 401. Browsers may call it only
from `ALLOWED_ORIGIN` in `worker/wrangler.toml` (the GitHub Pages origin). Cloudflare's free plan
covers it (KV allows 1,000 writes a day; a day of training uses a few dozen).

```sh
npm i -g wrangler
wrangler login                          # opens the browser to sign in to Cloudflare
cd worker
wrangler kv namespace create SYNC_KV    # copy the printed id into wrangler.toml
wrangler secret put SYNC_SECRET         # paste a long random secret when asked
wrangler deploy                         # prints https://tkd-sync.<your-subdomain>.workers.dev
```

To make a secret: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.
Then in the app: Settings > Cloud sync, paste the Worker URL and the secret, tap **Save and sync**.
Check the Worker from a terminal with
`curl -H "Authorization: Bearer <secret>" https://tkd-sync.<your-subdomain>.workers.dev/state`.

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

## Voice coach and sounds

`src/lib/coach.ts` decides what is said and played; `src/lib/voice.ts` speaks through the
browser's speech synthesis, and `src/lib/audio.ts` makes the beeps and the whistle with Web Audio.

- When a countdown starts the voice says what comes next: "Rest, 2 minutes. Next: Weighted pistol.
  Set 1 of 3, left side. 5 reps." With 10 s left it says "10 seconds", the last 3 seconds beep,
  and a whistle starts the work. A timed step that ends gives a long beep and the next step is
  announced. Each EMOM minute starts with the whistle and the minute's cue.
- Settings > Voice coach turns the voice on or off and picks the voice; the speaker button on the
  session screen mutes it too. Both are stored on the device only.
- iOS mutes Web Audio (and may mute speech) when the ring/silent switch is on silent. Use **Test
  sound** on the Train screen or **Test voice and whistle** in Settings to check.

## Totals

The Progress tab adds up what was done: kicks, 360s, 540s and 720s (split into kicks, tuck jumps
and spin drills), jumps, time in holds and stretches, and every exercise (`src/lib/volume.ts`).

- Each finished step of a timer session counts, stored with the completion as `vol`. Days marked
  as completed, and completions logged before totals existed, count the plan's full prescription.
- Ticked GTG slots count the set for that slot (the plan day decides the letter).
- "Per kick" kicks count each of roundhouse, side kick and hook; standing spin kicks split their
  reps evenly between spinning hook and 360 roundhouse; leg raise holds count each direction.
- An EMOM counts one rep a minute (the plan's lower bound), alternating cues where it alternates.
- The same movement adds up across months and names (`src/lib/movements.ts`): "540 to ball",
  "EMOM: 540" and the 540 test attempts are all 540 kicks.
