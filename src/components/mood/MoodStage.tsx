// ABOUTME: MoodStage — hidden export render canvas plus DPR display mirror.
// ABOUTME: Owns Mood's audio-clock rAF paint loop and active export canvas registration.
import { useEffect, useMemo, useRef } from "react";
import * as Tone from "tone";
import { sizeDisplayCanvas } from "../../lib/canvasDraw";
import { drawMoodFrame, initMoodRenderer } from "../../lib/moodRenderer";
import { STAGE_DESCRIPTORS } from "../../lib/moodStages";
import { setActiveCanvas } from "../../lib/videoEngine";
import { useAppStore } from "../../store/useAppStore";
import type { MoodPiece, MoodStageId } from "../../types";

const STAGE_LABELS: Record<MoodStageId, string> = {
  corners: "Corners",
  row: "Row",
  stack: "Stack",
};

interface MoodStageProps {
  piece: MoodPiece;
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
      <span className="sr-only">{stageLabel} stage</span>
      <span className="sr-only">{piece.mics.length} mics</span>
    </div>
  );
}
