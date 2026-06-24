// ABOUTME: export — combine the canvas captureStream and a tap of the Tone audio destination.
// ABOUTME: Also drives the full real-time render: Transport + MediaRecorder + progress + Blob.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import { ensureAudioStarted, stopPlayback } from "./audio";
import { timeoutAfter, waitMs } from "./async";

const FRAMERATE = 30;
const EXPORT_STOP_TIMEOUT_MS = 5000;

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
}

// Real-time render: starts the Transport at step 0 plus a MediaRecorder on the
// canvas+audio stream, runs for `bars` worth of milliseconds, and resolves
// with a single concatenated Blob.
export async function exportSong(
  canvas: HTMLCanvasElement,
  audioContext: AudioContext,
  options: ExportOptions,
): Promise<Blob> {
  const { bars, bpm, mimeType, onProgress } = options;
  const durationMs = (bars * 4 * 60_000) / bpm;

  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let exportStream: ExportStream | null = null;
  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];

  try {
    await ensureAudioStarted();
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

    stopPlayback();
    useAppStore.getState().actions.setIsExporting(true);
    useAppStore.getState().actions.setIsPlaying(true);
    const transport = Tone.getTransport();

    recorder.start(1000);
    transport.start();

    const startedAt = Date.now();
    if (onProgress) {
      onProgress(0);
      progressTimer = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        onProgress(Math.min(1, elapsed / durationMs));
      }, 100);
    }

    const renderResult = await Promise.race([
      waitMs(durationMs).then(() => "duration" as const),
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
    ]);
    if (recorderError) throw recorderError;

    if (chunks.length === 0) {
      throw new Error("MediaRecorder finished export without producing data.");
    }

    return new Blob(chunks, { type: mimeType });
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Recorder may already be inactive or in the middle of stopping.
      }
    }
    stopPlayback();
    useAppStore.getState().actions.setIsExporting(false);
    exportStream?.cleanup();
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function defaultExportFilename(extension = "webm"): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `hyperactive-amateur-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}.${extension}`;
}
