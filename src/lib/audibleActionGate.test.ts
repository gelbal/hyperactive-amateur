// ABOUTME: audibleActionGate tests — one predicate shared by playback, pads, keys, recording, and export.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetPendingAudibleClaimForTesting,
  canStartAudibleAction,
  canStartMoodPerformanceTap,
  canStartMoodTake,
  claimPendingAudible,
} from "./audibleActionGate";
import type { AppState, PlaybackState, RecordingSlice } from "../types";
import { useAppStore } from "../store/useAppStore";

type GateState = Pick<AppState, "playback" | "recording"> & Partial<Pick<AppState, "mood">>;

function state(
  playback: Partial<PlaybackState> = {},
  recording: Partial<RecordingSlice> = {},
): GateState {
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
      countdownEndsAt: null,
      error: null,
      ...recording,
    },
  };
}

function moodState(
  isPerforming: boolean,
  playback: Partial<PlaybackState> = {},
  recording: Partial<RecordingSlice> = {},
): GateState {
  const mood = useAppStore.getState().mood;
  return {
    ...state(playback, recording),
    mood: {
      ...mood,
      performance: {
        ...mood.performance,
        isPerforming,
      },
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
    expect(canStartAudibleAction(state({}, { state: "preparing", activeTrackId: 1 }))).toBe(false);
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

describe("spec section 7 audible gate policy matrix", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
  });

  afterEach(() => {
    __resetPendingAudibleClaimForTesting();
  });

  it("Chop record x Chop playing: blocked", () => {
    expect(canStartAudibleAction(state({ isPlaying: true }))).toBe(false);
  });

  it("Chop record x Mood performing: blocked", () => {
    expect(canStartAudibleAction(moodState(true))).toBe(false);
  });

  it("Chop record x Recording: blocked", () => {
    expect(canStartAudibleAction(state({}, { state: "recording", activeTrackId: 1 }))).toBe(false);
  });

  it("Chop record x Exporting: blocked", () => {
    expect(canStartAudibleAction(state({ isExporting: true }))).toBe(false);
  });

  it("Mood take record x Chop playing: blocked", () => {
    expect(canStartMoodTake(state({ isPlaying: true }))).toBe(false);
  });

  it("Mood take record x Mood performing: allowed", () => {
    expect(canStartMoodTake(moodState(true))).toBe(true);
  });

  it("Mood take record x Recording: blocked", () => {
    expect(canStartMoodTake(state({}, { state: "recording", activeTrackId: 1 }))).toBe(false);
  });

  it("Mood take record x Exporting: blocked", () => {
    expect(canStartMoodTake(state({ isExporting: true }))).toBe(false);
  });

  it("Export x Chop playing: blocked", () => {
    expect(canStartAudibleAction(state({ isPlaying: true }))).toBe(false);
  });

  it("Export x Mood performing: blocked", () => {
    expect(canStartAudibleAction(moodState(true))).toBe(false);
  });

  it("Export x Recording: blocked", () => {
    expect(canStartAudibleAction(state({}, { state: "recording", activeTrackId: 1 }))).toBe(false);
  });

  it("Export x Exporting: blocked", () => {
    expect(canStartAudibleAction(state({ isExporting: true }))).toBe(false);
  });

  it("Mood take record x Pending audible claim: blocked", () => {
    const release = claimPendingAudible();

    expect(release).toEqual(expect.any(Function));
    expect(canStartMoodTake(state())).toBe(false);

    release?.();
  });

  it("Mood performance taps x Chop playing: not an audible-start gate", () => {
    expect(canStartMoodPerformanceTap(moodState(true, { isPlaying: true }))).toBe(true);
  });

  it("Mood performance taps x Mood performing: allowed", () => {
    expect(canStartMoodPerformanceTap(moodState(true))).toBe(true);
  });

  it("Mood performance taps x Recording: blocked", () => {
    expect(
      canStartMoodPerformanceTap(moodState(true, {}, { state: "recording", activeTrackId: 1 })),
    ).toBe(false);
  });

  it("Mood performance taps x Exporting: allowed during the performance export", () => {
    expect(canStartMoodPerformanceTap(moodState(true, { isExporting: true }))).toBe(true);
  });
});
