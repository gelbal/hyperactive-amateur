// ABOUTME: Hyperactive Amateur service worker — app-shell cache, network for the AI proxy.
// ABOUTME: CACHE_NAME's %BUILD_HASH% is substituted at build time so deploys invalidate old caches.
const CACHE_NAME = "ha-shell-%BUILD_HASH%";
const CACHE_PREFIX = "ha-shell-";
const PRECACHE_URLS = ["/", "/index.html"]; // %PRECACHE_URLS%

function isApiRequest(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/api/");
}

function isRuntimeCachedAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/assets/");
}

function cacheKeyFor(request) {
  return new Request(request.url, { method: "GET" });
}

async function cacheFirst(request, event) {
  const cacheKey = cacheKeyFor(request);
  const cached = await caches.match(cacheKey);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && isRuntimeCachedAsset(new URL(request.url))) {
    const copy = response.clone();
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then((cache) => cache.put(cacheKey, copy))
        .catch(() => undefined),
    );
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
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
  if (isApiRequest(url) || event.request.method !== "GET") {
    return;
  }
  // Cache-first for the app shell and Vite's content-hashed runtime assets.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request, event));
  }
});
