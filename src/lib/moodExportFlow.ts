// ABOUTME: Mood performance-export flow — a one-take render driven by the live performance.
// ABOUTME: Owns the stop signal, boundary-aligned recorder start, and exportSong's mood drive hooks.
import * as Tone from "tone";
import { useAppStore } from "../store/useAppStore";
import { waitMs } from "./async";
import { getAudioContext } from "./audio";
import { exportSong, MOOD_EXPORT_MAX_MS, type ExportResult } from "./export";
import { nextCycleBoundary } from "./moodClock";
import { startMoodPerformanceForExportFlow } from "./moodTransport";
import { getActiveCanvas } from "./videoEngine";

export interface MoodExportOptions {
  mimeType: string;
  onProgress?: (fraction: number) => void;
}

export interface MoodExportHandle {
  result: Promise<ExportResult>;
  // Ends the render (a SUCCESS — the take is done); the performance keeps
  // running. Resolve-only: exportSong's stop signal must never reject.
  finish: () => void;
}

// No abort signal on purpose: exportSong races prepare against its own
// abort promise, so a dangling wait after an abort resolves harmlessly.
async function waitUntilAudioTime(
  deadlineSeconds: number,
  audioContext: Pick<BaseAudioContext, "currentTime">,
): Promise<void> {
  for (;;) {
    const remainingMs = (deadlineSeconds - audioContext.currentTime) * 1000;
    if (remainingMs <= 0) return;
    await waitMs(remainingMs);
  }
}

export function startMoodExport(options: MoodExportOptions): MoodExportHandle {
  const state = useAppStore.getState();
  const piece = state.mood.piece;
  if (!piece || piece.cycleSeconds === null) {
    throw new Error("Record the One before exporting.");
  }
  const canvas = getActiveCanvas();
  if (!canvas) {
    throw new Error("Mood stage canvas not ready");
  }

  let finish: () => void = () => undefined;
  const stopSignal = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const result = exportSong(canvas, getAudioContext(), {
    stopSignal,
    maxDurationMs: MOOD_EXPORT_MAX_MS,
    mimeType: options.mimeType,
    onProgress: options.onProgress,
    drive: {
      // Starts the live performance and holds until the next cycle boundary
      // so the recorder's first frame lands on the One.
      prepare: async () => {
        const started = await startMoodPerformanceForExportFlow();
        if (!started) {
          throw new Error("Could not start the performance for the export.");
        }
        const current = useAppStore.getState();
        const epoch = current.mood.performance.epoch;
        const cycleSeconds = current.mood.piece?.cycleSeconds ?? null;
        if (epoch === null || cycleSeconds === null) {
          throw new Error("Export needs a running cycle.");
        }
        await waitUntilAudioTime(
          nextCycleBoundary(epoch, cycleSeconds, Tone.now()),
          getAudioContext(),
        );
      },
      start: () => undefined,
      // The performance keeps running when the render ends — the render just
      // stopped watching. Must never throw (runs inside exportSong's finally).
      cleanup: () => undefined,
    },
  });

  return { result, finish };
}
