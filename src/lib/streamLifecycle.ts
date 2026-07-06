// ABOUTME: streamLifecycle — single owner of every transition INTO "suspended".
// ABOUTME: Three event sources route through here: track.onended, visibilitychange, MediaRecorder.onerror.
import { useAppStore } from "../store/useAppStore";
import { noteMicHeld, noteMicReleased } from "./audioLifecycle";
import { getAudioContext, stopPlayback } from "./audio";
import { abortActiveExport } from "./exportSession";
import { LOG_EVENTS, logger } from "./logger";

export interface StreamLifecycleHandle {
  detach: () => void;
}

const lifecycleHandles = new WeakMap<MediaStream, StreamLifecycleHandle>();

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

// Mark the store as suspended IF and only IF it currently holds `stream` in a
// "granted" status. A different stream having been acquired since (e.g. the
// user re-flipped the camera) means the listener fired on a stale handle and
// should not touch the store.
function transitionToSuspended(stream: MediaStream): void {
  suspendMediaStream(stream);
}

// Attach an `ended` listener to every track on `stream`. iOS suspends camera/
// mic on backgrounding, calls grab the camera, other apps reclaim the device,
// users revoke permission — all surface as track.ended. Returns a handle so
// the caller can detach when the stream is intentionally released.
export function attachStreamEndedListeners(stream: MediaStream): StreamLifecycleHandle {
  const tracks = stream.getTracks();
  const onEnded = () => transitionToSuspended(stream);
  for (const track of tracks) {
    track.addEventListener("ended", onEnded);
  }
  return {
    detach: () => {
      for (const track of tracks) {
        track.removeEventListener("ended", onEnded);
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
    noteMicReleased();
    state.actions.setMedia({ stream: null, status: "suspended", error: null });
  }
}

// Listen for page-visibility changes. On hidden: stop playback (no saved-
// position bookkeeping — restart is user-initiated) and suspend the held
// stream so the reconnect pill takes over. On visible: surface any blocked
// AudioContext through the resume pill; user activation owns the actual unlock.
// Returns a detach function for cleanup on unmount.
export function installVisibilityListener(): () => void {
  const handler = () => {
    if (document.hidden) {
      const abortedExport = abortActiveExport(
        "Export was interrupted because the page was hidden.",
      );
      if (!abortedExport) {
        try {
          stopPlayback();
        } catch {
          // Transport may not be initialized yet; safe to ignore.
        }
      }
      const state = useAppStore.getState();
      if (state.media.status === "granted" && state.media.stream) {
        suspendMediaStream(state.media.stream);
      }
    } else {
      const context = getAudioContext();
      if (context.state !== "running") {
        useAppStore.getState().actions.setAudioState("resume-required");
        logger.warn(LOG_EVENTS.AUDIO_RESUME_REQUIRED, { state: context.state });
      }
    }
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}

// Called from MediaRecorder.onerror after a recording dies. If the failure was
// caused by stream loss (tracks no longer live) we route it through the same
// suspension path as track.ended. If the tracks are still live, the recorder
// hit a genuine encoding error and we leave the store alone — the caller's
// onError handler surfaces the message.
export function onMediaRecorderError(stream: MediaStream, _err: Error): void {
  const tracks = stream.getTracks();
  const allTracksLive = tracks.length > 0 && tracks.every((t) => t.readyState === "live");
  if (allTracksLive) return;
  transitionToSuspended(stream);
}
