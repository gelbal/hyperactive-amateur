// ABOUTME: Viewport tests — canvas mounts at the expected dimensions and is labeled.
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Viewport } from "./Viewport";

describe("Viewport", () => {
  it("renders a labeled canvas at 480x480", () => {
    render(<Viewport />);
    const canvas = screen.getByLabelText("hard-cut video viewport") as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    expect(canvas.width).toBe(480);
    expect(canvas.height).toBe(480);
  });
});
