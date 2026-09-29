// ABOUTME: Zustand Mood slice factory — holds initial Mood state and its action map.
// ABOUTME: Receives store mutation hooks so the root store remains a single composed state.
import type {
  AppMode,
  AppState,
  MoodArtDirection,
  MoodLens,
  MoodCredits,
  MoodKeyEstimate,
  MoodPart,
  MoodPiece,
  MoodSelectionCommit,
  MoodSelectionEntry,
  MoodSlice,
  MoodStageId,
  MoodTake,
  MoodTimeFeel,
  MoodVibeId,
} from "../types";
import { LOG_EVENTS, logger } from "../lib/logger";
import { resetMoodDropFilter } from "../lib/moodFx";
import { evictMoodPosters } from "../lib/moodPosterCache";
import {
  clampCreditStyleIndex,
  CREDIT_NAME_MAX_LENGTH,
  CREDIT_STYLES,
} from "../lib/moodCredits";
import {
  createEmptyMoodPiece,
  establishCycleFromClick,
  establishCycleFromTake,
  MAX_TAKES_PER_MIC,
  STAGE_DESCRIPTORS,
} from "../lib/moodStages";

export const APP_MODE_STORAGE_KEY = "ha:lastMode";
export const MOOD_HEADPHONES_STORAGE_KEY = "ha:mood:headphones";

function readStoredMoodHeadphones(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MOOD_HEADPHONES_STORAGE_KEY) === "1";
  } catch {
    return false;
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

function persistMoodHeadphones(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(MOOD_HEADPHONES_STORAGE_KEY, "1");
    else window.localStorage.removeItem(MOOD_HEADPHONES_STORAGE_KEY);
  } catch {
    // localStorage may be disabled in private mode; persistence is best-effort.
  }
}

function bumpMoodRevision(session: AppState["session"]): AppState["session"] {
  return { ...session, moodRevision: session.moodRevision + 1 };
}

function startMoodPieceSession(session: AppState["session"]): AppState["session"] {
  return {
    ...session,
    moodRevision: session.moodRevision + 1,
    moodSessionId: session.moodSessionId + 1,
  };
}

function replaceMoodPieceSession(session: AppState["session"]): AppState["session"] {
  return { ...session, moodSessionId: session.moodSessionId + 1 };
}

function patchMoodTake(
  piece: MoodPiece,
  micId: string,
  takeId: string,
  patch: (take: MoodTake) => MoodTake | null,
): { mics: MoodPiece["mics"]; found: boolean } {
  let found = false;
  const mics = piece.mics.map((mic) => {
    if (mic.id !== micId) return mic;
    let patched = false;
    const takes = mic.takes.map((take) => {
      if (take.id !== takeId) return take;
      const nextTake = patch(take);
      if (!nextTake) return take;
      found = true;
      patched = true;
      return nextTake;
    });
    return patched ? { ...mic, takes } : mic;
  });
  return { mics, found };
}

function createMoodPerformanceForPiece(piece: MoodPiece): AppState["mood"]["performance"] {
  const selections: Record<string, MoodSelectionEntry> = {};
  const armed: Record<string, MoodSelectionEntry | null> = {};
  for (const mic of piece.mics) {
    let latestPlayableTake: MoodTake | null = null;
    for (let index = mic.takes.length - 1; index >= 0; index -= 1) {
      if (mic.takes[index].audioStatus === "ok") {
        latestPlayableTake = mic.takes[index];
        break;
      }
    }
    const latestTake = mic.takes[mic.takes.length - 1] ?? null;
    const savedSelection = piece.savedSelections?.[mic.id];
    const validSavedSelection =
      savedSelection === "off" ||
      (savedSelection !== undefined && mic.takes.some((take) => take.id === savedSelection));
    selections[mic.id] = validSavedSelection
      ? savedSelection
      : latestPlayableTake?.id ?? latestTake?.id ?? "off";
    armed[mic.id] = null;
  }
  return {
    ...createIdleMoodPerformance(),
    selections,
    armed,
  };
}

function stopMoodPerformanceState(
  performance: AppState["mood"]["performance"],
): AppState["mood"]["performance"] {
  return {
    ...performance,
    isPerforming: false,
    epoch: null,
    dropActive: false,
    cycleCount: 0,
    // The committed mix (selections) survives a stop/mode-switch, but pending
    // arms do not: stopping resets the boundary queue, so a preserved arm would
    // pulse forever with no boundary to commit at. Clear armed, keep selections.
    armed: Object.fromEntries(Object.keys(performance.selections).map((micId) => [micId, null])),
    armedLens: null,
    armedDropActive: null,
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
  if (take.posterUrl) {
    evictMoodPosters([take.posterUrl]);
    URL.revokeObjectURL(take.posterUrl);
  }
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

function commitEntryForExistingMoodTake(
  piece: MoodPiece | null,
  micId: string,
  entry: MoodSelectionEntry,
): MoodSelectionEntry {
  if (entry === "off") return entry;
  const mic = piece?.mics.find((candidate) => candidate.id === micId);
  return mic?.takes.some((take) => take.id === entry) ? entry : "off";
}

export interface MoodActions {
  setAppMode: (mode: AppMode) => void;
  setMoodHydration: (hydration: AppState["mood"]["hydration"]) => void;
  hydrateMoodPiece: (piece: MoodPiece | null) => void;
  createMoodPiece: (
    stage: MoodStageId,
    timeFeel: MoodTimeFeel,
    opts?: { bpm?: number; cycleBars?: NonNullable<MoodPiece["cycleBars"]> },
  ) => void;
  scratchMoodPiece: () => void;
  setMoodLens: (lens: MoodLens) => void;
  setMoodVibe: (vibe: MoodVibeId) => void;
  setMoodArmedLens: (lens: MoodLens | null) => void;
  setMoodArmedDrop: (dropActive: boolean | null) => void;
  setMoodPerforming: (isPerforming: boolean, epoch?: number | null) => void;
  setMonitorWithHeadphones: (enabled: boolean) => void;
  setMoodCredits: (
    update: Partial<Pick<MoodCredits, "enabled" | "styleIndex" | "mode">> & {
      names?: Record<string, string>;
    },
  ) => void;
  armMoodSelection: (micId: string, entry: MoodSelectionEntry) => void;
  commitMoodSelections: (dueArms: MoodSelectionCommit[]) => void;
  setMoodDrop: (dropActive: boolean) => void;
  setMoodHotMic: (micId: string | null) => void;
  setMoodCountInTicks: (countInTicks: number | null) => void;
  setMoodCycleCount: (cycleCount: number) => void;
  setMoodTake: (micId: string, take: MoodTake) => void;
  setMoodPartChecking: (takeId: string, checking: boolean) => void;
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
  applyMoodArtDirectionIfCurrent: (
    oneTakeId: string,
    artDirection: MoodArtDirection,
    expectedSessionId: number,
  ) => boolean;
  applyMoodKeyEstimateIfCurrent: (
    oneTakeId: string,
    keyEstimate: MoodKeyEstimate,
    expectedSessionId: number,
  ) => boolean;
  restoreMoodTakeAudio: (
    micId: string,
    takeId: string,
    audioBuffer: AudioBuffer,
    audioBlob?: Blob | null,
    expectedTake?: MoodTake,
  ) => void;
}

type StoreUpdater = (state: AppState) => AppState | Partial<AppState>;

interface MoodActionHooks {
  set: (updater: StoreUpdater) => void;
  setUnlessExporting: (updater: StoreUpdater) => void;
  get: () => AppState;
}

// A Mood record that could not be opened stays failed for the session: that
// state pauses Mood autosave, and a new piece must not unpause it and write
// over the record.
function settledMoodHydration(
  hydration: AppState["mood"]["hydration"],
): AppState["mood"]["hydration"] {
  return hydration === "failed" ? "failed" : "ready";
}

export function createIdleMoodPerformance(): AppState["mood"]["performance"] {
  return {
    isPerforming: false,
    epoch: null,
    selections: {},
    armed: {},
    armedLens: null,
    armedDropActive: null,
    dropActive: false,
    hotMicId: null,
    cycleCount: 0,
  };
}

export function createInitialMoodState(): MoodSlice {
  return {
    piece: null,
    hydration: "cold",
    monitorWithHeadphones: readStoredMoodHeadphones(),
    partCheckingTakeIds: [],
    countInTicks: null,
    performance: createIdleMoodPerformance(),
  };
}

export function createMoodActions(hooks: MoodActionHooks): MoodActions {
  const { set, setUnlessExporting } = hooks;
  return {
    setAppMode: (mode) => {
      setUnlessExporting((state) => {
        persistAppMode(mode);
        return {
          appMode: mode,
          mood: {
            ...state.mood,
            performance: state.mood.piece
              ? stopMoodPerformanceState(state.mood.performance)
              : createIdleMoodPerformance(),
          },
          // Both modes show recording.error; one mode's failure must not
          // greet the user in the other.
          recording:
            state.recording.error === null ? state.recording : { ...state.recording, error: null },
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

    hydrateMoodPiece: (piece) =>
      setUnlessExporting((state) => {
        if (state.mood.piece && state.mood.piece !== piece) {
          revokeMoodPieceObjectUrls(state.mood.piece);
        }
        return {
          mood: {
            ...state.mood,
            piece,
            hydration: "ready",
            partCheckingTakeIds: [],
            performance: piece
              ? createMoodPerformanceForPiece(piece)
              : createIdleMoodPerformance(),
          },
          session: replaceMoodPieceSession(state.session),
        };
      }),

    createMoodPiece: (stage, timeFeel, opts) =>
      setUnlessExporting((state) => {
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
            ...state.mood,
            piece,
            hydration: settledMoodHydration(state.mood.hydration),
            partCheckingTakeIds: [],
            performance: createMoodPerformanceForPiece(piece),
          },
          session: startMoodPieceSession(state.session),
        };
      }),

    scratchMoodPiece: () =>
      set((state) => {
        if (state.playback.isExporting || state.mood.performance.isPerforming) return state;
        if (!state.mood.piece) return state;
        resetMoodDropFilter();
        revokeMoodPieceObjectUrls(state.mood.piece);
        return {
          mood: {
            ...state.mood,
            piece: null,
            hydration: settledMoodHydration(state.mood.hydration),
            partCheckingTakeIds: [],
            performance: createIdleMoodPerformance(),
          },
          recording: {
            ...state.recording,
            lastTakeReceipt: null,
          },
          session: startMoodPieceSession(state.session),
        };
      }),

    setMoodLens: (lens) =>
      setUnlessExporting((state) => {
        const piece = state.mood.piece;
        if (!piece || piece.lens === lens) return state;
        return {
          mood: {
            ...state.mood,
            piece: {
              ...piece,
              lens,
              updatedAt: Date.now(),
            },
          },
        };
      }),

    setMoodVibe: (vibe) =>
      set((state) => {
        if (
          state.playback.isExporting ||
          state.mood.performance.isPerforming ||
          state.recording.state !== "idle"
        ) {
          return state;
        }
        const piece = state.mood.piece;
        if (!piece || piece.vibe === vibe) return state;
        return {
          mood: {
            ...state.mood,
            piece: {
              ...piece,
              vibe,
              updatedAt: Date.now(),
            },
          },
        };
      }),

    setMoodArmedLens: (lens) =>
      set((state) => ({
        mood: {
          ...state.mood,
          performance: {
            ...state.mood.performance,
            armedLens: lens,
          },
        },
      })),

    setMoodPerforming: (isPerforming, epoch = null) =>
      set((state) => ({
        mood: {
          ...state.mood,
          performance: isPerforming
            ? {
                ...state.mood.performance,
                isPerforming: true,
                epoch,
                dropActive: state.mood.piece?.vibe !== "clean",
                armedDropActive: null,
                cycleCount: 0,
              }
            : stopMoodPerformanceState(state.mood.performance),
        },
      })),

    setMonitorWithHeadphones: (enabled) =>
      setUnlessExporting((state) => {
        persistMoodHeadphones(enabled);
        return {
          mood: {
            ...state.mood,
            monitorWithHeadphones: enabled,
          },
        };
      }),

    setMoodCredits: (update) =>
      setUnlessExporting((state) => {
        const piece = state.mood.piece;
        if (!piece) return state;
        const current = piece.credits;
        const firstEnable = current === undefined && update.enabled === true;
        const base: MoodCredits =
          current ?? {
            enabled: false,
            names: {},
            styleIndex: firstEnable
              ? Math.floor(Math.random() * CREDIT_STYLES.length)
              : 0,
          };
        let names = base.names;
        if (update.names) {
          names = { ...base.names };
          const validMicIds = new Set(piece.mics.map((mic) => mic.id));
          for (const [micId, value] of Object.entries(update.names)) {
            if (!validMicIds.has(micId)) continue;
            const bounded = value.slice(0, CREDIT_NAME_MAX_LENGTH);
            if (bounded.trim().length === 0) delete names[micId];
            else names[micId] = bounded;
          }
        }
        const credits: MoodCredits = {
          enabled: update.enabled ?? base.enabled,
          names,
          styleIndex:
            update.styleIndex === undefined
              ? base.styleIndex
              : clampCreditStyleIndex(update.styleIndex),
        };
        if (update.mode !== undefined) credits.mode = update.mode;
        else if (base.mode !== undefined) credits.mode = base.mode;

        return {
          mood: {
            ...state.mood,
            piece: {
              ...piece,
              credits,
              updatedAt: Date.now(),
            },
          },
        };
      }),

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
          selections[micId] = commitEntryForExistingMoodTake(state.mood.piece, micId, entry);
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
    setMoodArmedDrop: (dropActive) =>
      set((state) => ({
        mood: {
          ...state.mood,
          performance: { ...state.mood.performance, armedDropActive: dropActive },
        },
      })),

    setMoodHotMic: (hotMicId) =>
      set((state) => ({
        mood: {
          ...state.mood,
          performance: { ...state.mood.performance, hotMicId },
        },
      })),

    setMoodCountInTicks: (countInTicks) =>
      set((state) => ({ mood: { ...state.mood, countInTicks } })),

    setMoodCycleCount: (cycleCount) =>
      set((state) => ({
        mood: {
          ...state.mood,
          performance: { ...state.mood.performance, cycleCount },
        },
      })),

    setMoodTake: (micId, take) =>
      setUnlessExporting((state) => {
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
          let nextMicIndex = mics.length;
          while (mics.some((candidate) => candidate.id === `mic-${nextMicIndex}`)) {
            nextMicIndex += 1;
          }
          const nextMicId = `mic-${nextMicIndex}`;
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

    setMoodPartChecking: (takeId, checking) =>
      set((state) => {
        const current = state.mood.partCheckingTakeIds;
        const hasTake = current.includes(takeId);
        if (checking === hasTake) return state;
        return {
          mood: {
            ...state.mood,
            partCheckingTakeIds: checking
              ? [...current, takeId]
              : current.filter((candidate) => candidate !== takeId),
          },
        };
      }),

    attachMoodTakePoster: (micId, takeId, posterBlob, posterUrl) =>
      setUnlessExporting((state) => {
        const piece = state.mood.piece;
        if (!piece) return state;
        const { mics, found: attached } = patchMoodTake(piece, micId, takeId, (take) => {
          if (take.posterUrl && take.posterUrl !== posterUrl) {
            evictMoodPosters([take.posterUrl]);
            URL.revokeObjectURL(take.posterUrl);
          }
          return { ...take, posterBlob, posterUrl };
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
      setUnlessExporting((state) => {
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
            ? {
                cycleSeconds: null,
                oneMicId: null,
                oneTakeId: null,
                artDirection: undefined,
                keyEstimate: undefined,
              }
            : deletedTheOne
              ? {
                  oneMicId: null,
                  oneTakeId: null,
                  artDirection: undefined,
                  keyEstimate: undefined,
                }
              : {};

        return {
          mood: {
            ...state.mood,
            partCheckingTakeIds: state.mood.partCheckingTakeIds.filter(
              (candidate) => candidate !== takeId,
            ),
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
      setUnlessExporting((state) => {
        if (state.session.moodRevision !== expectedRevision) return state;
        const piece = state.mood.piece;
        if (!piece) return state;
        const { mics, found } = patchMoodTake(piece, micId, takeId, (take) => ({
          ...take,
          syncOffsetMs: offsetMs,
        }));
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
      setUnlessExporting((state) => {
        if (state.session.moodRevision !== expectedRevision) return state;
        const piece = state.mood.piece;
        if (!piece) return state;
        const { mics, found } = patchMoodTake(piece, micId, takeId, (take) =>
          source === "ai" && take.partSource === "user"
            ? null
            : { ...take, part, partSource: source },
        );
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

    applyMoodArtDirectionIfCurrent: (oneTakeId, artDirection, expectedSessionId) => {
      let applied = false;
      // Export freeze also drops enrichment already in flight when export
      // begins; retrying that narrow race remains intentionally deferred.
      setUnlessExporting((state) => {
        const piece = state.mood.piece;
        // Piece-level AI is tied to the current session and the exact One,
        // not moodRevision: an overdub may land while this request is in flight.
        if (
          state.session.moodSessionId !== expectedSessionId ||
          !piece ||
          piece.oneTakeId !== oneTakeId ||
          (artDirection.source === "ai" && piece.artDirection?.source === "user")
        ) {
          return state;
        }
        applied = true;
        return {
          mood: {
            ...state.mood,
            piece: {
              ...piece,
              artDirection: { ...artDirection },
              updatedAt: Date.now(),
            },
          },
        };
      });
      return applied;
    },

    applyMoodKeyEstimateIfCurrent: (oneTakeId, keyEstimate, expectedSessionId) => {
      let applied = false;
      setUnlessExporting((state) => {
        const piece = state.mood.piece;
        // See the art-direction guard above: overdubs do not invalidate the One.
        if (
          state.session.moodSessionId !== expectedSessionId ||
          !piece ||
          piece.oneTakeId !== oneTakeId
        ) {
          return state;
        }
        applied = true;
        return {
          mood: {
            ...state.mood,
            piece: {
              ...piece,
              keyEstimate: { ...keyEstimate },
              updatedAt: Date.now(),
            },
          },
        };
      });
      return applied;
    },

    restoreMoodTakeAudio: (micId, takeId, audioBuffer, audioBlob, expectedTake) =>
      setUnlessExporting((state) => {
        const piece = state.mood.piece;
        if (!piece) return state;
        const { mics, found: restored } = patchMoodTake(piece, micId, takeId, (take) => {
          if (take.audioStatus !== "unavailable") return null;
          if (expectedTake && take !== expectedTake) return null;
          return {
            ...take,
            audioBuffer,
            audioStatus: "ok" as const,
            audioBlob: audioBlob !== undefined ? audioBlob : take.audioBlob,
          };
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
  };
}
