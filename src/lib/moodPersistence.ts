// ABOUTME: Mood persistence — schema-1 metadata for layered-loop pieces in IndexedDB.
// ABOUTME: Mood blobs share the content-addressed ha:blob:* store with Chop.
import { del, get, set } from "idb-keyval";
import type { MoodPiece, MoodTake } from "../types";
import {
  deleteOrphanedBlobRecords,
  isBlob,
  isRecord,
  loadContentAddressedBlob,
  storeContentAddressedBlob,
} from "./persistence";

export const MOOD_KEY = "ha:mood-meta";
export const MOOD_BACKUP_KEY = "ha:mood-meta-backup";
export const moodSchemaVersion = 1;

export type MoodBlobField = "videoBlob" | "audioBlob" | "posterBlob";

export interface MissingMoodBlobReference {
  micId: string;
  takeId: string;
  field: MoodBlobField;
  ref: string;
}

export interface PersistedMoodTake {
  id: string;
  videoBlob: Blob | null;
  audioBlob: Blob | null;
  posterBlob: Blob | null;
  trimStartMs: number;
  trimEndMs: number;
  durationSeconds: number;
  cycleMultiple: MoodTake["cycleMultiple"];
  syncOffsetMs: number;
  part: MoodTake["part"];
  partSource: MoodTake["partSource"];
  audioStatus: MoodTake["audioStatus"];
  recordedAt: number;
}

export interface PersistedMoodMic {
  id: string;
  takes: PersistedMoodTake[];
}

export interface PersistedMoodPiece {
  moodSchemaVersion: 1;
  stage: MoodPiece["stage"];
  timeFeel: MoodPiece["timeFeel"];
  bpm: MoodPiece["bpm"];
  cycleBars: MoodPiece["cycleBars"];
  cycleSeconds: MoodPiece["cycleSeconds"];
  oneMicId: MoodPiece["oneMicId"];
  oneTakeId: MoodPiece["oneTakeId"];
  vibe: MoodPiece["vibe"];
  lens: MoodPiece["lens"];
  mics: PersistedMoodMic[];
  updatedAt: number;
  missingBlobs?: MissingMoodBlobReference[];
}

type MoodPersistableTake = Pick<
  PersistedMoodTake,
  | "id"
  | "videoBlob"
  | "audioBlob"
  | "posterBlob"
  | "trimStartMs"
  | "trimEndMs"
  | "durationSeconds"
  | "cycleMultiple"
  | "syncOffsetMs"
  | "part"
  | "partSource"
  | "audioStatus"
  | "recordedAt"
>;

type MoodPersistablePiece = Omit<PersistedMoodPiece, "mics" | "missingBlobs"> & {
  mics: Array<{ id: string; takes: MoodPersistableTake[] }>;
};

interface PersistedMoodTakeV1 {
  id: string;
  trimStartMs: number;
  trimEndMs: number;
  durationSeconds: number;
  cycleMultiple: MoodTake["cycleMultiple"];
  syncOffsetMs: number;
  part: MoodTake["part"];
  partSource: MoodTake["partSource"];
  audioStatus: MoodTake["audioStatus"];
  recordedAt: number;
  videoBlobRef?: string;
  audioBlobRef?: string;
  posterBlobRef?: string;
}

interface PersistedMoodMicV1 {
  id: string;
  takes: PersistedMoodTakeV1[];
}

interface PersistedMoodMetaV1 {
  moodSchemaVersion: 1;
  stage: MoodPiece["stage"];
  timeFeel: MoodPiece["timeFeel"];
  bpm: MoodPiece["bpm"];
  cycleBars: MoodPiece["cycleBars"];
  cycleSeconds: MoodPiece["cycleSeconds"];
  oneMicId: MoodPiece["oneMicId"];
  oneTakeId: MoodPiece["oneTakeId"];
  vibe: MoodPiece["vibe"];
  lens: MoodPiece["lens"];
  mics: PersistedMoodMicV1[];
  updatedAt: number;
}

interface MetadataBuildResult {
  metadata: PersistedMoodMetaV1;
  referencedBlobKeys: Set<string>;
  blobReferences: Map<string, MoodTakeBlobReferenceCache>;
}

interface CachedMoodBlobReference {
  blob: Blob;
  ref: string;
}

type MoodTakeBlobReferenceCache = Partial<Record<MoodBlobField, CachedMoodBlobReference>>;

const moodBlobReferenceCache = new Map<string, MoodTakeBlobReferenceCache>();

export class InvalidMoodMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoodMetadataError";
  }
}

function moodTakeCacheKey(micId: string, takeId: string): string {
  return `${micId}:${takeId}`;
}

function cachedMoodBlobReference(
  micId: string,
  takeId: string,
  field: MoodBlobField,
  blob: Blob,
): string | undefined {
  const cached = moodBlobReferenceCache.get(moodTakeCacheKey(micId, takeId))?.[field];
  if (!cached || cached.blob !== blob) return undefined;
  return cached.ref;
}

function hasMoodBlobReferences(cache: MoodTakeBlobReferenceCache): boolean {
  return Boolean(cache.videoBlob || cache.audioBlob || cache.posterBlob);
}

function commitMoodBlobReferenceCache(
  nextCache: Map<string, MoodTakeBlobReferenceCache>,
): void {
  moodBlobReferenceCache.clear();
  for (const [takeKey, cache] of nextCache) {
    moodBlobReferenceCache.set(takeKey, cache);
  }
}

async function moodBlobReference(
  micId: string,
  take: MoodPersistableTake,
  field: MoodBlobField,
  referencedBlobKeys: Set<string>,
  writeMissingBlob: boolean,
  nextTakeCache: MoodTakeBlobReferenceCache,
): Promise<string | undefined> {
  const blob = take[field];
  if (!isBlob(blob)) return undefined;
  const cached = cachedMoodBlobReference(micId, take.id, field, blob);
  if (cached) {
    referencedBlobKeys.add(cached);
    nextTakeCache[field] = { blob, ref: cached };
    return cached;
  }

  const key = await storeContentAddressedBlob(blob, writeMissingBlob);
  referencedBlobKeys.add(key);
  nextTakeCache[field] = { blob, ref: key };
  return key;
}

export function snapshotMood(piece: MoodPersistablePiece): PersistedMoodPiece {
  return {
    moodSchemaVersion,
    stage: piece.stage,
    timeFeel: piece.timeFeel,
    bpm: piece.bpm,
    cycleBars: piece.cycleBars,
    cycleSeconds: piece.cycleSeconds,
    oneMicId: piece.oneMicId,
    oneTakeId: piece.oneTakeId,
    vibe: piece.vibe,
    lens: piece.lens,
    mics: piece.mics.map((mic) => ({
      id: mic.id,
      takes: mic.takes.map((take) => ({
        id: take.id,
        videoBlob: take.videoBlob,
        audioBlob: take.audioBlob,
        posterBlob: take.posterBlob,
        trimStartMs: take.trimStartMs,
        trimEndMs: take.trimEndMs,
        durationSeconds: take.durationSeconds,
        cycleMultiple: take.cycleMultiple,
        syncOffsetMs: take.syncOffsetMs,
        part: take.part,
        partSource: take.partSource,
        audioStatus: take.audioStatus,
        recordedAt: take.recordedAt,
      })),
    })),
    updatedAt: piece.updatedAt,
  };
}

async function buildMoodMetadataRecord(
  piece: PersistedMoodPiece,
  writeMissingBlobs: boolean,
): Promise<MetadataBuildResult> {
  const referencedBlobKeys = new Set<string>();
  const blobReferences = new Map<string, MoodTakeBlobReferenceCache>();
  const mics = await Promise.all(
    piece.mics.map(async (mic): Promise<PersistedMoodMicV1> => ({
      id: mic.id,
      takes: await Promise.all(
        mic.takes.map(async (take): Promise<PersistedMoodTakeV1> => {
          const nextTakeCache: MoodTakeBlobReferenceCache = {};
          const videoBlobRef = await moodBlobReference(
            mic.id,
            take,
            "videoBlob",
            referencedBlobKeys,
            writeMissingBlobs,
            nextTakeCache,
          );
          const audioBlobRef = await moodBlobReference(
            mic.id,
            take,
            "audioBlob",
            referencedBlobKeys,
            writeMissingBlobs,
            nextTakeCache,
          );
          const posterBlobRef = await moodBlobReference(
            mic.id,
            take,
            "posterBlob",
            referencedBlobKeys,
            writeMissingBlobs,
            nextTakeCache,
          );
          if (hasMoodBlobReferences(nextTakeCache)) {
            blobReferences.set(moodTakeCacheKey(mic.id, take.id), nextTakeCache);
          }

          return {
            id: take.id,
            trimStartMs: take.trimStartMs,
            trimEndMs: take.trimEndMs,
            durationSeconds: take.durationSeconds,
            cycleMultiple: take.cycleMultiple,
            syncOffsetMs: take.syncOffsetMs,
            part: take.part,
            partSource: take.partSource,
            audioStatus: take.audioStatus,
            recordedAt: take.recordedAt,
            ...(videoBlobRef ? { videoBlobRef } : {}),
            ...(audioBlobRef ? { audioBlobRef } : {}),
            ...(posterBlobRef ? { posterBlobRef } : {}),
          };
        }),
      ),
    })),
  );

  return {
    metadata: {
      moodSchemaVersion,
      stage: piece.stage,
      timeFeel: piece.timeFeel,
      bpm: piece.bpm,
      cycleBars: piece.cycleBars,
      cycleSeconds: piece.cycleSeconds,
      oneMicId: piece.oneMicId,
      oneTakeId: piece.oneTakeId,
      vibe: piece.vibe,
      lens: piece.lens,
      mics,
      updatedAt: piece.updatedAt,
    },
    referencedBlobKeys,
    blobReferences,
  };
}

function isMoodMetadata(value: unknown): value is PersistedMoodMetaV1 {
  return isRecord(value) && value.moodSchemaVersion === moodSchemaVersion && Array.isArray(value.mics);
}

async function resolveMoodBlobReference(
  ref: string | undefined,
  micId: string,
  takeId: string,
  field: MoodBlobField,
  missingBlobs: MissingMoodBlobReference[],
): Promise<Blob | null> {
  if (!ref) return null;
  const blob = await loadContentAddressedBlob(ref);
  if (blob) return blob;
  missingBlobs.push({ micId, takeId, field, ref });
  return null;
}

async function resolveMoodMetadataRecord(
  metadata: PersistedMoodMetaV1,
): Promise<PersistedMoodPiece> {
  const missingBlobs: MissingMoodBlobReference[] = [];
  const blobReferences = new Map<string, MoodTakeBlobReferenceCache>();
  const mics = await Promise.all(
    metadata.mics.map(async (mic): Promise<PersistedMoodMic> => ({
      id: mic.id,
      takes: await Promise.all(
        mic.takes.map(async (take): Promise<PersistedMoodTake> => {
          const videoBlob = await resolveMoodBlobReference(
            take.videoBlobRef,
            mic.id,
            take.id,
            "videoBlob",
            missingBlobs,
          );
          const audioBlob = await resolveMoodBlobReference(
            take.audioBlobRef,
            mic.id,
            take.id,
            "audioBlob",
            missingBlobs,
          );
          const posterBlob = await resolveMoodBlobReference(
            take.posterBlobRef,
            mic.id,
            take.id,
            "posterBlob",
            missingBlobs,
          );
          const nextTakeCache: MoodTakeBlobReferenceCache = {};
          const refs: Record<MoodBlobField, string | undefined> = {
            videoBlob: take.videoBlobRef,
            audioBlob: take.audioBlobRef,
            posterBlob: take.posterBlobRef,
          };
          const blobs: Record<MoodBlobField, Blob | null> = {
            videoBlob,
            audioBlob,
            posterBlob,
          };
          for (const field of ["videoBlob", "audioBlob", "posterBlob"] as const) {
            const blob = blobs[field];
            const ref = refs[field];
            if (blob && ref) nextTakeCache[field] = { blob, ref };
          }
          if (hasMoodBlobReferences(nextTakeCache)) {
            blobReferences.set(moodTakeCacheKey(mic.id, take.id), nextTakeCache);
          }

          return {
            id: take.id,
            videoBlob,
            audioBlob,
            posterBlob,
            trimStartMs: take.trimStartMs,
            trimEndMs: take.trimEndMs,
            durationSeconds: take.durationSeconds,
            cycleMultiple: take.cycleMultiple,
            syncOffsetMs: take.syncOffsetMs,
            part: take.part,
            partSource: take.partSource,
            audioStatus: take.audioStatus,
            recordedAt: take.recordedAt,
          };
        }),
      ),
    })),
  );
  commitMoodBlobReferenceCache(blobReferences);

  return {
    moodSchemaVersion,
    stage: metadata.stage,
    timeFeel: metadata.timeFeel,
    bpm: metadata.bpm,
    cycleBars: metadata.cycleBars,
    cycleSeconds: metadata.cycleSeconds,
    oneMicId: metadata.oneMicId,
    oneTakeId: metadata.oneTakeId,
    vibe: metadata.vibe,
    lens: metadata.lens,
    mics,
    updatedAt: metadata.updatedAt,
    ...(missingBlobs.length > 0 ? { missingBlobs } : {}),
  };
}

export async function saveMoodPiece(piece: MoodPersistablePiece): Promise<void> {
  const persisted = snapshotMood(piece);
  const { metadata, referencedBlobKeys, blobReferences } = await buildMoodMetadataRecord(
    persisted,
    true,
  );
  await set(MOOD_KEY, metadata);
  commitMoodBlobReferenceCache(blobReferences);
  await deleteOrphanedBlobRecords(referencedBlobKeys);
}

export async function loadMoodMeta(): Promise<PersistedMoodPiece | null> {
  const metadata = await get(MOOD_KEY);
  if (metadata === undefined) return null;
  if (isMoodMetadata(metadata)) return resolveMoodMetadataRecord(metadata);
  throw new InvalidMoodMetadataError(
    `${MOOD_KEY} exists but is not valid schema-${moodSchemaVersion} metadata`,
  );
}

export async function saveMoodRecoveryBackup(piece: MoodPersistablePiece): Promise<void> {
  const { metadata } = await buildMoodMetadataRecord(snapshotMood(piece), true);
  await set(MOOD_BACKUP_KEY, metadata);
}

export async function loadMoodRecoveryBackup(): Promise<unknown | null> {
  return (await get(MOOD_BACKUP_KEY)) ?? null;
}

export async function clearMoodPiece(): Promise<void> {
  moodBlobReferenceCache.clear();
  await Promise.all([del(MOOD_KEY), del(MOOD_BACKUP_KEY)]);
  await deleteOrphanedBlobRecords(new Set(), {
    excludeKeys: [MOOD_KEY, MOOD_BACKUP_KEY],
  });
}
