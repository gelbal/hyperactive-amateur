// ABOUTME: Tests for createInitialState — verifies shape, defaults, and per-call independence.
// ABOUTME: Independence matters because we reuse the factory in store reset paths.
import { describe, it, expect } from "vitest";
import { createInitialState } from "./initialState";

describe("createInitialState", () => {
  it("defaults bpm to 90, swing to 0, cutSubdivision '8n', sameTierHoldMs 400", () => {
    const state = createInitialState();
    expect(state.project.bpm).toBe(90);
    expect(state.project.swing).toBe(0);
    expect(state.project.cutSubdivision).toBe("8n");
    expect(state.project.sameTierHoldMs).toBe(400);
  });

  it("creates exactly 8 tracks", () => {
    const state = createInitialState();
    expect(state.project.tracks).toHaveLength(8);
  });

  it("gives every track 16 false steps", () => {
    const state = createInitialState();
    for (const track of state.project.tracks) {
      expect(track.steps).toHaveLength(16);
      expect(track.steps.every((s) => s === false)).toBe(true);
    }
  });

  it("defaults every track to showVideo: true", () => {
    const state = createInitialState();
    for (const track of state.project.tracks) {
      expect(track.showVideo).toBe(true);
    }
  });

  it("assigns ids 0 through 7 in order", () => {
    const state = createInitialState();
    expect(state.project.tracks.map((t) => t.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("returns independent objects on each call", () => {
    const a = createInitialState();
    const b = createInitialState();
    a.project.bpm = 120;
    a.project.tracks[0].steps[0] = true;
    expect(b.project.bpm).toBe(90);
    expect(b.project.tracks[0].steps[0]).toBe(false);
  });

  it("initializes default playback / recording / ui / media state", () => {
    const state = createInitialState();
    expect(state.playback).toEqual({
      isPlaying: false,
      currentStep: 0,
      activeTriggers: [],
      triggerSeq: [0, 0, 0, 0, 0, 0, 0, 0],
    });
    expect(state.recording).toEqual({ activeTrackId: null, state: "idle" });
    expect(state.ui).toEqual({ selectedTrackId: null, showExportDialog: false });
    expect(state.media).toEqual({ stream: null, status: "idle", error: null });
  });
});
