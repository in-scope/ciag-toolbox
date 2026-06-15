import { getRasterBandPixelsOrThrow, type RasterImage } from "@/lib/image/raster-image";

const RGBA_BYTES_PER_PIXEL = 4;
const OPAQUE_ALPHA = 0xff;

// CT-173: a true-colour raster (a promoted photo) stores R, G and B as three uint8 bands. A
// colour exporter (RGB TIFF, PNG, JPEG) needs them interleaved as RGBA bytes again, so the photo
// saves in colour instead of as a single grey band. Only call this for an actual RGB composite.
export function buildRgbaBytesFromRgbRaster(raster: RasterImage): Uint8ClampedArray {
  const red = getRasterBandPixelsOrThrow(raster, 0);
  const green = getRasterBandPixelsOrThrow(raster, 1);
  const blue = getRasterBandPixelsOrThrow(raster, 2);
  return interleaveRgbBandsAsRgbaBytes(red, green, blue, raster.width * raster.height);
}

function interleaveRgbBandsAsRgbaBytes(
  red: ArrayLike<number>,
  green: ArrayLike<number>,
  blue: ArrayLike<number>,
  pixelCount: number,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(pixelCount * RGBA_BYTES_PER_PIXEL);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    writeRgbaPixel(rgba, pixelIndex, red[pixelIndex] ?? 0, green[pixelIndex] ?? 0, blue[pixelIndex] ?? 0);
  }
  return rgba;
}

function writeRgbaPixel(
  rgba: Uint8ClampedArray,
  pixelIndex: number,
  red: number,
  green: number,
  blue: number,
): void {
  const offset = pixelIndex * RGBA_BYTES_PER_PIXEL;
  rgba[offset] = red;
  rgba[offset + 1] = green;
  rgba[offset + 2] = blue;
  rgba[offset + 3] = OPAQUE_ALPHA;
}
