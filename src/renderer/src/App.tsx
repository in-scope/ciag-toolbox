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
  type ConfirmedOpenImagesReplacePlan,
  type PendingOpenImageReplaceItem,
  type PendingOpenImagesReplace,
} from "@/components/open-image-replace-target-picker";
import { OpenImagesReviewModal } from "@/components/open-images-review-modal";
import { SaveImageFormatPicker } from "@/components/save-image-format-picker";
import {
  ToolOptionsPanel,
  type ToolOptionsApplyOptions,
  type ToolOptionsSourceViewport,
} from "@/components/tool-options-panel";
import {
  Toolbar,
  type ActionAvailabilityForActiveViewport,
  type BandSubsetToolbarToggleState,
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
  BAND_SUBSET_ACTION,
  REGISTERED_VIEWPORT_ACTIONS,
  buildBandSubsetParameterValuesFromKeptNumbers,
  readFalseColorBandAssignment,
  type RegisteredViewportAction,
} from "@/lib/actions/registered-actions";
import {
  listKeptBandIndexesFromRemoved,
  listKeptBandOriginalNumbersAfterRemovingBand,
} from "@/lib/image/apply-band-keep";
import { buildFalseColorPreviewSourceOrNull } from "@/lib/image/false-color-preview-pixels";
import { getRasterBandOriginalNumber, type RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";
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
import {
  planOpenImagesPlacement,
  type OpenImagesPlacementPlan,
} from "@/lib/grid/plan-open-images";
import { decodeImageBytesToViewportSource } from "@/lib/image/decode-image-bytes";
import { runOpenImagesDialogPhase } from "@/lib/image/run-open-images-flow";
import { buildConfirmedStackFromOrderedEntriesWithProgress } from "@/lib/image/confirm-stack-build";
import type { DecodedStackEntry } from "@/lib/image/open-image-stack-types";
import type {
  GroupedOpenedFileRow,
  OpenedFileForGrouping,
  OpenedFilesGroup,
  OpenedFilesGroupingProposal,
} from "@/lib/image/group-opened-files";
import { buildViewportImageMetadataDisplay } from "@/lib/image/image-metadata-display";
import { computeRoiMeanSpectrumOrNull } from "@/lib/image/compute-spectrum";
import {
  removePinnedSpectrumById,
  removeRoiSpectrumById,
} from "@/lib/image/spectrum-entry";
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
import {
  saveableSnapshotRequiresRasterRebake,
  type SaveableProjectSnapshot,
} from "@/lib/project/serialize-project";
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
  waitForBusyIndicatorToClearAntiFlashThreshold,
  type BusyEntryHandle,
  type BusyEntryRegistrar,
} from "@/state/busy-state-context";
import { PixelReadoutProvider } from "@/state/pixel-readout-context";
import { RightPanelCollapsedStateProvider } from "@/state/right-panel-collapsed-state";
import {
  RegionToolProvider,
  useRegionTool,
} from "@/state/region-tool-context";
import {
  RegionRequestProvider,
  useRegionRequest,
  type RegionRequestApi,
} from "@/state/region-request-context";
import {
  FalseColorPreviewProvider,
  useFalseColorPreview,
  type FalseColorPreview,
  type FalseColorPreviewApi,
} from "@/state/false-color-preview-context";
import {
  ViewportReimportProvider,
  type ViewportReimportApi,
} from "@/state/reimport-context";
import {
  ViewportBandRemovalProvider,
  type ViewportBandRemovalApi,
} from "@/state/band-removal-context";
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
  type ApplyScope,
  type ViewportRenderingState,
} from "@/lib/actions/viewport-action";
import { NO_PARAMETER_VALUES, type ParameterValuesById } from "@/lib/actions/parameter-schema";

const DEFAULT_GRID_LAYOUT: GridLayout = "1x1";

type ImagesByIndexMap = ReadonlyMap<number, ViewportCellContent>;
type SetImagesByIndex = Dispatch<SetStateAction<ImagesByIndexMap>>;
type SetGridLayout = Dispatch<SetStateAction<GridLayout>>;
type SetPendingDuplicate = Dispatch<SetStateAction<PendingDuplicateReplace | null>>;
type SetActiveAction = Dispatch<SetStateAction<RegisteredViewportAction | null>>;
type SetPendingOpenImagesReplace = Dispatch<SetStateAction<PendingOpenImagesReplace | null>>;
type SetPendingOpenImagesReview = Dispatch<SetStateAction<OpenedFilesGroupingProposal | null>>;
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
            <RegionRequestProvider>
            <FalseColorPreviewProvider>
              <PixelReadoutProvider>
                <BusyStateProvider>
                  <RightPanelCollapsedStateProvider>
                    <ApplicationShell />
                    <AboutDialog />
                    <AppBusyModal />
                    <Toaster />
                  </RightPanelCollapsedStateProvider>
                </BusyStateProvider>
              </PixelReadoutProvider>
            </FalseColorPreviewProvider>
            </RegionRequestProvider>
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
  const [pendingOpenImagesReplace, setPendingOpenImagesReplace] =
    useState<PendingOpenImagesReplace | null>(null);
  const [pendingOpenImagesReview, setPendingOpenImagesReview] =
    useState<OpenedFilesGroupingProposal | null>(null);
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
  const regionRequest = useRegionRequest();
  const falseColorPreview = useFalseColorPreview();
  const [activeActionParameterValues, setActiveActionParameterValues] =
    useState<ParameterValuesById>(NO_PARAMETER_VALUES);
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
  const handleOpenImagesRequested = useOpenImagesThroughDialogHandler({
    imagesByIndexRef,
    gridLayoutRef,
    setGridLayout,
    setImagesByIndex,
    setPendingOpenImagesReplace,
    setPendingOpenImagesReview,
    selectViewportFromClick,
    busyRegistrar,
  });
  useMenuOpenImageTriggersHandler(handleOpenImagesRequested);
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
  const singleSelectedSource = deriveSingleSelectedSource(selectedIndices, imagesByIndex, renderingApi);
  usePublishFalseColorPreview({
    activeAction,
    singleSelectedSource,
    imagesByIndex,
    parameterValues: activeActionParameterValues,
    falseColorPreview,
  });
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
  useRegionToolDeselectClearsInspectionRoi({
    isRegionToolActive: regionTool.isRegionToolActive,
    cellCount,
    renderingApi,
  });
  const regionRequestHandlers = buildToolPanelRegionRequestHandlers({
    activeSourceIndex: singleSelectedSource?.index ?? null,
    regionRequest,
    renderingApi,
    setActiveAction,
  });
  const handleApplyAction = (options: ToolOptionsApplyOptions) => {
    regionRequest.endRegionRequest();
    runApplyActionFromPanel(activeAction, singleSelectedSource, options, applyActionFlowBindings, setActiveAction);
  };
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
  const bandRemovalApi = useViewportBandRemovalApi(useLatestRef(applyActionFlowBindings));
  return (
    <div className="flex h-full flex-col">
      <Toolbar
        onOpenImage={handleOpenImagesRequested}
        gridLayout={gridLayout}
        onGridLayoutChange={handleGridLayoutChange}
        registeredActions={REGISTERED_VIEWPORT_ACTIONS}
        onInvokeAction={regionRequestHandlers.openActionPanel}
        getActionAvailability={(action) =>
          deriveActionAvailabilityForActiveViewport(action, singleSelectedSource, renderingApi)
        }
        isRegionToolActive={regionTool.isRegionToolActive}
        onToggleRegionTool={regionTool.toggleRegionTool}
        bandSubsetToggle={deriveBandSubsetToggleStateForToolbar(
          singleSelectedSource,
          imagesByIndex,
          renderingApi,
        )}
      />
      <ViewportDuplicationProvider value={duplicationApi}>
        <ViewportClosingProvider value={closingApi}>
          <ViewportReimportProvider value={reimportApi}>
            <ViewportBandRemovalProvider value={bandRemovalApi}>
              <ApplicationStageContent
                gridLayout={gridLayout}
                imagesByIndex={imagesByIndex}
                onOpenImage={handleOpenImagesRequested}
                activeAction={activeAction}
                sourceViewport={singleSelectedSource?.summary ?? null}
                rightPanelActiveSource={rightPanelActiveSource}
                onCancelAction={regionRequestHandlers.closeActionPanel}
                onApplyAction={handleApplyAction}
                onActiveActionParametersChange={setActiveActionParameterValues}
                onBeginRegionRequest={regionRequestHandlers.beginRegionRequest}
                onClearOperationRegion={regionRequestHandlers.clearOperationRegion}
              />
            </ViewportBandRemovalProvider>
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
        pending={pendingOpenImagesReplace}
        viewports={listOccupiedViewportEntries(imagesByIndex, cellCount, (content) => content.fileName)}
        onCancel={() => setPendingOpenImagesReplace(null)}
        onConfirm={(plan) =>
          confirmOpenImagesReplaceWithAssignments(plan, pendingOpenImagesReplace, {
            setImagesByIndex,
            setPendingOpenImagesReplace,
            selectViewportFromClick,
          })
        }
      />
      <OpenImagesReviewModal
        proposal={pendingOpenImagesReview}
        onCancel={() => setPendingOpenImagesReview(null)}
        onConfirm={(groups) =>
          void confirmOpenImagesReviewGroups(groups, {
            imagesByIndexRef,
            gridLayoutRef,
            setGridLayout,
            setImagesByIndex,
            setPendingOpenImagesReplace,
            setPendingOpenImagesReview,
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
  onActiveActionParametersChange: (values: ParameterValuesById) => void;
  onBeginRegionRequest: () => void;
  onClearOperationRegion: () => void;
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
        onParametersChange={props.onActiveActionParametersChange}
        onBeginRegionRequest={props.onBeginRegionRequest}
        onClearOperationRegion={props.onClearOperationRegion}
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

interface OpenImagesBindings {
  imagesByIndexRef: MutableRefObject<ImagesByIndexMap>;
  gridLayoutRef: MutableRefObject<GridLayout>;
  setGridLayout: SetGridLayout;
  setImagesByIndex: SetImagesByIndex;
  setPendingOpenImagesReplace: SetPendingOpenImagesReplace;
  setPendingOpenImagesReview: SetPendingOpenImagesReview;
  selectViewportFromClick: SelectViewportFromClick;
  busyRegistrar: BusyEntryRegistrar;
}

function useOpenImagesThroughDialogHandler(
  bindings: OpenImagesBindings,
): () => Promise<void> {
  const {
    imagesByIndexRef,
    gridLayoutRef,
    setGridLayout,
    setImagesByIndex,
    setPendingOpenImagesReplace,
    setPendingOpenImagesReview,
    selectViewportFromClick,
    busyRegistrar,
  } = bindings;
  return useCallback(
    () =>
      runOpenImagesDialogFlow({
        imagesByIndexRef,
        gridLayoutRef,
        setGridLayout,
        setImagesByIndex,
        setPendingOpenImagesReplace,
        setPendingOpenImagesReview,
        selectViewportFromClick,
        busyRegistrar,
      }),
    [
      imagesByIndexRef,
      gridLayoutRef,
      setGridLayout,
      setImagesByIndex,
      setPendingOpenImagesReplace,
      setPendingOpenImagesReview,
      selectViewportFromClick,
      busyRegistrar,
    ],
  );
}

async function runOpenImagesDialogFlow(bindings: OpenImagesBindings): Promise<void> {
  const handle = bindings.busyRegistrar.registerAppBusyEntry({
    label: "Reading files...",
    progress: 0,
  });
  try {
    await runOpenImagesDialogPhaseAndDispatchOutcome(bindings, handle);
  } catch (error) {
    toast.error(`Could not open images: ${describeUnknownError(error)}`);
  } finally {
    handle.clear();
  }
}

async function runOpenImagesDialogPhaseAndDispatchOutcome(
  bindings: OpenImagesBindings,
  handle: BusyEntryHandle,
): Promise<void> {
  const result = await runOpenImagesDialogPhase({ readPhaseBusyHandle: handle });
  if (result.kind === "canceled") return;
  if (result.kind === "single-file") {
    await routeSingleFileFastPathThroughOpenImages(result.file, bindings);
    return;
  }
  bindings.setPendingOpenImagesReview(result.proposal);
}

async function routeSingleFileFastPathThroughOpenImages(
  file: OpenedFileForGrouping,
  bindings: OpenImagesBindings,
): Promise<void> {
  if (file.decodeError !== null || file.source === null) {
    toast.error(`Could not open ${file.fileName}: ${file.decodeError ?? "decode failed"}`);
    return;
  }
  routeSingleSourceToViewportPlacement(
    {
      fileName: file.fileName,
      source: file.source,
      originalFilePath: file.filePath,
      fileSizeBytes: file.fileSizeBytes,
    },
    bindings,
  );
}

function routeSingleSourceToViewportPlacement(
  pending: PendingOpenImageReplaceItem,
  bindings: OpenImagesBindings,
): void {
  const plan = planOpenImagePlacement({
    currentLayout: bindings.gridLayoutRef.current,
    imagesByIndex: bindings.imagesByIndexRef.current,
  });
  applyOpenImagePlacementPlan(plan, pending, bindings);
}

function applyOpenImagePlacementPlan(
  plan: OpenImagePlacementPlan,
  pending: PendingOpenImageReplaceItem,
  bindings: OpenImagesBindings,
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
  bindings.setPendingOpenImagesReplace({ items: [pending] });
}

interface ApplyLoadedImageBindings {
  setImagesByIndex: SetImagesByIndex;
  selectViewportFromClick: SelectViewportFromClick;
}

function applyLoadedImageAtIndex(
  index: number,
  pending: PendingOpenImageReplaceItem,
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
  setPendingOpenImagesReplace: SetPendingOpenImagesReplace;
}

function confirmOpenImagesReplaceWithAssignments(
  plan: ConfirmedOpenImagesReplacePlan,
  pending: PendingOpenImagesReplace | null,
  bindings: ConfirmReplaceBindings,
): void {
  bindings.setPendingOpenImagesReplace(null);
  if (!pending) return;
  for (const { itemIndex, targetIndex } of plan.assignments) {
    const item = pending.items[itemIndex];
    if (!item) continue;
    applyLoadedImageAtIndex(targetIndex, item, bindings);
  }
}

interface ConfirmReviewBindings extends OpenImagesBindings {
  setPendingOpenImagesReview: SetPendingOpenImagesReview;
}

async function confirmOpenImagesReviewGroups(
  groups: ReadonlyArray<OpenedFilesGroup>,
  bindings: ConfirmReviewBindings,
): Promise<void> {
  bindings.setPendingOpenImagesReview(null);
  try {
    const pendingItems = await buildPendingItemsFromConfirmedGroups(groups, bindings);
    if (pendingItems.length === 0) return;
    placePendingItemsAcrossViewports(pendingItems, bindings);
  } catch (error) {
    toast.error(`Could not place images: ${describeUnknownError(error)}`);
  }
}

async function buildPendingItemsFromConfirmedGroups(
  groups: ReadonlyArray<OpenedFilesGroup>,
  bindings: ConfirmReviewBindings,
): Promise<ReadonlyArray<PendingOpenImageReplaceItem>> {
  const items: PendingOpenImageReplaceItem[] = [];
  for (const group of groups) {
    if (group.mode === "stack" && group.rows.length >= 2) {
      items.push(await buildStackedItemFromGroup(group, bindings));
    } else {
      for (const row of group.rows) items.push(buildSingleImageItemFromRow(row));
    }
  }
  return items;
}

async function buildStackedItemFromGroup(
  group: OpenedFilesGroup,
  bindings: ConfirmReviewBindings,
): Promise<PendingOpenImageReplaceItem> {
  const handle = bindings.busyRegistrar.registerAppBusyEntry({
    label: `Stacking ${group.rows.length} rows...`,
    progress: 0,
  });
  try {
    const entries = group.rows.map(convertGroupRowToDecodedStackEntry);
    const built = await buildConfirmedStackFromOrderedEntriesWithProgress(entries, handle);
    const fileSizeBytes = group.rows.reduce((sum, row) => sum + row.fileSizeBytes, 0);
    return {
      fileName: built.suggestedFileName,
      source: { kind: "raster", raster: built.raster },
      fileSizeBytes,
    };
  } finally {
    handle.clear();
  }
}

function convertGroupRowToDecodedStackEntry(row: GroupedOpenedFileRow): DecodedStackEntry {
  return {
    fileName: row.fileName,
    filePath: row.filePath,
    fileSizeBytes: row.fileSizeBytes,
    mtimeMs: row.mtimeMs,
    raster: row.source && row.source.kind === "raster" ? row.source.raster : null,
    decodeError: row.decodeError,
    wavelength: row.wavelength,
    differentiatingSubstring: row.differentiatingSubstring,
  };
}

function buildSingleImageItemFromRow(row: GroupedOpenedFileRow): PendingOpenImageReplaceItem {
  if (row.source === null) {
    throw new Error(`Cannot open ${row.fileName}: ${row.decodeError ?? "unknown decode error"}`);
  }
  return {
    fileName: row.fileName,
    source: row.source,
    originalFilePath: row.filePath,
    fileSizeBytes: row.fileSizeBytes,
  };
}

function placePendingItemsAcrossViewports(
  items: ReadonlyArray<PendingOpenImageReplaceItem>,
  bindings: ConfirmReviewBindings,
): void {
  const plan = planOpenImagesPlacement({
    currentLayout: bindings.gridLayoutRef.current,
    imagesByIndex: bindings.imagesByIndexRef.current,
    newItemCount: items.length,
  });
  applyOpenImagesPlacementPlan(plan, items, bindings);
}

function applyOpenImagesPlacementPlan(
  plan: OpenImagesPlacementPlan,
  items: ReadonlyArray<PendingOpenImageReplaceItem>,
  bindings: ConfirmReviewBindings,
): void {
  if (plan.kind === "growFillThenPromptReplace") {
    applyGrowFillThenPromptReplacePlan(plan, items, bindings);
    return;
  }
  if (plan.expandedLayout !== undefined) {
    bindings.setGridLayout(plan.expandedLayout);
  }
  placeItemsAtTargetIndices(plan.targetIndices, items, bindings);
}

function applyGrowFillThenPromptReplacePlan(
  plan: Extract<OpenImagesPlacementPlan, { kind: "growFillThenPromptReplace" }>,
  items: ReadonlyArray<PendingOpenImageReplaceItem>,
  bindings: ConfirmReviewBindings,
): void {
  if (plan.expandedLayout !== undefined) {
    bindings.setGridLayout(plan.expandedLayout);
  }
  placeItemsAtTargetIndices(plan.filledTargetIndices, items, bindings);
  const overflowItems = items.slice(plan.filledTargetIndices.length);
  if (overflowItems.length > 0) {
    bindings.setPendingOpenImagesReplace({ items: overflowItems });
  }
}

function placeItemsAtTargetIndices(
  targetIndices: ReadonlyArray<number>,
  items: ReadonlyArray<PendingOpenImageReplaceItem>,
  bindings: ApplyLoadedImageBindings,
): void {
  for (let i = 0; i < targetIndices.length && i < items.length; i++) {
    applyLoadedImageAtIndex(targetIndices[i]!, items[i]!, bindings);
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
  const result = await invokeOpenImageDialogForReimportSafely();
  if (!result || result.canceled) return;
  await replaceViewportSourceWithReimportedFile(viewportIndex, result, bindings);
}

async function invokeOpenImageDialogForReimportSafely(): Promise<ToolboxOpenImageDialogResult | null> {
  try {
    return await window.toolboxApi.openImageDialog();
  } catch (error) {
    toast.error(`Could not open the file dialog: ${describeUnknownError(error)}`);
    return null;
  }
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

interface ToolPanelRegionRequestHandlerInputs {
  readonly activeSourceIndex: number | null;
  readonly regionRequest: RegionRequestApi;
  readonly renderingApi: ViewportRenderingApi;
  readonly setActiveAction: SetActiveAction;
}

interface ToolPanelRegionRequestHandlers {
  readonly openActionPanel: (action: RegisteredViewportAction) => void;
  readonly closeActionPanel: () => void;
  readonly beginRegionRequest: () => void;
  readonly clearOperationRegion: () => void;
}

function buildToolPanelRegionRequestHandlers(
  inputs: ToolPanelRegionRequestHandlerInputs,
): ToolPanelRegionRequestHandlers {
  return {
    openActionPanel: (action) => openToolPanelClearingAnyRegionRequest(action, inputs),
    closeActionPanel: () => closeToolPanelClearingAnyRegionRequest(inputs),
    beginRegionRequest: () => beginOperationRegionRequestForActiveSource(inputs),
    clearOperationRegion: () => clearOperationRegionOnActiveSource(inputs),
  };
}

function openToolPanelClearingAnyRegionRequest(
  action: RegisteredViewportAction,
  inputs: ToolPanelRegionRequestHandlerInputs,
): void {
  inputs.regionRequest.endRegionRequest();
  clearOperationRegionOnActiveSource(inputs);
  inputs.setActiveAction(action);
}

function closeToolPanelClearingAnyRegionRequest(inputs: ToolPanelRegionRequestHandlerInputs): void {
  inputs.regionRequest.endRegionRequest();
  clearOperationRegionOnActiveSource(inputs);
  inputs.setActiveAction(null);
}

function beginOperationRegionRequestForActiveSource(
  inputs: ToolPanelRegionRequestHandlerInputs,
): void {
  if (inputs.activeSourceIndex === null) return;
  inputs.regionRequest.beginRegionRequest(inputs.activeSourceIndex);
}

function clearOperationRegionOnActiveSource(inputs: ToolPanelRegionRequestHandlerInputs): void {
  if (inputs.activeSourceIndex === null) return;
  const state = inputs.renderingApi.getRenderingState(inputs.activeSourceIndex);
  if (!state.operationRegion) return;
  inputs.renderingApi.setRenderingState(inputs.activeSourceIndex, { ...state, operationRegion: null });
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
  renderingApi: ViewportRenderingApi,
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
      operationRegion: renderingApi.getRenderingState(onlyIndex).operationRegion,
      sourceBandCount: readRasterBandCountFromContentOrNull(content),
    },
  };
}

function readRasterBandCountFromContentOrNull(content: ViewportCellContent): number | null {
  return content.source.kind === "raster" ? content.source.raster.bandCount : null;
}

interface PublishFalseColorPreviewInputs {
  readonly activeAction: RegisteredViewportAction | null;
  readonly singleSelectedSource: SingleSelectedSource | null;
  readonly imagesByIndex: ImagesByIndexMap;
  readonly parameterValues: ParameterValuesById;
  readonly falseColorPreview: FalseColorPreviewApi;
}

function usePublishFalseColorPreview(inputs: PublishFalseColorPreviewInputs): void {
  const raster = resolveFalseColorPreviewRasterOrNull(
    inputs.activeAction,
    inputs.singleSelectedSource,
    inputs.imagesByIndex,
  );
  const assignment = useMemo(
    () => readFalseColorBandAssignment(inputs.parameterValues),
    [inputs.parameterValues],
  );
  const previewSource = useMemo(
    () => (raster ? buildFalseColorPreviewSourceOrNull(raster, assignment) : null),
    [raster, assignment],
  );
  const sourceIndex = inputs.singleSelectedSource?.index ?? null;
  usePublishPreviewSourceForViewport(inputs.falseColorPreview.setPreview, previewSource, sourceIndex);
}

function resolveFalseColorPreviewRasterOrNull(
  activeAction: RegisteredViewportAction | null,
  singleSelectedSource: SingleSelectedSource | null,
  imagesByIndex: ImagesByIndexMap,
): RasterImage | null {
  if (!activeAction || activeAction.id !== "false-color" || !singleSelectedSource) return null;
  const content = imagesByIndex.get(singleSelectedSource.index);
  if (!content || content.source.kind !== "raster") return null;
  return content.source.raster;
}

function usePublishPreviewSourceForViewport(
  setPreview: FalseColorPreviewApi["setPreview"],
  previewSource: ViewportImageSource | null,
  sourceIndex: number | null,
): void {
  useEffect(() => {
    setPreview(buildFalseColorPreviewOrNull(previewSource, sourceIndex));
    return () => setPreview(null);
  }, [setPreview, previewSource, sourceIndex]);
}

function buildFalseColorPreviewOrNull(
  source: ViewportImageSource | null,
  sourceIndex: number | null,
): FalseColorPreview | null {
  if (source === null || sourceIndex === null) return null;
  return { viewportIndex: sourceIndex, source };
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

function extractImageSourceKindFromContentOrNull(
  content: ViewportCellContent | null,
): ViewportRightPanelActiveSource["imageSourceKind"] {
  if (!content) return null;
  if (content.source.kind === "raster") return "raster";
  return "browser-source";
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
    viewportIndex,
    viewportNumber: getViewportNumberFromIndex(viewportIndex),
    metadata: buildMetadataDisplayForActiveContentOrNull(content, currentProjectFilePath),
    raster,
    imageSourceKind: extractImageSourceKindFromContentOrNull(content),
    selectedBandIndex: renderingState.selectedBandIndex,
    onSelectBandIndex: (bandIndex) =>
      renderingApi.setRenderingState(viewportIndex, {
        ...renderingState,
        selectedBandIndex: bandIndex,
      }),
    removedBandIndexes: renderingState.removedBandIndexes,
    isBandSubsetEditModeActive: renderingState.isBandSubsetEditModeActive,
    onEnterBandSubsetEditMode: () =>
      setBandSubsetEditModeActiveAtViewport(viewportIndex, true, renderingApi),
    onExitBandSubsetEditMode: () =>
      setBandSubsetEditModeActiveAtViewport(viewportIndex, false, renderingApi),
    onApplyBandSubset: (options) =>
      runApplyBandSubsetForViewport({
        viewportIndex,
        raster,
        removedBandIndexes: options.removedBandIndexes,
        openInNewViewport: options.openInNewViewport,
        applyActionFlowBindings: inputs.applyActionFlowBindings,
      }),
    operationHistory: renderingState.operationHistory,
    roi: renderingState.roi,
    onClearRoi: () =>
      renderingApi.setRenderingState(viewportIndex, { ...renderingState, roi: null }),
    pinnedSpectra: renderingState.pinnedSpectra,
    pinnedRoiSpectra: renderingState.pinnedRoiSpectra,
    activeRoiMeanSpectrum: buildRoiMeanSpectrumForDisplayOrNull(raster, renderingState.roi),
    onRemovePinnedSpectrum: (spectrumId) =>
      renderingApi.setRenderingState(viewportIndex, {
        ...renderingState,
        pinnedSpectra: removePinnedSpectrumById(renderingState.pinnedSpectra, spectrumId),
      }),
    onRemovePinnedRoiSpectrum: (spectrumId) =>
      renderingApi.setRenderingState(viewportIndex, {
        ...renderingState,
        pinnedRoiSpectra: removeRoiSpectrumById(renderingState.pinnedRoiSpectra, spectrumId),
      }),
  };
}

interface ApplyBandSubsetInputs {
  readonly viewportIndex: number;
  readonly raster: ViewportRightPanelActiveSource["raster"];
  readonly removedBandIndexes: ReadonlyArray<number>;
  readonly openInNewViewport: boolean;
  readonly applyActionFlowBindings: ApplyActionFlowBindings;
}

function runApplyBandSubsetForViewport(inputs: ApplyBandSubsetInputs): void {
  const keptBandNumbers = pickKeptBandOriginalNumbersForSubsetOrNull(inputs);
  if (keptBandNumbers === null) return;
  invokeBandSubsetActionOnSourceViewport(
    inputs.viewportIndex,
    keptBandNumbers,
    inputs.openInNewViewport,
    inputs.applyActionFlowBindings,
  );
}

function pickKeptBandOriginalNumbersForSubsetOrNull(
  inputs: ApplyBandSubsetInputs,
): ReadonlyArray<number> | null {
  const { raster, removedBandIndexes } = inputs;
  if (!raster) {
    toast.error("Subset Bands requires a raster source.");
    return null;
  }
  const keptBandIndexes = listKeptBandIndexesFromRemoved(raster.bandCount, removedBandIndexes);
  if (keptBandIndexes.length === 0) {
    toast.error("Keep at least one band before applying.");
    return null;
  }
  if (keptBandIndexes.length === raster.bandCount) {
    toast.info("Uncheck a band to remove it on apply.");
    return null;
  }
  return keptBandIndexes.map((bandIndex) => getRasterBandOriginalNumber(raster, bandIndex));
}

function invokeBandSubsetActionOnSourceViewport(
  sourceIndex: number,
  keptBandNumbers: ReadonlyArray<number>,
  openInNewViewport: boolean,
  bindings: ApplyActionFlowBindings,
): void {
  const parameterValues = buildBandSubsetParameterValuesFromKeptNumbers(keptBandNumbers);
  if (openInNewViewport) {
    applyActionToDuplicateOfSource(BAND_SUBSET_ACTION, parameterValues, sourceIndex, bindings);
    return;
  }
  applyActionInPlaceAtSourceIndex(BAND_SUBSET_ACTION, parameterValues, sourceIndex, bindings);
}

function useViewportBandRemovalApi(
  bindingsRef: MutableRefObject<ApplyActionFlowBindings>,
): ViewportBandRemovalApi {
  return useMemo(
    () => ({
      removeBand: (viewportIndex: number, bandIndex: number) =>
        removeSingleBandFromViewportInPlace(viewportIndex, bandIndex, bindingsRef.current),
    }),
    [bindingsRef],
  );
}

function removeSingleBandFromViewportInPlace(
  viewportIndex: number,
  bandIndex: number,
  bindings: ApplyActionFlowBindings,
): void {
  const raster = extractRasterFromContentOrNull(bindings.imagesByIndex.get(viewportIndex) ?? null);
  const keptBandNumbers = pickKeptBandNumbersAfterSingleRemovalOrNull(raster, bandIndex);
  if (keptBandNumbers === null) return;
  invokeBandSubsetActionOnSourceViewport(viewportIndex, keptBandNumbers, false, bindings);
}

function pickKeptBandNumbersAfterSingleRemovalOrNull(
  raster: RasterImage | null,
  removedBandIndex: number,
): ReadonlyArray<number> | null {
  if (!raster) {
    toast.error("Removing a band requires a raster source.");
    return null;
  }
  if (raster.bandCount <= 1) {
    toast.info("Cannot remove the last remaining band.");
    return null;
  }
  return listKeptBandOriginalNumbersAfterRemovingBand(raster, removedBandIndex);
}

function setBandSubsetEditModeActiveAtViewport(
  viewportIndex: number,
  isActive: boolean,
  renderingApi: ViewportRenderingApi,
): void {
  const previous = renderingApi.getRenderingState(viewportIndex);
  if (previous.isBandSubsetEditModeActive === isActive) return;
  renderingApi.setRenderingState(viewportIndex, {
    ...previous,
    isBandSubsetEditModeActive: isActive,
  });
}

function deriveBandSubsetToggleStateForToolbar(
  singleSelectedSource: SingleSelectedSource | null,
  imagesByIndex: ImagesByIndexMap,
  renderingApi: ViewportRenderingApi,
): BandSubsetToolbarToggleState {
  if (!singleSelectedSource) return DISABLED_BAND_SUBSET_TOOLBAR_TOGGLE;
  const viewportIndex = singleSelectedSource.index;
  const raster = extractRasterFromContentOrNull(imagesByIndex.get(viewportIndex) ?? null);
  if (!raster || raster.bandCount < 2) return DISABLED_BAND_SUBSET_TOOLBAR_TOGGLE;
  const isActive = renderingApi.getRenderingState(viewportIndex).isBandSubsetEditModeActive;
  return {
    isAvailable: true,
    isActive,
    onToggle: () => setBandSubsetEditModeActiveAtViewport(viewportIndex, !isActive, renderingApi),
  };
}

const DISABLED_BAND_SUBSET_TOOLBAR_TOGGLE: BandSubsetToolbarToggleState = {
  isAvailable: false,
  isActive: false,
  onToggle: () => {},
};

function buildRoiMeanSpectrumForDisplayOrNull(
  raster: ViewportRightPanelActiveSource["raster"],
  roi: ViewportRightPanelActiveSource["roi"],
): ViewportRightPanelActiveSource["activeRoiMeanSpectrum"] {
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

interface RegionToolDeselectClearRoiBindings {
  readonly isRegionToolActive: boolean;
  readonly cellCount: number;
  readonly renderingApi: ViewportRenderingApi;
}

function useRegionToolDeselectClearsInspectionRoi(
  bindings: RegionToolDeselectClearRoiBindings,
): void {
  const { isRegionToolActive, cellCount, renderingApi } = bindings;
  const wasRegionToolActiveRef = useRef(isRegionToolActive);
  useEffect(() => {
    if (wasRegionToolActiveRef.current && !isRegionToolActive) {
      clearInspectionRoiOnEveryViewport(cellCount, renderingApi);
    }
    wasRegionToolActiveRef.current = isRegionToolActive;
  }, [isRegionToolActive, cellCount, renderingApi]);
}

function clearInspectionRoiOnEveryViewport(
  cellCount: number,
  renderingApi: ViewportRenderingApi,
): void {
  for (let index = 0; index < cellCount; index += 1) {
    const renderingState = renderingApi.getRenderingState(index);
    if (!renderingState.roi) continue;
    renderingApi.setRenderingState(index, { ...renderingState, roi: null });
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
    options.applyScope,
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
  if (action.id === "black-white-points") return "drag the histogram black/white markers first";
  return "not available for this viewport";
}

function mergeParameterValuesWithSourceRenderingState(
  action: RegisteredViewportAction,
  rawParameterValues: ParameterValuesById,
  sourceRenderingState: ViewportRenderingState,
  applyScope: ApplyScope,
): ParameterValuesById | null {
  if (!action.prepareParameterValuesForApply) return rawParameterValues;
  try {
    return action.prepareParameterValuesForApply(rawParameterValues, sourceRenderingState, applyScope);
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
    await letBusyIndicatorPaintBeforeHeavySaveWork(snapshot);
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

// When the save will re-encode a raster (the slow path), yield long enough for
// the "Saving project..." indicator to paint before the synchronous bake blocks
// the renderer thread, so the save never feels frozen (CT-072). Saves that only
// reference unmodified on-disk files skip the wait and stay flash-free.
async function letBusyIndicatorPaintBeforeHeavySaveWork(
  snapshot: SaveableProjectSnapshot,
): Promise<void> {
  if (!saveableSnapshotRequiresRasterRebake(snapshot)) return;
  await waitForBusyIndicatorToClearAntiFlashThreshold();
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
