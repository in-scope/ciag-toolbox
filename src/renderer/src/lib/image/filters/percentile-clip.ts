// CT-205: percentile clipping with np.clip semantics. The cut points are the
// lower/upper percentiles of the supplied values (numpy's default linear
// interpolation over the sorted data), and every value is clamped into
// [lowerCutPoint, upperCutPoint]. Computing cut points and clamping are
// separate exports so the action can derive ONE pair over the whole stack and
// clamp every band to it (full-stack scope) or give each band its own pair
// (band-wise scope). 0/100 percentiles are the data min/max, so they clip
// nothing; equal percentiles collapse every value to the single cut point.

export interface PercentileClipBounds {
  readonly lowerPercentile: number;
  readonly upperPercentile: number;
}

export interface PercentileCutPoints {
  readonly lowerCutPoint: number;
  readonly upperCutPoint: number;
}

export function applyPercentileClip(
  values: ArrayLike<number>,
  bounds: PercentileClipBounds,
): Float32Array {
  return clampValuesToCutPoints(values, computePercentileCutPoints(values, bounds));
}

export function computePercentileCutPoints(
  values: ArrayLike<number>,
  bounds: PercentileClipBounds,
): PercentileCutPoints {
  assertPercentileClipBoundsAreValid(bounds);
  assertValuesAreNotEmpty(values);
  const sorted = sortValuesAscending(values);
  return {
    lowerCutPoint: interpolatePercentileFromSortedValues(sorted, bounds.lowerPercentile),
    upperCutPoint: interpolatePercentileFromSortedValues(sorted, bounds.upperPercentile),
  };
}

export function clampValuesToCutPoints(
  values: ArrayLike<number>,
  cutPoints: PercentileCutPoints,
): Float32Array {
  const clamped = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    clamped[index] = clampValueToRange(
      values[index] ?? 0,
      cutPoints.lowerCutPoint,
      cutPoints.upperCutPoint,
    );
  }
  return clamped;
}

export function assertPercentileClipBoundsAreValid(bounds: PercentileClipBounds): void {
  assertPercentileIsWithinRange(bounds.lowerPercentile, "lower");
  assertPercentileIsWithinRange(bounds.upperPercentile, "upper");
  if (bounds.lowerPercentile > bounds.upperPercentile) {
    throw new Error("Enter an upper percentile at or above the lower percentile.");
  }
}

function assertPercentileIsWithinRange(percentile: number, sideName: string): void {
  if (Number.isFinite(percentile) && percentile >= 0 && percentile <= 100) return;
  throw new Error(`Enter a ${sideName} percentile between 0 and 100.`);
}

function assertValuesAreNotEmpty(values: ArrayLike<number>): void {
  if (values.length > 0) return;
  throw new Error("The stack has no pixel values to compute percentiles from.");
}

function sortValuesAscending(values: ArrayLike<number>): Float64Array {
  const sorted = new Float64Array(values.length);
  for (let index = 0; index < values.length; index += 1) sorted[index] = values[index] ?? 0;
  return sorted.sort();
}

// numpy's default "linear" percentile: rank p/100 * (n - 1) interpolates
// between the two nearest order statistics of the sorted data.
function interpolatePercentileFromSortedValues(sorted: Float64Array, percentile: number): number {
  const rank = (percentile / 100) * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.min(lowerIndex + 1, sorted.length - 1);
  const lowerValue = sorted[lowerIndex] ?? 0;
  const upperValue = sorted[upperIndex] ?? 0;
  return lowerValue + (rank - lowerIndex) * (upperValue - lowerValue);
}

function clampValueToRange(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
