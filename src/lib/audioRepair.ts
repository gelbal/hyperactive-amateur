// ABOUTME: audioRepair — retries decoding repair-state clip audio once sound is available.
// ABOUTME: Subscribes to audioState transitions; heals audioStatus:"unavailable" clips in place.
import { useAppStore } from "../store/useAppStore";
import { decodeClipAudio } from "./rehydrate";
import { audioBufferToWav } from "./wavEncoder";
import { logger, LOG_EVENTS } from "./logger";

let repairInFlight = false;

// One pass over every repair-state clip: decode the kept sidecar (or the
// video container as legacy fallback) and heal the track on success. Failures
// leave the clip in its repair state — re-record stays the manual way out.
export async function attemptAudioRepair(): Promise<void> {
  if (repairInFlight) return;
  const state = useAppStore.getState();
  if (state.playback.isExporting) return;
  const candidates = state.project.tracks.filter(
    (track) => track.clip && track.clip.audioStatus === "unavailable",
  );
  if (candidates.length === 0) return;
  repairInFlight = true;
  try {
    for (const track of candidates) {
      const clip = track.clip;
      if (!clip) continue;
      try {
        const audioBuffer = await decodeClipAudio(clip.blob, clip.audioBlob ?? null);
        let audioBlob = clip.audioBlob ?? null;
        if (!audioBlob) {
          // Best-effort: rebuild the missing playback sidecar so future loads
          // stop depending on video-container audio decode.
          try {
            audioBlob = audioBufferToWav(audioBuffer);
          } catch {
            audioBlob = null;
          }
        }
        useAppStore.getState().actions.restoreTrackAudio(track.id, audioBuffer, audioBlob, clip);
        // The action no-ops when the clip was replaced mid-decode or an
        // export froze mutations — only log a repair that actually landed.
        const healedClip = useAppStore.getState().project.tracks[track.id]?.clip;
        if (healedClip && healedClip !== clip && healedClip.audioStatus === "ok") {
          logger.info(LOG_EVENTS.AUDIO_REPAIRED, { trackId: track.id });
        }
      } catch {
        // Still undecodable — stays in repair state.
      }
    }
  } finally {
    repairInFlight = false;
  }
}

// Wire the retry to the moment sound becomes available: every transition of
// playback.audioState into "running" kicks one repair pass. Returns the
// unsubscribe for App-level cleanup.
export function initAudioRepair(): () => void {
  return useAppStore.subscribe((state, prev) => {
    if (
      state.playback.audioState === "running" &&
      prev.playback.audioState !== "running"
    ) {
      void attemptAudioRepair();
    }
  });
}

// Test-only: clears the single-flight latch between cases.
export function __resetAudioRepairForTesting(): void {
  repairInFlight = false;
}
