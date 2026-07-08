import type { RasterImage, RasterSampleFormat, RasterTypedArray } from "@/lib/image/raster-image";
import type { UnitProgressCallback } from "@/lib/image/unit-progress";
import {
  clampValueToDataTypeRangeRoundingIntegers,
  dataTypeValueRangeForBand,
  isFloatTypedArray,
} from "@/lib/image/data-type-value-range";
import {
  mapBandValuesPreservingType,
  mapSelectedRasterBandsPreservingType,
  mapSelectedRasterBandsPreservingTypeReportingProgress,
} from "@/lib/image/map-band-values";

export function applyBrightnessToRasterBands(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
  brightnessDelta: number,
): RasterImage {
  return mapSelectedRasterBandsPreservingType(raster, bandIndexes, (band) =>
    brightenBandClampedToTypeRange(band, brightnessDelta, raster.sampleFormat),
  );
}

// CT-222: the async twin of applyBrightnessToRasterBands. Identical per-band math,
// one progress tick per band.
export async function applyBrightnessToRasterBandsReportingProgress(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
  brightnessDelta: number,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  return mapSelectedRasterBandsPreservingTypeReportingProgress(
    raster,
    bandIndexes,
    (band) => brightenBandClampedToTypeRange(band, brightnessDelta, raster.sampleFormat),
    onProgress,
  );
}

function brightenBandClampedToTypeRange(
  band: RasterTypedArray,
  brightnessDelta: number,
  sampleFormat: RasterSampleFormat,
): RasterTypedArray {
  const range = dataTypeValueRangeForBand(band, sampleFormat);
  const roundForIntegerOutput = !isFloatTypedArray(band);
  return mapBandValuesPreservingType(band, (value) =>
    clampValueToDataTypeRangeRoundingIntegers(value + brightnessDelta, range, roundForIntegerOutput),
  );
}

export function brightnessDeltaForRangeFractionOfBand(
  band: RasterTypedArray,
  sampleFormat: RasterSampleFormat,
  rangeFraction: number,
): number {
  const range = dataTypeValueRangeForBand(band, sampleFormat);
  return rangeFraction * (range.max - range.min);
}
