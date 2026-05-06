// ABOUTME: Viewport — square canvas that the hard-cut video renderer draws into.
// ABOUTME: Each rAF frame asks the videoEngine for the active clip's frame.
import { useEffect, useRef } from "react";
import * as Tone from "tone";
import { drawCurrentFrame, initVideoEngine, setActiveCanvas } from "../lib/videoEngine";
import { useAppStore } from "../store/useAppStore";

const SIZE = 480;

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasClips = useAppStore((s) => s.project.tracks.some((t) => t.clip));

  useEffect(() => {
    initVideoEngine();
  }, []);

  useEffect(() => {
    setActiveCanvas(canvasRef.current);
    return () => setActiveCanvas(null);
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
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        aria-label="hard-cut video viewport"
        className="block bg-zinc-950 rounded shadow-lg"
        style={{ width: SIZE, height: SIZE }}
      />
      {!hasClips && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-center text-zinc-500 px-8">
          <p className="text-sm">
            Record some sounds in the tracks below to get started. Use the
            mic button on each row, then toggle steps to make a beat.
          </p>
        </div>
      )}
    </div>
  );
}
