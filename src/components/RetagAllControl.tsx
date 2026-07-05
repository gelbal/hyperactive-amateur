// ABOUTME: RetagAllControl — Re-tag clips button for the Feel popover; runs holistic re-classification.
// ABOUTME: Disabled below 2 populated clips; reports busy state to the parent so the popover stays put while in flight; cancellable mid-flight.
import { useEffect, useRef, useState } from "react";
import { Wand2, X } from "lucide-react";
import { retagAllClips, type RetagResult } from "../lib/retagAll";
import { GeminiOfflineError } from "../lib/aiErrors";
import { AI_OFFLINE_COPY, aiOfflineHint } from "../lib/aiOffline";

interface Props {
  clipsCount: number;
  onRetag?: (signal: AbortSignal) => Promise<RetagResult>;
  onBusyChange?: (busy: boolean) => void;
}

type Result =
  | { kind: "done"; tagged: number }
  | { kind: "cancelled" }
  | { kind: "offline" }
  | { kind: "error" }
  | null;

const MIN_CLIPS = 2;

export function RetagAllControl({ clipsCount, onRetag, onBusyChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const disabled = clipsCount < MIN_CLIPS || busy;

  // Abort any in-flight retag if the popover (and so this component) goes
  // away while the model is still working.
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  async function handleClick() {
    setResult(null);
    setBusy(true);
    onBusyChange?.(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const r = await (onRetag
        ? onRetag(controller.signal)
        : retagAllClips(controller.signal));
      if (r.reason === "cancelled") setResult({ kind: "cancelled" });
      else if (r.reason === "offline") setResult({ kind: "offline" });
      else if (r.ok) setResult({ kind: "done", tagged: r.tagged });
      else setResult({ kind: "error" });
    } catch (err) {
      setResult(err instanceof GeminiOfflineError ? { kind: "offline" } : { kind: "error" });
    } finally {
      controllerRef.current = null;
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  function handleCancel() {
    controllerRef.current?.abort();
  }

  const label = busy ? `Re-tagging ${clipsCount} clips…` : "Re-tag clips";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled}
          aria-label="Re-tag all clips holistically"
          title={aiOfflineHint() ?? undefined}
          className={
            "flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded border transition-colors " +
            (disabled
              ? "text-zinc-500 border-zinc-800 cursor-not-allowed"
              : "text-zinc-200 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600")
          }
        >
          <Wand2 size={14} />
          {label}
        </button>
        {busy && (
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Cancel re-tag"
            className="flex items-center justify-center w-9 h-9 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-500"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {clipsCount < MIN_CLIPS && result === null && (
        <p className="text-xs text-zinc-500 text-center">Record at least 2 clips first.</p>
      )}
      {result?.kind === "done" && (
        <p className="text-xs text-orange-400 text-center" role="status">
          Tagged {result.tagged} clip{result.tagged === 1 ? "" : "s"}.
        </p>
      )}
      {result?.kind === "cancelled" && (
        <p className="text-xs text-zinc-400 text-center" role="status">
          Cancelled.
        </p>
      )}
      {result?.kind === "error" && (
        <p className="text-xs text-red-400 text-center" role="alert">
          Re-tag failed — see console.
        </p>
      )}
      {result?.kind === "offline" && (
        <p className="text-xs text-red-400 text-center" role="alert">
          {AI_OFFLINE_COPY}
        </p>
      )}
    </div>
  );
}
