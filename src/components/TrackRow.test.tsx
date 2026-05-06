// ABOUTME: TrackRow tests — record button visibility, placeholder for non-recordable tracks,
// ABOUTME: thumbnail-after-clip, re-record clears the clip.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

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

import { TrackRow } from "./TrackRow";
import { useAppStore } from "../store/useAppStore";
import type { Clip } from "../types";

function makeFakeClip(): Clip {
  return {
    blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    url: "blob:test/1",
    audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
    trimStartMs: 0,
    trimEndMs: 1000,
    durationMs: 1000,
  };
}

describe("TrackRow", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
  });

  it("track 0 shows a record button when no clip is present", () => {
    render(<TrackRow trackId={0} />);
    expect(screen.getByLabelText("record clip for track 1")).toBeInTheDocument();
  });

  it("every track exposes a record button when no clip is present", () => {
    for (let id = 0; id < 8; id++) {
      const { unmount } = render(<TrackRow trackId={id} />);
      expect(screen.getByLabelText(`record clip for track ${id + 1}`)).toBeInTheDocument();
      unmount();
    }
  });

  it("multi-track integration: thumbnails appear for each clipped track", () => {
    const actions = useAppStore.getState().actions;
    actions.setTrackClip(0, makeFakeClip());
    actions.setTrackClip(3, makeFakeClip());
    render(
      <>
        <TrackRow trackId={0} />
        <TrackRow trackId={3} />
        <TrackRow trackId={5} />
      </>,
    );
    expect(screen.getAllByLabelText("re-record")).toHaveLength(2);
    expect(screen.getByLabelText("record clip for track 6")).toBeInTheDocument();
  });

  it("renders 16 step buttons", () => {
    render(<TrackRow trackId={0} />);
    expect(screen.getAllByLabelText(/track 1 step/i)).toHaveLength(16);
  });

  it("after setTrackClip, the row shows a thumbnail and the record button is gone", () => {
    useAppStore.getState().actions.setTrackClip(0, makeFakeClip());
    render(<TrackRow trackId={0} />);
    expect(screen.queryByLabelText("record clip for track 1")).not.toBeInTheDocument();
    expect(screen.getByLabelText("re-record")).toBeInTheDocument();
  });

  it("clicking re-record clears the clip", () => {
    useAppStore.getState().actions.setTrackClip(0, makeFakeClip());
    render(<TrackRow trackId={0} />);
    fireEvent.click(screen.getByLabelText("re-record"));
    expect(useAppStore.getState().project.tracks[0].clip).toBeNull();
  });

  describe("tag picker", () => {
    it("does not render tag chips for an empty track", () => {
      render(<TrackRow trackId={0} />);
      expect(screen.queryByLabelText("tag kick for track 1")).not.toBeInTheDocument();
    });

    it("renders unselected chips after a clip is added", () => {
      useAppStore.getState().actions.setTrackClip(0, makeFakeClip());
      render(<TrackRow trackId={0} />);
      for (const tag of ["kick", "snare", "hat", "vocal", "fx"]) {
        const chip = screen.getByLabelText(`tag ${tag} for track 1`);
        expect(chip).toHaveAttribute("data-selected", "false");
      }
    });

    it("clicking a chip selects it and updates the store", () => {
      useAppStore.getState().actions.setTrackClip(0, makeFakeClip());
      render(<TrackRow trackId={0} />);
      fireEvent.click(screen.getByLabelText("tag kick for track 1"));
      expect(useAppStore.getState().project.tracks[0].tag).toBe("kick");
      expect(screen.getByLabelText("tag kick for track 1")).toHaveAttribute("data-selected", "true");
    });

    it("clicking the selected chip clears the tag", () => {
      useAppStore.getState().actions.setTrackClip(0, makeFakeClip());
      useAppStore.getState().actions.setTrackTag(0, "snare");
      render(<TrackRow trackId={0} />);
      fireEvent.click(screen.getByLabelText("tag snare for track 1"));
      expect(useAppStore.getState().project.tracks[0].tag).toBeNull();
    });
  });

  describe("show-video toggle", () => {
    it("renders the Show-video state by default", () => {
      render(<TrackRow trackId={0} />);
      const toggle = screen.getByLabelText("Show video on cut");
      expect(toggle).toHaveAttribute("data-show-video", "true");
    });

    it("clicking the toggle flips showVideo and updates label", () => {
      render(<TrackRow trackId={2} />);
      fireEvent.click(screen.getByLabelText("Show video on cut"));
      expect(useAppStore.getState().project.tracks[2].showVideo).toBe(false);
      expect(screen.getByLabelText(/Audio only/)).toHaveAttribute("data-show-video", "false");
    });
  });
});
