// ABOUTME: SuggestButton — calls Claude to fill the step grid based on track tags + tempo.
// ABOUTME: Disabled until ≥4 tracks have clips; shows an undo toast for 5 seconds after applying.
import { useEffect, useState } from "react";
import { Sparkles, Undo2 } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { suggestPattern, SUBGENRES } from "../lib/aiSuggest";
import type { Subgenre } from "../types";

const TOAST_MS = 5000;
const MIN_CLIPS = 4;

export function SuggestButton() {
  const tracks = useAppStore((s) => s.project.tracks);
  const bpm = useAppStore((s) => s.project.bpm);
  const subgenre = useAppStore((s) => s.project.subgenre);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<boolean[][] | null>(null);

  const clipCount = tracks.filter((t) => t.clip).length;
  const disabled = pending || clipCount < MIN_CLIPS;

  useEffect(() => {
    if (!undoSnapshot) return;
    const id = window.setTimeout(() => setUndoSnapshot(null), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [undoSnapshot]);

  const handleClick = async () => {
    setError(null);
    setPending(true);
    const before = tracks.map((t) => [...t.steps]);
    try {
      const grid = await suggestPattern({
        bpm,
        subgenre,
        tracks: tracks.map((t) => ({ id: t.id, tag: t.tag })),
      });
      useAppStore.getState().actions.applyPattern(grid);
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
          className="bg-zinc-900 text-sm rounded border border-zinc-700 px-2 py-1 focus:outline-none focus:border-orange-500"
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
          clipCount < MIN_CLIPS
            ? `Record at least ${MIN_CLIPS} clips to enable this`
            : "Ask Claude to fill the grid"
        }
        onClick={() => void handleClick()}
        className="flex items-center gap-2 px-3 py-2 text-sm rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Sparkles size={14} className={pending ? "animate-pulse text-orange-400" : ""} />
        {pending ? "Thinking…" : "Suggest a beat"}
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
