// ABOUTME: Canvas renderer for Mood's stage-native Wall and Splits lenses.
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
import { STAGE_DESCRIPTORS } from "./moodStages";
import { layoutFor, type TileRect } from "./moodTilers";
import {
  applyVibe,
  getPrintDensity,
  initVibeResources,
  setPrintDensity,
  type VibeResources,
} from "./moodVibes";
import { LOG_EVENTS, logger } from "./logger";
import {
  isVideoReadyForDraw,
  setCaptureVideoPolicy,
  videoForTake,
} from "./moodVideoPool";

const TILE_BLACK = "#050505";
const OFF_POSTER_ALPHA = 0.28;
const CAPTURE_FROZEN_POSTER_ALPHA = 0.12;

export { deriveMoodMetronomeMicId } from "./moodCapture";

interface MoodRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  stage: MoodStageId;
  vibeResources: VibeResources;
}

export interface MoodRenderState {
  piece: MoodPiece;
  performance: MoodPerformanceState;
}

interface PosterCacheEntry {
  image: HTMLImageElement;
  ready: boolean;
  failed: boolean;
}

let renderer: MoodRenderer | null = null;
const posterCache = new Map<string, PosterCacheEntry>();
let capturePreviewVideo: HTMLVideoElement | null = null;
let capturePreviewStream: MediaStream | null = null;

// Print frame-budget watchdog. Thresholds are fallback defaults pending the
// S5 spike rows in .claude/mood/spikes.md — 12ms approximates a 30fps
// frame's paint share on a mid-tier phone; 60 frames of sustained overage
// (~2s) before degrading avoids tripping on one-off jank.
export const PRINT_FRAME_BUDGET_MS = 12;
export const PRINT_WATCHDOG_WINDOW_FRAMES = 60;
let printFrameTotalMs = 0;
let printFrameCount = 0;
let printWatchdogTripped = false;

// drawMoodFrame destructures the mood `performance` state, which shadows
// the global — the wall-clock reader must be bound out here. This is
// diagnostic timing only; musical time stays on the audio clock.
function frameNowMs(): number {
  return performance.now();
}

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
  renderer = { canvas, ctx, stage, vibeResources: initVibeResources(stage) };
}

function commitDueBoundary(audioTime: number): void {
  applyDueCommits(audioTime);
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
  performance: MoodPerformanceState,
): CaptureRenderState {
  const state = useAppStore.getState();
  const hotMicId = performance.hotMicId;
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
      : deriveMoodMetronomeTakeId(piece, performance);
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

function getPosterImage(posterUrl: string): PosterCacheEntry {
  const cached = posterCache.get(posterUrl);
  if (cached) return cached;

  const image = new Image();
  const entry: PosterCacheEntry = {
    image,
    ready: false,
    failed: false,
  };
  image.onload = () => {
    entry.ready = true;
    entry.failed = false;
  };
  image.onerror = () => {
    entry.ready = false;
    entry.failed = true;
  };
  image.src = posterUrl;
  posterCache.set(posterUrl, entry);
  return entry;
}

function canDrawPoster(entry: PosterCacheEntry): boolean {
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
  const poster = getPosterImage(take.posterUrl);
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

export function drawMoodFrame(audioTime: number, state: MoodRenderState): void {
  const active = renderer;
  if (!active) return;

  commitDueBoundary(audioTime);
  const renderState = postCommitState(active.stage, state);
  const { piece, performance } = renderState;
  const descriptor = STAGE_DESCRIPTORS[piece.stage];
  const { ctx } = active;

  const watchPrintBudget =
    piece.vibe === "print" && !printWatchdogTripped && getPrintDensity() === "normal";
  const frameStartMs = watchPrintBudget ? frameNowMs() : 0;

  ctx.fillStyle = TILE_BLACK;
  ctx.fillRect(0, 0, descriptor.canvasSize.w, descriptor.canvasSize.h);

  const capture = captureRenderState(piece, performance);
  const micStates = piece.mics.map((mic) => ({
    micId: mic.id,
    live: capture.active || liveTakeFor(mic, performance.selections[mic.id]) !== null,
  }));
  const rects = layoutFor(piece.stage, piece.lens, micStates);
  const micById = new Map(piece.mics.map((mic) => [mic.id, mic]));

  for (const rect of rects) {
    const mic = micById.get(rect.micId);
    if (!mic) continue;
    drawWallTile(ctx, mic, performance.selections[mic.id], rect, capture);
  }

  if (piece.vibe !== "clean") {
    applyVibe(ctx, active.canvas, piece.vibe, active.vibeResources);
  }

  if (watchPrintBudget) {
    recordPrintFrameTime(frameNowMs() - frameStartMs);
  }
}

export function __resetMoodRendererForTesting(): void {
  renderer = null;
  posterCache.clear();
  clearCapturePreviewVideo();
  capturePreviewVideo = null;
  setCaptureVideoPolicy(false);
  printFrameTotalMs = 0;
  printFrameCount = 0;
  printWatchdogTripped = false;
}

export function __getMoodRendererPreviewVideoForTesting(): HTMLVideoElement | null {
  return capturePreviewVideo;
}
