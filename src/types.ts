// ABOUTME: Shared type definitions for Hyperactive Amateur's domain (clips, tracks, app state).
// ABOUTME: Pure types — no runtime values. Mutations live in the store actions module.

export const TAGS = ["kick", "snare", "hat", "vocal", "fx"] as const;
export type Tag = (typeof TAGS)[number];

export interface Clip {
  blob: Blob;
  // Object URL for the blob; recreated on rehydrate (not persisted).
  url: string;
  // Decoded audio side of the clip; reused on every playback to avoid decode latency.
  audioBuffer: AudioBuffer;
  trimStartMs: number;
  trimEndMs: number;
  durationMs: number;
  // First-frame poster image, captured at record time and persisted to
  // IndexedDB. Used by <img> thumbnails in PadGrid + TrackInfo because
  // WebKit (every iPadOS browser) doesn't reliably paint a first frame
  // from a blob-backed <video preload="metadata"> that hasn't played.
  // Null when generation failed; thumbnails fall back to a placeholder.
  posterBlob: Blob | null;
  // Object URL for posterBlob; recreated on rehydrate (not persisted).
  posterUrl: string | null;
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
  // When false, the track fires audio but does not cause a viewport cut.
  // Hats/ghost notes typically benefit from this. Default true.
  showVideo: boolean;
}

export type RecordingState = "idle" | "countdown" | "recording" | "reviewing";

export interface ActiveTrigger {
  trackId: number;
  // audioContext.currentTime when the trigger was fired.
  startedAt: number;
  durationMs: number;
}

// Tone.js note-value notation for the visual cut subdivision.
export type CutSubdivision = "16n" | "8n" | "4n" | "2n" | "1m";

export type Subgenre = "boom-bap" | "trap" | "lo-fi" | "phonk";

// Persistent style hint sent to AI Suggest + variations. Does not mutate the
// pattern at runtime; it shapes the next AI generation.
// - tight: dense, all 8 tracks engaged, classic boom-bap repetition.
// - varied: fewer tracks per loop, asymmetric placement, more breathing room.
// - breaky: sparse last quarter — drop most hits there for a sense of rest.
export type Vibe = "tight" | "varied" | "breaky";

export interface ProjectState {
  bpm: number;
  // 0..1 — Tone.Transport swing amount.
  swing: number;
  // Visual-only quantization for the hard-cut renderer. Audio scheduling
  // stays at 16ths regardless.
  cutSubdivision: CutSubdivision;
  // Minimum time the renderer holds the current frame before cutting to a
  // same-priority-tier event. Higher-tier events bypass this. ms, 0..2000.
  sameTierHoldMs: number;
  // Genre hint sent to the AI suggester and pattern variations.
  subgenre: Subgenre;
  // Style hint sent to the AI suggester and pattern variations. Tight is the
  // default; Varied and Breaky bias the model toward space and drops.
  vibe: Vibe;
  // Number of 16th-note steps in the loop. Always a multiple of 4. Each
  // track's `steps` array has exactly this length.
  stepCount: number;
  // Per-track reasoning string returned by the most recent successful
  // auto-tag (per-clip or batch). Folded into the Suggest / vary prompt
  // as "Kit notes:" so the model has the same ontology that classified
  // the sounds. Persisted because it's a property of the kit, not the
  // current browser session — a refresh shouldn't wipe it.
  tagReasoning: Record<number, string>;
  tracks: Track[];
}

export interface PlaybackState {
  isPlaying: boolean;
  // 0..15 — drives the playhead UI.
  currentStep: number;
  // Recent trigger events the renderer consumes.
  activeTriggers: ActiveTrigger[];
  // Monotonically increments per track on every trigger; pads subscribe to
  // the relevant slot to drive a brief flash animation.
  triggerSeq: number[];
}

export interface RecordingSlice {
  activeTrackId: number | null;
  state: RecordingState;
}

export interface UiState {
  selectedTrackId: number | null;
  showExportDialog: boolean;
}

export type MediaStatus = "idle" | "requesting" | "granted" | "denied";

export interface MediaSlice {
  stream: MediaStream | null;
  status: MediaStatus;
  error: string | null;
  // Preferred input device ids (per-machine, persisted in localStorage —
  // not part of the saved project). When null, the browser picks the default.
  videoDeviceId: string | null;
  audioDeviceId: string | null;
}

export interface SessionSlice {
  // Track ids whose showVideo has been manually toggled in this session.
  // Transient — not persisted, cleared on reset and on page load.
  manuallyToggledShowVideo: number[];
  // Track ids whose tag has been picked by the user in this session.
  // Auto-tag flows (per-clip + holistic retag) skip these so a stale
  // classification can't overwrite a deliberate user choice. Transient.
  manuallyTagged: number[];
  // True after the user has clicked "Done" on the in-viewport recording
  // walkthrough; the station goes away until they re-open it. Transient.
  recordingStationDismissed: boolean;
}

export interface AppState {
  project: ProjectState;
  playback: PlaybackState;
  recording: RecordingSlice;
  ui: UiState;
  media: MediaSlice;
  session: SessionSlice;
}
