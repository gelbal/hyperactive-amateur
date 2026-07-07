// ABOUTME: Hidden muted video pool for Mood live-take canvas drawing.
// ABOUTME: Diffs live takes by id, pre-seeks boundary swaps, and exposes draw readiness guards.
import * as Tone from "tone";
import type { MoodPiece, MoodSelectionEntry } from "../types";
import { VIDEO_SEEK_LEAD_SECONDS } from "./videoTiming";

const HAVE_CURRENT_DATA = 2;

export interface MoodVideoPoolTake {
  takeId: string;
  url: string;
  loopStart: number;
  loopEnd: number;
}

interface PooledMoodVideo {
  video: HTMLVideoElement;
  url: string;
  loopStart: number;
  loopEnd: number;
  onTimeUpdate: () => void;
}

let host: HTMLDivElement | null = null;
const videos = new Map<string, PooledMoodVideo>();

function ensureHost(): HTMLDivElement {
  if (host) return host;
  host = document.createElement("div");
  host.setAttribute("data-hidden-mood-videos", "true");
  host.style.cssText =
    "position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;";
  document.body.appendChild(host);
  return host;
}

function seekToLoopStart(entry: PooledMoodVideo): boolean {
  try {
    entry.video.currentTime = entry.loopStart;
  } catch {
    // currentTime can throw before metadata loads; later boundary seeks retry.
  }
  return true;
}

function playVideo(entry: PooledMoodVideo): void {
  void entry.video.play().catch(() => undefined);
}

function loopTrimmedWindow(entry: PooledMoodVideo): void {
  if (entry.loopEnd <= entry.loopStart) {
    entry.video.pause();
    return;
  }

  if (entry.video.currentTime < entry.loopEnd) return;

  seekToLoopStart(entry);
  playVideo(entry);
}

function teardown(entry: PooledMoodVideo): void {
  entry.video.removeEventListener("timeupdate", entry.onTimeUpdate);
  entry.video.pause();
  entry.video.removeAttribute("src");
  entry.video.load();
  entry.video.remove();
}

function createEntry(take: MoodVideoPoolTake): PooledMoodVideo {
  const video = document.createElement("video");
  const entry: PooledMoodVideo = {
    video,
    url: take.url,
    loopStart: take.loopStart,
    loopEnd: take.loopEnd,
    onTimeUpdate: () => undefined,
  };
  entry.onTimeUpdate = () => loopTrimmedWindow(entry);

  video.muted = true;
  video.playsInline = true;
  video.loop = false;
  video.preload = "auto";
  video.src = take.url;
  video.addEventListener("timeupdate", entry.onTimeUpdate);
  ensureHost().appendChild(video);
  seekToLoopStart(entry);
  playVideo(entry);
  return entry;
}

export function syncPool(liveTakes: MoodVideoPoolTake[]): void {
  const nextIds = new Set(liveTakes.map((take) => take.takeId));

  for (const [takeId, entry] of videos) {
    if (nextIds.has(takeId)) continue;
    teardown(entry);
    videos.delete(takeId);
  }

  const seen = new Set<string>();
  for (const take of liveTakes) {
    if (seen.has(take.takeId)) continue;
    seen.add(take.takeId);

    const existing = videos.get(take.takeId);
    if (existing && existing.url === take.url) {
      existing.loopStart = take.loopStart;
      existing.loopEnd = take.loopEnd;
      continue;
    }

    if (existing) {
      teardown(existing);
    }
    videos.set(take.takeId, createEntry(take));
  }
}

export function liveTakesFromSelections(
  piece: MoodPiece,
  selections: Record<string, MoodSelectionEntry>,
): MoodVideoPoolTake[] {
  const live = new Map<string, MoodVideoPoolTake>();
  for (const mic of piece.mics) {
    const entry = selections[mic.id];
    if (!entry || entry === "off") continue;
    const take = mic.takes.find((candidate) => candidate.id === entry);
    if (!take) continue;
    live.set(take.id, {
      takeId: take.id,
      url: take.url,
      loopStart: take.trimStartMs / 1000,
      loopEnd: take.trimEndMs / 1000,
    });
  }
  return [...live.values()];
}

export function prepareUpcoming(takeId: string, atAudioTime: number): void {
  const entry = videos.get(takeId);
  if (!entry) return;

  const seekAndPlay = () => {
    seekToLoopStart(entry);
    playVideo(entry);
  };

  if (atAudioTime - Tone.now() <= VIDEO_SEEK_LEAD_SECONDS) {
    seekAndPlay();
    return;
  }

  Tone.getDraw().schedule(() => {
    seekAndPlay();
  }, atAudioTime - VIDEO_SEEK_LEAD_SECONDS);
}

export function videoForTake(takeId: string): HTMLVideoElement | null {
  return videos.get(takeId)?.video ?? null;
}

export function isVideoReadyForDraw(video: HTMLVideoElement): boolean {
  return (
    video.readyState >= HAVE_CURRENT_DATA &&
    !video.seeking &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  );
}

export function __resetMoodVideoPoolForTesting(): void {
  for (const entry of videos.values()) {
    teardown(entry);
  }
  videos.clear();
  host?.remove();
  host = null;
}
