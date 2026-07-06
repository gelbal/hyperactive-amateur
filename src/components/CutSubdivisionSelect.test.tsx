// ABOUTME: CutSubdivisionSelect tests — pin the cut-rate select's touch target contract.
// ABOUTME: Coarse-pointer users get a 44px control without changing the fine-pointer layout.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CutSubdivisionSelect } from "./CutSubdivisionSelect";

describe("CutSubdivisionSelect", () => {
  it("sizes the select to 44px on coarse pointers", () => {
    render(<CutSubdivisionSelect />);

    expect(screen.getByLabelText("cut rate")).toHaveClass(
      "pointer-coarse:min-h-11",
    );
  });
});
