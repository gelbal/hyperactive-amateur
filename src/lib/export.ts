// ABOUTME: export — combine the canvas captureStream and a tap of the Tone audio destination.
// ABOUTME: Also drives the full real-time render: Transport + MediaRecorder + progress + Blob.
import * as Tone from "tone";

const FRAMERATE = 30;

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

  const { stream, cleanup } = buildExportStream(canvas, audioContext);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (event) => {
      const err = (event as ErrorEvent).error ?? new Error("MediaRecorder error");
      reject(err instanceof Error ? err : new Error(String(err)));
    };
  });

  const transport = Tone.getTransport();
  transport.stop();
  transport.position = 0;

  recorder.start();
  transport.start();

  const startedAt = Date.now();
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  if (onProgress) {
    onProgress(0);
    progressTimer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      onProgress(Math.min(1, elapsed / durationMs));
    }, 100);
  }

  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
  if (progressTimer) clearInterval(progressTimer);
  onProgress?.(1);

  transport.stop();
  if (recorder.state !== "inactive") recorder.stop();
  await stopped;

  cleanup();
  return new Blob(chunks, { type: mimeType });
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
