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
import { DivergedSourceWarningDialog } from "@/components/diverged-source-warning-dialog";
import {
  OpenImageReplaceTargetPicker,
  type PendingOpenImageReplace,
} from "@/components/open-image-replace-target-picker";
import { SaveImageFormatPicker } from "@/components/save-image-format-picker";
import {
  ToolOptionsPanel,
  type ToolOptionsApplyOptions,
  type ToolOptionsSourceViewport,
} from "@/components/tool-options-panel";
import { Toolbar } from "@/components/toolbar";
import {
  ViewportRightPanel,
  type ViewportRightPanelActiveSource,
} from "@/components/viewport-right-panel";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
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
import { compactIndexedMapAfterRemovingIndex } from "@/lib/grid/compact-indexed-map";
import {
  getGridLayoutCellCount,
  getNextLargerGridLayout,
  getViewportNumberFromIndex,
  type GridLayout,
} from "@/lib/grid/grid-layout";
import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";
import { buildViewportImageMetadataDisplay } from "@/lib/image/image-metadata-display";
import { runSaveImageFlowThroughMainProcess } from "@/lib/image/run-save-image-flow";
import type { SaveImageFormatId } from "@/lib/image/save-image-formats";
import {
  findLowestIndexEmptyViewport,
  listOccupiedViewportEntries,
} from "@/lib/image/find-empty-viewport";
import { placeClonedSourceContentAtIndex } from "@/lib/image/place-cloned-source-content";
import {
  runOpenProjectFlowThroughMainProcess,
  type OpenedProject,
  type OpenedProjectDivergedSource,
  type OpenedProjectViewportSnapshot,
} from "@/lib/project/run-open-project-flow";
import { runPackProjectBundleFlowThroughMainProcess } from "@/lib/project/run-pack-bundle-flow";
import { runSaveProjectFlowThroughMainProcess } from "@/lib/project/run-save-project-flow";
import type { SaveableProjectSnapshot } from "@/lib/project/serialize-project";
import { applyDarkClassToDocumentRoot } from "@/lib/theme/apply-theme-class";
import { useCurrentThemeSnapshot } from "@/lib/theme/use-current-theme-snapshot";
import {
  ViewportClosingProvider,
  type ViewportClosingApi,
} from "@/state/closing-context";
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
  type ViewportRenderingByIndex,
} from "@/state/viewport-rendering-context";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "@/lib/actions/viewport-action";

const DEFAULT_GRID_LAYOUT: GridLayout = "1x1";

type ImagesByIndexMap = ReadonlyMap<number, ViewportCellContent>;
type SetImagesByIndex = Dispatch<SetStateAction<ImagesByIndexMap>>;
type SetGridLayout = Dispatch<SetStateAction<GridLayout>>;
type SetPendingDuplicate = Dispatch<SetStateAction<PendingDuplicateReplace | null>>;
type SetActiveAction = Dispatch<SetStateAction<RegisteredViewportAction | null>>;
type SetPendingOpenImageReplace = Dispatch<SetStateAction<PendingOpenImageReplace | null>>;
type SetPendingSaveImage = Dispatch<SetStateAction<PendingSaveImageRequest | null>>;
type SelectViewportFromClick = ViewportSelectionState["selectViewportFromClick"];
type UnresolvedFileNamesByIndex = ReadonlyMap<number, string>;
type SetUnresolvedFileNamesByIndex = Dispatch<SetStateAction<UnresolvedFileNamesByIndex>>;
type SetCurrentProjectFilePath = Dispatch<SetStateAction<string | null>>;

interface PendingDivergenceWithResolver {
  readonly diverged: ReadonlyArray<OpenedProjectDivergedSource>;
  readonly resolve: (continueLoad: boolean) => void;
}

type SetPendingDivergence = Dispatch<SetStateAction<PendingDivergenceWithResolver | null>>;

interface SingleSelectedSource {
  readonly index: number;
  readonly summary: ToolOptionsSourceViewport;
}

interface PendingSaveImageRequest {
  readonly fileName: string;
  readonly viewportIndex: number;
}

export function App(): JSX.Element {
  useThemeClassSyncedWithMainProcess();
  return (
    <TooltipProvider delayDuration={300}>
      <ViewportSelectionProvider>
        <ViewportRenderingProvider>
          <ApplicationShell />
          <AboutDialog />
          <Toaster />
        </ViewportRenderingProvider>
      </ViewportSelectionProvider>
    </TooltipProvider>
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
  const [pendingSaveImage, setPendingSaveImage] =
    useState<PendingSaveImageRequest | null>(null);
  const [unresolvedFileNamesByIndex, setUnresolvedFileNamesByIndex] =
    useState<UnresolvedFileNamesByIndex>(createEmptyUnresolvedMap);
  const [currentProjectFilePath, setCurrentProjectFilePath] = useState<string | null>(null);
  const [pendingDivergence, setPendingDivergence] =
    useState<PendingDivergenceWithResolver | null>(null);
  const {
    selectedIndices,
    pruneSelectionToCellCount,
    selectViewportFromClick,
    compactSelectionAfterRemovingIndex,
    replaceSelection,
  } = useViewportSelection();
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
  const handleSaveImageRequested = useSaveImageRequestHandler({
    imagesByIndexRef,
    selectedIndicesRef: useLatestRef(selectedIndices),
    setPendingSaveImage,
  });
  useMenuSaveImageTriggersHandler(handleSaveImageRequested);
  const handleSaveProjectRequested = useSaveProjectRequestHandler({
    gridLayoutRef: useLatestRef(gridLayout),
    imagesByIndexRef,
    selectedIndicesRef: useLatestRef(selectedIndices),
    renderingApi,
    currentProjectFilePathRef: useLatestRef(currentProjectFilePath),
    setCurrentProjectFilePath,
  });
  useMenuSaveProjectTriggersHandler(handleSaveProjectRequested.saveOrPromptForPath);
  useMenuSaveProjectAsTriggersHandler(handleSaveProjectRequested.alwaysPromptForPath);
  const handlePackProjectBundleRequested = usePackProjectBundleRequestHandler({
    gridLayoutRef: useLatestRef(gridLayout),
    imagesByIndexRef,
    selectedIndicesRef: useLatestRef(selectedIndices),
    renderingApi,
    currentProjectFilePathRef: useLatestRef(currentProjectFilePath),
  });
  useMenuPackProjectBundleTriggersHandler(handlePackProjectBundleRequested);
  const handleOpenProjectRequested = useOpenProjectRequestHandler({
    setGridLayout,
    setImagesByIndex,
    setUnresolvedFileNamesByIndex,
    setCurrentProjectFilePath,
    replaceAllRenderingStates: renderingApi.replaceAllRenderingStates,
    replaceSelection,
    setPendingDivergence,
  });
  useMenuOpenProjectTriggersHandler(handleOpenProjectRequested);
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
  const rightPanelActiveSource = deriveRightPanelActiveSourceFromSelection(
    selectedIndices,
    imagesByIndex,
    renderingApi,
    currentProjectFilePath,
  );
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
  const closingApi = useViewportClosingApi({
    imagesByIndex,
    setImagesByIndex,
    compactRenderingStateAfterRemovingIndex: renderingApi.compactRenderingStateAfterRemovingIndex,
    compactSelectionAfterRemovingIndex,
  });
  return (
    <div className="flex h-full flex-col">
      <Toolbar
        onOpenImage={handleOpenImageRequested}
        gridLayout={gridLayout}
        onGridLayoutChange={handleGridLayoutChange}
        registeredActions={REGISTERED_VIEWPORT_ACTIONS}
        onInvokeAction={handleInvokeAction}
        canInvokeActions={singleSelectedSource !== null}
      />
      <ViewportDuplicationProvider value={duplicationApi}>
        <ViewportClosingProvider value={closingApi}>
          <ApplicationStageContent
            gridLayout={gridLayout}
            imagesByIndex={imagesByIndex}
            unresolvedFileNamesByIndex={unresolvedFileNamesByIndex}
            onOpenImage={handleOpenImageRequested}
            activeAction={activeAction}
            sourceViewport={singleSelectedSource?.summary ?? null}
            rightPanelActiveSource={rightPanelActiveSource}
            onCancelAction={handleCancelAction}
            onApplyAction={handleApplyAction}
          />
        </ViewportClosingProvider>
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
      <SaveImageFormatPicker
        pending={pendingSaveImage}
        onCancel={() => setPendingSaveImage(null)}
        onConfirm={(formatId) =>
          confirmSaveImageFormatChoice(formatId, pendingSaveImage, {
            imagesByIndex,
            renderingApi,
            setPendingSaveImage,
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
      <DivergedSourceWarningDialog
        pending={pendingDivergence}
        onContinue={() => resolvePendingDivergence(pendingDivergence, true, setPendingDivergence)}
        onCancel={() => resolvePendingDivergence(pendingDivergence, false, setPendingDivergence)}
      />
    </div>
  );
}

function createEmptyUnresolvedMap(): UnresolvedFileNamesByIndex {
  return new Map();
}

function resolvePendingDivergence(
  pending: PendingDivergenceWithResolver | null,
  continueLoad: boolean,
  setPendingDivergence: SetPendingDivergence,
): void {
  if (!pending) return;
  setPendingDivergence(null);
  pending.resolve(continueLoad);
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
  unresolvedFileNamesByIndex: UnresolvedFileNamesByIndex;
  onOpenImage: () => void;
  activeAction: RegisteredViewportAction | null;
  sourceViewport: ToolOptionsSourceViewport | null;
  rightPanelActiveSource: ViewportRightPanelActiveSource | null;
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
          unresolvedFileNamesByIndex={props.unresolvedFileNamesByIndex}
          onOpenImage={props.onOpenImage}
        />
      </div>
      {renderActiveRightSidePanel(props)}
    </main>
  );
}

function renderActiveRightSidePanel(props: ApplicationStageContentProps): JSX.Element | null {
  if (props.activeAction) {
    return (
      <ToolOptionsPanel
        action={props.activeAction}
        sourceViewport={props.sourceViewport}
        onCancel={props.onCancelAction}
        onApply={props.onApplyAction}
      />
    );
  }
  return <ViewportRightPanel activeSource={props.rightPanelActiveSource} />;
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

function useMenuSaveImageTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuSaveImage(handler), [handler]);
}

function useMenuOpenProjectTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuOpenProject(handler), [handler]);
}

function useMenuSaveProjectTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuSaveProject(handler), [handler]);
}

function useMenuSaveProjectAsTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuSaveProjectAs(handler), [handler]);
}

function useMenuPackProjectBundleTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuPackProjectBundle(handler), [handler]);
}

interface SaveImageRequestBindings {
  imagesByIndexRef: MutableRefObject<ImagesByIndexMap>;
  selectedIndicesRef: MutableRefObject<ReadonlySet<number>>;
  setPendingSaveImage: SetPendingSaveImage;
}

function useSaveImageRequestHandler(
  bindings: SaveImageRequestBindings,
): () => void {
  const { imagesByIndexRef, selectedIndicesRef, setPendingSaveImage } = bindings;
  return useCallback(() => {
    const candidate = pickSingleSelectedSourceWithContent(
      selectedIndicesRef.current,
      imagesByIndexRef.current,
    );
    if (!candidate) {
      toast.info("Select a viewport with a loaded image to save");
      return;
    }
    setPendingSaveImage({ fileName: candidate.fileName, viewportIndex: candidate.index });
  }, [imagesByIndexRef, selectedIndicesRef, setPendingSaveImage]);
}

interface SingleSelectedContentSummary {
  readonly index: number;
  readonly fileName: string;
}

function pickSingleSelectedSourceWithContent(
  selectedIndices: ReadonlySet<number>,
  imagesByIndex: ImagesByIndexMap,
): SingleSelectedContentSummary | null {
  if (selectedIndices.size !== 1) return null;
  const onlyIndex = readSingleIndexFromSelection(selectedIndices);
  if (onlyIndex === null) return null;
  const content = imagesByIndex.get(onlyIndex);
  if (!content) return null;
  return { index: onlyIndex, fileName: content.fileName };
}

interface ConfirmSaveImageBindings {
  imagesByIndex: ImagesByIndexMap;
  renderingApi: ViewportRenderingApi;
  setPendingSaveImage: SetPendingSaveImage;
}

function confirmSaveImageFormatChoice(
  formatId: SaveImageFormatId,
  pending: PendingSaveImageRequest | null,
  bindings: ConfirmSaveImageBindings,
): void {
  bindings.setPendingSaveImage(null);
  if (!pending) return;
  const content = bindings.imagesByIndex.get(pending.viewportIndex);
  if (!content) return;
  const renderingState = bindings.renderingApi.getRenderingState(pending.viewportIndex);
  void runSaveImageFlowAndShowToast({
    source: content.source,
    selectedBandIndex: renderingState.selectedBandIndex,
    originalFileName: content.fileName,
    formatId,
  });
}

interface SaveImageFlowToastInput {
  source: ViewportCellContent["source"];
  selectedBandIndex: number;
  originalFileName: string;
  formatId: SaveImageFormatId;
}

async function runSaveImageFlowAndShowToast(
  input: SaveImageFlowToastInput,
): Promise<void> {
  try {
    const result = await runSaveImageFlowThroughMainProcess(input);
    if (result.canceled) return;
    toast.success(`Saved to ${result.filePath}`);
  } catch (error) {
    toast.error(`Could not save ${input.originalFileName}: ${describeUnknownError(error)}`);
  }
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
  await tryDecodeAndRouteImage(
    {
      fileName: result.fileName,
      bytes: result.bytes,
      sidecarBytes: result.sidecar?.bytes,
      originalFilePath: result.filePath,
      originalContentHash: result.contentHash,
      fileSizeBytes: result.bytes.length,
    },
    bindings,
  );
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
  bundle: {
    fileName: string;
    bytes: Uint8Array;
    sidecarBytes?: Uint8Array;
    originalFilePath: string;
    originalContentHash: string;
    fileSizeBytes: number;
  },
  bindings: OpenImageBindings,
): Promise<void> {
  try {
    const source = await decodeImageBytesToViewportSource(bundle);
    routeDecodedImageToTargetViewport(
      {
        fileName: bundle.fileName,
        source,
        originalFilePath: bundle.originalFilePath,
        originalContentHash: bundle.originalContentHash,
        fileSizeBytes: bundle.fileSizeBytes,
      },
      bindings,
    );
  } catch (error) {
    toast.error(`Could not open ${bundle.fileName}: ${describeUnknownError(error)}`);
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
      originalFilePath: pending.originalFilePath,
      originalContentHash: pending.originalContentHash,
      fileSizeBytes: pending.fileSizeBytes,
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
      pending.postDuplicateAction.action,
      pending.postDuplicateAction.parameterValues,
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

interface ViewportClosingApiBindings {
  imagesByIndex: ImagesByIndexMap;
  setImagesByIndex: SetImagesByIndex;
  compactRenderingStateAfterRemovingIndex: (removedIndex: number) => void;
  compactSelectionAfterRemovingIndex: (removedIndex: number) => void;
}

function useViewportClosingApi(bindings: ViewportClosingApiBindings): ViewportClosingApi {
  const {
    imagesByIndex,
    setImagesByIndex,
    compactRenderingStateAfterRemovingIndex,
    compactSelectionAfterRemovingIndex,
  } = bindings;
  return useMemo(
    () =>
      buildViewportClosingApi({
        imagesByIndex,
        setImagesByIndex,
        compactRenderingStateAfterRemovingIndex,
        compactSelectionAfterRemovingIndex,
      }),
    [
      imagesByIndex,
      setImagesByIndex,
      compactRenderingStateAfterRemovingIndex,
      compactSelectionAfterRemovingIndex,
    ],
  );
}

function buildViewportClosingApi(bindings: ViewportClosingApiBindings): ViewportClosingApi {
  return {
    hasContent: (index) => bindings.imagesByIndex.has(index),
    closeViewport: (index) => closeViewportAndCompactRemainingIndices(index, bindings),
  };
}

function closeViewportAndCompactRemainingIndices(
  index: number,
  bindings: ViewportClosingApiBindings,
): void {
  const content = bindings.imagesByIndex.get(index);
  if (!content) return;
  bindings.setImagesByIndex((previous) => compactIndexedMapAfterRemovingIndex(previous, index));
  bindings.compactRenderingStateAfterRemovingIndex(index);
  bindings.compactSelectionAfterRemovingIndex(index);
  toast.info(formatClosedSingleViewportMessage(index, content.fileName));
}

function formatClosedSingleViewportMessage(index: number, fileName: string): string {
  return `Closed viewport ${getViewportNumberFromIndex(index)} (${fileName})`;
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

function deriveRightPanelActiveSourceFromSelection(
  selectedIndices: ReadonlySet<number>,
  imagesByIndex: ImagesByIndexMap,
  renderingApi: ViewportRenderingApi,
  currentProjectFilePath: string | null,
): ViewportRightPanelActiveSource | null {
  const onlyIndex = readSingleSelectedIndexOrNull(selectedIndices);
  if (onlyIndex === null) return null;
  const content = imagesByIndex.get(onlyIndex) ?? null;
  return buildRightPanelActiveSource(onlyIndex, content, renderingApi, currentProjectFilePath);
}

function readSingleSelectedIndexOrNull(
  selectedIndices: ReadonlySet<number>,
): number | null {
  if (selectedIndices.size !== 1) return null;
  return readSingleIndexFromSelection(selectedIndices);
}

function extractRasterFromContentOrNull(
  content: ViewportCellContent | null,
): ViewportRightPanelActiveSource["raster"] {
  if (!content || content.source.kind !== "raster") return null;
  return content.source.raster;
}

function buildRightPanelActiveSource(
  viewportIndex: number,
  content: ViewportCellContent | null,
  renderingApi: ViewportRenderingApi,
  currentProjectFilePath: string | null,
): ViewportRightPanelActiveSource {
  const renderingState = renderingApi.getRenderingState(viewportIndex);
  return {
    viewportNumber: getViewportNumberFromIndex(viewportIndex),
    metadata: buildMetadataDisplayForActiveContentOrNull(content, currentProjectFilePath),
    raster: extractRasterFromContentOrNull(content),
    selectedBandIndex: renderingState.selectedBandIndex,
    onSelectBandIndex: (bandIndex) =>
      renderingApi.setRenderingState(viewportIndex, {
        ...renderingState,
        selectedBandIndex: bandIndex,
      }),
    operationHistory: renderingState.operationHistory,
  };
}

function buildMetadataDisplayForActiveContentOrNull(
  content: ViewportCellContent | null,
  currentProjectFilePath: string | null,
): ViewportRightPanelActiveSource["metadata"] {
  if (!content) return null;
  return buildViewportImageMetadataDisplay({
    fileName: content.fileName,
    source: content.source,
    originalFilePath: content.originalFilePath,
    fileSizeBytes: content.fileSizeBytes,
    currentProjectFilePath,
  });
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
    applyActionToDuplicateOfSource(action, options.parameterValues, source.index, bindings);
  } else {
    applyActionInPlaceAtSourceIndex(action, options.parameterValues, source.index, bindings);
  }
  setActiveAction(null);
}

interface SaveProjectRequestBindings {
  readonly gridLayoutRef: MutableRefObject<GridLayout>;
  readonly imagesByIndexRef: MutableRefObject<ImagesByIndexMap>;
  readonly selectedIndicesRef: MutableRefObject<ReadonlySet<number>>;
  readonly renderingApi: ViewportRenderingApi;
  readonly currentProjectFilePathRef: MutableRefObject<string | null>;
  readonly setCurrentProjectFilePath: SetCurrentProjectFilePath;
}

interface SaveProjectRequestHandlers {
  readonly saveOrPromptForPath: () => void;
  readonly alwaysPromptForPath: () => void;
}

function useSaveProjectRequestHandler(
  bindings: SaveProjectRequestBindings,
): SaveProjectRequestHandlers {
  const saveOrPromptForPath = useCallback(
    () => void runSaveProjectFlowAndShowToast(bindings, false),
    [bindings],
  );
  const alwaysPromptForPath = useCallback(
    () => void runSaveProjectFlowAndShowToast(bindings, true),
    [bindings],
  );
  return { saveOrPromptForPath, alwaysPromptForPath };
}

async function runSaveProjectFlowAndShowToast(
  bindings: SaveProjectRequestBindings,
  saveAs: boolean,
): Promise<void> {
  const snapshot = buildSaveableProjectSnapshotFromCurrentState(bindings);
  if (snapshot.viewports.length === 0) {
    toast.info("No viewports with loaded files to save");
    return;
  }
  await invokeSaveProjectFlowWithToastFeedback(snapshot, saveAs, bindings);
}

async function invokeSaveProjectFlowWithToastFeedback(
  snapshot: SaveableProjectSnapshot,
  saveAs: boolean,
  bindings: SaveProjectRequestBindings,
): Promise<void> {
  try {
    const result = await runSaveProjectFlowThroughMainProcess({
      snapshot,
      currentProjectFilePath: bindings.currentProjectFilePathRef.current,
      saveAs,
    });
    handleSaveProjectFlowOutcome(result, bindings.setCurrentProjectFilePath);
  } catch (error) {
    toast.error(`Could not save project: ${describeUnknownError(error)}`);
  }
}

function handleSaveProjectFlowOutcome(
  result: { canceled: boolean; filePath?: string },
  setCurrentProjectFilePath: SetCurrentProjectFilePath,
): void {
  if (result.canceled || !result.filePath) return;
  setCurrentProjectFilePath(result.filePath);
  toast.success(`Saved project to ${result.filePath}`);
}

function buildSaveableProjectSnapshotFromCurrentState(
  bindings: PackOrSaveProjectSnapshotInputs,
): SaveableProjectSnapshot {
  const imagesByIndex = bindings.imagesByIndexRef.current;
  const renderingApi = bindings.renderingApi;
  return {
    gridLayout: bindings.gridLayoutRef.current,
    selectedViewportIndices: Array.from(bindings.selectedIndicesRef.current),
    viewports: collectSaveableViewportsFromImagesMap(imagesByIndex, renderingApi),
  };
}

interface PackOrSaveProjectSnapshotInputs {
  readonly gridLayoutRef: MutableRefObject<GridLayout>;
  readonly imagesByIndexRef: MutableRefObject<ImagesByIndexMap>;
  readonly selectedIndicesRef: MutableRefObject<ReadonlySet<number>>;
  readonly renderingApi: ViewportRenderingApi;
}

interface PackProjectBundleRequestBindings extends PackOrSaveProjectSnapshotInputs {
  readonly currentProjectFilePathRef: MutableRefObject<string | null>;
}

function usePackProjectBundleRequestHandler(
  bindings: PackProjectBundleRequestBindings,
): () => void {
  return useCallback(
    () => void runPackProjectBundleFlowAndShowToast(bindings),
    [bindings],
  );
}

async function runPackProjectBundleFlowAndShowToast(
  bindings: PackProjectBundleRequestBindings,
): Promise<void> {
  const snapshot = buildSaveableProjectSnapshotFromCurrentState(bindings);
  if (snapshot.viewports.length === 0) {
    toast.info("No viewports with loaded files to pack");
    return;
  }
  await invokePackProjectBundleFlowWithToastFeedback(snapshot, bindings);
}

async function invokePackProjectBundleFlowWithToastFeedback(
  snapshot: SaveableProjectSnapshot,
  bindings: PackProjectBundleRequestBindings,
): Promise<void> {
  try {
    const result = await runPackProjectBundleFlowThroughMainProcess({
      snapshot,
      currentProjectFilePath: bindings.currentProjectFilePathRef.current,
    });
    handlePackProjectBundleFlowOutcome(result);
  } catch (error) {
    toast.error(`Could not pack project bundle: ${describeUnknownError(error)}`);
  }
}

function handlePackProjectBundleFlowOutcome(
  result: { canceled: boolean; filePath?: string },
): void {
  if (result.canceled || !result.filePath) return;
  toast.success(`Packed bundle to ${result.filePath}`);
}

function collectSaveableViewportsFromImagesMap(
  imagesByIndex: ImagesByIndexMap,
  renderingApi: ViewportRenderingApi,
): SaveableProjectSnapshot["viewports"] {
  const collected: SaveableProjectSnapshot["viewports"][number][] = [];
  for (const [index, content] of imagesByIndex) {
    const entry = buildSaveableViewportEntryOrNull(index, content, renderingApi);
    if (entry) collected.push(entry);
  }
  return collected.sort((a, b) => a.index - b.index);
}

function buildSaveableViewportEntryOrNull(
  index: number,
  content: ViewportCellContent,
  renderingApi: ViewportRenderingApi,
): SaveableProjectSnapshot["viewports"][number] | null {
  if (!content.originalFilePath || !content.originalContentHash) return null;
  const renderingState = renderingApi.getRenderingState(index);
  return {
    index,
    originalFilePath: content.originalFilePath,
    originalContentHash: content.originalContentHash,
    fileName: content.fileName,
    renderingState: {
      normalizationEnabled: renderingState.normalizationEnabled,
      selectedBandIndex: renderingState.selectedBandIndex,
      lastAppliedOperationLabel: renderingState.lastAppliedOperationLabel,
    },
    operationHistory: renderingState.operationHistory.map((entry) => ({
      actionId: entry.actionId,
      actionLabel: entry.actionLabel,
      appliedLabel: entry.appliedLabel,
      parameterValues: { ...entry.parameterValues },
      timestampMs: entry.timestampMs,
    })),
  };
}

interface OpenProjectRequestBindings {
  readonly setGridLayout: SetGridLayout;
  readonly setImagesByIndex: SetImagesByIndex;
  readonly setUnresolvedFileNamesByIndex: SetUnresolvedFileNamesByIndex;
  readonly setCurrentProjectFilePath: SetCurrentProjectFilePath;
  readonly replaceAllRenderingStates: ViewportRenderingApi["replaceAllRenderingStates"];
  readonly replaceSelection: ViewportSelectionState["replaceSelection"];
  readonly setPendingDivergence: SetPendingDivergence;
}

function useOpenProjectRequestHandler(
  bindings: OpenProjectRequestBindings,
): () => void {
  return useCallback(
    () => void runOpenProjectFlowAndShowToast(bindings),
    [bindings],
  );
}

async function runOpenProjectFlowAndShowToast(
  bindings: OpenProjectRequestBindings,
): Promise<void> {
  try {
    const result = await runOpenProjectFlowThroughMainProcess(
      buildAsyncDivergenceConfirmationCallback(bindings.setPendingDivergence),
    );
    handleOpenProjectFlowOutcome(result, bindings);
  } catch (error) {
    toast.error(`Could not open project: ${describeUnknownError(error)}`);
  }
}

function buildAsyncDivergenceConfirmationCallback(
  setPendingDivergence: SetPendingDivergence,
): (diverged: ReadonlyArray<OpenedProjectDivergedSource>) => Promise<boolean> {
  return (diverged) =>
    new Promise<boolean>((resolve) => {
      setPendingDivergence({ diverged, resolve });
    });
}

function handleOpenProjectFlowOutcome(
  result: { canceled: boolean; opened?: OpenedProject },
  bindings: OpenProjectRequestBindings,
): void {
  if (result.canceled || !result.opened) return;
  applyOpenedProjectToApplicationState(result.opened, bindings);
  toast.success(formatOpenedProjectToastMessage(result.opened));
}

function formatOpenedProjectToastMessage(opened: OpenedProject): string {
  const resolvedCount = opened.resolvedViewports.length;
  const unresolvedCount = opened.unresolvedViewports.length;
  if (unresolvedCount === 0) return `Opened project (${resolvedCount} viewports)`;
  return `Opened project (${resolvedCount} resolved, ${unresolvedCount} unresolved)`;
}

function applyOpenedProjectToApplicationState(
  opened: OpenedProject,
  bindings: OpenProjectRequestBindings,
): void {
  bindings.setGridLayout(opened.project.gridLayout);
  bindings.setImagesByIndex(buildImagesByIndexMapFromOpenedProject(opened));
  bindings.setUnresolvedFileNamesByIndex(buildUnresolvedFileNamesMapFromOpenedProject(opened));
  bindings.replaceAllRenderingStates(buildRenderingByIndexMapFromOpenedProject(opened));
  bindings.replaceSelection(new Set(opened.project.selectedViewportIndices));
  bindings.setCurrentProjectFilePath(opened.projectFilePath);
}

function buildImagesByIndexMapFromOpenedProject(opened: OpenedProject): ImagesByIndexMap {
  const next = new Map<number, ViewportCellContent>();
  for (const viewport of opened.resolvedViewports) {
    next.set(viewport.index, mapResolvedViewportSnapshotToCellContent(viewport));
  }
  return next;
}

function mapResolvedViewportSnapshotToCellContent(
  viewport: OpenedProjectViewportSnapshot,
): ViewportCellContent {
  return {
    fileName: viewport.fileName,
    source: viewport.source,
    originalFilePath: viewport.originalFilePath,
    originalContentHash: viewport.originalContentHash,
    fileSizeBytes: viewport.fileSizeBytes,
  };
}

function buildUnresolvedFileNamesMapFromOpenedProject(
  opened: OpenedProject,
): UnresolvedFileNamesByIndex {
  const next = new Map<number, string>();
  for (const entry of opened.unresolvedViewports) next.set(entry.index, entry.fileName);
  return next;
}

function buildRenderingByIndexMapFromOpenedProject(
  opened: OpenedProject,
): ViewportRenderingByIndex {
  const next = new Map<number, ReturnType<ViewportRenderingApi["getRenderingState"]>>();
  for (const viewport of opened.resolvedViewports) {
    next.set(viewport.index, mapProjectRenderingStateToViewportRenderingState(viewport));
  }
  return next;
}

function mapProjectRenderingStateToViewportRenderingState(
  viewport: OpenedProjectViewportSnapshot,
): ReturnType<ViewportRenderingApi["getRenderingState"]> {
  return {
    ...DEFAULT_VIEWPORT_RENDERING_STATE,
    normalizationEnabled: viewport.entry.renderingState.normalizationEnabled,
    selectedBandIndex: viewport.entry.renderingState.selectedBandIndex,
    lastAppliedOperationLabel: viewport.entry.renderingState.lastAppliedOperationLabel,
    operationHistory: viewport.entry.operationHistory.map((entry) => ({
      actionId: entry.actionId,
      actionLabel: entry.actionLabel,
      appliedLabel: entry.appliedLabel,
      parameterValues: Object.freeze({ ...entry.parameterValues }),
      timestampMs: entry.timestampMs,
    })),
  };
}
