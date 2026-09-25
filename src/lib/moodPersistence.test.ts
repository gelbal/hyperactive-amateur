// ABOUTME: Mood persistence tests — schema-1 metadata in the shared split blob store.
// ABOUTME: Pins cross-mode garbage-collection roots before Mood autosave is wired.
import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { del, get, keys, set } from "idb-keyval";
import {
  clearProject,
  loadProject,
  resetPersistenceStore,
  saveProject,
  saveRecoveryBackup,
} from "./persistence";
import {
  clearMoodPiece,
  InvalidMoodMetadataError,
  loadMoodMeta,
  loadMoodRecoveryBackup,
  MOOD_BACKUP_KEY,
  MOOD_KEY,
  MOOD_QUARANTINE_KEY,
  saveMoodPiece,
  saveMoodRecoveryBackup,
  snapshotMood,
} from "./moodPersistence";
import { createEmptyMoodPiece } from "./moodStages";
import { useAppStore } from "../store/useAppStore";
import type { Clip, MoodPiece, MoodTake } from "../types";

const BLOB_PREFIX = "ha:blob:";

function failingOpenRequest(): IDBOpenDBRequest {
  const request = {
    onupgradeneeded: null as null | (() => void),
    onsuccess: null as null | (() => void),
    onerror: null as null | (() => void),
    onabort: null as null | (() => void),
    oncomplete: null as null | (() => void),
    result: undefined,
    error: new DOMException("Connection to Indexed Database server lost", "UnknownError"),
  };
  setTimeout(() => request.onerror?.(), 0);
  return request as unknown as IDBOpenDBRequest;
}

function makeBlob(bytes: number[], type: string): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

function clip(seed: number): Clip {
  return {
    blob: makeBlob([seed, seed + 1, seed + 2], "video/webm"),
    url: `blob:test/chop-${seed}`,
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    audioBlob: makeBlob([seed + 10, seed + 11], "audio/wav"),
    trimStartMs: 25,
    trimEndMs: 925,
    durationMs: 1000,
    posterBlob: makeBlob([0xff, 0xd8, seed], "image/jpeg"),
    posterUrl: `blob:test/chop-poster-${seed}`,
  };
}

function moodTake(seed: number, overrides: Partial<MoodTake> = {}): MoodTake {
  const id = overrides.id ?? `take-${seed}`;
  return {
    id,
    videoBlob: makeBlob([seed, seed + 1, seed + 2], "video/webm"),
    audioBlob: makeBlob([seed + 20, seed + 21], "audio/wav"),
    posterBlob: makeBlob([0xff, 0xd8, seed + 30], "image/jpeg"),
    url: `blob:test/mood-${id}`,
    audioBuffer: { duration: 1.5, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    posterUrl: `blob:test/mood-poster-${id}`,
    trimStartMs: 10,
    trimEndMs: 1210,
    durationSeconds: 1.2,
    cycleMultiple: 1,
    syncOffsetMs: 0,
    part: "lead",
    partSource: "user",
    recordedAt: 1000 + seed,
    ...overrides,
  };
}

function moodPiece(seed: number): MoodPiece {
  const piece = createEmptyMoodPiece("row", "click", { bpm: 120, cycleBars: 2 });
  const take = moodTake(seed);
  return {
    ...piece,
    cycleSeconds: 4,
    oneMicId: "mic-0",
    oneTakeId: take.id,
    mics: piece.mics.map((mic, index) =>
      index === 0 ? { ...mic, takes: [take] } : mic,
    ),
    updatedAt: 2000 + seed,
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

async function storedMoodMeta(): Promise<Record<string, any>> {
  const value = await get(MOOD_KEY);
  expect(value).toBeTruthy();
  expect(typeof value).toBe("object");
  return value as Record<string, any>;
}

async function storedMoodBackup(): Promise<Record<string, any>> {
  const value = await get(MOOD_BACKUP_KEY);
  expect(value).toBeTruthy();
  expect(typeof value).toBe("object");
  return value as Record<string, any>;
}

function moodMediaRefs(meta: Record<string, any>): string[] {
  return meta.mics.flatMap((mic: Record<string, any>) =>
    mic.takes.flatMap((take: Record<string, unknown>) =>
      ["videoBlobRef", "audioBlobRef", "posterBlobRef"].flatMap((field) => {
        const value = take[field];
        return typeof value === "string" ? [value] : [];
      }),
    ),
  );
}

function chopMediaRefs(meta: Record<string, any>): string[] {
  return meta.tracks.flatMap((track: Record<string, unknown>) =>
    ["clipBlobRef", "audioBlobRef", "posterBlobRef"].flatMap((field) => {
      const value = track[field];
      return typeof value === "string" ? [value] : [];
    }),
  );
}

async function storedChopMeta(): Promise<Record<string, any>> {
  const value = await get("ha:meta");
  expect(value).toBeTruthy();
  expect(typeof value).toBe("object");
  return value as Record<string, any>;
}

describe("mood persistence", () => {
  beforeEach(async () => {
    useAppStore.getState().actions.reset();
    await clearMoodPiece();
    await clearProject();
  });

  it("keeps live mood blob records when a Chop save runs shared GC", async () => {
    await saveMoodPiece(moodPiece(1));
    const moodRefs = moodMediaRefs(await storedMoodMeta());
    expect(moodRefs).toHaveLength(3);

    useAppStore.getState().actions.setTrackClip(0, clip(20));
    await saveProject(useAppStore.getState());

    const chopRefs = chopMediaRefs(await storedChopMeta());
    expect(chopRefs).toHaveLength(3);
    expect(await storedBlobKeys()).toEqual([...moodRefs, ...chopRefs].sort());
    for (const ref of moodRefs) {
      expect(await get(ref)).toBeTruthy();
    }
  });

  it("keeps live Chop blob records when a Mood save runs shared GC", async () => {
    useAppStore.getState().actions.setTrackClip(0, clip(30));
    await saveProject(useAppStore.getState());
    const chopRefs = chopMediaRefs(await storedChopMeta());
    expect(chopRefs).toHaveLength(3);

    await saveMoodPiece(moodPiece(2));

    const moodRefs = moodMediaRefs(await storedMoodMeta());
    expect(moodRefs).toHaveLength(3);
    expect(await storedBlobKeys()).toEqual([...moodRefs, ...chopRefs].sort());
    for (const ref of chopRefs) {
      expect(await get(ref)).toBeTruthy();
    }
  });

  it("round-trips schema-1 metadata references and excludes derived take fields", async () => {
    const piece = moodPiece(3);
    const secondTake = moodTake(4, {
      id: "take-secondary",
      audioBlob: null,
      posterBlob: null,
      audioStatus: "unavailable",
      part: "harmony",
      partSource: "ai",
      syncOffsetMs: 42,
    });
    const richPiece: MoodPiece = {
      ...piece,
      vibe: "mixtape",
      lens: "splits",
      mics: piece.mics.map((mic, index) =>
        index === 0 ? { ...mic, takes: [...mic.takes, secondTake] } : mic,
      ),
      updatedAt: 3000,
    };

    const snapshot = snapshotMood(richPiece);
    expect(snapshot.mics[0].takes[0]).not.toHaveProperty("url");
    expect(snapshot.mics[0].takes[0]).not.toHaveProperty("audioBuffer");
    expect(snapshot.mics[0].takes[0]).not.toHaveProperty("posterUrl");

    await saveMoodPiece(richPiece);

    const meta = await storedMoodMeta();
    expect(meta.moodSchemaVersion).toBe(1);
    expect(blobPaths(meta)).toEqual([]);
    expect(meta.mics[0].takes[0]).not.toHaveProperty("videoBlob");
    expect(meta.mics[0].takes[0].videoBlobRef).toMatch(/^ha:blob:[a-f0-9]{16}$/);
    expect(meta.mics[0].takes[1].audioBlobRef).toBeUndefined();

    const loaded = await loadMoodMeta();
    expect(loaded).toMatchObject({
      moodSchemaVersion: 1,
      stage: "row",
      timeFeel: "click",
      bpm: 120,
      cycleBars: 2,
      cycleSeconds: 4,
      oneMicId: "mic-0",
      oneTakeId: "take-3",
      vibe: "mixtape",
      lens: "splits",
      updatedAt: 3000,
    });
    expect(isBlobLike(loaded?.mics[0].takes[0].videoBlob)).toBe(true);
    expect(isBlobLike(loaded?.mics[0].takes[0].audioBlob)).toBe(true);
    expect(isBlobLike(loaded?.mics[0].takes[0].posterBlob)).toBe(true);
    expect(loaded?.mics[0].takes[1]).toMatchObject({
      id: "take-secondary",
      audioBlob: null,
      posterBlob: null,
      audioStatus: "unavailable",
      part: "harmony",
      partSource: "ai",
      syncOffsetMs: 42,
    });
    expect(loaded?.mics[0].takes[0]).not.toHaveProperty("url");
    expect(loaded?.mics[0].takes[0]).not.toHaveProperty("audioBuffer");
    expect(loaded?.missingBlobs).toBeUndefined();
  });

  it("round-trips additive optional Credits metadata", async () => {
    const piece: MoodPiece = {
      ...moodPiece(5),
      credits: {
        enabled: true,
        names: { "mic-0": "Bass", "mic-1": "Ferro" },
        styleIndex: 2,
        mode: "together",
      },
    };

    expect(snapshotMood(piece).credits).toEqual(piece.credits);

    await saveMoodPiece(piece);

    expect((await storedMoodMeta()).credits).toEqual(piece.credits);
    expect((await loadMoodMeta())?.credits).toEqual(piece.credits);
  });

  it("round-trips cloned additive One aesthetics in schema 1", async () => {
    const piece: MoodPiece = {
      ...moodPiece(6),
      artDirection: { fxPreset: "sweep", creditPalette: "print", source: "user" },
      keyEstimate: { key: "D#", mode: "minor", confidence: 0.88 },
    };

    const snapshot = snapshotMood(piece);
    expect(snapshot.artDirection).toEqual(piece.artDirection);
    expect(snapshot.artDirection).not.toBe(piece.artDirection);
    expect(snapshot.keyEstimate).toEqual(piece.keyEstimate);
    expect(snapshot.keyEstimate).not.toBe(piece.keyEstimate);

    await saveMoodPiece(piece);

    expect((await storedMoodMeta()).artDirection).toEqual(piece.artDirection);
    expect((await storedMoodMeta()).keyEstimate).toEqual(piece.keyEstimate);
    expect((await loadMoodMeta())?.artDirection).toEqual(piece.artDirection);
    expect((await loadMoodMeta())?.keyEstimate).toEqual(piece.keyEstimate);
  });

  it("round-trips cloned additive saved selections without a schema bump", async () => {
    const piece: MoodPiece = {
      ...moodPiece(7),
      savedSelections: { "mic-0": "off", "mic-1": "off" },
    };

    const snapshot = snapshotMood(piece);
    expect(snapshot.moodSchemaVersion).toBe(1);
    expect(snapshot.savedSelections).toEqual(piece.savedSelections);
    expect(snapshot.savedSelections).not.toBe(piece.savedSelections);

    await saveMoodPiece(piece);

    expect((await storedMoodMeta()).savedSelections).toEqual(piece.savedSelections);
    expect((await loadMoodMeta())?.savedSelections).toEqual(piece.savedSelections);
  });

  it("deduplicates identical take blob bytes under one content-addressed key", async () => {
    const sharedBytes = [7, 7, 7];
    const firstTake = moodTake(10, {
      id: "take-shared-a",
      videoBlob: makeBlob(sharedBytes, "video/webm"),
      audioBlob: null,
      posterBlob: null,
    });
    const secondTake = moodTake(11, {
      id: "take-shared-b",
      videoBlob: makeBlob(sharedBytes, "video/webm"),
      audioBlob: null,
      posterBlob: null,
    });
    const piece = moodPiece(10);
    const dedupePiece: MoodPiece = {
      ...piece,
      oneTakeId: firstTake.id,
      mics: piece.mics.map((mic, index) =>
        index === 0 ? { ...mic, takes: [firstTake, secondTake] } : mic,
      ),
    };

    await saveMoodPiece(dedupePiece);

    const meta = await storedMoodMeta();
    expect(meta.mics[0].takes[0].videoBlobRef).toBe(meta.mics[0].takes[1].videoBlobRef);
    expect(await storedBlobKeys()).toHaveLength(1);
  });

  it("stores mood recovery backups as metadata references without blob copies", async () => {
    const piece = moodPiece(40);

    await saveMoodRecoveryBackup(snapshotMood(piece));

    const backup = await storedMoodBackup();
    const refs = moodMediaRefs(backup);
    expect(backup).toMatchObject({ moodSchemaVersion: 1 });
    expect(blobPaths(backup)).toEqual([]);
    expect(refs).toHaveLength(3);
    expect(backup.mics[0].takes[0]).not.toHaveProperty("videoBlob");
    expect(await loadMoodRecoveryBackup()).toEqual(backup);
    for (const ref of refs) {
      expect(isBlobLike(await get(ref))).toBe(true);
    }
  });

  it("quarantines invalid current mood metadata instead of rewriting it in place", async () => {
    const invalidMeta = { moodSchemaVersion: 1, mics: "not-an-array" };
    await set(MOOD_KEY, invalidMeta);

    await expect(loadMoodMeta()).rejects.toBeInstanceOf(InvalidMoodMetadataError);

    // Set aside, so Mood can start fresh and keep saving without ever
    // overwriting the original bytes.
    expect(await get(MOOD_KEY)).toBeUndefined();
    expect(await get(MOOD_QUARANTINE_KEY)).toEqual(invalidMeta);
  });

  it("refuses to overwrite an unresolved mood quarantine record with a second one", async () => {
    const first = { moodSchemaVersion: 1, mics: "first" };
    const second = { moodSchemaVersion: 1, mics: "second" };
    await set(MOOD_QUARANTINE_KEY, first);
    await set(MOOD_KEY, second);

    const failure = loadMoodMeta();
    await expect(failure).rejects.toThrow(/quarantine/);
    await expect(failure).rejects.not.toBeInstanceOf(InvalidMoodMetadataError);

    expect(await get(MOOD_QUARANTINE_KEY)).toEqual(first);
    expect(await get(MOOD_KEY)).toEqual(second);
  });

  it("leaves mood metadata from a newer schema untouched and fails the load", async () => {
    const newer = { moodSchemaVersion: 2, mics: [] };
    await set(MOOD_KEY, newer);

    const failure = loadMoodMeta();
    await expect(failure).rejects.toThrow(/newer/);
    await expect(failure).rejects.not.toBeInstanceOf(InvalidMoodMetadataError);

    expect(await get(MOOD_KEY)).toEqual(newer);
    expect(await get(MOOD_QUARANTINE_KEY)).toBeUndefined();
  });

  it("holds blob GC while a mood quarantine record has no readable mic list", async () => {
    await saveMoodPiece(moodPiece(40));
    const orphaned = await storedBlobKeys();
    expect(orphaned.length).toBeGreaterThan(0);
    await set(MOOD_QUARANTINE_KEY, { moodSchemaVersion: 1, mics: "not-an-array" });

    useAppStore.getState().actions.setTrackClip(0, clip(140));
    useAppStore.getState().actions.clearTrackClip(0);
    await saveProject(useAppStore.getState());
    await saveMoodPiece({ ...moodPiece(41), mics: [] });

    for (const ref of orphaned) {
      expect(isBlobLike(await get(ref))).toBe(true);
    }

    await del(MOOD_QUARANTINE_KEY);
    await saveMoodPiece({ ...moodPiece(41), mics: [] });
    for (const ref of orphaned) {
      expect(await get(ref)).toBeUndefined();
    }
  });

  it("roots the blob refs of a mood quarantine record that has a mic list", async () => {
    await saveMoodPiece(moodPiece(42));
    const refs = moodMediaRefs(await storedMoodMeta());
    await set(MOOD_QUARANTINE_KEY, {
      moodSchemaVersion: 1,
      mics: [{ id: "mic-0", takes: [{ id: "take-42", videoBlobRef: refs[0] }] }],
    });

    await saveMoodPiece({ ...moodPiece(43), mics: [] });

    expect(await storedBlobKeys()).toEqual([refs[0]]);
  });

  it.each([
    ["a live Mood record with an unreadable mic list (before Mood loads)", MOOD_KEY, { moodSchemaVersion: 1, mics: null }],
    ["a live Mood record from a newer schema", MOOD_KEY, { moodSchemaVersion: 2, layout: "unknown" }],
    [
      "a Mood quarantine with a readable mic list but unreadable takes",
      MOOD_QUARANTINE_KEY,
      { moodSchemaVersion: 1, mics: [{ id: "mic-0", takes: "unreadable" }] },
    ],
    [
      "a Mood record whose ref field is not a string",
      MOOD_KEY,
      { moodSchemaVersion: 1, mics: [{ id: "mic-0", takes: [{ id: "t", videoBlobRef: 7 }] }] },
    ],
  ])("holds blob GC while %s", async (_label, key, record) => {
    await saveMoodPiece(moodPiece(45));
    const moodRefs = await storedBlobKeys();
    expect(moodRefs.length).toBeGreaterThan(0);
    await set(key, record);

    // A Chop save runs the shared GC; nothing can tell which blobs the
    // unreadable record names.
    useAppStore.getState().actions.setTrackClip(0, clip(145));
    useAppStore.getState().actions.clearTrackClip(0);
    await saveProject(useAppStore.getState());

    for (const ref of moodRefs) {
      expect(isBlobLike(await get(ref))).toBe(true);
    }
  });

  it("holds blob GC while the live Chop record comes from a newer schema", async () => {
    await saveMoodPiece(moodPiece(46));
    useAppStore.getState().actions.setTrackClip(0, clip(146));
    await saveProject(useAppStore.getState());
    const chopRefs = chopMediaRefs(await storedChopMeta());
    await set("ha:meta", { schemaVersion: 3, layout: "unknown" });

    await saveMoodPiece({ ...moodPiece(47), mics: [] });

    for (const ref of chopRefs) {
      expect(isBlobLike(await get(ref))).toBe(true);
    }
  });

  it("reopens the database for Mood after a failed open once the store is reset", async () => {
    await saveMoodPiece(moodPiece(44));
    resetPersistenceStore();
    const openSpy = vi.spyOn(indexedDB, "open").mockImplementationOnce(() => failingOpenRequest());

    await expect(loadMoodMeta()).rejects.toMatchObject({ name: "UnknownError" });
    // idb-keyval caches the rejected open: without a reset every later call
    // fails the same way.
    await expect(loadMoodMeta()).rejects.toMatchObject({ name: "UnknownError" });

    resetPersistenceStore();

    expect((await loadMoodMeta())?.mics[0].takes).toHaveLength(1);
    expect(openSpy).toHaveBeenCalledTimes(2);
    openSpy.mockRestore();
  });

  it("keeps mood backup-only blob records when a Chop save runs shared GC", async () => {
    await saveMoodRecoveryBackup(moodPiece(50));
    const backupRefs = moodMediaRefs(await storedMoodBackup());
    expect(await get(MOOD_KEY)).toBeUndefined();

    useAppStore.getState().actions.setTrackClip(0, clip(150));
    await saveProject(useAppStore.getState());

    for (const ref of backupRefs) {
      expect(isBlobLike(await get(ref))).toBe(true);
    }
  });

  it("keeps Chop backup-only blob records when a Mood save runs shared GC", async () => {
    useAppStore.getState().actions.setTrackClip(0, clip(60));
    await saveProject(useAppStore.getState());
    const loaded = await loadProject();
    expect(loaded).not.toBeNull();
    await saveRecoveryBackup(loaded!);
    const chopBackup = (await get("ha:meta-backup")) as Record<string, any>;
    const backupRefs = chopMediaRefs(chopBackup);
    expect(backupRefs).toHaveLength(3);

    useAppStore.getState().actions.clearTrackClip(0);
    await saveProject(useAppStore.getState());
    expect(chopMediaRefs(await storedChopMeta())).toEqual([]);

    await saveMoodPiece(moodPiece(160));

    for (const ref of backupRefs) {
      expect(isBlobLike(await get(ref))).toBe(true);
    }
  });

  it("clearMoodPiece leaves Chop metadata and blob records intact", async () => {
    await saveMoodPiece(moodPiece(170));
    const moodRefs = moodMediaRefs(await storedMoodMeta());
    useAppStore.getState().actions.setTrackClip(0, clip(70));
    await saveProject(useAppStore.getState());
    const chopRefs = chopMediaRefs(await storedChopMeta());

    await set(MOOD_QUARANTINE_KEY, { moodSchemaVersion: 2, mics: [] });

    await clearMoodPiece();

    expect(await get(MOOD_KEY)).toBeUndefined();
    expect(await get(MOOD_QUARANTINE_KEY)).toBeUndefined();
    expect(await storedChopMeta()).toBeTruthy();
    expect(await storedBlobKeys()).toEqual(chopRefs.sort());
    for (const ref of moodRefs) {
      expect(await get(ref)).toBeUndefined();
    }
  });

  it("clearProject leaves Mood metadata and blob records intact", async () => {
    useAppStore.getState().actions.setTrackClip(0, clip(80));
    await saveProject(useAppStore.getState());
    const chopRefs = chopMediaRefs(await storedChopMeta());
    await saveMoodPiece(moodPiece(180));
    const moodRefs = moodMediaRefs(await storedMoodMeta());

    await clearProject();

    expect(await get("ha:meta")).toBeUndefined();
    expect(await storedMoodMeta()).toBeTruthy();
    expect(await storedBlobKeys()).toEqual(moodRefs.sort());
    for (const ref of chopRefs) {
      expect(await get(ref)).toBeUndefined();
    }
  });
});
