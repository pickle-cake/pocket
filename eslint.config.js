/* ESLint checks the scripts inside index.html for mistakes, not for style: the dense one-line layout is deliberate,
   so every formatting rule stays off. Problems that were already there are listed in eslint-suppressions.json. */
const html = require('eslint-plugin-html');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', '_site/**'] },
  {
    files: ['index.html', 'landing/index.html'],
    plugins: { html },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.browser } },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      /* names */
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-use-before-define': ['error', { functions: false, classes: true, variables: false }],   /* only code that runs as the page loads: a const read there before its line has run throws */
      'no-redeclare': 'error',
      'no-shadow-restricted-names': 'error',
      'no-func-assign': 'error',
      'no-const-assign': 'error',
      'no-class-assign': 'error',
      'no-import-assign': 'error',
      /* code that cannot do what it says */
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-dupe-else-if': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-constant-binary-expression': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-finally': 'error',
      'no-sparse-arrays': 'error',
      'no-loss-of-precision': 'error',
      'no-compare-neg-zero': 'error',
      'no-async-promise-executor': 'error',
      'no-setter-return': 'error',
      'getter-return': 'error',
      'no-unused-labels': 'error',
      'no-invalid-regexp': 'error',
      'no-empty-character-class': 'error',
      'no-control-regex': 'off',   /* the app matches control characters on purpose when it cleans imported text */
    },
  },
  {
    files: ['sw.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.serviceworker } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-self-assign': 'error',
    },
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser, axe: 'readonly' } },   /* page.evaluate callbacks run in the browser */
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-self-assign': 'error',
    },
  },
];
