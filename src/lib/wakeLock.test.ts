// ABOUTME: Pins the optional wake-lock wrapper's request coalescing and visibility behavior.
// ABOUTME: Covers release cleanup, pending requests, and unsupported-browser safety.
import { afterEach, describe, expect, it, vi } from "vitest";
import { holdScreenWakeLock, type ScreenWakeLockHandle } from "./wakeLock";

interface WakeLockSentinelStub extends EventTarget {
  released: boolean;
  release: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

type WakeLockRequest = ReturnType<
  typeof vi.fn<(type: "screen") => Promise<WakeLockSentinelStub>>
>;

const originalWakeLockDescriptor = Object.getOwnPropertyDescriptor(navigator, "wakeLock");
const originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
const handles: ScreenWakeLockHandle[] = [];

function makeSentinel(): WakeLockSentinelStub {
  const sentinel = new EventTarget() as WakeLockSentinelStub;
  sentinel.released = false;
  sentinel.release = vi.fn(async () => {
    sentinel.released = true;
    sentinel.dispatchEvent(new Event("release"));
  });
  return sentinel;
}

function autoRelease(sentinel: WakeLockSentinelStub): void {
  sentinel.released = true;
  sentinel.dispatchEvent(new Event("release"));
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
}

function installWakeLock(request: WakeLockRequest): void {
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: { request },
  });
}

async function holdTracked(): Promise<ScreenWakeLockHandle> {
  const handle = await holdScreenWakeLock();
  handles.push(handle);
  return handle;
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.release()));
  if (originalWakeLockDescriptor) {
    Object.defineProperty(navigator, "wakeLock", originalWakeLockDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "wakeLock");
  }
  if (originalHiddenDescriptor) {
    Object.defineProperty(document, "hidden", originalHiddenDescriptor);
  } else {
    Reflect.deleteProperty(document, "hidden");
  }
  vi.restoreAllMocks();
});

describe("holdScreenWakeLock", () => {
  it("re-requests after an auto-released sentinel when the document becomes visible", async () => {
    const sentinels: WakeLockSentinelStub[] = [];
    const request = vi.fn(async (_type: "screen") => {
      const sentinel = makeSentinel();
      sentinels.push(sentinel);
      return sentinel;
    });
    installWakeLock(request);
    const handle = await holdTracked();

    autoRelease(sentinels[0]);
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    await handle.release();
    expect(sentinels[1].release).toHaveBeenCalledTimes(1);
  });

  it("does not re-request after an auto-release while the document is hidden", async () => {
    const sentinel = makeSentinel();
    const request = vi.fn(async (_type: "screen") => sentinel);
    installWakeLock(request);
    await holdTracked();

    autoRelease(sentinel);
    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("release removes the listener, awaits an in-flight request, releases it, and prevents later requests", async () => {
    const firstSentinel = makeSentinel();
    const pendingSentinel = makeSentinel();
    let resolvePending: (sentinel: WakeLockSentinelStub) => void = () => undefined;
    let requestCount = 0;
    const request = vi.fn((_type: "screen") => {
      requestCount += 1;
      if (requestCount === 1) return Promise.resolve(firstSentinel);
      return new Promise<WakeLockSentinelStub>((resolve) => {
        resolvePending = resolve;
      });
    });
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    installWakeLock(request);
    const handle = await holdTracked();

    autoRelease(firstSentinel);
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    let releaseFinished = false;
    const releasePromise = handle.release().then(() => {
      releaseFinished = true;
    });
    await Promise.resolve();
    expect(removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(releaseFinished).toBe(false);

    resolvePending(pendingSentinel);
    await releasePromise;
    expect(pendingSentinel.release).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("resolves safely when the Screen Wake Lock API is unavailable", async () => {
    Reflect.deleteProperty(navigator, "wakeLock");

    const handle = await holdTracked();

    await expect(handle.release()).resolves.toBeUndefined();
  });

  it("coalesces concurrent queued requests into one wake-lock request", async () => {
    const sentinel = makeSentinel();
    let resolveRequest: (sentinel: WakeLockSentinelStub) => void = () => undefined;
    const request = vi.fn(
      (_type: "screen") =>
        new Promise<WakeLockSentinelStub>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    installWakeLock(request);
    setHidden(false);

    const handlePromise = holdScreenWakeLock();
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(request).toHaveBeenCalledTimes(1);
    resolveRequest(sentinel);
    const handle = await handlePromise;
    handles.push(handle);
  });
});
