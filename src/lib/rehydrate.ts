// ABOUTME: rehydrate — load, validate, decode, and dispatch persisted project state.
// ABOUTME: Object URLs are recreated on every load (not persisted); degraded loads keep one backup.
import {
  InvalidMetadataError,
  loadProject,
  migrateLegacyProject,
  PERSISTED_SCHEMA_VERSION,
  saveRecoveryBackup,
  type PersistedProject,
  type PersistedTrack,
} from "./persistence";
import { getAudioContext } from "./audio";
import { useAppStore } from "../store/useAppStore";
import { TAGS, type AppState, type Clip, type CutSubdivision, type Subgenre, type Tag, type Track, type Vibe } from "../types";
import {
  createInitialState,
  DEFAULT_STEP_COUNT,
  MAX_STEP_COUNT,
  MIN_STEP_COUNT,
  STEP_COUNT_INCREMENT,
} from "../store/initialState";
import { captureFirstFrame } from "./posterFrame";

export interface RehydrateResult {
  ok: boolean;
  degraded: boolean;
  warnings: string[];
}

const TRACK_COUNT = 8;
const CUT_SUBDIVISIONS: CutSubdivision[] = ["16n", "8n", "4n", "2n", "1m"];
const SUBGENRES: Subgenre[] = ["boom-bap", "trap", "lo-fi", "phonk"];
const VIBES: Vibe[] = ["tight", "varied", "breaky"];

function cleanResult(ok: boolean): RehydrateResult {
  return { ok, degraded: false, warnings: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBlob(value: unknown): value is Blob {
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  return (
    isRecord(value) &&
    typeof value.arrayBuffer === "function" &&
    typeof value.size === "number" &&
    typeof value.type === "string"
  );
}

function warn(warnings: string[], message: string): void {
  warnings.push(message);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeNumber(
  warnings: string[],
  name: string,
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = finiteNumber(value);
  if (n === null) {
    warn(warnings, `${name} was invalid and reset to ${fallback}.`);
    return fallback;
  }
  const clamped = Math.max(min, Math.min(max, n));
  if (clamped !== n) warn(warnings, `${name} was clamped to ${clamped}.`);
  return clamped;
}

function normalizeEnum<T extends string>(
  warnings: string[],
  name: string,
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof value === "string" && allowed.includes(value as T)) return value as T;
  if (value !== undefined) warn(warnings, `${name} was invalid and reset to ${fallback}.`);
  return fallback;
}

function normalizeStepCount(warnings: string[], value: unknown): number {
  const n = finiteNumber(value);
  if (n === null) {
    warn(warnings, `stepCount was invalid and reset to ${DEFAULT_STEP_COUNT}.`);
    return DEFAULT_STEP_COUNT;
  }
  const rounded = Math.round(n);
  const clamped = Math.max(MIN_STEP_COUNT, Math.min(MAX_STEP_COUNT, rounded));
  const aligned = Math.max(
    MIN_STEP_COUNT,
    Math.min(MAX_STEP_COUNT, Math.round(clamped / STEP_COUNT_INCREMENT) * STEP_COUNT_INCREMENT),
  );
  if (aligned !== n) warn(warnings, `stepCount was normalized to ${aligned}.`);
  return aligned;
}

function normalizeSteps(warnings: string[], trackId: number, value: unknown, stepCount: number): boolean[] {
  let invalidEntries = 0;
  const steps = Array.isArray(value)
    ? value.map((entry) => {
        if (typeof entry === "boolean") return entry;
        invalidEntries += 1;
        return false;
      })
    : [];
  if (!Array.isArray(value)) {
    warn(warnings, `Track ${trackId + 1} steps were invalid and reset.`);
  }
  if (invalidEntries > 0) {
    warn(warnings, `Track ${trackId + 1} steps had invalid entries and were normalized.`);
  }
  if (steps.length !== stepCount) {
    warn(warnings, `Track ${trackId + 1} steps were resized to ${stepCount}.`);
  }
  if (steps.length < stepCount) {
    steps.push(...new Array(stepCount - steps.length).fill(false));
  } else if (steps.length > stepCount) {
    steps.length = stepCount;
  }
  return steps;
}

function normalizeTag(warnings: string[], trackId: number, value: unknown): PersistedTrack["tag"] {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && TAGS.includes(value as Tag)) {
    return value as Tag;
  }
  warn(warnings, `Track ${trackId + 1} tag was invalid and cleared.`);
  return null;
}

function emptyPersistedTrack(id: number, stepCount: number): PersistedTrack {
  return {
    id,
    clipBlob: null,
    audioBlob: null,
    posterBlob: null,
    trimStartMs: 0,
    trimEndMs: 0,
    durationMs: 0,
    audioStatus: "ok",
    tag: null,
    steps: new Array(stepCount).fill(false),
    volume: 1,
    muted: false,
    mutedByRepair: false,
    showVideo: true,
  };
}

function normalizeClipFields(
  warnings: string[],
  trackId: number,
  raw: Record<string, unknown>,
): Pick<
  PersistedTrack,
  | "clipBlob"
  | "audioBlob"
  | "posterBlob"
  | "trimStartMs"
  | "trimEndMs"
  | "durationMs"
  | "audioStatus"
> {
  const audioStatus = raw.audioStatus === "unavailable" ? "unavailable" : "ok";
  if (raw.clipBlob === null || raw.clipBlob === undefined) {
    return {
      clipBlob: null,
      audioBlob: null,
      posterBlob: null,
      trimStartMs: 0,
      trimEndMs: 0,
      durationMs: 0,
      audioStatus: "ok",
    };
  }
  if (!isBlob(raw.clipBlob)) {
    warn(warnings, `Track ${trackId + 1} clip blob was invalid and dropped.`);
    return {
      clipBlob: null,
      audioBlob: null,
      posterBlob: null,
      trimStartMs: 0,
      trimEndMs: 0,
      durationMs: 0,
      audioStatus: "ok",
    };
  }

  const durationMs = finiteNumber(raw.durationMs);
  if (durationMs === null || durationMs <= 0) {
    warn(warnings, `Track ${trackId + 1} duration was invalid and its clip was dropped.`);
    return {
      clipBlob: null,
      audioBlob: null,
      posterBlob: null,
      trimStartMs: 0,
      trimEndMs: 0,
      durationMs: 0,
      audioStatus: "ok",
    };
  }

  const startRaw = finiteNumber(raw.trimStartMs) ?? 0;
  const endRaw = finiteNumber(raw.trimEndMs) ?? durationMs;
  const trimStartMs = Math.max(0, Math.min(durationMs, startRaw));
  const trimEndMs = Math.max(0, Math.min(durationMs, endRaw));
  if (trimStartMs !== startRaw || trimEndMs !== endRaw) {
    warn(warnings, `Track ${trackId + 1} trim window was clamped.`);
  }
  if (trimEndMs <= trimStartMs) {
    warn(warnings, `Track ${trackId + 1} trim window was invalid and its clip was dropped.`);
    return {
      clipBlob: null,
      audioBlob: null,
      posterBlob: null,
      trimStartMs: 0,
      trimEndMs: 0,
      durationMs: 0,
      audioStatus: "ok",
    };
  }

  return {
    clipBlob: raw.clipBlob,
    audioBlob: isBlob(raw.audioBlob) ? raw.audioBlob : null,
    posterBlob: isBlob(raw.posterBlob) ? raw.posterBlob : null,
    trimStartMs,
    trimEndMs,
    durationMs,
    audioStatus,
  };
}

function normalizeTrack(
  warnings: string[],
  rawTrack: unknown,
  trackId: number,
  stepCount: number,
): PersistedTrack {
  if (!isRecord(rawTrack)) {
    warn(warnings, `Track ${trackId + 1} was missing and reset.`);
    return emptyPersistedTrack(trackId, stepCount);
  }
  if (rawTrack.id !== undefined && rawTrack.id !== trackId) {
    warn(warnings, `Track ${trackId + 1} id was normalized.`);
  }
  const clip = normalizeClipFields(warnings, trackId, rawTrack);
  const tag = clip.clipBlob ? normalizeTag(warnings, trackId, rawTrack.tag) : null;
  return {
    id: trackId,
    ...clip,
    tag,
    // Manual tag ownership recorded at save time survives the reload so a
    // post-reload auto-tag pass keeps skipping user-tagged tracks.
    tagSource:
      tag && (rawTrack.tagSource === "user" || rawTrack.tagSource === "system")
        ? rawTrack.tagSource
        : null,
    steps: normalizeSteps(warnings, trackId, rawTrack.steps, stepCount),
    volume: normalizeNumber(warnings, `Track ${trackId + 1} volume`, rawTrack.volume, 0, 1, 1),
    muted: typeof rawTrack.muted === "boolean" ? rawTrack.muted : false,
    mutedByRepair: typeof rawTrack.mutedByRepair === "boolean" ? rawTrack.mutedByRepair : false,
    showVideo: typeof rawTrack.showVideo === "boolean" ? rawTrack.showVideo : true,
  };
}

function normalizeTagReasoning(
  warnings: string[],
  value: unknown,
  tracks: PersistedTrack[],
): Record<number, string> {
  if (!isRecord(value)) {
    if (value !== undefined) warn(warnings, "Tag reasoning was invalid and reset.");
    return {};
  }
  const withClips = new Set(tracks.filter((track) => track.clipBlob).map((track) => track.id));
  const out: Record<number, string> = {};
  for (const [key, reasoning] of Object.entries(value)) {
    const id = Number(key);
    if (Number.isInteger(id) && id >= 0 && id < TRACK_COUNT && withClips.has(id) && typeof reasoning === "string") {
      out[id] = reasoning;
    } else {
      warn(warnings, "Dropped invalid tag reasoning entry.");
    }
  }
  return out;
}

function normalizeProject(persisted: PersistedProject, warnings: string[]): PersistedProject {
  const schemaVersion =
    persisted.schemaVersion === undefined ? 0 : finiteNumber(persisted.schemaVersion);
  if (schemaVersion !== PERSISTED_SCHEMA_VERSION) {
    const versionLabel = schemaVersion === null ? "invalid" : schemaVersion;
    warn(warnings, `Schema version ${versionLabel} was migrated to ${PERSISTED_SCHEMA_VERSION}.`);
  }
  const empty = createInitialState().project;
  const stepCount = normalizeStepCount(warnings, persisted.stepCount);
  const rawTracks = Array.isArray(persisted.tracks) ? persisted.tracks : [];
  if (!Array.isArray(persisted.tracks)) {
    warn(warnings, "Persisted tracks were invalid and reset.");
  } else if (persisted.tracks.length !== TRACK_COUNT) {
    warn(warnings, `Track count was normalized to ${TRACK_COUNT}.`);
  }

  const tracks = Array.from({ length: TRACK_COUNT }, (_, id) => {
    const byId = rawTracks.find((track) => isRecord(track) && track.id === id);
    return normalizeTrack(warnings, byId ?? rawTracks[id], id, stepCount);
  });

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    bpm: normalizeNumber(warnings, "bpm", persisted.bpm, 60, 180, empty.bpm),
    swing: normalizeNumber(warnings, "swing", persisted.swing, 0, 1, empty.swing),
    cutSubdivision: normalizeEnum(warnings, "cutSubdivision", persisted.cutSubdivision, CUT_SUBDIVISIONS, empty.cutSubdivision),
    sameTierHoldMs: normalizeNumber(warnings, "sameTierHoldMs", persisted.sameTierHoldMs, 0, 2000, empty.sameTierHoldMs),
    subgenre: normalizeEnum(warnings, "subgenre", persisted.subgenre, SUBGENRES, empty.subgenre),
    vibe: normalizeEnum(warnings, "vibe", persisted.vibe, VIBES, empty.vibe),
    stepCount,
    tagReasoning: normalizeTagReasoning(warnings, persisted.tagReasoning, tracks),
    tracks,
    updatedAt: finiteNumber(persisted.updatedAt) ?? Date.now(),
  };
}

function audioUnavailableWarning(trackId: number): string {
  return `Track ${trackId + 1} audio unavailable — re-record to restore sound.`;
}

function warnAudioUnavailable(warnings: string[], trackId: number): void {
  const message = audioUnavailableWarning(trackId);
  if (!warnings.includes(message)) warn(warnings, message);
}

function collectAudioRepairTrackIds(
  persisted: PersistedProject,
  warnings: string[],
): Set<number> {
  const trackIds = new Set<number>();
  for (const missing of persisted.missingBlobs ?? []) {
    if (Number.isInteger(missing.trackId) && missing.trackId >= 0) {
      if (missing.field === "audioBlob") {
        trackIds.add(missing.trackId);
      } else if (missing.field === "clipBlob") {
        warn(warnings, `Track ${missing.trackId + 1} clip video was missing and was dropped.`);
      } else if (missing.field === "posterBlob") {
        warn(warnings, `Track ${missing.trackId + 1} poster was missing and regenerated.`);
      }
    }
  }
  for (const trackId of Array.from(trackIds).sort((a, b) => a - b)) {
    warnAudioUnavailable(warnings, trackId);
  }
  return trackIds;
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  // Fallback: rehydrate a plain Blob-shaped value (e.g., from fake-indexeddb)
  // back through the Response API.
  return new Response(blob).arrayBuffer();
}

async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const buffer = await blobToArrayBuffer(blob);
  return getAudioContext().decodeAudioData(buffer.slice(0));
}

async function decodeClipAudio(clipBlob: Blob, audioBlob?: Blob | null): Promise<AudioBuffer> {
  if (audioBlob) {
    try {
      return await decodeBlob(audioBlob);
    } catch {
      // Fall through to legacy mixed-container decode below.
    }
  }
  return decodeBlob(clipBlob);
}

async function restorePosterBlob(clipBlob: Blob, posterBlob: Blob | null): Promise<Blob | null> {
  if (posterBlob) return posterBlob;
  try {
    return await captureFirstFrame(clipBlob);
  } catch {
    return null;
  }
}

async function rehydrateClip(
  track: PersistedTrack,
  clipBlob: Blob,
  audioBuffer: AudioBuffer | null,
  audioStatus: Clip["audioStatus"],
): Promise<Clip> {
  const posterBlob = await restorePosterBlob(clipBlob, track.posterBlob ?? null);
  return {
    blob: clipBlob,
    url: URL.createObjectURL(clipBlob),
    audioBuffer,
    audioStatus,
    audioBlob: audioStatus === "ok" ? (track.audioBlob ?? null) : null,
    trimStartMs: track.trimStartMs,
    trimEndMs: track.trimEndMs,
    durationMs: track.durationMs,
    posterBlob,
    posterUrl: posterBlob ? URL.createObjectURL(posterBlob) : null,
  };
}

async function trySaveRecoveryBackup(
  persisted: PersistedProject,
  warnings: string[],
): Promise<boolean> {
  try {
    await saveRecoveryBackup(persisted);
    return true;
  } catch {
    warn(
      warnings,
      "Recovery backup could not be written. Saved project was left untouched and autosave was paused.",
    );
    return false;
  }
}

function revokeRecoveredClipUrls(tracks: Track[]): void {
  for (const track of tracks) {
    if (track.clip?.url) URL.revokeObjectURL(track.clip.url);
    if (track.clip?.posterUrl) URL.revokeObjectURL(track.clip.posterUrl);
  }
}

export async function rehydrateFromStorage(): Promise<RehydrateResult> {
  let persisted: Awaited<ReturnType<typeof loadProject>>;
  try {
    persisted = await loadProject();
  } catch (err) {
    // Invalid current metadata is its own failure, not a legacy migration
    // candidate: the record and the last good backup stay untouched.
    const warnings = [
      err instanceof InvalidMetadataError
        ? "Saved project metadata was invalid. Autosave was paused to avoid overwriting it."
        : "Saved project could not be loaded. Autosave was paused to avoid overwriting it.",
    ];
    useAppStore.getState().actions.setRecoveryWarnings(warnings);
    return { ok: false, degraded: true, warnings };
  }
  if (!persisted) return cleanResult(false);

  const empty = createInitialState();
  const warnings: string[] = [];
  const normalized = normalizeProject(persisted, warnings);
  const audioRepairTrackIds = collectAudioRepairTrackIds(persisted, warnings);
  let recoveryBackupWritten = false;
  if (warnings.length > 0 || persisted.storageFormat === "legacy") {
    recoveryBackupWritten = await trySaveRecoveryBackup(persisted, warnings);
    if (!recoveryBackupWritten) {
      useAppStore.getState().actions.setRecoveryWarnings(warnings);
      return { ok: false, degraded: true, warnings };
    }
  }
  if (persisted.storageFormat === "legacy") {
    try {
      await migrateLegacyProject(normalized);
    } catch {
      warn(
        warnings,
        "Saved project could not be migrated. Autosave was paused to avoid overwriting it.",
      );
      useAppStore.getState().actions.setRecoveryWarnings(warnings);
      return { ok: false, degraded: true, warnings };
    }
  }

  const tracks: Track[] = await Promise.all(
    normalized.tracks.map(async (pt): Promise<Track> => {
      let clip: Clip | null = null;
      if (pt.clipBlob) {
        if (pt.audioStatus === "unavailable" || audioRepairTrackIds.has(pt.id)) {
          warnAudioUnavailable(warnings, pt.id);
          clip = await rehydrateClip(pt, pt.clipBlob, null, "unavailable");
        } else {
          try {
            const audioBuffer = await decodeClipAudio(pt.clipBlob, pt.audioBlob);
            clip = await rehydrateClip(pt, pt.clipBlob, audioBuffer, "ok");
          } catch {
            warnAudioUnavailable(warnings, pt.id);
            clip = await rehydrateClip(pt, pt.clipBlob, null, "unavailable");
          }
        }
      }
      const audioUnavailable = clip?.audioStatus === "unavailable";
      const wasMutedByRepair = pt.mutedByRepair ?? false;
      return {
        id: pt.id,
        clip,
        blobRevision: 0,
        steps: [...pt.steps],
        volume: pt.volume,
        muted: audioUnavailable ? true : pt.muted,
        // The repair owns the mute when it flipped it on; a mute the user
        // already held (or re-applied after a repair) stays user-owned.
        mutedByRepair: audioUnavailable
          ? (pt.muted ? wasMutedByRepair : true)
          : wasMutedByRepair,
        tag: clip ? pt.tag : null,
        showVideo: pt.showVideo,
      };
    }),
  );
  const tagReasoning = { ...normalized.tagReasoning };
  for (const track of tracks) {
    if (!track.clip && track.id in tagReasoning) delete tagReasoning[track.id];
  }

  if (warnings.length > 0 && !recoveryBackupWritten) {
    recoveryBackupWritten = await trySaveRecoveryBackup(persisted, warnings);
    if (!recoveryBackupWritten) {
      revokeRecoveredClipUrls(tracks);
      useAppStore.getState().actions.setRecoveryWarnings(warnings);
      return { ok: false, degraded: true, warnings };
    }
  }

  const project: AppState["project"] = {
    bpm: normalized.bpm,
    swing: normalized.swing,
    cutSubdivision: normalized.cutSubdivision,
    sameTierHoldMs: normalized.sameTierHoldMs,
    subgenre: normalized.subgenre,
    vibe: normalized.vibe,
    stepCount: normalized.stepCount,
    tagReasoning,
    tracks: tracks.length === 8 ? tracks : empty.project.tracks,
  };
  const manuallyTagged = tracks
    .filter(
      (track) => track.tag !== null && normalized.tracks[track.id]?.tagSource === "user",
    )
    .map((track) => track.id);
  useAppStore.getState().actions.hydrateProject(project, manuallyTagged);
  useAppStore.getState().actions.setRecoveryWarnings(warnings);
  return { ok: true, degraded: warnings.length > 0, warnings };
}
