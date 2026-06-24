// ABOUTME: rehydrate tests — saved snapshot is restored into the store, blob decode happens.
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

const audioMocks = vi.hoisted(() => ({
  fakeAudioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
  sidecarAudioBuffer: { duration: 0.5, sampleRate: 48000 } as AudioBuffer,
  decodeAudioData: vi.fn(),
}));

const fakeAudioBuffer = audioMocks.fakeAudioBuffer;
vi.mock("./audio", () => ({
  getAudioContext: () => ({
    decodeAudioData: audioMocks.decodeAudioData,
  }),
}));
// jsdom can't decode video — short-circuit poster regen so legacy-row tests
// don't wait on the 1.5s captureFirstFrame timeout.
vi.mock("./posterFrame", () => ({
  captureFirstFrame: vi.fn(async () => null),
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
    audioBlob: new Blob([new Uint8Array([4, 5, 6])], { type: "audio/wav" }),
    trimStartMs: 50,
    trimEndMs: 950,
    durationMs: 1000,
    posterBlob: new Blob([new Uint8Array([9])], { type: "image/jpeg" }),
    posterUrl: "blob:test/poster",
  };
}

describe("rehydrateFromStorage", () => {
  beforeEach(async () => {
    useAppStore.getState().actions.reset();
    await clearProject();
    audioMocks.decodeAudioData.mockReset();
    audioMocks.decodeAudioData.mockResolvedValue(fakeAudioBuffer);
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
    // Persisted posterBlob is restored as a fresh object URL.
    expect(restored.project.tracks[0].clip?.posterUrl).toMatch(/^blob:/);
  });

  it("uses a persisted audio sidecar instead of decoding the video blob as audio", async () => {
    audioMocks.decodeAudioData.mockResolvedValueOnce(audioMocks.sidecarAudioBuffer);
    useAppStore.getState().actions.setTrackClip(0, makeClip());
    await saveProject(useAppStore.getState());

    useAppStore.getState().actions.reset();
    const ok = await rehydrateFromStorage();

    expect(ok).toBe(true);
    expect(useAppStore.getState().project.tracks[0].clip?.audioBuffer).toBe(
      audioMocks.sidecarAudioBuffer,
    );
    expect(audioMocks.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it("sets recordingStationDismissed=true after rehydrating a project with at least one clip", async () => {
    useAppStore.getState().actions.setTrackClip(0, makeClip());
    await saveProject(useAppStore.getState());

    useAppStore.getState().actions.reset();
    expect(useAppStore.getState().session.recordingStationDismissed).toBe(false);

    await rehydrateFromStorage();
    expect(useAppStore.getState().session.recordingStationDismissed).toBe(true);
  });
});
