import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

export type CanvasImageMimeType = "image/png" | "image/jpeg";

export interface CanvasEncodeOptions {
  readonly mimeType: CanvasImageMimeType;
  readonly jpegQuality?: number;
}

const DEFAULT_JPEG_QUALITY = 0.95;

export async function encodeViewportSourceAsCanvasBlobBytes(
  source: ViewportImageSource,
  selectedBandIndex: number,
  options: CanvasEncodeOptions,
): Promise<Uint8Array> {
  const canvas = renderViewportSourceToOffscreenCanvas(source, selectedBandIndex);
  const blob = await convertCanvasToImageBlob(canvas, options);
  return convertBlobToBytes(blob);
}

function renderViewportSourceToOffscreenCanvas(
  source: ViewportImageSource,
  selectedBandIndex: number,
): HTMLCanvasElement {
  if (source.kind === "raster") {
    return renderRasterBandAsGrayscaleCanvas(source.raster, selectedBandIndex);
  }
  return renderBrowserSourceToCanvas(source);
}

function renderRasterBandAsGrayscaleCanvas(
  raster: RasterImage,
  bandIndex: number,
): HTMLCanvasElement {
  const canvas = createCanvasAtSize(raster.width, raster.height);
  const context = acquireTwoDeeContextOrThrow(canvas);
  const rgbaBytes = convertRasterBandToRgbaBytes(raster, bandIndex);
  const imageData = createImageDataFromClampedRgbaBytes(rgbaBytes, raster.width, raster.height);
  context.putImageData(imageData, 0, 0);
  return canvas;
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

function convertRasterBandToRgbaBytes(
  raster: RasterImage,
  bandIndex: number,
): Uint8ClampedArray {
  const pixels = getRasterBandPixelsOrThrow(raster, bandIndex);
  const scaleFactor = computeUnitScaleFactorForRaster(raster);
  const rgba = new Uint8ClampedArray(raster.width * raster.height * 4);
  fillRgbaWithGrayscaleFromBand(rgba, pixels, scaleFactor);
  return rgba;
}

function fillRgbaWithGrayscaleFromBand(
  rgba: Uint8ClampedArray,
  pixels: RasterTypedArray,
  scaleFactor: number,
): void {
  for (let pixelIndex = 0; pixelIndex < pixels.length; pixelIndex += 1) {
    const byteValue = quantizeUnitValueToByte((pixels[pixelIndex] ?? 0) * scaleFactor);
    const offset = pixelIndex * 4;
    rgba[offset] = byteValue;
    rgba[offset + 1] = byteValue;
    rgba[offset + 2] = byteValue;
    rgba[offset + 3] = 0xff;
  }
}

function computeUnitScaleFactorForRaster(raster: RasterImage): number {
  if (raster.sampleFormat === "float") return 0xff;
  const containerMax = Math.pow(2, raster.bitsPerSample) - 1;
  if (containerMax <= 0) return 1;
  return 0xff / containerMax;
}

function quantizeUnitValueToByte(value: number): number {
  if (value <= 0) return 0;
  if (value >= 0xff) return 0xff;
  return Math.round(value);
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

export async function readRgbaBytesFromBrowserSource(
  source: Exclude<ViewportImageSource, { kind: "raster" }>,
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const canvas = renderBrowserSourceToCanvas(source);
  const context = acquireTwoDeeContextOrThrow(canvas);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return { rgba: imageData.data, width: canvas.width, height: canvas.height };
}
