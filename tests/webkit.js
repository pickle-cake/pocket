/* The browser tests again, in WebKit (Safari's engine) as an iPhone. Run with `npm run test:webkit`, after
   `npx playwright install webkit`. Not part of `npm test`: CI runs it on pull requests.
   Playwright's WebKit for Windows has no Web Audio, so there the tests that play a run are skipped. */
process.env.POCKET_ENGINE = 'webkit';
if (process.platform === 'win32') process.env.POCKET_NO_AUDIO = '1';
require('./browser.test.js');
