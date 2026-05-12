// ABOUTME: recordingFlow — shared "record into a track" sequence used by TrackRow and the in-viewport RecordingStation.
// ABOUTME: Drives the countdown → record → trim → store → auto-tag pipeline; module-level controller serializes flows + carries Esc cancellation.
import { useAppStore } from "../store/useAppStore";
import { recordClip } from "./recorder";
import { getAudioContext } from "./audio";
import { autoTrim } from "./autoTrim";
import { autoTag } from "./aiAutoTag";
import { acquireRecordingStream, releaseRecordingStream, requestMedia } from "./media";
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
  // When provided, the flow uses this stream instead of acquiring a fresh one
  // (and skips the matching release). Lets the RecordingStation share a
  // single preview stream across multiple recording cycles.
  stream?: MediaStream;
}

// Module-level singleton controller — serializes recording flows and carries
// the Esc cancellation signal. The RecordCountdown listens for Esc and calls
// cancelCurrentRecording() to abort the active flow.
let currentController: AbortController | null = null;
let currentFlow: Promise<boolean> | null = null;

export function cancelCurrentRecording(): void {
  currentController?.abort();
}

export function isRecordingInFlight(): boolean {
  return currentFlow !== null;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function waitMs(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted before wait started", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted during wait", "AbortError"));
    };
    signal.addEventListener("abort", onAbort);
  });
}

// Run the full record sequence for one track. Acquires a fresh MediaStream
// for the cycle (unless one was passed in), runs countdown → record → trim →
// store → auto-tag, then releases the stream (camera light goes off).
// Resolves with true on a saved clip, false if permission isn't granted yet,
// capture threw, or the user pressed Esc.
//
// If another flow is already in progress (double-click race), the second call
// resolves false without doing anything.
export async function recordIntoTrack(
  trackId: number,
  options: RecordIntoTrackOptions = {},
): Promise<boolean> {
  if (currentFlow) return false;

  const controller = new AbortController();
  currentController = controller;
  const flow = runFlow(trackId, options, controller.signal);
  currentFlow = flow;
  try {
    return await flow;
  } finally {
    if (currentController === controller) currentController = null;
    if (currentFlow === flow) currentFlow = null;
  }
}

async function runFlow(
  trackId: number,
  options: RecordIntoTrackOptions,
  signal: AbortSignal,
): Promise<boolean> {
  const actions = useAppStore.getState().actions;

  const externalStream = options.stream ?? null;
  let stream: MediaStream;
  if (externalStream) {
    stream = externalStream;
  } else {
    try {
      stream = await acquireRecordingStream();
    } catch (e) {
      // Permission may have been revoked since the last grant — surface the
      // viewport gate so the user can re-allow.
      void requestMedia();
      options.onError?.(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  actions.setRecordingState("countdown", trackId);
  try {
    await waitMs(COUNTDOWN_MS, signal);
    actions.setRecordingState("recording", trackId);
    const result = await recordClip(stream, RECORD_DURATION_MS, getAudioContext(), { signal });
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
    void runAutoTag(trackId, result.audioBuffer, options.onAutoTag);
    return true;
  } catch (e) {
    if (isAbortError(e)) {
      // User pressed Esc — quietly bail without saving.
      return false;
    }
    options.onError?.(e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    if (!externalStream) releaseRecordingStream(stream);
    actions.setRecordingState("idle", null);
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
