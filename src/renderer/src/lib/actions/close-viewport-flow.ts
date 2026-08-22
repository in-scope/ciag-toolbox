import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import type { ViewportCellContent } from "@/components/viewport-grid";
import type { InFlightApplyRunStore } from "@/lib/actions/in-flight-apply-run-store";
import { formatCloseRefusedWhileOperationReadsPanel } from "@/lib/actions/in-flight-apply-runs";
import { compactIndexedMapAfterRemovingIndex } from "@/lib/grid/compact-indexed-map";
import {
  getGridLayoutCellCount,
  getViewportNumberFromIndex,
  type GridLayout,
} from "@/lib/grid/grid-layout";
import { planCloseViewport } from "@/lib/grid/plan-close-viewport";
import { queueOutgoingRasterSourceForBufferRelease } from "@/lib/image/raster-buffer-release";
import { notifyError } from "@/lib/notifications/notify";
import type { ViewportClosingApi } from "@/state/closing-context";

// The panel-close flow, extracted from App (CT-290) so the close path is unit
// testable: closing a panel queues its raster for deterministic buffer release
// alongside the CT-269 in-flight-apply interactions it already had.

type ImagesByIndexMap = ReadonlyMap<number, ViewportCellContent>;

export interface ViewportClosingApiBindings {
  gridLayout: GridLayout;
  selectedIndices: ReadonlySet<number>;
  imagesByIndex: ImagesByIndexMap;
  setGridLayout: Dispatch<SetStateAction<GridLayout>>;
  setImagesByIndex: Dispatch<SetStateAction<ImagesByIndexMap>>;
  pruneRenderingStateToCellCount: (cellCount: number) => void;
  compactRenderingStateAfterRemovingIndex: (removedIndex: number) => void;
  pruneSelectionToCellCount: (cellCount: number) => void;
  compactSelectionAfterRemovingIndex: (removedIndex: number) => void;
  pruneLinkGroupsToCellCount: (cellCount: number) => void;
  compactLinkGroupsAfterRemovingIndex: (removedIndex: number) => void;
  replaceSelection: (indices: ReadonlySet<number>) => void;
  inFlightApplyRuns: InFlightApplyRunStore;
}

export function buildViewportClosingApi(bindings: ViewportClosingApiBindings): ViewportClosingApi {
  return {
    canClose: (index) =>
      bindings.imagesByIndex.has(index) ||
      bindings.inFlightApplyRuns.hasApplyRunReservingTargetIndex(index),
    closeViewport: (index) => closeViewportRespectingInFlightApplies(index, bindings),
  };
}

// CT-269: closing interacts with in-flight applies in two ways. A panel some
// running operation READS is refused (closing it would pull the cube out from
// under the transform). A panel reserved as a running operation's TARGET
// cancels that operation instead: the run's stop controller aborts it at the
// next chunk boundary and the cancellation mark discards a result that
// completes anyway, so the closed panel can never reappear.
function closeViewportRespectingInFlightApplies(
  index: number,
  bindings: ViewportClosingApiBindings,
): void {
  if (reportCloseRefusedWhileOperationReadsPanel(index, bindings)) return;
  bindings.inFlightApplyRuns.cancelAndStopApplyRunsTargetingIndex(index);
  closeViewportAndCompactRemainingIndices(index, bindings);
}

function reportCloseRefusedWhileOperationReadsPanel(
  index: number,
  bindings: ViewportClosingApiBindings,
): boolean {
  const operationLabel = bindings.inFlightApplyRuns.findRunningOperationLabelReadingSourceIndex(index);
  if (operationLabel === null) return false;
  notifyError(
    formatCloseRefusedWhileOperationReadsPanel(getViewportNumberFromIndex(index), operationLabel),
  );
  return true;
}

function closeViewportAndCompactRemainingIndices(
  index: number,
  bindings: ViewportClosingApiBindings,
): void {
  const content = bindings.imagesByIndex.get(index);
  if (!content) return;
  const closeContext = captureCloseContextBeforeMutation(index, bindings);
  bindings.setImagesByIndex((previous) => compactIndexedMapAfterRemovingIndex(previous, index));
  // CT-290: queue the closed panel's raster for deterministic buffer release;
  // App's post-commit flush detaches whatever no live consumer still shares.
  queueOutgoingRasterSourceForBufferRelease(content.source);
  bindings.compactRenderingStateAfterRemovingIndex(index);
  bindings.compactSelectionAfterRemovingIndex(index);
  bindings.compactLinkGroupsAfterRemovingIndex(index);
  bindings.inFlightApplyRuns.shiftApplyRunIndexesAfterViewportRemoved(index);
  collapseGridLayoutAndRestoreSelectionAfterClose(closeContext, bindings);
  toast.info(formatClosedSingleViewportMessage(index, content.fileName));
}

interface CloseContextBeforeMutation {
  readonly currentLayout: GridLayout;
  readonly closedIndex: number;
  readonly closedIndexWasOnlySelection: boolean;
  readonly populatedCellCountBeforeClose: number;
}

function captureCloseContextBeforeMutation(
  closedIndex: number,
  bindings: ViewportClosingApiBindings,
): CloseContextBeforeMutation {
  return {
    currentLayout: bindings.gridLayout,
    closedIndex,
    closedIndexWasOnlySelection: isClosedIndexTheOnlySelectedViewport(
      bindings.selectedIndices,
      closedIndex,
    ),
    // CT-269: empty cells reserved by in-flight applies count as populated so
    // the post-close layout collapse can never prune a reserved result panel.
    populatedCellCountBeforeClose:
      bindings.imagesByIndex.size + countReservedEmptyTargetCells(bindings),
  };
}

function countReservedEmptyTargetCells(bindings: ViewportClosingApiBindings): number {
  const reservedTargets = bindings.inFlightApplyRuns.listReservedResultTargetIndexes();
  return [...reservedTargets].filter((index) => !bindings.imagesByIndex.has(index)).length;
}

function isClosedIndexTheOnlySelectedViewport(
  selectedIndices: ReadonlySet<number>,
  closedIndex: number,
): boolean {
  return selectedIndices.size === 1 && selectedIndices.has(closedIndex);
}

function collapseGridLayoutAndRestoreSelectionAfterClose(
  context: CloseContextBeforeMutation,
  bindings: ViewportClosingApiBindings,
): void {
  const plan = planCloseViewport(context);
  if (plan.collapsedLayout === null) return;
  const newCellCount = getGridLayoutCellCount(plan.collapsedLayout);
  bindings.setGridLayout(plan.collapsedLayout);
  bindings.pruneRenderingStateToCellCount(newCellCount);
  bindings.pruneSelectionToCellCount(newCellCount);
  bindings.pruneLinkGroupsToCellCount(newCellCount);
  if (plan.fallbackSelectionIndex !== null) {
    bindings.replaceSelection(new Set([plan.fallbackSelectionIndex]));
  }
}

function formatClosedSingleViewportMessage(index: number, fileName: string): string {
  return `Closed panel ${getViewportNumberFromIndex(index)} (${fileName})`;
}
