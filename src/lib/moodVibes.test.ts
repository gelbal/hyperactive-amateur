// ABOUTME: moodVibes tests — pins Mood full-frame vibe pass behavior.
// ABOUTME: Covers identity fallbacks and Blocks offscreen resource reuse.
import colors from "tailwindcss/colors";
import { afterEach, describe, expect, it } from "vitest";

import { applyVibe, initVibeResources, setPrintDensity } from "./moodVibes";
import { CAMCORDER, MIXTAPE, PRINT } from "./moodVibePalettes";
import { STAGE_DESCRIPTORS } from "./moodStages";
import type { MoodStageId, MoodVibeId } from "../types";

type CanvasCall = {
  method: string;
  args: unknown[];
  fillStyle: unknown;
  globalAlpha: number;
  globalCompositeOperation: string;
};

type RecordedContext = CanvasRenderingContext2D & {
  __haCanvasCalls: CanvasCall[];
};

function renderContext(stage: MoodStageId = "corners"): {
  canvas: HTMLCanvasElement;
  ctx: RecordedContext;
} {
  const descriptor = STAGE_DESCRIPTORS[stage];
  const canvas = document.createElement("canvas");
  canvas.width = descriptor.canvasSize.w;
  canvas.height = descriptor.canvasSize.h;
  return {
    canvas,
    ctx: canvas.getContext("2d") as RecordedContext,
  };
}

function drawImageCalls(ctx: RecordedContext): CanvasCall[] {
  return ctx.__haCanvasCalls.filter((call) => call.method === "drawImage");
}

describe("moodVibes", () => {
  afterEach(() => {
    setPrintDensity("normal");
  });

  it("keeps Clean as an identity pass", () => {
    const { canvas, ctx } = renderContext();
    const resources = initVibeResources("corners");

    applyVibe(ctx, canvas, "clean", resources);

    expect(ctx.__haCanvasCalls).toEqual([]);
  });

  it("draws Print as one tiny readback and one batched dot fill", () => {
    const { canvas, ctx } = renderContext("corners");
    const resources = initVibeResources("corners");
    const lattice = resources.print.normal;
    const latticeCtx = lattice.ctx as RecordedContext;

    applyVibe(ctx, canvas, "print", resources);

    // One downsample into the lattice offscreen, one tiny readback.
    const sampleDraws = drawImageCalls(latticeCtx);
    expect(sampleDraws).toHaveLength(1);
    expect(sampleDraws[0].args[0]).toBe(canvas);
    const readbacks = latticeCtx.__haCanvasCalls.filter(
      (call) => call.method === "getImageData",
    );
    expect(readbacks).toHaveLength(1);
    expect(readbacks[0].args).toEqual([0, 0, lattice.canvas.width, lattice.canvas.height]);

    // Paper field first, then ONE batched path of dots with ONE ink fill.
    const fillRects = ctx.__haCanvasCalls.filter((call) => call.method === "fillRect");
    expect(fillRects).toHaveLength(1);
    expect(fillRects[0]).toMatchObject({
      args: [0, 0, canvas.width, canvas.height],
      fillStyle: PRINT.paper,
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
    });
    const byMethod = (method: string) =>
      ctx.__haCanvasCalls.filter((call) => call.method === method);
    expect(byMethod("beginPath")).toHaveLength(1);
    const arcs = byMethod("arc");
    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs.length).toBeLessThanOrEqual(
      lattice.canvas.width * lattice.canvas.height,
    );
    expect(byMethod("moveTo")).toHaveLength(arcs.length);
    const fills = byMethod("fill");
    expect(fills).toHaveLength(1);
    expect(fills[0].fillStyle).toBe(PRINT.ink);
    expect(ctx.__haCanvasCalls.indexOf(fillRects[0])).toBeLessThan(
      ctx.__haCanvasCalls.indexOf(fills[0]),
    );
  });

  it("precomputes lattice geometry per density and stage shape", () => {
    const corners = initVibeResources("corners").print;
    expect([corners.normal.canvas.width, corners.normal.canvas.height]).toEqual([48, 48]);
    expect([corners.degraded.canvas.width, corners.degraded.canvas.height]).toEqual([
      32, 32,
    ]);

    const row = initVibeResources("row").print;
    expect([row.normal.canvas.width, row.normal.canvas.height]).toEqual([48, 27]);
    expect([row.degraded.canvas.width, row.degraded.canvas.height]).toEqual([32, 18]);

    const stack = initVibeResources("stack").print;
    expect([stack.normal.canvas.width, stack.normal.canvas.height]).toEqual([27, 48]);
    expect([stack.degraded.canvas.width, stack.degraded.canvas.height]).toEqual([18, 32]);

    expect(corners.normal.centers).toHaveLength(48 * 48 * 2);
    expect(corners.degraded.centers).toHaveLength(32 * 32 * 2);
  });

  it("switches the lattice with the degrade knob for the session", () => {
    const { canvas, ctx } = renderContext("corners");
    const resources = initVibeResources("corners");
    const normalCtx = resources.print.normal.ctx as RecordedContext;
    const degradedCtx = resources.print.degraded.ctx as RecordedContext;

    setPrintDensity("degraded");
    applyVibe(ctx, canvas, "print", resources);

    expect(drawImageCalls(degradedCtx)).toHaveLength(1);
    expect(drawImageCalls(normalCtx)).toHaveLength(0);
  });

  it("reuses Print resources across frames", () => {
    const { canvas, ctx } = renderContext("corners");
    const resources = initVibeResources("corners");
    const print = resources.print;
    const normalCanvas = print.normal.canvas;
    const centers = print.normal.centers;

    applyVibe(ctx, canvas, "print", resources);
    applyVibe(ctx, canvas, "print", resources);

    expect(resources.print).toBe(print);
    expect(resources.print.normal.canvas).toBe(normalCanvas);
    expect(resources.print.normal.centers).toBe(centers);
  });

  it("pulls fixed Mixtape, Camcorder, and Print palettes from Tailwind defaults", () => {
    expect(PRINT).toEqual({
      paper: colors.stone[100],
      ink: colors.stone[900],
    });
    expect(MIXTAPE).toEqual({
      shadow: colors.zinc[950],
      highlight: colors.orange[500],
    });
    expect(CAMCORDER).toEqual({
      scanlineAlpha: 0.22,
      chromaAlpha: 0.22,
      chromaOffsetPx: 2,
      chromaLeft: colors.cyan[400],
      chromaRight: colors.red[500],
      noiseAlpha: 0.08,
      noiseTileSize: 64,
    });
  });

  it("draws Blocks through one persistent tiny canvas per renderer resource bundle", () => {
    const stage: MoodStageId = "corners";
    const descriptor = STAGE_DESCRIPTORS[stage];
    const { canvas, ctx } = renderContext(stage);
    const resources = initVibeResources(stage);
    const blocksCanvas = resources.blocks.canvas;
    const blocksCtx = resources.blocks.ctx as RecordedContext;

    expect(blocksCanvas.width).toBe(Math.max(1, Math.round(descriptor.canvasSize.w / 12)));
    expect(blocksCanvas.height).toBe(Math.max(1, Math.round(descriptor.canvasSize.h / 12)));

    applyVibe(ctx, canvas, "blocks", resources);
    applyVibe(ctx, canvas, "blocks", resources);

    expect(resources.blocks.canvas).toBe(blocksCanvas);
    expect(drawImageCalls(blocksCtx).map((call) => call.args[0])).toEqual([
      canvas,
      canvas,
    ]);
    expect(drawImageCalls(ctx).map((call) => call.args[0])).toEqual([
      blocksCanvas,
      blocksCanvas,
    ]);
    expect(ctx.imageSmoothingEnabled).toBe(true);
  });

  it("draws Mixtape as a desaturated orange-on-zinc duotone", () => {
    const { canvas, ctx } = renderContext("row");
    const resources = initVibeResources("row");

    applyVibe(ctx, canvas, "mixtape", resources);

    expect(ctx.__haCanvasCalls).toEqual([
      expect.objectContaining({
        method: "beginPath",
        args: [],
        globalCompositeOperation: "source-over",
      }),
      expect.objectContaining({
        method: "rect",
        args: [0, 0, canvas.width, canvas.height],
        globalCompositeOperation: "source-over",
      }),
      expect.objectContaining({
        method: "clip",
        args: [],
        globalCompositeOperation: "source-over",
      }),
      expect.objectContaining({
        method: "fillRect",
        args: [0, 0, canvas.width, canvas.height],
        fillStyle: "#000",
        globalAlpha: 1,
        globalCompositeOperation: "saturation",
      }),
      // Duotone ramp: multiply keys the BRIGHTS to the highlight color,
      // then the screen floor lifts the DARKS to the shadow color. The
      // reverse order crushes the frame to a flat highlight wash
      // (multiply by near-black zinc-950 leaves <5% detail for the
      // full-alpha orange screen to bury).
      expect.objectContaining({
        method: "fillRect",
        args: [0, 0, canvas.width, canvas.height],
        fillStyle: colors.orange[500],
        globalAlpha: 1,
        globalCompositeOperation: "multiply",
      }),
      expect.objectContaining({
        method: "fillRect",
        args: [0, 0, canvas.width, canvas.height],
        fillStyle: colors.zinc[950],
        globalAlpha: 1,
        globalCompositeOperation: "screen",
      }),
    ]);
    expect(ctx.globalCompositeOperation).toBe("source-over");
    expect(ctx.globalAlpha).toBe(1);
  });

  it("draws Camcorder with scanlines, chroma split, and cycling noise", () => {
    const { canvas, ctx } = renderContext("corners");
    const resources = initVibeResources("corners");
    const camcorder = resources.camcorder;
    const frameCtx = camcorder.frameCtx as RecordedContext;

    applyVibe(ctx, canvas, "camcorder", resources);

    expect(drawImageCalls(frameCtx).map((call) => call.args[0])).toEqual([canvas]);
    expect(ctx.__haCanvasCalls).toEqual([
      expect.objectContaining({ method: "beginPath", args: [] }),
      expect.objectContaining({ method: "rect", args: [0, 0, canvas.width, canvas.height] }),
      expect.objectContaining({ method: "clip", args: [] }),
      expect.objectContaining({
        method: "fillRect",
        args: [0, 0, canvas.width, canvas.height],
        fillStyle: camcorder.scanlinePattern,
        globalAlpha: 0.22,
        globalCompositeOperation: "multiply",
      }),
      expect.objectContaining({
        method: "drawImage",
        args: [camcorder.tintCanvas, -2, 0, canvas.width, canvas.height],
        globalAlpha: 0.22,
        globalCompositeOperation: "screen",
      }),
      expect.objectContaining({
        method: "drawImage",
        args: [camcorder.tintCanvas, 2, 0, canvas.width, canvas.height],
        globalAlpha: 0.22,
        globalCompositeOperation: "screen",
      }),
      expect.objectContaining({
        method: "fillRect",
        args: [0, 0, canvas.width, canvas.height],
        fillStyle: camcorder.noisePatterns[0],
        globalAlpha: 0.08,
        globalCompositeOperation: "overlay",
      }),
    ]);
    expect(ctx.globalCompositeOperation).toBe("source-over");
    expect(ctx.globalAlpha).toBe(1);

    // The chroma ghosts must be tinted COPIES (multiply keeps luminance);
    // tinting the main canvas after a screen draw would wash the whole
    // frame instead of fringing the offset edges.
    const tintCtx = camcorder.tintCtx as RecordedContext;
    expect(
      tintCtx.__haCanvasCalls.map((call) => [
        call.method,
        call.method === "drawImage" ? call.args[0] : call.fillStyle,
        call.globalCompositeOperation,
      ]),
    ).toEqual([
      ["drawImage", camcorder.frameCanvas, "source-over"],
      ["fillRect", colors.cyan[400], "multiply"],
      ["drawImage", camcorder.frameCanvas, "source-over"],
      ["fillRect", colors.red[500], "multiply"],
    ]);
  });

  it("reuses Mixtape and Camcorder resources across frames", () => {
    const { canvas, ctx } = renderContext("row");
    const resources = initVibeResources("row");
    const mixtape = resources.mixtape;
    const camcorder = resources.camcorder;
    const frameCanvas = camcorder.frameCanvas;
    const tintCanvas = camcorder.tintCanvas;
    const scanlinePattern = camcorder.scanlinePattern;
    const noiseTiles = camcorder.noiseTiles;
    const noisePatterns = camcorder.noisePatterns;

    applyVibe(ctx, canvas, "mixtape", resources);
    applyVibe(ctx, canvas, "mixtape", resources);

    expect(resources.mixtape).toBe(mixtape);

    ctx.__haCanvasCalls.length = 0;
    applyVibe(ctx, canvas, "camcorder", resources);
    applyVibe(ctx, canvas, "camcorder", resources);

    expect(resources.camcorder).toBe(camcorder);
    expect(resources.camcorder.frameCanvas).toBe(frameCanvas);
    expect(resources.camcorder.tintCanvas).toBe(tintCanvas);
    expect(resources.camcorder.scanlinePattern).toBe(scanlinePattern);
    expect(resources.camcorder.noiseTiles).toBe(noiseTiles);
    expect(resources.camcorder.noisePatterns).toBe(noisePatterns);
    expect(resources.camcorder.noiseTiles[0]).toBe(noiseTiles[0]);
    expect(resources.camcorder.noisePatterns[0]).toBe(noisePatterns[0]);
    expect(resources.camcorder.frameCounter).toBe(2);
    expect(
      ctx.__haCanvasCalls
        .filter((call) => call.globalCompositeOperation === "overlay")
        .map((call) => call.fillStyle),
    ).toEqual([noisePatterns[0], noisePatterns[1]]);
  });

  it("dispatches every spec vibe id without throwing", () => {
    const allVibes: MoodVibeId[] = ["clean", "blocks", "mixtape", "camcorder", "print"];
    const { canvas, ctx } = renderContext("row");
    const resources = initVibeResources("row");

    for (const vibe of allVibes) {
      applyVibe(ctx, canvas, vibe, resources);
    }

    // toBe, not toEqual: two blank canvases of the same size are
    // structurally equal, so toEqual cannot tell tint from snapshot.
    const sources = drawImageCalls(ctx).map((call) => call.args[0]);
    expect(sources).toHaveLength(3);
    expect(sources[0]).toBe(resources.blocks.canvas);
    expect(sources[1]).toBe(resources.camcorder.tintCanvas);
    expect(sources[2]).toBe(resources.camcorder.tintCanvas);
  });
});
