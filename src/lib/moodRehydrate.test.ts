// ABOUTME: Mood rehydrate tests — schema-1 metadata is normalized before lazy hydration.
// ABOUTME: Pins recovery-backup-first behavior so repairs cannot overwrite saved takes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { get, set } from "idb-keyval";
import {
  clearMoodPiece,
  loadMoodRecoveryBackup,
  MOOD_BACKUP_KEY,
  MOOD_KEY,
  saveMoodPiece,
} from "./moodPersistence";
import * as moodPersistence from "./moodPersistence";
import { clearProject } from "./persistence";
import { createEmptyMoodPiece } from "./moodStages";
import { decodeMoodTakes, normalizeMoodMeta, rehydrateMoodFromStorage } from "./moodRehydrate";
import * as posterFrame from "./posterFrame";
import type { MoodMic, MoodPiece, MoodTake } from "../types";

function makeBlob(bytes: number[], type: string): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
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

function cleanMoodPiece(): MoodPiece {
  const piece = createEmptyMoodPiece("corners", "pocket");
  const take = moodTake(1);
  return {
    ...piece,
    cycleSeconds: 1.2,
    oneMicId: "mic-0",
    oneTakeId: take.id,
    mics: piece.mics.map((mic, index) =>
      index === 0 ? { ...mic, takes: [take] } : mic,
    ),
    updatedAt: 2000,
  };
}

function emptyMic(id: string): MoodMic {
  return { id, takes: [] };
}

function decodeContext(decodeAudioData: ReturnType<typeof vi.fn>): AudioContext {
  return { decodeAudioData } as unknown as AudioContext;
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

async function storeCleanMetadata(): Promise<Record<string, any>> {
  await saveMoodPiece(cleanMoodPiece());
  const meta = await get(MOOD_KEY);
  expect(meta).toBeTruthy();
  return meta as Record<string, any>;
}

async function overwriteMoodMetadata(mutator: (meta: Record<string, any>) => void): Promise<void> {
  const meta = await storeCleanMetadata();
  mutator(meta);
  await set(MOOD_KEY, meta);
}

describe("normalizeMoodMeta", () => {
  it("accepts clean metadata without warnings or blob decode fields", () => {
    const piece = cleanMoodPiece();
    const warnings: string[] = [];

    const normalized = normalizeMoodMeta(piece, warnings);

    expect(warnings).toEqual([]);
    expect(normalized).toMatchObject({
      moodSchemaVersion: 1,
      stage: "corners",
      timeFeel: "pocket",
      cycleSeconds: 1.2,
      oneMicId: "mic-0",
      oneTakeId: "take-1",
      updatedAt: 2000,
    });
    expect(normalized.mics).toHaveLength(4);
    expect(normalized.mics[0].takes[0].videoBlob).toBe(piece.mics[0].takes[0].videoBlob);
    expect(normalized.mics[0].takes[0]).not.toHaveProperty("audioBuffer");
    expect(normalized.mics[0].takes[0]).not.toHaveProperty("url");
  });

  it("repairs an unknown stage to a known stage", () => {
    const raw = { ...cleanMoodPiece(), stage: "triangle" } as unknown;
    const warnings: string[] = [];

    const normalized = normalizeMoodMeta(raw, warnings);

    expect(normalized.stage).toBe("corners");
    expect(warnings).toContain("Mood stage was invalid and reset to corners.");
  });

  it("repairs an unknown feel to a known feel", () => {
    const raw = { ...cleanMoodPiece(), timeFeel: "loose" } as unknown;
    const warnings: string[] = [];

    const normalized = normalizeMoodMeta(raw, warnings);

    expect(normalized.timeFeel).toBe("pocket");
    expect(warnings).toContain("Mood feel was invalid and reset to pocket.");
  });

  it("repairs invalid cycleSeconds to null instead of coercing it", () => {
    const raw = { ...cleanMoodPiece(), cycleSeconds: "1.2" } as unknown;
    const warnings: string[] = [];

    const normalized = normalizeMoodMeta(raw, warnings);

    expect(normalized.cycleSeconds).toBeNull();
    expect(warnings).toContain("Mood cycleSeconds was invalid and reset to null.");
  });

  it("drops extra mics with a warning", () => {
    const raw = {
      ...cleanMoodPiece(),
      mics: [...cleanMoodPiece().mics, emptyMic("mic-extra")],
    };
    const warnings: string[] = [];

    const normalized = normalizeMoodMeta(raw, warnings);

    expect(normalized.mics).toHaveLength(4);
    expect(normalized.mics.some((mic) => mic.id === "mic-extra")).toBe(false);
    expect(warnings).toContain("Mood mics were truncated to 4 for the corners stage.");
  });

  it("creates missing mics empty with a warning", () => {
    const raw = { ...cleanMoodPiece(), mics: cleanMoodPiece().mics.slice(0, 2) };
    const warnings: string[] = [];

    const normalized = normalizeMoodMeta(raw, warnings);

    expect(normalized.mics).toHaveLength(4);
    expect(normalized.mics[2]).toEqual({ id: "mic-2", takes: [] });
    expect(normalized.mics[3]).toEqual({ id: "mic-3", takes: [] });
    expect(warnings).toContain("Mood mics were padded to 4 for the corners stage.");
  });

  it("drops takes over MAX_TAKES_PER_MIC with a warning", () => {
    const raw = cleanMoodPiece();
    raw.mics[0] = {
      ...raw.mics[0],
      takes: Array.from({ length: 7 }, (_, index) => moodTake(index + 10)),
    };
    const warnings: string[] = [];

    const normalized = normalizeMoodMeta(raw, warnings);

    expect(normalized.mics[0].takes).toHaveLength(6);
    expect(normalized.mics[0].takes.map((take) => take.id)).not.toContain("take-16");
    expect(warnings).toContain("Mic mic-0 had more than 6 takes; extra takes were dropped.");
  });

  it("drops a take with an unsupported cycleMultiple instead of coercing it", () => {
    const raw = cleanMoodPiece();
    raw.mics[0] = {
      ...raw.mics[0],
      takes: [{ ...raw.mics[0].takes[0], cycleMultiple: 3 } as unknown as MoodTake],
    };
    const warnings: string[] = [];

    const normalized = normalizeMoodMeta(raw, warnings);

    expect(normalized.mics[0].takes).toEqual([]);
    expect(warnings).toContain("Take take-1 in mic-0 had an invalid cycleMultiple and was dropped.");
  });

  it("clears one-pointers when either pointer is dangling", () => {
    const raw = { ...cleanMoodPiece(), oneTakeId: "take-missing" };
    const warnings: string[] = [];

    const normalized = normalizeMoodMeta(raw, warnings);

    expect(normalized.oneMicId).toBeNull();
    expect(normalized.oneTakeId).toBeNull();
    expect(warnings).toContain("Mood one-pointers were dangling and cleared.");
  });
});

describe("rehydrateMoodFromStorage", () => {
  beforeEach(async () => {
    await clearMoodPiece();
    await clearProject();
    vi.restoreAllMocks();
  });

  it("returns an empty result when no mood has been saved", async () => {
    const result = await rehydrateMoodFromStorage();

    expect(result).toEqual({
      status: "empty",
      ok: false,
      degraded: false,
      piece: null,
      warnings: [],
    });
  });

  it("returns an ok result for clean mood metadata", async () => {
    await saveMoodPiece(cleanMoodPiece());

    const result = await rehydrateMoodFromStorage();

    expect(result.status).toBe("ok");
    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(isBlobLike(result.piece?.mics[0].takes[0].videoBlob)).toBe(true);
  });

  it("writes a recovery backup before returning repaired metadata", async () => {
    await overwriteMoodMetadata((meta) => {
      meta.stage = "row";
      meta.mics = meta.mics.slice(0, 1);
    });

    const result = await rehydrateMoodFromStorage();

    expect(result.status).toBe("degraded");
    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.piece?.stage).toBe("row");
    // A 1-mic row piece is below the stage's initialMics (2), so it pads up to
    // initialMics — not maxMics. Row/Stack mic count is dynamic (spec §4).
    expect(result.piece?.mics).toHaveLength(2);
    expect(result.warnings).toContain("Mood mics were padded to 2 for the row stage.");
    const backup = (await loadMoodRecoveryBackup()) as Record<string, any>;
    expect(backup).toMatchObject({ moodSchemaVersion: 1, stage: "row" });
    expect(backup.mics).toHaveLength(1);
    expect(backup.mics[0].takes[0].videoBlobRef).toMatch(/^ha:blob:[a-f0-9]{16}$/);
  });

  it("preserves a valid in-range linear mic count instead of forcing maxMics", () => {
    const raw = {
      ...cleanMoodPiece(),
      stage: "row",
      mics: [
        { id: "mic-0", takes: [] },
        { id: "mic-1", takes: [] },
        { id: "mic-2", takes: [] },
      ],
      oneMicId: null,
      oneTakeId: null,
    } as unknown;
    const warnings: string[] = [];

    const normalized = normalizeMoodMeta(raw, warnings);

    // 3 is within [initialMics 2, maxMics 5] for row — the grown count must
    // round-trip unchanged, with no mic-count resize warning.
    expect(normalized.mics.map((mic) => mic.id)).toEqual(["mic-0", "mic-1", "mic-2"]);
    expect(warnings.some((w) => w.includes("mics were"))).toBe(false);
  });

  it("truncates an over-max linear mic count to maxMics", () => {
    const raw = {
      ...cleanMoodPiece(),
      stage: "stack",
      mics: Array.from({ length: 7 }, (_, index) => ({ id: `mic-${index}`, takes: [] })),
      oneMicId: null,
      oneTakeId: null,
    } as unknown;
    const warnings: string[] = [];

    const normalized = normalizeMoodMeta(raw, warnings);

    expect(normalized.mics).toHaveLength(5);
    expect(warnings).toContain("Mood mics were truncated to 5 for the stack stage.");
  });

  it("returns a failed result and no piece when the repair backup cannot be written", async () => {
    await overwriteMoodMetadata((meta) => {
      meta.cycleSeconds = -1;
    });
    vi.spyOn(moodPersistence, "saveMoodRecoveryBackup").mockRejectedValueOnce(
      new Error("quota exceeded"),
    );

    const result = await rehydrateMoodFromStorage();

    expect(result.status).toBe("failed");
    expect(result.ok).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.piece).toBeNull();
    expect(result.warnings).toContain(
      "Mood recovery backup could not be written. Saved mood was left untouched and autosave was paused.",
    );
    expect(await get(MOOD_BACKUP_KEY)).toBeUndefined();
  });

  it("catches invalid current metadata as a protected failed result", async () => {
    const invalidMeta = { moodSchemaVersion: 1, mics: "not-an-array" };
    await set(MOOD_KEY, invalidMeta);

    const result = await rehydrateMoodFromStorage();

    expect(result.status).toBe("failed");
    expect(result.ok).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.piece).toBeNull();
    expect(result.warnings).toContain(
      "Saved mood metadata was invalid. Autosave was paused to avoid overwriting it.",
    );
    expect(await get(MOOD_KEY)).toEqual(invalidMeta);
    expect(await get(MOOD_BACKUP_KEY)).toBeUndefined();
  });
});

describe("decodeMoodTakes", () => {
  const healedBuffer = { duration: 1.2, sampleRate: 48000 } as AudioBuffer;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the audio sidecar when a new decode failure enters repair state", async () => {
    const piece = cleanMoodPiece();
    const originalAudioBlob = piece.mics[0].takes[0].audioBlob;
    const decodeAudioData = vi.fn().mockRejectedValue(new Error("decode failed"));

    const result = await decodeMoodTakes(piece, decodeContext(decodeAudioData));

    expect(result.degraded).toBe(true);
    expect(result.warnings).toEqual([
      "Mood take take-1 in mic-0 audio unavailable — re-record to restore sound.",
    ]);
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
    const take = result.piece?.mics[0].takes[0];
    expect(take?.audioBlob).toBe(originalAudioBlob);
    expect(take?.audioStatus).toBe("unavailable");
    expect(take?.audioBuffer).toBeNull();
    expect(take?.url).toMatch(/^blob:test\//);
    expect(take?.posterUrl).toMatch(/^blob:test\//);
  });

  it("heals a persisted-unavailable take quietly when decode succeeds", async () => {
    const piece = cleanMoodPiece();
    piece.mics[0].takes[0] = {
      ...piece.mics[0].takes[0],
      audioBuffer: null,
      audioStatus: "unavailable",
    };
    const decodeAudioData = vi.fn().mockResolvedValue(healedBuffer);

    const result = await decodeMoodTakes(piece, decodeContext(decodeAudioData));

    expect(result.degraded).toBe(false);
    expect(result.warnings).toEqual([]);
    const take = result.piece?.mics[0].takes[0];
    expect(take?.audioStatus).toBe("ok");
    expect(take?.audioBuffer).toBe(healedBuffer);
  });

  it("keeps a still-failing persisted-unavailable take quiet and retryable", async () => {
    const piece = cleanMoodPiece();
    const originalAudioBlob = piece.mics[0].takes[0].audioBlob;
    piece.mics[0].takes[0] = {
      ...piece.mics[0].takes[0],
      audioBuffer: null,
      audioStatus: "unavailable",
    };
    const decodeAudioData = vi.fn().mockRejectedValue(new Error("still unavailable"));

    const result = await decodeMoodTakes(piece, decodeContext(decodeAudioData));

    expect(result.degraded).toBe(false);
    expect(result.warnings).toEqual([]);
    const take = result.piece?.mics[0].takes[0];
    expect(take?.audioBlob).toBe(originalAudioBlob);
    expect(take?.audioStatus).toBe("unavailable");
    expect(take?.audioBuffer).toBeNull();
  });

  it("starts best-effort poster regeneration for missing posters without failing hydration", async () => {
    const capture = vi.spyOn(posterFrame, "captureFirstFrame").mockResolvedValue(null);
    const piece = cleanMoodPiece();
    piece.mics[0].takes[0] = {
      ...piece.mics[0].takes[0],
      posterBlob: null,
      posterUrl: null,
    };
    const videoBlob = piece.mics[0].takes[0].videoBlob;
    const decodeAudioData = vi.fn().mockResolvedValue(healedBuffer);

    const result = await decodeMoodTakes(piece, decodeContext(decodeAudioData));

    expect(result.ok).toBe(true);
    expect(result.piece?.mics[0].takes[0].posterBlob).toBeNull();
    expect(capture).toHaveBeenCalledWith(videoBlob);
  });
});
