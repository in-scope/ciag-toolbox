import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "./raster-image";

export interface BandThumbnailPixels {
  readonly rgba: Uint8ClampedArray;
  readonly sizePx: number;
}

export function buildBandThumbnailPixelsOrNull(
  raster: RasterImage,
  bandIndex: number,
  sizePx: number,
): BandThumbnailPixels | null {
  if (sizePx <= 0) return null;
  const bandPixels = readBandPixelsOrNull(raster, bandIndex);
  if (!bandPixels) return null;
  const sample = pickUnitSampleFunctionForBand(raster, bandPixels);
  const rgba = buildDownsampledRgbaBytesForBand(raster, sample, sizePx);
  return { rgba, sizePx };
}

function readBandPixelsOrNull(
  raster: RasterImage,
  bandIndex: number,
): RasterTypedArray | null {
  if (bandIndex < 0 || bandIndex >= raster.bandPixels.length) return null;
  try {
    return getRasterBandPixelsOrThrow(raster, bandIndex);
  } catch {
    return null;
  }
}

type UnitSampleAtIndex = (sourceIndex: number) => number;

function pickUnitSampleFunctionForBand(
  raster: RasterImage,
  bandPixels: RasterTypedArray,
): UnitSampleAtIndex {
  const scale = computeUnitScaleForRasterSampleFormat(raster);
  return (sourceIndex) =>
    clampToUnitRange(((bandPixels[sourceIndex] ?? 0) as number) * scale);
}

function computeUnitScaleForRasterSampleFormat(raster: RasterImage): number {
  if (raster.sampleFormat === "float") return 1;
  const maxSampleValue = Math.pow(2, raster.bitsPerSample) - 1;
  if (maxSampleValue <= 0) return 1;
  return 1 / maxSampleValue;
}

function clampToUnitRange(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function buildDownsampledRgbaBytesForBand(
  raster: RasterImage,
  sample: UnitSampleAtIndex,
  sizePx: number,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(new ArrayBuffer(sizePx * sizePx * 4));
  for (let outY = 0; outY < sizePx; outY++) {
    for (let outX = 0; outX < sizePx; outX++) {
      writeOneDownsampledPixel(raster, sample, outX, outY, sizePx, rgba);
    }
  }
  return rgba;
}

function writeOneDownsampledPixel(
  raster: RasterImage,
  sample: UnitSampleAtIndex,
  outX: number,
  outY: number,
  sizePx: number,
  rgba: Uint8ClampedArray,
): void {
  const sourceIndex = pickNearestSourceIndexForOutputPixel(raster, outX, outY, sizePx);
  const unit = sample(sourceIndex);
  const byte = Math.round(unit * 255);
  const offset = (outY * sizePx + outX) * 4;
  rgba[offset] = byte;
  rgba[offset + 1] = byte;
  rgba[offset + 2] = byte;
  rgba[offset + 3] = 255;
}

function pickNearestSourceIndexForOutputPixel(
  raster: RasterImage,
  outX: number,
  outY: number,
  sizePx: number,
): number {
  const sourceX = Math.min(raster.width - 1, Math.floor((outX / sizePx) * raster.width));
  const sourceY = Math.min(raster.height - 1, Math.floor((outY / sizePx) * raster.height));
  return sourceY * raster.width + sourceX;
}
