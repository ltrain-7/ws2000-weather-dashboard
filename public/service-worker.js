const CACHE_NAME = "ws2000-v1.4.2";
const STATIC_ASSETS = ["/", "/index.html", "/styles.css?v=1.4.2", "/app.js?v=1.4.2", "/manifest.webmanifest", "/icon.svg", "/admin.html", "/admin.js?v=1.4.2"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok && ["/api/latest", "/api/config", "/api/admin"].includes(url.pathname)) {
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      }
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
