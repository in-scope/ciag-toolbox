import {
  makeFloatRasterFromBandComputation,
  makeFloatRasterFromBandComputationReportingProgress,
  makeFloatRasterReusingUnchangedSourceBands,
  makeFloatRasterReusingUnchangedSourceBandsReportingProgress,
  mapBandPixelsToFloat32,
} from "@/lib/image/make-float-raster";
import { isFloatTypedArray } from "@/lib/image/data-type-value-range";
import {
  mapBandValuesPreservingType,
  mapSelectedRasterBandsPreservingType,
  mapSelectedRasterBandsPreservingTypeReportingProgress,
} from "@/lib/image/map-band-values";
import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";
import type { UnitProgressCallback } from "@/lib/image/unit-progress";

// CT-083: data-changing linear normalize to [0, 1]. Distinct from the view-only
// Normalized viewing stretch. Full cube scales every band by one cube-wide
// min/max; band-wise scales each selected band by its own min/max. Output is a
// float32 [0, 1] raster (CT-077). Constant bands (max === min) map to 0 with no
// NaN. Non-selected bands in a band-wise pass are copied through unchanged.
//
// CT-194 / CT-281: the clip-absolute method clamps each value to an absolute
// [lo, hi] range instead of rescaling to [0, 1]. It preserves the source data
// type and the in-range values (only the known bad highs and lows move to the
// bounds), so its output is NOT a float32 [0, 1] raster like min-max. Since
// CT-281 it is driven by the standalone Clip by Value operation; the Normalize
// panel is min-max only. (The former robust-percentile method was removed with
// CT-281: percentile clipping lives only in the Percentile Clip operation.)

export type NormalizeScopeSelection =
  | { readonly scope: "full-cube" }
  | { readonly scope: "band-wise"; readonly bandIndexes: ReadonlyArray<number> };

export interface AbsoluteClipBounds {
  readonly lo: number;
  readonly hi: number;
}

export type NormalizeRangeMethod =
  | { readonly kind: "min-max" }
  | { readonly kind: "clip-absolute"; readonly bounds: AbsoluteClipBounds };

export const MIN_MAX_NORMALIZE_METHOD: NormalizeRangeMethod = { kind: "min-max" };

export function applyNormalizeToRaster(
  raster: RasterImage,
  selection: NormalizeScopeSelection,
  method: NormalizeRangeMethod = MIN_MAX_NORMALIZE_METHOD,
): RasterImage {
  if (method.kind === "clip-absolute") return clipRasterToAbsoluteBounds(raster, selection, method.bounds);
  if (selection.scope === "full-cube") return normalizeWholeCubeToUnitRange(raster);
  return normalizeSelectedBandsIndependentlyToUnitRange(raster, selection.bandIndexes);
}

// CT-221: the async twin of applyNormalizeToRaster. Identical per-band math, one
// progress tick per band so a long normalize can drive a determinate indicator.
export async function applyNormalizeToRasterReportingProgress(
  raster: RasterImage,
  selection: NormalizeScopeSelection,
  method: NormalizeRangeMethod = MIN_MAX_NORMALIZE_METHOD,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<RasterImage> {
  if (method.kind === "clip-absolute") {
    return mapSelectedRasterBandsPreservingTypeReportingProgress(
      raster,
      resolveClippedBandIndexes(raster, selection),
      (band) => clipBandValuesToAbsoluteBounds(band, method.bounds),
      onProgress,
      abortSignal,
    );
  }
  return normalizeRasterToUnitRangeReportingProgress(raster, selection, onProgress, abortSignal);
}

async function normalizeRasterToUnitRangeReportingProgress(
  raster: RasterImage,
  selection: NormalizeScopeSelection,
  onProgress?: UnitProgressCallback,
  abortSignal?: AbortSignal,
): Promise<RasterImage> {
  if (selection.scope === "full-cube") {
    const cubeRange = computeCubeWideValueRange(raster);
    return makeFloatRasterFromBandComputationReportingProgress(
      raster,
      (bandPixels) => mapBandPixelsToFloat32(bandPixels, (value) => scaleValueToUnitRange(value, cubeRange)),
      onProgress,
      abortSignal,
    );
  }
  return makeFloatRasterReusingUnchangedSourceBandsReportingProgress(
    raster,
    new Set(selection.bandIndexes),
    normalizeSingleBandToUnitRange,
    onProgress,
    abortSignal,
  );
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

function normalizeWholeCubeToUnitRange(raster: RasterImage): RasterImage {
  const cubeRange = computeCubeWideValueRange(raster);
  return makeFloatRasterFromBandComputation(raster, (bandPixels) =>
    mapBandPixelsToFloat32(bandPixels, (value) => scaleValueToUnitRange(value, cubeRange)),
  );
}

function normalizeSelectedBandsIndependentlyToUnitRange(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
): RasterImage {
  return makeFloatRasterReusingUnchangedSourceBands(
    raster,
    new Set(bandIndexes),
    normalizeSingleBandToUnitRange,
  );
}

function normalizeSingleBandToUnitRange(bandPixels: RasterTypedArray): Float32Array {
  const bandRange = computeValueRangeOverPixels(bandPixels);
  return mapBandPixelsToFloat32(bandPixels, (value) => scaleValueToUnitRange(value, bandRange));
}

interface ValueRange {
  readonly min: number;
  readonly max: number;
}

function scaleValueToUnitRange(value: number, range: ValueRange): number {
  const span = range.max - range.min;
  if (span === 0) return 0;
  return (value - range.min) / span;
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
