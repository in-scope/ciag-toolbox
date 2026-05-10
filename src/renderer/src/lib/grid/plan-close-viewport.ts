import {
  getCollapsedGridLayoutAfterClose,
  getGridLayoutCellCount,
  type GridLayout,
} from "./grid-layout";

export interface PlanCloseViewportInput {
  readonly currentLayout: GridLayout;
  readonly closedIndex: number;
  readonly closedIndexWasOnlySelection: boolean;
}

export interface PlanCloseViewportResult {
  readonly collapsedLayout: GridLayout | null;
  readonly fallbackSelectionIndex: number | null;
}

export function planCloseViewport(
  input: PlanCloseViewportInput,
): PlanCloseViewportResult {
  const collapsedLayout = getCollapsedGridLayoutAfterClose(input.currentLayout);
  if (collapsedLayout === null) {
    return { collapsedLayout: null, fallbackSelectionIndex: null };
  }
  return {
    collapsedLayout,
    fallbackSelectionIndex: pickFallbackSelectionIndexOrNull(input, collapsedLayout),
  };
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
