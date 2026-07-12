// ABOUTME: media — permission state, on-demand stream acquisition, and input-device selection.
// ABOUTME: Streams are held only while the RecordingStation is mounted (preview + record reuse the same stream); otherwise the camera light stays off.
import { useAppStore } from "../store/useAppStore";
import {
  registerStreamLifecycle,
  releaseMediaStream,
} from "./streamLifecycle";

let inFlight: Promise<void> | null = null;
let acquireGeneration = 0;
let activeAcquireToken: number | null = null;

export interface CaptureAspect {
  w: number;
  h: number;
}

const DEFAULT_CAPTURE_ASPECT: CaptureAspect = { w: 1, h: 1 };
const IDEAL_CAPTURE_SHORT_EDGE = 720;

function idealCaptureSize(aspect: CaptureAspect): { width: number; height: number } {
  if (aspect.w >= aspect.h) {
    return {
      width: Math.round(IDEAL_CAPTURE_SHORT_EDGE * (aspect.w / aspect.h)),
      height: IDEAL_CAPTURE_SHORT_EDGE,
    };
  }

  return {
    width: IDEAL_CAPTURE_SHORT_EDGE,
    height: Math.round(IDEAL_CAPTURE_SHORT_EDGE * (aspect.h / aspect.w)),
  };
}

// Build a MediaStreamConstraints honoring the user's preferred input devices.
// `ideal` sizing lets the browser negotiate sane defaults instead of throwing
// OverconstrainedError on cameras that don't natively shoot 720x720.
export function buildConstraints(aspect = DEFAULT_CAPTURE_ASPECT): MediaStreamConstraints {
  const { videoDeviceId, audioDeviceId, videoFacingMode } = useAppStore.getState().media;
  const { width, height } = idealCaptureSize(aspect);
  const video: MediaTrackConstraints = {
    width: { ideal: width },
    height: { ideal: height },
    aspectRatio: { ideal: aspect.w / aspect.h },
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

// `token` scopes the destructive half of the fallback: an acquire whose token
// was superseded while getUserMedia was pending must not clear the user's
// newer device choices or fire the retry — it just rethrows and lets the
// caller's stale handling run. requestMedia passes no token: its single-flight
// guard means the fallback is always current there.
async function getUserMediaWithDeviceFallback(
  token?: number,
  aspect?: CaptureAspect,
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(buildConstraints(aspect));
  } catch (err) {
    if (!isStaleDeviceError(err)) throw err;
    if (token !== undefined && token !== acquireGeneration) throw err;
    useAppStore.getState().actions.setPreferredDevices({ video: null, audio: null });
    return navigator.mediaDevices.getUserMedia(buildConstraints(aspect));
  }
}

// Acquire a fresh MediaStream for either preview or capture (same constraints).
// On failure, flip the media slice to 'denied' so the viewport gate re-opens —
// requestMedia is callable again because we no longer short-circuit on
// status === 'granted'. If the failure looks like a stale deviceId, clear the
// preference and retry once with the browser default.
export async function acquireRecordingStream(aspect?: CaptureAspect): Promise<MediaStream> {
  const token = ++acquireGeneration;
  activeAcquireToken = token;
  try {
    const stream = await getUserMediaWithDeviceFallback(token, aspect);
    if (token !== acquireGeneration) {
      releaseMediaStream(stream);
      throw new DOMException("Stale media acquisition", "AbortError");
    }
    const current = useAppStore.getState().media.stream;
    if (current && current !== stream) releaseMediaStream(current);
    registerStreamLifecycle(stream);
    useAppStore
      .getState()
      .actions.setMedia({ stream, status: "granted", error: null });
    return stream;
  } catch (err) {
    if (token === acquireGeneration) {
      const message = err instanceof Error ? err.message : String(err);
      useAppStore
        .getState()
        .actions.setMedia({ stream: null, status: "denied", error: message });
    }
    throw err;
  } finally {
    if (activeAcquireToken === token) activeAcquireToken = null;
  }
}

// Invalidate any pending acquire: bump the generation and clear the active
// token so a later-settling getUserMedia is treated as stale — its tracks get
// stopped and neither its stream nor its failure state is installed.
// streamLifecycle calls this on every lifecycle suspend decision (including
// hidden/pagehide when no stream is held), so a suspension can never be
// undone by a late grant.
export function invalidatePendingAcquire(): void {
  acquireGeneration += 1;
  activeAcquireToken = null;
}

// Release a stream returned by acquireRecordingStream. Stops every track (so
// the camera light goes off) and clears the media slice if this was the
// currently held stream.
export function releaseRecordingStream(stream: MediaStream): void {
  acquireGeneration += 1;
  activeAcquireToken = null;
  releaseMediaStream(stream);
}

export function isAcquireInFlight(): boolean {
  return activeAcquireToken !== null;
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
  acquireGeneration = 0;
  activeAcquireToken = null;
}
