import { describe, expect, it } from "vitest";

import type { ApplyActionFlowBindings } from "@/lib/actions/apply-action-flow";
import type { GridLayout } from "@/lib/grid/grid-layout";

import { canPlaceKeptProjectionInAFreePanel } from "./rop-keep-flow";

function bindingsWith(
  gridLayout: GridLayout,
  cellCount: number,
  occupiedIndexes: number[],
  reservedIndexes: number[] = [],
): ApplyActionFlowBindings {
  return {
    gridLayout,
    cellCount,
    imagesByIndex: new Map(occupiedIndexes.map((index) => [index, { marker: index }])),
    inFlightApplyRuns: {
      listReservedResultTargetIndexes: () => new Set(reservedIndexes),
    },
  } as unknown as ApplyActionFlowBindings;
}

describe("canPlaceKeptProjectionInAFreePanel", () => {
  it("allows the keep while an empty panel exists", () => {
    expect(canPlaceKeptProjectionInAFreePanel(bindingsWith("1x2", 2, [0]))).toBe(true);
  });

  it("allows the keep when the grid can still expand", () => {
    expect(canPlaceKeptProjectionInAFreePanel(bindingsWith("1x1", 1, [0]))).toBe(true);
  });

  it("refuses when every panel is full and the grid is at its largest", () => {
    expect(
      canPlaceKeptProjectionInAFreePanel(bindingsWith("3x2", 6, [0, 1, 2, 3, 4, 5])),
    ).toBe(false);
  });

  it("treats a panel reserved by an in-flight apply as occupied", () => {
    expect(
      canPlaceKeptProjectionInAFreePanel(bindingsWith("3x2", 6, [0, 1, 2, 3, 4], [5])),
    ).toBe(false);
  });
});
