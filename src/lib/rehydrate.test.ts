// ABOUTME: rehydrate tests — saved snapshot is restored into the store, blob decode happens.
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

const fakeAudioBuffer = { duration: 1, sampleRate: 48000 } as AudioBuffer;
vi.mock("./audio", () => ({
  getAudioContext: () => ({
    decodeAudioData: vi.fn(async () => fakeAudioBuffer),
  }),
}));

import { rehydrateFromStorage } from "./rehydrate";
import { saveProject, clearProject } from "./persistence";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

function makeClip(): Clip {
  return {
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "video/webm" }),
    url: "blob:test/x",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    trimStartMs: 50,
    trimEndMs: 950,
    durationMs: 1000,
  };
}

describe("rehydrateFromStorage", () => {
  beforeEach(async () => {
    useAppStore.getState().actions.reset();
    await clearProject();
  });

  it("returns false when nothing has been saved", async () => {
    const ok = await rehydrateFromStorage();
    expect(ok).toBe(false);
  });

  it("restores a saved project including clips, tags, and steps", async () => {
    useAppStore.getState().actions.setTrackClip(0, makeClip());
    useAppStore.getState().actions.setTrackTag(0, "snare");
    useAppStore.getState().actions.toggleStep(0, 4);
    useAppStore.getState().actions.setBpm(120);
    await saveProject(useAppStore.getState());

    useAppStore.getState().actions.reset();
    expect(useAppStore.getState().project.tracks[0].clip).toBeNull();

    const ok = await rehydrateFromStorage();
    expect(ok).toBe(true);
    const restored = useAppStore.getState();
    expect(restored.project.bpm).toBe(120);
    expect(restored.project.tracks[0].tag).toBe("snare");
    expect(restored.project.tracks[0].steps[4]).toBe(true);
    expect(restored.project.tracks[0].clip?.audioBuffer).toBe(fakeAudioBuffer);
    expect(restored.project.tracks[0].clip?.url).toMatch(/^blob:/);
  });
});
