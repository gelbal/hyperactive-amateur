// ABOUTME: videoEngine — hidden <video> elements per track + quantized canvas renderer.
// ABOUTME: Cut decisions land on cutSubdivision boundaries; audio playback path is unchanged.
import * as Tone from "tone";
import type { Clip, CutSubdivision, Tag } from "../types";
import { useAppStore } from "../store/useAppStore";
import { LOG_EVENTS, logger } from "./logger";

export type TagOrUntagged = Tag | "untagged";

// Higher number wins. Vocal/fx are loud-statement clips; hats are filler.
const TAG_PRIORITY: Record<TagOrUntagged, number> = {
  vocal: 5,
  fx: 4,
  snare: 3,
  kick: 2,
  hat: 1,
  untagged: 0,
};

export interface TrackContext {
  tag: Tag | null;
  muted: boolean;
}

export interface TriggerEvent {
  trackId: number;
  // Audio context seconds (Tone.now base) when the trigger fired.
  startTime: number;
  // Trimmed visual duration in milliseconds, when known for displayed events.
  trimDurationMs?: number;
}

// Pre-seek lookahead. A real <video> element needs a few render frames
// between `currentTime = X` and a decoded frame on the element — so if we
// seek + play at the same moment the audio fires, the first ~30–60 ms of
// the hard-cut shows a stale paused frame. Doing the seek slightly early
// (and the play exactly on time) leaves the element ready to render.
const LOOKAHEAD_S = 0.08;
const HAVE_CURRENT_DATA = 2;

let host: HTMLDivElement | null = null;
const videos = new Map<number, HTMLVideoElement>();
const trims = new Map<number, { startMs: number; endMs: number }>();
// Per-track flag indicating whether the hidden <video> has loaded enough
// metadata to safely seek + play. Triggers received before this is true
// queue the most recent {trackId, when} and replay from loadedmetadata.
const metadataReady = new Map<number, boolean>();
const pendingFirstTrigger = new Map<number, { when: number }>();
let pendingTriggers: TriggerEvent[] = [];
let currentlyDisplayed: TriggerEvent | null = null;
let drawErrorLogged = false;
let storeUnsubscribe: (() => void) | null = null;
let cutSubdivisionUnsubscribe: (() => void) | null = null;
let boundaryEventId: number | null = null;
let prepareEventId: number | null = null;
let prepareEventBoundaryTime: number | null = null;
let preparedBoundary: { boundaryTime: number; event: TriggerEvent } | null = null;
let cutSubdivision: CutSubdivision = "8n";
let initialized = false;
let activeCanvas: HTMLCanvasElement | null = null;

export function setActiveCanvas(canvas: HTMLCanvasElement | null): void {
  activeCanvas = canvas;
}

export function getActiveCanvas(): HTMLCanvasElement | null {
  return activeCanvas;
}

function ensureHost(): HTMLDivElement {
  if (host) return host;
  host = document.createElement("div");
  host.setAttribute("data-hidden-videos", "true");
  host.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;";
  document.body.appendChild(host);
  return host;
}

export function setClipForTrack(trackId: number, clip: Clip | null): void {
  const existing = videos.get(trackId);
  if (existing) {
    existing.pause();
    existing.removeAttribute("src");
    existing.load();
    existing.remove();
    videos.delete(trackId);
    trims.delete(trackId);
    metadataReady.delete(trackId);
    pendingFirstTrigger.delete(trackId);
  }
  if (!clip) return;

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = clip.url;
  video.addEventListener("loadedmetadata", () => {
    metadataReady.set(trackId, true);
    const queued = pendingFirstTrigger.get(trackId);
    if (queued) {
      pendingFirstTrigger.delete(trackId);
      startPlayback(trackId, queued.when);
    }
  });
  ensureHost().appendChild(video);
  videos.set(trackId, video);
  trims.set(trackId, { startMs: clip.trimStartMs, endMs: clip.trimEndMs });
  metadataReady.set(trackId, false);
}

function isSameBoundary(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000001;
}

function isSameEvent(left: TriggerEvent | null, right: TriggerEvent | null): boolean {
  return (
    !!left &&
    !!right &&
    left.trackId === right.trackId &&
    isSameBoundary(left.startTime, right.startTime)
  );
}

function seekToTrimStart(trackId: number): boolean {
  const video = videos.get(trackId);
  const trim = trims.get(trackId);
  if (!video || !trim) return false;

  try {
    video.currentTime = trim.startMs / 1000;
  } catch {
    // currentTime can throw before metadata loads; later triggers retry.
  }
  return true;
}

function playTrack(trackId: number): void {
  const video = videos.get(trackId);
  if (!video) return;
  void video.play().catch(() => undefined);
}

function pauseTrack(trackId: number): void {
  videos.get(trackId)?.pause();
}

function startPlayback(trackId: number, when: number): void {
  if (!videos.has(trackId) || !trims.has(trackId)) return;

  const seek = () => seekToTrimStart(trackId);
  const play = () => playTrack(trackId);

  const draw = Tone.getDraw();
  const now = Tone.now();
  // Within (or past) the lookahead window: seek + play back-to-back on
  // the next audio-aligned tick. Preserves the pre-1.1 behavior for pad
  // clicks and live keyboard hits while the transport is stopped.
  if (when - now <= LOOKAHEAD_S) {
    draw.schedule(() => {
      seek();
      play();
    }, Math.max(when, now));
    return;
  }
  // Comfortable lead time: seek early so the decoder has time to settle,
  // then play exactly on the audio beat.
  draw.schedule(seek, when - LOOKAHEAD_S);
  draw.schedule(play, when);
}

function resolveBoundaryWinner(boundaryTime: number): TriggerEvent | null {
  const interval = subdivisionToSeconds(cutSubdivision);
  const contexts = readTrackContexts();
  const result = quantizeToBoundary(
    pendingTriggers,
    boundaryTime - interval,
    boundaryTime,
    contexts,
  );
  const holdMs = useAppStore.getState().project.sameTierHoldMs;
  const winner = pickWithDucking(
    result.consumed,
    currentlyDisplayed,
    boundaryTime,
    holdMs,
    contexts,
  );
  return isSameEvent(winner, currentlyDisplayed) ? null : winner;
}

export function prepareUpcoming(boundaryTime: number): void {
  if (preparedBoundary && isSameBoundary(preparedBoundary.boundaryTime, boundaryTime)) {
    return;
  }

  const winner = resolveBoundaryWinner(boundaryTime);
  if (!winner) return;
  if (!seekToTrimStart(winner.trackId)) return;

  playTrack(winner.trackId);
  preparedBoundary = { boundaryTime, event: winner };
}

// Schedule the underlying video element to seek+play at the requested audio
// time. While the Transport is running, push the event onto the pending queue
// so the next boundary callback picks the visible cut; while it's stopped,
// promote the trigger to the displayed event immediately (so pad clicks /
// keyboard hits show video) and skip the queue (which would otherwise leak).
export function trigger(trackId: number, when: number, displayStartTime = when): void {
  const trim = trims.get(trackId);
  if (!trim) return;

  const playing = useAppStore.getState().playback.isPlaying;
  const event: TriggerEvent = {
    trackId,
    startTime: playing ? when : displayStartTime,
    trimDurationMs: trim.endMs - trim.startMs,
  };
  if (playing) {
    pendingTriggers.push(event);
  } else {
    currentlyDisplayed = event;
  }

  if (metadataReady.get(trackId)) {
    startPlayback(trackId, when);
  } else {
    // Metadata isn't ready yet — keep only the latest trigger; the
    // loadedmetadata handler will replay it.
    pendingFirstTrigger.set(trackId, { when });
  }
}

function tagScore(trackId: number, contexts?: Map<number, TrackContext>): number {
  const tag = contexts?.get(trackId)?.tag ?? null;
  return TAG_PRIORITY[(tag ?? "untagged") as TagOrUntagged];
}

// Pure: pick the visually-winning event by tag priority, ties broken by
// most-recent startTime. Muted tracks are stripped before comparison.
export function pickActiveEvent(
  events: TriggerEvent[],
  contexts?: Map<number, TrackContext>,
): TriggerEvent | null {
  if (events.length === 0) return null;
  const eligible = events.filter((e) => !contexts?.get(e.trackId)?.muted);
  if (eligible.length === 0) return null;

  let winner = eligible[0];
  let winnerScore = tagScore(winner.trackId, contexts);
  for (let i = 1; i < eligible.length; i++) {
    const candidate = eligible[i];
    const candidateScore = tagScore(candidate.trackId, contexts);
    if (
      candidateScore > winnerScore ||
      (candidateScore === winnerScore && candidate.startTime > winner.startTime)
    ) {
      winner = candidate;
      winnerScore = candidateScore;
    }
  }
  return winner;
}

// Pure: same as pickActiveEvent but takes the currently-displayed event into
// account. If a candidate ties on priority tier with `current` AND the elapsed
// time since `current.startTime` is below the hold, we duck (keep current).
// Higher-tier candidates always win regardless of hold time.
export function pickWithDucking(
  candidates: TriggerEvent[],
  current: TriggerEvent | null,
  audioTime: number,
  sameTierHoldMs: number,
  contexts?: Map<number, TrackContext>,
): TriggerEvent | null {
  const winner = pickActiveEvent(candidates, contexts);
  if (!winner) return current;
  const activeCurrent =
    current &&
    current.trimDurationMs !== undefined &&
    audioTime >= current.startTime + current.trimDurationMs / 1000
      ? null
      : current;
  if (!activeCurrent) return winner;

  const winnerTier = tagScore(winner.trackId, contexts);
  const currentTier = tagScore(activeCurrent.trackId, contexts);
  if (winnerTier > currentTier) return winner;

  const elapsedMs = (audioTime - activeCurrent.startTime) * 1000;
  if (winnerTier === currentTier && elapsedMs < sameTierHoldMs) {
    return activeCurrent;
  }
  return winner;
}

// Pure: among triggers landing in (windowStart, windowEnd], pick the priority
// winner. The ducking layer (pickWithDucking) wraps this and may keep the
// previously-displayed event instead.
export function quantizeToBoundary(
  triggers: TriggerEvent[],
  windowStart: number,
  windowEnd: number,
  contexts: Map<number, TrackContext>,
): { winner: TriggerEvent | null; consumed: TriggerEvent[]; remaining: TriggerEvent[] } {
  const consumed: TriggerEvent[] = [];
  const remaining: TriggerEvent[] = [];
  for (const t of triggers) {
    if (t.startTime > windowStart && t.startTime <= windowEnd) consumed.push(t);
    else if (t.startTime > windowEnd) remaining.push(t);
    // else: events older than windowStart fell off; intentional.
  }
  return { winner: pickActiveEvent(consumed, contexts), consumed, remaining };
}

function readTrackContexts(): Map<number, TrackContext> {
  const map = new Map<number, TrackContext>();
  for (const track of useAppStore.getState().project.tracks) {
    map.set(track.id, { tag: track.tag, muted: track.muted });
  }
  return map;
}

// Boundary callback: decide what to display until the next boundary.
function onCutBoundary(boundaryTime: number): void {
  const interval = subdivisionToSeconds(cutSubdivision);
  const windowStart = boundaryTime - interval;
  const windowEnd = boundaryTime;
  const contexts = readTrackContexts();
  const result = quantizeToBoundary(pendingTriggers, windowStart, windowEnd, contexts);
  pendingTriggers = result.remaining;

  const holdMs = useAppStore.getState().project.sameTierHoldMs;
  const next = pickWithDucking(result.consumed, currentlyDisplayed, boundaryTime, holdMs, contexts);
  Tone.getDraw().schedule(() => {
    if (
      preparedBoundary &&
      isSameBoundary(preparedBoundary.boundaryTime, boundaryTime)
    ) {
      if (!isSameEvent(preparedBoundary.event, next)) {
        pauseTrack(preparedBoundary.event.trackId);
      }
      preparedBoundary = null;
    }
    currentlyDisplayed = next;
  }, boundaryTime);
}

function subdivisionToSeconds(value: CutSubdivision): number {
  const bpm = useAppStore.getState().project.bpm;
  const beatSeconds = 60 / bpm;
  switch (value) {
    case "16n":
      return beatSeconds / 4;
    case "8n":
      return beatSeconds / 2;
    case "4n":
      return beatSeconds;
    case "2n":
      return beatSeconds * 2;
    case "1m":
      return beatSeconds * 4;
  }
}

export function drawCurrentFrame(ctx: CanvasRenderingContext2D, audioTime: number): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const displayed = currentlyDisplayed;
  const video = displayed ? videos.get(displayed.trackId) : null;
  const trim = displayed ? trims.get(displayed.trackId) : null;

  if (displayed && trim) {
    const elapsedMs = (audioTime - displayed.startTime) * 1000;
    if (elapsedMs < 0) return;
  }

  if (!displayed || !video || !trim) {
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, w, h);
    return;
  }

  const trimDurationMs = trim.endMs - trim.startMs;
  const elapsedMs = (audioTime - displayed.startTime) * 1000;
  if (trimDurationMs <= 0 || elapsedMs >= trimDurationMs) {
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, w, h);
    video.pause();
    return;
  }
  if (video.readyState < HAVE_CURRENT_DATA || video.seeking) return;
  // Cameras typically negotiate 16:9 (e.g. 1280x720) even when we ask for
  // 1:1, so the raw video is wider than tall. Center-crop a square source
  // rect so we draw without horizontal squish on the 1:1 canvas.
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw === 0 || vh === 0) return;
  const side = Math.min(vw, vh);
  const sx = (vw - side) / 2;
  const sy = (vh - side) / 2;
  try {
    ctx.drawImage(video, sx, sy, side, side, 0, 0, w, h);
  } catch (err) {
    if (!drawErrorLogged) {
      drawErrorLogged = true;
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      logger.warn(LOG_EVENTS.VIDEO_DRAW_ERROR, {
        trackId: displayed.trackId,
        message,
      });
    }
  }
}

function disposeBoundaryEvent(): void {
  if (boundaryEventId !== null) {
    try {
      Tone.getTransport().clear(boundaryEventId);
    } catch {
      // Transport may have been torn down; safe to ignore.
    }
    boundaryEventId = null;
  }
}

function disposePrepareEvent(): void {
  if (prepareEventId !== null) {
    try {
      Tone.getTransport().clear(prepareEventId);
    } catch {
      // Transport may have been torn down; safe to ignore.
    }
    prepareEventId = null;
    prepareEventBoundaryTime = null;
  }
}

function schedulePrepareForBoundary(boundaryTime: number): void {
  if (
    (prepareEventBoundaryTime !== null &&
      isSameBoundary(prepareEventBoundaryTime, boundaryTime)) ||
    (preparedBoundary && isSameBoundary(preparedBoundary.boundaryTime, boundaryTime))
  ) {
    return;
  }

  disposePrepareEvent();
  prepareEventBoundaryTime = boundaryTime;
  prepareEventId = Tone.getTransport().scheduleOnce(() => {
    prepareEventId = null;
    prepareEventBoundaryTime = null;
    prepareUpcoming(boundaryTime);
  }, boundaryTime - LOOKAHEAD_S);
}

function scheduleBoundaryEvent(): void {
  disposeBoundaryEvent();
  disposePrepareEvent();
  boundaryEventId = Tone.getTransport().scheduleRepeat((time) => {
    const interval = subdivisionToSeconds(cutSubdivision);
    onCutBoundary(time);
    schedulePrepareForBoundary(time + interval);
  }, cutSubdivision);
}

export function setVideoCutSubdivision(value: CutSubdivision): void {
  if (value === cutSubdivision && boundaryEventId !== null) return;
  cutSubdivision = value;
  scheduleBoundaryEvent();
}

// Reset transient render state — used on stop/pause so we don't carry stale
// triggers into the next playback session.
export function resetPlaybackState(): void {
  disposePrepareEvent();
  pendingTriggers = [];
  currentlyDisplayed = null;
  preparedBoundary = null;
}

// Wires the engine to the store so hidden videos stay in sync with track clips.
export function initVideoEngine(): void {
  if (initialized) return;
  initialized = true;

  const tracks = useAppStore.getState().project.tracks;
  for (const track of tracks) {
    if (track.clip) setClipForTrack(track.id, track.clip);
  }

  let lastClips = new Map<number, Clip | null>();
  for (const track of tracks) lastClips.set(track.id, track.clip);

  storeUnsubscribe = useAppStore.subscribe((state) => {
    const next = new Map<number, Clip | null>();
    for (const track of state.project.tracks) {
      next.set(track.id, track.clip);
      const prev = lastClips.get(track.id) ?? null;
      if (track.clip !== prev) setClipForTrack(track.id, track.clip);
    }
    lastClips = next;
  });

  // Sync the cut subdivision from the store now and on every change.
  cutSubdivision = useAppStore.getState().project.cutSubdivision;
  scheduleBoundaryEvent();
  cutSubdivisionUnsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.project.cutSubdivision !== prev.project.cutSubdivision) {
      setVideoCutSubdivision(state.project.cutSubdivision);
    }
  });
}

// Test-only: read the currently-displayed event without going through the
// canvas draw path.
export function __getCurrentlyDisplayedForTesting(): TriggerEvent | null {
  return currentlyDisplayed;
}

// Test-only: jsdom never fires loadedmetadata on the synthetic <video>,
// so triggers stay queued in pendingFirstTrigger and the scheduler is
// never exercised. This seam lets the scheduling tests pretend metadata
// has loaded.
export function __markMetadataReadyForTesting(trackId: number): void {
  metadataReady.set(trackId, true);
  pendingFirstTrigger.delete(trackId);
}

// Test-only: inspect the pending-triggers queue length so we can guard the
// "no growth while transport is stopped" regression.
export function __getPendingTriggerCountForTesting(): number {
  return pendingTriggers.length;
}

export function __resetVideoEngineForTesting(): void {
  if (storeUnsubscribe) {
    storeUnsubscribe();
    storeUnsubscribe = null;
  }
  if (cutSubdivisionUnsubscribe) {
    cutSubdivisionUnsubscribe();
    cutSubdivisionUnsubscribe = null;
  }
  disposeBoundaryEvent();
  disposePrepareEvent();
  for (const video of videos.values()) video.remove();
  videos.clear();
  trims.clear();
  metadataReady.clear();
  pendingFirstTrigger.clear();
  pendingTriggers = [];
  currentlyDisplayed = null;
  preparedBoundary = null;
  drawErrorLogged = false;
  if (host) {
    host.remove();
    host = null;
  }
  initialized = false;
  cutSubdivision = "8n";
}
