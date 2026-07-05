// ABOUTME: rehydrate tests — saved snapshot is restored into the store, blob decode happens.
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import * as idbKeyval from "idb-keyval";
import { del, get, keys, set } from "idb-keyval";

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
vi.mock("idb-keyval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb-keyval")>();
  return {
    ...actual,
    set: vi.fn(actual.set),
  };
});

import { rehydrateFromStorage } from "./rehydrate";
import {
  LEGACY_PROJECT_KEY,
  PERSISTED_SCHEMA_VERSION,
  PROJECT_BACKUP_KEY,
  PROJECT_KEY,
  clearProject,
  loadProject,
  loadRecoveryBackup,
  saveProject,
} from "./persistence";
import * as persistence from "./persistence";
import {
  corruptV1MonolithProject,
  v0MonolithProject,
  validV1MonolithProject,
} from "./__fixtures__/persistedProjects";
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
    audioStatus: "ok",
    audioBlob: await persistedBlob([4, 5, 6], "audio/wav"),
    trimStartMs: 50,
    trimEndMs: 950,
    durationMs: 1000,
    posterBlob: await persistedBlob([9], "image/jpeg"),
    posterUrl: "blob:test/poster",
  };
}

function isBlobLike(value: unknown): boolean {
  return (
    value instanceof Blob ||
    (typeof value === "object" &&
      value !== null &&
      typeof (value as Blob).arrayBuffer === "function" &&
      typeof (value as Blob).type === "string")
  );
}

function blobPaths(value: unknown, path = "$"): string[] {
  if (isBlobLike(value)) return [path];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => blobPaths(item, `${path}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => blobPaths(item, `${path}.${key}`));
  }
  return [];
}

async function storedBlobKeys(): Promise<string[]> {
  return (await keys())
    .filter((key): key is string => typeof key === "string" && key.startsWith("ha:blob:"))
    .sort();
}

// Mirrors the production content-addressing scheme so tests can predict the
// blob record key a given byte payload will live under.
async function contentAddressedBlobKey(bytes: number[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
  return `ha:blob:${hex}`;
}

async function storedMeta(): Promise<Record<string, any>> {
  const meta = await get(PROJECT_KEY);
  expect(meta).toMatchObject({ schemaVersion: PERSISTED_SCHEMA_VERSION });
  return meta as Record<string, any>;
}

// Legacy monolith where track 1's clip has an invalid trim window —
// normalization drops that clip during repair, so the pre-repair backup
// becomes the only remaining reference to its bytes.
async function legacyMonolithWithDroppedClip(
  droppedBytes: number[],
): Promise<Record<string, unknown>> {
  const emptyTrack = (id: number) => ({
    id,
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
  });
  return {
    schemaVersion: 1,
    bpm: 104,
    swing: 0,
    cutSubdivision: "8n",
    sameTierHoldMs: 400,
    subgenre: "trap",
    vibe: "tight",
    stepCount: 16,
    tagReasoning: {},
    tracks: [
      {
        ...emptyTrack(0),
        clipBlob: await persistedBlob([1, 2, 3], "video/webm"),
        trimStartMs: 0,
        trimEndMs: 500,
        durationMs: 500,
        tag: "kick",
      },
      {
        // Invalid trim window — normalization drops this clip during repair.
        ...emptyTrack(1),
        clipBlob: await persistedBlob(droppedBytes, "video/webm"),
        trimStartMs: 600,
        trimEndMs: 400,
        durationMs: 1000,
        tag: "snare",
      },
      ...Array.from({ length: 6 }, (_, id) => emptyTrack(id + 2)),
    ],
    updatedAt: 1_000,
  };
}

describe("rehydrateFromStorage", () => {
  beforeEach(async () => {
    useAppStore.getState().actions.reset();
    await clearProject();
    const actual = await vi.importActual<typeof import("idb-keyval")>("idb-keyval");
    vi.mocked(idbKeyval.set).mockImplementation(actual.set);
    vi.mocked(idbKeyval.set).mockClear();
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

  it("migrates corrupt v1 legacy saves through validation and records degraded recovery warnings", async () => {
    await set(LEGACY_PROJECT_KEY, corruptV1MonolithProject());

    const result = await rehydrateFromStorage();

    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.warnings).toContain(
      `Schema version 1 was migrated to ${PERSISTED_SCHEMA_VERSION}.`,
    );
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
    expect((await loadProject())?.stepCount).toBe(16);
  });

  it("migrates a realistic legacy save with no schema version instead of discarding it", async () => {
    await set(LEGACY_PROJECT_KEY, v0MonolithProject());

    const result = await rehydrateFromStorage();

    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.warnings).toContain(
      `Schema version 0 was migrated to ${PERSISTED_SCHEMA_VERSION}.`,
    );
    expect(useAppStore.getState().project.bpm).toBe(111);
    expect(useAppStore.getState().project.tracks[0].steps[3]).toBe(true);
    expect(await loadRecoveryBackup()).not.toBeNull();
    expect((await loadProject())?.storageFormat).toBe("schema2");
    expect((await storedMeta()).stepCount).toBe(16);
  });

  it("migrates a v1 monolith to schema 2 after writing a metadata-reference backup", async () => {
    await set(LEGACY_PROJECT_KEY, await validV1MonolithProject());

    const result = await rehydrateFromStorage();

    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.warnings).toContain(
      `Schema version 1 was migrated to ${PERSISTED_SCHEMA_VERSION}.`,
    );
    const state = useAppStore.getState();
    expect(state.project.bpm).toBe(104);
    expect(state.project.tracks[0].tag).toBe("kick");
    expect(state.project.tracks[3].tag).toBe("hat");
    expect(state.project.tracks[0].clip?.audioBuffer).toBe(fakeAudioBuffer);

    const meta = await storedMeta();
    expect(blobPaths(meta)).toEqual([]);
    expect(meta.tracks[0].clipBlobRef).toMatch(/^ha:blob:[a-f0-9]{16}$/);
    expect(meta.tracks[3].posterBlobRef).toMatch(/^ha:blob:[a-f0-9]{16}$/);
    expect(await storedBlobKeys()).toHaveLength(6);
    expect(await get(LEGACY_PROJECT_KEY)).toBeUndefined();

    const backup = await get(PROJECT_BACKUP_KEY);
    expect(backup).toMatchObject({ schemaVersion: PERSISTED_SCHEMA_VERSION });
    expect(blobPaths(backup)).toEqual([]);
    expect((backup as any).tracks[0].clipBlobRef).toMatch(/^ha:blob:[a-f0-9]{16}$/);
    expect((backup as any).tracks[0]).not.toHaveProperty("clipBlob");
  });

  it("treats invalid ha:meta as degraded without touching the backup or migrating", async () => {
    useAppStore.getState().actions.setTrackClip(0, await makeClip());
    await saveProject(useAppStore.getState());
    await persistence.saveRecoveryBackup((await loadProject())!);
    const backupBefore = await get(PROJECT_BACKUP_KEY);
    expect(backupBefore).toBeTruthy();
    const blobsBefore = await storedBlobKeys();
    const invalidMeta = { schemaVersion: 2, tracks: "corrupted" };
    await set(PROJECT_KEY, invalidMeta);
    useAppStore.getState().actions.reset();
    vi.mocked(idbKeyval.set).mockClear();

    const result = await rehydrateFromStorage();

    expect(result.ok).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("Autosave was paused"))).toBe(
      true,
    );
    expect(useAppStore.getState().ui.recoveryWarnings).toEqual(result.warnings);
    expect(useAppStore.getState().project.tracks[0].clip).toBeNull();
    // The last good backup is preserved, the invalid metadata is left in
    // place for recovery, and no legacy-migration write happens.
    expect(await get(PROJECT_BACKUP_KEY)).toEqual(backupBefore);
    expect(await get(PROJECT_KEY)).toEqual(invalidMeta);
    expect(vi.mocked(idbKeyval.set)).not.toHaveBeenCalled();
    expect(await storedBlobKeys()).toEqual(blobsBefore);
  });

  it("migration GC keeps blob records that only the pre-repair backup references", async () => {
    const droppedBytes = [7, 8, 9];
    await set(LEGACY_PROJECT_KEY, await legacyMonolithWithDroppedClip(droppedBytes));
    // A prior interrupted migration already wrote the dropped clip's blob record.
    const droppedRef = await contentAddressedBlobKey(droppedBytes);
    await set(droppedRef, await persistedBlob(droppedBytes, "video/webm"));

    const result = await rehydrateFromStorage();

    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(true);
    const backup = (await get(PROJECT_BACKUP_KEY)) as Record<string, any>;
    expect(backup.tracks[1].clipBlobRef).toBe(droppedRef);
    const meta = await storedMeta();
    expect(meta.tracks[1].clipBlobRef).toBeUndefined();
    // The backup is the only root left for the dropped clip — its bytes must
    // survive the migration GC and stay loadable for recovery.
    expect(isBlobLike(await get(droppedRef))).toBe(true);
  });

  it("migration writes blob records for backup-referenced media dropped by repair", async () => {
    const droppedBytes = [7, 8, 9];
    await set(LEGACY_PROJECT_KEY, await legacyMonolithWithDroppedClip(droppedBytes));

    const result = await rehydrateFromStorage();

    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(true);
    expect(await get(LEGACY_PROJECT_KEY)).toBeUndefined();
    const droppedRef = await contentAddressedBlobKey(droppedBytes);
    const backup = (await get(PROJECT_BACKUP_KEY)) as Record<string, any>;
    expect(backup.tracks[1].clipBlobRef).toBe(droppedRef);
    const meta = await storedMeta();
    expect(meta.tracks[1].clipBlobRef).toBeUndefined();
    // No pre-seeded record: the migration-time backup itself must have written
    // the dropped clip's blob record, or its bytes died with the monolith.
    const record = await get(droppedRef);
    expect(isBlobLike(record)).toBe(true);
    expect(new Uint8Array(await (record as Blob).arrayBuffer())).toEqual(
      new Uint8Array(droppedBytes),
    );
  });

  it("keeps legacy keys and pauses hydration when a backup blob write fails", async () => {
    await set(LEGACY_PROJECT_KEY, await legacyMonolithWithDroppedClip([7, 8, 9]));
    const actual = await vi.importActual<typeof import("idb-keyval")>("idb-keyval");
    vi.mocked(idbKeyval.set).mockImplementation(async (key, value) => {
      if (typeof key === "string" && key.startsWith("ha:blob:")) {
        throw new Error("quota exceeded");
      }
      return actual.set(key, value);
    });

    const result = await rehydrateFromStorage();

    expect(result.ok).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("autosave was paused"))).toBe(true);
    expect(useAppStore.getState().project.bpm).toBe(90);
    expect(useAppStore.getState().ui.recoveryWarnings).toEqual(result.warnings);
    // Quota failure while persisting backup media must leave the legacy
    // monolith untouched — no metadata, no backup, no partial deletion.
    expect(await get(LEGACY_PROJECT_KEY)).toMatchObject({ schemaVersion: 1 });
    expect(await get(PROJECT_KEY)).toBeUndefined();
    expect(await get(PROJECT_BACKUP_KEY)).toBeUndefined();
  });

  it("keeps legacy keys and pauses hydration when the schema-2 metadata write fails", async () => {
    await set(LEGACY_PROJECT_KEY, await validV1MonolithProject());
    const actual = await vi.importActual<typeof import("idb-keyval")>("idb-keyval");
    vi.mocked(idbKeyval.set).mockImplementation(async (key, value) => {
      if (key === PROJECT_KEY) throw new Error("meta write failed");
      return actual.set(key, value);
    });

    const result = await rehydrateFromStorage();

    expect(result.ok).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("could not be migrated"))).toBe(
      true,
    );
    expect(useAppStore.getState().project.bpm).toBe(90);
    expect(useAppStore.getState().ui.recoveryWarnings).toEqual(result.warnings);
    expect(await get(LEGACY_PROJECT_KEY)).toMatchObject({ schemaVersion: 1 });
    expect(await get(PROJECT_KEY)).toBeUndefined();
  });

  it("does not rewrite a clean schema-2 record during rehydrate", async () => {
    useAppStore.getState().actions.setTrackClip(0, await makeClip());
    await saveProject(useAppStore.getState());
    useAppStore.getState().actions.reset();
    vi.mocked(idbKeyval.set).mockClear();

    const result = await rehydrateFromStorage();

    expect(result).toEqual({ ok: true, degraded: false, warnings: [] });
    expect(vi.mocked(idbKeyval.set)).not.toHaveBeenCalled();
  });

  it("does not hydrate or risk autosave overwrite when degraded recovery backup fails", async () => {
    const saveRecoveryBackupSpy = vi
      .spyOn(persistence, "saveRecoveryBackup")
      .mockRejectedValueOnce(new Error("quota exceeded"));
    await set(LEGACY_PROJECT_KEY, {
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

  it("repairs clips that fail audio decode without dropping their video or tag", async () => {
    audioMocks.decodeAudioData.mockRejectedValueOnce(new Error("decode failed"));
    await set(LEGACY_PROJECT_KEY, {
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
    expect(result.warnings).toContain(
      "Track 1 audio unavailable — re-record to restore sound.",
    );
    const repairedTrack = useAppStore.getState().project.tracks[0];
    expect(repairedTrack.clip).toMatchObject({
      audioBuffer: null,
      audioStatus: "unavailable",
      trimStartMs: 0,
      trimEndMs: 500,
      durationMs: 500,
      posterBlob: null,
      posterUrl: null,
    });
    expect(isBlobLike(repairedTrack.clip?.blob)).toBe(true);
    expect(repairedTrack.clip?.url).toMatch(/^blob:/);
    expect(repairedTrack.muted).toBe(true);
    expect(repairedTrack.tag).toBe("kick");
    expect(useAppStore.getState().project.tagReasoning).toEqual({
      0: "good before corruption",
    });
    expect(await loadRecoveryBackup()).not.toBeNull();

    useAppStore.getState().actions.toggleStep(0, 3);
    await saveProject(useAppStore.getState());
    useAppStore.getState().actions.reset();
    audioMocks.decodeAudioData.mockReset();
    audioMocks.decodeAudioData.mockResolvedValue(fakeAudioBuffer);

    const roundTripResult = await rehydrateFromStorage();

    expect(roundTripResult.ok).toBe(true);
    expect(roundTripResult.degraded).toBe(true);
    const roundTrippedTrack = useAppStore.getState().project.tracks[0];
    expect(roundTrippedTrack.clip?.audioBuffer).toBeNull();
    expect(roundTrippedTrack.clip?.audioStatus).toBe("unavailable");
    expect(roundTrippedTrack.clip?.url).toMatch(/^blob:/);
    expect(roundTrippedTrack.tag).toBe("kick");
    expect(roundTrippedTrack.steps[3]).toBe(true);
    expect(audioMocks.decodeAudioData).not.toHaveBeenCalled();
  });

  it("routes a missing audio sidecar reference through the audio repair state", async () => {
    useAppStore.getState().actions.setTrackClip(0, await makeClip());
    useAppStore.getState().actions.setTrackTag(0, "kick");
    await saveProject(useAppStore.getState());
    const meta = await storedMeta();
    const missingRef = meta.tracks[0].audioBlobRef;
    await del(missingRef);
    useAppStore.getState().actions.reset();

    const result = await rehydrateFromStorage();

    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.warnings).toContain(
      "Track 1 audio unavailable — re-record to restore sound.",
    );
    const repairedTrack = useAppStore.getState().project.tracks[0];
    expect(repairedTrack.clip?.audioBuffer).toBeNull();
    expect(repairedTrack.clip?.audioStatus).toBe("unavailable");
    expect(isBlobLike(repairedTrack.clip?.blob)).toBe(true);
    expect(repairedTrack.clip?.url).toMatch(/^blob:/);
    expect(repairedTrack.clip?.posterUrl).toMatch(/^blob:/);
    expect(repairedTrack.muted).toBe(true);
    expect(repairedTrack.tag).toBe("kick");
    expect(await loadRecoveryBackup()).not.toBeNull();
  });
});
