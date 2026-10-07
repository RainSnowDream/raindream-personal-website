// Service Worker 版本号：只影响「缓存优先」的资源（头像等图片）。
// 页面、样式、脚本都走「网络优先」，所以改 HTML / CSS / JS 不需要动这里。
const CACHE_VERSION = 'v18';
const CACHE_NAME = 'raindream-cache-' + CACHE_VERSION;

/* 只有「换得少、体积小」的图片和字体走缓存优先。
   其余全都走网络优先 —— 包括 .json（歌单 audio/playlist.json 就是 json）。
   真实踩过的坑：以前 .json 落在缓存优先里，老访客一直看到缓存里那份旧歌单（只有一首歌）。 */
const CACHE_FIRST = /\.(?:webp|avif|png|jpe?g|gif|svg|ico|woff2?|ttf|otf|eot)$/i;

const PRECACHE_URLS = [
  './',
  './index.html',
  './blog',
  './blog.html',
  './404.html',
  './styles.css',
  './theme-button.js',
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

  // 音频不进缓存：一首歌几 MB，缓存进访客浏览器会白占几十上百 MB；
  // 而且音频由 src/worker.js 单独处理（支持 Range 分段下载），
  // 交给浏览器自己按需取那一段，比在这里整份缓存更合适。
  if (/\.(mp3|m4a|m4b|aac|ogg|oga|opus|wav|flac)$/i.test(url.pathname)) return;

  // 页面导航：网络优先，保证新文章立刻出现；断网时回退缓存。
  if (request.mode === 'navigate') {
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

  // 除图片 / 字体以外（含 html、css、js、json）：网络优先，断网时回退缓存。
  // 这一条很关键：HTML 走网络优先，如果 CSS / JS / 歌单 json 却走缓存优先，就会出现
  // 「新 HTML + 旧资源」的错位 —— 真实发生过两次：一次是导航栏按钮文字被挤成一列，
  // 一次是老访客只看到旧歌单里的一首歌。文本类资源必须与 HTML 来自同一次部署。
  if (!CACHE_FIRST.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(request, copy);
            });
          }
          return response;
        })
        .catch(function () {
          /* 断网：用缓存里的那份顶上 */
          return caches.match(request);
        })
    );
    return;
  }

  // 图片与字体：缓存优先，速度快、省流量；换文件后记得给 CACHE_VERSION +1。
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
