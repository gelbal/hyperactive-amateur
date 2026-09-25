// ABOUTME: Phase-locked Tone.Player loop pool for Mood's live takes.
// ABOUTME: Builds padded rest-in-loop buffers and routes all players through one shared gain seam.
import * as Tone from "tone";
import type { MoodTake } from "../types";
import { getAudioContext } from "./audio";
import { sliceAudioBuffer } from "./audioBufferSlice";
import { takeLoopPeriod } from "./moodClock";
import { getMoodFxInput } from "./moodFx";

export interface MoodPlayerLiveTake {
  takeId: string;
  take: MoodTake;
}

interface MoodPlayerEntry {
  take: MoodTake;
  player: Tone.Player | null;
}

interface ScheduledMoodPlayerEntry extends MoodPlayerEntry {
  startAt: number;
}

let players = new Map<string, MoodPlayerEntry>();
// Incoming players already started on the audio clock for a locked boundary
// swap, keyed by take id, until the paint-path commit makes them live.
let scheduledPlayers = new Map<string, ScheduledMoodPlayerEntry>();
let captureGain: Tone.Gain | null = null;

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function getCaptureGain(): Tone.Gain {
  if (!captureGain) {
    captureGain = new Tone.Gain(1);
    captureGain.connect(getMoodFxInput());
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
  // Rounded up (and past a float shortfall): Tone rejects a loopEnd beyond
  // the buffer's duration, and loopEnd is the exact period.
  let periodSamples = Math.max(1, Math.ceil(loopPeriodSeconds * sampleRate));
  if (periodSamples / sampleRate < loopPeriodSeconds) periodSamples += 1;
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

function hasPlayableAudio(take: MoodTake): boolean {
  return take.audioStatus !== "unavailable" && Boolean(take.audioBuffer);
}

// A take object is also replaced for metadata (a poster, a part tag); only
// these fields change what its player sounds like.
function playsSameAudio(a: MoodTake, b: MoodTake): boolean {
  return (
    a === b ||
    (a.audioBuffer === b.audioBuffer &&
      a.audioStatus === b.audioStatus &&
      a.trimStartMs === b.trimStartMs &&
      a.trimEndMs === b.trimEndMs &&
      a.cycleMultiple === b.cycleMultiple &&
      a.syncOffsetMs === b.syncOffsetMs)
  );
}

function createMoodPlayer(
  take: MoodTake,
  epoch: number,
  cycleSeconds: number,
  startAt: number = Tone.now(),
): Tone.Player {
  const loopPeriodSeconds = takeLoopPeriod(take.cycleMultiple, cycleSeconds);
  const loopBuffer = buildPaddedLoopBuffer(take, loopPeriodSeconds);
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

    // A player scheduled on the audio clock for this commit is already
    // sounding in phase from the boundary; it replaces the live one.
    const scheduled = scheduledPlayers.get(liveTake.takeId);
    if (scheduled) {
      scheduledPlayers.delete(liveTake.takeId);
      if (playsSameAudio(scheduled.take, liveTake.take)) {
        if (existing?.player) disposePlayer(existing.player);
        players.set(liveTake.takeId, { take: liveTake.take, player: scheduled.player });
        continue;
      }
      if (scheduled.player) disposePlayer(scheduled.player);
    }

    if (existing && playsSameAudio(existing.take, liveTake.take)) {
      players.set(liveTake.takeId, { take: liveTake.take, player: existing.player });
      continue;
    }

    if (existing?.player) {
      disposePlayer(existing.player);
    }

    if (!hasPlayableAudio(liveTake.take)) {
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

  // A scheduled take whose boundary has passed without it going live (it
  // was deleted, or replaced at the same boundary) must not keep sounding.
  // One scheduled for a later boundary (after a paint stall) waits for its
  // own commit.
  const now = Tone.immediate();
  for (const [takeId, scheduled] of [...scheduledPlayers]) {
    if (!nextTakeIds.has(takeId) && scheduled.startAt <= now) disposeScheduledPlayer(takeId);
  }
}

function disposeScheduledPlayer(takeId: string): void {
  const scheduled = scheduledPlayers.get(takeId);
  if (!scheduled) return;
  scheduledPlayers.delete(takeId);
  if (scheduled.player) disposePlayer(scheduled.player);
}

// Called once a boundary swap is locked (the lookahead clock has passed the
// boundary, so no re-arm can change it): the outgoing take stops and the
// incoming one starts in phase exactly at the boundary on the audio clock.
// A lock seen after the boundary swaps at the audible time instead. The
// paint-path commit then adopts the incoming player (syncMoodPlayers).
export function scheduleMoodPlayerSwap(
  outgoingTakeId: string | null,
  incoming: MoodPlayerLiveTake | null,
  boundaryTime: number,
  epoch: number,
  cycleSeconds: number,
): void {
  const outgoing = outgoingTakeId === null ? undefined : players.get(outgoingTakeId);
  if (
    incoming &&
    outgoing &&
    outgoingTakeId === incoming.takeId &&
    playsSameAudio(outgoing.take, incoming.take)
  ) {
    return;
  }

  const swapAt = Math.max(boundaryTime, Tone.immediate());
  outgoing?.player?.stop(swapAt);
  // An outgoing take that is itself only scheduled (for an earlier locked
  // boundary, or this same one) stops here too; its commit disposes it.
  if (outgoingTakeId !== null && outgoingTakeId !== incoming?.takeId) {
    scheduledPlayers.get(outgoingTakeId)?.player?.stop(swapAt);
  }
  if (!incoming || !hasPlayableAudio(incoming.take)) return;

  disposeScheduledPlayer(incoming.takeId);
  scheduledPlayers.set(incoming.takeId, {
    take: incoming.take,
    player: createMoodPlayer(incoming.take, epoch, cycleSeconds, swapAt),
    startAt: swapAt,
  });
}

// Switched on the audio clock's current time: the value setter schedules at
// Tone.now(), one lookahead (100 ms) late, so the loops would still sound
// through the speakers into the start of a take.
export function setCaptureGain(muted: boolean): void {
  const gain = getCaptureGain().gain;
  const now = Tone.immediate();
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(muted ? 0 : 1, now);
}

export function stopAllMoodPlayers(): void {
  for (const entry of [...players.values(), ...scheduledPlayers.values()]) {
    if (entry.player) {
      disposePlayer(entry.player);
    }
  }
  players = new Map();
  scheduledPlayers = new Map();
}

export function __resetMoodPlayersForTesting(): void {
  stopAllMoodPlayers();
  if (captureGain) {
    captureGain.dispose();
    captureGain = null;
  }
}
