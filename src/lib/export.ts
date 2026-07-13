// ABOUTME: export — combine the canvas captureStream and a tap of the Tone audio destination.
// ABOUTME: Also drives the full real-time render: Transport + MediaRecorder + progress + Blob.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import { stopPlayback } from "./audio";
import { ensureAudioRunning } from "./audioLifecycle";
import { timeoutAfter, waitMs } from "./async";
import { canStartAudibleAction } from "./audibleActionGate";
import { registerExportSession } from "./exportSession";
import { holdScreenWakeLock, type ScreenWakeLockHandle } from "./wakeLock";

const FRAMERATE = 30;
const EXPORT_STOP_TIMEOUT_MS = 5000;
const BEATS_PER_BAR = 4;
// Spec §18 holds the Mood export ceiling at 3:00 pending S6 thermal results.
export const MOOD_EXPORT_MAX_MS = 180_000;

type MaybePromise<T> = T | PromiseLike<T>;

export interface ExportDriveHooks {
  prepare?: () => MaybePromise<void>;
  start?: () => MaybePromise<void>;
  cleanup?: () => MaybePromise<void>;
}

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

interface ExportCommonOptions {
  // Caller-chosen MediaRecorder MIME. Use `detectSupportedFormats()` to find
  // a supported one; the export pipeline is codec-agnostic (canvas+audio go
  // in as raw streams) so any supported MIME works.
  mimeType: string;
  onProgress?: (fraction: number) => void;
  drive?: ExportDriveHooks;
}

interface BarsDurationExportOptions extends ExportCommonOptions {
  bars: number;
  bpm: number;
  durationMs?: never;
  stopSignal?: never;
  maxDurationMs?: never;
}

interface DurationMsExportOptions extends ExportCommonOptions {
  durationMs: number;
  bars?: never;
  bpm?: never;
  stopSignal?: never;
  maxDurationMs?: never;
}

interface StopSignalExportOptions extends ExportCommonOptions {
  stopSignal: PromiseLike<void>;
  maxDurationMs?: number;
  bars?: never;
  bpm?: never;
  durationMs?: never;
}

export type ExportOptions =
  | BarsDurationExportOptions
  | DurationMsExportOptions
  | StopSignalExportOptions;

export interface ExportResult extends Blob {
  readonly capped?: boolean;
}

export function getExportDurationMs(bars: number, bpm: number): number {
  return (bars * BEATS_PER_BAR * 60_000) / bpm;
}

function isStopSignalExport(options: ExportOptions): options is StopSignalExportOptions {
  return "stopSignal" in options;
}

function isDurationMsExport(options: ExportOptions): options is DurationMsExportOptions {
  return "durationMs" in options && typeof options.durationMs === "number";
}

function getRenderDurationMs(options: ExportOptions): number {
  if (isStopSignalExport(options)) return options.maxDurationMs ?? MOOD_EXPORT_MAX_MS;
  if (isDurationMsExport(options)) return options.durationMs;
  return getExportDurationMs(options.bars, options.bpm);
}

function createExportResult(blob: Blob, capped: boolean): ExportResult {
  Object.defineProperty(blob, "capped", {
    configurable: false,
    enumerable: true,
    value: capped,
    writable: false,
  });
  return blob as ExportResult;
}

function buildExportDrive(options: ExportOptions): Required<ExportDriveHooks> {
  const defaultDrive: Required<ExportDriveHooks> = isStopSignalExport(options)
    ? {
        prepare: () => undefined,
        start: () => undefined,
        cleanup: () => undefined,
      }
    : {
        prepare: () => {
          stopPlayback({ allowExportStop: true });
          useAppStore.getState().actions.setIsPlaying(true);
        },
        start: () => {
          Tone.getTransport().start();
        },
        cleanup: () => {
          stopPlayback({ allowExportStop: true });
        },
      };

  return {
    prepare: options.drive?.prepare ?? defaultDrive.prepare,
    start: options.drive?.start ?? defaultDrive.start,
    cleanup: options.drive?.cleanup ?? defaultDrive.cleanup,
  };
}

// Real-time render: starts the Transport at step 0 plus a MediaRecorder on the
// canvas+audio stream, runs for `bars` worth of milliseconds, and resolves
// with a single concatenated Blob.
export async function exportSong(
  canvas: HTMLCanvasElement,
  audioContext: AudioContext,
  options: ExportOptions,
): Promise<ExportResult> {
  const { mimeType, onProgress } = options;
  const stopSignalMode = isStopSignalExport(options);
  const durationMs = getRenderDurationMs(options);
  const drive = buildExportDrive(options);

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

    await Promise.race([Promise.resolve(drive.prepare()), exportAbort]);
    if (abortError) throw abortError;

    recorder.start(1000);
    await Promise.race([Promise.resolve(drive.start()), exportAbort]);
    if (abortError) throw abortError;

    const startedAt = Date.now();
    if (onProgress) {
      onProgress(0);
      progressTimer = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        onProgress(Math.min(1, elapsed / durationMs));
      }, 100);
    }

    const timedCompletion = waitMs(durationMs).then(() =>
      stopSignalMode ? ("max-duration" as const) : ("duration" as const),
    );
    const stopCompletion = stopSignalMode
      ? Promise.resolve(options.stopSignal).then(async () => {
          await Promise.resolve();
          if (abortError) throw abortError;
          return "stop" as const;
        })
      : null;
    const renderResult = await Promise.race([
      exportAbort,
      ...(stopCompletion ? [stopCompletion] : []),
      timedCompletion,
      recorderDone.then(() => "recorder" as const),
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

    return createExportResult(
      new Blob(chunks, { type: recorder.mimeType || mimeType }),
      renderResult === "max-duration",
    );
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
      await drive.cleanup();
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
