// ABOUTME: Persisted project fixtures for migration and recovery tests.
// ABOUTME: Records intentionally model old monolithic saves before schema-2 splitting.
import type { PersistedProject, PersistedTrack } from "../persistence";

async function fixtureBlob(bytes: number[], type: string): Promise<Blob> {
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": type },
  }).blob();
}

function steps(activeSteps: number[] = [], stepCount = 16): boolean[] {
  return Array.from({ length: stepCount }, (_, index) => activeSteps.includes(index));
}

function emptyTrack(id: number, stepCount = 16): PersistedTrack {
  return {
    id,
    clipBlob: null,
    audioBlob: null,
    posterBlob: null,
    trimStartMs: 0,
    trimEndMs: 0,
    durationMs: 0,
    tag: null,
    steps: steps([], stepCount),
    volume: 1,
    muted: false,
    showVideo: true,
  };
}

async function clipTrack(
  id: number,
  seed: number,
  tag: PersistedTrack["tag"],
  activeSteps: number[],
): Promise<PersistedTrack> {
  return {
    id,
    clipBlob: await fixtureBlob([seed, seed + 1, seed + 2], "video/webm"),
    audioBlob: await fixtureBlob([seed + 10, seed + 11], "audio/wav"),
    posterBlob: await fixtureBlob([0xff, 0xd8, seed], "image/jpeg"),
    trimStartMs: 25,
    trimEndMs: 925,
    durationMs: 1000,
    tag,
    steps: steps(activeSteps),
    volume: 1,
    muted: false,
    showVideo: true,
  };
}

export async function validV1MonolithProject(): Promise<PersistedProject> {
  const tracks = Array.from({ length: 8 }, (_, id) => emptyTrack(id));
  tracks[0] = await clipTrack(0, 1, "kick", [0, 8]);
  tracks[3] = await clipTrack(3, 30, "hat", [2, 6, 10, 14]);
  return {
    schemaVersion: 1,
    bpm: 104,
    swing: 0.1,
    cutSubdivision: "8n",
    sameTierHoldMs: 400,
    subgenre: "trap",
    vibe: "tight",
    stepCount: 16,
    tagReasoning: {
      0: "low thump",
      3: "bright tick",
    },
    tracks,
    updatedAt: 1_000,
  };
}

export function v0MonolithProject(): PersistedProject {
  return {
    bpm: 111,
    swing: 0.25,
    cutSubdivision: "4n",
    sameTierHoldMs: 600,
    subgenre: "lo-fi",
    vibe: "varied",
    stepCount: 16,
    tagReasoning: {},
    tracks: Array.from({ length: 8 }, (_, id) => ({
      ...emptyTrack(id),
      steps: steps(id === 0 ? [3] : []),
    })),
    updatedAt: 2_000,
  };
}

export function corruptV1MonolithProject(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    bpm: 999,
    swing: -0.5,
    cutSubdivision: "bad",
    sameTierHoldMs: "slow",
    subgenre: "jazz",
    vibe: "messy",
    stepCount: 15,
    tagReasoning: { 0: "stale without clip", 99: "out of range" },
    tracks: [
      {
        id: 0,
        clipBlob: null,
        audioBlob: "not a blob",
        posterBlob: "not a blob",
        trimStartMs: 0,
        trimEndMs: 0,
        durationMs: 0,
        tag: "wrong",
        steps: [true, "false", {}, false],
        volume: 4,
        muted: "no",
        showVideo: "yes",
      },
    ],
    updatedAt: "yesterday",
  };
}
