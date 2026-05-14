import { describe, expect, it } from "vitest";

import { planOpenImagePlacement } from "./plan-open-image";

function buildOccupiedImagesMapForCellCount(cellCount: number): ReadonlyMap<number, unknown> {
  const map = new Map<number, unknown>();
  for (let index = 0; index < cellCount; index++) map.set(index, {});
  return map;
}

describe("planOpenImagePlacement", () => {
  it("places into the only empty cell when the grid is empty", () => {
    const result = planOpenImagePlacement({
      currentLayout: "1x1",
      imagesByIndex: new Map(),
    });
    expect(result).toEqual({ kind: "placeInExistingEmptyCell", targetIndex: 0 });
  });

  it("grows 1x1 to 1x2 and places at index 1 when the only cell is occupied", () => {
    const result = planOpenImagePlacement({
      currentLayout: "1x1",
      imagesByIndex: buildOccupiedImagesMapForCellCount(1),
    });
    expect(result).toEqual({
      kind: "growGridAndPlace",
      expandedLayout: "1x2",
      targetIndex: 1,
    });
  });

  it("grows 1x2 to 1x3 and places at index 2 when both cells are occupied", () => {
    const result = planOpenImagePlacement({
      currentLayout: "1x2",
      imagesByIndex: buildOccupiedImagesMapForCellCount(2),
    });
    expect(result).toEqual({
      kind: "growGridAndPlace",
      expandedLayout: "1x3",
      targetIndex: 2,
    });
  });

  it("grows 2x1 to 3x1 and places at index 2 when both cells are occupied", () => {
    const result = planOpenImagePlacement({
      currentLayout: "2x1",
      imagesByIndex: buildOccupiedImagesMapForCellCount(2),
    });
    expect(result).toEqual({
      kind: "growGridAndPlace",
      expandedLayout: "3x1",
      targetIndex: 2,
    });
  });

  it("grows 1x3 to 2x2 and places at index 3 when all three cells are occupied", () => {
    const result = planOpenImagePlacement({
      currentLayout: "1x3",
      imagesByIndex: buildOccupiedImagesMapForCellCount(3),
    });
    expect(result).toEqual({
      kind: "growGridAndPlace",
      expandedLayout: "2x2",
      targetIndex: 3,
    });
  });

  it("grows 3x1 to 3x2 and places at index 3 when all three cells are occupied", () => {
    const result = planOpenImagePlacement({
      currentLayout: "3x1",
      imagesByIndex: buildOccupiedImagesMapForCellCount(3),
    });
    expect(result).toEqual({
      kind: "growGridAndPlace",
      expandedLayout: "3x2",
      targetIndex: 3,
    });
  });

  it("grows 2x2 to 2x3 and places at index 4 when all four cells are occupied", () => {
    const result = planOpenImagePlacement({
      currentLayout: "2x2",
      imagesByIndex: buildOccupiedImagesMapForCellCount(4),
    });
    expect(result).toEqual({
      kind: "growGridAndPlace",
      expandedLayout: "2x3",
      targetIndex: 4,
    });
  });

  it("prompts for replacement when 2x3 is full", () => {
    const result = planOpenImagePlacement({
      currentLayout: "2x3",
      imagesByIndex: buildOccupiedImagesMapForCellCount(6),
    });
    expect(result).toEqual({ kind: "promptReplace" });
  });

  it("prompts for replacement when 3x2 is full", () => {
    const result = planOpenImagePlacement({
      currentLayout: "3x2",
      imagesByIndex: buildOccupiedImagesMapForCellCount(6),
    });
    expect(result).toEqual({ kind: "promptReplace" });
  });

  it("places into an existing empty cell at maximum layout 2x3 instead of prompting", () => {
    const map = new Map<number, unknown>();
    for (const index of [0, 1, 2, 3, 4]) map.set(index, {});
    const result = planOpenImagePlacement({
      currentLayout: "2x3",
      imagesByIndex: map,
    });
    expect(result).toEqual({ kind: "placeInExistingEmptyCell", targetIndex: 5 });
  });

  it("places into an existing empty cell at maximum layout 3x2 instead of prompting", () => {
    const map = new Map<number, unknown>();
    for (const index of [0, 1, 3, 4, 5]) map.set(index, {});
    const result = planOpenImagePlacement({
      currentLayout: "3x2",
      imagesByIndex: map,
    });
    expect(result).toEqual({ kind: "placeInExistingEmptyCell", targetIndex: 2 });
  });

  it("picks the lowest-index empty cell when multiple cells are empty", () => {
    const map = new Map<number, unknown>();
    map.set(1, {});
    const result = planOpenImagePlacement({
      currentLayout: "2x2",
      imagesByIndex: map,
    });
    expect(result).toEqual({ kind: "placeInExistingEmptyCell", targetIndex: 0 });
  });

  it("places into an existing empty cell mid-grid (gap left from a closed viewport) without growing", () => {
    const map = new Map<number, unknown>();
    map.set(0, {});
    map.set(2, {});
    const result = planOpenImagePlacement({
      currentLayout: "1x3",
      imagesByIndex: map,
    });
    expect(result).toEqual({ kind: "placeInExistingEmptyCell", targetIndex: 1 });
  });
});
