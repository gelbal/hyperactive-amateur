// ABOUTME: persistence — save and rehydrate the project state to IndexedDB via idb-keyval.
// ABOUTME: AudioBuffer and object URLs are derived; only the blob and trim numbers are stored.
import { get, set, del } from "idb-keyval";
import type { AppState, CutSubdivision, Subgenre, Tag, Vibe } from "../types";

export const PROJECT_KEY = "hyperactive-amateur-project";

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
  tag: Tag | null;
  steps: boolean[];
  volume: number;
  muted: boolean;
  showVideo: boolean;
}

export interface PersistedProject {
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
}

export function snapshot(state: AppState): PersistedProject {
  return {
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
      tag: track.tag,
      steps: [...track.steps],
      volume: track.volume,
      muted: track.muted,
      showVideo: track.showVideo,
    })),
    updatedAt: Date.now(),
  };
}

export async function saveProject(state: AppState): Promise<void> {
  await set(PROJECT_KEY, snapshot(state));
}

export async function loadProject(): Promise<PersistedProject | null> {
  const value = await get(PROJECT_KEY);
  if (!value || typeof value !== "object" || !Array.isArray((value as PersistedProject).tracks)) {
    return null;
  }
  return value as PersistedProject;
}

export async function clearProject(): Promise<void> {
  await del(PROJECT_KEY);
}
