// ABOUTME: media — top-level getUserMedia request + store mirror, callable from any component.
// ABOUTME: Replaces the old useMediaStream hook so the viewport, camera tile, and recording flow share one source.
import { useAppStore } from "../store/useAppStore";

const CONSTRAINTS: MediaStreamConstraints = {
  video: { width: 720, height: 720, facingMode: "user" },
  audio: { sampleRate: 48000, channelCount: 1 },
};

let inFlight: Promise<void> | null = null;

export async function requestMedia(): Promise<void> {
  const state = useAppStore.getState();
  if (state.media.stream) return;
  if (inFlight) return inFlight;

  state.actions.setMedia({ stream: null, status: "requesting", error: null });

  inFlight = (async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      useAppStore
        .getState()
        .actions.setMedia({ stream, status: "granted", error: null });
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

// Probe the browser permissions API and silently call requestMedia if camera +
// microphone are already granted. Lets a refreshed app skip the gate when the
// browser still remembers the user's earlier consent.
export async function tryAutoGrantMedia(): Promise<void> {
  const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
  if (!perms || typeof perms.query !== "function") return;
  try {
    const cam = await perms.query({ name: "camera" as PermissionName });
    const mic = await perms.query({ name: "microphone" as PermissionName });
    if (cam.state === "granted" && mic.state === "granted") {
      await requestMedia();
    }
  } catch {
    // Some browsers throw on unsupported permission names; safe to ignore.
  }
}

export function stopMedia(): void {
  const state = useAppStore.getState();
  if (state.media.stream) {
    for (const track of state.media.stream.getTracks()) track.stop();
  }
  state.actions.setMedia({ stream: null, status: "idle", error: null });
}

// Test-only — clears the in-flight promise singleton between cases.
export function __resetMediaForTesting(): void {
  inFlight = null;
}
