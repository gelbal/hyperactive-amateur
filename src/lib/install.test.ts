// ABOUTME: install tests — beforeinstallprompt capture, prompt invocation, subscribe notify, cleanup, persist.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  captureInstallPrompt,
  canInstall,
  getStorageDurability,
  requestPersistence,
  subscribeInstall,
  triggerInstall,
  useCanInstall,
  isStandalone,
  __resetInstallForTesting,
} from "./install";

describe("install", () => {
  beforeEach(() => __resetInstallForTesting());
  afterEach(() => {
    __resetInstallForTesting();
    Reflect.deleteProperty(navigator, "storage");
  });

  it("captureInstallPrompt: firing beforeinstallprompt flips canInstall to true and notifies subscribers", () => {
    const detach = captureInstallPrompt();
    const notify = vi.fn();
    const unsubscribe = subscribeInstall(notify);
    expect(canInstall()).toBe(false);
    const event = new Event("beforeinstallprompt");
    // Real prompt() is a no-op for the test — we just need it to exist
    // so triggerInstall doesn't bail.
    Object.assign(event, { prompt: async () => undefined });
    window.dispatchEvent(event);
    expect(canInstall()).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    unsubscribe();
    detach();
  });

  it("captureInstallPrompt returns a detach that removes the listener (Strict Mode double-mount safety)", () => {
    const detach = captureInstallPrompt();
    detach();
    const event = new Event("beforeinstallprompt");
    Object.assign(event, { prompt: async () => undefined });
    window.dispatchEvent(event);
    // After detach, no listener captured the event → canInstall stays false.
    expect(canInstall()).toBe(false);
  });

  it("triggerInstall: invokes prompt(), clears the captured event, and notifies subscribers", async () => {
    const detach = captureInstallPrompt();
    const promptFn = vi.fn(async () => undefined);
    const event = new Event("beforeinstallprompt");
    Object.assign(event, { prompt: promptFn });
    window.dispatchEvent(event);
    const notify = vi.fn();
    const unsubscribe = subscribeInstall(notify);
    await triggerInstall();
    expect(promptFn).toHaveBeenCalled();
    expect(canInstall()).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    unsubscribe();
    detach();
  });

  it("useCanInstall: re-renders when beforeinstallprompt fires after mount", () => {
    const detach = captureInstallPrompt();
    const { result } = renderHook(() => useCanInstall());
    expect(result.current).toBe(false);
    act(() => {
      const event = new Event("beforeinstallprompt");
      Object.assign(event, { prompt: async () => undefined });
      window.dispatchEvent(event);
    });
    expect(result.current).toBe(true);
    detach();
  });

  it("isStandalone: matchMedia '(display-mode: standalone)' wins", () => {
    const original = window.matchMedia;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).matchMedia = (q: string) => ({
      matches: q === "(display-mode: standalone)",
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    try {
      expect(isStandalone()).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });

  it("getStorageDurability maps persisted storage status to app durability states", async () => {
    const persistedFn = vi.fn(async () => true);
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { persisted: persistedFn },
    });
    await expect(getStorageDurability()).resolves.toBe("persistent");
    expect(persistedFn).toHaveBeenCalledTimes(1);

    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { persisted: vi.fn(async () => false) },
    });
    await expect(getStorageDurability()).resolves.toBe("best-effort");

    Reflect.deleteProperty(navigator, "storage");
    await expect(getStorageDurability()).resolves.toBe("unknown");
  });

  it("requestPersistence calls persist and returns the resulting durability", async () => {
    const persistFn = vi.fn(async () => true);
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { persist: persistFn },
    });
    await expect(requestPersistence()).resolves.toBe("persistent");
    expect(persistFn).toHaveBeenCalledTimes(1);

    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { persist: vi.fn(async () => false) },
    });
    await expect(requestPersistence()).resolves.toBe("best-effort");

    Reflect.deleteProperty(navigator, "storage");
    await expect(requestPersistence()).resolves.toBe("unknown");
  });
});
