import { describe, expect, it } from "vitest";

import { planOpenImagesPlacement } from "./plan-open-images";

function buildOccupiedImagesMapForIndices(
  indices: ReadonlyArray<number>,
): ReadonlyMap<number, unknown> {
  const map = new Map<number, unknown>();
  for (const index of indices) map.set(index, {});
  return map;
}

describe("planOpenImagesPlacement", () => {
  it("returns empty target list when no items are pending", () => {
    const result = planOpenImagesPlacement({
      currentLayout: "1x1",
      imagesByIndex: new Map(),
      newItemCount: 0,
    });
    expect(result).toEqual({
      kind: "placeInExistingEmptyCellsAndGrow",
      targetIndices: [],
    });
  });

  it("places a single new item into the only empty cell of an empty 1x1 grid (N=1 parity)", () => {
    const result = planOpenImagesPlacement({
      currentLayout: "1x1",
      imagesByIndex: new Map(),
      newItemCount: 1,
    });
    expect(result).toEqual({
      kind: "placeInExistingEmptyCellsAndGrow",
      targetIndices: [0],
    });
  });

  it("places 2 items in existing empty cells when both cells fit without growing", () => {
    const result = planOpenImagesPlacement({
      currentLayout: "1x2",
      imagesByIndex: new Map(),
      newItemCount: 2,
    });
    expect(result).toEqual({
      kind: "placeInExistingEmptyCellsAndGrow",
      targetIndices: [0, 1],
    });
  });

  it("grows from 1x1 to 1x3 (smallest fit) when one cell is occupied and two new items arrive", () => {
    const result = planOpenImagesPlacement({
      currentLayout: "1x1",
      imagesByIndex: buildOccupiedImagesMapForIndices([0]),
      newItemCount: 2,
    });
    expect(result).toEqual({
      kind: "placeInExistingEmptyCellsAndGrow",
      expandedLayout: "1x3",
      targetIndices: [1, 2],
    });
  });

  it("grows to the largest layout, fills every cell, and prompts to replace for the remaining 4 of 10 items", () => {
    const result = planOpenImagesPlacement({
      currentLayout: "1x1",
      imagesByIndex: new Map(),
      newItemCount: 10,
    });
    expect(result).toEqual({
      kind: "growFillThenPromptReplace",
      expandedLayout: "2x3",
      filledTargetIndices: [0, 1, 2, 3, 4, 5],
      overflowItemCount: 4,
    });
  });

  it("prompts to replace with no grid growth and no auto-fill when the grid is already full at max (CT-059)", () => {
    const occupied = buildOccupiedImagesMapForIndices([0, 1, 2, 3, 4, 5]);
    const result = planOpenImagesPlacement({
      currentLayout: "2x3",
      imagesByIndex: occupied,
      newItemCount: 1,
    });
    expect(result).toEqual({
      kind: "growFillThenPromptReplace",
      expandedLayout: undefined,
      filledTargetIndices: [],
      overflowItemCount: 1,
    });
  });

  it("grows the grid and fills the empty cells before prompting when 8 items arrive into a near-empty grid (CT-059 repro)", () => {
    const occupied = buildOccupiedImagesMapForIndices([0]);
    const result = planOpenImagesPlacement({
      currentLayout: "1x1",
      imagesByIndex: occupied,
      newItemCount: 8,
    });
    expect(result).toEqual({
      kind: "growFillThenPromptReplace",
      expandedLayout: "2x3",
      filledTargetIndices: [1, 2, 3, 4, 5],
      overflowItemCount: 3,
    });
  });

  it("exact-fit boundary: when 6 cells are needed and grid grows to 2x3, all 6 indices are returned", () => {
    const result = planOpenImagesPlacement({
      currentLayout: "1x1",
      imagesByIndex: new Map(),
      newItemCount: 6,
    });
    expect(result.kind).toBe("placeInExistingEmptyCellsAndGrow");
    if (result.kind === "placeInExistingEmptyCellsAndGrow") {
      expect(result.targetIndices).toEqual([0, 1, 2, 3, 4, 5]);
      expect(result.expandedLayout).toBe("2x3");
    }
  });

  it("preserves existing-empty placement without growing when current layout has enough room", () => {
    const occupied = buildOccupiedImagesMapForIndices([0]);
    const result = planOpenImagesPlacement({
      currentLayout: "2x3",
      imagesByIndex: occupied,
      newItemCount: 3,
    });
    expect(result).toEqual({
      kind: "placeInExistingEmptyCellsAndGrow",
      targetIndices: [1, 2, 3],
    });
  });

  it("returns mid-grid empty indices when gaps exist (skips occupied middle cell)", () => {
    const map = new Map<number, unknown>();
    map.set(0, {});
    map.set(2, {});
    const result = planOpenImagesPlacement({
      currentLayout: "1x3",
      imagesByIndex: map,
      newItemCount: 1,
    });
    expect(result).toEqual({
      kind: "placeInExistingEmptyCellsAndGrow",
      targetIndices: [1],
    });
  });
});
