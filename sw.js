// Offline cache. Bump VERSION when files change so phones pick up the update.
const VERSION = 'wt-v6';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'sync.js', 'xlsx.full.min.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // Network first (skipping the browser's HTTP cache) so updates land as a set;
  // fall back to the offline copy at the gym.
  e.respondWith(fetch(e.request.url, { cache: 'no-cache' }).then((r) => { const c = r.clone(); caches.open(VERSION).then((ca) => ca.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
