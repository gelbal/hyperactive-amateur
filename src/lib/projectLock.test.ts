// ABOUTME: projectLock tests — the first open copy claims the saved project; a second copy does not.
// ABOUTME: Drives a Web Locks stand-in, since jsdom has no navigator.locks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLogs, getLogs, LOG_EVENTS } from "./logger";
import { claimProjectWriter, PROJECT_LOCK_NAME, PROJECT_LOCK_WAIT_MS } from "./projectLock";

type LockCallback = (lock: { name: string } | null) => unknown;

// Exclusive-mode Web Locks semantics: a free name is granted at once; a held
// name queues the request until the holder releases or the signal aborts.
class LockManagerStandIn {
  private readonly held = new Set<string>();
  private readonly waiting: Array<{ name: string; grant: () => void }> = [];

  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: LockCallback,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const grant = () => {
        this.held.add(name);
        void Promise.resolve(callback({ name })).then(resolve, reject);
      };
      if (!this.held.has(name)) {
        grant();
        return;
      }
      const waiter = { name, grant };
      this.waiting.push(waiter);
      options.signal?.addEventListener("abort", () => {
        const index = this.waiting.indexOf(waiter);
        if (index === -1) return;
        this.waiting.splice(index, 1);
        reject(new DOMException("The request was aborted.", "AbortError"));
      });
    });
  }

  // The holding page goes away (closed, or unloading on reload).
  releaseHolderOf(name: string): void {
    this.held.delete(name);
    const index = this.waiting.findIndex((waiter) => waiter.name === name);
    if (index === -1) return;
    const [next] = this.waiting.splice(index, 1);
    next.grant();
  }
}

function installLocks(locks: unknown): void {
  Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
}

describe("claimProjectWriter", () => {
  beforeEach(() => {
    clearLogs();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "locks");
    vi.useRealTimers();
  });

  it("the first open copy claims the project", async () => {
    installLocks(new LockManagerStandIn());

    await expect(claimProjectWriter()).resolves.toBe(true);
  });

  it("a second copy is refused once the wait runs out while the first holds the project", async () => {
    vi.useFakeTimers();
    installLocks(new LockManagerStandIn());
    await expect(claimProjectWriter()).resolves.toBe(true);

    let second: boolean | undefined;
    void claimProjectWriter().then((result) => {
      second = result;
    });
    await vi.advanceTimersByTimeAsync(PROJECT_LOCK_WAIT_MS - 1);
    expect(second).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(second).toBe(false);
  });

  it("a reloading page that lets go within the wait hands the project to its successor", async () => {
    vi.useFakeTimers();
    const locks = new LockManagerStandIn();
    installLocks(locks);
    await expect(claimProjectWriter()).resolves.toBe(true);

    let successor: boolean | undefined;
    void claimProjectWriter().then((result) => {
      successor = result;
    });
    await vi.advanceTimersByTimeAsync(300);
    locks.releaseHolderOf(PROJECT_LOCK_NAME);
    await vi.advanceTimersByTimeAsync(0);

    expect(successor).toBe(true);
    // The granted claim does not lapse when the wait would have run out.
    await vi.advanceTimersByTimeAsync(PROJECT_LOCK_WAIT_MS);
    expect(successor).toBe(true);
  });

  it("keeps saving as before where the browser has no Web Locks", async () => {
    installLocks(undefined);

    await expect(claimProjectWriter()).resolves.toBe(true);
  });

  it("keeps saving and logs it when the lock request fails for another reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installLocks({
      request: () => Promise.reject(new DOMException("Not allowed here.", "SecurityError")),
    });

    await expect(claimProjectWriter()).resolves.toBe(true);

    const entry = getLogs().find((log) => log.event === LOG_EVENTS.PROJECT_LOCK_FAILED);
    expect(entry?.payload).toEqual({ message: expect.stringContaining("Not allowed here.") });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
