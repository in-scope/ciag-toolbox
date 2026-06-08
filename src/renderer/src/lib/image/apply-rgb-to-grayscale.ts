import {
  clampValueToDataTypeRangeRoundingIntegers,
  dataTypeValueRangeForBand,
  isFloatTypedArray,
} from "@/lib/image/data-type-value-range";
import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";

// CT-085: convert a 3-band RGB raster to a single grayscale band. The grayscale
// value is red * wR + green * wG + blue * wB, clamped (and rounded for integer
// rasters) to the source data-type range. Output is a single-band raster that
// preserves the source typed-array type. Default weights are the luminance
// weights; the caller may pass custom weights (e.g. 1/3 each for a flat average).

export interface RgbToGrayscaleWeights {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export const LUMINANCE_GRAYSCALE_WEIGHTS: RgbToGrayscaleWeights = {
  red: 0.299,
  green: 0.587,
  blue: 0.114,
};

export function applyRgbToGrayscale(
  raster: RasterImage,
  weights: RgbToGrayscaleWeights,
): RasterImage {
  assertRasterIsThreeBandRgb(raster);
  const grayscaleBand = computeWeightedGrayscaleBand(raster, weights);
  return buildSingleBandGrayscaleRaster(raster, grayscaleBand);
}

export function assertRasterIsThreeBandRgb(raster: RasterImage): void {
  if (raster.bandCount === 3 && raster.bandPixels.length === 3) return;
  throw new Error(
    `Convert RGB to grayscale needs a 3-band RGB image, but this image has ${raster.bandCount} band(s).`,
  );
}

function computeWeightedGrayscaleBand(
  raster: RasterImage,
  weights: RgbToGrayscaleWeights,
): RasterTypedArray {
  const [red, green, blue] = readRgbBandTriple(raster);
  const range = dataTypeValueRangeForBand(red, raster.sampleFormat);
  const roundForIntegers = !isFloatTypedArray(red);
  const grayscale = makeEmptyBandMatchingType(red);
  for (let pixelIndex = 0; pixelIndex < red.length; pixelIndex += 1) {
    const weighted = weightedRgbValueAtPixel(red, green, blue, weights, pixelIndex);
    grayscale[pixelIndex] = clampValueToDataTypeRangeRoundingIntegers(weighted, range, roundForIntegers);
  }
  return grayscale;
}

function weightedRgbValueAtPixel(
  red: RasterTypedArray,
  green: RasterTypedArray,
  blue: RasterTypedArray,
  weights: RgbToGrayscaleWeights,
  pixelIndex: number,
): number {
  return (
    (red[pixelIndex] ?? 0) * weights.red +
    (green[pixelIndex] ?? 0) * weights.green +
    (blue[pixelIndex] ?? 0) * weights.blue
  );
}

function readRgbBandTriple(
  raster: RasterImage,
): readonly [RasterTypedArray, RasterTypedArray, RasterTypedArray] {
  return [
    getRasterBandPixelsOrThrow(raster, 0),
    getRasterBandPixelsOrThrow(raster, 1),
    getRasterBandPixelsOrThrow(raster, 2),
  ];
}

function makeEmptyBandMatchingType(band: RasterTypedArray): RasterTypedArray {
  const Constructor = band.constructor as new (length: number) => RasterTypedArray;
  return new Constructor(band.length);
}

function buildSingleBandGrayscaleRaster(
  source: RasterImage,
  grayscaleBand: RasterTypedArray,
): RasterImage {
  return {
    ...source,
    bandPixels: [grayscaleBand],
    bandCount: 1,
    bandLabels: ["Grayscale"],
    bandWavelengths: undefined,
    bandOriginalNumbers: [1],
  };
}
