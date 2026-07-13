// ABOUTME: MoodStage tests — pins Mood render/display canvas contracts.
// ABOUTME: Verifies active export-canvas registration and audio-clock paint loop wiring.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toneMocks = vi.hoisted(() => ({
  immediate: vi.fn(() => 4.25),
}));

const moodRendererMocks = vi.hoisted(() => ({
  drawMoodFrame: vi.fn(),
  initMoodRenderer: vi.fn(),
}));

vi.mock("tone", () => ({
  immediate: toneMocks.immediate,
}));

vi.mock("../../lib/moodRenderer", () => moodRendererMocks);

import { MoodStage } from "./MoodStage";
import { getDisplayBackingSize } from "../../lib/canvasDraw";
import { STAGE_DESCRIPTORS, createEmptyMoodPiece } from "../../lib/moodStages";
import { getActiveCanvas, setActiveCanvas } from "../../lib/videoEngine";
import { useAppStore } from "../../store/useAppStore";
import type { MoodPiece, MoodStageId, MoodTake } from "../../types";

function makePiece(stage: MoodStageId): MoodPiece {
  return createEmptyMoodPiece(stage, "pocket");
}

function makeTake(id = "take-live"): MoodTake {
  return {
    id,
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    audioBlob: null,
    posterBlob: null,
    url: `blob:test/${id}`,
    audioBuffer: { duration: 1.5, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    posterUrl: null,
    trimStartMs: 0,
    trimEndMs: 1500,
    durationSeconds: 1.5,
    cycleMultiple: 1,
    syncOffsetMs: 0,
    part: null,
    partSource: null,
    recordedAt: 1,
  };
}

function makeSplitsPieceWithTake(takeId = "take-live"): MoodPiece {
  const piece = makePiece("corners");
  return {
    ...piece,
    lens: "splits",
    mics: piece.mics.map((mic, index) =>
      index === 0 ? { ...mic, takes: [makeTake(takeId)] } : mic,
    ),
  };
}

describe("MoodStage", () => {
  let rafCallback: FrameRequestCallback | null = null;
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn> | null = null;
  let cancelAnimationFrameSpy: ReturnType<typeof vi.spyOn> | null = null;
  const originalDevicePixelRatio = window.devicePixelRatio;
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    rafCallback = null;
    requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        rafCallback = callback;
        return 101;
      });
    cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    toneMocks.immediate.mockClear();
    toneMocks.immediate.mockReturnValue(4.25);
    moodRendererMocks.drawMoodFrame.mockReset();
    moodRendererMocks.initMoodRenderer.mockReset();
    setActiveCanvas(null);
    useAppStore.getState().actions.reset();
  });

  afterEach(() => {
    cleanup();
    setActiveCanvas(null);
    requestAnimationFrameSpy?.mockRestore();
    cancelAnimationFrameSpy?.mockRestore();
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

  function setDevicePixelRatio(value: number): void {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value,
    });
  }

  function installResizeObserver(cssW: number, cssH: number): void {
    class StubResizeObserver implements ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element): void {
        this.callback(
          [
            {
              target,
              contentRect: {
                width: cssW,
                height: cssH,
              },
            } as ResizeObserverEntry,
          ],
          this,
        );
      }

      unobserve(): void {}

      disconnect(): void {}
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

  function renderCanvases(container: HTMLElement): {
    renderCanvas: HTMLCanvasElement;
    displayCanvas: HTMLCanvasElement;
  } {
    const renderCanvas = container.querySelector(
      ".ha-mood-render-canvas",
    ) as HTMLCanvasElement | null;
    const displayCanvas = container.querySelector(
      ".ha-mood-display-canvas",
    ) as HTMLCanvasElement | null;
    expect(renderCanvas).toBeInTheDocument();
    expect(displayCanvas).toBeInTheDocument();
    return {
      renderCanvas: renderCanvas as HTMLCanvasElement,
      displayCanvas: displayCanvas as HTMLCanvasElement,
    };
  }

  it.each(Object.keys(STAGE_DESCRIPTORS) as MoodStageId[])(
    "keeps the %s render canvas backing store on the stage descriptor",
    (stage) => {
      const { container } = render(<MoodStage piece={makePiece(stage)} />);
      const { renderCanvas } = renderCanvases(container);
      const descriptor = STAGE_DESCRIPTORS[stage];

      expect(renderCanvas.width).toBe(descriptor.canvasSize.w);
      expect(renderCanvas.height).toBe(descriptor.canvasSize.h);
      expect(renderCanvas).toHaveAttribute("aria-hidden", "true");
      expect(renderCanvas.style.opacity).toBe("0");
      expect(moodRendererMocks.initMoodRenderer).toHaveBeenCalledWith(
        renderCanvas,
        stage,
      );
    },
  );

  it("sizes the display canvas through the shared DPR helper", () => {
    setDevicePixelRatio(3);
    installResizeObserver(427, 240);

    const { container } = render(<MoodStage piece={makePiece("row")} />);
    const { displayCanvas } = renderCanvases(container);

    expect(displayCanvas.width).toBe(getDisplayBackingSize(427, 3));
    expect(displayCanvas.height).toBe(getDisplayBackingSize(240, 3));
  });

  it("registers the render canvas for export and clears it on unmount", () => {
    const { container, unmount } = render(<MoodStage piece={makePiece("corners")} />);
    const { renderCanvas } = renderCanvases(container);

    expect(getActiveCanvas()).toBe(renderCanvas);

    unmount();

    expect(getActiveCanvas()).toBeNull();
  });

  it("paints from Tone.immediate and mirrors the render canvas every frame", () => {
    const { container } = render(<MoodStage piece={makePiece("stack")} />);
    const { renderCanvas, displayCanvas } = renderCanvases(container);
    const displayCtx = displayCanvas.getContext("2d") as unknown as {
      drawImage: ReturnType<typeof vi.fn>;
    };

    expect(rafCallback).not.toBeNull();
    rafCallback?.(123);

    expect(toneMocks.immediate).toHaveBeenCalledTimes(1);
    expect(moodRendererMocks.drawMoodFrame).toHaveBeenCalledWith(
      4.25,
      expect.objectContaining({
        piece: expect.objectContaining({ stage: "stack" }),
        performance: expect.any(Object),
      }),
    );
    expect(displayCtx.drawImage).toHaveBeenCalledWith(
      renderCanvas,
      0,
      0,
      displayCanvas.width,
      displayCanvas.height,
    );
  });

  it("positions the count-in overlay over the hot mic tile", () => {
    const piece = makePiece("corners");
    useAppStore.getState().actions.setRecordingState("countdown", null);
    useAppStore.getState().actions.setCountdownEndsAt(6);
    useAppStore.getState().actions.setMoodHotMic("mic-2");

    render(<MoodStage piece={piece} />);

    // 1.75s remaining at a 90bpm count-in (0.667s beats) = 3 beats left.
    const overlay = screen.getByLabelText("Mood count-in for hot mic");
    expect(screen.getByTestId("mood-count-in-digit").textContent).toBe("3");
    expect(overlay).toHaveStyle({
      left: "0%",
      top: "50%",
      width: "50%",
      height: "50%",
    });
  });

  it("counts down in beats, not seconds, so digits match the audible ticks", () => {
    // Overdub branch: cycle 16 → beat = 2s. 1.75s remaining = the LAST beat,
    // so the digit must read 1 even though nearly 2 wall seconds remain.
    const piece = { ...makePiece("corners"), cycleSeconds: 16 };
    useAppStore.getState().actions.setRecordingState("countdown", null);
    useAppStore.getState().actions.setCountdownEndsAt(6);
    useAppStore.getState().actions.setMoodHotMic("mic-1");

    render(<MoodStage piece={piece} />);

    expect(screen.getByTestId("mood-count-in-digit").textContent).toBe("1");
  });

  it("renders the Splits zero-live state as a cycle-driven DOM boundary pulse", () => {
    const piece = makeSplitsPieceWithTake();

    render(<MoodStage piece={piece} />);

    expect(screen.getByTestId("mood-splits-zero-live")).toHaveAttribute(
      "data-cycle",
      "0",
    );

    act(() => {
      useAppStore.getState().actions.setMoodCycleCount(4);
    });

    expect(screen.getByTestId("mood-splits-zero-live")).toHaveAttribute(
      "data-cycle",
      "4",
    );
  });

  it("hides the Splits zero-live overlay when a valid live selection exists", () => {
    const piece = makeSplitsPieceWithTake();
    useAppStore.setState((state) => ({
      mood: {
        ...state.mood,
        performance: {
          ...state.mood.performance,
          selections: {
            ...state.mood.performance.selections,
            "mic-0": "take-live",
          },
        },
      },
    }));

    render(<MoodStage piece={piece} />);

    expect(screen.queryByTestId("mood-splits-zero-live")).not.toBeInTheDocument();
  });

  it.each(["preparing", "countdown", "recording"] as const)(
    "hides the Splits zero-live overlay while capture is %s",
    (recordingState) => {
      useAppStore.getState().actions.setRecordingState(recordingState, 0);

      render(<MoodStage piece={makeSplitsPieceWithTake()} />);

      expect(screen.queryByTestId("mood-splits-zero-live")).not.toBeInTheDocument();
    },
  );

  it("shows the Splits zero-live overlay when the only selection is a ghost take id", () => {
    const piece = makeSplitsPieceWithTake();
    useAppStore.setState((state) => ({
      mood: {
        ...state.mood,
        performance: {
          ...state.mood.performance,
          selections: {
            ...state.mood.performance.selections,
            "mic-0": "ghost-take",
          },
        },
      },
    }));

    render(<MoodStage piece={piece} />);

    expect(screen.getByTestId("mood-splits-zero-live")).toBeInTheDocument();
  });

  it("shows only the invitation for a fresh Splits piece with no takes", () => {
    const piece: MoodPiece = { ...makePiece("corners"), lens: "splits" };

    render(<MoodStage piece={piece} />);

    expect(screen.getByRole("button", { name: "record the One" })).toBeInTheDocument();
    expect(screen.queryByTestId("mood-splits-zero-live")).not.toBeInTheDocument();
  });
});
