import { readRgbaBytesFromBrowserSourceSync } from "@/lib/image/encode-canvas";
import type { RasterImage } from "@/lib/image/raster-image";
import type {
  BrowserViewportImageSource,
  ViewportImageSource,
} from "@/lib/webgl/texture";

// CT-109 / CT-172: a browser-decoded source (a JPG/PNG, or the RAW decode path) is promoted
// to a raster at LOAD so every raster feature (operations, the histogram, the tone curve)
// works on it like any other image. A true-colour photo becomes an 8-bit 3-band (R, G, B)
// raster tagged "rgb" so the viewport shows one colour composite; a grayscale photo (every
// pixel has R == G == B) becomes a single-band raster with NO rgb tag, so it is not mistaken
// for a colour composite. Alpha is always dropped (the promotion keeps R/G/B only).

export type RasterViewportImageSource = Extract<ViewportImageSource, { kind: "raster" }>;

type RgbaBytes = Uint8ClampedArray | Uint8Array;

interface BrowserSourceRgbaBytes {
  readonly rgba: RgbaBytes;
  readonly width: number;
  readonly height: number;
}

const RGB_PROMOTION_BAND_LABELS: ReadonlyArray<string> = ["Red", "Green", "Blue"];
const RGB_PROMOTION_BAND_ORIGINAL_NUMBERS: ReadonlyArray<number> = [1, 2, 3];
const RGBA_BYTES_PER_PIXEL = 4;

export function coerceViewportSourceToRasterSource(
  source: ViewportImageSource,
): RasterViewportImageSource {
  if (source.kind === "raster") return source;
  return { kind: "raster", raster: promoteBrowserSourceToRaster(source) };
}

export function promoteBrowserSourceToRaster(
  source: BrowserViewportImageSource,
): RasterImage {
  const { rgba, width, height } = readRgbaBytesFromBrowserSource(source);
  return buildRasterFromRgbaBytesDetectingColor(rgba, width, height);
}

function readRgbaBytesFromBrowserSource(
  source: BrowserViewportImageSource,
): BrowserSourceRgbaBytes {
  if (source.kind === "pixels") {
    return { rgba: source.pixels, width: source.width, height: source.height };
  }
  return readRgbaBytesFromBrowserSourceSync(source);
}

export function buildRasterFromRgbaBytesDetectingColor(
  rgba: RgbaBytes,
  width: number,
  height: number,
): RasterImage {
  const pixelCount = width * height;
  assertRgbaBytesCoverPixelCount(rgba, pixelCount);
  if (rgbaBytesContainOnlyGrayscalePixels(rgba, pixelCount)) {
    return buildSingleBandGrayscaleRaster(rgba, pixelCount, width, height);
  }
  return buildRgbRasterFromRgbaBytes(rgba, width, height);
}

export function buildRgbRasterFromRgbaBytes(
  rgba: RgbaBytes,
  width: number,
  height: number,
): RasterImage {
  const pixelCount = width * height;
  assertRgbaBytesCoverPixelCount(rgba, pixelCount);
  return {
    bandPixels: splitRgbaBytesIntoRgbBands(rgba, pixelCount),
    width,
    height,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 3,
    bandLabels: RGB_PROMOTION_BAND_LABELS,
    bandOriginalNumbers: RGB_PROMOTION_BAND_ORIGINAL_NUMBERS,
    colorInterpretation: "rgb",
  };
}

function buildSingleBandGrayscaleRaster(
  rgba: RgbaBytes,
  pixelCount: number,
  width: number,
  height: number,
): RasterImage {
  return {
    bandPixels: [extractRedChannelAsGrayscaleBand(rgba, pixelCount)],
    width,
    height,
    bitsPerSample: 8,
    sampleFormat: "uint",
    bandCount: 1,
  };
}

function rgbaBytesContainOnlyGrayscalePixels(rgba: RgbaBytes, pixelCount: number): boolean {
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * RGBA_BYTES_PER_PIXEL;
    const red = rgba[offset] ?? 0;
    if ((rgba[offset + 1] ?? 0) !== red || (rgba[offset + 2] ?? 0) !== red) return false;
  }
  return true;
}

function extractRedChannelAsGrayscaleBand(rgba: RgbaBytes, pixelCount: number): Uint8Array {
  const gray = new Uint8Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    gray[pixelIndex] = rgba[pixelIndex * RGBA_BYTES_PER_PIXEL] ?? 0;
  }
  return gray;
}

function splitRgbaBytesIntoRgbBands(
  rgba: RgbaBytes,
  pixelCount: number,
): ReadonlyArray<Uint8Array> {
  const red = new Uint8Array(pixelCount);
  const green = new Uint8Array(pixelCount);
  const blue = new Uint8Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * RGBA_BYTES_PER_PIXEL;
    red[pixelIndex] = rgba[offset] ?? 0;
    green[pixelIndex] = rgba[offset + 1] ?? 0;
    blue[pixelIndex] = rgba[offset + 2] ?? 0;
  }
  return [red, green, blue];
}

function assertRgbaBytesCoverPixelCount(rgba: RgbaBytes, pixelCount: number): void {
  if (rgba.length >= pixelCount * RGBA_BYTES_PER_PIXEL) return;
  throw new Error(
    `RGBA buffer has ${rgba.length} bytes but ${pixelCount} pixels require ${pixelCount * RGBA_BYTES_PER_PIXEL}.`,
  );
}
