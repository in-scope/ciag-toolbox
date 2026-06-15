import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  buildMonotoneToneCurve,
  evaluateToneCurveAtInput,
  type ToneCurveAnchor,
} from "@/lib/image/apply-tone-curve";
import { toneCurveFieldStepForBand } from "@/lib/image/tone-curve-anchor-fields";
import {
  applyToneCurveAnchorKeyboardAction,
  isToneCurveEditorKey,
} from "@/lib/image/tone-curve-anchor-keyboard";
import {
  addToneCurveAnchor,
  indexOfToneCurveAnchorByInput,
  isRemovableInteriorAnchorIndex,
  moveToneCurveAnchor,
  removeToneCurveAnchor,
  resolveToneCurveAnchorsOrDefault,
  type ToneCurveValueRanges,
} from "@/lib/image/tone-curve-editor-state";
import { cn } from "@/lib/utils";

const TONE_CURVE_SAMPLE_COUNT = 48;

interface HistogramToneCurveEditorProps {
  ranges: ToneCurveValueRanges;
  anchors: ReadonlyArray<ToneCurveAnchor> | null;
  onChange: (next: ReadonlyArray<ToneCurveAnchor>) => void;
  selectedAnchorIndex: number;
  onSelectAnchor: (index: number) => void;
  isIntegerBand: boolean;
}

export function HistogramToneCurveEditor(props: HistogramToneCurveEditorProps): JSX.Element {
  const anchors = resolveToneCurveAnchorsOrDefault(props.anchors, props.ranges);
  const drag = useToneCurveAnchorDrag(props.ranges, anchors, props.onChange, props.onSelectAnchor);
  return (
    <div
      className="absolute inset-0 touch-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      onKeyDown={(event) => nudgeOrDeleteSelectedAnchorFromKey(event, props, anchors)}
      onPointerDown={drag.onBackgroundPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.endDrag}
      onPointerCancel={drag.endDrag}
    >
      <ToneCurveSvgPath ranges={props.ranges} anchors={anchors} />
      {anchors.map((anchor, index) => (
        <ToneCurveAnchorHandle
          key={index}
          point={projectAnchorToFractionPoint(anchor, props.ranges)}
          isInterior={isRemovableInteriorAnchorIndex(anchors, index)}
          isSelected={index === props.selectedAnchorIndex}
          onPointerDown={(event) => drag.beginDrag(event, index)}
          onRemove={() => drag.removeAnchorAt(index)}
        />
      ))}
    </div>
  );
}

function nudgeOrDeleteSelectedAnchorFromKey(
  event: ReactKeyboardEvent<HTMLDivElement>,
  props: HistogramToneCurveEditorProps,
  anchors: ReadonlyArray<ToneCurveAnchor>,
): void {
  if (!isToneCurveEditorKey(event.key)) return;
  event.preventDefault();
  const step = toneCurveFieldStepForBand(props.isIntegerBand);
  const next = applyToneCurveAnchorKeyboardAction(event.key, anchors, props.selectedAnchorIndex, props.ranges, step);
  if (next.anchors !== anchors) props.onChange(next.anchors);
  if (next.selectedAnchorIndex !== props.selectedAnchorIndex) props.onSelectAnchor(next.selectedAnchorIndex);
}

interface FractionPoint {
  readonly x: number;
  readonly y: number;
}

interface ToneCurveAnchorDrag {
  beginDrag: (event: ReactPointerEvent<HTMLElement>, index: number) => void;
  onBackgroundPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  endDrag: () => void;
  removeAnchorAt: (index: number) => void;
}

function useToneCurveAnchorDrag(
  ranges: ToneCurveValueRanges,
  anchors: ReadonlyArray<ToneCurveAnchor>,
  onChange: (next: ReadonlyArray<ToneCurveAnchor>) => void,
  onSelectAnchor: (index: number) => void,
): ToneCurveAnchorDrag {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  return {
    beginDrag: (event, index) => beginAnchorDrag(event, index, setActiveIndex, onSelectAnchor),
    onBackgroundPointerDown: (event) =>
      addAnchorFromBackgroundClick(event, ranges, anchors, onChange, setActiveIndex, onSelectAnchor),
    onPointerMove: (event) => continueAnchorDrag(event, activeIndex, ranges, anchors, onChange),
    endDrag: () => setActiveIndex(null),
    removeAnchorAt: (index) => onChange(removeToneCurveAnchor(anchors, index)),
  };
}

function beginAnchorDrag(
  event: ReactPointerEvent<HTMLElement>,
  index: number,
  setActiveIndex: (next: number | null) => void,
  onSelectAnchor: (index: number) => void,
): void {
  event.stopPropagation();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  onSelectAnchor(index);
  setActiveIndex(index);
}

function addAnchorFromBackgroundClick(
  event: ReactPointerEvent<HTMLDivElement>,
  ranges: ToneCurveValueRanges,
  anchors: ReadonlyArray<ToneCurveAnchor>,
  onChange: (next: ReadonlyArray<ToneCurveAnchor>) => void,
  setActiveIndex: (next: number | null) => void,
  onSelectAnchor: (index: number) => void,
): void {
  const anchor = anchorFromPointerEvent(event, ranges);
  const next = addToneCurveAnchor(anchors, anchor, ranges);
  onChange(next);
  event.currentTarget.setPointerCapture?.(event.pointerId);
  const addedIndex = indexOfToneCurveAnchorByInput(next, anchor.input);
  onSelectAnchor(addedIndex);
  setActiveIndex(addedIndex);
}

function continueAnchorDrag(
  event: ReactPointerEvent<HTMLDivElement>,
  activeIndex: number | null,
  ranges: ToneCurveValueRanges,
  anchors: ReadonlyArray<ToneCurveAnchor>,
  onChange: (next: ReadonlyArray<ToneCurveAnchor>) => void,
): void {
  if (activeIndex === null) return;
  onChange(moveToneCurveAnchor(anchors, activeIndex, anchorFromPointerEvent(event, ranges), ranges));
}

function anchorFromPointerEvent(
  event: ReactPointerEvent<HTMLElement>,
  ranges: ToneCurveValueRanges,
): ToneCurveAnchor {
  const fraction = pointerFractionWithinElement(event.currentTarget, event.clientX, event.clientY);
  return {
    input: ranges.inputMin + fraction.x * (ranges.inputMax - ranges.inputMin),
    output: ranges.outputMin + (1 - fraction.y) * (ranges.outputMax - ranges.outputMin),
  };
}

function pointerFractionWithinElement(element: HTMLElement, clientX: number, clientY: number): FractionPoint {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.width <= 0 ? 0 : clampUnit((clientX - rect.left) / rect.width),
    y: rect.height <= 0 ? 0 : clampUnit((clientY - rect.top) / rect.height),
  };
}

interface ToneCurveSvgPathProps {
  ranges: ToneCurveValueRanges;
  anchors: ReadonlyArray<ToneCurveAnchor>;
}

function ToneCurveSvgPath(props: ToneCurveSvgPathProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full overflow-visible"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
    >
      <path
        d={buildToneCurvePathData(props.anchors, props.ranges)}
        className="fill-none stroke-primary"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function buildToneCurvePathData(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  ranges: ToneCurveValueRanges,
): string {
  const curve = buildMonotoneToneCurve(anchors);
  const points = Array.from({ length: TONE_CURVE_SAMPLE_COUNT + 1 }, (_unused, step) =>
    sampleCurveAtStep(curve, ranges, step),
  );
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function sampleCurveAtStep(
  curve: ReturnType<typeof buildMonotoneToneCurve>,
  ranges: ToneCurveValueRanges,
  step: number,
): FractionPoint {
  const input = ranges.inputMin + ((ranges.inputMax - ranges.inputMin) * step) / TONE_CURVE_SAMPLE_COUNT;
  const output = evaluateToneCurveAtInput(curve, input);
  return projectAnchorToFractionPoint({ input, output }, ranges);
}

function projectAnchorToFractionPoint(anchor: ToneCurveAnchor, ranges: ToneCurveValueRanges): FractionPoint {
  return {
    x: fractionWithinRange(anchor.input, ranges.inputMin, ranges.inputMax),
    y: 1 - fractionWithinRange(anchor.output, ranges.outputMin, ranges.outputMax),
  };
}

interface ToneCurveAnchorHandleProps {
  point: FractionPoint;
  isInterior: boolean;
  isSelected: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onRemove: () => void;
}

function ToneCurveAnchorHandle(props: ToneCurveAnchorHandleProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={props.isInterior ? "Curve anchor (right-click to remove)" : "Curve endpoint"}
      data-selected={props.isSelected ? "true" : "false"}
      className={cn(
        "absolute -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border border-background bg-primary",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        props.isSelected ? "size-4 ring-2 ring-ring ring-offset-1 ring-offset-background" : "size-3",
      )}
      style={{ left: `${props.point.x * 100}%`, top: `${props.point.y * 100}%` }}
      onPointerDown={props.onPointerDown}
      onContextMenu={(event) => removeInteriorAnchorOnContextMenu(event, props)}
    />
  );
}

function removeInteriorAnchorOnContextMenu(
  event: ReactPointerEvent<HTMLButtonElement> | React.MouseEvent<HTMLButtonElement>,
  props: ToneCurveAnchorHandleProps,
): void {
  event.preventDefault();
  if (props.isInterior) props.onRemove();
}

function fractionWithinRange(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clampUnit((value - min) / (max - min));
}

function clampUnit(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
