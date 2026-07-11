import {
  computeBandHistogramFromBandPixels,
  type BandHistogram,
  type HistogramValueRange,
} from "@/lib/image/compute-band-histogram";
import type { RasterSampleFormat, RasterTypedArray } from "@/lib/image/raster-image";
import {
  computeArrayReportingPerUnitProgress,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

// CT-219d: a combined (all-bands-together) histogram WITHOUT concatenating the
// stack. The old path copied every band's values into one Float64Array (~6.1 GB
// at reference scale) before binning; since a histogram only counts values, the
// sum of per-band tallies over ONE shared range is bin-for-bin identical to a
// tally over the concatenation. The per-band sweep is async with one tick and
// a paint yield per band so a busy bar can advance while it runs.

export interface CombinedBandHistogramInputs {
  readonly bands: ReadonlyArray<RasterTypedArray>;
  readonly sampleFormat: RasterSampleFormat;
  readonly bitsPerSample: number;
  readonly binCount: number;
}

export async function computeCombinedBandHistogramAcrossBands(
  inputs: CombinedBandHistogramInputs,
  onProgress?: UnitProgressCallback,
): Promise<BandHistogram> {
  const range = deriveSharedRangeForCombinedTally(inputs);
  const perBandTallies = await computeArrayReportingPerUnitProgress(
    inputs.bands.length,
    (bandIndex) => tallyOneBandIntoTheSharedRange(inputs, bandIndex, range),
    onProgress,
  );
  return sumBandHistogramsSharingOneRange(perBandTallies);
}

// An integer band's histogram always spans the sample type's container range,
// so every band shares one range with no override; a float band's range comes
// from its own data, so the combined tally needs the finite extents over ALL
// bands (matching what a scan over the concatenation would derive).
function deriveSharedRangeForCombinedTally(
  inputs: CombinedBandHistogramInputs,
): HistogramValueRange | undefined {
  if (inputs.sampleFormat !== "float") return undefined;
  return deriveCombinedFloatHistogramRangeAcrossBands(inputs.bands);
}

function tallyOneBandIntoTheSharedRange(
  inputs: CombinedBandHistogramInputs,
  bandIndex: number,
  range: HistogramValueRange | undefined,
): BandHistogram {
  const pixels = inputs.bands[bandIndex];
  if (!pixels) throw new Error(`Band ${bandIndex} is missing from the stack.`);
  return computeBandHistogramFromBandPixels({
    pixels,
    sampleFormat: inputs.sampleFormat,
    bitsPerSample: inputs.bitsPerSample,
    binCount: inputs.binCount,
    range,
  });
}

// The fallbacks mirror the single-band float range derivation: no finite
// values anywhere yields the [0, 1] placeholder, and an all-constant stack
// widens by one so the single value bins instead of dividing by zero.
export function deriveCombinedFloatHistogramRangeAcrossBands(
  bands: ReadonlyArray<RasterTypedArray>,
): HistogramValueRange {
  const extents = foldFiniteValueExtentsAcrossBandsOrNull(bands);
  if (extents === null) return { min: 0, max: 1 };
  if (extents.min === extents.max) return { min: extents.min, max: extents.min + 1 };
  return extents;
}

function foldFiniteValueExtentsAcrossBandsOrNull(
  bands: ReadonlyArray<RasterTypedArray>,
): HistogramValueRange | null {
  let extents: HistogramValueRange | null = null;
  for (const band of bands) extents = foldBandIntoFiniteValueExtents(band, extents);
  return extents;
}

function foldBandIntoFiniteValueExtents(
  band: RasterTypedArray,
  extents: HistogramValueRange | null,
): HistogramValueRange | null {
  let min = extents?.min ?? Number.POSITIVE_INFINITY;
  let max = extents?.max ?? Number.NEGATIVE_INFINITY;
  for (let i = 0; i < band.length; i++) {
    const value = band[i] ?? 0;
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return Number.isFinite(min) ? { min, max } : null;
}

export function sumBandHistogramsSharingOneRange(
  histograms: ReadonlyArray<BandHistogram>,
): BandHistogram {
  const first = histograms[0];
  if (!first) throw new Error("At least one band histogram is required to sum.");
  assertEveryHistogramSharesTheFirstRange(histograms, first);
  return {
    bins: sumHistogramBinsElementWise(histograms, first.binCount),
    binCount: first.binCount,
    min: first.min,
    max: first.max,
    binWidth: first.binWidth,
    totalSampleCount: sumAcrossHistograms(histograms, (h) => h.totalSampleCount),
    excludedSampleCount: sumAcrossHistograms(histograms, (h) => h.excludedSampleCount),
  };
}

function assertEveryHistogramSharesTheFirstRange(
  histograms: ReadonlyArray<BandHistogram>,
  first: BandHistogram,
): void {
  for (const histogram of histograms) {
    const matches =
      histogram.min === first.min &&
      histogram.max === first.max &&
      histogram.binWidth === first.binWidth &&
      histogram.binCount === first.binCount;
    if (!matches) throw new Error("Band histograms must share one range and bin layout to sum.");
  }
}

function sumHistogramBinsElementWise(
  histograms: ReadonlyArray<BandHistogram>,
  binCount: number,
): Uint32Array {
  const bins = new Uint32Array(binCount);
  for (const histogram of histograms) {
    for (let binIndex = 0; binIndex < binCount; binIndex += 1) {
      bins[binIndex] = (bins[binIndex] ?? 0) + (histogram.bins[binIndex] ?? 0);
    }
  }
  return bins;
}

function sumAcrossHistograms(
  histograms: ReadonlyArray<BandHistogram>,
  readCount: (histogram: BandHistogram) => number,
): number {
  return histograms.reduce((sum, histogram) => sum + readCount(histogram), 0);
}
