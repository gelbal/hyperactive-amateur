// ABOUTME: audibleActionGate tests — one predicate shared by playback, pads, keys, recording, and export.
import { describe, expect, it } from "vitest";
import { canStartAudibleAction } from "./audibleActionGate";
import type { PlaybackState, RecordingSlice } from "../types";

function state(
  playback: Partial<PlaybackState> = {},
  recording: Partial<RecordingSlice> = {},
) {
  return {
    playback: {
      isPlaying: false,
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
  it("allows idle starts and blocks exports or active recording states", () => {
    expect(canStartAudibleAction(state())).toBe(true);
    expect(canStartAudibleAction(state({ isPlaying: true }))).toBe(false);
    expect(canStartAudibleAction(state({ isExporting: true }))).toBe(false);
    expect(canStartAudibleAction(state({}, { state: "countdown", activeTrackId: 1 }))).toBe(false);
    expect(canStartAudibleAction(state({}, { state: "recording", activeTrackId: 1 }))).toBe(false);
    expect(canStartAudibleAction(state({}, { state: "reviewing", activeTrackId: 1 }))).toBe(false);
  });
});
