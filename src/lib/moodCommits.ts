// ABOUTME: Thin owner seam for Mood paint-path boundary commits.
// ABOUTME: Drains due transport commits once and applies store-visible performance state.
import { useAppStore } from "../store/useAppStore";
import type { MoodLens, MoodSelectionCommit } from "../types";
import { syncCommittedMoodEngines } from "./moodPerformance";
import { consumeDueCommits } from "./moodTransport";
import { restartVideosAtPeriodBoundary } from "./moodVideoPool";

export function applyDueCommits(audioTime: number): void {
  const due = consumeDueCommits(audioTime);

  const selections: MoodSelectionCommit[] = [];
  let lens: MoodLens | null = null;
  for (const commit of due) {
    if (commit.type === "selection") {
      selections.push({ micId: commit.micId, entry: commit.entry });
    } else if (commit.type === "lens") {
      lens = commit.lens;
    }
  }

  if (selections.length > 0) {
    useAppStore.getState().actions.commitMoodSelections(selections);
  }
  if (lens !== null) {
    const actions = useAppStore.getState().actions;
    actions.setMoodLens(lens);
    actions.setMoodArmedLens(null);
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
    return;
  }

  restartVideosAtPeriodBoundary(audioTime, epoch);
}
