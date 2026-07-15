import { allocateTypedArrayLikeBandOrThrow } from "@/lib/image/raster-allocation";
import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";
import {
  clampViewportRoiToImageBounds,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";

// CT-180: dimension-reduction math works on a cube as a band-major sample
// matrix: one value array per band, each holding the value of that band at
// every selected sample (pixel). Band-major matches the per-band covariance and
// projection loops, and matches the raster's own band-pixel layout so the
// whole-image case is a straight reference. CT-182 adds an ROI variant that
// fills the same shape from a pixel subset, so the transform math never
// branches on scope. CT-183: the samples are laid out row-major over a
// width x height rectangle (the whole image, or the ROI rectangle), so a
// transform that needs spatial adjacency (MNF's shift-difference noise
// estimate) can walk neighbours.
//
// CT-240: the whole-image matrix ALIASES the raster's own band arrays instead
// of copying them to float64. A float64 copy of a 100-band 10 GB cube is 40 GB
// and can never fit the measured ~17 GB renderer ArrayBuffer pool; reading a
// sample from the original typed array yields the exact same float64 value the
// copy held (every raster sample type widens to float64 exactly), so the fit
// and projection numbers are bit-identical with zero cube-scale allocation.
// The fit/project math is READ-ONLY over bandValues - the arrays belong to the
// live source raster (the CT-233 immutability contract).

export interface CubeSampleMatrix {
  readonly bandCount: number;
  readonly sampleCount: number;
  readonly width: number;
  readonly height: number;
  readonly bandValues: ReadonlyArray<RasterTypedArray>;
}

export function extractCubeSampleMatrixFromRaster(raster: RasterImage): CubeSampleMatrix {
  return {
    bandCount: raster.bandCount,
    sampleCount: raster.width * raster.height,
    width: raster.width,
    height: raster.height,
    bandValues: listEveryBandByReference(raster),
  };
}

function listEveryBandByReference(raster: RasterImage): RasterTypedArray[] {
  return Array.from({ length: raster.bandCount }, (_, bandIndex) =>
    getRasterBandPixelsOrThrow(raster, bandIndex),
  );
}

// CT-182: a transform may be FIT on only the pixels inside a selected ROI (a
// clean background or a target material) and then APPLIED to the whole cube. The
// fit consumes this in-ROI sample matrix; the apply step keeps using the full
// extractCubeSampleMatrixFromRaster. The returned shape is identical, so the
// fit/project math never branches on scope. The ROI copy keeps each band's own
// sample type (values read identically) and routes through the mapped allocator.
export function collectRoiSamples(raster: RasterImage, roi: ViewportRoi): CubeSampleMatrix {
  const bounds = clampViewportRoiToImageBounds(roi, raster);
  const pixelIndexes = listRoiPixelIndexes(bounds, raster.width);
  const bandValues = collectBandsAtPixelIndexes(raster, pixelIndexes);
  const width = bounds.imagePixelX1 - bounds.imagePixelX0 + 1;
  const height = bounds.imagePixelY1 - bounds.imagePixelY0 + 1;
  return { bandCount: raster.bandCount, sampleCount: pixelIndexes.length, width, height, bandValues };
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
): RasterTypedArray[] {
  return Array.from({ length: raster.bandCount }, (_, bandIndex) =>
    copyPixelsAtIndexesKeepingSampleType(getRasterBandPixelsOrThrow(raster, bandIndex), pixelIndexes),
  );
}

function copyPixelsAtIndexesKeepingSampleType(
  bandPixels: RasterTypedArray,
  pixelIndexes: ReadonlyArray<number>,
): RasterTypedArray {
  const values = allocateTypedArrayLikeBandOrThrow(bandPixels, pixelIndexes.length);
  for (let i = 0; i < pixelIndexes.length; i += 1) {
    values[i] = bandPixels[pixelIndexes[i]!] ?? 0;
  }
  return values;
}
