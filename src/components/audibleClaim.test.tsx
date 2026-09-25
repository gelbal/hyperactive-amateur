// ABOUTME: Regression test — a pad tap must leave the other pads and the Play button enabled.
// ABOUTME: Renders the real gate and audio module (Tone mocked) so the claim → store write → release order is real.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAudioContextStub, type AudioContextStub } from "../test-utils/audioContextStub";

const transportMock = {
  start: vi.fn(),
  stop: vi.fn(),
  clear: vi.fn(),
  scheduleRepeat: vi.fn(() => 1),
  bpm: { value: 90 },
  swing: 0,
  swingSubdivision: "16n",
  position: 0,
};
const drawMock = { schedule: vi.fn((fn: () => void) => fn()) };
let audioContextStub: AudioContextStub;

vi.mock("../lib/videoEngine", () => ({
  trigger: vi.fn(),
  resetPlaybackState: vi.fn(),
}));

vi.mock("tone", () => ({
  start: vi.fn().mockResolvedValue(undefined),
  getTransport: vi.fn(() => transportMock),
  getDraw: vi.fn(() => drawMock),
  getContext: vi.fn(() => ({ rawContext: audioContextStub })),
  MembraneSynth: vi.fn(function MembraneSynth() {
    return { triggerAttackRelease: vi.fn(), toDestination() { return this; } };
  }),
  Player: vi.fn(function Player() {
    return { start: vi.fn(), dispose: vi.fn(), loaded: true, volume: { value: 0 }, toDestination() { return this; } };
  }),
  now: vi.fn(() => 0),
  immediate: vi.fn(() => 0),
}));

import { __resetAudioForTesting } from "../lib/audio";
import { __resetPendingAudibleClaimForTesting } from "../lib/audibleActionGate";
import { useAppStore } from "../store/useAppStore";
import { PadGrid } from "./PadGrid";
import { PlayButton } from "./PlayButton";

describe("audible claim and the controls that read the gate", () => {
  beforeEach(() => {
    audioContextStub = createAudioContextStub();
    audioContextStub.setState("running");
    __resetAudioForTesting();
    __resetPendingAudibleClaimForTesting();
    useAppStore.getState().actions.setIsExporting(false);
    useAppStore.getState().actions.reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("leaves the other pads and Play enabled after a pad tap", async () => {
    render(
      <>
        <PlayButton />
        <PadGrid />
      </>,
    );
    const pad1 = screen.getByRole("button", { name: "pad 1, kick" });
    const pad2 = screen.getByRole("button", { name: "pad 2, hat" });
    const play = screen.getByRole("button", { name: "Start playback" });
    expect(pad2).toBeEnabled();

    // A synchronous click, then wait for the trigger to land: the render
    // that follows markTriggered is the one that must not show pad 2 or
    // Play disabled. Real timers — the DOM library's waitFor stalls under
    // vitest fake timers, and the 150 ms pad flash dies with cleanup().
    fireEvent.click(pad1);
    await waitFor(() => expect(useAppStore.getState().playback.triggerSeq[0]).toBe(1));

    expect(pad2).toBeEnabled();
    expect(play).toBeEnabled();
  });
});
