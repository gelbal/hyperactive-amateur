// ABOUTME: BpmDial tests — the three input modes (scroll, drag, arrow keys).
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { BpmDial } from "./BpmDial";
import { useAppStore } from "../store/useAppStore";

describe("BpmDial", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
  });

  it("scroll wheel and arrow keys step by one stop and clamp at the edges", () => {
    render(<BpmDial />);
    const slider = screen.getByRole("slider");

    // Default 90 → scroll up to 100, arrow up to 110.
    fireEvent.wheel(slider, { deltaY: -1 });
    expect(useAppStore.getState().project.bpm).toBe(100);
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(useAppStore.getState().project.bpm).toBe(110);

    // Clamp at top.
    act(() => {
      useAppStore.getState().actions.setBpm(160);
    });
    fireEvent.wheel(slider, { deltaY: -1 });
    expect(useAppStore.getState().project.bpm).toBe(160);
  });

  it("vertical drag changes BPM in proportion to pixels moved", () => {
    render(<BpmDial />);
    const knob = screen.getByRole("slider");
    fireEvent.mouseDown(knob, { clientY: 100 });
    act(() => {
      // Drag up 32px → 2 stops up from 90 → 110.
      document.dispatchEvent(new MouseEvent("mousemove", { clientY: 68 }));
    });
    expect(useAppStore.getState().project.bpm).toBe(110);
    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
  });
});
