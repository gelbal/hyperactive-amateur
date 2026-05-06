// ABOUTME: persistence tests — round-trip save/load via fake-indexeddb, plus clear.
import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { saveProject, loadProject, clearProject, snapshot } from "./persistence";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

function makeClip(): Clip {
  return {
    blob: new Blob([new Uint8Array([7, 8, 9])], { type: "video/webm" }),
    url: "blob:test/abc",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    trimStartMs: 100,
    trimEndMs: 1100,
    durationMs: 2000,
  };
}

describe("persistence", () => {
  beforeEach(async () => {
    useAppStore.getState().actions.reset();
    await clearProject();
  });

  it("snapshot strips the AudioBuffer and url, keeps blob+trim+steps", () => {
    useAppStore.getState().actions.setTrackClip(0, makeClip());
    useAppStore.getState().actions.toggleStep(0, 4);
    useAppStore.getState().actions.setTrackTag(0, "kick");
    const snap = snapshot(useAppStore.getState());
    expect(snap.version).toBe(1);
    expect(snap.bpm).toBe(90);
    expect(snap.tracks[0].clipBlob).toBeInstanceOf(Blob);
    expect(snap.tracks[0].trimStartMs).toBe(100);
    expect(snap.tracks[0].steps[4]).toBe(true);
    expect(snap.tracks[0].tag).toBe("kick");
    expect(snap.tracks[1].clipBlob).toBeNull();
  });

  it("save then load returns an equivalent shape", async () => {
    useAppStore.getState().actions.setBpm(110);
    useAppStore.getState().actions.toggleStep(2, 7);
    await saveProject(useAppStore.getState());
    const loaded = await loadProject();
    expect(loaded).not.toBeNull();
    expect(loaded?.bpm).toBe(110);
    expect(loaded?.tracks[2].steps[7]).toBe(true);
    expect(loaded?.tracks[0].steps[0]).toBe(false);
  });

  it("clearProject removes the record", async () => {
    await saveProject(useAppStore.getState());
    await clearProject();
    const loaded = await loadProject();
    expect(loaded).toBeNull();
  });
});
