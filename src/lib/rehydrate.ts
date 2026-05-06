// ABOUTME: rehydrate — load the persisted project, decode each clip blob, and dispatch to the store.
// ABOUTME: Object URLs are recreated on every load (not persisted).
import { loadProject } from "./persistence";
import { getAudioContext } from "./audio";
import { useAppStore } from "../store/useAppStore";
import type { AppState, Clip, Track } from "../types";
import { createInitialState } from "../store/initialState";

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

export async function rehydrateFromStorage(): Promise<boolean> {
  const persisted = await loadProject();
  if (!persisted) return false;

  const empty = createInitialState();
  const tracks: Track[] = await Promise.all(
    persisted.tracks.map(async (pt): Promise<Track> => {
      let clip: Clip | null = null;
      if (pt.clipBlob) {
        try {
          const audioBuffer = await decodeBlob(pt.clipBlob);
          clip = {
            blob: pt.clipBlob,
            url: URL.createObjectURL(pt.clipBlob),
            audioBuffer,
            trimStartMs: pt.trimStartMs,
            trimEndMs: pt.trimEndMs,
            durationMs: pt.durationMs,
          };
        } catch (err) {
          // Decode failed — drop the clip rather than stranding the track.
          console.warn(`[rehydrate] dropping clip on track ${pt.id}:`, err);
          clip = null;
        }
      }
      return {
        id: pt.id,
        clip,
        steps: [...pt.steps],
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
    tracks: tracks.length === 8 ? tracks : empty.project.tracks,
  };
  useAppStore.getState().actions.hydrateProject(project);
  return true;
}
