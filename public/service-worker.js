const CACHE_NAME = "ws2000-v1.9.0";
const STATIC_ASSETS = ["/", "/index.html", "/styles.css?v=1.9.0", "/history-time.js?v=1.9.0", "/insights.js?v=1.9.0", "/forecast.js?v=1.9.0", "/app.js?v=1.9.0", "/manifest.webmanifest", "/icon.svg"];

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
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(event.request))
        || (await cache.match("/index.html"))
        || (await cache.match("/"))
        || new Response("Dashboard unavailable while offline.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
    }));
    return;
  }
  if (url.pathname.startsWith("/api/admin") || url.pathname.startsWith("/api/auth")) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok && ["/api/latest", "/api/config", "/api/forecast"].includes(url.pathname)) {
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      }
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
