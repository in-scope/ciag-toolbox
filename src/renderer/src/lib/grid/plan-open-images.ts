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
  | { readonly kind: "promptReplace"; readonly overflow: number };

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
  return planGrowOrPromptReplace(input, existingEmpty);
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
  existingEmpty: ReadonlyArray<number>,
): OpenImagesPlacementPlan {
  const smallestLayoutThatFits = findSmallestExpandedLayoutThatFitsAll(input);
  if (smallestLayoutThatFits === null) {
    return buildPromptReplacePlan(input, existingEmpty);
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

function buildPromptReplacePlan(
  input: PlanOpenImagesPlacementInput,
  existingEmpty: ReadonlyArray<number>,
): OpenImagesPlacementPlan {
  const maxFitInChain = computeMaxFitInExpansionChain(input);
  const overflow = input.newItemCount - Math.max(maxFitInChain, existingEmpty.length);
  return { kind: "promptReplace", overflow: Math.max(0, overflow) };
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

function computeMaxFitInExpansionChain(input: PlanOpenImagesPlacementInput): number {
  let layout: GridLayout | null = input.currentLayout;
  let best = 0;
  while (layout !== null) {
    const empties = countEmptyCellsUnderLayout(input.imagesByIndex, layout);
    if (empties > best) best = empties;
    layout = getNextLargerGridLayout(layout);
  }
  return best;
}
