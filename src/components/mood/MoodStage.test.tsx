// ABOUTME: MoodStage tests — pins Mood render/display canvas contracts.
// ABOUTME: Verifies active export-canvas registration and audio-clock paint loop wiring.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toneHarness, toneSpies } = await vi.hoisted(async () => {
  const { createToneHarness } = await import("../../test-utils/toneTestHarness");
  const toneHarness = createToneHarness();
  const toneModule = toneHarness.createToneModule();
  return {
    toneHarness,
    toneSpies: { immediate: vi.fn(() => toneModule.immediate()) },
  };
});

const moodRendererMocks = vi.hoisted(() => ({
  disposeMoodRenderer: vi.fn(),
  drawMoodFrame: vi.fn(),
  initMoodRenderer: vi.fn(),
}));

const moodRecordingFlowMocks = vi.hoisted(() => ({
  recordMoodTake: vi.fn(),
  stopMoodTakeEarly: vi.fn(),
}));

vi.mock("tone", () => {
  return {
    ...toneHarness.createToneModule(),
    immediate: toneSpies.immediate,
  };
});

vi.mock("../../lib/moodRenderer", () => moodRendererMocks);

vi.mock("../../lib/moodRecordingFlow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/moodRecordingFlow")>();
  return {
    ...actual,
    recordMoodTake: moodRecordingFlowMocks.recordMoodTake,
    stopMoodTakeEarly: moodRecordingFlowMocks.stopMoodTakeEarly,
  };
});

import { MoodStage } from "./MoodStage";
import * as moodStageModule from "./MoodStage";
import { getDisplayBackingSize } from "../../lib/canvasDraw";
import { STAGE_DESCRIPTORS } from "../../lib/moodStages";
import { getActiveCanvas, setActiveCanvas } from "../../lib/videoEngine";
import { useAppStore } from "../../store/useAppStore";
import type { MoodPiece, MoodStageId } from "../../types";
import { makeMoodPiece, makeMoodTake } from "../../test-utils/moodFixtures";

function makeSplitsPieceWithTake(takeId = "take-live"): MoodPiece {
  const piece = makeMoodPiece({ stage: "corners" });
  return {
    ...piece,
    lens: "splits",
    mics: piece.mics.map((mic, index) =>
      index === 0
        ? {
            ...mic,
            takes: [
              makeMoodTake({ id: takeId, durationSeconds: 1.5, trimEndMs: 1_500 }),
            ],
          }
        : mic,
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
    toneHarness.setImmediate(4.25);
    toneHarness.setLookahead(0);
    toneSpies.immediate.mockClear();
    moodRendererMocks.drawMoodFrame.mockReset();
    moodRendererMocks.disposeMoodRenderer.mockReset();
    moodRendererMocks.initMoodRenderer.mockReset();
    moodRecordingFlowMocks.recordMoodTake.mockReset();
    moodRecordingFlowMocks.stopMoodTakeEarly.mockReset();
    moodRecordingFlowMocks.stopMoodTakeEarly.mockReturnValue(true);
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
      const { container } = render(<MoodStage piece={makeMoodPiece({ stage })} />);
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

    const { container } = render(<MoodStage piece={makeMoodPiece({ stage: "row" })} />);
    const { displayCanvas } = renderCanvases(container);

    expect(displayCanvas.width).toBe(getDisplayBackingSize(427, 3));
    expect(displayCanvas.height).toBe(getDisplayBackingSize(240, 3));
  });

  it("clears the export canvas and disposes renderer resources on unmount", () => {
    const { container, unmount } = render(
      <MoodStage piece={makeMoodPiece({ stage: "corners" })} />,
    );
    const { renderCanvas } = renderCanvases(container);

    expect(getActiveCanvas()).toBe(renderCanvas);

    unmount();

    expect(getActiveCanvas()).toBeNull();
    expect(moodRendererMocks.disposeMoodRenderer).toHaveBeenCalledTimes(1);
  });

  it("initializes a fresh renderer after a disposed stage remount", () => {
    const first = render(<MoodStage piece={makeMoodPiece({ stage: "corners" })} />);
    first.unmount();

    const second = render(<MoodStage piece={makeMoodPiece({ stage: "row" })} />);
    const { renderCanvas } = renderCanvases(second.container);

    expect(moodRendererMocks.disposeMoodRenderer).toHaveBeenCalledTimes(1);
    expect(moodRendererMocks.initMoodRenderer).toHaveBeenNthCalledWith(1, expect.anything(), "corners");
    expect(moodRendererMocks.initMoodRenderer).toHaveBeenNthCalledWith(2, renderCanvas, "row");
    expect(getActiveCanvas()).toBe(renderCanvas);
  });

  it("announces stopped, performing, and recording from one polite stage live region", () => {
    const { container } = render(<MoodStage piece={makeMoodPiece({ stage: "row" })} />);
    const liveRegions = container.querySelectorAll('[aria-live="polite"]');
    expect(liveRegions).toHaveLength(1);
    expect(liveRegions[0]).toHaveClass("sr-only");
    expect(liveRegions[0]).toHaveTextContent("stopped");

    act(() => {
      useAppStore.getState().actions.setMoodPerforming(true, 4);
    });
    expect(liveRegions[0]).toHaveTextContent("performing");

    act(() => {
      useAppStore.getState().actions.setRecordingState("recording", 0);
    });
    expect(liveRegions[0]).toHaveTextContent("recording");

    act(() => {
      useAppStore.getState().actions.setRecordingState("idle", null);
      useAppStore.getState().actions.setMoodPerforming(false, 0);
    });
    expect(liveRegions[0]).toHaveTextContent("stopped");
  });

  it("paints from Tone.immediate and mirrors the render canvas every frame", () => {
    const { container } = render(<MoodStage piece={makeMoodPiece({ stage: "stack" })} />);
    const { renderCanvas, displayCanvas } = renderCanvases(container);
    const displayCtx = displayCanvas.getContext("2d") as unknown as {
      drawImage: ReturnType<typeof vi.fn>;
    };

    expect(rafCallback).not.toBeNull();
    rafCallback?.(123);

    expect(toneSpies.immediate).toHaveBeenCalledTimes(1);
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
    expect(
      moodRendererMocks.drawMoodFrame.mock.invocationCallOrder[0],
    ).toBeLessThan(displayCtx.drawImage.mock.invocationCallOrder[0]);
  });

  it("positions the count-in overlay over the hot mic tile", () => {
    const piece = makeMoodPiece({ stage: "corners" });
    useAppStore.getState().actions.setRecordingState("countdown", null);
    useAppStore.getState().actions.setCountdownEndsAt(6);
    useAppStore.getState().actions.setMoodHotMic("mic-2");

    render(<MoodStage piece={piece} />);

    // 1.75s remaining at a 90bpm count-in (0.667s beats) = 3 beats left.
    const overlay = screen.getByLabelText("Mood count-in for hot mic");
    expect(screen.getByTestId("mood-count-in-digit").textContent).toBe("3");
    expect(screen.getByTestId("mood-count-in-digit")).toHaveStyle({
      fontSize: "min(8rem, 58cqh)",
    });
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
    const piece = { ...makeMoodPiece({ stage: "corners" }), cycleSeconds: 16 };
    useAppStore.getState().actions.setRecordingState("countdown", null);
    useAppStore.getState().actions.setCountdownEndsAt(6);
    useAppStore.getState().actions.setMoodHotMic("mic-1");

    render(<MoodStage piece={piece} />);

    expect(screen.getByTestId("mood-count-in-digit").textContent).toBe("1");
    expect(screen.getByTestId("mood-count-in-digit")).toHaveClass(
      "text-orange-500",
      "mood-count-in-final",
    );
  });

  it.each(["countdown", "recording"] as const)(
    "adds the full-opacity capture border while %s",
    (recordingState) => {
      useAppStore.getState().actions.setRecordingState(recordingState, 0);

      render(<MoodStage piece={makeMoodPiece({ stage: "corners" })} />);

      expect(screen.getByLabelText("Corners stage")).toHaveClass(
        "border-4",
        "border-red-500",
      );
    },
  );

  it("keeps the capture border off while idle", () => {
    render(<MoodStage piece={makeMoodPiece({ stage: "corners" })} />);

    expect(screen.getByLabelText("Corners stage")).not.toHaveClass(
      "border-4",
      "border-red-500",
    );
  });

  it("keeps the tile scrim for countdown and removes it while recording", () => {
    useAppStore.getState().actions.setRecordingState("countdown", 0);
    useAppStore.getState().actions.setCountdownEndsAt(6);
    useAppStore.getState().actions.setMoodHotMic("mic-0");
    render(<MoodStage piece={makeMoodPiece({ stage: "corners" })} />);

    expect(screen.getByTestId("mood-capture-overlay")).toHaveClass("bg-black/55");

    act(() => {
      useAppStore.getState().actions.setRecordingState("recording", 0);
    });

    expect(screen.getByTestId("mood-capture-overlay")).not.toHaveClass("bg-black/55");
    expect(screen.getByTestId("mood-capture-overlay")).toHaveClass("bg-transparent");
  });

  it("turns the One's recording tile into the sole early-stop button", () => {
    useAppStore.getState().actions.setRecordingState("recording", 0);
    useAppStore.getState().actions.setCountdownEndsAt(4);
    useAppStore.getState().actions.setMoodHotMic("mic-0");
    render(<MoodStage piece={makeMoodPiece({ stage: "corners" })} />);

    const punchOut = screen.getByRole("button", {
      name: "Stop take — sets the loop",
    });
    expect(punchOut).toHaveClass("pointer-events-auto");
    expect(punchOut).toHaveTextContent("● REC 0.3s");
    expect(punchOut).toHaveTextContent("tap to stop · 2–8s feels best");

    fireEvent.click(punchOut);

    expect(moodRecordingFlowMocks.stopMoodTakeEarly).toHaveBeenCalledTimes(1);
  });

  it("disables the One punch-out and switches both capture chips to saving at the deadline", () => {
    toneHarness.setImmediate(8);
    useAppStore.getState().actions.setRecordingState("recording", 0);
    useAppStore.getState().actions.setCountdownEndsAt(4);
    useAppStore.getState().actions.setCaptureEndsAt(8);
    useAppStore.getState().actions.setMoodHotMic("mic-0");
    const { unmount } = render(<MoodStage piece={makeMoodPiece({ stage: "corners" })} />);

    const punchOut = screen.getByRole("button", {
      name: "Stop take — sets the loop",
    });
    expect(punchOut).toBeDisabled();
    expect(punchOut).toHaveTextContent("saving…");
    expect(punchOut).not.toHaveTextContent("tap to stop");

    unmount();
    const overdub = { ...makeMoodPiece({ stage: "corners" }), cycleSeconds: 2 };
    render(<MoodStage piece={overdub} />);
    expect(screen.getByTestId("mood-capture-overlay")).toHaveTextContent("saving…");
    expect(screen.getByTestId("mood-capture-overlay")).not.toHaveTextContent("● REC");
  });

  it("keeps an overdub recording overlay non-interactive and shows loop progress", () => {
    const piece = { ...makeMoodPiece({ stage: "corners" }), cycleSeconds: 2 };
    useAppStore.getState().actions.setRecordingState("recording", 0);
    useAppStore.getState().actions.setCountdownEndsAt(4);
    useAppStore.getState().actions.setCaptureEndsAt(12);
    useAppStore.getState().actions.setMoodHotMic("mic-0");
    render(<MoodStage piece={piece} />);

    expect(
      screen.queryByRole("button", { name: "Stop take — sets the loop" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("mood-capture-overlay")).toHaveClass(
      "pointer-events-none",
      "bg-transparent",
    );
    expect(screen.getByTestId("mood-capture-overlay")).toHaveTextContent(
      "● REC · loop 1 of 4",
    );
  });

  it("keeps the Solo capture overlay on the hot mic full-bleed", () => {
    const piece: MoodPiece = {
      ...makeMoodPiece({ stage: "corners" }),
      cycleSeconds: 2,
      lens: "solo",
    };
    useAppStore.getState().actions.setRecordingState("recording", 0);
    useAppStore.getState().actions.setMoodHotMic("mic-3");

    render(<MoodStage piece={piece} />);

    expect(screen.getByTestId("mood-capture-overlay")).toHaveStyle({
      left: "0%",
      top: "0%",
      width: "100%",
      height: "100%",
    });
  });

  it("shows the overdub join line and eight-beat strip before the final three beats", () => {
    const piece = { ...makeMoodPiece({ stage: "corners" }), cycleSeconds: 8 };
    useAppStore.getState().actions.setRecordingState("countdown", 0);
    useAppStore.getState().actions.setCountdownEndsAt(10);
    useAppStore.getState().actions.setMoodHotMic("mic-0");
    render(<MoodStage piece={piece} />);

    const strip = screen.getByTestId("mood-count-in-beat-strip");
    expect(screen.getByText("joins at the top of the loop")).toBeInTheDocument();
    expect(strip.children).toHaveLength(8);
    expect(strip.querySelectorAll(".bg-orange-500")).toHaveLength(2);
    expect(screen.queryByTestId("mood-count-in-digit")).not.toBeInTheDocument();
  });

  it("fills the overdub beat strip without wrapping long count-ins", () => {
    const filledOverdubBeatCount = (
      moodStageModule as typeof moodStageModule & {
        filledOverdubBeatCount?: (beatsRemaining: number) => number;
      }
    ).filledOverdubBeatCount;

    expect(filledOverdubBeatCount).toBeTypeOf("function");
    expect([9, 8, 7, 1].map((beats) => filledOverdubBeatCount?.(beats))).toEqual([
      0, 0, 1, 7,
    ]);
  });

  it("switches an overdub count-in to big digits for the final three beats", () => {
    const piece = { ...makeMoodPiece({ stage: "corners" }), cycleSeconds: 8 };
    useAppStore.getState().actions.setRecordingState("countdown", 0);
    useAppStore.getState().actions.setCountdownEndsAt(6);
    useAppStore.getState().actions.setMoodHotMic("mic-0");
    render(<MoodStage piece={piece} />);

    expect(screen.getByTestId("mood-count-in-digit")).toHaveTextContent("2");
    expect(screen.queryByText("joins at the top of the loop")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mood-count-in-beat-strip")).not.toBeInTheDocument();
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

  it("renders the zero-live boundary pulse for Solo", () => {
    const piece: MoodPiece = { ...makeSplitsPieceWithTake(), lens: "solo" };

    render(<MoodStage piece={piece} />);

    expect(screen.getByTestId("mood-splits-zero-live")).toBeInTheDocument();
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
    const piece: MoodPiece = {
      ...makeMoodPiece({ stage: "corners" }),
      lens: "splits",
    };

    render(<MoodStage piece={piece} />);

    expect(screen.getByRole("button", { name: "record the One" })).toBeInTheDocument();
    expect(screen.queryByTestId("mood-splits-zero-live")).not.toBeInTheDocument();
  });
});
