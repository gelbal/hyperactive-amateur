// ABOUTME: export — combine the canvas captureStream and a tap of the Tone audio destination.
// ABOUTME: Also drives the full real-time render: Transport + MediaRecorder + progress + Blob.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import { stopPlayback } from "./audio";
import { ensureAudioRunning } from "./audioLifecycle";
import { timeoutAfter, waitMs } from "./async";
import { canStartAudibleAction } from "./audibleActionGate";
import { registerExportSession } from "./exportSession";
import { LOG_EVENTS, logger } from "./logger";
import { holdShareCard } from "./videoEngine";
import { holdScreenWakeLock, type ScreenWakeLockHandle } from "./wakeLock";

const FRAMERATE = 30;
const EXPORT_STOP_TIMEOUT_MS = 5000;
const BEATS_PER_BAR = 4;
// How long a render waits for the share card composed while the panel was
// open; a later card loses to the flat fallback.
export const COVER_WAIT_MS = 3000;

export interface ExportStream {
  stream: MediaStream;
  cleanup: () => void;
}

export function buildExportStream(
  canvas: HTMLCanvasElement,
  audioContext: AudioContext,
): ExportStream {
  const canvasStream = canvas.captureStream(FRAMERATE);
  const dest = audioContext.createMediaStreamDestination();
  // Tone routes audio through Tone.getDestination(); connecting it to our
  // recording destination ADDS a tap, it does not replace speaker output.
  Tone.getDestination().connect(dest);

  const videoTrack = canvasStream.getVideoTracks()[0];
  const audioTrack = dest.stream.getAudioTracks()[0];
  const tracks: MediaStreamTrack[] = [];
  if (videoTrack) tracks.push(videoTrack);
  if (audioTrack) tracks.push(audioTrack);
  const stream = new MediaStream(tracks);

  const cleanup = () => {
    try {
      Tone.getDestination().disconnect(dest);
    } catch {
      // disconnect throws if the connection was already torn down.
    }
    for (const track of stream.getTracks()) track.stop();
    for (const track of canvasStream.getTracks()) track.stop();
  };

  return { stream, cleanup };
}

export interface ExportOptions {
  bars: number;
  bpm: number;
  // Caller-chosen MediaRecorder MIME. Use `detectSupportedFormats()` to find
  // a supported one; the export pipeline is codec-agnostic (canvas+audio go
  // in as raw streams) so any supported MIME works.
  mimeType: string;
  onProgress?: (fraction: number) => void;
  // The share card for frame 0, composed from tiles loaded while the panel
  // was open. The render waits at most COVER_WAIT_MS for it; null means no
  // card was composed.
  cover?: Promise<HTMLCanvasElement | null>;
  // The flat card (no tiles), composed synchronously at Render: frame 0 when
  // the cover is late.
  coverFallback?: HTMLCanvasElement;
}

export function getExportDurationMs(bars: number, bpm: number): number {
  return (bars * BEATS_PER_BAR * 60_000) / bpm;
}

// One silent beat on the share card before step 0.
export function getShareCardHoldMs(bpm: number): number {
  return 60_000 / bpm;
}

// Rewinds to step 0 in playing mode and, with a card, holds it on the render
// canvas and paints it now, so the recorder's first frame is the card.
function prepareTransport(canvas: HTMLCanvasElement, card: HTMLCanvasElement | null): void {
  stopPlayback({ allowExportStop: true });
  useAppStore.getState().actions.setIsPlaying(true);
  if (!card) return;
  holdShareCard(card);
  canvas.getContext("2d")?.drawImage(card, 0, 0, canvas.width, canvas.height);
}

// Step 0 lands one hold after now on the audio clock, and the music stops at
// the last bar line on that clock, so the recording's lookahead tail catches
// only ringing sound, never the next loop's downbeat.
function startTransport(holdMs: number, durationMs: number): void {
  const transport = Tone.getTransport();
  const startAt = Tone.now() + holdMs / 1000;
  transport.start(startAt);
  transport.stop(startAt + durationMs / 1000);
}

// Real-time render: starts the Transport at step 0 plus a MediaRecorder on the
// canvas+audio stream, runs for `bars` worth of milliseconds, and resolves
// with a single concatenated Blob.
export async function exportSong(
  canvas: HTMLCanvasElement,
  audioContext: AudioContext,
  options: ExportOptions,
): Promise<Blob> {
  const { bars, bpm, mimeType, onProgress, cover, coverFallback } = options;
  const durationMs = getExportDurationMs(bars, bpm);

  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let exportStream: ExportStream | null = null;
  let recorder: MediaRecorder | null = null;
  let wakeLock: ScreenWakeLockHandle | null = null;
  let unregisterExportSession: (() => void) | null = null;
  let ownsExportSession = false;
  const chunks: Blob[] = [];

  try {
    if (!canStartAudibleAction(useAppStore.getState())) {
      throw new Error("Cannot export while recording or another export is active.");
    }

    let abortExport: (reason: string) => void = () => undefined;
    let abortError: Error | null = null;
    const exportAbort = new Promise<never>((_, reject) => {
      abortExport = (reason: string) => {
        abortError = new Error(reason);
        reject(abortError);
      };
    });
    // Observe the rejection immediately: an abort landing while no race below
    // is pending must not surface as an unhandled rejection.
    exportAbort.catch(() => undefined);
    unregisterExportSession = registerExportSession({ abort: abortExport });
    if (!unregisterExportSession) {
      throw new Error("Another export render is already active.");
    }
    ownsExportSession = true;
    useAppStore.getState().actions.setIsExporting(true);

    // The abort races every setup await so pagehide/audio interruption can
    // stop the render before any stream or transport work begins.
    const wakeLockPromise = holdScreenWakeLock();
    try {
      wakeLock = await Promise.race([wakeLockPromise, exportAbort]);
    } catch (err) {
      // A wake lock granted after the abort must still be released.
      void wakeLockPromise.then((handle) => void handle.release());
      throw err;
    }
    if (abortError) throw abortError;
    await Promise.race([ensureAudioRunning(), exportAbort]);
    if (abortError) throw abortError;
    // The card loads inside the session, so an abort ends the wait; nothing
    // is captured yet and the transport is stopped. A late or failed card
    // gives way to the flat fallback rather than failing the render.
    const coverResult = cover
      ? await Promise.race([
          cover.catch(() => "failed" as const),
          waitMs(COVER_WAIT_MS).then(() => "late" as const),
          exportAbort,
        ])
      : null;
    if (abortError) throw abortError;
    if (coverResult === "late") logger.warn(LOG_EVENTS.COVER_LATE, { waitedMs: COVER_WAIT_MS });
    if (coverResult === "failed") logger.warn(LOG_EVENTS.COVER_FAILED, { stage: "compose" });
    const readyCard = coverResult === "late" || coverResult === "failed" ? null : coverResult;
    const card = readyCard ?? coverFallback ?? null;
    const holdMs = card ? getShareCardHoldMs(bpm) : 0;
    // Step 0 sounds one lookahead after the transport starts, so the last
    // bar ends that much later too.
    const renderMs = durationMs + holdMs + Tone.getContext().lookAhead * 1000;
    exportStream = buildExportStream(canvas, audioContext);
    recorder = new MediaRecorder(exportStream.stream, {
      mimeType,
      videoBitsPerSecond: 4_000_000,
    });

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    let recorderError: Error | null = null;
    const recorderDone = new Promise<void>((resolve) => {
      if (!recorder) {
        recorderError = new Error("MediaRecorder was not initialized");
        resolve();
        return;
      }
      recorder.onstop = () => resolve();
      recorder.onerror = (event) => {
        const err = (event as ErrorEvent).error ?? new Error("MediaRecorder error");
        recorderError = err instanceof Error ? err : new Error(String(err));
        resolve();
      };
    });

    prepareTransport(canvas, card);
    recorder.start(1000);
    startTransport(holdMs, durationMs);

    const startedAt = Date.now();
    if (onProgress) {
      onProgress(0);
      progressTimer = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        onProgress(Math.min(1, elapsed / renderMs));
      }, 100);
    }

    const renderResult = await Promise.race([
      waitMs(renderMs).then(() => "duration" as const),
      recorderDone.then(() => "recorder" as const),
      exportAbort,
    ]);
    if (renderResult === "recorder") {
      if (recorderError) throw recorderError;
      throw new Error("MediaRecorder stopped before export finished.");
    }
    onProgress?.(1);

    if (typeof recorder.requestData === "function") recorder.requestData();
    if (recorder.state !== "inactive") recorder.stop();
    await Promise.race([
      recorderDone,
      timeoutAfter(EXPORT_STOP_TIMEOUT_MS, "MediaRecorder did not finish export after stop."),
      exportAbort,
    ]);
    if (recorderError) throw recorderError;

    if (chunks.length === 0) {
      throw new Error("MediaRecorder finished export without producing data.");
    }

    return new Blob(chunks, { type: recorder.mimeType || mimeType });
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    await wakeLock?.release();
    if (ownsExportSession) {
      unregisterExportSession?.();
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Recorder may already be inactive or in the middle of stopping.
        }
      }
      stopPlayback({ allowExportStop: true });
      useAppStore.getState().actions.setIsExporting(false);
      exportStream?.cleanup();
    }
  }
}

// Creates a download URL and synthetic anchor click; the caller owns revocation.
export function downloadBlob(blob: Blob, filename: string): string {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return url;
}

// Shares the rendered blob as a named File so mobile share sheets receive media.
export async function shareBlob(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  await navigator.share({ files: [file] });
}

export function defaultExportFilename(extension = "webm"): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `hyperactive-amateur-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}.${extension}`;
}
