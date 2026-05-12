// ABOUTME: Tests for audio.ts trigger gating — showVideo gate, mute respected, fallback synth.
// ABOUTME: Tone is fully mocked so JSDOM never touches a real audio context.
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
vi.mock("./videoEngine", () => ({
  trigger: (...args: unknown[]) => videoEngineTrigger(...args),
  resetPlaybackState: vi.fn(),
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
  now: vi.fn(() => 0),
}));

import { initTransport, __resetAudioForTesting } from "./audio";
import { useAppStore } from "../store/useAppStore";

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

describe("audio: per-step trigger logic", () => {
  beforeEach(() => {
    __resetAudioForTesting();
    useAppStore.getState().actions.reset();
    transportMock.scheduleRepeat.mockClear();
    synthInstances.length = 0;
    playerInstances.length = 0;
    videoEngineTrigger.mockClear();
  });

  it("clipped track: fires player + videoEngine; showVideo=false skips video; muted skips both", () => {
    initTransport();
    const a = useAppStore.getState().actions;
    // Track 0: normal — should trigger player + video.
    a.setTrackClip(0, makeClip());
    a.toggleStep(0, 0);
    // Track 1: showVideo=false — audio only.
    a.setTrackClip(1, makeClip());
    a.toggleStep(1, 0);
    a.setTrackShowVideo(1, false);
    // Track 2: muted — neither audio nor video.
    a.setTrackClip(2, makeClip());
    a.toggleStep(2, 0);
    a.setTrackMuted(2, true);

    const cb = transportMock.scheduleRepeat.mock.calls[0]?.[0];
    cb?.(0.25);

    expect(playerInstances[0].start).toHaveBeenCalledWith(0.25, 0, 1);
    expect(videoEngineTrigger).toHaveBeenCalledWith(0, 0.25);
    expect(playerInstances[1].start).toHaveBeenCalled();
    expect(videoEngineTrigger).toHaveBeenCalledTimes(1); // only track 0 cut
    expect(playerInstances[2].start).not.toHaveBeenCalled();
  });

  it("falls back to a synth click for tracks without a clip", () => {
    initTransport();
    useAppStore.getState().actions.toggleStep(2, 0);
    const cb = transportMock.scheduleRepeat.mock.calls[0]?.[0];
    cb?.(0);
    expect(synthInstances[2].triggerAttackRelease).toHaveBeenCalledWith("E2", "16n", 0);
  });
});
