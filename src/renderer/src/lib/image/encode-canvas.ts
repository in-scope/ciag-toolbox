import {
  buildAsViewedRgbaBytesFromRaster,
  mapRgbaBytesThroughDisplayNormalizationInPlace,
  resolveAsViewedNormalizationForSource,
  type ViewportDisplayMappingState,
} from "@/lib/image/as-viewed-display-mapping";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export type CanvasImageMimeType = "image/png" | "image/jpeg";

// CT-296: PNG and JPEG save the image AS VIEWED, so the encode needs the panel's
// display state alongside the pixels. Data formats never come through here.
export interface CanvasEncodeOptions {
  readonly mimeType: CanvasImageMimeType;
  readonly jpegQuality?: number;
  readonly displayMapping: ViewportDisplayMappingState;
}

const DEFAULT_JPEG_QUALITY = 0.95;

export async function encodeViewportSourceAsCanvasBlobBytes(
  source: ViewportImageSource,
  selectedBandIndex: number,
  options: CanvasEncodeOptions,
): Promise<Uint8Array> {
  const canvas = renderViewportSourceAsViewedToOffscreenCanvas(
    source,
    selectedBandIndex,
    options.displayMapping,
  );
  const blob = await convertCanvasToImageBlob(canvas, options);
  return convertBlobToBytes(blob);
}

function renderViewportSourceAsViewedToOffscreenCanvas(
  source: ViewportImageSource,
  selectedBandIndex: number,
  displayMapping: ViewportDisplayMappingState,
): HTMLCanvasElement {
  if (source.kind === "raster") {
    return renderRasterSourceAsViewedToCanvas(source.raster, selectedBandIndex, displayMapping);
  }
  return renderBrowserSourceAsViewedToCanvas(source, displayMapping);
}

// CT-173: a true-colour raster (a promoted photo) renders as a colour composite so PNG/JPEG keep
// its colour; every other raster renders the selected band as grayscale (a scientific stack).
// CT-296: either way the pixels come from the shared as-viewed display mapping.
function renderRasterSourceAsViewedToCanvas(
  raster: RasterImage,
  selectedBandIndex: number,
  displayMapping: ViewportDisplayMappingState,
): HTMLCanvasElement {
  const rgba = buildAsViewedRgbaBytesFromRaster(raster, selectedBandIndex, displayMapping);
  return renderRgbaBytesAsCanvas(rgba, raster.width, raster.height);
}

function renderRgbaBytesAsCanvas(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = createCanvasAtSize(width, height);
  const context = acquireTwoDeeContextOrThrow(canvas);
  context.putImageData(createImageDataFromClampedRgbaBytes(rgba, width, height), 0, 0);
  return canvas;
}

// A browser-image source is already in display units, so only the normalize
// block can change it; with normalized viewing off this is the plain draw.
function renderBrowserSourceAsViewedToCanvas(
  source: Exclude<ViewportImageSource, { kind: "raster" }>,
  displayMapping: ViewportDisplayMappingState,
): HTMLCanvasElement {
  const normalization = resolveAsViewedNormalizationForSource(source, 0, displayMapping);
  if (!normalization.enabled) return renderBrowserSourceToCanvas(source);
  const drawn = readRgbaBytesFromBrowserSourceSync(source);
  const mapped = mapRgbaBytesThroughDisplayNormalizationInPlace(drawn.rgba, normalization);
  return renderRgbaBytesAsCanvas(mapped, drawn.width, drawn.height);
}

function createImageDataFromClampedRgbaBytes(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): ImageData {
  const owned = new Uint8ClampedArray(rgba);
  return new ImageData(owned, width, height);
}

function renderBrowserSourceToCanvas(
  source: Exclude<ViewportImageSource, { kind: "raster" }>,
): HTMLCanvasElement {
  if (source.kind === "pixels") {
    return renderPixelsAsCanvas(source);
  }
  return renderHtmlOrBitmapImageAsCanvas(source.image);
}

function renderPixelsAsCanvas(source: {
  pixels: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}): HTMLCanvasElement {
  const canvas = createCanvasAtSize(source.width, source.height);
  const context = acquireTwoDeeContextOrThrow(canvas);
  const clampedPixels = ensureUint8ClampedArrayPixels(source.pixels);
  const imageData = createImageDataFromClampedRgbaBytes(
    clampedPixels,
    source.width,
    source.height,
  );
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function renderHtmlOrBitmapImageAsCanvas(
  image: HTMLImageElement | ImageBitmap,
): HTMLCanvasElement {
  const canvas = createCanvasAtSize(image.width, image.height);
  const context = acquireTwoDeeContextOrThrow(canvas);
  context.drawImage(image, 0, 0);
  return canvas;
}

function ensureUint8ClampedArrayPixels(
  pixels: Uint8ClampedArray | Uint8Array,
): Uint8ClampedArray {
  if (pixels instanceof Uint8ClampedArray) return pixels;
  return new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength);
}

function createCanvasAtSize(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function acquireTwoDeeContextOrThrow(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to acquire 2D canvas context for image export");
  }
  return context;
}

function convertCanvasToImageBlob(
  canvas: HTMLCanvasElement,
  options: CanvasEncodeOptions,
): Promise<Blob> {
  const quality = options.mimeType === "image/jpeg"
    ? options.jpegQuality ?? DEFAULT_JPEG_QUALITY
    : undefined;
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => routeBlobOrReject(blob, options.mimeType, resolve, reject),
      options.mimeType,
      quality,
    );
  });
}

function routeBlobOrReject(
  blob: Blob | null,
  mimeType: CanvasImageMimeType,
  resolve: (blob: Blob) => void,
  reject: (error: Error) => void,
): void {
  if (!blob) {
    reject(new Error(`Failed to encode canvas as ${mimeType}`));
    return;
  }
  resolve(blob);
}

async function convertBlobToBytes(blob: Blob): Promise<Uint8Array> {
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

export function readRgbaBytesFromBrowserSourceSync(
  source: Exclude<ViewportImageSource, { kind: "raster" }>,
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const canvas = renderBrowserSourceToCanvas(source);
  const context = acquireTwoDeeContextOrThrow(canvas);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return { rgba: imageData.data, width: canvas.width, height: canvas.height };
}

export async function readRgbaBytesFromBrowserSource(
  source: Exclude<ViewportImageSource, { kind: "raster" }>,
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  return readRgbaBytesFromBrowserSourceSync(source);
}
