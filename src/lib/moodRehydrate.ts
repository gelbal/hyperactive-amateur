// ABOUTME: Mood rehydrate core — load schema-1 metadata, normalize, and protect repairs.
// ABOUTME: Blob decoding is intentionally deferred to lazy Mood hydration.
import type {
  MoodLens,
  MoodPart,
  MoodPiece,
  MoodStageId,
  MoodTake,
  MoodTimeFeel,
  MoodVibeId,
} from "../types";
import { isBlob, isRecord } from "./persistence";
import { MAX_TAKES_PER_MIC, STAGE_DESCRIPTORS } from "./moodStages";
import * as moodPersistence from "./moodPersistence";
import type {
  PersistedMoodMic,
  PersistedMoodPiece,
  PersistedMoodTake,
} from "./moodPersistence";

type MoodRehydrateEmptyResult = {
  status: "empty";
  ok: false;
  degraded: false;
  piece: null;
  warnings: string[];
};

type MoodRehydrateOkResult = {
  status: "ok";
  ok: true;
  degraded: false;
  piece: PersistedMoodPiece;
  warnings: string[];
};

type MoodRehydrateDegradedResult = {
  status: "degraded";
  ok: true;
  degraded: true;
  piece: PersistedMoodPiece;
  warnings: string[];
};

type MoodRehydrateFailedResult = {
  status: "failed";
  ok: false;
  degraded: true;
  piece: null;
  warnings: string[];
};

export type MoodRehydrateResult =
  | MoodRehydrateEmptyResult
  | MoodRehydrateOkResult
  | MoodRehydrateDegradedResult
  | MoodRehydrateFailedResult;

const MOOD_STAGES = Object.keys(STAGE_DESCRIPTORS) as MoodStageId[];
const MOOD_FEELS: MoodTimeFeel[] = ["pocket", "click"];
const MOOD_VIBES: MoodVibeId[] = ["clean", "print", "mixtape", "blocks", "camcorder"];
const MOOD_LENSES: MoodLens[] = ["wall", "splits"];
const MOOD_PARTS: MoodPart[] = ["lead", "harmony", "bass", "beatbox", "adlib"];
const MOOD_PART_SOURCES = ["ai", "user"] as const;
const MOOD_AUDIO_STATUSES = ["ok", "unavailable"] as const;
const MOOD_CYCLE_BARS = [1, 2, 4] as const;
const MOOD_CYCLE_MULTIPLES = [0.5, 1, 2, 4] as const;

function warn(warnings: string[], message: string): void {
  warnings.push(message);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeEnum<T extends string>(
  warnings: string[],
  name: string,
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof value === "string" && allowed.includes(value as T)) return value as T;
  warn(warnings, `${name} was invalid and reset to ${fallback}.`);
  return fallback;
}

function normalizeNullableEnum<T extends string | number>(
  warnings: string[],
  name: string,
  value: unknown,
  allowed: readonly T[],
  fallback: T | null,
): T | null {
  if (value === null) return null;
  if (allowed.includes(value as T)) return value as T;
  warn(warnings, `${name} was invalid and reset to ${fallback}.`);
  return fallback;
}

function normalizeNullablePositiveNumber(
  warnings: string[],
  name: string,
  value: unknown,
): number | null {
  if (value === null) return null;
  const n = finiteNumber(value);
  if (n !== null && n > 0) return n;
  warn(warnings, `${name} was invalid and reset to null.`);
  return null;
}

function normalizeUpdatedAt(value: unknown, warnings: string[]): number {
  const updatedAt = finiteNumber(value);
  if (updatedAt !== null) return updatedAt;
  warn(warnings, "Mood updatedAt was invalid and reset.");
  return Date.now();
}

function normalizeMicId(
  value: unknown,
  fallback: string,
  usedIds: Set<string>,
  warnings: string[],
): string {
  if (typeof value === "string" && value.length > 0 && !usedIds.has(value)) {
    usedIds.add(value);
    return value;
  }
  warn(warnings, `Mic ${fallback} id was invalid and reset.`);
  usedIds.add(fallback);
  return fallback;
}

function normalizeBlobOrNull(
  warnings: string[],
  takeId: string,
  micId: string,
  field: "audioBlob" | "posterBlob",
  value: unknown,
): Blob | null {
  if (value === null || value === undefined) return null;
  if (isBlob(value)) return value;
  warn(warnings, `Take ${takeId} in ${micId} ${field} was invalid and reset to null.`);
  return null;
}

function normalizeTake(
  warnings: string[],
  rawTake: unknown,
  micId: string,
): PersistedMoodTake | null {
  if (!isRecord(rawTake)) {
    warn(warnings, `A take in ${micId} was invalid and dropped.`);
    return null;
  }

  if (typeof rawTake.id !== "string" || rawTake.id.length === 0) {
    warn(warnings, `A take in ${micId} had an invalid id and was dropped.`);
    return null;
  }
  const takeId = rawTake.id;

  if (!isBlob(rawTake.videoBlob)) {
    warn(warnings, `Take ${takeId} in ${micId} videoBlob was invalid and was dropped.`);
    return null;
  }

  const trimStartMs = finiteNumber(rawTake.trimStartMs);
  const trimEndMs = finiteNumber(rawTake.trimEndMs);
  if (
    trimStartMs === null ||
    trimEndMs === null ||
    trimStartMs < 0 ||
    trimEndMs <= trimStartMs
  ) {
    warn(warnings, `Take ${takeId} in ${micId} trim window was invalid and was dropped.`);
    return null;
  }

  const durationSeconds = finiteNumber(rawTake.durationSeconds);
  if (durationSeconds === null || durationSeconds <= 0) {
    warn(warnings, `Take ${takeId} in ${micId} duration was invalid and was dropped.`);
    return null;
  }

  if (!MOOD_CYCLE_MULTIPLES.includes(rawTake.cycleMultiple as MoodTake["cycleMultiple"])) {
    warn(warnings, `Take ${takeId} in ${micId} had an invalid cycleMultiple and was dropped.`);
    return null;
  }

  const syncOffsetMs = finiteNumber(rawTake.syncOffsetMs);
  const recordedAt = finiteNumber(rawTake.recordedAt);
  const audioStatus = normalizeEnum(
    warnings,
    `Take ${takeId} in ${micId} audioStatus`,
    rawTake.audioStatus,
    MOOD_AUDIO_STATUSES,
    "ok",
  );
  const part = normalizeNullableEnum(
    warnings,
    `Take ${takeId} in ${micId} part`,
    rawTake.part,
    MOOD_PARTS,
    null,
  );
  const partSource = part
    ? normalizeNullableEnum(
        warnings,
        `Take ${takeId} in ${micId} partSource`,
        rawTake.partSource,
        MOOD_PART_SOURCES,
        null,
      )
    : null;

  if (syncOffsetMs === null) {
    warn(warnings, `Take ${takeId} in ${micId} syncOffsetMs was invalid and reset to 0.`);
  }
  if (recordedAt === null) {
    warn(warnings, `Take ${takeId} in ${micId} recordedAt was invalid and reset.`);
  }

  return {
    id: takeId,
    videoBlob: rawTake.videoBlob,
    audioBlob: normalizeBlobOrNull(warnings, takeId, micId, "audioBlob", rawTake.audioBlob),
    posterBlob: normalizeBlobOrNull(warnings, takeId, micId, "posterBlob", rawTake.posterBlob),
    trimStartMs,
    trimEndMs,
    durationSeconds,
    cycleMultiple: rawTake.cycleMultiple as MoodTake["cycleMultiple"],
    syncOffsetMs: syncOffsetMs ?? 0,
    part,
    partSource,
    audioStatus,
    recordedAt: recordedAt ?? Date.now(),
  };
}

function normalizeMic(
  warnings: string[],
  rawMic: unknown,
  index: number,
  usedIds: Set<string>,
): PersistedMoodMic {
  const fallbackId = `mic-${index}`;
  if (!isRecord(rawMic)) {
    usedIds.add(fallbackId);
    return { id: fallbackId, takes: [] };
  }

  const id = normalizeMicId(rawMic.id, fallbackId, usedIds, warnings);
  const rawTakes = Array.isArray(rawMic.takes) ? rawMic.takes : [];
  if (!Array.isArray(rawMic.takes)) {
    warn(warnings, `Mic ${id} takes were invalid and reset.`);
  } else if (rawMic.takes.length > MAX_TAKES_PER_MIC) {
    warn(warnings, `Mic ${id} had more than ${MAX_TAKES_PER_MIC} takes; extra takes were dropped.`);
  }

  return {
    id,
    takes: rawTakes
      .slice(0, MAX_TAKES_PER_MIC)
      .map((take) => normalizeTake(warnings, take, id))
      .filter((take): take is PersistedMoodTake => take !== null),
  };
}

function normalizeMics(
  rawMics: unknown,
  stage: MoodStageId,
  warnings: string[],
): PersistedMoodMic[] {
  const { maxMics, initialMics } = STAGE_DESCRIPTORS[stage];
  const sourceMics = Array.isArray(rawMics) ? rawMics : [];
  if (!Array.isArray(rawMics)) {
    warn(warnings, `Mood mics were invalid and reset to ${initialMics} for the ${stage} stage.`);
  } else if (rawMics.length > maxMics) {
    warn(warnings, `Mood mics were truncated to ${maxMics} for the ${stage} stage.`);
  } else if (rawMics.length < initialMics) {
    warn(warnings, `Mood mics were padded to ${initialMics} for the ${stage} stage.`);
  }

  // Row/Stack mic count is dynamic (initialMics..maxMics, growing one-way as
  // mics gain their first take — spec §4). Preserve a valid in-range count;
  // only clamp when the saved count is out of range. Corners is fixed at 4
  // (initialMics === maxMics) so this always yields 4 there.
  const targetCount = Math.min(Math.max(sourceMics.length, initialMics), maxMics);
  const usedIds = new Set<string>();
  return Array.from({ length: targetCount }, (_, index) =>
    normalizeMic(warnings, sourceMics[index], index, usedIds),
  );
}

function normalizeOnePointers(
  rawOneMicId: unknown,
  rawOneTakeId: unknown,
  mics: PersistedMoodMic[],
  warnings: string[],
): Pick<PersistedMoodPiece, "oneMicId" | "oneTakeId"> {
  if (rawOneMicId === null && rawOneTakeId === null) {
    return { oneMicId: null, oneTakeId: null };
  }
  if (typeof rawOneMicId !== "string" || typeof rawOneTakeId !== "string") {
    warn(warnings, "Mood one-pointers were invalid and cleared.");
    return { oneMicId: null, oneTakeId: null };
  }

  const oneMic = mics.find((mic) => mic.id === rawOneMicId);
  const oneTake = oneMic?.takes.find((take) => take.id === rawOneTakeId);
  if (!oneMic || !oneTake) {
    warn(warnings, "Mood one-pointers were dangling and cleared.");
    return { oneMicId: null, oneTakeId: null };
  }
  return { oneMicId: rawOneMicId, oneTakeId: rawOneTakeId };
}

function warnMissingMoodBlobs(persisted: PersistedMoodPiece, warnings: string[]): void {
  for (const missing of persisted.missingBlobs ?? []) {
    if (missing.field === "videoBlob") {
      warn(warnings, `Take ${missing.takeId} in ${missing.micId} video was missing and was dropped.`);
    } else if (missing.field === "audioBlob") {
      warn(warnings, `Take ${missing.takeId} in ${missing.micId} audio sidecar was missing.`);
    } else if (missing.field === "posterBlob") {
      warn(warnings, `Take ${missing.takeId} in ${missing.micId} poster was missing.`);
    }
  }
}

async function trySaveMoodRecoveryBackup(
  persisted: PersistedMoodPiece,
  warnings: string[],
): Promise<boolean> {
  try {
    await moodPersistence.saveMoodRecoveryBackup(persisted);
    return true;
  } catch {
    warn(
      warnings,
      "Mood recovery backup could not be written. Saved mood was left untouched and autosave was paused.",
    );
    return false;
  }
}

function emptyResult(): MoodRehydrateEmptyResult {
  return {
    status: "empty",
    ok: false,
    degraded: false,
    piece: null,
    warnings: [],
  };
}

function okResult(piece: PersistedMoodPiece): MoodRehydrateOkResult {
  return {
    status: "ok",
    ok: true,
    degraded: false,
    piece,
    warnings: [],
  };
}

function degradedResult(
  piece: PersistedMoodPiece,
  warnings: string[],
): MoodRehydrateDegradedResult {
  return {
    status: "degraded",
    ok: true,
    degraded: true,
    piece,
    warnings,
  };
}

function failedResult(warnings: string[]): MoodRehydrateFailedResult {
  return {
    status: "failed",
    ok: false,
    degraded: true,
    piece: null,
    warnings,
  };
}

export function normalizeMoodMeta(raw: unknown, warnings: string[]): PersistedMoodPiece {
  const source = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) warn(warnings, "Mood metadata was invalid and reset.");
  if (source.moodSchemaVersion !== 1) {
    warn(warnings, "Mood schema version was invalid and reset to 1.");
  }

  const stage = normalizeEnum(warnings, "Mood stage", source.stage, MOOD_STAGES, "corners");
  const timeFeel = normalizeEnum(warnings, "Mood feel", source.timeFeel, MOOD_FEELS, "pocket");
  const mics = normalizeMics(source.mics, stage, warnings);
  const onePointers = normalizeOnePointers(source.oneMicId, source.oneTakeId, mics, warnings);

  return {
    moodSchemaVersion: 1,
    stage,
    timeFeel,
    bpm: normalizeNullablePositiveNumber(warnings, "Mood bpm", source.bpm),
    cycleBars: normalizeNullableEnum(
      warnings,
      "Mood cycleBars",
      source.cycleBars,
      MOOD_CYCLE_BARS,
      null,
    ) as MoodPiece["cycleBars"],
    cycleSeconds: normalizeNullablePositiveNumber(
      warnings,
      "Mood cycleSeconds",
      source.cycleSeconds,
    ),
    ...onePointers,
    vibe: normalizeEnum(warnings, "Mood vibe", source.vibe, MOOD_VIBES, "clean"),
    lens: normalizeEnum(warnings, "Mood lens", source.lens, MOOD_LENSES, "wall"),
    mics,
    updatedAt: normalizeUpdatedAt(source.updatedAt, warnings),
  };
}

export async function rehydrateMoodFromStorage(): Promise<MoodRehydrateResult> {
  let persisted: PersistedMoodPiece | null;
  try {
    persisted = await moodPersistence.loadMoodMeta();
  } catch (err) {
    const warnings = [
      err instanceof moodPersistence.InvalidMoodMetadataError
        ? "Saved mood metadata was invalid. Autosave was paused to avoid overwriting it."
        : "Saved mood could not be loaded. Autosave was paused to avoid overwriting it.",
    ];
    return failedResult(warnings);
  }

  if (!persisted) return emptyResult();

  const warnings: string[] = [];
  warnMissingMoodBlobs(persisted, warnings);
  const normalized = normalizeMoodMeta(persisted, warnings);
  if (warnings.length > 0) {
    const recoveryBackupWritten = await trySaveMoodRecoveryBackup(persisted, warnings);
    if (!recoveryBackupWritten) return failedResult(warnings);
    return degradedResult(normalized, warnings);
  }

  return okResult(normalized);
}
