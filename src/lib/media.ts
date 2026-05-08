// ABOUTME: media — permission state + on-demand stream acquisition for the recording flow.
// ABOUTME: Streams are acquired only during a record cycle and released immediately after, so the camera light stays off the rest of the time.
import { useAppStore } from "../store/useAppStore";

const CONSTRAINTS: MediaStreamConstraints = {
  video: { width: 720, height: 720, facingMode: "user" },
  audio: { sampleRate: 48000, channelCount: 1 },
};

let inFlight: Promise<void> | null = null;

// Confirms permission to use the camera + mic. Acquires a stream just long
// enough to trigger the browser's permission prompt (if needed), then releases
// the tracks immediately so the camera light goes back off. The viewport gate
// flips to 'granted' on success; the recording flow re-acquires its own stream
// when it actually needs to capture.
export async function requestMedia(): Promise<void> {
  const state = useAppStore.getState();
  if (state.media.status === "granted") return;
  if (inFlight) return inFlight;

  state.actions.setMedia({ stream: null, status: "requesting", error: null });

  inFlight = (async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      // Permission confirmed. Release the tracks immediately — the recording
      // flow opens its own stream when it needs one.
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

// Acquire a fresh MediaStream for the duration of one recording. Stores it on
// the media slice so the RecordingStation's <video> can preview it during the
// countdown. Caller is responsible for releasing via releaseRecordingStream.
export async function acquireRecordingStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
  useAppStore
    .getState()
    .actions.setMedia({ stream, status: "granted", error: null });
  return stream;
}

// Release a stream returned by acquireRecordingStream. Stops every track (so
// the camera light goes off) and clears the media slice if this was the
// currently held stream.
export function releaseRecordingStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
  const current = useAppStore.getState().media.stream;
  if (current === stream) {
    useAppStore
      .getState()
      .actions.setMedia({ stream: null, status: "granted", error: null });
  }
}

// Test-only — clears the in-flight promise singleton between cases.
export function __resetMediaForTesting(): void {
  inFlight = null;
}
