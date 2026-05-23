// ABOUTME: ExportButton — top-bar button + popover with bars slider, format picker, progress, and download.
// ABOUTME: Mirrors the FeelDisclosure pattern: anchored popover, click-outside + Escape close, no modal scrim.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { exportSong, downloadBlob, defaultExportFilename } from "../lib/export";
import { detectSupportedFormats } from "../lib/exportFormats";
import { getAudioContext } from "../lib/audio";
import { getActiveCanvas } from "../lib/videoEngine";
import { usePopoverDismiss } from "../lib/usePopoverDismiss";

const MIN_BARS = 1;
const MAX_BARS = 8;
const DEFAULT_BARS = 4;
const FORMAT_STORAGE_KEY = "ha:exportMimeType";

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

  const formats = useMemo(() => detectSupportedFormats(), []);
  const [mimeType, setMimeType] = useState<string>(() => {
    const saved =
      typeof window !== "undefined"
        ? window.localStorage.getItem(FORMAT_STORAGE_KEY)
        : null;
    if (saved && formats.some((f) => f.mimeType === saved)) return saved;
    // First-use default: prefer MP4 (better for sharing to WhatsApp/iMessage/
    // Twitter/Instagram); fall back to whatever the browser does support.
    const mp4 = formats.find((f) => f.extension === "mp4");
    return (mp4 ?? formats[0])?.mimeType ?? "";
  });

  useEffect(() => {
    if (!mimeType) return;
    try {
      window.localStorage.setItem(FORMAT_STORAGE_KEY, mimeType);
    } catch {
      // localStorage may be unavailable (private mode); choice just doesn't
      // persist this session.
    }
  }, [mimeType]);

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
    const chosen = formats.find((f) => f.mimeType === mimeType) ?? formats[0];
    if (!chosen) {
      setError("This browser does not support video export.");
      return;
    }
    setError(null);
    setProgress(0);
    try {
      const blob = await exportSong(canvas, getAudioContext(), {
        bars,
        bpm,
        mimeType: chosen.mimeType,
        onProgress: (p) => setProgress(p),
      });
      downloadBlob(blob, defaultExportFilename(chosen.extension));
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
          {formats.length > 1 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[11px] uppercase tracking-wide text-zinc-400">
                Format
              </legend>
              <div className="flex gap-2">
                {formats.map((fmt) => (
                  <label
                    key={fmt.mimeType}
                    className={
                      "px-3 py-1.5 rounded-full text-xs cursor-pointer border " +
                      (mimeType === fmt.mimeType
                        ? "bg-orange-500 text-zinc-950 border-orange-500"
                        : "bg-zinc-900 text-zinc-300 border-zinc-700 hover:bg-zinc-800")
                    }
                  >
                    <input
                      type="radio"
                      name="export-format"
                      value={fmt.mimeType}
                      checked={mimeType === fmt.mimeType}
                      onChange={() => setMimeType(fmt.mimeType)}
                      className="sr-only"
                    />
                    {fmt.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
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
