// ABOUTME: persistence — save and rehydrate project state through a split IndexedDB layout.
// ABOUTME: Blob bytes are content-addressed; metadata stores only references and trim numbers.
import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";
import type { AppState, CutSubdivision, Subgenre, Tag, Vibe } from "../types";

export const PERSISTED_SCHEMA_VERSION = 2;
export const PROJECT_KEY = "ha:meta";
export const PROJECT_BACKUP_KEY = "ha:meta-backup";
// An unreadable ha:meta is moved here (never rewritten in place) so the app
// can start fresh and keep saving; blob GC is held while the record exists.
export const PROJECT_QUARANTINE_KEY = "ha:meta-quarantine";
export const LEGACY_PROJECT_KEY = "hyperactive-amateur-project";
export const LEGACY_PROJECT_BACKUP_KEY = "hyperactive-amateur-project:recovery-backup";

export const BLOB_KEY_PREFIX = "ha:blob:";
const MOOD_KEY_FOR_GC = "ha:mood-meta";
const MOOD_BACKUP_KEY_FOR_GC = "ha:mood-meta-backup";
const MOOD_QUARANTINE_KEY_FOR_GC = "ha:mood-meta-quarantine";
const MOOD_SCHEMA_VERSION_FOR_GC = 1;

// idb-keyval's default database and store names, kept so existing projects
// stay readable. The store is created here rather than left to idb-keyval's
// module singleton because idb-keyval caches a *rejected* open forever; a
// load retry after WebKit's "Connection to Indexed Database server lost"
// needs a fresh open, which resetPersistenceStore() provides.
const DB_NAME = "keyval-store";
const STORE_NAME = "keyval";
let store: UseStore = createStore(DB_NAME, STORE_NAME);

export function resetPersistenceStore(): void {
  store = createStore(DB_NAME, STORE_NAME);
}

// The current store for the other persisted records sharing this database
// (Mood's metadata), so a reset reopens them too.
export function persistenceStore(): UseStore {
  return store;
}

type BlobField = "clipBlob" | "audioBlob" | "posterBlob";
type PersistedStorageFormat = "schema2" | "legacy";
type TagSource = "user" | "system";
type AudioStatus = "ok" | "unavailable";

export interface MissingBlobReference {
  trackId: number;
  field: BlobField;
  ref: string;
}

// Thrown when ha:meta exists but is not valid schema-2 metadata. Only the
// legacy monolith key may enter the migration path; an invalid current record
// must surface as its own failure so the backup and metadata stay untouched.
export class InvalidMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMetadataError";
  }
}

export interface PersistedTrack {
  id: number;
  blobRevision?: number;
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
  // True when `muted` was applied by the audio-repair path rather than the
  // user. Older saves predate this field and read as undefined (false).
  mutedByRepair?: boolean;
  showVideo: boolean;
  // Drum-kit voice id (drumKit.ts); absent means the position default.
  voice?: string;
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
  // Optional because schema-2 records written before repair-mute marking
  // lack it; new writes always include it.
  mutedByRepair?: boolean;
  showVideo: boolean;
  // Optional: absent means the position's default drum voice.
  voice?: string;
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
  blobReferences: Map<number, TrackBlobReferenceCache>;
}

interface CachedBlobReference {
  blob: Blob;
  ref: string;
}

type TrackBlobReferenceCache = { blobRevision: number } & Partial<
  Record<BlobField, CachedBlobReference>
>;

const blobReferenceCache = new Map<number, TrackBlobReferenceCache>();

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isBlob(value: unknown): value is Blob {
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  return (
    isRecord(value) &&
    typeof value.arrayBuffer === "function" &&
    typeof value.size === "number" &&
    typeof value.type === "string"
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

export async function storeContentAddressedBlob(
  blob: Blob,
  writeMissingBlob: boolean,
): Promise<string> {
  const key = await blobKey(blob);
  if (writeMissingBlob && (await get(key, store)) === undefined) {
    await set(key, await storableBlob(blob), store);
  }
  return key;
}

export async function loadContentAddressedBlob(ref: string): Promise<Blob | null> {
  const value = await get(ref, store);
  return isBlob(value) ? value : null;
}

function cachedBlobReference(
  track: PersistedTrack,
  field: BlobField,
  blob: Blob,
): string | undefined {
  const cachedTrack = blobReferenceCache.get(track.id);
  const cached = cachedTrack?.[field];
  if (!cached) return undefined;
  const blobRevision = track.blobRevision ?? 0;
  if (cachedTrack.blobRevision === blobRevision || cached.blob === blob) return cached.ref;
  return undefined;
}

function hasBlobReferences(cache: TrackBlobReferenceCache): boolean {
  return Boolean(cache.clipBlob || cache.audioBlob || cache.posterBlob);
}

function commitBlobReferenceCache(nextCache: Map<number, TrackBlobReferenceCache>): void {
  blobReferenceCache.clear();
  for (const [trackId, cache] of nextCache) {
    blobReferenceCache.set(trackId, cache);
  }
}

async function blobReference(
  track: PersistedTrack,
  field: BlobField,
  referencedBlobKeys: Set<string>,
  writeMissingBlob: boolean,
  nextTrackCache: TrackBlobReferenceCache,
): Promise<string | undefined> {
  const blob = track[field];
  if (!isBlob(blob)) return undefined;
  const cached = cachedBlobReference(track, field, blob);
  if (cached) {
    referencedBlobKeys.add(cached);
    nextTrackCache[field] = { blob, ref: cached };
    return cached;
  }
  const key = await storeContentAddressedBlob(blob, writeMissingBlob);
  referencedBlobKeys.add(key);
  nextTrackCache[field] = { blob, ref: key };
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
      blobRevision: track.blobRevision ?? 0,
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
      mutedByRepair: track.mutedByRepair ?? false,
      showVideo: track.showVideo,
      ...(track.voice ? { voice: track.voice } : {}),
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
  const blobReferences = new Map<number, TrackBlobReferenceCache>();
  const tracks = await Promise.all(
    rawTracks.map(async (track): Promise<PersistedTrackV2> => {
      const nextTrackCache: TrackBlobReferenceCache = {
        blobRevision: track.blobRevision ?? 0,
      };
      const clipBlobRef = await blobReference(
        track,
        "clipBlob",
        referencedBlobKeys,
        writeMissingBlobs,
        nextTrackCache,
      );
      const audioBlobRef = await blobReference(
        track,
        "audioBlob",
        referencedBlobKeys,
        writeMissingBlobs,
        nextTrackCache,
      );
      const posterBlobRef = await blobReference(
        track,
        "posterBlob",
        referencedBlobKeys,
        writeMissingBlobs,
        nextTrackCache,
      );
      if (hasBlobReferences(nextTrackCache)) {
        blobReferences.set(track.id, nextTrackCache);
      }
      const tagReasoning = track.tagReasoning ?? projectTagReasoning[track.id];

      return {
        id: track.id,
        steps: Array.isArray(track.steps) ? [...track.steps] : [],
        volume: track.volume,
        muted: track.muted,
        mutedByRepair: track.mutedByRepair ?? false,
        showVideo: track.showVideo,
        ...(track.voice ? { voice: track.voice } : {}),
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
    blobReferences,
  };
}

// Each collector returns false when a present record cannot be enumerated:
// a newer schema, or a list, entry or ref that is not the shape this build
// writes. Such a record could name any blob.
type BlobRefCollector = (record: unknown, refs: Set<string>) => boolean;

function collectRefFields(entry: unknown, fields: readonly string[], refs: Set<string>): boolean {
  if (!isRecord(entry)) return false;
  for (const field of fields) {
    const ref = entry[field];
    if (ref === undefined) continue;
    if (typeof ref !== "string") return false;
    if (ref.startsWith(BLOB_KEY_PREFIX)) refs.add(ref);
  }
  return true;
}

function isNewerSchema(version: unknown, knownVersion: number): boolean {
  return typeof version === "number" && version > knownVersion;
}

const CHOP_REF_FIELDS = ["clipBlobRef", "audioBlobRef", "posterBlobRef"] as const;
const MOOD_REF_FIELDS = ["videoBlobRef", "audioBlobRef", "posterBlobRef"] as const;

function collectChopBlobRefs(metadata: unknown, refs: Set<string>): boolean {
  if (!isRecord(metadata) || !Array.isArray(metadata.tracks)) return false;
  if (isNewerSchema(metadata.schemaVersion, PERSISTED_SCHEMA_VERSION)) return false;
  return metadata.tracks.every((track) => collectRefFields(track, CHOP_REF_FIELDS, refs));
}

function collectMoodBlobRefs(metadata: unknown, refs: Set<string>): boolean {
  if (!isRecord(metadata) || !Array.isArray(metadata.mics)) return false;
  if (isNewerSchema(metadata.moodSchemaVersion, MOOD_SCHEMA_VERSION_FOR_GC)) return false;
  return metadata.mics.every(
    (mic) =>
      isRecord(mic) &&
      Array.isArray(mic.takes) &&
      mic.takes.every((take) => collectRefFields(take, MOOD_REF_FIELDS, refs)),
  );
}

interface BlobGcOptions {
  excludeKeys?: Iterable<string>;
}

// Null means GC is held: a present record that cannot be enumerated could
// name any blob.
async function collectStoredBlobRoots(
  referencedBlobKeys: Set<string>,
  options: BlobGcOptions = {},
): Promise<Set<string> | null> {
  // Both live metadata records, both recovery backups and both quarantines
  // are GC roots. A save from either mode must not be able to collect the
  // other mode's blobs, including a record that mode has not loaded yet.
  const rootedBlobKeys = new Set(referencedBlobKeys);
  const excluded = new Set(options.excludeKeys ?? []);
  const rootRecords: Array<[string, BlobRefCollector]> = [
    [PROJECT_KEY, collectChopBlobRefs],
    [PROJECT_BACKUP_KEY, collectChopBlobRefs],
    [PROJECT_QUARANTINE_KEY, collectChopBlobRefs],
    [MOOD_KEY_FOR_GC, collectMoodBlobRefs],
    [MOOD_BACKUP_KEY_FOR_GC, collectMoodBlobRefs],
    [MOOD_QUARANTINE_KEY_FOR_GC, collectMoodBlobRefs],
  ];

  for (const [key, collectRefs] of rootRecords) {
    if (excluded.has(key)) continue;
    const record = await get(key, store);
    if (record === undefined) continue;
    if (!collectRefs(record, rootedBlobKeys)) return null;
  }

  return rootedBlobKeys;
}

export async function deleteOrphanedBlobRecords(
  referencedBlobKeys: Set<string>,
  options: BlobGcOptions = {},
): Promise<void> {
  const rootedBlobKeys = await collectStoredBlobRoots(referencedBlobKeys, options);
  if (!rootedBlobKeys) return;
  const allKeys = await keys(store);
  await Promise.all(
    allKeys
      .filter(
        (key): key is string =>
          typeof key === "string" &&
          key.startsWith(BLOB_KEY_PREFIX) &&
          !rootedBlobKeys.has(key),
      )
      .map((key) => del(key, store)),
  );
}

export async function saveProject(state: AppState): Promise<void> {
  const persisted = snapshot(state);
  const { metadata, referencedBlobKeys, blobReferences } = await buildMetadataRecord(
    persisted,
    true,
  );
  await set(PROJECT_KEY, metadata, store);
  commitBlobReferenceCache(blobReferences);
  await deleteOrphanedBlobRecords(referencedBlobKeys);
}

export async function migrateLegacyProject(project: PersistedProject): Promise<void> {
  const { metadata, referencedBlobKeys, blobReferences } = await buildMetadataRecord(project, true);
  await set(PROJECT_KEY, metadata, store);
  commitBlobReferenceCache(blobReferences);
  const legacyKeys = new Set<string>([LEGACY_PROJECT_KEY, LEGACY_PROJECT_BACKUP_KEY]);
  if (project.legacyKey && project.legacyKey !== PROJECT_KEY) {
    legacyKeys.add(project.legacyKey);
  }
  await Promise.all(Array.from(legacyKeys, (key) => del(key, store)));
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
  const value = await get(ref, store);
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
  const blobReferences = new Map<number, TrackBlobReferenceCache>();
  const tracks = await Promise.all(
    metadata.tracks.map(async (track): Promise<PersistedTrack> => {
      const clipBlob = await resolveBlobReference(
        track.clipBlobRef,
        track.id,
        "clipBlob",
        missingBlobs,
      );
      const audioBlob = await resolveBlobReference(
        track.audioBlobRef,
        track.id,
        "audioBlob",
        missingBlobs,
      );
      const posterBlob = await resolveBlobReference(
        track.posterBlobRef,
        track.id,
        "posterBlob",
        missingBlobs,
      );
      const nextTrackCache: TrackBlobReferenceCache = { blobRevision: 0 };
      const refs: Record<BlobField, string | undefined> = {
        clipBlob: track.clipBlobRef,
        audioBlob: track.audioBlobRef,
        posterBlob: track.posterBlobRef,
      };
      for (const field of ["clipBlob", "audioBlob", "posterBlob"] as const) {
        const blob = { clipBlob, audioBlob, posterBlob }[field];
        const ref = refs[field];
        if (blob && ref) nextTrackCache[field] = { blob, ref };
      }
      if (hasBlobReferences(nextTrackCache)) {
        blobReferences.set(track.id, nextTrackCache);
      }
      return {
        id: track.id,
        blobRevision: 0,
        clipBlob,
        audioBlob,
        posterBlob,
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
        mutedByRepair: track.mutedByRepair ?? false,
        showVideo: track.showVideo,
        ...(track.voice ? { voice: track.voice } : {}),
      };
    }),
  );
  commitBlobReferenceCache(blobReferences);

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

// A kill between the schema-2 metadata write and the legacy delete leaves the
// old monolith behind as duplicate storage. Once schema 2 loads cleanly it is
// the source of truth, so lingering legacy records are removed. Degraded
// loads (missing blob records) keep them: the monolith's inline bytes may be
// the only remaining copy of the media.
async function deleteLingeringLegacyRecords(): Promise<void> {
  await Promise.all(
    [LEGACY_PROJECT_KEY, LEGACY_PROJECT_BACKUP_KEY].map(async (key) => {
      if ((await get(key, store)) !== undefined) await del(key, store);
    }),
  );
}

export async function loadProject(): Promise<PersistedProject | null> {
  const metadata = await get(PROJECT_KEY, store);
  if (isRecord(metadata)) {
    if (isSchema2Metadata(metadata)) {
      const resolved = await resolveMetadataRecord(metadata);
      if (!resolved.missingBlobs) await deleteLingeringLegacyRecords();
      return resolved;
    }
    // A record from a newer build is not corrupt; it must stay exactly where
    // it is (an older cached shell can open a newer project). Fail the load
    // as an ordinary error so the App keeps autosave off behind its one line.
    if (
      typeof metadata.schemaVersion === "number" &&
      metadata.schemaVersion > PERSISTED_SCHEMA_VERSION
    ) {
      throw new Error(
        `${PROJECT_KEY} was written by a newer build (schema ${metadata.schemaVersion}); this build reads schema ${PERSISTED_SCHEMA_VERSION}`,
      );
    }
    // One quarantine slot: an unresolved record in it is never overwritten
    // (a second one would take its metadata and, through GC, its bytes).
    // Fail the load instead; the App keeps autosave off behind its one line.
    if ((await get(PROJECT_QUARANTINE_KEY, store)) !== undefined) {
      throw new Error(
        `${PROJECT_KEY} is unreadable and the quarantine slot ${PROJECT_QUARANTINE_KEY} is already occupied`,
      );
    }
    // Set the unreadable record aside before failing: the app then starts
    // empty with autosave on, and nothing overwrites the original bytes. If
    // either write fails the error propagates as an ordinary load failure.
    await set(PROJECT_QUARANTINE_KEY, metadata, store);
    await del(PROJECT_KEY, store);
    throw new InvalidMetadataError(
      `${PROJECT_KEY} was not valid schema-${PERSISTED_SCHEMA_VERSION} metadata and was moved to ${PROJECT_QUARANTINE_KEY}`,
    );
  }

  const legacy = await get(LEGACY_PROJECT_KEY, store);
  if (isRecord(legacy)) {
    return tagLegacyProject(legacy, LEGACY_PROJECT_KEY);
  }

  return null;
}

export async function saveRecoveryBackup(project: PersistedProject): Promise<void> {
  // The backup stores references, not bytes — but a reference must never
  // dangle: every ref gets a real blob record before the backup is written.
  // This matters during legacy migration, where media that normalization
  // subsequently drops keeps its bytes reachable only through the backup refs
  // (the backup is a GC root). For already-split projects the records exist
  // and nothing extra is written. If a blob write fails (quota), the error
  // propagates before any backup or migration write happens.
  const { metadata } = await buildMetadataRecord(project, true);
  await set(PROJECT_BACKUP_KEY, metadata, store);
}

// No app code path restores from the backup yet — it is write-only insurance
// (and a GC root for protected bytes) pending the export/import roadmap item.
export async function loadRecoveryBackup(): Promise<unknown | null> {
  return (await get(PROJECT_BACKUP_KEY, store)) ?? null;
}

export async function clearProject(): Promise<void> {
  blobReferenceCache.clear();
  await Promise.all([
    del(PROJECT_KEY, store),
    del(PROJECT_BACKUP_KEY, store),
    del(PROJECT_QUARANTINE_KEY, store),
    del(LEGACY_PROJECT_KEY, store),
    del(LEGACY_PROJECT_BACKUP_KEY, store),
  ]);
  // Only Chop's records go; Mood's records still root the blobs they name.
  await deleteOrphanedBlobRecords(new Set(), {
    excludeKeys: [
      PROJECT_KEY,
      PROJECT_BACKUP_KEY,
      PROJECT_QUARANTINE_KEY,
      LEGACY_PROJECT_KEY,
      LEGACY_PROJECT_BACKUP_KEY,
    ],
  });
}
