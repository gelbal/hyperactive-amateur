// ABOUTME: MoodStage tests — pins Mood render/display canvas contracts.
// ABOUTME: Verifies active export-canvas registration and audio-clock paint loop wiring.
import { cleanup, render } from "@testing-library/react";
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
import type { MoodPiece, MoodStageId } from "../../types";

function makePiece(stage: MoodStageId): MoodPiece {
  return createEmptyMoodPiece(stage, "pocket");
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
});
