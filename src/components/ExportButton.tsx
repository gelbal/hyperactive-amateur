// ABOUTME: ExportButton — top-bar button + popover with bars slider, render progress, and WebM download.
// ABOUTME: Mirrors the FeelDisclosure pattern: anchored popover, click-outside + Escape close, no modal scrim.
import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { exportSong, downloadBlob, defaultExportFilename } from "../lib/export";
import { getAudioContext } from "../lib/audio";
import { getActiveCanvas } from "../lib/videoEngine";
import { usePopoverDismiss } from "../lib/usePopoverDismiss";

const MIN_BARS = 1;
const MAX_BARS = 8;
const DEFAULT_BARS = 4;

export function ExportButton() {
  const bpm = useAppStore((s) => s.project.bpm);
  const [open, setOpen] = useState(false);
  const [bars, setBars] = useState(DEFAULT_BARS);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rendering = progress !== null;
  const close = useCallback(() => setOpen(false), []);
  usePopoverDismiss(rootRef, open, close, { whileBusy: rendering });

  // Clear stale errors when the popover closes so a reopen starts fresh.
  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  const handleRender = async () => {
    const canvas = getActiveCanvas();
    if (!canvas) {
      setError("Viewport canvas not ready");
      return;
    }
    setError(null);
    setProgress(0);
    try {
      const blob = await exportSong(canvas, getAudioContext(), {
        bars,
        bpm,
        onProgress: (p) => setProgress(p),
      });
      downloadBlob(blob, defaultExportFilename());
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label="Export"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={
          "flex items-center gap-2 px-3 py-2 text-sm rounded border transition-colors " +
          (open
            ? "bg-zinc-800 border-zinc-600 text-zinc-200"
            : "bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:border-zinc-500")
        }
      >
        <Download size={14} />
        Export
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Export song"
          className="absolute right-0 top-full mt-2 z-30 min-w-[18rem] rounded-md border border-zinc-700 bg-zinc-900 shadow-xl p-4 flex flex-col gap-3"
        >
          <label className="flex flex-col gap-2 text-sm">
            <span>
              Length: <span className="text-orange-400 font-mono">{bars}</span> bar
              {bars === 1 ? "" : "s"}{" "}
              <span className="text-zinc-500">
                ({Math.round(((bars * 4 * 60000) / bpm) / 100) / 10}s)
              </span>
            </span>
            <input
              type="range"
              min={MIN_BARS}
              max={MAX_BARS}
              value={bars}
              disabled={rendering}
              onChange={(e) => setBars(Number(e.target.value))}
              aria-label="bars"
            />
          </label>

          {progress !== null && (
            <div className="flex flex-col gap-1">
              <div className="h-2 bg-zinc-800 rounded overflow-hidden">
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={1}
                  aria-valuenow={progress}
                  className="h-full bg-orange-500 transition-[width] duration-100"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <span className="text-xs text-zinc-400">
                Rendering… {Math.round(progress * 100)}%
              </span>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="button"
            onClick={() => void handleRender()}
            disabled={rendering}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded bg-orange-500 text-zinc-950 font-medium hover:bg-orange-400 disabled:opacity-50"
          >
            <Download size={16} />
            {rendering ? "Rendering" : "Render"}
          </button>
        </div>
      )}
    </div>
  );
}
