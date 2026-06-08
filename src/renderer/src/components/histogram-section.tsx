import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { HistogramBlackWhiteMarkers } from "@/components/histogram-black-white-markers";
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
  type HistogramAxisTickAnchor,
  type HistogramAxisTickLabel,
} from "@/lib/image/compute-histogram-axis-tick-labels";
import { computeHistogramBarHeightsInPixels } from "@/lib/image/compute-histogram-bar-heights";
import { computeHistogramBarHorizontalSpan } from "@/lib/image/compute-histogram-bar-layout";
import {
  clampBandIndexToRaster,
  formatRasterBandIdentityText,
  type RasterImage,
  type RasterSampleFormat,
} from "@/lib/image/raster-image";
import type { BlackWhitePointSelection } from "@/lib/image/black-white-point-selection";
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
            Viewport {props.viewportNumber}
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
  const markerBinding = useBlackWhitePointMarkerBinding(props.viewportIndex);
  if (!histogram) return <HistogramSkeleton />;
  return (
    <HistogramCanvas
      histogram={histogram}
      sampleFormat={props.raster.sampleFormat}
      markerBinding={markerBinding}
    />
  );
}

interface BlackWhitePointMarkerBinding {
  selection: BlackWhitePointSelection | null;
  onChange: (next: BlackWhitePointSelection) => void;
}

function useBlackWhitePointMarkerBinding(viewportIndex: number): BlackWhitePointMarkerBinding {
  const renderingApi = useViewportRendering();
  const selection = renderingApi.getRenderingState(viewportIndex).blackWhitePoints;
  const onChange = useCallback(
    (next: BlackWhitePointSelection) => {
      const current = renderingApi.getRenderingState(viewportIndex);
      renderingApi.setRenderingState(viewportIndex, { ...current, blackWhitePoints: next });
    },
    [renderingApi, viewportIndex],
  );
  return { selection, onChange };
}

function HistogramSkeleton(): JSX.Element {
  return (
    <Skeleton
      className="w-full"
      style={{ height: `${HISTOGRAM_CANVAS_HEIGHT_PX}px` }}
    />
  );
}

function useBandHistogramFromCacheOrWorker(
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

interface HistogramCanvasProps {
  histogram: BandHistogram;
  sampleFormat: RasterSampleFormat;
  markerBinding: BlackWhitePointMarkerBinding;
}

function HistogramCanvas(props: HistogramCanvasProps): JSX.Element {
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
      <div className="relative" style={{ height: `${HISTOGRAM_CANVAS_HEIGHT_PX}px` }}>
        <canvas
          ref={canvasRef}
          width={canvasWidthPx}
          height={HISTOGRAM_CANVAS_HEIGHT_PX}
          aria-label="Active band intensity histogram"
          role="img"
          className="block w-full rounded-sm bg-muted text-primary"
          style={{ height: `${HISTOGRAM_CANVAS_HEIGHT_PX}px` }}
        />
        <HistogramBlackWhiteMarkers
          min={props.histogram.min}
          max={props.histogram.max}
          selection={props.markerBinding.selection}
          onChange={props.markerBinding.onChange}
        />
      </div>
      <HistogramAxisTickLabelsRow
        histogram={props.histogram}
        sampleFormat={props.sampleFormat}
      />
    </div>
  );
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
    <div className="relative h-4" aria-hidden="true">
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
    paintOneHistogramBarAtIndex(context, i, barHeights[i] ?? 0, widthPx, heightPx, barCount);
  }
}

function paintOneHistogramBarAtIndex(
  context: CanvasRenderingContext2D,
  index: number,
  barHeight: number,
  widthPx: number,
  heightPx: number,
  barCount: number,
): void {
  if (barHeight <= 0) return;
  const span = computeHistogramBarHorizontalSpan(index, barCount, widthPx);
  context.fillRect(span.left, heightPx - barHeight, span.width, barHeight);
}

function readCanvasCurrentColorOrFallback(canvas: HTMLCanvasElement): string {
  const computedColor = getComputedStyle(canvas).color.trim();
  return computedColor.length > 0 ? computedColor : "#3b82f6";
}
