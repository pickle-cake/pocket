/* html-validate checks index.html's markup without a browser: structure, ids, labels, ARIA and attribute values.
   It sees every panel and dialog, including the hidden ones axe only meets when they are open. */
module.exports = {
  extends: ['html-validate:recommended'],
  rules: {
    'doctype-style': 'off',                 /* lowercase <!doctype html> is valid and is this file's style */
    'prefer-native-element': 'off',         /* the exercise lists are custom listboxes on purpose, with their own keys */
    'multiple-labeled-controls': 'off',     /* a slider's label holds its live value in an <output>, so the value is read with the name */
  },
};
