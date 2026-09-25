// ABOUTME: Owns Mood performance Transport scheduling and boundary commit staging.
// ABOUTME: Keeps audible start gating aligned with Chop while exposing paint-path commit consumption.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import type { MoodLens, MoodSelectionCommit } from "../types";
import {
  claimPendingAudible,
  canStartAudibleAction,
  isPendingAudibleCurrent,
} from "./audibleActionGate";
import { ensureAudioRunning } from "./audioLifecycle";
import { getActiveExportSession } from "./exportSession";
import { initializeMoodFxForPerformance, resetMoodDropFilter } from "./moodFx";
import { stopAllMoodPlayers } from "./moodPlayers";
import { registerPerformanceInterruptHandler } from "./performanceInterrupt";
import {
  createBoundaryQueue,
  cycleIndexAt,
  type BoundaryQueue,
  type BoundaryQueueEvent,
} from "./moodClock";

let boundaryQueue: BoundaryQueue = createBoundaryQueue();
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

// Re-checked after the unlock's await: a tap that was pending when the page
// went hidden must not start sound in the background once audio resumes, nor
// on return when the frozen unlock settles only then.
function canStartAfterPendingAudible(): boolean {
  const state = useAppStore.getState();
  return (
    isPendingAudibleCurrent() &&
    !(typeof document !== "undefined" && document.hidden) &&
    hasStartableMoodCycle() &&
    !state.playback.isPlaying &&
    !state.playback.isExporting &&
    state.recording.state === "idle"
  );
}

function canStartFromRecordingFlow(): boolean {
  const state = useAppStore.getState();
  return hasStartableMoodCycle() && !state.playback.isPlaying && !state.playback.isExporting;
}

function clearScheduledBoundaryRepeat(): void {
  if (scheduledBoundaryEventId === null) return;
  Tone.getTransport().clear(scheduledBoundaryEventId);
  scheduledBoundaryEventId = null;
}

function resetBoundaryState(): void {
  boundaryQueue = createBoundaryQueue();
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
  scheduleCycleDisplayUpdate(audioTime);
}

async function startMoodPerformanceTransport(): Promise<boolean> {
  const cycleSeconds = currentCycleSeconds();
  if (cycleSeconds === null) return false;

  clearScheduledBoundaryRepeat();
  resetBoundaryState();
  const epoch = Tone.now();
  activeEpoch = epoch;
  const transport = Tone.getTransport();
  transport.position = 0;
  scheduledBoundaryEventId = transport.scheduleRepeat(onCycleBoundary, cycleSeconds);
  initializeMoodFxForPerformance(cycleSeconds);
  useAppStore.getState().actions.setMoodPerforming(true, epoch);
  const { syncCommittedMoodEngines } = await import("./moodPerformance");
  // A hide or an interruption can stop the performance during that await;
  // starting the shared transport now would run Chop's step loop unowned.
  if (activeEpoch !== epoch || !useAppStore.getState().mood.performance.isPerforming) {
    return false;
  }
  syncCommittedMoodEngines();
  // The transport is shared and carries Chop's swing, which Tone applies by
  // delaying off-grid events: Mood's count-in ticks and GATE repeat would
  // land late. Mood runs unswung; stop hands Chop its swing back.
  transport.swing = 0;
  transport.start();
  return true;
}

export async function startMoodPerformance(): Promise<void> {
  if (!canClaimMoodStart()) return;
  const release = claimPendingAudible();
  if (!release) return;

  try {
    await ensureAudioRunning();
    if (!canStartAfterPendingAudible()) return;
    await startMoodPerformanceTransport();
  } finally {
    release();
  }
}

export async function startMoodPerformanceForRecordingFlow(): Promise<boolean> {
  if (!canStartFromRecordingFlow()) return false;
  return startMoodPerformanceTransport();
}

// The export flow starts the performance INSIDE its own export session:
// a REGISTERED session (not just the isExporting flag) is the mutex, so
// this entry stays unusable outside an actual export render.
export async function startMoodPerformanceForExportFlow(): Promise<boolean> {
  const state = useAppStore.getState();
  if (
    !hasStartableMoodCycle() ||
    !state.playback.isExporting ||
    getActiveExportSession() === null ||
    state.playback.isPlaying ||
    state.recording.state !== "idle"
  ) {
    return false;
  }
  return startMoodPerformanceTransport();
}

// Registered from the Mood composition root: a page hide or an audio
// interruption stops a running performance the way it stops Chop playback.
export function registerMoodPerformanceInterrupt(): () => void {
  return registerPerformanceInterruptHandler({
    isActive: () => useAppStore.getState().mood.performance.isPerforming,
    interrupt: stopMoodPerformance,
  });
}

export function stopMoodPerformance(): void {
  clearScheduledBoundaryRepeat();
  resetBoundaryState();
  activeEpoch = null;
  resetMoodDropFilter();
  const transport = Tone.getTransport();
  transport.stop();
  transport.position = 0;
  transport.swing = useAppStore.getState().project.swing;
  stopAllMoodPlayers();
  useAppStore.getState().actions.setMoodPerforming(false);
}

export function armMoodSelectionCommit(
  commit: MoodSelectionCommit,
  boundaryTime: number,
  now: number,
): void {
  boundaryQueue.armSelection(commit, boundaryTime, now);
}

export function armMoodLensCommit(lens: MoodLens, boundaryTime: number, now: number): void {
  boundaryQueue.armLens(lens, boundaryTime, now);
}

export function armMoodDropCommit(active: boolean, boundaryTime: number, now: number): void {
  boundaryQueue.armDrop(active, boundaryTime, now);
}

export function consumeDueCommits(audioTime: number): BoundaryQueueEvent[] {
  return boundaryQueue.dueAt(audioTime);
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
