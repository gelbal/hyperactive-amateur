// ABOUTME: BpmInput tests — initial value, change-to-update-store, clamp via store, blur revert.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { BpmInput } from "./BpmInput";
import { useAppStore } from "../store/useAppStore";

describe("BpmInput", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
  });

  it("renders with the current store BPM", () => {
    render(<BpmInput />);
    const input = screen.getByLabelText("BPM") as HTMLInputElement;
    expect(input.value).toBe("90");
  });

  it("typing a new value updates the store", () => {
    render(<BpmInput />);
    const input = screen.getByLabelText("BPM");
    fireEvent.change(input, { target: { value: "120" } });
    expect(useAppStore.getState().project.bpm).toBe(120);
  });

  it("an out-of-range value is clamped via the store", () => {
    render(<BpmInput />);
    const input = screen.getByLabelText("BPM");
    fireEvent.change(input, { target: { value: "500" } });
    expect(useAppStore.getState().project.bpm).toBe(180);
  });

  it("blurring with an empty value reverts to the last valid BPM", () => {
    render(<BpmInput />);
    const input = screen.getByLabelText("BPM") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("100");
  });
});
