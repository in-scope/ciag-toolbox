import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { AboutDialog } from "@/components/about-dialog";
import {
  OpenImageReplaceTargetPicker,
  type PendingOpenImageReplace,
} from "@/components/open-image-replace-target-picker";
import {
  ToolOptionsPanel,
  type ToolOptionsApplyOptions,
  type ToolOptionsSourceViewport,
} from "@/components/tool-options-panel";
import { Toolbar } from "@/components/toolbar";
import { Toaster } from "@/components/ui/sonner";
import {
  DuplicateReplaceTargetPicker,
  type DuplicateReplaceTargetEntry,
  type PendingDuplicateReplace,
} from "@/components/viewport-duplicate-replace-target-picker";
import { ViewportGrid, type ViewportCellContent } from "@/components/viewport-grid";
import {
  applyActionInPlaceAtSourceIndex,
  applyActionToDuplicateOfSource,
  runDuplicateAndApplyAtTargetIndex,
  type ApplyActionFlowBindings,
} from "@/lib/actions/apply-action-flow";
import {
  REGISTERED_VIEWPORT_ACTIONS,
  type RegisteredViewportAction,
} from "@/lib/actions/registered-actions";
import {
  getGridLayoutCellCount,
  getNextLargerGridLayout,
  getViewportNumberFromIndex,
  type GridLayout,
} from "@/lib/grid/grid-layout";
import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";
import {
  findLowestIndexEmptyViewport,
  listOccupiedViewportEntries,
} from "@/lib/image/find-empty-viewport";
import { placeClonedSourceContentAtIndex } from "@/lib/image/place-cloned-source-content";
import { applyDarkClassToDocumentRoot } from "@/lib/theme/apply-theme-class";
import { useCurrentThemeSnapshot } from "@/lib/theme/use-current-theme-snapshot";
import {
  ViewportDuplicationProvider,
  type ViewportDuplicationApi,
} from "@/state/duplication-context";
import {
  ViewportSelectionProvider,
  useViewportSelection,
  type ViewportSelectionState,
} from "@/state/selection-context";
import {
  ViewportRenderingProvider,
  useViewportRendering,
  type ViewportRenderingApi,
} from "@/state/viewport-rendering-context";

const DEFAULT_GRID_LAYOUT: GridLayout = "1x1";

type ImagesByIndexMap = ReadonlyMap<number, ViewportCellContent>;
type SetImagesByIndex = Dispatch<SetStateAction<ImagesByIndexMap>>;
type SetGridLayout = Dispatch<SetStateAction<GridLayout>>;
type SetPendingDuplicate = Dispatch<SetStateAction<PendingDuplicateReplace | null>>;
type SetActiveAction = Dispatch<SetStateAction<RegisteredViewportAction | null>>;
type SetPendingOpenImageReplace = Dispatch<SetStateAction<PendingOpenImageReplace | null>>;
type SelectViewportFromClick = ViewportSelectionState["selectViewportFromClick"];

interface SingleSelectedSource {
  readonly index: number;
  readonly summary: ToolOptionsSourceViewport;
}

export function App(): JSX.Element {
  useThemeClassSyncedWithMainProcess();
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

function useThemeClassSyncedWithMainProcess(): void {
  const snapshot = useCurrentThemeSnapshot();
  useEffect(() => applyDarkClassToDocumentRoot(snapshot.isDark), [snapshot.isDark]);
}

function ApplicationShell(): JSX.Element {
  const [gridLayout, setGridLayout] = useState<GridLayout>(DEFAULT_GRID_LAYOUT);
  const [imagesByIndex, setImagesByIndex] = useState<ImagesByIndexMap>(createEmptyImagesMap);
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicateReplace | null>(null);
  const [activeAction, setActiveAction] = useState<RegisteredViewportAction | null>(null);
  const [pendingOpenImageReplace, setPendingOpenImageReplace] =
    useState<PendingOpenImageReplace | null>(null);
  const { selectedIndices, pruneSelectionToCellCount, selectViewportFromClick } =
    useViewportSelection();
  const renderingApi = useViewportRendering();
  const cellCount = getGridLayoutCellCount(gridLayout);
  const imagesByIndexRef = useLatestRef(imagesByIndex);
  const cellCountRef = useLatestRef(cellCount);
  const handleGridLayoutChange = createGridLayoutChangeHandler({
    currentLayout: gridLayout,
    imagesByIndex,
    setGridLayout,
    setImagesByIndex,
    pruneSelectionToCellCount,
    pruneRenderingStateToCellCount: renderingApi.pruneRenderingStateToCellCount,
  });
  const handleOpenImageRequested = useOpenImageThroughDialogHandler({
    imagesByIndexRef,
    cellCountRef,
    setImagesByIndex,
    setPendingOpenImageReplace,
    selectViewportFromClick,
  });
  const handleInvokeAction = useOpenPanelForActionHandler(setActiveAction);
  const handleCancelAction = useCloseToolPanelHandler(setActiveAction);
  useMenuOpenImageTriggersHandler(handleOpenImageRequested);
  const applyActionFlowBindings = buildApplyActionFlowBindings({
    gridLayout,
    cellCount,
    imagesByIndex,
    setGridLayout,
    setImagesByIndex,
    setPendingDuplicate,
    renderingApi,
  });
  const singleSelectedSource = deriveSingleSelectedSource(selectedIndices, imagesByIndex);
  const handleApplyAction = (options: ToolOptionsApplyOptions) =>
    runApplyActionFromPanel(
      activeAction,
      singleSelectedSource,
      options,
      applyActionFlowBindings,
      setActiveAction,
    );
  const duplicationApi = useViewportDuplicationApi({
    gridLayout,
    cellCount,
    imagesByIndex,
    setGridLayout,
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
        <ApplicationStageContent
          gridLayout={gridLayout}
          imagesByIndex={imagesByIndex}
          onOpenImage={handleOpenImageRequested}
          activeAction={activeAction}
          sourceViewport={singleSelectedSource?.summary ?? null}
          onCancelAction={handleCancelAction}
          onApplyAction={handleApplyAction}
        />
      </ViewportDuplicationProvider>
      <DuplicateReplaceTargetPicker
        pending={pendingDuplicate}
        viewports={buildDuplicateReplaceTargetEntries(pendingDuplicate, imagesByIndex, cellCount)}
        onCancel={() => setPendingDuplicate(null)}
        onConfirm={(targetIndex) =>
          confirmPendingDuplicateReplaceAtTargetIndex(targetIndex, pendingDuplicate, {
            setImagesByIndex,
            setPendingDuplicate,
            applyActionFlowBindings,
          })
        }
      />
      <OpenImageReplaceTargetPicker
        pending={pendingOpenImageReplace}
        viewports={listOccupiedViewportEntries(imagesByIndex, cellCount, (content) => content.fileName)}
        onCancel={() => setPendingOpenImageReplace(null)}
        onConfirm={(targetIndex) =>
          confirmOpenImageReplaceAtTargetIndex(targetIndex, pendingOpenImageReplace, {
            setImagesByIndex,
            setPendingOpenImageReplace,
            selectViewportFromClick,
          })
        }
      />
    </div>
  );
}

function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function createEmptyImagesMap(): ImagesByIndexMap {
  return new Map();
}

interface ApplicationStageContentProps {
  gridLayout: GridLayout;
  imagesByIndex: ImagesByIndexMap;
  onOpenImage: () => void;
  activeAction: RegisteredViewportAction | null;
  sourceViewport: ToolOptionsSourceViewport | null;
  onCancelAction: () => void;
  onApplyAction: (options: ToolOptionsApplyOptions) => void;
}

function ApplicationStageContent(props: ApplicationStageContentProps): JSX.Element {
  const { clearSelection } = useViewportSelection();
  return (
    <main className="flex min-h-0 flex-1">
      <div
        className="min-w-0 flex-1 p-4"
        onClick={(event) => clearSelectionWhenClickIsOutsideAnyCell(event, clearSelection)}
      >
        <ViewportGrid
          layout={props.gridLayout}
          cellsByIndex={props.imagesByIndex}
          onOpenImage={props.onOpenImage}
        />
      </div>
      <ToolOptionsPanel
        action={props.activeAction}
        sourceViewport={props.sourceViewport}
        onCancel={props.onCancelAction}
        onApply={props.onApplyAction}
      />
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

interface OpenImageBindings {
  imagesByIndexRef: MutableRefObject<ImagesByIndexMap>;
  cellCountRef: MutableRefObject<number>;
  setImagesByIndex: SetImagesByIndex;
  setPendingOpenImageReplace: SetPendingOpenImageReplace;
  selectViewportFromClick: SelectViewportFromClick;
}

function useOpenImageThroughDialogHandler(bindings: OpenImageBindings): () => Promise<void> {
  const {
    imagesByIndexRef,
    cellCountRef,
    setImagesByIndex,
    setPendingOpenImageReplace,
    selectViewportFromClick,
  } = bindings;
  return useCallback(async () => {
    await runOpenImageDialogFlow({
      imagesByIndexRef,
      cellCountRef,
      setImagesByIndex,
      setPendingOpenImageReplace,
      selectViewportFromClick,
    });
  }, [
    imagesByIndexRef,
    cellCountRef,
    setImagesByIndex,
    setPendingOpenImageReplace,
    selectViewportFromClick,
  ]);
}

async function runOpenImageDialogFlow(bindings: OpenImageBindings): Promise<void> {
  const result = await invokeOpenImageDialogSafely();
  if (!result || result.canceled) return;
  await tryDecodeAndRouteImage(result.fileName, result.bytes, bindings);
}

async function invokeOpenImageDialogSafely(): Promise<ToolboxOpenImageDialogResult | null> {
  try {
    return await window.toolboxApi.openImageDialog();
  } catch (error) {
    toast.error(`Could not open the file dialog: ${describeUnknownError(error)}`);
    return null;
  }
}

async function tryDecodeAndRouteImage(
  fileName: string,
  bytes: Uint8Array,
  bindings: OpenImageBindings,
): Promise<void> {
  try {
    const source = await decodeImageBytesToViewportSource(bytes);
    routeDecodedImageToTargetViewport({ fileName, source }, bindings);
  } catch (error) {
    toast.error(`Could not open ${fileName}: ${describeUnknownError(error)}`);
  }
}

function routeDecodedImageToTargetViewport(
  pending: PendingOpenImageReplace,
  bindings: OpenImageBindings,
): void {
  const cellCount = bindings.cellCountRef.current;
  const emptyIndex = findLowestIndexEmptyViewport(bindings.imagesByIndexRef.current, cellCount);
  if (emptyIndex !== null) {
    applyLoadedImageAtIndex(emptyIndex, pending, bindings);
    return;
  }
  bindings.setPendingOpenImageReplace(pending);
}

interface ApplyLoadedImageBindings {
  setImagesByIndex: SetImagesByIndex;
  selectViewportFromClick: SelectViewportFromClick;
}

function applyLoadedImageAtIndex(
  index: number,
  pending: PendingOpenImageReplace,
  bindings: ApplyLoadedImageBindings,
): void {
  bindings.setImagesByIndex((previous) =>
    assignViewportContentAtIndex(previous, index, {
      fileName: pending.fileName,
      source: pending.source,
    }),
  );
  bindings.selectViewportFromClick(index, { ctrlOrMeta: false, shift: false });
  toast.success(`Loaded ${pending.fileName}`);
}

interface ConfirmReplaceBindings extends ApplyLoadedImageBindings {
  setPendingOpenImageReplace: SetPendingOpenImageReplace;
}

function confirmOpenImageReplaceAtTargetIndex(
  targetIndex: number,
  pending: PendingOpenImageReplace | null,
  bindings: ConfirmReplaceBindings,
): void {
  bindings.setPendingOpenImageReplace(null);
  if (!pending) return;
  applyLoadedImageAtIndex(targetIndex, pending, bindings);
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
  gridLayout: GridLayout;
  cellCount: number;
  imagesByIndex: ImagesByIndexMap;
  setGridLayout: SetGridLayout;
  setImagesByIndex: SetImagesByIndex;
  setPendingDuplicate: SetPendingDuplicate;
}

function useViewportDuplicationApi(
  bindings: ViewportDuplicationApiBindings,
): ViewportDuplicationApi {
  const {
    gridLayout,
    cellCount,
    imagesByIndex,
    setGridLayout,
    setImagesByIndex,
    setPendingDuplicate,
  } = bindings;
  return useMemo(
    () =>
      buildViewportDuplicationApi({
        gridLayout,
        cellCount,
        imagesByIndex,
        setGridLayout,
        setImagesByIndex,
        setPendingDuplicate,
      }),
    [gridLayout, cellCount, imagesByIndex, setGridLayout, setImagesByIndex, setPendingDuplicate],
  );
}

function buildViewportDuplicationApi(
  bindings: ViewportDuplicationApiBindings,
): ViewportDuplicationApi {
  return {
    hasSourceContent: (index) => bindings.imagesByIndex.has(index),
    requestDuplicate: (sourceIndex) => routeDuplicateRequest(bindings, sourceIndex),
  };
}

function routeDuplicateRequest(
  bindings: ViewportDuplicationApiBindings,
  sourceIndex: number,
): void {
  const sourceContent = bindings.imagesByIndex.get(sourceIndex);
  if (!sourceContent) return;
  if (placeDuplicateInExistingEmptyViewport(bindings, sourceContent)) return;
  if (placeDuplicateByExpandingGrid(bindings, sourceContent)) return;
  bindings.setPendingDuplicate({ sourceIndex, sourceContent });
}

function placeDuplicateInExistingEmptyViewport(
  bindings: ViewportDuplicationApiBindings,
  sourceContent: ViewportCellContent,
): boolean {
  const emptyIndex = findLowestIndexEmptyViewport(bindings.imagesByIndex, bindings.cellCount);
  if (emptyIndex === null) return false;
  void applyDuplicateToTargetIndex(sourceContent, emptyIndex, bindings.setImagesByIndex);
  return true;
}

function placeDuplicateByExpandingGrid(
  bindings: ViewportDuplicationApiBindings,
  sourceContent: ViewportCellContent,
): boolean {
  const expandedLayout = getNextLargerGridLayout(bindings.gridLayout);
  if (expandedLayout === null) return false;
  const newCellIndex = bindings.cellCount;
  bindings.setGridLayout(expandedLayout);
  void applyDuplicateToTargetIndex(sourceContent, newCellIndex, bindings.setImagesByIndex);
  return true;
}

async function applyDuplicateToTargetIndex(
  sourceContent: ViewportCellContent,
  targetIndex: number,
  setImagesByIndex: SetImagesByIndex,
): Promise<void> {
  try {
    await placeClonedSourceContentAtIndex(sourceContent, targetIndex, setImagesByIndex);
    toast.success(formatDuplicateSuccessMessage(sourceContent.fileName, targetIndex));
  } catch (error) {
    toast.error(`Could not duplicate ${sourceContent.fileName}: ${describeUnknownError(error)}`);
  }
}

function formatDuplicateSuccessMessage(fileName: string, targetIndex: number): string {
  const targetNumber = getViewportNumberFromIndex(targetIndex);
  return `Duplicated ${fileName} to viewport ${targetNumber}`;
}

interface ConfirmDuplicateReplaceBindings {
  setImagesByIndex: SetImagesByIndex;
  setPendingDuplicate: SetPendingDuplicate;
  applyActionFlowBindings: ApplyActionFlowBindings;
}

function confirmPendingDuplicateReplaceAtTargetIndex(
  targetIndex: number,
  pending: PendingDuplicateReplace | null,
  bindings: ConfirmDuplicateReplaceBindings,
): void {
  bindings.setPendingDuplicate(null);
  if (!pending) return;
  if (pending.postDuplicateAction) {
    void runDuplicateAndApplyAtTargetIndex(
      pending.postDuplicateAction,
      pending.sourceContent,
      targetIndex,
      bindings.applyActionFlowBindings,
    );
    return;
  }
  void applyDuplicateToTargetIndex(pending.sourceContent, targetIndex, bindings.setImagesByIndex);
}

function buildDuplicateReplaceTargetEntries(
  pending: PendingDuplicateReplace | null,
  imagesByIndex: ImagesByIndexMap,
  cellCount: number,
): ReadonlyArray<DuplicateReplaceTargetEntry> {
  if (!pending) return [];
  const occupied = listOccupiedViewportEntries(imagesByIndex, cellCount, (content) => content.fileName);
  return occupied.filter((entry) => entry.index !== pending.sourceIndex);
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function useOpenPanelForActionHandler(
  setActiveAction: SetActiveAction,
): (action: RegisteredViewportAction) => void {
  return useCallback((action) => setActiveAction(action), [setActiveAction]);
}

function useCloseToolPanelHandler(setActiveAction: SetActiveAction): () => void {
  return useCallback(() => setActiveAction(null), [setActiveAction]);
}

interface ApplyActionFlowBindingsInputs {
  gridLayout: GridLayout;
  cellCount: number;
  imagesByIndex: ImagesByIndexMap;
  setGridLayout: SetGridLayout;
  setImagesByIndex: SetImagesByIndex;
  setPendingDuplicate: SetPendingDuplicate;
  renderingApi: ViewportRenderingApi;
}

function buildApplyActionFlowBindings(
  inputs: ApplyActionFlowBindingsInputs,
): ApplyActionFlowBindings {
  return {
    gridLayout: inputs.gridLayout,
    cellCount: inputs.cellCount,
    imagesByIndex: inputs.imagesByIndex,
    setGridLayout: inputs.setGridLayout,
    setImagesByIndex: inputs.setImagesByIndex,
    setPendingDuplicate: inputs.setPendingDuplicate,
    getRenderingState: inputs.renderingApi.getRenderingState,
    setRenderingState: inputs.renderingApi.setRenderingState,
  };
}

function deriveSingleSelectedSource(
  selectedIndices: ReadonlySet<number>,
  imagesByIndex: ImagesByIndexMap,
): SingleSelectedSource | null {
  if (selectedIndices.size !== 1) return null;
  const onlyIndex = readSingleIndexFromSelection(selectedIndices);
  if (onlyIndex === null) return null;
  const content = imagesByIndex.get(onlyIndex);
  if (!content) return null;
  return {
    index: onlyIndex,
    summary: {
      viewportNumber: getViewportNumberFromIndex(onlyIndex),
      fileName: content.fileName,
    },
  };
}

function readSingleIndexFromSelection(selection: ReadonlySet<number>): number | null {
  for (const index of selection) return index;
  return null;
}

function runApplyActionFromPanel(
  action: RegisteredViewportAction | null,
  source: SingleSelectedSource | null,
  options: ToolOptionsApplyOptions,
  bindings: ApplyActionFlowBindings,
  setActiveAction: SetActiveAction,
): void {
  if (!action || !source) return;
  if (options.openInNewViewport) {
    applyActionToDuplicateOfSource(action, source.index, bindings);
  } else {
    applyActionInPlaceAtSourceIndex(action, source.index, bindings);
  }
  setActiveAction(null);
}
