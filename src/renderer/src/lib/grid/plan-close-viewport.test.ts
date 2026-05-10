import { describe, expect, it } from "vitest";

import { planCloseViewport } from "./plan-close-viewport";

describe("planCloseViewport", () => {
  it("collapses 2x2 down to 1x3", () => {
    const result = planCloseViewport({
      currentLayout: "2x2",
      closedIndex: 1,
      closedIndexWasOnlySelection: false,
    });
    expect(result.collapsedLayout).toBe("1x3");
    expect(result.fallbackSelectionIndex).toBeNull();
  });

  it("collapses 1x3 down to 1x2", () => {
    const result = planCloseViewport({
      currentLayout: "1x3",
      closedIndex: 2,
      closedIndexWasOnlySelection: false,
    });
    expect(result.collapsedLayout).toBe("1x2");
  });

  it("collapses 3x1 down to 2x1", () => {
    const result = planCloseViewport({
      currentLayout: "3x1",
      closedIndex: 0,
      closedIndexWasOnlySelection: false,
    });
    expect(result.collapsedLayout).toBe("2x1");
  });

  it("collapses 2x1 down to 1x1", () => {
    const result = planCloseViewport({
      currentLayout: "2x1",
      closedIndex: 0,
      closedIndexWasOnlySelection: false,
    });
    expect(result.collapsedLayout).toBe("1x1");
  });

  it("collapses 1x2 down to 1x1", () => {
    const result = planCloseViewport({
      currentLayout: "1x2",
      closedIndex: 1,
      closedIndexWasOnlySelection: false,
    });
    expect(result.collapsedLayout).toBe("1x1");
  });

  it("returns no collapse for 1x1 since there is no smaller layout", () => {
    const result = planCloseViewport({
      currentLayout: "1x1",
      closedIndex: 0,
      closedIndexWasOnlySelection: true,
    });
    expect(result.collapsedLayout).toBeNull();
    expect(result.fallbackSelectionIndex).toBeNull();
  });

  it("returns no collapse for 2x3 since it stays at 2x3", () => {
    const result = planCloseViewport({
      currentLayout: "2x3",
      closedIndex: 4,
      closedIndexWasOnlySelection: true,
    });
    expect(result.collapsedLayout).toBeNull();
    expect(result.fallbackSelectionIndex).toBeNull();
  });

  it("returns no collapse for 3x2 since it stays at 3x2", () => {
    const result = planCloseViewport({
      currentLayout: "3x2",
      closedIndex: 5,
      closedIndexWasOnlySelection: true,
    });
    expect(result.collapsedLayout).toBeNull();
    expect(result.fallbackSelectionIndex).toBeNull();
  });

  it("falls back to the closed index when it remains valid in the smaller layout", () => {
    const result = planCloseViewport({
      currentLayout: "2x2",
      closedIndex: 1,
      closedIndexWasOnlySelection: true,
    });
    expect(result.collapsedLayout).toBe("1x3");
    expect(result.fallbackSelectionIndex).toBe(1);
  });

  it("clamps the fallback selection to the last valid index when the closed index falls off the new layout", () => {
    const result = planCloseViewport({
      currentLayout: "2x2",
      closedIndex: 3,
      closedIndexWasOnlySelection: true,
    });
    expect(result.collapsedLayout).toBe("1x3");
    expect(result.fallbackSelectionIndex).toBe(2);
  });

  it("clamps fallback to 0 when the closed index was the only viewport in 2x1", () => {
    const result = planCloseViewport({
      currentLayout: "2x1",
      closedIndex: 1,
      closedIndexWasOnlySelection: true,
    });
    expect(result.collapsedLayout).toBe("1x1");
    expect(result.fallbackSelectionIndex).toBe(0);
  });

  it("does not propose a fallback when more than one viewport was selected", () => {
    const result = planCloseViewport({
      currentLayout: "2x2",
      closedIndex: 1,
      closedIndexWasOnlySelection: false,
    });
    expect(result.collapsedLayout).toBe("1x3");
    expect(result.fallbackSelectionIndex).toBeNull();
  });
});
