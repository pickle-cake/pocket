/* Pocket's service worker: the app keeps working without a connection.
   The page and the libraries come from the network whenever there is one, so a new version arrives on the next load
   and the update notice keeps working. Without a connection they come from the last copy. Fonts rarely change, so
   they come from the cache first. Each site (the live app and the fork's preview) has its own worker and cache. */
const CACHE = 'pocket-v1';
const SHELL = ['./', './routines/starter.txt', './routines/rudiments.txt'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));   /* a missing library must not stop the install */
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !font) return;   /* other sites, such as linked libraries, go straight to the network */
  if (url.searchParams.has('check')) return;   /* the page asking whether there is a new version: always the network, never kept */
  e.respondWith(font ? cacheFirst(req) : networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./') : null);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}
