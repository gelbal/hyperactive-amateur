// ABOUTME: videoEngine — hidden <video> elements per track + quantized canvas renderer.
// ABOUTME: Cut decisions land on cutSubdivision boundaries; audio playback path is unchanged.
import * as Tone from "tone";
import type { Clip, CutSubdivision, Tag } from "../types";
import { useAppStore } from "../store/useAppStore";

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
}

let host: HTMLDivElement | null = null;
const videos = new Map<number, HTMLVideoElement>();
const trims = new Map<number, { startMs: number; endMs: number }>();
let pendingTriggers: TriggerEvent[] = [];
let currentlyDisplayed: TriggerEvent | null = null;
let storeUnsubscribe: (() => void) | null = null;
let cutSubdivisionUnsubscribe: (() => void) | null = null;
let boundaryEventId: number | null = null;
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
  }
  if (!clip) return;

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = clip.url;
  ensureHost().appendChild(video);
  videos.set(trackId, video);
  trims.set(trackId, { startMs: clip.trimStartMs, endMs: clip.trimEndMs });
}

// Push a new trigger onto the pending queue and schedule the underlying video
// element to seek+play at the requested audio time. The visible cut is decided
// later, at the next boundary callback.
export function trigger(trackId: number, when: number): void {
  const trim = trims.get(trackId);
  if (!trim) return;

  pendingTriggers.push({ trackId, startTime: when });

  const delaySeconds = Math.max(0, when - Tone.now());
  const start = () => {
    const video = videos.get(trackId);
    if (!video) return;
    try {
      video.currentTime = trim.startMs / 1000;
    } catch {
      // currentTime can throw before metadata loads; later triggers retry.
    }
    void video.play().catch(() => undefined);
  };
  if (delaySeconds <= 0) start();
  else setTimeout(start, delaySeconds * 1000);

  // Live triggers (pad clicks, keyboard hits) when the Transport isn't
  // running won't get picked up by the boundary scheduleRepeat callback.
  // Show them immediately so the canvas reflects the user's input.
  const playing = useAppStore.getState().playback.isPlaying;
  if (!playing) {
    currentlyDisplayed = { trackId, startTime: when };
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
  if (!current) return winner;

  const winnerTier = tagScore(winner.trackId, contexts);
  const currentTier = tagScore(current.trackId, contexts);
  if (winnerTier > currentTier) return winner;

  const elapsedMs = (audioTime - current.startTime) * 1000;
  if (winnerTier === currentTier && elapsedMs < sameTierHoldMs) {
    return current;
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
  currentlyDisplayed = next;
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

export function drawCurrentFrame(ctx: CanvasRenderingContext2D, _audioTime: number): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, w, h);

  if (!currentlyDisplayed) return;
  const video = videos.get(currentlyDisplayed.trackId);
  if (!video) return;
  ctx.drawImage(video, 0, 0, w, h);
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

function scheduleBoundaryEvent(): void {
  disposeBoundaryEvent();
  boundaryEventId = Tone.getTransport().scheduleRepeat((time) => {
    onCutBoundary(time);
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
  pendingTriggers = [];
  currentlyDisplayed = null;
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
  for (const video of videos.values()) video.remove();
  videos.clear();
  trims.clear();
  pendingTriggers = [];
  currentlyDisplayed = null;
  if (host) {
    host.remove();
    host = null;
  }
  initialized = false;
  cutSubdivision = "8n";
}
