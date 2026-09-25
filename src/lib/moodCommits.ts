// ABOUTME: Thin owner seam for Mood paint-path boundary commits.
// ABOUTME: Drains due transport commits once and applies store-visible performance state.
import { useAppStore } from "../store/useAppStore";
import type { MoodLens, MoodSelectionCommit } from "../types";
import type { BoundaryDropEvent } from "./moodClock";
import { scheduleLockedPlayerSwaps, syncCommittedMoodEngines } from "./moodPerformance";
import { consumeDueCommits } from "./moodTransport";
import { restartVideosAtPeriodBoundary } from "./moodVideoPool";

export function applyDueCommits(audioTime: number): BoundaryDropEvent | null {
  scheduleLockedPlayerSwaps();
  const due = consumeDueCommits(audioTime);

  const selections: MoodSelectionCommit[] = [];
  let lens: MoodLens | null = null;
  let dropCommit: BoundaryDropEvent | null = null;
  for (const commit of due) {
    if (commit.type === "selection") {
      selections.push({ micId: commit.micId, entry: commit.entry });
    } else if (commit.type === "lens") {
      lens = commit.lens;
    } else if (commit.type === "drop") {
      dropCommit = commit;
    }
  }

  const actions = useAppStore.getState().actions;
  if (selections.length > 0) {
    actions.commitMoodSelections(selections);
  }
  if (lens !== null) {
    actions.setMoodLens(lens);
    actions.setMoodArmedLens(null);
  }
  if (dropCommit !== null) {
    actions.setMoodDrop(dropCommit.active);
    actions.setMoodArmedDrop(null);
  }
  if (selections.length > 0) {
    syncCommittedMoodEngines();
  }

  const state = useAppStore.getState();
  const piece = state.mood.piece;
  const epoch = state.mood.performance.epoch;
  if (
    !state.mood.performance.isPerforming ||
    !piece ||
    piece.cycleSeconds === null ||
    epoch === null ||
    audioTime < epoch
  ) {
    return dropCommit;
  }

  restartVideosAtPeriodBoundary(audioTime, epoch);
  return dropCommit;
}
