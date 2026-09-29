// ABOUTME: Mood performance conductor for selection arming and engine fanout.
// ABOUTME: Keeps stack swaps quantized while syncing audio players and hidden video.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import type { MoodLens, MoodPiece, MoodSelectionEntry, MoodTake } from "../types";
import { canStartMoodPerformanceTap } from "./audibleActionGate";
import {
  DROP_BEATS_PER_CYCLE,
  nextBeatBoundary,
  nextCycleBoundary,
  takeLoopPeriod,
} from "./moodClock";
import { scheduleMoodDropFilter } from "./moodFx";
import {
  livePlayerIsStale,
  playerSyncOffsetMs,
  scheduleMoodPlayerSwap,
  syncMoodPlayers,
  type MoodPlayerLiveTake,
} from "./moodPlayers";
import {
  armMoodDropCommit,
  armMoodLensCommit,
  armMoodSelectionCommit,
  lockedSelectionCommits,
  pendingSelectionCommits,
} from "./moodTransport";
import {
  liveTakesFromSelections,
  prepareUpcoming,
  syncPool,
  type MoodVideoPoolTake,
} from "./moodVideoPool";

type SelectionMap = Record<string, MoodSelectionEntry>;
type ArmedMap = Record<string, MoodSelectionEntry | null>;

function takeForEntry(
  piece: MoodPiece,
  micId: string,
  entry: MoodSelectionEntry,
): MoodTake | null {
  if (entry === "off") return null;
  const mic = piece.mics.find((candidate) => candidate.id === micId);
  return mic?.takes.find((take) => take.id === entry) ?? null;
}

function isValidEntry(piece: MoodPiece, micId: string, entry: MoodSelectionEntry): boolean {
  if (entry === "off") return piece.mics.some((mic) => mic.id === micId);
  return takeForEntry(piece, micId, entry) !== null;
}

function liveVideoTakesIncludingArmed(
  piece: MoodPiece,
  selections: SelectionMap,
  armed: ArmedMap,
  epoch: number | null,
): MoodVideoPoolTake[] {
  const live = new Map(
    liveTakesFromSelections(piece, selections, epoch).map((take) => [take.takeId, take]),
  );

  // Armed takes, and takes whose swap is still queued (a locked swap stays
  // queued after its mic is re-armed for a later boundary): their prepared
  // videos stay in the pool until their cut.
  const upcoming = [
    ...Object.entries(armed).map(([micId, entry]) => ({ micId, entry })),
    ...pendingSelectionCommits(),
  ];
  for (const { micId, entry } of upcoming) {
    if (!entry || entry === "off") continue;
    const take = takeForEntry(piece, micId, entry);
    if (!take || live.has(take.id)) continue;
    live.set(take.id, {
      takeId: take.id,
      url: take.url,
      loopStart: take.trimStartMs / 1000,
      loopEnd: take.trimEndMs / 1000,
      loopPeriod:
        piece.cycleSeconds === null
          ? Math.max(take.trimEndMs / 1000 - take.trimStartMs / 1000, 1e-6)
          : takeLoopPeriod(take.cycleMultiple, piece.cycleSeconds),
      cycleMultiple: take.cycleMultiple,
      epoch,
      syncOffsetMs: take.syncOffsetMs,
    });
  }

  return [...live.values()];
}

function livePlayerTakesFromSelections(
  piece: MoodPiece,
  selections: SelectionMap,
): MoodPlayerLiveTake[] {
  const live = new Map<string, MoodPlayerLiveTake>();
  for (const mic of piece.mics) {
    const entry = selections[mic.id];
    if (!entry || entry === "off") continue;
    const take = mic.takes.find((candidate) => candidate.id === entry);
    if (!take || live.has(take.id)) continue;
    live.set(take.id, { takeId: take.id, take });
  }
  return [...live.values()];
}

// The pool's takes: live and armed (an armed take keeps its prepared video
// through an earlier commit), each phase-locked with the sync offset its
// audio player was built with, so a new offset reaches the video when it
// reaches the sound.
function videoTakesForPool(
  piece: MoodPiece,
  selections: SelectionMap,
  armed: ArmedMap,
  epoch: number | null,
): MoodVideoPoolTake[] {
  return liveVideoTakesIncludingArmed(piece, selections, armed, epoch).map((take) => {
    const syncOffsetMs = playerSyncOffsetMs(take.takeId);
    return syncOffsetMs === null ? take : { ...take, syncOffsetMs };
  });
}

// audioTime is the drain's audible time on the commit path.
export function syncCommittedMoodEngines(
  options: { syncPlayers?: boolean; audioTime?: number } = {},
): void {
  const state = useAppStore.getState();
  const piece = state.mood.piece;
  if (!piece) return;

  const { performance: performanceState } = state.mood;
  if (
    options.syncPlayers !== false &&
    performanceState.isPerforming &&
    performanceState.epoch !== null &&
    piece.cycleSeconds !== null
  ) {
    // The live take of every mic with a swap still queued (its resync, Off
    // or another take) keeps its player until that commit, whose swap on the
    // audio clock replaces it.
    const swapQueued = new Set(
      pendingSelectionCommits()
        .map((event) => performanceState.selections[event.micId])
        .filter((entry): entry is string => entry !== undefined && entry !== "off"),
    );
    syncMoodPlayers(
      livePlayerTakesFromSelections(piece, performanceState.selections),
      performanceState.epoch,
      piece.cycleSeconds,
      options.audioTime,
      swapQueued,
    );
  }

  syncPool(
    videoTakesForPool(
      piece,
      performanceState.selections,
      performanceState.armed,
      performanceState.epoch,
    ),
  );
}

// Audio swaps run on the audio clock, not the paint path: once a swap is
// locked (the arm clock passed its boundary, so no re-arm can change it)
// its players are scheduled to swap exactly at the boundary, about a
// lookahead before the paint-path commit adopts them. Runs every frame;
// the players module schedules each swap once.
export function scheduleLockedPlayerSwaps(): void {
  const state = useAppStore.getState();
  const piece = state.mood.piece;
  const { performance: performanceState } = state.mood;
  if (
    !piece ||
    !performanceState.isPerforming ||
    performanceState.epoch === null ||
    piece.cycleSeconds === null
  ) {
    return;
  }

  const locked = lockedSelectionCommits();
  // Arms made while the arm clock sat on a boundary all land on it, in
  // order; only a mic's last one is its swap there.
  const swaps = locked.filter(
    (event, index) =>
      !locked
        .slice(index + 1)
        .some(
          (later) => later.micId === event.micId && later.boundaryTime === event.boundaryTime,
        ),
  );
  const projected: SelectionMap = { ...performanceState.selections };
  for (const event of swaps) {
    const outgoing = projected[event.micId] ?? "off";
    projected[event.micId] = event.entry;
    const incomingTake = takeForEntry(piece, event.micId, event.entry);
    scheduleMoodPlayerSwap(
      outgoing === "off" ? null : outgoing,
      incomingTake ? { takeId: incomingTake.id, take: incomingTake } : null,
      event.boundaryTime,
      performanceState.epoch,
      piece.cycleSeconds,
    );
  }

  resyncStaleLiveTakes(piece, performanceState.selections, performanceState.epoch);
}

// A live take whose audio changed under its player (a repair that decoded
// its audio, a new sync offset) is re-armed for the next boundary, where the
// swap above rebuilds it on the audio clock. A mic with a queued swap
// resyncs through that swap.
function resyncStaleLiveTakes(piece: MoodPiece, selections: SelectionMap, epoch: number): void {
  if (piece.cycleSeconds === null) return;
  let queuedMics: Set<string> | null = null;
  for (const mic of piece.mics) {
    const take = takeForEntry(piece, mic.id, selections[mic.id] ?? "off");
    if (!take || !livePlayerIsStale(take)) continue;
    queuedMics ??= new Set(pendingSelectionCommits().map((event) => event.micId));
    if (queuedMics.has(mic.id)) continue;
    const now = Tone.now();
    armMoodSelectionCommit(
      { micId: mic.id, entry: take.id },
      nextCycleBoundary(epoch, piece.cycleSeconds, now),
      now,
    );
    queuedMics.add(mic.id);
  }
}

export function armSelection(micId: string, entry: MoodSelectionEntry): void {
  const state = useAppStore.getState();
  if (!canStartMoodPerformanceTap(state)) return;

  const piece = state.mood.piece;
  if (!piece || !isValidEntry(piece, micId, entry)) return;

  const current = state.mood.performance.selections[micId] ?? "off";
  const armed = state.mood.performance.armed[micId] ?? null;
  if (current === entry && armed === null) return;

  const commit = { micId, entry };
  state.actions.armMoodSelection(micId, entry);

  const armedState = useAppStore.getState();
  const performanceState = armedState.mood.performance;
  if (
    !performanceState.isPerforming ||
    performanceState.epoch === null ||
    piece.cycleSeconds === null
  ) {
    armedState.actions.commitMoodSelections([commit]);
    syncCommittedMoodEngines({ syncPlayers: false });
    return;
  }

  const now = Tone.now();
  const boundaryTime = nextCycleBoundary(performanceState.epoch, piece.cycleSeconds, now);
  armMoodSelectionCommit(commit, boundaryTime, now);
  syncPool(
    videoTakesForPool(
      piece,
      performanceState.selections,
      performanceState.armed,
      performanceState.epoch,
    ),
  );
  // The live take is already playing in step: re-selecting it (to cancel a
  // queued swap) must not pre-roll its video.
  if (entry !== "off" && entry !== current) {
    prepareUpcoming(entry, boundaryTime);
  }
}

export function armLens(lens: MoodLens): void {
  const state = useAppStore.getState();
  if (state.playback.isExporting) return;
  if (!canStartMoodPerformanceTap(state)) return;

  const piece = state.mood.piece;
  if (!piece) return;

  const performanceState = state.mood.performance;
  if (
    !performanceState.isPerforming ||
    performanceState.epoch === null ||
    piece.cycleSeconds === null
  ) {
    state.actions.setMoodLens(lens);
    return;
  }

  state.actions.setMoodArmedLens(lens === piece.lens ? null : lens);
  const now = Tone.now();
  const boundaryTime = nextCycleBoundary(performanceState.epoch, piece.cycleSeconds, now);
  armMoodLensCommit(lens, boundaryTime, now);
}

export function armDrop(): void {
  const state = useAppStore.getState();
  if (!canStartMoodPerformanceTap(state)) return;

  const piece = state.mood.piece;
  const performanceState = state.mood.performance;
  if (
    !piece ||
    piece.vibe === "clean" ||
    !performanceState.isPerforming ||
    performanceState.epoch === null ||
    piece.cycleSeconds === null
  ) {
    return;
  }

  const nextActive = !(performanceState.armedDropActive ?? performanceState.dropActive);
  state.actions.setMoodArmedDrop(nextActive);
  const now = Tone.now();
  const boundaryTime = nextBeatBoundary(performanceState.epoch, piece.cycleSeconds, now);
  armMoodDropCommit(nextActive, boundaryTime, now);
  scheduleMoodDropFilter(
    nextActive,
    boundaryTime,
    piece.cycleSeconds / DROP_BEATS_PER_CYCLE,
  );
}
