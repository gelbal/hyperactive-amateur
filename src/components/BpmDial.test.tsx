// ABOUTME: BpmDial tests — initial value, scroll wheel stepping, arrow keys, drag steps via document mousemove.
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { BpmDial } from "./BpmDial";
import { useAppStore } from "../store/useAppStore";

describe("BpmDial", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
  });

  it("renders the current BPM value", () => {
    render(<BpmDial />);
    expect(screen.getByText("90")).toBeInTheDocument();
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("aria-valuenow", "90");
  });

  it("scroll up steps to the next stop (10 BPM)", () => {
    render(<BpmDial />);
    fireEvent.wheel(screen.getByRole("slider"), { deltaY: -1 });
    expect(useAppStore.getState().project.bpm).toBe(100);
  });

  it("scroll down steps to the previous stop", () => {
    render(<BpmDial />);
    fireEvent.wheel(screen.getByRole("slider"), { deltaY: 1 });
    expect(useAppStore.getState().project.bpm).toBe(80);
  });

  it("ArrowRight / ArrowUp steps forward", () => {
    render(<BpmDial />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(useAppStore.getState().project.bpm).toBe(100);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowUp" });
    expect(useAppStore.getState().project.bpm).toBe(110);
  });

  it("ArrowLeft / ArrowDown steps backward", () => {
    render(<BpmDial />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowDown" });
    expect(useAppStore.getState().project.bpm).toBe(80);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowLeft" });
    expect(useAppStore.getState().project.bpm).toBe(70);
  });

  it("clamps at the lower end of the stops range", () => {
    useAppStore.getState().actions.setBpm(70);
    render(<BpmDial />);
    fireEvent.wheel(screen.getByRole("slider"), { deltaY: 1 });
    expect(useAppStore.getState().project.bpm).toBe(70);
  });

  it("clamps at the upper end of the stops range", () => {
    useAppStore.getState().actions.setBpm(160);
    render(<BpmDial />);
    fireEvent.wheel(screen.getByRole("slider"), { deltaY: -1 });
    expect(useAppStore.getState().project.bpm).toBe(160);
  });

  it("vertical drag changes BPM in proportion to pixels moved", () => {
    render(<BpmDial />);
    const knob = screen.getByRole("slider");
    fireEvent.mouseDown(knob, { clientY: 100 });
    act(() => {
      // Drag up by 32px → 2 stops up.
      document.dispatchEvent(new MouseEvent("mousemove", { clientY: 68 }));
    });
    expect(useAppStore.getState().project.bpm).toBe(110);
    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
  });
});
