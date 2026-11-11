/* Checks index.html against STYLE-GUIDE.md. Most of the app predates the guide, so the checks are a ratchet:
   tests/style-baseline.json lists the violations that are already there, a change may not add one, and a fixed
   one must be taken off the list. `npm run style:baseline` takes fixed ones off. It never adds any.
   `node tests/style.js --accept` records the current violations as they are; use it only for a deliberate exception. */
const fs = require('fs'), path = require('path');
const { html } = require('./helpers');
const BASELINE = path.join(__dirname, 'style-baseline.json');

/* ---- The stylesheet ---- */

/* Every declaration in the <style> block, with the selector (and any @media around it) it sits in. */
function declarations(page = html) {
  const css = /<style>([\s\S]*?)<\/style>/.exec(page)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [], stack = [];
  let buf = '';
  const flush = () => {
    const d = buf.trim(); buf = '';
    const i = d.indexOf(':');
    if (!d || i < 0 || !stack.length || stack[stack.length - 1].startsWith('@')) return;
    const sel = stack.join(' ').replace(/\s+/g, ' ');
    out.push({ sel, rule: stack[stack.length - 1], prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim().replace(/\s+/g, ' ') });
  };
  for (const ch of css) {
    if (ch === '{') { stack.push(buf.trim().replace(/\s+/g, ' ')); buf = ''; }
    else if (ch === '}') { flush(); stack.pop(); }
    else if (ch === ';') flush();
    else buf += ch;
  }
  return out;
}

const sig = d => d.sel + ' { ' + d.prop + ': ' + d.value + ' }';
const THEME = /^:root(\[[^\]]*\]|:not\(\[[^\]]*\]\))*$/;   /* :root, :root[data-theme=dark], :root:not([data-theme=light]) ... */
const inTheme = d => d.rule.split(',').every(s => THEME.test(s.trim()));
const STAFF = /(^|\s)\.staff\b/;   /* music engraving: its sizes follow the SVG geometry, not the type scale */

const SIZES = ['11px', '13px', '14px', '15px', '16px', '20px'];
const RADII = ['0', '4px', '8px', '12px', '999px', '50%'];
const TRACKING = ['0', 'normal', '.01em', '.06em', '.08em', '.1em'];
const isVar = (v, prefix) => new RegExp('^var\\(--' + prefix).test(v);
const short = v => v.replace(/^0\./, '.');

/* The font size in a `font` shorthand: the token in front of the optional /line-height and the family. */
function shorthandSize(v) {
  const m = /(?:^|\s)((?:clamp|calc|min|max)\([^)]*\)|var\(--[\w-]+\)|[\d.]+(?:px|r?em|%|vw))(?:\/\S+)?\s+\S/.exec(v);
  return m && m[1];
}

function staticViolations(page = html) {   /* index.html by default; the home page passes its own */
  const ds = declarations(page);
  const defined = new Set([...page.matchAll(/--([\w-]+)\s*:/g)].map(m => m[1]).concat([...page.matchAll(/setProperty\('--([\w-]+)'/g)].map(m => m[1])));
  const found = { 'raw-colour': [], 'font-size': [], 'radius': [], 'letter-spacing': [], 'undefined-variable': [] };
  for (const d of ds) {
    if (/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\b(white|black)\b/i.test(d.value) && !(d.prop.startsWith('--') && inTheme(d)))
      found['raw-colour'].push(sig(d));
    const size = d.prop === 'font-size' ? d.value : d.prop === 'font' ? shorthandSize(d.value) : null;
    if (size && size !== 'inherit' && !STAFF.test(d.sel) && !SIZES.includes(size) && !isVar(size, 't-')) found['font-size'].push(d.sel + ' { font-size: ' + size + ' }');   /* the size alone, so a change of weight or family is not a new entry */
    if (/^border(-[a-z]+)*-radius$/.test(d.prop) && d.value.split(/[\s/]+/).some(v => !RADII.includes(v) && !isVar(v, 'r-'))) found.radius.push(sig(d));
    if (d.prop === 'letter-spacing' && !TRACKING.includes(short(d.value)) && !isVar(d.value, '')) found['letter-spacing'].push(sig(d));
    for (const m of d.value.matchAll(/var\(\s*--([\w-]+)\s*(,)?/g)) if (!m[2] && !defined.has(m[1])) found['undefined-variable'].push(sig(d));
  }
  return found;
}

/* ---- The running app ---- */

/* Weights each family loads from Google Fonts. A weight not loaded is drawn with the nearest one, so it never shows. */
function loadedWeights() {
  const url = /href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/.exec(html)[1].replace(/&amp;/g, '&');
  const out = {};
  for (const m of url.matchAll(/family=([^:&]+)(?::wght@([\d;]+))?/g)) out[decodeURIComponent(m[1].replace(/\+/g, ' '))] = (m[2] || '400').split(';').map(Number);
  return out;
}

const VIEWS = [
  ['play', ['#tabPlay']],
  ['library', ['#tabLibrary', '.glib>summary']],
  ['history', ['#tabProgress', '#pvBtnHist']],
  ['run', ['#tabProgress', '#pvBtnHist', '.lrow:visible']],
  ['scores', ['#tabProgress', '#pvBtnStats']],
  ['achievements', ['#tabProgress', '#pvBtnAch']],
  ['preferences', ['#tabSetup', '#svBtnPref']],
  ['device', ['#tabSetup', '#svBtnDev']],
  ['data', ['#tabSetup', '#svBtnData']],
  ['help', ['#tabPlay', '#helpBtn']],
  ['tempo', ['#tabPlay', '#bpmOpen']],
];
const THEMES = [['light', {}], ['dark', { theme: 'dark' }], ['cb-light', { palette: 'cb' }], ['cb-dark', { theme: 'dark', palette: 'cb' }]];
const SIZES_PX = [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]];

/* Runs in the page: axe's WCAG rules, plus the guide's own 44px targets, 3:1 field edges and loaded weights. */
async function inPage({ loaded, theme }) {
  const STATE = new Set('on cur open up arm sel done hit pop flash running editing start skip have change alert newex warn ok late early miss muted good bad today fut l1 l2 l3 l4 lvl pulse pulse2 win rv sliding pick fl go dy acc'.split(' '));
  const part = e => e.id ? '#' + e.id : e.tagName.toLowerCase() + [...e.classList].filter(c => !STATE.has(c)).map(c => '.' + c).join('');
  const sel = el => { const o = []; for (let e = el; e && e !== document.body && o.length < 4; e = e.parentElement) { o.unshift(part(e)); if (e.id) break; } return o.join(' > '); };
  const shown = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
  const cv = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  const rgba = s => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = s; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (a, b) => [0, 1, 2].map(i => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
  const bgOf = el => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= .99) break; }
    return layers.reverse().reduce((b, c) => over(c, b), [255, 255, 255, 1]);
  };
  const lum = c => { const v = c.slice(0, 3).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const inSentence = el => [...el.parentElement.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());

  const found = { axe: [], 'target-44': [], 'field-edge': [], 'font-weight': [] };
  const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'], elementRef: true });
  for (const v of r.violations) for (const n of v.nodes) found.axe.push(v.id + ' ' + (n.element ? sel(n.element) : n.target.join(' ')) + (/contrast/.test(v.id) ? ' [' + theme + ']' : ''));

  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab]')) {
    if (!shown(el) || inSentence(el) || el.closest('label')) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 43.5 || b.height < 43.5) found['target-44'].push(sel(el));
  }
  for (const el of document.querySelectorAll('input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea')) {
    if (!shown(el)) continue;
    const cs = getComputedStyle(el), outer = bgOf(el.parentElement), edges = [];
    if (parseFloat(cs.borderTopWidth) > 0 && rgba(cs.borderTopColor)[3] > 0) edges.push(over(rgba(cs.borderTopColor), outer));
    if (rgba(cs.backgroundColor)[3] > 0) edges.push(over(rgba(cs.backgroundColor), outer));
    if (edges.length && Math.max(...edges.map(e => ratio(e, outer))) < 3) found['field-edge'].push(sel(el) + ' [' + theme + ']');
  }
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || !shown(el)) continue;
    const cs = getComputedStyle(el), fam = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''), w = parseInt(cs.fontWeight, 10);
    if (loaded[fam] && !loaded[fam].includes(w)) found['font-weight'].push(fam + ' ' + w + ' ' + sel(el));
  }
  return found;
}

/* Opens every view in every theme at phone and desktop width, with the seed history (tests/fixtures/make-seed.js),
   and again as a new install, for the welcome and the empty states. The clock and time zone are fixed, so "Yesterday" and the
   streak calendar come out the same on any machine on any day. Each violation is listed once. */
const SEED = require('./fixtures/seed-records.json');
const NOW = '2026-10-31T12:00:00Z';
async function browserViolations(browser, base) {
  const loaded = loadedWeights(), all = {};
  const runs = [];
  for (const [theme, settings] of THEMES) for (const [, viewport] of SIZES_PX) runs.push([theme, settings, viewport, SEED]);
  for (const [theme, settings] of THEMES) for (const [, viewport] of SIZES_PX) runs.push([theme, settings, viewport, null]);   /* a new install, with the welcome, in every theme and size */
  /* Four browser windows at a time: each run is independent, and one at a time takes minutes. */
  const one = async ([theme, settings, viewport, seed]) => {
    const ctx = await browser.newContext({ viewport, timezoneId: 'UTC' });
    const p = await ctx.newPage();
    await p.clock.setFixedTime(new Date(NOW));
    await p.addInitScript(([s, r]) => {
      localStorage.setItem('stick-timing-trainer.v1', JSON.stringify({ settings: r ? Object.assign({ noise: -50, latCal: true }, s) : s, cal: null }));   /* with history, a returning user: set up. A new install sees the welcome. */
      if (r) localStorage.setItem('stick-timing-trainer.records.v2', JSON.stringify(r));
    }, [settings, seed]);
    await p.goto(base);
    await p.waitForTimeout(400);
    for (const [, clicks] of VIEWS) {
      await p.keyboard.press('Escape');
      for (const c of clicks) { await p.locator(c).first().click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(150); }
      if (!(await p.evaluate(() => typeof axe !== 'undefined'))) await p.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const f = await p.evaluate(inPage, { loaded, theme });
      for (const k in f) (all[k] = all[k] || new Set()), f[k].forEach(x => all[k].add(x));
      if (await p.locator('#pgBack').isVisible()) await p.locator('#pgBack').click();   /* Help has a Back button; a run page closes on Escape */
      else if (await p.locator('#pg').isVisible()) await p.keyboard.press('Escape');
    }
    await ctx.close();
  };
  for (let i = 0; i < runs.length; i += 4) await Promise.all(runs.slice(i, i + 4).map(one));
  const out = {};
  for (const k in all) out[k] = [...all[k]];
  return out;
}

/* ---- The ratchet ---- */

const readBaseline = () => fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const counts = list => list.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
/* Items in a beyond what b holds, counting repeats. */
const minus = (a, b) => { const left = counts(b), out = []; for (const x of a) { if (left.get(x) > 0) left.set(x, left.get(x) - 1); else out.push(x); } return out; };

function compare(check, found) {
  const base = readBaseline()[check] || [];
  return { added: minus(found, base), fixed: minus(base, found) };
}

const GUIDE = { 'raw-colour': '§2 Colour tokens', 'font-size': '§3 Typography', radius: '§4 Radius', 'letter-spacing': '§3 Typography', 'undefined-variable': 'CLAUDE.md', axe: '§9 Accessibility', 'target-44': '§4 Hit targets', 'field-edge': '§2 --line-strong', 'font-weight': '§3 Typography' };

function report(check, { added, fixed }) {
  const lines = [];
  if (added.length) lines.push(added.length + ' new "' + check + '" violation(s). Fix them as STYLE-GUIDE.md says (' + GUIDE[check] + '):', ...added.map(x => '  + ' + x));
  if (fixed.length) lines.push(fixed.length + ' "' + check + '" violation(s) fixed. Run `npm run style:baseline` to take them off the list:', ...fixed.map(x => '  - ' + x));
  return lines.join('\n');
}


module.exports = { staticViolations, browserViolations, compare, report, GUIDE };

/* `node tests/style.js --update` takes fixed violations off the list; `--accept` records the current ones. */
if (require.main === module) (async () => {
  const accept = process.argv.includes('--accept');
  if (!accept && !process.argv.includes('--update')) { console.log('usage: node tests/style.js --update | --accept'); process.exit(1); }
  const { chromium } = require('playwright'), { serve } = require('./helpers');
  const { server, base } = await serve(html);
  const browser = await chromium.launch();
  const found = Object.assign(staticViolations(), await browserViolations(browser, base));
  await browser.close(); server.close();
  const old = readBaseline(), next = {};
  for (const k of Object.keys(found).sort()) {
    next[k] = (accept || !old[k] ? found[k] : minus(old[k], minus(old[k], found[k]))).sort();
    const c = compare(k, found[k]);
    console.log(k + ': ' + next[k].length + (c.fixed.length ? ', ' + c.fixed.length + ' fixed' : '') + (c.added.length ? ', ' + c.added.length + (accept || !old[k] ? ' recorded' : ' new, NOT recorded: fix them') : ''));
  }
  fs.writeFileSync(BASELINE, JSON.stringify(next, null, 1) + '\n');
})();
