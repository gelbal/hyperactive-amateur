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

const synthInstance = {
  triggerAttackRelease: vi.fn(),
  toDestination: vi.fn(function (this: typeof synthInstance) {
    return this;
  }),
};

vi.mock("tone", () => ({
  start: vi.fn().mockResolvedValue(undefined),
  getTransport: vi.fn(() => transportMock),
  getDraw: vi.fn(() => drawMock),
  getContext: vi.fn(() => ({ rawContext: {} })),
  MembraneSynth: vi.fn(() => synthInstance),
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
    synthInstance.triggerAttackRelease.mockClear();
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

  it("metronome callback fires the synth on each step", () => {
    initTransport();
    const callback = transportMock.scheduleRepeat.mock.calls[0]?.[0];
    expect(callback).toBeDefined();
    callback?.(0.123);
    expect(synthInstance.triggerAttackRelease).toHaveBeenCalledWith("C2", "16n", 0.123);
  });

  it("BPM changes propagate to Transport.bpm", () => {
    initTransport();
    useAppStore.getState().actions.setBpm(140);
    expect(transportMock.bpm.value).toBe(140);
  });
});
