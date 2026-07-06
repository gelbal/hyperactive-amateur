// ABOUTME: RecordingStation test — target advance on skip, Record fires the flow, Done dismisses, full-track hides.
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const recordIntoTrack = vi.fn();
vi.mock("../lib/recordingFlow", () => ({
  recordIntoTrack: (...args: unknown[]) => recordIntoTrack(...args),
}));

import { RecordingStation } from "./RecordingStation";
import { TrackInfo } from "./TrackInfo";
import { __resetInstallForTesting, captureInstallPrompt } from "../lib/install";
import { __resetMediaForTesting } from "../lib/media";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

const INTERRUPTION_COPY =
  "Recording interrupted — the microphone or camera was taken by another app or call.";
const MANUAL_INSTALL_COPY = "Tap Share → Add to Home Screen to install.";
const originalMatchMedia = window.matchMedia;

function makeClip(): Clip {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    url: "blob:test/x",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    trimStartMs: 0,
    trimEndMs: 800,
    durationMs: 1000,
    posterBlob: null,
    posterUrl: null,
  };
}

function stubMatchMedia({
  coarse = false,
  standalone = false,
}: {
  coarse?: boolean;
  standalone?: boolean;
}) {
  window.matchMedia = vi.fn((query: string) => ({
    matches:
      (query === "(pointer: coarse)" && coarse) ||
      (query === "(display-mode: standalone)" && standalone),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("RecordingStation", () => {
  beforeEach(() => {
    __resetInstallForTesting();
    __resetMediaForTesting();
    recordIntoTrack.mockReset();
    useAppStore.getState().actions.reset();
    window.matchMedia = originalMatchMedia;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetInstallForTesting();
    window.matchMedia = originalMatchMedia;
  });

  it("targets the lowest empty track, Skip advances, Record fires the flow, Done dismisses, full-kit hides the station", async () => {
    const actions = useAppStore.getState().actions;
    actions.setTrackClip(0, makeClip());
    actions.setTrackClip(1, makeClip());
    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });
    expect(screen.getByText("Recording for Track 3")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByLabelText("Skip this track"));
    });
    expect(screen.getByText("Recording for Track 4")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByLabelText("Record clip for track 4"));
    });
    expect(recordIntoTrack).toHaveBeenCalledWith(3, expect.any(Object));

    act(() => {
      fireEvent.click(screen.getByLabelText("Done recording"));
    });
    expect(useAppStore.getState().session.recordingStationDismissed).toBe(true);
    cleanup();

    // The parent normally won't mount this with a full kit, but direct renders
    // still land in the no-target completion state.
    for (let i = 0; i < 8; i++) actions.setTrackClip(i, makeClip());
    actions.reopenRecordingStation();
    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });
    expect(screen.getByText(/all empty tracks were skipped/i)).toBeInTheDocument();
  });

  it("offers a start-over path after every empty track is skipped", async () => {
    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });

    for (let i = 0; i < 8; i += 1) {
      act(() => {
        fireEvent.click(screen.getByLabelText("Skip this track"));
      });
    }

    expect(screen.getByText(/all empty tracks were skipped/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /record first sound/i }));
      await Promise.resolve();
    });
    expect(screen.getByText("Recording for Track 1")).toBeInTheDocument();
  });

  it("dispatches camera flip and disables Flip while recording is not idle", async () => {
    const actions = useAppStore.getState().actions;
    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });

    const flipButton = screen.getByRole("button", { name: "Switch camera" });
    expect(flipButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(flipButton);
      await Promise.resolve();
    });
    expect(useAppStore.getState().media.videoFacingMode).toBe("environment");

    for (const state of ["preparing", "countdown", "recording", "reviewing"] as const) {
      act(() => {
        actions.setRecordingState(state, 0);
      });
      expect(flipButton).toBeDisabled();
    }

    act(() => {
      actions.setRecordingState("idle", null);
    });
    expect(flipButton).not.toBeDisabled();
  });

  it("shows the store recording error while the station is open", async () => {
    useAppStore.getState().actions.setRecordingError(INTERRUPTION_COPY);

    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent(INTERRUPTION_COPY);
  });

  it("shows the store recording error only in the station while the station is open", async () => {
    const actions = useAppStore.getState().actions;
    await act(async () => {
      render(
        <>
          <RecordingStation />
          <TrackInfo trackId={0} />
        </>,
      );
      await Promise.resolve();
    });
    act(() => {
      actions.setMedia({
        stream: null,
        status: "granted",
        error: null,
      });
    });
    act(() => {
      actions.setRecordingState("recording", 0);
    });
    act(() => {
      actions.setRecordingError(INTERRUPTION_COPY);
    });
    act(() => {
      actions.setRecordingState("idle", null);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(INTERRUPTION_COPY);
    expect(screen.getAllByText(INTERRUPTION_COPY)).toHaveLength(1);
  });

  it("does not let a preview acquire that fails after unmount mark media as denied", async () => {
    // Playback starting unmounts the station mid-acquire; the user did not
    // deny anything, so a late getUserMedia failure must not flip the gate
    // to the blocked state.
    useAppStore.getState().actions.setMedia({ stream: null, status: "granted", error: null });
    let rejectAcquire: (err: Error) => void = () => undefined;
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((_, reject) => {
              rejectAcquire = reject;
            }),
        ),
      },
    });
    try {
      const { unmount } = render(<RecordingStation />);
      unmount();
      await act(async () => {
        rejectAcquire(new DOMException("device busy", "NotReadableError"));
        await Promise.resolve();
      });
      expect(useAppStore.getState().media.status).toBe("granted");
      expect(useAppStore.getState().media.error).toBeNull();
    } finally {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: originalMediaDevices,
      });
    }
  });

  it("releases a preview stream that resolves after unmount instead of installing it", async () => {
    useAppStore.getState().actions.setMedia({ stream: null, status: "granted", error: null });
    const stops = [vi.fn(), vi.fn()];
    const fakeStream = {
      getTracks: () => [{ stop: stops[0] }, { stop: stops[1] }],
      getVideoTracks: () => [{ stop: stops[0] }],
      getAudioTracks: () => [{ stop: stops[1] }],
    } as unknown as MediaStream;
    let resolveAcquire: (stream: MediaStream) => void = () => undefined;
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              resolveAcquire = resolve;
            }),
        ),
      },
    });
    try {
      const { unmount } = render(<RecordingStation />);
      unmount();
      await act(async () => {
        resolveAcquire(fakeStream);
        await Promise.resolve();
      });
      // The camera light goes back off and nothing was installed.
      expect(stops[0]).toHaveBeenCalled();
      expect(stops[1]).toHaveBeenCalled();
      expect(useAppStore.getState().media.stream).toBeNull();
      expect(useAppStore.getState().media.status).toBe("granted");
    } finally {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: originalMediaDevices,
      });
    }
  });

  it("shows the manual install hint before clips under feature signals without reading an iOS UA", async () => {
    stubMatchMedia({ coarse: true });
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 Chrome/126",
    );

    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });
    act(() => {
      fireEvent.click(screen.getByLabelText("Choose camera and microphone"));
    });

    expect(screen.getByText(MANUAL_INSTALL_COPY)).toBeInTheDocument();
  });

  it("hides the manual install hint after clips exist", async () => {
    stubMatchMedia({ coarse: true });
    useAppStore.getState().actions.setTrackClip(0, makeClip());

    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });
    act(() => {
      fireEvent.click(screen.getByLabelText("Choose camera and microphone"));
    });

    expect(screen.queryByText(MANUAL_INSTALL_COPY)).toBeNull();
  });

  it("hides the manual install hint when standalone, fine pointer, or install prompt captured", async () => {
    stubMatchMedia({ coarse: true, standalone: true });
    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });
    act(() => {
      fireEvent.click(screen.getByLabelText("Choose camera and microphone"));
    });
    expect(screen.queryByText(MANUAL_INSTALL_COPY)).toBeNull();
    cleanup();

    stubMatchMedia({ coarse: false });
    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });
    act(() => {
      fireEvent.click(screen.getByLabelText("Choose camera and microphone"));
    });
    expect(screen.queryByText(MANUAL_INSTALL_COPY)).toBeNull();
    cleanup();

    stubMatchMedia({ coarse: true });
    const detach = captureInstallPrompt();
    const event = new Event("beforeinstallprompt");
    Object.assign(event, { prompt: async () => undefined });
    window.dispatchEvent(event);
    await act(async () => {
      render(<RecordingStation />);
      await Promise.resolve();
    });
    act(() => {
      fireEvent.click(screen.getByLabelText("Choose camera and microphone"));
    });
    expect(screen.queryByText(MANUAL_INSTALL_COPY)).toBeNull();
    expect(screen.getByRole("button", { name: "Install app" })).toBeInTheDocument();
    detach();
  });
});
