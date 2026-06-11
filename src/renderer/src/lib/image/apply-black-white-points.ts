import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
} from "@/lib/image/raster-image";
import {
  clampValueToDataTypeRangeRoundingIntegers,
  dataTypeValueRangeForBand,
  isFloatTypedArray,
  type DataTypeValueRange,
} from "@/lib/image/data-type-value-range";
import {
  remapRasterBandWithinRegion,
  type RegionRemapOptions,
} from "@/lib/image/remap-band-region";

export interface BlackWhitePointRange {
  readonly black: number;
  readonly white: number;
}

export type ApplyBlackWhitePointsOptions = RegionRemapOptions;

export function applyBlackWhitePointsToRasterBand(
  raster: RasterImage,
  bandIndex: number,
  points: BlackWhitePointRange,
  options: ApplyBlackWhitePointsOptions = {},
): RasterImage {
  validateWhitePointIsAboveBlackPoint(points);
  const band = getRasterBandPixelsOrThrow(raster, bandIndex);
  const typeRange = dataTypeValueRangeForBand(band, raster.sampleFormat);
  const roundForOutput = !isFloatTypedArray(band);
  return remapRasterBandWithinRegion(raster, bandIndex, options, (value) =>
    mapValueToTypeRange(value, points, typeRange, roundForOutput),
  );
}

function validateWhitePointIsAboveBlackPoint(points: BlackWhitePointRange): void {
  if (points.white > points.black) return;
  throw new Error(
    `White point (${points.white}) must be greater than black point (${points.black}).`,
  );
}

function mapValueToTypeRange(
  value: number,
  points: BlackWhitePointRange,
  typeRange: DataTypeValueRange,
  roundForOutput: boolean,
): number {
  const fraction = (value - points.black) / (points.white - points.black);
  const mapped = typeRange.min + fraction * (typeRange.max - typeRange.min);
  return clampValueToDataTypeRangeRoundingIntegers(mapped, typeRange, roundForOutput);
}
