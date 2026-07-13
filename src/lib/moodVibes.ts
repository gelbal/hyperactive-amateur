// ABOUTME: Mood full-frame vibe passes for the render canvas.
// ABOUTME: Owns reusable offscreen resources so per-frame painting stays allocation-free.
import type { MoodStageId, MoodVibeId } from "../types";
import { STAGE_DESCRIPTORS } from "./moodStages";

type VibeApplier = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  resources: VibeResources,
) => void;

export interface BlocksVibeResources {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export interface VibeResources {
  blocks: BlocksVibeResources;
}

function createResourceCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function initVibeResources(stage: MoodStageId): VibeResources {
  const descriptor = STAGE_DESCRIPTORS[stage];
  const blocksWidth = Math.max(1, Math.round(descriptor.canvasSize.w / 12));
  const blocksHeight = Math.max(1, Math.round(descriptor.canvasSize.h / 12));
  const blocksCanvas = createResourceCanvas(blocksWidth, blocksHeight);
  const blocksCtx = blocksCanvas.getContext("2d");
  if (!blocksCtx) {
    throw new Error("Mood Blocks vibe needs a 2D canvas context");
  }
  return {
    blocks: {
      canvas: blocksCanvas,
      ctx: blocksCtx,
    },
  };
}

function applyIdentity(): void {}

function applyBlocks(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  resources: VibeResources,
): void {
  const { canvas: blocksCanvas, ctx: blocksCtx } = resources.blocks;
  blocksCtx.drawImage(canvas, 0, 0, blocksCanvas.width, blocksCanvas.height);

  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    blocksCanvas,
    0,
    0,
    blocksCanvas.width,
    blocksCanvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  ctx.imageSmoothingEnabled = previousSmoothing;
}

const VIBE_APPLIERS = {
  clean: applyIdentity,
  blocks: applyBlocks,
  mixtape: applyIdentity,
  camcorder: applyIdentity,
  print: applyIdentity,
} satisfies Record<MoodVibeId, VibeApplier>;

export function applyVibe(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  vibeId: MoodVibeId,
  resources: VibeResources,
): void {
  VIBE_APPLIERS[vibeId](ctx, canvas, resources);
}
