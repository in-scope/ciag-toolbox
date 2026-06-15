import type { RasterSampleFormat, RasterTypedArray } from "@/lib/image/raster-image";

export interface DataTypeValueRange {
  readonly min: number;
  readonly max: number;
}

const FLOAT_DISPLAY_RANGE: DataTypeValueRange = { min: 0, max: 1 };

export function dataTypeValueRangeForBand(
  band: RasterTypedArray,
  sampleFormat: RasterSampleFormat,
): DataTypeValueRange {
  if (sampleFormat === "float") return FLOAT_DISPLAY_RANGE;
  return integerContainerValueRangeForBand(band);
}

function integerContainerValueRangeForBand(band: RasterTypedArray): DataTypeValueRange {
  if (band instanceof Uint8Array) return { min: 0, max: 0xff };
  if (band instanceof Uint16Array) return { min: 0, max: 0xffff };
  if (band instanceof Uint32Array) return { min: 0, max: 0xffffffff };
  if (band instanceof Int8Array) return { min: -0x80, max: 0x7f };
  if (band instanceof Int16Array) return { min: -0x8000, max: 0x7fff };
  if (band instanceof Int32Array) return { min: -0x80000000, max: 0x7fffffff };
  return FLOAT_DISPLAY_RANGE;
}

export function clampValueToDataTypeRange(value: number, range: DataTypeValueRange): number {
  if (value < range.min) return range.min;
  if (value > range.max) return range.max;
  return value;
}

export function isFloatTypedArray(band: RasterTypedArray): boolean {
  return band instanceof Float32Array || band instanceof Float64Array;
}

export function clampValueToDataTypeRangeRoundingIntegers(
  value: number,
  range: DataTypeValueRange,
  roundForIntegerOutput: boolean,
): number {
  const clamped = clampValueToDataTypeRange(value, range);
  return roundForIntegerOutput ? Math.round(clamped) : clamped;
}
