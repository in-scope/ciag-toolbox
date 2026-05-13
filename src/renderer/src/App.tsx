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
import { AppBusyModal } from "@/components/busy-indicators";
import { StatusBar } from "@/components/status-bar";
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
import {
  Toolbar,
  type ActionAvailabilityForActiveViewport,
} from "@/components/toolbar";
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
  BAND_KEEP_ACTION,
  REGISTERED_VIEWPORT_ACTIONS,
  buildBandKeepParameterValuesFromKeptIndexes,
  type RegisteredViewportAction,
} from "@/lib/actions/registered-actions";
import { listKeptBandIndexesFromRemoved } from "@/lib/image/apply-band-keep";
import { compactIndexedMapAfterRemovingIndex } from "@/lib/grid/compact-indexed-map";
import {
  getGridLayoutCellCount,
  getNextLargerGridLayout,
  getViewportNumberFromIndex,
  type GridLayout,
} from "@/lib/grid/grid-layout";
import { planCloseViewport } from "@/lib/grid/plan-close-viewport";
import {
  planOpenImagePlacement,
  type OpenImagePlacementPlan,
} from "@/lib/grid/plan-open-image";
import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";
import { runOpenImageStackDialogPhase } from "@/lib/image/run-open-stack-flow";
import { buildConfirmedStackFromOrderedEntriesWithProgress } from "@/lib/image/confirm-stack-build";
import type {
  DecodedStackEntry,
  PendingOpenImageStack,
} from "@/lib/image/open-image-stack-types";
import { StackConfirmationModal } from "@/components/stack-confirmation-modal";
import { buildViewportImageMetadataDisplay } from "@/lib/image/image-metadata-display";
import { computeRoiMeanSpectrumOrNull } from "@/lib/image/compute-spectrum";
import { removePinnedSpectrumById } from "@/lib/image/spectrum-entry";
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
  type OpenedProjectViewportSnapshot,
} from "@/lib/project/run-open-project-flow";
import { runSaveProjectBundleFlowThroughMainProcess } from "@/lib/project/run-save-bundle-flow";
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
  BusyStateProvider,
  useBusyEntryRegistrar,
  type BusyEntryHandle,
  type BusyEntryRegistrar,
} from "@/state/busy-state-context";
import { PixelReadoutProvider } from "@/state/pixel-readout-context";
import {
  RegionToolProvider,
  useRegionTool,
} from "@/state/region-tool-context";
import {
  ViewportReimportProvider,
  type ViewportReimportApi,
} from "@/state/reimport-context";
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
import {
  DEFAULT_VIEWPORT_RENDERING_STATE,
  type ViewportRenderingState,
} from "@/lib/actions/viewport-action";
import type { ParameterValuesById } from "@/lib/actions/parameter-schema";

const DEFAULT_GRID_LAYOUT: GridLayout = "1x1";

type ImagesByIndexMap = ReadonlyMap<number, ViewportCellContent>;
type SetImagesByIndex = Dispatch<SetStateAction<ImagesByIndexMap>>;
type SetGridLayout = Dispatch<SetStateAction<GridLayout>>;
type SetPendingDuplicate = Dispatch<SetStateAction<PendingDuplicateReplace | null>>;
type SetActiveAction = Dispatch<SetStateAction<RegisteredViewportAction | null>>;
type SetPendingOpenImageReplace = Dispatch<SetStateAction<PendingOpenImageReplace | null>>;
type SetPendingSaveImage = Dispatch<SetStateAction<PendingSaveImageRequest | null>>;
type SelectViewportFromClick = ViewportSelectionState["selectViewportFromClick"];
type SetCurrentProjectFilePath = Dispatch<SetStateAction<string | null>>;

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
          <RegionToolProvider>
            <PixelReadoutProvider>
              <BusyStateProvider>
                <ApplicationShell />
                <AboutDialog />
                <AppBusyModal />
                <Toaster />
              </BusyStateProvider>
            </PixelReadoutProvider>
          </RegionToolProvider>
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
  const busyRegistrar = useBusyEntryRegistrar();
  const [gridLayout, setGridLayout] = useState<GridLayout>(DEFAULT_GRID_LAYOUT);
  const [imagesByIndex, setImagesByIndex] = useState<ImagesByIndexMap>(createEmptyImagesMap);
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicateReplace | null>(null);
  const [activeAction, setActiveAction] = useState<RegisteredViewportAction | null>(null);
  const [pendingOpenImageReplace, setPendingOpenImageReplace] =
    useState<PendingOpenImageReplace | null>(null);
  const [pendingOpenImageStack, setPendingOpenImageStack] =
    useState<PendingOpenImageStack | null>(null);
  const [pendingSaveImage, setPendingSaveImage] =
    useState<PendingSaveImageRequest | null>(null);
  const [currentProjectFilePath, setCurrentProjectFilePath] = useState<string | null>(null);
  const {
    selectedIndices,
    pruneSelectionToCellCount,
    selectViewportFromClick,
    compactSelectionAfterRemovingIndex,
    replaceSelection,
  } = useViewportSelection();
  const renderingApi = useViewportRendering();
  const regionTool = useRegionTool();
  const cellCount = getGridLayoutCellCount(gridLayout);
  const imagesByIndexRef = useLatestRef(imagesByIndex);
  const handleGridLayoutChange = createGridLayoutChangeHandler({
    currentLayout: gridLayout,
    imagesByIndex,
    setGridLayout,
    setImagesByIndex,
    pruneSelectionToCellCount,
    pruneRenderingStateToCellCount: renderingApi.pruneRenderingStateToCellCount,
  });
  const gridLayoutRef = useLatestRef(gridLayout);
  const handleOpenImageRequested = useOpenImageThroughDialogHandler({
    imagesByIndexRef,
    gridLayoutRef,
    setGridLayout,
    setImagesByIndex,
    setPendingOpenImageReplace,
    selectViewportFromClick,
    busyRegistrar,
  });
  const handleInvokeAction = useOpenPanelForActionHandler(setActiveAction);
  const handleCancelAction = useCloseToolPanelHandler(setActiveAction);
  useMenuOpenImageTriggersHandler(handleOpenImageRequested);
  const handleOpenImageStackRequested = useOpenImageStackThroughDialogHandler({
    setPendingOpenImageStack,
    busyRegistrar,
  });
  useMenuOpenImageStackTriggersHandler(handleOpenImageStackRequested);
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
    busyRegistrar,
  });
  useMenuSaveProjectTriggersHandler(handleSaveProjectRequested.saveOrPromptForPath);
  useMenuSaveProjectAsTriggersHandler(handleSaveProjectRequested.alwaysPromptForPath);
  const handleOpenProjectRequested = useOpenProjectRequestHandler({
    setGridLayout,
    setImagesByIndex,
    setCurrentProjectFilePath,
    replaceAllRenderingStates: renderingApi.replaceAllRenderingStates,
    replaceSelection,
    busyRegistrar,
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
    busyRegistrar,
  });
  const singleSelectedSource = deriveSingleSelectedSource(selectedIndices, imagesByIndex);
  const rightPanelActiveSource = deriveRightPanelActiveSourceFromSelection({
    selectedIndices,
    imagesByIndex,
    renderingApi,
    currentProjectFilePath,
    applyActionFlowBindings,
  });
  useEscapeKeyClearsActiveViewportRoi({
    selectedIndicesRef: useLatestRef(selectedIndices),
    renderingApi,
  });
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
    getRenderingState: renderingApi.getRenderingState,
    setRenderingState: renderingApi.setRenderingState,
  });
  const closingApi = useViewportClosingApi({
    gridLayout,
    selectedIndices,
    imagesByIndex,
    setGridLayout,
    setImagesByIndex,
    pruneRenderingStateToCellCount: renderingApi.pruneRenderingStateToCellCount,
    compactRenderingStateAfterRemovingIndex: renderingApi.compactRenderingStateAfterRemovingIndex,
    pruneSelectionToCellCount,
    compactSelectionAfterRemovingIndex,
    replaceSelection,
  });
  const reimportApi = useViewportReimportApi({
    setImagesByIndex,
    setRenderingState: renderingApi.setRenderingState,
    busyRegistrar,
  });
  return (
    <div className="flex h-full flex-col">
      <Toolbar
        onOpenImage={handleOpenImageRequested}
        gridLayout={gridLayout}
        onGridLayoutChange={handleGridLayoutChange}
        registeredActions={REGISTERED_VIEWPORT_ACTIONS}
        onInvokeAction={handleInvokeAction}
        getActionAvailability={(action) =>
          deriveActionAvailabilityForActiveViewport(action, singleSelectedSource, renderingApi)
        }
        isRegionToolActive={regionTool.isRegionToolActive}
        onToggleRegionTool={regionTool.toggleRegionTool}
      />
      <ViewportDuplicationProvider value={duplicationApi}>
        <ViewportClosingProvider value={closingApi}>
          <ViewportReimportProvider value={reimportApi}>
            <ApplicationStageContent
              gridLayout={gridLayout}
              imagesByIndex={imagesByIndex}
              onOpenImage={handleOpenImageRequested}
              activeAction={activeAction}
              sourceViewport={singleSelectedSource?.summary ?? null}
              rightPanelActiveSource={rightPanelActiveSource}
              onCancelAction={handleCancelAction}
              onApplyAction={handleApplyAction}
            />
          </ViewportReimportProvider>
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
            busyRegistrar,
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
      <StackConfirmationModal
        pending={pendingOpenImageStack}
        onCancel={() => setPendingOpenImageStack(null)}
        onConfirm={(orderedIncluded) =>
          void confirmStackBuildFromOrderedEntries(orderedIncluded, {
            imagesByIndexRef,
            gridLayoutRef,
            setGridLayout,
            setImagesByIndex,
            setPendingOpenImageReplace,
            setPendingOpenImageStack,
            selectViewportFromClick,
            busyRegistrar,
          })
        }
      />
      <StatusBar />
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

function useMenuOpenImageStackTriggersHandler(handler: () => void): void {
  useEffect(() => window.toolboxApi.onMenuOpenImageStack(handler), [handler]);
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

interface SaveImageRequestBindings {
  imagesByIndexRef: MutableRefObject<ImagesByIndexMap>;
  selectedIndicesRef: MutableRefObject<ReadonlySet<number>>;
  setPendingSaveImage: SetPendingSaveImage;
}

interface ConfirmSaveImageBindings {
  imagesByIndex: ImagesByIndexMap;
  renderingApi: ViewportRenderingApi;
  setPendingSaveImage: SetPendingSaveImage;
  busyRegistrar: BusyEntryRegistrar;
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
  void runSaveImageFlowAndShowToast(
    {
      source: content.source,
      selectedBandIndex: renderingState.selectedBandIndex,
      originalFileName: content.fileName,
      formatId,
    },
    bindings.busyRegistrar,
  );
}

interface SaveImageFlowToastInput {
  source: ViewportCellContent["source"];
  selectedBandIndex: number;
  originalFileName: string;
  formatId: SaveImageFormatId;
}

async function runSaveImageFlowAndShowToast(
  input: SaveImageFlowToastInput,
  busyRegistrar: BusyEntryRegistrar,
): Promise<void> {
  const handle = busyRegistrar.registerAppBusyEntry({
    label: `Saving ${input.originalFileName}...`,
  });
  try {
    const result = await runSaveImageFlowThroughMainProcess(input);
    if (result.canceled) return;
    toast.success(`Saved to ${result.filePath}`);
  } catch (error) {
    toast.error(`Could not save ${input.originalFileName}: ${describeUnknownError(error)}`);
  } finally {
    handle.clear();
  }
}

interface OpenImageBindings {
  imagesByIndexRef: MutableRefObject<ImagesByIndexMap>;
  gridLayoutRef: MutableRefObject<GridLayout>;
  setGridLayout: SetGridLayout;
  setImagesByIndex: SetImagesByIndex;
  setPendingOpenImageReplace: SetPendingOpenImageReplace;
  selectViewportFromClick: SelectViewportFromClick;
  busyRegistrar: BusyEntryRegistrar;
}

function useOpenImageStackThroughDialogHandler(
  bindings: OpenImageStackBindings,
): () => Promise<void> {
  const {
    busyRegistrar,
    setPendingOpenImageStack,
  } = bindings;
  return useCallback(async () => {
    await runOpenImageStackDialogFlow({
      busyRegistrar,
      setPendingOpenImageStack,
    });
  }, [busyRegistrar, setPendingOpenImageStack]);
}

interface OpenImageStackBindings {
  setPendingOpenImageStack: Dispatch<SetStateAction<PendingOpenImageStack | null>>;
  busyRegistrar: BusyEntryRegistrar;
}

async function runOpenImageStackDialogFlow(
  bindings: OpenImageStackBindings,
): Promise<void> {
  const handle = bindings.busyRegistrar.registerAppBusyEntry({
    label: "Reading file 0 of ?...",
    progress: 0,
  });
  try {
    await openImageStackDialogAndPresentResultOrToast(bindings, handle);
  } finally {
    handle.clear();
  }
}

async function openImageStackDialogAndPresentResultOrToast(
  bindings: OpenImageStackBindings,
  handle: BusyEntryHandle,
): Promise<void> {
  const result = await runOpenImageStackDialogPhase({
    readPhaseBusyHandle: handle,
  });
  if (result.kind === "canceled") return;
  if (result.kind === "too-few-files") {
    toast.info("Open Image Stack needs 2 or more TIFFs; use Open Image for a single file");
    return;
  }
  bindings.setPendingOpenImageStack(result.pending);
}

interface ConfirmStackBindings extends OpenImageBindings {
  setPendingOpenImageStack: Dispatch<SetStateAction<PendingOpenImageStack | null>>;
}

async function confirmStackBuildFromOrderedEntries(
  orderedIncludedEntries: ReadonlyArray<DecodedStackEntry>,
  bindings: ConfirmStackBindings,
): Promise<void> {
  bindings.setPendingOpenImageStack(null);
  const handle = bindings.busyRegistrar.registerAppBusyEntry({
    label: `Stacking band 1 of ${orderedIncludedEntries.length}...`,
    progress: 0,
  });
  try {
    await buildAndRouteStackedImage(orderedIncludedEntries, handle, bindings);
  } catch (error) {
    toast.error(`Could not stack TIFFs: ${describeUnknownError(error)}`);
  } finally {
    handle.clear();
  }
}

async function buildAndRouteStackedImage(
  orderedIncludedEntries: ReadonlyArray<DecodedStackEntry>,
  handle: BusyEntryHandle,
  bindings: OpenImageBindings,
): Promise<void> {
  const built = await buildConfirmedStackFromOrderedEntriesWithProgress(
    orderedIncludedEntries,
    handle,
  );
  routeDecodedImageToTargetViewport(
    {
      fileName: built.suggestedFileName,
      source: { kind: "raster", raster: built.raster },
      fileSizeBytes: orderedIncludedEntries.reduce((sum, entry) => sum + entry.fileSizeBytes, 0),
    },
    bindings,
  );
}

function useOpenImageThroughDialogHandler(bindings: OpenImageBindings): () => Promise<void> {
  const {
    imagesByIndexRef,
    gridLayoutRef,
    setGridLayout,
    setImagesByIndex,
    setPendingOpenImageReplace,
    selectViewportFromClick,
    busyRegistrar,
  } = bindings;
  return useCallback(async () => {
    await runOpenImageDialogFlow({
      imagesByIndexRef,
      gridLayoutRef,
      setGridLayout,
      setImagesByIndex,
      setPendingOpenImageReplace,
      selectViewportFromClick,
      busyRegistrar,
    });
  }, [
    imagesByIndexRef,
    gridLayoutRef,
    setGridLayout,
    setImagesByIndex,
    setPendingOpenImageReplace,
    selectViewportFromClick,
    busyRegistrar,
  ]);
}

async function runOpenImageDialogFlow(bindings: OpenImageBindings): Promise<void> {
  const result = await invokeOpenImageDialogSafely();
  if (!result || result.canceled) return;
  const handle = registerOpenImageBusyEntry(result.fileName, bindings);
  try {
    await tryDecodeAndRouteImage(
      {
        fileName: result.fileName,
        bytes: result.bytes,
        sidecarBytes: result.sidecar?.bytes,
        originalFilePath: result.filePath,
        fileSizeBytes: result.bytes.length,
      },
      bindings,
    );
  } finally {
    handle.clear();
  }
}

function registerOpenImageBusyEntry(
  fileName: string,
  bindings: OpenImageBindings,
): BusyEntryHandle {
  const plan = planOpenImagePlacement({
    currentLayout: bindings.gridLayoutRef.current,
    imagesByIndex: bindings.imagesByIndexRef.current,
  });
  const targetIndex = pickPlannedTargetIndexFromOpenImagePlan(plan);
  const label = `Loading ${fileName}...`;
  if (targetIndex !== null) {
    return bindings.busyRegistrar.registerViewportBusyEntry({ viewportIndex: targetIndex, label });
  }
  return bindings.busyRegistrar.registerAppBusyEntry({ label });
}

function pickPlannedTargetIndexFromOpenImagePlan(plan: OpenImagePlacementPlan): number | null {
  if (plan.kind === "placeInExistingEmptyCell") return plan.targetIndex;
  if (plan.kind === "growGridAndPlace") return plan.targetIndex;
  return null;
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
  const plan = planOpenImagePlacement({
    currentLayout: bindings.gridLayoutRef.current,
    imagesByIndex: bindings.imagesByIndexRef.current,
  });
  applyOpenImagePlacementPlan(plan, pending, bindings);
}

function applyOpenImagePlacementPlan(
  plan: OpenImagePlacementPlan,
  pending: PendingOpenImageReplace,
  bindings: OpenImageBindings,
): void {
  if (plan.kind === "placeInExistingEmptyCell") {
    applyLoadedImageAtIndex(plan.targetIndex, pending, bindings);
    return;
  }
  if (plan.kind === "growGridAndPlace") {
    bindings.setGridLayout(plan.expandedLayout);
    applyLoadedImageAtIndex(plan.targetIndex, pending, bindings);
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
  getRenderingState: ViewportRenderingApi["getRenderingState"];
  setRenderingState: ViewportRenderingApi["setRenderingState"];
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
    getRenderingState,
    setRenderingState,
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
        getRenderingState,
        setRenderingState,
      }),
    [
      gridLayout,
      cellCount,
      imagesByIndex,
      setGridLayout,
      setImagesByIndex,
      setPendingDuplicate,
      getRenderingState,
      setRenderingState,
    ],
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
  if (placeDuplicateInExistingEmptyViewport(bindings, sourceContent, sourceIndex)) return;
  if (placeDuplicateByExpandingGrid(bindings, sourceContent, sourceIndex)) return;
  bindings.setPendingDuplicate({ sourceIndex, sourceContent });
}

function placeDuplicateInExistingEmptyViewport(
  bindings: ViewportDuplicationApiBindings,
  sourceContent: ViewportCellContent,
  sourceIndex: number,
): boolean {
  const emptyIndex = findLowestIndexEmptyViewport(bindings.imagesByIndex, bindings.cellCount);
  if (emptyIndex === null) return false;
  void applyDuplicateToTargetIndex(sourceContent, sourceIndex, emptyIndex, bindings);
  return true;
}

function placeDuplicateByExpandingGrid(
  bindings: ViewportDuplicationApiBindings,
  sourceContent: ViewportCellContent,
  sourceIndex: number,
): boolean {
  const expandedLayout = getNextLargerGridLayout(bindings.gridLayout);
  if (expandedLayout === null) return false;
  const newCellIndex = bindings.cellCount;
  bindings.setGridLayout(expandedLayout);
  void applyDuplicateToTargetIndex(sourceContent, sourceIndex, newCellIndex, bindings);
  return true;
}

interface DuplicateTargetBindings {
  setImagesByIndex: SetImagesByIndex;
  getRenderingState: ViewportRenderingApi["getRenderingState"];
  setRenderingState: ViewportRenderingApi["setRenderingState"];
}

async function applyDuplicateToTargetIndex(
  sourceContent: ViewportCellContent,
  sourceIndex: number,
  targetIndex: number,
  bindings: DuplicateTargetBindings,
): Promise<void> {
  try {
    await placeClonedSourceContentAtIndex(sourceContent, targetIndex, bindings.setImagesByIndex);
    bindings.setRenderingState(targetIndex, bindings.getRenderingState(sourceIndex));
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
      pending.sourceIndex,
      targetIndex,
      bindings.applyActionFlowBindings,
    );
    return;
  }
  void applyDuplicateToTargetIndex(pending.sourceContent, pending.sourceIndex, targetIndex, {
    setImagesByIndex: bindings.setImagesByIndex,
    getRenderingState: bindings.applyActionFlowBindings.getRenderingState,
    setRenderingState: bindings.applyActionFlowBindings.setRenderingState,
  });
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
  gridLayout: GridLayout;
  selectedIndices: ReadonlySet<number>;
  imagesByIndex: ImagesByIndexMap;
  setGridLayout: SetGridLayout;
  setImagesByIndex: SetImagesByIndex;
  pruneRenderingStateToCellCount: (cellCount: number) => void;
  compactRenderingStateAfterRemovingIndex: (removedIndex: number) => void;
  pruneSelectionToCellCount: (cellCount: number) => void;
  compactSelectionAfterRemovingIndex: (removedIndex: number) => void;
  replaceSelection: (indices: ReadonlySet<number>) => void;
}

function useViewportClosingApi(bindings: ViewportClosingApiBindings): ViewportClosingApi {
  const {
    gridLayout,
    selectedIndices,
    imagesByIndex,
    setGridLayout,
    setImagesByIndex,
    pruneRenderingStateToCellCount,
    compactRenderingStateAfterRemovingIndex,
    pruneSelectionToCellCount,
    compactSelectionAfterRemovingIndex,
    replaceSelection,
  } = bindings;
  return useMemo(
    () =>
      buildViewportClosingApi({
        gridLayout,
        selectedIndices,
        imagesByIndex,
        setGridLayout,
        setImagesByIndex,
        pruneRenderingStateToCellCount,
        compactRenderingStateAfterRemovingIndex,
        pruneSelectionToCellCount,
        compactSelectionAfterRemovingIndex,
        replaceSelection,
      }),
    [
      gridLayout,
      selectedIndices,
      imagesByIndex,
      setGridLayout,
      setImagesByIndex,
      pruneRenderingStateToCellCount,
      compactRenderingStateAfterRemovingIndex,
      pruneSelectionToCellCount,
      compactSelectionAfterRemovingIndex,
      replaceSelection,
    ],
  );
}

interface ViewportReimportApiBindings {
  setImagesByIndex: SetImagesByIndex;
  setRenderingState: ViewportRenderingApi["setRenderingState"];
  busyRegistrar: BusyEntryRegistrar;
}

function useViewportReimportApi(
  bindings: ViewportReimportApiBindings,
): ViewportReimportApi {
  const { setImagesByIndex, setRenderingState, busyRegistrar } = bindings;
  return useMemo(
    () => buildViewportReimportApi({ setImagesByIndex, setRenderingState, busyRegistrar }),
    [setImagesByIndex, setRenderingState, busyRegistrar],
  );
}

function buildViewportReimportApi(
  bindings: ViewportReimportApiBindings,
): ViewportReimportApi {
  return {
    requestReimport: (viewportIndex) =>
      void runReimportSourceFromDiskFlow(viewportIndex, bindings),
  };
}

async function runReimportSourceFromDiskFlow(
  viewportIndex: number,
  bindings: ViewportReimportApiBindings,
): Promise<void> {
  const result = await invokeOpenImageDialogSafely();
  if (!result || result.canceled) return;
  await replaceViewportSourceWithReimportedFile(viewportIndex, result, bindings);
}

async function replaceViewportSourceWithReimportedFile(
  viewportIndex: number,
  result: Extract<ToolboxOpenImageDialogResult, { canceled: false }>,
  bindings: ViewportReimportApiBindings,
): Promise<void> {
  const handle = bindings.busyRegistrar.registerViewportBusyEntry({
    viewportIndex,
    label: `Re-importing ${result.fileName}...`,
  });
  try {
    const source = await decodeImageBytesToViewportSource({
      fileName: result.fileName,
      bytes: result.bytes,
      sidecarBytes: result.sidecar?.bytes,
    });
    bindings.setImagesByIndex((previous) =>
      assignViewportContentAtIndex(previous, viewportIndex, {
        fileName: result.fileName,
        source,
        originalFilePath: result.filePath,
        fileSizeBytes: result.bytes.length,
      }),
    );
    bindings.setRenderingState(viewportIndex, DEFAULT_VIEWPORT_RENDERING_STATE);
    toast.success(`Re-imported ${result.fileName}`);
  } catch (error) {
    toast.error(`Could not re-import ${result.fileName}: ${describeUnknownError(error)}`);
  } finally {
    handle.clear();
  }
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
  const closeContext = captureCloseContextBeforeMutation(index, bindings);
  bindings.setImagesByIndex((previous) => compactIndexedMapAfterRemovingIndex(previous, index));
  bindings.compactRenderingStateAfterRemovingIndex(index);
  bindings.compactSelectionAfterRemovingIndex(index);
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
    populatedCellCountBeforeClose: bindings.imagesByIndex.size,
  };
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
  if (plan.fallbackSelectionIndex !== null) {
    bindings.replaceSelection(new Set([plan.fallbackSelectionIndex]));
  }
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
  busyRegistrar: BusyEntryRegistrar;
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
    busyRegistrar: inputs.busyRegistrar,
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

interface DeriveRightPanelActiveSourceInputs {
  readonly selectedIndices: ReadonlySet<number>;
  readonly imagesByIndex: ImagesByIndexMap;
  readonly renderingApi: ViewportRenderingApi;
  readonly currentProjectFilePath: string | null;
  readonly applyActionFlowBindings: ApplyActionFlowBindings;
}

function deriveRightPanelActiveSourceFromSelection(
  inputs: DeriveRightPanelActiveSourceInputs,
): ViewportRightPanelActiveSource | null {
  const onlyIndex = readSingleSelectedIndexOrNull(inputs.selectedIndices);
  if (onlyIndex === null) return null;
  const content = inputs.imagesByIndex.get(onlyIndex) ?? null;
  return buildRightPanelActiveSource({
    viewportIndex: onlyIndex,
    content,
    renderingApi: inputs.renderingApi,
    currentProjectFilePath: inputs.currentProjectFilePath,
    applyActionFlowBindings: inputs.applyActionFlowBindings,
  });
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

interface BuildRightPanelActiveSourceInputs {
  readonly viewportIndex: number;
  readonly content: ViewportCellContent | null;
  readonly renderingApi: ViewportRenderingApi;
  readonly currentProjectFilePath: string | null;
  readonly applyActionFlowBindings: ApplyActionFlowBindings;
}

function buildRightPanelActiveSource(
  inputs: BuildRightPanelActiveSourceInputs,
): ViewportRightPanelActiveSource {
  const { viewportIndex, content, renderingApi, currentProjectFilePath } = inputs;
  const renderingState = renderingApi.getRenderingState(viewportIndex);
  const raster = extractRasterFromContentOrNull(content);
  return {
    viewportNumber: getViewportNumberFromIndex(viewportIndex),
    metadata: buildMetadataDisplayForActiveContentOrNull(content, currentProjectFilePath),
    raster,
    selectedBandIndex: renderingState.selectedBandIndex,
    onSelectBandIndex: (bandIndex) =>
      renderingApi.setRenderingState(viewportIndex, {
        ...renderingState,
        selectedBandIndex: bandIndex,
      }),
    removedBandIndexes: renderingState.removedBandIndexes,
    onToggleRemovedBandIndex: (bandIndex) =>
      renderingApi.setRenderingState(viewportIndex, {
        ...renderingState,
        removedBandIndexes: toggleBandIndexInRemovedList(
          renderingState.removedBandIndexes,
          bandIndex,
        ),
      }),
    onApplyBandSelection: () =>
      runApplyBandSelectionForViewport({
        viewportIndex,
        raster,
        renderingState,
        applyActionFlowBindings: inputs.applyActionFlowBindings,
      }),
    operationHistory: renderingState.operationHistory,
    roi: renderingState.roi,
    onClearRoi: () =>
      renderingApi.setRenderingState(viewportIndex, { ...renderingState, roi: null }),
    pinnedSpectra: renderingState.pinnedSpectra,
    roiMeanSpectrum: buildRoiMeanSpectrumForDisplayOrNull(raster, renderingState.roi),
    onRemovePinnedSpectrum: (spectrumId) =>
      renderingApi.setRenderingState(viewportIndex, {
        ...renderingState,
        pinnedSpectra: removePinnedSpectrumById(renderingState.pinnedSpectra, spectrumId),
      }),
  };
}

function toggleBandIndexInRemovedList(
  removedBandIndexes: ReadonlyArray<number>,
  bandIndex: number,
): ReadonlyArray<number> {
  if (removedBandIndexes.includes(bandIndex)) {
    return removedBandIndexes.filter((existing) => existing !== bandIndex);
  }
  return [...removedBandIndexes, bandIndex].sort((a, b) => a - b);
}

interface ApplyBandSelectionInputs {
  readonly viewportIndex: number;
  readonly raster: ViewportRightPanelActiveSource["raster"];
  readonly renderingState: ViewportRenderingState;
  readonly applyActionFlowBindings: ApplyActionFlowBindings;
}

function runApplyBandSelectionForViewport(inputs: ApplyBandSelectionInputs): void {
  const { raster, renderingState } = inputs;
  if (!raster) {
    toast.error("Keep Bands requires a raster source.");
    return;
  }
  const keptBandIndexes = listKeptBandIndexesFromRemoved(
    raster.bandCount,
    renderingState.removedBandIndexes,
  );
  if (keptBandIndexes.length === 0) {
    toast.error("Keep at least one band before applying.");
    return;
  }
  if (keptBandIndexes.length === raster.bandCount) {
    toast.info("Uncheck a band to remove it on apply.");
    return;
  }
  applyActionToDuplicateOfSource(
    BAND_KEEP_ACTION,
    buildBandKeepParameterValuesFromKeptIndexes(keptBandIndexes),
    inputs.viewportIndex,
    inputs.applyActionFlowBindings,
  );
}

function buildRoiMeanSpectrumForDisplayOrNull(
  raster: ViewportRightPanelActiveSource["raster"],
  roi: ViewportRightPanelActiveSource["roi"],
): ViewportRightPanelActiveSource["roiMeanSpectrum"] {
  if (!raster || !roi) return null;
  const spectrum = computeRoiMeanSpectrumOrNull(raster, roi);
  if (!spectrum) return null;
  return {
    bandMeans: spectrum.bandMeans,
    bandStandardDeviations: spectrum.bandStandardDeviations,
    samplePixelCount: spectrum.samplePixelCount,
  };
}

interface EscapeKeyClearRoiBindings {
  readonly selectedIndicesRef: MutableRefObject<ReadonlySet<number>>;
  readonly renderingApi: ViewportRenderingApi;
}

function useEscapeKeyClearsActiveViewportRoi(bindings: EscapeKeyClearRoiBindings): void {
  const { selectedIndicesRef, renderingApi } = bindings;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void =>
      handleEscapeKeyForRoiClearing(event, { selectedIndicesRef, renderingApi });
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndicesRef, renderingApi]);
}

function handleEscapeKeyForRoiClearing(
  event: KeyboardEvent,
  bindings: EscapeKeyClearRoiBindings,
): void {
  if (event.key !== "Escape") return;
  if (isFocusInsideEditableElement(event.target)) return;
  clearRoiOnEverySelectedViewport(bindings);
}

function clearRoiOnEverySelectedViewport(bindings: EscapeKeyClearRoiBindings): void {
  for (const index of bindings.selectedIndicesRef.current) {
    const renderingState = bindings.renderingApi.getRenderingState(index);
    if (!renderingState.roi) continue;
    bindings.renderingApi.setRenderingState(index, { ...renderingState, roi: null });
  }
}

function isFocusInsideEditableElement(eventTarget: EventTarget | null): boolean {
  if (!(eventTarget instanceof HTMLElement)) return false;
  const tagName = eventTarget.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return true;
  return eventTarget.isContentEditable;
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
  const merged = mergeParameterValuesWithSourceRenderingState(
    action,
    options.parameterValues,
    bindings.getRenderingState(source.index),
  );
  if (merged === null) return;
  if (options.openInNewViewport) {
    applyActionToDuplicateOfSource(action, merged, source.index, bindings);
  } else {
    applyActionInPlaceAtSourceIndex(action, merged, source.index, bindings);
  }
  setActiveAction(null);
}

function deriveActionAvailabilityForActiveViewport(
  action: RegisteredViewportAction,
  source: SingleSelectedSource | null,
  renderingApi: ViewportRenderingApi,
): ActionAvailabilityForActiveViewport {
  if (!source) return { isAvailable: false };
  if (!action.isAvailableForActiveViewport) return { isAvailable: true };
  const renderingState = renderingApi.getRenderingState(source.index);
  if (action.isAvailableForActiveViewport(renderingState)) return { isAvailable: true };
  return {
    isAvailable: false,
    disabledReason: describeWhyActionIsUnavailableForViewport(action),
  };
}

function describeWhyActionIsUnavailableForViewport(action: RegisteredViewportAction): string {
  if (action.id === "crop-to-region") return "draw a region first";
  return "not available for this viewport";
}

function mergeParameterValuesWithSourceRenderingState(
  action: RegisteredViewportAction,
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
): ParameterValuesById | null {
  if (!action.prepareParameterValuesForApply) return rawParameterValues;
  try {
    return action.prepareParameterValuesForApply(rawParameterValues, sourceRenderingState);
  } catch (error) {
    toast.error(formatActionPreparationErrorMessage(action.label, error));
    return null;
  }
}

function formatActionPreparationErrorMessage(actionLabel: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${actionLabel} failed: ${message}`;
}

interface SaveProjectRequestBindings {
  readonly gridLayoutRef: MutableRefObject<GridLayout>;
  readonly imagesByIndexRef: MutableRefObject<ImagesByIndexMap>;
  readonly selectedIndicesRef: MutableRefObject<ReadonlySet<number>>;
  readonly renderingApi: ViewportRenderingApi;
  readonly currentProjectFilePathRef: MutableRefObject<string | null>;
  readonly setCurrentProjectFilePath: SetCurrentProjectFilePath;
  readonly busyRegistrar: BusyEntryRegistrar;
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
  const handle = bindings.busyRegistrar.registerAppBusyEntry({
    label: "Saving project...",
    progress: 0,
  });
  try {
    const result = await runSaveProjectBundleFlowThroughMainProcess({
      snapshot,
      currentProjectFilePath: bindings.currentProjectFilePathRef.current,
      saveAs,
      onProgress: (event) => updateSaveBundleProgressOnHandle(handle, event),
    });
    handleSaveProjectFlowOutcome(result, bindings.setCurrentProjectFilePath);
  } catch (error) {
    toast.error(`Could not save project: ${describeUnknownError(error)}`);
  } finally {
    handle.clear();
  }
}

function updateSaveBundleProgressOnHandle(
  handle: BusyEntryHandle,
  event: { bakedAssetCount: number; totalAssetCount: number },
): void {
  const fraction = event.totalAssetCount === 0 ? 1 : event.bakedAssetCount / event.totalAssetCount;
  handle.update({
    label: `Saving project... asset ${event.bakedAssetCount} of ${event.totalAssetCount}`,
    progress: fraction,
  });
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

function collectSaveableViewportsFromImagesMap(
  imagesByIndex: ImagesByIndexMap,
  renderingApi: ViewportRenderingApi,
): SaveableProjectSnapshot["viewports"] {
  const collected: SaveableProjectSnapshot["viewports"][number][] = [];
  for (const [index, content] of imagesByIndex) {
    collected.push(buildSaveableViewportEntry(index, content, renderingApi));
  }
  return collected.sort((a, b) => a.index - b.index);
}

function buildSaveableViewportEntry(
  index: number,
  content: ViewportCellContent,
  renderingApi: ViewportRenderingApi,
): SaveableProjectSnapshot["viewports"][number] {
  const renderingState = renderingApi.getRenderingState(index);
  return {
    index,
    fileName: content.fileName,
    source: content.source,
    originalFilePath: content.originalFilePath ?? null,
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
  readonly setCurrentProjectFilePath: SetCurrentProjectFilePath;
  readonly replaceAllRenderingStates: ViewportRenderingApi["replaceAllRenderingStates"];
  readonly replaceSelection: ViewportSelectionState["replaceSelection"];
  readonly busyRegistrar: BusyEntryRegistrar;
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
  const handle = bindings.busyRegistrar.registerAppBusyEntry({
    label: "Opening project...",
    progress: 0,
  });
  try {
    const result = await runOpenProjectFlowThroughMainProcess({
      onProgress: (event) => updateOpenBundleProgressOnHandle(handle, event),
    });
    handleOpenProjectFlowOutcome(result, bindings);
  } catch (error) {
    toast.error(`Could not open project: ${describeUnknownError(error)}`);
  } finally {
    handle.clear();
  }
}

function updateOpenBundleProgressOnHandle(
  handle: BusyEntryHandle,
  event: { readAssetCount: number; totalAssetCount: number },
): void {
  const fraction = event.totalAssetCount === 0 ? 1 : event.readAssetCount / event.totalAssetCount;
  handle.update({
    label: `Opening project... asset ${event.readAssetCount} of ${event.totalAssetCount}`,
    progress: fraction,
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
  return `Opened project (${opened.resolvedViewports.length} viewports)`;
}

function applyOpenedProjectToApplicationState(
  opened: OpenedProject,
  bindings: OpenProjectRequestBindings,
): void {
  bindings.setGridLayout(opened.project.gridLayout);
  bindings.setImagesByIndex(buildImagesByIndexMapFromOpenedProject(opened));
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
    fileSizeBytes: viewport.fileSizeBytes,
  };
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
