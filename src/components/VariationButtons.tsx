// ABOUTME: VariationButtons — Busier / Fill / Half-time / Strip mutations of the current pattern.
// ABOUTME: Each click snapshots the current grid and offers an Undo toast on success.
import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { selectClipCount, useAppStore } from "../store/useAppStore";
import { AI_UNLOCK_CLIPS, varyPattern, type Variation } from "../lib/aiSuggest";

const TOAST_MS = 5000;

interface ButtonSpec {
  variation: Variation;
  label: string;
}
const BUTTONS: ButtonSpec[] = [
  { variation: "busier", label: "Busier" },
  { variation: "fill", label: "Fill" },
  { variation: "halftime", label: "Half-time" },
  { variation: "strip", label: "Strip" },
  { variation: "break", label: "Break" },
];

export function VariationButtons() {
  const tracks = useAppStore((s) => s.project.tracks);
  const bpm = useAppStore((s) => s.project.bpm);
  const subgenre = useAppStore((s) => s.project.subgenre);
  const vibe = useAppStore((s) => s.project.vibe);
  const stepCount = useAppStore((s) => s.project.stepCount);
  const tagReasoning = useAppStore((s) => s.session.tagReasoning);
  const clipCount = useAppStore(selectClipCount);
  const [pending, setPending] = useState<Variation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<{
    variation: Variation;
    grid: boolean[][];
  } | null>(null);

  const hasPattern = tracks.some((t) => t.steps.some((s) => s));
  const baseDisabled = pending !== null || clipCount < AI_UNLOCK_CLIPS || !hasPattern;

  useEffect(() => {
    if (!undoSnapshot) return;
    const id = window.setTimeout(() => setUndoSnapshot(null), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [undoSnapshot]);

  const handleClick = async (variation: Variation) => {
    setError(null);
    setPending(variation);
    const before = tracks.map((t) => [...t.steps]);
    try {
      const grid = await varyPattern({
        bpm,
        subgenre,
        vibe,
        stepCount,
        tracks: tracks.map((t) => ({
          id: t.id,
          tag: t.tag,
          reasoning: tagReasoning[t.id] ?? null,
        })),
        currentPattern: before,
        variation,
      });
      useAppStore.getState().actions.applyPattern(grid);
      setUndoSnapshot({ variation, grid: before });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  };

  const handleUndo = () => {
    if (!undoSnapshot) return;
    useAppStore.getState().actions.applyPattern(undoSnapshot.grid);
    setUndoSnapshot(null);
  };

  return (
    <div className="flex items-center gap-1">
      {BUTTONS.map(({ variation, label }) => {
        const isPending = pending === variation;
        return (
          <button
            key={variation}
            type="button"
            aria-label={label}
            disabled={baseDisabled}
            title={
              clipCount < AI_UNLOCK_CLIPS
                ? `Record at least ${AI_UNLOCK_CLIPS} clips first`
                : !hasPattern
                  ? "Set a pattern first (Suggest a beat or toggle some steps)"
                  : `${label} variation`
            }
            onClick={() => void handleClick(variation)}
            className={
              "px-3 py-2 text-sm rounded border transition-colors " +
              "bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-500 " +
              "disabled:opacity-50 disabled:cursor-not-allowed " +
              (isPending ? "animate-pulse text-orange-400" : "")
            }
          >
            {label}
          </button>
        );
      })}
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
          <span className="text-sm">{capitalize(undoSnapshot.variation)} applied.</span>
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
