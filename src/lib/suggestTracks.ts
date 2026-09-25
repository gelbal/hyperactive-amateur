// ABOUTME: Builds the per-track rows that Suggest and the variations send to Gemini.
// ABOUTME: A track without a clip plays its chosen kit voice, so it is sent under that voice's tag; the stored tag is untouched.
import { voiceFor } from "./drumKit";
import type { SuggestPatternInput } from "./aiSuggest";
import type { Track } from "../types";

export function suggestTracks(
  tracks: Track[],
  tagReasoning: Record<number, string>,
): SuggestPatternInput["tracks"] {
  return tracks.map((t) => ({
    id: t.id,
    // clearTrackClip keeps the tag, so the clip decides: a cleared track
    // plays a kit voice again and is described as one.
    tag: t.clip ? t.tag : voiceFor(t).tag,
    // An empty row says it is a built-in drum with no video, so the model
    // does not carry the groove on rows that never cut the picture.
    reasoning: t.clip ? (tagReasoning[t.id] ?? null) : `built-in ${voiceFor(t).name}, no video`,
  }));
}
