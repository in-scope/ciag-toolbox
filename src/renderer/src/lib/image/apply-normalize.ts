import {
  makeFloatRasterFromBandComputation,
  makeFloatRasterReusingUnchangedSourceBands,
  mapBandPixelsToFloat32,
} from "@/lib/image/make-float-raster";
import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";

// CT-083: data-changing linear normalize to [0, 1]. Distinct from the view-only
// Normalized viewing stretch. Full cube scales every band by one cube-wide
// min/max; band-wise scales each selected band by its own min/max. Output is a
// float32 [0, 1] raster (CT-077). Constant bands (max === min) map to 0 with no
// NaN. Non-selected bands in a band-wise pass are copied through unchanged.

export type NormalizeScopeSelection =
  | { readonly scope: "full-cube" }
  | { readonly scope: "band-wise"; readonly bandIndexes: ReadonlyArray<number> };

interface ValueRange {
  readonly min: number;
  readonly max: number;
}

export function applyNormalizeToRaster(
  raster: RasterImage,
  selection: NormalizeScopeSelection,
): RasterImage {
  if (selection.scope === "full-cube") return normalizeWholeCubeToUnitRange(raster);
  return normalizeSelectedBandsIndependentlyToUnitRange(raster, selection.bandIndexes);
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
  return makeFloatRasterReusingUnchangedSourceBands(raster, new Set(bandIndexes), (bandPixels) =>
    normalizeSingleBandToUnitRange(bandPixels),
  );
}

function normalizeSingleBandToUnitRange(bandPixels: RasterTypedArray): Float32Array {
  const bandRange = computeValueRangeOverPixels(bandPixels);
  return mapBandPixelsToFloat32(bandPixels, (value) => scaleValueToUnitRange(value, bandRange));
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
