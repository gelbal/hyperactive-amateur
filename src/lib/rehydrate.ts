// ABOUTME: rehydrate — load the persisted project, decode each clip blob, and dispatch to the store.
// ABOUTME: Object URLs are recreated on every load (not persisted).
import { loadProject } from "./persistence";
import { getAudioContext } from "./audio";
import { useAppStore } from "../store/useAppStore";
import type { AppState, Clip, Track } from "../types";
import { createInitialState, DEFAULT_STEP_COUNT } from "../store/initialState";
import { captureFirstFrame } from "./posterFrame";

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  // Fallback: rehydrate a plain Blob-shaped value (e.g., from fake-indexeddb)
  // back through the Response API.
  return new Response(blob).arrayBuffer();
}

async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const buffer = await blobToArrayBuffer(blob);
  return getAudioContext().decodeAudioData(buffer.slice(0));
}

async function decodeClipAudio(clipBlob: Blob, audioBlob?: Blob | null): Promise<AudioBuffer> {
  if (audioBlob) {
    try {
      return await decodeBlob(audioBlob);
    } catch {
      // Fall through to legacy mixed-container decode below.
    }
  }
  return decodeBlob(clipBlob);
}

export async function rehydrateFromStorage(): Promise<boolean> {
  const persisted = await loadProject();
  if (!persisted) return false;

  const empty = createInitialState();
  const stepCount = persisted.stepCount ?? DEFAULT_STEP_COUNT;

  const tracks: Track[] = await Promise.all(
    persisted.tracks.map(async (pt): Promise<Track> => {
      let clip: Clip | null = null;
      if (pt.clipBlob) {
        try {
          const audioBuffer = await decodeClipAudio(pt.clipBlob, pt.audioBlob);
          // Older saves predate posterBlob; regenerate from clipBlob so the
          // <img> thumbnails have something to show. Best-effort — null on fail.
          let posterBlob: Blob | null = pt.posterBlob ?? null;
          if (!posterBlob) {
            try {
              posterBlob = await captureFirstFrame(pt.clipBlob);
            } catch {
              posterBlob = null;
            }
          }
          clip = {
            blob: pt.clipBlob,
            url: URL.createObjectURL(pt.clipBlob),
            audioBuffer,
            audioBlob: pt.audioBlob ?? null,
            trimStartMs: pt.trimStartMs,
            trimEndMs: pt.trimEndMs,
            durationMs: pt.durationMs,
            posterBlob,
            posterUrl: posterBlob ? URL.createObjectURL(posterBlob) : null,
          };
        } catch (err) {
          // Decode failed — drop the clip rather than stranding the track.
          console.warn(`[rehydrate] dropping clip on track ${pt.id}:`, err);
          clip = null;
        }
      }
      // Pad / truncate persisted steps to match the project's stepCount.
      const steps = [...pt.steps];
      if (steps.length < stepCount) {
        steps.push(...new Array(stepCount - steps.length).fill(false));
      } else if (steps.length > stepCount) {
        steps.length = stepCount;
      }
      return {
        id: pt.id,
        clip,
        steps,
        volume: pt.volume,
        muted: pt.muted,
        tag: pt.tag,
        showVideo: pt.showVideo,
      };
    }),
  );

  const project: AppState["project"] = {
    bpm: persisted.bpm,
    swing: persisted.swing,
    cutSubdivision: persisted.cutSubdivision,
    sameTierHoldMs: persisted.sameTierHoldMs,
    subgenre: persisted.subgenre ?? "boom-bap",
    vibe: persisted.vibe ?? "tight",
    stepCount,
    tagReasoning: persisted.tagReasoning ?? {},
    tracks: tracks.length === 8 ? tracks : empty.project.tracks,
  };
  useAppStore.getState().actions.hydrateProject(project);
  return true;
}
