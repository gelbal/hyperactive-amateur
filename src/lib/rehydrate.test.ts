// ABOUTME: rehydrate tests — saved snapshot is restored into the store, blob decode happens.
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { set } from "idb-keyval";

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
import {
  PROJECT_KEY,
  clearProject,
  loadProject,
  loadRecoveryBackup,
  saveProject,
} from "./persistence";
import * as persistence from "./persistence";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

async function persistedBlob(bytes: number[], type: string): Promise<Blob> {
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": type },
  }).blob();
}

async function makeClip(): Promise<Clip> {
  return {
    blob: await persistedBlob([1, 2, 3], "video/webm"),
    url: "blob:test/x",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    audioBlob: await persistedBlob([4, 5, 6], "audio/wav"),
    trimStartMs: 50,
    trimEndMs: 950,
    durationMs: 1000,
    posterBlob: await persistedBlob([9], "image/jpeg"),
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

  it("returns a structured miss when nothing has been saved", async () => {
    const result = await rehydrateFromStorage();
    expect(result).toEqual({ ok: false, degraded: false, warnings: [] });
  });

  it("restores a saved project including clips, tags, and steps", async () => {
    useAppStore.getState().actions.setTrackClip(0, await makeClip());
    useAppStore.getState().actions.setTrackTag(0, "snare");
    useAppStore.getState().actions.toggleStep(0, 4);
    useAppStore.getState().actions.setBpm(120);
    await saveProject(useAppStore.getState());

    useAppStore.getState().actions.reset();
    expect(useAppStore.getState().project.tracks[0].clip).toBeNull();

    const result = await rehydrateFromStorage();
    expect(result).toEqual({ ok: true, degraded: false, warnings: [] });
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
    useAppStore.getState().actions.setTrackClip(0, await makeClip());
    await saveProject(useAppStore.getState());

    useAppStore.getState().actions.reset();
    const result = await rehydrateFromStorage();

    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(false);
    expect(useAppStore.getState().project.tracks[0].clip?.audioBuffer).toBe(
      audioMocks.sidecarAudioBuffer,
    );
    expect(audioMocks.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it("sets recordingStationDismissed=true after rehydrating a project with at least one clip", async () => {
    useAppStore.getState().actions.setTrackClip(0, await makeClip());
    await saveProject(useAppStore.getState());

    useAppStore.getState().actions.reset();
    expect(useAppStore.getState().session.recordingStationDismissed).toBe(false);

    await rehydrateFromStorage();
    expect(useAppStore.getState().session.recordingStationDismissed).toBe(true);
  });

  it("migrates legacy saves through validation and records degraded recovery warnings", async () => {
    const malformed = {
      schemaVersion: 0,
      bpm: 999,
      swing: -0.5,
      cutSubdivision: "bad",
      sameTierHoldMs: "slow",
      subgenre: "jazz",
      vibe: "messy",
      stepCount: 15,
      tagReasoning: { 0: "stale without clip", 99: "out of range" },
      tracks: [
        {
          id: 0,
          clipBlob: null,
          audioBlob: "not a blob",
          posterBlob: "not a blob",
          trimStartMs: 0,
          trimEndMs: 0,
          durationMs: 0,
          tag: "wrong",
          steps: [true, "false", {}, false],
          volume: 4,
          muted: "no",
          showVideo: "yes",
        },
      ],
      updatedAt: "yesterday",
    };
    await set(PROJECT_KEY, malformed);

    const result = await rehydrateFromStorage();

    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(useAppStore.getState().ui.recoveryWarnings).toEqual(result.warnings);

    const project = useAppStore.getState().project;
    expect(project.bpm).toBe(180);
    expect(project.swing).toBe(0);
    expect(project.cutSubdivision).toBe("8n");
    expect(project.sameTierHoldMs).toBe(400);
    expect(project.subgenre).toBe("boom-bap");
    expect(project.vibe).toBe("tight");
    expect(project.stepCount).toBe(16);
    expect(project.tracks).toHaveLength(8);
    expect(project.tracks[0].steps).toHaveLength(16);
    expect(project.tracks[0].steps[0]).toBe(true);
    expect(project.tracks[0].steps[1]).toBe(false);
    expect(project.tracks[0].steps[2]).toBe(false);
    expect(project.tracks[0].volume).toBe(1);
    expect(project.tracks[0].muted).toBe(false);
    expect(project.tracks[0].showVideo).toBe(true);
    expect(project.tagReasoning).toEqual({});

    expect(await loadRecoveryBackup()).not.toBeNull();
    expect((await loadProject())?.stepCount).toBe(15);
  });

  it("migrates a realistic legacy save with no schema version instead of discarding it", async () => {
    await set(PROJECT_KEY, {
      bpm: 111,
      swing: 0.25,
      cutSubdivision: "4n",
      sameTierHoldMs: 600,
      subgenre: "lo-fi",
      vibe: "varied",
      stepCount: 16,
      tagReasoning: {},
      tracks: Array.from({ length: 8 }, (_, id) => ({
        id,
        clipBlob: null,
        audioBlob: null,
        posterBlob: null,
        trimStartMs: 0,
        trimEndMs: 0,
        durationMs: 0,
        tag: null,
        steps: Array.from({ length: 16 }, (_, step) => id === 0 && step === 3),
        volume: 1,
        muted: false,
        showVideo: true,
      })),
      updatedAt: Date.now(),
    });

    const result = await rehydrateFromStorage();

    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.warnings).toContain("Schema version 0 was migrated to 1.");
    expect(useAppStore.getState().project.bpm).toBe(111);
    expect(useAppStore.getState().project.tracks[0].steps[3]).toBe(true);
    expect(await loadRecoveryBackup()).not.toBeNull();
  });

  it("does not hydrate or risk autosave overwrite when degraded recovery backup fails", async () => {
    const saveRecoveryBackupSpy = vi
      .spyOn(persistence, "saveRecoveryBackup")
      .mockRejectedValueOnce(new Error("quota exceeded"));
    await set(PROJECT_KEY, {
      schemaVersion: 0,
      bpm: 123,
      swing: 0,
      cutSubdivision: "8n",
      sameTierHoldMs: 400,
      subgenre: "trap",
      vibe: "tight",
      stepCount: 15,
      tagReasoning: {},
      tracks: [],
      updatedAt: Date.now(),
    });

    const result = await rehydrateFromStorage();

    expect(result.ok).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("autosave was paused"))).toBe(true);
    expect(useAppStore.getState().project.bpm).toBe(90);
    expect(useAppStore.getState().ui.recoveryWarnings).toEqual(result.warnings);
    expect((await loadProject())?.stepCount).toBe(15);

    saveRecoveryBackupSpy.mockRestore();
  });

  it("drops clips that fail audio decode and removes their stale tag reasoning", async () => {
    audioMocks.decodeAudioData.mockRejectedValueOnce(new Error("decode failed"));
    await set(PROJECT_KEY, {
      bpm: 100,
      swing: 0,
      cutSubdivision: "8n",
      sameTierHoldMs: 400,
      subgenre: "trap",
      vibe: "tight",
      stepCount: 16,
      tagReasoning: { 0: "good before corruption" },
      tracks: [
        {
          id: 0,
          clipBlob: await persistedBlob([1], "video/webm"),
          audioBlob: null,
          posterBlob: null,
          trimStartMs: 0,
          trimEndMs: 500,
          durationMs: 500,
          tag: "kick",
          steps: new Array(16).fill(false),
          volume: 1,
          muted: false,
          showVideo: true,
        },
        ...Array.from({ length: 7 }, (_, id) => ({
          id: id + 1,
          clipBlob: null,
          audioBlob: null,
          posterBlob: null,
          trimStartMs: 0,
          trimEndMs: 0,
          durationMs: 0,
          tag: null,
          steps: new Array(16).fill(false),
          volume: 1,
          muted: false,
          showVideo: true,
        })),
      ],
      updatedAt: Date.now(),
    });

    const result = await rehydrateFromStorage();

    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("could not be decoded"))).toBe(true);
    expect(useAppStore.getState().project.tracks[0].clip).toBeNull();
    expect(useAppStore.getState().project.tracks[0].tag).toBeNull();
    expect(useAppStore.getState().project.tagReasoning).toEqual({});
    expect(await loadRecoveryBackup()).not.toBeNull();
  });
});
