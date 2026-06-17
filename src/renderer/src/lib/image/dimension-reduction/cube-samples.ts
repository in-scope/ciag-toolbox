import { getRasterBandPixelsOrThrow, type RasterImage } from "@/lib/image/raster-image";

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
