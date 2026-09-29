// ABOUTME: moodVibes tests — pins Mood full-frame vibe pass behavior.
// ABOUTME: Covers identity fallbacks and Blocks offscreen resource reuse.
import colors from "tailwindcss/colors";
import { afterEach, describe, expect, it } from "vitest";

import { applyVibe, initVibeResources, setPrintDensity } from "./moodVibes";
import {
  CAMCORDER,
  CAMCORDER_NOISE_HOLD_SECONDS,
  CROSSROLL,
  GHOST,
  MIXTAPE,
  PRINT,
  SOLAR,
  WEAVE,
} from "./moodVibePalettes";
import { STAGE_DESCRIPTORS } from "./moodStages";
import { MOOD_VIBE_IDS, type MoodStageId } from "../types";

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
    expect([corners.normal.canvas.width, corners.normal.canvas.height]).toEqual([128, 128]);
    expect([corners.degraded.canvas.width, corners.degraded.canvas.height]).toEqual([
      84, 84,
    ]);

    const row = initVibeResources("row").print;
    expect([row.normal.canvas.width, row.normal.canvas.height]).toEqual([128, 72]);
    expect([row.degraded.canvas.width, row.degraded.canvas.height]).toEqual([84, 47]);

    const stack = initVibeResources("stack").print;
    expect([stack.normal.canvas.width, stack.normal.canvas.height]).toEqual([72, 128]);
    expect([stack.degraded.canvas.width, stack.degraded.canvas.height]).toEqual([47, 84]);

    expect(corners.normal.centers).toHaveLength(128 * 128 * 2);
    expect(corners.degraded.centers).toHaveLength(84 * 84 * 2);
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

  it("pulls fixed Mixtape, Camcorder, Print, Ghost, and Solar tuning from Tailwind defaults", () => {
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
    expect(GHOST).toEqual({
      echoAlphas: [0.22, 0.14, 0.08],
      feedbackAlpha: 0.72,
    });
    expect(SOLAR).toEqual({
      pale: colors.white,
      orange: colors.orange[500],
      zinc: colors.zinc[950],
      orangeAlpha: 0.8,
      zincAlpha: 0.45,
    });
    expect(WEAVE).toMatchObject({
      wash: colors.amber[200],
      gate: colors.stone[950],
      scratch: colors.stone[200],
    });
    expect(CROSSROLL).toMatchObject({
      bar: colors.zinc[950],
      sprocket: colors.white,
      seamHeightPx: 24,
    });
  });

  it("draws Blocks through one persistent tiny canvas per renderer resource bundle", () => {
    const stage: MoodStageId = "corners";
    const descriptor = STAGE_DESCRIPTORS[stage];
    const { canvas, ctx } = renderContext(stage);
    const resources = initVibeResources(stage);
    const blocksCanvas = resources.blocks.canvas;
    const blocksCtx = resources.blocks.ctx as RecordedContext;

    expect(blocksCanvas.width).toBe(Math.max(1, Math.round(descriptor.canvasSize.w / 6)));
    expect(blocksCanvas.height).toBe(Math.max(1, Math.round(descriptor.canvasSize.h / 6)));

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

  it("reuses Mixtape and Camcorder resources across audio-clock frames", () => {
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
    applyVibe(ctx, canvas, "camcorder", resources, 2);
    applyVibe(ctx, canvas, "camcorder", resources, 2);

    expect(resources.camcorder).toBe(camcorder);
    expect(resources.camcorder.frameCanvas).toBe(frameCanvas);
    expect(resources.camcorder.tintCanvas).toBe(tintCanvas);
    expect(resources.camcorder.scanlinePattern).toBe(scanlinePattern);
    expect(resources.camcorder.noiseTiles).toBe(noiseTiles);
    expect(resources.camcorder.noisePatterns).toBe(noisePatterns);
    expect(resources.camcorder.noiseTiles[0]).toBe(noiseTiles[0]);
    expect(resources.camcorder.noisePatterns[0]).toBe(noisePatterns[0]);
    expect(
      ctx.__haCanvasCalls
        .filter((call) => call.globalCompositeOperation === "overlay")
        .map((call) => noisePatterns.indexOf(call.fillStyle as CanvasPattern)),
    ).toEqual([2, 2]);
  });

  it("steps Camcorder noise on a fifteen-hertz audio-clock hold", () => {
    const { canvas, ctx } = renderContext("row");
    const resources = initVibeResources("row");

    expect(CAMCORDER_NOISE_HOLD_SECONDS).toBeCloseTo(1 / 15);
    for (const audioTime of [
      0,
      CAMCORDER_NOISE_HOLD_SECONDS - 0.001,
      CAMCORDER_NOISE_HOLD_SECONDS + 0.001,
      CAMCORDER_NOISE_HOLD_SECONDS * 2 - 0.001,
      CAMCORDER_NOISE_HOLD_SECONDS * 2 + 0.001,
    ]) {
      applyVibe(ctx, canvas, "camcorder", resources, audioTime);
    }

    expect(
      ctx.__haCanvasCalls
        .filter((call) => call.globalCompositeOperation === "overlay")
        .map((call) =>
          resources.camcorder.noisePatterns.indexOf(call.fillStyle as CanvasPattern),
        ),
    ).toEqual([0, 0, 1, 1, 2]);
  });

  it("selects identical Camcorder noise at matching times across 30Hz and 120Hz paints", () => {
    const { canvas, ctx } = renderContext("row");
    const resources = initVibeResources("row");
    const noiseAtEndOfPattern = (paintTimes: number[]) => {
      ctx.__haCanvasCalls.length = 0;
      for (const audioTime of paintTimes) {
        applyVibe(ctx, canvas, "camcorder", resources, audioTime);
      }
      const fillStyle = ctx.__haCanvasCalls
        .filter((call) => call.globalCompositeOperation === "overlay")
        .at(-1)?.fillStyle;
      return resources.camcorder.noisePatterns.indexOf(fillStyle as CanvasPattern);
    };

    const at30Hz = noiseAtEndOfPattern([0, 1 / 30, 2 / 30, 3 / 30, 4 / 30, 0.2]);
    const at120Hz = noiseAtEndOfPattern([
      ...Array.from({ length: 24 }, (_, index) => index / 120),
      0.2,
    ]);

    expect(at30Hz).toBe(3);
    expect(at120Hz).toBe(at30Hz);
  });

  it("draws Kaleido from one persistent snapshot with four flipped quadrants", () => {
    const { canvas, ctx } = renderContext("row");
    const resources = initVibeResources("row");
    const kaleido = resources.kaleido;
    const snapshotCanvas = kaleido.snapshotCanvas;
    const snapshotCtx = kaleido.snapshotCtx as RecordedContext;
    const halfWidth = canvas.width / 2;
    const halfHeight = canvas.height / 2;

    // No established beat grid uses a fixed top-left source quadrant.
    applyVibe(ctx, canvas, "kaleido", resources, 8.25, 0, null);
    // Beat one jumps the source quadrant to top-right, using audio time only.
    applyVibe(ctx, canvas, "kaleido", resources, 1.25, 0, 1);

    expect(resources.kaleido).toBe(kaleido);
    expect(resources.kaleido.snapshotCanvas).toBe(snapshotCanvas);
    expect(drawImageCalls(snapshotCtx).map((call) => call.args[0])).toEqual([
      canvas,
      canvas,
    ]);
    expect(drawImageCalls(ctx).map((call) => call.args)).toEqual([
      ...Array.from({ length: 4 }, () => [
        snapshotCanvas,
        0,
        0,
        halfWidth,
        halfHeight,
        0,
        0,
        halfWidth,
        halfHeight,
      ]),
      ...Array.from({ length: 4 }, () => [
        snapshotCanvas,
        halfWidth,
        0,
        halfWidth,
        halfHeight,
        0,
        0,
        halfWidth,
        halfHeight,
      ]),
    ]);
    expect(ctx.save).toHaveBeenCalledTimes(8);
    expect(ctx.restore).toHaveBeenCalledTimes(8);
    expect(ctx.translate).toHaveBeenNthCalledWith(1, 0, 0);
    expect(ctx.translate).toHaveBeenNthCalledWith(2, canvas.width, 0);
    expect(ctx.translate).toHaveBeenNthCalledWith(3, 0, canvas.height);
    expect(ctx.translate).toHaveBeenNthCalledWith(4, canvas.width, canvas.height);
    expect(ctx.scale).toHaveBeenNthCalledWith(1, 1, 1);
    expect(ctx.scale).toHaveBeenNthCalledWith(2, -1, 1);
    expect(ctx.scale).toHaveBeenNthCalledWith(3, 1, -1);
    expect(ctx.scale).toHaveBeenNthCalledWith(4, -1, -1);
  });

  it("draws Weave from persistent film plates with audio-clock sway and splice bump", () => {
    const { canvas, ctx } = renderContext("corners");
    const resources = initVibeResources("corners");
    const weave = resources.weave;
    const frameCanvas = weave.frameCanvas;
    const gateCanvas = weave.gateCanvas;
    const scratchTiles = weave.scratchTiles;
    const scratchPatterns = weave.scratchPatterns;
    const frameCtx = weave.frameCtx as RecordedContext;
    const phase = 0.25;
    const beatIndex = 8;
    const swayAngle = Math.PI * 2 * phase + beatIndex;
    const splice = 1 - phase;
    const expectedDx =
      WEAVE.swayXPx * Math.sin(swayAngle) + WEAVE.spliceBumpPx * splice;
    const expectedDy =
      WEAVE.swayYPx * Math.cos(swayAngle) - WEAVE.spliceBumpPx * 0.25 * splice;

    applyVibe(ctx, canvas, "weave", resources, 8.25, 0, 1);

    expect(resources.weave).toBe(weave);
    expect(resources.weave.frameCanvas).toBe(frameCanvas);
    expect(resources.weave.gateCanvas).toBe(gateCanvas);
    expect(resources.weave.scratchTiles).toBe(scratchTiles);
    expect(resources.weave.scratchPatterns).toBe(scratchPatterns);
    expect(drawImageCalls(frameCtx)).toEqual([
      expect.objectContaining({ args: [canvas, 0, 0] }),
    ]);
    const frameDraw = drawImageCalls(ctx)[0];
    expect(frameDraw.args[0]).toBe(frameCanvas);
    expect(frameDraw.args[1]).toBeCloseTo(expectedDx);
    expect(frameDraw.args[2]).toBeCloseTo(expectedDy);
    expect(frameDraw.args.slice(3)).toEqual([canvas.width, canvas.height]);
    expect(drawImageCalls(ctx)[1]).toMatchObject({
      args: [gateCanvas, 0, 0],
      globalCompositeOperation: "multiply",
    });
    expect(ctx.__haCanvasCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "fillRect",
          args: [0, 0, canvas.width, canvas.height],
          fillStyle: WEAVE.wash,
          globalCompositeOperation: "screen",
        }),
        expect.objectContaining({
          method: "fillRect",
          args: [0, 0, canvas.width, canvas.height],
          fillStyle: scratchPatterns[0],
          globalCompositeOperation: "screen",
        }),
      ]),
    );

    ctx.__haCanvasCalls.length = 0;
    frameCtx.__haCanvasCalls.length = 0;
    applyVibe(ctx, canvas, "weave", resources, 9.25, 0, 1);

    expect(resources.weave.frameCanvas).toBe(frameCanvas);
    expect(resources.weave.gateCanvas).toBe(gateCanvas);
    expect(resources.weave.scratchTiles).toBe(scratchTiles);
    expect(resources.weave.scratchPatterns).toBe(scratchPatterns);
    expect(drawImageCalls(frameCtx).map((call) => call.args[0])).toEqual([canvas]);
    expect(
      ctx.__haCanvasCalls.find(
        (call) =>
          call.method === "fillRect" &&
          call.globalCompositeOperation === "screen" &&
          call.fillStyle === scratchPatterns[1],
      ),
    ).toBeTruthy();
  });

  it("keeps Crossroll identity through beat six and rolls once on beat seven", () => {
    const { canvas, ctx } = renderContext("corners");
    const resources = initVibeResources("corners");
    const crossroll = resources.crossroll;
    const frameCanvas = crossroll.frameCanvas;
    const seamCanvas = crossroll.seamCanvas;
    const frameCtx = crossroll.frameCtx as RecordedContext;

    applyVibe(ctx, canvas, "crossroll", resources, 3.25, 0, 1);

    expect(resources.crossroll).toBe(crossroll);
    expect(resources.crossroll.frameCanvas).toBe(frameCanvas);
    expect(resources.crossroll.seamCanvas).toBe(seamCanvas);
    expect(ctx.__haCanvasCalls).toEqual([]);
    expect(drawImageCalls(frameCtx)).toHaveLength(0);

    applyVibe(ctx, canvas, "crossroll", resources, 7.5, 0, 1);

    expect(drawImageCalls(frameCtx)).toEqual([
      expect.objectContaining({ args: [canvas, 0, 0] }),
    ]);
    expect(drawImageCalls(ctx)).toEqual([
      expect.objectContaining({ args: [frameCanvas, 0, canvas.height / 2] }),
      expect.objectContaining({ args: [frameCanvas, 0, -canvas.height / 2] }),
      expect.objectContaining({
        args: [seamCanvas, 0, canvas.height / 2 - CROSSROLL.seamHeightPx / 2],
      }),
    ]);
  });

  it("reuses persistent Ghost and Solar resources across frames", () => {
    const { canvas, ctx } = renderContext("row");
    const resources = initVibeResources("row");
    const ghost = resources.ghost;
    const solar = resources.solar;
    const ghostFeedback = ghost.feedbackCanvas;
    const ghostVignette = ghost.vignetteCanvas;
    const ghostTransforms = ghost.transforms;
    const solarPlates = solar.plates;

    applyVibe(ctx, canvas, "ghost", resources, 10, 10, 0.5);
    applyVibe(ctx, canvas, "solar", resources, 10.13, 10, 0.5);

    expect(resources.ghost).toBe(ghost);
    expect(resources.ghost.feedbackCanvas).toBe(ghostFeedback);
    expect(resources.ghost.vignetteCanvas).toBe(ghostVignette);
    expect(resources.ghost.transforms).toBe(ghostTransforms);
    expect(resources.solar).toBe(solar);
    expect(resources.solar.plates).toBe(solarPlates);
    expect(resources.solar.plates.pale).toBe(solarPlates.pale);
    expect(resources.solar.plates.orange).toBe(solarPlates.orange);
    expect(resources.solar.plates.zinc).toBe(solarPlates.zinc);
  });

  it("draws three fixed Ghost screen echoes, clamps feedback, then updates it", () => {
    const { canvas, ctx } = renderContext("stack");
    const resources = initVibeResources("stack");
    const ghost = resources.ghost;
    const feedbackCtx = ghost.feedbackCtx as RecordedContext;

    applyVibe(ctx, canvas, "ghost", resources, 2, 0, 0.5);

    const screenDraws = drawImageCalls(ctx).filter(
      (call) => call.globalCompositeOperation === "screen",
    );
    expect(screenDraws).toHaveLength(3);
    expect(screenDraws.map((call) => call.globalAlpha)).toEqual([0.22, 0.14, 0.08]);
    expect(screenDraws.map((call) => call.args)).toEqual(
      ghost.transforms.map((transform) => [
        ghost.feedbackCanvas,
        0,
        0,
        canvas.width,
        canvas.height,
        transform.x,
        transform.y,
        transform.w,
        transform.h,
      ]),
    );
    expect(drawImageCalls(feedbackCtx)).toEqual([
      expect.objectContaining({
        args: [ghost.vignetteCanvas, 0, 0],
        globalAlpha: 1,
        globalCompositeOperation: "destination-in",
      }),
      expect.objectContaining({
        args: [canvas, 0, 0],
        globalAlpha: 0.72,
        globalCompositeOperation: "source-over",
      }),
    ]);
  });

  it("switches Solar exposure plates hard on audio-clock beat subdivisions", () => {
    const { canvas, ctx } = renderContext("row");
    const resources = initVibeResources("row");
    const { plates } = resources.solar;

    applyVibe(ctx, canvas, "solar", resources, 4, 4, 0.8);
    expect(drawImageCalls(ctx)).toHaveLength(0);

    applyVibe(ctx, canvas, "solar", resources, 4.21, 4, 0.8);
    expect(drawImageCalls(ctx)).toEqual([
      expect.objectContaining({
        args: [plates.pale, 0, 0],
        globalAlpha: 1,
        globalCompositeOperation: "difference",
      }),
    ]);

    ctx.__haCanvasCalls.length = 0;
    applyVibe(ctx, canvas, "solar", resources, 4.41, 4, 0.8);
    expect(drawImageCalls(ctx)).toEqual([
      expect.objectContaining({
        args: [plates.orange, 0, 0],
        globalAlpha: 0.8,
        globalCompositeOperation: "screen",
      }),
    ]);

    ctx.__haCanvasCalls.length = 0;
    applyVibe(ctx, canvas, "solar", resources, 4.61, 4, 0.8);
    expect(drawImageCalls(ctx)).toEqual([
      expect.objectContaining({
        args: [plates.zinc, 0, 0],
        globalAlpha: 0.45,
        globalCompositeOperation: "multiply",
      }),
    ]);
  });

  it("dispatches all ten vibe ids from the stopped-preview audio-clock anchor", () => {
    const { canvas, ctx } = renderContext("row");
    const resources = initVibeResources("row");

    for (const vibe of MOOD_VIBE_IDS) {
      applyVibe(ctx, canvas, vibe, resources, 7.25, 0, 1);
    }

    // toBe, not toEqual: two blank canvases of the same size are
    // structurally equal, so toEqual cannot tell tint from snapshot.
    const sources = drawImageCalls(ctx).map((call) => call.args[0]);
    expect(sources).toHaveLength(16);
    expect(sources[0]).toBe(resources.blocks.canvas);
    expect(sources[1]).toBe(resources.camcorder.tintCanvas);
    expect(sources[2]).toBe(resources.camcorder.tintCanvas);
    expect(sources.slice(3, 7)).toEqual([
      resources.kaleido.snapshotCanvas,
      resources.kaleido.snapshotCanvas,
      resources.kaleido.snapshotCanvas,
      resources.kaleido.snapshotCanvas,
    ]);
    expect(sources.slice(7, 9)).toEqual([
      resources.weave.frameCanvas,
      resources.weave.gateCanvas,
    ]);
    expect(sources.slice(9, 12)).toEqual([
      resources.crossroll.frameCanvas,
      resources.crossroll.frameCanvas,
      resources.crossroll.seamCanvas,
    ]);
    expect(sources.slice(12, 15)).toEqual([
      resources.ghost.feedbackCanvas,
      resources.ghost.feedbackCanvas,
      resources.ghost.feedbackCanvas,
    ]);
    expect(sources[15]).toBe(resources.solar.plates.pale);
  });
});
