// ABOUTME: recordingFlow — shared "record into a track" sequence used by TrackRow and the in-viewport RecordingStation.
// ABOUTME: Drives the countdown → record → trim → store → auto-tag pipeline; module-level controller serializes flows + carries Esc cancellation.
import { useAppStore } from "../store/useAppStore";
import { recordClip } from "./recorder";
import { getAudioContext } from "./audio";
import { AudioUnavailableError, ensureAudioRunning } from "./audioLifecycle";
import { autoTrim } from "./autoTrim";
import { autoTag, AUTO_TAG_CONFIDENCE_THRESHOLD } from "./aiAutoTag";
import { applyClassifiedTag } from "./applyClassifiedTag";
import { acquireRecordingStream, releaseRecordingStream, requestMedia } from "./media";
import { sliceAudioBuffer } from "./audioBufferSlice";
import { isAbortError } from "./aiClient";
import { logger, LOG_EVENTS } from "./logger";
import { captureFirstFrame } from "./posterFrame";
import { audioBufferToWav } from "./wavEncoder";
import { canStartAudibleAction } from "./audibleActionGate";
import { allTracksUsable, registerRecordingInterruptHandler } from "./streamLifecycle";
import type { Clip, Tag } from "../types";

export const RECORD_DURATION_MS = 2000;
export const COUNTDOWN_MS = 3000;
const AUDIO_UNAVAILABLE_COPY = "Couldn't start audio — tap the audio pill, then try again.";
const RECORDING_INTERRUPTED_COPY =
  "Recording interrupted — the microphone or camera was taken by another app or call.";
export type RecordingCancelReason = "user" | "interrupted";

export type AutoTagEvent =
  | { kind: "tagging" }
  | { kind: "applied"; tag: Tag; hatAudioOnly: boolean }
  | { kind: "miss" }
  | { kind: "idle" };

export interface RecordIntoTrackOptions {
  // Notified at the start of auto-tagging, on each terminal status, and once
  // when the whole flow is done. Use to drive a tagging spinner / toast.
  onAutoTag?: (event: AutoTagEvent) => void;
  // Called with the error message if recordClip throws.
  onError?: (message: string) => void;
  // When provided, the flow uses this stream instead of acquiring a fresh one
  // (and skips the matching release). Lets the RecordingStation share a
  // single preview stream across multiple recording cycles.
  stream?: MediaStream;
}

// Module-level singleton controller — serializes recording flows and carries
// the Esc cancellation signal. The RecordCountdown listens for Esc and calls
// cancelCurrentRecording() to abort the active flow.
let currentController: AbortController | null = null;
let currentFlow: Promise<boolean> | null = null;

export function cancelCurrentRecording(reason: RecordingCancelReason = "user"): void {
  currentController?.abort(reason);
}

export function isRecordingInFlight(): boolean {
  return currentFlow !== null;
}

registerRecordingInterruptHandler({
  isActive: isRecordingInFlight,
  interrupt: (reason) => cancelCurrentRecording(reason),
});

function waitMs(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(makeAbortError("Aborted before wait started"));
      return;
    }
    const delayMs = Math.max(0, ms);
    if (delayMs === 0) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(makeAbortError("Aborted during wait"));
    };
    signal.addEventListener("abort", onAbort);
  });
}

async function waitUntilAudioTime(
  deadlineSeconds: number,
  audioContext: Pick<BaseAudioContext, "currentTime">,
  signal: AbortSignal,
): Promise<void> {
  for (;;) {
    throwIfFlowAborted(signal, "Aborted before countdown completed");
    const remainingMs = (deadlineSeconds - audioContext.currentTime) * 1000;
    if (remainingMs <= 0) return;
    await waitMs(remainingMs, signal);
  }
}

function makeAbortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

function throwIfFlowAborted(signal: AbortSignal, message: string): void {
  if (signal.aborted) {
    throw makeAbortError(message);
  }
}

function acquireRecordingStreamUntilAbort(signal: AbortSignal): Promise<MediaStream> {
  const acquisition = acquireRecordingStream();
  return new Promise<MediaStream>((resolve, reject) => {
    let settled = false;
    const stopWatchingAbort = () => signal.removeEventListener("abort", onAbort);
    const releaseLateStream = (stream: MediaStream) => {
      releaseRecordingStream(stream);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      stopWatchingAbort();
      acquisition.then(releaseLateStream, () => undefined);
      reject(makeAbortError("Aborted during media acquisition"));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
    acquisition.then(
      (stream) => {
        if (settled) {
          releaseLateStream(stream);
          return;
        }
        settled = true;
        stopWatchingAbort();
        resolve(stream);
      },
      (err) => {
        if (settled) return;
        settled = true;
        stopWatchingAbort();
        reject(err);
      },
    );
  });
}

function getAbortReason(signal: AbortSignal): RecordingCancelReason {
  return signal.reason === "interrupted" ? "interrupted" : "user";
}

function isFlowAbort(err: unknown, signal: AbortSignal): boolean {
  return isAbortError(err) || (signal.aborted && err === signal.reason);
}

// Run the full record sequence for one track. Acquires a fresh MediaStream
// for the cycle (unless one was passed in), runs countdown → record → trim →
// store → auto-tag, then releases the stream (camera light goes off).
// Resolves with true on a saved clip, false if permission isn't granted yet,
// capture threw, or the user pressed Esc.
//
// If another flow is already in progress (double-click race), the second call
// resolves false without doing anything.
export async function recordIntoTrack(
  trackId: number,
  options: RecordIntoTrackOptions = {},
): Promise<boolean> {
  if (currentFlow) return false;
  const actions = useAppStore.getState().actions;
  if (!canStartAudibleAction(useAppStore.getState())) return false;
  actions.setRecordingState("preparing", trackId);

  const controller = new AbortController();
  currentController = controller;
  const flow = runFlow(trackId, options, controller.signal);
  currentFlow = flow;
  try {
    return await flow;
  } finally {
    if (currentController === controller) currentController = null;
    if (currentFlow === flow) currentFlow = null;
  }
}

async function runFlow(
  trackId: number,
  options: RecordIntoTrackOptions,
  signal: AbortSignal,
): Promise<boolean> {
  const actions = useAppStore.getState().actions;
  const externalStream = options.stream ?? null;
  let stream: MediaStream | null = null;

  try {
    try {
      await ensureAudioRunning();
    } catch (e) {
      if (e instanceof AudioUnavailableError) {
        options.onError?.(AUDIO_UNAVAILABLE_COPY);
        return false;
      }
      // Recording can still proceed; recordClip has a decode fallback if the
      // live Web Audio tap cannot run.
    }
    throwIfFlowAborted(signal, "Aborted before media acquisition");

    if (externalStream) {
      stream = externalStream;
    } else {
      try {
        stream = await acquireRecordingStreamUntilAbort(signal);
      } catch (e) {
        if (signal.aborted) {
          throw makeAbortError("Aborted during media acquisition");
        }
        // Permission may have been revoked since the last grant — surface the
        // viewport gate so the user can re-allow.
        void requestMedia();
        options.onError?.(e instanceof Error ? e.message : String(e));
        return false;
      }
    }
    if (!stream) return false;
    throwIfFlowAborted(signal, "Aborted before countdown");

    if (!allTracksUsable(stream)) {
      actions.setRecordingError(RECORDING_INTERRUPTED_COPY);
      options.onError?.(RECORDING_INTERRUPTED_COPY);
      return false;
    }

    const audioContext = getAudioContext();
    const countdownEndsAt = audioContext.currentTime + COUNTDOWN_MS / 1000;
    actions.setCountdownEndsAt(countdownEndsAt);
    actions.setRecordingState("countdown", trackId);

    await waitUntilAudioTime(countdownEndsAt, audioContext, signal);
    actions.setRecordingState("recording", trackId);
    const result = await recordClip(stream, RECORD_DURATION_MS, audioContext, { signal });
    throwIfFlowAborted(signal, "Aborted after capture");
    const trim = autoTrim(result.audioBuffer);
    const bufferDurationMs = Math.max(0, Math.round(result.audioBuffer.duration * 1000));
    const trimStartMs = Math.max(0, Math.min(trim.trimStartMs, bufferDurationMs));
    const trimEndMs = Math.max(trimStartMs, Math.min(trim.trimEndMs, bufferDurationMs));
    // Poster generation is best-effort — never let a poster failure block
    // the clip save. captureFirstFrame returns null on any decode/timeout.
    let posterBlob: Blob | null = null;
    try {
      posterBlob = await captureFirstFrame(result.blob);
    } catch {
      posterBlob = null;
    }
    throwIfFlowAborted(signal, "Aborted after poster extraction");
    const url = URL.createObjectURL(result.blob);
    const posterUrl = posterBlob ? URL.createObjectURL(posterBlob) : null;
    const newClip: Clip = {
      blob: result.blob,
      url,
      audioBuffer: result.audioBuffer,
      audioBlob: audioBufferToWav(result.audioBuffer),
      trimStartMs,
      trimEndMs,
      durationMs: result.durationMs,
      posterBlob,
      posterUrl,
    };
    actions.setTrackClip(trackId, newClip);
    // Send only the trimmed window to the AI tagger — the raw recording
    // is ~2 s and is mostly silence on either side of the actual sound.
    const trimmedForTagging = sliceAudioBuffer(
      result.audioBuffer,
      trimStartMs,
      trimEndMs,
    );
    void runAutoTag(trackId, trimmedForTagging, options.onAutoTag);
    return true;
  } catch (e) {
    if (isFlowAbort(e, signal)) {
      if (getAbortReason(signal) === "interrupted") {
        actions.setRecordingError(RECORDING_INTERRUPTED_COPY);
      }
      return false;
    }
    options.onError?.(e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    if (!externalStream && stream) releaseRecordingStream(stream);
    actions.setCountdownEndsAt(null);
    actions.setRecordingState("idle", null);
  }
}

async function runAutoTag(
  trackId: number,
  audioBuffer: AudioBuffer,
  onEvent?: (event: AutoTagEvent) => void,
): Promise<void> {
  onEvent?.({ kind: "tagging" });
  const result = await autoTag(audioBuffer);
  if (!result) {
    onEvent?.({ kind: "miss" });
    return;
  }
  if (result.confidence < AUTO_TAG_CONFIDENCE_THRESHOLD) {
    logger.warn(LOG_EVENTS.AUTOTAG_BELOW_THRESHOLD, {
      trackId,
      tag: result.tag,
      confidence: result.confidence,
      threshold: AUTO_TAG_CONFIDENCE_THRESHOLD,
    });
    onEvent?.({ kind: "miss" });
    return;
  }
  const { applied, hatAudioOnly } = applyClassifiedTag(
    trackId,
    result.tag,
    result.reasoning,
  );
  if (!applied) {
    // User picked a tag while we were thinking — keep their choice and
    // tell the caller this looked like a miss UX-wise.
    onEvent?.({ kind: "miss" });
    return;
  }
  onEvent?.({ kind: "applied", tag: result.tag, hatAudioOnly });
}
