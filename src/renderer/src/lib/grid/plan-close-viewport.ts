import {
  getCollapsedGridLayoutAfterClose,
  getGridLayoutCellCount,
  type GridLayout,
} from "./grid-layout";

export interface PlanCloseViewportInput {
  readonly currentLayout: GridLayout;
  readonly closedIndex: number;
  readonly closedIndexWasOnlySelection: boolean;
  readonly populatedCellCountBeforeClose: number;
}

export interface PlanCloseViewportResult {
  readonly collapsedLayout: GridLayout | null;
  readonly fallbackSelectionIndex: number | null;
}

export function planCloseViewport(
  input: PlanCloseViewportInput,
): PlanCloseViewportResult {
  const collapsedLayout = pickCollapsedLayoutThatPreservesAllRemainingImages(input);
  if (collapsedLayout === null) {
    return { collapsedLayout: null, fallbackSelectionIndex: null };
  }
  return {
    collapsedLayout,
    fallbackSelectionIndex: pickFallbackSelectionIndexOrNull(input, collapsedLayout),
  };
}

function pickCollapsedLayoutThatPreservesAllRemainingImages(
  input: PlanCloseViewportInput,
): GridLayout | null {
  const candidate = getCollapsedGridLayoutAfterClose(input.currentLayout);
  if (candidate === null) return null;
  const remainingImagesAfterClose = input.populatedCellCountBeforeClose - 1;
  if (remainingImagesAfterClose > getGridLayoutCellCount(candidate)) return null;
  return candidate;
}

function pickFallbackSelectionIndexOrNull(
  input: PlanCloseViewportInput,
  collapsedLayout: GridLayout,
): number | null {
  if (!input.closedIndexWasOnlySelection) return null;
  const newCellCount = getGridLayoutCellCount(collapsedLayout);
  if (newCellCount === 0) return null;
  return Math.min(input.closedIndex, newCellCount - 1);
}
