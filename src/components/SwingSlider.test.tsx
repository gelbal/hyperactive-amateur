// ABOUTME: SwingSlider tests — initial value, change updates store as 0..1.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { SwingSlider } from "./SwingSlider";
import { useAppStore } from "../store/useAppStore";

describe("SwingSlider", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
  });

  it("renders at 0 by default", () => {
    render(<SwingSlider />);
    const slider = screen.getByLabelText("swing") as HTMLInputElement;
    expect(slider.value).toBe("0");
  });

  it("changing the slider stores 0..1 swing", () => {
    render(<SwingSlider />);
    const slider = screen.getByLabelText("swing");
    fireEvent.change(slider, { target: { value: "50" } });
    expect(useAppStore.getState().project.swing).toBeCloseTo(0.5);
  });
});
