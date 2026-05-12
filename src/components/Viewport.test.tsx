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

  it("after the recording station is dismissed and no clips exist, shows the record-prompt copy", () => {
    act(() => {
      useAppStore.getState().actions.setMedia({ stream: {} as MediaStream, status: "granted", error: null });
      useAppStore.getState().actions.dismissRecordingStation();
    });
    render(<Viewport />);
    expect(screen.queryByLabelText("recording station")).not.toBeInTheDocument();
    expect(screen.getByText(/record a sound on any track/i)).toBeInTheDocument();
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
});
