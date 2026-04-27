import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { AboutDialog } from "@/components/about-dialog";
import { Toolbar } from "@/components/toolbar";
import { Toaster } from "@/components/ui/sonner";
import {
  DuplicateOverwriteAlertDialog,
  type PendingDuplicateOverwrite,
} from "@/components/viewport-duplicate-overwrite-dialog";
import { ViewportGrid, type ViewportCellContent } from "@/components/viewport-grid";
import { REGISTERED_VIEWPORT_ACTIONS } from "@/lib/actions/registered-actions";
import {
  applyActionToSelectedViewports,
  type ApplyActionFailure,
  type ViewportAction,
} from "@/lib/actions/viewport-action";
import {
  getGridLayoutCellCount,
  getViewportNumberFromIndex,
  type GridLayout,
} from "@/lib/grid/grid-layout";
import { cloneViewportImageSource } from "@/lib/image/clone-viewport-image-source";
import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";
import {
  ViewportDuplicationProvider,
  type ViewportDuplicationApi,
} from "@/state/duplication-context";
import { ViewportSelectionProvider, useViewportSelection } from "@/state/selection-context";
import {
  ViewportRenderingProvider,
  useViewportRendering,
  type ViewportRenderingApi,
} from "@/state/viewport-rendering-context";

const DEFAULT_GRID_LAYOUT: GridLayout = "1x1";
const DEFAULT_OPEN_TARGET_VIEWPORT_INDEX = 0;

type ImagesByIndexMap = ReadonlyMap<number, ViewportCellContent>;
type SetImagesByIndex = Dispatch<SetStateAction<ImagesByIndexMap>>;
type SetPendingDuplicate = Dispatch<SetStateAction<PendingDuplicateOverwrite | null>>;

export function App(): JSX.Element {
  return (
    <ViewportSelectionProvider>
      <ViewportRenderingProvider>
        <ApplicationShell />
        <AboutDialog />
        <Toaster />
      </ViewportRenderingProvider>
    </ViewportSelectionProvider>
  );
}

function ApplicationShell(): JSX.Element {
  const [gridLayout, setGridLayout] = useState<GridLayout>(DEFAULT_GRID_LAYOUT);
  const [imagesByIndex, setImagesByIndex] = useState<ImagesByIndexMap>(createEmptyImagesMap);
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicateOverwrite | null>(null);
  const { selectedIndices, pruneSelectionToCellCount } = useViewportSelection();
  const renderingApi = useViewportRendering();
  const handleGridLayoutChange = createGridLayoutChangeHandler({
    currentLayout: gridLayout,
    imagesByIndex,
    setGridLayout,
    setImagesByIndex,
    pruneSelectionToCellCount,
    pruneRenderingStateToCellCount: renderingApi.pruneRenderingStateToCellCount,
  });
  const handleOpenImageRequested = useOpenImageThroughDialogHandler(setImagesByIndex);
  const handleInvokeAction = useInvokeActionHandler(selectedIndices, renderingApi);
  useMenuOpenImageTriggersHandler(handleOpenImageRequested);
  const duplicationApi = useViewportDuplicationApi({
    cellCount: getGridLayoutCellCount(gridLayout),
    imagesByIndex,
    setImagesByIndex,
    setPendingDuplicate,
  });
  return (
    <div className="flex h-full flex-col">
      <Toolbar
        onOpenImage={handleOpenImageRequested}
        gridLayout={gridLayout}
        onGridLayoutChange={handleGridLayoutChange}
        registeredActions={REGISTERED_VIEWPORT_ACTIONS}
        onInvokeAction={handleInvokeAction}
      />
      <ViewportDuplicationProvider value={duplicationApi}>
        <ApplicationStageContent gridLayout={gridLayout} imagesByIndex={imagesByIndex} />
      </ViewportDuplicationProvider>
      <DuplicateOverwriteAlertDialog
        pending={pendingDuplicate}
        onCancel={() => setPendingDuplicate(null)}
        onConfirm={() => confirmPendingDuplicateOverwrite(pendingDuplicate, setImagesByIndex, setPendingDuplicate)}
      />
    </div>
  );
}

function createEmptyImagesMap(): ImagesByIndexMap {
  return new Map();
}

function ApplicationStageContent({
  gridLayout,
  imagesByIndex,
}: {
  gridLayout: GridLayout;
  imagesByIndex: ImagesByIndexMap;
}): JSX.Element {
  const { clearSelection } = useViewportSelection();
  return (
    <main
      className="flex min-h-0 flex-1 p-4"
      onClick={(event) => clearSelectionWhenClickIsOutsideAnyCell(event, clearSelection)}
    >
      <ViewportGrid layout={gridLayout} cellsByIndex={imagesByIndex} />
    </main>
  );
}

function clearSelectionWhenClickIsOutsideAnyCell(
  event: MouseEvent<HTMLElement>,
  clearSelection: () => void,
): void {
  const targetElement = event.target as HTMLElement;
  if (targetElement.closest('[role="gridcell"]')) return;
  clearSelection();
}

function useMenuOpenImageTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuOpenImage(handler), [handler]);
}

function useOpenImageThroughDialogHandler(setImagesByIndex: SetImagesByIndex): () => Promise<void> {
  return useCallback(async () => {
    await runOpenImageDialogFlow(setImagesByIndex);
  }, [setImagesByIndex]);
}

async function runOpenImageDialogFlow(setImagesByIndex: SetImagesByIndex): Promise<void> {
  const result = await invokeOpenImageDialogSafely();
  if (!result || result.canceled) return;
  await tryDecodeAndApplyImage(result.fileName, result.bytes, setImagesByIndex);
}

async function invokeOpenImageDialogSafely(): Promise<ToolboxOpenImageDialogResult | null> {
  try {
    return await window.toolboxApi.openImageDialog();
  } catch (error) {
    toast.error(`Could not open the file dialog: ${describeUnknownError(error)}`);
    return null;
  }
}

async function tryDecodeAndApplyImage(
  fileName: string,
  bytes: Uint8Array,
  setImagesByIndex: SetImagesByIndex,
): Promise<void> {
  try {
    const source = await decodeImageBytesToViewportSource(bytes);
    setImagesByIndex((previous) =>
      assignViewportContentAtIndex(previous, DEFAULT_OPEN_TARGET_VIEWPORT_INDEX, {
        fileName,
        source,
      }),
    );
    toast.success(`Loaded ${fileName}`);
  } catch (error) {
    toast.error(`Could not open ${fileName}: ${describeUnknownError(error)}`);
  }
}

function assignViewportContentAtIndex(
  previous: ImagesByIndexMap,
  index: number,
  content: ViewportCellContent,
): ImagesByIndexMap {
  const next = new Map(previous);
  next.set(index, content);
  return next;
}

interface GridLayoutChangeBindings {
  currentLayout: GridLayout;
  imagesByIndex: ImagesByIndexMap;
  setGridLayout: (layout: GridLayout) => void;
  setImagesByIndex: SetImagesByIndex;
  pruneSelectionToCellCount: (cellCount: number) => void;
  pruneRenderingStateToCellCount: (cellCount: number) => void;
}

function createGridLayoutChangeHandler(
  bindings: GridLayoutChangeBindings,
): (layout: GridLayout) => void {
  return (newLayout) => applyGridLayoutChange(newLayout, bindings);
}

function applyGridLayoutChange(newLayout: GridLayout, bindings: GridLayoutChangeBindings): void {
  if (newLayout === bindings.currentLayout) return;
  const newCellCount = getGridLayoutCellCount(newLayout);
  notifyAboutClosedLoadedViewports(bindings.imagesByIndex, newCellCount);
  bindings.setImagesByIndex(filterImagesToWithinCellCount(bindings.imagesByIndex, newCellCount));
  bindings.pruneSelectionToCellCount(newCellCount);
  bindings.pruneRenderingStateToCellCount(newCellCount);
  bindings.setGridLayout(newLayout);
}

function notifyAboutClosedLoadedViewports(
  imagesByIndex: ImagesByIndexMap,
  newCellCount: number,
): void {
  const closed = collectClosedLoadedViewports(imagesByIndex, newCellCount);
  if (closed.length === 0) return;
  toast.info(formatClosedViewportsMessage(closed));
}

interface ClosedViewportSummary {
  readonly viewportNumber: number;
  readonly fileName: string;
}

function collectClosedLoadedViewports(
  imagesByIndex: ImagesByIndexMap,
  newCellCount: number,
): ReadonlyArray<ClosedViewportSummary> {
  const closed: ClosedViewportSummary[] = [];
  for (const [index, content] of imagesByIndex) {
    if (index < newCellCount) continue;
    closed.push({
      viewportNumber: getViewportNumberFromIndex(index),
      fileName: content.fileName,
    });
  }
  return closed.sort((a, b) => a.viewportNumber - b.viewportNumber);
}

function formatClosedViewportsMessage(closed: ReadonlyArray<ClosedViewportSummary>): string {
  if (closed.length === 1) {
    const only = closed[0]!;
    return `Closed viewport ${only.viewportNumber} (${only.fileName})`;
  }
  const list = closed.map((entry) => `${entry.viewportNumber} (${entry.fileName})`).join(", ");
  return `Closed viewports: ${list}`;
}

function filterImagesToWithinCellCount(
  imagesByIndex: ImagesByIndexMap,
  newCellCount: number,
): ImagesByIndexMap {
  const next = new Map<number, ViewportCellContent>();
  for (const [index, content] of imagesByIndex) {
    if (index < newCellCount) next.set(index, content);
  }
  return next;
}

interface ViewportDuplicationApiBindings {
  cellCount: number;
  imagesByIndex: ImagesByIndexMap;
  setImagesByIndex: SetImagesByIndex;
  setPendingDuplicate: SetPendingDuplicate;
}

function useViewportDuplicationApi(
  bindings: ViewportDuplicationApiBindings,
): ViewportDuplicationApi {
  const { cellCount, imagesByIndex, setImagesByIndex, setPendingDuplicate } = bindings;
  return useMemo(
    () =>
      buildViewportDuplicationApi({
        cellCount,
        imagesByIndex,
        setImagesByIndex,
        setPendingDuplicate,
      }),
    [cellCount, imagesByIndex, setImagesByIndex, setPendingDuplicate],
  );
}

function buildViewportDuplicationApi(
  bindings: ViewportDuplicationApiBindings,
): ViewportDuplicationApi {
  return {
    cellCount: bindings.cellCount,
    getCellFileName: (index) => bindings.imagesByIndex.get(index)?.fileName ?? null,
    hasSourceContent: (index) => bindings.imagesByIndex.has(index),
    requestDuplicateTo: (sourceIndex, targetIndex) =>
      requestDuplicateBetweenIndices(bindings, sourceIndex, targetIndex),
  };
}

function requestDuplicateBetweenIndices(
  bindings: ViewportDuplicationApiBindings,
  sourceIndex: number,
  targetIndex: number,
): void {
  if (sourceIndex === targetIndex) return;
  const sourceContent = bindings.imagesByIndex.get(sourceIndex);
  if (!sourceContent) return;
  const existingTarget = bindings.imagesByIndex.get(targetIndex);
  if (existingTarget) {
    bindings.setPendingDuplicate({
      sourceIndex,
      targetIndex,
      sourceContent,
      targetFileName: existingTarget.fileName,
    });
    return;
  }
  void applyDuplicateToTargetIndex(sourceContent, targetIndex, bindings.setImagesByIndex);
}

async function applyDuplicateToTargetIndex(
  sourceContent: ViewportCellContent,
  targetIndex: number,
  setImagesByIndex: SetImagesByIndex,
): Promise<void> {
  try {
    const independentSource = await cloneViewportImageSource(sourceContent.source);
    setImagesByIndex((previous) =>
      assignViewportContentAtIndex(previous, targetIndex, {
        fileName: sourceContent.fileName,
        source: independentSource,
      }),
    );
    toast.success(formatDuplicateSuccessMessage(sourceContent.fileName, targetIndex));
  } catch (error) {
    toast.error(`Could not duplicate ${sourceContent.fileName}: ${describeUnknownError(error)}`);
  }
}

function formatDuplicateSuccessMessage(fileName: string, targetIndex: number): string {
  const targetNumber = getViewportNumberFromIndex(targetIndex);
  return `Duplicated ${fileName} to viewport ${targetNumber}`;
}

function confirmPendingDuplicateOverwrite(
  pending: PendingDuplicateOverwrite | null,
  setImagesByIndex: SetImagesByIndex,
  setPendingDuplicate: SetPendingDuplicate,
): void {
  if (!pending) return;
  setPendingDuplicate(null);
  void applyDuplicateToTargetIndex(pending.sourceContent, pending.targetIndex, setImagesByIndex);
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function useInvokeActionHandler(
  selectedIndices: ReadonlySet<number>,
  renderingApi: ViewportRenderingApi,
): (action: ViewportAction) => void {
  return useCallback(
    (action) => invokeActionAgainstSelection(action, selectedIndices, renderingApi),
    [selectedIndices, renderingApi],
  );
}

function invokeActionAgainstSelection(
  action: ViewportAction,
  selectedIndices: ReadonlySet<number>,
  renderingApi: ViewportRenderingApi,
): void {
  if (selectedIndices.size === 0) return;
  applyActionToSelectedViewports(action, selectedIndices, {
    getViewportRenderingState: renderingApi.getRenderingState,
    setViewportRenderingState: renderingApi.setRenderingState,
    reportApplyFailure: (failure) => reportActionApplyFailure(action, failure),
  });
}

function reportActionApplyFailure(action: ViewportAction, failure: ApplyActionFailure): void {
  const viewportNumber = getViewportNumberFromIndex(failure.viewportIndex);
  const reason = describeUnknownError(failure.error);
  console.error(
    `[toolbox] Action "${action.id}" failed on viewport ${viewportNumber}:`,
    failure.error,
  );
  toast.error(`${action.label} failed on viewport ${viewportNumber}: ${reason}`);
}
