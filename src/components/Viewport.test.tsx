// ABOUTME: Viewport tests — canvas mounts at the expected dimensions and is labeled.
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("tone", () => ({
  now: vi.fn(() => 0),
  getTransport: vi.fn(() => ({
    clear: vi.fn(),
    scheduleRepeat: vi.fn(() => 1),
  })),
}));

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
