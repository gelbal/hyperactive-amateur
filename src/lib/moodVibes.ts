// ABOUTME: Mood full-frame vibe passes for the render canvas.
// ABOUTME: Owns reusable offscreen resources so per-frame painting stays allocation-free.
import type { MoodStageId, MoodVibeId } from "../types";
import { STAGE_DESCRIPTORS } from "./moodStages";
import {
  CAMCORDER,
  CAMCORDER_NOISE_HOLD_SECONDS,
  CAMCORDER_NOISE_TILE_COUNT,
  CROSSROLL,
  GHOST,
  MIXTAPE,
  PRINT,
  SOLAR,
  WEAVE,
  WEAVE_SCRATCH_TILE_COUNT,
} from "./moodVibePalettes";

type VibeApplier = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  resources: VibeResources,
  audioTime: number,
  gridStartTime: number,
  beatSeconds: number | null,
) => void;

interface BlocksVibeResources {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

interface MixtapeVibeResources {
  ready: true;
}

interface CamcorderVibeResources {
  frameCanvas: HTMLCanvasElement;
  frameCtx: CanvasRenderingContext2D;
  tintCanvas: HTMLCanvasElement;
  tintCtx: CanvasRenderingContext2D;
  scanlineCanvas: HTMLCanvasElement;
  scanlinePattern: CanvasPattern;
  noiseTiles: HTMLCanvasElement[];
  noisePatterns: CanvasPattern[];
}

interface KaleidoVibeResources {
  snapshotCanvas: HTMLCanvasElement;
  snapshotCtx: CanvasRenderingContext2D;
}

interface WeaveVibeResources {
  frameCanvas: HTMLCanvasElement;
  frameCtx: CanvasRenderingContext2D;
  gateCanvas: HTMLCanvasElement;
  gateCtx: CanvasRenderingContext2D;
  scratchTiles: HTMLCanvasElement[];
  scratchPatterns: CanvasPattern[];
}

interface CrossrollVibeResources {
  frameCanvas: HTMLCanvasElement;
  frameCtx: CanvasRenderingContext2D;
  seamCanvas: HTMLCanvasElement;
  seamCtx: CanvasRenderingContext2D;
}

interface GhostTransform {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface GhostVibeResources {
  feedbackCanvas: HTMLCanvasElement;
  feedbackCtx: CanvasRenderingContext2D;
  vignetteCanvas: HTMLCanvasElement;
  vignetteCtx: CanvasRenderingContext2D;
  transforms: readonly [GhostTransform, GhostTransform, GhostTransform];
}

interface SolarVibeResources {
  plates: {
    pale: HTMLCanvasElement;
    orange: HTMLCanvasElement;
    zinc: HTMLCanvasElement;
  };
}

type PrintDensity = "normal" | "degraded";

// Lattice cells across the stage canvas's LONG axis per density. The
// degraded lattice deliberately keeps the approved 84-cell geometry, so
// the frame-budget watchdog falls back to a known-good source-fidelity level.
export const PRINT_LATTICE_LONG_AXIS: Record<PrintDensity, number> = {
  normal: 128,
  degraded: 84,
};

// Dots smaller than this read as noise, not halftone — skip them.
const PRINT_MIN_DOT_RADIUS_PX = 0.4;
// Slight overlap at full darkness so shadows print solid, not dotted.
const PRINT_MAX_RADIUS_CELL_SHARE = 0.58;

interface PrintLatticeResources {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  centers: Float32Array;
  maxRadius: number;
}

interface PrintVibeResources {
  normal: PrintLatticeResources;
  degraded: PrintLatticeResources;
}

export interface VibeResources {
  blocks: BlocksVibeResources;
  mixtape: MixtapeVibeResources;
  camcorder: CamcorderVibeResources;
  print: PrintVibeResources;
  kaleido: KaleidoVibeResources;
  weave: WeaveVibeResources;
  crossroll: CrossrollVibeResources;
  ghost: GhostVibeResources;
  solar: SolarVibeResources;
}

// The degrade knob is session-scoped: once the renderer's watchdog trips
// it, Print stays coarse until the tab reloads.
let printDensity: PrintDensity = "normal";

export function setPrintDensity(density: PrintDensity): void {
  printDensity = density;
}

export function getPrintDensity(): PrintDensity {
  return printDensity;
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

function createWeaveScratchTile(): HTMLCanvasElement {
  const tile = createResourceCanvas(WEAVE.scratchTileSize, WEAVE.scratchTileSize);
  const ctx = getResourceContext(tile, "Mood Weave scratch vibe");
  ctx.fillStyle = WEAVE.scratch;

  for (let index = 0; index < 12; index++) {
    const x = Math.floor(Math.random() * tile.width);
    const y = Math.floor(Math.random() * tile.height);
    const scratchHeight = 4 + Math.floor(Math.random() * 22);
    ctx.fillRect(x, y, 1, scratchHeight);
  }
  for (let index = 0; index < 28; index++) {
    const x = Math.floor(Math.random() * tile.width);
    const y = Math.floor(Math.random() * tile.height);
    const dustSize = Math.random() > 0.82 ? 2 : 1;
    ctx.fillRect(x, y, dustSize, dustSize);
  }

  return tile;
}

function createWeaveResources(width: number, height: number): WeaveVibeResources {
  const frameCanvas = createResourceCanvas(width, height);
  const frameCtx = getResourceContext(frameCanvas, "Mood Weave frame snapshot vibe");
  const gateCanvas = createResourceCanvas(width, height);
  const gateCtx = getResourceContext(gateCanvas, "Mood Weave gate vignette vibe");
  const innerRadius = Math.min(width, height) * 0.18;
  const outerRadius = Math.hypot(width, height) * 0.64;
  const gate = gateCtx.createRadialGradient(
    width * 0.5,
    height * 0.48,
    innerRadius,
    width * 0.5,
    height * 0.48,
    outerRadius,
  );
  gate.addColorStop(0, "rgba(255, 255, 255, 1)");
  gate.addColorStop(0.58, "rgba(255, 255, 255, 0.94)");
  gate.addColorStop(1, WEAVE.gate);
  gateCtx.fillStyle = gate;
  gateCtx.fillRect(0, 0, width, height);

  const scratchTiles = Array.from(
    { length: WEAVE_SCRATCH_TILE_COUNT },
    createWeaveScratchTile,
  );
  const scratchPatterns = scratchTiles.map((tile) =>
    createResourcePattern(frameCtx, tile, "Mood Weave scratch vibe"),
  );

  return {
    frameCanvas,
    frameCtx,
    gateCanvas,
    gateCtx,
    scratchTiles,
    scratchPatterns,
  };
}

function createCrossrollResources(width: number, height: number): CrossrollVibeResources {
  const frameCanvas = createResourceCanvas(width, height);
  const frameCtx = getResourceContext(frameCanvas, "Mood Crossroll frame snapshot vibe");
  const seamCanvas = createResourceCanvas(width, CROSSROLL.seamHeightPx);
  const seamCtx = getResourceContext(seamCanvas, "Mood Crossroll seam vibe");
  seamCtx.fillStyle = CROSSROLL.bar;
  seamCtx.fillRect(0, 0, seamCanvas.width, seamCanvas.height);
  seamCtx.fillStyle = CROSSROLL.sprocket;
  seamCtx.beginPath();
  for (
    let x = CROSSROLL.sprocketGapPx / 2;
    x < seamCanvas.width;
    x += CROSSROLL.sprocketGapPx
  ) {
    seamCtx.moveTo(x + CROSSROLL.sprocketRadiusPx, seamCanvas.height / 2);
    seamCtx.arc(
      x,
      seamCanvas.height / 2,
      CROSSROLL.sprocketRadiusPx,
      0,
      Math.PI * 2,
    );
  }
  seamCtx.fill();

  return {
    frameCanvas,
    frameCtx,
    seamCanvas,
    seamCtx,
  };
}

function createGhostResources(width: number, height: number): GhostVibeResources {
  const feedbackCanvas = createResourceCanvas(width, height);
  const feedbackCtx = getResourceContext(feedbackCanvas, "Mood Ghost feedback vibe");
  const vignetteCanvas = createResourceCanvas(width, height);
  const vignetteCtx = getResourceContext(vignetteCanvas, "Mood Ghost vignette vibe");
  const vanishingX = width * 0.5;
  const vanishingY = height * 0.38;
  const innerRadius = Math.min(width, height) * 0.2;
  const outerRadius = Math.hypot(width, height) * 0.62;
  const vignette = vignetteCtx.createRadialGradient(
    vanishingX,
    vanishingY,
    innerRadius,
    vanishingX,
    vanishingY,
    outerRadius,
  );
  vignette.addColorStop(0, "rgba(255, 255, 255, 1)");
  vignette.addColorStop(0.72, "rgba(255, 255, 255, 0.88)");
  vignette.addColorStop(1, "rgba(255, 255, 255, 0)");
  vignetteCtx.fillStyle = vignette;
  vignetteCtx.fillRect(0, 0, width, height);

  const transformFor = (scale: number, translateX: number, translateY: number) => ({
    x: vanishingX - vanishingX * scale + translateX,
    y: vanishingY - vanishingY * scale + translateY,
    w: width * scale,
    h: height * scale,
  });

  return {
    feedbackCanvas,
    feedbackCtx,
    vignetteCanvas,
    vignetteCtx,
    transforms: [
      transformFor(1.012, 1, -1),
      transformFor(1.024, -1, 0),
      transformFor(1.036, 0, 1),
    ],
  };
}

function createSolarPlate(
  width: number,
  height: number,
  color: string,
  label: string,
): HTMLCanvasElement {
  const canvas = createResourceCanvas(width, height);
  const ctx = getResourceContext(canvas, label);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

function createPrintLattice(
  canvasW: number,
  canvasH: number,
  density: PrintDensity,
): PrintLatticeResources {
  const longAxis = Math.max(canvasW, canvasH);
  const cellSize = longAxis / PRINT_LATTICE_LONG_AXIS[density];
  const cellsX = Math.max(1, Math.round(canvasW / cellSize));
  const cellsY = Math.max(1, Math.round(canvasH / cellSize));
  const cellW = canvasW / cellsX;
  const cellH = canvasH / cellsY;
  const canvas = createResourceCanvas(cellsX, cellsY);
  const ctx = getResourceContext(canvas, "Mood Print lattice vibe");
  const centers = new Float32Array(cellsX * cellsY * 2);
  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const i = (cy * cellsX + cx) * 2;
      centers[i] = (cx + 0.5) * cellW;
      centers[i + 1] = (cy + 0.5) * cellH;
    }
  }
  return {
    canvas,
    ctx,
    centers,
    maxRadius: Math.min(cellW, cellH) * PRINT_MAX_RADIUS_CELL_SHARE,
  };
}

function clipFullCanvas(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.clip();
}

function fillFullCanvas(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// Snapshot the live stage frame into an offscreen ctx with clean compositing
// state, so a vibe can re-read it while it repaints the main canvas.
function snapshotInto(target: CanvasRenderingContext2D, source: HTMLCanvasElement): void {
  target.globalAlpha = 1;
  target.globalCompositeOperation = "source-over";
  target.drawImage(source, 0, 0);
}

export function initVibeResources(stage: MoodStageId): VibeResources {
  const descriptor = STAGE_DESCRIPTORS[stage];
  const stageWidth = descriptor.canvasSize.w;
  const stageHeight = descriptor.canvasSize.h;
  const blocksWidth = Math.max(1, Math.round(descriptor.canvasSize.w / 6));
  const blocksHeight = Math.max(1, Math.round(descriptor.canvasSize.h / 6));
  const blocksCanvas = createResourceCanvas(blocksWidth, blocksHeight);
  const blocksCtx = getResourceContext(blocksCanvas, "Mood Blocks vibe");
  const frameCanvas = createResourceCanvas(stageWidth, stageHeight);
  const frameCtx = getResourceContext(frameCanvas, "Mood Camcorder frame snapshot vibe");
  const tintCanvas = createResourceCanvas(stageWidth, stageHeight);
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
  const kaleidoSnapshotCanvas = createResourceCanvas(stageWidth, stageHeight);
  const weave = createWeaveResources(stageWidth, stageHeight);
  const crossroll = createCrossrollResources(stageWidth, stageHeight);
  const ghost = createGhostResources(stageWidth, stageHeight);

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
    },
    print: {
      normal: createPrintLattice(stageWidth, stageHeight, "normal"),
      degraded: createPrintLattice(
        stageWidth,
        stageHeight,
        "degraded",
      ),
    },
    kaleido: {
      snapshotCanvas: kaleidoSnapshotCanvas,
      snapshotCtx: getResourceContext(
        kaleidoSnapshotCanvas,
        "Mood Kaleido snapshot vibe",
      ),
    },
    weave,
    crossroll,
    ghost,
    solar: {
      plates: {
        pale: createSolarPlate(stageWidth, stageHeight, SOLAR.pale, "Mood Solar pale plate"),
        orange: createSolarPlate(
          stageWidth,
          stageHeight,
          SOLAR.orange,
          "Mood Solar orange plate",
        ),
        zinc: createSolarPlate(stageWidth, stageHeight, SOLAR.zinc, "Mood Solar zinc plate"),
      },
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
  audioTime: number,
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

  const noiseStep = Math.floor(
    (Number.isFinite(audioTime) && audioTime >= 0 ? audioTime : 0) /
      CAMCORDER_NOISE_HOLD_SECONDS,
  );
  const noisePattern = camcorder.noisePatterns[noiseStep % camcorder.noisePatterns.length];
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = CAMCORDER.noiseAlpha;
  ctx.fillStyle = noisePattern;
  fillFullCanvas(ctx, canvas);

  ctx.restore();
}

const TWO_PI = Math.PI * 2;

function applyPrint(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  resources: VibeResources,
): void {
  const lattice = resources.print[printDensity];
  const { canvas: latticeCanvas, ctx: latticeCtx, centers, maxRadius } = lattice;
  latticeCtx.drawImage(canvas, 0, 0, latticeCanvas.width, latticeCanvas.height);
  // The ONLY readback in any vibe — lattice-sized, never full resolution.
  const { data } = latticeCtx.getImageData(0, 0, latticeCanvas.width, latticeCanvas.height);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = PRINT.paper;
  fillFullCanvas(ctx, canvas);

  ctx.fillStyle = PRINT.ink;
  ctx.beginPath();
  const cellCount = centers.length / 2;
  for (let i = 0; i < cellCount; i++) {
    const o = i * 4;
    const luma = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    const radius = maxRadius * (1 - luma / 255);
    if (radius < PRINT_MIN_DOT_RADIUS_PX) continue;
    const x = centers[i * 2];
    const y = centers[i * 2 + 1];
    // moveTo before each arc keeps the dots disjoint subpaths — without it
    // the path chords dots together and the fill grows slivers.
    ctx.moveTo(x + radius, y);
    ctx.arc(x, y, radius, 0, TWO_PI);
  }
  ctx.fill();
  ctx.restore();
}

const VIBE_BOUNDARY_EPSILON_SECONDS = 1e-9;

function validVibeBeatGrid(
  audioTime: number,
  gridStartTime: number,
  beatSeconds: number | null,
): beatSeconds is number {
  return (
    Number.isFinite(audioTime) &&
    Number.isFinite(gridStartTime) &&
    beatSeconds !== null &&
    Number.isFinite(beatSeconds) &&
    beatSeconds > 0
  );
}

function vibeBeatIndex(audioTime: number, gridStartTime: number, beatSeconds: number): number {
  const rawIndex = (audioTime - gridStartTime) / beatSeconds;
  const nearestIndex = Math.round(rawIndex);
  if (Math.abs(rawIndex - nearestIndex) <= VIBE_BOUNDARY_EPSILON_SECONDS) {
    return nearestIndex;
  }
  return Math.floor(rawIndex);
}

function vibeBeatPhase(audioTime: number, gridStartTime: number, beatSeconds: number): number {
  const beatIndex = vibeBeatIndex(audioTime, gridStartTime, beatSeconds);
  const phase = (audioTime - (gridStartTime + beatIndex * beatSeconds)) / beatSeconds;
  return Math.max(0, Math.min(1 - Number.EPSILON, phase));
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function applyKaleido(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  resources: VibeResources,
  audioTime: number,
  gridStartTime: number,
  beatSeconds: number | null,
): void {
  let sourceIndex = 0;
  if (validVibeBeatGrid(audioTime, gridStartTime, beatSeconds)) {
    sourceIndex = positiveModulo(
      vibeBeatIndex(audioTime, gridStartTime, beatSeconds),
      4,
    );
  }

  const kaleido = resources.kaleido;
  const halfWidth = canvas.width / 2;
  const halfHeight = canvas.height / 2;
  const sourceX = (sourceIndex % 2) * halfWidth;
  const sourceY = Math.floor(sourceIndex / 2) * halfHeight;
  snapshotInto(kaleido.snapshotCtx, canvas);

  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const column = quadrant % 2;
    const row = Math.floor(quadrant / 2);
    ctx.save();
    ctx.translate(column === 0 ? 0 : canvas.width, row === 0 ? 0 : canvas.height);
    ctx.scale(column === 0 ? 1 : -1, row === 0 ? 1 : -1);
    ctx.drawImage(
      kaleido.snapshotCanvas,
      sourceX,
      sourceY,
      halfWidth,
      halfHeight,
      0,
      0,
      halfWidth,
      halfHeight,
    );
    ctx.restore();
  }
}

function applyWeave(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  resources: VibeResources,
  audioTime: number,
  gridStartTime: number,
  beatSeconds: number | null,
): void {
  let beatIndex = 0;
  let phase = 0;
  if (validVibeBeatGrid(audioTime, gridStartTime, beatSeconds)) {
    beatIndex = vibeBeatIndex(audioTime, gridStartTime, beatSeconds);
    phase = vibeBeatPhase(audioTime, gridStartTime, beatSeconds);
  }

  const weave = resources.weave;
  const swayAngle = TWO_PI * phase + beatIndex;
  const splice = positiveModulo(beatIndex, 8) === 0 ? 1 - phase : 0;
  const dx = WEAVE.swayXPx * Math.sin(swayAngle) + WEAVE.spliceBumpPx * splice;
  const dy =
    WEAVE.swayYPx * Math.cos(swayAngle) - WEAVE.spliceBumpPx * 0.25 * splice;
  const scratchPattern =
    weave.scratchPatterns[positiveModulo(beatIndex, weave.scratchPatterns.length)];

  snapshotInto(weave.frameCtx, canvas);

  ctx.save();
  clipFullCanvas(ctx, canvas);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(weave.frameCanvas, dx, dy, canvas.width, canvas.height);

  ctx.globalAlpha = WEAVE.washAlpha;
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = WEAVE.wash;
  fillFullCanvas(ctx, canvas);

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(weave.gateCanvas, 0, 0);

  ctx.globalAlpha = WEAVE.scratchAlpha;
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = scratchPattern;
  fillFullCanvas(ctx, canvas);
  ctx.restore();
}

function applyCrossroll(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  resources: VibeResources,
  audioTime: number,
  gridStartTime: number,
  beatSeconds: number | null,
): void {
  if (!validVibeBeatGrid(audioTime, gridStartTime, beatSeconds)) return;
  const beatIndex = vibeBeatIndex(audioTime, gridStartTime, beatSeconds);
  if (positiveModulo(beatIndex, 8) !== 7) return;

  const crossroll = resources.crossroll;
  const phase = vibeBeatPhase(audioTime, gridStartTime, beatSeconds);
  const wrapY = phase * canvas.height;
  snapshotInto(crossroll.frameCtx, canvas);

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(crossroll.frameCanvas, 0, wrapY);
  ctx.drawImage(crossroll.frameCanvas, 0, wrapY - canvas.height);
  ctx.drawImage(
    crossroll.seamCanvas,
    0,
    wrapY - CROSSROLL.seamHeightPx / 2,
  );
  ctx.restore();
}

function applyGhost(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  resources: VibeResources,
): void {
  const ghost = resources.ghost;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let index = 0; index < ghost.transforms.length; index++) {
    const transform = ghost.transforms[index];
    ctx.globalAlpha = GHOST.echoAlphas[index];
    ctx.drawImage(
      ghost.feedbackCanvas,
      0,
      0,
      canvas.width,
      canvas.height,
      transform.x,
      transform.y,
      transform.w,
      transform.h,
    );
  }
  ctx.restore();

  ghost.feedbackCtx.save();
  ghost.feedbackCtx.globalAlpha = 1;
  ghost.feedbackCtx.globalCompositeOperation = "destination-in";
  ghost.feedbackCtx.drawImage(ghost.vignetteCanvas, 0, 0);
  ghost.feedbackCtx.globalAlpha = GHOST.feedbackAlpha;
  ghost.feedbackCtx.globalCompositeOperation = "source-over";
  ghost.feedbackCtx.drawImage(canvas, 0, 0);
  ghost.feedbackCtx.restore();
}

function drawSolarPlate(
  ctx: CanvasRenderingContext2D,
  plate: HTMLCanvasElement,
  composite: GlobalCompositeOperation,
  alpha: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = composite;
  ctx.globalAlpha = alpha;
  ctx.drawImage(plate, 0, 0);
  ctx.restore();
}

function applySolar(
  ctx: CanvasRenderingContext2D,
  _canvas: HTMLCanvasElement,
  resources: VibeResources,
  audioTime: number,
  gridStartTime: number,
  beatSeconds: number | null,
): void {
  if (!validVibeBeatGrid(audioTime, gridStartTime, beatSeconds)) return;
  const subdivision = Math.floor(vibeBeatPhase(audioTime, gridStartTime, beatSeconds) * 4);
  if (subdivision === 1) {
    drawSolarPlate(ctx, resources.solar.plates.pale, "difference", 1);
  } else if (subdivision === 2) {
    drawSolarPlate(ctx, resources.solar.plates.orange, "screen", SOLAR.orangeAlpha);
  } else if (subdivision === 3) {
    drawSolarPlate(ctx, resources.solar.plates.zinc, "multiply", SOLAR.zincAlpha);
  }
}

const VIBE_APPLIERS = {
  clean: applyIdentity,
  print: applyPrint,
  mixtape: applyMixtape,
  blocks: applyBlocks,
  camcorder: applyCamcorder,
  kaleido: applyKaleido,
  weave: applyWeave,
  crossroll: applyCrossroll,
  ghost: applyGhost,
  solar: applySolar,
} satisfies Record<MoodVibeId, VibeApplier>;

export function applyVibe(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  vibeId: MoodVibeId,
  resources: VibeResources,
  audioTime = 0,
  gridStartTime = 0,
  beatSeconds: number | null = null,
): void {
  VIBE_APPLIERS[vibeId](
    ctx,
    canvas,
    resources,
    audioTime,
    gridStartTime,
    beatSeconds,
  );
}
