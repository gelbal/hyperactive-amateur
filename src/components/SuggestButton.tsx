// ABOUTME: SuggestButton — calls Claude to fill the step grid based on track tags + tempo.
// ABOUTME: Disabled until ≥4 tracks have clips; shows an undo toast for 5 seconds after applying.
import { useEffect, useState } from "react";
import { Sparkles, Undo2 } from "lucide-react";
import { selectClipCount, useAppStore } from "../store/useAppStore";
import { AI_UNLOCK_CLIPS, suggestPattern, SUBGENRES } from "../lib/aiSuggest";
import type { Subgenre } from "../types";

const TOAST_MS = 5000;
const PENDING_VERB_ROTATE_MS = 7000;
const PENDING_VERBS = [
  "Vibing",
  "Cooking",
  "Chopping",
  "Crate-diggin'",
  "Flipping",
  "Layering",
  "Brewing",
  "Loopin'",
  "Sampling",
  "Bouncing",
] as const;

function nextVerb(exclude: string | null): string {
  const pool =
    exclude === null ? PENDING_VERBS : PENDING_VERBS.filter((v) => v !== exclude);
  return pool[Math.floor(Math.random() * pool.length)];
}

export function SuggestButton() {
  const subgenre = useAppStore((s) => s.project.subgenre);
  const clipCount = useAppStore(selectClipCount);
  const [pending, setPending] = useState(false);
  const [pendingVerb, setPendingVerb] = useState(() => nextVerb(null));
  const [error, setError] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<boolean[][] | null>(null);

  const disabled = pending || clipCount < AI_UNLOCK_CLIPS;

  useEffect(() => {
    if (!undoSnapshot) return;
    const id = window.setTimeout(() => setUndoSnapshot(null), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [undoSnapshot]);

  // While pending, swap the verb every few seconds so the wait feels alive
  // instead of frozen. Each pick excludes the current verb so the label
  // visibly changes rather than re-rolling the same word.
  useEffect(() => {
    if (!pending) return;
    setPendingVerb((current) => nextVerb(current));
    const id = window.setInterval(() => {
      setPendingVerb((current) => nextVerb(current));
    }, PENDING_VERB_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [pending]);

  const handleClick = async () => {
    setError(null);
    setPending(true);
    const state = useAppStore.getState();
    const { projectRevision } = state.session;
    const { bpm, subgenre, vibe, stepCount, tagReasoning } = state.project;
    const requestTracks = state.project.tracks;
    const before = requestTracks.map((t) => [...t.steps]);
    // Read reasoning fresh at click time — that way changes during a
    // retag pass don't re-render this button on every write.
    try {
      const grid = await suggestPattern({
        bpm,
        subgenre,
        vibe,
        stepCount,
        tracks: requestTracks.map((t) => ({
          id: t.id,
          tag: t.tag,
          reasoning: tagReasoning[t.id] ?? null,
        })),
      });
      const applied = useAppStore
        .getState()
        .actions.applyPatternIfCurrent(grid, projectRevision, stepCount);
      if (!applied) {
        setError("Beat changed while Gemini was thinking. Try again.");
        return;
      }
      setUndoSnapshot(before);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const handleUndo = () => {
    if (!undoSnapshot) return;
    useAppStore.getState().actions.applyPattern(undoSnapshot);
    setUndoSnapshot(null);
  };

  return (
    <div className="flex items-center gap-2">
      {!disabled && (
        <select
          aria-label="subgenre"
          value={subgenre}
          onChange={(e) =>
            useAppStore.getState().actions.setSubgenre(e.target.value as Subgenre)
          }
          className="bg-zinc-900 text-sm rounded border border-zinc-700 text-zinc-200 px-3 py-2 hover:border-zinc-500 focus:outline-none focus:border-orange-500 transition-colors"
        >
          {SUBGENRES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        aria-label="Suggest a beat"
        disabled={disabled}
        title={
          clipCount < AI_UNLOCK_CLIPS
            ? `Record at least ${AI_UNLOCK_CLIPS} clips to enable this`
            : "Ask Gemini to fill the grid"
        }
        onClick={() => void handleClick()}
        className="flex items-center gap-2 px-3 py-2 text-sm rounded bg-zinc-900 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:border-zinc-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <Sparkles size={14} className={pending ? "animate-pulse text-orange-400" : "text-orange-400"} />
        {pending ? `${pendingVerb}…` : "Suggest a beat"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-400 max-w-[14rem]">
          {error}
        </span>
      )}
      {undoSnapshot && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-40 flex items-center gap-3 px-4 py-3 rounded bg-zinc-900 border border-zinc-700 shadow-lg"
        >
          <span className="text-sm">AI suggested a pattern.</span>
          <button
            type="button"
            onClick={handleUndo}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-orange-500 text-zinc-950 hover:bg-orange-400"
          >
            <Undo2 size={12} /> Undo
          </button>
        </div>
      )}
    </div>
  );
}
