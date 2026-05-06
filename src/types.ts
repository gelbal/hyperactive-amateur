// ABOUTME: Shared type definitions for Hyperpad's domain (clips, tracks, app state).
// ABOUTME: Pure types — no runtime values. Mutations live in the store actions module.

export type Tag = "kick" | "snare" | "hat" | "vocal" | "fx";

export interface Clip {
  blob: Blob;
  // Object URL for the blob; recreated on rehydrate (not persisted).
  url: string;
  // Decoded audio side of the clip; reused on every playback to avoid decode latency.
  audioBuffer: AudioBuffer;
  trimStartMs: number;
  trimEndMs: number;
  durationMs: number;
}

export interface Track {
  // 0-7 — track index in the sequencer.
  id: number;
  clip: Clip | null;
  // Length-16 array of step toggles (one bar of 16th notes).
  steps: boolean[];
  // 0..1 linear volume.
  volume: number;
  muted: boolean;
  tag: Tag | null;
}

export type RecordingState = "idle" | "countdown" | "recording" | "reviewing";

export interface ActiveTrigger {
  trackId: number;
  // audioContext.currentTime when the trigger was fired.
  startedAt: number;
  durationMs: number;
}

export interface ProjectState {
  bpm: number;
  // 0..1 — Tone.Transport swing amount.
  swing: number;
  tracks: Track[];
}

export interface PlaybackState {
  isPlaying: boolean;
  // 0..15 — drives the playhead UI.
  currentStep: number;
  // Recent trigger events the renderer consumes.
  activeTriggers: ActiveTrigger[];
}

export interface RecordingSlice {
  activeTrackId: number | null;
  state: RecordingState;
}

export interface UiState {
  selectedTrackId: number | null;
  showExportDialog: boolean;
}

export interface AppState {
  project: ProjectState;
  playback: PlaybackState;
  recording: RecordingSlice;
  ui: UiState;
}
