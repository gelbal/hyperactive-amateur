// ABOUTME: audibleActionGate tests — one predicate shared by playback, pads, keys, recording, and export.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetPendingAudibleClaimForTesting,
  canStartAudibleAction,
  claimPendingAudible,
} from "./audibleActionGate";
import type { AppState, PlaybackState, RecordingSlice } from "../types";
import { useAppStore } from "../store/useAppStore";

function state(
  playback: Partial<PlaybackState> = {},
  recording: Partial<RecordingSlice> = {},
): Pick<AppState, "playback" | "recording"> {
  return {
    playback: {
      isPlaying: false,
      audioState: "unknown",
      isExporting: false,
      currentStep: 0,
      activeTriggers: [],
      triggerSeq: new Array(8).fill(0),
      ...playback,
    },
    recording: {
      state: "idle" as const,
      activeTrackId: null,
      ...recording,
    },
  };
}

describe("canStartAudibleAction", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
  });

  afterEach(() => {
    __resetPendingAudibleClaimForTesting();
  });

  it("allows idle starts and blocks exports or active recording states", () => {
    expect(canStartAudibleAction(state())).toBe(true);
    expect(canStartAudibleAction(state({ isPlaying: true }))).toBe(false);
    expect(canStartAudibleAction(state({ isExporting: true }))).toBe(false);
    expect(canStartAudibleAction(state({}, { state: "countdown", activeTrackId: 1 }))).toBe(false);
    expect(canStartAudibleAction(state({}, { state: "recording", activeTrackId: 1 }))).toBe(false);
    expect(canStartAudibleAction(state({}, { state: "reviewing", activeTrackId: 1 }))).toBe(false);
  });

  it("claimPendingAudible holds the gate until its idempotent release", () => {
    const release = claimPendingAudible();

    expect(release).toEqual(expect.any(Function));
    expect(canStartAudibleAction(state())).toBe(false);
    expect(claimPendingAudible()).toBeNull();

    release?.();
    release?.();

    expect(canStartAudibleAction(state())).toBe(true);
  });

  it("test reset seam clears a leaked pending claim", () => {
    expect(claimPendingAudible()).toEqual(expect.any(Function));
    expect(canStartAudibleAction(state())).toBe(false);

    __resetPendingAudibleClaimForTesting();

    expect(canStartAudibleAction(state())).toBe(true);
  });

  it("claimPendingAudible returns null when another audible owner is active", () => {
    useAppStore.getState().actions.setRecordingState("recording", 0);

    expect(claimPendingAudible()).toBeNull();
    expect(canStartAudibleAction(useAppStore.getState())).toBe(false);

    useAppStore.getState().actions.setRecordingState("idle", null);

    expect(canStartAudibleAction(useAppStore.getState())).toBe(true);
  });
});
