// ABOUTME: CutSubdivisionSelect tests — initial value, change updates store.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { CutSubdivisionSelect } from "./CutSubdivisionSelect";
import { useAppStore } from "../store/useAppStore";

describe("CutSubdivisionSelect", () => {
  beforeEach(() => {
    useAppStore.getState().actions.reset();
  });

  it("renders with the default '8n' value", () => {
    render(<CutSubdivisionSelect />);
    const select = screen.getByLabelText("cut rate") as HTMLSelectElement;
    expect(select.value).toBe("8n");
  });

  it("changing the dropdown updates the store", () => {
    render(<CutSubdivisionSelect />);
    fireEvent.change(screen.getByLabelText("cut rate"), { target: { value: "4n" } });
    expect(useAppStore.getState().project.cutSubdivision).toBe("4n");
  });
});
