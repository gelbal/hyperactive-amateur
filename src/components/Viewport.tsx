// ABOUTME: Viewport — square canvas that the hard-cut video renderer draws into.
// ABOUTME: Each rAF frame asks the videoEngine for the active clip's frame.
import { useEffect, useRef } from "react";
import * as Tone from "tone";
import { drawCurrentFrame, initVideoEngine } from "../lib/videoEngine";

const SIZE = 480;

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    initVideoEngine();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const draw = () => {
      // Audio time is the source of truth for "what should be on screen".
      // rAF only decides when we paint.
      const audioTime = Tone.now();
      drawCurrentFrame(ctx, audioTime);
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      aria-label="hard-cut video viewport"
      className="block bg-zinc-950 rounded shadow-lg"
      style={{ width: SIZE, height: SIZE }}
    />
  );
}
