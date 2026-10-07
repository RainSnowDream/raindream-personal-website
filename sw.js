// Service Worker 版本号：替换了静态资源（如 avatar.webp）且希望老访客立即更新时，把它 +1。
// posts.js 走的是「网络优先」，所以发布新文章不需要改这里。
const CACHE_VERSION = 'v7';
const CACHE_NAME = 'raindream-cache-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './blog.html',
  './404.html',
  './styles.css',
  './common.js',
  './posts.js',
  './marked.umd.js',
  './avatar.webp'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        /* 逐个缓存，而不是 addAll：addAll 只要有一个文件取不到，整次安装就会失败，
           而且不报错 —— 预缓存会静默停止更新。 */
        return Promise.all(PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function () {});
        }));
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

  // 音频不进缓存：一首歌几 MB，缓存进访客浏览器会白占几十上百 MB，
  // 而且本站不支持分段请求（Range），缓存它也没什么收益。直接交给浏览器自己处理。
  if (/\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(url.pathname)) return;

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
            if (cached) return cached;
            /* 离线、且这个地址从没访问过：返回真正的 404 页面（状态码也是 404），
               而不是把首页当成「成功」返回。404 页面也拿不到时才退回首页。 */
            return caches.match('./404.html').then(function (page) {
              if (!page) return caches.match('./index.html');
              return page.text().then(function (html) {
                return new Response(html, {
                  status: 404,
                  statusText: 'Not Found',
                  headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
              });
            });
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
