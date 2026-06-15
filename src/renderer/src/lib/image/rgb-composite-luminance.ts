import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";

/**
 * CT-176: the tone-curve panel's "rgb"/Value channel shows a COMBINED backdrop
 * rather than one colour plane, so it bins a luminance band derived from the
 * three display channels. Rec. 709 luma weights match how the eye perceives the
 * composite's brightness. The result is a single-band raster (no colour tag) the
 * existing histogram pipeline can bin exactly like any scientific band.
 */
const REC_709_RED_WEIGHT = 0.2126;
const REC_709_GREEN_WEIGHT = 0.7152;
const REC_709_BLUE_WEIGHT = 0.0722;

export function buildLuminanceRasterFromRgbComposite(raster: RasterImage): RasterImage {
  return {
    ...raster,
    bandPixels: [computeLuminanceBandFromRgbComposite(raster)],
    bandCount: 1,
    bandLabels: undefined,
    bandWavelengths: undefined,
    bandOriginalNumbers: undefined,
    colorInterpretation: undefined,
  };
}

function computeLuminanceBandFromRgbComposite(raster: RasterImage): RasterTypedArray {
  const red = getRasterBandPixelsOrThrow(raster, 0);
  const green = getRasterBandPixelsOrThrow(raster, 1);
  const blue = getRasterBandPixelsOrThrow(raster, 2);
  const luminance = createMatchingTypedArray(red);
  for (let index = 0; index < luminance.length; index += 1) {
    luminance[index] = weightedLuminanceOf(red[index] ?? 0, green[index] ?? 0, blue[index] ?? 0);
  }
  return luminance;
}

function weightedLuminanceOf(red: number, green: number, blue: number): number {
  return Math.round(
    red * REC_709_RED_WEIGHT + green * REC_709_GREEN_WEIGHT + blue * REC_709_BLUE_WEIGHT,
  );
}

function createMatchingTypedArray(source: RasterTypedArray): RasterTypedArray {
  const Constructor = source.constructor as new (length: number) => RasterTypedArray;
  return new Constructor(source.length);
}
