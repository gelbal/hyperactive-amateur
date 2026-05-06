// ABOUTME: Tests for audio.ts — verifies Tone.start/Transport.start/stop are wired through.
// ABOUTME: Tone.js is fully mocked; no real audio context is created in jsdom.
import { describe, it, expect, vi, beforeEach } from "vitest";

type RepeatCb = (time: number) => void;
const transportMock = {
  start: vi.fn(),
  stop: vi.fn(),
  clear: vi.fn(),
  scheduleRepeat: vi.fn<(cb: RepeatCb, interval: string) => number>(() => 1),
  bpm: { value: 90 },
};

const drawMock = { schedule: vi.fn((fn: () => void) => fn()) };

interface SynthMock {
  triggerAttackRelease: ReturnType<typeof vi.fn>;
  toDestination: () => SynthMock;
}
const synthInstances: SynthMock[] = [];
function makeSynth(): SynthMock {
  const s: SynthMock = {
    triggerAttackRelease: vi.fn(),
    toDestination: () => s,
  };
  synthInstances.push(s);
  return s;
}

vi.mock("tone", () => ({
  start: vi.fn().mockResolvedValue(undefined),
  getTransport: vi.fn(() => transportMock),
  getDraw: vi.fn(() => drawMock),
  getContext: vi.fn(() => ({ rawContext: {} })),
  MembraneSynth: vi.fn(() => makeSynth()),
}));

import * as Tone from "tone";
import {
  initTransport,
  startPlayback,
  stopPlayback,
  togglePlayback,
  __resetAudioForTesting,
} from "./audio";
import { useAppStore } from "../store/useAppStore";

describe("audio module", () => {
  beforeEach(() => {
    __resetAudioForTesting();
    useAppStore.getState().actions.reset();
    transportMock.start.mockClear();
    transportMock.stop.mockClear();
    transportMock.scheduleRepeat.mockClear();
    transportMock.bpm.value = 90;
    drawMock.schedule.mockClear();
    synthInstances.length = 0;
    (Tone.start as ReturnType<typeof vi.fn>).mockClear();
  });

  it("initTransport schedules a 16th-note repeating callback", () => {
    initTransport();
    expect(transportMock.scheduleRepeat).toHaveBeenCalledTimes(1);
    expect(transportMock.scheduleRepeat.mock.calls[0][1]).toBe("16n");
  });

  it("initTransport is idempotent", () => {
    initTransport();
    initTransport();
    expect(transportMock.scheduleRepeat).toHaveBeenCalledTimes(1);
  });

  it("startPlayback calls Tone.start and Transport.start", async () => {
    await startPlayback();
    expect(Tone.start).toHaveBeenCalled();
    expect(transportMock.start).toHaveBeenCalled();
  });

  it("stopPlayback calls Transport.stop and resets currentStep to 0", () => {
    useAppStore.getState().actions.setCurrentStep(7);
    stopPlayback();
    expect(transportMock.stop).toHaveBeenCalled();
    expect(useAppStore.getState().playback.currentStep).toBe(0);
  });

  it("togglePlayback flips isPlaying and starts the transport", async () => {
    expect(useAppStore.getState().playback.isPlaying).toBe(false);
    await togglePlayback();
    expect(useAppStore.getState().playback.isPlaying).toBe(true);
    expect(transportMock.start).toHaveBeenCalled();
    await togglePlayback();
    expect(useAppStore.getState().playback.isPlaying).toBe(false);
    expect(transportMock.stop).toHaveBeenCalled();
  });

  it("only fires synths for tracks whose current step is toggled on", () => {
    useAppStore.getState().actions.toggleStep(0, 0);
    initTransport();
    const callback = transportMock.scheduleRepeat.mock.calls[0]?.[0];
    expect(callback).toBeDefined();
    callback?.(0.5);
    expect(synthInstances[0].triggerAttackRelease).toHaveBeenCalledTimes(1);
    expect(synthInstances[0].triggerAttackRelease).toHaveBeenCalledWith("C2", "16n", 0.5);
    for (let i = 1; i < 8; i++) {
      expect(synthInstances[i].triggerAttackRelease).not.toHaveBeenCalled();
    }
  });

  it("muted tracks do not fire even when their step is on", () => {
    useAppStore.getState().actions.toggleStep(2, 0);
    useAppStore.getState().actions.setTrackMuted(2, true);
    initTransport();
    const callback = transportMock.scheduleRepeat.mock.calls[0]?.[0];
    callback?.(0.1);
    expect(synthInstances[2].triggerAttackRelease).not.toHaveBeenCalled();
  });

  it("uses the per-track pitch when firing", () => {
    useAppStore.getState().actions.toggleStep(3, 0);
    initTransport();
    const callback = transportMock.scheduleRepeat.mock.calls[0]?.[0];
    callback?.(0);
    expect(synthInstances[3].triggerAttackRelease).toHaveBeenCalledWith("F2", "16n", 0);
  });

  it("BPM changes propagate to Transport.bpm", () => {
    initTransport();
    useAppStore.getState().actions.setBpm(140);
    expect(transportMock.bpm.value).toBe(140);
  });
});
