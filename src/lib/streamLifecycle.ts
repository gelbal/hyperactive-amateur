// ABOUTME: streamLifecycle — single owner of every transition INTO "suspended".
// ABOUTME: Three event sources route through here: track.onended, visibilitychange, MediaRecorder.onerror.
import { useAppStore } from "../store/useAppStore";
// media.ts ↔ streamLifecycle.ts is a circular import (media registers its
// streams here); ESM hoists the function binding and invalidatePendingAcquire
// is only invoked at event time, long after both modules have loaded.
import { invalidatePendingAcquire } from "./media";
import { noteMicHeld, noteMicReleased } from "./audioLifecycle";
import { getAudioContext, stopPlayback } from "./audio";
import { abortActiveExport } from "./exportSession";
import { LOG_EVENTS, logger } from "./logger";
import { flushPending } from "./autoSave";
import {
  interruptActiveRecording,
  registerRecordingInterruptHandler,
  type RecordingInterruptHandler,
} from "./recordingInterrupt";

export interface StreamLifecycleHandle {
  detach: () => void;
}

export { registerRecordingInterruptHandler };
export type { RecordingInterruptHandler };

const lifecycleHandles = new WeakMap<MediaStream, StreamLifecycleHandle>();
const pendingMuteSuspensions = new WeakMap<MediaStream, ReturnType<typeof setTimeout>>();
const TRACK_MUTE_SUSPEND_DELAY_MS = 250;

function detachLifecycle(stream: MediaStream): void {
  const handle = lifecycleHandles.get(stream);
  if (!handle) return;
  handle.detach();
  lifecycleHandles.delete(stream);
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    if (typeof track.stop === "function") track.stop();
  }
}

// A stream is current when the store holds exactly it in a "granted" status.
// A different stream having been acquired since (e.g. the user re-flipped the
// camera) means the event fired on a stale handle: it must neither touch the
// store nor interrupt a recording running on the newer stream.
function isCurrentStream(stream: MediaStream): boolean {
  const media = useAppStore.getState().media;
  return media.status === "granted" && media.stream === stream;
}

// Mark the store as suspended IF and only IF `stream` is current — checked
// BEFORE the recording interrupt so check+interrupt+suspend act as one
// current-stream-only operation.
function transitionToSuspended(stream: MediaStream): void {
  if (!isCurrentStream(stream)) return;
  interruptActiveRecording("interrupted");
  suspendMediaStream(stream);
}

function clearPendingMuteSuspension(stream: MediaStream): void {
  const timer = pendingMuteSuspensions.get(stream);
  if (!timer) return;
  clearTimeout(timer);
  pendingMuteSuspensions.delete(stream);
}

function hasUsableTrack(tracks: MediaStreamTrack[]): boolean {
  return tracks.some((track) => track.readyState === "live" && !track.muted);
}

export function allTracksUsable(stream: MediaStream): boolean {
  return hasUsableTrack(stream.getAudioTracks()) && hasUsableTrack(stream.getVideoTracks());
}

function scheduleMutedSuspension(stream: MediaStream): void {
  clearPendingMuteSuspension(stream);
  const timer = setTimeout(() => {
    pendingMuteSuspensions.delete(stream);
    suspendMediaStream(stream);
  }, TRACK_MUTE_SUSPEND_DELAY_MS);
  pendingMuteSuspensions.set(stream, timer);
}

function onTrackMuted(stream: MediaStream): void {
  if (!isCurrentStream(stream)) return;
  if (interruptActiveRecording("interrupted")) {
    clearPendingMuteSuspension(stream);
    suspendMediaStream(stream);
    return;
  }
  scheduleMutedSuspension(stream);
}

// Attach an `ended` listener to every track on `stream`. iOS suspends camera/
// mic on backgrounding, calls grab the camera, other apps reclaim the device,
// users revoke permission — all surface as track.ended. Returns a handle so
// the caller can detach when the stream is intentionally released.
export function attachStreamEndedListeners(stream: MediaStream): StreamLifecycleHandle {
  const tracks = stream.getTracks();
  const onEnded = () => transitionToSuspended(stream);
  const onMute = () => onTrackMuted(stream);
  const onUnmute = () => {
    if (allTracksUsable(stream)) clearPendingMuteSuspension(stream);
  };
  for (const track of tracks) {
    track.addEventListener("ended", onEnded);
    track.addEventListener("mute", onMute);
    track.addEventListener("unmute", onUnmute);
  }
  return {
    detach: () => {
      clearPendingMuteSuspension(stream);
      for (const track of tracks) {
        track.removeEventListener("ended", onEnded);
        track.removeEventListener("mute", onMute);
        track.removeEventListener("unmute", onUnmute);
      }
    },
  };
}

export function registerStreamLifecycle(stream: MediaStream): void {
  detachLifecycle(stream);
  lifecycleHandles.set(stream, attachStreamEndedListeners(stream));
  noteMicHeld();
}

export function releaseMediaStream(stream: MediaStream): void {
  detachLifecycle(stream);
  stopTracks(stream);
  const state = useAppStore.getState();
  if (state.media.stream === stream) {
    noteMicReleased();
    state.actions.setMedia({ stream: null, status: "granted", error: null });
  }
}

export function suspendMediaStream(stream: MediaStream): void {
  detachLifecycle(stream);
  stopTracks(stream);
  const state = useAppStore.getState();
  if (state.media.status === "granted" && state.media.stream === stream) {
    // A suspension is a lifecycle decision: any acquire still in flight must
    // not be allowed to re-grant after it.
    invalidatePendingAcquire();
    noteMicReleased();
    state.actions.setMedia({ stream: null, status: "suspended", error: null });
  }
}

// Listen for page-visibility changes and pagehide. On hidden: stop playback
// (no saved-position bookkeeping — restart is user-initiated) and suspend the
// held stream so the reconnect pill takes over. On visible: surface any
// blocked AudioContext through the resume pill; user activation owns the
// actual unlock. pagehide shares the hidden branch because it can fire
// without a preceding visibilitychange → hidden (bfcache eviction, some iOS
// tab-close/navigation paths) and must still flush pending saves.
// Returns a detach function for cleanup on unmount.
export function installVisibilityListener(): () => void {
  const handleHidden = () => {
    flushPending();
    const abortedExport = abortActiveExport(
      "Rendering was interrupted because the screen locked or the app was hidden. Tap Render to try again.",
    );
    if (!abortedExport) {
      try {
        stopPlayback();
      } catch {
        // Transport may not be initialized yet; safe to ignore.
      }
    }
    // Hidden/pagehide is a suspend decision even when no stream is held: a
    // reconnect-tap acquire still pending must not re-light camera/mic by
    // resolving after the app went hidden.
    invalidatePendingAcquire();
    const state = useAppStore.getState();
    if (state.media.status === "granted" && state.media.stream) {
      transitionToSuspended(state.media.stream);
    } else {
      // No held stream to route through transitionToSuspended — a recording
      // still in `preparing` (audio starting, acquisition pending) must be
      // interrupted all the same, with the same pinned copy.
      interruptActiveRecording("interrupted");
    }
  };
  const reconcileHeldStream = () => {
    const state = useAppStore.getState();
    if (state.media.status !== "granted" || !state.media.stream) return;
    if (!allTracksUsable(state.media.stream)) {
      transitionToSuspended(state.media.stream);
    }
  };
  const handleVisibilityChange = () => {
    if (document.hidden) {
      handleHidden();
    } else {
      const context = getAudioContext();
      if (context.state !== "running") {
        useAppStore.getState().actions.setAudioState("resume-required");
        logger.warn(LOG_EVENTS.AUDIO_RESUME_REQUIRED, { state: context.state });
      }
    }
  };
  const documentEvents =
    typeof document.addEventListener === "function" &&
    typeof document.removeEventListener === "function";
  const windowEvents =
    typeof window.addEventListener === "function" &&
    typeof window.removeEventListener === "function";

  if (documentEvents) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("resume", reconcileHeldStream);
  }
  if (windowEvents) {
    window.addEventListener("pagehide", handleHidden);
    window.addEventListener("pageshow", reconcileHeldStream);
  }
  return () => {
    if (documentEvents) {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("resume", reconcileHeldStream);
    }
    if (windowEvents) {
      window.removeEventListener("pagehide", handleHidden);
      window.removeEventListener("pageshow", reconcileHeldStream);
    }
  };
}

// Called from MediaRecorder.onerror after a recording dies. If the failure was
// caused by stream loss (tracks no longer live) we route it through the same
// suspension path as track.ended. If the tracks are still live, the recorder
// hit a genuine encoding error and we leave the store alone — the caller's
// onError handler surfaces the message.
export function onMediaRecorderError(stream: MediaStream, _err: Error): void {
  if (allTracksUsable(stream)) return;
  transitionToSuspended(stream);
}
