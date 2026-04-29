import { describe, expect, it } from "vitest";

import {
  computeInitialPickerTargetsFromSelection,
  makeAllViewportsPickerTargets,
  togglePickerTargetAtIndex,
} from "./picker-targets";

describe("computeInitialPickerTargetsFromSelection", () => {
  it("returns an empty set when nothing is selected", () => {
    const targets = computeInitialPickerTargetsFromSelection(new Set(), 4);
    expect(Array.from(targets)).toEqual([]);
  });

  it("returns the selected indices that still exist in the current grid", () => {
    const targets = computeInitialPickerTargetsFromSelection(new Set([0, 2, 5]), 4);
    expect(Array.from(targets).sort()).toEqual([0, 2]);
  });

  it("ignores negative indices defensively", () => {
    const targets = computeInitialPickerTargetsFromSelection(new Set([-1, 1]), 4);
    expect(Array.from(targets)).toEqual([1]);
  });
});

describe("makeAllViewportsPickerTargets", () => {
  it("returns the full row-major range for the cell count", () => {
    expect(Array.from(makeAllViewportsPickerTargets(4))).toEqual([0, 1, 2, 3]);
  });

  it("returns an empty set when there are no cells", () => {
    expect(Array.from(makeAllViewportsPickerTargets(0))).toEqual([]);
  });
});

describe("togglePickerTargetAtIndex", () => {
  it("adds the index when it is not present", () => {
    const next = togglePickerTargetAtIndex(new Set([0]), 2);
    expect(Array.from(next).sort()).toEqual([0, 2]);
  });

  it("removes the index when it is present", () => {
    const next = togglePickerTargetAtIndex(new Set([0, 2]), 2);
    expect(Array.from(next)).toEqual([0]);
  });
});
