// ABOUTME: Owns Mood performance Transport scheduling and boundary commit staging.
// ABOUTME: Keeps audible start gating aligned with Chop while exposing paint-path commit consumption.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import type { MoodLens, MoodSelectionCommit } from "../types";
import { claimPendingAudible, canStartAudibleAction } from "./audibleActionGate";
import { ensureAudioRunning } from "./audioLifecycle";
import {
  createBoundaryQueue,
  cycleIndexAt,
  type BoundaryQueue,
  type BoundaryQueueEvent,
} from "./moodClock";

let boundaryQueue: BoundaryQueue = createBoundaryQueue();
let pendingCommits: BoundaryQueueEvent[] = [];
let scheduledBoundaryEventId: number | null = null;
let activeEpoch: number | null = null;

function currentCycleSeconds(): number | null {
  return useAppStore.getState().mood.piece?.cycleSeconds ?? null;
}

function hasStartableMoodCycle(): boolean {
  const state = useAppStore.getState();
  return (
    state.appMode === "mood" &&
    !state.mood.performance.isPerforming &&
    state.mood.piece?.cycleSeconds !== null &&
    state.mood.piece?.cycleSeconds !== undefined
  );
}

function canClaimMoodStart(): boolean {
  return hasStartableMoodCycle() && canStartAudibleAction(useAppStore.getState());
}

function canStartAfterPendingAudible(): boolean {
  const state = useAppStore.getState();
  return (
    hasStartableMoodCycle() &&
    !state.playback.isPlaying &&
    !state.playback.isExporting &&
    state.recording.state === "idle"
  );
}

function clearScheduledBoundaryRepeat(): void {
  if (scheduledBoundaryEventId === null) return;
  Tone.getTransport().clear(scheduledBoundaryEventId);
  scheduledBoundaryEventId = null;
}

function resetBoundaryState(): void {
  boundaryQueue = createBoundaryQueue();
  pendingCommits = [];
}

function scheduleCycleDisplayUpdate(audioTime: number): void {
  const state = useAppStore.getState();
  const cycleSeconds = state.mood.piece?.cycleSeconds ?? null;
  const epoch = state.mood.performance.epoch ?? activeEpoch;
  if (cycleSeconds === null || epoch === null) return;

  const cycleCount = cycleIndexAt(epoch, cycleSeconds, audioTime);
  Tone.getDraw().schedule(() => {
    const latest = useAppStore.getState();
    if (
      !latest.mood.performance.isPerforming ||
      latest.mood.performance.epoch !== epoch
    ) {
      return;
    }
    latest.actions.setMoodCycleCount(cycleCount);
  }, audioTime);
}

function onCycleBoundary(audioTime: number): void {
  const due = boundaryQueue.dueAt(audioTime);
  if (due.length > 0) {
    pendingCommits = [...pendingCommits, ...due];
  }
  scheduleCycleDisplayUpdate(audioTime);
}

export async function startMoodPerformance(): Promise<void> {
  if (!canClaimMoodStart()) return;
  const release = claimPendingAudible();
  if (!release) return;

  try {
    await ensureAudioRunning();
    if (!canStartAfterPendingAudible()) return;

    const cycleSeconds = currentCycleSeconds();
    if (cycleSeconds === null) return;

    clearScheduledBoundaryRepeat();
    resetBoundaryState();
    activeEpoch = Tone.now();
    const transport = Tone.getTransport();
    transport.position = 0;
    scheduledBoundaryEventId = transport.scheduleRepeat(onCycleBoundary, cycleSeconds);
    useAppStore.getState().actions.setMoodPerforming(true, activeEpoch);
    transport.start();
  } finally {
    release();
  }
}

export function stopMoodPerformance(): void {
  clearScheduledBoundaryRepeat();
  resetBoundaryState();
  activeEpoch = null;
  const transport = Tone.getTransport();
  transport.stop();
  transport.position = 0;
  useAppStore.getState().actions.setMoodPerforming(false);
}

export function armMoodSelectionCommit(
  commit: MoodSelectionCommit,
  boundaryTime: number,
): void {
  boundaryQueue.armSelection(commit, boundaryTime);
}

export function armMoodLensCommit(lens: MoodLens, boundaryTime: number): void {
  boundaryQueue.armLens(lens, boundaryTime);
}

export function armMoodDropCommit(active: boolean, boundaryTime: number): void {
  boundaryQueue.armDrop(active, boundaryTime);
}

export function consumeDueCommits(audioTime: number): BoundaryQueueEvent[] {
  const due: BoundaryQueueEvent[] = [];
  const future: BoundaryQueueEvent[] = [];

  for (const commit of pendingCommits) {
    if (commit.boundaryTime <= audioTime) due.push(commit);
    else future.push(commit);
  }

  pendingCommits = future;
  return due;
}

export function __resetMoodTransportForTesting(): void {
  clearScheduledBoundaryRepeat();
  resetBoundaryState();
  activeEpoch = null;
}

useAppStore.subscribe((state, previousState) => {
  if (
    previousState.appMode === "mood" &&
    state.appMode !== "mood" &&
    previousState.mood.performance.isPerforming
  ) {
    stopMoodPerformance();
  }
});
