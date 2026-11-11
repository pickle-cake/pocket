/* Assembles the Pages site in _site/: the home page at the root and the app under app/.
     _site/index.html          landing/index.html, the home page
     _site/sw.js               the service worker again, so the old address keeps working offline
     _site/routines/           the libraries again: links saved before the app moved point here
     _site/app/                index.html, sw.js and routines/: the app
   Run with `npm run site`, then serve _site/ to preview it (for example `npx http-server _site`). */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.resolve(ROOT, process.argv[2] || '_site');   /* a folder for a test can be given */

fs.rmSync(OUT, { recursive: true, force: true });
const copy = (from, to) => fs.cpSync(path.join(ROOT, from), path.join(OUT, to), { recursive: true });
copy('landing/index.html', 'index.html');
copy('sw.js', 'sw.js');
copy('routines', 'routines');
copy('index.html', 'app/index.html');
copy('sw.js', 'app/sw.js');
copy('routines', 'app/routines');
console.log('site assembled in ' + path.relative(ROOT, OUT) + '/');
