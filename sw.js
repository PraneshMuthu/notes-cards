const VERSION = 'v1';
const CACHE = `notes-cards-${VERSION}`;
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icon.svg',
  './apple-touch-icon.png', './icon-192.png', './icon-512.png',
  './js/app.js', './js/parse.js', './js/markdown.js', './js/day.js', './js/scheduler.js',
  './js/store.js', './js/picker.js', './js/sync.js', './vendor/ts-fsrs.mjs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

async function precache() {
  const c = await caches.open(CACHE);
  await Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
  try { // card files are listed in cards/index.json; cache them so the first offline visit works
    const res = await fetch(new Request('./cards/index.json', { cache: 'reload' }));
    if (!res.ok) throw new Error(res.status);
    await c.put('./cards/index.json', res.clone());
    const files = await res.json();
    await Promise.all(files.map((f) => c.add(new Request('./cards/' + f, { cache: 'reload' })).catch(() => {})));
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
  e.respondWith(networkFirst(req, e));
});

const TIMEOUT = 3000;

// Every same-origin GET is network-first (revalidated via ETag), so a deploy is picked up
// on the next online load without any VERSION bump. The cache is the offline fallback, and
// also answers after TIMEOUT on a slow network (the fetch keeps going and refreshes the cache).
function networkFirst(req, e) {
  const net = fetch(req, { cache: 'no-cache' });
  // Refresh the cache whenever the network answers, even after we already served the cached copy.
  e.waitUntil(net.then((res) => {
    if (res.ok) return caches.open(CACHE).then((c) => c.put(req, res.clone()));
  }).catch(() => {}));
  return respond(req, net);
}

async function respond(req, net) {
  const cached = async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
  };
  let timer;
  const slow = new Promise((resolve) => { timer = setTimeout(resolve, TIMEOUT); });
  try {
    const first = await Promise.race([net, slow]);
    if (first) return first; // network answered in time
    return (await cached()) || (await net); // slow: cached copy, else keep waiting for the network
  } catch (err) {
    const hit = await cached();
    if (hit) return hit;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
