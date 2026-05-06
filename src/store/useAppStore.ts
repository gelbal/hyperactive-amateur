// ABOUTME: Zustand store for Hyperpad — holds AppState and the actions that mutate it.
// ABOUTME: Actions are co-located under state.actions so selectors stay stable.
import { create } from "zustand";
import type { AppState, Clip, CutSubdivision, MediaStatus, RecordingState, Tag } from "../types";
import { createInitialState } from "./initialState";

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export interface AppActions {
  toggleStep: (trackId: number, stepIndex: number) => void;
  setBpm: (bpm: number) => void;
  setSwing: (swing: number) => void;
  setCutSubdivision: (value: CutSubdivision) => void;
  setSameTierHoldMs: (ms: number) => void;
  setTrackVolume: (trackId: number, volume: number) => void;
  setTrackMuted: (trackId: number, muted: boolean) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentStep: (step: number) => void;
  markTriggered: (trackId: number) => void;
  setTrackClip: (trackId: number, clip: Clip) => void;
  clearTrackClip: (trackId: number) => void;
  setTrackTag: (trackId: number, tag: Tag | null) => void;
  setTrackShowVideo: (
    trackId: number,
    showVideo: boolean,
    source?: "user" | "system",
  ) => void;
  setMedia: (next: { stream: MediaStream | null; status: MediaStatus; error: string | null }) => void;
  setRecordingState: (state: RecordingState, activeTrackId?: number | null) => void;
  hydrateProject: (project: AppState["project"]) => void;
  applyPattern: (grid: boolean[][]) => void;
  reset: () => void;
}

export type AppStore = AppState & { actions: AppActions };

export const useAppStore = create<AppStore>((set) => ({
  ...createInitialState(),
  actions: {
    toggleStep: (trackId, stepIndex) =>
      set((state) => ({
        project: {
          ...state.project,
          tracks: state.project.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  steps: track.steps.map((s, i) => (i === stepIndex ? !s : s)),
                }
              : track,
          ),
        },
      })),

    setBpm: (bpm) =>
      set((state) => ({
        project: { ...state.project, bpm: clamp(bpm, 60, 180) },
      })),

    setSwing: (swing) =>
      set((state) => ({
        project: { ...state.project, swing: clamp(swing, 0, 1) },
      })),

    setCutSubdivision: (value) =>
      set((state) => ({ project: { ...state.project, cutSubdivision: value } })),

    setSameTierHoldMs: (ms) =>
      set((state) => ({
        project: { ...state.project, sameTierHoldMs: clamp(ms, 0, 2000) },
      })),

    setTrackVolume: (trackId, volume) =>
      set((state) => ({
        project: {
          ...state.project,
          tracks: state.project.tracks.map((track) =>
            track.id === trackId ? { ...track, volume: clamp(volume, 0, 1) } : track,
          ),
        },
      })),

    setTrackMuted: (trackId, muted) =>
      set((state) => ({
        project: {
          ...state.project,
          tracks: state.project.tracks.map((track) =>
            track.id === trackId ? { ...track, muted } : track,
          ),
        },
      })),

    setIsPlaying: (playing) =>
      set((state) => ({ playback: { ...state.playback, isPlaying: playing } })),

    setCurrentStep: (step) =>
      set((state) => ({ playback: { ...state.playback, currentStep: step } })),

    markTriggered: (trackId) =>
      set((state) => ({
        playback: {
          ...state.playback,
          triggerSeq: state.playback.triggerSeq.map((v, i) => (i === trackId ? v + 1 : v)),
        },
      })),

    setTrackClip: (trackId, clip) =>
      set((state) => {
        const previous = state.project.tracks[trackId]?.clip;
        if (previous && previous.url && previous.url !== clip.url) {
          // Avoid leaking object URLs when a clip is replaced.
          URL.revokeObjectURL(previous.url);
        }
        return {
          project: {
            ...state.project,
            tracks: state.project.tracks.map((track) =>
              track.id === trackId ? { ...track, clip } : track,
            ),
          },
        };
      }),

    clearTrackClip: (trackId) =>
      set((state) => {
        const previous = state.project.tracks[trackId]?.clip;
        if (previous && previous.url) URL.revokeObjectURL(previous.url);
        return {
          project: {
            ...state.project,
            tracks: state.project.tracks.map((track) =>
              track.id === trackId ? { ...track, clip: null } : track,
            ),
          },
        };
      }),

    setTrackTag: (trackId, tag) =>
      set((state) => ({
        project: {
          ...state.project,
          tracks: state.project.tracks.map((track) =>
            track.id === trackId ? { ...track, tag } : track,
          ),
        },
      })),

    setTrackShowVideo: (trackId, showVideo, source = "user") =>
      set((state) => {
        const next = state.project.tracks.map((track) =>
          track.id === trackId ? { ...track, showVideo } : track,
        );
        const session =
          source === "user" && !state.session.manuallyToggledShowVideo.includes(trackId)
            ? {
                ...state.session,
                manuallyToggledShowVideo: [...state.session.manuallyToggledShowVideo, trackId],
              }
            : state.session;
        return { project: { ...state.project, tracks: next }, session };
      }),

    setMedia: (next) => set({ media: next }),

    setRecordingState: (recordingState, activeTrackId) =>
      set((state) => ({
        recording: {
          state: recordingState,
          activeTrackId: activeTrackId === undefined ? state.recording.activeTrackId : activeTrackId,
        },
      })),

    hydrateProject: (project) => set({ project }),

    applyPattern: (grid) =>
      set((state) => {
        if (!Array.isArray(grid) || grid.length !== 8) return state;
        return {
          project: {
            ...state.project,
            tracks: state.project.tracks.map((track, i) => {
              const row = grid[i];
              if (!Array.isArray(row) || row.length !== 16) return track;
              return { ...track, steps: row.map(Boolean) };
            }),
          },
        };
      }),

    reset: () => set({ ...createInitialState() }),
  },
}));
