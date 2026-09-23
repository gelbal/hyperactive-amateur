// ABOUTME: Shared predicate for user actions that start playback, pad triggers, recording, or exports.
// ABOUTME: Prevents recording/export flows from overlapping and corrupting each other.
import type { AppState } from "../types";
import { useAppStore } from "../store/useAppStore";

// The in-flight claim of a pad or Play tap (held across the audio unlock).
// It lives outside the store on purpose and only the claim below reads it:
// the predicate is used as a React selector, and a selector that read this
// flag would paint every control disabled on the store write the unlock
// makes and never repaint when the flag flips back without a store write.
let pendingAudibleClaim = false;

export function canStartAudibleAction(state: Pick<AppState, "playback" | "recording">): boolean {
  return (
    !state.playback.isPlaying &&
    !state.playback.isExporting &&
    state.recording.state === "idle"
  );
}

// Recording and export claim their state in the store synchronously before
// their first await; pads and Play claim this flag. A second pad or Play tap
// during the unlock gets null and drops; a pad or Play that finishes its
// unlock re-checks the store before it makes any sound.
export function claimPendingAudible(): (() => void) | null {
  if (pendingAudibleClaim || !canStartAudibleAction(useAppStore.getState())) return null;

  pendingAudibleClaim = true;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    pendingAudibleClaim = false;
  };
}

export function __resetPendingAudibleClaimForTesting(): void {
  pendingAudibleClaim = false;
}
