// ABOUTME: Service worker tests — precaches built assets, runtime-caches later assets, leaves APIs network-only.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, it, expect, vi } from "vitest";

interface ListenerMap {
  install?: (event: ExtendableEventStub) => void;
  activate?: (event: ExtendableEventStub) => void;
  fetch?: (event: FetchEventStub) => void;
}

interface ExtendableEventStub {
  waits: Promise<unknown>[];
  waitUntil: (promise: Promise<unknown>) => void;
}

interface FetchEventStub extends ExtendableEventStub {
  request: Request;
  responsePromise: Promise<Response> | null;
  respondWith: (promise: Promise<Response>) => void;
}

function makeEvent(): ExtendableEventStub {
  return {
    waits: [],
    waitUntil(promise) {
      this.waits.push(promise);
    },
  };
}

function makeFetchEvent(request: Request): FetchEventStub {
  return {
    ...makeEvent(),
    request,
    responsePromise: null,
    respondWith(promise) {
      this.responsePromise = promise;
    },
  };
}

function loadServiceWorker(
  options: {
    precacheUrls?: string[];
    rejectCacheOpen?: boolean;
    rejectCachePut?: boolean;
  } = {},
) {
  const listeners: ListenerMap = {};
  const stores = new Map<string, Map<string, Response>>();
  const deletedCaches: string[] = [];
  const fetchMock = vi.fn(async (request: Request) => {
    return new Response(`network:${new URL(request.url).pathname}`, { status: 200 });
  });
  const self = {
    location: { origin: "https://example.test" },
    clients: { claim: vi.fn() },
    skipWaiting: vi.fn(),
    addEventListener(type: keyof ListenerMap, cb: ListenerMap[keyof ListenerMap]) {
      listeners[type] = cb;
    },
  };
  const caches = {
    async open(name: string) {
      if (options.rejectCacheOpen) throw new Error("cache unavailable");
      let store = stores.get(name);
      if (!store) {
        store = new Map();
        stores.set(name, store);
      }
      return {
        addAll: vi.fn(async (urls: string[]) => {
          for (const url of urls) {
            store!.set(new URL(url, self.location.origin).href, new Response("shell"));
          }
        }),
        put: vi.fn(async (request: Request, response: Response) => {
          if (options.rejectCachePut) throw new Error("quota exceeded");
          store!.set(request.url, response);
        }),
      };
    },
    async keys() {
      return Array.from(stores.keys());
    },
    async delete(name: string) {
      deletedCaches.push(name);
      return stores.delete(name);
    },
    async match(request: Request) {
      if (request.cache === "reload") return undefined;
      for (const store of stores.values()) {
        const cached = store.get(request.url);
        if (cached) return cached.clone();
      }
      return undefined;
    },
  };

  const precacheUrls = options.precacheUrls ?? ["/", "/index.html"];
  const source = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8")
    .replaceAll("%BUILD_HASH%", "testhash")
    .replace(
      'const PRECACHE_URLS = ["/", "/index.html"]; // %PRECACHE_URLS%',
      `const PRECACHE_URLS = ${JSON.stringify(precacheUrls)};`,
    );
  vm.runInNewContext(source, {
    self,
    caches,
    fetch: fetchMock,
    Request,
    URL,
    Response,
  });
  return { listeners, stores, deletedCaches, fetchMock, self };
}

describe("service worker", () => {
  it("pre-caches build-injected Vite assets during install", async () => {
    const { listeners, stores, self } = loadServiceWorker({
      precacheUrls: [
        "/",
        "/index.html",
        "/assets/index-abc123.js",
        "/assets/index-def456.css",
      ],
    });
    const event = makeEvent();

    listeners.install?.(event);
    await Promise.all(event.waits);

    const store = stores.get("ha-shell-testhash");
    expect(store?.has("https://example.test/")).toBe(true);
    expect(store?.has("https://example.test/index.html")).toBe(true);
    expect(store?.has("https://example.test/assets/index-abc123.js")).toBe(true);
    expect(store?.has("https://example.test/assets/index-def456.css")).toBe(true);
    expect(self.skipWaiting).toHaveBeenCalled();
  });

  it("serves precached app shell even for browser reload requests", async () => {
    const { listeners, fetchMock } = loadServiceWorker();
    const installEvent = makeEvent();
    listeners.install?.(installEvent);
    await Promise.all(installEvent.waits);

    const reloadEvent = makeFetchEvent(
      new Request("https://example.test/", { cache: "reload" }),
    );
    listeners.fetch?.(reloadEvent);

    const response = await reloadEvent.responsePromise!;
    expect(await response.text()).toBe("shell");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runtime-caches same-origin Vite assets after first fetch", async () => {
    const { listeners, fetchMock } = loadServiceWorker();
    const event = makeFetchEvent(
      new Request("https://example.test/assets/index-abc123.js"),
    );

    listeners.fetch?.(event);
    expect(event.responsePromise).not.toBeNull();
    const first = await event.responsePromise!;
    expect(await first.text()).toBe("network:/assets/index-abc123.js");
    await Promise.all(event.waits);

    const secondEvent = makeFetchEvent(
      new Request("https://example.test/assets/index-abc123.js"),
    );
    listeners.fetch?.(secondEvent);
    const second = await secondEvent.responsePromise!;
    expect(await second.text()).toBe("network:/assets/index-abc123.js");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still serves a fetched asset when cache write fails", async () => {
    const { listeners, fetchMock } = loadServiceWorker({ rejectCachePut: true });
    const event = makeFetchEvent(
      new Request("https://example.test/assets/index-quota.js"),
    );

    listeners.fetch?.(event);

    const response = await event.responsePromise!;
    expect(await response.text()).toBe("network:/assets/index-quota.js");
    await expect(Promise.all(event.waits)).resolves.toEqual([undefined]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still serves a fetched asset when cache open fails", async () => {
    const { listeners, fetchMock } = loadServiceWorker({ rejectCacheOpen: true });
    const event = makeFetchEvent(
      new Request("https://example.test/assets/index-cache-open.js"),
    );

    listeners.fetch?.(event);

    const response = await event.responsePromise!;
    expect(await response.text()).toBe("network:/assets/index-cache-open.js");
    await expect(Promise.all(event.waits)).resolves.toEqual([undefined]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves API requests network-only and unhandled by the service worker", () => {
    const { listeners, fetchMock } = loadServiceWorker();
    const event = makeFetchEvent(new Request("https://example.test/api/gemini"));

    listeners.fetch?.(event);

    expect(event.responsePromise).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deletes old versioned shell caches on activate", async () => {
    const { listeners, stores, deletedCaches } = loadServiceWorker();
    stores.set("ha-shell-old", new Map());
    stores.set("ha-shell-testhash", new Map());
    stores.set("other-cache", new Map());
    const event = makeEvent();

    listeners.activate?.(event);
    await Promise.all(event.waits);

    expect(deletedCaches).toEqual(["ha-shell-old"]);
    expect(stores.has("ha-shell-testhash")).toBe(true);
    expect(stores.has("other-cache")).toBe(true);
  });
});
