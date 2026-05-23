// ABOUTME: streamLifecycle — single owner of every transition INTO "suspended".
// ABOUTME: Three event sources route through here: track.onended, visibilitychange, MediaRecorder.onerror.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";

export interface StreamLifecycleHandle {
  detach: () => void;
}

// Mark the store as suspended IF and only IF it currently holds `stream` in a
// "granted" status. A different stream having been acquired since (e.g. the
// user re-flipped the camera) means the listener fired on a stale handle and
// should not touch the store.
function transitionToSuspended(stream: MediaStream): void {
  const state = useAppStore.getState();
  if (state.media.status === "granted" && state.media.stream === stream) {
    state.actions.setMedia({ stream: null, status: "suspended", error: null });
  }
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

// Listen for page-visibility changes. On hidden: stop the Transport (no saved-
// position bookkeeping — restart is user-initiated) and suspend the held
// stream so the reconnect pill takes over. On visible: nudge the AudioContext
// awake (iOS suspends it when the tab hides); the store stays suspended until
// the user taps the pill — deliberately, so we don't auto-resume the camera
// light. Returns a detach function for cleanup on unmount.
export function installVisibilityListener(): () => void {
  const handler = () => {
    if (document.hidden) {
      try {
        Tone.getTransport().stop();
      } catch {
        // Transport may not be initialized yet; safe to ignore.
      }
      const state = useAppStore.getState();
      if (state.media.status === "granted" && state.media.stream) {
        state.actions.setMedia({
          stream: null,
          status: "suspended",
          error: null,
        });
      }
    } else {
      // Tone.start() is idempotent. Resumes the AudioContext on iOS without
      // affecting other platforms.
      void Tone.start();
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
  const anyLive = stream.getTracks().some((t) => t.readyState === "live");
  if (anyLive) return;
  transitionToSuspended(stream);
}
