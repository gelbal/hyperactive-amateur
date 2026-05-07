// ABOUTME: useFullscreen tests — initial state, change events update isFullscreen, enter/exit call the API.
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
  let originalExit: Document["exitFullscreen"] | undefined;
  let originalElement: Element | null;
  const requestSpy = vi.fn(async () => undefined);
  const exitSpy = vi.fn(async () => undefined);

  beforeEach(() => {
    lastResult = null;
    originalRequest = Element.prototype.requestFullscreen;
    originalExit = Document.prototype.exitFullscreen;
    originalElement = document.fullscreenElement;
    requestSpy.mockClear();
    exitSpy.mockClear();
    Element.prototype.requestFullscreen = requestSpy as unknown as Element["requestFullscreen"];
    Document.prototype.exitFullscreen = exitSpy as unknown as Document["exitFullscreen"];
  });

  afterEach(() => {
    Element.prototype.requestFullscreen = originalRequest as Element["requestFullscreen"];
    Document.prototype.exitFullscreen = originalExit as Document["exitFullscreen"];
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: originalElement,
    });
  });

  it("starts with isFullscreen=false when nothing is fullscreen", () => {
    render(<Probe />);
    expect(lastResult?.isFullscreen).toBe(false);
  });

  it("enter() calls requestFullscreen on the given element", async () => {
    render(<Probe />);
    const el = document.createElement("div");
    await act(async () => {
      await lastResult?.enter(el);
    });
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it("exit() calls document.exitFullscreen when something is fullscreen", async () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.createElement("div"),
    });
    render(<Probe />);
    await act(async () => {
      await lastResult?.exit();
    });
    expect(exitSpy).toHaveBeenCalled();
  });

  it("isFullscreen flips when fullscreenchange fires", () => {
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
