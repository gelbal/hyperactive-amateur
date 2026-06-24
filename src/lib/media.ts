// ABOUTME: media — permission state, on-demand stream acquisition, and input-device selection.
// ABOUTME: Streams are held only while the RecordingStation is mounted (preview + record reuse the same stream); otherwise the camera light stays off.
import { useAppStore } from "../store/useAppStore";
import {
  attachStreamEndedListeners,
  type StreamLifecycleHandle,
} from "./streamLifecycle";

let inFlight: Promise<void> | null = null;

// Map every active stream to its lifecycle handle so we can detach listeners
// when the stream is intentionally released. WeakMap keeps this GC-safe.
const lifecycleHandles = new WeakMap<MediaStream, StreamLifecycleHandle>();

// Build a MediaStreamConstraints honoring the user's preferred input devices.
// `ideal` sizing lets the browser negotiate sane defaults instead of throwing
// OverconstrainedError on cameras that don't natively shoot 720x720.
export function buildConstraints(): MediaStreamConstraints {
  const { videoDeviceId, audioDeviceId, videoFacingMode } = useAppStore.getState().media;
  const video: MediaTrackConstraints = {
    width: { ideal: 720 },
    height: { ideal: 720 },
    aspectRatio: { ideal: 1 },
  };
  // deviceId wins over facingMode: when the user picks a specific camera in
  // the Sources picker we must honor that exact device, otherwise the front/
  // rear hint can pull a different camera on hybrid devices.
  if (videoDeviceId) {
    video.deviceId = { exact: videoDeviceId };
  } else {
    video.facingMode = videoFacingMode;
  }
  const audio: MediaTrackConstraints = {
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 1 },
  };
  if (audioDeviceId) audio.deviceId = { exact: audioDeviceId };
  return { video, audio };
}

// Confirms permission to use the camera + mic. Acquires a stream just long
// enough to trigger the browser's permission prompt (if needed), then releases
// the tracks immediately so the camera light goes back off. The viewport gate
// flips to 'granted' on success; the recording flow re-acquires its own stream
// when it actually needs to capture.
export async function requestMedia(): Promise<void> {
  if (inFlight) return inFlight;

  useAppStore
    .getState()
    .actions.setMedia({ stream: null, status: "requesting", error: null });

  inFlight = (async () => {
    try {
      const stream = await getUserMediaWithDeviceFallback();
      // Permission confirmed. Release the tracks immediately — the recording
      // flow / preview opens its own stream when it needs one.
      for (const track of stream.getTracks()) track.stop();
      useAppStore
        .getState()
        .actions.setMedia({ stream: null, status: "granted", error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      useAppStore
        .getState()
        .actions.setMedia({ stream: null, status: "denied", error: message });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

// Probe the browser permissions API. If camera + mic are already granted, mark
// the store granted WITHOUT acquiring a stream — that way page loads don't
// flash the camera light.
export async function tryAutoGrantMedia(): Promise<void> {
  const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
  if (!perms || typeof perms.query !== "function") return;
  try {
    const cam = await perms.query({ name: "camera" as PermissionName });
    const mic = await perms.query({ name: "microphone" as PermissionName });
    if (cam.state === "granted" && mic.state === "granted") {
      useAppStore
        .getState()
        .actions.setMedia({ stream: null, status: "granted", error: null });
    }
  } catch {
    // Some browsers throw on unsupported permission names; safe to ignore.
  }
}

// Tracks whether the most recent acquire failure was because of a stale
// deviceId. If so, callers can clear preferences and retry with defaults.
export class StaleDeviceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleDeviceError";
  }
}

function isStaleDeviceError(err: unknown): boolean {
  const name =
    err instanceof Error
      ? err.name
      : typeof err === "object" && err !== null && "name" in err
        ? String((err as { name: unknown }).name)
        : "";
  // Chrome surfaces NotFoundError / OverconstrainedError when a saved deviceId
  // is no longer present (camera unplugged, mic removed).
  return name === "NotFoundError" || name === "OverconstrainedError";
}

async function getUserMediaWithDeviceFallback(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(buildConstraints());
  } catch (err) {
    if (!isStaleDeviceError(err)) throw err;
    useAppStore.getState().actions.setPreferredDevices({ video: null, audio: null });
    return navigator.mediaDevices.getUserMedia(buildConstraints());
  }
}

// Acquire a fresh MediaStream for either preview or capture (same constraints).
// On failure, flip the media slice to 'denied' so the viewport gate re-opens —
// requestMedia is callable again because we no longer short-circuit on
// status === 'granted'. If the failure looks like a stale deviceId, clear the
// preference and retry once with the browser default.
export async function acquireRecordingStream(): Promise<MediaStream> {
  try {
    const stream = await getUserMediaWithDeviceFallback();
    lifecycleHandles.set(stream, attachStreamEndedListeners(stream));
    useAppStore
      .getState()
      .actions.setMedia({ stream, status: "granted", error: null });
    return stream;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    useAppStore
      .getState()
      .actions.setMedia({ stream: null, status: "denied", error: message });
    throw err;
  }
}

// Release a stream returned by acquireRecordingStream. Stops every track (so
// the camera light goes off) and clears the media slice if this was the
// currently held stream.
export function releaseRecordingStream(stream: MediaStream): void {
  // Detach lifecycle listeners BEFORE stopping the tracks so the intentional
  // .stop() doesn't accidentally fire the suspended-transition we wired up
  // for unexpected ends.
  const handle = lifecycleHandles.get(stream);
  if (handle) {
    handle.detach();
    lifecycleHandles.delete(stream);
  }
  for (const track of stream.getTracks()) track.stop();
  const current = useAppStore.getState().media.stream;
  if (current === stream) {
    useAppStore
      .getState()
      .actions.setMedia({ stream: null, status: "granted", error: null });
  }
}

// Preview helpers — same shape as the recording acquire/release, kept as
// separate names so future tweaks (e.g. lower bitrate hints for preview)
// don't require changing the recording path.
export const acquirePreviewStream = acquireRecordingStream;
export const releasePreviewStream = releaseRecordingStream;

export interface InputDeviceList {
  videoInputs: MediaDeviceInfo[];
  audioInputs: MediaDeviceInfo[];
}

// Enumerate available video + audio inputs. Labels are only populated after
// permission has been granted — call after requestMedia() succeeds.
export async function enumerateMediaDevices(): Promise<InputDeviceList> {
  if (
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.enumerateDevices !== "function"
  ) {
    return { videoInputs: [], audioInputs: [] };
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      videoInputs: devices.filter((d) => d.kind === "videoinput"),
      audioInputs: devices.filter((d) => d.kind === "audioinput"),
    };
  } catch {
    return { videoInputs: [], audioInputs: [] };
  }
}

// Test-only — clears the in-flight promise singleton between cases.
export function __resetMediaForTesting(): void {
  inFlight = null;
}
