import { useEffect, useMemo } from "react";

import {
  buildToneCurveValueRanges,
  HistogramCanvas,
  HistogramSkeleton,
  useBandHistogramFromCacheOrWorker,
  useToneCurveAnchorBinding,
  type ToneCurveAnchorBinding,
} from "@/components/histogram-section";
import { HistogramToneCurveEditor } from "@/components/histogram-tone-curve-editor";
import { clampBandIndexToRaster, type RasterImage } from "@/lib/image/raster-image";
import {
  buildDefaultToneCurveAnchors,
  type ToneCurveValueRanges,
} from "@/lib/image/tone-curve-editor-state";
import { useViewportRendering } from "@/state/viewport-rendering-context";

interface ToolOptionsToneCurveEditorProps {
  viewportIndex: number;
  raster: RasterImage;
}

export function ToolOptionsToneCurveEditor(
  props: ToolOptionsToneCurveEditorProps,
): JSX.Element {
  const bandIndex = useSelectedBandIndexForViewport(props.viewportIndex, props.raster);
  const histogram = useBandHistogramFromCacheOrWorker(props.raster, bandIndex, props.viewportIndex);
  const binding = useToneCurveAnchorBinding(props.viewportIndex);
  const ranges = useToneCurveRangesOrNull(props.raster, bandIndex, histogram);
  useInitializeToneCurveAnchorsWhenAbsent(ranges, binding);
  if (!histogram || !ranges) return <ToneCurveEditorLoading />;
  return <LoadedToneCurveEditor raster={props.raster} histogram={histogram} ranges={ranges} binding={binding} />;
}

function useSelectedBandIndexForViewport(viewportIndex: number, raster: RasterImage): number {
  const renderingApi = useViewportRendering();
  const selectedBandIndex = renderingApi.getRenderingState(viewportIndex).selectedBandIndex;
  return clampBandIndexToRaster(raster, selectedBandIndex);
}

function useToneCurveRangesOrNull(
  raster: RasterImage,
  bandIndex: number,
  histogram: ReturnType<typeof useBandHistogramFromCacheOrWorker>,
): ToneCurveValueRanges | null {
  return useMemo(
    () => (histogram ? buildToneCurveValueRanges(raster, bandIndex, histogram) : null),
    [raster, bandIndex, histogram],
  );
}

function useInitializeToneCurveAnchorsWhenAbsent(
  ranges: ToneCurveValueRanges | null,
  binding: ToneCurveAnchorBinding,
): void {
  const hasAnchors = binding.anchors !== null;
  const { onChange } = binding;
  useEffect(() => {
    if (!ranges || hasAnchors) return;
    onChange(buildDefaultToneCurveAnchors(ranges));
  }, [ranges, hasAnchors, onChange]);
}

interface LoadedToneCurveEditorProps {
  raster: RasterImage;
  histogram: NonNullable<ReturnType<typeof useBandHistogramFromCacheOrWorker>>;
  ranges: ToneCurveValueRanges;
  binding: ToneCurveAnchorBinding;
}

function LoadedToneCurveEditor(props: LoadedToneCurveEditorProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Tone curve</span>
      <HistogramCanvas
        histogram={props.histogram}
        sampleFormat={props.raster.sampleFormat}
        canvasOverlay={
          <HistogramToneCurveEditor
            ranges={props.ranges}
            anchors={props.binding.anchors}
            onChange={props.binding.onChange}
          />
        }
      />
      <p className="text-xs text-muted-foreground">
        Click to add a point, drag to move, right-click an interior point to remove it.
      </p>
    </div>
  );
}

function ToneCurveEditorLoading(): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Tone curve</span>
      <HistogramSkeleton />
    </div>
  );
}
