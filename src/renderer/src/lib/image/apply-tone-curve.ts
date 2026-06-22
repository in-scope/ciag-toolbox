import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
} from "@/lib/image/raster-image";
import {
  clampValueToDataTypeRangeRoundingIntegers,
  dataTypeValueRangeForBand,
  isFloatTypedArray,
  type DataTypeValueRange,
} from "@/lib/image/data-type-value-range";
import {
  remapRasterBandWithinRegion,
  type RegionRemapOptions,
} from "@/lib/image/remap-band-region";

export interface ToneCurveAnchor {
  readonly input: number;
  readonly output: number;
}

interface ToneCurveSegment {
  readonly startInput: number;
  readonly endInput: number;
  readonly startOutput: number;
  readonly endOutput: number;
  readonly startTangent: number;
  readonly endTangent: number;
}

export interface ToneCurve {
  readonly anchors: ReadonlyArray<ToneCurveAnchor>;
  readonly segments: ReadonlyArray<ToneCurveSegment>;
}

export type ApplyToneCurveOptions = RegionRemapOptions;

export function buildMonotoneToneCurve(anchors: ReadonlyArray<ToneCurveAnchor>): ToneCurve {
  const ordered = assertAnchorsAreOrderedWithAtLeastTwo(anchors);
  const secantSlopes = computeSecantSlopesBetweenAnchors(ordered);
  const tangents = computeMonotoneHermiteTangents(ordered, secantSlopes);
  return { anchors: ordered, segments: buildSegmentsFromAnchorsAndTangents(ordered, tangents) };
}

export function evaluateToneCurveAtInput(curve: ToneCurve, input: number): number {
  const firstAnchor = curve.anchors[0]!;
  const lastAnchor = curve.anchors[curve.anchors.length - 1]!;
  if (input <= firstAnchor.input) return firstAnchor.output;
  if (input >= lastAnchor.input) return lastAnchor.output;
  return evaluateHermiteSegmentAtInput(findSegmentContainingInput(curve.segments, input), input);
}

export function buildToneCurveLookupTable(
  curve: ToneCurve,
  range: DataTypeValueRange,
  entryCount: number,
): ReadonlyArray<number> {
  const lastEntryIndex = entryCount - 1;
  return Array.from({ length: entryCount }, (_unused, index) =>
    evaluateToneCurveAtInput(curve, inputForLookupTableEntry(range, index, lastEntryIndex)),
  );
}

// CT-170: the WebGL display shader samples a band value that has already been
// mapped into the [0, 1] display unit (data-type range -> 0..1). This builds the
// matching LUT in that same display-normalized domain: entry i answers "what does
// the curve output for the value whose display-unit coordinate is i/(N-1)?", with
// the output renormalized back into the display unit. The shader can then remap a
// sampled value by texturing this LUT directly, without touching pixel data.
export function buildDisplayNormalizedToneCurveLookupTable(
  curve: ToneCurve,
  range: DataTypeValueRange,
  entryCount: number,
): ReadonlyArray<number> {
  return buildDisplayNormalizedLookupTable(
    (value) => evaluateToneCurveAtInput(curve, value),
    range,
    entryCount,
  );
}

// CT-186: a display-normalized LUT for ANY data-domain value map (tone curve,
// brightness/contrast). Entry i answers "for the value at display coordinate
// i/(N-1), what does mapDataValue output?", renormalized into the display unit, so
// the GPU shader can remap a sampled value by texturing it without touching pixels.
export function buildDisplayNormalizedLookupTable(
  mapDataValue: (value: number) => number,
  range: DataTypeValueRange,
  entryCount: number,
): ReadonlyArray<number> {
  const lastEntryIndex = entryCount - 1;
  return Array.from({ length: entryCount }, (_unused, index) =>
    normalizeOutputIntoDisplayUnit(
      mapDataValue(inputForLookupTableEntry(range, index, lastEntryIndex)),
      range,
    ),
  );
}

// CT-177: a composite channel's display LUT folds the per-channel curve and the
// rgb/Value curve into one sampling table. Entry i answers "for the value at
// display coordinate i/(N-1), what does the rgb/Value curve output after the
// per-channel curve has remapped it?", renormalized into the display unit. The
// per-channel curve is the inner map; the rgb/Value curve is applied on top.
export function buildDisplayNormalizedComposedToneCurveLookupTable(
  perChannelCurve: ToneCurve,
  valueCurve: ToneCurve,
  range: DataTypeValueRange,
  entryCount: number,
): ReadonlyArray<number> {
  const lastEntryIndex = entryCount - 1;
  return Array.from({ length: entryCount }, (_unused, index) =>
    composedDisplayOutputForLookupTableEntry(perChannelCurve, valueCurve, range, index, lastEntryIndex),
  );
}

function composedDisplayOutputForLookupTableEntry(
  perChannelCurve: ToneCurve,
  valueCurve: ToneCurve,
  range: DataTypeValueRange,
  index: number,
  lastEntryIndex: number,
): number {
  const input = inputForLookupTableEntry(range, index, lastEntryIndex);
  const channelOutput = evaluateToneCurveAtInput(perChannelCurve, input);
  return normalizeOutputIntoDisplayUnit(evaluateToneCurveAtInput(valueCurve, channelOutput), range);
}

function normalizeOutputIntoDisplayUnit(output: number, range: DataTypeValueRange): number {
  const span = range.max - range.min;
  if (span <= 0) return 0;
  return clampToUnitInterval((output - range.min) / span);
}

function clampToUnitInterval(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function applyToneCurveToRasterBand(
  raster: RasterImage,
  bandIndex: number,
  anchors: ReadonlyArray<ToneCurveAnchor>,
  options: ApplyToneCurveOptions = {},
): RasterImage {
  const band = getRasterBandPixelsOrThrow(raster, bandIndex);
  const typeRange = dataTypeValueRangeForBand(band, raster.sampleFormat);
  const roundForOutput = !isFloatTypedArray(band);
  const curve = buildMonotoneToneCurve(anchors);
  return remapRasterBandWithinRegion(raster, bandIndex, options, (value) =>
    clampValueToDataTypeRangeRoundingIntegers(evaluateToneCurveAtInput(curve, value), typeRange, roundForOutput),
  );
}

// CT-178: bake one composite channel band. The per-channel curve is the inner
// map and the rgb/Value curve is applied on top, matching the CT-177 preview
// contract composed(v) = valueCurve(channelCurve(v)). A null curve folds in as the
// identity diagonal over the band's data-type range, so an unedited channel still
// receives the rgb/Value curve.
export function applyComposedToneCurveToRasterBand(
  raster: RasterImage,
  bandIndex: number,
  perChannelAnchors: ReadonlyArray<ToneCurveAnchor> | null,
  valueAnchors: ReadonlyArray<ToneCurveAnchor> | null,
  options: ApplyToneCurveOptions = {},
): RasterImage {
  const band = getRasterBandPixelsOrThrow(raster, bandIndex);
  const typeRange = dataTypeValueRangeForBand(band, raster.sampleFormat);
  const roundForOutput = !isFloatTypedArray(band);
  const perChannelCurve = buildToneCurveOrIdentity(perChannelAnchors, typeRange);
  const valueCurve = buildToneCurveOrIdentity(valueAnchors, typeRange);
  return remapRasterBandWithinRegion(raster, bandIndex, options, (value) =>
    clampValueToDataTypeRangeRoundingIntegers(
      evaluateComposedToneCurves(perChannelCurve, valueCurve, value),
      typeRange,
      roundForOutput,
    ),
  );
}

function evaluateComposedToneCurves(perChannelCurve: ToneCurve, valueCurve: ToneCurve, value: number): number {
  return evaluateToneCurveAtInput(valueCurve, evaluateToneCurveAtInput(perChannelCurve, value));
}

function buildToneCurveOrIdentity(
  anchors: ReadonlyArray<ToneCurveAnchor> | null,
  range: DataTypeValueRange,
): ToneCurve {
  if (anchors && anchors.length >= 2) return buildMonotoneToneCurve(anchors);
  return buildMonotoneToneCurve([
    { input: range.min, output: range.min },
    { input: range.max, output: range.max },
  ]);
}

function inputForLookupTableEntry(
  range: DataTypeValueRange,
  index: number,
  lastEntryIndex: number,
): number {
  if (lastEntryIndex <= 0) return range.min;
  return range.min + ((range.max - range.min) * index) / lastEntryIndex;
}

function assertAnchorsAreOrderedWithAtLeastTwo(
  anchors: ReadonlyArray<ToneCurveAnchor>,
): ReadonlyArray<ToneCurveAnchor> {
  if (anchors.length < 2) throw new Error("A tone curve needs at least two anchor points.");
  assertAnchorInputsStrictlyIncrease(anchors);
  return anchors;
}

function assertAnchorInputsStrictlyIncrease(anchors: ReadonlyArray<ToneCurveAnchor>): void {
  for (let index = 1; index < anchors.length; index += 1) {
    if (anchors[index]!.input > anchors[index - 1]!.input) continue;
    throw new Error("Tone curve anchors must be ordered by strictly increasing input.");
  }
}

function computeSecantSlopesBetweenAnchors(anchors: ReadonlyArray<ToneCurveAnchor>): number[] {
  const slopes: number[] = [];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    slopes.push(secantSlopeBetweenAnchors(anchors[index]!, anchors[index + 1]!));
  }
  return slopes;
}

function secantSlopeBetweenAnchors(start: ToneCurveAnchor, end: ToneCurveAnchor): number {
  return (end.output - start.output) / (end.input - start.input);
}

function computeMonotoneHermiteTangents(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  secantSlopes: ReadonlyArray<number>,
): number[] {
  const tangents = initializeTangentsFromSecantSlopes(anchors.length, secantSlopes);
  limitTangentsToPreserveMonotonicity(tangents, secantSlopes);
  return tangents;
}

function initializeTangentsFromSecantSlopes(
  anchorCount: number,
  secantSlopes: ReadonlyArray<number>,
): number[] {
  const tangents = new Array<number>(anchorCount);
  tangents[0] = secantSlopes[0]!;
  tangents[anchorCount - 1] = secantSlopes[anchorCount - 2]!;
  for (let index = 1; index < anchorCount - 1; index += 1) {
    tangents[index] = averageInteriorTangent(secantSlopes[index - 1]!, secantSlopes[index]!);
  }
  return tangents;
}

function averageInteriorTangent(previousSlope: number, nextSlope: number): number {
  if (previousSlope * nextSlope <= 0) return 0;
  return (previousSlope + nextSlope) / 2;
}

function limitTangentsToPreserveMonotonicity(
  tangents: number[],
  secantSlopes: ReadonlyArray<number>,
): void {
  for (let index = 0; index < secantSlopes.length; index += 1) {
    rescaleTangentPairForSegment(tangents, secantSlopes[index]!, index);
  }
}

function rescaleTangentPairForSegment(
  tangents: number[],
  secantSlope: number,
  index: number,
): void {
  if (secantSlope === 0) {
    tangents[index] = 0;
    tangents[index + 1] = 0;
    return;
  }
  const scale = monotonicityScaleFactor(tangents[index]! / secantSlope, tangents[index + 1]! / secantSlope);
  tangents[index] = tangents[index]! * scale;
  tangents[index + 1] = tangents[index + 1]! * scale;
}

function monotonicityScaleFactor(startRatio: number, endRatio: number): number {
  const squaredMagnitude = startRatio * startRatio + endRatio * endRatio;
  if (squaredMagnitude <= 9) return 1;
  return 3 / Math.sqrt(squaredMagnitude);
}

function buildSegmentsFromAnchorsAndTangents(
  anchors: ReadonlyArray<ToneCurveAnchor>,
  tangents: ReadonlyArray<number>,
): ToneCurveSegment[] {
  const segments: ToneCurveSegment[] = [];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    segments.push(
      buildSegmentBetweenAnchors(anchors[index]!, anchors[index + 1]!, tangents[index]!, tangents[index + 1]!),
    );
  }
  return segments;
}

function buildSegmentBetweenAnchors(
  start: ToneCurveAnchor,
  end: ToneCurveAnchor,
  startTangent: number,
  endTangent: number,
): ToneCurveSegment {
  return {
    startInput: start.input,
    endInput: end.input,
    startOutput: start.output,
    endOutput: end.output,
    startTangent,
    endTangent,
  };
}

function findSegmentContainingInput(
  segments: ReadonlyArray<ToneCurveSegment>,
  input: number,
): ToneCurveSegment {
  for (const segment of segments) {
    if (input >= segment.startInput && input <= segment.endInput) return segment;
  }
  return segments[segments.length - 1]!;
}

function evaluateHermiteSegmentAtInput(segment: ToneCurveSegment, input: number): number {
  const span = segment.endInput - segment.startInput;
  const normalizedPosition = (input - segment.startInput) / span;
  return interpolateHermiteSegment(segment, normalizedPosition, span);
}

function interpolateHermiteSegment(segment: ToneCurveSegment, t: number, span: number): number {
  const squared = t * t;
  const cubed = squared * t;
  return (
    (2 * cubed - 3 * squared + 1) * segment.startOutput +
    (cubed - 2 * squared + t) * span * segment.startTangent +
    (-2 * cubed + 3 * squared) * segment.endOutput +
    (cubed - squared) * span * segment.endTangent
  );
}
