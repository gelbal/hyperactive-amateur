// ABOUTME: Zustand store for Hyperpad — holds AppState and the actions that mutate it.
// ABOUTME: Actions are co-located under state.actions so selectors stay stable.
import { create } from "zustand";
import type { AppState } from "../types";
import { createInitialState } from "./initialState";

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export interface AppActions {
  toggleStep: (trackId: number, stepIndex: number) => void;
  setBpm: (bpm: number) => void;
  setSwing: (swing: number) => void;
  setTrackVolume: (trackId: number, volume: number) => void;
  setTrackMuted: (trackId: number, muted: boolean) => void;
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

    reset: () => set({ ...createInitialState() }),
  },
}));
