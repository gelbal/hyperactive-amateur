// ABOUTME: recordingFlow — shared "record into a track" sequence used by TrackRow and the in-viewport RecordingStation.
// ABOUTME: Drives the countdown → record → trim → store → auto-tag pipeline. Pure side-effects against the store and lib modules.
import { useAppStore } from "../store/useAppStore";
import { recordClip } from "./recorder";
import { getAudioContext } from "./audio";
import { autoTrim } from "./autoTrim";
import { autoTag } from "./aiAutoTag";
import { requestMedia } from "./media";
import type { Clip, Tag } from "../types";

export const RECORD_DURATION_MS = 2000;
export const COUNTDOWN_MS = 3000;
export const AUTO_TAG_CONFIDENCE_THRESHOLD = 0.6;

export type AutoTagEvent =
  | { kind: "tagging" }
  | { kind: "applied"; tag: Tag; hatAudioOnly: boolean }
  | { kind: "miss" }
  | { kind: "idle" };

export interface RecordIntoTrackOptions {
  // Notified at the start of auto-tagging, on each terminal status, and once
  // when the whole flow is done. Use to drive a tagging spinner / toast.
  onAutoTag?: (event: AutoTagEvent) => void;
  // Called with the error message if recordClip throws.
  onError?: (message: string) => void;
}

// Run the full record sequence for one track. Resolves with true on a saved
// clip, false if the flow couldn't start (no stream — kicked permission flow)
// or threw during capture.
export async function recordIntoTrack(
  trackId: number,
  options: RecordIntoTrackOptions = {},
): Promise<boolean> {
  const stream = useAppStore.getState().media.stream;
  if (!stream) {
    void requestMedia();
    return false;
  }
  const actions = useAppStore.getState().actions;
  actions.setRecordingState("countdown", trackId);
  await new Promise((r) => setTimeout(r, COUNTDOWN_MS));
  actions.setRecordingState("recording", trackId);
  try {
    const result = await recordClip(stream, RECORD_DURATION_MS, getAudioContext());
    const url = URL.createObjectURL(result.blob);
    const trim = autoTrim(result.audioBuffer);
    const newClip: Clip = {
      blob: result.blob,
      url,
      audioBuffer: result.audioBuffer,
      trimStartMs: trim.trimStartMs,
      trimEndMs: trim.trimEndMs,
      durationMs: result.durationMs,
    };
    actions.setTrackClip(trackId, newClip);
    actions.setRecordingState("idle", null);
    void runAutoTag(trackId, result.audioBuffer, options.onAutoTag);
    return true;
  } catch (e) {
    actions.setRecordingState("idle", null);
    options.onError?.(e instanceof Error ? e.message : String(e));
    return false;
  }
}

async function runAutoTag(
  trackId: number,
  audioBuffer: AudioBuffer,
  onEvent?: (event: AutoTagEvent) => void,
): Promise<void> {
  onEvent?.({ kind: "tagging" });
  const result = await autoTag(audioBuffer);
  if (!result || result.confidence < AUTO_TAG_CONFIDENCE_THRESHOLD) {
    onEvent?.({ kind: "miss" });
    return;
  }
  const actions = useAppStore.getState().actions;
  actions.setTrackTag(trackId, result.tag);
  let hatAudioOnly = false;
  if (result.tag === "hat") {
    const manuallyToggled = useAppStore
      .getState()
      .session.manuallyToggledShowVideo.includes(trackId);
    if (!manuallyToggled) {
      actions.setTrackShowVideo(trackId, false, "system");
      hatAudioOnly = true;
    }
  }
  onEvent?.({ kind: "applied", tag: result.tag, hatAudioOnly });
}
