// ABOUTME: applyClassifiedTag — single point of "AI says this track is tag X" → store mutation.
// ABOUTME: Honors manual tag picks and manual showVideo toggles so an auto-tag result never silently steamrolls a user choice.
import { useAppStore } from "../store/useAppStore";
import type { Tag } from "../types";

export interface ApplyClassifiedTagOutcome {
  applied: boolean;
  hatAudioOnly: boolean;
}

// Skipped entirely when the user has hand-picked a tag for this track in
// this session — a stale auto-tag result must not silently override a
// deliberate user choice. The user's explicit showVideo toggle always
// wins; otherwise the system picks audio-only for hat and video-on for
// every other tag. Symmetry matters when re-tag changes a track's
// category — without it, a track previously system-flipped to audio-only
// as a hat would stay hidden after being re-classified as
// kick / snare / vocal / fx.
export function applyClassifiedTag(
  trackId: number,
  tag: Tag,
  reasoning?: string | null,
): ApplyClassifiedTagOutcome {
  const state = useAppStore.getState();
  if (state.session.manuallyTagged.includes(trackId)) {
    return { applied: false, hatAudioOnly: false };
  }
  state.actions.setTrackTag(trackId, tag, "system");
  state.actions.setTrackTagReasoning(trackId, reasoning ?? null);
  if (state.session.manuallyToggledShowVideo.includes(trackId)) {
    return { applied: true, hatAudioOnly: false };
  }
  const desiredShowVideo = tag !== "hat";
  state.actions.setTrackShowVideo(trackId, desiredShowVideo, "system");
  return { applied: true, hatAudioOnly: tag === "hat" };
}
