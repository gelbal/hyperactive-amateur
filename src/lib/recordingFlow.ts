// ABOUTME: recordingFlow — shared "record into a track" sequence used by TrackRow and the in-viewport RecordingStation.
// ABOUTME: Drives the countdown → record → trim → store → auto-tag pipeline; module-level controller serializes flows + carries Esc cancellation.
import { useAppStore } from "../store/useAppStore";
import { recordClip } from "./recorder";
import { getAudioContext } from "./audio";
import { AudioUnavailableError, ensureAudioRunning, noteMicAcquireStarted } from "./audioLifecycle";
import { autoTrim } from "./autoTrim";
import { autoTag, AUTO_TAG_CONFIDENCE_THRESHOLD } from "./aiAutoTag";
import { applyClassifiedTag } from "./applyClassifiedTag";
import {
  errorMessage,
  getAbortReason,
  isFlowAbort,
  makeAbortError,
  throwIfFlowAborted,
  waitUntilAudioTime,
} from "./async";
import {
  ACQUIRE_FAILED_COPY,
  CAMERA_DENIED_COPY,
  isPermissionDenial,
  releaseRecordingStream,
  requestMedia,
} from "./media";
import { sliceAudioBuffer } from "./audioBufferSlice";
import { logger, LOG_EVENTS } from "./logger";
import { captureFirstFrame } from "./posterFrame";
import { audioBufferToWav } from "./wavEncoder";
import { canStartAudibleAction } from "./audibleActionGate";
import {
  allTracksUsable,
  registerRecordingInterruptHandler,
  waitForUsableTracks,
} from "./streamLifecycle";
import { saveNow } from "./autoSave";
import { acquireRecordingStreamUntilAbort } from "./recordingAcquire";
import { requestPersistenceAfterClipSave } from "./recordingPersistence";
import type { Clip, Tag } from "../types";
export { __resetPersistenceRequestForTesting } from "./recordingPersistence";

export const RECORD_DURATION_MS = 2000;
export const COUNTDOWN_MS = 3000;
const AUDIO_UNAVAILABLE_COPY = "Couldn't start audio — try again.";
const RECORDING_INTERRUPTED_COPY =
  "Recording interrupted — the microphone or camera was taken by another app or call.";
export type RecordingCancelReason = "user" | "interrupted";

export type AutoTagEvent =
  | { kind: "tagging" }
  | { kind: "applied"; tag: Tag; hatAudioOnly: boolean }
  | { kind: "offline" }
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

function attachPosterWhenReady(
  trackId: number,
  clip: Clip,
  sourceBlob: Blob,
  signal: AbortSignal,
): void {
  void (async () => {
    let posterBlob: Blob | null = null;
    try {
      posterBlob = await captureFirstFrame(sourceBlob);
    } catch (err) {
      logger.warn(LOG_EVENTS.POSTER_CAPTURE_ERROR, {
        phase: "poster",
        message: errorMessage(err),
      });
      posterBlob = null;
    }
    try {
      throwIfFlowAborted(signal, "Aborted after poster extraction");
    } catch (err) {
      if (isFlowAbort(err, signal)) return;
      throw err;
    }
    useAppStore.getState().actions.setTrackPoster(trackId, posterBlob, clip);
  })();
}

export function registerChopRecordingInterrupt(): () => void {
  return registerRecordingInterruptHandler({
    isActive: isRecordingInFlight,
    interrupt: (reason) => cancelCurrentRecording(reason),
  });
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

  // A flow that will acquire its own stream declares capture intent before
  // the audio unlock, so the session type never passes through "playback"
  // on the way to getUserMedia. A station-supplied stream is already held.
  const releaseCaptureIntent = externalStream ? null : noteMicAcquireStarted();
  try {
    try {
      await ensureAudioRunning();
    } catch (e) {
      // A hide during the unlock aborts the flow; report the abort, not the
      // audio failure the bounded unlock surfaces on its way out.
      throwIfFlowAborted(signal, "Aborted during audio unlock");
      if (e instanceof AudioUnavailableError) {
        options.onError?.(AUDIO_UNAVAILABLE_COPY);
        return false;
      }
      // ensureAudioRunning wraps every failure in AudioUnavailableError, so
      // a failed unlock always aborts the flow — recording never proceeds
      // without the shared audio context. Rethrow so a future unwrapped
      // error surfaces through the outer catch instead of recording silent.
      throw e;
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
        // Permission may have been revoked since the last grant — re-probe so
        // the viewport gate can take over, without waiting on it: a pending
        // probe must never hold the flow (and its Cancel) open. With the
        // station dismissed the gate is not on screen, so the row's line
        // carries the right next action from the failure itself: the
        // settings for a denial, a retry for anything else.
        void requestMedia();
        options.onError?.(isPermissionDenial(e) ? CAMERA_DENIED_COPY : ACQUIRE_FAILED_COPY);
        return false;
      }
    }
    if (!stream) return false;
    throwIfFlowAborted(signal, "Aborted before countdown");

    // Already-usable tracks take the synchronous path; a cold track (muted
    // for a few hundred ms after acquisition on phones) gets a bounded grace.
    const tracksUsable = allTracksUsable(stream) || (await waitForUsableTracks(stream, { signal }));
    if (!tracksUsable) {
      actions.setRecordingError(RECORDING_INTERRUPTED_COPY);
      options.onError?.(RECORDING_INTERRUPTED_COPY);
      return false;
    }

    const audioContext = getAudioContext();
    const countdownEndsAt = audioContext.currentTime + COUNTDOWN_MS / 1000;
    actions.setCountdownEndsAt(countdownEndsAt);
    actions.setRecordingState("countdown", trackId);

    await waitUntilAudioTime(countdownEndsAt, audioContext, signal);
    actions.setCaptureEndsAt(countdownEndsAt + RECORD_DURATION_MS / 1000);
    actions.setRecordingState("recording", trackId);
    const result = await recordClip(stream, RECORD_DURATION_MS, audioContext, { signal });
    throwIfFlowAborted(signal, "Aborted after capture");
    const trim = autoTrim(result.audioBuffer);
    const bufferDurationMs = Math.max(0, Math.round(result.audioBuffer.duration * 1000));
    const trimStartMs = Math.max(0, Math.min(trim.trimStartMs, bufferDurationMs));
    const trimEndMs = Math.max(trimStartMs, Math.min(trim.trimEndMs, bufferDurationMs));
    const url = URL.createObjectURL(result.blob);
    const newClip: Clip = {
      blob: result.blob,
      url,
      audioBuffer: result.audioBuffer,
      audioStatus: "ok",
      audioBlob: audioBufferToWav(result.audioBuffer),
      trimStartMs,
      trimEndMs,
      durationMs: result.durationMs,
      posterBlob: null,
      posterUrl: null,
    };
    actions.setTrackClip(trackId, newClip);
    try {
      // saveNow resolves false when autosave has not started (load pending
      // or failed) — no persistence request should anchor to a skipped save.
      if (await saveNow()) requestPersistenceAfterClipSave();
    } catch {
      // saveNow logs autosave.error; durability failure is not a recording failure.
    }
    throwIfFlowAborted(signal, "Aborted after clip durability save");
    // Poster generation is best-effort and intentionally not awaited: the clip
    // save is the durability boundary, and the poster can attach later.
    attachPosterWhenReady(trackId, newClip, result.blob, signal);
    // Send only the trimmed window to the AI tagger — the raw recording
    // is ~2 s and is mostly silence on either side of the actual sound.
    const trimmedForTagging = sliceAudioBuffer(
      result.audioBuffer,
      trimStartMs,
      trimEndMs,
    );
    void runAutoTag(trackId, newClip, trimmedForTagging, options.onAutoTag);
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
    releaseCaptureIntent?.();
    actions.setCountdownEndsAt(null);
    actions.setCaptureEndsAt(null);
    actions.setRecordingState("idle", null);
  }
}

async function runAutoTag(
  trackId: number,
  clip: Clip,
  audioBuffer: AudioBuffer,
  onEvent?: (event: AutoTagEvent) => void,
): Promise<void> {
  onEvent?.({ kind: "tagging" });
  const result = await autoTag(audioBuffer);
  // The take was deleted or re-recorded while the classifier ran: nothing
  // to report about it (a newer take reports its own status).
  if (useAppStore.getState().project.tracks[trackId]?.clip?.blob !== clip.blob) return;
  if (result && "kind" in result) {
    onEvent?.({ kind: "offline" });
    return;
  }
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
    clip,
  );
  if (!applied) {
    // User picked a tag while we were thinking — keep their choice and
    // tell the caller this looked like a miss UX-wise.
    onEvent?.({ kind: "miss" });
    return;
  }
  onEvent?.({ kind: "applied", tag: result.tag, hatAudioOnly });
}
