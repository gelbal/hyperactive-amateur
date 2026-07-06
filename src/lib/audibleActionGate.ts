// ABOUTME: Shared predicate for user actions that start playback, pad triggers, recording, or exports.
// ABOUTME: Prevents recording/export flows from overlapping and corrupting each other.
import type { AppState } from "../types";
import { useAppStore } from "../store/useAppStore";

let pendingAudibleClaim = false;

export function canStartAudibleAction(state: Pick<AppState, "playback" | "recording">): boolean {
  return (
    !pendingAudibleClaim &&
    !state.playback.isPlaying &&
    !state.playback.isExporting &&
    state.recording.state === "idle"
  );
}

export function claimPendingAudible(): (() => void) | null {
  if (!canStartAudibleAction(useAppStore.getState())) return null;

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
