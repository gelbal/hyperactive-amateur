// ABOUTME: persistence — save and rehydrate the project state to IndexedDB via idb-keyval.
// ABOUTME: AudioBuffer and object URLs are derived; only the blob and trim numbers are stored.
import { get, set, del } from "idb-keyval";
import type { AppState, Tag } from "../types";

export const PROJECT_KEY = "current-project";
export const CURRENT_SCHEMA_VERSION = 2;

export interface PersistedTrack {
  id: number;
  clipBlob: Blob | null;
  trimStartMs: number;
  trimEndMs: number;
  durationMs: number;
  tag: Tag | null;
  steps: boolean[];
  volume: number;
  muted: boolean;
  showVideo: boolean;
}

export interface PersistedProject {
  version: typeof CURRENT_SCHEMA_VERSION;
  bpm: number;
  swing: number;
  tracks: PersistedTrack[];
  updatedAt: number;
}

export function snapshot(state: AppState): PersistedProject {
  return {
    version: CURRENT_SCHEMA_VERSION,
    bpm: state.project.bpm,
    swing: state.project.swing,
    tracks: state.project.tracks.map((track) => ({
      id: track.id,
      clipBlob: track.clip ? track.clip.blob : null,
      trimStartMs: track.clip ? track.clip.trimStartMs : 0,
      trimEndMs: track.clip ? track.clip.trimEndMs : 0,
      durationMs: track.clip ? track.clip.durationMs : 0,
      tag: track.tag,
      steps: [...track.steps],
      volume: track.volume,
      muted: track.muted,
      showVideo: track.showVideo,
    })),
    updatedAt: Date.now(),
  };
}

// Bring older schemas up to the current version. Pure function for testability.
export function migrate(value: unknown): PersistedProject | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<PersistedProject> & { version?: number };
  const version = typeof v.version === "number" ? v.version : 1;
  if (!Array.isArray(v.tracks)) return null;

  const tracks: PersistedTrack[] = v.tracks.map((t) => {
    const track = t as Partial<PersistedTrack>;
    return {
      id: typeof track.id === "number" ? track.id : 0,
      clipBlob: (track.clipBlob as Blob | null) ?? null,
      trimStartMs: typeof track.trimStartMs === "number" ? track.trimStartMs : 0,
      trimEndMs: typeof track.trimEndMs === "number" ? track.trimEndMs : 0,
      durationMs: typeof track.durationMs === "number" ? track.durationMs : 0,
      tag: (track.tag as Tag | null) ?? null,
      steps: Array.isArray(track.steps) ? track.steps.map(Boolean) : new Array(16).fill(false),
      volume: typeof track.volume === "number" ? track.volume : 1,
      muted: typeof track.muted === "boolean" ? track.muted : false,
      // v2: showVideo defaults to true on legacy saves.
      showVideo: typeof track.showVideo === "boolean" ? track.showVideo : true,
    };
  });

  const migrated: PersistedProject = {
    version: CURRENT_SCHEMA_VERSION,
    bpm: typeof v.bpm === "number" ? v.bpm : 90,
    swing: typeof v.swing === "number" ? v.swing : 0,
    tracks,
    updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : Date.now(),
  };

  // Future: add v2 → v3 etc. here.
  void version;
  return migrated;
}

export async function saveProject(state: AppState): Promise<void> {
  await set(PROJECT_KEY, snapshot(state));
}

export async function loadProject(): Promise<PersistedProject | null> {
  const value = await get(PROJECT_KEY);
  if (value === undefined) return null;
  const migrated = migrate(value);
  if (!migrated) return null;
  // Persist the migrated form so subsequent loads skip the upgrade path.
  if ((value as { version?: number }).version !== CURRENT_SCHEMA_VERSION) {
    await set(PROJECT_KEY, migrated);
  }
  return migrated;
}

export async function clearProject(): Promise<void> {
  await del(PROJECT_KEY);
}
