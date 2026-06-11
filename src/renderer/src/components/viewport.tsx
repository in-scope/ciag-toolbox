import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { MutableRefObject, RefObject } from "react";
import { Contrast, FolderOpen, X } from "lucide-react";
import { toast } from "sonner";

import { ViewportBandNavigator } from "@/components/viewport-band-navigator";
import { formatViewportHeaderLabel } from "@/components/viewport-header-label";
import { ViewportRoiOverlay } from "@/components/viewport-roi-overlay";
import type { RasterImage } from "@/lib/image/raster-image";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { readPixelReadoutBandsAtImagePointOrNull } from "@/lib/image/compute-pixel-readout";
import type { ClickedImagePixel } from "@/lib/image/roi-selection-lifecycle";
import {
  canonicalizeViewportRoiCorners,
  clampViewportRoiToImageBounds,
  isViewportRoiLargerThanMinimumSide,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";
import { attachPanZoomEventHandlers } from "@/lib/webgl/pan-zoom-input";
import { attachPixelClickEventHandlers } from "@/lib/webgl/pixel-click-input";
import {
  attachPointerReadoutEventHandlers,
  type CanvasCursorPositionPx,
} from "@/lib/webgl/pointer-readout-input";
import {
  attachRoiDrawEventHandlers,
  type RoiDrawAttachment,
  type RoiDrawCanvasRect,
} from "@/lib/webgl/roi-draw-input";
import { getImageSourceDimensions, type ViewportImageSource } from "@/lib/webgl/texture";
import { ViewportRenderer } from "@/lib/webgl/viewport-renderer";
import {
  usePixelReadoutPublisher,
  type PixelReadoutPublisher,
  type ViewportPixelReadoutSnapshot,
} from "@/state/pixel-readout-context";

interface ViewportProps {
  imageSource?: ViewportImageSource | null;
  previewImageSource?: ViewportImageSource | null;
  fileName?: string | null;
  viewportNumber?: number | null;
  normalizationEnabled: boolean;
  onToggleNormalizedViewing: () => void;
  selectedBandIndex: number;
  onSelectBandIndex: (bandIndex: number) => void;
  onRemoveBand?: (bandIndex: number) => void;
  lastAppliedOperationLabel?: string | null;
  isRegionToolActive: boolean;
  roi: ViewportRoi | null;
  onCommitRoi: (roi: ViewportRoi) => void;
  onRegionToolPlainClick: (clickedImagePixel: ClickedImagePixel | null) => void;
  onPinPixelSpectrum: (imageX: number, imageY: number) => void;
  onOpenImage: () => void;
  onClose?: () => void;
}

export function Viewport(props: ViewportProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<ViewportRenderer | null>(null);
  const roiDrawAttachmentRef = useRef<RoiDrawAttachment | null>(null);
  const imageSource = props.imageSource ?? null;
  const displaySource = props.previewImageSource ?? imageSource;
  const viewportAriaLabel = describeViewportAriaLabel(props.viewportNumber);
  const [inProgressDragRect, setInProgressDragRect] = useState<RoiDrawCanvasRect | null>(null);

  useViewportRendererLifecycle(canvasRef, rendererRef);
  useImageSourceUploadEffect(rendererRef, displaySource, props.selectedBandIndex);
  useSelectedBandIndexEffect(rendererRef, displaySource, props.selectedBandIndex);
  useNormalizationToggleEffect(rendererRef, props.normalizationEnabled);
  useCanvasResizeObserverEffect(canvasRef, rendererRef);
  useViewportPanZoomInteractions(canvasRef, rendererRef, props.isRegionToolActive);
  useViewportPixelReadoutPublisher(canvasRef, rendererRef, {
    viewportNumber: props.viewportNumber ?? null,
    imageSource,
    selectedBandIndex: props.selectedBandIndex,
  });
  useViewportRoiDrawAttachment(canvasRef, roiDrawAttachmentRef, {
    isRegionToolActive: props.isRegionToolActive,
    imageSource,
    rendererRef,
    onCommitRoi: props.onCommitRoi,
    onRegionToolPlainClick: props.onRegionToolPlainClick,
    setInProgressDragRect,
  });
  useDiscardInProgressDragWhenRegionToolDeactivates(
    roiDrawAttachmentRef,
    props.isRegionToolActive,
  );
  useViewportPixelClickPinAttachment(canvasRef, {
    isRegionToolActive: props.isRegionToolActive,
    imageSource,
    rendererRef,
    onPinPixelSpectrum: props.onPinPixelSpectrum,
  });
  const transformVersion = useRendererViewTransformVersion(rendererRef);
  const cursorClassName = props.isRegionToolActive ? "cursor-crosshair" : "";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-md border bg-card">
      <ViewportHeaderStrip
        viewportNumber={props.viewportNumber ?? null}
        fileName={props.fileName ?? null}
        raster={getRasterFromSourceOrNull(imageSource)}
        selectedBandIndex={props.selectedBandIndex}
        lastAppliedOperationLabel={props.lastAppliedOperationLabel ?? null}
        normalizationEnabled={props.normalizationEnabled}
        onToggleNormalizedViewing={props.onToggleNormalizedViewing}
        showNormalizedViewingToggle={imageSource !== null}
        onClose={props.onClose ?? null}
        showCloseButton={imageSource !== null && Boolean(props.onClose)}
      />
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className={`block h-full w-full touch-none select-none ${cursorClassName}`}
          aria-label={viewportAriaLabel}
        />
        <ViewportRoiOverlay
          renderer={rendererRef.current}
          committedRoi={props.roi}
          inProgressDragRect={inProgressDragRect}
          transformVersion={transformVersion}
        />
        {shouldShowBandNavigator(imageSource) ? (
          <ViewportBandNavigator
            bandCount={getMultiBandSourceBandCount(imageSource)}
            selectedBandIndex={props.selectedBandIndex}
            onSelectBandIndex={props.onSelectBandIndex}
            onRemoveBand={props.onRemoveBand}
          />
        ) : null}
        {imageSource === null ? <ViewportEmptyState onOpenImage={props.onOpenImage} /> : null}
      </div>
    </div>
  );
}

function ViewportEmptyState({ onOpenImage }: { onOpenImage: () => void }): JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card">
      <p className="text-sm text-muted-foreground">No stack loaded</p>
      <Button variant="outline" size="sm" onClick={onOpenImage}>
        <FolderOpen className="size-4" />
        Open image
      </Button>
    </div>
  );
}

function describeViewportAriaLabel(viewportNumber: number | null | undefined): string {
  if (typeof viewportNumber === "number") return `Panel ${viewportNumber}`;
  return "Image panel";
}

function shouldShowBandNavigator(source: ViewportImageSource | null): boolean {
  return getMultiBandSourceBandCount(source) > 1;
}

function getMultiBandSourceBandCount(source: ViewportImageSource | null): number {
  if (!source || source.kind !== "raster") return 0;
  return source.raster.bandCount;
}

function getRasterFromSourceOrNull(source: ViewportImageSource | null): RasterImage | null {
  if (!source || source.kind !== "raster") return null;
  return source.raster;
}

interface ViewportHeaderStripProps {
  viewportNumber: number | null;
  fileName: string | null;
  raster: RasterImage | null;
  selectedBandIndex: number;
  lastAppliedOperationLabel: string | null;
  normalizationEnabled: boolean;
  onToggleNormalizedViewing: () => void;
  showNormalizedViewingToggle: boolean;
  onClose: (() => void) | null;
  showCloseButton: boolean;
}

function ViewportHeaderStrip(props: ViewportHeaderStripProps): JSX.Element {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-card px-2 text-xs">
      {typeof props.viewportNumber === "number" ? (
        <ViewportNumberBadge viewportNumber={props.viewportNumber} />
      ) : null}
      {props.fileName ? (
        <ViewportFileNameLabel
          fileName={props.fileName}
          raster={props.raster}
          selectedBandIndex={props.selectedBandIndex}
          lastAppliedOperationLabel={props.lastAppliedOperationLabel}
        />
      ) : null}
      {props.showNormalizedViewingToggle ? (
        <NormalizedViewingToggleButton
          enabled={props.normalizationEnabled}
          onToggle={props.onToggleNormalizedViewing}
        />
      ) : null}
      {props.showCloseButton && props.onClose ? (
        <ViewportCloseButton viewportNumber={props.viewportNumber} onClose={props.onClose} />
      ) : null}
    </div>
  );
}

interface NormalizedViewingToggleButtonProps {
  enabled: boolean;
  onToggle: () => void;
}

function NormalizedViewingToggleButton(props: NormalizedViewingToggleButtonProps): JSX.Element {
  const label = props.enabled ? "Normalized viewing (on)" : "Normalized viewing";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("ml-auto size-6", props.enabled && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}
          aria-label={label}
          aria-pressed={props.enabled}
          onClick={handleNormalizedViewingToggleClick(props.onToggle)}
        >
          <Contrast className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function handleNormalizedViewingToggleClick(
  onToggle: () => void,
): (event: MouseEvent<HTMLButtonElement>) => void {
  return (event) => {
    event.stopPropagation();
    onToggle();
  };
}

interface ViewportCloseButtonProps {
  viewportNumber: number | null;
  onClose: () => void;
}

function ViewportCloseButton(props: ViewportCloseButtonProps): JSX.Element {
  const label = formatCloseButtonLabel(props.viewportNumber);
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    props.onClose();
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={label}
          onClick={handleClick}
        >
          <X className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function formatCloseButtonLabel(viewportNumber: number | null): string {
  if (typeof viewportNumber === "number") return `Close panel ${viewportNumber}`;
  return "Close panel";
}

interface ViewportFileNameLabelProps {
  fileName: string;
  raster: RasterImage | null;
  selectedBandIndex: number;
  lastAppliedOperationLabel: string | null;
}

function ViewportFileNameLabel(props: ViewportFileNameLabelProps): JSX.Element {
  const display = formatViewportHeaderLabel({
    fileName: props.fileName,
    raster: props.raster,
    selectedBandIndex: props.selectedBandIndex,
    lastAppliedOperationLabel: props.lastAppliedOperationLabel,
  });
  return (
    <span className="truncate font-medium text-foreground" title={display}>
      {display}
    </span>
  );
}

function ViewportNumberBadge({
  viewportNumber,
}: {
  viewportNumber: number;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded border bg-background px-1 text-xs font-medium text-muted-foreground"
    >
      {viewportNumber}
    </span>
  );
}

function useViewportRendererLifecycle(
  canvasRef: RefObject<HTMLCanvasElement>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
): void {
  useEffect(() => {
    if (!canvasRef.current) return;
    rendererRef.current = new ViewportRenderer(canvasRef.current, {
      onError: showRendererErrorToast,
    });
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
    // canvasRef and rendererRef are stable refs; effect must run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function showRendererErrorToast(message: string): void {
  toast.error(message);
}

function useImageSourceUploadEffect(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  source: ViewportImageSource | null,
  selectedBandIndex: number,
): void {
  useEffect(() => {
    if (source === null) return;
    rendererRef.current?.setImageSource(source, selectedBandIndex);
    // Re-uploading on bandIndex change is handled by useSelectedBandIndexEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendererRef, source]);
}

function useSelectedBandIndexEffect(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  source: ViewportImageSource | null,
  selectedBandIndex: number,
): void {
  useEffect(() => {
    if (source === null || source.kind !== "raster") return;
    rendererRef.current?.setSelectedRasterBandIndex(selectedBandIndex);
  }, [rendererRef, source, selectedBandIndex]);
}

function useNormalizationToggleEffect(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    rendererRef.current?.setNormalizationEnabled(enabled);
  }, [rendererRef, enabled]);
}

function useCanvasResizeObserverEffect(
  canvasRef: RefObject<HTMLCanvasElement>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) =>
      forwardResizeEntriesToRenderer(entries, rendererRef),
    );
    observer.observe(canvas);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function forwardResizeEntriesToRenderer(
  entries: ReadonlyArray<ResizeObserverEntry>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
): void {
  const entry = entries[0];
  if (!entry || !rendererRef.current) return;
  const { width, height } = entry.contentRect;
  rendererRef.current.resizeToDisplaySize(width, height);
}

function useViewportPanZoomInteractions(
  canvasRef: RefObject<HTMLCanvasElement>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  isRegionToolActive: boolean,
): void {
  const isRegionToolActiveRef = useLatestValueRef(isRegionToolActive);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return attachPanZoomEventHandlers(
      canvas,
      () => rendererRef.current,
      () => !isRegionToolActiveRef.current,
    );
    // canvasRef and rendererRef are stable refs; latest-value ref holds the toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

interface ViewportPixelReadoutInputs {
  viewportNumber: number | null;
  imageSource: ViewportImageSource | null;
  selectedBandIndex: number;
}

function useViewportPixelReadoutPublisher(
  canvasRef: RefObject<HTMLCanvasElement>,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  inputs: ViewportPixelReadoutInputs,
): void {
  const publishReadoutSnapshot = usePixelReadoutPublisher();
  const inputsRef = useLatestValueRef(inputs);
  const publisherRef = useLatestValueRef(publishReadoutSnapshot);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return attachPointerReadoutEventHandlers(canvas, {
      onMove: (cursor) => publishReadoutSnapshotForCursor(cursor, rendererRef, inputsRef, publisherRef),
      onLeave: () => publisherRef.current(null),
    });
    // canvasRef and rendererRef are stable refs; latest-value refs hold dynamic inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useLatestValueRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function publishReadoutSnapshotForCursor(
  cursor: CanvasCursorPositionPx,
  rendererRef: MutableRefObject<ViewportRenderer | null>,
  inputsRef: MutableRefObject<ViewportPixelReadoutInputs>,
  publisherRef: MutableRefObject<PixelReadoutPublisher>,
): void {
  const snapshot = buildPixelReadoutSnapshotForCursorOrNull(cursor, rendererRef.current, inputsRef.current);
  publisherRef.current(snapshot);
}

function buildPixelReadoutSnapshotForCursorOrNull(
  cursor: CanvasCursorPositionPx,
  renderer: ViewportRenderer | null,
  inputs: ViewportPixelReadoutInputs,
): ViewportPixelReadoutSnapshot | null {
  if (!renderer || !inputs.imageSource || inputs.viewportNumber === null) return null;
  const imagePixel = renderer.getImagePixelAtCanvasPoint(cursor.xPx, cursor.yPx);
  if (!imagePixel) return null;
  return {
    viewportNumber: inputs.viewportNumber,
    imagePixelX: imagePixel.x,
    imagePixelY: imagePixel.y,
    selectedBandIndex: inputs.selectedBandIndex,
    bands: readPixelReadoutBandsAtImagePointOrNull(inputs.imageSource, imagePixel.x, imagePixel.y),
    bandCount: countSourceBandsForReadout(inputs.imageSource),
  };
}

function countSourceBandsForReadout(source: ViewportImageSource): number {
  if (source.kind === "raster") return source.raster.bandCount;
  return 0;
}

interface ViewportRoiDrawInputs {
  readonly isRegionToolActive: boolean;
  readonly imageSource: ViewportImageSource | null;
  readonly rendererRef: MutableRefObject<ViewportRenderer | null>;
  readonly onCommitRoi: (roi: ViewportRoi) => void;
  readonly onRegionToolPlainClick: (clickedImagePixel: ClickedImagePixel | null) => void;
  readonly setInProgressDragRect: (rect: RoiDrawCanvasRect | null) => void;
}

function useViewportRoiDrawAttachment(
  canvasRef: RefObject<HTMLCanvasElement>,
  attachmentRef: MutableRefObject<RoiDrawAttachment | null>,
  inputs: ViewportRoiDrawInputs,
): void {
  const inputsRef = useLatestValueRef(inputs);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const attachment = attachRoiDrawEventHandlers(canvas, {
      isRoiDrawingEnabled: () => isRoiDrawingEnabledFromInputs(inputsRef.current),
      onDragStateChange: (rect) => inputsRef.current.setInProgressDragRect(rect),
      onDragCommit: (rect) => commitRoiFromCanvasRect(rect, inputsRef.current),
    });
    attachmentRef.current = attachment;
    return () => {
      attachmentRef.current = null;
      attachment.detach();
    };
    // canvasRef is stable; latest-value ref holds dynamic inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useDiscardInProgressDragWhenRegionToolDeactivates(
  attachmentRef: MutableRefObject<RoiDrawAttachment | null>,
  isRegionToolActive: boolean,
): void {
  useEffect(() => {
    if (isRegionToolActive) return;
    attachmentRef.current?.cancelInProgressDrag();
  }, [attachmentRef, isRegionToolActive]);
}

function isRoiDrawingEnabledFromInputs(inputs: ViewportRoiDrawInputs): boolean {
  return inputs.isRegionToolActive && inputs.imageSource !== null;
}

const MINIMUM_DRAG_DISTANCE_FOR_COMMIT_PX = 3;

function commitRoiFromCanvasRect(
  rect: RoiDrawCanvasRect,
  inputs: ViewportRoiDrawInputs,
): void {
  const renderer = inputs.rendererRef.current;
  const source = inputs.imageSource;
  if (!renderer || !source) return;
  if (isCanvasDragLargerThanClickThreshold(rect)) {
    commitRoiFromLargeDrag(rect, renderer, source, inputs);
    return;
  }
  reportRegionToolPlainClick(rect, renderer, inputs);
}

function commitRoiFromLargeDrag(
  rect: RoiDrawCanvasRect,
  renderer: ViewportRenderer,
  source: ViewportImageSource,
  inputs: ViewportRoiDrawInputs,
): void {
  const startImagePixel = renderer.getImagePixelAtCanvasPoint(rect.start.x, rect.start.y);
  const endImagePixel = renderer.getImagePixelAtCanvasPoint(rect.current.x, rect.current.y);
  if (!startImagePixel || !endImagePixel) return;
  const candidate = clampViewportRoiToImageBounds(
    {
      imagePixelX0: startImagePixel.x,
      imagePixelY0: startImagePixel.y,
      imagePixelX1: endImagePixel.x,
      imagePixelY1: endImagePixel.y,
    },
    getImageSourceDimensions(source),
  );
  const canonical = canonicalizeViewportRoiCorners(candidate);
  if (!isViewportRoiLargerThanMinimumSide(canonical)) return;
  inputs.onCommitRoi(canonical);
}

function reportRegionToolPlainClick(
  rect: RoiDrawCanvasRect,
  renderer: ViewportRenderer,
  inputs: ViewportRoiDrawInputs,
): void {
  const imagePixel = renderer.getImagePixelAtCanvasPoint(rect.start.x, rect.start.y);
  inputs.onRegionToolPlainClick(imagePixel ?? null);
}

function isCanvasDragLargerThanClickThreshold(rect: RoiDrawCanvasRect): boolean {
  const widthPx = Math.abs(rect.current.x - rect.start.x);
  const heightPx = Math.abs(rect.current.y - rect.start.y);
  return widthPx >= MINIMUM_DRAG_DISTANCE_FOR_COMMIT_PX
    || heightPx >= MINIMUM_DRAG_DISTANCE_FOR_COMMIT_PX;
}

interface ViewportPixelClickPinInputs {
  readonly isRegionToolActive: boolean;
  readonly imageSource: ViewportImageSource | null;
  readonly rendererRef: MutableRefObject<ViewportRenderer | null>;
  readonly onPinPixelSpectrum: (imageX: number, imageY: number) => void;
}

function useViewportPixelClickPinAttachment(
  canvasRef: RefObject<HTMLCanvasElement>,
  inputs: ViewportPixelClickPinInputs,
): void {
  const inputsRef = useLatestValueRef(inputs);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return attachPixelClickEventHandlers(canvas, {
      isPixelClickEnabled: () => isPixelClickPinEnabledFromInputs(inputsRef.current),
      onPixelClick: (point) => pinPixelSpectrumFromCanvasPoint(point, inputsRef.current),
    });
    // canvasRef is stable; latest-value ref holds dynamic inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function isPixelClickPinEnabledFromInputs(inputs: ViewportPixelClickPinInputs): boolean {
  if (inputs.isRegionToolActive) return false;
  if (!inputs.imageSource || inputs.imageSource.kind !== "raster") return false;
  return inputs.imageSource.raster.bandCount > 1;
}

function pinPixelSpectrumFromCanvasPoint(
  point: { x: number; y: number },
  inputs: ViewportPixelClickPinInputs,
): void {
  const renderer = inputs.rendererRef.current;
  if (!renderer) return;
  const imagePixel = renderer.getImagePixelAtCanvasPoint(point.x, point.y);
  if (!imagePixel) return;
  inputs.onPinPixelSpectrum(imagePixel.x, imagePixel.y);
}

function useRendererViewTransformVersion(
  rendererRef: MutableRefObject<ViewportRenderer | null>,
): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    return renderer.subscribeToViewTransformChanges(() => {
      setVersion((current) => current + 1);
    });
    // rendererRef is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return version;
}
