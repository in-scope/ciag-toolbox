import {
  getRasterBandLabelOrDefault,
  type RasterImage,
  type RasterSampleFormat,
} from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

const SIGNIFICANT_FIGURES_FOR_FLOAT_VALUES = 4;
const RGBA_BAND_LABELS: ReadonlyArray<string> = ["Red", "Green", "Blue", "Alpha"];

export interface ViewportPixelReadoutBands {
  readonly values: ReadonlyArray<number>;
  readonly labels: ReadonlyArray<string>;
  readonly sampleFormat: RasterSampleFormat;
}

export function readPixelReadoutBandsAtImagePointOrNull(
  source: ViewportImageSource,
  imageX: number,
  imageY: number,
): ViewportPixelReadoutBands | null {
  if (source.kind === "raster") {
    return readRasterReadoutBandsAtImagePoint(source.raster, imageX, imageY);
  }
  if (source.kind === "pixels") {
    return readBrowserPixelsReadoutBandsAtImagePoint(source, imageX, imageY);
  }
  return null;
}

function readRasterReadoutBandsAtImagePoint(
  raster: RasterImage,
  imageX: number,
  imageY: number,
): ViewportPixelReadoutBands | null {
  if (!isImagePointInsideRaster(imageX, imageY, raster.width, raster.height)) return null;
  const offset = imageY * raster.width + imageX;
  const values = raster.bandPixels.map((band) => readNumberOrZero(band, offset));
  const labels = raster.bandPixels.map((_, index) => getRasterBandLabelOrDefault(raster, index));
  return { values, labels, sampleFormat: raster.sampleFormat };
}

function readBrowserPixelsReadoutBandsAtImagePoint(
  source: { width: number; height: number; pixels: Uint8ClampedArray | Uint8Array },
  imageX: number,
  imageY: number,
): ViewportPixelReadoutBands | null {
  if (!isImagePointInsideRaster(imageX, imageY, source.width, source.height)) return null;
  const baseOffset = (imageY * source.width + imageX) * 4;
  const values = [0, 1, 2, 3].map((channel) => readNumberOrZero(source.pixels, baseOffset + channel));
  return { values, labels: [...RGBA_BAND_LABELS], sampleFormat: "uint" };
}

function isImagePointInsideRaster(
  imageX: number,
  imageY: number,
  width: number,
  height: number,
): boolean {
  if (imageX < 0 || imageY < 0) return false;
  return imageX < width && imageY < height;
}

function readNumberOrZero(typedArray: ArrayLike<number>, index: number): number {
  return typedArray[index] ?? 0;
}

export function formatPixelReadoutValueForDisplay(
  value: number,
  sampleFormat: RasterSampleFormat,
): string {
  if (!Number.isFinite(value)) return "-";
  if (sampleFormat === "float") return formatFloatToFourSignificantFigures(value);
  return value.toString();
}

function formatFloatToFourSignificantFigures(value: number): string {
  if (value === 0) return "0";
  return value.toPrecision(SIGNIFICANT_FIGURES_FOR_FLOAT_VALUES);
}

export function formatPixelReadoutValuesAsCommaSeparatedList(
  values: ReadonlyArray<number>,
  sampleFormat: RasterSampleFormat,
): string {
  return values.map((value) => formatPixelReadoutValueForDisplay(value, sampleFormat)).join(", ");
}
