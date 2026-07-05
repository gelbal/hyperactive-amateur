// ABOUTME: wakeLock — optional Screen Wake Lock wrapper for long-running renders.
// ABOUTME: Keeps feature detection, release, and visible-state re-request logic in one place.

interface ScreenWakeLockSentinelLike extends EventTarget {
  released?: boolean;
  release: () => Promise<void>;
}

interface ScreenWakeLockLike {
  request: (type: "screen") => Promise<ScreenWakeLockSentinelLike>;
}

type NavigatorWithWakeLock = Navigator & { wakeLock?: ScreenWakeLockLike };

export interface ScreenWakeLockHandle {
  release: () => Promise<void>;
}

function getScreenWakeLock(): ScreenWakeLockLike | null {
  return (navigator as NavigatorWithWakeLock).wakeLock ?? null;
}

async function releaseSentinel(sentinel: ScreenWakeLockSentinelLike | null): Promise<void> {
  if (!sentinel || sentinel.released) return;
  try {
    await sentinel.release();
  } catch {
    // Wake-lock release can race browser auto-release; cleanup stays best-effort.
  }
}

export async function holdScreenWakeLock(): Promise<ScreenWakeLockHandle> {
  let active = true;
  let sentinel: ScreenWakeLockSentinelLike | null = null;
  let requestInFlight: Promise<void> | null = null;

  const request = async (): Promise<void> => {
    if (!active) return;
    if (sentinel && !sentinel.released) return;
    const wakeLock = getScreenWakeLock();
    if (!wakeLock) return;
    try {
      const nextSentinel = await wakeLock.request("screen");
      if (!active) {
        await releaseSentinel(nextSentinel);
        return;
      }
      sentinel = nextSentinel;
      nextSentinel.addEventListener("release", () => {
        if (sentinel === nextSentinel) sentinel = null;
      });
    } catch {
      sentinel = null;
    }
  };

  const queueRequest = (): Promise<void> => {
    if (!requestInFlight) {
      requestInFlight = request().finally(() => {
        requestInFlight = null;
      });
    }
    return requestInFlight;
  };

  const onVisibilityChange = () => {
    if (!document.hidden) void queueRequest();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  await queueRequest();

  return {
    release: async () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      await requestInFlight;
      const held = sentinel;
      sentinel = null;
      await releaseSentinel(held);
    },
  };
}
