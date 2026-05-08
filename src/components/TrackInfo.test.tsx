// ABOUTME: TrackInfo tests — record button visibility, tag picker click, eye toggle marks user-source.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/aiAutoTag", () => ({ autoTag: vi.fn() }));
vi.mock("tone", () => ({
  start: vi.fn().mockResolvedValue(undefined),
  getTransport: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    clear: vi.fn(),
    scheduleRepeat: vi.fn(() => 1),
    bpm: { value: 90 },
  })),
  getDraw: vi.fn(() => ({ schedule: vi.fn() })),
  getContext: vi.fn(() => ({ rawContext: {} })),
  MembraneSynth: vi.fn(() => ({
    triggerAttackRelease: vi.fn(),
    toDestination: vi.fn(function (this: object) {
      return this;
    }),
  })),
}));

import { TrackInfo } from "./TrackInfo";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

function makeClip(): Clip {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    url: "blob:test/1",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    trimStartMs: 0,
    trimEndMs: 1000,
    durationMs: 1000,
  };
}

describe("TrackInfo", () => {
  beforeEach(() => useAppStore.getState().actions.reset());

  it("shows the record button when empty; thumbnail + tag chips appear after a clip lands", () => {
    const { rerender } = render(<TrackInfo trackId={0} />);
    expect(screen.getByLabelText("record clip for track 1")).toBeInTheDocument();
    expect(screen.queryByLabelText("tag kick for track 1")).not.toBeInTheDocument();

    useAppStore.getState().actions.setTrackClip(0, makeClip());
    rerender(<TrackInfo trackId={0} />);
    expect(screen.queryByLabelText("record clip for track 1")).not.toBeInTheDocument();
    expect(screen.getByLabelText("re-record")).toBeInTheDocument();
    expect(screen.getByLabelText("tag kick for track 1")).toBeInTheDocument();
  });

  it("clicking a tag chip toggles the tag; clicking the eye marks the track as user-touched", () => {
    useAppStore.getState().actions.setTrackClip(0, makeClip());
    render(<TrackInfo trackId={0} />);
    fireEvent.click(screen.getByLabelText("tag kick for track 1"));
    expect(useAppStore.getState().project.tracks[0].tag).toBe("kick");
    fireEvent.click(screen.getByLabelText("Show video on cut"));
    expect(useAppStore.getState().project.tracks[0].showVideo).toBe(false);
    expect(useAppStore.getState().session.manuallyToggledShowVideo).toContain(0);
  });
});
