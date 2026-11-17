// 請假登記表 PWA：service worker
// 作用：第一次開啟時把網頁和圖示存進手機，之後離線也能打開。
// 修改 index.html 或圖示後，請把 CACHE_VERSION 的數字加 1，手機才會下載新版。
var CACHE_VERSION = "leave-pwa-v1";

var FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

// 安裝：先把所有檔案存起來
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(FILES);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// 啟用：刪掉舊版本的快取
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf("leave-pwa-") === 0 && key !== CACHE_VERSION) return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// 讀取：
// ・開啟頁面時先連網抓最新版，連不上才用手機裡存的版本。
// ・圖示等其他檔案直接用存好的版本，比較快。
self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(function (response) {
        if (response.ok) {
          var copy = response.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put("./index.html", copy); });
        }
        return response;
      }).catch(function () {
        return caches.match("./index.html");
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      return cached || fetch(request);
    })
  );
});
