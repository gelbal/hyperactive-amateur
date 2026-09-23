// ABOUTME: BpmDial tests — turning the knob by angle changes BPM; arrow keys still step; cancel reverts.
// ABOUTME: jsdom's PointerEvent ignores client coordinates in its init and its rects are zero, so both are built by hand.
import { cleanup, render, screen, fireEvent, createEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BpmDial } from "./BpmDial";
import { useAppStore } from "../store/useAppStore";

const SIZE = 56;
const CENTER = SIZE / 2;
const RING = 26;

// Point on the knob's ring at a clock angle: 0° is 12 o'clock, clockwise.
function at(angleDeg: number): { clientX: number; clientY: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { clientX: CENTER + RING * Math.sin(rad), clientY: CENTER - RING * Math.cos(rad) };
}

function firePointer(
  knob: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: { pointerId?: number; clientX?: number; clientY?: number },
): void {
  const event = createEvent[type === "pointerdown" ? "pointerDown" :
    type === "pointermove" ? "pointerMove" :
    type === "pointerup" ? "pointerUp" : "pointerCancel"](knob, {
    pointerId: init.pointerId ?? 1,
  });
  if (init.clientX !== undefined) {
    Object.defineProperty(event, "clientX", { value: init.clientX });
  }
  if (init.clientY !== undefined) {
    Object.defineProperty(event, "clientY", { value: init.clientY });
  }
  fireEvent(knob, event);
}

function renderKnob(): HTMLElement {
  render(<BpmDial />);
  const knob = screen.getByRole("slider");
  vi.spyOn(knob, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: SIZE,
    height: SIZE,
    right: SIZE,
    bottom: SIZE,
    toJSON: () => ({}),
  } as DOMRect);
  return knob;
}

describe("BpmDial", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    // jsdom doesn't implement pointer capture — stub it so onPointerDown
    // doesn't throw.
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
  });

  afterEach(() => {
    cleanup();
  });

  it("turning clockwise from 12 to 3 o'clock raises BPM three stops and shows a grab cursor", () => {
    useAppStore.getState().actions.setBpm(90);
    const knob = renderKnob();
    expect(knob.className).toContain("cursor-grab");

    firePointer(knob, "pointerdown", at(0));
    firePointer(knob, "pointermove", at(90));
    firePointer(knob, "pointerup", at(90));

    expect(useAppStore.getState().project.bpm).toBe(120);
  });

  it("turning counter-clockwise lowers BPM", () => {
    useAppStore.getState().actions.setBpm(90);
    const knob = renderKnob();

    firePointer(knob, "pointerdown", at(90));
    firePointer(knob, "pointermove", at(30));
    firePointer(knob, "pointerup", at(30));

    expect(useAppStore.getState().project.bpm).toBe(70);
  });

  it("reversing after the top stop lowers BPM on the first 30 degrees back", () => {
    useAppStore.getState().actions.setBpm(150);
    const knob = renderKnob();

    firePointer(knob, "pointerdown", at(0));
    firePointer(knob, "pointermove", at(90));
    expect(useAppStore.getState().project.bpm).toBe(160);

    firePointer(knob, "pointermove", at(60));
    firePointer(knob, "pointerup", at(60));
    expect(useAppStore.getState().project.bpm).toBe(150);
  });

  it("a straight half-turn from 12 to 6 o'clock counts clockwise", () => {
    useAppStore.getState().actions.setBpm(100);
    const knob = renderKnob();

    firePointer(knob, "pointerdown", at(0));
    firePointer(knob, "pointermove", at(180));
    firePointer(knob, "pointerup", at(180));

    expect(useAppStore.getState().project.bpm).toBe(160);
  });

  it("a sub-stop wobble and a move through the centre write nothing", () => {
    useAppStore.getState().actions.setBpm(90);
    const setBpm = vi.spyOn(useAppStore.getState().actions, "setBpm");
    const knob = renderKnob();

    firePointer(knob, "pointerdown", at(0));
    firePointer(knob, "pointermove", at(10));
    firePointer(knob, "pointermove", { clientX: CENTER + 2, clientY: CENTER - 2 });
    firePointer(knob, "pointermove", at(-10));
    firePointer(knob, "pointerup", at(-10));

    expect(setBpm).not.toHaveBeenCalled();
    expect(useAppStore.getState().project.bpm).toBe(90);
    setBpm.mockRestore();
  });

  it("pointer-cancel mid-drag does not change BPM", () => {
    useAppStore.getState().actions.setBpm(90);
    const knob = renderKnob();
    firePointer(knob, "pointerdown", at(0));
    firePointer(knob, "pointercancel", {});
    // A subsequent move must not be honored (the drag was cleared).
    firePointer(knob, "pointermove", at(90));
    expect(useAppStore.getState().project.bpm).toBe(90);
  });

  it("stacks the readout under the knob so the transport fits beside the title", () => {
    const knob = renderKnob();

    expect(knob.parentElement).toHaveClass("flex-col", "items-center");
    expect(screen.getByText("BPM")).toBeInTheDocument();
  });

  it("ArrowUp still increments by one stop", () => {
    useAppStore.getState().actions.setBpm(90);
    const knob = renderKnob();
    fireEvent.keyDown(knob, { key: "ArrowUp" });
    expect(useAppStore.getState().project.bpm).toBe(100);
  });

  describe("while exporting", () => {
    afterEach(() => {
      // Unmount before the store write, or React warns about an update
      // outside act(); reset() itself no-ops while exporting.
      cleanup();
      useAppStore.getState().actions.setIsExporting(false);
    });

    it("renders disabled and ignores wheel, turn, and arrow keys", () => {
      useAppStore.getState().actions.setBpm(90);
      useAppStore.getState().actions.setIsExporting(true);
      const setBpm = vi.spyOn(useAppStore.getState().actions, "setBpm");
      const knob = renderKnob();

      expect(knob).toBeDisabled();

      fireEvent.wheel(knob, { deltaY: -1 });
      firePointer(knob, "pointerdown", at(0));
      firePointer(knob, "pointermove", at(90));
      firePointer(knob, "pointerup", at(90));
      fireEvent.keyDown(knob, { key: "ArrowUp" });

      expect(setBpm).not.toHaveBeenCalled();
      expect(useAppStore.getState().project.bpm).toBe(90);
      setBpm.mockRestore();
    });
  });
});
