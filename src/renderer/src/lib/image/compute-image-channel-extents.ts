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
const MAX_BYTE_VALUE = 255;

export function computeImageRgbChannelExtents(
  source: ViewportImageSource,
): RgbChannelExtents {
  const rgbaBytes = readRgbaBytesFromSource(source);
  return computeRgbChannelExtentsFromBytes(rgbaBytes);
}

function readRgbaBytesFromSource(
  source: ViewportImageSource,
): Uint8ClampedArray | Uint8Array {
  if (source.kind === "pixels") return source.pixels;
  return readRgbaBytesByDrawingToOffscreenCanvas(source.image);
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
    expandChannelRangeWithPixelAtOffset(range, rgba, offset);
  }
  return convertChannelRangeToNormalizedExtents(range);
}

function createInitialChannelRange(): MutableRgbChannelRange {
  return {
    minR: MAX_BYTE_VALUE,
    minG: MAX_BYTE_VALUE,
    minB: MAX_BYTE_VALUE,
    maxR: 0,
    maxG: 0,
    maxB: 0,
  };
}

function expandChannelRangeWithPixelAtOffset(
  range: MutableRgbChannelRange,
  rgba: Uint8Array | Uint8ClampedArray,
  offset: number,
): void {
  const r = rgba[offset] ?? 0;
  const g = rgba[offset + 1] ?? 0;
  const b = rgba[offset + 2] ?? 0;
  if (r < range.minR) range.minR = r;
  if (g < range.minG) range.minG = g;
  if (b < range.minB) range.minB = b;
  if (r > range.maxR) range.maxR = r;
  if (g > range.maxG) range.maxG = g;
  if (b > range.maxB) range.maxB = b;
}

function convertChannelRangeToNormalizedExtents(
  range: MutableRgbChannelRange,
): RgbChannelExtents {
  return {
    min: [
      range.minR / MAX_BYTE_VALUE,
      range.minG / MAX_BYTE_VALUE,
      range.minB / MAX_BYTE_VALUE,
    ],
    max: [
      range.maxR / MAX_BYTE_VALUE,
      range.maxG / MAX_BYTE_VALUE,
      range.maxB / MAX_BYTE_VALUE,
    ],
  };
}
