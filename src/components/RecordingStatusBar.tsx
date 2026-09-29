// ABOUTME: Presentational recording-mode status bar shared by Chop and Mood header controls.
// ABOUTME: Renders audio-clock progress, capture actions, finishing feedback, and take receipts from props.
import { useEffect, useState } from "react";
import type { TakeReceipt } from "../types";

const PROGRESS_TICK_MS = 100;

export interface RecordingStatusBarProps {
  identity: string;
  state: "preparing" | "countdown" | "recording" | "finishing";
  beatSeconds: number;
  countdownEndsAt: number | null;
  captureEndsAt: number | null;
  nowSeconds: () => number;
  loopsMuted?: boolean;
  guidance?: string;
  receipt?: TakeReceipt | null;
  onStop?: () => void;
  onCancel?: () => void;
  onDismissReceipt?: () => void;
  stopLabel?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function formatSeconds(seconds: number): string {
  return `${finiteNonNegative(seconds).toFixed(1)}s`;
}

export function takeReceiptCopy(receipt: TakeReceipt): string {
  if (receipt.kind === "too-short") return "too short — try again";
  return `kept ${formatSeconds(receipt.seconds)} · ×${receipt.multiple}`;
}

function stateAnnouncement(
  state: RecordingStatusBarProps["state"],
  receipt: TakeReceipt | null,
): string {
  if (receipt?.kind === "kept") return "take kept";
  if (receipt?.kind === "too-short") return "take too short, try again";
  if (state === "countdown") return "count-in";
  if (state === "finishing") return "saving";
  return state;
}

export function RecordingStatusBar({
  identity,
  state,
  beatSeconds,
  countdownEndsAt,
  captureEndsAt,
  nowSeconds,
  loopsMuted = false,
  guidance,
  receipt = null,
  onStop,
  onCancel,
  onDismissReceipt,
  stopLabel = "stop",
}: RecordingStatusBarProps) {
  const [now, setNow] = useState(() => nowSeconds());

  useEffect(() => {
    setNow(nowSeconds());
    if (state !== "recording") return;
    const id = window.setInterval(() => setNow(nowSeconds()), PROGRESS_TICK_MS);
    return () => window.clearInterval(id);
  }, [nowSeconds, state]);

  const captureStart = countdownEndsAt ?? now;
  const windowSeconds = finiteNonNegative((captureEndsAt ?? captureStart) - captureStart);
  const elapsedSeconds = clamp(
    finiteNonNegative(now - captureStart),
    0,
    windowSeconds,
  );
  const progress = windowSeconds > 0 ? (elapsedSeconds / windowSeconds) * 100 : 0;
  const pulseSeconds = Number.isFinite(beatSeconds) ? Math.max(0.1, beatSeconds) : 1;

  return (
    <div
      className="flex min-h-14 flex-1 min-w-0 items-center gap-3 rounded border border-red-500 bg-red-900/40 px-3 py-2 text-red-100"
    >
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {stateAnnouncement(state, receipt)}
      </span>
      {receipt ? (
        <>
          <span
            className={`font-mono text-sm font-bold tabular-nums ${
              receipt.kind === "kept" ? "animate-pulse text-orange-500" : "text-red-200"
            }`}
          >
            {takeReceiptCopy(receipt)}
          </span>
          {onDismissReceipt && (
            <button
              type="button"
              aria-label="dismiss take note"
              onClick={onDismissReceipt}
              className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded border border-red-400/70 bg-zinc-950/70 text-lg leading-none text-red-100 hover:bg-red-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              ×
            </button>
          )}
        </>
      ) : (
        <>
          <span className="shrink-0 text-xs font-black uppercase tracking-wider">
            <span
              className="inline-block text-red-500 animate-pulse"
              style={{ animationDuration: `${pulseSeconds}s` }}
              aria-hidden
            >
              ●
            </span>{" "}
            REC {identity}
          </span>

          {state === "preparing" && (
            <span className="min-w-0 text-sm text-red-100/80">getting ready</span>
          )}

          {state === "countdown" && (
            <>
              {" "}
              <span className="min-w-0 text-sm font-semibold">· count-in</span>
              {onCancel && (
                <button
                  type="button"
                  aria-label="Cancel take"
                  onClick={onCancel}
                  className="ml-auto min-h-9 shrink-0 rounded border border-red-400/70 bg-zinc-950/70 px-3 text-xs font-bold uppercase tracking-wide text-red-100 hover:bg-red-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 pointer-coarse:min-h-11"
                >
                  cancel
                </button>
              )}
            </>
          )}

          {state === "recording" && (
            <>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-2">
                  <div
                    role="progressbar"
                    aria-label="Recording progress"
                    aria-valuemin={0}
                    aria-valuemax={windowSeconds}
                    aria-valuenow={elapsedSeconds}
                    className="h-2 min-w-12 flex-1 overflow-hidden rounded-full bg-red-950/80"
                  >
                    <div
                      className="h-full bg-red-500 transition-[width] duration-100 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="shrink-0 font-mono text-sm font-bold tabular-nums">
                    {formatSeconds(elapsedSeconds)}
                  </span>
                </div>
                {(loopsMuted || guidance) && (
                  <div className="flex min-w-0 flex-wrap gap-x-2 text-[10px] uppercase tracking-wide text-red-100/70">
                    {loopsMuted && <span>loops muted · no headphones</span>}
                    {guidance && <span>{guidance}</span>}
                  </div>
                )}
              </div>
              {onStop && (
                <button
                  type="button"
                  aria-label="Stop take now"
                  onClick={onStop}
                  className="min-h-9 shrink-0 rounded bg-red-500 px-3 text-xs font-black uppercase tracking-wide text-zinc-950 hover:bg-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200 pointer-coarse:min-h-11"
                >
                  {stopLabel}
                </button>
              )}
            </>
          )}

          {state === "finishing" && (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="font-mono text-sm tabular-nums">saving…</span>
              <span
                className="h-1.5 min-w-10 flex-1 animate-pulse rounded-full bg-red-500/70"
                aria-hidden
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
