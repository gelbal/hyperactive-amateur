// ABOUTME: drumKit tests — eleven named voices in a role-grouped cycle, a default per track position, built lazily with exact Tone options.
// ABOUTME: Tone is mocked; each voice is checked for its constructor, options object, trigger shape and dispose.
import { describe, it, expect, vi, beforeEach } from "vitest";

interface NodeMock {
  triggerAttackRelease: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  toDestination: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}
const { synthInstances, filterInstances, makeSynth, makeFilter } = vi.hoisted(() => {
  const synthInstances: NodeMock[] = [];
  const filterInstances: NodeMock[] = [];
  const makeNode = (): NodeMock => {
    const n: NodeMock = {
      triggerAttackRelease: vi.fn(),
      dispose: vi.fn(),
      toDestination: vi.fn(() => n),
      connect: vi.fn(() => n),
    };
    return n;
  };
  const makeSynth = (): NodeMock => {
    const n = makeNode();
    synthInstances.push(n);
    return n;
  };
  const makeFilter = (): NodeMock => {
    const n = makeNode();
    filterInstances.push(n);
    return n;
  };
  return { synthInstances, filterInstances, makeSynth, makeFilter };
});

vi.mock("tone", () => ({
  MembraneSynth: vi.fn(function MembraneSynth() {
    return makeSynth();
  }),
  MetalSynth: vi.fn(function MetalSynth() {
    return makeSynth();
  }),
  NoiseSynth: vi.fn(function NoiseSynth() {
    return makeSynth();
  }),
  Synth: vi.fn(function Synth() {
    return makeSynth();
  }),
  Filter: vi.fn(function Filter() {
    return makeFilter();
  }),
}));

import * as Tone from "tone";
import { DEFAULT_VOICES, KIT, nextVoiceId, voiceFor } from "./drumKit";

// Captured before any beforeEach clears the mocks: components import KIT
// for names and tags, so importing it must build no synth.
const builtAtImport = [Tone.MembraneSynth, Tone.MetalSynth, Tone.NoiseSynth, Tone.Synth, Tone.Filter].map(
  (ctor) => vi.mocked(ctor).mock.calls.length,
);

describe("drumKit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    synthInstances.length = 0;
    filterInstances.length = 0;
  });

  it("builds nothing at import, so components can read names and tags", () => {
    expect(builtAtImport).toEqual([0, 0, 0, 0, 0]);
  });

  it("has eleven voices in a role-grouped cycle, plain names with no numbers, and tag families", () => {
    expect(KIT.map((v) => v.id)).toEqual([
      "kick", "thump", "snare", "clap", "rim", "hat", "tick", "open-hat", "shaker", "ride", "cowbell",
    ]);
    expect(KIT.map((v) => v.name)).toEqual([
      "kick", "thump", "snare", "clap", "rim", "hat", "tick", "open hat", "shaker", "ride", "cowbell",
    ]);
    for (const voice of KIT) expect(voice.name).not.toMatch(/\d/);
    expect(KIT.map((v) => v.tag)).toEqual([
      "kick", "kick", "snare", "snare", "snare", "hat", "hat", "hat", "hat", "hat", "fx",
    ]);
  });

  it("defaults each track position to today's kit", () => {
    expect(DEFAULT_VOICES).toEqual(["kick", "hat", "snare", "open-hat", "thump", "tick", "clap", "ride"]);
    expect(voiceFor({ id: 4 }).name).toBe("thump");
    expect(voiceFor({ id: 4, voice: "cowbell" }).name).toBe("cowbell");
    // An id this build does not know falls back to the position default.
    expect(voiceFor({ id: 4, voice: "gong" }).name).toBe("thump");
  });

  it("cycles to the next voice and wraps", () => {
    expect(nextVoiceId("kick")).toBe("thump");
    expect(nextVoiceId("shaker")).toBe("ride");
    expect(nextVoiceId("cowbell")).toBe("kick");
  });

  it.each([
    ["kick", "MembraneSynth", { pitchDecay: 0.05, octaves: 6, envelope: { decay: 0.3 }, volume: -10 }, ["A1", "16n", 0.25, 0.5]],
    ["thump", "MembraneSynth", { pitchDecay: 0.08, octaves: 8, envelope: { decay: 0.2 }, volume: -10 }, ["C2", "16n", 0.25, 0.5]],
    ["snare", "NoiseSynth", { noise: { type: "white" }, envelope: { decay: 0.15 }, volume: -10 }, ["16n", 0.25, 0.5]],
    ["clap", "NoiseSynth", { noise: { type: "pink" }, envelope: { decay: 0.2 }, volume: -10 }, ["16n", 0.25, 0.5]],
    // A square body with a fast drop: a woody cross-stick, quieter because
    // it sits where phone speakers are loudest.
    ["rim", "MembraneSynth", { oscillator: { type: "square" }, pitchDecay: 0.008, octaves: 2, envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 }, volume: -16 }, ["E5", "16n", 0.25, 0.5]],
    ["ride", "MetalSynth", { envelope: { decay: 0.8, release: 0.5 }, harmonicity: 3, resonance: 3000, volume: -10 }, [250, "16n", 0.25, 0.5]],
  ] as const)(
    "%s is a %s built with exactly its options, routed out, triggered and disposed",
    (id, synth, options, triggerArgs) => {
      const voice = KIT.find((v) => v.id === id)!.make();

      const ctor = Tone[synth] as unknown as ReturnType<typeof vi.fn>;
      expect(ctor).toHaveBeenCalledTimes(1);
      // optionsFromArguments drops unknown keys silently, so the exact
      // object is pinned here.
      expect(ctor).toHaveBeenCalledWith(options);
      expect(synthInstances[0].toDestination).toHaveBeenCalledTimes(1);
      expect(Tone.Filter).not.toHaveBeenCalled();

      voice.trigger(0.25, 0.5);
      expect(synthInstances[0].triggerAttackRelease).toHaveBeenCalledWith(...triggerArgs);

      voice.dispose();
      expect(synthInstances[0].dispose).toHaveBeenCalledTimes(1);
    },
  );

  // Hats are filtered noise, not MetalSynths: a MetalSynth hit starts six FM
  // oscillator pairs, too much DSP for a phone with several hats on 16ths.
  it.each([
    ["hat", { noise: { type: "white" }, envelope: { decay: 0.05 }, volume: -10 }, { type: "highpass", frequency: 7000 }],
    ["tick", { noise: { type: "white" }, envelope: { decay: 0.08 }, volume: -10 }, { type: "highpass", frequency: 9000 }],
    ["open-hat", { noise: { type: "white" }, envelope: { decay: 0.3 }, volume: -10 }, { type: "highpass", frequency: 7000 }],
    // A slower attack through a band-pass: a soft "chk", not a hat.
    ["shaker", { noise: { type: "white" }, envelope: { attack: 0.03, decay: 0.08, sustain: 0, release: 0.02 }, volume: -12 }, { type: "bandpass", frequency: 5000, Q: 1.5 }],
  ] as const)(
    "%s is filtered noise, triggered and disposed with its filter",
    (id, noiseOptions, filterOptions) => {
      const voice = KIT.find((v) => v.id === id)!.make();

      expect(Tone.NoiseSynth).toHaveBeenCalledWith(noiseOptions);
      expect(Tone.Filter).toHaveBeenCalledWith(filterOptions);
      expect(Tone.MetalSynth).not.toHaveBeenCalled();
      expect(synthInstances[0].connect).toHaveBeenCalledWith(filterInstances[0]);
      expect(synthInstances[0].toDestination).not.toHaveBeenCalled();
      expect(filterInstances[0].toDestination).toHaveBeenCalledTimes(1);

      voice.trigger(0.25, 0.5);
      expect(synthInstances[0].triggerAttackRelease).toHaveBeenCalledWith("16n", 0.25, 0.5);

      voice.dispose();
      expect(synthInstances[0].dispose).toHaveBeenCalledTimes(1);
      expect(filterInstances[0].dispose).toHaveBeenCalledTimes(1);
    },
  );

  it("cowbell is two square tones through a band-pass, held a fixed time so its length does not follow the tempo", () => {
    const voice = KIT.find((v) => v.id === "cowbell")!.make();

    const tone = {
      oscillator: { type: "square" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0.3, release: 0.2 },
      volume: -18,
    };
    expect(Tone.Synth).toHaveBeenCalledTimes(2);
    expect(Tone.Synth).toHaveBeenNthCalledWith(1, tone);
    expect(Tone.Synth).toHaveBeenNthCalledWith(2, tone);
    expect(Tone.Filter).toHaveBeenCalledWith({ type: "bandpass", frequency: 1000, Q: 2 });
    expect(synthInstances[0].connect).toHaveBeenCalledWith(filterInstances[0]);
    expect(synthInstances[1].connect).toHaveBeenCalledWith(filterInstances[0]);
    expect(filterInstances[0].toDestination).toHaveBeenCalledTimes(1);

    voice.trigger(0.25, 0.5);
    expect(synthInstances[0].triggerAttackRelease).toHaveBeenCalledWith(540, 0.1, 0.25, 0.5);
    expect(synthInstances[1].triggerAttackRelease).toHaveBeenCalledWith(800, 0.1, 0.25, 0.5);

    voice.dispose();
    expect(synthInstances[0].dispose).toHaveBeenCalledTimes(1);
    expect(synthInstances[1].dispose).toHaveBeenCalledTimes(1);
    expect(filterInstances[0].dispose).toHaveBeenCalledTimes(1);
  });
});
