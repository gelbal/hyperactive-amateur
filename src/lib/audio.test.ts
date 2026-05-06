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
  swing: 0,
  swingSubdivision: "16n",
};

const videoEngineTrigger = vi.fn();
const videoEngineResetPlaybackState = vi.fn();
const videoEngineSetCutSubdivision = vi.fn();
vi.mock("./videoEngine", () => ({
  trigger: (...args: unknown[]) => videoEngineTrigger(...args),
  resetPlaybackState: () => videoEngineResetPlaybackState(),
  setVideoCutSubdivision: (...args: unknown[]) => videoEngineSetCutSubdivision(...args),
}));

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

interface PlayerMock {
  start: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  toDestination: () => PlayerMock;
  loaded: boolean;
}
const playerInstances: PlayerMock[] = [];
function makePlayer(): PlayerMock {
  const p: PlayerMock = {
    start: vi.fn(),
    dispose: vi.fn(),
    toDestination: () => p,
    loaded: true,
  };
  playerInstances.push(p);
  return p;
}

vi.mock("tone", () => ({
  start: vi.fn().mockResolvedValue(undefined),
  getTransport: vi.fn(() => transportMock),
  getDraw: vi.fn(() => drawMock),
  getContext: vi.fn(() => ({ rawContext: {} })),
  MembraneSynth: vi.fn(() => makeSynth()),
  Player: vi.fn(() => makePlayer()),
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
    playerInstances.length = 0;
    videoEngineTrigger.mockClear();
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

  describe("clip players", () => {
    function makeClip() {
      return {
        blob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
        url: "blob:test/1",
        audioBuffer: { duration: 1, sampleRate: 48000 } as AudioBuffer,
        trimStartMs: 0,
        trimEndMs: 1000,
        durationMs: 1000,
      };
    }

    it("setTrackClip creates a Tone.Player for that track", () => {
      initTransport();
      useAppStore.getState().actions.setTrackClip(0, makeClip());
      expect(playerInstances).toHaveLength(1);
    });

    it("triggered step on a clipped track calls Player.start instead of synth", () => {
      initTransport();
      useAppStore.getState().actions.setTrackClip(0, makeClip());
      useAppStore.getState().actions.toggleStep(0, 0);
      const callback = transportMock.scheduleRepeat.mock.calls[0]?.[0];
      callback?.(0.25);
      expect(playerInstances[0].start).toHaveBeenCalledTimes(1);
      expect(playerInstances[0].start).toHaveBeenCalledWith(0.25, 0, 1);
      expect(synthInstances[0].triggerAttackRelease).not.toHaveBeenCalled();
    });

    it("clearTrackClip disposes the player", () => {
      initTransport();
      useAppStore.getState().actions.setTrackClip(0, makeClip());
      const player = playerInstances[0];
      useAppStore.getState().actions.clearTrackClip(0);
      expect(player.dispose).toHaveBeenCalled();
    });

    it("honors trim offsets when starting the player", () => {
      initTransport();
      const clip = makeClip();
      clip.trimStartMs = 200;
      clip.trimEndMs = 800;
      useAppStore.getState().actions.setTrackClip(0, clip);
      useAppStore.getState().actions.toggleStep(0, 0);
      const callback = transportMock.scheduleRepeat.mock.calls[0]?.[0];
      callback?.(1);
      expect(playerInstances[0].start).toHaveBeenCalledWith(1, 0.2, 0.6);
    });

    it("fires videoEngine.trigger when track.showVideo is true (default)", () => {
      initTransport();
      useAppStore.getState().actions.setTrackClip(0, makeClip());
      useAppStore.getState().actions.toggleStep(0, 0);
      const callback = transportMock.scheduleRepeat.mock.calls[0]?.[0];
      callback?.(0.1);
      expect(videoEngineTrigger).toHaveBeenCalledWith(0, 0.1);
    });

    it("does NOT fire videoEngine.trigger when track.showVideo is false", () => {
      initTransport();
      useAppStore.getState().actions.setTrackClip(0, makeClip());
      useAppStore.getState().actions.toggleStep(0, 0);
      useAppStore.getState().actions.setTrackShowVideo(0, false);
      const callback = transportMock.scheduleRepeat.mock.calls[0]?.[0];
      callback?.(0.1);
      expect(videoEngineTrigger).not.toHaveBeenCalled();
      // Audio still fires.
      expect(playerInstances[0].start).toHaveBeenCalled();
    });

    it("falls back to synth on tracks without a clip", () => {
      initTransport();
      useAppStore.getState().actions.setTrackClip(0, makeClip());
      useAppStore.getState().actions.toggleStep(2, 0);
      const callback = transportMock.scheduleRepeat.mock.calls[0]?.[0];
      callback?.(0);
      expect(synthInstances[2].triggerAttackRelease).toHaveBeenCalledWith("E2", "16n", 0);
    });
  });
});
