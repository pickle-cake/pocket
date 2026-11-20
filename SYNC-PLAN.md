# Storage and sync plan

Where Pocket keeps its records, and how it gets to sync between devices. Written 2026-11-20.

## The problem

- **Storage.** Records were kept in `localStorage`, which allows about 5 MB a site. After a few weeks of practice they took 1.3 MB: 792 KB of stroke detail for 154 runs, 485 KB of runs. Stroke detail was capped at 2 MB and runs at 300; past those, old runs lost their detail and were folded into the totals.
- **Responsiveness.** All records sat in one `localStorage` key. Every save turned the whole 1.3 MB into text and wrote it, and the page waited while it did. That grows with the history.
- **Sync.** Practising on a phone and a tablet means exporting to iCloud, finding the file on the other device and importing it. Web pages have no access to iCloud, so there is no shortcut there.

AI coaching came up as well. It is not a goal for now; see step 4.

## What the data allows

- Every run has an `id` and a time `t`, and runs are only ever added, so two devices' runs combine by keeping both and dropping duplicate ids. Saved routines have an `id` and `t` too.
- Stroke detail (`sp`) is already packed at about 4 characters a stroke, about 5 KB a run. Making it smaller would gain little. The limit was the storage, not the data.
- The one awkward part is `sum`: running totals for runs that were folded away. They cannot be combined by id, so before sync they need to become something that can be recalculated or added up, such as counts per day.

## Steps

### 1. Records move to IndexedDB (done in 1.5.230)

- Each run is its own entry in IndexedDB (`pocket` database, `runs` store, keyed by `id`). Totals, names and saved routines are one more entry (`meta` store, key `recs`).
- A save writes only the runs that changed, in the background. A new run is a few KB, not the whole history.
- Limits rise from 300 runs and 2 MB of stroke detail to 2,000 runs and 20 MB.
- Settings stay in `localStorage`. They are small, and the page reads them before it draws.
- On the first load after the update, records in `localStorage` move across and the old key is removed once the move has been written.
- Where IndexedDB cannot open (some private windows), records stay in `localStorage` with the old limits, as before.
- The app already asks the browser to keep its data (`navigator.storage.persist()`). Adding Pocket to the home screen is what protects it from Safari clearing site data.

### 2. A data model ready for sync

- Everything that can change (saved routines, names, linked libraries, portable settings) gets an `id`, an updated time and a deleted marker, so merging is "newest version wins, per item".
- `sum` becomes totals that can be added up or recalculated (see above).
- Deleting a run leaves a deleted marker, so a sync does not bring it back.

### 3. Sync, as an optional setting

- **No accounts.** Turning sync on makes a random sync code. A second device joins by scanning a QR code shown on the first. The code is both the login and the encryption key.
- **End-to-end encrypted.** Data is encrypted on the device before it is sent. The server stores only unreadable data, never stickings or history.
- **Small protocol.** "Here are my changes since X; send me everything since Y." Runs combine by id, everything else by newest version.
- **Hosting.** A Cloudflare Worker with its own storage runs free at this scale. The server is a few hundred lines and can sit in this repository under the AGPL.
- **In the app.** Sync runs when a run is saved and when the app opens, never during a run. Offline, changes wait. With sync off, Pocket works exactly as it does without it.
- **Fallback, if a hosted service is not wanted:** sync through a cloud drive the user signs into (Dropbox and Google Drive both allow sign-in from a web page).

### 4. Later, if ever: a companion page

Analysis or coaching on a separate page, opened with the same sync code, so the weight stays out of Pocket itself. Coaching could start as "copy a summary for a chatbot", or use the person's own API key from the browser, before anything is hosted.

## Open questions

- Is running a small hosted service for years acceptable, or should sync go through people's own cloud drives?
- Is sync for one person's devices, or for anyone using Pocket? That decides how much goes into abuse limits and setup screens.
- Loading every run at start-up is fine at 2,000 runs. Well past that, stroke detail could load only when a run's staff is shown.
