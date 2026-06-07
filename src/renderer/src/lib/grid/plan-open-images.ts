import {
  getGridLayoutCellCount,
  getNextLargerGridLayout,
  type GridLayout,
} from "./grid-layout";

export interface PlanOpenImagesPlacementInput {
  readonly currentLayout: GridLayout;
  readonly imagesByIndex: ReadonlyMap<number, unknown>;
  readonly newItemCount: number;
}

export type OpenImagesPlacementPlan =
  | {
      readonly kind: "placeInExistingEmptyCellsAndGrow";
      readonly expandedLayout?: GridLayout;
      readonly targetIndices: ReadonlyArray<number>;
    }
  | {
      readonly kind: "growFillThenPromptReplace";
      readonly expandedLayout?: GridLayout;
      readonly filledTargetIndices: ReadonlyArray<number>;
      readonly overflowItemCount: number;
    };

export function planOpenImagesPlacement(
  input: PlanOpenImagesPlacementInput,
): OpenImagesPlacementPlan {
  if (input.newItemCount <= 0) {
    return { kind: "placeInExistingEmptyCellsAndGrow", targetIndices: [] };
  }
  const existingEmpty = listEmptyCellIndicesInCurrentLayout(
    input.imagesByIndex,
    input.currentLayout,
  );
  if (existingEmpty.length >= input.newItemCount) {
    return buildPlanUsingExistingEmpties(existingEmpty, input.newItemCount);
  }
  return planGrowOrPromptReplace(input);
}

function buildPlanUsingExistingEmpties(
  existingEmpty: ReadonlyArray<number>,
  newItemCount: number,
): OpenImagesPlacementPlan {
  return {
    kind: "placeInExistingEmptyCellsAndGrow",
    targetIndices: existingEmpty.slice(0, newItemCount),
  };
}

function planGrowOrPromptReplace(
  input: PlanOpenImagesPlacementInput,
): OpenImagesPlacementPlan {
  const smallestLayoutThatFits = findSmallestExpandedLayoutThatFitsAll(input);
  if (smallestLayoutThatFits === null) {
    return buildGrowFillThenPromptReplacePlan(input);
  }
  const targetIndices = collectTargetIndicesUnderLayout(
    input.imagesByIndex,
    smallestLayoutThatFits,
    input.newItemCount,
  );
  if (smallestLayoutThatFits === input.currentLayout) {
    return { kind: "placeInExistingEmptyCellsAndGrow", targetIndices };
  }
  return {
    kind: "placeInExistingEmptyCellsAndGrow",
    expandedLayout: smallestLayoutThatFits,
    targetIndices,
  };
}

function buildGrowFillThenPromptReplacePlan(
  input: PlanOpenImagesPlacementInput,
): OpenImagesPlacementPlan {
  const largestLayout = findLargestReachableLayout(input.currentLayout);
  const filledTargetIndices = collectTargetIndicesUnderLayout(
    input.imagesByIndex,
    largestLayout,
    input.newItemCount,
  );
  return {
    kind: "growFillThenPromptReplace",
    expandedLayout: largestLayout === input.currentLayout ? undefined : largestLayout,
    filledTargetIndices,
    overflowItemCount: input.newItemCount - filledTargetIndices.length,
  };
}

function findLargestReachableLayout(currentLayout: GridLayout): GridLayout {
  let layout = currentLayout;
  let next = getNextLargerGridLayout(layout);
  while (next !== null) {
    layout = next;
    next = getNextLargerGridLayout(layout);
  }
  return layout;
}

function listEmptyCellIndicesInCurrentLayout(
  imagesByIndex: ReadonlyMap<number, unknown>,
  layout: GridLayout,
): ReadonlyArray<number> {
  const cellCount = getGridLayoutCellCount(layout);
  return listEmptyCellIndicesUnderCellCount(imagesByIndex, cellCount);
}

function listEmptyCellIndicesUnderCellCount(
  imagesByIndex: ReadonlyMap<number, unknown>,
  cellCount: number,
): ReadonlyArray<number> {
  const empties: number[] = [];
  for (let index = 0; index < cellCount; index++) {
    if (!imagesByIndex.has(index)) empties.push(index);
  }
  return empties;
}

function findSmallestExpandedLayoutThatFitsAll(
  input: PlanOpenImagesPlacementInput,
): GridLayout | null {
  let layout: GridLayout | null = input.currentLayout;
  while (layout !== null) {
    if (countEmptyCellsUnderLayout(input.imagesByIndex, layout) >= input.newItemCount) {
      return layout;
    }
    layout = getNextLargerGridLayout(layout);
  }
  return null;
}

function countEmptyCellsUnderLayout(
  imagesByIndex: ReadonlyMap<number, unknown>,
  layout: GridLayout,
): number {
  return listEmptyCellIndicesUnderCellCount(imagesByIndex, getGridLayoutCellCount(layout)).length;
}

function collectTargetIndicesUnderLayout(
  imagesByIndex: ReadonlyMap<number, unknown>,
  layout: GridLayout,
  newItemCount: number,
): ReadonlyArray<number> {
  const empties = listEmptyCellIndicesUnderCellCount(
    imagesByIndex,
    getGridLayoutCellCount(layout),
  );
  return empties.slice(0, newItemCount);
}
