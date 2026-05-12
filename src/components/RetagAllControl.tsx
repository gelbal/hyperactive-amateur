// ABOUTME: RetagAllControl — Re-tag clips button for the Feel popover; runs holistic re-classification.
// ABOUTME: Disabled below 2 populated clips; reports busy state to the parent so the popover stays put while in flight.
import { useState } from "react";
import { Wand2 } from "lucide-react";
import { retagAllClips, type RetagResult } from "../lib/retagAll";

interface Props {
  clipsCount: number;
  onRetag?: () => Promise<RetagResult>;
  onBusyChange?: (busy: boolean) => void;
}

type Result = { kind: "done"; tagged: number } | { kind: "error" } | null;

const MIN_CLIPS = 2;

export function RetagAllControl({ clipsCount, onRetag, onBusyChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const disabled = clipsCount < MIN_CLIPS || busy;

  async function handleClick() {
    setResult(null);
    setBusy(true);
    onBusyChange?.(true);
    try {
      const r = await (onRetag ? onRetag() : retagAllClips());
      setResult(r.ok ? { kind: "done", tagged: r.tagged } : { kind: "error" });
    } catch {
      setResult({ kind: "error" });
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  const label = busy ? `Re-tagging ${clipsCount} clips…` : "Re-tag clips";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label="Re-tag all clips holistically"
        className={
          "w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded border transition-colors " +
          (disabled
            ? "text-zinc-500 border-zinc-800 cursor-not-allowed"
            : "text-zinc-200 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600")
        }
      >
        <Wand2 size={14} />
        {label}
      </button>
      {clipsCount < MIN_CLIPS && result === null && (
        <p className="text-xs text-zinc-500 text-center">Record at least 2 clips first.</p>
      )}
      {result?.kind === "done" && (
        <p className="text-xs text-orange-400 text-center" role="status">
          Tagged {result.tagged} clip{result.tagged === 1 ? "" : "s"}.
        </p>
      )}
      {result?.kind === "error" && (
        <p className="text-xs text-red-400 text-center" role="alert">
          Re-tag failed — see console.
        </p>
      )}
    </div>
  );
}
