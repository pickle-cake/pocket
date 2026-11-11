/* The home page (landing/index.html) against STYLE-GUIDE.md. It is new, so it has no baseline: every check is clean.
   Its markup and spelling are checked in lint.test.js, with the app's. */
const test = require('node:test'), assert = require('node:assert/strict');
const { read } = require('./helpers');
const { staticViolations } = require('./style');

const page = read('landing/index.html'), app = read('index.html');

const found = staticViolations(page);
for (const check of Object.keys(found)) test('home page style: no ' + check, () => {
  assert.deepEqual(found[check], [], check + ' on the home page. Fix it as STYLE-GUIDE.md says.');
});

test('home page: the same theme colours as the app', () => {
  const block = (html, sel) => { const m = new RegExp(sel.replace(/[[\]]/g, '\\$&') + '\\{([^}]*)\\}').exec(html); return m ? Object.fromEntries([...m[1].replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--([\w-]+):\s*([^;]+);?/g)].map(x => [x[1], x[2].trim()])) : null; };
  for (const sel of [':root', ':root[data-theme=dark]', ':root[data-palette=cb]', ':root[data-palette=cb][data-theme=dark]']) {
    const a = block(app, sel), h = block(page, sel);
    assert.ok(h, sel + ' is defined on the home page');
    for (const k of Object.keys(h)) if (k in a) assert.equal(h[k], a[k], sel + ' --' + k + ' matches the app');
  }
});

test('home page: the fonts link loads the same weights as the app', () => {
  const link = h => /https:\/\/fonts\.googleapis\.com\/css2\?[^"]+/.exec(h)[0];
  assert.equal(link(page), link(app));
});

test('home page: one primary action, and it opens the app', () => {
  const primaries = [...page.matchAll(/<a class="btn primary" href="([^"]+)"/g)];
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0][1], 'app/');
});
