// ABOUTME: moodPlayers tests — phase-lock Mood take loops and shared gain routing.
// ABOUTME: Tone and Web Audio are mocked so buffer padding and start math stay deterministic.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toneHarness } = await vi.hoisted(async () => {
  const { createToneHarness } = await import("../test-utils/toneTestHarness");
  return { toneHarness: createToneHarness() };
});

const moodFxMocks = vi.hoisted(() => ({
  input: { name: "mood-fx-input" },
}));

const toneMocks = vi.hoisted(() => {
  interface PlayerMock {
    buffer: AudioBuffer;
    connect: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    loop: boolean;
    loopStart: number;
    loopEnd: number;
  }

  interface GainMock {
    gain: { value: number };
    connect: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }

  const players: PlayerMock[] = [];
  const gains: GainMock[] = [];

  function makePlayer(buffer: AudioBuffer): PlayerMock {
    const player: PlayerMock = {
      buffer,
      connect: vi.fn(() => player),
      dispose: vi.fn(),
      start: vi.fn(() => player),
      stop: vi.fn(() => player),
      loop: false,
      loopStart: 0,
      loopEnd: 0,
    };
    players.push(player);
    return player;
  }

  function makeGain(initialGain: number): GainMock {
    const gain: GainMock = {
      gain: { value: initialGain },
      connect: vi.fn(() => gain),
      dispose: vi.fn(),
    };
    gains.push(gain);
    return gain;
  }

  return { gains, makeGain, makePlayer, players };
});

vi.mock("./moodFx", () => ({
  getMoodFxInput: () => moodFxMocks.input,
}));

vi.mock("tone", () => {
  return {
    ...toneHarness.createToneModule(),
    Gain: vi.fn(function Gain(initialGain: number) {
      return toneMocks.makeGain(initialGain);
    }),
    Player: vi.fn(function Player(buffer: AudioBuffer) {
      return toneMocks.makePlayer(buffer);
    }),
  };
});

const fakeContext = {
  createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      sampleRate,
      length,
      duration: length / sampleRate,
      numberOfChannels: channels,
      getChannelData: (channel: number) => data[channel],
    } as unknown as AudioBuffer;
  }),
} as unknown as AudioContext;

vi.mock("./audio", () => ({
  getAudioContext: () => fakeContext,
}));

import {
  __resetMoodPlayersForTesting,
  setCaptureGain,
  stopAllMoodPlayers,
  syncMoodPlayers,
} from "./moodPlayers";
import { makeMoodTake } from "../test-utils/moodFixtures";

function makeBuffer(
  sampleRate: number,
  channels: number,
  fill: (channel: number, sampleIndex: number) => number,
  length: number,
): AudioBuffer {
  const data = Array.from({ length: channels }, (_, channel) => {
    const samples = new Float32Array(length);
    for (let i = 0; i < length; i += 1) samples[i] = fill(channel, i);
    return samples;
  });

  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: channels,
    getChannelData: (channel: number) => data[channel],
  } as unknown as AudioBuffer;
}

describe("moodPlayers", () => {
  let defaultAudioBuffer: AudioBuffer;

  beforeEach(() => {
    __resetMoodPlayersForTesting();
    toneMocks.players.length = 0;
    toneMocks.gains.length = 0;
    toneHarness.setImmediate(0);
    toneHarness.setLookahead(0);
    defaultAudioBuffer = makeBuffer(
      48_000,
      1,
      (_channel, sampleIndex) => sampleIndex / 1_000,
      48_000,
    );
    vi.mocked(fakeContext.createBuffer).mockClear();
  });

  it("diffs by takeId and rebuilds only when the take reference changes", () => {
    const takeA = makeMoodTake({ id: "take-a", audioBuffer: defaultAudioBuffer });
    syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
    const first = toneMocks.players[0];

    syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
    expect(toneMocks.players).toHaveLength(1);
    expect(first.dispose).not.toHaveBeenCalled();

    const replacement = makeMoodTake({ id: "take-a", audioBuffer: defaultAudioBuffer });
    syncMoodPlayers([{ takeId: "take-a", take: replacement }], 0, 2);
    expect(toneMocks.players).toHaveLength(2);
    expect(first.dispose).toHaveBeenCalledTimes(1);

    const second = toneMocks.players[1];
    syncMoodPlayers([], 0, 2);
    expect(second.stop).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });

  it("skips unavailable-audio takes without creating a player", () => {
    const unavailable = makeMoodTake({
      id: "take-muted-by-repair",
      audioBuffer: null,
      audioStatus: "unavailable",
      durationSeconds: 1,
      trimEndMs: 1_000,
    });

    expect(() =>
      syncMoodPlayers([{ takeId: "take-muted-by-repair", take: unavailable }], 0, 2),
    ).not.toThrow();
    expect(toneMocks.players).toHaveLength(0);
  });

  it("pads the trimmed content to the cycleMultiple loop period", () => {
    const source = makeBuffer(48000, 2, (channel, sampleIndex) => {
      return channel === 0 ? sampleIndex : -sampleIndex;
    }, 48000);
    const take = makeMoodTake({
      id: "long-loop",
      audioBuffer: source,
      trimStartMs: 250,
      trimEndMs: 750,
      durationSeconds: 0.5,
      cycleMultiple: 2,
    });

    syncMoodPlayers([{ takeId: "long-loop", take }], 0, 4);

    const player = toneMocks.players[0];
    expect(player.loop).toBe(true);
    expect(player.loopStart).toBe(0);
    expect(player.loopEnd).toBe(8);
    expect(player.buffer.length).toBe(384000);
    expect(player.buffer.duration).toBe(8);
    expect(player.buffer.numberOfChannels).toBe(2);
    expect(player.buffer.getChannelData(0)[0]).toBe(12000);
    expect(player.buffer.getChannelData(1)[0]).toBe(-12000);
    expect(player.buffer.getChannelData(0)[23999]).toBe(35999);
    expect(player.buffer.getChannelData(0)[24000]).toBe(0);
    expect(player.buffer.getChannelData(0)[383999]).toBe(0);
  });

  it.each([
    { now: 10, offset: 0 },
    { now: 11.5, offset: 1.5 },
    { now: 14, offset: 4 },
    { now: 18.1, offset: 0.1 },
  ])("starts immediately with a phase offset for now=$now", (row) => {
    toneHarness.setImmediate(row.now);
    const take = makeMoodTake({
      id: `phase-${row.now}`,
      audioBuffer: defaultAudioBuffer,
      cycleMultiple: 2,
    });

    syncMoodPlayers([{ takeId: take.id, take }], 10, 4);

    const [startAt, offset] = toneMocks.players[0].start.mock.calls[0];
    expect(startAt).toBe(row.now);
    expect(offset).toBeCloseTo(row.offset);
  });

  it("joins immediately just after a cycle boundary instead of waiting a full cycle", () => {
    toneHarness.setImmediate(4.02);
    const take = makeMoodTake({
      id: "late-boundary",
      audioBuffer: defaultAudioBuffer,
      cycleMultiple: 1,
    });

    syncMoodPlayers([{ takeId: "late-boundary", take }], 0, 4);

    const [startAt, offset] = toneMocks.players[0].start.mock.calls[0];
    expect(startAt).toBe(4.02);
    expect(startAt).not.toBe(8);
    expect(offset).toBeCloseTo(0.02);
  });

  it("applies syncOffsetMs to the phase offset and wraps inside the loop", () => {
    toneHarness.setImmediate(13.9);
    const take = makeMoodTake({
      id: "nudged",
      audioBuffer: defaultAudioBuffer,
      cycleMultiple: 1,
      syncOffsetMs: 250,
    });

    syncMoodPlayers([{ takeId: "nudged", take }], 10, 4);
    {
      const [startAt, offset] = toneMocks.players[0].start.mock.calls[0];
      expect(startAt).toBe(13.9);
      expect(offset).toBeCloseTo(0.15);
    }

    const early = makeMoodTake({
      id: "early",
      audioBuffer: defaultAudioBuffer,
      cycleMultiple: 1,
      syncOffsetMs: -250,
    });
    syncMoodPlayers([{ takeId: "early", take: early }], 10, 4);
    {
      const [startAt, offset] = toneMocks.players[1].start.mock.calls[0];
      expect(startAt).toBe(13.9);
      expect(offset).toBeCloseTo(3.65);
    }
  });

  it("creates one shared capture gain node and routes players through it", () => {
    setCaptureGain(true);
    expect(toneMocks.gains).toHaveLength(1);
    expect(toneMocks.gains[0].gain.value).toBe(0);
    expect(toneMocks.gains[0].connect).toHaveBeenCalledWith(moodFxMocks.input);

    const takeA = makeMoodTake({ id: "take-a", audioBuffer: defaultAudioBuffer });
    const takeB = makeMoodTake({ id: "take-b", audioBuffer: defaultAudioBuffer });
    syncMoodPlayers(
      [
        { takeId: "take-a", take: takeA },
        { takeId: "take-b", take: takeB },
      ],
      0,
      2,
    );

    expect(toneMocks.gains).toHaveLength(1);
    expect(toneMocks.players[0].connect).toHaveBeenCalledWith(toneMocks.gains[0]);
    expect(toneMocks.players[1].connect).toHaveBeenCalledWith(toneMocks.gains[0]);

    setCaptureGain(false);
    expect(toneMocks.gains[0].gain.value).toBe(1);
  });

  it("stops and disposes every mood player", () => {
    const takeA = makeMoodTake({ id: "take-a", audioBuffer: defaultAudioBuffer });
    const takeB = makeMoodTake({ id: "take-b", audioBuffer: defaultAudioBuffer });
    syncMoodPlayers(
      [
        { takeId: "take-a", take: takeA },
        { takeId: "take-b", take: takeB },
      ],
      0,
      2,
    );

    stopAllMoodPlayers();

    expect(toneMocks.players[0].stop).toHaveBeenCalledTimes(1);
    expect(toneMocks.players[0].dispose).toHaveBeenCalledTimes(1);
    expect(toneMocks.players[1].stop).toHaveBeenCalledTimes(1);
    expect(toneMocks.players[1].dispose).toHaveBeenCalledTimes(1);

    syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
    expect(toneMocks.players).toHaveLength(3);
  });
});
