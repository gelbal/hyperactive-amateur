// ABOUTME: recordClip — record a fixed-duration camera clip and capture its mic audio.
// ABOUTME: Returns the blob plus an AudioBuffer for low-latency Tone.Player playback.
import { onMediaRecorderError } from "./streamLifecycle";
import { getSupportedRecordingMimeType } from "./mediaRecorderSupport";
import { startAudioBufferCapture } from "./audioCapture";
import { timeoutAfter } from "./async";

export interface RecordingResult {
  blob: Blob;
  audioBuffer: AudioBuffer;
  durationMs: number;
}

const RECORDER_STOP_TIMEOUT_MS = 5000;

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

  const mimeType = getSupportedRecordingMimeType();
  const recorderOptions = mimeType ? { mimeType } : undefined;
  const recorder = recorderOptions
    ? new MediaRecorder(stream, recorderOptions)
    : new MediaRecorder(stream);
  const audioCapture = startAudioBufferCapture(stream, audioContext, {
    maxDurationMs: durationMs,
  });
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
    audioCapture?.cancel();
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    throw err instanceof Error ? err : new Error(String(err));
  }

  const stopTimer = setTimeout(() => {
    if (recorder.state !== "inactive") recorder.stop();
  }, durationMs);

  try {
    await Promise.race([
      stopped,
      timeoutAfter(
        durationMs + RECORDER_STOP_TIMEOUT_MS,
        "MediaRecorder did not finish recording after stop.",
      ),
    ]);
  } catch (err) {
    audioCapture?.cancel();
    throw err;
  } finally {
    clearTimeout(stopTimer);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Recorder may already be transitioning to inactive.
      }
    }
  }

  const blob = new Blob(chunks, { type: mimeType });
  const capturedAudioBuffer = audioCapture?.stop() ?? null;
  if (capturedAudioBuffer) {
    return {
      blob,
      audioBuffer: capturedAudioBuffer,
      durationMs: Math.round(capturedAudioBuffer.duration * 1000),
    };
  }

  let audioBuffer: AudioBuffer;
  try {
    const arrayBuffer = await blob.arrayBuffer();
    // Pass a copy to decodeAudioData — some browsers detach the input buffer.
    const decodeBuffer = arrayBuffer.slice(0);
    audioBuffer = await audioContext.decodeAudioData(decodeBuffer);
  } catch (err) {
    throw new Error(
      `Failed to decode recorded audio: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { blob, audioBuffer, durationMs: Math.round(audioBuffer.duration * 1000) };
}
