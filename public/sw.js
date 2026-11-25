// SmartPark service worker.
// - The detection model and the app's built files are kept on the device after the
//   first download, so the app opens fast and does not re-download ~40 MB.
// - Pages are always fetched fresh when online (new Base44 publishes show up
//   immediately); the last copy is used only when offline.
// - API calls, uploads, sign-in and other sites are never cached.
const VERSION = "smartpark-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (!key.startsWith(VERSION)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

const isStatic = (url) =>
  url.pathname.startsWith("/models/") ||
  url.pathname.startsWith("/assets/") ||
  url.pathname.startsWith("/icons/");

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Built files have content hashes and model files are versioned by name: cache-first.
  if (isStatic(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok && response.status === 200) cache.put(request, response.clone());
      return response;
    })());
    return;
  }

  // App pages: network first, cached copy when offline.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(PAGE_CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) cache.put("/", response.clone());
        return response;
      } catch {
        return (await cache.match("/")) || Response.error();
      }
    })());
  }
});
