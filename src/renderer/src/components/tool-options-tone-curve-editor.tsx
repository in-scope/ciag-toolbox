import { Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  buildToneCurveValueRanges,
  HistogramCanvas,
  HistogramSkeleton,
  useBandHistogramFromCacheOrWorker,
  useToneCurveAnchorBinding,
  type ToneCurveAnchorBinding,
} from "@/components/histogram-section";
import { HistogramToneCurveEditor } from "@/components/histogram-tone-curve-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ToneCurveAnchor } from "@/lib/image/apply-tone-curve";
import {
  formatToneCurveFieldValue,
  isToneCurveEndpointIndex,
  moveSelectedAnchorInputTo,
  moveSelectedAnchorOutputTo,
  parseToneCurveFieldValueOrNull,
  toneCurveFieldStepForBand,
} from "@/lib/image/tone-curve-anchor-fields";
import {
  clampSelectedToneCurveAnchorIndex,
  DEFAULT_SELECTED_TONE_CURVE_ANCHOR_INDEX,
} from "@/lib/image/tone-curve-anchor-selection";
import { clampBandIndexToRaster, type RasterImage } from "@/lib/image/raster-image";
import {
  buildDefaultToneCurveAnchors,
  resolveToneCurveAnchorsOrDefault,
  type ToneCurveValueRanges,
} from "@/lib/image/tone-curve-editor-state";
import { useViewportRendering } from "@/state/viewport-rendering-context";

type ToneCurveAnchors = ReadonlyArray<ToneCurveAnchor>;

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
  const anchors = resolveToneCurveAnchorsOrDefault(props.binding.anchors, props.ranges);
  const selection = useSelectedToneCurveAnchorIndex(anchors.length);
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
            selectedAnchorIndex={selection.selectedAnchorIndex}
            onSelectAnchor={selection.selectAnchor}
            isIntegerBand={props.raster.sampleFormat !== "float"}
          />
        }
      />
      <SelectedToneCurveAnchorFields
        anchors={anchors}
        selectedAnchorIndex={selection.selectedAnchorIndex}
        ranges={props.ranges}
        isIntegerBand={props.raster.sampleFormat !== "float"}
        onChange={props.binding.onChange}
      />
      <p className="text-xs text-muted-foreground">
        Click to add a point, drag to move, right-click an interior point to remove it.
      </p>
    </div>
  );
}

interface SelectedToneCurveAnchorFieldsProps {
  anchors: ToneCurveAnchors;
  selectedAnchorIndex: number;
  ranges: ToneCurveValueRanges;
  isIntegerBand: boolean;
  onChange: (next: ToneCurveAnchors) => void;
}

function SelectedToneCurveAnchorFields(props: SelectedToneCurveAnchorFieldsProps): JSX.Element {
  const index = props.selectedAnchorIndex;
  const anchor = props.anchors[index]!;
  const step = toneCurveFieldStepForBand(props.isIntegerBand);
  return (
    <div className="grid grid-cols-2 gap-2">
      <ToneCurveAnchorField
        label="Input"
        value={anchor.input}
        step={step}
        isIntegerBand={props.isIntegerBand}
        disabled={isToneCurveEndpointIndex(index, props.anchors.length)}
        onCommitValue={(value) => props.onChange(moveSelectedAnchorInputTo(props.anchors, index, value, props.ranges))}
      />
      <ToneCurveAnchorField
        label="Output"
        value={anchor.output}
        step={step}
        isIntegerBand={props.isIntegerBand}
        onCommitValue={(value) => props.onChange(moveSelectedAnchorOutputTo(props.anchors, index, value, props.ranges))}
      />
    </div>
  );
}

interface ToneCurveAnchorFieldProps {
  label: string;
  value: number;
  step: number;
  isIntegerBand: boolean;
  disabled?: boolean;
  onCommitValue: (value: number) => void;
}

function ToneCurveAnchorField(props: ToneCurveAnchorFieldProps): JSX.Element {
  const field = useToneCurveAnchorFieldController(props);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{props.label}</span>
      <div className="flex items-center gap-1">
        <ToneCurveStepperButton label={`Decrease ${props.label}`} disabled={props.disabled} onClick={() => field.step(-1)}>
          <Minus />
        </ToneCurveStepperButton>
        <Input
          aria-label={props.label}
          inputMode="numeric"
          disabled={props.disabled}
          value={field.displayedText}
          onChange={(event) => field.setDraft(event.target.value)}
          onBlur={field.commit}
          onKeyDown={(event) => commitToneCurveFieldOnEnter(event, field.commit)}
          className="h-8 text-center text-foreground"
        />
        <ToneCurveStepperButton label={`Increase ${props.label}`} disabled={props.disabled} onClick={() => field.step(1)}>
          <Plus />
        </ToneCurveStepperButton>
      </div>
    </div>
  );
}

interface ToneCurveAnchorFieldController {
  displayedText: string;
  setDraft: (text: string) => void;
  commit: () => void;
  step: (direction: number) => void;
}

function useToneCurveAnchorFieldController(props: ToneCurveAnchorFieldProps): ToneCurveAnchorFieldController {
  const formatted = formatToneCurveFieldValue(props.value, props.isIntegerBand);
  const [draft, setDraft] = useState<string | null>(null);
  return {
    displayedText: draft ?? formatted,
    setDraft,
    commit: () => commitToneCurveAnchorField(draft ?? formatted, props.onCommitValue, setDraft),
    step: (direction) => props.onCommitValue(props.value + direction * props.step),
  };
}

function commitToneCurveAnchorField(
  text: string,
  onCommitValue: (value: number) => void,
  setDraft: (text: string | null) => void,
): void {
  const parsed = parseToneCurveFieldValueOrNull(text);
  if (parsed !== null) onCommitValue(parsed);
  setDraft(null);
}

function commitToneCurveFieldOnEnter(event: ReactKeyboardEvent<HTMLInputElement>, commit: () => void): void {
  if (event.key !== "Enter") return;
  event.preventDefault();
  commit();
}

interface ToneCurveStepperButtonProps {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: JSX.Element;
}

function ToneCurveStepperButton(props: ToneCurveStepperButtonProps): JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="size-8 shrink-0"
    >
      {props.children}
    </Button>
  );
}

interface SelectedToneCurveAnchor {
  readonly selectedAnchorIndex: number;
  readonly selectAnchor: (index: number) => void;
}

function useSelectedToneCurveAnchorIndex(anchorCount: number): SelectedToneCurveAnchor {
  const [requestedIndex, setRequestedIndex] = useState(DEFAULT_SELECTED_TONE_CURVE_ANCHOR_INDEX);
  return {
    selectedAnchorIndex: clampSelectedToneCurveAnchorIndex(requestedIndex, anchorCount),
    selectAnchor: setRequestedIndex,
  };
}

function ToneCurveEditorLoading(): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Tone curve</span>
      <HistogramSkeleton />
    </div>
  );
}
