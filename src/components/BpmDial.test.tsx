// ABOUTME: BpmDial tests — pointer-event drag updates BPM; arrow keys still step; cancel reverts.
// ABOUTME: jsdom's PointerEvent ignores clientY in its init, so we build the event by hand.
import { render, screen, fireEvent, createEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { BpmDial } from "./BpmDial";
import { useAppStore } from "../store/useAppStore";

function firePointer(
  knob: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: { pointerId?: number; clientY?: number },
): void {
  const event = createEvent[type === "pointerdown" ? "pointerDown" :
    type === "pointermove" ? "pointerMove" :
    type === "pointerup" ? "pointerUp" : "pointerCancel"](knob, {
    pointerId: init.pointerId ?? 1,
  });
  if (init.clientY !== undefined) {
    Object.defineProperty(event, "clientY", { value: init.clientY });
  }
  fireEvent(knob, event);
}

describe("BpmDial", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
    // jsdom doesn't implement pointer capture — stub it so onPointerDown
    // doesn't throw.
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
  });

  it("pointer drag up by one stop (16px) bumps BPM to the next stop", () => {
    useAppStore.getState().actions.setBpm(90);
    render(<BpmDial />);
    const knob = screen.getByRole("slider");
    firePointer(knob, "pointerdown", { clientY: 200 });
    firePointer(knob, "pointermove", { clientY: 184 });
    firePointer(knob, "pointerup", { clientY: 184 });
    expect(useAppStore.getState().project.bpm).toBe(100);
  });

  it("pointer-cancel mid-drag does not change BPM", () => {
    useAppStore.getState().actions.setBpm(90);
    render(<BpmDial />);
    const knob = screen.getByRole("slider");
    firePointer(knob, "pointerdown", { clientY: 200 });
    firePointer(knob, "pointercancel", {});
    // A subsequent move must not be honored (dragRef cleared).
    firePointer(knob, "pointermove", { clientY: 100 });
    expect(useAppStore.getState().project.bpm).toBe(90);
  });

  it("ArrowUp still increments by one stop", () => {
    useAppStore.getState().actions.setBpm(90);
    render(<BpmDial />);
    const knob = screen.getByRole("slider");
    fireEvent.keyDown(knob, { key: "ArrowUp" });
    expect(useAppStore.getState().project.bpm).toBe(100);
  });
});
