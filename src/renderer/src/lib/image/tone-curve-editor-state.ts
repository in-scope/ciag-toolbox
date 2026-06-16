import type { ToneCurveAnchor } from "@/lib/image/apply-tone-curve";

/**
 * Pure state model for the interactive tone-curve editor (CT-099). The editor
 * overlays the band histogram: the X axis spans the band's value range (the
 * histogram min/max) and the Y axis spans the data-type output range. The two
 * endpoints behave like the CT-080 black/white points, so the default 2-anchor
 * curve is byte-for-byte the linear black/white stretch (see the test). Adding,
 * moving, and removing anchors are pure array transforms tested independently of
 * the React component.
 */
export interface ToneCurveValueRanges {
  readonly inputMin: number;
  readonly inputMax: number;
  readonly outputMin: number;
  readonly outputMax: number;
}

const MIN_ANCHOR_INPUT_SEPARATION_FRACTION = 1e-3;

export function buildDefaultToneCurveAnchors(
  ranges: ToneCurveValueRanges,
): ReadonlyArray<ToneCurveAnchor> {
  return [
    { input: ranges.inputMin, output: ranges.outputMin },
    { input: ranges.inputMax, output: ranges.outputMax },
  ];
}

export function resolveToneCurveAnchorsOrDefault(
  anchors: ReadonlyArray<ToneCurveAnchor> | null,
  ranges: ToneCurveValueRanges,
): ReadonlyArray<ToneCurveAnchor> {
  if (anchors && anchors.length >= 2) return anchors;
  return buildDefaultToneCurveAnchors(ranges);
}

export function toneCurveAnchorsMatchDefaultIdentity(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  ranges: ToneCurveValueRanges,
): boolean {
  const identity = buildDefaultToneCurveAnchors(ranges);
  if (anchors.length !== identity.length) return false;
  return anchors.every((anchor, index) => anchorsHaveSameInputAndOutput(anchor, identity[index]!));
}

function anchorsHaveSameInputAndOutput(first: ToneCurveAnchor, second: ToneCurveAnchor): boolean {
  return first.input === second.input && first.output === second.output;
}

export function addToneCurveAnchor(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  anchor: ToneCurveAnchor,
  ranges: ToneCurveValueRanges,
): ReadonlyArray<ToneCurveAnchor> {
  const clamped = clampAnchorToRanges(anchor, ranges);
  if (anchorsAlreadyHaveInputNear(anchors, clamped.input, ranges)) return anchors;
  return [...anchors, clamped].sort(compareAnchorsByInput);
}

export function moveToneCurveAnchor(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  index: number,
  target: ToneCurveAnchor,
  ranges: ToneCurveValueRanges,
): ReadonlyArray<ToneCurveAnchor> {
  if (index < 0 || index >= anchors.length) return anchors;
  const clamped = clampAnchorToRanges(target, ranges);
  const input = constrainInputBetweenNeighbors(anchors, index, clamped.input, ranges);
  return replaceAnchorAtIndex(anchors, index, { input, output: clamped.output });
}

export function removeToneCurveAnchor(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  index: number,
): ReadonlyArray<ToneCurveAnchor> {
  if (!isRemovableInteriorAnchorIndex(anchors, index)) return anchors;
  return anchors.filter((_unused, current) => current !== index);
}

export function indexOfToneCurveAnchorByInput(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  input: number,
): number {
  return anchors.findIndex((anchor) => anchor.input === input);
}

export function isRemovableInteriorAnchorIndex(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  index: number,
): boolean {
  return index > 0 && index < anchors.length - 1;
}

function clampAnchorToRanges(anchor: ToneCurveAnchor, ranges: ToneCurveValueRanges): ToneCurveAnchor {
  return {
    input: clampNumberToRange(anchor.input, ranges.inputMin, ranges.inputMax),
    output: clampNumberToRange(anchor.output, ranges.outputMin, ranges.outputMax),
  };
}

function constrainInputBetweenNeighbors(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  index: number,
  input: number,
  ranges: ToneCurveValueRanges,
): number {
  const separation = anchorInputSeparationForRange(ranges);
  const lower = index === 0 ? ranges.inputMin : anchors[index - 1]!.input + separation;
  const upper = index === anchors.length - 1 ? ranges.inputMax : anchors[index + 1]!.input - separation;
  return clampNumberToRange(input, lower, Math.max(lower, upper));
}

function anchorsAlreadyHaveInputNear(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  input: number,
  ranges: ToneCurveValueRanges,
): boolean {
  const separation = anchorInputSeparationForRange(ranges);
  return anchors.some((anchor) => Math.abs(anchor.input - input) < separation);
}

function anchorInputSeparationForRange(ranges: ToneCurveValueRanges): number {
  return Math.max(0, ranges.inputMax - ranges.inputMin) * MIN_ANCHOR_INPUT_SEPARATION_FRACTION;
}

function replaceAnchorAtIndex(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  index: number,
  anchor: ToneCurveAnchor,
): ReadonlyArray<ToneCurveAnchor> {
  return anchors.map((current, position) => (position === index ? anchor : current));
}

function compareAnchorsByInput(first: ToneCurveAnchor, second: ToneCurveAnchor): number {
  return first.input - second.input;
}

function clampNumberToRange(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
