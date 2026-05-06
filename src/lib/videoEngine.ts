// ABOUTME: videoEngine — hidden <video> elements per track + scheduled-event canvas renderer.
// ABOUTME: Render decisions read the audio clock (Tone.now seconds) so A/V stays locked.
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
  startTime: number; // audio context seconds (Tone.now base)
  endTime: number;
}

const GC_GRACE_SECONDS = 0.5;

let host: HTMLDivElement | null = null;
const videos = new Map<number, HTMLVideoElement>();
const trims = new Map<number, { startMs: number; endMs: number }>();
let triggers: TriggerEvent[] = [];
let storeUnsubscribe: (() => void) | null = null;
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

// Schedule a trigger event for the renderer to consume. `when` is in audio
// context seconds (Tone.now base). Also queues the actual <video> playback to
// start at the same wall-clock moment.
export function trigger(trackId: number, when: number): void {
  const trim = trims.get(trackId);
  if (!trim) return;
  const durationSeconds = Math.max(0.05, (trim.endMs - trim.startMs) / 1000);

  triggers.push({
    trackId,
    startTime: when,
    endTime: when + durationSeconds,
  });

  const delaySeconds = Math.max(0, when - Tone.now());
  const start = () => {
    const video = videos.get(trackId);
    if (!video) return;
    try {
      video.currentTime = trim.startMs / 1000;
    } catch {
      // currentTime can throw before metadata loads; the next trigger will retry.
    }
    void video.play().catch(() => undefined);
  };
  if (delaySeconds <= 0) start();
  else setTimeout(start, delaySeconds * 1000);
}

// Pure: drop trigger events whose endTime is well in the past.
export function gcEvents(events: TriggerEvent[], audioTime: number): TriggerEvent[] {
  const cutoff = audioTime - GC_GRACE_SECONDS;
  return events.filter((e) => e.endTime >= cutoff);
}

// Pure: which events should be visible at a given audio time. Muted tracks
// are filtered out as defense in depth.
export function findActiveEvents(
  events: TriggerEvent[],
  audioTime: number,
  contexts?: Map<number, TrackContext>,
): TriggerEvent[] {
  return events.filter((e) => {
    if (e.startTime > audioTime || audioTime > e.endTime) return false;
    const ctx = contexts?.get(e.trackId);
    if (ctx?.muted) return false;
    return true;
  });
}

// Pure: pick the visually-winning event by tag priority, ties broken by
// most-recent startTime.
export function pickActiveEvent(
  events: TriggerEvent[],
  contexts?: Map<number, TrackContext>,
): TriggerEvent | null {
  if (events.length === 0) return null;

  const score = (e: TriggerEvent): number => {
    const tag = contexts?.get(e.trackId)?.tag ?? null;
    return TAG_PRIORITY[(tag ?? "untagged") as TagOrUntagged];
  };

  let winner = events[0];
  let winnerScore = score(winner);
  for (let i = 1; i < events.length; i++) {
    const candidate = events[i];
    const candidateScore = score(candidate);
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

function readTrackContexts(): Map<number, TrackContext> {
  const map = new Map<number, TrackContext>();
  for (const track of useAppStore.getState().project.tracks) {
    map.set(track.id, { tag: track.tag, muted: track.muted });
  }
  return map;
}

export function drawCurrentFrame(ctx: CanvasRenderingContext2D, audioTime: number): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  triggers = gcEvents(triggers, audioTime);

  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, w, h);

  const contexts = readTrackContexts();
  const active = findActiveEvents(triggers, audioTime, contexts);
  const winner = pickActiveEvent(active, contexts);
  if (!winner) return;
  const video = videos.get(winner.trackId);
  if (!video) return;
  ctx.drawImage(video, 0, 0, w, h);
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
}

// Stub for v1.1-4 — wired up in v1.1-5 with the boundary scheduleRepeat.
export function setVideoCutSubdivision(_value: CutSubdivision): void {
  // intentionally no-op until the boundary scheduler lands.
}

export function getDebugInfo(): { activeEvents: TriggerEvent[]; audioTime: number } {
  const audioTime = Tone.now();
  return {
    activeEvents: findActiveEvents(triggers, audioTime, readTrackContexts()),
    audioTime,
  };
}

export function __resetVideoEngineForTesting(): void {
  if (storeUnsubscribe) {
    storeUnsubscribe();
    storeUnsubscribe = null;
  }
  for (const video of videos.values()) video.remove();
  videos.clear();
  trims.clear();
  triggers = [];
  if (host) {
    host.remove();
    host = null;
  }
  initialized = false;
}
