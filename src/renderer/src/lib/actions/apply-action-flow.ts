import { toast } from "sonner";

import type { ViewportCellContent } from "@/components/viewport-grid";
import type { PendingDuplicateReplace } from "@/components/viewport-duplicate-replace-target-picker";
import { appendOperationHistoryEntry } from "@/lib/actions/operation-history";
import {
  describeOperationLoadingMessage,
  shouldShowOperationLoadingImmediately,
} from "@/lib/actions/operation-loading-message";
import type { ParameterValuesById } from "@/lib/actions/parameter-schema";
import type { RegisteredViewportAction } from "@/lib/actions/registered-actions";
import type { ViewportActionOutput, ViewportRenderingState } from "@/lib/actions/viewport-action";
import type { ViewportImageSource } from "@/lib/webgl/texture";
import { getNextLargerGridLayout, type GridLayout } from "@/lib/grid/grid-layout";
import { cloneViewportImageSource } from "@/lib/image/clone-viewport-image-source";
import { findLowestIndexEmptyViewport } from "@/lib/image/find-empty-viewport";
import {
  placeClonedSourceContentAtIndex,
  type ViewportContentMap,
  type ViewportContentMapUpdater,
} from "@/lib/image/place-cloned-source-content";
import type { BusyEntryHandle, BusyEntryRegistrar } from "@/state/busy-state-context";

export interface ApplyActionFlowBindings {
  gridLayout: GridLayout;
  cellCount: number;
  imagesByIndex: ViewportContentMap;
  setGridLayout: (layout: GridLayout) => void;
  setImagesByIndex: (updater: ViewportContentMapUpdater) => void;
  setPendingDuplicate: (pending: PendingDuplicateReplace | null) => void;
  getRenderingState: (index: number) => ViewportRenderingState;
  setRenderingState: (index: number, next: ViewportRenderingState) => void;
  // CT-105: selects the panel that now holds an operation's result so the user's
  // next action targets the result rather than the original source panel.
  selectViewportIndex?: (index: number) => void;
  busyRegistrar: BusyEntryRegistrar;
}

export function applyActionInPlaceAtSourceIndex(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  if (action.transformSource) {
    void runApplyActionInPlaceWithBusyIndicator(action, parameterValues, sourceIndex, bindings);
    return;
  }
  applyActionInPlaceWithoutBusyIndicator(action, parameterValues, sourceIndex, bindings);
}

function applyActionInPlaceWithoutBusyIndicator(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  try {
    replaceSourceAtIndexWhenActionTransformsSource(action, parameterValues, sourceIndex, bindings);
    writeAppliedRenderingStateInheritingFromSource(
      action,
      parameterValues,
      sourceIndex,
      sourceIndex,
      bindings,
    );
    placeSecondaryActionOutputsInFreshViewports(action, parameterValues, sourceIndex, sourceIndex, bindings);
    toast.success(action.successMessage);
  } catch (error) {
    toast.error(formatActionErrorMessage(action.label, error));
  }
}

async function runApplyActionInPlaceWithBusyIndicator(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): Promise<void> {
  const handle = bindings.busyRegistrar.registerViewportBusyEntry({
    viewportIndex: sourceIndex,
    label: describeOperationLoadingMessage(action),
  });
  try {
    await yieldOnceSoBusyOverlayCanPaint();
    replaceSourceAtIndexWhenActionTransformsSource(action, parameterValues, sourceIndex, bindings);
    writeAppliedRenderingStateInheritingFromSource(
      action,
      parameterValues,
      sourceIndex,
      sourceIndex,
      bindings,
    );
    placeSecondaryActionOutputsInFreshViewports(action, parameterValues, sourceIndex, sourceIndex, bindings);
    toast.success(action.successMessage);
  } catch (error) {
    toast.error(formatActionErrorMessage(action.label, error));
  } finally {
    handle.clear();
  }
}

function yieldOnceSoBusyOverlayCanPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

function writeAppliedRenderingStateInheritingFromSource(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  const inherited = bindings.getRenderingState(sourceIndex);
  bindings.setRenderingState(
    targetIndex,
    applyActionAndTagOperationLabel(action, parameterValues, inherited),
  );
}

// CT-097: after the primary result lands, place each secondary output (e.g. the
// auto-normalized intermediate produced when inverting unbounded data) into its
// own fresh viewport, expanding the grid if needed. The source is untouched.
function placeSecondaryActionOutputsInFreshViewports(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceIndex: number,
  primaryTargetIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  if (!action.transformSourceToSecondaryOutputs) return;
  const sourceContent = bindings.imagesByIndex.get(sourceIndex);
  if (!sourceContent) return;
  const outputs = action.transformSourceToSecondaryOutputs(sourceContent.source, parameterValues);
  placeEachSecondaryOutputInFreshViewport(action, parameterValues, sourceContent, outputs, sourceIndex, primaryTargetIndex, bindings);
}

function placeEachSecondaryOutputInFreshViewport(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  outputs: ReadonlyArray<ViewportActionOutput>,
  sourceIndex: number,
  primaryTargetIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  const reservedIndexes = new Set<number>([sourceIndex, primaryTargetIndex]);
  for (const output of outputs) {
    const targetIndex = reserveFreshViewportIndexExcluding(bindings, reservedIndexes);
    if (targetIndex === null) return;
    reservedIndexes.add(targetIndex);
    placeSecondaryOutputAtIndex(action, parameterValues, sourceContent, output, sourceIndex, targetIndex, bindings);
  }
}

function placeSecondaryOutputAtIndex(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  output: ViewportActionOutput,
  sourceIndex: number,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  bindings.setImagesByIndex((previous) =>
    writeViewportContentAtIndex(previous, targetIndex, { ...sourceContent, source: output.source }),
  );
  writeAppliedRenderingStateWithExplicitLabel(action, parameterValues, output.appliedLabel, sourceIndex, targetIndex, bindings);
}

function reserveFreshViewportIndexExcluding(
  bindings: ApplyActionFlowBindings,
  excludedIndexes: ReadonlySet<number>,
): number | null {
  for (let index = 0; index < bindings.cellCount; index += 1) {
    if (!bindings.imagesByIndex.has(index) && !excludedIndexes.has(index)) return index;
  }
  return expandGridForOneMoreSecondaryOutput(bindings);
}

function expandGridForOneMoreSecondaryOutput(bindings: ApplyActionFlowBindings): number | null {
  const expanded = getNextLargerGridLayout(bindings.gridLayout);
  if (expanded === null) return null;
  bindings.setGridLayout(expanded);
  return bindings.cellCount;
}

function writeAppliedRenderingStateWithExplicitLabel(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  appliedLabel: string,
  sourceIndex: number,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  const inherited = bindings.getRenderingState(sourceIndex);
  bindings.setRenderingState(
    targetIndex,
    applyActionAndTagWithExplicitLabel(action, parameterValues, appliedLabel, inherited),
  );
}

function applyActionAndTagOperationLabel(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  previous: ViewportRenderingState,
): ViewportRenderingState {
  const appliedLabel = resolveAppliedLabelForActionAndParameters(action, parameterValues);
  return applyActionAndTagWithExplicitLabel(action, parameterValues, appliedLabel, previous);
}

function applyActionAndTagWithExplicitLabel(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  appliedLabel: string,
  previous: ViewportRenderingState,
): ViewportRenderingState {
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
  if (reportActionCannotApplyToSourceBeforeOpeningPanel(action, sourceContent.source, parameterValues)) return;
  if (tryDuplicateAndApplyInEmptyViewport(action, parameterValues, sourceContent, sourceIndex, bindings)) return;
  if (tryDuplicateAndApplyByExpandingGrid(action, parameterValues, sourceContent, sourceIndex, bindings)) return;
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
  sourceIndex: number,
  bindings: ApplyActionFlowBindings,
): boolean {
  const empty = findLowestIndexEmptyViewport(bindings.imagesByIndex, bindings.cellCount);
  if (empty === null) return false;
  void runDuplicateAndApplyAtTargetIndex(action, parameterValues, sourceContent, sourceIndex, empty, bindings);
  return true;
}

function tryDuplicateAndApplyByExpandingGrid(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  sourceIndex: number,
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
    sourceIndex,
    newIndex,
    bindings,
  );
  return true;
}

export async function runDuplicateAndApplyAtTargetIndex(
  action: RegisteredViewportAction,
  parameterValues: ParameterValuesById,
  sourceContent: ViewportCellContent,
  sourceIndex: number,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): Promise<void> {
  const handle = action.transformSource
    ? registerResultPanelBusyEntry(action, targetIndex, bindings)
    : null;
  try {
    if (handle) await yieldOnceSoBusyOverlayCanPaint();
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
    writeAppliedRenderingStateInheritingFromSource(
      action,
      parameterValues,
      sourceIndex,
      targetIndex,
      bindings,
    );
    clearConsumedSourceStateAfterDuplicateApply(action, sourceIndex, targetIndex, bindings);
    placeSecondaryActionOutputsInFreshViewports(action, parameterValues, sourceIndex, targetIndex, bindings);
    selectResultPanelHoldingTheDuplicateOutput(targetIndex, bindings);
    toast.success(action.successMessage);
  } catch (error) {
    toast.error(formatActionErrorMessage(action.label, error));
  } finally {
    handle?.clear();
  }
}

function selectResultPanelHoldingTheDuplicateOutput(
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  bindings.selectViewportIndex?.(targetIndex);
}

// CT-106: the result lands in a freshly opened panel. When that panel is empty
// (no image to show under a delayed spinner) its loading state must paint
// immediately; an overwrite of an existing panel keeps the anti-flash delay.
function registerResultPanelBusyEntry(
  action: RegisteredViewportAction,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): BusyEntryHandle {
  const opensInNewEmptyPanel = !bindings.imagesByIndex.has(targetIndex);
  return bindings.busyRegistrar.registerViewportBusyEntry({
    viewportIndex: targetIndex,
    label: describeOperationLoadingMessage(action),
    immediate: shouldShowOperationLoadingImmediately({ opensInNewEmptyPanel }),
  });
}

function clearConsumedSourceStateAfterDuplicateApply(
  action: RegisteredViewportAction,
  sourceIndex: number,
  targetIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  if (!action.clearConsumedSourceStateAfterApply) return;
  if (sourceIndex === targetIndex) return;
  const current = bindings.getRenderingState(sourceIndex);
  bindings.setRenderingState(
    sourceIndex,
    action.clearConsumedSourceStateAfterApply(current),
  );
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
    fileSizeBytes: sourceContent.fileSizeBytes,
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

// CT-190: surface an unappliable operation (e.g. RGB-to-grayscale on a non-RGB
// image) as an error toast BEFORE any panel is reserved or the grid is expanded,
// so a failure opens no blank panel and records no History entry. Returns true
// when the apply flow must stop.
function reportActionCannotApplyToSourceBeforeOpeningPanel(
  action: RegisteredViewportAction,
  source: ViewportImageSource,
  parameterValues: ParameterValuesById,
): boolean {
  if (!action.assertCanApplyToSource) return false;
  try {
    action.assertCanApplyToSource(source, parameterValues);
    return false;
  } catch (error) {
    toast.error(formatActionErrorMessage(action.label, error));
    return true;
  }
}

function formatActionErrorMessage(actionLabel: string, error: unknown): string {
  return `${actionLabel} failed: ${describeUnknownError(error)}`;
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
