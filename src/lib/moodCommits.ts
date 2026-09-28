// ABOUTME: Thin owner seam for Mood paint-path boundary commits.
// ABOUTME: Drains due transport commits once and applies store-visible performance state.
import { useAppStore } from "../store/useAppStore";
import type { MoodLens, MoodSelectionCommit } from "../types";
import type { BoundaryDropEvent } from "./moodClock";
import { scheduleLockedPlayerSwaps, syncCommittedMoodEngines } from "./moodPerformance";
import { consumeDueCommits, pendingSelectionCommits } from "./moodTransport";
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
    // A re-arm made after its boundary locked waits for the next one: the
    // committed mic stays armed with it. A take deleted meanwhile commits as
    // Off, so it re-arms as Off; a queued swap to what just went live is a
    // no-op and does not re-arm.
    const committedMics = new Set(selections.map((commit) => commit.micId));
    const committedState = useAppStore.getState().mood;
    for (const event of pendingSelectionCommits()) {
      if (!committedMics.has(event.micId)) continue;
      const takeExists = committedState.piece?.mics
        .find((mic) => mic.id === event.micId)
        ?.takes.some((take) => take.id === event.entry);
      const entry = event.entry === "off" || takeExists ? event.entry : "off";
      if (entry === committedState.performance.selections[event.micId]) continue;
      actions.armMoodSelection(event.micId, entry);
    }
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
    syncCommittedMoodEngines({ audioTime });
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
