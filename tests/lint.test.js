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
