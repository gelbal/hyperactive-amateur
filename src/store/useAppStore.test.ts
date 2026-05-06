// ABOUTME: Action-level tests for the Zustand store — toggleStep, BPM/swing clamps, mute, volume.
// ABOUTME: Each test calls reset() to start from a known state.
import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./useAppStore";

const get = () => useAppStore.getState();

describe("useAppStore", () => {
  beforeEach(() => {
    get().actions.reset();
  });

  describe("toggleStep", () => {
    it("flips the targeted step and leaves others unchanged", () => {
      get().actions.toggleStep(2, 5);
      const track = get().project.tracks[2];
      expect(track.steps[5]).toBe(true);
      expect(track.steps.filter((s) => s).length).toBe(1);
    });

    it("toggles back to false on second call", () => {
      get().actions.toggleStep(0, 0);
      get().actions.toggleStep(0, 0);
      expect(get().project.tracks[0].steps[0]).toBe(false);
    });

    it("only mutates the specified track", () => {
      get().actions.toggleStep(3, 7);
      const others = get().project.tracks.filter((t) => t.id !== 3);
      expect(others.every((t) => t.steps.every((s) => !s))).toBe(true);
    });
  });

  describe("setBpm", () => {
    it("clamps to 180 when given 250", () => {
      get().actions.setBpm(250);
      expect(get().project.bpm).toBe(180);
    });

    it("clamps to 60 when given 30", () => {
      get().actions.setBpm(30);
      expect(get().project.bpm).toBe(60);
    });

    it("accepts a value in range", () => {
      get().actions.setBpm(120);
      expect(get().project.bpm).toBe(120);
    });
  });

  describe("setSwing", () => {
    it("clamps to [0, 1]", () => {
      get().actions.setSwing(-0.5);
      expect(get().project.swing).toBe(0);
      get().actions.setSwing(2);
      expect(get().project.swing).toBe(1);
      get().actions.setSwing(0.4);
      expect(get().project.swing).toBe(0.4);
    });
  });

  describe("setTrackVolume", () => {
    it("only mutates the targeted track", () => {
      get().actions.setTrackVolume(3, 0.25);
      expect(get().project.tracks[3].volume).toBe(0.25);
      const others = get().project.tracks.filter((t) => t.id !== 3);
      expect(others.every((t) => t.volume === 1)).toBe(true);
    });

    it("clamps volume to [0, 1]", () => {
      get().actions.setTrackVolume(0, 5);
      expect(get().project.tracks[0].volume).toBe(1);
      get().actions.setTrackVolume(0, -1);
      expect(get().project.tracks[0].volume).toBe(0);
    });
  });

  describe("setTrackMuted", () => {
    it("toggles the mute flag on the targeted track", () => {
      get().actions.setTrackMuted(4, true);
      expect(get().project.tracks[4].muted).toBe(true);
      get().actions.setTrackMuted(4, false);
      expect(get().project.tracks[4].muted).toBe(false);
    });
  });

  describe("reset", () => {
    it("returns the store to a fresh initial state", () => {
      get().actions.setBpm(150);
      get().actions.toggleStep(0, 0);
      get().actions.reset();
      expect(get().project.bpm).toBe(90);
      expect(get().project.tracks[0].steps[0]).toBe(false);
    });
  });
});
