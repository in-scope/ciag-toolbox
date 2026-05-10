import { describe, expect, it } from "vitest";

import {
  SELECTABLE_GRID_LAYOUTS,
  getCollapsedGridLayoutAfterClose,
  getGridLayoutCellCount,
  getGridLayoutTailwindTrackClasses,
  getNextLargerGridLayout,
} from "./grid-layout";

describe("SELECTABLE_GRID_LAYOUTS", () => {
  it("includes the new 1x3 and 3x1 layouts", () => {
    expect(SELECTABLE_GRID_LAYOUTS).toContain("1x3");
    expect(SELECTABLE_GRID_LAYOUTS).toContain("3x1");
  });
});

describe("getGridLayoutCellCount", () => {
  it("returns three cells for 1x3", () => {
    expect(getGridLayoutCellCount("1x3")).toBe(3);
  });

  it("returns three cells for 3x1", () => {
    expect(getGridLayoutCellCount("3x1")).toBe(3);
  });
});

describe("getGridLayoutTailwindTrackClasses", () => {
  it("places three columns on a single row for 1x3", () => {
    expect(getGridLayoutTailwindTrackClasses("1x3")).toBe(
      "grid-cols-3 grid-rows-1",
    );
  });

  it("places three rows on a single column for 3x1", () => {
    expect(getGridLayoutTailwindTrackClasses("3x1")).toBe(
      "grid-cols-1 grid-rows-3",
    );
  });
});

describe("getNextLargerGridLayout", () => {
  it("steps from 1x2 into 1x3 so the duplicate-and-grow flow lands on 1x3", () => {
    expect(getNextLargerGridLayout("1x2")).toBe("1x3");
  });

  it("steps from 2x1 into 3x1 so the duplicate-and-grow flow lands on 3x1", () => {
    expect(getNextLargerGridLayout("2x1")).toBe("3x1");
  });

  it("steps from 1x3 into 2x2", () => {
    expect(getNextLargerGridLayout("1x3")).toBe("2x2");
  });

  it("steps from 3x1 into 3x2", () => {
    expect(getNextLargerGridLayout("3x1")).toBe("3x2");
  });

  it("keeps 1x1 -> 1x2 unchanged", () => {
    expect(getNextLargerGridLayout("1x1")).toBe("1x2");
  });

  it("keeps 2x2 -> 2x3 unchanged", () => {
    expect(getNextLargerGridLayout("2x2")).toBe("2x3");
  });

  it("returns null at the maximum 2x3 and 3x2 layouts", () => {
    expect(getNextLargerGridLayout("2x3")).toBeNull();
    expect(getNextLargerGridLayout("3x2")).toBeNull();
  });
});

describe("getCollapsedGridLayoutAfterClose", () => {
  it("collapses 2x1 to 1x1", () => {
    expect(getCollapsedGridLayoutAfterClose("2x1")).toBe("1x1");
  });

  it("collapses 1x2 to 1x1", () => {
    expect(getCollapsedGridLayoutAfterClose("1x2")).toBe("1x1");
  });

  it("collapses 2x2 to 1x3", () => {
    expect(getCollapsedGridLayoutAfterClose("2x2")).toBe("1x3");
  });

  it("collapses 1x3 to 1x2", () => {
    expect(getCollapsedGridLayoutAfterClose("1x3")).toBe("1x2");
  });

  it("collapses 3x1 to 2x1", () => {
    expect(getCollapsedGridLayoutAfterClose("3x1")).toBe("2x1");
  });

  it("returns null for 1x1 (no further collapse)", () => {
    expect(getCollapsedGridLayoutAfterClose("1x1")).toBeNull();
  });

  it("returns null for 2x3 (layout stays)", () => {
    expect(getCollapsedGridLayoutAfterClose("2x3")).toBeNull();
  });

  it("returns null for 3x2 (layout stays)", () => {
    expect(getCollapsedGridLayoutAfterClose("3x2")).toBeNull();
  });
});
