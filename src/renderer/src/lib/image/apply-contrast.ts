import type { RasterImage, RasterSampleFormat, RasterTypedArray } from "@/lib/image/raster-image";
import {
  clampValueToDataTypeRangeRoundingIntegers,
  dataTypeValueRangeForBand,
  isFloatTypedArray,
} from "@/lib/image/data-type-value-range";
import {
  mapBandValuesPreservingType,
  mapSelectedRasterBandsPreservingType,
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

function stretchBandContrastClampedToTypeRange(
  band: RasterTypedArray,
  contrastRatio: number,
  sampleFormat: RasterSampleFormat,
): RasterTypedArray {
  const range = dataTypeValueRangeForBand(band, sampleFormat);
  const roundForIntegerOutput = !isFloatTypedArray(band);
  const mean = computeArithmeticMeanOfBand(band);
  return mapBandValuesPreservingType(band, (value) =>
    clampValueToDataTypeRangeRoundingIntegers((value - mean) * contrastRatio + mean, range, roundForIntegerOutput),
  );
}

function computeArithmeticMeanOfBand(band: RasterTypedArray): number {
  if (band.length === 0) return 0;
  let runningSum = 0;
  for (let index = 0; index < band.length; index += 1) runningSum += band[index] ?? 0;
  return runningSum / band.length;
}
