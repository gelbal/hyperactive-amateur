// ABOUTME: Shared predicate for user actions that start playback, pad triggers, recording, or exports.
// ABOUTME: Prevents recording/export flows from overlapping and corrupting each other.
import type { AppState } from "../types";

export function canStartAudibleAction(state: Pick<AppState, "playback" | "recording">): boolean {
  return (
    !state.playback.isPlaying &&
    !state.playback.isExporting &&
    state.recording.state === "idle"
  );
}
