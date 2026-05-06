// ABOUTME: Viewport tests — canvas mounts; gate copy switches with media.status.
import { render, screen, fireEvent, act } from "@testing-library/react";
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

  it("renders a labeled canvas at 480x480", () => {
    render(<Viewport />);
    const canvas = screen.getByLabelText("hard-cut video viewport") as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    expect(canvas.width).toBe(480);
    expect(canvas.height).toBe(480);
  });

  it("shows the permission gate when media is idle", () => {
    render(<Viewport />);
    expect(
      screen.getByRole("button", { name: /enable camera & mic/i }),
    ).toBeInTheDocument();
  });

  it("clicking the gate calls requestMedia", () => {
    render(<Viewport />);
    fireEvent.click(screen.getByRole("button", { name: /enable camera & mic/i }));
    expect(requestMedia).toHaveBeenCalledTimes(1);
  });

  it("swaps to the denied copy when status is denied", () => {
    act(() => {
      useAppStore.getState().actions.setMedia({
        stream: null,
        status: "denied",
        error: "user blocked it",
      });
    });
    render(<Viewport />);
    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enable camera & mic/i }),
    ).not.toBeInTheDocument();
  });

  it("hides the gate and mounts the recording station once granted with no clips", () => {
    act(() => {
      useAppStore.getState().actions.setMedia({
        stream: {} as MediaStream,
        status: "granted",
        error: null,
      });
    });
    render(<Viewport />);
    expect(
      screen.queryByRole("button", { name: /enable camera & mic/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("recording station")).toBeInTheDocument();
  });

  it("shows the record-prompt copy after the station is dismissed and no clips exist", () => {
    act(() => {
      useAppStore.getState().actions.setMedia({
        stream: {} as MediaStream,
        status: "granted",
        error: null,
      });
      useAppStore.getState().actions.dismissRecordingStation();
    });
    render(<Viewport />);
    expect(screen.queryByLabelText("recording station")).not.toBeInTheDocument();
    expect(screen.getByText(/record a sound on any track/i)).toBeInTheDocument();
  });
});
