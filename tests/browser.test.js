/* End-to-end checks in a real browser. The app is served from memory with a small hook added, so a test can
   feed it hits at exact times instead of playing. Nothing is changed on disk. */
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const playwright = require('playwright');
/* Chromium by default. `npm run test:webkit` runs the same tests in WebKit, Safari's engine, as an iPhone 13 at
   phone widths: touch, a mobile user agent and a 3x screen. It is not iOS Safari, but it catches engine differences. */
const ENGINE = process.env.POCKET_ENGINE || 'chromium';
const contextFor = viewport => Object.assign(ENGINE === 'webkit' && viewport.width < 720 ? { ...playwright.devices['iPhone 13'] } : {}, { viewport });
const { ROOT, html } = require('./helpers');

const page = html.replace('let heardTimer=0;', 'window.__T={hit:handleHit,run:()=>run,S:()=>S,ctx:()=>ctx,sync:()=>syncInfo(),unlocked:renderUnlocked};let heardTimer=0;');
assert.ok(page !== html, 'the test hook did not attach: has handleHit moved?');

let server, base, browser, served = 0;
test.before(async () => {
  server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/' || u === '/index.html') { res.setHeader('content-type', 'text/html'); res.setHeader('x-served', String(++served)); return res.end(page); }   /* x-served counts, so a test can tell the server from a cache */
    const f = path.join(ROOT, u);
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) { if (f.endsWith('.js')) res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(f)); }   /* a service worker must be served as JavaScript */
    res.statusCode = 404; res.end();
  });
  await new Promise(r => server.listen(0, r));
  base = 'http://localhost:' + server.address().port + '/';
  /* Chromium gets a fake microphone that is allowed without asking, so tests can open it. WebKit has no such switch. */
  browser = await playwright[ENGINE].launch(ENGINE === 'chromium' ? { args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } : {});
});
test.after(async () => { await browser.close(); server.close(); });
/* Each test's pages are closed when it ends. Left open, they pile up (some still playing), and on CI WebKit runs out of memory part-way and the job is cancelled. */
test.afterEach(async () => { await Promise.all(browser.contexts().map(c => c.close())); });

/* Tests that play a run need Web Audio. Playwright's WebKit for Windows has none, so there they are skipped. */
const audioTest = process.env.POCKET_NO_AUDIO ? (name, fn) => test(name, { skip: 'no Web Audio in this WebKit build; CI runs it on Linux' }, fn) : test;

const micTest = ENGINE === 'chromium' ? test : (name, fn) => test(name, { skip: 'needs a fake microphone, which only Chromium has' }, fn);

/* Presses the visible button whose text matches, as a real tap: WebKit only lets audio start from one. */
const press = (p, re) => p.locator('button:visible').filter({ hasText: re }).first().click();

/* A fresh browser profile, with settings put in storage before the app starts. */
async function open(settings, size, init) {
  const ctx = await browser.newContext(contextFor(size || { width: 390, height: 900 }));
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  await p.addInitScript(s => {
    if (s && !localStorage.getItem('stick-timing-trainer.v1')) localStorage.setItem('stick-timing-trainer.v1', JSON.stringify({ settings: s, cal: null }));
  }, settings);
  if (init) await p.addInitScript(init);
  await p.goto(base);
  await p.waitForTimeout(300);
  return p;
}

test('the page starts with no errors and the right title', async () => {
  const p = await open({});
  assert.equal(await p.title(), 'Pocket - your pad practice coach');
  assert.deepEqual(p.errors, []);
  assert.match(await p.textContent('.app'), /Set up/);
  assert.equal(await p.isDisabled('#startBtn'), true);   /* Start waits for mic, Mic check and latency */
});

test('a first visit sees the welcome and nothing else of Play, until Start practising', async () => {
  const p = await open({ seeded: true });
  const seen = () => p.evaluate(() => ({ welcome: !!document.getElementById('setup').offsetParent, start: !!document.getElementById('startBtn').offsetParent }));
  assert.deepEqual(await seen(), { welcome: true, start: false });
  assert.match(await p.textContent('#setup'), /Welcome to Pocket/);
  await p.evaluate(() => { const S = window.__T.S(); S.noise = -50; S.latCal = true; window.__T.sync(); });
  assert.deepEqual(await seen(), { welcome: true, start: false });   /* set up, but still welcoming until the button */
  await p.click('#tabLibrary');
  await p.click('#tabPlay');
  assert.deepEqual(await seen(), { welcome: true, start: false });   /* a first visit's welcome survives a tab change */
  assert.equal(await p.evaluate(() => document.getElementById('status').parentElement.id), 'setup');   /* messages stay in view */
  await p.click('#setup >> text=Start practising');
  assert.deepEqual(await seen(), { welcome: false, start: true });
  assert.equal(await p.evaluate(() => document.getElementById('status').parentElement.id), 'stPlay');
  /* the staff was laid out while hidden, at no width: once shown it is laid out again, as on a normal visit, with no gap */
  await p.waitForTimeout(400);
  const staff = q => q.evaluate(() => [...document.querySelectorAll('#rows .prow')].map(e => Math.round(e.getBoundingClientRect().height)));
  const normal = await open({ seeded: true, noise: -50, latCal: true });
  assert.deepEqual(await staff(p), await staff(normal));
  assert.deepEqual(p.errors, []);
});

test('clearing Device setup brings the welcome back', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true });
  const welcome = () => p.evaluate(() => document.body.dataset.welcome);
  assert.equal(await welcome(), '');
  await p.click('#tabSetup');
  await p.evaluate(() => document.getElementById('recClear').click());
  await p.evaluate(() => document.querySelector('#exOpts input[data-k=dev]').click());
  await p.evaluate(() => { const b = document.getElementById('exGo'); b.click(); b.click(); });
  await p.waitForTimeout(1500);   /* clearing may reload the page */
  await p.click('#tabPlay');
  assert.equal(await welcome(), '1');
  assert.match(await p.textContent('#setSteps'), /Mic check/);
});

audioTest('starting a run from the welcome closes it, so the results are not hidden', async () => {
  const p = await open({ seeded: true, eachUnit: 'pass', eachVal: 1, bpm: 200 });
  await p.evaluate(() => { window.__T.S().input = 'kb'; window.__T.sync(); });   /* switched to keys part-way through set-up */
  assert.match(await p.textContent('#setSteps'), /not needed with keyboard input/);
  assert.doesNotMatch(await p.textContent('#setSteps'), /Mic check done/);
  await p.keyboard.press('Space');
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  assert.equal(await p.evaluate(() => document.body.dataset.welcome), '');
  assert.deepEqual(p.errors, []);
});

audioTest('View while playing: the staff by default; with Highway chosen, the highway takes its place only while a run plays', async () => {
  const shown = (p, sel) => p.evaluate(s => { const e = document.querySelector(s), cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden'; }, sel);
  const start = async p => { await p.keyboard.press('Space'); await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 }); };
  const staff = await open({ seeded: true, noise: -50, latCal: true, input: 'kb', eachUnit: 'pass', eachVal: 2 });
  assert.equal(await staff.getAttribute('#viewStaff', 'aria-pressed'), 'true');
  await start(staff);
  assert.ok(await shown(staff, '#rows'), 'the staff while playing, by default');
  assert.ok(!(await shown(staff, '#hwy')));
  assert.deepEqual(staff.errors, []);
  const p = await open({ seeded: true, noise: -50, latCal: true, input: 'kb', eachUnit: 'pass', eachVal: 2, view: 'hwy' });
  assert.equal(await p.getAttribute('#viewHwy', 'aria-pressed'), 'true');
  assert.ok(await shown(p, '#rows'), 'before a run the staff is still there to pick the exercise');
  assert.ok(!(await shown(p, '#hwy')));
  await start(p);
  await p.waitForTimeout(300);
  assert.ok(await shown(p, '#hwy'), 'the highway while playing');
  assert.ok(!(await shown(p, '#rows')));
  assert.ok(await p.evaluate(() => { const c = document.getElementById('hwy'); return c.width > 0 && c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some(v => v); }), 'the highway is drawn');
  await p.evaluate(() => document.getElementById('viewStaff').click());   /* Staff chosen mid-run: back to the staff */
  assert.equal(await p.getAttribute('#viewStaff', 'aria-pressed'), 'true');
  assert.equal(await p.getAttribute('#viewHwy', 'aria-pressed'), 'false');
  assert.ok(await shown(p, '#rows'), 'Staff chosen, the staff again');
  assert.ok(!(await shown(p, '#hwy')));
  assert.deepEqual(p.errors, []);
});

micTest('cancelling Auto calibrate stops its clicks, so starting again does not stack them', async () => {
  /* Count the short clicks Auto calibrate schedules, and forget each one once it is stopped or has played. */
  const p = await open({ seeded: true, noise: -50 }, null, () => {
    const live = window.__clicks = new Set(), start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function () { if (this.buffer && Math.abs(this.buffer.duration - 0.012) < 0.001) {   /* Auto calibrate's 12 ms click, not the silent unlock sound */ live.add(this); this.addEventListener('ended', () => live.delete(this)); } return start.apply(this, arguments); };
    AudioBufferSourceNode.prototype.stop = function () { live.delete(this); return stop.apply(this, arguments); };
  });
  const waiting = () => p.evaluate(() => window.__clicks.size);
  const step = () => p.locator('#setSteps button.primary');
  await step().click();   /* Auto calibrate */
  await p.waitForFunction(() => window.__clicks.size >= 10, null, { timeout: 8000 });
  const n = await waiting();
  assert.ok(n >= 10, 'clicks scheduled: ' + n);
  await step().click();   /* Cancel */
  assert.equal(await waiting(), 0, 'cancelling stops every click still to come');
  await step().click();   /* Auto calibrate again */
  await p.waitForFunction(() => window.__clicks.size >= 10, null, { timeout: 8000 });
  assert.ok(await waiting() <= n, 'starting again schedules one set, not two');
  await step().click();
  assert.equal(await waiting(), 0);
  assert.deepEqual(p.errors, []);
});

test('a fresh app starts on 8 passes at 40 BPM with the Easy click; saved settings are kept', async () => {
  const fresh = await open({});
  assert.deepEqual(await fresh.evaluate(() => { const S = window.__T.S(); return [S.click, S.eachUnit, S.eachVal, S.bpm]; }), ['strokes', 'pass', 8, 40]);
  const kept = await open({ click: 'beat', eachUnit: 'min', eachVal: 2, bpm: 90 });
  assert.deepEqual(await kept.evaluate(() => { const S = window.__T.S(); return [S.click, S.eachUnit, S.eachVal, S.bpm]; }), ['beat', 'min', 2, 90]);
});

test('the tempo steps by 1, opens a sheet to type it or step by 10, stops at 40 and 220, and the quick row fits a phone', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true, bpm: 41 }, { width: 390, height: 844 }, () => {
    if (localStorage.getItem('stick-timing-trainer.records.v2')) return;
    const run = (i, b) => ({ id: 'r' + i, t: Date.now() - 86400000 * (3 - i), mode: 'single', rk: null, lv: 'beat', dy: '', ne: 1, bpm: b, tol: 20, sec: 60,
      exercises: [{ k: '8 RLRL', bpm: b, due: 16, within: 8, heard: 16, avg: 0, sd: 3, miss: 0, i: 1 }] });
    localStorage.setItem('stick-timing-trainer.records.v2', JSON.stringify({ v: 1, names: {}, nu: 1, lib: [], runs: [run(0, 55), run(1, 60)] }));
  });
  const bpm = () => p.evaluate(() => window.__T.S().bpm);
  await p.click('#bpmDown'); assert.equal(await bpm(), 40);
  await p.click('#bpmDown'); assert.equal(await bpm(), 40, 'never below 40');
  await p.click('#bpmUp'); assert.equal(await bpm(), 41);
  assert.equal(await p.textContent('#bpmNum'), '41');
  await p.click('#bpmOpen'); assert.ok(await p.isVisible('#tempoModal'), 'tapping the tempo opens the sheet');
  await p.click('#tmUp10'); await p.click('#tmUp10'); assert.equal(await bpm(), 61, 'steps of 10');
  await p.click('#tmDown10'); await p.click('#tmDown'); assert.equal(await bpm(), 50);
  assert.equal(await p.inputValue('#tmRange'), '50', 'the slider follows');
  await p.fill('#tmRange', '75'); assert.equal(await bpm(), 75, 'the slider sets it');
  await p.keyboard.press('Escape'); assert.ok(!(await p.isVisible('#tempoModal')), 'Escape closes it');
  assert.equal(await p.textContent('#bpmNum'), '75');
  await p.click('#bpmOpen'); await p.fill('#bpm', '120'); await p.press('#bpm', 'Enter');
  assert.equal(await bpm(), 120, 'typed');
  assert.ok(!(await p.isVisible('#tempoModal')), 'Enter keeps it and closes the sheet');
  await p.click('#bpmOpen'); await p.fill('#bpm', '300'); await p.press('#bpm', 'Enter');
  assert.equal(await bpm(), 220, 'never above 220');
  assert.equal(await p.inputValue('#bpm'), '220');
  await p.click('#bpmOpen'); await p.fill('#bpm', ''); await p.press('#bpm', 'Enter');
  assert.equal(await p.inputValue('#bpm'), '220', 'an empty box goes back to the tempo');
  await p.click('#bpmOpen'); await p.click('#bpm'); await p.keyboard.type('90');
  assert.equal(await p.inputValue('#bpm'), '90', 'clicking the box selects its value, so typing replaces it');
  await p.fill('#bpm', '220'); await p.press('#bpm', 'Enter');
  assert.match(await p.textContent('#playSummary'), /^220 BPM/);
  const chips = await p.$$eval('#tmChips .tmchip', b => b.map(x => x.textContent));
  assert.ok(chips.length >= 1 && chips.every(c => /^\d+ BPM(Last time|Cleared|Recent)$/.test(c)), 'the sheet offers the tempos played: ' + chips);
  const nums = chips.map(c => parseInt(c));
  assert.ok(nums.length >= 2 && nums.every((n, i) => !i || n > nums[i - 1]), 'slowest to fastest: ' + chips);
  await p.click('#bpmOpen'); const first = await p.$eval('#tmChips .tmchip b', b => parseInt(b.textContent));
  await p.click('#tmChips .tmchip'); assert.equal(await bpm(), first, 'a chip sets its tempo');
  assert.ok(!(await p.isVisible('#tempoModal')), 'and closes the sheet');
  await p.click('#bpmOpen'); await p.click('#tmDone'); assert.ok(!(await p.isVisible('#tempoModal')), 'Done closes it');
  const b0 = await bpm(); const box = await p.$eval('#bpmUp', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await p.mouse.move(box[0], box[1]); await p.mouse.down(); await p.waitForTimeout(1200); await p.mouse.up();
  const b1 = await bpm(); assert.ok(b1 >= b0 + 5 && b1 <= 220, 'holding + keeps going: ' + b0 + ' to ' + b1);
  await p.waitForTimeout(300); assert.equal(await bpm(), b1, 'and stops on release, without one more step');
  await p.click('#ckHalf');
  assert.equal(await p.evaluate(() => window.__T.S().click), 'half');
  assert.equal(await p.getAttribute('#ckHalf', 'aria-pressed'), 'true');
  assert.equal(await p.textContent('#clickHint'), 'A click on the strong beats. Underlined notes get a click.');
  const w = await p.evaluate(() => ({ page: document.documentElement.scrollWidth, btn: ['bpmDown', 'bpmUp', 'bpmOpen', 'eachVal', 'eachUnit', 'ckStrokes', 'ckBar'].map(id => document.getElementById(id).getBoundingClientRect()).map(r => Math.min(r.width, r.height)), over: [...document.querySelectorAll('#clickSeg button')].some(b => b.scrollWidth > b.clientWidth) }));
  assert.ok(w.btn.every(x => x >= 44), 'controls are 44px targets: ' + w.btn);
  assert.ok(!w.over, 'the click levels fit their buttons');
  assert.ok(w.page <= 390, 'no sideways scroll');
  assert.deepEqual(p.errors, []);
});

test('Harder: silent bars: clicked notes underlined, one stepper in a closed disclosure, silent bars faded, a key that says so, kept, and off on Solo with the reason', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true, click: 'beat' }, { width: 390, height: 844 });
  const marks = () => p.evaluate(() => { const c = [...document.querySelectorAll('#rowsTrack .staff .cd')].filter(g => g.querySelector('.lt').textContent); const n = k => c.filter(g => g.classList.contains(k)).length; return [n('ck'), n('sb')]; });
  const wt = () => p.evaluate(() => ['.ck', ':not(.ck):not(.sb)', '.sb'].map(k => { const g = document.querySelector('#rowsTrack .staff .cd' + k + ' .lt'); return g ? getComputedStyle(g).textDecorationLine : ''; }));
  const key = () => p.evaluate(() => [...document.querySelectorAll('.cap.key')].filter(e => e.offsetParent).map(e => e.innerText.replace(/\s+/g, ' ').trim()));
  const val = () => p.evaluate(() => document.getElementById('barsOffN').firstChild.textContent + ' ' + document.getElementById('barsDots').children.length + ' ' + document.getElementById('barsSum').textContent);
  assert.equal(await p.getAttribute('#barsBox', 'open'), null, 'closed to start with');
  assert.equal(await val(), '0 0 Off');
  const [ck0, sil0] = await marks();
  assert.ok(ck0 > 0 && sil0 === 0, 'clicked notes underlined, no silent bars: ' + ck0 + '/' + sil0);
  assert.deepEqual(await wt(), ['underline', 'none', ''], 'underlined with a click, plain without');
  assert.deepEqual(await key(), ['R click · R no click'], 'before a run the key is the click key, not the timing key');
  await p.click('#barsBox>summary');
  assert.equal(await p.textContent('#barsHint'), 'Add a silent bar with +. The exercise above shows where it goes.');
  assert.ok(await p.isDisabled('#barsOffDown'));
  await p.click('#barsOffUp');
  assert.equal(await val(), '1 2 1 bar');
  assert.equal(await p.evaluate(() => window.__T.S().bars), '10');
  assert.equal(await p.textContent('#barsHint'), 'Faded notes are a silent bar. Silent bars are still scored: points ×1.25.');
  const [ck1, sil1] = await marks();
  assert.ok(sil1 > 0 && ck1 < ck0, 'silent bars are faded and lose their underlines: ' + ck1 + '/' + sil1);
  assert.deepEqual(await key(), ['R click · R no click · R silent bar']);
  await p.click('#ckStrokes');
  assert.ok((await marks())[0] > ck1, 'Easy underlines more notes');
  await p.click('#ckBeat');
  for (let i = 0; i < 3; i++) await p.click('#barsOffUp');
  assert.equal(await val(), '4 5 4 bars', 'up to 4 silent bars');
  assert.ok(await p.isDisabled('#barsOffUp'));
  assert.match(await p.textContent('#barsHint'), /×2.$/);
  const w = await p.evaluate(() => ({ page: document.documentElement.scrollWidth, btn: [...document.querySelectorAll('#barsBox>summary, #barsOffDown, #barsOffUp')].map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }) }));
  assert.ok(w.btn.every(x => x >= 44), '44px targets: ' + w.btn);
  assert.ok(w.page <= 390, 'no sideways scroll');
  await p.click('#ckNone');
  assert.ok(await p.isDisabled('#barsOffDown'), 'off on Solo');
  assert.equal(await p.textContent('#barsSum'), 'Off on Solo');
  assert.equal(await p.textContent('#barsHint'), 'Off on Solo: it has no click after the count-in.');
  assert.deepEqual(await marks(), [0, 0], 'Solo underlines nothing');
  assert.deepEqual(await key(), [], 'and no click key');
  await p.click('#ckBeat');
  assert.equal(await p.evaluate(() => window.__T.S().bars), '10000', 'the setting comes back after Solo');
  await p.reload();
  assert.equal(await val(), '4 5 4 bars', 'kept');
  await p.click('#barsBox>summary');
  for (let i = 0; i < 4; i++) await p.click('#barsOffDown');
  assert.equal(await val(), '0 0 Off', 'no silent bars is every bar again');
  assert.deepEqual(p.errors, []);
});

audioTest('Listen, under the staff, plays the click with no count-in and the cursor moving, says what it plays, and stops on a setting change or a tab change', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true, click: 'beat', bpm: 120 }, { width: 390, height: 844 });
  const lab = () => p.getAttribute('#ckHear', 'aria-label');
  assert.equal(await lab(), 'Listen to the click');
  assert.equal(await p.textContent('#ckHearNote'), 'Hear the click for 2 passes at 120 BPM.');
  const pos = await p.evaluate(() => {
    const y = id => document.getElementById(id).getBoundingClientRect().top, b = document.getElementById('ckHear').getBoundingClientRect();
    return { start: y('startBtn'), name: y('playName'), click: y('clickSeg'), rows: y('rows'), hear: y('ckHear'), r: Math.min(b.width, b.height) };
  });
  assert.ok(pos.r >= 44, '44px target: ' + pos.r);
  assert.ok(pos.name < pos.start && pos.start < pos.click, 'Start sits under the routine, above the settings: ' + JSON.stringify(pos));
  assert.ok(pos.hear > pos.rows, 'Listen sits under the staff: ' + JSON.stringify(pos));
  await p.click('#barsBox>summary');
  await p.click('#barsOffUp');
  assert.equal(await p.textContent('#ckHearNote'), 'Hear the click at 120 BPM, twice round the bars with the click and the silent bars.');
  await p.click('#ckNone');
  assert.equal(await p.isVisible('#ckHear'), false, 'Solo has no click to hear');
  await p.click('#ckBeat');
  await p.click('#ckHear');
  await p.waitForFunction(() => document.getElementById('ckHear').getAttribute('aria-label') === 'Stop');
  await p.click('#ckHear');
  assert.equal(await lab(), 'Listen to the click', 'Stop stops it');
  await p.click('#ckHear');
  await p.waitForFunction(() => document.getElementById('ckHear').getAttribute('aria-label') === 'Stop');
  await p.click('#ckStrokes');
  assert.equal(await lab(), 'Listen to the click', 'a setting change stops it');
  await p.click('#ckHear');
  await p.waitForFunction(() => document.getElementById('ckHear').getAttribute('aria-label') === 'Stop');
  await p.click('#tabLibrary');
  await p.click('#tabPlay');
  assert.equal(await lab(), 'Listen to the click', 'leaving Play stops it');
  assert.deepEqual(p.errors, []);
});

test('a newer version on the server shows the update notice, asked at an address no cache can answer', async () => {
  /* WebKit lets a page's requests pass a route once a service worker is installed, so this one has none and routes before the page loads. */
  const ctx = await browser.newContext({ ...contextFor({ width: 390, height: 900 }), serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('stick-timing-trainer.v1', JSON.stringify({ settings: { seeded: true, noise: -50, latCal: true }, cal: null })));
  const asked = [];
  await ctx.route(u => u.searchParams.has('check'), async r => {
    asked.push(r.request().url());
    const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace(/const VERSION='[\d.]+'/, "const VERSION='99.0.0'") });
  });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  await p.goto(base);
  await p.waitForSelector('#updNote:not([hidden])', { timeout: 5000 });
  assert.equal(await p.textContent('#updText'), 'A new version (99.0.0) is available.');
  assert.ok(asked.length && asked.every(u => /\?check=\d+$/.test(u)), 'a new address each time: ' + asked);
  await p.click('#updLater'); assert.ok(!(await p.isVisible('#updNote')), 'Later hides it');
  assert.deepEqual(p.errors, []);
});

test('on desktop the tempo sheet covers only the controls column', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true }, { width: 1280, height: 800 });
  await p.click('#tabPlay'); await p.click('#bpmOpen');
  const r = await p.evaluate(() => [document.querySelector('#tempoModal .mbox'), document.querySelector('#pagePlay>.pctl'), document.querySelector('#pagePlay>.pview')].map(e => e.getBoundingClientRect()));
  assert.ok(Math.abs(r[0].left - r[1].left) < 1 && Math.abs(r[0].width - r[1].width) < 1, 'the width of the column: ' + JSON.stringify(r.slice(0, 2)));
  assert.ok(r[0].right <= r[2].left, 'clear of the staff');
  assert.ok(r[0].bottom <= 800, 'on screen');
  await p.setViewportSize({ width: 1100, height: 800 });
  const follows = await p.waitForFunction(() => { const [m, c] = [document.querySelector('#tempoModal .mbox'), document.querySelector('#pagePlay>.pctl')].map(e => e.getBoundingClientRect()); return innerWidth === 1100 && Math.abs(m.left - c.left) < 1 && Math.abs(m.width - c.width) < 1; }, null, { timeout: 2000 }).then(() => true, () => false);   /* WebKit can send resize a little after the viewport changes */
  assert.ok(follows, 'and follows it when the window changes size');
  assert.deepEqual(p.errors, []);
});

test('Report a timing problem opens feedback with the timing ticked, and Copy and Email it say what they did', async () => {
  const log = [{ t: 1, ver: 'x', ok: true, slip: 0, clicks: 36, runs: 1, mics: 1 }, { t: 2, ver: 'x', ok: false, slip: 250, clicks: 4, runs: 1, mics: 0, kb: true }];
  const p = await open({ seeded: true, noise: -50, latCal: true, clockLog: log }, null, () => {
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } });
  });
  await p.click('#tabSetup');
  await p.click('#svBtnDev');
  assert.equal(await p.$('#clkReset'), null, 'no Reset audio');
  await p.click('#clkReport');
  assert.equal(await p.isVisible('#fbModal'), true);
  assert.equal(await p.isChecked('#fbDev'), true, 'a timing report includes the details');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'fbText');
  assert.match(await p.inputValue('#fbText'), /out of step with the count-in/);
  await p.click('#fbShow summary');
  const det = await p.textContent('#fbDet');
  assert.match(det, /^Pocket \d+\.\d+\.\d+\n/);
  assert.match(det, /Last 2 runs, newest first, times in UTC:/);
  assert.match(det, /x slipped, slip 250 ms, clicks 4 .* keyboard/);
  await p.fill('#fbText', 'The first click came late.');
  await p.click('#fbCopy');
  await p.waitForTimeout(100);
  assert.match(await p.textContent('#fbMsg'), /^Copied\. Paste it into an email to pocket@mndlss\.com/);
  const copied = await p.evaluate(() => window.__copied);
  assert.match(copied, /^To: pocket@mndlss\.com\n\nThe first click came late\.\n\n-- Device and timing details --\nPocket /);
  /* without the details, only the message */
  await p.uncheck('#fbDev');
  assert.equal(await p.isVisible('#fbShow'), false);
  await p.click('#fbCopy');
  await p.waitForTimeout(100);
  assert.equal(await p.evaluate(() => window.__copied), 'To: pocket@mndlss.com\n\nThe first click came late.');
  await p.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('no')); });
  await p.click('#fbCopy');
  await p.waitForTimeout(100);
  assert.match(await p.textContent('#fbMsg'), /blocked the clipboard/);
  await p.click('#fbMail');
  await p.waitForTimeout(200);
  assert.match(await p.textContent('#fbMsg'), /mail app should open/);
  assert.deepEqual(p.errors, []);
});

test('Send feedback in Help: no details by default, and Escape closes the dialog but not Help', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true });
  await p.click('#helpBtn');
  await p.waitForTimeout(200);
  await p.evaluate(() => document.getElementById('help-about').scrollIntoView());
  await p.click('#fbHelp');
  assert.equal(await p.isVisible('#fbModal'), true);
  assert.equal(await p.isChecked('#fbDev'), false);
  assert.equal(await p.inputValue('#fbText'), '');
  await p.keyboard.press('Escape');
  assert.equal(await p.isVisible('#fbModal'), false);
  assert.equal(await p.isVisible('#pg'), true, 'Help is still open');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'fbHelp', 'focus goes back to the button');
  assert.equal(await p.getAttribute('#help-about a[href*="github"]', 'rel'), 'noopener');
  assert.deepEqual(p.errors, []);
});

test('the Library opens sorted by name, with Name first, and Recent puts the newest first', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true }, null, () => {
    if (!localStorage.getItem('stick-timing-trainer.records.v2')) localStorage.setItem('stick-timing-trainer.records.v2', JSON.stringify({ v: 1, names: {}, nu: 1, runs: [], lib: [
      { id: 'a1', x: '8 RLRL RLRL', t: 3 }, { id: 'a2', x: '8 RRLL RRLL', t: 1 }, { id: 'a3', x: '8 RLLR RLLR', t: 2 }] }));
  });
  await p.click('#tabLibrary');
  const names = () => p.evaluate(() => [...document.querySelectorAll('#pageLibrary .glib .hrow > .row > .rt')].map(e => e.textContent));
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#pageLibrary [aria-label="Sort by"] button')].map(b => b.textContent + ':' + b.getAttribute('aria-pressed'))), ['Name:true', 'Recent:false']);
  assert.deepEqual(await names(), ['8 RLLR RLLR', '8 RLRL RLRL', '8 RRLL RRLL'], 'by name');
  await p.click('#lsRecent');
  assert.deepEqual(await names(), ['8 RLRL RLRL', '8 RLLR RLLR', '8 RRLL RRLL'], 'newest first');
  await p.reload(); await p.waitForTimeout(300);
  await p.click('#tabLibrary');
  assert.deepEqual(await names(), ['8 RLRL RLRL', '8 RLLR RLLR', '8 RRLL RRLL'], 'the choice is remembered');
  assert.equal(await p.getAttribute('#lsRecent', 'aria-pressed'), 'true');
  assert.deepEqual(p.errors, []);
});

test('Change lists the four routines last opened or played at the top, without the open one', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true, libId: 'b1', libOpened: [{ id: 'b2', t: 50 }, { id: 'b3', t: 40 }, { id: 'b1', t: 30 }] }, null, () => {
    if (!localStorage.getItem('stick-timing-trainer.records.v2')) localStorage.setItem('stick-timing-trainer.records.v2', JSON.stringify({ v: 1, names: {}, nu: 1, runs: [], lib: [
      { id: 'b1', x: 'G: 8 RLRL RLRL', t: 1 }, { id: 'b2', x: 'G: 8 RRLL RRLL', t: 1 }, { id: 'b3', x: 'G: 8 RLLR RLLR', t: 1 },
      { id: 'b4', x: 'G: 8 RRRL RRRL', t: 1 }, { id: 'b5', x: 'G: 8 RLRR RLRR', t: 1 }, { id: 'b6', x: 'G: 8 LRLR LRLR', t: 1 }] }));
  });
  const recent = () => p.evaluate(() => [...document.querySelectorAll('#pickList .pickrec .row > .rt')].map(e => e.textContent));
  await p.evaluate(() => document.getElementById('pickModal').hidden || document.getElementById('pickClose').click());
  await p.click('#playChange');
  const first = await recent();
  assert.equal(first.length, 2, 'only routines opened before are listed, and not the open one: ' + first);
  assert.ok(!first.some(n => /RLRL RLRL/.test(n)), 'the open routine is left out');
  /* open another from its group: it goes to the top next time, and the one it replaced joins the list */
  assert.equal(await p.evaluate(() => document.querySelector('#pickList .glib').open), true, 'the group of the open routine is open');
  await p.locator('#pickList .glib .row').filter({ hasText: 'RRRL' }).click();
  await p.waitForTimeout(200);
  await p.click('#playChange');
  const next = await recent();
  assert.equal(next.length, 3);
  assert.match(next[0], /RLRL RLRL/, 'the routine open before is now the newest');
  assert.ok(!next.some(n => /RRRL/.test(n)), 'the routine now open is left out');
  assert.deepEqual(p.errors, []);
});

test('Device has no stick calibration, and an old saved one is dropped', async () => {
  const p = await open(null, null, () => {
    if (!localStorage.getItem('stick-timing-trainer.v1')) localStorage.setItem('stick-timing-trainer.v1', JSON.stringify({ settings: { seeded: true, noise: -50, latCal: true, handDet: true }, cal: { L: [[1, 2]], R: [[3, 4]] } }));
  });
  await p.click('#tabSetup'); await p.click('#svBtnDev');
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#svDev h3, [aria-label="Stick calibration"]')].map(e => e.textContent).filter(t => /stick|hand/i.test(t))), []);
  await p.evaluate(() => document.getElementById('vol').dispatchEvent(new Event('input')));
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('stick-timing-trainer.v1')));
  assert.equal(saved.cal, undefined);
  assert.equal(saved.settings.handDet, undefined);
  assert.deepEqual(p.errors, []);
});

test('the microphone level slider moves its trigger line', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true, sens: -30 });
  await p.click('#tabSetup');
  await p.click('#svBtnDev');
  const left = () => p.evaluate(() => parseFloat(document.getElementById('mThr').style.left));
  assert.equal(Math.round(await left()), 50);   /* -30 dB on a -60..0 scale */
  await p.evaluate(() => { const s = document.getElementById('sens'); s.value = -15; s.dispatchEvent(new Event('input')); });
  assert.equal(Math.round(await left()), 75);
  assert.deepEqual(p.errors, []);
});

test('after one visit the app opens without a connection, and a new version still arrives online', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true });
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.waitForFunction(async () => !!(await caches.match('./')), null, { timeout: 8000 });
  await p.context().setOffline(true);
  await p.reload();
  await p.waitForTimeout(400);
  assert.equal(await p.title(), 'Pocket - your pad practice coach');
  assert.equal(await p.evaluate(() => document.body.dataset.welcome), '', 'the app ran, with its saved settings');
  await p.context().setOffline(false);
  const served = () => p.evaluate(async () => +(await fetch(location.pathname, { cache: 'no-cache' })).headers.get('x-served'));
  const a = await served(), b = await served();
  assert.ok(b > a, 'online, the page comes from the server each time, not the cache: ' + a + ', ' + b);
});

test('a returning visit goes straight to Play', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true });
  assert.equal(await p.evaluate(() => !!document.getElementById('setup').offsetParent), false);
  assert.equal(await p.evaluate(() => !!document.getElementById('startBtn').offsetParent), true);
});

test('every Help section can scroll its heading to the top, the last ones too, on a phone and on desktop', async () => {
  for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const p = await open({ seeded: true, noise: -50, latCal: true }, size);
    await p.click('#helpBtn');
    await p.waitForTimeout(200);
    const off = await p.evaluate(async () => {
      const bd = document.getElementById('pgBody'), out = [];
      for (const s of document.querySelectorAll('#pageHelp > section.panel')) {
        s.scrollIntoView({ block: 'start' });
        await new Promise(r => requestAnimationFrame(r));
        out.push([s.id, Math.round(s.getBoundingClientRect().top - bd.getBoundingClientRect().top)]);
      }
      return out;
    });
    const bad = off.filter(([, d]) => Math.abs(d - off[0][1]) > 2);   /* each lands where the first one does, under the page's own padding */
    assert.deepEqual(bad, [], size.width + 'px: sections that stop short of the top');
    assert.deepEqual(p.errors, []);
  }
});

test('Help ends with About: the licence and a link to the source', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true });
  await p.click('#helpBtn');
  await p.waitForTimeout(200);
  const o = await p.evaluate(() => {
    const s = document.getElementById('help-about'), a = s.querySelector('a'), r = a.getBoundingClientRect();
    return { last: s === [...document.querySelectorAll('#pageHelp > section.panel')].pop(), text: s.textContent, href: a.href, target: a.target, rel: a.rel, h: r.height };
  });
  assert.ok(o.last, 'About is the last section');
  assert.match(o.text, /Pocket is free/, 'no version: Pocket is free, not just this version');
  assert.match(o.text, /GNU General Public License/);
  assert.equal(o.href, 'https://github.com/pickle-cake/pocket');
  assert.equal(o.target, '_blank');
  assert.equal(o.rel, 'noopener');
  assert.ok(o.h >= 44, 'a 44px target: ' + o.h);
  assert.deepEqual(p.errors, []);
});

test('Help opens and the Try it buttons load their exercise', async () => {
  const p = await open({ seeded: true });
  await p.click('#helpBtn').catch(async () => { await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Help').click()); });
  await p.waitForTimeout(300);
  const tries = await p.evaluate(() => document.querySelectorAll('[data-try]').length);
  assert.ok(tries >= 5, 'Try it buttons found: ' + tries);
  assert.deepEqual(p.errors, []);
});

/* Plays a routine by calling the hit handler with times relative to the run. */
async function playScenario(text, bpm, spec) {
  const p = await open({ input: 'kb', bpm, routineText: text, seeded: true });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(spec => {
    const T = window.__T, r = T.run(), pl = r.plan;
    pl.slots.forEach((s, i) => {
      const note = pl.segs[s.seg].notes[s.pos], hand = note.slice(-1), other = hand === 'R' ? 'L' : 'R';
      const hit = (t, h) => T.hit({ t: r.t0 + t, kb: true, f: null, det: { hand: h, conf: 1 } });
      if (s.gr) (spec.pre || []).forEach(d => hit(s.t - d, other));
      if (spec.stray === i && !s.gr) hit(s.t - 0.04, other);
      hit(s.t + 0.005, hand);
    });
  }, spec);
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  const r = await p.evaluate(() => { const r = window.__T.run(); return { slots: r.slots, miss: r.miss, within: r.within, extras: r.extras }; });
  assert.deepEqual(p.errors, []);
  return r;
}

audioTest('flam grace notes are not extras, and the main stroke is scored', async () => {
  const r = await playScenario('8 fR fL R L x2', 120, { pre: [0.03] });
  assert.deepEqual(r, { slots: 8, miss: 0, within: 8, extras: 0 });
});

audioTest('drag grace notes at a fast tempo are not extras', async () => {
  const r = await playScenario('16 dR dL R L x2', 120, { pre: [0.1, 0.05] });
  assert.deepEqual(r, { slots: 8, miss: 0, within: 8, extras: 0 });
});

audioTest('a stray hit before a plain stroke is still an extra', async () => {
  const r = await playScenario('8 R L R L x2', 120, { stray: 2 });
  assert.equal(r.extras, 1);
  assert.equal(r.miss, 0);
});

test('saved titles survive a reload, including long single exercises', async () => {
  const p = await open({ seeded: true });
  await p.click('#tabLibrary');
  await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Import').click());
  await p.setInputFiles('#routineFile', path.join(ROOT, 'routines/rudiments.txt'));
  await p.waitForTimeout(600);
  await p.reload();
  await p.waitForTimeout(400);
  await p.click('#tabLibrary');
  await p.waitForTimeout(300);
  const untitled = await p.evaluate(() => [...document.querySelectorAll('#libPage > .hrow .hn')].map(e => e.textContent));
  assert.deepEqual(untitled, [], 'routines that lost their title: ' + untitled.join(' | '));
});

test('builder: flam holds until a stroke, greys the other keys, and writes fR', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true, routineText: '8 RL' });
  await p.click('#editPlay');
  await p.waitForTimeout(300);
  const off = () => p.evaluate(() => [...document.querySelectorAll('.bkey')].filter(k => k.disabled).map(k => k.dataset.k));
  assert.deepEqual(await off(), []);
  await p.click('.bkey[data-k="flam"]');
  assert.deepEqual((await off()).sort(), ['_', 'back', 'clear', 'group', 'swap']);
  await p.click('.bkey[data-k="drag"]');
  assert.equal(await p.getAttribute('.bkey[data-k=drag]', 'aria-pressed'), 'true');
  await p.click('.bkey[data-k="drag"]');
  assert.deepEqual(await off(), []);
  await p.click('.bkey[data-k="flam"]');
  await p.click('.bkey[data-k="R"]');
  assert.equal(await p.inputValue('#routineText'), '8 RLfR');
  assert.deepEqual(await off(), []);
  assert.deepEqual(p.errors, []);
});

test('menus: one open at a time, Escape and the same button close it', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true, routineText: 'RLRL RLRL\nLRLR LRLR' });
  await p.click('#editPlay');
  const open_ = () => p.evaluate(() => [...document.querySelectorAll('.menu')].filter(m => !m.hidden).map(m => m.id));
  const dots = '#editList .erow:first-child .dots';
  await p.click(dots);
  assert.deepEqual(await open_(), ['exMenu']);
  assert.equal(await p.getAttribute(dots, 'aria-expanded'), 'true');
  await p.keyboard.press('Escape');
  assert.deepEqual(await open_(), []);
  assert.equal(await p.getAttribute(dots, 'aria-expanded'), 'false');
  await p.click(dots);
  await p.click(dots);
  assert.deepEqual(await open_(), [], 'the same button closes it');
  await p.click(dots);
  await p.click('#saveMore');
  assert.deepEqual(await open_(), ['saveMenu'], 'opening another closes the first');
  await p.click('#saveNew');
  assert.deepEqual(await open_(), [], 'an item closes it');
  assert.deepEqual(p.errors, []);
});

test('editor: Discard puts a saved routine back', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true, routineText: 'title: Mine\n8 RLRL RLRL' });
  await p.click('#editPlay');
  await p.click('#saveBtn');
  await p.click('.bkey[data-k="flam"]');
  await p.click('.bkey[data-k="R"]');
  assert.equal(await p.textContent('#edState'), 'Unsaved');
  await p.click('#saveMore');
  await p.click('#edDiscard');
  assert.equal(await p.textContent('#edDiscard'), 'Tap again to discard');
  assert.equal(await p.isVisible('#saveMenu'), true, 'the first tap keeps the menu open');
  await p.click('#edDiscard');
  assert.equal(await p.isVisible('#saveMenu'), false);
  assert.equal(await p.inputValue('#routineText'), 'title: Mine\n8 RLRL RLRL');
  assert.equal(await p.textContent('#edState'), 'Saved');
});

test('Clear asks what to wipe, starts with nothing ticked, and asks twice', async () => {
  const p = await open({ seeded: true });
  await p.click('#tabSettings').catch(() => {});
  await p.evaluate(() => document.getElementById('recClear').click());
  const r = await p.evaluate(() => ({ parts: [...document.querySelectorAll('#exOpts input')].map(c => c.dataset.k + ':' + c.checked), off: document.getElementById('exGo').disabled, redo: !!document.getElementById('redoSetup') }));
  assert.deepEqual(r.parts, ['hist:false', 'lib:false', 'lists:false', 'set:false', 'dev:false']);
  assert.equal(r.off, true);
  assert.equal(r.redo, false);
  await p.evaluate(() => document.querySelector('#exOpts input[data-k=dev]').click());
  const label = await p.evaluate(() => { const b = document.getElementById('exGo'); b.click(); return b.textContent + '|' + ('armed' in b.dataset); });
  assert.equal(label, 'Tap again to clear|true');
});

test('a stray exercise is deleted from a run, and an unheard one is not scored', async () => {
  const ctx = await browser.newContext(contextFor({ width: 390, height: 900 }));
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  await p.addInitScript(() => {
    if (localStorage.getItem('seeded-by-test')) return;
    localStorage.setItem('seeded-by-test', '1');
    const ex = (k, i, w, h) => ({ k, bpm: 60, due: 32, within: w, heard: h, avg: h ? -2.7 : null, sd: h ? 3 : null, miss: 0, i });
    localStorage.setItem('stick-timing-trainer.records.v2', JSON.stringify({ v: 1, names: { pabc: 'Mine' }, nu: 1, lib: [], runs: [{
      id: 'r1', t: Date.now(), mode: 'routine', rk: 'pabc', lv: 'beat', dy: '', ne: 3, bpm: 60, tol: 20, sec: 120,
      exercises: [ex('8 RLRL RLRL', 1, 30, 32), ex('8 RRLL RRLL', 2, 26, 32), ex('8 dLfR', 3, 0, 0)],
      rp: { x: 'RLRL RLRL\nRRLL RRLL\ndLfR', st: 1, ev: 8, eu: 'pass', gp: 0, o: null } }] }));
    localStorage.setItem('stick-timing-trainer.v1', JSON.stringify({ settings: { seeded: true, noise: -50, latCal: true }, cal: null }));
  });
  await p.goto(base);
  await p.waitForTimeout(300);
  await p.click('#tabProgress');
  await p.locator('.lrow', { hasText: 'Mine' }).first().click();
  const text = () => p.evaluate(() => [...document.querySelectorAll('#pg')].map(x => x.innerText).join('|'));
  let t = await text();
  assert.match(t, /1 not played/);            /* nothing was heard in the last exercise */
  assert.doesNotMatch(t, /dLfR[\s\S]*on time/);    /* it is not scored, so it cannot be the weakest */
  await p.evaluate(() => { document.querySelector('details').open = true; document.querySelector('details .btn.icon').click(); });
  const del = () => p.evaluate(() => [...document.querySelectorAll('.menu:not([hidden]) button')].find(x => /^(Delete|Tap again to delete)$/.test(x.textContent)).click());
  await del(); await del();
  await p.waitForTimeout(300);
  t = await text();
  assert.doesNotMatch(t, /\d not played/);
  assert.match(t, /87%/);                      /* both exercises were played, so the run now has an overall score, rounded down */
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('stick-timing-trainer.records.v2')).runs[0]);
  assert.equal(saved.ne, 2);
  assert.deepEqual(p.errors, []);
  await ctx.close();
});

audioTest('coaching says when the exercises were too short for notes on single strokes', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: ['16 RLRL RLRL RLRL RLRL', '16 LRLR LRLR LRLR LRLR'].join(String.fromCharCode(10)), eachUnit: 'pass', eachVal: 2, seeded: true });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => {
    const T = window.__T, r = T.run(), pl = r.plan;
    pl.slots.forEach((s, i) => T.hit({ t: r.t0 + s.t + ((i * 7) % 5 - 2) / 1000, kb: true, f: null, det: { hand: pl.segs[s.seg].notes[s.pos].slice(-1), conf: 1 } }));
  });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(300);
  const t = await p.evaluate(() => document.getElementById('advice').innerText);
  assert.match(t, /Each exercise played 2 passes, so no single stroke was checked\. Notes on single strokes need at least 3 passes: set Each exercise to 3 passes or more\./, t);
  /* once the run is over, the early-or-late gauge covers the whole run, not the last 32 strokes */
  const g = await p.evaluate(() => { const e = window.__T.run().errs; return { span: document.querySelector('#leadBox h3').textContent, val: document.getElementById('gVal').textContent, n: e.length, mean: e.reduce((a, b) => a + b, 0) / e.length }; });
  assert.equal(g.span, 'Early or late, whole run');
  assert.ok(g.n > 32, 'more strokes than the live window');
  assert.equal(parseFloat(g.val.replace('−', '-')), Math.round(g.mean * 10) / 10 + 0, JSON.stringify(g));
  assert.deepEqual(p.errors, []);
});

/* One keyboard run with perfect hits. Returns how many runs were saved and the result text. */
audioTest('a finding after a run marks its strokes on the review staff, in brackets while the rest fade, and a second tap clears them', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: '16 RLRL RLRL', eachUnit: 'pass', eachVal: 10, seeded: true });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => {
    const T = window.__T, r = T.run(), pl = r.plan;
    pl.slots.forEach((s, i) => {
      const hand = pl.segs[s.seg].notes[s.pos].slice(-1), late = s.pos === 2 ? 0.03 : 0;   /* the third stroke always 30 ms late */
      T.hit({ t: r.t0 + s.t + late + ((i * 7) % 5 - 2) / 1000, kb: true, f: null, det: { hand, conf: 1 } });
    });
  });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(300);
  /* the hands differ too, since only the right hand is late, so the finding may come second */
  const note = await p.evaluate(() => document.querySelector('#advice [data-mk]').parentElement.innerText);
  assert.match(note, /^Stroke 3 \(R\) lands \d+ ms later than the rest of the exercise\. Show on staff Practise at 110 BPM$/, note);
  const btn = p.locator('#advice [data-mk]').first();
  assert.equal(await btn.textContent(), 'Show on staff');
  assert.equal(await p.isVisible('#mkKey'), false);
  await btn.click();
  await p.waitForFunction(() => +getComputedStyle(document.querySelector('#rows g.cd:not(.mk)')).opacity < 0.6, null, { timeout: 3000 });   /* the fade runs over a moment */
  const on = await p.evaluate(() => {
    const mk = [...document.querySelectorAll('#rows g.cd.mk')];
    return { n: mk.length, texts: [...new Set(mk.map(c => c.querySelector('.lt').textContent))], edge: mk.length ? [...mk[0].querySelectorAll('.mks')].filter(e => getComputedStyle(e).display !== 'none').length : '', dim: getComputedStyle(document.querySelector('#rows g.cd:not(.mk)')).opacity, lit: mk.length ? getComputedStyle(mk[0]).opacity : '', label: document.querySelector('#advice [data-mk]').textContent, key: !document.getElementById('mkKey').hidden };
  });
  assert.equal(on.n, 10, 'one stroke in each of the ten passes');
  assert.deepEqual(on.texts, ['R']);
  assert.equal(on.edge, 3, 'a single marked stroke is bracketed underneath, with both ends');
  assert.ok(+on.dim < 1 && +on.lit === 1, 'the strokes the note does not mean fade back');
  assert.equal(on.label, 'Hide on staff');
  assert.equal(on.key, true, 'the key under the staff explains the brackets');
  await btn.click();
  assert.equal(await p.evaluate(() => document.querySelectorAll('#rows g.cd.mk').length), 0);
  assert.equal(await p.evaluate(() => document.getElementById('rows').classList.contains('mking')), false, 'nothing stays faded');
  assert.equal(await btn.textContent(), 'Show on staff');
  assert.equal(await p.isVisible('#mkKey'), false);
  /* the drill: the beats around the stroke, 10 BPM slower, loaded on Play but not started */
  await p.locator('#advice [data-mk] ~ [data-drill]').first().click();
  if (await p.locator('#confirmModal').isVisible()) await p.click('#cfDiscard');   /* the routine was never saved */
  const after = await p.evaluate(() => ({ text: document.getElementById('routineText').value, bpm: document.getElementById('bpm').value, sum: document.getElementById('playSummary').textContent, state: document.body.dataset.state, review: document.body.dataset.review || '' }));
  assert.match(after.text, /^title: .*Drill/im, after.text);
  assert.match(after.text, /^16 RLRL( RLRL)*$/m, after.text);
  assert.equal(after.bpm, '110');
  assert.match(after.sum, /^110 BPM.* plays for 1 minute$/, after.sum);
  assert.notEqual(after.state, 'run');
  assert.notEqual(after.review, '1');
  assert.deepEqual(p.errors, []);
});

async function runOnce(settings, practice, init) {
  const p = await open(Object.assign({ input: 'kb', bpm: 120, routineText: '8 RLRL', eachUnit: 'pass', eachVal: 1, seeded: true }, settings), null, init);
  if (practice) await p.evaluate(() => { const s = document.getElementById('score'); s.value = '0'; s.dispatchEvent(new Event('change')); });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => {
    const T = window.__T, r = T.run(), pl = r.plan;
    pl.slots.forEach(s => {
      const hand = pl.segs[s.seg].notes[s.pos].slice(-1);
      T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand, conf: 1 } });
    });
  });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(300);
  const out = await p.evaluate(() => ({
    saved: ((JSON.parse(localStorage.getItem('stick-timing-trainer.records.v2')) || {}).runs || []).map(r => r.lv),
    text: document.getElementById('advice').innerText,
    warm: document.getElementById('advWarm').hidden ? '' : document.getElementById('advWarm').textContent,
    discard: !document.getElementById('advDiscard').hidden,
    badge: document.getElementById('advBadge').hidden ? '' : document.getElementById('advBadge').innerText,
    days: ((JSON.parse(localStorage.getItem('stick-timing-trainer.records.v2')) || {}).sum || {}).days || {},
  }));
  assert.deepEqual(p.errors, []);
  return out;
}

audioTest('Next step: a cleared run on Master with no silent bars offers one; Try sets it, Not now hides it for the day, and other levels get no offer', async () => {
  const play = async settings => {
    const p = await open(Object.assign({ input: 'kb', bpm: 120, routineText: '8 RLRL', eachUnit: 'pass', eachVal: 2, seeded: true, click: 'bar' }, settings), { width: 390, height: 844 });
    await press(p, /^Start/);
    await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
    await p.evaluate(() => {
      const T = window.__T, r = T.run(), pl = r.plan;
      pl.slots.forEach(s => T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand: pl.segs[s.seg].notes[s.pos].slice(-1), conf: 1 } }));
    });
    await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
    await p.waitForTimeout(300);
    return p;
  };
  let p = await play({});
  assert.ok(await p.isVisible('#advOffer'), 'offered after a cleared run on Master');
  assert.equal(await p.textContent('#offerT'), 'You held time with one click a bar. Try a silent bar next.');
  assert.equal(await p.textContent('#offerTx'), 'The click plays bar 1, then drops out for bar 2. Keep counting; it comes back on beat 1. Silent bars score more: points ×1.25.');
  const fig = await p.evaluate(() => [...document.querySelectorAll('#offerFig .bt')].map(b => b.className + ':' + b.textContent + ':' + b.querySelectorAll('.ck').length));
  assert.deepEqual(fig, ['bt:1234:1', 'bt sb:1234:0'], 'the count of a bar with the click, 1 underlined, then a silent bar');
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('.cap.key')].filter(e => e.offsetParent).map(e => e.id)), ['tmKey'], 'after a run, the timing key');
  const t = await p.evaluate(() => ['offerTry', 'offerLater'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return Math.min(r.width, r.height); }));
  assert.ok(t.every(x => x >= 44), '44px targets: ' + t);
  await p.click('#offerTry');
  assert.equal(await p.isVisible('#advOffer'), false);
  assert.equal(await p.evaluate(() => window.__T.S().bars), '10');
  assert.match(await p.textContent('#status'), /^Silent bars on: the click plays 1 bar, then leaves 1 bar out\. Press Again to play it\./);
  assert.deepEqual(p.errors, []);
  p = await play({});
  await p.click('#offerLater');
  assert.equal(await p.isVisible('#advOffer'), false);
  assert.equal(await p.evaluate(() => window.__T.S().bars), '', 'Not now changes nothing');
  await p.click('#advAgain');
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan && !window.__T.run().ended, null, { timeout: 8000 });
  await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.forEach(s => T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand: pl.segs[s.seg].notes[s.pos].slice(-1), conf: 1 } })); });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(300);
  assert.equal(await p.isVisible('#advOffer'), false, 'not again the same day');
  assert.deepEqual(p.errors, []);
  p = await play({ click: 'beat' });
  assert.equal(await p.isVisible('#advOffer'), false, 'Hard has the levels above it to try first');
  assert.deepEqual(p.errors, []);
});

audioTest('Restart sits after Stop and needs a second tap, so a stray tap keeps the run', async () => {
  const p = await open({ input: 'kb', bpm: 60, routineText: '8 RLRL', eachUnit: 'pass', eachVal: 4, seeded: true });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#runBtns button')].filter(b => b.offsetParent).map(b => b.id)), ['stopBtn', 'restartBtn']);
  await p.evaluate(() => { window.__first = window.__T.run(); });
  await p.click('#restartBtn');
  assert.equal(await p.textContent('#restartBtn'), 'Tap again to restart');
  assert.equal(await p.evaluate(() => window.__T.run() === window.__first && !window.__first.ended), true);
  await p.click('#restartBtn');
  await p.waitForFunction(() => window.__T.run() && window.__T.run() !== window.__first && window.__T.run().plan, null, { timeout: 8000 });
  assert.equal(await p.textContent('#restartBtn'), 'Restart');
  assert.deepEqual(p.errors, []);
});

test('a new best tempo names its medal and the tempo of the next; a raised medal leads the card when no badge was won', async () => {
  const p = await open({ game: true });
  const card = (bpm, was, n = 1) => p.evaluate(([bpm, was, n]) => {
    const k = '16 RLRR LRLL RLRR LRLL', L = { won: [], newTempo: Array.from({ length: n }, () => ({ key: k, bpm, was })), run: { lv: 'strokes' } };
    window.__T.unlocked(L, ['New best tempo: ' + (n === 1 ? k + ' at ' + bpm + ' BPM' : n + ' exercises at a new tempo')]);
    const b = document.getElementById('advBadge');
    return { lead: b.querySelector('.lbl').textContent, text: b.textContent, medal: !!b.querySelector('.medal') };
  }, [bpm, was, n]);
  let c = await card(90, 80);   /* Platinum before and after: a line */
  assert.equal(c.lead, 'New best tempo');
  assert.match(c.text, /at 90 BPM. Platinum on Easy. Sapphire at 100 BPM/);
  c = await card(100, 90);   /* Platinum to Sapphire: the medal leads */
  assert.equal(c.lead, 'New medal');
  assert.equal(c.medal, true);
  assert.match(c.text, /Sapphire on Easy.*cleared at 100 BPM, 400 strokes a minute..*Next: Ruby at 120 BPM/);
  c = await card(220, 200);
  assert.match(c.text, /Diamond on Easy, the top medal/);
  c = await card(90, 80, 2);   /* two exercises: no one medal to name */
  assert.doesNotMatch(c.text, /Platinum/);
  await p.evaluate(() => { window.__T.S().game = false; });
  c = await card(100, 90);
  assert.doesNotMatch(c.text, /medal|Sapphire/i);
  assert.deepEqual(p.errors, []);
});

audioTest('Export run saves the run just played with its loudness, only when the loudness was kept', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: '8 zRzL', eachUnit: 'pass', eachVal: 1, seeded: true });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => {
    const T = window.__T, r = T.run(), pl = r.plan, v = new Float32Array(4000);
    for (let k = 0; k < 4000; k++) v[k] = k % 250 < 20 ? 0.5 : 0.01;
    r.env = { t: 0, dt: 0.001, v, n: 3000, thr: -30 };   /* as a microphone run with buzz strokes keeps it */
    r.dev = [['h', 0.25, -6], ['b', 0.31, -14]];
    pl.slots.forEach(s => {
      const hand = pl.segs[s.seg].notes[s.pos].slice(-1);
      T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand, conf: 1 } });
    });
  });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(300);
  assert.equal(await p.isVisible('#advExport'), true);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#advExport')]);
  assert.match(dl.suggestedFilename(), /^pocket-run-\d{8}-\d{4}\.json$/);
  const f = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
  assert.equal(f.v, 2);
  assert.equal(f.runs.length, 1);
  assert.match(f.items[f.runs[0].exercises[0].k], /zRzL$/);   /* the exercise travels as a hash, as in a history export */
  const tr = f.trace;
  assert.equal(tr.slots.length, 2);
  assert.deepEqual(tr.slots.map(s => s.bz), [1, 1]);
  assert.ok(tr.slots.every(s => Math.abs(s.ms - 5) <= 1));
  assert.deepEqual(tr.det, [['h', 0.25, -6], ['b', 0.31, -14]]);
  assert.equal(tr.env.db.length, 3000);
  assert.equal(tr.env.db[0], -6);
  assert.equal(tr.env.db[100], -40);
  /* a run with no loudness kept has no Export run */
  await p.click('#advAgain');
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan && !window.__T.run().ended, null, { timeout: 8000 });
  await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.forEach(s => T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand: pl.segs[s.seg].notes[s.pos].slice(-1), conf: 1 } })); });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(300);
  assert.equal(await p.isVisible('#advExport'), false);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

audioTest('a run whose sound falls behind the screen is stopped, not saved, and the audio rebuilt', async () => {
  /* The audio clock runs at 80% of real time, as a broken iPhone audio setup might: the clicks fall further and further behind. */
  const p = await open({ input: 'kb', bpm: 60, routineText: '8 RLRL', eachUnit: 'pass', eachVal: 4, seeded: true }, null, () => {
    const d = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'currentTime');
    Object.defineProperty(BaseAudioContext.prototype, 'currentTime', { configurable: true, get() { const t = d.get.call(this); return window.__slow ? t * 0.8 : t; } });
    window.__slow = true;
  });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => { window.__ctx0 = window.__T.ctx(); });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 8000 });
  assert.match(await p.textContent('#status'), /out of step with the screen, so this run was stopped and not saved/);
  const after = await p.evaluate(() => ({
    saved: ((JSON.parse(localStorage.getItem('stick-timing-trainer.records.v2')) || {}).runs || []).length,
    rebuilt: window.__T.ctx() !== window.__ctx0,
    log: JSON.parse(localStorage.getItem('stick-timing-trainer.v1')).settings.clockLog,
  }));
  assert.equal(after.saved, 0, 'the run is not saved');
  assert.equal(after.rebuilt, true, 'the audio context was thrown away');
  assert.equal(after.log[0].ok, false);
  assert.ok(after.log[0].slip >= 200, 'slip logged: ' + after.log[0].slip);
  /* with a healthy clock, the next run plays through and logs as fine */
  await p.evaluate(() => { window.__slow = false; });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan && !window.__T.run().ended, null, { timeout: 8000 });
  await p.waitForTimeout(2500);
  assert.equal(await p.evaluate(() => window.__T.run().ended), false, 'a healthy run is not stopped');
  assert.deepEqual(p.errors, []);
});

audioTest('Stop cancels the clicks already queued, even where a second stop() is refused, as in Safari', async () => {
  /* Track every sound: when it was queued to start, whether it was stopped at once, and whether its path to the
     speaker was cut. A second stop() throws, as WebKit does, so the test catches the iPhone bug in Chromium too. */
  const p = await open({ input: 'kb', bpm: 220, routineText: 'RLRL RLRL', eachUnit: 'min', eachVal: 1, seeded: true }, null, () => {
    const tones = window.__tones = [], P = AudioScheduledSourceNode.prototype, start = P.start, stop = P.stop, cut = AudioNode.prototype.disconnect;
    P.start = function (when) { tones.push({ n: this, T: when || 0, now: false }); return start.apply(this, arguments); };
    P.stop = function (when) {
      if (this.__stops) throw new DOMException('cannot call stop more than once', 'InvalidStateError');
      this.__stops = 1;
      const out = stop.apply(this, arguments), e = tones.find(x => x.n === this);
      if (e && !(when > this.context.currentTime)) e.now = true;
      return out;
    };
    AudioNode.prototype.disconnect = function () { this.__cut = true; return cut.apply(this, arguments); };
  });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan && window.__T.ctx().currentTime > window.__T.run().t0 + 1.5, null, { timeout: 10000 });
  await press(p, /^Stop/);
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 5000 });
  const left = await p.evaluate(() => {
    const now = window.__T.ctx().currentTime;
    const queued = window.__tones.filter(x => x.T > now);
    return { queued: queued.length, audible: queued.filter(x => !x.now && !x.n.__cut && !(x.n._out && x.n._out.__cut)).length };
  });
  assert.ok(left.queued > 0, 'clicks were queued ahead when Stop was pressed: ' + left.queued);
  assert.equal(left.audible, 0, 'none of them can still sound');
  assert.deepEqual(p.errors, []);
});

audioTest('the whole count-in is queued at Start, and clicks queued late are logged', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: '8 RLRL RLRL', eachUnit: 'pass', eachVal: 4, click: 'strokes', seeded: true }, null, () => {
    const starts = window.__starts = [], start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (when) { starts.push(when || 0); return start.apply(this, arguments); };
  });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  const ci = await p.evaluate(() => { const r = window.__T.run(), first = r.plan.segs[0].t0, cin = r.plan.clicks.filter(c => c.t < first - 1e-6); return { cin: cin.length, queued: window.__starts.filter(t => cin.some(c => Math.abs(r.t0 + c.t - t) < 1e-6)).length, span: first }; });
  assert.ok(ci.cin >= 4 && ci.span > 0.35, 'a count-in longer than the lookahead: ' + JSON.stringify(ci));
  assert.equal(ci.queued, ci.cin, 'every count-in click is queued at Start');
  /* the page goes busy for 0.8 s in the middle of the run: clicks are dropped or late, and the log says so */
  await p.waitForFunction(() => window.__T.ctx().currentTime > window.__T.run().t0 + window.__T.run().plan.segs[0].t0 + 0.5, null, { timeout: 8000 });
  await p.evaluate(() => { const end = performance.now() + 800; while (performance.now() < end); });
  await p.waitForTimeout(400);
  await press(p, /^Stop/);
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 5000 });
  const d = await p.evaluate(() => JSON.parse(localStorage.getItem('stick-timing-trainer.v1')).settings.clockLog[0]);
  assert.ok(d.clicks > 4, 'clicks counted: ' + d.clicks);
  assert.ok(d.late + d.lost > 0 && d.worst > 100, 'the busy page shows in the log: ' + JSON.stringify(d));
  assert.match(await p.textContent('#clkMsg'), /The page fell behind/);
  assert.deepEqual(p.errors, []);
});

audioTest('every Start and Again plays on a fresh audio setup, as a refresh would', async () => {
  const p = await open({ input: 'kb', bpm: 200, routineText: '8 RLRL', eachUnit: 'pass', eachVal: 1, seeded: true });
  const play = async re => {
    await press(p, re);
    await p.waitForFunction(() => window.__T.run() && window.__T.run().plan && !window.__T.run().ended, null, { timeout: 8000 });
    await p.evaluate(() => { window.__ctxs = (window.__ctxs || []).concat(window.__T.ctx()); });
    await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.forEach(s => T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand: pl.segs[s.seg].notes[s.pos].slice(-1), conf: 1 } })); });
    await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 20000 });
    await p.waitForTimeout(300);
  };
  await play(/^Start$/);
  await play(/^Again$/);
  await play(/^Again$/);
  const o = await p.evaluate(() => ({
    distinct: new Set(window.__ctxs).size,
    closed: window.__ctxs.slice(0, -1).every(c => c.state === 'closed'),
    runs: JSON.parse(localStorage.getItem('stick-timing-trainer.v1')).settings.clockLog.slice(0, 3).map(d => d.runs),
  }));
  assert.equal(o.distinct, 3, 'three runs, three audio setups');
  assert.equal(o.closed, true, 'the old ones are closed, not left running');
  assert.deepEqual(o.runs, [1, 1, 1], 'the timing log shows each run on its own setup');
  assert.deepEqual(p.errors, []);
});

audioTest('the first result explains itself once', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: '8 RLRL', eachUnit: 'pass', eachVal: 1, seeded: true, tol: 30 });
  const play = async () => {
    await press(p, /^(Start|Again)$/);
    await p.waitForFunction(() => window.__T.run() && window.__T.run().plan && !window.__T.run().ended, null, { timeout: 8000 });
    await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.forEach(s => T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand: pl.segs[s.seg].notes[s.pos].slice(-1), conf: 1 } })); });
    await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
    await p.waitForTimeout(300);
  };
  const note = () => p.evaluate(() => { const n = document.getElementById('advFirst'); return n.offsetParent ? n.innerText : ''; });   /* seen, not just unhidden: phones hide notices during a review */
  await play();
  assert.match(await note(), /within ±30 ms/);
  await play();
  assert.equal(await note(), '', 'not after the second run');
  await p.reload();
  await p.waitForTimeout(400);
  assert.equal(await note(), '', 'not after a reload');
  assert.deepEqual(p.errors, []);
});

audioTest('Solo (count-in only) is scored and saved', async () => {
  const o = await runOnce({ click: 'none' }, false);
  assert.deepEqual(o.saved, ['none']);
  assert.ok(o.discard);
});

audioTest('a practice run shows its result but saves nothing', async () => {
  const o = await runOnce({ click: 'beat' }, true);
  assert.deepEqual(o.saved, []);
  assert.equal(o.warm, 'Warm-up · not saved', 'the card says so at the top');
  assert.match(o.text, /Your time still counts today/);
  assert.doesNotMatch(o.text, /First run at this tempo|New best|Best at this tempo/, 'not compared with saved runs');
  assert.ok(!o.discard);
});

audioTest('a practice run still counts its time toward the day', async () => {
  const o = await runOnce({ click: 'beat' }, true);
  assert.equal(Object.keys(o.days).length, 1);
});

audioTest('a new badge is announced on the result', async () => {
  const seed = () => {
    if (localStorage.getItem('seeded-runs')) return;
    localStorage.setItem('seeded-runs', '1');
    const run = i => ({ id: 'r' + i, t: Date.now() - 86400000 * (i + 1), mode: 'single', rk: null, lv: 'beat', dy: '', ne: 1, bpm: 60, tol: 20, sec: 60,
      exercises: [{ k: '8 RLRL', bpm: 60, due: 16, within: 8, heard: 16, avg: 0, sd: 3, miss: 0, i: 1 }] });
    localStorage.setItem('stick-timing-trainer.records.v2', JSON.stringify({ v: 1, names: {}, nu: 1, lib: [], runs: [0, 1, 2, 3].map(run) }));
  };
  const o = await runOnce({ click: 'beat', game: true }, false, seed);
  assert.match(o.badge, /Unlocked/i);
  assert.match(o.badge, /Next: /);
  assert.match(o.badge, /step \d+ of \d+/i);
  assert.doesNotMatch(o.badge, /undefined|NaN/);
});

test('staff rows stack their label above the staff, whatever else is on the page', async () => {
  const p = await open({ seeded: true, input: 'kb' });
  const d = await p.evaluate(() => { const r = document.querySelector('#rowsTrack .prow'); return r ? getComputedStyle(r).display : 'none'; });
  assert.equal(d, 'grid');
});

test('no empty box sits between the tabs and the page on any tab', async () => {
  const p = await open({ seeded: true, input: 'kb' });
  for (const t of ['Play', 'Library', 'Progress', 'Settings']) {
    await p.evaluate(t => [...document.querySelectorAll('.tabs button')].find(x => x.textContent.trim() === t).click(), t);
    await p.waitForTimeout(150);
    const gap = await p.evaluate(() => {
      const tabs = document.querySelector('.tabs').getBoundingClientRect().bottom;
      const pg = [...document.querySelectorAll('main > [id^=page]')].find(x => !x.hidden);
      return pg.getBoundingClientRect().top - tabs;
    });
    assert.ok(gap <= 24, t + ' gap ' + gap);
  }
});

test('the exercise list starts collapsed, Start is full width and the time sits under Start', async () => {
  const text = 'title: Test\n' + Array.from({ length: 24 }, () => '8 RLRL RLRL').join('\n') + '\n';
  const p = await open({ seeded: true, input: 'kb', mode: 'routine', routineText: text, bpm: 70, eachUnit: 'pass', eachVal: 8 }, { width: 390, height: 844 });
  const r = await p.evaluate(() => {
    const w = x => document.getElementById(x).getBoundingClientRect();
    return {
      open: document.getElementById('exBox').open,
      sum: document.getElementById('routineInfo').textContent,
      note: document.getElementById('playSummary').textContent,
      startW: w('startBtn').width, panelW: w('exBox').width,
      startBottom: w('startBtn').bottom,
    };
  });
  assert.equal(r.open, false);
  assert.equal(r.sum, '24 exercises');
  assert.match(r.note, /^70 BPM · about \d+:\d\d/);
  assert.ok(r.startW >= r.panelW - 1, 'Start is full width ' + r.startW + ' vs ' + r.panelW);
  assert.ok(r.startBottom < 844, 'Start is on the first screen ' + r.startBottom);
  await p.evaluate(() => document.querySelector('#exBox>summary').click());
  await p.evaluate(() => document.querySelectorAll('#exerciseList .erow')[6].click());
  assert.equal(await p.evaluate(() => document.getElementById('routineInfo').textContent), '24 exercises · from 7');
});

test('Help: a menu in the title on a phone, a contents list beside the text on desktop', async () => {
  const ph = await open({ seeded: true, input: 'kb' }, { width: 390, height: 844 });
  await ph.evaluate(() => document.getElementById('helpBtn').click());
  await ph.waitForTimeout(200);
  assert.equal(await ph.evaluate(() => document.getElementById('pgTtl').textContent), 'Help · How it works');
  assert.equal(await ph.evaluate(() => getComputedStyle(document.getElementById('helpNav')).display), 'none');
  await ph.evaluate(() => document.getElementById('pgTtl').click());
  const items = await ph.evaluate(() => [...document.querySelectorAll('.menu:not([hidden]) button')].map(b => b.textContent));
  assert.equal(items.length, 10);
  assert.equal(items[9], 'About Pocket');
  await ph.evaluate(() => [...document.querySelectorAll('.menu:not([hidden]) button')].find(b => b.textContent === 'Scores, tempo and progress').click());
  await ph.waitForTimeout(400);
  assert.equal(await ph.evaluate(() => document.getElementById('pgTtl').textContent), 'Help · Scores, tempo and progress');
  assert.equal(await ph.evaluate(() => document.querySelectorAll('.menu:not([hidden])').length), 0);
  assert.equal(await ph.getAttribute('#pgTtl', 'role'), 'button', 'on a phone the title opens the contents');

  const dk = await open({ seeded: true, input: 'kb' }, { width: 1440, height: 900 });
  await dk.evaluate(() => document.getElementById('helpBtn').click());
  await dk.waitForTimeout(200);
  const g = await dk.evaluate(() => {
    const n = document.getElementById('helpNav').getBoundingClientRect(), s = document.getElementById('help-how').getBoundingClientRect(), pg = document.getElementById('pageHelp').getBoundingClientRect();
    return { navRight: n.right, secLeft: s.left, navTop: n.top, secTop: s.top, wide: pg.width, title: document.getElementById('pgTtl').textContent };
  });
  assert.ok(g.navRight < g.secLeft, 'list is left of the text');
  assert.ok(Math.abs(g.navTop - g.secTop) < 4, 'list and text start together');
  assert.ok(g.wide > 900, 'Help uses the wide page ' + g.wide);
  assert.equal(g.title, 'Help');
  assert.equal(await dk.getAttribute('#pgTtl', 'role'), null, 'on desktop the title is not a button');
  await dk.evaluate(() => [...document.querySelectorAll('#helpNav button')].find(b => b.textContent === 'If something is off').click());
  await dk.waitForTimeout(400);
  assert.equal(await dk.evaluate(() => document.querySelector('#helpNav button[aria-current]').textContent), 'If something is off');
});

test('every badge has one medal, with a written step name, on the Achievements page', async () => {
  const p = await open({ seeded: true, input: 'kb' }, { width: 1440, height: 900 });
  await p.evaluate(() => [...document.querySelectorAll('.tabs button')].find(x => x.textContent.trim() === 'Progress').click());
  await p.evaluate(() => document.getElementById('pvBtnAch').click());
  await p.waitForTimeout(200);
  const r = await p.evaluate(() => ({ n: document.querySelectorAll('#badges .medal').length, bad: [...document.querySelectorAll('#badges .medal')].filter(m => /undefined|NaN/.test(m.title) || !m.title).length, off: document.querySelectorAll('#badges .medal.off').length }));
  assert.equal(r.n, 24);
  assert.equal(r.bad, 0);
  assert.equal(r.off, 24);
  const txt = await p.evaluate(() => document.getElementById('badges').innerText);
  assert.doesNotMatch(txt, /undefined|NaN/);
});

test('Import asks what to bring in, offers only what the file holds, and imports only the ticks', async () => {
  const p = await open({ seeded: true });
  const file = path.join(os.tmpdir(), 'pocket-imp-test.json');
  fs.writeFileSync(file, JSON.stringify({ lib: [{ id: 'zz1', x: '8 R L R L', t: 1 }], settings: { bpm: 77 } }));
  await p.click('#tabProgress');
  await p.setInputFiles('#recFile', file);
  await p.waitForTimeout(300);
  const rows = await p.evaluate(() => ({ title: document.getElementById('exTitle').textContent, go: document.getElementById('exGo').textContent, parts: [...document.querySelectorAll('#exOpts input')].map(c => c.dataset.k) }));
  assert.equal(rows.title, 'Import');
  assert.equal(rows.go, 'Import');
  assert.deepEqual(rows.parts, ['lib', 'set']);
  await p.evaluate(() => { document.querySelector('#exOpts input[data-k=set]').click(); });
  await p.click('#exGo');
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({ bpm: JSON.parse(localStorage.getItem('stick-timing-trainer.v1')).settings.bpm, lib: JSON.parse(localStorage.getItem('stick-timing-trainer.records.v2')).lib.length }));
  assert.notEqual(after.bpm, 77, 'settings were unticked');
  assert.equal(after.lib, 1);
});

audioTest('a scored run shows its score against the maximum, flags a new high score, and a practice run has no score', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: '8 RLRL', eachUnit: 'pass', eachVal: 1, click: 'half', seeded: true, game: true });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.forEach(s => { const hand = pl.segs[s.seg].notes[s.pos].slice(-1); T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand, conf: 1 } }); }); });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(300);
  const o = await p.evaluate(() => ({ score: document.getElementById('advScore').textContent, max: document.getElementById('advMax').textContent, chip: !document.getElementById('advHs').hidden, solo: document.getElementById('advRes').classList.contains('solo'), prev: document.getElementById('advPrev').textContent }));
  assert.match(o.score, /^[\d,]+$/);
  assert.match(o.max, /^\/ [\d,]+$/);
  assert.ok(o.chip, 'the first score is a new high score');
  assert.ok(!o.solo);
  assert.match(o.prev, /^First score on Extreme at ±20 ms$/);
  assert.doesNotMatch(await p.evaluate(() => document.querySelector('#advRes .scap').innerText), /%/, 'the score is not given as a second percentage, beside on time');
  assert.equal(await p.evaluate(() => document.querySelector('#advRes .slab').textContent), 'Score');
  const bd = await p.evaluate(() => ({ shown: !document.getElementById('scoreBox').hidden, on: document.getElementById('bOn').textContent, note: document.getElementById('scoreNote').textContent, row: [...document.getElementById('advBtns1').children].filter(b => !b.hidden).map(b => b.id) }));
  assert.ok(bd.shown); assert.match(bd.on, /^\d+$/); assert.match(bd.note, /Extreme: 10 points on time/);
  assert.deepEqual(bd.row, ['advDiscard', 'advDone', 'advAgain'], 'Discard, Done and Again share one row');
  const p0 = await runOnce({ click: 'half', game: true }, true);
  assert.doesNotMatch(p0.text, /high score/i, 'a practice run is not scored');
});

test('scores and rewards start on for a new install, and a saved Off is kept', async () => {
  assert.equal(await (await open({ seeded: true })).evaluate(() => window.__T.S().game), true);
  assert.equal(await (await open({ seeded: true, game: false })).evaluate(() => window.__T.S().game), false);
});

audioTest('with scores and rewards off, a run is saved and cleared, and shows on time with no score, streak meter or medals', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: '8 RLRL', eachUnit: 'pass', eachVal: 1, click: 'half', seeded: true, game: false });
  const n0 = await p.evaluate(() => ((JSON.parse(localStorage.getItem('stick-timing-trainer.records.v2')) || {}).runs || []).length);
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  assert.ok(await p.evaluate(() => document.getElementById('live').hidden), 'no live score or streak meter');
  await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.forEach(s => { const hand = pl.segs[s.seg].notes[s.pos].slice(-1); T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand, conf: 1 } }); }); });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(300);
  const o = await p.evaluate(() => ({ solo: document.getElementById('advRes').classList.contains('solo'), box: document.getElementById('scoreBox').hidden, medal: !!document.querySelector('#advBadge:not([hidden]) .medal'), runs: ((JSON.parse(localStorage.getItem('stick-timing-trainer.records.v2')) || {}).runs || []).length, ach: document.getElementById('pvBtnAch').hidden, tol: [...document.querySelectorAll('#tol option')].map(o => o.textContent).join('|') }));
  assert.ok(o.solo, 'on time is the hero'); assert.ok(o.box, 'no score breakdown'); assert.ok(!o.medal, 'no medal');
  assert.equal(o.runs, n0 + 1, 'the run is still saved');
  assert.ok(o.ach, 'no Achievements tab');
  assert.doesNotMatch(o.tol, /points/, 'the windows give no points');
  assert.doesNotMatch(await p.evaluate(() => document.getElementById('pvHist').innerText), /Score:/, 'history shows no score');
});


test('with no saved run, the line under Start says so, so the settings below it do not move', async () => {
  const p = await open({ routineText: 'RLRL RRLL', click: 'beat' });
  assert.equal(await p.getAttribute('#lastNote', 'hidden'), null);
  assert.equal(await p.textContent('#lastNote'), 'No saved run with these settings yet.');
  assert.equal(await p.evaluate(() => document.getElementById('lastNote').previousElementSibling.id), 'playSummary');
});

audioTest('after a run a note says what to play next time, and Play says it again with the last result', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: '8 RLRL', eachUnit: 'pass', eachVal: 1, click: 'half', seeded: true });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.forEach(s => { const hand = pl.segs[s.seg].notes[s.pos].slice(-1); T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand, conf: 1 } }); }); });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(300);
  assert.equal(await p.textContent('#advNext'), 'Next time: try 125 BPM.');
  assert.equal(await p.textContent('#advBody'), '', 'no closing advice repeats it');
  await p.evaluate(() => document.getElementById('advDone').click());
  await p.waitForTimeout(200);
  assert.ok(await p.isVisible('#lastNote'), 'Play shows the last result');
  assert.equal(await p.textContent('#lastNote'), 'Last time: 100% on time at 120 BPM. Try 125 BPM.');
  assert.deepEqual(await p.evaluate('[onPct(0.896), onPct(0.9), onPct(0.29)]'), ['89%', '90%', '29%'], 'on time rounds down, so below the target never reads 90%');
});

audioTest('a routine below the target is told to stay until every exercise reaches 90%, naming no single exercise', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: '8 RLRL\n8 RRLL', mode: 'routine', eachUnit: 'pass', eachVal: 1, click: 'half', seeded: true });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.forEach((s, i) => { const hand = pl.segs[s.seg].notes[s.pos].slice(-1); T.hit({ t: r.t0 + s.t + (s.seg && i % 2 ? 0.04 : 0.005), kb: true, f: null, det: { hand, conf: 1 } }); }); });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(300);
  assert.equal(await p.textContent('#advNext'), 'Next time: stay at 120 BPM until every exercise reaches 90% on time.');
  await p.evaluate(() => document.getElementById('advDone').click());
  await p.waitForTimeout(200);
  assert.equal(await p.textContent('#lastNote'), 'Last time: 75% on time at 120 BPM. Stay at 120 BPM until every exercise reaches 90% on time.');
});

audioTest('rests keep the streak and score nothing unless hit, and a hit on a rest is a miss', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: 'R_L_ R_L_', eachUnit: 'pass', eachVal: 2, seeded: true });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => {
    const T = window.__T, r = T.run(), pl = r.plan, rest = pl.cells.filter(c => c.rest)[1];
    pl.slots.forEach(s => { const hand = pl.segs[s.seg].notes[s.pos].slice(-1); T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand, conf: 1 } }); });
    T.hit({ t: r.t0 + rest.t, kb: true, f: null, det: { hand: 'R', conf: 1 } });
  });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(300);
  const q = await p.evaluate(() => JSON.parse(localStorage.getItem('stick-timing-trainer.records.v2')).runs[0].exercises[0].q);
  assert.ok(q && q.length > 8, 'rests are in the sequence: ' + q);
  assert.equal((q.match(/m/g) || []).length, 1, 'one rest was hit: ' + q);
  assert.ok(/r/.test(q), 'the other rests are kept: ' + q);
});

test('Play settings: Scoring beside Accent, tops level; Other strokes only once an accent is set', async () => {
  const p = await open({ seeded: true, noise: -50, latCal: true }, { width: 390, height: 900 });
  assert.equal(await p.textContent('#setSum'), 'Saved · No accents');
  await p.evaluate(() => { document.getElementById('setBox').open = true; });   /* closed at phone width */
  const r = await p.evaluate(() => { const a = document.getElementById('score').getBoundingClientRect(), b = document.getElementById('accent').getBoundingClientRect(); return { dy: Math.abs(a.top - b.top), side: b.left > a.right - 1 }; });
  assert.ok(await p.isVisible('#score'), 'Scoring is visible');
  assert.ok(r.side, 'Accent is beside Scoring');
  assert.ok(r.dy < 1, 'tops are level');
  assert.ok(!(await p.isVisible('#othersSeg')), 'no Other strokes without an accent');
  await p.selectOption('#accent', 'b');
  assert.ok(await p.isVisible('#othersSeg'), 'Other strokes shows with an accent');
  await p.click('#othG');
  assert.equal(await p.evaluate(() => window.__T.S().others), 'g');
  await p.evaluate(() => { document.getElementById('setBox').open = false; });
  await p.waitForFunction(() => document.getElementById('setSum').textContent !== 'More settings');
  assert.equal(await p.textContent('#setSum'), 'Saved · Accent: each beat · Ghost notes');
  assert.deepEqual(p.errors, []);
});

audioTest('a routine shows the most a flawless run could score, and a flawless run reaches it', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: 'RLRL RLRL\nLRLR LRLR', eachUnit: 'pass', eachVal: 1, click: 'half', seeded: true, game: true });
  const max = await p.evaluate(() => document.getElementById('maxLine').textContent);
  assert.match(max, /^Max score: [\d,]+$/);
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.forEach(s => { const hand = pl.segs[s.seg].notes[s.pos].slice(-1); T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand, conf: 1 } }); }); });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(400);
  const got = await p.evaluate(() => document.getElementById('advScore').textContent + '|' + document.getElementById('advMax').textContent);
  const [sc, mx] = got.split('|');
  assert.equal(sc, max.replace('Max score: ', ''), 'a flawless run scores the maximum');
  assert.equal(mx, '/ ' + sc);
});

audioTest('a stroke shows nothing when it is heard, and its timing only once its window has closed', async () => {
  const p = await open({ input: 'kb', bpm: 60, routineText: '8 RLRL', eachUnit: 'pass', eachVal: 1, seeded: true });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan && window.__T.run().t0 > 0, null, { timeout: 8000 });
  const card = () => p.evaluate(() => {
    const c = [...document.querySelectorAll('svg.staff g.cd')].find(g => g._slot === 0), v = window.__T.run().res.get(0);
    return c ? { cls: c.getAttribute('class').split(/\s+/), ft: (c.querySelector('.ft') || {}).textContent, pend: !!(v && v.pend) } : null;
  });
  /* the first stroke, 5 ms late, played as it is due */
  await p.evaluate(async () => {
    const T = window.__T, r = T.run(), s = r.plan.slots[0], ctx = T.ctx(), due = r.t0 + s.t;
    while (ctx.currentTime < due - 0.02) await new Promise(f => setTimeout(f, 10));
    T.hit({ t: due + 0.005, kb: true, f: null, det: { hand: 'R', conf: 1 } });
  });
  let c = null;
  for (let k = 0; k < 40 && !(c && c.pend); k++) { await p.waitForTimeout(25); c = await card(); }
  assert.ok(c && c.pend, 'heard: ' + JSON.stringify(c));
  assert.equal(c.ft, '');
  assert.ok(!['ok', 'early', 'late', 'heard'].some(k => c.cls.includes(k)), 'no mark before the window closes');
  for (let k = 0; k < 80 && c && !['ok', 'early', 'late', 'miss'].some(k => c.cls.includes(k)); k++) { await p.waitForTimeout(50); c = await card(); }
  assert.ok(c && c.cls.includes('ok'), 'judged on time: ' + JSON.stringify(c));
  assert.equal(c.pend, false);
  assert.ok(!c.cls.includes('heard'));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

audioTest('the live score counts up as strokes are judged, drops the streak on a slip, matches the final score, and is hidden for practice', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: 'RLRL RLRL\nLRLR LRLR', eachUnit: 'pass', eachVal: 1, click: 'half', seeded: true, game: true });
  assert.equal(await p.evaluate(() => document.getElementById('live').hidden), true, 'hidden before a run');
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.forEach((s, i) => { if (i === 11) return; const hand = pl.segs[s.seg].notes[s.pos].slice(-1); T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand, conf: 1 } }); }); });
  await p.waitForFunction(() => window.__T.run().sk >= 4, null, { timeout: 20000 });
  const mid = await p.evaluate(() => ({ shown: !document.getElementById('live').hidden, sk: window.__T.run().sk, lit: document.querySelectorAll('#lvMeter i.on').length, n: document.querySelectorAll('#lvMeter i').length, fire: getComputedStyle(document.getElementById('lvFire')).visibility }));
  assert.ok(mid.shown); assert.equal(mid.n, 16); assert.ok(mid.sk >= 4 && mid.lit === mid.sk, 'one segment per stroke in a row'); assert.equal(mid.fire, 'hidden', 'no flame below the best streak');
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(400);
  const end = await p.evaluate(() => ({ live: window.__T.run().pts, hidden: document.getElementById('live').hidden, score: document.getElementById('advScore').textContent }));
  assert.ok(end.hidden, 'the live score gives way to the result');
  assert.equal(Math.round(end.live).toLocaleString('en-US'), end.score, 'the live score matches the final score');
  const q = await open({ input: 'kb', bpm: 120, routineText: '8 RLRL', eachUnit: 'pass', eachVal: 1, click: 'half', seeded: true, game: true });
  await q.evaluate(() => { const s = document.getElementById('score'); s.value = '0'; s.dispatchEvent(new Event('change')); });
  await press(q, /^Start/);
  await q.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  assert.equal(await q.evaluate(() => document.getElementById('live').hidden), true, 'no live score in practice');
});

audioTest('the audio output wakes when Start resumes a paused run, even if it was put to sleep meanwhile', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: '8 RLRL', eachUnit: 'pass', eachVal: 3, click: 'half', seeded: true });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan && window.__T.ctx() && window.__T.ctx().state === 'running', null, { timeout: 8000 });
  await press(p, /^Pause/);
  await p.evaluate(() => window.__T.ctx().suspend());
  assert.equal(await p.evaluate(() => window.__T.ctx().state), 'suspended');
  await press(p, /^(Resume|Start|Continue)/);
  await p.waitForFunction(() => window.__T.ctx().state === 'running' && !window.__T.run().paused, null, { timeout: 5000 });
});

audioTest('a flame shows in the live header once the streak reaches its best', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: 'RLRL RLRL RLRL RLRL RLRL RLRL', eachUnit: 'pass', eachVal: 1, click: 'half', seeded: true, game: true });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.forEach(s => { const hand = pl.segs[s.seg].notes[s.pos].slice(-1); T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand, conf: 1 } }); }); });
  await p.waitForFunction(() => getComputedStyle(document.getElementById('lvFire')).visibility === 'visible', null, { timeout: 30000 });
  assert.ok(await p.evaluate(() => window.__T.run().sk >= 16));
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('#lvFire .fo')).animationName), 'lvflick', 'the flame flickers');
});

audioTest('Done clears the result and the details, and the run stays in History', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: 'RLRL RLRL', eachUnit: 'pass', eachVal: 1, click: 'half', seeded: true });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.forEach(s => { const hand = pl.segs[s.seg].notes[s.pos].slice(-1); T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand, conf: 1 } }); }); });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(400);
  assert.equal(await p.evaluate(() => !document.getElementById('advice').hidden), true, 'the result shows after a run');
  await p.evaluate(() => document.getElementById('advDone').click());
  await p.waitForTimeout(200);
  const o = await p.evaluate(() => ({ advice: document.getElementById('advice').hidden, within: document.getElementById('sWithin').textContent, runs: ((JSON.parse(localStorage.getItem('stick-timing-trainer.records.v2')) || {}).runs || []).length }));
  assert.equal(o.advice, true, 'the result card goes');
  assert.equal(o.within, '\u2014', 'the details go back to empty');
  assert.equal(o.runs, 1, 'the run is still saved');
});

audioTest('History shows each run\'s score in the list and on the run page', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: 'RLRL RLRL', eachUnit: 'pass', eachVal: 1, click: 'half', seeded: true, game: true });
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.forEach(s => { const hand = pl.segs[s.seg].notes[s.pos].slice(-1); T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand, conf: 1 } }); }); });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(300);
  await p.evaluate(() => { document.getElementById('tabProgress').click(); document.getElementById('pvBtnHist').click(); }); await p.waitForTimeout(400);
  const row = await p.evaluate(() => document.getElementById('pvHist').innerText);
  assert.match(row, /Score: [\d,]+/);
  await p.evaluate(() => { const b = [...document.querySelectorAll('#pvHist .lrow')].find(x => /Score: /.test(x.innerText)); b.click(); });
  await p.waitForTimeout(300);
  const page = await p.evaluate(() => document.getElementById('pgBody').textContent);
  assert.match(page, /[\d,]+\s*of [\d,]+/);
});

audioTest('A kept routine is saved to the library on its own, and discarding the run takes it back out', async () => {
  const p = await open({ input: 'kb', bpm: 120, mode: 'routine', routineText: '8 RLRL RLRL\n8 RLLR RLLR', eachUnit: 'pass', eachVal: 1, click: 'half', seeded: true });
  const libN = () => p.evaluate(() => (JSON.parse(localStorage.getItem('stick-timing-trainer.records.v2')) || { lib: [] }).lib.length);
  const n0 = await libN();
  await press(p, /^Start/);
  await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
  await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.forEach(s => { const hand = pl.segs[s.seg].notes[s.pos].slice(-1); T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand, conf: 1 } }); }); });
  await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 40000 });
  await p.waitForTimeout(300);
  assert.equal(await libN(), n0 + 1, 'the routine joins the library');
  const runsN = () => p.evaluate(() => (JSON.parse(localStorage.getItem('stick-timing-trainer.records.v2')) || { runs: [] }).runs.length);
  await p.click('#advDiscard');
  assert.equal(await p.textContent('#advDiscard'), 'Tap again to discard');
  assert.equal(await runsN(), 1, 'one tap only arms it');
  await p.click('#advDiscard');
  await p.waitForTimeout(300);
  assert.equal(await libN(), n0, 'discarding takes it back out');
  assert.equal(await runsN(), 0);
  assert.equal(await p.evaluate(() => document.body.dataset.state), 'idle', 'back to the start screen');
  assert.match(await p.textContent('#status'), /^Run discarded\./);
  assert.equal(await p.evaluate(() => document.activeElement.textContent), 'Undo', 'focus moves to Undo, not lost with the Discard button');
  await p.click('#status >> text=Undo');
  await p.waitForTimeout(300);
  assert.equal(await runsN(), 1, 'Undo puts the run back');
  assert.equal(await libN(), n0 + 1, 'and the routine saved with it');
  assert.equal(await p.evaluate(() => document.body.dataset.state), 'done', 'and shows the result again');
  assert.equal(await p.isVisible('#advDiscard'), true);
  /* discarded again, then the routine changes before Undo: the run comes back, but its result is not drawn over the new routine */
  await p.click('#advDiscard'); await p.click('#advDiscard');
  await p.waitForTimeout(300);
  await p.evaluate(() => { const t = document.getElementById('routineText'); t.value = '8 RRLL RRLL'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('#status >> text=Undo');
  await p.waitForTimeout(300);
  assert.equal(await runsN(), 1, 'the run is back in the records');
  assert.equal(await libN(), n0 + 1, 'and its routine, once');
  assert.equal(await p.evaluate(() => document.body.dataset.state), 'idle', 'no result over a different routine');
  assert.match(await p.textContent('#status'), /routine has changed/);
  assert.deepEqual(p.errors, []);
});

audioTest('the result\'s actions are in view without scrolling, in one row of equal height, on a phone and on desktop', async () => {
  for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const p = await open({ input: 'kb', bpm: 120, routineText: '8 RLRL', eachUnit: 'pass', eachVal: 2, seeded: true }, size);
    await press(p, /^Start/);
    await p.waitForFunction(() => window.__T.run() && window.__T.run().plan, null, { timeout: 8000 });
    await p.evaluate(() => { const T = window.__T, r = T.run(), pl = r.plan; pl.slots.slice(0, 6).forEach(s => T.hit({ t: r.t0 + s.t + 0.005, kb: true, f: null, det: { hand: pl.segs[s.seg].notes[s.pos].slice(-1), conf: 1 } })); });
    await p.waitForFunction(() => window.__T.ctx().currentTime > window.__T.run().t0 + window.__T.run().plan.slots[6].t, null, { timeout: 10000 });
    await press(p, /^Stop/);   /* stopped early, after a few strokes: the case where Discard is wanted at once */
    await p.waitForFunction(() => window.__T.run().ended, null, { timeout: 5000 });
    await p.waitForTimeout(500);
    const b = await p.evaluate(() => ['advDiscard', 'advDone', 'advAgain'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { id, top: r.top, bottom: r.bottom, h: Math.round(r.height), w: r.width }; }));
    for (const x of b) assert.ok(x.top >= 0 && x.bottom <= size.height && x.w > 0, size.width + 'px: ' + x.id + ' is in view: ' + JSON.stringify(x));
    assert.equal(new Set(b.map(x => x.h)).size, 1, size.width + 'px: the same height: ' + JSON.stringify(b));
    assert.ok(b[0].bottom <= b[1].top + 1 || Math.abs(b[0].top - b[1].top) < 1, 'one row');
    assert.ok(b[2].w > b[1].w, 'Again is the widest');
    assert.deepEqual(p.errors, []);
  }
});

test('a routine shows no Max score with scores and rewards off, and shows it as soon as they are turned on', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: 'RLRL RLRL\nLRLR LRLR', eachUnit: 'pass', eachVal: 1, click: 'half', seeded: true, game: false });
  assert.equal(await p.textContent('#maxLine'), '');
  await p.evaluate(() => document.getElementById('gameOn').click());
  assert.match(await p.textContent('#maxLine'), /^Max score: [\d,]+$/);
});

test('changing the on-time window updates the routine\'s Max score at once', async () => {
  const p = await open({ input: 'kb', bpm: 120, routineText: 'RLRL RLRL\nLRLR LRLR', eachUnit: 'pass', eachVal: 1, click: 'half', tol: 20, seeded: true, game: true });
  const max = () => p.evaluate(() => +document.getElementById('maxLine').textContent.replace(/\D/g, ''));
  const at20 = await max();
  await p.evaluate(() => { const s = document.getElementById('tol'); s.value = '50'; s.dispatchEvent(new Event('change')); });
  const at50 = await max();
  assert.ok(at20 > 0);
  assert.ok(Math.abs(at50 - at20 / 1.5) <= 1, '±50 ms is x1 against x1.5 at ±20: ' + at20 + ' then ' + at50);
});

test('a library row keeps Play beside More actions, which holds Edit, and says only what tells rows apart: the fastest clear and its medal', async () => {
  const seed = lib => () => {
    if (localStorage.getItem('stick-timing-trainer.records.v2')) return;
    const run = (i, b, w) => ({ id: 'r' + i, t: Date.now() - 86400000 * (3 - i), mode: 'single', rk: null, lv: 'beat', dy: '', ne: 1, bpm: b, tol: 20, sec: 60,
      exercises: [{ k: '/4 RLRL', bpm: b, due: 16, within: w, heard: 16, avg: 0, sd: 3, miss: 0, i: 1 }] });
    localStorage.setItem('stick-timing-trainer.records.v2', JSON.stringify({ v: 1, names: {}, nu: 3, runs: [run(0, 80, 16), run(1, 90, 15), run(2, 100, 8)],
      lib: [{ id: 'a', x: 'RLRL', t: 1 }, { id: 'b', x: 'RRLL', t: 2 }] }));
  };
  const rows = async p => { await p.click('#tabLibrary'); await p.waitForTimeout(200);
    return p.evaluate(() => [...document.querySelectorAll('#libPage .hrow')].map(r => ({ name: r.querySelector('.rt').textContent, meta: r.querySelector('.rm').hidden ? '' : r.querySelector('.rm').textContent,
      btns: [...r.querySelector('.ra').querySelectorAll('button')].map(b => b.getAttribute('aria-label')) }))); };
  const p = await open({ seeded: true, noise: -50, latCal: true, click: 'beat', game: true }, null, seed());
  const r = await rows(p);
  const a = r.find(x => x.name === 'RLRL'), b = r.find(x => x.name === 'RRLL');
  assert.match(a.meta, /^\w+ · cleared at 90 BPM · 3 runs · latest /, a.meta);
  assert.equal(b.meta, '', 'an unplayed exercise says nothing');
  assert.deepEqual(a.btns, ['Play', 'More actions']);
  await p.evaluate(() => document.querySelectorAll('.glib').forEach(d => { d.open = true; }));
  await p.locator('#libPage .hrow').first().locator('[aria-label="More actions"]').click();
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].filter(e => e.offsetParent).map(e => e.textContent)), ['Edit', 'Download', 'Delete']);
  const q = await open({ seeded: true, noise: -50, latCal: true, click: 'beat', game: false }, null, seed());
  assert.match((await rows(q)).find(x => x.name === 'RLRL').meta, /^Cleared at 90 BPM · /, 'no medal with rewards off');
  const e = await open({ seeded: true, noise: -50, latCal: true, click: 'strokes', game: true }, null, seed());
  assert.match((await rows(e)).find(x => x.name === 'RLRL').meta, /^3 runs/, 'a clear on another click level is not this one');
  assert.deepEqual(p.errors, []);
});
