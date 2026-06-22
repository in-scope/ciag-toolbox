import { buildDisplayNormalizedLookupTable } from "@/lib/image/apply-tone-curve";
import {
  clampValueToDataTypeRangeRoundingIntegers,
  dataTypeValueRangeForBand,
  type DataTypeValueRange,
} from "@/lib/image/data-type-value-range";
import {
  clampBandIndexToRaster,
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";
import { TONE_CURVE_LUT_ENTRY_COUNT } from "@/lib/webgl/tone-curve-lut-texture";

// CT-186: brightness/contrast preview is display-only, exactly like the tone-curve
// preview. It builds the same display-normalized LUT the GPU samples, so dragging a
// slider remaps the viewed band on the GPU without re-baking the band into a new
// raster. The committed Apply runs brightness (a clamped additive shift) then
// contrast around the BRIGHTENED band mean; because the shift moves every pixel and
// the mean by the same delta, the composed data-domain map is
// f(v) = (clamp(v + delta) - brightenedMean) * contrast + brightenedMean.

export function buildBrightnessContrastPreviewLutOrNull(
  raster: RasterImage | null,
  bandIndex: number,
  brightnessPercent: number,
  contrastRatio: number,
): ReadonlyArray<number> | null {
  if (!raster || isIdentityBrightnessAndContrast(brightnessPercent, contrastRatio)) return null;
  const band = getRasterBandPixelsOrThrow(raster, clampBandIndexToRaster(raster, bandIndex));
  const range = dataTypeValueRangeForBand(band, raster.sampleFormat);
  const brightnessDelta = brightnessDeltaForDisplayRange(range, brightnessPercent);
  const brightenedMean = computeBrightenedBandMean(band, range, brightnessDelta);
  return buildDisplayNormalizedLookupTable(
    (value) => brightenThenContrastDataValue(value, range, brightnessDelta, brightenedMean, contrastRatio),
    range,
    TONE_CURVE_LUT_ENTRY_COUNT,
  );
}

function isIdentityBrightnessAndContrast(brightnessPercent: number, contrastRatio: number): boolean {
  return brightnessPercent === 0 && contrastRatio === 1;
}

function brightnessDeltaForDisplayRange(range: DataTypeValueRange, brightnessPercent: number): number {
  return (brightnessPercent / 100) * (range.max - range.min);
}

function computeBrightenedBandMean(
  band: RasterTypedArray,
  range: DataTypeValueRange,
  brightnessDelta: number,
): number {
  if (band.length === 0) return 0;
  let runningSum = 0;
  for (let index = 0; index < band.length; index += 1) {
    runningSum += clampValueToDataTypeRangeRoundingIntegers((band[index] ?? 0) + brightnessDelta, range, false);
  }
  return runningSum / band.length;
}

function brightenThenContrastDataValue(
  value: number,
  range: DataTypeValueRange,
  brightnessDelta: number,
  brightenedMean: number,
  contrastRatio: number,
): number {
  const brightened = clampValueToDataTypeRangeRoundingIntegers(value + brightnessDelta, range, false);
  return (brightened - brightenedMean) * contrastRatio + brightenedMean;
}
