// ABOUTME: PadGrid tests — verifies pad-trigger promise handling at the UI boundary and the kit voice named on empty pads.
// ABOUTME: Keeps audio mocked so click behavior can target unhandled-rejection regressions.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  triggerTrackNow: vi.fn(),
}));
const audioLifecycleMocks = vi.hoisted(() => ({
  AudioUnavailableError: class TestAudioUnavailableError extends Error {
    constructor(message = "Audio unavailable") {
      super(message);
      this.name = "AudioUnavailableError";
    }
  },
}));

vi.mock("../lib/audio", () => ({
  triggerTrackNow: audioMocks.triggerTrackNow,
}));

vi.mock("../lib/audioLifecycle", () => ({
  AudioUnavailableError: audioLifecycleMocks.AudioUnavailableError,
}));

import { useAppStore } from "../store/useAppStore";
import { PadGrid } from "./PadGrid";
import type { Clip } from "../types";

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

describe("PadGrid", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    audioMocks.triggerTrackNow.mockReset();
    audioMocks.triggerTrackNow.mockResolvedValue(undefined);
  });

  it("swallows audio-unavailable pad rejections from clicks", async () => {
    audioMocks.triggerTrackNow.mockRejectedValueOnce(
      new audioLifecycleMocks.AudioUnavailableError(),
    );

    render(<PadGrid />);
    fireEvent.click(screen.getByRole("button", { name: "pad 1, kick" }));

    expect(audioMocks.triggerTrackNow).toHaveBeenCalledWith(0);
    await Promise.resolve();
  });

  it("an empty pad names its kit voice; the tag corner shows only with a clip", () => {
    const actions = useAppStore.getState().actions;
    render(<PadGrid />);
    // The voice is part of the pad's name, so a screen reader says it too.
    const pad = screen.getByRole("button", { name: "pad 4, open hat" });
    expect(within(pad).getByText("open hat")).toHaveClass("text-zinc-400");

    act(() => {
      actions.setTrackClip(3, makeClip());
      actions.setTrackTag(3, "fx");
    });
    expect(within(pad).queryByText("open hat")).toBeNull();
    expect(within(pad).getByText("fx")).toHaveClass("text-orange-300");
    expect(pad).toHaveAccessibleName("pad 4");

    act(() => actions.clearTrackClip(3));
    expect(within(pad).getByText("open hat")).toBeInTheDocument();
    expect(within(pad).queryByText("fx")).toBeNull();
  });
});
