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
// Bumped by the stream lifecycle on every hide. A claim taken before a hide
// is obsolete once the page is back: its unlock was frozen in the background
// and may settle only on return, and a tap from before the app switch must
// not start sound then.
let hideEpoch = 0;
let claimEpoch = 0;

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
  claimEpoch = hideEpoch;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    pendingAudibleClaim = false;
  };
}

export function invalidatePendingAudible(): void {
  hideEpoch += 1;
}

export function isPendingAudibleCurrent(): boolean {
  return claimEpoch === hideEpoch;
}

// A pad or Play tap is unlocking right now and will make sound when it
// settles. Guards that would re-light the camera read this (as a plain call,
// never a selector) so playback does not start with the mic held.
export function hasCurrentAudibleClaim(): boolean {
  return pendingAudibleClaim && isPendingAudibleCurrent();
}

export function __resetPendingAudibleClaimForTesting(): void {
  pendingAudibleClaim = false;
  hideEpoch = 0;
  claimEpoch = 0;
}
