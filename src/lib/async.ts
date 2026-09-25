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

export async function waitUntilAudioTime(
  deadlineSeconds: number,
  audioContext: Pick<BaseAudioContext, "currentTime">,
  signal?: AbortSignal,
): Promise<void> {
  for (;;) {
    if (signal) {
      throwIfFlowAborted(signal, "Aborted before countdown completed");
    }
    const remainingMs = (deadlineSeconds - audioContext.currentTime) * 1000;
    if (remainingMs <= 0) return;
    await waitMs(remainingMs, signal);
  }
}

export function getAbortReason(signal: AbortSignal): "user" | "interrupted" {
  return signal.reason === "interrupted" ? "interrupted" : "user";
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function isFlowAbort(err: unknown, signal: AbortSignal): boolean {
  return isAbortError(err) || (signal.aborted && err === signal.reason);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
