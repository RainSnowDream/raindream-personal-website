// Service Worker 版本号：替换了静态资源（如 avatar.webp）且希望老访客立即更新时，把它 +1。
// posts.js 走的是「网络优先」，所以发布新文章不需要改这里。
const CACHE_VERSION = 'v3';
const CACHE_NAME = 'raindream-cache-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './blog.html',
  './posts.js',
  './avatar.webp'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(PRECACHE_URLS);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== CACHE_NAME;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 页面导航 + 文章数据（posts.js）：网络优先，保证新文章立刻出现；断网时回退缓存。
  if (request.mode === 'navigate' || url.pathname.endsWith('/posts.js')) {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy);
          });
          return response;
        })
        .catch(function () {
          return caches.match(request).then(function (cached) {
            return cached || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // 其余静态资源（头像等）：缓存优先，速度快、省流量；换文件后记得给 CACHE_VERSION +1。
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, copy);
        });
        return response;
      });
    })
  );
});
