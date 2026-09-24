// ABOUTME: drumKit tests — eight named voices by track position, built lazily with exact Tone options.
// ABOUTME: Tone is mocked; each voice is checked for its constructor, options object, trigger shape and dispose.
import { describe, it, expect, vi, beforeEach } from "vitest";

interface SynthMock {
  triggerAttackRelease: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  toDestination: ReturnType<typeof vi.fn>;
}
const { synthInstances, makeSynth } = vi.hoisted(() => {
  const synthInstances: SynthMock[] = [];
  const makeSynth = (): SynthMock => {
    const s: SynthMock = {
      triggerAttackRelease: vi.fn(),
      dispose: vi.fn(),
      toDestination: vi.fn(() => s),
    };
    synthInstances.push(s);
    return s;
  };
  return { synthInstances, makeSynth };
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
}));

import * as Tone from "tone";
import { KIT } from "./drumKit";

// Captured before any beforeEach clears the mocks: components import KIT
// for names and tags, so importing it must build no synth.
const builtAtImport = [Tone.MembraneSynth, Tone.MetalSynth, Tone.NoiseSynth].map(
  (ctor) => vi.mocked(ctor).mock.calls.length,
);

describe("drumKit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    synthInstances.length = 0;
  });

  it("builds nothing at import, so components can read names and tags", () => {
    expect(builtAtImport).toEqual([0, 0, 0]);
  });

  it("has eight voices by track position with plain names and tag families", () => {
    expect(KIT.map((v) => v.name)).toEqual([
      "kick",
      "hat",
      "snare",
      "open hat",
      "kick 2",
      "hat 2",
      "clap",
      "ride",
    ]);
    expect(KIT.map((v) => v.tag)).toEqual([
      "kick",
      "hat",
      "snare",
      "hat",
      "kick",
      "hat",
      "snare",
      "hat",
    ]);
  });

  it.each([
    [0, "MembraneSynth", { pitchDecay: 0.05, octaves: 6, envelope: { decay: 0.3 } }, ["A1", "16n", 0.25, 0.5]],
    [1, "MetalSynth", { envelope: { decay: 0.05 } }, [200, "16n", 0.25, 0.5]],
    [2, "NoiseSynth", { noise: { type: "white" }, envelope: { decay: 0.15 } }, ["16n", 0.25, 0.5]],
    [3, "MetalSynth", { envelope: { decay: 0.35 } }, [200, "16n", 0.25, 0.5]],
    [4, "MembraneSynth", { pitchDecay: 0.08, octaves: 8, envelope: { decay: 0.2 } }, ["C2", "16n", 0.25, 0.5]],
    [5, "MetalSynth", { envelope: { decay: 0.08 }, resonance: 6000, octaves: 1 }, [320, "16n", 0.25, 0.5]],
    [6, "NoiseSynth", { noise: { type: "pink" }, envelope: { decay: 0.2 } }, ["16n", 0.25, 0.5]],
    [7, "MetalSynth", { envelope: { decay: 0.8, release: 0.5 }, harmonicity: 3, resonance: 3000 }, [250, "16n", 0.25, 0.5]],
  ] as const)(
    "voice %i is a %s built with exactly its options at -10 dB, routed out, triggered and disposed",
    (index, synth, options, triggerArgs) => {
      const voice = KIT[index].make();

      const ctor = Tone[synth] as unknown as ReturnType<typeof vi.fn>;
      expect(ctor).toHaveBeenCalledTimes(1);
      // optionsFromArguments drops unknown keys silently, so the exact
      // object is pinned here.
      expect(ctor).toHaveBeenCalledWith({ ...options, volume: -10 });
      expect(synthInstances[0].toDestination).toHaveBeenCalledTimes(1);

      voice.trigger(0.25, 0.5);
      expect(synthInstances[0].triggerAttackRelease).toHaveBeenCalledWith(...triggerArgs);

      voice.dispose();
      expect(synthInstances[0].dispose).toHaveBeenCalledTimes(1);
    },
  );
});
