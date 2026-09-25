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

// Vite asset URLs are content-hashed, so an /assets/ entry that already
// exists in the outgoing deploy's cache is byte-identical — copy it instead
// of re-downloading the whole bundle on every deploy. Shell URLs ("/",
// "/index.html") change content without changing their URL and always
// re-fetch through addAll. Any copy failure falls back to addAll.
async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const oldKeys = (await caches.keys()).filter(
    (k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME,
  );
  const missing = [];
  for (const url of PRECACHE_URLS) {
    let copied = false;
    if (url.startsWith("/assets/")) {
      const href = new URL(url, self.location.origin).href;
      for (const key of oldKeys) {
        try {
          const previous = await caches.open(key);
          const hit = await previous.match(href);
          if (hit) {
            await cache.put(new Request(href), hit.clone());
            copied = true;
            break;
          }
        } catch {
          // fall through to addAll below
        }
      }
    }
    if (!copied) missing.push(url);
  }
  if (missing.length > 0) await cache.addAll(missing);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell());
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
