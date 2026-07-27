import type { RasterTypedArray } from "@/lib/image/raster-image";

// CT-219c: exact order statistics over the UNION of independently sorted band
// arrays, so a whole-stack percentile never materializes the concatenated
// stack. The k-th smallest value of the union equals sorted-concatenation[k]
// by definition (equal values are interchangeable), so callers get results
// bit-identical to a concatenate-and-sort while peak memory stays at the
// per-band copies they already hold.
//
// NaN values sort to the tail of a typed-array sort, exactly as they do in the
// sorted concatenation, so a rank landing in the NaN tail returns NaN and every
// rank below it ignores the NaNs.

const GATHER_REMAINING_THRESHOLD = 4096;

interface SortedBandWindow {
  readonly values: RasterTypedArray;
  start: number;
  end: number;
}

export function kthSmallestValueAcrossSortedBands(
  sortedBands: ReadonlyArray<RasterTypedArray>,
  k: number,
): number {
  const windows = sortedBands.map(openWindowOverValuesBeforeNaNTail);
  const valuesBeforeNaNTail = windows.reduce((sum, window) => sum + window.end, 0);
  if (k >= valuesBeforeNaNTail) return Number.NaN;
  return selectKthValueByPivotNarrowing(windows, k);
}

function openWindowOverValuesBeforeNaNTail(values: RasterTypedArray): SortedBandWindow {
  return { values, start: 0, end: countValuesBeforeNaNTail(values) };
}

// NaNs occupy a contiguous tail after a typed-array sort; binary search for it.
function countValuesBeforeNaNTail(sorted: RasterTypedArray): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (Number.isNaN(sorted[middle]!)) high = middle;
    else low = middle + 1;
  }
  return low;
}

// Classic multi-sorted-array selection: pick an actual element as the pivot,
// count how the union splits around it, and either answer, keep only the
// values below it, or discard the values at or below it. The pivot itself
// leaves the active set on every branch, so the loop always terminates; small
// remainders are gathered and sorted directly.
function selectKthValueByPivotNarrowing(windows: SortedBandWindow[], k: number): number {
  let remainingK = k;
  for (;;) {
    if (countActiveValues(windows) <= GATHER_REMAINING_THRESHOLD) {
      return gatherRemainingValuesAndPick(windows, remainingK);
    }
    const pivot = pickPivotFromLargestWindow(windows);
    const belowPivot = countActiveValuesBelow(windows, pivot);
    if (remainingK < belowPivot) shrinkWindowsToValuesBelow(windows, pivot);
    else if (remainingK < countActiveValuesAtOrBelow(windows, pivot)) return pivot;
    else remainingK -= discardValuesAtOrBelow(windows, pivot);
  }
}

function countActiveValues(windows: ReadonlyArray<SortedBandWindow>): number {
  return windows.reduce((sum, window) => sum + (window.end - window.start), 0);
}

function pickPivotFromLargestWindow(windows: ReadonlyArray<SortedBandWindow>): number {
  let largest = windows[0]!;
  for (const window of windows) {
    if (window.end - window.start > largest.end - largest.start) largest = window;
  }
  return largest.values[(largest.start + largest.end) >>> 1]!;
}

function countActiveValuesBelow(windows: ReadonlyArray<SortedBandWindow>, pivot: number): number {
  return windows.reduce(
    (sum, window) =>
      sum + firstIndexAtOrAbove(window.values, pivot, window.start, window.end) - window.start,
    0,
  );
}

function countActiveValuesAtOrBelow(
  windows: ReadonlyArray<SortedBandWindow>,
  pivot: number,
): number {
  return windows.reduce(
    (sum, window) =>
      sum + firstIndexAbove(window.values, pivot, window.start, window.end) - window.start,
    0,
  );
}

function shrinkWindowsToValuesBelow(windows: SortedBandWindow[], pivot: number): void {
  for (const window of windows) {
    window.end = firstIndexAtOrAbove(window.values, pivot, window.start, window.end);
  }
}

function discardValuesAtOrBelow(windows: SortedBandWindow[], pivot: number): number {
  let discarded = 0;
  for (const window of windows) {
    const bound = firstIndexAbove(window.values, pivot, window.start, window.end);
    discarded += bound - window.start;
    window.start = bound;
  }
  return discarded;
}

function gatherRemainingValuesAndPick(
  windows: ReadonlyArray<SortedBandWindow>,
  remainingK: number,
): number {
  const gathered: number[] = [];
  for (const window of windows) {
    for (let index = window.start; index < window.end; index += 1) {
      gathered.push(window.values[index]!);
    }
  }
  gathered.sort((left, right) => left - right);
  return gathered[remainingK]!;
}

function firstIndexAtOrAbove(
  sorted: RasterTypedArray,
  target: number,
  start: number,
  end: number,
): number {
  let low = start;
  let high = end;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function firstIndexAbove(
  sorted: RasterTypedArray,
  target: number,
  start: number,
  end: number,
): number {
  let low = start;
  let high = end;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}
