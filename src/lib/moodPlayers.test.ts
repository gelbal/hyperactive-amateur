// ABOUTME: moodPlayers tests — phase-lock Mood take loops and shared gain routing.
// ABOUTME: Tone and Web Audio are mocked so buffer padding and start math stay deterministic.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MoodTake } from "../types";

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
    toDestination: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }

  const players: PlayerMock[] = [];
  const gains: GainMock[] = [];
  const now = vi.fn(() => 0);

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
      toDestination: vi.fn(() => gain),
      dispose: vi.fn(),
    };
    gains.push(gain);
    return gain;
  }

  return { gains, makeGain, makePlayer, now, players };
});

vi.mock("tone", () => ({
  Gain: vi.fn(function Gain(initialGain: number) {
    return toneMocks.makeGain(initialGain);
  }),
  Player: vi.fn(function Player(buffer: AudioBuffer) {
    return toneMocks.makePlayer(buffer);
  }),
  now: toneMocks.now,
}));

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

function makeTake(overrides: Partial<MoodTake> = {}): MoodTake {
  const id = overrides.id ?? "take-1";
  const audioBuffer =
    overrides.audioBuffer ??
    makeBuffer(48000, 1, (_channel, sampleIndex) => sampleIndex / 1000, 48000);
  const durationSeconds = overrides.durationSeconds ?? audioBuffer.duration;

  return {
    id,
    videoBlob: new Blob([new Uint8Array([1])], { type: "video/webm" }),
    audioBlob: null,
    posterBlob: null,
    url: `blob:test/${id}`,
    audioBuffer,
    audioStatus: "ok",
    posterUrl: null,
    trimStartMs: 0,
    trimEndMs: durationSeconds * 1000,
    durationSeconds,
    cycleMultiple: 1,
    syncOffsetMs: 0,
    part: null,
    partSource: null,
    recordedAt: 1,
    ...overrides,
  };
}

describe("moodPlayers", () => {
  beforeEach(() => {
    __resetMoodPlayersForTesting();
    toneMocks.players.length = 0;
    toneMocks.gains.length = 0;
    toneMocks.now.mockReset();
    toneMocks.now.mockReturnValue(0);
    vi.mocked(fakeContext.createBuffer).mockClear();
  });

  it("diffs by takeId and rebuilds only when the take reference changes", () => {
    const takeA = makeTake({ id: "take-a" });
    syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
    const first = toneMocks.players[0];

    syncMoodPlayers([{ takeId: "take-a", take: takeA }], 0, 2);
    expect(toneMocks.players).toHaveLength(1);
    expect(first.dispose).not.toHaveBeenCalled();

    const replacement = makeTake({ id: "take-a" });
    syncMoodPlayers([{ takeId: "take-a", take: replacement }], 0, 2);
    expect(toneMocks.players).toHaveLength(2);
    expect(first.dispose).toHaveBeenCalledTimes(1);

    const second = toneMocks.players[1];
    syncMoodPlayers([], 0, 2);
    expect(second.stop).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });

  it("skips unavailable-audio takes without creating a player", () => {
    const unavailable = makeTake({
      id: "take-muted-by-repair",
      audioBuffer: null,
      audioStatus: "unavailable",
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
    const take = makeTake({
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
    { now: 10, startAt: 10, offset: 0 },
    { now: 11.5, startAt: 14, offset: 4 },
    { now: 14, startAt: 14, offset: 4 },
    { now: 18.1, startAt: 22, offset: 4 },
  ])("starts at the next cycle boundary with a phase offset for now=$now", (row) => {
    toneMocks.now.mockReturnValue(row.now);
    const take = makeTake({ id: `phase-${row.now}`, cycleMultiple: 2 });

    syncMoodPlayers([{ takeId: take.id, take }], 10, 4);

    expect(toneMocks.players[0].start).toHaveBeenCalledWith(row.startAt, row.offset);
  });

  it("applies syncOffsetMs to the phase offset and wraps inside the loop", () => {
    toneMocks.now.mockReturnValue(13.9);
    const take = makeTake({ id: "nudged", cycleMultiple: 1, syncOffsetMs: 250 });

    syncMoodPlayers([{ takeId: "nudged", take }], 10, 4);
    expect(toneMocks.players[0].start).toHaveBeenCalledWith(14, 0.25);

    const early = makeTake({ id: "early", cycleMultiple: 1, syncOffsetMs: -250 });
    syncMoodPlayers([{ takeId: "early", take: early }], 10, 4);
    expect(toneMocks.players[1].start).toHaveBeenCalledWith(14, 3.75);
  });

  it("creates one shared capture gain node and routes players through it", () => {
    setCaptureGain(true);
    expect(toneMocks.gains).toHaveLength(1);
    expect(toneMocks.gains[0].gain.value).toBe(0);
    expect(toneMocks.gains[0].toDestination).toHaveBeenCalledTimes(1);

    const takeA = makeTake({ id: "take-a" });
    const takeB = makeTake({ id: "take-b" });
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
    const takeA = makeTake({ id: "take-a" });
    const takeB = makeTake({ id: "take-b" });
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
