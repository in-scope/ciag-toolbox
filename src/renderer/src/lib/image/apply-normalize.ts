import {
  makeFloatRasterFromBandComputation,
  makeFloatRasterReusingUnchangedSourceBands,
  mapBandPixelsToFloat32,
  RasterMemoryAllocationError,
} from "@/lib/image/make-float-raster";
import {
  computePercentileValueRange,
  computePercentileValueRangeOfOwnedArray,
  type PercentileBounds,
  type ValueRange,
} from "@/lib/image/percentile-value-range";
import { isFloatTypedArray } from "@/lib/image/data-type-value-range";
import {
  mapBandValuesPreservingType,
  mapSelectedRasterBandsPreservingType,
} from "@/lib/image/map-band-values";
import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";

// CT-083: data-changing linear normalize to [0, 1]. Distinct from the view-only
// Normalized viewing stretch. Full cube scales every band by one cube-wide
// min/max; band-wise scales each selected band by its own min/max. Output is a
// float32 [0, 1] raster (CT-077). Constant bands (max === min) map to 0 with no
// NaN. Non-selected bands in a band-wise pass are copied through unchanged.
//
// CT-107: the robust percentile method scales by low/high percentiles instead of
// absolute min/max so sparse outliers do not flatten the image; values outside
// the percentile range clip to 0/1. Plain min/max is unchanged (no clip).
//
// CT-194: the clip-by-value method clamps each value to an absolute [lo, hi]
// range instead of rescaling to [0, 1]. It preserves the source data type and
// the in-range values (only the known bad highs and lows move to the bounds),
// so its output is NOT a float32 [0, 1] raster like the two scaling methods.

export type NormalizeScopeSelection =
  | { readonly scope: "full-cube" }
  | { readonly scope: "band-wise"; readonly bandIndexes: ReadonlyArray<number> };

export interface AbsoluteClipBounds {
  readonly lo: number;
  readonly hi: number;
}

export type NormalizeRangeMethod =
  | { readonly kind: "min-max" }
  | { readonly kind: "percentile"; readonly bounds: PercentileBounds }
  | { readonly kind: "clip-absolute"; readonly bounds: AbsoluteClipBounds };

export const MIN_MAX_NORMALIZE_METHOD: NormalizeRangeMethod = { kind: "min-max" };

export function applyNormalizeToRaster(
  raster: RasterImage,
  selection: NormalizeScopeSelection,
  method: NormalizeRangeMethod = MIN_MAX_NORMALIZE_METHOD,
): RasterImage {
  if (method.kind === "clip-absolute") return clipRasterToAbsoluteBounds(raster, selection, method.bounds);
  if (selection.scope === "full-cube") return normalizeWholeCubeToUnitRange(raster, method);
  return normalizeSelectedBandsIndependentlyToUnitRange(raster, selection.bandIndexes, method);
}

function clipRasterToAbsoluteBounds(
  raster: RasterImage,
  selection: NormalizeScopeSelection,
  bounds: AbsoluteClipBounds,
): RasterImage {
  return mapSelectedRasterBandsPreservingType(raster, resolveClippedBandIndexes(raster, selection), (band) =>
    clipBandValuesToAbsoluteBounds(band, bounds),
  );
}

function resolveClippedBandIndexes(
  raster: RasterImage,
  selection: NormalizeScopeSelection,
): ReadonlyArray<number> {
  if (selection.scope === "full-cube") return listEveryBandIndex(raster.bandCount);
  return selection.bandIndexes;
}

function listEveryBandIndex(bandCount: number): number[] {
  return Array.from({ length: bandCount }, (_unused, index) => index);
}

function clipBandValuesToAbsoluteBounds(
  band: RasterTypedArray,
  bounds: AbsoluteClipBounds,
): RasterTypedArray {
  const roundForIntegerOutput = !isFloatTypedArray(band);
  return mapBandValuesPreservingType(band, (value) =>
    clampValueToAbsoluteBoundsRoundingIntegers(value, bounds, roundForIntegerOutput),
  );
}

export function clampValueToAbsoluteBoundsRoundingIntegers(
  value: number,
  bounds: AbsoluteClipBounds,
  roundForIntegerOutput: boolean,
): number {
  const clamped = clampValueToAbsoluteBounds(value, bounds);
  return roundForIntegerOutput ? Math.round(clamped) : clamped;
}

export function clampValueToAbsoluteBounds(value: number, bounds: AbsoluteClipBounds): number {
  if (value < bounds.lo) return bounds.lo;
  if (value > bounds.hi) return bounds.hi;
  return value;
}

function normalizeWholeCubeToUnitRange(raster: RasterImage, method: NormalizeRangeMethod): RasterImage {
  const cubeRange = computeCubeWideRangeForMethod(raster, method);
  const shouldClip = shouldClipScaledValuesToUnitRange(method);
  return makeFloatRasterFromBandComputation(raster, (bandPixels) =>
    mapBandPixelsToFloat32(bandPixels, (value) => scaleValueToUnitRange(value, cubeRange, shouldClip)),
  );
}

function normalizeSelectedBandsIndependentlyToUnitRange(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
  method: NormalizeRangeMethod,
): RasterImage {
  return makeFloatRasterReusingUnchangedSourceBands(raster, new Set(bandIndexes), (bandPixels) =>
    normalizeSingleBandToUnitRange(bandPixels, method),
  );
}

function normalizeSingleBandToUnitRange(
  bandPixels: RasterTypedArray,
  method: NormalizeRangeMethod,
): Float32Array {
  const bandRange = computeBandRangeForMethod(bandPixels, method);
  const shouldClip = shouldClipScaledValuesToUnitRange(method);
  return mapBandPixelsToFloat32(bandPixels, (value) => scaleValueToUnitRange(value, bandRange, shouldClip));
}

function shouldClipScaledValuesToUnitRange(method: NormalizeRangeMethod): boolean {
  return method.kind === "percentile";
}

function computeBandRangeForMethod(
  bandPixels: RasterTypedArray,
  method: NormalizeRangeMethod,
): ValueRange {
  if (method.kind === "percentile") return computePercentileValueRange(bandPixels, method.bounds);
  return computeValueRangeOverPixels(bandPixels);
}

function computeCubeWideRangeForMethod(raster: RasterImage, method: NormalizeRangeMethod): ValueRange {
  if (method.kind === "percentile") {
    return computePercentileValueRangeOfOwnedArray(gatherAllCubeValues(raster), method.bounds);
  }
  return computeCubeWideValueRange(raster);
}

function gatherAllCubeValues(raster: RasterImage): Float64Array {
  const all = allocateFloat64ArrayOrThrow(countCubePixels(raster));
  let offset = 0;
  for (const bandPixels of raster.bandPixels) {
    all.set(bandPixels as never, offset);
    offset += bandPixels.length;
  }
  return all;
}

function countCubePixels(raster: RasterImage): number {
  return raster.bandPixels.reduce((total, bandPixels) => total + bandPixels.length, 0);
}

function allocateFloat64ArrayOrThrow(length: number): Float64Array {
  try {
    return new Float64Array(length);
  } catch {
    const megabytes = Math.ceil((length * Float64Array.BYTES_PER_ELEMENT) / (1024 * 1024));
    throw new RasterMemoryAllocationError(
      `Not enough memory to allocate ${megabytes} MB for a robust full-stack normalize. ` +
        `Free memory or normalize band-wise and try again.`,
    );
  }
}

function scaleValueToUnitRange(value: number, range: ValueRange, shouldClipToUnit: boolean): number {
  const span = range.max - range.min;
  if (span === 0) return 0;
  const scaled = (value - range.min) / span;
  return shouldClipToUnit ? clampToUnitInterval(scaled) : scaled;
}

function clampToUnitInterval(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function computeCubeWideValueRange(raster: RasterImage): ValueRange {
  return raster.bandPixels.reduce<ValueRange>(
    (accumulated, bandPixels) => mergeValueRanges(accumulated, computeValueRangeOverPixels(bandPixels)),
    { min: Infinity, max: -Infinity },
  );
}

function mergeValueRanges(first: ValueRange, second: ValueRange): ValueRange {
  return {
    min: Math.min(first.min, second.min),
    max: Math.max(first.max, second.max),
  };
}

function computeValueRangeOverPixels(bandPixels: RasterTypedArray): ValueRange {
  let min = Infinity;
  let max = -Infinity;
  for (let pixelIndex = 0; pixelIndex < bandPixels.length; pixelIndex += 1) {
    const value = bandPixels[pixelIndex] ?? 0;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}
