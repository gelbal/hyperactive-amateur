// ABOUTME: Phase-locked Tone.Player loop pool for Mood's live takes.
// ABOUTME: Builds padded rest-in-loop buffers and routes all players through one shared gain seam.
import * as Tone from "tone";
import type { MoodTake } from "../types";
import { getAudioContext } from "./audio";
import { sliceAudioBuffer } from "./audioBufferSlice";
import { takeLoopPeriod } from "./moodClock";

export interface MoodPlayerLiveTake {
  takeId: string;
  take: MoodTake;
}

interface MoodPlayerEntry {
  take: MoodTake;
  player: Tone.Player | null;
}

let players = new Map<string, MoodPlayerEntry>();
let captureGain: Tone.Gain | null = null;

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function getCaptureGain(): Tone.Gain {
  if (!captureGain) {
    captureGain = new Tone.Gain(1).toDestination();
  }
  return captureGain;
}

function disposePlayer(player: Tone.Player): void {
  player.stop();
  player.dispose();
}

function buildPaddedLoopBuffer(take: MoodTake, loopPeriodSeconds: number): AudioBuffer {
  if (!take.audioBuffer) {
    throw new Error("Cannot build a Mood loop player without decoded audio.");
  }

  const trimmed = sliceAudioBuffer(take.audioBuffer, take.trimStartMs, take.trimEndMs);
  const sampleRate = trimmed.sampleRate;
  const periodSamples = Math.max(1, Math.round(loopPeriodSeconds * sampleRate));
  const loopBuffer = getAudioContext().createBuffer(
    trimmed.numberOfChannels,
    periodSamples,
    sampleRate,
  );
  const copyLength = Math.min(trimmed.length, periodSamples);

  for (let channel = 0; channel < trimmed.numberOfChannels; channel += 1) {
    const source = trimmed.getChannelData(channel);
    const target = loopBuffer.getChannelData(channel);
    target.set(source.subarray(0, copyLength));
  }

  return loopBuffer;
}

function startPhaseOffset(
  epoch: number,
  startTime: number,
  loopPeriodSeconds: number,
  syncOffsetMs: number,
): number {
  return positiveModulo(startTime - epoch + syncOffsetMs / 1000, loopPeriodSeconds);
}

function createMoodPlayer(take: MoodTake, epoch: number, cycleSeconds: number): Tone.Player {
  const loopPeriodSeconds = takeLoopPeriod(take.cycleMultiple, cycleSeconds);
  const loopBuffer = buildPaddedLoopBuffer(take, loopPeriodSeconds);
  const startAt = Tone.now();
  const offset = startPhaseOffset(
    epoch,
    startAt,
    loopPeriodSeconds,
    take.syncOffsetMs,
  );
  const player = new Tone.Player(loopBuffer).connect(getCaptureGain());
  player.loop = true;
  player.loopStart = 0;
  player.loopEnd = loopPeriodSeconds;
  player.start(startAt, offset);
  return player;
}

export function syncMoodPlayers(
  liveTakes: MoodPlayerLiveTake[],
  epoch: number,
  cycleSeconds: number,
): void {
  const nextTakeIds = new Set<string>();

  for (const liveTake of liveTakes) {
    nextTakeIds.add(liveTake.takeId);
    const existing = players.get(liveTake.takeId);

    if (existing?.take === liveTake.take) {
      continue;
    }

    if (existing?.player) {
      disposePlayer(existing.player);
    }

    if (liveTake.take.audioStatus === "unavailable" || !liveTake.take.audioBuffer) {
      players.set(liveTake.takeId, { take: liveTake.take, player: null });
      continue;
    }

    players.set(liveTake.takeId, {
      take: liveTake.take,
      player: createMoodPlayer(liveTake.take, epoch, cycleSeconds),
    });
  }

  for (const [takeId, entry] of players) {
    if (nextTakeIds.has(takeId)) continue;
    if (entry.player) {
      disposePlayer(entry.player);
    }
    players.delete(takeId);
  }
}

export function setCaptureGain(muted: boolean): void {
  getCaptureGain().gain.value = muted ? 0 : 1;
}

export function stopAllMoodPlayers(): void {
  for (const entry of players.values()) {
    if (entry.player) {
      disposePlayer(entry.player);
    }
  }
  players = new Map();
}

export function __resetMoodPlayersForTesting(): void {
  stopAllMoodPlayers();
  if (captureGain) {
    captureGain.dispose();
    captureGain = null;
  }
}
