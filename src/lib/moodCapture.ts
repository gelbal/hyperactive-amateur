// ABOUTME: Shared Mood capture state helpers for preview streams and metronome derivation.
// ABOUTME: Keeps recording-flow lifecycle data readable by renderer and video-pool policy code.
import type { MoodPerformanceState, MoodPiece } from "../types";

let moodRecordingPreviewStream: MediaStream | null = null;

export function setMoodRecordingPreviewStream(stream: MediaStream | null): void {
  moodRecordingPreviewStream = stream;
}

export function getMoodRecordingPreviewStream(): MediaStream | null {
  return moodRecordingPreviewStream;
}

export function deriveMoodMetronomeMicId(piece: MoodPiece): string | null {
  if (piece.oneMicId && piece.oneTakeId) {
    const oneMic = piece.mics.find((mic) => mic.id === piece.oneMicId);
    if (oneMic?.takes.some((take) => take.id === piece.oneTakeId)) {
      return oneMic.id;
    }
  }

  let fallback: { micId: string; recordedAt: number } | null = null;
  for (const mic of piece.mics) {
    for (const take of mic.takes) {
      if (!fallback || take.recordedAt < fallback.recordedAt) {
        fallback = { micId: mic.id, recordedAt: take.recordedAt };
      }
    }
  }
  return fallback?.micId ?? null;
}

export function deriveMoodMetronomeTakeId(
  piece: MoodPiece,
  performance: MoodPerformanceState,
): string | null {
  const micId = deriveMoodMetronomeMicId(piece);
  if (!micId) return null;
  const entry = performance.selections[micId];
  if (!entry || entry === "off") return null;
  const mic = piece.mics.find((candidate) => candidate.id === micId);
  if (!mic?.takes.some((take) => take.id === entry)) return null;
  return entry;
}
