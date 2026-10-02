// ABOUTME: ExportButton — top-bar button + popover with cover, bars slider, format picker, progress, review.
// ABOUTME: Mirrors the FeelDisclosure pattern: anchored popover, click-outside + Escape close, no modal scrim.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Share2, Trash2, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import {
  exportSong,
  downloadBlob,
  defaultExportFilename,
  getExportDurationMs,
  getShareCardHoldMs,
  shareBlob,
} from "../lib/export";
import { PAPER, pickCoverClips, pickCoverPalettes } from "../lib/coverArt";
import { composeShareCard, loadCoverTiles, type CoverTiles } from "../lib/shareCard";
import { detectSupportedFormats, extensionForMimeType } from "../lib/exportFormats";
import { getAudioContext } from "../lib/audio";
import { getActiveCanvas } from "../lib/videoEngine";
import { usePopoverDismiss } from "../lib/usePopoverDismiss";
import { hasCoarsePointer } from "../lib/install";
import { canStartAudibleAction } from "../lib/audibleActionGate";

const MIN_BARS = 1;
const MAX_BARS = 8;
const DEFAULT_BARS = 4;
const STEPS_PER_BAR = 16;
const FORMAT_STORAGE_KEY = "ha:exportMimeType";
const SHARE_FAILED_MESSAGE = "Sharing failed — use Save to download the video.";

type ExportReview = {
  blob: Blob;
  filename: string;
  objectUrl?: string;
};

function makeShareFile(blob: Blob, filename: string): File | null {
  if (typeof File === "undefined") return null;
  return new File([blob], filename, { type: blob.type });
}

function canShareReview(review: ExportReview | null): boolean {
  if (!review) return false;
  const file = makeShareFile(review.blob, review.filename);
  return Boolean(file && navigator.canShare?.({ files: [file] }));
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException || err instanceof Error) &&
    err.name === "AbortError"
  );
}

function readStoredFormat(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(FORMAT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function ExportButton() {
  const bpm = useAppStore((s) => s.project.bpm);
  const tracks = useAppStore((s) => s.project.tracks);
  const stepCount = useAppStore((s) => s.project.stepCount);
  const canStart = useAppStore(canStartAudibleAction);
  const [open, setOpen] = useState(false);
  const [bars, setBars] = useState(DEFAULT_BARS);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareFallback, setShareFallback] = useState<string | null>(null);
  const [review, setReview] = useState<ExportReview | null>(null);
  const [sharePending, setSharePending] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reviewObjectUrlRef = useRef<string | null>(null);
  const reviewRef = useRef<ExportReview | null>(null);
  const mountedRef = useRef(true);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const tilesRef = useRef<Promise<CoverTiles> | null>(null);
  // The tiles with the load that made them: the preview shows them only
  // while that load is the current one.
  const [loaded, setLoaded] = useState<{ from: Promise<CoverTiles>; tiles: CoverTiles } | null>(
    null,
  );
  // Bars beyond the pattern's length replay it, so a short pattern's cover
  // does not change (or reload) as the length slider moves.
  const renderedSteps = Math.min(bars * STEPS_PER_BAR, stepCount);
  const coverClips = useMemo(
    () => pickCoverClips(tracks, renderedSteps),
    [tracks, renderedSteps],
  );
  // Drawn from the whole pattern and its takes, so the length slider never
  // recolours the cover.
  const coverPalettes = useMemo(() => pickCoverPalettes(tracks), [tracks]);
  // Any clip gets a cover; with none on screen it is the flat card.
  const coverOn = tracks.some((track) => track.clip);
  const rendering = progress !== null;
  const shareAvailable = useMemo(() => canShareReview(review), [review]);
  const exportDurationMs =
    getExportDurationMs(bars, bpm) + (coverOn ? getShareCardHoldMs(bpm) : 0);
  const exportDurationSeconds = Math.round(exportDurationMs / 1000);
  const close = useCallback(() => setOpen(false), []);
  usePopoverDismiss(rootRef, open, close, { whileBusy: rendering });

  const formats = useMemo(() => detectSupportedFormats(), []);
  const [mimeType, setMimeType] = useState<string>(() => {
    const saved = readStoredFormat();
    if (saved && formats.some((f) => f.mimeType === saved)) return saved;
    return formats[0]?.mimeType ?? "";
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

  // Loads the cover tiles once per open and per project change, while the
  // app could start audio. A load in flight when Render claims the session
  // is the one the export waits for.
  useEffect(() => {
    if (!open || !canStart || !coverOn) return;
    const loading = loadCoverTiles(coverClips);
    tilesRef.current = loading;
    void loading.then((tiles) => {
      if (tilesRef.current === loading && mountedRef.current) setLoaded({ from: loading, tiles });
    });
  }, [open, canStart, coverOn, coverClips]);

  // Draws the preview when the current load's tiles land, and clears it
  // while a newer load runs (the old tiles may show a clip that is gone).
  // Runs after the load effect above, so a reopened panel never draws the
  // previous load first. Never while a render, playback or recording runs:
  // composing is main-thread work beside the paint loop.
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || rendering || !canStart) return;
    const ctx = preview.getContext("2d");
    if (!loaded || loaded.from !== tilesRef.current) {
      ctx?.clearRect(0, 0, preview.width, preview.height);
      return;
    }
    ctx?.drawImage(composeShareCard(loaded.tiles, coverPalettes), 0, 0, preview.width, preview.height);
  }, [loaded, open, rendering, canStart, coverClips, coverPalettes]);

  // Clear stale errors when the popover closes so a reopen starts fresh.
  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  const revokeReviewObjectUrl = useCallback(() => {
    if (!reviewObjectUrlRef.current) return;
    URL.revokeObjectURL(reviewObjectUrlRef.current);
    reviewObjectUrlRef.current = null;
  }, []);

  const setCurrentReview = useCallback((nextReview: ExportReview | null) => {
    reviewRef.current = nextReview;
    setReview(nextReview);
  }, []);

  const dismissReview = useCallback(() => {
    revokeReviewObjectUrl();
    setCurrentReview(null);
    setShareFallback(null);
  }, [revokeReviewObjectUrl, setCurrentReview]);

  // The setup body re-arms the ref so StrictMode's dev double-mount
  // (setup → cleanup → setup) cannot strand it false for the component's life.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      revokeReviewObjectUrl();
    };
  }, [revokeReviewObjectUrl]);

  const saveReview = (current: ExportReview): boolean => {
    if (reviewRef.current !== current) return false;
    revokeReviewObjectUrl();
    const objectUrl = downloadBlob(current.blob, current.filename);
    const savedReview = { ...current, objectUrl };
    reviewObjectUrlRef.current = objectUrl;
    reviewRef.current = savedReview;
    setReview((existing) =>
      existing === current ? savedReview : existing,
    );
    return true;
  };

  const handleSave = () => {
    if (!review) return;
    saveReview(review);
  };

  const handleShare = async () => {
    if (!review || sharePending) return;
    const currentReview = review;
    setSharePending(true);
    setShareFallback(null);
    try {
      await shareBlob(currentReview.blob, currentReview.filename);
    } catch (err) {
      if (isAbortError(err)) return;
      if (!mountedRef.current || reviewRef.current !== currentReview) return;
      // The render already saved the video once; another automatic download
      // would duplicate it, so point to Save instead.
      setShareFallback(SHARE_FAILED_MESSAGE);
    } finally {
      if (mountedRef.current) setSharePending(false);
    }
  };

  const handleRender = async () => {
    if (!canStartAudibleAction(useAppStore.getState())) {
      setError("Finish recording or export before rendering.");
      return;
    }
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
    // The cover is a promise the export waits for inside its session; the
    // flat fallback is composed now, so frame 0 is a card even when the
    // tiles are late.
    let cover: Promise<HTMLCanvasElement | null> | undefined;
    let coverFallback: HTMLCanvasElement | undefined;
    const loading = tilesRef.current;
    if (coverOn && loading) {
      // Tiles landing after the export stopped waiting (its transport has
      // started) would only cost main-thread time during the recording.
      cover = loading.then((loaded) =>
        useAppStore.getState().playback.isPlaying ? null : composeShareCard(loaded, coverPalettes),
      );
      // Observed here so a render that fails before awaiting it cannot
      // leave an unhandled rejection; the export still sees it.
      cover.catch(() => undefined);
      coverFallback = composeShareCard(coverClips.map(() => null), coverPalettes);
    }
    dismissReview();
    setError(null);
    setProgress(0);
    try {
      const blob = await exportSong(canvas, getAudioContext(), {
        bars,
        bpm,
        mimeType: chosen.mimeType,
        onProgress: (p) => setProgress(p),
        cover,
        coverFallback,
      });
      const finished: ExportReview = {
        blob,
        filename: defaultExportFilename(
          extensionForMimeType(blob.type, chosen.extension),
        ),
      };
      setCurrentReview(finished);
      setOpen(true);
      // Act on the finished render at once. On a touch device that can
      // share files, Share is the primary action (it opens the sheet with
      // Save Video, and needs the fresh tap a render outlasts); everywhere
      // else the video saves itself.
      if (mountedRef.current && !(hasCoarsePointer() && canShareReview(finished))) {
        saveReview(finished);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="static lg:relative grow lg:grow-0" ref={rootRef}>
      <button
        type="button"
        aria-label="Export"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={rendering || (!canStart && !open)}
        onClick={() => {
          if (rendering) return;
          setOpen((v) => !v);
        }}
        className={
          "flex items-center justify-center gap-1.5 lg:gap-2 px-2 lg:px-3 py-2 pointer-coarse:min-h-11 w-full lg:w-auto text-sm rounded border transition-colors " +
          (rendering
            ? "bg-zinc-800 border-zinc-600 text-zinc-400 cursor-progress"
            : !canStart && !open
            ? "bg-zinc-900 border-zinc-800 text-zinc-600 cursor-not-allowed"
            : open
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
          className="absolute inset-x-3 top-full mt-2 z-30 w-auto max-w-[24rem] mx-auto max-h-[calc(100dvh_-_100%_-_1rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-xl p-4 flex flex-col gap-3 lg:inset-x-auto lg:right-0 lg:min-w-[18rem] lg:max-w-none lg:mx-0 lg:max-h-none lg:overflow-visible"
        >
          {coverOn && (
            <canvas
              ref={previewRef}
              width={192}
              height={192}
              role="img"
              aria-label="Cover preview"
              className="w-24 h-24 shrink-0 rounded"
              style={{ backgroundColor: PAPER }}
            />
          )}
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
                      "inline-flex items-center px-3 py-1.5 pointer-coarse:min-h-11 rounded-full text-xs cursor-pointer border " +
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
                ({Math.round(exportDurationMs / 100) / 10}s)
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
          <p className="text-xs text-zinc-400">
            Keep this screen open — rendering takes about {exportDurationSeconds} s.
          </p>

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

          {review && (
            <div className="flex flex-col gap-2 rounded border border-zinc-700 bg-zinc-950/60 p-3">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wide text-zinc-500">
                  Ready
                </span>
                <span className="font-mono text-xs text-zinc-100 break-all">
                  {review.filename}
                </span>
              </div>
              {shareFallback && (
                <p className="text-xs text-orange-300">{shareFallback}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {shareAvailable && (
                  <button
                    type="button"
                    disabled={sharePending}
                    onClick={() => void handleShare()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-orange-500 bg-orange-500 text-xs font-medium text-zinc-950 hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Share2 size={14} />
                    Share
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-600 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  <Download size={14} />
                  Save
                </button>
                <button
                  type="button"
                  onClick={dismissReview}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-700 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  {/* Once saved, closing the review throws nothing away. */}
                  {review.objectUrl ? <X size={14} /> : <Trash2 size={14} />}
                  {review.objectUrl ? "Done" : "Discard"}
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleRender()}
            disabled={rendering || !canStart}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded bg-orange-500 text-zinc-950 font-medium hover:bg-orange-400 disabled:opacity-50"
          >
            <Download size={16} />
            {rendering ? "Rendering" : review ? "Render again" : "Render"}
          </button>
        </div>
      )}
    </div>
  );
}
