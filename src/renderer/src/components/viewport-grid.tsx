import { useCallback, type MouseEvent } from "react";

import { ViewportBusyOverlay } from "@/components/busy-indicators";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Viewport } from "@/components/viewport";
import {
  getGridLayoutCellCount,
  getGridLayoutTailwindTrackClasses,
  getViewportNumberFromIndex,
  type GridLayout,
} from "@/lib/grid/grid-layout";
import { computePixelSpectrumOrNull } from "@/lib/image/compute-spectrum";
import {
  appendPinnedSpectrumWithCapLimit,
  buildPinnedSpectrumIdFromTimestamp,
  type PinnedSpectrum,
} from "@/lib/image/spectrum-entry";
import type { ViewportRoi } from "@/lib/image/viewport-roi";
import { cn } from "@/lib/utils";
import type { ViewportImageSource } from "@/lib/webgl/texture";
import { useViewportClosing } from "@/state/closing-context";
import { useViewportDuplication } from "@/state/duplication-context";
import { useFalseColorPreview } from "@/state/false-color-preview-context";
import { useRegionTool } from "@/state/region-tool-context";
import { useViewportReimport } from "@/state/reimport-context";
import { useViewportRendering } from "@/state/viewport-rendering-context";
import {
  useViewportSelection,
  type ViewportSelectionClickModifiers,
} from "@/state/selection-context";

export interface ViewportCellContent {
  fileName: string;
  source: ViewportImageSource;
  originalFilePath?: string;
  fileSizeBytes?: number;
}

interface ViewportGridProps {
  layout: GridLayout;
  cellsByIndex: ReadonlyMap<number, ViewportCellContent>;
  onOpenImage: () => void;
}

export function ViewportGrid(props: ViewportGridProps): JSX.Element {
  const cellCount = getGridLayoutCellCount(props.layout);
  const trackClasses = getGridLayoutTailwindTrackClasses(props.layout);
  return (
    <div
      role="grid"
      aria-label="Viewport grid"
      className={cn("grid h-full w-full gap-2", trackClasses)}
    >
      {renderViewportCells(cellCount, props)}
    </div>
  );
}

function renderViewportCells(
  cellCount: number,
  props: ViewportGridProps,
): ReadonlyArray<JSX.Element> {
  return Array.from({ length: cellCount }, (_, cellIndex) => (
    <ViewportCell
      key={cellIndex}
      cellIndex={cellIndex}
      viewportNumber={getViewportNumberFromIndex(cellIndex)}
      content={props.cellsByIndex.get(cellIndex) ?? null}
      onOpenImage={props.onOpenImage}
    />
  ));
}

interface ViewportCellProps {
  cellIndex: number;
  viewportNumber: number;
  content: ViewportCellContent | null;
  onOpenImage: () => void;
}

function ViewportCell(props: ViewportCellProps): JSX.Element {
  const settings = useViewportCellInteractionSettings(props.cellIndex, props.content);
  const cellElement = renderViewportCellGridcellElement(props, settings);
  if (!props.content) return cellElement;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{cellElement}</ContextMenuTrigger>
      <ViewportCellContextMenuContent sourceIndex={props.cellIndex} />
    </ContextMenu>
  );
}

function renderViewportCellGridcellElement(
  props: ViewportCellProps,
  settings: ViewportCellInteractionSettings,
): JSX.Element {
  return (
    <div
      role="gridcell"
      aria-selected={settings.isSelected}
      onClick={settings.handleClick}
      className={getViewportCellClassName(settings.isSelected)}
    >
      {renderViewportCellViewport(props, settings)}
      <ViewportBusyOverlay viewportIndex={props.cellIndex} />
    </div>
  );
}

function renderViewportCellViewport(
  props: ViewportCellProps,
  settings: ViewportCellInteractionSettings,
): JSX.Element {
  return (
    <Viewport
      viewportNumber={props.viewportNumber}
      imageSource={props.content?.source ?? null}
      previewImageSource={settings.previewImageSource}
      fileName={props.content?.fileName ?? null}
      normalizationEnabled={settings.normalizationEnabled}
      onToggleNormalizedViewing={settings.handleToggleNormalizedViewing}
      selectedBandIndex={settings.selectedBandIndex}
      onSelectBandIndex={settings.handleSelectBandIndex}
      lastAppliedOperationLabel={settings.lastAppliedOperationLabel}
      isRegionToolActive={settings.isRegionToolActive}
      roi={settings.roi}
      onCommitRoi={settings.handleCommitRoi}
      onPinPixelSpectrum={settings.handlePinPixelSpectrum}
      onOpenImage={props.onOpenImage}
      onClose={settings.handleClose}
    />
  );
}

function ViewportCellContextMenuContent(props: { sourceIndex: number }): JSX.Element {
  return (
    <ContextMenuContent>
      <DuplicateContextMenuItem sourceIndex={props.sourceIndex} />
      <ReimportSourceContextMenuItem sourceIndex={props.sourceIndex} />
      <CloseContextMenuItem sourceIndex={props.sourceIndex} />
    </ContextMenuContent>
  );
}

interface ViewportCellInteractionSettings {
  isSelected: boolean;
  handleClick: (event: MouseEvent<HTMLDivElement>) => void;
  handleClose: (() => void) | undefined;
  previewImageSource: ViewportImageSource | null;
  normalizationEnabled: boolean;
  handleToggleNormalizedViewing: () => void;
  selectedBandIndex: number;
  handleSelectBandIndex: (bandIndex: number) => void;
  lastAppliedOperationLabel: string | null;
  isRegionToolActive: boolean;
  roi: ViewportRoi | null;
  handleCommitRoi: (roi: ViewportRoi) => void;
  handlePinPixelSpectrum: (imageX: number, imageY: number) => void;
}

function useViewportCellInteractionSettings(
  cellIndex: number,
  content: ViewportCellContent | null,
): ViewportCellInteractionSettings {
  const { isViewportSelected, selectViewportFromClick } = useViewportSelection();
  const { getRenderingState, setRenderingState } = useViewportRendering();
  const { isRegionToolActive } = useRegionTool();
  const { getPreviewSourceForViewport } = useFalseColorPreview();
  const closing = useViewportClosing();
  const isSelected = isViewportSelected(cellIndex);
  const renderingState = getRenderingState(cellIndex);
  const handleClick = (event: MouseEvent<HTMLDivElement>) =>
    selectViewportFromClick(cellIndex, extractClickModifiers(event));
  const handleClose = closing.hasContent(cellIndex)
    ? () => closing.closeViewport(cellIndex)
    : undefined;
  const handleCommitRoi = useCallback(
    (roi: ViewportRoi) => {
      setRenderingState(cellIndex, { ...renderingState, roi });
      selectViewportFromClick(cellIndex, { ctrlOrMeta: false, shift: false });
    },
    [cellIndex, renderingState, setRenderingState, selectViewportFromClick],
  );
  const handlePinPixelSpectrum = useCallback(
    (imageX: number, imageY: number) => {
      const next = buildPinnedPixelSpectrumFromImagePoint(content, imageX, imageY);
      if (!next) return;
      setRenderingState(cellIndex, {
        ...renderingState,
        pinnedSpectra: appendPinnedSpectrumWithCapLimit(renderingState.pinnedSpectra, next),
      });
      selectViewportFromClick(cellIndex, { ctrlOrMeta: false, shift: false });
    },
    [cellIndex, content, renderingState, setRenderingState, selectViewportFromClick],
  );
  const handleToggleNormalizedViewing = useCallback(
    () =>
      setRenderingState(cellIndex, {
        ...renderingState,
        normalizationEnabled: !renderingState.normalizationEnabled,
      }),
    [cellIndex, renderingState, setRenderingState],
  );
  const handleSelectBandIndex = useCallback(
    (bandIndex: number) =>
      setRenderingState(cellIndex, { ...renderingState, selectedBandIndex: bandIndex }),
    [cellIndex, renderingState, setRenderingState],
  );
  return {
    isSelected,
    handleClick,
    handleClose,
    previewImageSource: getPreviewSourceForViewport(cellIndex),
    normalizationEnabled: renderingState.normalizationEnabled,
    handleToggleNormalizedViewing,
    selectedBandIndex: renderingState.selectedBandIndex,
    handleSelectBandIndex,
    lastAppliedOperationLabel: renderingState.lastAppliedOperationLabel,
    isRegionToolActive,
    roi: renderingState.roi,
    handleCommitRoi,
    handlePinPixelSpectrum,
  };
}

function buildPinnedPixelSpectrumFromImagePoint(
  content: ViewportCellContent | null,
  imageX: number,
  imageY: number,
): PinnedSpectrum | null {
  if (!content || content.source.kind !== "raster") return null;
  const spectrum = computePixelSpectrumOrNull(content.source.raster, imageX, imageY);
  if (!spectrum) return null;
  return {
    kind: "pixel",
    id: buildPinnedSpectrumIdFromTimestamp(Date.now(), Math.random()),
    imagePixelX: imageX,
    imagePixelY: imageY,
    bandValues: spectrum.bandValues,
  };
}

function getViewportCellClassName(isSelected: boolean): string {
  return cn(
    "relative min-h-0 min-w-0 rounded-md transition-shadow",
    isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
  );
}

function extractClickModifiers(event: MouseEvent<HTMLDivElement>): ViewportSelectionClickModifiers {
  return {
    ctrlOrMeta: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
  };
}

function DuplicateContextMenuItem(props: { sourceIndex: number }): JSX.Element {
  const duplication = useViewportDuplication();
  return (
    <ContextMenuItem onSelect={() => duplication.requestDuplicate(props.sourceIndex)}>
      Duplicate
    </ContextMenuItem>
  );
}

function CloseContextMenuItem(props: { sourceIndex: number }): JSX.Element {
  const closing = useViewportClosing();
  return (
    <ContextMenuItem onSelect={() => closing.closeViewport(props.sourceIndex)}>
      Close
    </ContextMenuItem>
  );
}

function ReimportSourceContextMenuItem(props: { sourceIndex: number }): JSX.Element {
  const reimport = useViewportReimport();
  return (
    <ContextMenuItem onSelect={() => reimport.requestReimport(props.sourceIndex)}>
      Re-import source from disk
    </ContextMenuItem>
  );
}
