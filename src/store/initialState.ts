// ABOUTME: Factory for a fresh, empty AppState — 8 untouched tracks at 90 BPM.
// ABOUTME: Pure function so callers can rely on independent objects between calls.
import type { AppState, Track } from "../types";

const TRACK_COUNT = 8;
const STEP_COUNT = 16;

function createEmptyTrack(id: number): Track {
  return {
    id,
    clip: null,
    steps: new Array(STEP_COUNT).fill(false),
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
      tracks: Array.from({ length: TRACK_COUNT }, (_, i) => createEmptyTrack(i)),
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
  };
}
