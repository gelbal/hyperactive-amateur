// ABOUTME: Mood full-frame vibe passes for the render canvas.
// ABOUTME: Owns reusable offscreen resources so per-frame painting stays allocation-free.
import type { MoodStageId, MoodVibeId } from "../types";
import { STAGE_DESCRIPTORS } from "./moodStages";
import { CAMCORDER, CAMCORDER_NOISE_TILE_COUNT, MIXTAPE } from "./moodVibePalettes";

type VibeApplier = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  resources: VibeResources,
) => void;

export interface BlocksVibeResources {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export interface MixtapeVibeResources {
  ready: true;
}

export interface CamcorderVibeResources {
  frameCanvas: HTMLCanvasElement;
  frameCtx: CanvasRenderingContext2D;
  tintCanvas: HTMLCanvasElement;
  tintCtx: CanvasRenderingContext2D;
  scanlineCanvas: HTMLCanvasElement;
  scanlinePattern: CanvasPattern;
  noiseTiles: HTMLCanvasElement[];
  noisePatterns: CanvasPattern[];
  frameCounter: number;
}

export interface VibeResources {
  blocks: BlocksVibeResources;
  mixtape: MixtapeVibeResources;
  camcorder: CamcorderVibeResources;
}

function createResourceCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getResourceContext(
  canvas: HTMLCanvasElement,
  label: string,
): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error(`${label} needs a 2D canvas context`);
  }
  return ctx;
}

function createResourcePattern(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  label: string,
): CanvasPattern {
  const pattern = ctx.createPattern(canvas, "repeat");
  if (!pattern) {
    throw new Error(`${label} needs a repeat canvas pattern`);
  }
  return pattern;
}

function createScanlineCanvas(): HTMLCanvasElement {
  const canvas = createResourceCanvas(1, 4);
  const ctx = getResourceContext(canvas, "Mood Camcorder scanline vibe");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 1, 1);
  return canvas;
}

function createNoiseTile(): HTMLCanvasElement {
  const tile = createResourceCanvas(CAMCORDER.noiseTileSize, CAMCORDER.noiseTileSize);
  const ctx = getResourceContext(tile, "Mood Camcorder noise vibe");
  const grainSize = 2;

  for (let y = 0; y < tile.height; y += grainSize) {
    for (let x = 0; x < tile.width; x += grainSize) {
      ctx.fillStyle = Math.random() > 0.5 ? "#fff" : "#000";
      ctx.fillRect(x, y, grainSize, grainSize);
    }
  }

  return tile;
}

function clipFullCanvas(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.clip();
}

function fillFullCanvas(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

export function initVibeResources(stage: MoodStageId): VibeResources {
  const descriptor = STAGE_DESCRIPTORS[stage];
  const blocksWidth = Math.max(1, Math.round(descriptor.canvasSize.w / 12));
  const blocksHeight = Math.max(1, Math.round(descriptor.canvasSize.h / 12));
  const blocksCanvas = createResourceCanvas(blocksWidth, blocksHeight);
  const blocksCtx = getResourceContext(blocksCanvas, "Mood Blocks vibe");
  const frameCanvas = createResourceCanvas(descriptor.canvasSize.w, descriptor.canvasSize.h);
  const frameCtx = getResourceContext(frameCanvas, "Mood Camcorder frame snapshot vibe");
  const tintCanvas = createResourceCanvas(descriptor.canvasSize.w, descriptor.canvasSize.h);
  const tintCtx = getResourceContext(tintCanvas, "Mood Camcorder chroma tint vibe");
  const scanlineCanvas = createScanlineCanvas();
  const scanlinePattern = createResourcePattern(
    frameCtx,
    scanlineCanvas,
    "Mood Camcorder scanline vibe",
  );
  const noiseTiles = Array.from({ length: CAMCORDER_NOISE_TILE_COUNT }, () => createNoiseTile());
  const noisePatterns = noiseTiles.map((tile) =>
    createResourcePattern(frameCtx, tile, "Mood Camcorder noise vibe"),
  );

  return {
    blocks: {
      canvas: blocksCanvas,
      ctx: blocksCtx,
    },
    mixtape: {
      ready: true,
    },
    camcorder: {
      frameCanvas,
      frameCtx,
      tintCanvas,
      tintCtx,
      scanlineCanvas,
      scanlinePattern,
      noiseTiles,
      noisePatterns,
      frameCounter: 0,
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

function applyMixtape(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx.save();
  clipFullCanvas(ctx, canvas);

  ctx.globalCompositeOperation = "saturation";
  ctx.fillStyle = "#000";
  fillFullCanvas(ctx, canvas);

  // Duotone ramp: multiply keys the brights to the highlight color, then
  // the screen floor lifts the darks to the shadow color — dark pixels land
  // on the shadow, bright pixels on the highlight, detail rides the ramp.
  // Multiplying by the near-black shadow first would crush the frame to
  // <5% detail and the highlight screen would bury it in a flat wash.
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = MIXTAPE.highlight;
  fillFullCanvas(ctx, canvas);

  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = MIXTAPE.shadow;
  fillFullCanvas(ctx, canvas);

  ctx.restore();
}

// The ghost must be a tinted COPY of the frame (multiply keeps luminance,
// zeroing the off channels) screened back offset — tinting the main canvas
// after a screen draw would wash the whole frame instead of fringing edges.
function drawChromaGhost(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  camcorder: CamcorderVibeResources,
  tint: string,
  offsetPx: number,
): void {
  const { tintCanvas, tintCtx, frameCanvas } = camcorder;
  tintCtx.globalCompositeOperation = "source-over";
  tintCtx.drawImage(frameCanvas, 0, 0);
  tintCtx.globalCompositeOperation = "multiply";
  tintCtx.fillStyle = tint;
  fillFullCanvas(tintCtx, tintCanvas);

  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = CAMCORDER.chromaAlpha;
  ctx.drawImage(tintCanvas, offsetPx, 0, canvas.width, canvas.height);
}

function applyCamcorder(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  resources: VibeResources,
): void {
  const camcorder = resources.camcorder;
  camcorder.frameCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height);

  ctx.save();
  clipFullCanvas(ctx, canvas);

  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = CAMCORDER.scanlineAlpha;
  ctx.fillStyle = camcorder.scanlinePattern;
  fillFullCanvas(ctx, canvas);

  drawChromaGhost(ctx, canvas, camcorder, CAMCORDER.chromaLeft, -CAMCORDER.chromaOffsetPx);
  drawChromaGhost(ctx, canvas, camcorder, CAMCORDER.chromaRight, CAMCORDER.chromaOffsetPx);

  const noisePattern = camcorder.noisePatterns[camcorder.frameCounter];
  camcorder.frameCounter = (camcorder.frameCounter + 1) % camcorder.noisePatterns.length;
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = CAMCORDER.noiseAlpha;
  ctx.fillStyle = noisePattern;
  fillFullCanvas(ctx, canvas);

  ctx.restore();
}

const VIBE_APPLIERS = {
  clean: applyIdentity,
  blocks: applyBlocks,
  mixtape: applyMixtape,
  camcorder: applyCamcorder,
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
