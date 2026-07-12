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

vi.mock("../../lib/audio", () => ({
  getAudioContext: audioMocks.getAudioContext,
}));

vi.mock("../../lib/moodRecordingFlow", () => ({
  countInBeatSeconds: moodRecordingMocks.countInBeatSeconds,
  stopMoodTakeEarly: moodRecordingMocks.stopMoodTakeEarly,
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

    expect(screen.getByRole("button", { name: /Mic 1, live/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /Mic 2, armed/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mic 3, recording/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mic 4, off/i })).toBeInTheDocument();

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

  it("shows countdown beats and stops from the hot mic chip", async () => {
    vi.useFakeTimers();
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodTake("mic-0", makeTake("take-live"));
    useAppStore.getState().actions.setMoodHotMic("mic-0");
    useAppStore.getState().actions.setCountdownEndsAt(1.5);
    useAppStore.getState().actions.setRecordingState("countdown", null);

    render(<MicStrip piece={useAppStore.getState().mood.piece!} />);

    const hotChip = screen.getByRole("button", { name: /Mic 1, recording.*Stop take/i });
    expect(screen.getByTestId("mic-mic-0-ring")).toHaveClass("border-red-500");
    expect(screen.getByTestId("mic-mic-0-rec-dot")).toBeInTheDocument();
    expect(screen.getByTestId("mic-mic-0-countdown")).toHaveTextContent("3");

    audioMocks.context.currentTime = 0.51;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByTestId("mic-mic-0-countdown")).toHaveTextContent("2");

    fireEvent.click(hotChip);

    expect(moodRecordingMocks.stopMoodTakeEarly).toHaveBeenCalledTimes(1);

  });

  it("opens a stack sheet from a 44px coarse-pointer mic chip", () => {
    useAppStore.getState().actions.createMoodPiece("corners", "pocket");
    useAppStore.getState().actions.setMoodTake("mic-0", makeTake("take-a"));

    render(<MicStrip piece={useAppStore.getState().mood.piece!} />);

    const micOne = screen.getByRole("button", { name: /Mic 1, off/i });
    expect(micOne).toHaveClass("min-h-11", "pointer-coarse:min-h-12");
    expect(micOne).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(micOne);

    expect(micOne).toHaveAttribute("aria-expanded", "true");
    expect(micOne).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("dialog", { name: "Mic 1 stack" })).toBeInTheDocument();
  });
});
