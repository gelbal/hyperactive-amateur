// ABOUTME: Factory for a fresh, empty AppState — 8 untouched tracks at 90 BPM.
// ABOUTME: Pure function so callers can rely on independent objects between calls.
import type { AppState, Track } from "../types";

const TRACK_COUNT = 8;
export const DEFAULT_STEP_COUNT = 16;
export const STEP_COUNT_INCREMENT = 4;
export const MIN_STEP_COUNT = 4;
export const MAX_STEP_COUNT = 64;

function createEmptyTrack(id: number, stepCount: number): Track {
  return {
    id,
    clip: null,
    steps: new Array(stepCount).fill(false),
    volume: 1,
    muted: false,
    tag: null,
    showVideo: true,
  };
}

export function createInitialState(): AppState {
  return {
    project: {
      bpm: 90,
      swing: 0,
      cutSubdivision: "8n",
      sameTierHoldMs: 400,
      subgenre: "boom-bap",
      stepCount: DEFAULT_STEP_COUNT,
      tracks: Array.from({ length: TRACK_COUNT }, (_, i) =>
        createEmptyTrack(i, DEFAULT_STEP_COUNT),
      ),
    },
    playback: {
      isPlaying: false,
      currentStep: 0,
      activeTriggers: [],
      triggerSeq: new Array(TRACK_COUNT).fill(0),
    },
    recording: {
      activeTrackId: null,
      state: "idle",
    },
    ui: {
      selectedTrackId: null,
      showExportDialog: false,
    },
    media: {
      stream: null,
      status: "idle",
      error: null,
    },
    session: {
      manuallyToggledShowVideo: [],
      recordingStationDismissed: false,
    },
  };
}
