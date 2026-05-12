// ABOUTME: FeelDisclosure test — Scratch is a destructive action; it must take a second click to confirm.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { FeelDisclosure } from "./FeelDisclosure";
import { useAppStore } from "../store/useAppStore";

describe("FeelDisclosure", () => {
  beforeEach(() => useAppStore.getState().actions.reset());

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
