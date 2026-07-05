// ABOUTME: persistence tests — schema-2 IndexedDB layout plus resolved load contracts.
// ABOUTME: Uses fake-indexeddb to pin metadata/blob split, backup, GC, and legacy detection.
import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import * as idbKeyval from "idb-keyval";
import { del, get, keys, set } from "idb-keyval";
import {
  PERSISTED_SCHEMA_VERSION,
  clearProject,
  loadProject,
  loadRecoveryBackup,
  saveProject,
  saveRecoveryBackup,
  snapshot,
} from "./persistence";
import { useAppStore } from "../store/useAppStore";

vi.mock("idb-keyval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb-keyval")>();
  return {
    ...actual,
    set: vi.fn(actual.set),
  };
});

const META_KEY = "ha:meta";
const BACKUP_KEY = "ha:meta-backup";
const LEGACY_PROJECT_KEY = "hyperactive-amateur-project";
const LEGACY_BACKUP_KEY = "hyperactive-amateur-project:recovery-backup";
const BLOB_PREFIX = "ha:blob:";

function makeBlob(bytes: number[], type: string): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

function clip(seed: number, options: { sharedClipBlob?: Blob; withMedia?: boolean } = {}) {
  const clipBlob = options.sharedClipBlob ?? makeBlob([seed, seed + 1, seed + 2], "video/webm");
  const withMedia = options.withMedia ?? true;
  return {
    blob: clipBlob,
    url: `blob:test/clip-${seed}`,
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok" as const,
    audioBlob: withMedia ? makeBlob([seed + 10, seed + 11], "audio/wav") : null,
    trimStartMs: 25,
    trimEndMs: 925,
    durationMs: 1000,
    posterBlob: withMedia ? makeBlob([0xff, 0xd8, seed], "image/jpeg") : null,
    posterUrl: withMedia ? `blob:test/poster-${seed}` : null,
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
    .filter((key): key is string => typeof key === "string" && key.startsWith(BLOB_PREFIX))
    .sort();
}

async function storedMeta(): Promise<Record<string, any>> {
  const value = await get(META_KEY);
  expect(value).toBeTruthy();
  expect(typeof value).toBe("object");
  return value as Record<string, any>;
}

function mediaRefs(track: Record<string, unknown>): string[] {
  return ["clipBlobRef", "audioBlobRef", "posterBlobRef"].flatMap((field) => {
    const value = track[field];
    return typeof value === "string" ? [value] : [];
  });
}

describe("persistence", () => {
  beforeEach(async () => {
    useAppStore.getState().actions.reset();
    await clearProject();
    vi.clearAllMocks();
  });

  it("round-trips schema-2 metadata references and resolves the logical project shape", async () => {
    useAppStore.getState().actions.setBpm(110);
    useAppStore.getState().actions.toggleStep(2, 7);
    useAppStore.getState().actions.setCutSubdivision("4n");
    useAppStore.getState().actions.setSameTierHoldMs(750);
    useAppStore.getState().actions.setTrackShowVideo(0, false, "user");
    useAppStore.getState().actions.setTrackClip(0, clip(1));
    useAppStore.getState().actions.setTrackClip(2, clip(20));
    useAppStore.getState().actions.setTrackTag(0, "snare");
    await saveProject(useAppStore.getState());

    const meta = await storedMeta();
    expect(meta.schemaVersion).toBe(2);
    expect(PERSISTED_SCHEMA_VERSION).toBe(2);
    expect(blobPaths(meta)).toEqual([]);
    expect(meta.tracks[0]).not.toHaveProperty("clipBlob");
    expect(meta.tracks[0]).not.toHaveProperty("audioBlob");
    expect(meta.tracks[0]).not.toHaveProperty("posterBlob");
    expect(meta.tracks[0].clipBlobRef).toMatch(/^ha:blob:[a-f0-9]{16}$/);
    expect(meta.tracks[0].audioBlobRef).toMatch(/^ha:blob:[a-f0-9]{16}$/);
    expect(meta.tracks[0].posterBlobRef).toMatch(/^ha:blob:[a-f0-9]{16}$/);
    expect(meta.tracks[1].clipBlobRef).toBeUndefined();
    expect(await storedBlobKeys()).toHaveLength(6);

    const loaded = await loadProject();
    expect(loaded).toMatchObject({
      schemaVersion: 2,
      bpm: 110,
      cutSubdivision: "4n",
      sameTierHoldMs: 750,
      storageFormat: "schema2",
    });
    expect(loaded?.tracks[0]).toMatchObject({
      id: 0,
      trimStartMs: 25,
      trimEndMs: 925,
      durationMs: 1000,
      tag: "snare",
      showVideo: false,
    });
    expect(isBlobLike(loaded?.tracks[0].clipBlob)).toBe(true);
    expect(isBlobLike(loaded?.tracks[0].audioBlob)).toBe(true);
    expect(isBlobLike(loaded?.tracks[0].posterBlob)).toBe(true);
    expect(loaded?.tracks[0]).not.toHaveProperty("clipBlobRef");
    expect(loaded?.tracks[2].steps[7]).toBe(true);
    expect(loaded?.tracks[1].clipBlob).toBeNull();
  });

  it("deduplicates identical blob bytes under one content-addressed key", async () => {
    const shared = makeBlob([7, 7, 7], "video/webm");
    useAppStore.getState().actions.setTrackClip(0, clip(1, { sharedClipBlob: shared, withMedia: false }));
    useAppStore.getState().actions.setTrackClip(1, clip(2, { sharedClipBlob: makeBlob([7, 7, 7], "video/webm"), withMedia: false }));

    await saveProject(useAppStore.getState());

    const meta = await storedMeta();
    expect(meta.tracks[0].clipBlobRef).toBe(meta.tracks[1].clipBlobRef);
    expect(await storedBlobKeys()).toHaveLength(1);
  });

  it("writes only metadata when a save changes bpm without new blobs", async () => {
    useAppStore.getState().actions.setTrackClip(0, clip(3));
    await saveProject(useAppStore.getState());
    const originalBlobKeys = await storedBlobKeys();
    const setSpy = vi.mocked(idbKeyval.set);
    setSpy.mockClear();

    useAppStore.getState().actions.setBpm(123);
    await saveProject(useAppStore.getState());

    expect((await loadProject())?.bpm).toBe(123);
    expect(await storedBlobKeys()).toEqual(originalBlobKeys);
    expect(setSpy.mock.calls.some(([key]) => key === META_KEY)).toBe(true);
    expect(
      setSpy.mock.calls.filter(([key]) => typeof key === "string" && key.startsWith(BLOB_PREFIX)),
    ).toHaveLength(0);
  });

  it("writes only metadata and the poster blob when an async poster attaches", async () => {
    const initialClip = clip(9, { withMedia: false });
    useAppStore.getState().actions.setTrackClip(0, initialClip);
    await saveProject(useAppStore.getState());
    const before = await storedMeta();
    const clipRef = before.tracks[0].clipBlobRef;
    const setSpy = vi.mocked(idbKeyval.set);
    setSpy.mockClear();

    const posterBlob = makeBlob([0xff, 0xd8, 0x09], "image/jpeg");
    useAppStore.getState().actions.setTrackPoster(0, posterBlob, initialClip);
    await saveProject(useAppStore.getState());

    const after = await storedMeta();
    expect(after.tracks[0].clipBlobRef).toBe(clipRef);
    expect(after.tracks[0].posterBlobRef).toMatch(/^ha:blob:[a-f0-9]{16}$/);
    expect(after.tracks[0].posterBlobRef).not.toBe(clipRef);
    expect(setSpy.mock.calls.some(([key]) => key === META_KEY)).toBe(true);
    expect(
      setSpy.mock.calls.filter(([key]) => typeof key === "string" && key.startsWith(BLOB_PREFIX)),
    ).toHaveLength(1);
  });

  it("garbage-collects orphaned blob records after a successful metadata save", async () => {
    useAppStore.getState().actions.setTrackClip(0, clip(4));
    useAppStore.getState().actions.setTrackClip(1, clip(40));
    await saveProject(useAppStore.getState());
    const before = await storedMeta();
    const removedRefs = mediaRefs(before.tracks[0]);
    const retainedRefs = mediaRefs(before.tracks[1]);

    useAppStore.getState().actions.clearTrackClip(0);
    await saveProject(useAppStore.getState());

    const afterKeys = await storedBlobKeys();
    expect(afterKeys).toEqual(retainedRefs.sort());
    expect(afterKeys.some((key) => removedRefs.includes(key))).toBe(false);
  });

  it("keeps blob records referenced only by the recovery backup across a later save", async () => {
    useAppStore.getState().actions.setTrackClip(0, clip(4));
    await saveProject(useAppStore.getState());
    const loaded = await loadProject();
    expect(loaded).not.toBeNull();
    await saveRecoveryBackup(loaded!);
    const backup = (await get(BACKUP_KEY)) as Record<string, any>;
    const backupRefs = mediaRefs(backup.tracks[0]);
    expect(backupRefs).toHaveLength(3);
    // A stray blob referenced by neither the live metadata nor the backup
    // must still be collected.
    const orphanKey = `${BLOB_PREFIX}0000000000000000`;
    await set(orphanKey, makeBlob([0xde, 0xad], "video/webm"));

    useAppStore.getState().actions.clearTrackClip(0);
    await saveProject(useAppStore.getState());

    const meta = await storedMeta();
    expect(mediaRefs(meta.tracks[0])).toEqual([]);
    const remaining = await storedBlobKeys();
    expect(remaining).toEqual([...backupRefs].sort());
    expect(remaining).not.toContain(orphanKey);
    for (const ref of backupRefs) {
      expect(isBlobLike(await get(ref))).toBe(true);
    }
  });

  it("stores recovery backups as metadata references without blob copies", async () => {
    useAppStore.getState().actions.setTrackClip(0, clip(5));
    await saveProject(useAppStore.getState());
    const loaded = await loadProject();
    expect(loaded).not.toBeNull();

    await saveRecoveryBackup(loaded!);

    const backup = await get(BACKUP_KEY);
    expect(backup).toBeTruthy();
    expect(backup).toMatchObject({ schemaVersion: 2 });
    expect(blobPaths(backup)).toEqual([]);
    expect((backup as any).tracks[0].clipBlobRef).toMatch(/^ha:blob:[a-f0-9]{16}$/);
    expect((backup as any).tracks[0]).not.toHaveProperty("clipBlob");
    expect(await loadRecoveryBackup()).toEqual(backup);
  });

  it("marks missing blob references in the loaded contract for rehydrate repair", async () => {
    useAppStore.getState().actions.setTrackClip(0, clip(6));
    useAppStore.getState().actions.setTrackTag(0, "kick");
    await saveProject(useAppStore.getState());
    const meta = await storedMeta();
    const missingRef = meta.tracks[0].clipBlobRef;
    await del(missingRef);

    const loaded = await loadProject();

    expect(loaded?.tracks[0].clipBlob).toBeNull();
    expect(isBlobLike(loaded?.tracks[0].audioBlob)).toBe(true);
    expect(isBlobLike(loaded?.tracks[0].posterBlob)).toBe(true);
    expect(loaded?.tracks[0].tag).toBe("kick");
    expect(loaded?.missingBlobs).toEqual([
      { trackId: 0, field: "clipBlob", ref: missingRef },
    ]);
  });

  it("tags old monolithic saves as legacy without rewriting or deleting them", async () => {
    const legacy = {
      schemaVersion: 1,
      bpm: 99,
      swing: 0,
      cutSubdivision: "8n",
      sameTierHoldMs: 400,
      subgenre: "trap",
      vibe: "tight",
      stepCount: 16,
      tagReasoning: {},
      tracks: [
        {
          id: 0,
          clipBlob: makeBlob([1], "video/webm"),
          audioBlob: makeBlob([2], "audio/wav"),
          posterBlob: makeBlob([3], "image/jpeg"),
          trimStartMs: 0,
          trimEndMs: 500,
          durationMs: 500,
          tag: "hat",
          steps: new Array(16).fill(false),
          volume: 1,
          muted: false,
          showVideo: true,
        },
      ],
      updatedAt: 1000,
    };
    await set(LEGACY_PROJECT_KEY, legacy);

    const loaded = await loadProject();

    expect(loaded).toMatchObject({
      ...legacy,
      storageFormat: "legacy",
      legacyKey: LEGACY_PROJECT_KEY,
    });
    expect(await get(LEGACY_PROJECT_KEY)).toBeTruthy();
    expect(await get(META_KEY)).toBeUndefined();
  });

  it("deletes lingering legacy records once schema-2 metadata loads cleanly", async () => {
    useAppStore.getState().actions.setTrackClip(0, clip(11));
    await saveProject(useAppStore.getState());
    // A kill between the schema-2 metadata write and the legacy delete leaves
    // the monolith behind.
    await set(LEGACY_PROJECT_KEY, { schemaVersion: 1, tracks: [] });
    await set(LEGACY_BACKUP_KEY, { schemaVersion: 1, tracks: [] });

    const loaded = await loadProject();

    expect(loaded?.storageFormat).toBe("schema2");
    expect(loaded?.missingBlobs).toBeUndefined();
    expect(await get(LEGACY_PROJECT_KEY)).toBeUndefined();
    expect(await get(LEGACY_BACKUP_KEY)).toBeUndefined();
    expect(await storedMeta()).toBeTruthy();
  });

  it("keeps lingering legacy records when the schema-2 load is degraded", async () => {
    useAppStore.getState().actions.setTrackClip(0, clip(12));
    await saveProject(useAppStore.getState());
    const meta = await storedMeta();
    await del(meta.tracks[0].clipBlobRef);
    await set(LEGACY_PROJECT_KEY, { schemaVersion: 1, tracks: [] });

    const loaded = await loadProject();

    expect(loaded?.missingBlobs?.length).toBeGreaterThan(0);
    // The monolith's inline bytes may be the only remaining copy — keep it.
    expect(await get(LEGACY_PROJECT_KEY)).toEqual({ schemaVersion: 1, tracks: [] });
  });

  it("rejects an existing-but-invalid ha:meta instead of treating it as legacy", async () => {
    const invalidMeta = { schemaVersion: 2, tracks: "not-an-array" };
    await set(META_KEY, invalidMeta);
    await set(LEGACY_PROJECT_KEY, { schemaVersion: 1, tracks: [] });

    await expect(loadProject()).rejects.toMatchObject({ name: "InvalidMetadataError" });

    // The invalid record is preserved for recovery, never rewritten, and the
    // legacy record cannot be reached while ha:meta exists.
    expect(await get(META_KEY)).toEqual(invalidMeta);
    expect(await get(LEGACY_PROJECT_KEY)).toEqual({ schemaVersion: 1, tracks: [] });
  });

  it("omits transient playback and recording fields from persistence snapshots", () => {
    useAppStore.getState().actions.setAudioState("resume-required");
    useAppStore.getState().actions.setCountdownEndsAt(123.25);
    useAppStore.getState().actions.setRecordingError("do not persist");

    const persisted = snapshot(useAppStore.getState());

    expect(persisted).not.toHaveProperty("playback");
    expect(persisted).not.toHaveProperty("audioState");
    expect(persisted).not.toHaveProperty("recording");
    expect(persisted).not.toHaveProperty("countdownEndsAt");
    expect(persisted).not.toHaveProperty("error");
  });

  it("clearProject removes schema-2 metadata, blob records, backup, and legacy records", async () => {
    useAppStore.getState().actions.setTrackClip(0, clip(8));
    await saveProject(useAppStore.getState());
    await saveRecoveryBackup((await loadProject())!);
    await set(LEGACY_PROJECT_KEY, { schemaVersion: 1 });

    await clearProject();

    expect(await loadProject()).toBeNull();
    expect(await get(META_KEY)).toBeUndefined();
    expect(await loadRecoveryBackup()).toBeNull();
    expect(await get(LEGACY_PROJECT_KEY)).toBeUndefined();
    expect(await storedBlobKeys()).toEqual([]);
  });
});
