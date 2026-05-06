// ABOUTME: Viewport — square canvas that the hard-cut video renderer draws into.
// ABOUTME: Step 17 sets up the rAF loop with a dark-fill placeholder; step 18+ wires real video.
import { useEffect, useRef } from "react";

const SIZE = 480;

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const draw = () => {
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, SIZE, SIZE);

      ctx.fillStyle = "#52525b";
      ctx.font = "14px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("VIEWPORT", SIZE / 2, SIZE / 2);

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
