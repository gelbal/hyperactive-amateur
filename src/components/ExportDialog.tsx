// ABOUTME: ExportDialog — modal with a bars slider + render progress + WebM download trigger.
// ABOUTME: Pulls the active canvas from videoEngine and streams audio via the shared AudioContext.
import { useState } from "react";
import { Download, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { exportSong, downloadBlob, defaultExportFilename } from "../lib/export";
import { getAudioContext } from "../lib/audio";
import { getActiveCanvas } from "../lib/videoEngine";

const MIN_BARS = 1;
const MAX_BARS = 8;
const DEFAULT_BARS = 4;

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const bpm = useAppStore((s) => s.project.bpm);
  const [bars, setBars] = useState(DEFAULT_BARS);
  const [progress, setProgress] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleRender = async () => {
    const canvas = getActiveCanvas();
    if (!canvas) {
      setError("Viewport canvas not ready");
      return;
    }
    setError(null);
    setRendering(true);
    setProgress(0);
    try {
      const blob = await exportSong(canvas, getAudioContext(), {
        bars,
        bpm,
        onProgress: (p) => setProgress(p),
      });
      downloadBlob(blob, defaultExportFilename());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
      setProgress(0);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Export song"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (!rendering && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 w-[24rem] flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Export song</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={rendering}
            className="text-zinc-400 hover:text-white disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

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

        {rendering && (
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
            <span className="text-xs text-zinc-400">Rendering… {Math.round(progress * 100)}%</span>
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
    </div>
  );
}
