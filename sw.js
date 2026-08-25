/* POKE TOWER service worker
   之前係 cache-first：一裝咗就永遠食 cache，改完上載同事都收唔到新版。
   後來改成 network-first：有網就攞最新，冇網就用 cache，離線照玩。

   而家（階段 0 拆檔）分咗兩個 cache：
     CORE  —— index.html 同 PWA 嗰幾個檔。**每次出版都要升 CORE_V**，
              升咗就會清走舊嘅，玩家開機攞到新 code。
     ASSET —— assets/ 入面啲圖。**唔跟 CORE_V 清**，因為每個檔名
              本身已經帶住版本號（bg-title-v1.webp），改圖就改檔名。
              兩個 cache 分開就係成件事嘅重點：升遊戲版本號唔應該
              連 1.1MB 圖一齊重新落過。 */
const CORE_V = 'poketower-v42';
/* ⚠ 淨係喺「想一次過丟掉全部舊圖」嗰陣先加一（例如換走成套精靈圖之後
     想清走舊檔）。平時換一兩張圖係改檔名嘅版本號，唔關呢度事。 */
const ASSET_V = 'poketower-assets-1';

const CORE_FILES = ['./', './index.html', './manifest.webmanifest',
                    './icon-192.png', './icon-512.png',
                    './icon-mask-192.png', './icon-mask-512.png',
                    /* 呢兩個一開機就要，所以裝嗰陣就落定 */
                    './assets/dexspr-v1.js', './assets/bg-title-v1.webp'];

/* 戰鬥背景同地圖底圖冇寫喺上面 —— 特登嘅。
   佢哋第一次用到先落（每張 30-75KB），之後就永久留喺 ASSET cache。
   咁樣就唔使喺呢度維護一張十六個檔名嘅清單（改完圖唔記得改就會食住舊 cache）。 */

const NET_TIMEOUT = 4000;   // 見下面 fetch handler

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CORE_V).then(c => c.addAll(CORE_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CORE_V && k !== ASSET_V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 「網慢到爬」同「完全冇網」係兩件事。
   之前個 fetch 淨係有 .catch()，即係得「完全冇網」先會用返 cache ——
   地鐵、電梯、酒樓地庫嗰種「連得到但慢到死」就會一路等到瀏覽器自己放棄，
   玩家對住白畫面，明明部機入面已經有一份開得到。
   而家過咗 NET_TIMEOUT 就唔等，用 cache 開住先；
   個 fetch 唔會 cancel，返到嚟照樣更新 cache，下次開就係新版。 */
function timeout(ms){
  return new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), ms));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const path = new URL(req.url).pathname;

  /* assets/ 入面啲嘢：純 cache-first，唔使背景更新。
     檔名帶版本號 = 同一個 URL 嘅內容永遠一樣，攞到就唔使再問。 */
  if (path.includes('/assets/')) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(ASSET_V).then(c => c.put(req, copy)).catch(() => {}); }
        return r;
      }))
    );
    return;
  }

  const isDoc = req.mode === 'navigate' ||
                (req.destination === 'document') ||
                path.endsWith('/index.html');

  if (isDoc) {
    const net = fetch(req).then(r => {
      const copy = r.clone();
      caches.open(CORE_V).then(c => c.put(req, copy)).catch(() => {});
      return r;
    });
    e.respondWith(
      Promise.race([net, timeout(NET_TIMEOUT)])
        /* 慢／冇網 → 用 cache。連 cache 都冇（第一次裝）就冇得揀，
           唯有等返個 fetch，唔可以喺度 reject 住個畫面。 */
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')).then(r => r || net))
    );
    return;
  }

  // 其他靜態檔（icon、manifest）：cache 行先，背景順手更新
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(r => {
        const copy = r.clone();
        caches.open(CORE_V).then(c => c.put(req, copy)).catch(() => {});
        return r;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
