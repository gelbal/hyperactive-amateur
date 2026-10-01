// ABOUTME: tagPriority — the visual tier of each clip tag, shared by the cut engine and the cover.
// ABOUTME: Higher tiers win hard cuts, so they are also the faces a cover should show first.
import type { Tag } from "../types";

export type TagOrUntagged = Tag | "untagged";

// Higher number wins. Vocal/fx are loud-statement clips; hats are filler.
export const TAG_PRIORITY: Record<TagOrUntagged, number> = {
  vocal: 5,
  fx: 4,
  snare: 3,
  kick: 2,
  hat: 1,
  untagged: 0,
};

export function tagTier(tag: Tag | null): number {
  return TAG_PRIORITY[tag ?? "untagged"];
}
