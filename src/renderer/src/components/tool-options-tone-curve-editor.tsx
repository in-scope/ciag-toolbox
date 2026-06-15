import { Minus, Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

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
import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";
import { buildLuminanceRasterFromRgbComposite } from "@/lib/image/rgb-composite-luminance";
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
import {
  colorBandIndexForToneCurveChannel,
  setToneCurveChannelAnchors,
  toneCurveEditingModeForComposite,
  type ToneCurveChannel,
  type ToneCurveChannelAnchors,
} from "@/lib/image/tone-curve-channels";
import { formatToneCurveEditingBandLabel } from "@/lib/image/tone-curve-editing-band-label";
import { clampBandIndexToRaster, type RasterImage } from "@/lib/image/raster-image";
import {
  buildDefaultToneCurveAnchors,
  resolveToneCurveAnchorsOrDefault,
  toneCurveAnchorsMatchDefaultIdentity,
  type ToneCurveValueRanges,
} from "@/lib/image/tone-curve-editor-state";
import type { ViewportRenderingState } from "@/lib/actions/viewport-action";
import { useViewportRendering } from "@/state/viewport-rendering-context";

type ToneCurveAnchors = ReadonlyArray<ToneCurveAnchor>;

interface ToolOptionsToneCurveEditorProps {
  viewportIndex: number;
  raster: RasterImage;
}

export function ToolOptionsToneCurveEditor(
  props: ToolOptionsToneCurveEditorProps,
): JSX.Element {
  const isComposite = shouldRenderRasterAsRgbComposite(props.raster);
  if (toneCurveEditingModeForComposite(isComposite) === "channels") {
    return <CompositeToneCurveEditor viewportIndex={props.viewportIndex} raster={props.raster} />;
  }
  return <ScientificToneCurveEditor viewportIndex={props.viewportIndex} raster={props.raster} />;
}

function ScientificToneCurveEditor(props: ToolOptionsToneCurveEditorProps): JSX.Element {
  const bandIndex = useSelectedBandIndexForViewport(props.viewportIndex, props.raster);
  const histogram = useBandHistogramFromCacheOrWorker(props.raster, bandIndex, props.viewportIndex);
  const binding = useToneCurveAnchorBinding(props.viewportIndex);
  const ranges = useToneCurveRangesOrNull(props.raster, bandIndex, histogram);
  useInitializeToneCurveAnchorsWhenAbsent(ranges, binding);
  if (!histogram || !ranges) return <ToneCurveEditorLoading />;
  return (
    <LoadedToneCurveEditor
      raster={props.raster}
      histogram={histogram}
      ranges={ranges}
      binding={binding}
      aboveHistogram={renderEditingBandLabelWhenMultiBand(props.raster, bandIndex)}
    />
  );
}

function CompositeToneCurveEditor(props: ToolOptionsToneCurveEditorProps): JSX.Element {
  const channel = useActiveToneCurveChannel(props.viewportIndex);
  const histogramRaster = useChannelHistogramRaster(props.raster, channel);
  const bandIndex = colorBandIndexForToneCurveChannel(channel) ?? 0;
  const histogram = useBandHistogramFromCacheOrWorker(histogramRaster, bandIndex, props.viewportIndex);
  const binding = useCompositeToneCurveBinding(props.viewportIndex, channel);
  const ranges = useToneCurveRangesOrNull(histogramRaster, bandIndex, histogram);
  useInitializeToneCurveAnchorsWhenAbsent(ranges, binding);
  if (!histogram || !ranges) return <ToneCurveEditorLoading />;
  return (
    <LoadedToneCurveEditor
      raster={histogramRaster}
      histogram={histogram}
      ranges={ranges}
      binding={binding}
      histogramAccessibleLabel={toneCurveChannelHistogramLabel(channel)}
      aboveHistogram={<ToneCurveChannelSelector viewportIndex={props.viewportIndex} activeChannel={channel} />}
    />
  );
}

function useChannelHistogramRaster(raster: RasterImage, channel: ToneCurveChannel): RasterImage {
  const luminanceRaster = useMemo(() => buildLuminanceRasterFromRgbComposite(raster), [raster]);
  return colorBandIndexForToneCurveChannel(channel) === null ? luminanceRaster : raster;
}

function useActiveToneCurveChannel(viewportIndex: number): ToneCurveChannel {
  const renderingApi = useViewportRendering();
  return renderingApi.getRenderingState(viewportIndex).toneCurveActiveChannel;
}

function useCompositeToneCurveBinding(
  viewportIndex: number,
  channel: ToneCurveChannel,
): ToneCurveAnchorBinding {
  const renderingApi = useViewportRendering();
  const anchors = renderingApi.getRenderingState(viewportIndex).toneCurveAnchors;
  const onChange = useCallback(
    (next: ToneCurveAnchors) => writeActiveChannelAnchors(renderingApi, viewportIndex, channel, next),
    [renderingApi, viewportIndex, channel],
  );
  return { anchors, onChange };
}

function writeActiveChannelAnchors(
  renderingApi: ReturnType<typeof useViewportRendering>,
  viewportIndex: number,
  channel: ToneCurveChannel,
  next: ToneCurveAnchors,
): void {
  const current = renderingApi.getRenderingState(viewportIndex);
  renderingApi.setRenderingState(viewportIndex, {
    ...current,
    toneCurveAnchors: next,
    toneCurveChannelAnchors: setToneCurveChannelAnchors(current.toneCurveChannelAnchors, channel, next),
  });
}

interface ToneCurveChannelSelectorProps {
  viewportIndex: number;
  activeChannel: ToneCurveChannel;
}

interface ToneCurveChannelOption {
  readonly channel: ToneCurveChannel;
  readonly shortLabel: string;
  readonly accessibleName: string;
}

const TONE_CURVE_CHANNEL_OPTIONS: ReadonlyArray<ToneCurveChannelOption> = [
  { channel: "rgb", shortLabel: "RGB", accessibleName: "RGB" },
  { channel: "red", shortLabel: "R", accessibleName: "Red" },
  { channel: "green", shortLabel: "G", accessibleName: "Green" },
  { channel: "blue", shortLabel: "B", accessibleName: "Blue" },
];

function ToneCurveChannelSelector(props: ToneCurveChannelSelectorProps): JSX.Element {
  const switchChannel = useSwitchActiveToneCurveChannel(props.viewportIndex);
  return (
    <div role="group" aria-label="Tone curve channel" className="flex gap-1">
      {TONE_CURVE_CHANNEL_OPTIONS.map((option) => (
        <ToneCurveChannelButton
          key={option.channel}
          option={option}
          isActive={option.channel === props.activeChannel}
          onSelect={() => switchChannel(option.channel)}
        />
      ))}
    </div>
  );
}

interface ToneCurveChannelButtonProps {
  option: ToneCurveChannelOption;
  isActive: boolean;
  onSelect: () => void;
}

function ToneCurveChannelButton(props: ToneCurveChannelButtonProps): JSX.Element {
  return (
    <Button
      type="button"
      size="sm"
      variant={props.isActive ? "default" : "outline"}
      aria-label={props.option.accessibleName}
      aria-pressed={props.isActive}
      onClick={props.onSelect}
      className="flex-1"
    >
      {props.option.shortLabel}
    </Button>
  );
}

function useSwitchActiveToneCurveChannel(
  viewportIndex: number,
): (channel: ToneCurveChannel) => void {
  const renderingApi = useViewportRendering();
  return useCallback(
    (nextChannel: ToneCurveChannel) => switchActiveChannel(renderingApi, viewportIndex, nextChannel),
    [renderingApi, viewportIndex],
  );
}

function switchActiveChannel(
  renderingApi: ReturnType<typeof useViewportRendering>,
  viewportIndex: number,
  nextChannel: ToneCurveChannel,
): void {
  const current = renderingApi.getRenderingState(viewportIndex);
  const channelAnchors = stashActiveChannelAnchors(current);
  renderingApi.setRenderingState(viewportIndex, {
    ...current,
    toneCurveActiveChannel: nextChannel,
    toneCurveChannelAnchors: channelAnchors,
    toneCurveAnchors: channelAnchors[nextChannel] ?? null,
  });
}

function stashActiveChannelAnchors(state: ViewportRenderingState): ToneCurveChannelAnchors {
  if (!state.toneCurveAnchors) return state.toneCurveChannelAnchors;
  return setToneCurveChannelAnchors(
    state.toneCurveChannelAnchors,
    state.toneCurveActiveChannel,
    state.toneCurveAnchors,
  );
}

function toneCurveChannelHistogramLabel(channel: ToneCurveChannel): string {
  return `${toneCurveChannelDisplayName(channel)} channel intensity histogram`;
}

function toneCurveChannelDisplayName(channel: ToneCurveChannel): string {
  if (channel === "red") return "Red";
  if (channel === "green") return "Green";
  if (channel === "blue") return "Blue";
  return "Value";
}

function renderEditingBandLabelWhenMultiBand(raster: RasterImage, bandIndex: number): ReactNode {
  if (raster.bandCount <= 1) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="tone-curve-editing-band">
      {formatToneCurveEditingBandLabel(raster, bandIndex)}
    </p>
  );
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
  aboveHistogram?: ReactNode;
  histogramAccessibleLabel?: string;
}

function LoadedToneCurveEditor(props: LoadedToneCurveEditorProps): JSX.Element {
  const anchors = resolveToneCurveAnchorsOrDefault(props.binding.anchors, props.ranges);
  const selection = useSelectedToneCurveAnchorIndex(anchors.length);
  return (
    <div className="flex flex-col gap-2">
      <ToneCurveEditorHeader
        isAtIdentity={toneCurveAnchorsMatchDefaultIdentity(anchors, props.ranges)}
        onReset={() => resetToneCurveToIdentityDiagonal(props.ranges, props.binding.onChange, selection.selectAnchor)}
      />
      {props.aboveHistogram}
      <HistogramCanvas
        histogram={props.histogram}
        sampleFormat={props.raster.sampleFormat}
        accessibleLabel={props.histogramAccessibleLabel}
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

interface ToneCurveEditorHeaderProps {
  isAtIdentity: boolean;
  onReset: () => void;
}

function ToneCurveEditorHeader(props: ToneCurveEditorHeaderProps): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-muted-foreground">Tone curve</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={props.isAtIdentity}
        onClick={props.onReset}
      >
        Reset
      </Button>
    </div>
  );
}

function resetToneCurveToIdentityDiagonal(
  ranges: ToneCurveValueRanges,
  onChange: (next: ToneCurveAnchors) => void,
  selectAnchor: (index: number) => void,
): void {
  onChange(buildDefaultToneCurveAnchors(ranges));
  selectAnchor(DEFAULT_SELECTED_TONE_CURVE_ANCHOR_INDEX);
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
