// ABOUTME: Tests for the store actions that contain real logic — clamping, side-effects, slicing.
// ABOUTME: Trivial setters (setIsPlaying, setBpm-in-range, etc.) are not tested directly; they're verified by the components that drive them.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
const audioLifecycleMocks = vi.hoisted(() => ({
  noteMicHeld: vi.fn(),
  noteMicReleased: vi.fn(),
}));

vi.mock("../lib/audioLifecycle", () => ({
  noteMicHeld: audioLifecycleMocks.noteMicHeld,
  noteMicReleased: audioLifecycleMocks.noteMicReleased,
}));

import { registerStreamLifecycle } from "../lib/streamLifecycle";
import { __resetMediaForTesting } from "../lib/media";
import { logger, LOG_EVENTS } from "../lib/logger";
import {
  APP_MODE_STORAGE_KEY,
  AUDIO_DEVICE_STORAGE_KEY,
  VIDEO_DEVICE_STORAGE_KEY,
} from "./initialState";
import { createEmptyMoodPiece, MAX_TAKES_PER_MIC } from "../lib/moodStages";
import type { Clip, MoodPart, MoodTake } from "../types";
import { useAppStore } from "./useAppStore";

const get = () => useAppStore.getState();

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    url: "blob:test/clip",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
    posterBlob: null,
    posterUrl: null,
    ...overrides,
  };
}

function makeMoodTake(overrides: Partial<MoodTake> = {}): MoodTake {
  const id = overrides.id ?? "take-1";
  const durationSeconds = overrides.durationSeconds ?? 1.5;
  return {
    id,
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    audioBlob: null,
    posterBlob: null,
    url: `blob:test/${id}`,
    audioBuffer: { duration: durationSeconds, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    posterUrl: null,
    trimStartMs: 0,
    trimEndMs: durationSeconds * 1000,
    durationSeconds,
    cycleMultiple: 1,
    syncOffsetMs: 0,
    part: null,
    partSource: null,
    recordedAt: 1,
    ...overrides,
  };
}

function makeFakeStream() {
  const tracks = [
    Object.assign(new EventTarget(), {
      stop: vi.fn(),
      readyState: "live" as "live" | "ended",
    }),
    Object.assign(new EventTarget(), {
      stop: vi.fn(),
      readyState: "live" as "live" | "ended",
    }),
  ];
  return {
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useAppStore", () => {
  let originalMediaDevices: MediaDevices | undefined;

  beforeEach(() => {
    __resetMediaForTesting();
    originalMediaDevices = (navigator as Navigator & { mediaDevices?: MediaDevices }).mediaDevices;
    get().actions.setIsExporting(false);
    window.localStorage.removeItem(APP_MODE_STORAGE_KEY);
    window.localStorage.removeItem(VIDEO_DEVICE_STORAGE_KEY);
    window.localStorage.removeItem(AUDIO_DEVICE_STORAGE_KEY);
    get().actions.reset();
    audioLifecycleMocks.noteMicHeld.mockClear();
    audioLifecycleMocks.noteMicReleased.mockClear();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  it("tracks transient audio context state in the playback slice", () => {
    expect(get().playback.audioState).toBe("unknown");

    get().actions.setAudioState("resume-required");
    expect(get().playback.audioState).toBe("resume-required");
  });

  it("tracks storage durability in the transient session slice", () => {
    expect(get().session.storageDurability).toBe("unknown");

    get().actions.setStorageDurability("best-effort");
    expect(get().session.storageDurability).toBe("best-effort");

    get().actions.setStorageDurability("persistent");
    expect(get().session.storageDurability).toBe("persistent");
  });

  it("tracks transient recording countdown deadline and explicit error state", () => {
    expect(get().recording.countdownEndsAt).toBeNull();
    expect(get().recording.error).toBeNull();

    get().actions.setCountdownEndsAt(12.5);
    get().actions.setRecordingError("camera failed");
    expect(get().recording.countdownEndsAt).toBe(12.5);
    expect(get().recording.error).toBe("camera failed");

    get().actions.setRecordingState("idle", null);
    expect(get().recording.error).toBe("camera failed");

    get().actions.setCountdownEndsAt(null);
    get().actions.setRecordingError(null);
    expect(get().recording.countdownEndsAt).toBeNull();
    expect(get().recording.error).toBeNull();

    get().actions.setCountdownEndsAt(24);
    get().actions.setRecordingError("stale failure");
    get().actions.setRecordingState("preparing", 3);
    expect(get().recording.countdownEndsAt).toBeNull();
    expect(get().recording.error).toBeNull();
  });

  it("resumeMedia no-ops while recording is active", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(makeFakeStream());
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    get().actions.setMedia({ stream: null, status: "suspended", error: null });
    get().actions.setRecordingState("countdown", 0);

    await get().actions.resumeMedia();

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(get().media.status).toBe("suspended");
  });

  it("resumeMedia no-ops while an acquire is already in flight", async () => {
    const acquisition = deferred<MediaStream>();
    const stream = makeFakeStream();
    const getUserMedia = vi.fn().mockReturnValue(acquisition.promise);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    get().actions.setMedia({ stream: null, status: "suspended", error: null });

    const first = get().actions.resumeMedia();
    const second = get().actions.resumeMedia();

    acquisition.resolve(stream);
    await Promise.allSettled([first, second]);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(get().media.stream).toBe(stream);
    expect(get().media.status).toBe("granted");
  });

  it("toggleVideoFacingMode clears and unpersists the pinned video device", () => {
    get().actions.setPreferredDevices({ video: "rear-camera-id" });
    expect(get().media.videoDeviceId).toBe("rear-camera-id");
    expect(window.localStorage.getItem(VIDEO_DEVICE_STORAGE_KEY)).toBe("rear-camera-id");

    get().actions.toggleVideoFacingMode();

    expect(get().media.videoFacingMode).toBe("environment");
    expect(get().media.videoDeviceId).toBeNull();
    expect(window.localStorage.getItem(VIDEO_DEVICE_STORAGE_KEY)).toBeNull();

    get().actions.setPreferredDevices({ video: "front-camera-id" });
    expect(get().media.videoDeviceId).toBe("front-camera-id");
    expect(window.localStorage.getItem(VIDEO_DEVICE_STORAGE_KEY)).toBe("front-camera-id");
  });

  it("setBpm and setSameTierHoldMs clamp to their valid ranges", () => {
    get().actions.setBpm(250);
    expect(get().project.bpm).toBe(180);
    get().actions.setBpm(30);
    expect(get().project.bpm).toBe(60);

    get().actions.setSameTierHoldMs(-10);
    expect(get().project.sameTierHoldMs).toBe(0);
    get().actions.setSameTierHoldMs(5000);
    expect(get().project.sameTierHoldMs).toBe(2000);
  });

  it("setTrackShowVideo records user-source toggles in the session list (system-source does not)", () => {
    get().actions.setTrackShowVideo(2, false, "user");
    expect(get().session.manuallyToggledShowVideo).toContain(2);
    get().actions.setTrackShowVideo(3, false, "system");
    expect(get().session.manuallyToggledShowVideo).not.toContain(3);
  });

  it("setTrackTag records user-source picks in manuallyTagged; system-source does not; user pick drops stale reasoning", () => {
    // System assignment (auto-tag) doesn't claim the track.
    get().actions.setTrackTag(0, "kick", "system");
    expect(get().session.manuallyTagged).not.toContain(0);
    // Seed reasoning, then a user pick claims the track and clears it.
    get().actions.setTrackTagReasoning(1, "bright short tick");
    expect(get().project.tagReasoning[1]).toBe("bright short tick");
    get().actions.setTrackTag(1, "snare", "user");
    expect(get().session.manuallyTagged).toContain(1);
    expect(get().project.tagReasoning[1]).toBeUndefined();
    // Default source is "user" — preserves chip-picker behavior; idempotent.
    get().actions.setTrackTag(2, "hat");
    get().actions.setTrackTag(2, "kick");
    expect(get().session.manuallyTagged.filter((id) => id === 2).length).toBe(1);
  });

  it("extendSteps grows every track by the increment with false padding and caps at MAX_STEP_COUNT", () => {
    get().actions.toggleStep(0, 5);
    const start = get().project.stepCount;
    get().actions.extendSteps();
    const grown = get().project.stepCount;
    expect(grown).toBeGreaterThan(start);
    // Every track now has the new length; the original true step survives;
    // the new trailing cells are false.
    for (const t of get().project.tracks) {
      expect(t.steps.length).toBe(grown);
      for (let i = start; i < grown; i++) expect(t.steps[i]).toBe(false);
    }
    expect(get().project.tracks[0].steps[5]).toBe(true);
    // Push to the cap — further extends must be no-ops.
    while (get().project.stepCount < 64) get().actions.extendSteps();
    expect(get().project.stepCount).toBe(64);
    get().actions.extendSteps();
    expect(get().project.stepCount).toBe(64);
  });

  it("removeStepColumn drops a 4-step block from every track and clamps at the floor", () => {
    get().actions.toggleStep(0, 1);
    get().actions.toggleStep(0, 6);
    get().actions.toggleStep(0, 10);

    get().actions.removeStepColumn(5);

    expect(get().project.stepCount).toBe(12);
    // The block containing step 6 is removed; later steps shift down by 4.
    expect(get().project.tracks[0].steps[1]).toBe(true);
    expect(get().project.tracks[0].steps[6]).toBe(true);
    expect(get().project.tracks[0].steps.filter(Boolean)).toHaveLength(2);
    for (const track of get().project.tracks) {
      expect(track.steps).toHaveLength(get().project.stepCount);
    }

    // Squeeze down to the 4-step floor; further removes are no-ops.
    while (get().project.stepCount > 4) get().actions.removeStepColumn(0);
    get().actions.removeStepColumn(0);
    expect(get().project.stepCount).toBe(4);
  });

  it("scratch revokes object URLs on every clip and resets state", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const clip: Clip = {
      blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
      url: "blob:test/x",
      audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
      audioStatus: "ok",
      trimStartMs: 0,
      trimEndMs: 800,
      durationMs: 1000,
      posterBlob: new Blob([new Uint8Array([9])], { type: "image/jpeg" }),
      posterUrl: "blob:test/poster-x",
    };
    get().actions.setTrackClip(0, clip);
    get().actions.setTrackClip(2, { ...clip, url: "blob:test/y", posterUrl: "blob:test/poster-y" });
    get().actions.setBpm(140);

    get().actions.scratch();

    expect(revoke).toHaveBeenCalledWith("blob:test/x");
    expect(revoke).toHaveBeenCalledWith("blob:test/y");
    expect(revoke).toHaveBeenCalledWith("blob:test/poster-x");
    expect(revoke).toHaveBeenCalledWith("blob:test/poster-y");
    expect(get().project.bpm).toBe(90);
    expect(get().project.tracks[0].clip).toBeNull();
    revoke.mockRestore();
  });

  it("scratch releases a held stream through the lifecycle owner", () => {
    const tracks = [
      Object.assign(new EventTarget(), { stop: vi.fn() }),
      Object.assign(new EventTarget(), { stop: vi.fn() }),
    ];
    const stream = {
      getTracks: () => tracks,
    } as unknown as MediaStream;
    registerStreamLifecycle(stream);
    get().actions.setMedia({ stream, status: "granted", error: null });
    audioLifecycleMocks.noteMicReleased.mockClear();

    get().actions.scratch();

    expect(audioLifecycleMocks.noteMicReleased).toHaveBeenCalledTimes(1);
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(tracks[1].stop).toHaveBeenCalledTimes(1);
    expect(get().media.stream).toBeNull();
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

  it("ignores output-affecting project mutations while export is active", () => {
    const before = get().project;
    const sessionBefore = get().session;
    const clip: Clip = {
      blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
      url: "blob:test/export-clip",
      audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
      audioStatus: "ok",
      trimStartMs: 0,
      trimEndMs: 800,
      durationMs: 1000,
      posterBlob: null,
      posterUrl: null,
    };
    get().actions.setIsExporting(true);

    get().actions.setBpm(140);
    get().actions.setSubgenre("lo-fi");
    get().actions.setVibe("breaky");
    get().actions.toggleStep(0, 0);
    get().actions.setTrackVolume(0, 0.25);
    get().actions.setTrackMuted(0, true);
    get().actions.setTrackClip(0, clip);
    get().actions.setTrackTag(0, "kick");
    get().actions.setTrackTagReasoning(0, "would change rendered priority");
    get().actions.setTrackShowVideo(0, false);
    get().actions.extendSteps();
    get().actions.applyPattern(Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => true)));

    expect(get().project).toBe(before);
    expect(get().session).toBe(sessionBefore);
    get().actions.setIsExporting(false);
  });

  it("clearTrackClip revokes both blob URL and poster URL and re-opens the recording station", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const clip: Clip = {
      blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
      url: "blob:test/clip",
      audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
      audioStatus: "ok",
      trimStartMs: 0,
      trimEndMs: 800,
      durationMs: 1000,
      posterBlob: new Blob([new Uint8Array([9])], { type: "image/jpeg" }),
      posterUrl: "blob:test/poster",
    };
    get().actions.setTrackClip(0, clip);
    get().actions.dismissRecordingStation();
    expect(get().session.recordingStationDismissed).toBe(true);

    get().actions.clearTrackClip(0);

    expect(revoke).toHaveBeenCalledWith("blob:test/clip");
    expect(revoke).toHaveBeenCalledWith("blob:test/poster");
    expect(get().project.tracks[0].clip).toBeNull();
    expect(get().session.recordingStationDismissed).toBe(false);
    revoke.mockRestore();
  });

  it("setTrackClip revokes the previous clip's poster URL when replaced", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const first: Clip = {
      blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
      url: "blob:test/a",
      audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
      audioStatus: "ok",
      trimStartMs: 0,
      trimEndMs: 800,
      durationMs: 1000,
      posterBlob: new Blob([new Uint8Array([9])], { type: "image/jpeg" }),
      posterUrl: "blob:test/poster-a",
    };
    const second = { ...first, url: "blob:test/b", posterUrl: "blob:test/poster-b" };
    get().actions.setTrackClip(0, first);
    get().actions.setTrackClip(0, second);
    expect(revoke).toHaveBeenCalledWith("blob:test/a");
    expect(revoke).toHaveBeenCalledWith("blob:test/poster-a");
    revoke.mockRestore();
  });

  it("setTrackPoster attaches and replaces poster blobs without bumping projectRevision", () => {
    const create = vi.spyOn(URL, "createObjectURL");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    create.mockReturnValueOnce("blob:test/poster-a").mockReturnValueOnce("blob:test/poster-b");
    get().actions.setTrackClip(0, makeClip());
    const revision = get().session.projectRevision;
    const blobRevision = get().project.tracks[0].blobRevision ?? 0;
    const firstPoster = new Blob([new Uint8Array([9])], { type: "image/jpeg" });
    const secondPoster = new Blob([new Uint8Array([10])], { type: "image/jpeg" });

    get().actions.setTrackPoster(0, firstPoster);
    expect(get().project.tracks[0].clip?.posterBlob).toBe(firstPoster);
    expect(get().project.tracks[0].clip?.posterUrl).toBe("blob:test/poster-a");
    expect(get().project.tracks[0].blobRevision).toBe(blobRevision + 1);

    get().actions.setTrackPoster(0, secondPoster);
    expect(get().project.tracks[0].clip?.posterBlob).toBe(secondPoster);
    expect(get().project.tracks[0].clip?.posterUrl).toBe("blob:test/poster-b");
    expect(revoke).toHaveBeenCalledWith("blob:test/poster-a");
    expect(get().project.tracks[0].blobRevision).toBe(blobRevision + 2);
    expect(get().session.projectRevision).toBe(revision);
    create.mockRestore();
    revoke.mockRestore();
  });

  // Mirrors how repair state reaches the store in production: rehydrate
  // constructs the repaired track (auto-muted, marked) and hydrates it.
  function hydrateRepairMutedTrack(trackId: number) {
    get().actions.setTrackClip(
      trackId,
      makeClip({ audioBuffer: null, audioStatus: "unavailable" }),
    );
    get().actions.hydrateProject({
      ...get().project,
      tracks: get().project.tracks.map((track) =>
        track.id === trackId ? { ...track, muted: true, mutedByRepair: true } : track,
      ),
    });
    expect(get().project.tracks[trackId].muted).toBe(true);
  }

  it("re-recording over a repair-muted clip clears the repair mute", () => {
    hydrateRepairMutedTrack(0);

    get().actions.setTrackClip(0, makeClip({ url: "blob:test/re-record" }));

    expect(get().project.tracks[0].clip?.audioStatus).toBe("ok");
    expect(get().project.tracks[0].muted).toBe(false);
    expect(get().project.tracks[0].mutedByRepair).toBe(false);
  });

  it("clears a repair mute when re-recording after the repaired clip was cleared", () => {
    hydrateRepairMutedTrack(0);

    get().actions.clearTrackClip(0);
    get().actions.setTrackClip(0, makeClip({ url: "blob:test/re-record" }));

    expect(get().project.tracks[0].muted).toBe(false);
  });

  it("keeps a user's re-mute on a repaired track when re-recording", () => {
    hydrateRepairMutedTrack(0);
    // The user toggles the mute themselves — their intent now owns the state.
    get().actions.setTrackMuted(0, false);
    get().actions.setTrackMuted(0, true);

    get().actions.setTrackClip(0, makeClip({ url: "blob:test/re-record" }));

    expect(get().project.tracks[0].clip?.audioStatus).toBe("ok");
    expect(get().project.tracks[0].muted).toBe(true);
  });

  it("keeps a user's own mute when replacing a healthy clip", () => {
    get().actions.setTrackClip(0, makeClip());
    get().actions.setTrackMuted(0, true);

    get().actions.setTrackClip(0, makeClip({ url: "blob:test/replacement" }));

    expect(get().project.tracks[0].muted).toBe(true);
  });

  it("setTrackClip and clearTrackClip bump the track blobRevision", () => {
    const start = get().project.tracks[0].blobRevision ?? 0;

    get().actions.setTrackClip(0, makeClip());
    expect(get().project.tracks[0].blobRevision).toBe(start + 1);

    get().actions.clearTrackClip(0);
    expect(get().project.tracks[0].blobRevision).toBe(start + 2);
  });

  it("setTrackPoster no-ops while exporting or when the track has no clip", () => {
    const create = vi.spyOn(URL, "createObjectURL");
    const poster = new Blob([new Uint8Array([9])], { type: "image/jpeg" });
    const emptyProject = get().project;
    const emptyRevision = get().session.projectRevision;

    get().actions.setTrackPoster(0, poster);
    expect(get().project).toBe(emptyProject);
    expect(get().session.projectRevision).toBe(emptyRevision);
    expect(create).not.toHaveBeenCalled();

    get().actions.setTrackClip(0, makeClip());
    const clipBeforeExport = get().project.tracks[0].clip;
    const exportRevision = get().session.projectRevision;
    get().actions.setIsExporting(true);

    get().actions.setTrackPoster(0, poster);
    expect(get().project.tracks[0].clip).toBe(clipBeforeExport);
    expect(get().session.projectRevision).toBe(exportRevision);
    expect(create).not.toHaveBeenCalled();
    get().actions.setIsExporting(false);
    create.mockRestore();
  });

  it("setTrackPoster discards a stale poster when the clip changed since capture started", () => {
    const create = vi.spyOn(URL, "createObjectURL");
    const first = makeClip({ url: "blob:test/first" });
    const replacement = makeClip({
      blob: new Blob([new Uint8Array([2])], { type: "video/webm" }),
      url: "blob:test/replacement",
    });
    get().actions.setTrackClip(0, first);
    get().actions.setTrackClip(0, replacement);

    get().actions.setTrackPoster(
      0,
      new Blob([new Uint8Array([9])], { type: "image/jpeg" }),
      first,
    );

    expect(get().project.tracks[0].clip).toBe(replacement);
    expect(get().project.tracks[0].clip?.posterBlob).toBeNull();
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it("hydrateProject sets recordingStationDismissed=true when any incoming track has a clip", () => {
    const baseline = get().project;
    const tracks = baseline.tracks.map((t, i) =>
      i === 0
        ? {
            ...t,
            clip: {
              blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
              url: "blob:test/hydr",
              audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
              audioStatus: "ok" as const,
              trimStartMs: 0,
              trimEndMs: 800,
              durationMs: 1000,
              posterBlob: null,
              posterUrl: null,
            },
          }
        : t,
    );
    get().actions.hydrateProject({ ...baseline, tracks });
    expect(get().session.recordingStationDismissed).toBe(true);
  });

  it("hydrateProject leaves recordingStationDismissed=false when no incoming track has a clip", () => {
    const baseline = get().project;
    get().actions.hydrateProject({ ...baseline });
    expect(get().session.recordingStationDismissed).toBe(false);
  });

  it("stores recovery warnings in the UI slice", () => {
    get().actions.setRecoveryWarnings(["bpm clamped", "track reset"]);
    expect(get().ui.recoveryWarnings).toEqual(["bpm clamped", "track reset"]);
  });

  it("keeps recovery warnings scope-tagged while preserving the string warning list", () => {
    get().actions.setRecoveryWarningsForScope(
      "chop",
      ["Track 1 audio unavailable — re-record to restore sound."],
      true,
    );
    get().actions.setRecoveryWarningsForScope(
      "mood",
      ["Mood take take-1 in mic-0 audio unavailable — re-record to restore sound."],
      true,
    );

    expect(get().ui.recoveryWarnings).toEqual([
      "Track 1 audio unavailable — re-record to restore sound.",
      "Mood take take-1 in mic-0 audio unavailable — re-record to restore sound.",
    ]);
    expect(get().ui.recoveryWarningScopes).toEqual(["chop", "mood"]);
    expect(get().ui.degradedRecoveryScopes).toEqual(["chop", "mood"]);

    get().actions.clearRecoveryWarnings("mood");

    expect(get().ui.recoveryWarnings).toEqual([
      "Track 1 audio unavailable — re-record to restore sound.",
    ]);
    expect(get().ui.recoveryWarningScopes).toEqual(["chop"]);
    expect(get().ui.degradedRecoveryScopes).toEqual(["chop"]);
  });

  it("uses projectRevision to reject stale AI pattern applies", () => {
    const revision = get().session.projectRevision;
    const grid = Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => true));
    get().actions.toggleStep(0, 0);

    const applied = get().actions.applyPatternIfCurrent(grid, revision, 16);

    expect(applied).toBe(false);
    expect(get().project.tracks[0].steps.every(Boolean)).toBe(false);
    expect(get().session.projectRevision).toBeGreaterThan(revision);
  });

  describe("mood slice", () => {
    it("defaults to Chop mode and persists the last selected mode", () => {
      expect(get().appMode).toBe("chop");

      get().actions.setAppMode("mood");

      expect(get().appMode).toBe("mood");
      expect(window.localStorage.getItem(APP_MODE_STORAGE_KEY)).toBe("mood");

      get().actions.reset();
      expect(get().appMode).toBe("mood");

      window.localStorage.setItem(APP_MODE_STORAGE_KEY, "not-a-mode");
      get().actions.reset();
      expect(get().appMode).toBe("chop");
    });

    it("creates an empty Mood piece with idle all-Off performance state", () => {
      const revision = get().session.moodRevision;

      get().actions.createMoodPiece("row", "click", { bpm: 132, cycleBars: 4 });

      expect(get().mood.piece).toMatchObject({
        moodSchemaVersion: 1,
        stage: "row",
        timeFeel: "click",
        bpm: 132,
        cycleBars: 4,
        cycleSeconds: null,
        vibe: "clean",
        lens: "wall",
      });
      expect(get().mood.piece?.mics.map((mic) => mic.id)).toEqual(["mic-0", "mic-1"]);
      expect(get().mood.hydration).toBe("ready");
      expect(get().mood.performance).toMatchObject({
        isPerforming: false,
        epoch: null,
        selections: { "mic-0": "off", "mic-1": "off" },
        armed: { "mic-0": null, "mic-1": null },
        dropActive: false,
        hotMicId: null,
        cycleCount: 0,
      });
      expect(get().session.moodRevision).toBe(revision + 1);
    });

    it("hydrates a decoded Mood piece and records scoped recovery warnings", () => {
      const piece = createEmptyMoodPiece("row", "pocket");
      const take = makeMoodTake({ id: "take-1", audioStatus: "unavailable", audioBuffer: null });
      const hydratedPiece = {
        ...piece,
        cycleSeconds: 1.5,
        oneMicId: "mic-0",
        oneTakeId: "take-1",
        mics: piece.mics.map((mic, index) =>
          index === 0 ? { ...mic, takes: [take] } : mic,
        ),
      };

      get().actions.hydrateMoodPiece({
        ok: true,
        degraded: true,
        piece: hydratedPiece,
        warnings: ["Mood take take-1 in mic-0 audio unavailable — re-record to restore sound."],
      });

      expect(get().mood.hydration).toBe("ready");
      expect(get().mood.piece).toBe(hydratedPiece);
      expect(get().mood.performance.selections).toEqual({
        "mic-0": "off",
        "mic-1": "off",
      });
      expect(get().ui.recoveryWarnings).toEqual([
        "Mood take take-1 in mic-0 audio unavailable — re-record to restore sound.",
      ]);
      expect(get().ui.recoveryWarningScopes).toEqual(["mood"]);
      expect(get().ui.degradedRecoveryScopes).toEqual(["mood"]);
    });

    it("rejects a Click piece without positive bpm and logs an HA event", () => {
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      const revision = get().session.moodRevision;

      get().actions.createMoodPiece("corners", "click", { bpm: 0 });

      expect(get().mood.piece).toBeNull();
      expect(get().session.moodRevision).toBe(revision);
      expect(warn).toHaveBeenCalledWith(
        LOG_EVENTS.MOOD_CLICK_BPM_REJECTED,
        expect.objectContaining({ stage: "corners", bpm: 0 }),
      );
      warn.mockRestore();
    });

    it("freezes piece writers during export while performance actions remain live", () => {
      get().actions.createMoodPiece("corners", "pocket");
      const pieceBeforeExport = get().mood.piece;
      const revisionBeforeExport = get().session.moodRevision;
      get().actions.setIsExporting(true);

      get().actions.createMoodPiece("stack", "pocket");
      get().actions.scratchMoodPiece();
      get().actions.armMoodSelection("mic-0", "take-a");
      get().actions.commitMoodSelections([{ micId: "mic-0", entry: "take-a" }]);
      get().actions.setMoodDrop(true);

      expect(get().mood.piece).toBe(pieceBeforeExport);
      expect(get().session.moodRevision).toBe(revisionBeforeExport);
      expect(get().mood.performance.selections["mic-0"]).toBe("take-a");
      expect(get().mood.performance.armed["mic-0"]).toBeNull();
      expect(get().mood.performance.dropActive).toBe(true);
      get().actions.setIsExporting(false);
    });

    it("stops performance flags on mode switch without forgetting the mix", () => {
      get().actions.createMoodPiece("row", "pocket");
      get().actions.setMoodTake("mic-0", makeMoodTake({ id: "baseline-a" }));
      get().actions.setMoodTake("mic-1", makeMoodTake({ id: "baseline-b" }));
      const micIds = get().mood.piece?.mics.map((mic) => mic.id) ?? [];
      get().actions.setAppMode("mood");
      get().actions.setMoodPerforming(true, 12.5);
      get().actions.commitMoodSelections([{ micId: "mic-0", entry: "take-a" }]);
      get().actions.armMoodSelection("mic-1", "take-b");
      get().actions.setMoodDrop(true);
      get().actions.setMoodHotMic("mic-2");
      get().actions.setMoodCycleCount(7);

      get().actions.setAppMode("chop");
      get().actions.setAppMode("mood");

      expect(get().appMode).toBe("mood");
      expect(get().mood.performance).toEqual({
        isPerforming: false,
        epoch: null,
        selections: {
          ...Object.fromEntries(micIds.map((micId) => [micId, "off"])),
          "mic-0": "take-a",
        },
        armed: {
          ...Object.fromEntries(micIds.map((micId) => [micId, null])),
          "mic-1": "take-b",
        },
        dropActive: false,
        hotMicId: null,
        cycleCount: 0,
      });
    });

    it("ignores app mode changes and preference writes while exporting", () => {
      expect(get().appMode).toBe("chop");
      expect(window.localStorage.getItem(APP_MODE_STORAGE_KEY)).toBeNull();
      get().actions.setIsExporting(true);

      get().actions.setAppMode("mood");

      expect(get().appMode).toBe("chop");
      expect(window.localStorage.getItem(APP_MODE_STORAGE_KEY)).toBeNull();
      get().actions.setIsExporting(false);
    });

    it("bumps moodRevision for piece mutations but not performance mutations", () => {
      const start = get().session.moodRevision;

      get().actions.armMoodSelection("mic-0", "take-a");
      get().actions.commitMoodSelections([{ micId: "mic-0", entry: "take-a" }]);
      get().actions.setMoodPerforming(true, 4);
      get().actions.setMoodDrop(true);
      get().actions.setMoodHotMic("mic-0");
      get().actions.setMoodCycleCount(2);
      expect(get().session.moodRevision).toBe(start);

      get().actions.createMoodPiece("row", "pocket");
      expect(get().session.moodRevision).toBe(start + 1);

      get().actions.setMoodPerforming(true, 8);
      get().actions.scratchMoodPiece();
      expect(get().mood.piece).not.toBeNull();
      expect(get().session.moodRevision).toBe(start + 1);

      get().actions.setMoodPerforming(false);
      get().actions.scratchMoodPiece();
      expect(get().mood.piece).toBeNull();
      expect(get().session.moodRevision).toBe(start + 2);
    });

    describe("mood takes", () => {
      it("establishes the One from a Pocket take and from Click timing rules", () => {
        get().actions.createMoodPiece("corners", "pocket");
        get().actions.setMoodTake("mic-0", makeMoodTake({ id: "pocket-one", durationSeconds: 2.75 }));

        expect(get().mood.piece).toMatchObject({
          cycleSeconds: 2.75,
          oneMicId: "mic-0",
          oneTakeId: "pocket-one",
        });

        get().actions.createMoodPiece("row", "click", { bpm: 120, cycleBars: 2 });
        get().actions.setMoodTake("mic-0", makeMoodTake({ id: "click-one", durationSeconds: 9 }));

        expect(get().mood.piece).toMatchObject({
          cycleSeconds: 4,
          oneMicId: "mic-0",
          oneTakeId: "click-one",
        });
      });

      it("grows linear stage mics after every mic has a take and caps at the stage max", () => {
        get().actions.createMoodPiece("row", "pocket");

        get().actions.setMoodTake("mic-0", makeMoodTake({ id: "take-0" }));
        expect(get().mood.piece?.mics.map((mic) => mic.id)).toEqual(["mic-0", "mic-1"]);

        get().actions.setMoodTake("mic-1", makeMoodTake({ id: "take-1" }));
        expect(get().mood.piece?.mics.map((mic) => mic.id)).toEqual([
          "mic-0",
          "mic-1",
          "mic-2",
        ]);
        expect(get().mood.performance.selections["mic-2"]).toBe("off");
        expect(get().mood.performance.armed["mic-2"]).toBeNull();

        get().actions.setMoodTake("mic-2", makeMoodTake({ id: "take-2" }));
        get().actions.setMoodTake("mic-3", makeMoodTake({ id: "take-3" }));
        get().actions.setMoodTake("mic-4", makeMoodTake({ id: "take-4" }));

        expect(get().mood.piece?.mics.map((mic) => mic.id)).toEqual([
          "mic-0",
          "mic-1",
          "mic-2",
          "mic-3",
          "mic-4",
        ]);

        get().actions.createMoodPiece("corners", "pocket");
        for (let i = 0; i < 4; i++) {
          get().actions.setMoodTake(`mic-${i}`, makeMoodTake({ id: `corner-${i}` }));
        }

        expect(get().mood.piece?.mics.map((mic) => mic.id)).toEqual([
          "mic-0",
          "mic-1",
          "mic-2",
          "mic-3",
        ]);
      });

      it("rejects takes over the per-mic stack limit with an HA log event", () => {
        const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
        get().actions.createMoodPiece("corners", "pocket");

        for (let i = 0; i < MAX_TAKES_PER_MIC; i++) {
          get().actions.setMoodTake("mic-0", makeMoodTake({ id: `take-${i}` }));
        }
        const revision = get().session.moodRevision;

        get().actions.setMoodTake("mic-0", makeMoodTake({ id: "take-over-limit" }));

        expect(get().mood.piece?.mics[0].takes).toHaveLength(MAX_TAKES_PER_MIC);
        expect(get().session.moodRevision).toBe(revision);
        expect(warn).toHaveBeenCalledWith(
          LOG_EVENTS.MOOD_TAKE_LIMIT_REJECTED,
          expect.objectContaining({ micId: "mic-0", takeId: "take-over-limit" }),
        );
        warn.mockRestore();
      });

      it("attaches posters only to the matching current take", () => {
        const revoke = vi.spyOn(URL, "revokeObjectURL");
        get().actions.createMoodPiece("corners", "pocket");
        get().actions.setMoodTake("mic-0", makeMoodTake({ id: "take-with-poster" }));
        const firstPoster = new Blob([new Uint8Array([2])], { type: "image/jpeg" });
        const secondPoster = new Blob([new Uint8Array([3])], { type: "image/jpeg" });
        const revision = get().session.moodRevision;

        get().actions.attachMoodTakePoster(
          "mic-0",
          "stale-take",
          firstPoster,
          "blob:test/poster-stale",
        );

        expect(get().mood.piece?.mics[0].takes[0].posterBlob).toBeNull();
        expect(get().mood.piece?.mics[0].takes[0].posterUrl).toBeNull();
        expect(get().session.moodRevision).toBe(revision);

        const pieceBeforeAttach = get().mood.piece;
        get().actions.attachMoodTakePoster(
          "mic-0",
          "take-with-poster",
          firstPoster,
          "blob:test/poster-1",
        );
        get().actions.attachMoodTakePoster(
          "mic-0",
          "take-with-poster",
          secondPoster,
          "blob:test/poster-2",
        );

        expect(get().mood.piece?.mics[0].takes[0].posterBlob).toBe(secondPoster);
        expect(get().mood.piece?.mics[0].takes[0].posterUrl).toBe("blob:test/poster-2");
        expect(get().mood.piece).not.toBe(pieceBeforeAttach);
        expect(get().session.moodRevision).toBe(revision);
        expect(revoke).toHaveBeenCalledWith("blob:test/poster-1");
        revoke.mockRestore();
      });

      it("deletes takes, clears live references, and only resets the cycle after the last take", () => {
        const revoke = vi.spyOn(URL, "revokeObjectURL");
        get().actions.createMoodPiece("row", "pocket");
        get().actions.setMoodTake(
          "mic-0",
          makeMoodTake({
            id: "one",
            durationSeconds: 3,
            posterBlob: new Blob([new Uint8Array([4])], { type: "image/jpeg" }),
            posterUrl: "blob:test/one-poster",
          }),
        );
        get().actions.setMoodTake("mic-1", makeMoodTake({ id: "other" }));
        get().actions.armMoodSelection("mic-0", "one");
        get().actions.commitMoodSelections([{ micId: "mic-0", entry: "one" }]);
        get().actions.armMoodSelection("mic-1", "one");

        get().actions.deleteMoodTake("mic-0", "one");

        expect(revoke).toHaveBeenCalledWith("blob:test/one");
        expect(revoke).toHaveBeenCalledWith("blob:test/one-poster");
        expect(get().mood.performance.selections["mic-0"]).toBe("off");
        expect(get().mood.performance.armed["mic-1"]).toBe("off");
        expect(get().mood.piece).toMatchObject({
          cycleSeconds: 3,
          oneMicId: null,
          oneTakeId: null,
        });
        expect(get().mood.piece?.mics.find((mic) => mic.id === "mic-1")?.takes).toHaveLength(1);

        get().actions.deleteMoodTake("mic-1", "other");

        expect(get().mood.piece).toMatchObject({
          cycleSeconds: null,
          oneMicId: null,
          oneTakeId: null,
        });
        expect(get().mood.piece?.mics.every((mic) => mic.takes.length === 0)).toBe(true);
        revoke.mockRestore();
      });

      it("revokes all take object URLs when scratching or replacing a piece", () => {
        const revoke = vi.spyOn(URL, "revokeObjectURL");
        get().actions.createMoodPiece("row", "pocket");
        get().actions.setMoodTake(
          "mic-0",
          makeMoodTake({ id: "scratch-a", posterUrl: "blob:test/scratch-a-poster" }),
        );
        get().actions.setMoodTake(
          "mic-1",
          makeMoodTake({ id: "scratch-b", posterUrl: "blob:test/scratch-b-poster" }),
        );

        get().actions.scratchMoodPiece();

        expect(get().mood.piece).toBeNull();
        expect(revoke).toHaveBeenCalledTimes(4);
        expect(revoke).toHaveBeenCalledWith("blob:test/scratch-a");
        expect(revoke).toHaveBeenCalledWith("blob:test/scratch-a-poster");
        expect(revoke).toHaveBeenCalledWith("blob:test/scratch-b");
        expect(revoke).toHaveBeenCalledWith("blob:test/scratch-b-poster");

        revoke.mockClear();
        get().actions.createMoodPiece("corners", "pocket");
        get().actions.setMoodTake(
          "mic-0",
          makeMoodTake({ id: "replace-a", posterUrl: "blob:test/replace-a-poster" }),
        );
        get().actions.setMoodTake(
          "mic-1",
          makeMoodTake({ id: "replace-b", posterUrl: "blob:test/replace-b-poster" }),
        );

        get().actions.createMoodPiece("stack", "pocket");

        expect(get().mood.piece?.stage).toBe("stack");
        expect(revoke).toHaveBeenCalledTimes(4);
        expect(revoke).toHaveBeenCalledWith("blob:test/replace-a");
        expect(revoke).toHaveBeenCalledWith("blob:test/replace-a-poster");
        expect(revoke).toHaveBeenCalledWith("blob:test/replace-b");
        expect(revoke).toHaveBeenCalledWith("blob:test/replace-b-poster");

        revoke.mockClear();
        get().actions.setMoodTake(
          "mic-0",
          makeMoodTake({ id: "frozen", posterUrl: "blob:test/frozen-poster" }),
        );
        const pieceBeforeExport = get().mood.piece;
        get().actions.setIsExporting(true);

        get().actions.scratchMoodPiece();
        get().actions.createMoodPiece("row", "pocket");

        expect(get().mood.piece).toBe(pieceBeforeExport);
        expect(revoke).not.toHaveBeenCalled();
        get().actions.setIsExporting(false);
        revoke.mockRestore();
      });

      it("revision-guards async take appliers without churning moodRevision and lets manual parts beat AI parts", () => {
        get().actions.createMoodPiece("corners", "pocket");
        get().actions.setMoodTake("mic-0", makeMoodTake({ id: "take-ai" }));
        const staleRevision = get().session.moodRevision - 1;

        expect(get().actions.applyMoodSyncOffsetIfCurrent("mic-0", "take-ai", 120, staleRevision)).toBe(
          false,
        );
        expect(get().actions.applyMoodPartIfCurrent("mic-0", "take-ai", "bass", "ai", staleRevision)).toBe(
          false,
        );
        expect(get().mood.piece?.mics[0].takes[0]).toMatchObject({
          syncOffsetMs: 0,
          part: null,
          partSource: null,
        });

        const beforeStructuralEditRevision = get().session.moodRevision;
        get().actions.setMoodTake("mic-1", makeMoodTake({ id: "structural-edit" }));
        expect(
          get().actions.applyMoodSyncOffsetIfCurrent(
            "mic-0",
            "take-ai",
            80,
            beforeStructuralEditRevision,
          ),
        ).toBe(false);
        expect(get().mood.piece?.mics[0].takes[0].syncOffsetMs).toBe(0);

        const revision = get().session.moodRevision;
        expect(get().actions.applyMoodSyncOffsetIfCurrent("mic-0", "take-ai", 120, revision)).toBe(
          true,
        );
        expect(get().mood.piece?.mics[0].takes[0].syncOffsetMs).toBe(120);
        expect(
          get().actions.applyMoodPartIfCurrent(
            "mic-0",
            "take-ai",
            "beatbox" satisfies MoodPart,
            "ai",
            revision,
          ),
        ).toBe(true);
        expect(get().session.moodRevision).toBe(revision);
        expect(get().mood.piece?.mics[0].takes[0]).toMatchObject({
          syncOffsetMs: 120,
          part: "beatbox",
          partSource: "ai",
        });

        expect(
          get().actions.applyMoodPartIfCurrent(
            "mic-0",
            "take-ai",
            "lead" satisfies MoodPart,
            "user",
            revision,
          ),
        ).toBe(true);

        expect(get().actions.applyMoodPartIfCurrent("mic-0", "take-ai", "bass", "ai", revision)).toBe(
          false,
        );
        expect(get().session.moodRevision).toBe(revision);
        expect(get().mood.piece?.mics[0].takes[0]).toMatchObject({
          part: "lead",
          partSource: "user",
        });
      });

      it("freezes take mutations during export", () => {
        get().actions.createMoodPiece("corners", "pocket");
        get().actions.setMoodTake("mic-0", makeMoodTake({ id: "existing" }));
        const pieceBeforeExport = get().mood.piece;
        const revisionBeforeExport = get().session.moodRevision;
        get().actions.setIsExporting(true);

        get().actions.setMoodTake("mic-0", makeMoodTake({ id: "blocked" }));
        get().actions.attachMoodTakePoster(
          "mic-0",
          "existing",
          new Blob([new Uint8Array([5])], { type: "image/jpeg" }),
          "blob:test/blocked-poster",
        );
        get().actions.deleteMoodTake("mic-0", "existing");
        expect(
          get().actions.applyMoodSyncOffsetIfCurrent(
            "mic-0",
            "existing",
            80,
            revisionBeforeExport,
          ),
        ).toBe(false);
        expect(
          get().actions.applyMoodPartIfCurrent(
            "mic-0",
            "existing",
            "adlib",
            "ai",
            revisionBeforeExport,
          ),
        ).toBe(false);

        expect(get().mood.piece).toBe(pieceBeforeExport);
        expect(get().session.moodRevision).toBe(revisionBeforeExport);
        get().actions.setIsExporting(false);
      });
    });
  });

  describe("restoreTrackAudio", () => {
    const healedBuffer = { duration: 0.7, sampleRate: 48000 } as AudioBuffer;

    it("heals an unavailable clip in place and releases a repair-owned mute", () => {
      get().actions.setTrackClip(0, makeClip({ audioBuffer: null, audioStatus: "unavailable" }));
      useAppStore.setState((state) => ({
        project: {
          ...state.project,
          tracks: state.project.tracks.map((t) =>
            t.id === 0 ? { ...t, muted: true, mutedByRepair: true } : t,
          ),
        },
      }));
      const sidecar = new Blob([new Uint8Array([7])], { type: "audio/wav" });
      const beforeRevision = get().session.projectRevision;
      const beforeBlobRevision = get().project.tracks[0].blobRevision ?? 0;

      get().actions.restoreTrackAudio(0, healedBuffer, sidecar);

      const track = get().project.tracks[0];
      expect(track.clip?.audioStatus).toBe("ok");
      expect(track.clip?.audioBuffer).toBe(healedBuffer);
      expect(track.clip?.audioBlob).toBe(sidecar);
      expect(track.muted).toBe(false);
      expect(track.mutedByRepair).toBe(false);
      // The audio sidecar reference changed, so the content-address cache
      // must be invalidated through a blobRevision bump.
      expect(track.blobRevision).toBe(beforeBlobRevision + 1);
      expect(get().session.projectRevision).toBeGreaterThan(beforeRevision);
    });

    it("keeps a user-owned mute when healing", () => {
      get().actions.setTrackClip(0, makeClip({ audioBuffer: null, audioStatus: "unavailable" }));
      get().actions.setTrackMuted(0, true);

      get().actions.restoreTrackAudio(0, healedBuffer);

      const track = get().project.tracks[0];
      expect(track.clip?.audioStatus).toBe("ok");
      expect(track.muted).toBe(true);
      expect(track.mutedByRepair).toBe(false);
    });

    it("no-ops for healthy clips, empty tracks, and during export", () => {
      const healthy = makeClip();
      get().actions.setTrackClip(0, healthy);
      get().actions.restoreTrackAudio(0, healedBuffer);
      expect(get().project.tracks[0].clip).toBe(healthy);

      get().actions.restoreTrackAudio(3, healedBuffer);
      expect(get().project.tracks[3].clip).toBeNull();

      get().actions.setTrackClip(1, makeClip({ audioBuffer: null, audioStatus: "unavailable" }));
      get().actions.setIsExporting(true);
      get().actions.restoreTrackAudio(1, healedBuffer);
      expect(get().project.tracks[1].clip?.audioStatus).toBe("unavailable");
      get().actions.setIsExporting(false);
    });
  });
});
