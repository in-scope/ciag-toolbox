import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterSampleFormat,
  type RasterTypedArray,
} from "@/lib/image/raster-image";
import {
  clampViewportRoiToImageBounds,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";

export interface BlackWhitePointRange {
  readonly black: number;
  readonly white: number;
}

interface DataTypeValueRange {
  readonly min: number;
  readonly max: number;
}

interface PixelRectangle {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface ApplyBlackWhitePointsOptions {
  readonly region?: ViewportRoi;
}

export function applyBlackWhitePointsToRasterBand(
  raster: RasterImage,
  bandIndex: number,
  points: BlackWhitePointRange,
  options: ApplyBlackWhitePointsOptions = {},
): RasterImage {
  validateWhitePointIsAboveBlackPoint(points);
  const band = getRasterBandPixelsOrThrow(raster, bandIndex);
  const typeRange = dataTypeValueRangeForBand(band, raster.sampleFormat);
  const region = readRegionRectangleIfPresent(raster, options.region);
  const remappedBand = remapBandBlackWhitePointsWithinRegion(band, raster.width, points, typeRange, region);
  return { ...raster, bandPixels: replaceBandPixelsAtIndex(raster.bandPixels, bandIndex, remappedBand) };
}

function readRegionRectangleIfPresent(
  raster: RasterImage,
  region: ViewportRoi | undefined,
): PixelRectangle | null {
  if (!region) return null;
  return readPixelRectangleFromRoiClampedToRaster(raster, region);
}

function validateWhitePointIsAboveBlackPoint(points: BlackWhitePointRange): void {
  if (points.white > points.black) return;
  throw new Error(
    `White point (${points.white}) must be greater than black point (${points.black}).`,
  );
}

function replaceBandPixelsAtIndex(
  bands: ReadonlyArray<RasterTypedArray>,
  bandIndex: number,
  replacement: RasterTypedArray,
): ReadonlyArray<RasterTypedArray> {
  return bands.map((band, index) => (index === bandIndex ? replacement : band));
}

function dataTypeValueRangeForBand(
  band: RasterTypedArray,
  sampleFormat: RasterSampleFormat,
): DataTypeValueRange {
  if (sampleFormat === "float") return { min: 0, max: 1 };
  if (band instanceof Uint8Array) return { min: 0, max: 0xff };
  if (band instanceof Uint16Array) return { min: 0, max: 0xffff };
  if (band instanceof Uint32Array) return { min: 0, max: 0xffffffff };
  if (band instanceof Int8Array) return { min: -0x80, max: 0x7f };
  if (band instanceof Int16Array) return { min: -0x8000, max: 0x7fff };
  if (band instanceof Int32Array) return { min: -0x80000000, max: 0x7fffffff };
  return { min: 0, max: 1 };
}

function remapBandBlackWhitePointsWithinRegion(
  band: RasterTypedArray,
  rasterWidth: number,
  points: BlackWhitePointRange,
  typeRange: DataTypeValueRange,
  region: PixelRectangle | null,
): RasterTypedArray {
  const remapped = copyBandPixels(band);
  const roundForOutput = !isFloatTypedArray(band);
  for (const pixelIndex of listPixelIndexesInRegionOrWholeBand(band.length, rasterWidth, region)) {
    const source = band[pixelIndex] ?? 0;
    remapped[pixelIndex] = mapValueToTypeRange(source, points, typeRange, roundForOutput);
  }
  return remapped;
}

function mapValueToTypeRange(
  value: number,
  points: BlackWhitePointRange,
  typeRange: DataTypeValueRange,
  roundForOutput: boolean,
): number {
  const fraction = (value - points.black) / (points.white - points.black);
  const mapped = typeRange.min + fraction * (typeRange.max - typeRange.min);
  const clamped = clampValueToRange(mapped, typeRange);
  return roundForOutput ? Math.round(clamped) : clamped;
}

function clampValueToRange(value: number, range: DataTypeValueRange): number {
  if (value < range.min) return range.min;
  if (value > range.max) return range.max;
  return value;
}

function isFloatTypedArray(band: RasterTypedArray): boolean {
  return band instanceof Float32Array || band instanceof Float64Array;
}

function copyBandPixels(band: RasterTypedArray): RasterTypedArray {
  const Constructor = band.constructor as new (length: number) => RasterTypedArray;
  const copy = new Constructor(band.length);
  copy.set(band as never);
  return copy;
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

function* listPixelIndexesInRegionOrWholeBand(
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
