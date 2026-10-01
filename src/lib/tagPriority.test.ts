// ABOUTME: tagPriority tests — the visual tier table shared by the cut engine and the cover.
// ABOUTME: Pins the tier order so cover ranking and cut decisions cannot drift apart.
import { describe, it, expect } from "vitest";
import { TAG_PRIORITY, tagTier } from "./tagPriority";

describe("tagTier", () => {
  it("ranks vocal over fx over snare over kick over hat, untagged last", () => {
    expect(tagTier("vocal")).toBe(5);
    expect(tagTier("fx")).toBe(4);
    expect(tagTier("snare")).toBe(3);
    expect(tagTier("kick")).toBe(2);
    expect(tagTier("hat")).toBe(1);
    expect(tagTier(null)).toBe(0);
  });

  it("reads the same table the engine uses", () => {
    expect(TAG_PRIORITY.untagged).toBe(tagTier(null));
  });
});
