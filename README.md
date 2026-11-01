# stick-timing-trainer
Drum Practice Pad Timing Trainer

## Tests

`npm install`, `npx playwright install chromium`, then `npm test`. The core and library checks need only Node and run in a second; the browser tests take about a minute. The tests read `index.html` and `routines/*.txt` as they are, and use no book content. `npm run test:webkit` runs the browser tests in WebKit, Safari's engine, as an iPhone (`npx playwright install webkit` first). Pull requests run it in CI. It does not replace checking on a real iPhone: no test can play a pad into a phone's microphone.

## Where changes go

Work happens in the fork, `feature-pocket`. A push to its `main` runs the tests and, if they pass, publishes `index.html` and `routines/` to the fork's own GitHub Pages site. That site is the preview: try a change there on a phone. The fork has its own address, so its saved settings and records are separate from the live app's.

When a change is good, open a pull request from the fork's `main` to this repository's `main`. The same workflow runs the tests on the pull request. After review, merge it (squash); the merge publishes the live site. Then reset the fork's `main` to this repository's `main`.

Both repositories use the "GitHub Actions" Pages source. If the tests fail, nothing is published.
