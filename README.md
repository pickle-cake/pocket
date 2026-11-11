# Pocket

A timing coach for drummers practising on a pad. It plays a click, listens to each stroke through the microphone and shows how early or late it landed, in milliseconds. It runs in the browser, on a phone or a computer, and works offline after the first visit. Nothing is uploaded: your history stays in the browser.

**Open it:** https://pickle-cake.github.io/pocket/app/ (the home page, https://pickle-cake.github.io/pocket/, says what it does)

## Licence

Copyright (C) 2026 the Pocket contributors.

Pocket is free software under the GNU General Public License, version 3 or any later version: see [LICENSE](LICENSE). The code was written with AI, which learned from the work of countless people who shared theirs freely. It is shared in that spirit, and it stays that way: you may use, change and share it, and anything built from it must be shared under the same licence, with its source.

## Tests

`npm install`, `npx playwright install chromium`, then `npm test`. The core and library checks need only Node and run in a second; the browser tests take about a minute. The tests read `index.html` and `routines/*.txt` as they are, and use no book content. `npm run test:webkit` runs the browser tests in WebKit, Safari's engine, as an iPhone (`npx playwright install webkit` first). Pull requests run it in CI. It does not replace checking on a real iPhone: no test can play a pad into a phone's microphone.

## Where changes go

Work happens in the fork, `feature-pocket`. A push to its `main` runs the tests and, if they pass, publishes the site that `npm run site` assembles in `_site/` (the home page from `landing/index.html` at the root, the app with `sw.js` and `routines/` under `app/`) to the fork's own GitHub Pages site, https://b6fsb6.github.io/feature-pocket/. That site is the preview: try a change there on a phone. The fork has its own address, so its saved settings and records are separate from the live app's.

When a change is good, open a pull request from the fork's `main` to this repository's `main`. The same workflow runs the tests on the pull request. After review, merge it (squash); the merge publishes the live site. Then reset the fork's `main` to this repository's `main`.

Both repositories use the "GitHub Actions" Pages source. If the tests fail, nothing is published.

## Checking on an iPhone

The WebKit tests cover Safari's engine, but no test can play a pad into a phone's microphone. Before a pull request that touches audio, timing or the Play page, check the preview on a real iPhone:

1. On a first visit, the welcome shows. The Mic check asks for the microphone, hears the room, then counts twelve strokes.
2. Auto calibrate plays 12 clicks and sets a latency. Cancelling it part-way and starting again plays one set of clicks, not two.
3. A run at 60 BPM: the click is steady, strokes show on the staff as they land, and the result appears when it ends.
4. Steps 2 and 3 again with the ring/silent switch on silent, then with headphones.
5. After one visit, with flight mode on, the app still opens and plays.
