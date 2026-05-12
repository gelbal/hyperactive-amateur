// ABOUTME: retagAll — holistic re-classification across every populated track, with per-clip fallback.
// ABOUTME: Wraps autoTagBatch + autoTag, writes tags into the store, and respects manual showVideo toggles.
import { useAppStore } from "../store/useAppStore";
import { autoTagBatch, type BatchAutoTagItem } from "./aiAutoTagBatch";
import { autoTag, AUTO_TAG_CONFIDENCE_THRESHOLD, type AutoTagResult } from "./aiAutoTag";
import { sliceAudioBuffer } from "./audioBufferSlice";
import { logger, LOG_EVENTS } from "./logger";
import { applyClassifiedTag } from "./applyClassifiedTag";

export interface RetagResult {
  ok: boolean;
  tagged: number;
  reason?: "no-clips" | "all-failed";
}

export interface RetagDeps {
  batch: (items: { trackId: number; audioBuffer: AudioBuffer }[]) => Promise<BatchAutoTagItem[] | null>;
  single: (audioBuffer: AudioBuffer, trackId: number) => Promise<AutoTagResult | null>;
}

const defaultDeps: RetagDeps = {
  batch: (items) => autoTagBatch(items),
  single: (buf) => autoTag(buf),
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

export async function retagAllClipsWith(deps: RetagDeps): Promise<RetagResult> {
  const tracks = populatedTracks();
  if (tracks.length === 0) {
    logger.warn(LOG_EVENTS.RETAG_MISS, { reason: "no-clips" });
    return { ok: false, tagged: 0, reason: "no-clips" };
  }

  logger.info(LOG_EVENTS.RETAG_START, { count: tracks.length });

  const batchResult = await deps.batch(tracks);
  if (batchResult) {
    let tagged = 0;
    for (const item of batchResult) {
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
    if (tagged === 0) {
      logger.warn(LOG_EVENTS.RETAG_COMPLETE, { mode: "batch", tagged: 0, total: tracks.length });
      return { ok: false, tagged: 0, reason: "all-failed" };
    }
    logger.info(LOG_EVENTS.RETAG_COMPLETE, { mode: "batch", tagged, total: tracks.length });
    return { ok: true, tagged };
  }

  logger.warn(LOG_EVENTS.RETAG_FALLBACK, { mode: "per-clip", count: tracks.length });
  const perClipResults = await Promise.all(
    tracks.map(async (t) => ({
      trackId: t.trackId,
      result: await deps.single(t.audioBuffer, t.trackId),
    })),
  );
  let tagged = 0;
  for (const { trackId, result } of perClipResults) {
    if (!result) continue;
    if (result.confidence < AUTO_TAG_CONFIDENCE_THRESHOLD) {
      logger.warn(LOG_EVENTS.RETAG_BELOW_THRESHOLD, {
        trackId,
        tag: result.tag,
        confidence: result.confidence,
        threshold: AUTO_TAG_CONFIDENCE_THRESHOLD,
      });
      continue;
    }
    const { applied } = applyClassifiedTag(trackId, result.tag, result.reasoning);
    if (applied) tagged++;
  }
  if (tagged === 0) {
    logger.warn(LOG_EVENTS.RETAG_COMPLETE, { mode: "per-clip", tagged: 0, total: tracks.length });
    return { ok: false, tagged: 0, reason: "all-failed" };
  }
  logger.info(LOG_EVENTS.RETAG_COMPLETE, { mode: "per-clip", tagged, total: tracks.length });
  return { ok: true, tagged };
}

export function retagAllClips(): Promise<RetagResult> {
  return retagAllClipsWith(defaultDeps);
}
