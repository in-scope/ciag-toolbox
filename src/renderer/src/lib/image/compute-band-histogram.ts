import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterSampleFormat,
  type RasterTypedArray,
} from "@/lib/image/raster-image";

export const DEFAULT_BAND_HISTOGRAM_BIN_COUNT = 256;

export interface BandHistogram {
  readonly bins: Uint32Array;
  readonly binCount: number;
  readonly min: number;
  readonly max: number;
  readonly binWidth: number;
  readonly totalSampleCount: number;
  readonly excludedSampleCount: number;
}

export function computeBandHistogramFromRaster(
  raster: RasterImage,
  bandIndex: number,
  binCount: number = DEFAULT_BAND_HISTOGRAM_BIN_COUNT,
): BandHistogram {
  const pixels = getRasterBandPixelsOrThrow(raster, bandIndex);
  return computeBandHistogramFromBandPixels({
    pixels,
    sampleFormat: raster.sampleFormat,
    bitsPerSample: raster.bitsPerSample,
    binCount,
  });
}

export interface BandHistogramInputs {
  readonly pixels: RasterTypedArray;
  readonly sampleFormat: RasterSampleFormat;
  readonly bitsPerSample: number;
  readonly binCount: number;
}

export function computeBandHistogramFromBandPixels(
  inputs: BandHistogramInputs,
): BandHistogram {
  const range = deriveHistogramRangeForInputs(inputs);
  const isIntegerFormat = inputs.sampleFormat !== "float";
  return fillHistogramBinsAcrossRange(inputs.pixels, range, inputs.binCount, isIntegerFormat);
}

interface HistogramValueRange {
  readonly min: number;
  readonly max: number;
}

function deriveHistogramRangeForInputs(inputs: BandHistogramInputs): HistogramValueRange {
  if (inputs.sampleFormat === "float") {
    return deriveFloatBandHistogramRangeFromPixels(inputs.pixels);
  }
  return deriveIntegerContainerRangeFromSampleFormat(
    inputs.sampleFormat,
    inputs.bitsPerSample,
  );
}

function deriveIntegerContainerRangeFromSampleFormat(
  sampleFormat: RasterSampleFormat,
  bitsPerSample: number,
): HistogramValueRange {
  if (sampleFormat === "uint") {
    return { min: 0, max: Math.pow(2, bitsPerSample) - 1 };
  }
  const halfRange = Math.pow(2, bitsPerSample - 1);
  return { min: -halfRange, max: halfRange - 1 };
}

function deriveFloatBandHistogramRangeFromPixels(
  pixels: RasterTypedArray,
): HistogramValueRange {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < pixels.length; i++) {
    const value = pixels[i] ?? 0;
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  if (min === max) return { min, max: min + 1 };
  return { min, max };
}

function fillHistogramBinsAcrossRange(
  pixels: RasterTypedArray,
  range: HistogramValueRange,
  binCount: number,
  isIntegerFormat: boolean,
): BandHistogram {
  const safeBinCount = Math.max(1, Math.floor(binCount));
  const binWidth = computeBinWidthForRange(range, safeBinCount, isIntegerFormat);
  const bins = new Uint32Array(safeBinCount);
  const tally = tallyEachSampleIntoBin(pixels, range, binWidth, bins);
  return {
    bins,
    binCount: safeBinCount,
    min: range.min,
    max: range.max,
    binWidth,
    totalSampleCount: tally.includedSampleCount,
    excludedSampleCount: tally.excludedSampleCount,
  };
}

function computeBinWidthForRange(
  range: HistogramValueRange,
  binCount: number,
  isIntegerFormat: boolean,
): number {
  if (isIntegerFormat) return (range.max - range.min + 1) / binCount;
  return (range.max - range.min) / binCount;
}

interface HistogramTallyTotals {
  readonly includedSampleCount: number;
  readonly excludedSampleCount: number;
}

function tallyEachSampleIntoBin(
  pixels: RasterTypedArray,
  range: HistogramValueRange,
  binWidth: number,
  bins: Uint32Array,
): HistogramTallyTotals {
  let includedSampleCount = 0;
  let excludedSampleCount = 0;
  for (let i = 0; i < pixels.length; i++) {
    const value = pixels[i] ?? 0;
    if (!isSampleInRangeAndFinite(value, range)) {
      excludedSampleCount += 1;
      continue;
    }
    const binIndex = pickBinIndexForSampleValue(value, range, binWidth, bins.length);
    bins[binIndex] = (bins[binIndex] ?? 0) + 1;
    includedSampleCount += 1;
  }
  return { includedSampleCount, excludedSampleCount };
}

function isSampleInRangeAndFinite(value: number, range: HistogramValueRange): boolean {
  if (!Number.isFinite(value)) return false;
  if (value < range.min) return false;
  if (value > range.max) return false;
  return true;
}

function pickBinIndexForSampleValue(
  value: number,
  range: HistogramValueRange,
  binWidth: number,
  binCount: number,
): number {
  if (binWidth <= 0) return 0;
  const rawIndex = Math.floor((value - range.min) / binWidth);
  if (rawIndex < 0) return 0;
  if (rawIndex >= binCount) return binCount - 1;
  return rawIndex;
}
