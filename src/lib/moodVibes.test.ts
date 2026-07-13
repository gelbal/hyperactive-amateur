// ABOUTME: moodVibes tests — pins Mood full-frame vibe pass behavior.
// ABOUTME: Covers identity fallbacks and Blocks offscreen resource reuse.
import { describe, expect, it } from "vitest";

import { applyVibe, initVibeResources } from "./moodVibes";
import { STAGE_DESCRIPTORS } from "./moodStages";
import type { MoodStageId, MoodVibeId } from "../types";

type CanvasCall = {
  method: string;
  args: unknown[];
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
  it("keeps Clean as an identity pass", () => {
    const { canvas, ctx } = renderContext();
    const resources = initVibeResources("corners");

    applyVibe(ctx, canvas, "clean", resources);

    expect(ctx.__haCanvasCalls).toEqual([]);
  });

  it.each(["print", "mixtape", "camcorder"] as const)(
    "keeps %s as an identity fallback until its step ships",
    (vibe) => {
      const { canvas, ctx } = renderContext();
      const resources = initVibeResources("corners");

      applyVibe(ctx, canvas, vibe, resources);

      expect(ctx.__haCanvasCalls).toEqual([]);
    },
  );

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

  it("dispatches every spec vibe id without throwing", () => {
    const allVibes: MoodVibeId[] = ["clean", "blocks", "mixtape", "camcorder", "print"];
    const { canvas, ctx } = renderContext("row");
    const resources = initVibeResources("row");

    for (const vibe of allVibes) {
      applyVibe(ctx, canvas, vibe, resources);
    }

    expect(drawImageCalls(ctx).map((call) => call.args[0])).toEqual([
      resources.blocks.canvas,
    ]);
  });
});
