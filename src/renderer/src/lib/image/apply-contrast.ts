import type { RasterImage, RasterSampleFormat, RasterTypedArray } from "@/lib/image/raster-image";
import type { UnitProgressCallback } from "@/lib/image/unit-progress";
import {
  clampValueToDataTypeRangeRoundingIntegers,
  dataTypeValueRangeForBand,
  isFloatTypedArray,
  midpointOfDataTypeValueRange,
} from "@/lib/image/data-type-value-range";
import {
  mapBandValuesPreservingType,
  mapSelectedRasterBandsPreservingType,
  mapSelectedRasterBandsPreservingTypeReportingProgress,
} from "@/lib/image/map-band-values";

export function applyContrastToRasterBands(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
  contrastRatio: number,
): RasterImage {
  return mapSelectedRasterBandsPreservingType(raster, bandIndexes, (band) =>
    stretchBandContrastClampedToTypeRange(band, contrastRatio, raster.sampleFormat),
  );
}

// CT-222: the async twin of applyContrastToRasterBands. Identical per-band math,
// one progress tick per band.
export async function applyContrastToRasterBandsReportingProgress(
  raster: RasterImage,
  bandIndexes: ReadonlyArray<number>,
  contrastRatio: number,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  return mapSelectedRasterBandsPreservingTypeReportingProgress(
    raster,
    bandIndexes,
    (band) => stretchBandContrastClampedToTypeRange(band, contrastRatio, raster.sampleFormat),
    onProgress,
  );
}

function stretchBandContrastClampedToTypeRange(
  band: RasterTypedArray,
  contrastRatio: number,
  sampleFormat: RasterSampleFormat,
): RasterTypedArray {
  const range = dataTypeValueRangeForBand(band, sampleFormat);
  const roundForIntegerOutput = !isFloatTypedArray(band);
  const midpoint = midpointOfDataTypeValueRange(range);
  return mapBandValuesPreservingType(band, (value) =>
    clampValueToDataTypeRangeRoundingIntegers(
      (value - midpoint) * contrastRatio + midpoint,
      range,
      roundForIntegerOutput,
    ),
  );
}
