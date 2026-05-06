import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";
import {
  canonicalizeViewportRoiCorners,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";

export interface PixelSpectrum {
  readonly bandValues: ReadonlyArray<number>;
}

export interface RoiMeanSpectrum {
  readonly bandMeans: ReadonlyArray<number>;
  readonly bandStandardDeviations: ReadonlyArray<number>;
  readonly samplePixelCount: number;
}

export function computePixelSpectrumOrNull(
  raster: RasterImage,
  imageX: number,
  imageY: number,
): PixelSpectrum | null {
  if (!isImagePointInsideRaster(imageX, imageY, raster.width, raster.height)) return null;
  const offset = imageY * raster.width + imageX;
  const bandValues = raster.bandPixels.map((band) => readSampleAtIndexOrZero(band, offset));
  return { bandValues };
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

function readSampleAtIndexOrZero(typedArray: RasterTypedArray, index: number): number {
  return typedArray[index] ?? 0;
}

export function computeRoiMeanSpectrumOrNull(
  raster: RasterImage,
  roi: ViewportRoi,
): RoiMeanSpectrum | null {
  const region = clampRoiToRasterBounds(raster, roi);
  if (region.samplePixelCount === 0) return null;
  const bandMeans = raster.bandPixels.map((band) =>
    computeBandMeanOverRegion(band, raster.width, region),
  );
  const bandStandardDeviations = raster.bandPixels.map((band, bandIndex) =>
    computeBandStandardDeviationOverRegion(band, raster.width, region, bandMeans[bandIndex] ?? 0),
  );
  return {
    bandMeans,
    bandStandardDeviations,
    samplePixelCount: region.samplePixelCount,
  };
}

interface ClampedRoiRegion {
  readonly imagePixelX0: number;
  readonly imagePixelY0: number;
  readonly imagePixelX1: number;
  readonly imagePixelY1: number;
  readonly samplePixelCount: number;
}

function clampRoiToRasterBounds(
  raster: RasterImage,
  roi: ViewportRoi,
): ClampedRoiRegion {
  const canonical = canonicalizeViewportRoiCorners(roi);
  const x0 = clampPixelIndex(canonical.imagePixelX0, raster.width);
  const y0 = clampPixelIndex(canonical.imagePixelY0, raster.height);
  const x1 = clampPixelIndex(canonical.imagePixelX1, raster.width);
  const y1 = clampPixelIndex(canonical.imagePixelY1, raster.height);
  const widthPixels = Math.max(0, x1 - x0 + 1);
  const heightPixels = Math.max(0, y1 - y0 + 1);
  return {
    imagePixelX0: x0,
    imagePixelY0: y0,
    imagePixelX1: x1,
    imagePixelY1: y1,
    samplePixelCount: widthPixels * heightPixels,
  };
}

function clampPixelIndex(value: number, length: number): number {
  if (length <= 0) return 0;
  const intValue = Math.round(value);
  if (intValue < 0) return 0;
  if (intValue > length - 1) return length - 1;
  return intValue;
}

function computeBandMeanOverRegion(
  band: RasterTypedArray,
  rasterWidth: number,
  region: ClampedRoiRegion,
): number {
  if (region.samplePixelCount === 0) return 0;
  let sum = 0;
  for (let y = region.imagePixelY0; y <= region.imagePixelY1; y++) {
    for (let x = region.imagePixelX0; x <= region.imagePixelX1; x++) {
      sum += readSampleAtIndexOrZero(band, y * rasterWidth + x);
    }
  }
  return sum / region.samplePixelCount;
}

function computeBandStandardDeviationOverRegion(
  band: RasterTypedArray,
  rasterWidth: number,
  region: ClampedRoiRegion,
  bandMean: number,
): number {
  if (region.samplePixelCount === 0) return 0;
  let sumSquaredDiff = 0;
  for (let y = region.imagePixelY0; y <= region.imagePixelY1; y++) {
    for (let x = region.imagePixelX0; x <= region.imagePixelX1; x++) {
      const value = readSampleAtIndexOrZero(band, y * rasterWidth + x);
      const diff = value - bandMean;
      sumSquaredDiff += diff * diff;
    }
  }
  return Math.sqrt(sumSquaredDiff / region.samplePixelCount);
}

export function computeSpectrumValueAtBandIndexFromRaster(
  raster: RasterImage,
  imageX: number,
  imageY: number,
  bandIndex: number,
): number | null {
  if (!isImagePointInsideRaster(imageX, imageY, raster.width, raster.height)) return null;
  const band = getRasterBandPixelsOrThrow(raster, bandIndex);
  return readSampleAtIndexOrZero(band, imageY * raster.width + imageX);
}
