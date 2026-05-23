// ABOUTME: recordClip — record a fixed-duration WebM clip from a MediaStream and decode its audio.
// ABOUTME: Returns the blob plus a pre-decoded AudioBuffer for low-latency Tone.Player playback.
import { onMediaRecorderError } from "./streamLifecycle";

export interface RecordingResult {
  blob: Blob;
  audioBuffer: AudioBuffer;
  durationMs: number;
}

const PREFERRED_MIME = "video/webm; codecs=vp9,opus";
const FALLBACK_MIME = "video/webm";

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return PREFERRED_MIME;
  if (MediaRecorder.isTypeSupported(PREFERRED_MIME)) return PREFERRED_MIME;
  return FALLBACK_MIME;
}

export interface RecordClipOptions {
  // When this fires, stop the recorder early and reject with AbortError.
  // Callers should not save the resulting (partial) blob.
  signal?: AbortSignal;
}

export async function recordClip(
  stream: MediaStream,
  durationMs: number,
  audioContext: AudioContext,
  options: RecordClipOptions = {},
): Promise<RecordingResult> {
  const { signal } = options;
  if (signal?.aborted) {
    throw new DOMException("Recording aborted before start", "AbortError");
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  let abortListener: (() => void) | null = null;
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (event) => {
      const err = (event as ErrorEvent).error ?? new Error("MediaRecorder error");
      const normalized = err instanceof Error ? err : new Error(String(err));
      // Route through streamLifecycle — if the failure was caused by stream
      // loss, this transitions the store to "suspended" so the reconnect pill
      // surfaces. If the tracks are still live, it's a genuine encoder error
      // and the lifecycle module leaves the store alone.
      onMediaRecorderError(stream, normalized);
      reject(normalized);
    };
    if (signal) {
      abortListener = () => {
        if (recorder.state !== "inactive") {
          try {
            recorder.stop();
          } catch {
            // Ignore — recorder may have just transitioned to inactive.
          }
        }
        reject(new DOMException("Recording aborted", "AbortError"));
      };
      signal.addEventListener("abort", abortListener);
    }
  });

  try {
    recorder.start();
  } catch (err) {
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    throw err instanceof Error ? err : new Error(String(err));
  }

  const stopTimer = setTimeout(() => {
    if (recorder.state !== "inactive") recorder.stop();
  }, durationMs);

  try {
    await stopped;
  } finally {
    clearTimeout(stopTimer);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }

  const blob = new Blob(chunks, { type: mimeType });
  const arrayBuffer = await blob.arrayBuffer();
  // Pass a copy to decodeAudioData — some browsers detach the input buffer.
  const decodeBuffer = arrayBuffer.slice(0);

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioContext.decodeAudioData(decodeBuffer);
  } catch (err) {
    throw new Error(
      `Failed to decode recorded audio: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { blob, audioBuffer, durationMs };
}
