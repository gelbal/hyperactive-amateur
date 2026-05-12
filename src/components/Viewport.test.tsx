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
});
