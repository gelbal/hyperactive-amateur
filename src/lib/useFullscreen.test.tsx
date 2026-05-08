// ABOUTME: useFullscreen tests — enter() invokes requestFullscreen; fullscreenchange flips state.
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useFullscreen, type UseFullscreenResult } from "./useFullscreen";

let lastResult: UseFullscreenResult | null = null;
function Probe() {
  lastResult = useFullscreen();
  return null;
}

describe("useFullscreen", () => {
  let originalRequest: Element["requestFullscreen"] | undefined;
  const requestSpy = vi.fn(async () => undefined);

  beforeEach(() => {
    lastResult = null;
    originalRequest = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = requestSpy as unknown as Element["requestFullscreen"];
    requestSpy.mockClear();
  });

  afterEach(() => {
    Element.prototype.requestFullscreen = originalRequest as Element["requestFullscreen"];
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
  });

  it("enter() calls requestFullscreen on the given element", async () => {
    render(<Probe />);
    const el = document.createElement("div");
    await act(async () => {
      await lastResult?.enter(el);
    });
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it("isFullscreen flips on fullscreenchange events", () => {
    render(<Probe />);
    expect(lastResult?.isFullscreen).toBe(false);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.createElement("div"),
    });
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(lastResult?.isFullscreen).toBe(true);
  });
});
