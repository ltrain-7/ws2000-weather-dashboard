const CACHE_NAME = "ws2000-v1.6.0";
const STATIC_ASSETS = ["/", "/index.html", "/styles.css?v=1.6.0", "/app.js?v=1.6.0", "/manifest.webmanifest", "/icon.svg"];

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
  if (url.pathname.startsWith("/api/admin") || url.pathname.startsWith("/api/auth")) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok && ["/api/latest", "/api/config"].includes(url.pathname)) {
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      }
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
