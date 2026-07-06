// ABOUTME: Viewport tests — gate-state transitions across idle/denied/granted; recording station mount.
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toneMocks = vi.hoisted(() => ({
  immediate: vi.fn(() => 1),
  now: vi.fn(() => 1.1),
}));
vi.mock("tone", () => ({
  immediate: toneMocks.immediate,
  now: toneMocks.now,
  getTransport: vi.fn(() => ({
    clear: vi.fn(),
    scheduleRepeat: vi.fn(() => 1),
  })),
}));

const videoEngineMocks = vi.hoisted(() => ({
  drawCurrentFrame: vi.fn(),
  initVideoEngine: vi.fn(),
  setActiveCanvas: vi.fn(),
}));
vi.mock("../lib/videoEngine", () => videoEngineMocks);

const requestMedia = vi.fn();
const isAcquireInFlight = vi.fn(() => false);
const ensureAudioRunning = vi.fn();
vi.mock("../lib/media", () => ({
  requestMedia: () => requestMedia(),
  isAcquireInFlight: () => isAcquireInFlight(),
}));
vi.mock("../lib/audioLifecycle", () => ({
  ensureAudioRunning: () => ensureAudioRunning(),
}));

import { Viewport } from "./Viewport";
import { useAppStore } from "../store/useAppStore";

describe("Viewport", () => {
  let rafCallback: FrameRequestCallback | null = null;
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn> | null = null;
  let cancelAnimationFrameSpy: ReturnType<typeof vi.spyOn> | null = null;
  let getContextSpy: ReturnType<typeof vi.spyOn> | null = null;
  const originalDevicePixelRatio = window.devicePixelRatio;
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    rafCallback = null;
    requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        rafCallback = callback;
        return 1;
      });
    cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    toneMocks.immediate.mockClear();
    toneMocks.now.mockClear();
    toneMocks.immediate.mockReturnValue(1);
    toneMocks.now.mockReturnValue(1.1);
    videoEngineMocks.drawCurrentFrame.mockReset();
    videoEngineMocks.initVideoEngine.mockReset();
    videoEngineMocks.setActiveCanvas.mockReset();
    requestMedia.mockReset();
    isAcquireInFlight.mockReset();
    isAcquireInFlight.mockReturnValue(false);
    ensureAudioRunning.mockReset();
    ensureAudioRunning.mockImplementation(async () => {
      useAppStore.getState().actions.setAudioState("running");
    });
    useAppStore.getState().actions.reset();
    // jsdom doesn't ship Element#requestFullscreen by default — stub it so
    // the capability guard (M3-2) treats the platform as supporting fullscreen
    // for the toggle-visibility assertion below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document.documentElement as any).requestFullscreen = () => Promise.resolve();
  });

  afterEach(() => {
    requestAnimationFrameSpy?.mockRestore();
    cancelAnimationFrameSpy?.mockRestore();
    getContextSpy?.mockRestore();
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: originalDevicePixelRatio,
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: originalResizeObserver,
    });
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: originalResizeObserver,
    });
  });

  function setDevicePixelRatio(value: number) {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value,
    });
  }

  function installResizeObserver(cssSize: number) {
    class StubResizeObserver implements ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: {
                width: cssSize,
                height: cssSize,
              },
            } as ResizeObserverEntry,
          ],
          this,
        );
      }

      unobserve() {}

      disconnect() {}
    }

    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: StubResizeObserver,
    });
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: StubResizeObserver,
    });
  }

  function getRenderCanvas() {
    return document.querySelector(".ha-render-canvas") as HTMLCanvasElement | null;
  }

  function getDisplayCanvas() {
    return screen.getByLabelText("hard-cut video viewport") as HTMLCanvasElement;
  }

  it("keeps a hidden 480 render canvas registered for export", () => {
    render(<Viewport />);
    const renderCanvas = getRenderCanvas();

    expect(renderCanvas).toBeInTheDocument();
    expect(renderCanvas?.width).toBe(480);
    expect(renderCanvas?.height).toBe(480);
    expect(renderCanvas).toHaveAttribute("aria-hidden", "true");
    expect(renderCanvas?.style.opacity).toBe("0");
    expect(renderCanvas?.style.display).not.toBe("none");
    expect(videoEngineMocks.setActiveCanvas).toHaveBeenLastCalledWith(renderCanvas);
  });

  it("sizes the display canvas from CSS size and capped DPR", () => {
    setDevicePixelRatio(3);
    installResizeObserver(390);

    render(<Viewport />);

    let displayCanvas = getDisplayCanvas();
    expect(displayCanvas).toHaveClass("ha-display-canvas");
    expect(displayCanvas.width).toBe(780);
    expect(displayCanvas.height).toBe(780);

    cleanup();
    setDevicePixelRatio(1);
    installResizeObserver(390);

    render(<Viewport />);

    displayCanvas = getDisplayCanvas();
    expect(displayCanvas.width).toBe(390);
    expect(displayCanvas.height).toBe(390);
  });

  it("blits the render canvas onto the display canvas each animation frame", () => {
    const renderContext = { canvas: null } as unknown as CanvasRenderingContext2D;
    const displayDrawImage = vi.fn();
    const displayContext = {
      canvas: null,
      drawImage: displayDrawImage,
    } as unknown as CanvasRenderingContext2D;
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(function (
        this: HTMLCanvasElement,
        contextId: string,
      ) {
        if (contextId === "2d" && this.classList.contains("ha-render-canvas")) {
          return renderContext;
        }
        if (contextId === "2d" && this.classList.contains("ha-display-canvas")) {
          return displayContext;
        }
        return originalGetContext.call(this, contextId);
      } as typeof HTMLCanvasElement.prototype.getContext);

    render(<Viewport />);
    const renderCanvas = getRenderCanvas();

    expect(rafCallback).not.toBeNull();
    rafCallback?.(123);

    expect(videoEngineMocks.drawCurrentFrame).toHaveBeenCalledWith(renderContext, 1);
    expect(displayDrawImage).toHaveBeenCalledTimes(1);
    expect(displayDrawImage.mock.calls[0]?.[0]).toBe(renderCanvas);
  });

  it("falls back to a 480 display canvas when ResizeObserver is absent", () => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: undefined,
    });

    expect(() => render(<Viewport />)).not.toThrow();
    const displayCanvas = getDisplayCanvas();
    expect(displayCanvas.width).toBe(480);
    expect(displayCanvas.height).toBe(480);
  });

  it("keeps fullscreen presentation classes on the display canvas", () => {
    render(<Viewport />);
    const renderCanvas = getRenderCanvas();
    const displayCanvas = getDisplayCanvas();

    expect(displayCanvas).toHaveClass("ha-canvas");
    expect(displayCanvas).toHaveClass("ha-display-canvas");
    expect(renderCanvas).not.toHaveClass("ha-canvas");
  });

  it("passes audible Tone.immediate time into the draw loop", () => {
    render(<Viewport />);

    expect(rafCallback).not.toBeNull();
    rafCallback?.(123);

    expect(toneMocks.immediate).toHaveBeenCalledTimes(1);
    expect(toneMocks.now).not.toHaveBeenCalled();
    expect(videoEngineMocks.drawCurrentFrame).toHaveBeenCalledWith(expect.any(Object), 1);
  });

  it("idle: shows the gate; click calls requestMedia. Denied: swaps to blocked copy. Granted: gate gone, station mounted.", () => {
    // Idle.
    render(<Viewport />);
    fireEvent.click(screen.getByRole("button", { name: /enable camera & mic/i }));
    expect(requestMedia).toHaveBeenCalledTimes(1);
    cleanup();

    // Denied.
    act(() => {
      useAppStore.getState().actions.setMedia({ stream: null, status: "denied", error: "user blocked it" });
    });
    render(<Viewport />);
    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enable camera & mic/i })).not.toBeInTheDocument();
    cleanup();

    // Granted.
    act(() => {
      useAppStore.getState().actions.setMedia({ stream: {} as MediaStream, status: "granted", error: null });
    });
    render(<Viewport />);
    expect(screen.queryByRole("button", { name: /enable camera & mic/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("recording station")).toBeInTheDocument();
  });

  it("suppresses the permission gate while playback runs so the video stays visible", () => {
    // Deleting a clip on a fresh session reopens the station intent, and the
    // gate takes its place while media is idle. Playing the remaining clips
    // must not leave "Enable camera & mic" floating over the hard-cut video.
    render(<Viewport />);
    expect(screen.getByRole("button", { name: /enable camera & mic/i })).toBeInTheDocument();

    act(() => {
      useAppStore.getState().actions.setIsPlaying(true);
    });
    expect(screen.queryByRole("button", { name: /enable camera & mic/i })).not.toBeInTheDocument();

    act(() => {
      useAppStore.getState().actions.setIsPlaying(false);
    });
    expect(screen.getByRole("button", { name: /enable camera & mic/i })).toBeInTheDocument();
  });

  // The preview-stream release itself is pinned by RecordingStation's
  // unmount tests; this only pins that playback unmounts the station.
  it("unmounts the recording station while playback runs", () => {
    act(() => {
      useAppStore.getState().actions.setMedia({ stream: {} as MediaStream, status: "granted", error: null });
    });
    render(<Viewport />);
    expect(screen.getByLabelText("recording station")).toBeInTheDocument();

    act(() => {
      useAppStore.getState().actions.setIsPlaying(true);
    });
    expect(screen.queryByLabelText("recording station")).not.toBeInTheDocument();

    act(() => {
      useAppStore.getState().actions.setIsPlaying(false);
    });
    expect(screen.getByLabelText("recording station")).toBeInTheDocument();
  });

  it("hides the idle record prompt while playback runs", () => {
    act(() => {
      useAppStore.getState().actions.setMedia({ stream: {} as MediaStream, status: "granted", error: null });
      useAppStore.getState().actions.dismissRecordingStation();
    });
    render(<Viewport />);
    expect(screen.getByText(/record a sound on any track/i)).toBeInTheDocument();

    act(() => {
      useAppStore.getState().actions.setIsPlaying(true);
    });
    expect(screen.queryByText(/record a sound on any track/i)).not.toBeInTheDocument();
  });

  it("after the recording station is dismissed and no clips exist, shows an actionable first-record affordance", () => {
    act(() => {
      useAppStore.getState().actions.setMedia({ stream: {} as MediaStream, status: "granted", error: null });
      useAppStore.getState().actions.dismissRecordingStation();
    });
    render(<Viewport />);
    expect(screen.queryByLabelText("recording station")).not.toBeInTheDocument();
    expect(screen.getByText(/record a sound on any track/i)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /record first sound/i });
    fireEvent.click(button);
    expect(useAppStore.getState().session.recordingStationDismissed).toBe(false);
  });

  it("idle media + all tracks have clips + station dismissed: gate stays hidden and fullscreen toggle is visible", () => {
    act(() => {
      const setTrackClip = useAppStore.getState().actions.setTrackClip;
      for (let i = 0; i < 8; i++) {
        setTrackClip(i, {
          blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
          url: `blob:test/clip-${i}`,
          audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
          audioStatus: "ok",
          trimStartMs: 0,
          trimEndMs: 800,
          durationMs: 1000,
          posterBlob: null,
          posterUrl: null,
        });
      }
      useAppStore.getState().actions.dismissRecordingStation();
    });
    render(<Viewport />);
    expect(screen.queryByRole("button", { name: /enable camera & mic/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enter fullscreen/i })).toBeInTheDocument();
  });

  it("suspended: reconnect pill shows; permission gate does NOT show; clicking pill calls resumeMedia", async () => {
    act(() => {
      useAppStore.getState().actions.setMedia({
        stream: null,
        status: "suspended",
        error: null,
      });
    });
    render(<Viewport />);
    const pill = screen.getByRole("button", { name: /tap to reconnect/i });
    expect(pill).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enable camera & mic/i }),
    ).not.toBeInTheDocument();

    // resumeMedia is a real action that dynamic-imports media.ts;
    // we just verify the click handler is wired by spying on it.
    const spy = vi.spyOn(useAppStore.getState().actions, "resumeMedia");
    fireEvent.click(pill);
    expect(spy).toHaveBeenCalled();
    // Let the pill's pending state settle inside act — resumeMedia resolves
    // on a microtask and re-enables the button.
    await act(async () => {});
    spy.mockRestore();
  });

  it("suspended: reconnect pill is disabled while recording or acquiring media", () => {
    act(() => {
      useAppStore.getState().actions.setMedia({
        stream: null,
        status: "suspended",
        error: null,
      });
      useAppStore.getState().actions.setRecordingState("recording", 0);
    });
    render(<Viewport />);
    expect(screen.getByRole("button", { name: /tap to reconnect/i })).toBeDisabled();
    cleanup();

    act(() => {
      useAppStore.getState().actions.setRecordingState("idle", null);
      useAppStore.getState().actions.setMedia({
        stream: null,
        status: "suspended",
        error: null,
      });
    });
    isAcquireInFlight.mockReturnValue(true);
    render(<Viewport />);
    expect(screen.getByRole("button", { name: /tap to reconnect/i })).toBeDisabled();
  });

  it("suspended: clicking the reconnect pill disables it until the acquire settles", async () => {
    act(() => {
      useAppStore.getState().actions.setMedia({
        stream: null,
        status: "suspended",
        error: null,
      });
    });
    // resumeMedia resolves in both outcomes (it swallows acquire failures);
    // the store's media status carries the result.
    let settleResume!: () => void;
    let resumeGate = new Promise<void>((resolve) => {
      settleResume = resolve;
    });
    const spy = vi
      .spyOn(useAppStore.getState().actions, "resumeMedia")
      .mockImplementation(() => resumeGate);

    // Failure path: the acquire settles with the store still suspended — the
    // pill stays mounted and must re-enable.
    render(<Viewport />);
    const pill = screen.getByRole("button", { name: /tap to reconnect/i });
    expect(pill).not.toBeDisabled();

    fireEvent.click(pill);
    expect(pill).toBeDisabled();

    await act(async () => {
      settleResume();
      await resumeGate;
    });
    expect(screen.getByRole("button", { name: /tap to reconnect/i })).not.toBeDisabled();
    cleanup();

    // Success path: the acquire lands granted — the pill leaves the screen.
    resumeGate = new Promise<void>((resolve) => {
      settleResume = resolve;
    });
    render(<Viewport />);
    const secondPill = screen.getByRole("button", { name: /tap to reconnect/i });

    fireEvent.click(secondPill);
    expect(secondPill).toBeDisabled();

    await act(async () => {
      useAppStore.getState().actions.setMedia({
        stream: null,
        status: "granted",
        error: null,
      });
      settleResume();
      await resumeGate;
    });
    expect(
      screen.queryByRole("button", { name: /tap to reconnect/i }),
    ).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it('resume-required: audio pill shows exactly "Audio interrupted — tap to resume." and stacks with reconnect pill', () => {
    render(<Viewport />);
    expect(screen.queryByRole("button", { name: "Audio interrupted — tap to resume." })).not.toBeInTheDocument();
    cleanup();

    act(() => {
      useAppStore.getState().actions.setAudioState("resume-required");
      useAppStore.getState().actions.setMedia({
        stream: null,
        status: "suspended",
        error: null,
      });
    });
    render(<Viewport />);

    expect(screen.getByRole("button", { name: "Audio interrupted — tap to resume." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tap to reconnect/i })).toBeInTheDocument();
  });

  it("resume-required: tapping the audio pill resumes audio and hides it", async () => {
    act(() => {
      useAppStore.getState().actions.setAudioState("resume-required");
    });
    render(<Viewport />);

    fireEvent.click(screen.getByRole("button", { name: "Audio interrupted — tap to resume." }));

    expect(ensureAudioRunning).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Audio interrupted — tap to resume." })).not.toBeInTheDocument();
    });
  });

  it("resume-required: failed resume keeps the audio pill and shows the blocked hint", async () => {
    ensureAudioRunning.mockRejectedValueOnce(new Error("still blocked"));
    act(() => {
      useAppStore.getState().actions.setAudioState("resume-required");
    });
    render(<Viewport />);

    fireEvent.click(screen.getByRole("button", { name: "Audio interrupted — tap to resume." }));

    expect(ensureAudioRunning).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Still blocked — try the volume keys or reopen the app.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Audio interrupted — tap to resume." })).toBeInTheDocument();
  });

  it("idle media + some empty tracks + station dismissed: gate hidden, Record more pill is visible", () => {
    act(() => {
      useAppStore.getState().actions.setTrackClip(0, {
        blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
        url: "blob:test/clip-0",
        audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
        audioStatus: "ok",
        trimStartMs: 0,
        trimEndMs: 800,
        durationMs: 1000,
        posterBlob: null,
        posterUrl: null,
      });
      useAppStore.getState().actions.dismissRecordingStation();
    });
    render(<Viewport />);
    expect(screen.queryByRole("button", { name: /enable camera & mic/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record more/i })).toBeInTheDocument();
  });

  it("idle media + no clips + station dismissed: gate hidden until the first-record affordance is clicked", () => {
    act(() => {
      useAppStore.getState().actions.dismissRecordingStation();
    });
    render(<Viewport />);
    expect(screen.queryByRole("button", { name: /enable camera & mic/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /record first sound/i }));

    expect(screen.getByRole("button", { name: /enable camera & mic/i })).toBeInTheDocument();
  });
});
