/* Static checks of index.html that need no browser. Every inline script must parse: a mistake fails here in
   milliseconds and names its line in index.html, instead of as a page error in the browser tests a minute later. */
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('vm');
const { html } = require('./helpers');

/* Each inline <script>, with the line of index.html it starts on. */
const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .filter(m => !/\ssrc=/.test(m[1] || ''))
  .map(m => ({ name: (/id="([^"]+)"/.exec(m[1] || '') || [, 'inline'])[1], code: m[2], line: html.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length - 1 }));

test('syntax: index.html has its inline scripts', () => {
  assert.deepEqual(scripts.map(s => s.name), ['inline', 'core', 'app']);
});

for (const s of scripts) test('syntax: <script' + (s.name === 'inline' ? '' : ' id="' + s.name + '"') + '> parses', () => {
  try { new vm.Script(s.code, { filename: 'index.html', lineOffset: s.line }); }
  catch (e) { assert.fail(e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')); }
});

/* ESLint, with eslint.config.js: correctness rules only, over index.html's scripts and the tests. */
test('eslint: no problems', async () => {
  const { ESLint } = require('eslint');
  const { ROOT } = require('./helpers');
  const results = await new ESLint({ cwd: ROOT }).lintFiles(['.']);
  const found = results.flatMap(r => r.messages.map(m => require('path').relative(ROOT, r.filePath) + ':' + m.line + ':' + m.column + '  ' + m.message + (m.ruleId ? '  (' + m.ruleId + ')' : '')));
  assert.ok(!found.length, found.length + ' ESLint problem(s). Fix them; see eslint.config.js for why each rule is on:\n  ' + found.join('\n  '));
});

/* html-validate, with .htmlvalidate.cjs: the markup, including every panel and dialog that starts hidden. */
test('html-validate: no problems', async () => {
  const { HtmlValidate, FileSystemConfigLoader } = require('html-validate');
  const { ROOT } = require('./helpers');
  const report = await new HtmlValidate(new FileSystemConfigLoader()).validateFile(require('path').join(ROOT, 'index.html'));
  const found = report.results.flatMap(r => r.messages.map(m => 'index.html:' + m.line + ':' + m.column + '  ' + m.message + '  (' + m.ruleId + ')'));
  assert.ok(report.valid, found.length + ' markup problem(s). Fix them; see .htmlvalidate.cjs for the rules turned off and why:\n  ' + found.join('\n  '));
});

/* Australian English in everything people read: the page's text and labels, sentences in the scripts, and the built-in
   routines. A word the regular expression would catch but that is right in Australian English goes in AU_OK, with a reason. */
const AU_US = /\b(colors?|colored|behaviors?|centers?|centered|favorites?|grays?|catalogs?|license|licensed|defense|offense|traveled|traveling|canceled|canceling|labeled|labeling|modeled|leveled|leveling|signaled|fulfill|enroll|skillful|judgment|toward|math|gotten|analog|fiber|theater|liters?|[a-z]+(?:yze|yzed|yzing|ize|izes|ized|izing|ization|izations))\b/gi;
const AU_OK = new Set(['size', 'sizes', 'sized', 'resize', 'resized', 'resizing', 'prize', 'prizes', 'seize']);   /* not the -ize ending */
const AU_NAMES = /GNU General Public License|stop-color|color:var/g;   /* a proper name, and CSS inside script strings */
test('spelling: Australian English in everything people read', () => {
  const fs = require('fs'), path = require('path'), { ROOT } = require('./helpers');
  const texts = [];
  const markup = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  texts.push(['index.html', markup.replace(/<[^>]+>/g, ' ')]);
  for (const m of markup.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g)) texts.push(['index.html', m[1]]);
  for (const s of scripts) for (const m of s.code.matchAll(/'((?:[^'\\n]|\.)*)'/g)) if (/[a-z] [a-z]/i.test(m[1])) texts.push(['index.html <script id="' + s.name + '">', m[1]]);
  for (const f of fs.readdirSync(path.join(ROOT, 'routines'))) texts.push(['routines/' + f, fs.readFileSync(path.join(ROOT, 'routines', f), 'utf8')]);
  const found = [];
  texts.forEach(([src, t]) => {
    t = t.replace(AU_NAMES, '');
    for (const m of t.matchAll(AU_US)) if (!AU_OK.has(m[0].toLowerCase())) found.push(src + ': "' + m[0] + '" in "…' + t.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, ' ') + '…"');
  });
  assert.ok(!found.length, found.length + ' American spelling(s). Use Australian English (colour, centre, behaviour, -ise, licence for the noun):\n  ' + found.join('\n  '));
});
