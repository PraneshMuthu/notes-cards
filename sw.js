const VERSION = 'v1';
const CACHE = `notes-cards-${VERSION}`;
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icon.svg',
  './js/app.js', './js/parse.js', './js/markdown.js', './js/day.js', './js/scheduler.js',
  './js/store.js', './js/picker.js', './vendor/ts-fsrs.mjs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

async function precache() {
  const c = await caches.open(CACHE);
  await c.addAll(SHELL);
  try { // card files are listed in cards/index.json; cache them so the first offline visit works
    const res = await fetch('./cards/index.json', { cache: 'no-store' });
    await c.put('./cards/index.json', res.clone());
    const files = await res.json();
    await Promise.all(files.map((f) => c.add('./cards/' + f).catch(() => {})));
  } catch { /* offline install: cards will be cached on first online use */ }
}

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const isCards = url.pathname.includes('/cards/');
  e.respondWith(isCards ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
