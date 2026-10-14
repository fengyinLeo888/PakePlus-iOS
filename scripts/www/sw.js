/* ============================================================
 * sw.js —— Service Worker（PWA 离线支持）
 * 策略：核心文件缓存优先（本地应用无需网络），直连 API 请求不拦截
 * 仅在 http(s) 下注册生效，file:// 直开时自动跳过
 * ============================================================ */
// 【维护提醒】任何代码/资源文件改动后，务必升级下面版本号，否则旧缓存不会更新
var CACHE_NAME = 'fitness-helper-v6'; // v6：APK 分发版适配——manifest 补 id/scope，首页加隐私提示条，新增构建脚本

// 需要离线缓存的全部核心文件
var CORE_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './apple-touch-icon.png',
  './css/app.css',
  './js/db.js',
  './js/exercise-data.js',
  './js/report-parser.js',
  './js/chart.js',
  './js/survey.js',
  './js/ai-client.js',
  './js/state-cards.js',
  './js/report.js',
  './js/today.js',
  './js/coach.js',
  './js/meal.js',
  './js/log.js',
  './js/me.js',
  './js/app.js'
];

// 安装：预缓存核心文件（任一失败不影响整体，尽力而为）
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(
        CORE_FILES.map(function (f) {
          return cache.add(f).catch(function () { /* 单文件失败忽略 */ });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// 激活：清理旧版本缓存
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; })
             .map(function (n) { return caches.delete(n); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// 拦截请求：核心文件缓存优先；其余（如外部视频链接）放行网络
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return; // 只处理 GET
  var url = new URL(e.request.url);
  // 非同源请求（B 站 / YouTube 视频、厂商 API）一律直连，不经过 SW
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) return cached;
      // 缓存没有则走网络，成功后顺带补进缓存（运行时缓存）
      return fetch(e.request).then(function (resp) {
        if (resp.ok) {
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(e.request, clone); });
        }
        return resp;
      }).catch(function () {
        // 离线且无缓存：返回简单提示
        return new Response('离线且无缓存', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      });
    })
  );
});
