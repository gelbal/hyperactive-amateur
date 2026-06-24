// ABOUTME: Viewport tests — gate-state transitions across idle/denied/granted; recording station mount.
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("tone", () => ({
  now: vi.fn(() => 0),
  getTransport: vi.fn(() => ({
    clear: vi.fn(),
    scheduleRepeat: vi.fn(() => 1),
  })),
}));

const requestMedia = vi.fn();
vi.mock("../lib/media", () => ({
  requestMedia: () => requestMedia(),
}));

import { Viewport } from "./Viewport";
import { useAppStore } from "../store/useAppStore";

describe("Viewport", () => {
  beforeEach(() => {
    requestMedia.mockReset();
    useAppStore.getState().actions.reset();
    // jsdom doesn't ship Element#requestFullscreen by default — stub it so
    // the capability guard (M3-2) treats the platform as supporting fullscreen
    // for the toggle-visibility assertion below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document.documentElement as any).requestFullscreen = () => Promise.resolve();
  });

  it("keeps canvas backing store at 480x480 even when CSS scales", () => {
    render(<Viewport />);
    const canvas = screen.getByLabelText(
      "hard-cut video viewport",
    ) as HTMLCanvasElement;
    expect(canvas.width).toBe(480);
    expect(canvas.height).toBe(480);
  });

  it("idle: shows the gate; click calls requestMedia. Denied: swaps to blocked copy. Granted: gate gone, station mounted.", () => {
    // Idle.
    render(<Viewport />);
    fireEvent.click(screen.getByRole("button", { name: /enable camera & mic/i }));
    expect(requestMedia).toHaveBeenCalledTimes(1);
    cleanup();

    // Denied.
    act(() => {
      useAppStore.getState().actions.setMedia({ stream: null, status: "denied", error: "user blocked it" });
    });
    render(<Viewport />);
    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enable camera & mic/i })).not.toBeInTheDocument();
    cleanup();

    // Granted.
    act(() => {
      useAppStore.getState().actions.setMedia({ stream: {} as MediaStream, status: "granted", error: null });
    });
    render(<Viewport />);
    expect(screen.queryByRole("button", { name: /enable camera & mic/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("recording station")).toBeInTheDocument();
  });

  it("after the recording station is dismissed and no clips exist, shows an actionable first-record affordance", () => {
    act(() => {
      useAppStore.getState().actions.setMedia({ stream: {} as MediaStream, status: "granted", error: null });
      useAppStore.getState().actions.dismissRecordingStation();
    });
    render(<Viewport />);
    expect(screen.queryByLabelText("recording station")).not.toBeInTheDocument();
    expect(screen.getByText(/record a sound on any track/i)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /record first sound/i });
    fireEvent.click(button);
    expect(useAppStore.getState().session.recordingStationDismissed).toBe(false);
  });

  it("idle media + all tracks have clips + station dismissed: gate stays hidden and fullscreen toggle is visible", () => {
    act(() => {
      const setTrackClip = useAppStore.getState().actions.setTrackClip;
      for (let i = 0; i < 8; i++) {
        setTrackClip(i, {
          blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
          url: `blob:test/clip-${i}`,
          audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
          trimStartMs: 0,
          trimEndMs: 800,
          durationMs: 1000,
          posterBlob: null,
          posterUrl: null,
        });
      }
      useAppStore.getState().actions.dismissRecordingStation();
    });
    render(<Viewport />);
    expect(screen.queryByRole("button", { name: /enable camera & mic/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enter fullscreen/i })).toBeInTheDocument();
  });

  it("suspended: reconnect pill shows; permission gate does NOT show; clicking pill calls resumeMedia", () => {
    act(() => {
      useAppStore.getState().actions.setMedia({
        stream: null,
        status: "suspended",
        error: null,
      });
    });
    render(<Viewport />);
    const pill = screen.getByRole("button", { name: /tap to reconnect/i });
    expect(pill).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enable camera & mic/i }),
    ).not.toBeInTheDocument();

    // resumeMedia is a real action that dynamic-imports media.ts;
    // we just verify the click handler is wired by spying on it.
    const spy = vi.spyOn(useAppStore.getState().actions, "resumeMedia");
    fireEvent.click(pill);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("idle media + some empty tracks + station dismissed: gate hidden, Record more pill is visible", () => {
    act(() => {
      useAppStore.getState().actions.setTrackClip(0, {
        blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
        url: "blob:test/clip-0",
        audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
        trimStartMs: 0,
        trimEndMs: 800,
        durationMs: 1000,
        posterBlob: null,
        posterUrl: null,
      });
      useAppStore.getState().actions.dismissRecordingStation();
    });
    render(<Viewport />);
    expect(screen.queryByRole("button", { name: /enable camera & mic/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record more/i })).toBeInTheDocument();
  });

  it("idle media + no clips + station dismissed: gate hidden until the first-record affordance is clicked", () => {
    act(() => {
      useAppStore.getState().actions.dismissRecordingStation();
    });
    render(<Viewport />);
    expect(screen.queryByRole("button", { name: /enable camera & mic/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /record first sound/i }));

    expect(screen.getByRole("button", { name: /enable camera & mic/i })).toBeInTheDocument();
  });
});
