// ABOUTME: persistence — save and rehydrate the project state to IndexedDB via idb-keyval.
// ABOUTME: AudioBuffer and object URLs are derived; only the blob and trim numbers are stored.
import { get, set, del } from "idb-keyval";
import type { AppState, Tag } from "../types";

export const PROJECT_KEY = "current-project";

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
}

export interface PersistedProject {
  version: 1;
  bpm: number;
  swing: number;
  tracks: PersistedTrack[];
  updatedAt: number;
}

export function snapshot(state: AppState): PersistedProject {
  return {
    version: 1,
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
    })),
    updatedAt: Date.now(),
  };
}

export async function saveProject(state: AppState): Promise<void> {
  await set(PROJECT_KEY, snapshot(state));
}

export async function loadProject(): Promise<PersistedProject | null> {
  const value = (await get(PROJECT_KEY)) as PersistedProject | undefined;
  return value ?? null;
}

export async function clearProject(): Promise<void> {
  await del(PROJECT_KEY);
}
