// ABOUTME: FeelDisclosure tests — popover open/close + Scratch confirm flow.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { FeelDisclosure } from "./FeelDisclosure";
import { useAppStore } from "../store/useAppStore";

describe("FeelDisclosure", () => {
  beforeEach(() => useAppStore.getState().actions.reset());

  it("opens on click, closes on Escape, and the trigger label reflects live state", () => {
    render(<FeelDisclosure />);
    const trigger = screen.getByLabelText("Feel: cut rate, swing, hold");
    expect(trigger).toHaveTextContent("1/8");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("swing"), { target: { value: "50" } });
    expect(trigger).toHaveTextContent("50%");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Scratch needs a second click to confirm; Cancel keeps state", () => {
    useAppStore.getState().actions.setBpm(140);
    render(<FeelDisclosure />);
    fireEvent.click(screen.getByLabelText("Feel: cut rate, swing, hold"));
    fireEvent.click(screen.getByLabelText("Scratch: start fresh"));
    fireEvent.click(screen.getByLabelText("Cancel scratch"));
    expect(useAppStore.getState().project.bpm).toBe(140);
    fireEvent.click(screen.getByLabelText("Scratch: start fresh"));
    fireEvent.click(screen.getByLabelText("Confirm scratch"));
    expect(useAppStore.getState().project.bpm).toBe(90);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
