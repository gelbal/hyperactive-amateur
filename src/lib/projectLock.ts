// ABOUTME: projectLock — one open copy of the app (tab, window or installed app) owns the saved project.
// ABOUTME: The owner holds a Web Lock for the page's lifetime; any other copy neither loads nor saves.
import { LOG_EVENTS, logger } from "./logger";

export const PROJECT_LOCK_NAME = "ha:project";
// On reload the outgoing page can still hold the lock while it unloads, so a
// new page waits this long before deciding another copy owns the project.
export const PROJECT_LOCK_WAIT_MS = 1500;

// Resolves true when this page owns the saved project. Every save deletes the
// stored recordings its own project does not use, so two copies saving side
// by side delete each other's takes; only the owner may load or save.
export function claimProjectWriter(): Promise<boolean> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  // Without Web Locks one owner cannot be enforced; keep saving as before.
  if (!locks) return Promise.resolve(true);
  const wait = new AbortController();
  const timer = setTimeout(() => wait.abort(), PROJECT_LOCK_WAIT_MS);
  return new Promise<boolean>((resolve) => {
    locks
      .request(PROJECT_LOCK_NAME, { signal: wait.signal }, () => {
        clearTimeout(timer);
        resolve(true);
        // Held until the page goes away.
        return new Promise<never>(() => undefined);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        if (wait.signal.aborted) {
          resolve(false);
          return;
        }
        logger.warn(LOG_EVENTS.PROJECT_LOCK_FAILED, {
          message: err instanceof Error ? err.message : String(err),
        });
        resolve(true);
      });
  });
}
