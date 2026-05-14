import {
  getGridLayoutCellCount,
  getNextLargerGridLayout,
  type GridLayout,
} from "./grid-layout";

export interface PlanOpenImagePlacementInput {
  readonly currentLayout: GridLayout;
  readonly imagesByIndex: ReadonlyMap<number, unknown>;
}

export type OpenImagePlacementPlan =
  | { readonly kind: "placeInExistingEmptyCell"; readonly targetIndex: number }
  | {
      readonly kind: "growGridAndPlace";
      readonly expandedLayout: GridLayout;
      readonly targetIndex: number;
    }
  | { readonly kind: "promptReplace" };

export function planOpenImagePlacement(
  input: PlanOpenImagePlacementInput,
): OpenImagePlacementPlan {
  const cellCount = getGridLayoutCellCount(input.currentLayout);
  const emptyIndex = findLowestIndexEmptyCellOrNull(input.imagesByIndex, cellCount);
  if (emptyIndex !== null) {
    return { kind: "placeInExistingEmptyCell", targetIndex: emptyIndex };
  }
  const expandedLayout = getNextLargerGridLayout(input.currentLayout);
  if (expandedLayout === null) {
    return { kind: "promptReplace" };
  }
  return { kind: "growGridAndPlace", expandedLayout, targetIndex: cellCount };
}

function findLowestIndexEmptyCellOrNull(
  imagesByIndex: ReadonlyMap<number, unknown>,
  cellCount: number,
): number | null {
  for (let index = 0; index < cellCount; index++) {
    if (!imagesByIndex.has(index)) return index;
  }
  return null;
}
