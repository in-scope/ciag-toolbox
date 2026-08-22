import { buildDisplayNormalizedLookupTable } from "@/lib/image/apply-tone-curve";
import {
  clampValueToDataTypeRangeRoundingIntegers,
  dataTypeValueRangeForBand,
  midpointOfDataTypeValueRange,
  type DataTypeValueRange,
} from "@/lib/image/data-type-value-range";
import {
  clampBandIndexToRaster,
  getRasterBandPixelsOrThrow,
  type RasterImage,
} from "@/lib/image/raster-image";
import { shouldRenderRasterAsRgbComposite } from "@/lib/image/raster-color-interpretation";
import type { ToneCurveChannelPreviewLuts } from "@/lib/image/tone-curve-composite-preview";
import { TONE_CURVE_LUT_ENTRY_COUNT } from "@/lib/webgl/tone-curve-lut-texture";

// CT-186: brightness/contrast preview is display-only, exactly like the tone-curve
// preview. It builds the same display-normalized LUT the GPU samples, so dragging a
// slider remaps the viewed band on the GPU without re-baking the band into a new
// raster. The committed Apply runs brightness (a clamped additive shift) then
// contrast around the midpoint of the data range; the composed data-domain map is
// f(v) = (clamp(v + delta) - m) * contrast + m, where m is that midpoint (CT-297).

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
  const midpoint = midpointOfDataTypeValueRange(range);
  return buildDisplayNormalizedLookupTable(
    (value) => brightenThenContrastDataValue(value, range, brightnessDelta, midpoint, contrastRatio),
    range,
    TONE_CURVE_LUT_ENTRY_COUNT,
  );
}

// CT-247: a true-colour composite previews through the SAME per-channel LUT
// triple the tone curve uses (CT-177): each channel LUT applies the shared
// brightness delta then contrast centred on that channel's OWN brightened mean,
// which is exactly what the committed Apply does over bands 0/1/2.
export function buildBrightnessContrastCompositePreviewLutsOrNull(
  raster: RasterImage | null,
  brightnessPercent: number,
  contrastRatio: number,
): ToneCurveChannelPreviewLuts | null {
  if (!raster || !shouldRenderRasterAsRgbComposite(raster)) return null;
  const red = buildBrightnessContrastPreviewLutOrNull(raster, 0, brightnessPercent, contrastRatio);
  const green = buildBrightnessContrastPreviewLutOrNull(raster, 1, brightnessPercent, contrastRatio);
  const blue = buildBrightnessContrastPreviewLutOrNull(raster, 2, brightnessPercent, contrastRatio);
  if (!red || !green || !blue) return null;
  return { red, green, blue };
}

function isIdentityBrightnessAndContrast(brightnessPercent: number, contrastRatio: number): boolean {
  return brightnessPercent === 0 && contrastRatio === 1;
}

function brightnessDeltaForDisplayRange(range: DataTypeValueRange, brightnessPercent: number): number {
  return (brightnessPercent / 100) * (range.max - range.min);
}

function brightenThenContrastDataValue(
  value: number,
  range: DataTypeValueRange,
  brightnessDelta: number,
  midpoint: number,
  contrastRatio: number,
): number {
  const brightened = clampValueToDataTypeRangeRoundingIntegers(value + brightnessDelta, range, false);
  return (brightened - midpoint) * contrastRatio + midpoint;
}
