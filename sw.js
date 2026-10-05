// Offline shell for 死锁车库 / GRIDLOCK.
//
// 口径：**同源子资源一律网络优先，网络失败才退缓存**。手工写死的 VERSION 号配 cache-first
// 会把 js/css 永久钉在旧版——出新 HTML 配旧 JS 是别人踩过的鬼状态，这里不再犯。
// 版本号只用来在发版时把上一轮的 runtime 缓存清掉（见 activate），不用来决定读取顺序。
//
// file:// 下不注册（注册代码在 index.html 里按 protocol 分流），这里另外挡掉非 http(s) 的
// 请求，免得某个把站点直接开成 file:// 的打包方式在 SW 里抛未捕获异常。

const VERSION = 'gridlock-v1.1.1';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/game.css',
  // main.js 是 type=module：浏览器按 import 图逐个拉 js/core/*，少一条就是一条 504。
  // 只缓存三个入口模块的话，「装完第一次打开就断网」这台设备连关卡池都取不到。
  './js/main.js',
  './js/view.js',
  './js/audio.js',
  './js/core/game.js',
  './js/core/law.js',
  './js/core/lot.js',
  './js/core/rng.js',
  './js/core/solve.js',
  './js/core/storage.js',
  './js/core/library.js',
  './js/data/lots.js',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
  './assets/img/icon-maskable-512.png',
  './assets/img/apple-touch-icon.png',
  './assets/img/favicon.png',
  './assets/img/favicon-32.png',
  './assets/img/favicon-16.png',
  './assets/img/tex-asphalt-256.png',
  './assets/img/tex-concrete-256.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // 一张图没上线不能拖垮整次安装：逐条 add，失败只记一条。
    await Promise.all(SHELL_URLS.map((u) => cache.add(u).catch(() => undefined)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('gridlock-') && k !== SHELL && k !== RUNTIME)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME);
  let response = null;
  let fromNetwork = false;
  try {
    response = await fetch(request);
    fromNetwork = true;
    if (response && response.ok && request.method === 'GET') {
      cache.put(request, response.clone()).catch(() => undefined);
    }
  } catch (err) {
    response = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
  }
  if (response) return response;
  if (fromNetwork && request.mode === 'navigate') {
    // 在线但这一页没缓存：至少让离线壳接住刷新，别给一屏 500。
    const shell = await caches.match('./index.html');
    if (shell) return shell;
  }
  return new Response('offline', { status: 504, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' } });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch (err) {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin !== self.location.origin) return; // 不代理第三方
  if (url.pathname.endsWith('/sw.js')) return; // 别把自己的更新喂进缓存
  event.respondWith(networkFirst(req));
});
