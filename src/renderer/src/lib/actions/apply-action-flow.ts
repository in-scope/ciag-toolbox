import { toast } from "sonner";

import type { ViewportCellContent } from "@/components/viewport-grid";
import type { PendingDuplicateReplace } from "@/components/viewport-duplicate-replace-target-picker";
import type { RegisteredViewportAction } from "@/lib/actions/registered-actions";
import type { ViewportRenderingState } from "@/lib/actions/viewport-action";
import { getNextLargerGridLayout, type GridLayout } from "@/lib/grid/grid-layout";
import { findLowestIndexEmptyViewport } from "@/lib/image/find-empty-viewport";
import {
  placeClonedSourceContentAtIndex,
  type ViewportContentMap,
  type ViewportContentMapUpdater,
} from "@/lib/image/place-cloned-source-content";

export interface ApplyActionFlowBindings {
  gridLayout: GridLayout;
  cellCount: number;
  imagesByIndex: ViewportContentMap;
  setGridLayout: (layout: GridLayout) => void;
  setImagesByIndex: (updater: ViewportContentMapUpdater) => void;
  setPendingDuplicate: (pending: PendingDuplicateReplace | null) => void;
  getRenderingState: (index: number) => ViewportRenderingState;
  setRenderingState: (index: number, next: ViewportRenderingState) => void;
}

export function applyActionInPlaceAtSourceIndex(
  action: RegisteredViewportAction,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  try {
    const previous = bindings.getRenderingState(sourceIndex);
    bindings.setRenderingState(sourceIndex, applyActionAndTagOperationLabel(action, previous));
    toast.success(action.successMessage);
  } catch (error) {
    toast.error(formatActionErrorMessage(action.label, error));
  }
}

function applyActionAndTagOperationLabel(
  action: RegisteredViewportAction,
  previous: ViewportRenderingState,
): ViewportRenderingState {
  return {
    ...action.apply(previous),
    lastAppliedOperationLabel: action.appliedLabel,
  };
}

export function applyActionToDuplicateOfSource(
  action: RegisteredViewportAction,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  const sourceContent = bindings.imagesByIndex.get(sourceIndex);
  if (!sourceContent) return;
  if (tryDuplicateAndApplyInEmptyViewport(action, sourceContent, bindings)) return;
  if (tryDuplicateAndApplyByExpandingGrid(action, sourceContent, bindings)) return;
  bindings.setPendingDuplicate({ sourceIndex, sourceContent, postDuplicateAction: action });
}

function tryDuplicateAndApplyInEmptyViewport(
  action: RegisteredViewportAction,
  sourceContent: ViewportCellContent,
  bindings: ApplyActionFlowBindings,
): boolean {
  const empty = findLowestIndexEmptyViewport(bindings.imagesByIndex, bindings.cellCount);
  if (empty === null) return false;
  void runDuplicateAndApplyAtTargetIndex(action, sourceContent, empty, bindings);
  return true;
}

function tryDuplicateAndApplyByExpandingGrid(
  action: RegisteredViewportAction,
  sourceContent: ViewportCellContent,
  bindings: ApplyActionFlowBindings,
): boolean {
  const expanded = getNextLargerGridLayout(bindings.gridLayout);
  if (expanded === null) return false;
  const newIndex = bindings.cellCount;
  bindings.setGridLayout(expanded);
  void runDuplicateAndApplyAtTargetIndex(action, sourceContent, newIndex, bindings);
  return true;
}

export async function runDuplicateAndApplyAtTargetIndex(
  action: RegisteredViewportAction,
  sourceContent: ViewportCellContent,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): Promise<void> {
  try {
    await placeClonedSourceContentAtIndex(sourceContent, targetIndex, bindings.setImagesByIndex);
    const previous = bindings.getRenderingState(targetIndex);
    bindings.setRenderingState(targetIndex, applyActionAndTagOperationLabel(action, previous));
    toast.success(action.successMessage);
  } catch (error) {
    toast.error(formatActionErrorMessage(action.label, error));
  }
}

function formatActionErrorMessage(actionLabel: string, error: unknown): string {
  return `${actionLabel} failed: ${describeUnknownError(error)}`;
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
