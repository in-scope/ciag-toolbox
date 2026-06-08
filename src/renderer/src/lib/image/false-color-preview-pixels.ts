import {
  isFalseColorBandAssignmentInRange,
  type FalseColorBandAssignment,
} from "@/lib/image/apply-false-color-composite";
import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// CT-086: build an RGBA pixels source for the live false-color preview. The
// committed composite (apply-false-color-composite) keeps true band values, but
// the single-band raster renderer cannot show three bands at once, so the
// preview stretches each chosen band to [0,255] by its own min/max and packs the
// three into an interleaved RGBA buffer the viewport can display directly.

const OPAQUE_ALPHA_BYTE = 255;

export function buildFalseColorPreviewSourceOrNull(
  raster: RasterImage,
  assignment: FalseColorBandAssignment,
): ViewportImageSource | null {
  if (!isFalseColorBandAssignmentInRange(raster, assignment)) return null;
  return buildFalseColorPreviewSource(raster, assignment);
}

export function buildFalseColorPreviewSource(
  raster: RasterImage,
  assignment: FalseColorBandAssignment,
): ViewportImageSource {
  const red = stretchBandToDisplayBytes(getRasterBandPixelsOrThrow(raster, assignment.r - 1));
  const green = stretchBandToDisplayBytes(getRasterBandPixelsOrThrow(raster, assignment.g - 1));
  const blue = stretchBandToDisplayBytes(getRasterBandPixelsOrThrow(raster, assignment.b - 1));
  return {
    kind: "pixels",
    pixels: interleaveChannelBytesIntoRgbaPixels(red, green, blue),
    width: raster.width,
    height: raster.height,
  };
}

function stretchBandToDisplayBytes(band: RasterTypedArray): Uint8ClampedArray {
  const range = computeBandValueRange(band);
  const bytes = new Uint8ClampedArray(band.length);
  for (let index = 0; index < band.length; index += 1) {
    bytes[index] = scaleValueToDisplayByte(band[index] ?? range.min, range);
  }
  return bytes;
}

interface BandValueRange {
  readonly min: number;
  readonly max: number;
}

function scaleValueToDisplayByte(value: number, range: BandValueRange): number {
  const span = range.max - range.min;
  if (span === 0) return 0;
  return Math.round(((value - range.min) / span) * 255);
}

function computeBandValueRange(band: RasterTypedArray): BandValueRange {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < band.length; index += 1) {
    const value = band[index] ?? 0;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return band.length === 0 ? { min: 0, max: 0 } : { min, max };
}

function interleaveChannelBytesIntoRgbaPixels(
  red: Uint8ClampedArray,
  green: Uint8ClampedArray,
  blue: Uint8ClampedArray,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(red.length * 4);
  for (let index = 0; index < red.length; index += 1) {
    writeRgbaPixel(pixels, index, red[index] ?? 0, green[index] ?? 0, blue[index] ?? 0);
  }
  return pixels;
}

function writeRgbaPixel(
  pixels: Uint8ClampedArray,
  pixelIndex: number,
  red: number,
  green: number,
  blue: number,
): void {
  const base = pixelIndex * 4;
  pixels[base] = red;
  pixels[base + 1] = green;
  pixels[base + 2] = blue;
  pixels[base + 3] = OPAQUE_ALPHA_BYTE;
}
