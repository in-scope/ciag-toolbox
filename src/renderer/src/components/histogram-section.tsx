import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ViewportRightPanelActiveSource } from "@/components/viewport-right-panel";
import { BandHistogramCache } from "@/lib/image/band-histogram-cache";
import {
  createBandHistogramWorkerClient,
  isBandHistogramRequestAbandonedError,
  type BandHistogramWorkerClient,
} from "@/lib/image/band-histogram-worker-client";
import {
  DEFAULT_BAND_HISTOGRAM_BIN_COUNT,
  type BandHistogram,
} from "@/lib/image/compute-band-histogram";
import {
  computeHistogramAxisTickLabels,
  computeHistogramCountAxisTickLabels,
  type HistogramAxisTickAnchor,
  type HistogramAxisTickLabel,
  type HistogramCountAxisTickLabel,
} from "@/lib/image/compute-histogram-axis-tick-labels";
import { computeHistogramBarHeightsInPixels } from "@/lib/image/compute-histogram-bar-heights";
import { computeHistogramBarFillSpan } from "@/lib/image/compute-histogram-bar-layout";
import {
  clampBandIndexToRaster,
  formatRasterBandIdentityText,
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterSampleFormat,
} from "@/lib/image/raster-image";
import { dataTypeValueRangeForBand } from "@/lib/image/data-type-value-range";
import type { ToneCurveAnchor } from "@/lib/image/apply-tone-curve";
import type { ToneCurveValueRanges } from "@/lib/image/tone-curve-editor-state";
import { cn } from "@/lib/utils";
import { useBusyEntryRegistrar } from "@/state/busy-state-context";
import { useRightPanelCollapsedSection } from "@/state/right-panel-collapsed-state";
import { useViewportRendering } from "@/state/viewport-rendering-context";

const HISTOGRAM_CANVAS_HEIGHT_PX = 120;

const sharedBandHistogramCache = new BandHistogramCache();
let sharedBandHistogramWorkerClient: BandHistogramWorkerClient | null = null;

function acquireBandHistogramWorkerClient(): BandHistogramWorkerClient {
  if (!sharedBandHistogramWorkerClient) {
    sharedBandHistogramWorkerClient = createBandHistogramWorkerClient();
  }
  return sharedBandHistogramWorkerClient;
}

interface HistogramSectionProps {
  activeSource: ViewportRightPanelActiveSource;
}

export function HistogramSection(props: HistogramSectionProps): JSX.Element | null {
  if (!shouldShowHistogramSection(props.activeSource)) return null;
  return <HistogramSectionBody activeSource={props.activeSource} />;
}

export function shouldShowHistogramSection(
  activeSource: ViewportRightPanelActiveSource,
): boolean {
  if (!activeSource.raster) return false;
  return activeSource.raster.bandCount >= 1;
}

function HistogramSectionBody(props: HistogramSectionProps): JSX.Element {
  const raster = props.activeSource.raster as RasterImage;
  const { isCollapsed, setCollapsed } = useRightPanelCollapsedSection("histogram");
  const activeBandIndex = clampBandIndexToRaster(
    raster,
    props.activeSource.selectedBandIndex,
  );
  return (
    <Collapsible
      open={!isCollapsed}
      onOpenChange={(open) => setCollapsed(!open)}
      asChild
    >
      <section aria-label="Histogram" className={RIGHT_PANEL_SECTION_CLASSES}>
        <HistogramSectionHeader
          viewportNumber={props.activeSource.viewportNumber}
          activeBandLabel={formatRasterBandIdentityText(raster, activeBandIndex)}
          isCollapsed={isCollapsed}
        />
        <CollapsibleContent>
          <HistogramChartLoader
            raster={raster}
            bandIndex={activeBandIndex}
            viewportIndex={props.activeSource.viewportIndex}
          />
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

const RIGHT_PANEL_SECTION_CLASSES =
  "flex flex-col gap-2 light:rounded-md light:border light:border-border light:p-3";

interface HistogramSectionHeaderProps {
  viewportNumber: number;
  activeBandLabel: string;
  isCollapsed: boolean;
}

function HistogramSectionHeader(props: HistogramSectionHeaderProps): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-baseline justify-between rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-expanded={!props.isCollapsed}
        >
          <span className="flex items-center gap-1.5">
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "h-3 w-3 text-muted-foreground transition-transform",
                props.isCollapsed && "-rotate-90",
              )}
            />
            <h2 className="text-sm font-medium text-foreground">Histogram</h2>
          </span>
          <span className="text-xs text-muted-foreground">
            Panel {props.viewportNumber}
          </span>
        </button>
      </CollapsibleTrigger>
      <span
        className="truncate pl-4 font-mono text-[11px] text-muted-foreground"
        title={props.activeBandLabel}
      >
        {props.activeBandLabel}
      </span>
    </div>
  );
}

interface HistogramChartLoaderProps {
  raster: RasterImage;
  bandIndex: number;
  viewportIndex: number;
}

function HistogramChartLoader(props: HistogramChartLoaderProps): JSX.Element {
  const histogram = useBandHistogramFromCacheOrWorker(
    props.raster,
    props.bandIndex,
    props.viewportIndex,
  );
  if (!histogram) return <HistogramSkeleton />;
  return (
    <HistogramCanvas histogram={histogram} sampleFormat={props.raster.sampleFormat} />
  );
}

export function buildToneCurveValueRanges(
  raster: RasterImage,
  bandIndex: number,
  histogram: BandHistogram,
): ToneCurveValueRanges {
  const outputRange = toneCurveEditorOutputRangeForBand(raster, bandIndex, histogram);
  return {
    inputMin: histogram.min,
    inputMax: histogram.max,
    outputMin: outputRange.min,
    outputMax: outputRange.max,
  };
}

// CT-198: a float band's tone-curve output range is its OWN value extents (the same
// [dataMin, dataMax] the histogram spans), so the default endpoints map each value to
// itself - a true identity. An integer band keeps its data-type container range, which
// already equals the editor's input range, so its default was already an identity.
function toneCurveEditorOutputRangeForBand(
  raster: RasterImage,
  bandIndex: number,
  histogram: BandHistogram,
): { min: number; max: number } {
  if (raster.sampleFormat === "float") return { min: histogram.min, max: histogram.max };
  return dataTypeValueRangeForBand(getRasterBandPixelsOrThrow(raster, bandIndex), raster.sampleFormat);
}

export interface ToneCurveAnchorBinding {
  anchors: ReadonlyArray<ToneCurveAnchor> | null;
  onChange: (next: ReadonlyArray<ToneCurveAnchor>) => void;
}

export function useToneCurveAnchorBinding(viewportIndex: number): ToneCurveAnchorBinding {
  const renderingApi = useViewportRendering();
  const anchors = renderingApi.getRenderingState(viewportIndex).toneCurveAnchors;
  const onChange = useCallback(
    (next: ReadonlyArray<ToneCurveAnchor>) => {
      const current = renderingApi.getRenderingState(viewportIndex);
      renderingApi.setRenderingState(viewportIndex, { ...current, toneCurveAnchors: next });
    },
    [renderingApi, viewportIndex],
  );
  return { anchors, onChange };
}

export function HistogramSkeleton(): JSX.Element {
  return (
    <Skeleton
      className="w-full"
      style={{ height: `${HISTOGRAM_CANVAS_HEIGHT_PX}px` }}
    />
  );
}

export function useBandHistogramFromCacheOrWorker(
  raster: RasterImage,
  bandIndex: number,
  viewportIndex: number,
): BandHistogram | null {
  const busyRegistrar = useBusyEntryRegistrar();
  const [histogram, setHistogram] = useState<BandHistogram | null>(() =>
    sharedBandHistogramCache.read(raster, bandIndex, DEFAULT_BAND_HISTOGRAM_BIN_COUNT),
  );
  useEffect(() => {
    return runBandHistogramRequestForActiveBand({
      raster,
      bandIndex,
      viewportIndex,
      busyRegistrar,
      setHistogram,
    });
  }, [raster, bandIndex, viewportIndex, busyRegistrar]);
  return histogram;
}

interface RunBandHistogramRequestInputs {
  raster: RasterImage;
  bandIndex: number;
  viewportIndex: number;
  busyRegistrar: ReturnType<typeof useBusyEntryRegistrar>;
  setHistogram: (next: BandHistogram | null) => void;
}

function runBandHistogramRequestForActiveBand(
  inputs: RunBandHistogramRequestInputs,
): () => void {
  const cached = sharedBandHistogramCache.read(
    inputs.raster,
    inputs.bandIndex,
    DEFAULT_BAND_HISTOGRAM_BIN_COUNT,
  );
  if (cached) {
    inputs.setHistogram(cached);
    return () => {};
  }
  inputs.setHistogram(null);
  return triggerBandHistogramWorkerAndUpdateState(inputs);
}

function triggerBandHistogramWorkerAndUpdateState(
  inputs: RunBandHistogramRequestInputs,
): () => void {
  let canceled = false;
  const busyHandle = inputs.busyRegistrar.registerViewportBusyEntry({
    viewportIndex: inputs.viewportIndex,
    label: "Computing histogram...",
  });
  acquireBandHistogramWorkerClient()
    .computeBandHistogramOnWorker({
      raster: inputs.raster,
      bandIndex: inputs.bandIndex,
      binCount: DEFAULT_BAND_HISTOGRAM_BIN_COUNT,
    })
    .then((histogram) => {
      sharedBandHistogramCache.store(
        inputs.raster,
        inputs.bandIndex,
        DEFAULT_BAND_HISTOGRAM_BIN_COUNT,
        histogram,
      );
      if (!canceled) inputs.setHistogram(histogram);
    })
    .catch(absorbBandHistogramAbandonmentOrRethrow)
    .finally(() => busyHandle.clear());
  return () => {
    canceled = true;
  };
}

function absorbBandHistogramAbandonmentOrRethrow(reason: unknown): void {
  if (isBandHistogramRequestAbandonedError(reason)) return;
  throw reason;
}

const DEFAULT_HISTOGRAM_CANVAS_LABEL = "Active band intensity histogram";

interface HistogramCanvasProps {
  histogram: BandHistogram;
  sampleFormat: RasterSampleFormat;
  canvasOverlay?: ReactNode;
  accessibleLabel?: string;
}

export function HistogramCanvas(props: HistogramCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasWidthPx, setCanvasWidthPx] = useState<number>(props.histogram.binCount);
  useObserveCanvasWidthInPixels(canvasRef, setCanvasWidthPx);
  useEffect(() => {
    drawHistogramBarsToCanvasOrSkip(
      canvasRef.current,
      props.histogram,
      canvasWidthPx,
      HISTOGRAM_CANVAS_HEIGHT_PX,
    );
  }, [props.histogram, canvasWidthPx]);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <HistogramCountAxisLabelsColumn bins={props.histogram.bins} />
        <div
          className="relative flex-1"
          style={{ height: `${HISTOGRAM_CANVAS_HEIGHT_PX}px` }}
        >
          <canvas
            ref={canvasRef}
            width={canvasWidthPx}
            height={HISTOGRAM_CANVAS_HEIGHT_PX}
            aria-label={props.accessibleLabel ?? DEFAULT_HISTOGRAM_CANVAS_LABEL}
            role="img"
            className="block w-full rounded-sm bg-muted text-primary"
            style={{ height: `${HISTOGRAM_CANVAS_HEIGHT_PX}px` }}
          />
          {props.canvasOverlay}
        </div>
      </div>
      <div className="flex gap-1">
        <div className={HISTOGRAM_Y_AXIS_COLUMN_CLASSES} aria-hidden="true" />
        <HistogramAxisTickLabelsRow
          histogram={props.histogram}
          sampleFormat={props.sampleFormat}
        />
      </div>
    </div>
  );
}

const HISTOGRAM_Y_AXIS_COLUMN_CLASSES = "w-9 shrink-0";

interface HistogramCountAxisLabelsColumnProps {
  bins: ArrayLike<number>;
}

function HistogramCountAxisLabelsColumn(
  props: HistogramCountAxisLabelsColumnProps,
): JSX.Element {
  const ticks = computeHistogramCountAxisTickLabels(props.bins);
  return (
    <div
      className={cn("relative", HISTOGRAM_Y_AXIS_COLUMN_CLASSES)}
      style={{ height: `${HISTOGRAM_CANVAS_HEIGHT_PX}px` }}
      data-testid="histogram-count-axis"
      aria-hidden="true"
    >
      {ticks.map((tick) => (
        <span
          key={tick.fraction}
          className="absolute right-0 font-mono text-[11px] leading-none text-muted-foreground"
          style={positionStyleForCountAxisTickLabel(tick)}
        >
          {tick.text}
        </span>
      ))}
    </div>
  );
}

function positionStyleForCountAxisTickLabel(
  tick: HistogramCountAxisTickLabel,
): React.CSSProperties {
  return {
    top: `${(1 - tick.fraction) * 100}%`,
    transform: translateYForCountAxisFraction(tick.fraction),
  };
}

function translateYForCountAxisFraction(fraction: number): string {
  if (fraction >= 1) return "translateY(0)";
  if (fraction <= 0) return "translateY(-100%)";
  return "translateY(-50%)";
}

interface HistogramAxisTickLabelsRowProps {
  histogram: BandHistogram;
  sampleFormat: RasterSampleFormat;
}

function HistogramAxisTickLabelsRow(props: HistogramAxisTickLabelsRowProps): JSX.Element {
  const ticks = computeHistogramAxisTickLabels(
    { min: props.histogram.min, max: props.histogram.max },
    props.sampleFormat,
  );
  return (
    <div className="relative h-4 flex-1" data-testid="histogram-value-axis" aria-hidden="true">
      {ticks.map((tick) => (
        <span
          key={tick.value}
          className="absolute font-mono text-[11px] leading-4 text-muted-foreground"
          style={positionStyleForAxisTickLabel(tick)}
        >
          {tick.text}
        </span>
      ))}
    </div>
  );
}

function positionStyleForAxisTickLabel(
  tick: HistogramAxisTickLabel,
): React.CSSProperties {
  return {
    left: `${tick.fraction * 100}%`,
    transform: translateXForAxisTickAnchor(tick.anchor),
  };
}

function translateXForAxisTickAnchor(anchor: HistogramAxisTickAnchor): string {
  if (anchor === "start") return "translateX(0)";
  if (anchor === "end") return "translateX(-100%)";
  return "translateX(-50%)";
}

function useObserveCanvasWidthInPixels(
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>,
  setCanvasWidthPx: (next: number) => void,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const update = () =>
      setCanvasWidthPx(Math.max(1, Math.floor(canvas.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef, setCanvasWidthPx]);
}

function drawHistogramBarsToCanvasOrSkip(
  canvas: HTMLCanvasElement | null,
  histogram: BandHistogram,
  widthPx: number,
  heightPx: number,
): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, widthPx, heightPx);
  paintHistogramBarsOnContext(context, histogram, widthPx, heightPx);
}

function paintHistogramBarsOnContext(
  context: CanvasRenderingContext2D,
  histogram: BandHistogram,
  widthPx: number,
  heightPx: number,
): void {
  const barHeights = computeHistogramBarHeightsInPixels({ bins: histogram.bins, heightPx });
  context.fillStyle = readCanvasCurrentColorOrFallback(context.canvas);
  const barCount = histogram.binCount;
  for (let i = 0; i < barCount; i++) {
    paintOneHistogramBarAtIndex(context, i, barHeights, widthPx, heightPx, barCount);
  }
}

function paintOneHistogramBarAtIndex(
  context: CanvasRenderingContext2D,
  index: number,
  barHeights: ReadonlyArray<number>,
  widthPx: number,
  heightPx: number,
  barCount: number,
): void {
  const barHeight = barHeights[index] ?? 0;
  if (barHeight <= 0) return;
  const overlapsNextBar = (barHeights[index + 1] ?? 0) > 0;
  const span = computeHistogramBarFillSpan(index, barCount, widthPx, overlapsNextBar);
  const top = Math.max(0, Math.round(heightPx - barHeight));
  context.fillRect(span.left, top, span.width, heightPx - top);
}

function readCanvasCurrentColorOrFallback(canvas: HTMLCanvasElement): string {
  const computedColor = getComputedStyle(canvas).color.trim();
  return computedColor.length > 0 ? computedColor : "#3b82f6";
}
