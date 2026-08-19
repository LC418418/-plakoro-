/* POKE TOWER service worker
   之前係 cache-first：一裝咗就永遠食 cache，改完上載同事都收唔到新版。
   而家改成 network-first：有網就攞最新，冇網就用 cache，離線照玩。 */
const C = 'poketower-v23';
const FILES = ['./', './index.html', './manifest.webmanifest',
               './icon-192.png', './icon-512.png',
               './icon-mask-192.png', './icon-mask-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const isDoc = req.mode === 'navigate' ||
                (req.destination === 'document') ||
                new URL(req.url).pathname.endsWith('/index.html');

  if (isDoc) {
    // 有網 → 攞最新並更新 cache；冇網 → 用返 cache
    e.respondWith(
      fetch(req)
        .then(r => {
          const copy = r.clone();
          caches.open(C).then(c => c.put(req, copy)).catch(() => {});
          return r;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // 其他靜態檔（icon、manifest）：cache 行先，背景順手更新
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(r => {
        const copy = r.clone();
        caches.open(C).then(c => c.put(req, copy)).catch(() => {});
        return r;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
