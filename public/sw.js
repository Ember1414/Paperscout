/* PaperScout Service Worker
 * v2 修复：样式/脚本改为「网络优先」——
 * v1 的缓存优先策略导致 CSS 修复无法送达用户浏览器（白框问题反复出现的根因） */
var CACHE = 'paperscout-v2';
var CACHE_FIRST = ['/manifest.webmanifest'];   // 很少变的资源才用缓存优先
var NETWORK_FIRST = ['/style.css', '/app.js']; // 样式与逻辑必须保持最新

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      // 删除所有旧版本缓存，确保修复立即生效
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // 页面导航：网络优先
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(function () { return caches.match(e.request); }));
    return;
  }

  if (NETWORK_FIRST.indexOf(url.pathname) !== -1) {
    // 网络优先：拿不到最新版才用缓存兜底（离线场景）
    e.respondWith(
      fetch(e.request).then(function (res) {
        if (res.ok) {
          var clone = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, clone); });
        }
        return res;
      }).catch(function () { return caches.match(e.request); })
    );
    return;
  }

  if (CACHE_FIRST.indexOf(url.pathname) !== -1) {
    e.respondWith(
      caches.match(e.request).then(function (cached) {
        return cached || fetch(e.request);
      })
    );
  }
});
