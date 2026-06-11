import type { RasterImage, RasterSampleFormat, RasterTypedArray } from "@/lib/image/raster-image";
import { applyNormalizeToRaster } from "@/lib/image/apply-normalize";
import { dataTypeValueRangeForBand } from "@/lib/image/data-type-value-range";
import {
  mapBandValuesPreservingType,
  mapSelectedRasterBandsPreservingType,
} from "@/lib/image/map-band-values";

const UNIT_INTERVAL_TOLERANCE = 1e-4;

export function applyInvertToRasterBands(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
): RasterImage {
  return mapSelectedRasterBandsPreservingType(raster, bandIndexes, (band) =>
    invertBandAcrossDataTypeRange(band, raster.sampleFormat),
  );
}

function invertBandAcrossDataTypeRange(
  band: RasterTypedArray,
  sampleFormat: RasterSampleFormat,
): RasterTypedArray {
  const range = dataTypeValueRangeForBand(band, sampleFormat);
  return mapBandValuesPreservingType(band, (value) => range.max - value);
}

export function isRasterDataRangeBoundedForInvert(raster: RasterImage): boolean {
  if (raster.sampleFormat !== "float") return true;
  return raster.bandPixels.every(everyBandValueStaysWithinUnitInterval);
}

function everyBandValueStaysWithinUnitInterval(band: RasterTypedArray): boolean {
  for (let index = 0; index < band.length; index += 1) {
    if (isValueOutsideUnitInterval(band[index] ?? 0)) return false;
  }
  return true;
}

function isValueOutsideUnitInterval(value: number): boolean {
  return value < -UNIT_INTERVAL_TOLERANCE || value > 1 + UNIT_INTERVAL_TOLERANCE;
}

export function assertRasterDataRangeIsBoundedForInvert(raster: RasterImage): void {
  if (isRasterDataRangeBoundedForInvert(raster)) return;
  throw new Error(
    "Invert needs a bounded data range. This float image has values outside [0, 1]; " +
      "normalize it to [0, 1] or convert it to a bounded integer data type first.",
  );
}

// CT-097: invert no longer blocks unbounded data. A bounded raster inverts
// directly (max - value, per CT-082); an unbounded raster is auto-normalized to
// [0, 1] first, yielding two outputs: the normalized image and the
// normalized-then-inverted image.
export interface DirectInvertOutcome {
  readonly kind: "direct";
  readonly inverted: RasterImage;
}

export interface AutoNormalizedInvertOutcome {
  readonly kind: "auto-normalized";
  readonly normalized: RasterImage;
  readonly normalizedThenInverted: RasterImage;
}

export type InvertOutcome = DirectInvertOutcome | AutoNormalizedInvertOutcome;

export function planInvertForRaster(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
): InvertOutcome {
  if (isRasterDataRangeBoundedForInvert(raster)) {
    return { kind: "direct", inverted: applyInvertToRasterBands(raster, bandIndexes) };
  }
  return planAutoNormalizedThenInvert(raster, bandIndexes);
}

function planAutoNormalizedThenInvert(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
): AutoNormalizedInvertOutcome {
  const normalized = autoNormalizeUnboundedRasterToUnitRange(raster);
  return {
    kind: "auto-normalized",
    normalized,
    normalizedThenInverted: applyInvertToRasterBands(normalized, bandIndexes),
  };
}

export function autoNormalizeUnboundedRasterToUnitRange(raster: RasterImage): RasterImage {
  return applyNormalizeToRaster(raster, { scope: "full-cube" });
}
