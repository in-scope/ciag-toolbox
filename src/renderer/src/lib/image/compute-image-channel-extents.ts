import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export interface RgbChannelExtents {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export const IDENTITY_RGB_CHANNEL_EXTENTS: RgbChannelExtents = {
  min: [0, 0, 0],
  max: [1, 1, 1],
};

const BYTES_PER_PIXEL = 4;
const BYTE_TO_UNIT_SCALE = 1 / 255;

export function computeImageRgbChannelExtents(
  source: ViewportImageSource,
): RgbChannelExtents {
  if (source.kind === "raster") return computeRasterUnitChannelExtents(source.raster);
  const rgbaBytes = readRgbaBytesFromSource(source);
  return computeRgbChannelExtentsFromBytes(rgbaBytes);
}

function readRgbaBytesFromSource(
  source: Exclude<ViewportImageSource, { kind: "raster" }>,
): Uint8ClampedArray | Uint8Array {
  if (source.kind === "pixels") return source.pixels;
  return readRgbaBytesByDrawingToOffscreenCanvas(source.image);
}

function computeRasterUnitChannelExtents(raster: RasterImage): RgbChannelExtents {
  const range = computeRasterValueRange(raster);
  if (!Number.isFinite(range.min)) return IDENTITY_RGB_CHANNEL_EXTENTS;
  const containerScale = chooseUnitScaleForRaster(raster);
  const minUnit = clampToUnit(range.min * containerScale);
  const maxUnit = clampToUnit(range.max * containerScale);
  return { min: [minUnit, minUnit, minUnit], max: [maxUnit, maxUnit, maxUnit] };
}

interface NumericRange {
  min: number;
  max: number;
}

function computeRasterValueRange(raster: RasterImage): NumericRange {
  const range: NumericRange = {
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
  };
  for (let i = 0; i < raster.pixels.length; i++) {
    expandRangeWithValue(range, raster.pixels[i] ?? 0);
  }
  return range;
}

function expandRangeWithValue(range: NumericRange, value: number): void {
  if (value < range.min) range.min = value;
  if (value > range.max) range.max = value;
}

function chooseUnitScaleForRaster(raster: RasterImage): number {
  if (raster.sampleFormat === "float") return 1;
  return 1 / containerMaxForBitsPerSample(raster.bitsPerSample);
}

function containerMaxForBitsPerSample(bitsPerSample: number): number {
  if (bitsPerSample <= 0) return 1;
  return Math.pow(2, bitsPerSample) - 1;
}

function clampToUnit(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function readRgbaBytesByDrawingToOffscreenCanvas(
  image: HTMLImageElement | ImageBitmap,
): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = acquireTwoDeeContextOrThrow(canvas);
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function acquireTwoDeeContextOrThrow(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to acquire 2D canvas context for image readback");
  }
  return context;
}

interface MutableRgbChannelRange {
  minR: number;
  minG: number;
  minB: number;
  maxR: number;
  maxG: number;
  maxB: number;
}

function computeRgbChannelExtentsFromBytes(
  rgba: Uint8Array | Uint8ClampedArray,
): RgbChannelExtents {
  const range = createInitialChannelRange();
  for (let offset = 0; offset < rgba.length; offset += BYTES_PER_PIXEL) {
    expandChannelRangeWithUnitPixelAtOffset(range, rgba, offset);
  }
  return convertChannelRangeToExtents(range);
}

function createInitialChannelRange(): MutableRgbChannelRange {
  return {
    minR: Number.POSITIVE_INFINITY,
    minG: Number.POSITIVE_INFINITY,
    minB: Number.POSITIVE_INFINITY,
    maxR: Number.NEGATIVE_INFINITY,
    maxG: Number.NEGATIVE_INFINITY,
    maxB: Number.NEGATIVE_INFINITY,
  };
}

function expandChannelRangeWithUnitPixelAtOffset(
  range: MutableRgbChannelRange,
  rgba: Uint8Array | Uint8ClampedArray,
  offset: number,
): void {
  const r = (rgba[offset] ?? 0) * BYTE_TO_UNIT_SCALE;
  const g = (rgba[offset + 1] ?? 0) * BYTE_TO_UNIT_SCALE;
  const b = (rgba[offset + 2] ?? 0) * BYTE_TO_UNIT_SCALE;
  if (r < range.minR) range.minR = r;
  if (g < range.minG) range.minG = g;
  if (b < range.minB) range.minB = b;
  if (r > range.maxR) range.maxR = r;
  if (g > range.maxG) range.maxG = g;
  if (b > range.maxB) range.maxB = b;
}

function convertChannelRangeToExtents(
  range: MutableRgbChannelRange,
): RgbChannelExtents {
  if (!Number.isFinite(range.minR)) return IDENTITY_RGB_CHANNEL_EXTENTS;
  return {
    min: [range.minR, range.minG, range.minB],
    max: [range.maxR, range.maxG, range.maxB],
  };
}
