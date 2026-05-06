import { toast } from "sonner";

import type { ViewportCellContent } from "@/components/viewport-grid";
import type { PendingDuplicateReplace } from "@/components/viewport-duplicate-replace-target-picker";
import { appendOperationHistoryEntry } from "@/lib/actions/operation-history";
import type { ParameterValuesById } from "@/lib/actions/parameter-schema";
import type { RegisteredViewportAction } from "@/lib/actions/registered-actions";
import type { ViewportRenderingState } from "@/lib/actions/viewport-action";
import { getNextLargerGridLayout, type GridLayout } from "@/lib/grid/grid-layout";
import { cloneViewportImageSource } from "@/lib/image/clone-viewport-image-source";
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
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  try {
    replaceSourceAtIndexWhenActionTransformsSource(action, parameterValues, sourceIndex, bindings);
    writeAppliedRenderingStateAtIndex(action, parameterValues, sourceIndex, bindings);
    toast.success(action.successMessage);
  } catch (error) {
    toast.error(formatActionErrorMessage(action.label, error));
  }
}

function replaceSourceAtIndexWhenActionTransformsSource(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  if (!action.transformSource) return;
  const content = bindings.imagesByIndex.get(sourceIndex);
  if (!content) throw new Error(`No source loaded at viewport index ${sourceIndex}`);
  const nextSource = action.transformSource(content.source, parameterValues);
  bindings.setImagesByIndex((previous) =>
    writeViewportContentAtIndex(previous, sourceIndex, { ...content, source: nextSource }),
  );
}

function writeAppliedRenderingStateAtIndex(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  index: number,
  bindings: ApplyActionFlowBindings,
): void {
  const previous = bindings.getRenderingState(index);
  bindings.setRenderingState(
    index,
    applyActionAndTagOperationLabel(action, parameterValues, previous),
  );
}

function applyActionAndTagOperationLabel(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  previous: ViewportRenderingState,
): ViewportRenderingState {
  const appliedLabel = resolveAppliedLabelForActionAndParameters(action, parameterValues);
  const applied = action.apply(previous, parameterValues);
  return {
    ...applied,
    lastAppliedOperationLabel: appliedLabel,
    operationHistory: appendOperationHistoryEntry(applied.operationHistory, {
      actionId: action.id,
      actionLabel: action.label,
      appliedLabel,
      parameterValues,
    }),
  };
}

function resolveAppliedLabelForActionAndParameters(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
): string {
  if (action.formatAppliedLabel) return action.formatAppliedLabel(parameterValues);
  return action.appliedLabel;
}

export function applyActionToDuplicateOfSource(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  const sourceContent = bindings.imagesByIndex.get(sourceIndex);
  if (!sourceContent) return;
  if (tryDuplicateAndApplyInEmptyViewport(action, parameterValues, sourceContent, bindings)) return;
  if (tryDuplicateAndApplyByExpandingGrid(action, parameterValues, sourceContent, bindings)) return;
  bindings.setPendingDuplicate({
    sourceIndex,
    sourceContent,
    postDuplicateAction: { action, parameterValues },
  });
}

function tryDuplicateAndApplyInEmptyViewport(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  bindings: ApplyActionFlowBindings,
): boolean {
  const empty = findLowestIndexEmptyViewport(bindings.imagesByIndex, bindings.cellCount);
  if (empty === null) return false;
  void runDuplicateAndApplyAtTargetIndex(action, parameterValues, sourceContent, empty, bindings);
  return true;
}

function tryDuplicateAndApplyByExpandingGrid(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  bindings: ApplyActionFlowBindings,
): boolean {
  const expanded = getNextLargerGridLayout(bindings.gridLayout);
  if (expanded === null) return false;
  const newIndex = bindings.cellCount;
  bindings.setGridLayout(expanded);
  void runDuplicateAndApplyAtTargetIndex(
    action,
    parameterValues,
    sourceContent,
    newIndex,
    bindings,
  );
  return true;
}

export async function runDuplicateAndApplyAtTargetIndex(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): Promise<void> {
  try {
    if (action.transformSource) {
      await placeTransformedDuplicateAtTargetIndex(
        action,
        parameterValues,
        sourceContent,
        targetIndex,
        bindings,
      );
    } else {
      await placeClonedSourceContentAtIndex(sourceContent, targetIndex, bindings.setImagesByIndex);
    }
    writeAppliedRenderingStateAtIndex(action, parameterValues, targetIndex, bindings);
    toast.success(action.successMessage);
  } catch (error) {
    toast.error(formatActionErrorMessage(action.label, error));
  }
}

async function placeTransformedDuplicateAtTargetIndex(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): Promise<void> {
  const transformedContent = await cloneAndTransformSourceContent(
    sourceContent,
    action.transformSource!,
    parameterValues,
  );
  bindings.setImagesByIndex((previous) =>
    writeViewportContentAtIndex(previous, targetIndex, transformedContent),
  );
}

async function cloneAndTransformSourceContent(
  sourceContent: ViewportCellContent,
  transform: NonNullable<RegisteredViewportAction["transformSource"]>,
  parameterValues: ParameterValuesById,
): Promise<ViewportCellContent> {
  const clonedSource = await cloneViewportImageSource(sourceContent.source);
  const transformedSource = transform(clonedSource, parameterValues);
  return {
    fileName: sourceContent.fileName,
    source: transformedSource,
    originalFilePath: sourceContent.originalFilePath,
    originalContentHash: sourceContent.originalContentHash,
  };
}

function writeViewportContentAtIndex(
  previous: ViewportContentMap,
  index: number,
  next: ViewportCellContent,
): ViewportContentMap {
  const updated = new Map(previous);
  updated.set(index, next);
  return updated;
}

function formatActionErrorMessage(actionLabel: string, error: unknown): string {
  return `${actionLabel} failed: ${describeUnknownError(error)}`;
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
