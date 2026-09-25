// ABOUTME: Deterministic Mood credit pass scheduling plus frozen multi-entry canvas moments.
// ABOUTME: Owns reusable credit canvases and derives every animation phase from audio-clock time.
import type {
  MoodCreditMode,
  MoodCreditPalette,
  MoodPerformanceState,
  MoodPiece,
  RecordingState,
} from "../types";
import { LOG_EVENTS, logger } from "./logger";
import { cycleIndexAt, DROP_BEATS_PER_CYCLE } from "./moodClock";
import {
  APP_FONT_STACK,
  CREDIT_STYLES,
  fontSizeFor,
  MIN_CREDIT_FONT_PX,
  renderTrackInName,
} from "./moodCreditStyles";
import type { TileRect } from "./moodTilers";

export {
  CREDIT_STYLES,
  easeInCubic,
  easeOutCubic,
  MIN_CREDIT_FONT_PX,
} from "./moodCreditStyles";

export const CREDIT_WINDOW_BEATS = Math.min(4, DROP_BEATS_PER_CYCLE);
export const CREDIT_WINDOW_MIN_SECONDS = 2.4;
export const CREDITS_PASS_GAP_SECONDS = 18;
export const CREDIT_NAME_MAX_LENGTH = 24;

export interface MoodCreditPaletteValues {
  accent: string;
  flash: string;
  ink: string;
  paper: string;
}

export const MOOD_CREDIT_PALETTES: Readonly<
  Record<MoodCreditPalette, MoodCreditPaletteValues>
> = {
  signal: { accent: "#f97316", flash: "#dc2626", ink: "#09090b", paper: "#fafafa" },
  print: { accent: "#fef3c7", flash: "#78716c", ink: "#0c0a09", paper: "#fffbeb" },
  heat: { accent: "#fbbf24", flash: "#e11d48", ink: "#450a0a", paper: "#fff7ed" },
};

type CreditWindowKind = "sequence" | "together";

interface ScheduledCreditPass {
  kind: CreditWindowKind;
  passIndex: number;
  castMicIds: string[];
  passStart: number;
  passEnd: number;
  windowSeconds: number;
  cycleIndex: number;
}

interface ScheduledCreditWindow {
  kind: CreditWindowKind;
  micId?: string;
  micIds?: readonly string[];
  passIndex: number;
  position: number;
  castSize: number;
  windowStart: number;
  windowSeconds: number;
  cycleIndex: number;
  key: string;
}

interface CreditSchedulerState {
  nextWindow: ScheduledCreditWindow | null;
  activePass: ScheduledCreditPass | null;
  lastCycleIndex: number | null;
  lastPassEndTime: number | null;
  schedulerEpoch: number | null;
  handledWindowKey: string | null;
  nextPassIndex: number;
}

export type CreditPhase =
  | { kind: "enter"; progress: number }
  | { kind: "hold"; progress: number }
  | { kind: "exit"; progress: number };

export interface ActiveCreditEntry {
  micId: string;
  name: string;
  upperName: string;
  displayName: string;
  displayUpper: string;
  rect: TileRect;
  mastheadFont: string;
  nameBoundsX: number;
  nameBoundsW: number;
}

export interface ActiveCreditWindow {
  key: string;
  entries: ActiveCreditEntry[];
  styleIndex: number;
  windowStart: number;
  windowSeconds: number;
  beatSeconds: number;
  palette: MoodCreditPaletteValues;
}

export interface MoodCreditResources extends CreditSchedulerState {
  snapshotCanvas: HTMLCanvasElement;
  snapshotCtx: CanvasRenderingContext2D | null;
  nameCanvas: HTMLCanvasElement;
  nameCtx: CanvasRenderingContext2D | null;
  activeWindow: ActiveCreditWindow | null;
}

export function createCreditSchedulerState(): CreditSchedulerState {
  return {
    nextWindow: null,
    activePass: null,
    lastCycleIndex: null,
    lastPassEndTime: null,
    schedulerEpoch: null,
    handledWindowKey: null,
    nextPassIndex: 0,
  };
}

export function creditWindowSeconds(cycleSeconds: number): number {
  if (!Number.isFinite(cycleSeconds) || cycleSeconds <= 0) return 0;
  const beatSeconds = cycleSeconds / DROP_BEATS_PER_CYCLE;
  return Math.max(CREDIT_WINDOW_MIN_SECONDS, CREDIT_WINDOW_BEATS * beatSeconds);
}

export function creditPhase(
  audioTime: number,
  windowStart: number,
  windowSeconds: number,
): CreditPhase | null {
  if (
    !Number.isFinite(audioTime) ||
    !Number.isFinite(windowStart) ||
    !Number.isFinite(windowSeconds) ||
    windowSeconds <= 0
  ) {
    return null;
  }

  const elapsedSeconds = audioTime - windowStart;
  if (elapsedSeconds < 0 || elapsedSeconds >= windowSeconds) return null;
  const phaseSeconds = windowSeconds / 4;
  const boundaryEpsilon = 1e-9;
  if (elapsedSeconds + boundaryEpsilon < phaseSeconds) {
    return { kind: "enter", progress: elapsedSeconds / phaseSeconds };
  }
  if (elapsedSeconds + boundaryEpsilon < phaseSeconds * 3) {
    const progress = (elapsedSeconds - phaseSeconds) / (phaseSeconds * 2);
    return {
      kind: "hold",
      progress: progress < boundaryEpsilon ? 0 : progress,
    };
  }
  const progress = (elapsedSeconds - phaseSeconds * 3) / phaseSeconds;
  return {
    kind: "exit",
    progress: progress < boundaryEpsilon ? 0 : progress,
  };
}

export function clampCreditStyleIndex(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(CREDIT_STYLES.length - 1, Math.trunc(value)));
}

function creditNameFor(piece: MoodPiece, micId: string): string | null {
  const name = piece.credits?.names[micId];
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function creditMicIsLive(
  piece: MoodPiece,
  performance: MoodPerformanceState,
  micId: string,
): boolean {
  const selection = performance.selections[micId];
  if (!selection || selection === "off") return false;
  const mic = piece.mics.find((candidate) => candidate.id === micId);
  return mic?.takes.some((take) => take.id === selection) ?? false;
}

function frozenCast(
  piece: MoodPiece,
  performance: MoodPerformanceState,
): string[] {
  const cast: string[] = [];
  for (const mic of piece.mics) {
    if (creditNameFor(piece, mic.id) && creditMicIsLive(piece, performance, mic.id)) {
      cast.push(mic.id);
    }
  }
  return cast;
}

function clearPass(scheduler: CreditSchedulerState): void {
  scheduler.nextWindow = null;
  scheduler.activePass = null;
  scheduler.handledWindowKey = null;
}

function resetSchedulerForEpoch(
  scheduler: CreditSchedulerState,
  epoch: number,
  cycleIndex: number,
): void {
  clearPass(scheduler);
  scheduler.schedulerEpoch = epoch;
  scheduler.lastCycleIndex = cycleIndex > 0 ? cycleIndex - 1 : 0;
  scheduler.lastPassEndTime = null;
  scheduler.nextPassIndex = 0;
}

function scheduledWindowFor(
  pass: ScheduledCreditPass,
  position: number,
): ScheduledCreditWindow {
  const windowStart = pass.passStart + position * pass.windowSeconds;
  const base = {
    kind: pass.kind,
    passIndex: pass.passIndex,
    position,
    castSize: pass.castMicIds.length,
    windowStart,
    windowSeconds: pass.windowSeconds,
    cycleIndex: pass.cycleIndex,
    key: `${pass.passIndex}:${pass.kind}:${position}:${windowStart}`,
  };
  return pass.kind === "together"
    ? { ...base, micIds: pass.castMicIds }
    : { ...base, micId: pass.castMicIds[position] };
}

function schedulePass(
  scheduler: CreditSchedulerState,
  piece: MoodPiece,
  performance: MoodPerformanceState,
  boundaryTime: number,
  cycleIndex: number,
): void {
  const castMicIds = frozenCast(piece, performance);
  if (castMicIds.length === 0) return;
  const configuredMode: MoodCreditMode = piece.credits?.mode ?? "sequence";
  // Together cannot coexist with Solo's one-rect grammar. The pass degrades
  // locally to sequence while the persisted piece setting stays untouched.
  const kind: CreditWindowKind =
    configuredMode === "together" && piece.lens !== "solo"
      ? "together"
      : "sequence";
  const windowSeconds = creditWindowSeconds(piece.cycleSeconds ?? 0);
  const passWindowCount = kind === "together" ? 1 : castMicIds.length;
  const pass: ScheduledCreditPass = {
    kind,
    passIndex: scheduler.nextPassIndex,
    castMicIds,
    passStart: boundaryTime,
    passEnd: boundaryTime + passWindowCount * windowSeconds,
    windowSeconds,
    cycleIndex,
  };
  scheduler.nextPassIndex += 1;
  scheduler.activePass = pass;
  scheduler.nextWindow = scheduledWindowFor(pass, 0);
  scheduler.handledWindowKey = null;
}

type CreditSkipReason =
  | "no-rect"
  | "expired-unseen"
  | "capture-veto"
  | "rect-changed"
  | "name-cleared"
  | "performance-stopped"
  | "mic-not-live";

function windowIdentity(scheduled: ScheduledCreditWindow):
  | { micId: string }
  | { micIds: readonly string[] } {
  return scheduled.kind === "together"
    ? { micIds: scheduled.micIds ?? [] }
    : { micId: scheduled.micId ?? "" };
}

function logCreditSkip(
  piece: MoodPiece,
  scheduled: ScheduledCreditWindow,
  reason: CreditSkipReason,
): void {
  logger.info(LOG_EVENTS.MOOD_CREDIT_SKIP, {
    reason,
    kind: scheduled.kind,
    ...windowIdentity(scheduled),
    passIndex: scheduled.passIndex,
    position: scheduled.position,
    castSize: scheduled.castSize,
    lens: piece.lens,
  });
}

function logCreditWindow(
  piece: MoodPiece,
  scheduled: ScheduledCreditWindow,
  styleIndex: number,
): void {
  logger.info(LOG_EVENTS.MOOD_CREDIT_WINDOW, {
    kind: scheduled.kind,
    ...windowIdentity(scheduled),
    passIndex: scheduled.passIndex,
    position: scheduled.position,
    castSize: scheduled.castSize,
    cycleIndex: scheduled.cycleIndex,
    lens: piece.lens,
    windowSeconds: scheduled.windowSeconds,
    styleIndex,
  });
}

function completeOrAdvancePass(
  scheduler: CreditSchedulerState,
  piece: MoodPiece,
  audioTime: number,
): void {
  while (scheduler.activePass && scheduler.nextWindow) {
    const scheduled = scheduler.nextWindow;
    if (audioTime < scheduled.windowStart + scheduled.windowSeconds) return;
    if (scheduler.handledWindowKey !== scheduled.key) {
      logCreditSkip(piece, scheduled, "expired-unseen");
    }

    const pass = scheduler.activePass;
    const nextPosition = scheduled.position + 1;
    if (pass.kind === "sequence" && nextPosition < pass.castMicIds.length) {
      scheduler.nextWindow = scheduledWindowFor(pass, nextPosition);
      scheduler.handledWindowKey = null;
      continue;
    }

    scheduler.lastPassEndTime = pass.passEnd;
    clearPass(scheduler);
  }
}

export function advanceCreditScheduler(
  scheduler: CreditSchedulerState,
  piece: MoodPiece,
  performance: MoodPerformanceState,
  _rects: readonly TileRect[],
  audioTime: number,
  recordingState: RecordingState,
): void {
  if (
    !performance.isPerforming ||
    performance.epoch === null ||
    piece.cycleSeconds === null ||
    !piece.credits?.enabled
  ) {
    if (!performance.isPerforming && scheduler.nextWindow) {
      logCreditSkip(piece, scheduler.nextWindow, "performance-stopped");
    }
    clearPass(scheduler);
    scheduler.schedulerEpoch = null;
    scheduler.lastCycleIndex = null;
    scheduler.lastPassEndTime = null;
    scheduler.nextPassIndex = 0;
    return;
  }

  const { epoch } = performance;
  const cycleIndex = cycleIndexAt(epoch, piece.cycleSeconds, audioTime);
  if (scheduler.schedulerEpoch !== epoch) {
    resetSchedulerForEpoch(scheduler, epoch, cycleIndex);
  }

  if (recordingState !== "idle") {
    if (scheduler.lastCycleIndex === null || cycleIndex > scheduler.lastCycleIndex) {
      scheduler.lastCycleIndex = cycleIndex;
    }
    return;
  }

  completeOrAdvancePass(scheduler, piece, audioTime);

  if (scheduler.lastCycleIndex !== null && cycleIndex <= scheduler.lastCycleIndex) return;
  scheduler.lastCycleIndex = cycleIndex;
  if (cycleIndex < 1 || scheduler.activePass) return;

  const boundaryTime = epoch + cycleIndex * piece.cycleSeconds;
  if (
    scheduler.lastPassEndTime !== null &&
    boundaryTime < scheduler.lastPassEndTime + CREDITS_PASS_GAP_SECONDS
  ) {
    return;
  }
  schedulePass(scheduler, piece, performance, boundaryTime, cycleIndex);
}

export function initMoodCreditResources(size: { w: number; h: number }): MoodCreditResources {
  if (typeof document !== "undefined" && "fonts" in document) {
    void document.fonts.load(`900 16px ${APP_FONT_STACK}`).catch(() => undefined);
  }
  const snapshotCanvas = document.createElement("canvas");
  snapshotCanvas.width = size.w;
  snapshotCanvas.height = size.h;
  const nameCanvas = document.createElement("canvas");
  nameCanvas.width = size.w;
  nameCanvas.height = size.h;
  return {
    ...createCreditSchedulerState(),
    snapshotCanvas,
    snapshotCtx: snapshotCanvas.getContext("2d"),
    nameCanvas,
    nameCtx: nameCanvas.getContext("2d"),
    activeWindow: null,
  };
}

function rectsMatch(left: TileRect, right: TileRect): boolean {
  return (
    left.micId === right.micId &&
    left.x === right.x &&
    left.y === right.y &&
    left.w === right.w &&
    left.h === right.h
  );
}

function displayNameFor(name: string, rect: TileRect): string {
  const maxLen = Math.max(
    1,
    Math.floor((rect.w * 0.84) / (MIN_CREDIT_FONT_PX * 0.62)),
  );
  return name.length > maxLen ? `${name.slice(0, maxLen - 1)}…` : name;
}

function scheduledMicIds(scheduled: ScheduledCreditWindow): readonly string[] {
  return scheduled.kind === "together"
    ? scheduled.micIds ?? []
    : scheduled.micId
      ? [scheduled.micId]
      : [];
}

function buildActiveEntries(
  piece: MoodPiece,
  performance: MoodPerformanceState,
  rects: readonly TileRect[],
  scheduled: ScheduledCreditWindow,
): { entries: ActiveCreditEntry[]; skipReason: CreditSkipReason | null } {
  const entries: ActiveCreditEntry[] = [];
  for (const micId of scheduledMicIds(scheduled)) {
    const name = creditNameFor(piece, micId);
    if (!name || !creditMicIsLive(piece, performance, micId)) {
      return { entries, skipReason: "mic-not-live" };
    }
    const rect = rects.find((candidate) => candidate.micId === micId);
    if (!rect) return { entries, skipReason: "no-rect" };
    const displayName = displayNameFor(name, rect);
    const displayUpper = displayName.toUpperCase();
    entries.push({
      micId,
      name,
      upperName: name.toUpperCase(),
      displayName,
      displayUpper,
      rect: { ...rect },
      mastheadFont: `900 ${fontSizeFor(rect, displayUpper, 0.17)}px ${APP_FONT_STACK}`,
      nameBoundsX: 0,
      nameBoundsW: 0,
    });
  }
  return { entries, skipReason: null };
}

function startCreditWindow(
  resources: MoodCreditResources,
  canvas: HTMLCanvasElement,
  scheduled: ScheduledCreditWindow,
  entries: ActiveCreditEntry[],
  styleIndex: number,
  beatSeconds: number,
  palette: MoodCreditPaletteValues,
): ActiveCreditWindow | null {
  if (!resources.snapshotCtx) return null;
  const active: ActiveCreditWindow = {
    key: scheduled.key,
    entries,
    styleIndex,
    windowStart: scheduled.windowStart,
    windowSeconds: scheduled.windowSeconds,
    beatSeconds,
    palette,
  };

  resources.snapshotCtx.save();
  resources.snapshotCtx.globalAlpha = 1;
  resources.snapshotCtx.globalCompositeOperation = "source-over";
  resources.snapshotCtx.clearRect(
    0,
    0,
    resources.snapshotCanvas.width,
    resources.snapshotCanvas.height,
  );
  for (const entry of entries) {
    const { rect } = entry;
    resources.snapshotCtx.drawImage(
      canvas,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
    );
  }
  resources.snapshotCtx.restore();

  if (resources.nameCtx) {
    resources.nameCtx.clearRect(0, 0, resources.nameCanvas.width, resources.nameCanvas.height);
  }
  if (CREDIT_STYLES[styleIndex]?.name === "Track-In") {
    for (const entry of entries) renderTrackInName(resources, active, entry);
  }
  return active;
}

function activeEntriesStillValid(
  piece: MoodPiece,
  performance: MoodPerformanceState,
  rects: readonly TileRect[],
  active: ActiveCreditWindow,
): CreditSkipReason | null {
  for (const entry of active.entries) {
    if (!creditNameFor(piece, entry.micId) || !creditMicIsLive(piece, performance, entry.micId)) {
      return "mic-not-live";
    }
    const currentRect = rects.find((rect) => rect.micId === entry.micId);
    if (!currentRect || !rectsMatch(entry.rect, currentRect)) return "rect-changed";
  }
  return null;
}

function abortPassAt(resources: MoodCreditResources, audioTime: number): void {
  resources.lastPassEndTime = audioTime;
  resources.activeWindow = null;
  clearPass(resources);
}

export function prepareMoodCredits(
  canvas: HTMLCanvasElement,
  piece: MoodPiece,
  performance: MoodPerformanceState,
  rects: readonly TileRect[],
  audioTime: number,
  recordingState: RecordingState,
  resources: MoodCreditResources,
): void {
  const previousEpoch = resources.schedulerEpoch;
  advanceCreditScheduler(
    resources,
    piece,
    performance,
    rects,
    audioTime,
    recordingState,
  );
  if (resources.schedulerEpoch !== previousEpoch) {
    resources.activeWindow = null;
    resources.handledWindowKey = null;
  }

  if (!performance.isPerforming || !piece.credits?.enabled) {
    resources.activeWindow = null;
    return;
  }

  const scheduled = resources.nextWindow;
  if (!scheduled) {
    resources.activeWindow = null;
    return;
  }

  if (recordingState !== "idle") {
    logCreditSkip(piece, scheduled, "capture-veto");
    abortPassAt(resources, audioTime);
    return;
  }

  if (piece.cycleSeconds === null) return;
  const phase = creditPhase(audioTime, scheduled.windowStart, scheduled.windowSeconds);
  if (!phase) {
    resources.activeWindow = null;
    return;
  }

  const active = resources.activeWindow;
  if (active?.key === scheduled.key) {
    const skipReason = activeEntriesStillValid(piece, performance, rects, active);
    if (skipReason) {
      logCreditSkip(piece, scheduled, skipReason);
      resources.activeWindow = null;
    }
    return;
  }

  resources.activeWindow = null;
  if (resources.handledWindowKey === scheduled.key) return;

  const { entries, skipReason } = buildActiveEntries(piece, performance, rects, scheduled);
  if (skipReason) {
    logCreditSkip(piece, scheduled, skipReason);
    resources.handledWindowKey = scheduled.key;
    return;
  }

  const styleIndex = clampCreditStyleIndex(piece.credits.styleIndex);
  const started = startCreditWindow(
    resources,
    canvas,
    scheduled,
    entries,
    styleIndex,
    piece.cycleSeconds / DROP_BEATS_PER_CYCLE,
    MOOD_CREDIT_PALETTES[piece.artDirection?.creditPalette ?? "signal"],
  );
  if (!started) {
    logCreditSkip(piece, scheduled, "expired-unseen");
    resources.handledWindowKey = scheduled.key;
    return;
  }

  resources.activeWindow = started;
  resources.handledWindowKey = scheduled.key;
  logCreditWindow(piece, scheduled, styleIndex);
}

export function featuredMoodCreditMicId(
  resources: MoodCreditResources,
  audioTime: number,
): string | null {
  const active = resources.activeWindow;
  if (active && creditPhase(audioTime, active.windowStart, active.windowSeconds)) {
    return active.entries[0]?.micId ?? null;
  }
  const scheduled = resources.nextWindow;
  if (!scheduled || !creditPhase(audioTime, scheduled.windowStart, scheduled.windowSeconds)) {
    return null;
  }
  return scheduled.kind === "together"
    ? scheduled.micIds?.[0] ?? null
    : scheduled.micId ?? null;
}

export function drawMoodCredits(
  ctx: CanvasRenderingContext2D,
  audioTime: number,
  resources: MoodCreditResources,
): void {
  const credit = resources.activeWindow;
  if (!credit) return;
  const phase = creditPhase(audioTime, credit.windowStart, credit.windowSeconds);
  if (!phase) {
    resources.activeWindow = null;
    return;
  }

  for (const entry of credit.entries) {
    const { rect } = entry;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = phase.kind === "exit" ? 1 - phase.progress : 1;
    ctx.drawImage(
      resources.snapshotCanvas,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
    );
    ctx.globalAlpha = 1;
    CREDIT_STYLES[credit.styleIndex].draw({
      ctx,
      resources,
      active: credit,
      entry,
      phase,
      audioTime,
      palette: credit.palette,
    });
    ctx.restore();
  }
}
