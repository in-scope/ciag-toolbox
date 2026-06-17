import { getRasterBandPixelsOrThrow, type RasterImage } from "@/lib/image/raster-image";
import {
  clampViewportRoiToImageBounds,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";

// CT-180: dimension-reduction math works on a cube as a band-major sample
// matrix: one Float64Array per band, each holding the value of that band at
// every selected sample (pixel). Band-major matches the per-band covariance and
// projection loops, and matches the raster's own band-pixel layout so the
// whole-image case is a straight copy. CT-182 adds an ROI variant that fills the
// same shape from a pixel subset, so the transform math never branches on scope.

export interface CubeSampleMatrix {
  readonly bandCount: number;
  readonly sampleCount: number;
  readonly bandValues: ReadonlyArray<Float64Array>;
}

export function extractCubeSampleMatrixFromRaster(raster: RasterImage): CubeSampleMatrix {
  const sampleCount = raster.width * raster.height;
  const bandValues = collectEveryBandAsFloat64(raster, sampleCount);
  return { bandCount: raster.bandCount, sampleCount, bandValues };
}

function collectEveryBandAsFloat64(raster: RasterImage, sampleCount: number): Float64Array[] {
  return Array.from({ length: raster.bandCount }, (_, bandIndex) =>
    copyBandPixelsToFloat64(getRasterBandPixelsOrThrow(raster, bandIndex), sampleCount),
  );
}

function copyBandPixelsToFloat64(
  bandPixels: ArrayLike<number>,
  sampleCount: number,
): Float64Array {
  const values = new Float64Array(sampleCount);
  for (let pixelIndex = 0; pixelIndex < sampleCount; pixelIndex += 1) {
    values[pixelIndex] = bandPixels[pixelIndex] ?? 0;
  }
  return values;
}

// CT-182: a transform may be FIT on only the pixels inside a selected ROI (a
// clean background or a target material) and then APPLIED to the whole cube. The
// fit consumes this in-ROI sample matrix; the apply step keeps using the full
// extractCubeSampleMatrixFromRaster. The returned shape is identical, so the
// fit/project math never branches on scope.
export function collectRoiSamples(raster: RasterImage, roi: ViewportRoi): CubeSampleMatrix {
  const bounds = clampViewportRoiToImageBounds(roi, raster);
  const pixelIndexes = listRoiPixelIndexes(bounds, raster.width);
  const bandValues = collectBandsAtPixelIndexes(raster, pixelIndexes);
  return { bandCount: raster.bandCount, sampleCount: pixelIndexes.length, bandValues };
}

function listRoiPixelIndexes(bounds: ViewportRoi, width: number): number[] {
  const pixelIndexes: number[] = [];
  for (let y = bounds.imagePixelY0; y <= bounds.imagePixelY1; y += 1) {
    for (let x = bounds.imagePixelX0; x <= bounds.imagePixelX1; x += 1) {
      pixelIndexes.push(y * width + x);
    }
  }
  return pixelIndexes;
}

function collectBandsAtPixelIndexes(
  raster: RasterImage,
  pixelIndexes: ReadonlyArray<number>,
): Float64Array[] {
  return Array.from({ length: raster.bandCount }, (_, bandIndex) =>
    copyPixelsAtIndexesToFloat64(getRasterBandPixelsOrThrow(raster, bandIndex), pixelIndexes),
  );
}

function copyPixelsAtIndexesToFloat64(
  bandPixels: ArrayLike<number>,
  pixelIndexes: ReadonlyArray<number>,
): Float64Array {
  const values = new Float64Array(pixelIndexes.length);
  for (let i = 0; i < pixelIndexes.length; i += 1) {
    values[i] = bandPixels[pixelIndexes[i]!] ?? 0;
  }
  return values;
}
