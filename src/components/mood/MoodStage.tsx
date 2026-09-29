// ABOUTME: MoodStage — hidden export render canvas plus DPR display mirror.
// ABOUTME: Owns Mood's audio-clock rAF paint loop and active export canvas registration.
import { useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import { sizeDisplayCanvas } from "../../lib/canvasDraw";
import { countInBeatSeconds, recordMoodTake } from "../../lib/moodRecordingFlow";
import { drawMoodFrame, initMoodRenderer } from "../../lib/moodRenderer";
import { STAGE_DESCRIPTORS } from "../../lib/moodStages";
import { layoutFor, type TileRect } from "../../lib/moodTilers";
import { setActiveCanvas } from "../../lib/videoEngine";
import { useAppStore } from "../../store/useAppStore";
import type { MoodPiece, MoodSelectionEntry, MoodStageId, RecordingState } from "../../types";

const STAGE_LABELS: Record<MoodStageId, string> = {
  corners: "Corners",
  row: "Row",
  stack: "Stack",
};
const COUNTDOWN_TICK_MS = 100;

interface MoodStageProps {
  piece: MoodPiece;
}

function isCaptureOverlayState(state: RecordingState): boolean {
  return state === "preparing" || state === "countdown" || state === "recording";
}

// Digits count BEATS remaining (the same beat the count-in ticks play on),
// not wall seconds — a 90bpm count-in must read 3-2-1 across its 2 seconds.
function countInDigit(countdownEndsAt: number | null, beatSeconds: number): number {
  if (countdownEndsAt === null) return 3;
  const beatsRemaining = Math.ceil((countdownEndsAt - Tone.immediate()) / beatSeconds);
  return Math.max(1, Math.min(3, beatsRemaining));
}

function hotTileRect(piece: MoodPiece, hotMicId: string | null): TileRect | null {
  if (!hotMicId) return null;
  const rects = layoutFor(
    piece.stage,
    piece.lens,
    piece.mics.map((mic) => ({ micId: mic.id, live: true })),
  );
  return rects.find((rect) => rect.micId === hotMicId) ?? null;
}

function pieceHasNoTakes(piece: MoodPiece): boolean {
  return piece.mics.every((mic) => mic.takes.length === 0);
}

function hasLiveSelection(
  piece: MoodPiece,
  selections: Record<string, MoodSelectionEntry>,
): boolean {
  return piece.mics.some((mic) => {
    const entry = selections[mic.id];
    return entry !== undefined && entry !== "off" && mic.takes.some((take) => take.id === entry);
  });
}

function MoodOneInvitation({ piece }: MoodStageProps) {
  const monitorWithHeadphones = useAppStore((s) => s.mood.monitorWithHeadphones);
  const recordingState = useAppStore((s) => s.recording.state);
  const isExporting = useAppStore((s) => s.playback.isExporting);
  const setMonitorWithHeadphones = useAppStore((s) => s.actions.setMonitorWithHeadphones);
  const showInvitation = pieceHasNoTakes(piece) && recordingState === "idle";
  if (!showInvitation) return null;

  const startTheOne = () => {
    if (isExporting) return;
    void recordMoodTake("mic-0");
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/65 px-4">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          aria-label="record the One"
          disabled={isExporting}
          onClick={startTheOne}
          className="flex min-h-12 flex-col items-center justify-center rounded border border-orange-500/70 bg-orange-500 px-4 py-2 text-zinc-950 hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="text-sm font-semibold">record the One</span>
          <span className="text-xs">your first loop sets the length</span>
        </button>
        <label className="flex min-h-12 items-center gap-2 rounded border border-zinc-700 bg-zinc-950/90 px-3 py-2 text-left text-xs text-zinc-300">
          <input
            type="checkbox"
            aria-label="I've got headphones on"
            checked={monitorWithHeadphones}
            disabled={isExporting}
            onChange={(event) => setMonitorWithHeadphones(event.currentTarget.checked)}
            className="h-4 w-4 shrink-0 accent-orange-500 disabled:cursor-not-allowed"
          />
          <span>I've got headphones on</span>
        </label>
      </div>
    </div>
  );
}

function MoodCaptureOverlay({ piece }: MoodStageProps) {
  const recordingState = useAppStore((s) => s.recording.state);
  const countdownEndsAt = useAppStore((s) => s.recording.countdownEndsAt);
  const hotMicId = useAppStore((s) => s.mood.performance.hotMicId);
  const descriptor = STAGE_DESCRIPTORS[piece.stage];
  const rect = useMemo(() => hotTileRect(piece, hotMicId), [hotMicId, piece]);
  const beatSeconds = countInBeatSeconds(piece);
  const [count, setCount] = useState(() => countInDigit(countdownEndsAt, beatSeconds));

  useEffect(() => {
    if (recordingState !== "countdown") {
      setCount(3);
      return;
    }
    const update = () => setCount(countInDigit(countdownEndsAt, beatSeconds));
    update();
    const id = window.setInterval(update, COUNTDOWN_TICK_MS);
    return () => window.clearInterval(id);
  }, [beatSeconds, countdownEndsAt, recordingState]);

  if (!rect || !isCaptureOverlayState(recordingState)) return null;

  return (
    <div
      role="status"
      aria-live="assertive"
      aria-label="Mood count-in for hot mic"
      className="absolute z-30 flex items-center justify-center bg-black/55 pointer-events-none"
      style={{
        left: `${(rect.x / descriptor.canvasSize.w) * 100}%`,
        top: `${(rect.y / descriptor.canvasSize.h) * 100}%`,
        width: `${(rect.w / descriptor.canvasSize.w) * 100}%`,
        height: `${(rect.h / descriptor.canvasSize.h) * 100}%`,
      }}
    >
      {recordingState === "preparing" ? (
        <div className="px-2 text-center text-sm font-semibold tracking-tight text-white">
          Getting ready
        </div>
      ) : recordingState === "countdown" ? (
        <div
          key={count}
          data-testid="mood-count-in-digit"
          className="text-6xl font-extrabold leading-none text-white tabular-nums"
          style={{ animation: "scale-down 1s ease-out forwards" }}
        >
          {count}
        </div>
      ) : (
        <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-red-400">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" aria-hidden />
          Recording
        </div>
      )}
      <style>{`@keyframes scale-down{from{transform:scale(1.4);opacity:0.4}to{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}

function MoodSplitsZeroLiveOverlay({ piece }: MoodStageProps) {
  const performance = useAppStore((s) => s.mood.performance);
  const recordingState = useAppStore((s) => s.recording.state);
  const show =
    piece.lens === "splits" &&
    !pieceHasNoTakes(piece) &&
    !isCaptureOverlayState(recordingState) &&
    !hasLiveSelection(piece, performance.selections);

  if (!show) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="mood-splits-zero-live"
      data-cycle={performance.cycleCount}
      className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/85 pointer-events-none"
    >
      <span
        key={performance.cycleCount}
        className="block h-20 w-20 rounded-full border border-orange-500/55"
        style={{ animation: "mood-boundary-ring 520ms ease-out forwards" }}
      />
      <style>{`@keyframes mood-boundary-ring{from{transform:scale(.82);opacity:.7}to{transform:scale(1.18);opacity:.18}}`}</style>
    </div>
  );
}

export function MoodStage({ piece }: MoodStageProps) {
  const renderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const descriptor = STAGE_DESCRIPTORS[piece.stage];
  const stageLabel = STAGE_LABELS[piece.stage];
  const frameStyle = useMemo(
    () => ({
      aspectRatio: `${descriptor.canvasSize.w} / ${descriptor.canvasSize.h}`,
      maxWidth:
        descriptor.canvasSize.w >= descriptor.canvasSize.h
          ? "min(100%, 46rem)"
          : "min(100%, 26rem)",
    }),
    [descriptor.canvasSize.h, descriptor.canvasSize.w],
  );

  useEffect(() => {
    const renderCanvas = renderCanvasRef.current;
    if (!renderCanvas) return;
    initMoodRenderer(renderCanvas, piece.stage);
  }, [piece.stage]);

  useEffect(() => {
    setActiveCanvas(renderCanvasRef.current);
    return () => setActiveCanvas(null);
  }, []);

  useEffect(() => {
    const displayCanvas = displayCanvasRef.current;
    if (!displayCanvas) return;

    const sizeFromCss = (cssW: number, cssH: number) => {
      sizeDisplayCanvas(
        displayCanvas,
        cssW || descriptor.canvasSize.w,
        cssH || descriptor.canvasSize.h,
      );
    };

    if (typeof ResizeObserver === "undefined") {
      sizeFromCss(descriptor.canvasSize.w, descriptor.canvasSize.h);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      sizeFromCss(rect?.width ?? descriptor.canvasSize.w, rect?.height ?? descriptor.canvasSize.h);
    });

    observer.observe(displayCanvas);
    return () => observer.disconnect();
  }, [descriptor.canvasSize.h, descriptor.canvasSize.w]);

  useEffect(() => {
    const renderCanvas = renderCanvasRef.current;
    const displayCanvas = displayCanvasRef.current;
    if (!renderCanvas || !displayCanvas) return;
    const displayCtx = displayCanvas.getContext("2d");
    if (!displayCtx) return;

    let rafId = 0;
    const draw = () => {
      const audioTime = Tone.immediate();
      const mood = useAppStore.getState().mood;
      drawMoodFrame(audioTime, {
        piece: mood.piece ?? piece,
        performance: mood.performance,
      });
      displayCtx.drawImage(
        renderCanvas,
        0,
        0,
        displayCanvas.width,
        displayCanvas.height,
      );
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [piece]);

  return (
    <div
      aria-label={`${stageLabel} stage`}
      className="relative w-full overflow-hidden rounded bg-zinc-950 shadow-lg"
      style={frameStyle}
    >
      <canvas
        ref={renderCanvasRef}
        width={descriptor.canvasSize.w}
        height={descriptor.canvasSize.h}
        aria-hidden="true"
        className="ha-mood-render-canvas"
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0,
          pointerEvents: "none",
        }}
      />
      <canvas
        ref={displayCanvasRef}
        width={descriptor.canvasSize.w}
        height={descriptor.canvasSize.h}
        aria-label="Mood stage display"
        className="ha-mood-display-canvas block h-full w-full bg-zinc-950"
      />
      <MoodSplitsZeroLiveOverlay piece={piece} />
      <MoodOneInvitation piece={piece} />
      <MoodCaptureOverlay piece={piece} />
      <span className="sr-only">{stageLabel} stage</span>
      <span className="sr-only">{piece.mics.length} mics</span>
    </div>
  );
}
