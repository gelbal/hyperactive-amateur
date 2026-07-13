// ABOUTME: Zustand store for Hyperactive Amateur — holds AppState and the actions that mutate it.
// ABOUTME: Actions are co-located under state.actions so selectors stay stable.
import { create } from "zustand";
import type {
  AppMode,
  AppState,
  Clip,
  CutSubdivision,
  MediaStatus,
  MoodPiece,
  MoodPart,
  MoodSelectionCommit,
  MoodSelectionEntry,
  MoodStageId,
  MoodTake,
  MoodTimeFeel,
  RecordingState,
  RecoveryWarningScope,
  StorageDurability,
  Subgenre,
  Tag,
  Vibe,
} from "../types";
import { clearProject } from "../lib/persistence";
import { acquireRecordingStream, isAcquireInFlight } from "../lib/media";
import { releaseMediaStream } from "../lib/streamLifecycle";
import { LOG_EVENTS, logger } from "../lib/logger";
import {
  createEmptyMoodPiece,
  establishCycleFromClick,
  establishCycleFromTake,
  MAX_TAKES_PER_MIC,
  STAGE_DESCRIPTORS,
} from "../lib/moodStages";
import {
  APP_MODE_STORAGE_KEY,
  AUDIO_DEVICE_STORAGE_KEY,
  createIdleMoodPerformance,
  createInitialState,
  MAX_STEP_COUNT,
  MIN_STEP_COUNT,
  STEP_COUNT_INCREMENT,
  VIDEO_DEVICE_STORAGE_KEY,
} from "./initialState";

function persistDeviceId(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // localStorage may be disabled in private mode; persistence is best-effort.
  }
}

function persistAppMode(mode: AppMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(APP_MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage may be disabled in private mode; persistence is best-effort.
  }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function omitKey<V>(obj: Record<number, V>, key: number): Record<number, V> {
  const out: Record<number, V> = {};
  for (const k of Object.keys(obj)) {
    const id = Number(k);
    if (id !== key) out[id] = obj[id];
  }
  return out;
}

function bumpProjectRevision(session: AppState["session"]): AppState["session"] {
  return { ...session, projectRevision: session.projectRevision + 1 };
}

function bumpMoodRevision(session: AppState["session"]): AppState["session"] {
  return { ...session, moodRevision: session.moodRevision + 1 };
}

function createMoodPerformanceForPiece(piece: MoodPiece): AppState["mood"]["performance"] {
  const selections: Record<string, MoodSelectionEntry> = {};
  const armed: Record<string, MoodSelectionEntry | null> = {};
  for (const mic of piece.mics) {
    selections[mic.id] = "off";
    armed[mic.id] = null;
  }
  return {
    ...createIdleMoodPerformance(),
    selections,
    armed,
  };
}

function uniqueRecoveryScopes(scopes: RecoveryWarningScope[]): RecoveryWarningScope[] {
  const out: RecoveryWarningScope[] = [];
  for (const scope of scopes) {
    if (!out.includes(scope)) out.push(scope);
  }
  return out;
}

function setRecoveryWarningsForScopeState(
  ui: AppState["ui"],
  scope: RecoveryWarningScope,
  warnings: string[],
  degraded: boolean,
): AppState["ui"] {
  const recoveryWarnings = ui.recoveryWarnings.filter(
    (_warning, index) => ui.recoveryWarningScopes[index] !== scope,
  );
  const recoveryWarningScopes = ui.recoveryWarningScopes.filter(
    (candidate) => candidate !== scope,
  );
  recoveryWarnings.push(...warnings);
  recoveryWarningScopes.push(...warnings.map(() => scope));
  const withoutScope = ui.degradedRecoveryScopes.filter((candidate) => candidate !== scope);
  const degradedRecoveryScopes =
    degraded && warnings.length > 0 ? uniqueRecoveryScopes([...withoutScope, scope]) : withoutScope;
  return {
    ...ui,
    recoveryWarnings,
    recoveryWarningScopes,
    degradedRecoveryScopes,
  };
}

function clearRecoveryWarningsState(
  ui: AppState["ui"],
  scope?: RecoveryWarningScope,
): AppState["ui"] {
  if (!scope) {
    return {
      ...ui,
      recoveryWarnings: [],
      recoveryWarningScopes: [],
      degradedRecoveryScopes: [],
    };
  }
  return {
    ...ui,
    recoveryWarnings: ui.recoveryWarnings.filter(
      (_warning, index) => ui.recoveryWarningScopes[index] !== scope,
    ),
    recoveryWarningScopes: ui.recoveryWarningScopes.filter(
      (candidate) => candidate !== scope,
    ),
    degradedRecoveryScopes: ui.degradedRecoveryScopes.filter(
      (candidate) => candidate !== scope,
    ),
  };
}

function hasPositiveBpm(bpm: number | undefined): bpm is number {
  return typeof bpm === "number" && Number.isFinite(bpm) && bpm > 0;
}

function establishCycleForTake(piece: MoodPiece, take: MoodTake): number {
  if (piece.timeFeel === "click" && piece.bpm !== null && piece.cycleBars !== null) {
    return establishCycleFromClick(piece.bpm, piece.cycleBars);
  }
  return establishCycleFromTake(take.durationSeconds);
}

function revokeMoodTakeObjectUrls(take: MoodTake): void {
  if (take.url) URL.revokeObjectURL(take.url);
  if (take.posterUrl) URL.revokeObjectURL(take.posterUrl);
}

function revokeMoodPieceObjectUrls(piece: MoodPiece): void {
  for (const mic of piece.mics) {
    for (const take of mic.takes) {
      revokeMoodTakeObjectUrls(take);
    }
  }
}

function clearMoodTakePerformanceRefs(
  performance: AppState["mood"]["performance"],
  takeId: string,
): AppState["mood"]["performance"] {
  let selections = performance.selections;
  let armed = performance.armed;

  for (const [micId, entry] of Object.entries(performance.selections)) {
    if (entry === takeId) {
      if (selections === performance.selections) selections = { ...performance.selections };
      selections[micId] = "off";
    }
  }

  for (const [micId, entry] of Object.entries(performance.armed)) {
    if (entry === takeId) {
      if (armed === performance.armed) armed = { ...performance.armed };
      armed[micId] = "off";
    }
  }

  return selections === performance.selections && armed === performance.armed
    ? performance
    : { ...performance, selections, armed };
}

export interface AppActions {
  setAppMode: (mode: AppMode) => void;
  setMoodHydration: (hydration: AppState["mood"]["hydration"]) => void;
  hydrateMoodPiece: (result: {
    ok: boolean;
    degraded: boolean;
    piece: MoodPiece | null;
    warnings: string[];
  }) => void;
  createMoodPiece: (
    stage: MoodStageId,
    timeFeel: MoodTimeFeel,
    opts?: { bpm?: number; cycleBars?: NonNullable<MoodPiece["cycleBars"]> },
  ) => void;
  scratchMoodPiece: () => void;
  setMoodPerforming: (isPerforming: boolean, epoch?: number | null) => void;
  armMoodSelection: (micId: string, entry: MoodSelectionEntry) => void;
  commitMoodSelections: (dueArms: MoodSelectionCommit[]) => void;
  setMoodDrop: (dropActive: boolean) => void;
  setMoodHotMic: (micId: string | null) => void;
  setMoodCycleCount: (cycleCount: number) => void;
  setMoodTake: (micId: string, take: MoodTake) => void;
  attachMoodTakePoster: (
    micId: string,
    takeId: string,
    posterBlob: Blob | null,
    posterUrl: string | null,
  ) => void;
  deleteMoodTake: (micId: string, takeId: string) => void;
  applyMoodSyncOffsetIfCurrent: (
    micId: string,
    takeId: string,
    offsetMs: number,
    expectedRevision: number,
  ) => boolean;
  applyMoodPartIfCurrent: (
    micId: string,
    takeId: string,
    part: MoodPart | null,
    source: "ai" | "user",
    expectedRevision: number,
  ) => boolean;
  toggleStep: (trackId: number, stepIndex: number) => void;
  setBpm: (bpm: number) => void;
  setSwing: (swing: number) => void;
  setCutSubdivision: (value: CutSubdivision) => void;
  setSameTierHoldMs: (ms: number) => void;
  setSubgenre: (value: Subgenre) => void;
  setVibe: (value: Vibe) => void;
  extendSteps: () => void;
  removeStepColumn: (stepIndex: number) => void;
  setTrackVolume: (trackId: number, volume: number) => void;
  setTrackMuted: (trackId: number, muted: boolean) => void;
  setIsPlaying: (playing: boolean) => void;
  setAudioState: (audioState: AppState["playback"]["audioState"]) => void;
  setIsExporting: (exporting: boolean) => void;
  setCurrentStep: (step: number) => void;
  markTriggered: (trackId: number) => void;
  setTrackClip: (trackId: number, clip: Clip) => void;
  setTrackPoster: (trackId: number, posterBlob: Blob | null, expectedClip?: Clip) => void;
  restoreTrackAudio: (
    trackId: number,
    audioBuffer: AudioBuffer,
    audioBlob?: Blob | null,
    expectedClip?: Clip,
  ) => void;
  restoreMoodTakeAudio: (
    micId: string,
    takeId: string,
    audioBuffer: AudioBuffer,
    audioBlob?: Blob | null,
    expectedTake?: MoodTake,
  ) => void;
  clearTrackClip: (trackId: number) => void;
  setTrackTag: (
    trackId: number,
    tag: Tag | null,
    source?: "user" | "system",
  ) => void;
  setTrackTagReasoning: (trackId: number, reasoning: string | null) => void;
  setTrackShowVideo: (
    trackId: number,
    showVideo: boolean,
    source?: "user" | "system",
  ) => void;
  setRecoveryWarnings: (warnings: string[]) => void;
  setRecoveryWarningsForScope: (
    scope: RecoveryWarningScope,
    warnings: string[],
    degraded: boolean,
  ) => void;
  clearRecoveryWarnings: (scope?: RecoveryWarningScope) => void;
  setStorageDurability: (durability: StorageDurability) => void;
  setMedia: (next: { stream: MediaStream | null; status: MediaStatus; error: string | null }) => void;
  setPreferredDevices: (next: { video?: string | null; audio?: string | null }) => void;
  setVideoFacingMode: (mode: "user" | "environment") => void;
  toggleVideoFacingMode: () => void;
  resumeMedia: () => Promise<void>;
  setRecordingState: (state: RecordingState, activeTrackId?: number | null) => void;
  setCountdownEndsAt: (deadline: number | null) => void;
  setRecordingError: (error: string | null) => void;
  hydrateProject: (project: AppState["project"], manuallyTagged?: number[]) => void;
  applyPattern: (grid: boolean[][]) => void;
  applyPatternIfCurrent: (
    grid: boolean[][],
    expectedProjectRevision: number,
    expectedStepCount: number,
  ) => boolean;
  dismissRecordingStation: () => void;
  reopenRecordingStation: () => void;
  scratch: () => void;
  reset: () => void;
}

export type AppStore = AppState & { actions: AppActions };

export const selectClipCount = (s: AppStore): number =>
  s.project.tracks.reduce((n, t) => (t.clip ? n + 1 : n), 0);

export const useAppStore = create<AppStore>((set) => ({
  ...createInitialState(),
  actions: {
    setAppMode: (mode) => {
      set((state) => {
        if (state.playback.isExporting) return state;
        persistAppMode(mode);
        return {
          appMode: mode,
          mood: {
            ...state.mood,
            performance: state.mood.piece
              ? createMoodPerformanceForPiece(state.mood.piece)
              : createIdleMoodPerformance(),
          },
        };
      });
    },

    setMoodHydration: (hydration) =>
      set((state) => ({
        mood: {
          ...state.mood,
          hydration,
        },
      })),

    hydrateMoodPiece: (result) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        if (state.mood.piece && state.mood.piece !== result.piece) {
          revokeMoodPieceObjectUrls(state.mood.piece);
        }
        const piece = result.piece;
        return {
          mood: {
            piece,
            hydration: "ready",
            performance: piece
              ? createMoodPerformanceForPiece(piece)
              : createIdleMoodPerformance(),
          },
          ui: setRecoveryWarningsForScopeState(
            state.ui,
            "mood",
            result.warnings,
            result.degraded,
          ),
        };
      }),

    createMoodPiece: (stage, timeFeel, opts) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        if (timeFeel === "click" && !hasPositiveBpm(opts?.bpm)) {
          logger.warn(LOG_EVENTS.MOOD_CLICK_BPM_REJECTED, {
            stage,
            bpm: opts?.bpm ?? null,
          });
          return state;
        }
        if (state.mood.piece) {
          revokeMoodPieceObjectUrls(state.mood.piece);
        }
        const piece = createEmptyMoodPiece(stage, timeFeel, opts);
        return {
          mood: {
            piece,
            hydration: "ready",
            performance: createMoodPerformanceForPiece(piece),
          },
          session: bumpMoodRevision(state.session),
        };
      }),

    scratchMoodPiece: () =>
      set((state) => {
        if (state.playback.isExporting || state.mood.performance.isPerforming) return state;
        if (!state.mood.piece) return state;
        revokeMoodPieceObjectUrls(state.mood.piece);
        return {
          mood: {
            piece: null,
            hydration: "ready",
            performance: createIdleMoodPerformance(),
          },
          session: bumpMoodRevision(state.session),
        };
      }),

    setMoodPerforming: (isPerforming, epoch = null) =>
      set((state) => ({
        mood: {
          ...state.mood,
          performance: isPerforming
            ? {
                ...state.mood.performance,
                isPerforming: true,
                epoch,
                dropActive: false,
                hotMicId: null,
                cycleCount: 0,
              }
            : createIdleMoodPerformance(),
        },
      })),

    armMoodSelection: (micId, entry) =>
      set((state) => ({
        mood: {
          ...state.mood,
          performance: {
            ...state.mood.performance,
            armed: { ...state.mood.performance.armed, [micId]: entry },
          },
        },
      })),

    commitMoodSelections: (dueArms) =>
      set((state) => {
        if (dueArms.length === 0) return state;
        const selections = { ...state.mood.performance.selections };
        const armed = { ...state.mood.performance.armed };
        for (const { micId, entry } of dueArms) {
          selections[micId] = entry;
          armed[micId] = null;
        }
        return {
          mood: {
            ...state.mood,
            performance: {
              ...state.mood.performance,
              selections,
              armed,
            },
          },
        };
      }),

    setMoodDrop: (dropActive) =>
      set((state) => ({
        mood: {
          ...state.mood,
          performance: { ...state.mood.performance, dropActive },
        },
      })),

    setMoodHotMic: (hotMicId) =>
      set((state) => ({
        mood: {
          ...state.mood,
          performance: { ...state.mood.performance, hotMicId },
        },
      })),

    setMoodCycleCount: (cycleCount) =>
      set((state) => ({
        mood: {
          ...state.mood,
          performance: { ...state.mood.performance, cycleCount },
        },
      })),

    setMoodTake: (micId, take) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        const piece = state.mood.piece;
        if (!piece) return state;
        const micIndex = piece.mics.findIndex((mic) => mic.id === micId);
        if (micIndex === -1) return state;
        const mic = piece.mics[micIndex];
        if (mic.takes.length >= MAX_TAKES_PER_MIC) {
          logger.warn(LOG_EVENTS.MOOD_TAKE_LIMIT_REJECTED, {
            micId,
            takeId: take.id,
            maxTakes: MAX_TAKES_PER_MIC,
          });
          return state;
        }

        let mics = piece.mics.map((candidate, index) =>
          index === micIndex ? { ...candidate, takes: [...candidate.takes, take] } : candidate,
        );
        let performance = state.mood.performance;
        const descriptor = STAGE_DESCRIPTORS[piece.stage];
        if (
          descriptor.linearAxis &&
          mics.length < descriptor.maxMics &&
          mics.every((candidate) => candidate.takes.length > 0)
        ) {
          const nextMicId = `mic-${mics.length}`;
          mics = [...mics, { id: nextMicId, takes: [] }];
          performance = {
            ...performance,
            selections: { ...performance.selections, [nextMicId]: "off" },
            armed: { ...performance.armed, [nextMicId]: null },
          };
        }

        const cyclePatch =
          piece.cycleSeconds === null
            ? {
                cycleSeconds: establishCycleForTake(piece, take),
                oneMicId: micId,
                oneTakeId: take.id,
              }
            : {};

        return {
          mood: {
            ...state.mood,
            piece: {
              ...piece,
              ...cyclePatch,
              mics,
              updatedAt: Date.now(),
            },
            performance,
          },
          session: bumpMoodRevision(state.session),
        };
      }),

    attachMoodTakePoster: (micId, takeId, posterBlob, posterUrl) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        const piece = state.mood.piece;
        if (!piece) return state;
        let attached = false;
        const mics = piece.mics.map((mic) => {
          if (mic.id !== micId) return mic;
          const takes = mic.takes.map((take) => {
            if (take.id !== takeId) return take;
            attached = true;
            if (take.posterUrl && take.posterUrl !== posterUrl) {
              URL.revokeObjectURL(take.posterUrl);
            }
            return { ...take, posterBlob, posterUrl };
          });
          return attached ? { ...mic, takes } : mic;
        });
        if (!attached) return state;
        return {
          mood: {
            ...state.mood,
            piece: { ...piece, mics, updatedAt: Date.now() },
          },
        };
      }),

    deleteMoodTake: (micId, takeId) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        const piece = state.mood.piece;
        if (!piece) return state;
        let deleted: MoodTake | null = null;
        const mics = piece.mics.map((mic) => {
          if (mic.id !== micId) return mic;
          const takes = mic.takes.filter((take) => {
            if (take.id !== takeId) return true;
            deleted = take;
            return false;
          });
          return takes.length === mic.takes.length ? mic : { ...mic, takes };
        });
        if (!deleted) return state;

        revokeMoodTakeObjectUrls(deleted);
        const remainingTakeCount = mics.reduce((count, mic) => count + mic.takes.length, 0);
        const deletedTheOne = piece.oneMicId === micId && piece.oneTakeId === takeId;
        const onePatch =
          remainingTakeCount === 0
            ? { cycleSeconds: null, oneMicId: null, oneTakeId: null }
            : deletedTheOne
              ? { oneMicId: null, oneTakeId: null }
              : {};

        return {
          mood: {
            ...state.mood,
            piece: {
              ...piece,
              ...onePatch,
              mics,
              updatedAt: Date.now(),
            },
            performance: clearMoodTakePerformanceRefs(state.mood.performance, takeId),
          },
          session: bumpMoodRevision(state.session),
        };
      }),

    applyMoodSyncOffsetIfCurrent: (micId, takeId, offsetMs, expectedRevision) => {
      let applied = false;
      set((state) => {
        if (state.playback.isExporting) return state;
        if (state.session.moodRevision !== expectedRevision) return state;
        const piece = state.mood.piece;
        if (!piece) return state;
        let found = false;
        const mics = piece.mics.map((mic) => {
          if (mic.id !== micId) return mic;
          const takes = mic.takes.map((take) => {
            if (take.id !== takeId) return take;
            found = true;
            return { ...take, syncOffsetMs: offsetMs };
          });
          return found ? { ...mic, takes } : mic;
        });
        if (!found) return state;
        applied = true;
        return {
          mood: {
            ...state.mood,
            piece: { ...piece, mics, updatedAt: Date.now() },
          },
        };
      });
      return applied;
    },

    applyMoodPartIfCurrent: (micId, takeId, part, source, expectedRevision) => {
      let applied = false;
      set((state) => {
        if (state.playback.isExporting) return state;
        if (state.session.moodRevision !== expectedRevision) return state;
        const piece = state.mood.piece;
        if (!piece) return state;
        let found = false;
        let blockedByManualPart = false;
        const mics = piece.mics.map((mic) => {
          if (mic.id !== micId) return mic;
          const takes = mic.takes.map((take) => {
            if (take.id !== takeId) return take;
            found = true;
            if (source === "ai" && take.partSource === "user") {
              blockedByManualPart = true;
              return take;
            }
            return { ...take, part, partSource: source };
          });
          return found && !blockedByManualPart ? { ...mic, takes } : mic;
        });
        if (!found || blockedByManualPart) return state;
        applied = true;
        return {
          mood: {
            ...state.mood,
            piece: { ...piece, mics, updatedAt: Date.now() },
          },
        };
      });
      return applied;
    },

    toggleStep: (trackId, stepIndex) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        return {
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
          session: bumpProjectRevision(state.session),
        };
      }),

    setBpm: (bpm) =>
      set((state) =>
        state.playback.isExporting
          ? state
          : {
              project: { ...state.project, bpm: clamp(bpm, 60, 180) },
              session: bumpProjectRevision(state.session),
            },
      ),

    setSwing: (swing) =>
      set((state) =>
        state.playback.isExporting
          ? state
          : { project: { ...state.project, swing: clamp(swing, 0, 1) } },
      ),

    setCutSubdivision: (value) =>
      set((state) =>
        state.playback.isExporting
          ? state
          : { project: { ...state.project, cutSubdivision: value } },
      ),

    setSameTierHoldMs: (ms) =>
      set((state) =>
        state.playback.isExporting
          ? state
          : { project: { ...state.project, sameTierHoldMs: clamp(ms, 0, 2000) } },
      ),

    setSubgenre: (value) =>
      set((state) =>
        state.playback.isExporting
          ? state
          : {
              project: { ...state.project, subgenre: value },
              session: bumpProjectRevision(state.session),
            },
      ),

    setVibe: (value) =>
      set((state) =>
        state.playback.isExporting
          ? state
          : {
              project: { ...state.project, vibe: value },
              session: bumpProjectRevision(state.session),
            },
      ),

    extendSteps: () =>
      set((state) => {
        if (state.playback.isExporting) return state;
        const next = Math.min(MAX_STEP_COUNT, state.project.stepCount + STEP_COUNT_INCREMENT);
        if (next === state.project.stepCount) return state;
        const padding = next - state.project.stepCount;
        return {
          project: {
            ...state.project,
            stepCount: next,
            tracks: state.project.tracks.map((track) => ({
              ...track,
              steps: [...track.steps, ...new Array(padding).fill(false)],
            })),
          },
          session: bumpProjectRevision(state.session),
        };
      }),

    removeStepColumn: (stepIndex) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        if (state.project.stepCount <= MIN_STEP_COUNT) return state;
        if (stepIndex < 0 || stepIndex >= state.project.stepCount) return state;
        const removeStart = Math.floor(stepIndex / STEP_COUNT_INCREMENT) * STEP_COUNT_INCREMENT;
        const removeEnd = removeStart + STEP_COUNT_INCREMENT;
        const nextStepCount = Math.max(
          MIN_STEP_COUNT,
          state.project.stepCount - STEP_COUNT_INCREMENT,
        );
        if (nextStepCount === state.project.stepCount) return state;
        return {
          project: {
            ...state.project,
            stepCount: nextStepCount,
            tracks: state.project.tracks.map((track) => ({
              ...track,
              steps: track.steps.filter((_, i) => i < removeStart || i >= removeEnd),
            })),
          },
          session: bumpProjectRevision(state.session),
        };
      }),

    setTrackVolume: (trackId, volume) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        return {
          project: {
            ...state.project,
            tracks: state.project.tracks.map((track) =>
              track.id === trackId ? { ...track, volume: clamp(volume, 0, 1) } : track,
            ),
          },
        };
      }),

    setTrackMuted: (trackId, muted) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        return {
          project: {
            ...state.project,
            tracks: state.project.tracks.map((track) =>
              // A user mute toggle owns the state from then on: it clears any
              // repair-applied marker so re-record won't override the intent.
              track.id === trackId ? { ...track, muted, mutedByRepair: false } : track,
            ),
          },
        };
      }),

    setIsPlaying: (playing) =>
      set((state) => ({ playback: { ...state.playback, isPlaying: playing } })),

    setAudioState: (audioState) =>
      set((state) => ({ playback: { ...state.playback, audioState } })),

    setIsExporting: (exporting) =>
      set((state) => ({ playback: { ...state.playback, isExporting: exporting } })),

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
        if (state.playback.isExporting) return state;
        const previousTrack = state.project.tracks[trackId];
        const previous = previousTrack?.clip;
        if (previous && previous.url && previous.url !== clip.url) {
          // Avoid leaking object URLs when a clip is replaced.
          URL.revokeObjectURL(previous.url);
        }
        if (
          previous &&
          previous.posterUrl &&
          previous.posterUrl !== clip.posterUrl
        ) {
          URL.revokeObjectURL(previous.posterUrl);
        }
        // Reasoning describes the previous sound; a fresh recording on
        // the same track invalidates it until the next auto-tag pass.
        const tagReasoning =
          trackId in state.project.tagReasoning
            ? omitKey(state.project.tagReasoning, trackId)
            : state.project.tagReasoning;
        // Re-recording clears a mute only when the repair applied it (marked
        // mutedByRepair). A mute the user owns — on a healthy track or
        // re-applied after a repair — is kept.
        const clearRepairMute =
          previousTrack?.mutedByRepair === true && clip.audioStatus === "ok";
        return {
          project: {
            ...state.project,
            tagReasoning,
            tracks: state.project.tracks.map((track) =>
              track.id === trackId
                ? {
                    ...track,
                    clip,
                    muted: clearRepairMute ? false : track.muted,
                    mutedByRepair: false,
                    blobRevision: (track.blobRevision ?? 0) + 1,
                  }
                : track,
            ),
          },
          session: bumpProjectRevision(state.session),
        };
      }),

    setTrackPoster: (trackId, posterBlob, expectedClip) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        const current = state.project.tracks[trackId]?.clip;
        if (!current) return state;
        if (expectedClip && current !== expectedClip) return state;
        if (!posterBlob && !current.posterBlob && !current.posterUrl) return state;

        const posterUrl = posterBlob ? URL.createObjectURL(posterBlob) : null;
        if (current.posterUrl && current.posterUrl !== posterUrl) {
          URL.revokeObjectURL(current.posterUrl);
        }
        return {
          project: {
            ...state.project,
            tracks: state.project.tracks.map((track) =>
              track.id === trackId
                ? {
                    ...track,
                    blobRevision: (track.blobRevision ?? 0) + 1,
                    clip: { ...current, posterBlob, posterUrl },
                  }
                : track,
            ),
          },
        };
      }),

    // Heal a repair-state clip whose audio decoded successfully after the
    // fact (see lib/audioRepair.ts). Mirrors setTrackClip's repair-mute rule:
    // only a repair-owned mute is released; user mutes stay.
    restoreTrackAudio: (trackId, audioBuffer, audioBlob, expectedClip) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        const track = state.project.tracks[trackId];
        const clip = track?.clip;
        if (!clip || clip.audioStatus !== "unavailable") return state;
        // A repair decoded from a clip that has since been replaced must not
        // graft its audio onto the newer clip.
        if (expectedClip && clip !== expectedClip) return state;
        const nextClip: Clip = {
          ...clip,
          audioBuffer,
          audioStatus: "ok",
          audioBlob: audioBlob !== undefined ? audioBlob : (clip.audioBlob ?? null),
        };
        return {
          project: {
            ...state.project,
            tracks: state.project.tracks.map((t) =>
              t.id === trackId
                ? {
                    ...t,
                    clip: nextClip,
                    muted: t.mutedByRepair ? false : t.muted,
                    mutedByRepair: false,
                    // The audio sidecar reference may have changed — invalidate
                    // the persistence blob-reference cache for this track.
                    blobRevision: (t.blobRevision ?? 0) + 1,
                  }
                : t,
            ),
          },
          session: bumpProjectRevision(state.session),
        };
      }),

    restoreMoodTakeAudio: (micId, takeId, audioBuffer, audioBlob, expectedTake) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        const piece = state.mood.piece;
        if (!piece) return state;
        let restored = false;
        const mics = piece.mics.map((mic) => {
          if (mic.id !== micId) return mic;
          const takes = mic.takes.map((take) => {
            if (take.id !== takeId) return take;
            if (take.audioStatus !== "unavailable") return take;
            if (expectedTake && take !== expectedTake) return take;
            restored = true;
            return {
              ...take,
              audioBuffer,
              audioStatus: "ok" as const,
              audioBlob: audioBlob !== undefined ? audioBlob : take.audioBlob,
            };
          });
          return restored ? { ...mic, takes } : mic;
        });
        if (!restored) return state;
        return {
          mood: {
            ...state.mood,
            piece: { ...piece, mics, updatedAt: Date.now() },
          },
          session: bumpMoodRevision(state.session),
        };
      }),

    clearTrackClip: (trackId) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        const previous = state.project.tracks[trackId]?.clip;
        if (previous && previous.url) URL.revokeObjectURL(previous.url);
        if (previous && previous.posterUrl) URL.revokeObjectURL(previous.posterUrl);
        const tagReasoning =
          trackId in state.project.tagReasoning
            ? omitKey(state.project.tagReasoning, trackId)
            : state.project.tagReasoning;
        return {
          project: {
            ...state.project,
            tagReasoning,
            tracks: state.project.tracks.map((track) =>
              track.id === trackId
                ? { ...track, clip: null, blobRevision: (track.blobRevision ?? 0) + 1 }
                : track,
            ),
          },
          // Re-recording a track means the user wants the station back. Without
          // this, "Re-record" on a fully-finished project would clear the clip
          // but leave the empty-slot UI invisible until the user finds the
          // "Record more" pill.
          session: {
            ...bumpProjectRevision(state.session),
            recordingStationDismissed: false,
          },
        };
      }),

    setTrackTag: (trackId, tag, source = "user") =>
      set((state) => {
        if (state.playback.isExporting) return state;
        const prevTrack = state.project.tracks[trackId];
        const tagUnchanged = prevTrack?.tag === tag;
        const wouldClaim =
          source === "user" && !state.session.manuallyTagged.includes(trackId);
        const wouldClearReasoning =
          source === "user" && trackId in state.project.tagReasoning;
        if (tagUnchanged && !wouldClaim && !wouldClearReasoning) return state;

        // User-driven picks claim the track from future auto-tag passes
        // and invalidate any prior reasoning string (the chip picker has
        // no idea why the model picked what it picked).
        let project = tagUnchanged
          ? state.project
          : {
              ...state.project,
              tracks: state.project.tracks.map((track) =>
                track.id === trackId ? { ...track, tag } : track,
              ),
            };
        let session = state.session;
        if (wouldClaim) {
          session = {
            ...session,
            manuallyTagged: [...session.manuallyTagged, trackId],
          };
        }
        if (wouldClearReasoning) {
          project = { ...project, tagReasoning: omitKey(project.tagReasoning, trackId) };
        }
        return { project, session: bumpProjectRevision(session) };
      }),

    setTrackTagReasoning: (trackId, reasoning) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        const current = state.project.tagReasoning;
        if (reasoning === null || reasoning === "") {
          if (!(trackId in current)) return state;
          return {
            project: { ...state.project, tagReasoning: omitKey(current, trackId) },
            session: bumpProjectRevision(state.session),
          };
        }
        if (current[trackId] === reasoning) return state;
        return {
          project: {
            ...state.project,
            tagReasoning: { ...current, [trackId]: reasoning },
          },
          session: bumpProjectRevision(state.session),
        };
      }),

    setTrackShowVideo: (trackId, showVideo, source = "user") =>
      set((state) => {
        if (state.playback.isExporting) return state;
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

    setRecoveryWarnings: (warnings) =>
      set((state) => ({
        ui: {
          ...state.ui,
          recoveryWarnings: [...warnings],
          recoveryWarningScopes: warnings.map(() => "chop" as const),
          degradedRecoveryScopes: warnings.length > 0 ? ["chop"] : [],
        },
      })),

    setRecoveryWarningsForScope: (scope, warnings, degraded) =>
      set((state) => ({
        ui: setRecoveryWarningsForScopeState(state.ui, scope, warnings, degraded),
      })),

    clearRecoveryWarnings: (scope) =>
      set((state) => ({ ui: clearRecoveryWarningsState(state.ui, scope) })),

    setStorageDurability: (storageDurability) =>
      set((state) => ({ session: { ...state.session, storageDurability } })),

    setMedia: (next) =>
      set((state) => ({
        media: {
          ...next,
          videoDeviceId: state.media.videoDeviceId,
          audioDeviceId: state.media.audioDeviceId,
          videoFacingMode: state.media.videoFacingMode,
        },
      })),

    setPreferredDevices: (next) =>
      set((state) => {
        const videoDeviceId =
          next.video === undefined ? state.media.videoDeviceId : next.video;
        const audioDeviceId =
          next.audio === undefined ? state.media.audioDeviceId : next.audio;
        if (next.video !== undefined)
          persistDeviceId(VIDEO_DEVICE_STORAGE_KEY, videoDeviceId);
        if (next.audio !== undefined)
          persistDeviceId(AUDIO_DEVICE_STORAGE_KEY, audioDeviceId);
        return { media: { ...state.media, videoDeviceId, audioDeviceId } };
      }),

    setVideoFacingMode: (mode) =>
      set((state) => ({ media: { ...state.media, videoFacingMode: mode } })),

    toggleVideoFacingMode: () =>
      set((state) => {
        persistDeviceId(VIDEO_DEVICE_STORAGE_KEY, null);
        return {
          media: {
            ...state.media,
            videoDeviceId: null,
            videoFacingMode: state.media.videoFacingMode === "user" ? "environment" : "user",
          },
        };
      }),

    // Re-acquire after a "suspended" transition (track ended, page resumed,
    // recorder died). media.ts ↔ useAppStore.ts is a circular import, but ESM
    // hoists the static binding and we only invoke acquireRecordingStream
    // lazily inside the action body — by which time both modules are loaded.
    // On success acquireRecordingStream flips status to "granted"; on failure
    // it flips to "denied" and we let the gate take over.
    resumeMedia: async () => {
      if (useAppStore.getState().recording.state !== "idle") return;
      if (isAcquireInFlight()) return;
      try {
        await acquireRecordingStream();
      } catch {
        // Status already set inside acquireRecordingStream's catch path.
      }
    },

    setRecordingState: (recordingState, activeTrackId) =>
      set((state) => ({
        recording: {
          ...state.recording,
          state: recordingState,
          activeTrackId: activeTrackId === undefined ? state.recording.activeTrackId : activeTrackId,
          countdownEndsAt:
            recordingState === "preparing" ? null : state.recording.countdownEndsAt,
          error: recordingState === "preparing" ? null : state.recording.error,
        },
      })),

    setCountdownEndsAt: (deadline) =>
      set((state) => ({
        recording: { ...state.recording, countdownEndsAt: deadline },
      })),

    setRecordingError: (error) =>
      set((state) => ({
        recording: { ...state.recording, error },
      })),

    dismissRecordingStation: () =>
      set((state) => ({ session: { ...state.session, recordingStationDismissed: true } })),

    reopenRecordingStation: () =>
      set((state) => ({ session: { ...state.session, recordingStationDismissed: false } })),

    hydrateProject: (project, manuallyTagged) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        // If the rehydrated project has any recorded clip, the user is past
        // the first-recording walkthrough; suppress the in-viewport station
        // (and its permission gate) on reload until they explicitly opt back
        // in via "Record more" or "Re-record".
        const hasAnyClip = project.tracks.some((t) => t.clip);
        const normalizedProject = {
          ...project,
          tracks: project.tracks.map((track) => ({
            ...track,
            blobRevision: track.blobRevision ?? 0,
          })),
        };
        return {
          project: normalizedProject,
          // Persisted tagSource restores manual tag ownership so auto-tag
          // passes keep skipping user-tagged tracks after a reload.
          session: {
            ...bumpProjectRevision(state.session),
            ...(manuallyTagged ? { manuallyTagged: [...manuallyTagged] } : {}),
            ...(hasAnyClip ? { recordingStationDismissed: true } : {}),
          },
        };
      }),

    applyPattern: (grid) =>
      set((state) => {
        if (state.playback.isExporting) return state;
        if (!Array.isArray(grid) || grid.length !== 8) return state;
        const expectedLen = state.project.stepCount;
        let changed = false;
        return {
          project: {
            ...state.project,
            tracks: state.project.tracks.map((track, i) => {
              const row = grid[i];
              if (!Array.isArray(row) || row.length !== expectedLen) return track;
              if (!changed) {
                changed = row.some((step, j) => Boolean(step) !== track.steps[j]);
              }
              return { ...track, steps: row.map(Boolean) };
            }),
          },
          session: changed ? bumpProjectRevision(state.session) : state.session,
        };
      }),

    applyPatternIfCurrent: (grid, expectedProjectRevision, expectedStepCount) => {
      let applied = false;
      set((state) => {
        if (state.playback.isExporting) return state;
        if (
          state.session.projectRevision !== expectedProjectRevision ||
          state.project.stepCount !== expectedStepCount
        ) {
          return state;
        }
        if (!Array.isArray(grid) || grid.length !== 8) return state;
        const expectedLen = state.project.stepCount;
        if (!grid.every((row) => Array.isArray(row) && row.length === expectedLen)) {
          return state;
        }
        applied = true;
        return {
          project: {
            ...state.project,
            tracks: state.project.tracks.map((track, i) => ({
              ...track,
              steps: grid[i].map(Boolean),
            })),
          },
          session: bumpProjectRevision(state.session),
        };
      });
      return applied;
    },

    scratch: () => {
      const state = useAppStore.getState();
      if (state.playback.isExporting) return;
      // Revoke object URLs on every existing clip.
      for (const track of state.project.tracks) {
        if (track.clip?.url) URL.revokeObjectURL(track.clip.url);
        if (track.clip?.posterUrl) URL.revokeObjectURL(track.clip.posterUrl);
      }
      // Stop any held media stream so getUserMedia is re-armed cleanly.
      if (state.media.stream) {
        releaseMediaStream(state.media.stream);
      }
      const next = createInitialState();
      set({
        ...next,
        session: {
          ...next.session,
          projectRevision: state.session.projectRevision + 1,
        },
      });
      // Wipe the persisted record; subsequent edits will write a fresh one.
      void clearProject().catch(() => undefined);
    },

    reset: () =>
      set((state) => {
        if (state.playback.isExporting) return state;
        const next = createInitialState();
        return {
          ...next,
          session: {
            ...next.session,
            projectRevision: state.session.projectRevision + 1,
          },
        };
      }),
  },
}));
