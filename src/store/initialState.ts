// ABOUTME: Factory for a fresh, empty AppState — 8 untouched tracks at 90 BPM.
// ABOUTME: Pure function so callers can rely on independent objects between calls.
import type { AppState, Track } from "../types";

const TRACK_COUNT = 8;
export const DEFAULT_STEP_COUNT = 16;
export const STEP_COUNT_INCREMENT = 4;
export const MIN_STEP_COUNT = 4;
export const MAX_STEP_COUNT = 64;

export const VIDEO_DEVICE_STORAGE_KEY = "hyperactive-amateur-video-device";
export const AUDIO_DEVICE_STORAGE_KEY = "hyperactive-amateur-audio-device";

function readStoredDeviceId(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(key);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

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
      vibe: "tight",
      stepCount: DEFAULT_STEP_COUNT,
      tagReasoning: {},
      tracks: Array.from({ length: TRACK_COUNT }, (_, i) =>
        createEmptyTrack(i, DEFAULT_STEP_COUNT),
      ),
    },
    playback: {
      isPlaying: false,
      audioState: "unknown",
      isExporting: false,
      currentStep: 0,
      activeTriggers: [],
      triggerSeq: new Array(TRACK_COUNT).fill(0),
    },
    recording: {
      activeTrackId: null,
      countdownEndsAt: null,
      error: null,
      state: "idle",
    },
    ui: {
      selectedTrackId: null,
      showExportDialog: false,
      recoveryWarnings: [],
    },
    media: {
      stream: null,
      status: "idle",
      error: null,
      videoDeviceId: readStoredDeviceId(VIDEO_DEVICE_STORAGE_KEY),
      audioDeviceId: readStoredDeviceId(AUDIO_DEVICE_STORAGE_KEY),
      videoFacingMode: "user",
    },
    session: {
      projectRevision: 0,
      manuallyToggledShowVideo: [],
      manuallyTagged: [],
      recordingStationDismissed: false,
    },
  };
}
