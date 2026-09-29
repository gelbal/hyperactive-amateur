// ABOUTME: Thin owner seam for Mood paint-path boundary commits.
// ABOUTME: Drains due transport commits once and applies store-visible performance state.
import { useAppStore } from "../store/useAppStore";
import type { MoodSelectionCommit } from "../types";
import { consumeDueCommits } from "./moodTransport";

export function applyDueCommits(audioTime: number): void {
  const due = consumeDueCommits(audioTime);
  if (due.length === 0) return;

  const selections: MoodSelectionCommit[] = [];
  for (const commit of due) {
    if (commit.type === "selection") {
      selections.push({ micId: commit.micId, entry: commit.entry });
    }
  }

  if (selections.length > 0) {
    useAppStore.getState().actions.commitMoodSelections(selections);
  }
}
