// ABOUTME: Hyperactive Amateur service worker — app-shell cache, network for the AI proxy.
// ABOUTME: CACHE_NAME's %BUILD_HASH% is substituted at build time so deploys invalidate old caches.
const CACHE_NAME = "ha-shell-%BUILD_HASH%";
const APP_SHELL = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("ha-shell-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Network-first for the AI proxy and any same-origin non-GET — we don't
  // want to serve a stale Gemini response or hijack a POST.
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET") {
    return;
  }
  // Cache-first for everything else under our origin (the app shell).
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) => cached || fetch(event.request),
      ),
    );
  }
});
