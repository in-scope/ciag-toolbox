import { describe, expect, it } from "vitest";

import { planCloseViewport } from "./plan-close-viewport";

describe("planCloseViewport", () => {
  it("collapses 2x2 down to 1x3", () => {
    const result = planCloseViewport({
      currentLayout: "2x2",
      closedIndex: 1,
      closedIndexWasOnlySelection: false,
      populatedCellCountBeforeClose: 4,
    });
    expect(result.collapsedLayout).toBe("1x3");
    expect(result.fallbackSelectionIndex).toBeNull();
  });

  it("collapses 1x3 down to 1x2", () => {
    const result = planCloseViewport({
      currentLayout: "1x3",
      closedIndex: 2,
      closedIndexWasOnlySelection: false,
      populatedCellCountBeforeClose: 3,
    });
    expect(result.collapsedLayout).toBe("1x2");
  });

  it("collapses 3x1 down to 2x1", () => {
    const result = planCloseViewport({
      currentLayout: "3x1",
      closedIndex: 0,
      closedIndexWasOnlySelection: false,
      populatedCellCountBeforeClose: 3,
    });
    expect(result.collapsedLayout).toBe("2x1");
  });

  it("collapses 2x1 down to 1x1", () => {
    const result = planCloseViewport({
      currentLayout: "2x1",
      closedIndex: 0,
      closedIndexWasOnlySelection: false,
      populatedCellCountBeforeClose: 2,
    });
    expect(result.collapsedLayout).toBe("1x1");
  });

  it("collapses 1x2 down to 1x1", () => {
    const result = planCloseViewport({
      currentLayout: "1x2",
      closedIndex: 1,
      closedIndexWasOnlySelection: false,
      populatedCellCountBeforeClose: 2,
    });
    expect(result.collapsedLayout).toBe("1x1");
  });

  it("returns no collapse for 1x1 since there is no smaller layout", () => {
    const result = planCloseViewport({
      currentLayout: "1x1",
      closedIndex: 0,
      closedIndexWasOnlySelection: true,
      populatedCellCountBeforeClose: 1,
    });
    expect(result.collapsedLayout).toBeNull();
    expect(result.fallbackSelectionIndex).toBeNull();
  });

  it("collapses 2x3 down to 2x2 when at most five cells are populated", () => {
    const result = planCloseViewport({
      currentLayout: "2x3",
      closedIndex: 4,
      closedIndexWasOnlySelection: false,
      populatedCellCountBeforeClose: 5,
    });
    expect(result.collapsedLayout).toBe("2x2");
  });

  it("keeps 2x3 when all six cells are populated since collapsing would drop an image", () => {
    const result = planCloseViewport({
      currentLayout: "2x3",
      closedIndex: 4,
      closedIndexWasOnlySelection: true,
      populatedCellCountBeforeClose: 6,
    });
    expect(result.collapsedLayout).toBeNull();
    expect(result.fallbackSelectionIndex).toBeNull();
  });

  it("collapses 3x2 down to 3x1 when at most four cells are populated", () => {
    const result = planCloseViewport({
      currentLayout: "3x2",
      closedIndex: 3,
      closedIndexWasOnlySelection: false,
      populatedCellCountBeforeClose: 4,
    });
    expect(result.collapsedLayout).toBe("3x1");
  });

  it("keeps 3x2 when five or six cells are populated since collapsing would drop an image", () => {
    const result = planCloseViewport({
      currentLayout: "3x2",
      closedIndex: 5,
      closedIndexWasOnlySelection: true,
      populatedCellCountBeforeClose: 5,
    });
    expect(result.collapsedLayout).toBeNull();
    expect(result.fallbackSelectionIndex).toBeNull();
  });

  it("falls back to the closed index when it remains valid in the smaller layout", () => {
    const result = planCloseViewport({
      currentLayout: "2x2",
      closedIndex: 1,
      closedIndexWasOnlySelection: true,
      populatedCellCountBeforeClose: 4,
    });
    expect(result.collapsedLayout).toBe("1x3");
    expect(result.fallbackSelectionIndex).toBe(1);
  });

  it("clamps the fallback selection to the last valid index when the closed index falls off the new layout", () => {
    const result = planCloseViewport({
      currentLayout: "2x2",
      closedIndex: 3,
      closedIndexWasOnlySelection: true,
      populatedCellCountBeforeClose: 4,
    });
    expect(result.collapsedLayout).toBe("1x3");
    expect(result.fallbackSelectionIndex).toBe(2);
  });

  it("clamps fallback to 0 when the closed index was the only viewport in 2x1", () => {
    const result = planCloseViewport({
      currentLayout: "2x1",
      closedIndex: 1,
      closedIndexWasOnlySelection: true,
      populatedCellCountBeforeClose: 2,
    });
    expect(result.collapsedLayout).toBe("1x1");
    expect(result.fallbackSelectionIndex).toBe(0);
  });

  it("does not propose a fallback when more than one viewport was selected", () => {
    const result = planCloseViewport({
      currentLayout: "2x2",
      closedIndex: 1,
      closedIndexWasOnlySelection: false,
      populatedCellCountBeforeClose: 4,
    });
    expect(result.collapsedLayout).toBe("1x3");
    expect(result.fallbackSelectionIndex).toBeNull();
  });
});
