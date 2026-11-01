/* Loads the app's two scripts straight out of index.html, so the tests always run against what ships. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function script(id) {
  const m = new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>').exec(html);
  if (!m) throw new Error('no <script id="' + id + '"> in index.html');
  return m[1];
}

/* The core script is pure logic with no DOM access. names are the functions and classes to hand back. */
function loadCore(names) {
  const ctx = { console, Math };
  vm.createContext(ctx);
  vm.runInContext(script('core') + '\n;' + names.map(n => 'this.' + n + '=' + n + ';').join(''), ctx);
  return ctx;
}

/* Values made inside the vm have their own Array, so tests compare plain copies. */
const plain = x => JSON.parse(JSON.stringify(x));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* Serves a page as the app, and the repository's files beside it, on a free port. */
function serve(page) {
  const server = require('http').createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/' || u === '/index.html') { res.setHeader('content-type', 'text/html'); return res.end(page); }
    const f = path.join(ROOT, u);
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) { if (f.endsWith('.js')) res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(f)); }   /* a service worker must be served as JavaScript */
    res.statusCode = 404; res.end();
  });
  return new Promise(r => server.listen(0, () => r({ server, base: 'http://localhost:' + server.address().port + '/' })));
}
module.exports = { ROOT, html, script, loadCore, read, plain, serve };
