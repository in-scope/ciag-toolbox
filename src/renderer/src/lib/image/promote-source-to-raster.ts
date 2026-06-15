import { readRgbaBytesFromBrowserSourceSync } from "@/lib/image/encode-canvas";
import type { RasterImage } from "@/lib/image/raster-image";
import type {
  BrowserViewportImageSource,
  ViewportImageSource,
} from "@/lib/webgl/texture";

// CT-109: raster operations historically rejected any non-raster source (a
// browser-decoded JPG/PNG arrives as an image-bitmap, html-image, or pixels
// source). Instead of refusing, we promote a browser-decoded source to an
// 8-bit 3-band (R, G, B) raster by reading its RGBA pixels, so every raster
// operation can run unchanged afterwards.

export type RasterViewportImageSource = Extract<ViewportImageSource, { kind: "raster" }>;

const RGB_PROMOTION_BAND_LABELS: ReadonlyArray<string> = ["Red", "Green", "Blue"];
const RGB_PROMOTION_BAND_ORIGINAL_NUMBERS: ReadonlyArray<number> = [1, 2, 3];

export function coerceViewportSourceToRasterSource(
  source: ViewportImageSource,
): RasterViewportImageSource {
  if (source.kind === "raster") return source;
  return { kind: "raster", raster: promoteBrowserSourceToRgbRaster(source) };
}

export function promoteBrowserSourceToRgbRaster(
  source: BrowserViewportImageSource,
): RasterImage {
  if (source.kind === "pixels") {
    return buildRgbRasterFromRgbaBytes(source.pixels, source.width, source.height);
  }
  const { rgba, width, height } = readRgbaBytesFromBrowserSourceSync(source);
  return buildRgbRasterFromRgbaBytes(rgba, width, height);
}

export function buildRgbRasterFromRgbaBytes(
  rgba: Uint8ClampedArray | Uint8Array,
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

function splitRgbaBytesIntoRgbBands(
  rgba: Uint8ClampedArray | Uint8Array,
  pixelCount: number,
): ReadonlyArray<Uint8Array> {
  const red = new Uint8Array(pixelCount);
  const green = new Uint8Array(pixelCount);
  const blue = new Uint8Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    red[pixelIndex] = rgba[offset] ?? 0;
    green[pixelIndex] = rgba[offset + 1] ?? 0;
    blue[pixelIndex] = rgba[offset + 2] ?? 0;
  }
  return [red, green, blue];
}

function assertRgbaBytesCoverPixelCount(
  rgba: Uint8ClampedArray | Uint8Array,
  pixelCount: number,
): void {
  if (rgba.length >= pixelCount * 4) return;
  throw new Error(
    `RGBA buffer has ${rgba.length} bytes but ${pixelCount} pixels require ${pixelCount * 4}.`,
  );
}
