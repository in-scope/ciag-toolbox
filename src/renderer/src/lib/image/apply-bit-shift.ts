import {
  cloneRasterImage,
  type RasterImage,
  type RasterSampleFormat,
  type RasterTypedArray,
} from "@/lib/image/raster-image";
import {
  clampViewportRoiToImageBounds,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";

export const MIN_BIT_SHIFT_AMOUNT = 0;
export const MAX_BIT_SHIFT_AMOUNT = 8;

interface TypedArrayValueRange {
  readonly min: number;
  readonly max: number;
}

interface PixelRectangle {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface ApplyBitShiftOptions {
  readonly region?: ViewportRoi;
}

export function applyBitShiftToRasterImage(
  raster: RasterImage,
  shiftAmount: number,
  options: ApplyBitShiftOptions = {},
): RasterImage {
  validateBitShiftAmountIsInSupportedRange(shiftAmount);
  if (shiftAmount === 0) return cloneRasterImage(raster);
  const shiftMultiplier = 2 ** shiftAmount;
  const region = options.region ? readPixelRectangleFromRoiClampedToRaster(raster, options.region) : null;
  const shiftedBandPixels = raster.bandPixels.map((band) =>
    leftShiftBandValuesAndClampToTypeRange(band, shiftMultiplier, raster.sampleFormat, raster.width, region),
  );
  return { ...raster, bandPixels: shiftedBandPixels };
}

function readPixelRectangleFromRoiClampedToRaster(
  raster: RasterImage,
  roi: ViewportRoi,
): PixelRectangle {
  const clamped = clampViewportRoiToImageBounds(roi, {
    width: raster.width,
    height: raster.height,
  });
  return {
    x0: clamped.imagePixelX0,
    y0: clamped.imagePixelY0,
    x1: clamped.imagePixelX1,
    y1: clamped.imagePixelY1,
  };
}

function validateBitShiftAmountIsInSupportedRange(shiftAmount: number): void {
  if (!Number.isInteger(shiftAmount)) {
    throw new Error(`Bit shift amount must be an integer (received ${shiftAmount})`);
  }
  if (shiftAmount < MIN_BIT_SHIFT_AMOUNT || shiftAmount > MAX_BIT_SHIFT_AMOUNT) {
    throw new Error(
      `Bit shift amount must be between ${MIN_BIT_SHIFT_AMOUNT} and ${MAX_BIT_SHIFT_AMOUNT} (received ${shiftAmount})`,
    );
  }
}

function leftShiftBandValuesAndClampToTypeRange(
  band: RasterTypedArray,
  shiftMultiplier: number,
  sampleFormat: RasterSampleFormat,
  rasterWidth: number,
  region: PixelRectangle | null,
): RasterTypedArray {
  const valueRange = getTypedArrayValueRangeForSampleFormat(band, sampleFormat);
  const shiftedBand = copyBandPixelsForShift(band, region);
  const indexes = listPixelIndexesToShift(band.length, rasterWidth, region);
  for (const pixelIndex of indexes) {
    const sourceValue = band[pixelIndex] ?? 0;
    shiftedBand[pixelIndex] = clampValueToRange(sourceValue * shiftMultiplier, valueRange);
  }
  return shiftedBand;
}

function copyBandPixelsForShift(
  band: RasterTypedArray,
  region: PixelRectangle | null,
): RasterTypedArray {
  if (!region) return createEmptyTypedArrayMatchingBand(band);
  const Constructor = band.constructor as new (length: number) => RasterTypedArray;
  const copy = new Constructor(band.length);
  copy.set(band as never);
  return copy;
}

function* listPixelIndexesToShift(
  bandLength: number,
  rasterWidth: number,
  region: PixelRectangle | null,
): IterableIterator<number> {
  if (!region) {
    for (let pixelIndex = 0; pixelIndex < bandLength; pixelIndex += 1) yield pixelIndex;
    return;
  }
  for (let row = region.y0; row <= region.y1; row += 1) {
    const rowStart = row * rasterWidth;
    for (let column = region.x0; column <= region.x1; column += 1) yield rowStart + column;
  }
}

function getTypedArrayValueRangeForSampleFormat(
  band: RasterTypedArray,
  sampleFormat: RasterSampleFormat,
): TypedArrayValueRange {
  if (sampleFormat === "float") return { min: -Infinity, max: Infinity };
  if (band instanceof Uint8Array) return { min: 0, max: 0xff };
  if (band instanceof Uint16Array) return { min: 0, max: 0xffff };
  if (band instanceof Uint32Array) return { min: 0, max: 0xffffffff };
  if (band instanceof Int8Array) return { min: -0x80, max: 0x7f };
  if (band instanceof Int16Array) return { min: -0x8000, max: 0x7fff };
  if (band instanceof Int32Array) return { min: -0x80000000, max: 0x7fffffff };
  return { min: -Infinity, max: Infinity };
}

function createEmptyTypedArrayMatchingBand(band: RasterTypedArray): RasterTypedArray {
  const Constructor = band.constructor as new (length: number) => RasterTypedArray;
  return new Constructor(band.length);
}

function clampValueToRange(value: number, range: TypedArrayValueRange): number {
  if (value > range.max) return range.max;
  if (value < range.min) return range.min;
  return value;
}
