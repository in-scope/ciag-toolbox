import {
  cloneRasterImage,
  type RasterImage,
  type RasterSampleFormat,
  type RasterTypedArray,
} from "@/lib/image/raster-image";

export const MIN_BIT_SHIFT_AMOUNT = 0;
export const MAX_BIT_SHIFT_AMOUNT = 8;

interface TypedArrayValueRange {
  readonly min: number;
  readonly max: number;
}

export function applyBitShiftToRasterImage(
  raster: RasterImage,
  shiftAmount: number,
): RasterImage {
  validateBitShiftAmountIsInSupportedRange(shiftAmount);
  if (shiftAmount === 0) return cloneRasterImage(raster);
  const shiftMultiplier = 2 ** shiftAmount;
  const shiftedBandPixels = raster.bandPixels.map((band) =>
    leftShiftBandValuesAndClampToTypeRange(band, shiftMultiplier, raster.sampleFormat),
  );
  return { ...raster, bandPixels: shiftedBandPixels };
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
): RasterTypedArray {
  const valueRange = getTypedArrayValueRangeForSampleFormat(band, sampleFormat);
  const shiftedBand = createEmptyTypedArrayMatchingBand(band);
  for (let pixelIndex = 0; pixelIndex < band.length; pixelIndex += 1) {
    const sourceValue = band[pixelIndex] ?? 0;
    shiftedBand[pixelIndex] = clampValueToRange(sourceValue * shiftMultiplier, valueRange);
  }
  return shiftedBand;
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
