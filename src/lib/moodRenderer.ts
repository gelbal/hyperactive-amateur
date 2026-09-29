// ABOUTME: Canvas renderer for Mood's stage-native Wall, Splits, and Solo lenses.
// ABOUTME: Promotes boundary commits, lays out mics, and paints take posters into export pixels.
import { useAppStore } from "../store/useAppStore";
import type {
  MoodMic,
  MoodPerformanceState,
  MoodPiece,
  MoodSelectionEntry,
  MoodStageId,
  MoodTake,
  RecordingState,
} from "../types";
import { drawCover } from "./canvasDraw";
import {
  deriveMoodMetronomeMicId,
  deriveMoodMetronomeTakeId,
  getMoodRecordingPreviewStream,
} from "./moodCapture";
import { applyDueCommits } from "./moodCommits";
import { cycleIndexAt, DROP_BEATS_PER_CYCLE } from "./moodClock";
import {
  advanceCreditScheduler,
  drawMoodCredits,
  featuredMoodCreditMicId,
  initMoodCreditResources,
  prepareMoodCredits,
  type MoodCreditResources,
} from "./moodCredits";
import {
  brakeVisualLevel,
  echoVisualLevel,
  gateVisualActive,
  harmonizeVisualLevel,
} from "./moodFx";
import { STAGE_DESCRIPTORS } from "./moodStages";
import {
  clearMoodPosterCache,
  getMoodPosterImage,
  type MoodPosterCacheEntry,
} from "./moodPosterCache";
import { layoutFor, type MoodTilerMic, type TileRect } from "./moodTilers";
import {
  applyVibe,
  getPrintDensity,
  initVibeResources,
  setPrintDensity,
  type VibeResources,
} from "./moodVibes";
import { DROP_FLASH_ACCENTS, DROP_FLASH_WHITEWARD } from "./moodVibePalettes";
import { LOG_EVENTS, logger } from "./logger";
import {
  isVideoReadyForDraw,
  setCaptureVideoPolicy,
  videoForTake,
} from "./moodVideoPool";

const TILE_BLACK = "#050505";
const OFF_POSTER_ALPHA = 0.28;
const CAPTURE_FROZEN_POSTER_ALPHA = 0.12;
const DROP_FLASH_MAX_ALPHA = 0.35;
const HARMONY_TWIN_MAX_ALPHA = 0.16;
const HARMONY_TWIN_OFFSET_PX = 2;

export { deriveMoodMetronomeMicId } from "./moodCapture";

interface MoodRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  stage: MoodStageId;
  vibeResources: VibeResources;
  fxSnapshotCanvas: HTMLCanvasElement;
  fxSnapshotCtx: CanvasRenderingContext2D | null;
  creditsResources: MoodCreditResources;
}

interface MoodRenderState {
  piece: MoodPiece;
  performance: MoodPerformanceState;
}

let renderer: MoodRenderer | null = null;
let capturePreviewVideo: HTMLVideoElement | null = null;
let capturePreviewStream: MediaStream | null = null;
let dropImpact: { boundaryTime: number; active: boolean } | null = null;

// Print frame-budget watchdog. Thresholds are fallback defaults pending the
// S5 spike rows in .claude/mood/spikes.md — 12ms approximates a 30fps
// frame's paint share on a mid-tier phone; 60 frames of sustained overage
// (~2s) before degrading avoids tripping on one-off jank.
export const PRINT_FRAME_BUDGET_MS = 12;
export const PRINT_WATCHDOG_WINDOW_FRAMES = 60;
let printFrameTotalMs = 0;
let printFrameCount = 0;
let printWatchdogTripped = false;

function recordPrintFrameTime(durationMs: number): void {
  printFrameTotalMs += durationMs;
  printFrameCount += 1;
  if (printFrameCount < PRINT_WATCHDOG_WINDOW_FRAMES) return;
  const averageMs = printFrameTotalMs / printFrameCount;
  printFrameTotalMs = 0;
  printFrameCount = 0;
  if (averageMs <= PRINT_FRAME_BUDGET_MS) return;
  printWatchdogTripped = true;
  setPrintDensity("degraded");
  logger.warn(LOG_EVENTS.MOOD_PRINT_DEGRADED, {
    averageMs: Math.round(averageMs * 100) / 100,
    budgetMs: PRINT_FRAME_BUDGET_MS,
  });
}

export function initMoodRenderer(canvas: HTMLCanvasElement, stage: MoodStageId): void {
  const descriptor = STAGE_DESCRIPTORS[stage];
  canvas.width = descriptor.canvasSize.w;
  canvas.height = descriptor.canvasSize.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    renderer = null;
    return;
  }
  dropImpact = null;
  const fxSnapshotCanvas = document.createElement("canvas");
  fxSnapshotCanvas.width = descriptor.canvasSize.w;
  fxSnapshotCanvas.height = descriptor.canvasSize.h;
  renderer = {
    canvas,
    ctx,
    stage,
    vibeResources: initVibeResources(stage),
    fxSnapshotCanvas,
    fxSnapshotCtx: fxSnapshotCanvas.getContext("2d"),
    creditsResources: initMoodCreditResources(descriptor.canvasSize),
  };
}

function commitDueBoundary(audioTime: number): void {
  const dropCommit = applyDueCommits(audioTime);
  if (dropCommit) {
    dropImpact = {
      boundaryTime: dropCommit.boundaryTime,
      active: dropCommit.active,
    };
  }
}

export function moodDropFlashAlpha(
  audioTime: number,
  boundaryTime: number,
  beatSeconds: number,
): number {
  if (
    !Number.isFinite(audioTime) ||
    !Number.isFinite(boundaryTime) ||
    !Number.isFinite(beatSeconds) ||
    beatSeconds <= 0
  ) {
    return 0;
  }
  const elapsed = audioTime - boundaryTime;
  if (elapsed < 0 || elapsed >= beatSeconds) return 0;
  return (1 - elapsed / beatSeconds) * DROP_FLASH_MAX_ALPHA;
}

function drawDropImpact(
  ctx: CanvasRenderingContext2D,
  piece: MoodPiece,
  performanceState: MoodPerformanceState,
  captureActive: boolean,
  audioTime: number,
): void {
  if (
    !dropImpact ||
    captureActive ||
    !performanceState.isPerforming ||
    performanceState.epoch === null ||
    dropImpact.boundaryTime < performanceState.epoch ||
    piece.cycleSeconds === null
  ) {
    return;
  }

  const alpha = moodDropFlashAlpha(
    audioTime,
    dropImpact.boundaryTime,
    piece.cycleSeconds / DROP_BEATS_PER_CYCLE,
  );
  if (alpha <= 0) return;

  const descriptor = STAGE_DESCRIPTORS[piece.stage];
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = dropImpact.active
    ? DROP_FLASH_ACCENTS[piece.vibe]
    : DROP_FLASH_WHITEWARD;
  ctx.fillRect(0, 0, descriptor.canvasSize.w, descriptor.canvasSize.h);
  ctx.restore();
}

function drawLiveFxTwins(
  active: MoodRenderer,
  performanceState: MoodPerformanceState,
  captureActive: boolean,
  audioTime: number,
): void {
  if (captureActive || !performanceState.isPerforming) return;
  const echoLevel = echoVisualLevel(audioTime);
  const brakeLevel = brakeVisualLevel(audioTime);
  const harmonyLevel = harmonizeVisualLevel(audioTime);
  const gateOffPhase = gateVisualActive(audioTime);
  const { canvas, ctx, fxSnapshotCanvas, fxSnapshotCtx } = active;
  const needsSnapshot = echoLevel > 0 || brakeLevel > 0 || harmonyLevel > 0;

  if (needsSnapshot && fxSnapshotCtx) {
    fxSnapshotCtx.save();
    fxSnapshotCtx.globalAlpha = 1;
    fxSnapshotCtx.globalCompositeOperation = "source-over";
    fxSnapshotCtx.clearRect(0, 0, fxSnapshotCanvas.width, fxSnapshotCanvas.height);
    fxSnapshotCtx.drawImage(canvas, 0, 0);
    fxSnapshotCtx.restore();
  }

  if (harmonyLevel > 0 && fxSnapshotCtx) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = harmonyLevel * HARMONY_TWIN_MAX_ALPHA;
    ctx.drawImage(fxSnapshotCanvas, -HARMONY_TWIN_OFFSET_PX, 0);
    ctx.drawImage(fxSnapshotCanvas, HARMONY_TWIN_OFFSET_PX, 0);
    ctx.restore();
  }

  if (echoLevel > 0 && fxSnapshotCtx) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = echoLevel;
    ctx.drawImage(fxSnapshotCanvas, -4, 0);
    ctx.restore();
  }

  if (brakeLevel > 0 && fxSnapshotCtx) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = brakeLevel * 0.5;
    ctx.drawImage(fxSnapshotCanvas, 0, 2);
    ctx.fillStyle = TILE_BLACK;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  // Gate is last so its muted phases stay visually black even when Echo or
  // Brake is also held. Credit/impact overlays remain above this layer.
  if (gateOffPhase) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = TILE_BLACK;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
}

function postCommitState(stage: MoodStageId, fallback: MoodRenderState): MoodRenderState {
  const mood = useAppStore.getState().mood;
  if (!mood.piece || mood.piece.stage !== stage) return fallback;
  return { piece: mood.piece, performance: mood.performance };
}

function liveTakeFor(mic: MoodMic, entry: MoodSelectionEntry | undefined): MoodTake | null {
  if (!entry || entry === "off") return null;
  return mic.takes.find((take) => take.id === entry) ?? null;
}

function isCaptureRecordingState(state: RecordingState): boolean {
  return state === "preparing" || state === "countdown" || state === "recording";
}

function clearCapturePreviewVideo(): void {
  if (!capturePreviewVideo) return;
  capturePreviewVideo.pause();
  capturePreviewVideo.srcObject = null;
  capturePreviewStream = null;
}

function previewVideoForStream(stream: MediaStream | null): HTMLVideoElement | null {
  if (!stream) {
    clearCapturePreviewVideo();
    return null;
  }
  if (!capturePreviewVideo) {
    capturePreviewVideo = document.createElement("video");
    capturePreviewVideo.autoplay = true;
    capturePreviewVideo.muted = true;
    capturePreviewVideo.playsInline = true;
  }
  if (capturePreviewStream !== stream) {
    capturePreviewStream = stream;
    capturePreviewVideo.srcObject = stream;
    void capturePreviewVideo.play().catch(() => undefined);
  } else if (capturePreviewVideo.paused) {
    void capturePreviewVideo.play().catch(() => undefined);
  }
  return capturePreviewVideo;
}

interface CaptureRenderState {
  active: boolean;
  hotMicId: string | null;
  metronomeMicId: string | null;
  metronomeTakeId: string | null;
  previewVideo: HTMLVideoElement | null;
}

function captureRenderState(
  piece: MoodPiece,
  performanceState: MoodPerformanceState,
): CaptureRenderState {
  const state = useAppStore.getState();
  const hotMicId = performanceState.hotMicId;
  const active = hotMicId !== null && isCaptureRecordingState(state.recording.state);

  if (!active) {
    clearCapturePreviewVideo();
    setCaptureVideoPolicy(false);
    return {
      active: false,
      hotMicId: null,
      metronomeMicId: null,
      metronomeTakeId: null,
      previewVideo: null,
    };
  }

  const metronomeMicId = state.mood.monitorWithHeadphones
    ? null
    : deriveMoodMetronomeMicId(piece);
  const metronomeTakeId =
    metronomeMicId === null
      ? null
      : deriveMoodMetronomeTakeId(piece, performanceState);
  setCaptureVideoPolicy(true, metronomeTakeId);

  return {
    active: true,
    hotMicId,
    metronomeMicId,
    metronomeTakeId,
    previewVideo: previewVideoForStream(getMoodRecordingPreviewStream()),
  };
}

function lastPosterTake(mic: MoodMic): MoodTake | null {
  return mic.takes[mic.takes.length - 1] ?? null;
}

function canDrawPoster(entry: MoodPosterCacheEntry): boolean {
  return (
    entry.ready &&
    !entry.failed &&
    entry.image.complete &&
    entry.image.naturalWidth > 0 &&
    entry.image.naturalHeight > 0
  );
}

function fillTile(ctx: CanvasRenderingContext2D, rect: TileRect): void {
  ctx.fillStyle = TILE_BLACK;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

function drawPoster(
  ctx: CanvasRenderingContext2D,
  take: MoodTake | null,
  rect: TileRect,
  alpha: number,
): void {
  if (!take?.posterUrl) return;
  const poster = getMoodPosterImage(take.posterUrl);
  if (!canDrawPoster(poster)) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  drawCover(ctx, poster.image, {
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
  });
  ctx.restore();
}

export function drawDesaturated(
  ctx: CanvasRenderingContext2D,
  rect: TileRect,
  drawTile: () => void,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  drawTile();
  ctx.globalCompositeOperation = "saturation";
  ctx.fillStyle = "#000";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

function drawCaptureTile(
  ctx: CanvasRenderingContext2D,
  mic: MoodMic,
  entry: MoodSelectionEntry | undefined,
  rect: TileRect,
  capture: CaptureRenderState,
): void {
  fillTile(ctx, rect);
  if (mic.id === capture.hotMicId) {
    if (capture.previewVideo && isVideoReadyForDraw(capture.previewVideo)) {
      drawCover(ctx, capture.previewVideo, {
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h,
      });
    }
    return;
  }

  const liveTake = liveTakeFor(mic, entry);
  if (mic.id === capture.metronomeMicId && capture.metronomeTakeId) {
    drawDesaturated(ctx, rect, () => {
      const video = videoForTake(capture.metronomeTakeId as string);
      if (video && isVideoReadyForDraw(video)) {
        drawCover(ctx, video, {
          x: rect.x,
          y: rect.y,
          width: rect.w,
          height: rect.h,
        });
        return;
      }
      drawPoster(ctx, liveTake ?? lastPosterTake(mic), rect, 1);
    });
    return;
  }

  drawPoster(ctx, liveTake ?? lastPosterTake(mic), rect, CAPTURE_FROZEN_POSTER_ALPHA);
}

function drawWallTile(
  ctx: CanvasRenderingContext2D,
  mic: MoodMic,
  entry: MoodSelectionEntry | undefined,
  rect: TileRect,
  capture: CaptureRenderState,
): void {
  if (capture.active) {
    drawCaptureTile(ctx, mic, entry, rect, capture);
    return;
  }

  fillTile(ctx, rect);
  const liveTake = liveTakeFor(mic, entry);
  if (liveTake) {
    const video = videoForTake(liveTake.id);
    if (video && isVideoReadyForDraw(video)) {
      drawCover(ctx, video, {
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h,
      });
      return;
    }
    drawPoster(ctx, liveTake, rect, 1);
    return;
  }

  if (entry === "off") {
    drawPoster(ctx, lastPosterTake(mic), rect, OFF_POSTER_ALPHA);
  }
}

function soloFeaturedMicId(
  piece: MoodPiece,
  performanceState: MoodPerformanceState,
  capture: CaptureRenderState,
  micStates: MoodTilerMic[],
  audioTime: number,
  creditsResources: MoodCreditResources,
): string | null {
  if (capture.active) return capture.hotMicId;
  const creditedMicId = featuredMoodCreditMicId(creditsResources, audioTime);
  if (creditedMicId) return creditedMicId;

  let liveCount = 0;
  for (const mic of micStates) {
    if (mic.live) liveCount += 1;
  }
  if (liveCount === 0) return null;

  const liveIndex =
    performanceState.epoch !== null && piece.cycleSeconds !== null
      ? cycleIndexAt(performanceState.epoch, piece.cycleSeconds, audioTime) % liveCount
      : 0;
  let currentLiveIndex = 0;
  for (const mic of micStates) {
    if (!mic.live) continue;
    if (currentLiveIndex === liveIndex) return mic.micId;
    currentLiveIndex += 1;
  }
  return null;
}

export function drawMoodFrame(audioTime: number, state: MoodRenderState): void {
  const active = renderer;
  if (!active) return;

  commitDueBoundary(audioTime);
  const renderState = postCommitState(active.stage, state);
  const { piece, performance: performanceState } = renderState;
  const descriptor = STAGE_DESCRIPTORS[piece.stage];
  const { ctx } = active;

  const capture = captureRenderState(piece, performanceState);
  // The take window is vibe-free: the capture presentation's reserved
  // grammar (B&W = reference, hot preview = framing) must stay readable
  // (spec §7), so an active capture suspends the full-canvas pass.
  const vibeActive =
    piece.vibe !== "clean" &&
    !capture.active &&
    (!performanceState.isPerforming || performanceState.dropActive);
  const watchPrintBudget =
    vibeActive && piece.vibe === "print" && !printWatchdogTripped && getPrintDensity() === "normal";
  // Diagnostic timing only; musical time stays on the audio clock.
  const frameStartMs = watchPrintBudget ? performance.now() : 0;

  ctx.fillStyle = TILE_BLACK;
  ctx.fillRect(0, 0, descriptor.canvasSize.w, descriptor.canvasSize.h);
  const micStates = piece.mics.map((mic) => ({
    micId: mic.id,
    live: capture.active || liveTakeFor(mic, performanceState.selections[mic.id]) !== null,
    featured: false,
  }));
  if (piece.lens === "solo") {
    const featuredMicId = soloFeaturedMicId(
      piece,
      performanceState,
      capture,
      micStates,
      audioTime,
      active.creditsResources,
    );
    for (const mic of micStates) {
      mic.featured = mic.micId === featuredMicId;
    }
  }
  let rects = layoutFor(piece.stage, piece.lens, micStates);
  const recordingState = useAppStore.getState().recording.state;
  if (piece.lens === "solo" && !capture.active) {
    // Ambient rotation may schedule a mic that the natural Solo cycle has not
    // laid out. Advance once before tile paint, then let the scheduled-window
    // hold promote that mic into the start-boundary frame.
    advanceCreditScheduler(
      active.creditsResources,
      piece,
      performanceState,
      rects,
      audioTime,
      recordingState,
    );
    const scheduledFeaturedMicId = soloFeaturedMicId(
      piece,
      performanceState,
      capture,
      micStates,
      audioTime,
      active.creditsResources,
    );
    for (const mic of micStates) {
      mic.featured = mic.micId === scheduledFeaturedMicId;
    }
    rects = layoutFor(piece.stage, piece.lens, micStates);
  }
  const micById = new Map(piece.mics.map((mic) => [mic.id, mic]));

  for (const rect of rects) {
    const mic = micById.get(rect.micId);
    if (!mic) continue;
    drawWallTile(ctx, mic, performanceState.selections[mic.id], rect, capture);
  }

  if (vibeActive) {
    applyVibe(
      ctx,
      active.canvas,
      piece.vibe,
      active.vibeResources,
      audioTime,
      performanceState.epoch ?? 0,
      piece.cycleSeconds === null ? null : piece.cycleSeconds / DROP_BEATS_PER_CYCLE,
    );
  }

  prepareMoodCredits(
    active.canvas,
    piece,
    performanceState,
    rects,
    audioTime,
    recordingState,
    active.creditsResources,
  );
  drawLiveFxTwins(active, performanceState, capture.active, audioTime);
  drawDropImpact(ctx, piece, performanceState, capture.active, audioTime);
  drawMoodCredits(ctx, audioTime, active.creditsResources);

  if (watchPrintBudget) {
    recordPrintFrameTime(performance.now() - frameStartMs);
  }
}

export function disposeMoodRenderer(): void {
  renderer = null;
  dropImpact = null;
  clearMoodPosterCache();
  clearCapturePreviewVideo();
  capturePreviewVideo = null;
  capturePreviewStream = null;
  setCaptureVideoPolicy(false);
}

export function __resetMoodRendererForTesting(): void {
  disposeMoodRenderer();
  printFrameTotalMs = 0;
  printFrameCount = 0;
  printWatchdogTripped = false;
}

export { __getMoodPosterCacheSizeForTesting, evictMoodPosters } from "./moodPosterCache";

export function __getMoodRendererPreviewVideoForTesting(): HTMLVideoElement | null {
  return capturePreviewVideo;
}
