// ABOUTME: Tests for the store actions that contain real logic — clamping, side-effects, slicing.
// ABOUTME: Trivial setters (setIsPlaying, setBpm-in-range, etc.) are not tested directly; they're verified by the components that drive them.
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { useAppStore } from "./useAppStore";

const get = () => useAppStore.getState();

describe("useAppStore", () => {
  beforeEach(() => {
    get().actions.reset();
  });

  it("setBpm clamps to [60, 180]", () => {
    get().actions.setBpm(250);
    expect(get().project.bpm).toBe(180);
    get().actions.setBpm(30);
    expect(get().project.bpm).toBe(60);
  });

  it("setSameTierHoldMs clamps to [0, 2000]", () => {
    get().actions.setSameTierHoldMs(-10);
    expect(get().project.sameTierHoldMs).toBe(0);
    get().actions.setSameTierHoldMs(5000);
    expect(get().project.sameTierHoldMs).toBe(2000);
  });

  it("setTrackShowVideo records user-source toggles in the session list", () => {
    get().actions.setTrackShowVideo(2, false, "user");
    expect(get().session.manuallyToggledShowVideo).toContain(2);
    // System-source toggles do NOT mark the track as user-touched.
    get().actions.setTrackShowVideo(3, false, "system");
    expect(get().session.manuallyToggledShowVideo).not.toContain(3);
  });

  it("extendSteps adds 4 false steps to every track", () => {
    get().actions.extendSteps();
    expect(get().project.stepCount).toBe(20);
    for (const track of get().project.tracks) expect(track.steps).toHaveLength(20);
  });

  it("removeStepColumn drops the column from every track and clamps at the floor", () => {
    get().actions.toggleStep(0, 5);
    get().actions.removeStepColumn(2);
    expect(get().project.stepCount).toBe(15);
    // Step 5 shifted down to index 4.
    expect(get().project.tracks[0].steps[4]).toBe(true);
    // Squeeze down to the 4-step floor; further removes are no-ops.
    while (get().project.stepCount > 4) get().actions.removeStepColumn(0);
    get().actions.removeStepColumn(0);
    expect(get().project.stepCount).toBe(4);
  });

  it("scratch revokes object URLs on every clip and resets state", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const clip = {
      blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
      url: "blob:test/x",
      audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
      trimStartMs: 0,
      trimEndMs: 800,
      durationMs: 1000,
    };
    get().actions.setTrackClip(0, clip);
    get().actions.setTrackClip(2, { ...clip, url: "blob:test/y" });
    get().actions.setBpm(140);

    get().actions.scratch();

    expect(revoke).toHaveBeenCalledWith("blob:test/x");
    expect(revoke).toHaveBeenCalledWith("blob:test/y");
    expect(get().project.bpm).toBe(90);
    expect(get().project.tracks[0].clip).toBeNull();
    revoke.mockRestore();
  });

  it("applyPattern only writes rows whose length matches the current stepCount", () => {
    const valid = Array.from({ length: 8 }, (_, i) =>
      Array.from({ length: 16 }, (_, j) => i === 0 && j === 0),
    );
    get().actions.applyPattern(valid);
    expect(get().project.tracks[0].steps[0]).toBe(true);

    // A grid the wrong length is ignored row-by-row.
    const wrong = Array.from({ length: 8 }, () => Array.from({ length: 12 }, () => true));
    const before = get().project.tracks[0].steps.slice();
    get().actions.applyPattern(wrong);
    expect(get().project.tracks[0].steps).toEqual(before);
  });
});
