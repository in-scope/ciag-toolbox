// CT-107: a pure low/high-percentile value range, the robust alternative to the
// absolute min/max used by plain normalize. Sparse near-max outliers push the
// absolute max toward the data-type ceiling, so a min/max stretch leaves the
// bulk of the data compressed near 0. Scaling by the 2nd/98th percentile instead
// lets the bulk span [0, 1] (values outside the percentile range then clip).

export interface ValueRange {
  readonly min: number;
  readonly max: number;
}

export interface PercentileBounds {
  readonly lowPercentile: number;
  readonly highPercentile: number;
}

export const DEFAULT_PERCENTILE_BOUNDS: PercentileBounds = {
  lowPercentile: 2,
  highPercentile: 98,
};

export function computePercentileValueRange(
  values: ArrayLike<number>,
  bounds: PercentileBounds,
): ValueRange {
  return readPercentileRangeFromSortedAscending(copyValuesIntoSortedAscending(values), bounds);
}

// The caller owns `values` and accepts that it is sorted in place; used for the
// throwaway full-cube gather so the percentile pass does not copy a second time.
export function computePercentileValueRangeOfOwnedArray(
  values: Float64Array,
  bounds: PercentileBounds,
): ValueRange {
  values.sort();
  return readPercentileRangeFromSortedAscending(values, bounds);
}

function readPercentileRangeFromSortedAscending(
  sortedAscending: Float64Array,
  bounds: PercentileBounds,
): ValueRange {
  return {
    min: valueAtPercentile(sortedAscending, bounds.lowPercentile),
    max: valueAtPercentile(sortedAscending, bounds.highPercentile),
  };
}

function copyValuesIntoSortedAscending(values: ArrayLike<number>): Float64Array {
  const copy = Float64Array.from(values);
  copy.sort();
  return copy;
}

function valueAtPercentile(sortedAscending: Float64Array, percentile: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = (clampPercentileToHundredths(percentile) / 100) * (sortedAscending.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.min(lowerIndex + 1, sortedAscending.length - 1);
  return interpolateLinearly(sortedAscending[lowerIndex]!, sortedAscending[upperIndex]!, rank - lowerIndex);
}

function clampPercentileToHundredths(percentile: number): number {
  if (!Number.isFinite(percentile)) return 0;
  return Math.min(100, Math.max(0, percentile));
}

function interpolateLinearly(start: number, end: number, weight: number): number {
  return start + (end - start) * weight;
}
