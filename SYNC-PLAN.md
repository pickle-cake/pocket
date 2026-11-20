# Storage and sync plan
 
Where Pocket keeps its records, and how it gets to sync between devices. Written 2026-11-20, revised 2026-11-21.
 
## The problem
 
- **Storage.** Records were kept in `localStorage`, which allows about 5 MB a site, counted at two bytes a character. After 23 days of practice (154 runs) they took 653K characters (1.3 MB): 503K of detail and 150K of runs. Stroke detail was capped at 1M characters and runs at 300; past those, old runs lost their detail and were folded into the totals.
- **Responsiveness.** All records sat in one `localStorage` key. Every save turned the whole history into text and wrote it, and the page waited while it did. That grows with the history.
- **Sync.** Practising on a phone and a tablet means exporting to iCloud, finding the file on the other device and importing it. Web pages have no access to iCloud, so there is no shortcut there.
AI coaching came up as well. It is not a goal for now; see step 4.
 
## What the data allows
 
- Every run has an `id` and a time `t`. Runs are added, and leave only when the person deletes or discards them, so two devices' runs combine by keeping both, dropping duplicate ids and honouring deleted markers. Saved routines have an `id` and `t` too.
- **Detail** is what a run holds for each stroke: its timing (`sp`, packed at 4 characters a stroke) and its quality (`q`, one character a stroke). Measured on an export of 2026-11-21, it is about 3,200 characters a run (2,632 of `sp`, 562 of `q`), 77% of the records. Making it smaller would gain little. The limit was the storage, not the data.
- **A run without detail** is about 970 characters (median 350, up to 3,700 for a routine of 24 exercises). At about 2,400 runs a year, that is 2.4M characters a year, 12M after five. So every run can be kept; only detail needs a limit.
- The one awkward part is `sum`: running totals for runs that were folded away. They cannot be combined by id. Step 2 stops folding, so the totals from before it stay fixed and everything after is worked out from the runs.
Sizes in this plan are in characters, as JSON holds them, unless they say bytes. Sizes over time are estimates from average run sizes.
 
## Release order
 
Agreed on 2026-11-21. Each release protects what is already there before the next builds on it.
 
1. **Storage release (next).** Safe database upgrade, no automatic folding, and a failed save that can be recovered (step 1, "Storage release"). It protects the history that exists now, whatever sync becomes.
2. **Data model revisions.** Keep every run with detail in its own store, logical versions, clear history by generation, deleted markers kept (step 2, revisions). The detail store needs the safe upgrade from release 1.
3. **Sync pilot.** One revisioned snapshot, phone and tablet only (step 3), once the acceptance tests in step 3 pass.
4. **Month files**, only when measurements on the phone show the snapshot is too big or too slow.
## Steps
 
### 1. Records move to IndexedDB (done in 1.5.230)
 
- Each run is its own entry in IndexedDB (`pocket` database, `runs` store, keyed by `id`). Totals, names and saved routines are one more entry (`meta` store, key `recs`).
- A save writes only the runs that changed, in the background. A new run is a few KB, not the whole history.
- Limits rise from 300 runs and 2 MB of stroke detail to 2,000 runs and 20 MB. (Replaced by step 2's revision: no run limit, and a detail budget in characters.)
- Settings stay in `localStorage`. They are small, and the page reads them before it draws.
- On the first load after the update, records in `localStorage` move across and the old key is removed once the move has been written.
- Where IndexedDB cannot open (some private windows), records stay in `localStorage` with the old limits, as before. (Changed by the storage release: only where IndexedDB is not supported.)
- The app already asks the browser to keep its data (`navigator.storage.persist()`). Adding Pocket to the home screen is what protects it from Safari clearing site data.
#### Storage release (done in 1.5.233)
 
- **Safe database upgrade.** Adding the `detail` store (step 2) raises the database version. The danger is an older build of Pocket in the same browser on the same device; another device has its own database.
  - Fall back to `localStorage` only when IndexedDB is not supported, never on an error opening it. Today any error falls back, so an older build that meets a newer database (`VersionError`) would show an old or empty history and save new runs where nothing reads them.
  - An open tab on the old version can block the upgrade (`onblocked`): the new tab says another Pocket tab must close or reload. The old tab closes its connection when asked (`onversionchange`) and shows a reload prompt.
  - An old build that opens after the upgrade shows a reload prompt and writes nothing to a fallback history.
  - A preparatory release with these handlers helps, but a tab already running older code still has to close or reload.
  - As built: `openDb` asks for version 1 (`DB_VER`). On `VersionError` it opens the database as it is: exactly the stores `meta` and `runs` means a database that 1.5.230–1.5.232 opened one version up to make its stores, so it is still this version's; anything more is a newer version's. So a newer version that changes the database must add a store, not only change one. The reasons records are off (`recsOff`: newer, update, lost, error) show as a warning notice under the header with a Reload button, and while one is set nothing is saved or imported. Browser tests cover an upgrade from another tab, a newer database, an older tab blocking an upgrade, and a full disk.
- **No automatic folding.** `foldRuns` no longer runs (it stays in the core script for the tests), neither past 2,000 runs nor when storage is full. A merge of two large copies could make a device fold all of its own runs, today's included, and step 2's revision removes folding anyway.
- **A failed save can be recovered.** When a write fails for lack of space, Pocket drops the oldest stroke detail and saves the run again (first the oldest half of the detail, then all but the newest run's: `dropDetail`). If that fails too, it tells the person the run was not saved, and keeps the run available for export while the app is open.
#### Follow-ups from the review of 2026-11-21
 
- **Before sync: the import limit.** Done in 1.5.232. Pocket refused an import over 5 MB (`file.size>5e6`). An export takes about 4.2K characters a run with detail, so it passes 5 MB at about 1,200 runs. At about 200 runs a month (154 on 2026-11-21), that is late April 2027, well before the 2,000-run limit. From then on an export could neither move the history to the other device nor restore it. An export holds every run kept plus the detail kept: about 12M characters at today's limits (2,000 runs and 10M of detail), and about 22M after five years once every run is kept. The limit dates from `localStorage`, when nothing bigger could be stored; with IndexedDB it protects nothing.
  - ~~Raise it well above the largest export possible.~~ Now 100 MB (`MAX_IMPORT`). Every field is still checked as it is read.
  - ~~Write the imported runs in one IndexedDB transaction.~~ It already was: an import saves once, and `writeRecs` puts every changed run and the totals in one transaction, so a failed import leaves nothing half done.
  - Update both devices before exports pass 5 MB: an older Pocket on the other device still has the old limit. Still to do, by the person, not the code.
  - ~~Test it.~~ A browser test imports 1,600 runs in a 25 MB file: every run is kept, and stroke detail is cut to its budget, the newest kept. It takes about 1.5 seconds on a desktop. This is a stress test: about 15.6K characters a run, several times a real one. Still to check: a realistic restore on an iPhone.
  - Later, optional: compress the export with `CompressionStream` (gzip, Safari 16.4 and later), so files move through iCloud more quickly, with import reading both. And an export without detail, a small history-only backup at about 1K characters a run.
- ~~The two new limits do not fit together.~~ Settled by step 2's revision: no run limit, and the detail budget is the only limit.
- Keep the old `localStorage` key as a backup for a release or two, instead of removing it once the move is written.
- ~~Fall back to `localStorage` only when IndexedDB is not supported, not on any error opening it.~~ Part of the storage release.
- Save on `pagehide`, so a run saved just before the page closes is not lost.
- The home screen app on iOS starts with empty storage, separate from Safari's. Moving to it means an export and import (or, later, a sync).
### 2. A data model ready for sync (done in 1.5.231)
 
Reworked after two reviews on 2026-11-21, before it was committed. Three revisions below, not yet built, replace parts of it: keeping every run replaces totals by device and folding; logical versions replace clock time in versions and the far-ahead rule; and clear history by generation replaces `recs.z` as a time.
 
- **Stamps.** Every new id and version is a stamp, made by `newStamp()`: time, counter and device id, `ttttttttt-cccccc-dddddddd` in base 36 at fixed widths, so comparing two as text compares the time, then the counter, then the device.
  - The device id is 8 random characters, made once and kept with the counter in `localStorage` under its own key. It is never exported or part of the portable settings, though it shows inside the stamps it made.
  - The time in a stamp never goes back and the counter only goes up, so each device's stamps always rise, even when its clock jumps back or two come in the same millisecond. The device id settles an exact tie, so no edit is lost to one.
  - **An edit is newer than what it changes.** A new version is stamped after the item's current version (and a delete after the item, a restore after its deleted marker), so an edit made on a device with a slow clock still beats the version it was made from.
  - **Receiving moves the clock up.** After taking in another copy (an import now, a sync in step 3), a device moves its stamp time up to the latest stamp in it (`latestStamp`, `seeStamps`), so whatever it changes next is newer than everything it has seen. A fast clock wins only edits made at about the same time on two devices that had not yet seen each other's, the same way on every device.
  - **A clock far ahead does not take over.** A stamp more than a day ahead of this device's clock is not believed (`okStamp`): it reads as version zero, or as no marker, and the clock does not move up to it. A device whose own stamp time is more than a day ahead (its clock was set ahead and is right again) goes back to the clock. A clear time ahead of the clock counts from now. (Removed by the logical-versions revision: the result of a merge must not depend on when it runs.)
  - Runs, saved routines and library links made from now on have stamp ids. Old ids (time plus random letters) stay as they are, and everything reads both.
- **Versions.** A changed or restored item's `u`, each portable setting's time in `S.setT`, each name's time in `recs.nt`, and the deleted markers (`recs.gone`, `recs.libGone`, `S.listGone`, id to stamp, the newest 5,000 kept) are all stamps. Data from before sync has version zero (`ZERO`), which any real edit beats. Plain times from before 1.5.231 are dropped when read, which makes them version zero.
- **Totals by device.** `recs.sums` maps a device id to the totals of the runs that device folded away, each with its version `v` and what it covers: `cov` (device id to the highest counter of that device's runs folded in) and `ids` (runs with old ids folded in). The totals shown (`recs.sum`) add every device's entry up. A device only ever changes its own entry, so two copies combine by keeping the newer version of each.
  - The one `sum` from before 1.5.231 becomes this device's entry. It kept no ids, so it covers old-format runs by time (`upTo`).
  - When the history is cleared, `recs.z` holds the time; no run, totals entry, name or discarded time from before it comes back.
  - Discarded runs keep their time in `recs.xs` (id to [time, seconds]), so the practice days still count it, once, whichever copies have it, and not at all if the run comes back.
- **Folding.** Past 2,000 runs (or when storage is full), the oldest runs are folded into this device's entry (`foldRuns`). **A device folds only its own runs**, and runs with old ids, from before runs moved between devices except by import. So no run is folded by two devices, and the device folding has every earlier run of its own, which is what a counter in `cov` assumes. Its runs go by counter: every one up to the last it made on or before the day of the newest that has to go, so the counter covers exactly the runs folded, even after the clock went back. Its discarded runs on those days go with them, so `recs.xs` does not grow forever, and a copy of `xs` already in someone's totals is dropped on merge and import. Other devices' runs are left for their own device, and lose only their stroke detail. A device with few runs of its own can stay over the limit, and a merge of two large copies makes a device fold all of its own runs; the storage release turns folding off, and the revision below removes it.
- **Duplicate copies.** Runs combine by id. Of two copies, the newer version wins; at the same version, the one with stroke detail. A deleted marker beats any version that is not newer, so a delete stays unless the run was restored (Undo, import) or changed after it. Two saved routines or libraries with the same text or address keep the newer one, and the other gets a deleted marker.
  - **Ties are settled the same on every device.** Data from before sync is all at version zero, so two devices can hold different copies of a run, routine, name, setting or totals entry at the same version. The one kept is a value over none, then the larger as JSON (`tieWins`), so merging a with b gives the same as b with a.
- **Format version.** Records are written as format 3 (`REC_FORMAT`). Fields this version does not know are kept as they are: on the records (`recs.x`), on runs, exercises and saved routines, whole, and through an import. Cutting them short would let an older device's next edit carry the cut copy back to newer devices; the 100 MB import limit bounds them. A newer format is read as far as this version understands it.
- `mergeRecs` and `mergeSettings` in the core script combine two copies; sync (step 3) will call them. `tests/sync.test.js` covers stamps, every merge rule, and two simulated devices with clocks five minutes apart that edit, delete, restore and fold runs with both kinds of id, and end up the same. Further tests cover the receive rule, stamps far ahead, folding only a device's own runs, and ties from different data before sync merged either way round. A browser test imports a file in format 9 (a made-up future format) and checks that the other device's totals and the unknown fields survive.
Known limits (the revisions below change the ones marked):
 
- Totals that overlap from past export and import cannot be untangled. An import from before 1.5.231 brings totals only into an empty history, as before.
- Pocket before 1.5.231 reading a format 3 file sees its runs but no totals.
- Clearing history relies on clocks: a device whose clock is behind can bring back a run made after the clear by a device whose clock is ahead (by less than a day). (Replaced by clear history by generation.)
- Two edits of one item made at about the same time on two devices that had not seen each other's: the later stamp wins, which is the faster clock. (With logical versions: the winner is the same on every device, but may not be the later edit in real time.)
- An edit after a delete on another copy brings the item back: the last change wins.
- Keeping unknown fields also keeps ones a later version stops using.
#### Revision: keep every run, no folding (not yet built)
 
Measured on 2026-11-21 (see "What the data allows"): runs without detail grow by about 2.4M characters a year, which IndexedDB holds easily for decades. Folding saved space that is not short, and it is the part of the sync model that went wrong most often: a merge of two large copies made a device fold all of its own runs, today's included. So:
 
- **No run limit, no folding.** Every run is kept. `foldRuns` and the 2,000-run limit go.
- **Totals are worked out from the runs.** The totals shown add up the runs kept, plus a fixed base: the `sum` from before 1.5.231 and anything already folded into `recs.sums` before this change. Nothing is added to the base again. Two copies still combine it by keeping the newer version of each device's entry, since copies made before the change may differ.
- **The base still covers what it folded.** A run folded on one device may still be held in full on another, so `cov`, `ids` and `upTo` stay, read only, and a merge keeps dropping runs they cover. Nothing new is ever covered.
- **Merging is runs by id, plus deleted markers**, plus that fixed base. There is nothing else in the history to settle.
- **Discarded runs** keep their time in `recs.xs`, as now; it is small. Without folding it is never trimmed.
- **Detail is one thing.** `sp` and `q` are kept and dropped together.
- **Detail has its own store** (`detail`, keyed by run id). Start-up reads only the runs: about 12M characters after five years, instead of about 22M with the detail budget full. Dropping detail deletes an entry instead of rewriting the run, and loading detail only when a staff is shown follows from it.
- **Exports keep detail on each run.** `sp` and `q` stay inline in an export, as now, so Pocket 1.5.231 still reads detail from a newer export. Check the round trip with 1.5.231 both ways.
- **The detail budget is the only limit**, oldest dropped first, whoever made the run. It is 10M characters: about 3,100 runs with both `sp` and `q`, or 15 months at the current pace. Raising it to 20M characters keeps 2.5 years. Pick one, and count both parts.
- **Dropping detail is local.** A run's detail never changes once played, so two copies combine it by id, and a drop is not a change: it needs no marker and does not travel. A device that dropped a run's detail does not fetch it again by itself; it can fetch it when the run's staff is shown, if the server still has it (step 3).
- **Rounding `avg` and `sd`** (stored at full float precision) would save about a quarter of a run. It is not needed for storage. If it is done, only for new runs: rewriting old ones would give each a new version, and the first sync would send everything again.
- **Moving across.** On the first load after the change, detail moves to its own store, and runs are written without it. This is a storage change, not an edit, so versions stay as they are. It needs the safe upgrade from the storage release.
#### Revision: logical versions, not clock time (not yet built)
 
The result of a merge must not depend on any device's clock, or on when the merge runs. Distrusting far-ahead stamps (`okStamp`) made it depend on both: the same two copies could merge differently on Monday than on Wednesday, and capping a stamp when it arrives would let two devices store the same edit differently. So versions stop using the clock.
 
- **A version is one more than the newest version seen.** `newVersion()` makes the time part one more than the highest version this device has seen (its own or received), with the counter and device id as now. The format and the text comparison stay the same.
- **Existing versions need no converting.** New versions count up from the highest existing one, so everything already stamped keeps its order.
- **Far-ahead stamps stop mattering.** A version from a clock set ahead, or in an old import, is just a large number that later versions count up from. `okStamp` and the one-day rule go.
- **Receiving still moves the count up** (`seeStamps`), so an edit made after seeing another version beats it, whatever any clock says.
- **Ids keep the clock.** Run, routine and library ids are still made from time, counter and device id (`newStamp()`). They only need to be unique, and the counter and device id make sure of that. Versions are counted from versions only, never from ids.
- **Practice time stays real.** A run's `t` is still the clock time, for history, practice days and streaks.
- **The trade-off.** Two edits of one routine on two devices that had not seen each other's have a winner that is the same on every device, but it may not be the later edit in real time: the device that had seen more versions wins. For one person handing over between two devices this is accepted.
- **The clock is checked, not trusted.** With sync on, Pocket compares its clock with the server's time (the `Date` header) and warns when it is off by more than a few minutes. The check never blocks a save, an edit or a sync.
#### Revision: clear history by generation (not yet built)
 
`recs.z` compares a run's practice time with the time of the clear, so it relies on clocks.
 
- **A clear starts a new generation.** Clearing history raises the generation number, stamped with a version like any change. Two clears made without seeing each other give the same number; the newer version is kept.
- **Every run records its generation** (`g`), the one its device was in when the run was made. Runs from before this change are generation 0.
- **A merge drops runs from an older generation**, with their totals entries, names and discarded times. Any run recorded before a device learns of the clear is removed from the history when that device reconnects. That includes runs played after the clear, on a device that was still offline. That is the rule chosen (confirmed on 2026-11-21): a clear is a fresh start everywhere. Keeping such runs instead would need the clear to record, for each device, the highest counter it had seen from it.
- **Clearing history clears every device.** With sync on, the confirmation says it wipes the history on every synced device, not only this one, including runs a device plays before it next syncs.
#### Revision: deleted markers kept (not yet built)
 
- **Markers are not trimmed.** The 5,000-marker cap leaves the merge path, so a trimmed marker can never let an old copy bring a deleted item back. A marker is about 45 characters, so even 20,000 is under 1M characters. Revisit only if markers pass that.
- The trim point (S) proposed in an earlier review is dropped: it would throw away runs a device made while it was away, and a "highest counter seen" proves nothing unless everything below it is known to have arrived.
### 3. Sync, as an optional setting
 
**Usage assumed:** one person's devices, used one at a time. Pocket is open on the phone or on the tablet while practising, not both. So sync is a handover: the device being opened pulls the latest copy, and pushes its changes when a run is saved or it goes to the background. The only real clash is a change to the same routine (or setting) on two devices before either has synced, for example with one offline. The winner is the same on both devices (step 2, logical versions), and the other edit is lost. That is rare and easy to see, so it is accepted for now. If it ever matters, the app can say "this routine was also changed on your other device" rather than merge the two.
 
#### Access and encryption
 
- **No accounts.** Turning sync on makes a random sync code of at least 128 bits. A second device joins by scanning a QR code shown on the first, or by pasting a copyable text version.
- **Login and key are separate.** Both are derived from the code, so the server never sees the encryption key.
- **Reset sync code.** Makes a new code, so a lost device is cut off. The device list shows which devices are linked, but removing one from the list does not take its key away; only a reset does. Every other device then has to join again with the new code. The reset confirmation says so, in those words.
- **End-to-end encrypted.** Data is encrypted on the device before it is sent. The server stores only unreadable data, never stickings or history.
- **Format 3 or later only.** The server and every client refuse a device writing an older format, and a client on a newer format than it understands stops syncing and asks to update, rather than writing back a copy it only half read. Pocket before 1.5.231 cannot sync at all.
#### Pilot: one revisioned snapshot
 
- **One file.** The server holds one encrypted snapshot per sync code: runs without detail, settings, routines, names, deleted markers, the generation and the fixed totals base. So a run's summary, its score and the practice history appear on both devices. Detail (per-stroke timing and quality) stays on the device that played the run during the pilot (confirmed on 2026-11-21); revisit after using the pilot. Before it, check every feature that reads `sp` or `q` from older runs, so a run without detail shows as having none, not as poor timing.
- **Conditional writes.** The snapshot has a revision. A device pulls it, merges with `mergeRecs` and `mergeSettings`, moves its version count up to what it received (`seeStamps`), and writes back only if the revision is still the one it read. Otherwise it pulls, merges and tries again. With one device in use at a time, a retry is rare.
- **Pending changes.** Changes not yet uploaded are kept and marked pending. A run always saves locally first; sync is shown as pending, or blocked with the reason (offline, server full, update needed), never silently dropped.
- **When it runs.** When the app opens, when a run is saved, and on `visibilitychange`; never during a run. Offline, changes wait. With sync off, Pocket works exactly as it does without it. Decide what turning sync off does (keep the local copy, leave the server copy until reset).
- **Measure it.** The snapshot without detail grows by about 2.4M characters a year, sent whole on every upload. Measure upload size and handover time on the phone, and move to month files when they show it is needed, not on a fixed date.
#### Later: month files with a manifest
 
- **Split by month.** One small file for settings, routines, names, deleted markers, the generation and the fixed base; one file a month for runs; and, if detail is synced, one a month for detail. A sync then sends the small file and the current month.
- **Files are never overwritten.** A changed file is uploaded under a new key. Then a small manifest, listing the key of every current file, is published with a conditional write. A reader goes by one manifest, so it never sees a mixture of revisions. Files no longer in any manifest are deleted after a while.
- **Shared, not per device.** Every device reads and writes the same files through the manifest, so deletes, resets and retired files have one owner.
- **A change to an old run** (a rename, a delete) rewrites only its month, or goes in the small file as a marker.
#### Server limits
 
- **Abuse limits**, even if only one person uses it: request rate, stored size per sync code.
- **Retention for detail.** If detail is synced, the server keeps a set amount of it (by months or by size) and drops the oldest first, before runs without detail come near the size limit. A device fetches older detail only when a run's staff is shown, and only if the server still has it.
- **Size limit.** Size it for more than ten years: at the measured pace, 24M characters is about ten years of runs without detail. Set the actual limit in stored bytes, after measuring the full encoded snapshot (routines, settings, names and deleted markers included). Check the largest payload the service accepts in a single write too: that may call for month files before the size limit does.
- **When the snapshot reaches the limit**, new runs still save locally, and sync shows as blocked with the reason.
- **Hosting.** A Cloudflare Worker with its own storage runs free at this scale. Check the free tier's writes per day and the largest stored value before building. The server is a few hundred lines and can sit in this repository under the AGPL.
- **Limits that differ.** Two devices on different versions may keep different numbers of saved routines, or different detail budgets (which is harmless, since dropping detail is local). Decide before sync whether the limits travel with the format (a device keeps at least what the format says) or a device with a lower limit is asked to update.
#### Acceptance tests
 
Sync is not turned on until these pass, phone and tablet both converging to the same records:
 
1. **A wrong clock, offline.** The tablet's clock is wrong. It completes a run and edits a routine offline, then reconnects after the clock is corrected. Both changes survive, and the phone and tablet end up the same.
2. **A far-ahead stamp.** An old import containing a version far in the future merges, and later edits on either device still win over it.
3. **The accepted trade-off.** The tablet makes several edits to a routine offline, then the phone makes one later edit to the same routine without having seen them. The result is the same on both devices whichever syncs first, and matches what step 2 says wins.
4. **A clear while offline.** The phone clears history while the tablet practises offline. After both sync, the history is cleared on both, the tablet's offline runs included (step 2, generation).
5. **A failed upload.** An upload fails halfway. Nothing is lost, the changes stay pending, and the next sync completes them.
#### Other
 
- **Export stays** as the recovery path.
- **Fallback, if a hosted service is not wanted:** sync through a cloud drive the user signs into (Dropbox and Google Drive both allow sign-in from a web page), with the same snapshot, or files and manifest, as above. Still open: Google sign-in lasts about an hour, and iCloud users have neither service. Check CloudKit JS.
### 4. Later, if ever: a companion page
 
Analysis or coaching on a separate page, opened read-only, so the weight stays out of Pocket itself. It needs its own read key and read-only login, derived from the sync code but not able to derive it, so a page that is given them can read the history but never write, and a reset cuts it off too. The sync code itself is never typed into it. Coaching could start as "copy a summary for a chatbot", or use the person's own API key from the browser, before anything is hosted.
 
## Open questions
 
- Is running a small hosted service for years acceptable, or should sync go through people's own cloud drives?
- Is sync for one person's devices, or for anyone using Pocket? That decides how much goes into abuse limits and setup screens. For one person, used one device at a time, see the usage assumed in step 3; whether others can turn it on is still open.
- Loading every run at start-up: with detail in its own store (step 2's revision), start-up reads about 2.4M characters a year of history. Check how long that takes on a phone at five years (12M) before deciding whether runs also need loading by month.
- Detail budget: 10M characters (15 months) or 20M (2.5 years)?
- Should detail sync at all, or stay on the device that played the run?
 