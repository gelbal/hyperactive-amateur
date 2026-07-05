// ABOUTME: RecordCountdown tests — preparing copy, audio-clock countdown digits, and cancel affordances.
// ABOUTME: Pins the overlay to the shared recording deadline instead of a component-local epoch.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => {
  const context = { currentTime: 0 };
  return {
    context,
    getAudioContext: vi.fn(() => context as AudioContext),
  };
});

const recordingFlowMocks = vi.hoisted(() => ({
  cancelCurrentRecording: vi.fn(),
}));

vi.mock("../lib/audio", () => ({
  getAudioContext: audioMocks.getAudioContext,
}));

vi.mock("../lib/recordingFlow", () => ({
  cancelCurrentRecording: (...args: unknown[]) =>
    recordingFlowMocks.cancelCurrentRecording(...args),
}));

import { useAppStore } from "../store/useAppStore";
import { RecordCountdown } from "./RecordCountdown";

function renderForState(
  state: "preparing" | "countdown" | "recording",
  countdownEndsAt: number | null = null,
) {
  act(() => {
    useAppStore.getState().actions.setCountdownEndsAt(countdownEndsAt);
    useAppStore.getState().actions.setRecordingState(state, 0);
  });
  render(<RecordCountdown />);
}

describe("RecordCountdown", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    recordingFlowMocks.cancelCurrentRecording.mockReset();
    audioMocks.context.currentTime = 0;
    audioMocks.getAudioContext.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the preparing state with exact "Getting the camera ready…" copy, Cancel, and Esc hint', () => {
    renderForState("preparing");

    expect(screen.getByText("Getting the camera ready…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel recording" })).toBeInTheDocument();
    expect(screen.getByText("Press Esc to cancel")).toBeInTheDocument();
    expect(screen.queryByText(/^[123]$/)).not.toBeInTheDocument();
  });

  it("derives countdown digits from the shared audio-clock deadline", async () => {
    vi.useFakeTimers();
    audioMocks.context.currentTime = 20;
    renderForState("countdown", 23);

    expect(screen.getByText("3")).toBeInTheDocument();

    audioMocks.context.currentTime = 21.01;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByText("2")).toBeInTheDocument();

    audioMocks.context.currentTime = 22.01;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it.each(["preparing", "countdown"] as const)(
    "lets Cancel and Esc abort the %s phase",
    (state) => {
      renderForState(state, state === "countdown" ? 3 : null);

      fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));
      expect(recordingFlowMocks.cancelCurrentRecording).toHaveBeenCalledTimes(1);
      expect(recordingFlowMocks.cancelCurrentRecording).toHaveBeenNthCalledWith(1, "user");

      fireEvent.keyDown(window, { key: "Escape" });
      expect(recordingFlowMocks.cancelCurrentRecording).toHaveBeenCalledTimes(2);
      expect(recordingFlowMocks.cancelCurrentRecording).toHaveBeenNthCalledWith(2, "user");
    },
  );

  it("keeps the existing recording indicator behavior while recording", () => {
    renderForState("recording");

    expect(screen.getByText("Recording")).toBeInTheDocument();
    expect(screen.getByText("Press Esc to cancel")).toBeInTheDocument();
  });
});
