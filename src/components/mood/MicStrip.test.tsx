// ABOUTME: MicStrip tests — pins Mood mic chip state, poster, and touch sizing.
// ABOUTME: Verifies the strip opens each mic's stack without replacing keyboard arming.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => {
  const context = { currentTime: 0 };
  return {
    context,
    getAudioContext: vi.fn(() => context as AudioContext),
  };
});

const moodRecordingMocks = vi.hoisted(() => ({
  countInBeatSeconds: vi.fn(() => 0.5),
  stopMoodTakeEarly: vi.fn(),
}));

const recordingCancelMocks = vi.hoisted(() => ({
  cancelActiveRecordingByUser: vi.fn(),
}));

vi.mock("../../lib/audio", () => ({
  getAudioContext: audioMocks.getAudioContext,
}));

vi.mock("../../lib/moodRecordingFlow", () => ({
  countInBeatSeconds: moodRecordingMocks.countInBeatSeconds,
  stopMoodTakeEarly: moodRecordingMocks.stopMoodTakeEarly,
}));

vi.mock("../../lib/useRecordingEscapeCancel", () => ({
  cancelActiveRecordingByUser: recordingCancelMocks.cancelActiveRecordingByUser,
}));

import { MicStrip } from "./MicStrip";
import { useAppStore } from "../../store/useAppStore";
import type { MoodTake } from "../../types";

function makeBlob(bytes: number[], type: string): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

function makeTake(id: string, overrides: Partial<MoodTake> = {}): MoodTake {
  return {
    id,
    videoBlob: makeBlob([1, 2, 3], "video/webm"),
    audioBlob: makeBlob([4, 5, 6], "audio/wav"),
    posterBlob: makeBlob([7, 8, 9], "image/jpeg"),
    url: `blob:test/${id}`,
    audioBuffer: { duration: 1.5, sampleRate: 48000 } as AudioBuffer,
    audioStatus: "ok",
    posterUrl: `blob:test/${id}-poster`,
    trimStartMs: 0,
    trimEndMs: 1500,
    durationSeconds: 1.5,
    cycleMultiple: 1,
    syncOffsetMs: 0,
    part: null,
    partSource: null,
    recordedAt: 1,
    ...overrides,
  };
}

describe("MicStrip", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    useAppStore.getState().actions.setAppMode("mood");
    useAppStore.getState().actions.setMoodHydration("ready");
    audioMocks.context.currentTime = 0;
    audioMocks.getAudioContext.mockClear();
    moodRecordingMocks.countInBeatSeconds.mockReturnValue(0.5);
    moodRecordingMocks.stopMoodTakeEarly.mockReset();
    recordingCancelMocks.cancelActiveRecordingByUser.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders one accessible chip per mic with live, armed, hot, and off states", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodTake("mic-0", makeTake("take-live"));
    useAppStore.getState().actions.setMoodTake("mic-1", makeTake("take-armed"));
    useAppStore.getState().actions.commitMoodSelections([
      { micId: "mic-0", entry: "take-live" },
    ]);
    useAppStore.getState().actions.armMoodSelection("mic-1", "take-armed");
    useAppStore.getState().actions.setMoodHotMic("mic-2");

    render(<MicStrip piece={useAppStore.getState().mood.piece!} />);

    expect(
      screen.getByRole("button", { name: "mic 1 — live: take 1. Open stack" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "mic 2 — armed: take 1. Open stack" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "mic 3 — recording. Cancel take" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "mic 4 — off. Open stack" }),
    ).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByText("ARMED")).toBeInTheDocument();
    expect(screen.getByText("OFF")).toBeInTheDocument();

    expect(screen.getByTestId("mic-mic-0-poster")).toHaveAttribute(
      "src",
      "blob:test/take-live-poster",
    );
    expect(screen.getByTestId("mic-mic-1-ring")).toHaveClass(
      "animate-pulse",
      "border-orange-400",
    );
    expect(screen.getByTestId("mic-mic-0-ring")).toHaveClass("border-orange-500");
    expect(screen.getByTestId("mic-mic-2-ring")).toHaveClass("border-red-500");
    expect(screen.getByText("REC")).toBeInTheDocument();
    expect(screen.getByTestId("mic-mic-3-ring")).toHaveClass(
      "border-zinc-700",
      "opacity-60",
    );
    expect(screen.getByTestId("mic-mic-3-empty")).toHaveClass("border-dashed");
  });

  it("shows countdown beats and cancels from the hot mic chip before capture", async () => {
    vi.useFakeTimers();
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodTake("mic-0", makeTake("take-live"));
    useAppStore.getState().actions.setMoodHotMic("mic-0");
    useAppStore.getState().actions.setCountdownEndsAt(1.5);
    useAppStore.getState().actions.setRecordingState("countdown", null);

    render(<MicStrip piece={useAppStore.getState().mood.piece!} />);

    const hotChip = screen.getByRole("button", { name: /mic 1 — recording.*Cancel take/i });
    expect(screen.getByTestId("mic-mic-0-ring")).toHaveClass("border-red-500");
    expect(screen.getByTestId("mic-mic-0-rec-dot")).toBeInTheDocument();
    expect(screen.getByTestId("mic-mic-0-countdown")).toHaveTextContent("3");

    audioMocks.context.currentTime = 0.51;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByTestId("mic-mic-0-countdown")).toHaveTextContent("2");

    fireEvent.click(hotChip);

    expect(recordingCancelMocks.cancelActiveRecordingByUser).toHaveBeenCalledTimes(1);
    expect(moodRecordingMocks.stopMoodTakeEarly).not.toHaveBeenCalled();

  });

  it("stops the take from the hot mic chip during capture", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodTake("mic-0", makeTake("take-live"));
    useAppStore.getState().actions.setMoodHotMic("mic-0");
    useAppStore.getState().actions.setRecordingState("recording", null);

    render(<MicStrip piece={useAppStore.getState().mood.piece!} />);

    fireEvent.click(screen.getByRole("button", { name: /mic 1 — recording.*Stop take/i }));

    expect(moodRecordingMocks.stopMoodTakeEarly).toHaveBeenCalledTimes(1);
    expect(recordingCancelMocks.cancelActiveRecordingByUser).not.toHaveBeenCalled();
  });

  it("opens a stack sheet from a 44px coarse-pointer mic chip", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodTake("mic-0", makeTake("take-a"));

    render(<MicStrip piece={useAppStore.getState().mood.piece!} />);

    const micOne = screen.getByRole("button", { name: /mic 1 — off/i });
    expect(micOne).toHaveClass("min-h-11", "pointer-coarse:min-h-12");
    expect(micOne).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(micOne);

    expect(micOne).toHaveAttribute("aria-expanded", "true");
    expect(micOne).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("dialog", { name: "Mic 1 stack" })).toBeInTheDocument();
  });
});
