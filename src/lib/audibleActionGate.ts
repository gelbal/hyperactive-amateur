// ABOUTME: Shared predicate for user actions that start playback, pad triggers, recording, or exports.
// ABOUTME: Prevents recording/export flows from overlapping and corrupting each other.
import type { AppState } from "../types";
import { useAppStore } from "../store/useAppStore";

let pendingAudibleClaim = false;

type AudibleActionGateState = Pick<AppState, "playback" | "recording"> &
  Partial<Pick<AppState, "mood">>;

export function canStartAudibleAction(state: AudibleActionGateState): boolean {
  const moodIsPerforming = state.mood?.performance.isPerforming ?? false;
  return (
    !pendingAudibleClaim &&
    !state.playback.isPlaying &&
    !state.playback.isExporting &&
    state.recording.state === "idle" &&
    !moodIsPerforming
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
