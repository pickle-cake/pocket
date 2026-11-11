/* The Pages site as it deploys: scripts/site.js assembles it, and it is served from a subpath as GitHub Pages does
   (/pocket/). The home page passes axe in every palette at phone and desktop width, it never redirects, and the app
   under app/ loads its libraries. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { ROOT } = require('./helpers');

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-site-'));
const BASE = '/pocket/';
let server, origin, browser;

test.before(async () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'site.js'), OUT]);
  server = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (!u.startsWith(BASE)) { res.statusCode = 404; return res.end(); }
    let f = path.join(OUT, u.slice(BASE.length));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!f.startsWith(OUT) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'text/plain');
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => server.listen(0, r));
  origin = 'http://localhost:' + server.address().port;
  browser = await chromium.launch();
});
test.after(async () => { await browser.close(); server.close(); fs.rmSync(OUT, { recursive: true, force: true }); });

async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.width || 390, height: 844 }, colorScheme: opts.scheme || 'light', serviceWorkers: 'block' });
  if (opts.saved) await ctx.addInitScript(s => { try { localStorage.setItem('stick-timing-trainer.v1', s); } catch (e) {} }, JSON.stringify({ settings: opts.saved }));
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  return p;
}

test('site: the assembled files', () => {
  for (const f of ['index.html', 'sw.js', 'routines/starter.txt', 'routines/rudiments.txt', 'app/index.html', 'app/sw.js', 'app/routines/starter.txt', 'app/routines/rudiments.txt'])
    assert.ok(fs.existsSync(path.join(OUT, f)), f);
  assert.equal(fs.readFileSync(path.join(OUT, 'app/index.html'), 'utf8'), fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(OUT, 'index.html'), 'utf8'), fs.readFileSync(path.join(ROOT, 'landing/index.html'), 'utf8'));
});

test('home page: a first visit stays on it, and Start practising opens the app', async () => {
  const p = await page();
  await p.goto(origin + BASE);
  assert.equal(new URL(p.url()).pathname, BASE);
  await p.click('a.btn.primary');
  await p.waitForURL(u => u.pathname === BASE + 'app/');
  await p.waitForFunction(() => document.querySelector('#tabPlay'));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('home page: a drummer with saved records still sees it, and the app links back to it', async () => {
  const p = await page({ saved: {} });
  await p.goto(origin + BASE);
  await p.waitForTimeout(300);
  assert.equal(new URL(p.url()).pathname, BASE);
  await p.goto(origin + BASE + 'app/');
  await p.waitForFunction(() => document.querySelector('#tabPlay'));
  const href = await p.evaluate(() => [...document.querySelectorAll('#help-about a')].find(a => /home page/.test(a.textContent)).href);
  assert.equal(href, origin + BASE);
  await p.goto(href);
  await p.waitForTimeout(300);
  assert.equal(new URL(p.url()).pathname, BASE);
  assert.ok(await p.isVisible('#about'));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('app: under app/ it loads the hosted libraries from beside it', async () => {
  const p = await page();
  await p.goto(origin + BASE + 'app/');
  const ok = await p.evaluate(async () => (await fetch('routines/starter.txt')).ok);
  assert.ok(ok);
  await p.context().close();
});

/* axe's WCAG checks and the guide's 44px targets, in every palette at both widths. */
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
for (const theme of ['light', 'dark']) for (const palette of ['', 'cb']) for (const width of [390, 1280]) {
  test('home page a11y: ' + theme + (palette ? ' cb' : '') + ' at ' + width + 'px', async () => {
    const p = await page({ width, scheme: theme });
    await p.goto(origin + BASE);
    await p.evaluate(([t, c]) => { document.documentElement.dataset.theme = t; if (c) document.documentElement.dataset.palette = c; }, [theme, palette]);
    await p.evaluate(() => document.fonts.ready);
    await p.addScriptTag({ content: AXE });
    const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] })).violations.map(x => x.id + ': ' + x.nodes.map(n => n.target.join(' ')).join(', ')));
    assert.deepEqual(v, []);
    const small = await p.evaluate(() => [...document.querySelectorAll('a,button')].filter(e => !e.classList.contains('skip')).map(e => [e.textContent.trim(), e.getBoundingClientRect()]).filter(([, r]) => r.width && (r.height < 44 || r.width < 44)).map(([t, r]) => t + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)));
    assert.deepEqual(small, [], 'tap targets under 44px');
    const wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(wide <= 0, 'no sideways scroll: ' + wide + 'px');
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}
