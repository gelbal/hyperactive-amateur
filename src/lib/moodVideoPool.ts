// ABOUTME: Hidden muted video pool for Mood live-take canvas drawing.
// ABOUTME: Diffs live takes by id, pre-seeks boundary swaps, and exposes draw readiness guards.
import * as Tone from "tone";
import type { MoodPiece, MoodSelectionEntry, MoodTake } from "../types";
import { takeLoopPeriod } from "./moodClock";
import { VIDEO_SEEK_LEAD_SECONDS } from "./videoTiming";

const HAVE_CURRENT_DATA = 2;
const LOOP_EPSILON_SECONDS = 1e-6;
// At its cut a prepared video plays from its held frame when that frame is
// this close to where the take's audio is; otherwise it seeks there first.
const JOIN_TOLERANCE_SECONDS = 0.05;

export interface MoodVideoPoolTake {
  takeId: string;
  url: string;
  loopStart: number;
  loopEnd: number;
  loopPeriod?: number;
  cycleMultiple?: MoodTake["cycleMultiple"];
  epoch?: number | null;
  // Sync Assist's nudge, as for the audio: positive starts the take later.
  syncOffsetMs?: number;
}

interface PooledMoodVideo {
  takeId: string;
  video: HTMLVideoElement;
  url: string;
  loopStart: number;
  loopEnd: number;
  effectiveLoopEnd: number;
  loopPeriod: number;
  cycleMultiple: MoodTake["cycleMultiple"];
  epoch: number | null;
  syncOffsetSeconds: number;
  holdingRest: boolean;
  playing: boolean;
  // Period-lock dedup: the index of the take's own loop period (which can be a
  // half-cycle for cycleMultiple 0.5), scoped to the epoch it was computed
  // under so a stop/restart re-seeks even inside the same period index.
  restartEpoch: number | null;
  lastPeriodIndex: number | null;
  // The audio time of the boundary this video is prepared to join at, held
  // on its first frame until then; null when it is not waiting for a cut.
  preparedFor: number | null;
  onTimeUpdate: () => void;
  onLoadedMetadata: () => void;
  onEnded: () => void;
}

let host: HTMLDivElement | null = null;
const videos = new Map<string, PooledMoodVideo>();
let capturePolicy: { active: boolean; metronomeTakeId: string | null } = {
  active: false,
  metronomeTakeId: null,
};
const pausedForCapture = new Set<string>();

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
    entry.holdingRest = false;
    entry.video.currentTime = entry.loopStart;
  } catch {
    // currentTime can throw before metadata loads; later boundary seeks retry.
  }
  return true;
}

function pauseVideo(entry: PooledMoodVideo): void {
  entry.playing = false;
  entry.video.pause();
}

function resumeVideo(entry: PooledMoodVideo): void {
  entry.holdingRest = false;
  entry.playing = true;
  void entry.video.play().catch(() => undefined);
}

function shouldPauseForCapture(entry: PooledMoodVideo): boolean {
  return capturePolicy.active && entry.takeId !== capturePolicy.metronomeTakeId;
}

function pauseForCapture(entry: PooledMoodVideo): void {
  if (pausedForCapture.has(entry.takeId)) {
    entry.playing = false;
    return;
  }
  pausedForCapture.add(entry.takeId);
  pauseVideo(entry);
}

function playVideo(entry: PooledMoodVideo): void {
  if (shouldPauseForCapture(entry)) {
    pauseForCapture(entry);
    return;
  }
  pausedForCapture.delete(entry.takeId);
  resumeVideo(entry);
}

function applyCapturePolicy(entry: PooledMoodVideo): void {
  if (shouldPauseForCapture(entry)) {
    pauseForCapture(entry);
    return;
  }
  if (pausedForCapture.has(entry.takeId)) {
    pausedForCapture.delete(entry.takeId);
    resumeVideo(entry);
  }
}

function fallbackLoopPeriod(take: MoodVideoPoolTake): number {
  return Math.max(take.loopEnd - take.loopStart, LOOP_EPSILON_SECONDS);
}

function updateEffectiveLoopEnd(entry: PooledMoodVideo): void {
  const duration = entry.video.duration;
  entry.effectiveLoopEnd =
    Number.isFinite(duration) && duration > 0
      ? Math.min(entry.loopEnd, duration)
      : entry.loopEnd;
}

function contentFillsPeriod(entry: PooledMoodVideo): boolean {
  return entry.effectiveLoopEnd - entry.loopStart >= entry.loopPeriod - LOOP_EPSILON_SECONDS;
}

function holdAtContentEnd(entry: PooledMoodVideo): void {
  if (entry.holdingRest) return;
  entry.holdingRest = true;
  try {
    entry.video.currentTime = entry.effectiveLoopEnd;
  } catch {
    // Holding at the current decoded frame is still preferable to a content-loop seek.
  }
  pauseVideo(entry);
}

// How far the take has played at audioTime: phase-locked to the epoch and
// shifted by its sync offset, exactly as its audio player is.
function takeTimeAt(entry: PooledMoodVideo, audioTime: number, epoch: number): number {
  return audioTime - epoch - entry.syncOffsetSeconds;
}

// The index of the take's OWN loop period at audioTime, phase-locked to the
// epoch. loopPeriod = cycleMultiple × cycleSeconds, so this correctly counts
// half-cycle periods (0.5) as well as multi-cycle ones (2, 4).
function periodIndexAt(entry: PooledMoodVideo, audioTime: number, epoch: number): number {
  return Math.floor(takeTimeAt(entry, audioTime, epoch) / entry.loopPeriod + LOOP_EPSILON_SECONDS);
}

// Where the take's audio is at audioTime: the same epoch phase in its loop
// period, as a video position, and whether that falls in the period's rest.
function phasePositionAt(
  entry: PooledMoodVideo,
  audioTime: number,
  epoch: number,
): { position: number; inRest: boolean } {
  const periodIndex = periodIndexAt(entry, audioTime, epoch);
  const phase = Math.max(0, takeTimeAt(entry, audioTime, epoch) - periodIndex * entry.loopPeriod);
  updateEffectiveLoopEnd(entry);
  const position = entry.loopStart + phase;
  return {
    position,
    inRest: phase > LOOP_EPSILON_SECONDS && position >= entry.effectiveLoopEnd,
  };
}

// Seeks to where the take's audio is at audioTime. A multi-cycle take can
// join mid-period; past its content the period rests, so the video holds its
// last frame. With play false the video is held on that frame (a pre-roll).
function seekToPhase(
  entry: PooledMoodVideo,
  audioTime: number,
  epoch: number | null,
  play = true,
): void {
  if (epoch === null) {
    seekToLoopStart(entry);
    if (play) playVideo(entry);
    else pauseVideo(entry);
    return;
  }
  const { position, inRest } = phasePositionAt(entry, audioTime, epoch);
  if (inRest) {
    holdAtContentEnd(entry);
    return;
  }
  entry.holdingRest = false;
  try {
    entry.video.currentTime = position;
  } catch {
    // currentTime can throw before metadata loads; later boundary seeks retry.
  }
  if (play) playVideo(entry);
  else pauseVideo(entry);
}

// A prepared video's cut: it plays on from the frame it was held on, which
// is where its audio starts (up to a frame late); if that pre-roll never
// landed it seeks there first.
function startPreparedJoin(entry: PooledMoodVideo, audioTime: number, epoch: number): void {
  entry.preparedFor = null;
  entry.lastPeriodIndex = periodIndexAt(entry, audioTime, epoch);
  const { position, inRest } = phasePositionAt(entry, audioTime, epoch);
  if (
    !inRest &&
    !entry.holdingRest &&
    Math.abs(entry.video.currentTime - position) <= JOIN_TOLERANCE_SECONDS
  ) {
    playVideo(entry);
    return;
  }
  seekToPhase(entry, audioTime, epoch);
}

function loopTrimmedWindow(entry: PooledMoodVideo): void {
  updateEffectiveLoopEnd(entry);
  if (entry.effectiveLoopEnd <= entry.loopStart) {
    pauseVideo(entry);
    return;
  }

  if (entry.video.currentTime < entry.effectiveLoopEnd) return;

  if (!contentFillsPeriod(entry)) {
    holdAtContentEnd(entry);
    return;
  }

  seekToLoopStart(entry);
  playVideo(entry);
}

function teardown(entry: PooledMoodVideo): void {
  entry.video.removeEventListener("timeupdate", entry.onTimeUpdate);
  entry.video.removeEventListener("loadedmetadata", entry.onLoadedMetadata);
  entry.video.removeEventListener("ended", entry.onEnded);
  pausedForCapture.delete(entry.takeId);
  pauseVideo(entry);
  entry.video.removeAttribute("src");
  entry.video.load();
  entry.video.remove();
}

function createEntry(take: MoodVideoPoolTake): PooledMoodVideo {
  const video = document.createElement("video");
  const entry: PooledMoodVideo = {
    takeId: take.takeId,
    video,
    url: take.url,
    loopStart: take.loopStart,
    loopEnd: take.loopEnd,
    effectiveLoopEnd: take.loopEnd,
    loopPeriod: take.loopPeriod ?? fallbackLoopPeriod(take),
    cycleMultiple: take.cycleMultiple ?? 1,
    epoch: take.epoch ?? null,
    syncOffsetSeconds: (take.syncOffsetMs ?? 0) / 1000,
    holdingRest: false,
    playing: false,
    restartEpoch: null,
    lastPeriodIndex: null,
    preparedFor: null,
    onTimeUpdate: () => undefined,
    onLoadedMetadata: () => undefined,
    onEnded: () => undefined,
  };
  entry.onTimeUpdate = () => loopTrimmedWindow(entry);
  entry.onLoadedMetadata = () => updateEffectiveLoopEnd(entry);
  entry.onEnded = () => {
    updateEffectiveLoopEnd(entry);
    if (contentFillsPeriod(entry)) {
      seekToLoopStart(entry);
      playVideo(entry);
      return;
    }
    holdAtContentEnd(entry);
  };

  video.muted = true;
  video.playsInline = true;
  video.loop = false;
  video.preload = "auto";
  video.src = take.url;
  video.addEventListener("timeupdate", entry.onTimeUpdate);
  video.addEventListener("loadedmetadata", entry.onLoadedMetadata);
  video.addEventListener("ended", entry.onEnded);
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
      existing.loopPeriod = take.loopPeriod ?? fallbackLoopPeriod(take);
      existing.cycleMultiple = take.cycleMultiple ?? 1;
      existing.epoch = take.epoch ?? null;
      const syncOffsetSeconds = (take.syncOffsetMs ?? 0) / 1000;
      if (existing.syncOffsetSeconds !== syncOffsetSeconds) {
        // A re-synced take re-seeks on the next restart check, in step with
        // its audio.
        existing.syncOffsetSeconds = syncOffsetSeconds;
        existing.lastPeriodIndex = null;
      }
      updateEffectiveLoopEnd(existing);
      applyCapturePolicy(existing);
      continue;
    }

    if (existing) {
      teardown(existing);
    }
    videos.set(take.takeId, createEntry(take));
  }
}

export function setCaptureVideoPolicy(
  active: boolean,
  metronomeTakeId: string | null = null,
): void {
  capturePolicy = {
    active,
    metronomeTakeId: active ? metronomeTakeId : null,
  };

  if (!active) {
    const pausedIds = [...pausedForCapture];
    for (const takeId of pausedIds) {
      const entry = videos.get(takeId);
      if (!entry) {
        pausedForCapture.delete(takeId);
        continue;
      }
      playVideo(entry);
    }
    return;
  }

  for (const entry of videos.values()) {
    applyCapturePolicy(entry);
  }
}

export function liveTakesFromSelections(
  piece: MoodPiece,
  selections: Record<string, MoodSelectionEntry>,
  epoch: number | null = null,
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
      loopPeriod:
        piece.cycleSeconds === null
          ? Math.max(take.trimEndMs / 1000 - take.trimStartMs / 1000, LOOP_EPSILON_SECONDS)
          : takeLoopPeriod(take.cycleMultiple, piece.cycleSeconds),
      cycleMultiple: take.cycleMultiple,
      epoch,
      syncOffsetMs: take.syncOffsetMs,
    });
  }
  return [...live.values()];
}

export function restartVideosAtPeriodBoundary(audioTime: number, epoch: number): void {
  for (const entry of videos.values()) {
    // A new performance epoch resets the dedup so the first period of the new
    // run always re-seeks, even if it lands on the same index as the old run.
    if (entry.restartEpoch !== epoch) {
      entry.restartEpoch = epoch;
      entry.lastPeriodIndex = null;
    }
    // A prepared join waits, held on its first frame, for its cut.
    if (entry.preparedFor !== null) {
      if (audioTime < entry.preparedFor) continue;
      startPreparedJoin(entry, audioTime, epoch);
      continue;
    }
    // Index -1 is a take synced to start later, still in its previous pass.
    const periodIndex = periodIndexAt(entry, audioTime, epoch);
    if (entry.lastPeriodIndex === periodIndex) continue;
    entry.lastPeriodIndex = periodIndex;
    seekToPhase(entry, audioTime, epoch);
  }
}

// Pre-rolls a video that joins at atAudioTime: a lead ahead it seeks to the
// frame its audio starts on and holds there, so the cut plays a decoded
// frame in step with the sound.
export function prepareUpcoming(takeId: string, atAudioTime: number): void {
  const entry = videos.get(takeId);
  if (!entry) return;
  entry.preparedFor = atAudioTime;

  const preroll = () => {
    // A later arm re-prepared this video for another boundary.
    if (entry.preparedFor !== atAudioTime) return;
    seekToPhase(entry, atAudioTime, entry.epoch, false);
  };

  if (atAudioTime - Tone.now() <= VIDEO_SEEK_LEAD_SECONDS) {
    preroll();
    return;
  }

  Tone.getDraw().schedule(preroll, atAudioTime - VIDEO_SEEK_LEAD_SECONDS);
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
  capturePolicy = { active: false, metronomeTakeId: null };
  pausedForCapture.clear();
  host?.remove();
  host = null;
}

export function __getMoodVideoPoolStateForTesting(): Array<{
  takeId: string;
  playing: boolean;
  pausedForCapture: boolean;
}> {
  return [...videos.values()].map((entry) => ({
    takeId: entry.takeId,
    playing: entry.playing,
    pausedForCapture: pausedForCapture.has(entry.takeId),
  }));
}
