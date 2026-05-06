// ABOUTME: videoEngine — owns hidden <video> elements per track and the canvas draw routine.
// ABOUTME: Step 19 uses naive most-recent-wins; the audio-clock-driven refactor lands in step 20.
import type { Clip } from "../types";
import { useAppStore } from "../store/useAppStore";

interface ActiveTrigger {
  trackId: number;
  startedAt: number;
  durationMs: number;
}

let host: HTMLDivElement | null = null;
const videos = new Map<number, HTMLVideoElement>();
const trims = new Map<number, { startMs: number; endMs: number }>();
let activeTrigger: ActiveTrigger | null = null;
let storeUnsubscribe: (() => void) | null = null;
let initialized = false;

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

export function trigger(trackId: number, _when: number): void {
  const video = videos.get(trackId);
  if (!video) return;
  const trim = trims.get(trackId);
  const startSeconds = trim ? trim.startMs / 1000 : 0;
  try {
    video.currentTime = startSeconds;
    void video.play();
  } catch {
    // currentTime can throw before metadata loads; later triggers succeed.
  }
  const durationMs = trim ? Math.max(50, trim.endMs - trim.startMs) : 1000;
  activeTrigger = { trackId, startedAt: performance.now(), durationMs };
}

export function drawCurrentFrame(ctx: CanvasRenderingContext2D, _audioTime: number): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, w, h);

  if (!activeTrigger) return;
  const elapsedMs = performance.now() - activeTrigger.startedAt;
  if (elapsedMs > activeTrigger.durationMs + 100) {
    activeTrigger = null;
    return;
  }
  const video = videos.get(activeTrigger.trackId);
  if (!video) return;
  ctx.drawImage(video, 0, 0, w, h);
}

// Wires the engine to the Zustand store: hidden videos stay in sync with each
// track's current clip. Idempotent.
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

export function __resetVideoEngineForTesting(): void {
  if (storeUnsubscribe) {
    storeUnsubscribe();
    storeUnsubscribe = null;
  }
  for (const video of videos.values()) video.remove();
  videos.clear();
  trims.clear();
  activeTrigger = null;
  if (host) {
    host.remove();
    host = null;
  }
  initialized = false;
}
