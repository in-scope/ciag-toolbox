import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { notifyError } from "@/lib/notifications/notify";

import {
  HistogramCanvas,
  HistogramSkeleton,
  useBandHistogramFromCacheOrWorker,
} from "@/components/histogram-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DataTypeValueRange } from "@/lib/image/data-type-value-range";
import {
  clampBandIndexToRaster,
  formatRasterBandIdentityText,
  type RasterImage,
} from "@/lib/image/raster-image";
import {
  deriveOtsuCutoffsShowingViewportBusyOrNotifyFailure,
  type OtsuAutoThresholdFlowBindings,
} from "@/lib/image/threshold/otsu-auto-flow";
import type { ThresholdBounds } from "@/lib/image/threshold/threshold";
import {
  buildDefaultThresholdBounds,
  fractionForThresholdBoundValue,
  moveLowerThresholdBoundTo,
  moveUpperThresholdBoundTo,
  thresholdBoundValueAtFraction,
} from "@/lib/image/threshold/threshold-bounds-editing";
import {
  formatToneCurveFieldValue,
  parseToneCurveFieldValueOrNull,
} from "@/lib/image/tone-curve-anchor-fields";
import { useBusyEntryRegistrar } from "@/state/busy-state-context";
import {
  useViewportRendering,
  type ViewportRenderingApi,
} from "@/state/viewport-rendering-context";

// CT-200: the interactive threshold bounds editor embedded in the Threshold
// operation panel. The live bounds ride in ViewportRenderingState (the same
// pattern as the tone-curve anchors), so the histogram handles, the numeric
// fields, the GPU preview, and Apply all share one source of truth. Every
// edit funnels through the pure move helpers, so a drag and a typed value
// clamp identically (band value range, lower <= upper).

interface ToolOptionsThresholdEditorProps {
  viewportIndex: number;
  raster: RasterImage;
}

export function ToolOptionsThresholdEditor(
  props: ToolOptionsThresholdEditorProps,
): JSX.Element {
  const bandIndex = useSelectedBandIndexForThreshold(props.viewportIndex, props.raster);
  const histogram = useBandHistogramFromCacheOrWorker(props.raster, bandIndex, props.viewportIndex);
  const binding = useThresholdBoundsBinding(props.viewportIndex);
  const applyOtsuAutoBounds = useApplyOtsuAutoThresholdBounds(
    props.viewportIndex,
    props.raster,
    bandIndex,
  );
  const range = useMemo(
    () => (histogram ? { min: histogram.min, max: histogram.max } : null),
    [histogram],
  );
  useInitializeThresholdBoundsWhenAbsent(range, binding);
  if (!histogram || !range || !binding.bounds) return <ThresholdEditorLoading />;
  return (
    <LoadedThresholdEditor
      raster={props.raster}
      bandIndex={bandIndex}
      histogram={histogram}
      range={range}
      bounds={binding.bounds}
      onChange={binding.onChange}
      onAutoThreshold={applyOtsuAutoBounds}
    />
  );
}

export interface ThresholdBoundsBinding {
  bounds: ThresholdBounds | null;
  onChange: (next: ThresholdBounds) => void;
}

// A manual edit (drag or typed value) discards the Otsu derivation: the bounds
// become plain manual bounds again, applying identically to every in-scope
// band (the CT-200 path).
function useThresholdBoundsBinding(viewportIndex: number): ThresholdBoundsBinding {
  const renderingApi = useViewportRendering();
  const bounds = renderingApi.getRenderingState(viewportIndex).thresholdBounds;
  const onChange = useCallback(
    (next: ThresholdBounds) => {
      const current = renderingApi.getRenderingState(viewportIndex);
      renderingApi.setRenderingState(viewportIndex, {
        ...current,
        thresholdBounds: next,
        thresholdOtsuCutoffs: null,
      });
    },
    [renderingApi, viewportIndex],
  );
  return { bounds, onChange };
}

// CT-201: Auto derives an Otsu cutoff per band (and one over the combined
// data) and shows the CURRENT band's bounds; the live preview and Apply reuse
// the CT-200 paths unchanged, with band-wise Apply reading each band's own
// cutoff from the stored set. CT-219d: the derivation runs asynchronously
// behind a viewport busy entry with per-band progress, failures surface as an
// error toast instead of vanishing in the click handler, and a second click
// is ignored while a derivation is in flight.
function useApplyOtsuAutoThresholdBounds(
  viewportIndex: number,
  raster: RasterImage,
  bandIndex: number,
): () => void {
  const renderingApi = useViewportRendering();
  const busyRegistrar = useBusyEntryRegistrar();
  const [isDeriving, setIsDeriving] = useState(false);
  return useCallback(() => {
    if (isDeriving) return;
    setIsDeriving(true);
    const bindings = { busyRegistrar, viewportIndex, notifyError: notifyOtsuAutoFailureToast };
    void deriveOtsuBoundsAndStoreThem(bindings, renderingApi, raster, bandIndex).finally(() =>
      setIsDeriving(false),
    );
  }, [isDeriving, busyRegistrar, renderingApi, viewportIndex, raster, bandIndex]);
}

function notifyOtsuAutoFailureToast(message: string): void {
  notifyError(message);
}

async function deriveOtsuBoundsAndStoreThem(
  bindings: OtsuAutoThresholdFlowBindings,
  renderingApi: ViewportRenderingApi,
  raster: RasterImage,
  bandIndex: number,
): Promise<void> {
  const cutoffs = await deriveOtsuCutoffsShowingViewportBusyOrNotifyFailure(bindings, raster);
  if (cutoffs === null) return;
  const current = renderingApi.getRenderingState(bindings.viewportIndex);
  renderingApi.setRenderingState(bindings.viewportIndex, {
    ...current,
    thresholdBounds: cutoffs.perBandBounds[bandIndex] ?? current.thresholdBounds,
    thresholdOtsuCutoffs: cutoffs,
  });
}

function useSelectedBandIndexForThreshold(viewportIndex: number, raster: RasterImage): number {
  const renderingApi = useViewportRendering();
  const selectedBandIndex = renderingApi.getRenderingState(viewportIndex).selectedBandIndex;
  return clampBandIndexToRaster(raster, selectedBandIndex);
}

function useInitializeThresholdBoundsWhenAbsent(
  range: DataTypeValueRange | null,
  binding: ThresholdBoundsBinding,
): void {
  const hasBounds = binding.bounds !== null;
  const { onChange } = binding;
  useEffect(() => {
    if (!range || hasBounds) return;
    onChange(buildDefaultThresholdBounds(range));
  }, [range, hasBounds, onChange]);
}

interface LoadedThresholdEditorProps {
  raster: RasterImage;
  bandIndex: number;
  histogram: NonNullable<ReturnType<typeof useBandHistogramFromCacheOrWorker>>;
  range: DataTypeValueRange;
  bounds: ThresholdBounds;
  onChange: (next: ThresholdBounds) => void;
  onAutoThreshold: () => void;
}

function LoadedThresholdEditor(props: LoadedThresholdEditorProps): JSX.Element {
  const isIntegerBand = props.raster.sampleFormat !== "float";
  return (
    <div className="flex flex-col gap-2">
      <ThresholdEditorHeader onAutoThreshold={props.onAutoThreshold} />
      {renderThresholdBandLabelWhenMultiBand(props.raster, props.bandIndex)}
      <HistogramCanvas
        histogram={props.histogram}
        sampleFormat={props.raster.sampleFormat}
        canvasOverlay={
          <HistogramThresholdBoundsOverlay
            range={props.range}
            bounds={props.bounds}
            onChange={props.onChange}
            isIntegerBand={isIntegerBand}
          />
        }
      />
      <ThresholdBoundFields
        range={props.range}
        bounds={props.bounds}
        onChange={props.onChange}
        isIntegerBand={isIntegerBand}
      />
      <p className="text-xs text-muted-foreground">
        Drag a handle or type a value, or use Auto to derive a cutoff per band (Otsu).
        Pixels inside the bounds preview white; outside black. The stack changes only on Apply.
      </p>
    </div>
  );
}

interface ThresholdEditorHeaderProps {
  onAutoThreshold: () => void;
}

function ThresholdEditorHeader(props: ThresholdEditorHeaderProps): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-muted-foreground">Threshold bounds</span>
      <Button type="button" variant="outline" size="sm" onClick={props.onAutoThreshold}>
        Auto
      </Button>
    </div>
  );
}

function renderThresholdBandLabelWhenMultiBand(
  raster: RasterImage,
  bandIndex: number,
): ReactNode {
  if (raster.bandCount <= 1) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="threshold-editing-band">
      Histogram: {formatRasterBandIdentityText(raster, bandIndex)}
    </p>
  );
}

type ThresholdBoundSide = "lower" | "upper";

interface HistogramThresholdBoundsOverlayProps {
  range: DataTypeValueRange;
  bounds: ThresholdBounds;
  onChange: (next: ThresholdBounds) => void;
  isIntegerBand: boolean;
}

function HistogramThresholdBoundsOverlay(
  props: HistogramThresholdBoundsOverlayProps,
): JSX.Element {
  const drag = useThresholdBoundDrag(props);
  const lowerFraction = fractionForThresholdBoundValue(props.range, props.bounds.lower);
  const upperFraction = fractionForThresholdBoundValue(props.range, props.bounds.upper);
  return (
    <div
      className="absolute inset-0 touch-none"
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.endDrag}
      onPointerCancel={drag.endDrag}
    >
      <ThresholdInRangeShading lowerFraction={lowerFraction} upperFraction={upperFraction} />
      <ThresholdBoundHandle
        side="lower"
        fraction={lowerFraction}
        onPointerDown={(event) => drag.beginDrag(event, "lower")}
      />
      <ThresholdBoundHandle
        side="upper"
        fraction={upperFraction}
        onPointerDown={(event) => drag.beginDrag(event, "upper")}
      />
    </div>
  );
}

interface ThresholdBoundDrag {
  beginDrag: (event: ReactPointerEvent<HTMLElement>, side: ThresholdBoundSide) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  endDrag: () => void;
}

function useThresholdBoundDrag(props: HistogramThresholdBoundsOverlayProps): ThresholdBoundDrag {
  const [activeSide, setActiveSide] = useState<ThresholdBoundSide | null>(null);
  return {
    beginDrag: (event, side) => beginThresholdBoundDrag(event, side, setActiveSide),
    onPointerMove: (event) => continueThresholdBoundDrag(event, activeSide, props),
    endDrag: () => setActiveSide(null),
  };
}

function beginThresholdBoundDrag(
  event: ReactPointerEvent<HTMLElement>,
  side: ThresholdBoundSide,
  setActiveSide: (next: ThresholdBoundSide | null) => void,
): void {
  event.stopPropagation();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  setActiveSide(side);
}

function continueThresholdBoundDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  activeSide: ThresholdBoundSide | null,
  props: HistogramThresholdBoundsOverlayProps,
): void {
  if (activeSide === null) return;
  const value = thresholdBoundValueAtFraction(
    props.range,
    pointerFractionAcrossElementWidth(event.currentTarget, event.clientX),
  );
  props.onChange(moveThresholdBoundOnSide(activeSide, props, value));
}

function moveThresholdBoundOnSide(
  side: ThresholdBoundSide,
  props: HistogramThresholdBoundsOverlayProps,
  value: number,
): ThresholdBounds {
  if (side === "lower") {
    return moveLowerThresholdBoundTo(props.bounds, value, props.range, props.isIntegerBand);
  }
  return moveUpperThresholdBoundTo(props.bounds, value, props.range, props.isIntegerBand);
}

function pointerFractionAcrossElementWidth(element: HTMLElement, clientX: number): number {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  const fraction = (clientX - rect.left) / rect.width;
  if (fraction < 0) return 0;
  if (fraction > 1) return 1;
  return fraction;
}

function ThresholdInRangeShading(props: {
  lowerFraction: number;
  upperFraction: number;
}): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 bg-primary/15"
      style={{
        left: `${props.lowerFraction * 100}%`,
        width: `${Math.max(0, props.upperFraction - props.lowerFraction) * 100}%`,
      }}
    />
  );
}

interface ThresholdBoundHandleProps {
  side: ThresholdBoundSide;
  fraction: number;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

function ThresholdBoundHandle(props: ThresholdBoundHandleProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={props.side === "lower" ? "Lower bound handle" : "Upper bound handle"}
      className="absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      style={{ left: `${props.fraction * 100}%` }}
      onPointerDown={props.onPointerDown}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-primary" />
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-primary"
      />
    </button>
  );
}

interface ThresholdBoundFieldsProps {
  range: DataTypeValueRange;
  bounds: ThresholdBounds;
  onChange: (next: ThresholdBounds) => void;
  isIntegerBand: boolean;
}

function ThresholdBoundFields(props: ThresholdBoundFieldsProps): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2">
      <ThresholdBoundField
        label="Lower bound"
        value={props.bounds.lower}
        isIntegerBand={props.isIntegerBand}
        onCommitValue={(value) =>
          props.onChange(moveLowerThresholdBoundTo(props.bounds, value, props.range, props.isIntegerBand))
        }
      />
      <ThresholdBoundField
        label="Upper bound"
        value={props.bounds.upper}
        isIntegerBand={props.isIntegerBand}
        onCommitValue={(value) =>
          props.onChange(moveUpperThresholdBoundTo(props.bounds, value, props.range, props.isIntegerBand))
        }
      />
    </div>
  );
}

interface ThresholdBoundFieldProps {
  label: string;
  value: number;
  isIntegerBand: boolean;
  onCommitValue: (value: number) => void;
}

// The field holds a typed draft while editing; committing (Enter or blur)
// parses it, funnels it through the shared clamp, then snaps back to the
// formatted stored value so out-of-range text displays as its clamped result.
function ThresholdBoundField(props: ThresholdBoundFieldProps): JSX.Element {
  const formatted = formatToneCurveFieldValue(props.value, props.isIntegerBand);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => commitThresholdBoundField(draft ?? formatted, props.onCommitValue, setDraft);
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      {props.label}
      <Input
        aria-label={props.label}
        inputMode="numeric"
        value={draft ?? formatted}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => commitThresholdBoundFieldOnEnter(event, commit)}
        className="h-8 text-center text-foreground"
      />
    </label>
  );
}

function commitThresholdBoundField(
  text: string,
  onCommitValue: (value: number) => void,
  setDraft: (text: string | null) => void,
): void {
  const parsed = parseToneCurveFieldValueOrNull(text);
  if (parsed !== null) onCommitValue(parsed);
  setDraft(null);
}

function commitThresholdBoundFieldOnEnter(
  event: ReactKeyboardEvent<HTMLInputElement>,
  commit: () => void,
): void {
  if (event.key !== "Enter") return;
  event.preventDefault();
  commit();
}

function ThresholdEditorLoading(): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Threshold bounds</span>
      <HistogramSkeleton />
    </div>
  );
}
