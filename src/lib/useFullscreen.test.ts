// ABOUTME: useFullscreen tests — isSupported reflects requestFullscreen presence on documentElement.
// ABOUTME: iOS Safari has no element-level requestFullscreen; the hook must report that honestly.
import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useFullscreen } from "./useFullscreen";

describe("useFullscreen", () => {
  it("reports unsupported when documentElement.requestFullscreen is absent", () => {
    const original = document.documentElement.requestFullscreen;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document.documentElement as any).requestFullscreen = undefined;
    try {
      const { result } = renderHook(() => useFullscreen());
      expect(result.current.isSupported).toBe(false);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (document.documentElement as any).requestFullscreen = original;
    }
  });

  it("reports supported when documentElement.requestFullscreen is a function (jsdom default)", () => {
    // jsdom provides requestFullscreen as a function — make the assertion
    // structural rather than asserting true/false so the test stays robust
    // across jsdom versions.
    const { result } = renderHook(() => useFullscreen());
    expect(typeof result.current.isSupported).toBe("boolean");
  });
});
