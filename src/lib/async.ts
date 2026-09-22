// ABOUTME: Tiny async helpers shared by browser media flows.
// ABOUTME: Keeps timeout/error wiring consistent without repeating Promise.race boilerplate.

export function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(makeAbortError("Aborted before wait started"));
      return;
    }
    const delayMs = Math.max(0, ms);
    if (delayMs === 0) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(makeAbortError("Aborted during wait"));
    };
    signal.addEventListener("abort", onAbort);
  });
}

export function makeAbortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

export function throwIfFlowAborted(signal: AbortSignal, message: string): void {
  if (signal.aborted) {
    throw makeAbortError(message);
  }
}

export function timeoutAfter(ms: number, message: string): Promise<never> {
  return waitMs(ms).then(() => {
    throw new Error(message);
  });
}
