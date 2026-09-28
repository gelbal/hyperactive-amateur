// ABOUTME: Shared type definitions for Hyperactive Amateur's domain (clips, tracks, app state),
// ABOUTME: plus the TAGS taxonomy constant. Mutations live in the store actions module.

export const TAGS = ["kick", "snare", "hat", "vocal", "fx"] as const;
export type Tag = (typeof TAGS)[number];

export interface Clip {
  blob: Blob;
  // Object URL for the blob; recreated on rehydrate (not persisted).
  url: string;
  // Decoded audio side of the clip; null only for repair-state clips.
  audioBuffer: AudioBuffer | null;
  audioStatus: "ok" | "unavailable";
  // Persisted playback sidecar. Present for new recordings so reload does not
  // depend on decoding a mixed video container as audio.
  audioBlob?: Blob | null;
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
  // In-memory media revision. Bumped when clip/poster blob references change.
  blobRevision?: number;
  // Step toggles; length always equals project.stepCount.
  steps: boolean[];
  // 0..1 linear volume.
  volume: number;
  muted: boolean;
  // True when `muted` was applied by the audio-repair path rather than the
  // user. Re-recording clears the mute only while this is set; any user mute
  // toggle claims ownership of the state and clears it. Defaults to false.
  mutedByRepair?: boolean;
  tag: Tag | null;
  // When false, the track fires audio but does not cause a viewport cut.
  // Hats/ghost notes typically benefit from this. Default true.
  showVideo: boolean;
  // Id of the drum-kit voice the track plays while it has no clip
  // (drumKit.ts). Undefined means the default for the track's position.
  // Kept under a recorded clip, so deleting the clip brings it back.
  voice?: string;
}

export type MoodStageId = "corners" | "row" | "stack";

// Freestyle joins this union post-v1. Its v1 design representation is
// cycleSeconds: null through the clock module, not a dead enum value here.
export type MoodTimeFeel = "pocket" | "click";

export const MOOD_LENS_IDS = ["wall", "splits", "solo"] as const;
export type MoodLens = (typeof MOOD_LENS_IDS)[number];

export const MOOD_VIBE_IDS = [
  "clean",
  "print",
  "mixtape",
  "blocks",
  "camcorder",
  "kaleido",
  "weave",
  "crossroll",
  "ghost",
  "solar",
] as const;
// Mood visual treatment; unrelated to the chop Vibe AI pattern-style hint.
export type MoodVibeId = (typeof MOOD_VIBE_IDS)[number];

export type MoodPart = "lead" | "harmony" | "bass" | "beatbox" | "adlib";

export const MOOD_FX_PRESET_IDS = ["neutral", "sweep", "wash"] as const;
export type MoodFxPreset = (typeof MOOD_FX_PRESET_IDS)[number];

export const MOOD_CREDIT_PALETTE_IDS = ["signal", "print", "heat"] as const;
export type MoodCreditPalette = (typeof MOOD_CREDIT_PALETTE_IDS)[number];

export const MOOD_CREDIT_MODE_IDS = ["sequence", "together"] as const;
export type MoodCreditMode = (typeof MOOD_CREDIT_MODE_IDS)[number];

export const MOOD_KEY_IDS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;
export type MoodKey = (typeof MOOD_KEY_IDS)[number];
export type MoodKeyMode = "major" | "minor";

export interface MoodArtDirection {
  fxPreset: MoodFxPreset;
  creditPalette: MoodCreditPalette;
  source: "ai" | "user";
}

export interface MoodKeyEstimate {
  key: MoodKey;
  mode: MoodKeyMode;
  confidence: number;
}

export type AppMode = "chop" | "mood";

export const MOOD_TAKE_CYCLE_MULTIPLES = [0.5, 1, 2, 4] as const;
export type MoodTakeCycleMultiple = (typeof MOOD_TAKE_CYCLE_MULTIPLES)[number];

export interface MoodTake {
  id: string;
  // Persisted recording blobs. The video blob is immutable; trim points below
  // define the play/draw-time window without mutating the source.
  videoBlob: Blob;
  audioBlob: Blob | null;
  posterBlob: Blob | null;
  // Object URL for videoBlob; recreated on rehydrate (not persisted).
  url: string;
  // Decoded audio side of the take; null only for repair-state takes.
  audioBuffer: AudioBuffer | null;
  audioStatus: "ok" | "unavailable";
  // Object URL for posterBlob; recreated on rehydrate (not persisted).
  posterUrl: string | null;
  trimStartMs: number;
  trimEndMs: number;
  // Silence-trimmed content length: (trimEndMs - trimStartMs) / 1000.
  durationSeconds: number;
  cycleMultiple: MoodTakeCycleMultiple;
  syncOffsetMs: number;
  part: MoodPart | null;
  partSource: "ai" | "user" | null;
  recordedAt: number;
}

export interface MoodMic {
  id: string;
  takes: MoodTake[];
}

export interface MoodCredits {
  enabled: boolean;
  names: Record<string, string>;
  styleIndex: number;
  mode?: MoodCreditMode;
}

export const MOOD_CYCLE_BARS = [1, 2, 4] as const;

export interface MoodPiece {
  moodSchemaVersion: 1;
  stage: MoodStageId;
  timeFeel: MoodTimeFeel;
  bpm: number | null;
  cycleBars: (typeof MOOD_CYCLE_BARS)[number] | null;
  cycleSeconds: number | null;
  oneMicId: string | null;
  oneTakeId: string | null;
  vibe: MoodVibeId;
  lens: MoodLens;
  credits?: MoodCredits;
  artDirection?: MoodArtDirection;
  keyEstimate?: MoodKeyEstimate;
  // Last stopped mix; optional so legacy schema-1 pieces keep live defaults.
  savedSelections?: Record<string, MoodSelectionEntry>;
  mics: MoodMic[];
  updatedAt: number;
}

export type MoodSelectionEntry = string | "off";

export interface MoodSelectionCommit {
  micId: string;
  entry: MoodSelectionEntry;
}

export interface MoodPerformanceState {
  isPerforming: boolean;
  epoch: number | null;
  selections: Record<string, MoodSelectionEntry>;
  armed: Record<string, MoodSelectionEntry | null>;
  armedLens: MoodLens | null;
  armedDropActive: boolean | null;
  dropActive: boolean;
  hotMicId: string | null;
  cycleCount: number;
}

export type MoodHydrationState = "cold" | "hydrating" | "ready" | "failed";

export interface MoodSlice {
  piece: MoodPiece | null;
  hydration: MoodHydrationState;
  monitorWithHeadphones: boolean;
  // Take ids currently awaiting Part Tags. Transient and session-scoped.
  partCheckingTakeIds: string[];
  // How many ticks the current take's count-in plays; the count-in digit
  // never shows above it. Transient.
  countInTicks: number | null;
  performance: MoodPerformanceState;
}

export type RecordingState = "idle" | "preparing" | "countdown" | "recording" | "reviewing";

export type TakeReceipt =
  | { kind: "kept"; seconds: number; multiple: number }
  | { kind: "too-short" };

// Tone.js note-value notation for the visual cut subdivision.
export type CutSubdivision = "16n" | "8n" | "4n" | "2n" | "1m";

export type Subgenre = "boom-bap" | "trap" | "lo-fi" | "phonk";

// Persistent style hint sent to AI Suggest + variations. Does not mutate the
// pattern at runtime; it shapes the next AI generation.
// - tight: dense, all 8 tracks engaged, classic boom-bap repetition.
// - varied: fewer tracks per loop, asymmetric placement, more breathing room.
// - breaky: sparse last quarter — drop most hits there for a sense of rest.
// This chop AI pattern-style hint is unrelated to MoodVibeId's visual treatment.
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

export type AudioState = "unknown" | "running" | "resume-required";

export interface PlaybackState {
  isPlaying: boolean;
  // Transient AudioContext health for resume-required UI; never persisted.
  audioState: AudioState;
  // True while a real-time export render owns the Transport. User playback
  // controls are ignored so they cannot silently corrupt the captured output.
  isExporting: boolean;
  // 0..stepCount-1 — drives the playhead UI.
  currentStep: number;
  // Monotonically increments per track on every trigger; pads subscribe to
  // the relevant slot to drive a brief flash animation.
  triggerSeq: number[];
}

export interface RecordingSlice {
  activeTrackId: number | null;
  countdownEndsAt: number | null;
  captureEndsAt: number | null;
  error: string | null;
  lastTakeReceipt: TakeReceipt | null;
  state: RecordingState;
}

export interface UiState {
  selectedTrackId: number | null;
  showExportDialog: boolean;
}

export type MediaStatus = "idle" | "requesting" | "granted" | "denied" | "suspended";

export interface MediaSlice {
  stream: MediaStream | null;
  status: MediaStatus;
  error: string | null;
  // Preferred input device ids (per-machine, persisted in localStorage —
  // not part of the saved project). When null, the browser picks the default.
  videoDeviceId: string | null;
  audioDeviceId: string | null;
  // Preferred camera orientation on phones. Applied only when videoDeviceId
  // is null — an explicit Sources-picker selection wins.
  videoFacingMode: "user" | "environment";
}

export type StorageDurability = "persistent" | "best-effort" | "unknown";

export interface SessionSlice {
  // Monotonic in-memory counter for edits that make pending AI pattern
  // responses stale. Not persisted; reloads start a fresh active project.
  projectRevision: number;
  // Monotonic in-memory counter for Mood piece edits that make async
  // refinements stale. Performance-only state does not bump it.
  moodRevision: number;
  // Identifies the current Mood piece session without changing for overdubs.
  moodSessionId: number;
  // Browser storage durability for this session. Not persisted because it is
  // a property of the current browser bucket, not the project.
  storageDurability: StorageDurability;
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
  // True once the project has had something to play (a clip, or on load a
  // clip or a step): the pads, grid and transport stay available after the
  // last clip is deleted, so a drums-only beat remains editable. Cleared by
  // reset and Scratch. Transient.
  editorUnlocked: boolean;
}

export interface AppState {
  appMode: AppMode;
  project: ProjectState;
  mood: MoodSlice;
  playback: PlaybackState;
  recording: RecordingSlice;
  ui: UiState;
  media: MediaSlice;
  session: SessionSlice;
}
