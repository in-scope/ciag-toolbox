import type { RasterTypedArray } from "@/lib/image/raster-image";
import {
  reportCompletedUnitAndYieldSoProgressCanPaint,
  reportMultiUnitWorkStarting,
  runInChunksReportingProgress,
  scaleProgressToWindow,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

import {
  assertPercentileClipBoundsAreValid,
  assertPercentileValueCountIsNotEmpty,
  describePercentileOrderStatisticRank,
  interpolatePercentileBetweenOrderStatistics,
  type PercentileClipBounds,
  type PercentileCutPoints,
} from "./percentile-clip";
import { kthSmallestValueAcrossSortedBands } from "./sorted-band-order-statistics";

// CT-219c: whole-stack percentile cut points WITHOUT concatenating the stack.
// The old path allocated the concatenation as a Float64Array and then a second
// Float64Array copy to sort (~12.3 GB transient for a 3 GB float32 stack, an
// allocation failure at reference scale). The cut points are bit-identical to
// computePercentileCutPoints over the concatenation because both share the
// same rank/interpolation math and the order statistics of a multiset do not
// depend on how it is stored:
// - Small-integer stacks (uint8/int8/uint16/int16, the loaded-capture case)
//   accumulate ONE shared counting histogram over the sample-type range and
//   read order statistics from the counts: no copy of the stack at all.
// - Everything else (float32/float64/uint32/int32 bands) sorts a PER-BAND copy
//   in the band's own sample type and merges order statistics across the
//   sorted bands: peak transient memory is ONE extra copy of the stack, and no
//   single allocation exceeds one band.
// Both paths tick per band (chunked within a band on the histogram path) with
// paint yields so the busy bar advances while the cut points compute.

const DEFAULT_HISTOGRAM_VALUES_PER_CHUNK = 8_000_000;

export interface WholeStackPercentileOptions {
  readonly histogramValuesPerChunk?: number;
}

type KthSmallestValueProvider = (k: number) => number;

export async function computeWholeStackPercentileCutPoints(
  bands: ReadonlyArray<RasterTypedArray>,
  bounds: PercentileClipBounds,
  onProgress?: UnitProgressCallback,
  options?: WholeStackPercentileOptions,
): Promise<PercentileCutPoints> {
  assertPercentileClipBoundsAreValid(bounds);
  const totalValueCount = bands.reduce((sum, band) => sum + band.length, 0);
  assertPercentileValueCountIsNotEmpty(totalValueCount);
  const kthSmallestValue = await (everyBandFitsASharedCountingHistogram(bands)
    ? accumulateSharedCountingHistogram(bands, onProgress, options)
    : sortBandCopiesForOrderStatisticMerge(bands, onProgress));
  return {
    lowerCutPoint: interpolateCutPointAtPercentile(kthSmallestValue, totalValueCount, bounds.lowerPercentile),
    upperCutPoint: interpolateCutPointAtPercentile(kthSmallestValue, totalValueCount, bounds.upperPercentile),
  };
}

function interpolateCutPointAtPercentile(
  kthSmallestValue: KthSmallestValueProvider,
  totalValueCount: number,
  percentile: number,
): number {
  const rank = describePercentileOrderStatisticRank(totalValueCount, percentile);
  return interpolatePercentileBetweenOrderStatistics(
    kthSmallestValue(rank.lowerIndex),
    kthSmallestValue(rank.upperIndex),
    rank.fractionBetween,
  );
}

// --- shared counting histogram (small-integer sample types) -------------------

interface IntegerValueRange {
  readonly minValue: number;
  readonly maxValue: number;
}

const SMALL_INTEGER_SAMPLE_RANGES = new Map<unknown, IntegerValueRange>([
  [Uint8Array, { minValue: 0, maxValue: 255 }],
  [Int8Array, { minValue: -128, maxValue: 127 }],
  [Uint16Array, { minValue: 0, maxValue: 65535 }],
  [Int16Array, { minValue: -32768, maxValue: 32767 }],
]);

function everyBandFitsASharedCountingHistogram(bands: ReadonlyArray<RasterTypedArray>): boolean {
  return bands.every((band) => SMALL_INTEGER_SAMPLE_RANGES.has(band.constructor));
}

async function accumulateSharedCountingHistogram(
  bands: ReadonlyArray<RasterTypedArray>,
  onProgress: UnitProgressCallback | undefined,
  options: WholeStackPercentileOptions | undefined,
): Promise<KthSmallestValueProvider> {
  const range = unionOfBandSampleRanges(bands);
  // Float64 counts stay integer-exact far past any in-memory stack size.
  const counts = allocateOrReportNotEnoughMemory(
    () => new Float64Array(range.maxValue - range.minValue + 1),
  );
  await countEveryBandIntoHistogram(bands, counts, range.minValue, onProgress, options);
  return (k) => kthSmallestValueFromCounts(counts, range.minValue, k);
}

function unionOfBandSampleRanges(bands: ReadonlyArray<RasterTypedArray>): IntegerValueRange {
  const ranges = bands.map((band) => SMALL_INTEGER_SAMPLE_RANGES.get(band.constructor)!);
  return {
    minValue: Math.min(...ranges.map((range) => range.minValue)),
    maxValue: Math.max(...ranges.map((range) => range.maxValue)),
  };
}

async function countEveryBandIntoHistogram(
  bands: ReadonlyArray<RasterTypedArray>,
  counts: Float64Array,
  minValue: number,
  onProgress: UnitProgressCallback | undefined,
  options: WholeStackPercentileOptions | undefined,
): Promise<void> {
  const valuesPerChunk = options?.histogramValuesPerChunk ?? DEFAULT_HISTOGRAM_VALUES_PER_CHUNK;
  reportMultiUnitWorkStarting(onProgress, bands.length);
  for (let bandIndex = 0; bandIndex < bands.length; bandIndex += 1) {
    const withinBand = scaleProgressToWindow(
      onProgress,
      bandIndex / bands.length,
      (bandIndex + 1) / bands.length,
    );
    await countBandValuesInChunks(bands[bandIndex]!, counts, minValue, valuesPerChunk, withinBand);
  }
}

function countBandValuesInChunks(
  band: RasterTypedArray,
  counts: Float64Array,
  minValue: number,
  valuesPerChunk: number,
  onProgress: UnitProgressCallback | undefined,
): Promise<void> {
  return runInChunksReportingProgress(
    band.length,
    valuesPerChunk,
    (start, end) => {
      for (let index = start; index < end; index += 1) {
        const countIndex = band[index]! - minValue;
        counts[countIndex] = (counts[countIndex] ?? 0) + 1;
      }
    },
    onProgress,
  );
}

function kthSmallestValueFromCounts(counts: Float64Array, minValue: number, k: number): number {
  let cumulativeCount = 0;
  for (let index = 0; index < counts.length; index += 1) {
    cumulativeCount += counts[index]!;
    if (cumulativeCount > k) return minValue + index;
  }
  throw new Error("The stack has no pixel values to compute percentiles from.");
}

// --- per-band sorted copies (float and large-integer sample types) ------------

async function sortBandCopiesForOrderStatisticMerge(
  bands: ReadonlyArray<RasterTypedArray>,
  onProgress: UnitProgressCallback | undefined,
): Promise<KthSmallestValueProvider> {
  reportMultiUnitWorkStarting(onProgress, bands.length);
  const sortedBands: RasterTypedArray[] = [];
  for (let bandIndex = 0; bandIndex < bands.length; bandIndex += 1) {
    sortedBands.push(sortCopyOfBand(bands[bandIndex]!));
    await reportCompletedUnitAndYieldSoProgressCanPaint(onProgress, bandIndex + 1, bands.length);
  }
  return (k) => kthSmallestValueAcrossSortedBands(sortedBands, k);
}

function sortCopyOfBand(band: RasterTypedArray): RasterTypedArray {
  const copy = allocateOrReportNotEnoughMemory(() => {
    const Constructor = band.constructor as new (length: number) => RasterTypedArray;
    return new Constructor(band.length);
  });
  copy.set(band as never);
  return copy.sort();
}

function allocateOrReportNotEnoughMemory<T>(allocate: () => T): T {
  try {
    return allocate();
  } catch {
    throw new Error(
      "There is not enough memory to compute cut points over the full stack. " +
        "Use the Band-wise scope, or crop the stack to a smaller region and try again.",
    );
  }
}
