/* ============================================================
   搭搭 Service Worker（APP-02）
   策略：
   - 静态资源（css/js/img/icons，同源 GET）：Stale-While-Revalidate
   - /uploads/ 图片：Cache-First（文件名含时间戳，不可变）
   - /api/ GET：Network-First（仅缓存成功响应），失败回退缓存
   - 导航请求：Network-First，失败回退 /（SPA 壳离线可开）
   - /ws 与一切非 GET 请求：绝不拦截，直接放行
   ============================================================ */
const VERSION = 'v3';
const STATIC_CACHE = `dada-static-${VERSION}`;   // 静态资源（版本化缓存 dada-static-v3）
const API_CACHE = `dada-api-${VERSION}`;         // 接口 GET 兜底（dada-api-v3）
const KEEP = [STATIC_CACHE, API_CACHE];

// 预缓存：SPA 壳核心资源（离线可开）
// 性能F1：12 个页面脚本全部纳入预缓存——首访即写缓存，离线 reload 不再因
// /js/pages/*.js 拉取失败而白屏（此前仅缓存壳四件套，离线时页面路由全部落空）
const PRECACHE = [
  '/',
  '/css/app.css',
  '/css/extensions.css',
  '/css/desktop.css',
  '/js/api.js',
  '/js/ui.js',
  '/js/ws.js',
  '/js/app.js',
  '/js/pages/login.js',
  '/js/pages/square.js',
  '/js/pages/post.js',
  '/js/pages/publish.js',
  '/js/pages/discover.js',
  '/js/pages/chat.js',
  '/js/pages/conv.js',
  '/js/pages/me.js',
  '/js/pages/user.js',
  '/js/pages/misc.js',
  '/js/pages/admin.js',
  '/js/pages/legal.js',
  '/img/logo.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('dada-') && !KEEP.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 非 GET（POST/PUT/DELETE/PATCH）与 WebSocket 升级请求：一律直连不拦截
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname === '/ws' || url.protocol === 'ws:' || url.protocol === 'wss:') return;

  // 跨域请求不处理
  if (url.origin !== self.location.origin) return;

  // 导航请求：Network-First，失败回退 SPA 壳
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, STATIC_CACHE, '/'));
    return;
  }

  // 上传图片：Cache-First（文件名含时间戳，天然不可变）
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // 接口：Network-First（仅缓存 200，失败回退缓存）
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(req, API_CACHE));
    return;
  }

  // 同源静态资源（css/js/img/icons 等）：Stale-While-Revalidate
  event.respondWith(staleWhileRevalidate(event, req, STATIC_CACHE));
});

/* ---------- 策略实现 ---------- */

async function staleWhileRevalidate(event, req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const refresh = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  event.waitUntil(refresh); // 保活后台更新，避免 SW 提前休眠中断刷新
  return cached || (await refresh) || Response.error();
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return cached || Response.error();
  }
}

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (fallbackUrl) {
      const shell = await cache.match(fallbackUrl) || await caches.open(STATIC_CACHE).then((c) => c.match('/'));
      if (shell) return shell;
    }
    return Response.error();
  }
}
