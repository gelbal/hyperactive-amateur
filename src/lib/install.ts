// ABOUTME: install — capture beforeinstallprompt, gate the install affordance, request persistent storage.
// ABOUTME: Persistence matters because the entire project (clip blobs) lives in IndexedDB.
import { useSyncExternalStore } from "react";
import type { StorageDurability } from "../types";

// Chromium-only event shape; iOS Safari has no programmatic install API.
type InstallPromptEvent = Event & {
  prompt?: () => Promise<void>;
};

let deferredPrompt: InstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

function notifySubscribers(): void {
  for (const cb of subscribers) cb();
}

// Subscribe to install-state changes. Used by the React hook below and by
// any other consumer that needs to react when the prompt becomes available
// or is consumed. Returns an unsubscribe.
export function subscribeInstall(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

// Browser fires beforeinstallprompt when the page becomes install-eligible.
// We stash the event so the user can trigger it later from inside the UI;
// the spec requires we call .prompt() in response to a user gesture. Returns
// a detach so App.tsx can clean up on unmount (React Strict Mode runs the
// effect twice in dev — without this the listener would stack up).
export function captureInstallPrompt(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    notifySubscribers();
  };
  window.addEventListener("beforeinstallprompt", handler);
  return () => window.removeEventListener("beforeinstallprompt", handler);
}

export function canInstall(): boolean {
  return deferredPrompt !== null;
}

// React hook: re-renders when canInstall() changes. Lets <InstallAffordance>
// appear if beforeinstallprompt fires AFTER the component mounts (Chrome's
// heuristics may take several seconds to flip the page install-eligible).
export function useCanInstall(): boolean {
  return useSyncExternalStore(subscribeInstall, canInstall, () => false);
}

export async function triggerInstall(): Promise<void> {
  if (!deferredPrompt?.prompt) return;
  await deferredPrompt.prompt();
  // The prompt can only be shown once per event; null it out so the
  // affordance disappears whether the user accepted or dismissed.
  deferredPrompt = null;
  notifySubscribers();
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari signals home-screen install via a non-standard navigator flag.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export function hasCoarsePointer(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches === true;
}

export function isManualInstallHintContext(installable = canInstall()): boolean {
  return !isStandalone() && !installable && hasCoarsePointer();
}

export async function getStorageDurability(): Promise<StorageDurability> {
  if (typeof navigator === "undefined") return "unknown";
  const storage = navigator.storage;
  if (!storage?.persisted) return "unknown";
  try {
    return (await storage.persisted()) ? "persistent" : "best-effort";
  } catch {
    return "unknown";
  }
}

// Best-effort request for eviction-resistant storage. Granted persistence
// makes the IndexedDB-backed project safer across long idle gaps; browsers
// grant or deny based on signals like installed-PWA or frequent use.
export async function requestPersistence(): Promise<StorageDurability> {
  if (typeof navigator === "undefined") return "unknown";
  const storage = navigator.storage;
  if (!storage?.persist) return "unknown";
  try {
    return (await storage.persist()) ? "persistent" : "best-effort";
  } catch {
    return "unknown";
  }
}

// Test-only — clears the captured prompt between cases.
export function __resetInstallForTesting(): void {
  deferredPrompt = null;
}
