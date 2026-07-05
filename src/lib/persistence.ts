// ABOUTME: persistence — save and rehydrate project state through a split IndexedDB layout.
// ABOUTME: Blob bytes are content-addressed; metadata stores only references and trim numbers.
import { del, get, keys, set } from "idb-keyval";
import type { AppState, CutSubdivision, Subgenre, Tag, Vibe } from "../types";

export const PERSISTED_SCHEMA_VERSION = 2;
export const PROJECT_KEY = "ha:meta";
export const PROJECT_BACKUP_KEY = "ha:meta-backup";
export const LEGACY_PROJECT_KEY = "hyperactive-amateur-project";
export const LEGACY_PROJECT_BACKUP_KEY = "hyperactive-amateur-project:recovery-backup";

const BLOB_KEY_PREFIX = "ha:blob:";

type BlobField = "clipBlob" | "audioBlob" | "posterBlob";
type PersistedStorageFormat = "schema2" | "legacy";
type TagSource = "user" | "system";
type AudioStatus = "ok" | "unavailable";

export interface MissingBlobReference {
  trackId: number;
  field: BlobField;
  ref: string;
}

export interface PersistedTrack {
  id: number;
  clipBlob: Blob | null;
  // Audio sidecar for clips recorded after live mic capture was introduced.
  // Older saves do not have it; rehydrate falls back to clipBlob audio decode.
  audioBlob?: Blob | null;
  // First-frame poster image persisted alongside the clip so reload doesn't
  // pay the regen cost. Older saves predate this field and read as undefined;
  // rehydrate falls back to regenerating from clipBlob.
  posterBlob: Blob | null;
  trimStartMs: number;
  trimEndMs: number;
  durationMs: number;
  audioStatus?: AudioStatus;
  tag: Tag | null;
  tagSource?: TagSource | null;
  tagReasoning?: string;
  steps: boolean[];
  volume: number;
  muted: boolean;
  showVideo: boolean;
}

export interface PersistedProject {
  schemaVersion?: number;
  bpm: number;
  swing: number;
  cutSubdivision: CutSubdivision;
  sameTierHoldMs: number;
  subgenre: Subgenre;
  vibe: Vibe;
  stepCount: number;
  // Per-track reasoning strings from the most recent auto-tag pass.
  // Persisted because they describe the kit, not the browser session —
  // a refresh shouldn't lose the model's notes about each clip.
  tagReasoning: Record<number, string>;
  tracks: PersistedTrack[];
  updatedAt: number;
  storageFormat?: PersistedStorageFormat;
  legacyKey?: string;
  missingBlobs?: MissingBlobReference[];
}

interface PersistedTrackV2 {
  id: number;
  steps: boolean[];
  volume: number;
  muted: boolean;
  showVideo: boolean;
  tag: Tag | null;
  tagSource: TagSource | null;
  tagReasoning?: string;
  trimStartMs: number;
  trimEndMs: number;
  durationMs: number;
  audioStatus: AudioStatus;
  clipBlobRef?: string;
  audioBlobRef?: string;
  posterBlobRef?: string;
}

interface PersistedProjectV2 {
  schemaVersion: 2;
  bpm: number;
  swing: number;
  cutSubdivision: CutSubdivision;
  sameTierHoldMs: number;
  subgenre: Subgenre;
  vibe: Vibe;
  stepCount: number;
  tagReasoning: Record<number, string>;
  tracks: PersistedTrackV2[];
  updatedAt: number;
}

interface MetadataBuildResult {
  metadata: PersistedProjectV2;
  referencedBlobKeys: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBlob(value: unknown): value is Blob {
  const maybeBlob = value as unknown as Blob;
  return (
    value instanceof Blob ||
    (isRecord(value) &&
      typeof maybeBlob.arrayBuffer === "function" &&
      typeof maybeBlob.type === "string")
  );
}

function getSubtleCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("crypto.subtle is required for persistence blob hashing");
  }
  return globalThis.crypto.subtle;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function blobKey(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const digest = await getSubtleCrypto().digest("SHA-256", new Uint8Array(bytes));
  return `${BLOB_KEY_PREFIX}${hex(digest).slice(0, 16)}`;
}

async function storableBlob(blob: Blob): Promise<Blob> {
  const headers = blob.type ? { "content-type": blob.type } : undefined;
  return new Response(new Uint8Array(await blob.arrayBuffer()), { headers }).blob();
}

async function blobReference(
  blob: unknown,
  referencedBlobKeys: Set<string>,
  writeMissingBlob: boolean,
): Promise<string | undefined> {
  if (!isBlob(blob)) return undefined;
  const key = await blobKey(blob);
  referencedBlobKeys.add(key);
  if (writeMissingBlob && (await get(key)) === undefined) {
    await set(key, await storableBlob(blob));
  }
  return key;
}

function tagSourceForTrack(state: AppState, trackId: number): TagSource | null {
  const track = state.project.tracks[trackId];
  if (!track?.tag) return null;
  return state.session.manuallyTagged.includes(trackId) ? "user" : "system";
}

export function snapshot(state: AppState): PersistedProject {
  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    bpm: state.project.bpm,
    swing: state.project.swing,
    cutSubdivision: state.project.cutSubdivision,
    sameTierHoldMs: state.project.sameTierHoldMs,
    subgenre: state.project.subgenre,
    vibe: state.project.vibe,
    stepCount: state.project.stepCount,
    tagReasoning: { ...state.project.tagReasoning },
    tracks: state.project.tracks.map((track) => ({
      id: track.id,
      clipBlob: track.clip ? track.clip.blob : null,
      audioBlob: track.clip ? (track.clip.audioBlob ?? null) : null,
      posterBlob: track.clip ? track.clip.posterBlob : null,
      trimStartMs: track.clip ? track.clip.trimStartMs : 0,
      trimEndMs: track.clip ? track.clip.trimEndMs : 0,
      durationMs: track.clip ? track.clip.durationMs : 0,
      audioStatus: track.clip ? track.clip.audioStatus : "ok",
      tag: track.tag,
      tagSource: tagSourceForTrack(state, track.id),
      tagReasoning: state.project.tagReasoning[track.id],
      steps: [...track.steps],
      volume: track.volume,
      muted: track.muted,
      showVideo: track.showVideo,
    })),
    updatedAt: Date.now(),
  };
}

async function buildMetadataRecord(
  project: PersistedProject,
  writeMissingBlobs: boolean,
): Promise<MetadataBuildResult> {
  const referencedBlobKeys = new Set<string>();
  const projectTagReasoning = isRecord(project.tagReasoning)
    ? (project.tagReasoning as Record<number, string>)
    : {};
  const rawTracks = Array.isArray(project.tracks) ? project.tracks : [];
  const tracks = await Promise.all(
    rawTracks.map(async (track): Promise<PersistedTrackV2> => {
      const clipBlobRef = await blobReference(
        track.clipBlob,
        referencedBlobKeys,
        writeMissingBlobs,
      );
      const audioBlobRef = await blobReference(
        track.audioBlob,
        referencedBlobKeys,
        writeMissingBlobs,
      );
      const posterBlobRef = await blobReference(
        track.posterBlob,
        referencedBlobKeys,
        writeMissingBlobs,
      );
      const tagReasoning = track.tagReasoning ?? projectTagReasoning[track.id];

      return {
        id: track.id,
        steps: Array.isArray(track.steps) ? [...track.steps] : [],
        volume: track.volume,
        muted: track.muted,
        showVideo: track.showVideo,
        tag: track.tag,
        tagSource: track.tagSource ?? (track.tag ? "system" : null),
        ...(tagReasoning ? { tagReasoning } : {}),
        trimStartMs: track.trimStartMs,
        trimEndMs: track.trimEndMs,
        durationMs: track.durationMs,
        audioStatus: track.audioStatus ?? "ok",
        ...(clipBlobRef ? { clipBlobRef } : {}),
        ...(audioBlobRef ? { audioBlobRef } : {}),
        ...(posterBlobRef ? { posterBlobRef } : {}),
      };
    }),
  );

  return {
    metadata: {
      schemaVersion: PERSISTED_SCHEMA_VERSION,
      bpm: project.bpm,
      swing: project.swing,
      cutSubdivision: project.cutSubdivision,
      sameTierHoldMs: project.sameTierHoldMs,
      subgenre: project.subgenre,
      vibe: project.vibe,
      stepCount: project.stepCount,
      tagReasoning: { ...projectTagReasoning },
      tracks,
      updatedAt: project.updatedAt,
    },
    referencedBlobKeys,
  };
}

async function deleteOrphanedBlobRecords(referencedBlobKeys: Set<string>): Promise<void> {
  const allKeys = await keys();
  await Promise.all(
    allKeys
      .filter(
        (key): key is string =>
          typeof key === "string" &&
          key.startsWith(BLOB_KEY_PREFIX) &&
          !referencedBlobKeys.has(key),
      )
      .map((key) => del(key)),
  );
}

export async function saveProject(state: AppState): Promise<void> {
  const persisted = snapshot(state);
  const { metadata, referencedBlobKeys } = await buildMetadataRecord(persisted, true);
  await set(PROJECT_KEY, metadata);
  await deleteOrphanedBlobRecords(referencedBlobKeys);
}

function tagLegacyProject(value: Record<string, unknown>, legacyKey: string): PersistedProject {
  return {
    ...(value as unknown as PersistedProject),
    storageFormat: "legacy",
    legacyKey,
  };
}

async function resolveBlobReference(
  ref: string | undefined,
  trackId: number,
  field: BlobField,
  missingBlobs: MissingBlobReference[],
): Promise<Blob | null> {
  if (!ref) return null;
  const value = await get(ref);
  if (isBlob(value)) return value;
  missingBlobs.push({ trackId, field, ref });
  return null;
}

function tagReasoningFromTracks(tracks: PersistedTrackV2[]): Record<number, string> {
  return Object.fromEntries(
    tracks
      .filter((track) => typeof track.tagReasoning === "string" && track.tagReasoning.length > 0)
      .map((track) => [track.id, track.tagReasoning as string]),
  );
}

async function resolveMetadataRecord(metadata: PersistedProjectV2): Promise<PersistedProject> {
  const missingBlobs: MissingBlobReference[] = [];
  const tracks = await Promise.all(
    metadata.tracks.map(async (track): Promise<PersistedTrack> => ({
      id: track.id,
      clipBlob: await resolveBlobReference(
        track.clipBlobRef,
        track.id,
        "clipBlob",
        missingBlobs,
      ),
      audioBlob: await resolveBlobReference(
        track.audioBlobRef,
        track.id,
        "audioBlob",
        missingBlobs,
      ),
      posterBlob: await resolveBlobReference(
        track.posterBlobRef,
        track.id,
        "posterBlob",
        missingBlobs,
      ),
      trimStartMs: track.trimStartMs,
      trimEndMs: track.trimEndMs,
      durationMs: track.durationMs,
      audioStatus: track.audioStatus,
      tag: track.tag,
      tagSource: track.tagSource,
      tagReasoning: track.tagReasoning,
      steps: [...track.steps],
      volume: track.volume,
      muted: track.muted,
      showVideo: track.showVideo,
    })),
  );

  return {
    schemaVersion: PERSISTED_SCHEMA_VERSION,
    bpm: metadata.bpm,
    swing: metadata.swing,
    cutSubdivision: metadata.cutSubdivision,
    sameTierHoldMs: metadata.sameTierHoldMs,
    subgenre: metadata.subgenre,
    vibe: metadata.vibe,
    stepCount: metadata.stepCount,
    tagReasoning: { ...tagReasoningFromTracks(metadata.tracks), ...metadata.tagReasoning },
    tracks,
    updatedAt: metadata.updatedAt,
    storageFormat: "schema2",
    ...(missingBlobs.length > 0 ? { missingBlobs } : {}),
  };
}

function isSchema2Metadata(value: unknown): value is PersistedProjectV2 {
  return (
    isRecord(value) &&
    value.schemaVersion === PERSISTED_SCHEMA_VERSION &&
    Array.isArray(value.tracks)
  );
}

export async function loadProject(): Promise<PersistedProject | null> {
  const metadata = await get(PROJECT_KEY);
  if (isRecord(metadata)) {
    if (isSchema2Metadata(metadata)) {
      return resolveMetadataRecord(metadata);
    }
    return tagLegacyProject(metadata, PROJECT_KEY);
  }

  const legacy = await get(LEGACY_PROJECT_KEY);
  if (isRecord(legacy)) {
    return tagLegacyProject(legacy, LEGACY_PROJECT_KEY);
  }

  return null;
}

export async function saveRecoveryBackup(project: PersistedProject): Promise<void> {
  const { metadata } = await buildMetadataRecord(project, false);
  await set(PROJECT_BACKUP_KEY, metadata);
}

export async function loadRecoveryBackup(): Promise<unknown | null> {
  return (await get(PROJECT_BACKUP_KEY)) ?? null;
}

export async function clearProject(): Promise<void> {
  await Promise.all([
    del(PROJECT_KEY),
    del(PROJECT_BACKUP_KEY),
    del(LEGACY_PROJECT_KEY),
    del(LEGACY_PROJECT_BACKUP_KEY),
  ]);
  const allKeys = await keys();
  await Promise.all(
    allKeys
      .filter((key): key is string => typeof key === "string" && key.startsWith(BLOB_KEY_PREFIX))
      .map((key) => del(key)),
  );
}
