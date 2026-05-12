// ABOUTME: retagAll — holistic re-classification across every populated track, with per-clip fallback.
// ABOUTME: Wraps autoTagBatch + autoTag, writes tags into the store, and respects manual showVideo toggles.
import { useAppStore } from "../store/useAppStore";
import { autoTagBatch, type BatchAutoTagItem } from "./aiAutoTagBatch";
import { autoTag, AUTO_TAG_CONFIDENCE_THRESHOLD, type AutoTagResult } from "./aiAutoTag";
import { sliceAudioBuffer } from "./audioBufferSlice";
import { logger, LOG_EVENTS } from "./logger";
import { applyClassifiedTag } from "./applyClassifiedTag";
import type { Tag } from "../types";

export interface RetagResult {
  ok: boolean;
  tagged: number;
  reason?: "no-clips" | "all-failed" | "cancelled";
}

export interface RetagDeps {
  batch: (
    items: { trackId: number; audioBuffer: AudioBuffer }[],
    signal?: AbortSignal,
  ) => Promise<BatchAutoTagItem[] | null>;
  single: (
    audioBuffer: AudioBuffer,
    trackId: number,
    signal?: AbortSignal,
  ) => Promise<AutoTagResult | null>;
}

const defaultDeps: RetagDeps = {
  batch: (items, signal) => autoTagBatch(items, undefined, signal),
  single: (buf, _trackId, signal) => autoTag(buf, undefined, signal),
};

interface PopulatedTrack {
  trackId: number;
  audioBuffer: AudioBuffer;
}

function populatedTracks(): PopulatedTrack[] {
  return useAppStore
    .getState()
    .project.tracks.filter((t) => t.clip != null)
    .map((t) => ({
      trackId: t.id,
      // Trim around the actual sound — silence on either side dilutes the
      // classifier and inflates the inline payload size estimate.
      audioBuffer: sliceAudioBuffer(
        t.clip!.audioBuffer,
        t.clip!.trimStartMs,
        t.clip!.trimEndMs,
      ),
    }));
}

function cancelled(total: number): RetagResult {
  logger.warn(LOG_EVENTS.RETAG_CANCELLED, { total });
  return { ok: false, tagged: 0, reason: "cancelled" };
}

interface Classification {
  trackId: number;
  tag: Tag;
  confidence: number;
  reasoning?: string;
}

function applyAcceptedTags(items: Classification[]): number {
  let tagged = 0;
  for (const item of items) {
    if (item.confidence < AUTO_TAG_CONFIDENCE_THRESHOLD) {
      logger.warn(LOG_EVENTS.RETAG_BELOW_THRESHOLD, {
        trackId: item.trackId,
        tag: item.tag,
        confidence: item.confidence,
        threshold: AUTO_TAG_CONFIDENCE_THRESHOLD,
      });
      continue;
    }
    const { applied } = applyClassifiedTag(item.trackId, item.tag, item.reasoning);
    if (applied) tagged++;
  }
  return tagged;
}

function completion(mode: "batch" | "per-clip", tagged: number, total: number): RetagResult {
  if (tagged === 0) {
    logger.warn(LOG_EVENTS.RETAG_COMPLETE, { mode, tagged: 0, total });
    return { ok: false, tagged: 0, reason: "all-failed" };
  }
  logger.info(LOG_EVENTS.RETAG_COMPLETE, { mode, tagged, total });
  return { ok: true, tagged };
}

export async function retagAllClipsWith(
  deps: RetagDeps,
  signal?: AbortSignal,
): Promise<RetagResult> {
  const tracks = populatedTracks();
  if (tracks.length === 0) {
    logger.warn(LOG_EVENTS.RETAG_MISS, { reason: "no-clips" });
    return { ok: false, tagged: 0, reason: "no-clips" };
  }

  logger.info(LOG_EVENTS.RETAG_START, { count: tracks.length });
  if (signal?.aborted) return cancelled(tracks.length);

  const batchResult = await deps.batch(tracks, signal);
  if (signal?.aborted) return cancelled(tracks.length);
  if (batchResult) {
    return completion("batch", applyAcceptedTags(batchResult), tracks.length);
  }

  logger.warn(LOG_EVENTS.RETAG_FALLBACK, { mode: "per-clip", count: tracks.length });
  const perClipResults = await Promise.all(
    tracks.map(async (t) => ({
      trackId: t.trackId,
      result: await deps.single(t.audioBuffer, t.trackId, signal),
    })),
  );
  if (signal?.aborted) return cancelled(tracks.length);
  const accepted: Classification[] = [];
  for (const { trackId, result } of perClipResults) {
    if (result) accepted.push({ trackId, ...result });
  }
  return completion("per-clip", applyAcceptedTags(accepted), tracks.length);
}

export function retagAllClips(signal?: AbortSignal): Promise<RetagResult> {
  return retagAllClipsWith(defaultDeps, signal);
}
