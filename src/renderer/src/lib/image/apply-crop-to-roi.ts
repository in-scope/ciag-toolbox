import { allocateTypedArrayLikeBandOrThrow } from "@/lib/image/raster-allocation";
import {
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";
import {
  clampViewportRoiToImageBounds,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";
import {
  computeArrayReportingPerUnitProgress,
  type UnitProgressCallback,
} from "@/lib/image/unit-progress";

export interface CropRectangleInPixels {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function applyCropToRasterImage(
  raster: RasterImage,
  roi: ViewportRoi,
): RasterImage {
  const cropRect = readCropRectangleFromRoiClampedToRaster(raster, roi);
  validateCropRectangleHasPositiveArea(cropRect);
  const cropWidth = cropRect.x1 - cropRect.x0 + 1;
  const cropHeight = cropRect.y1 - cropRect.y0 + 1;
  const croppedBandPixels = raster.bandPixels.map((band) =>
    cropBandPixelsToRectangle(band, raster.width, cropRect, cropWidth, cropHeight),
  );
  return {
    ...raster,
    bandPixels: croppedBandPixels,
    width: cropWidth,
    height: cropHeight,
  };
}

// CT-222: the async twin of applyCropToRasterImage. Identical per-band math, one
// progress tick per band.
export async function applyCropToRasterImageReportingProgress(
  raster: RasterImage,
  roi: ViewportRoi,
  onProgress?: UnitProgressCallback,
): Promise<RasterImage> {
  const cropRect = readCropRectangleFromRoiClampedToRaster(raster, roi);
  validateCropRectangleHasPositiveArea(cropRect);
  const cropWidth = cropRect.x1 - cropRect.x0 + 1;
  const cropHeight = cropRect.y1 - cropRect.y0 + 1;
  const croppedBandPixels = await computeArrayReportingPerUnitProgress(
    raster.bandPixels.length,
    (index) => cropBandPixelsToRectangle(raster.bandPixels[index]!, raster.width, cropRect, cropWidth, cropHeight),
    onProgress,
  );
  return { ...raster, bandPixels: croppedBandPixels, width: cropWidth, height: cropHeight };
}

export function readCropRectangleFromRoiClampedToRaster(
  raster: RasterImage,
  roi: ViewportRoi,
): CropRectangleInPixels {
  return readCropRectangleFromRoiClampedToPlane(raster.width, raster.height, roi);
}

// A single width x height plane (a mask layer's values) cropped by the same
// row-slicing math as a raster band, so masks crop exactly like the pixels
// they annotate. Corners are inclusive, matching the raster crop.
export interface CroppedPlane<T extends RasterTypedArray> {
  readonly values: T;
  readonly width: number;
  readonly height: number;
}

export function cropPlaneToRoi<T extends RasterTypedArray>(
  values: T,
  width: number,
  height: number,
  roi: ViewportRoi,
): CroppedPlane<T> {
  const cropRect = readCropRectangleFromRoiClampedToPlane(width, height, roi);
  validateCropRectangleHasPositiveArea(cropRect);
  const cropWidth = cropRect.x1 - cropRect.x0 + 1;
  const cropHeight = cropRect.y1 - cropRect.y0 + 1;
  return {
    values: cropBandPixelsToRectangle(values, width, cropRect, cropWidth, cropHeight) as T,
    width: cropWidth,
    height: cropHeight,
  };
}

function readCropRectangleFromRoiClampedToPlane(
  width: number,
  height: number,
  roi: ViewportRoi,
): CropRectangleInPixels {
  const clamped = clampViewportRoiToImageBounds(roi, { width, height });
  return {
    x0: clamped.imagePixelX0,
    y0: clamped.imagePixelY0,
    x1: clamped.imagePixelX1,
    y1: clamped.imagePixelY1,
  };
}

function validateCropRectangleHasPositiveArea(cropRect: CropRectangleInPixels): void {
  const cropWidth = cropRect.x1 - cropRect.x0 + 1;
  const cropHeight = cropRect.y1 - cropRect.y0 + 1;
  if (cropWidth < 1 || cropHeight < 1) {
    throw new Error("Crop region resolves to a zero-area rectangle.");
  }
}

function cropBandPixelsToRectangle(
  band: RasterTypedArray,
  sourceWidth: number,
  cropRect: CropRectangleInPixels,
  cropWidth: number,
  cropHeight: number,
): RasterTypedArray {
  const cropped = createEmptyTypedArrayMatchingBand(band, cropWidth * cropHeight);
  for (let row = 0; row < cropHeight; row += 1) {
    const sourceRowStart = (cropRect.y0 + row) * sourceWidth + cropRect.x0;
    const sourceRowEnd = sourceRowStart + cropWidth;
    const sourceSlice = band.subarray(sourceRowStart, sourceRowEnd);
    cropped.set(sourceSlice as never, row * cropWidth);
  }
  return cropped;
}

function createEmptyTypedArrayMatchingBand(
  band: RasterTypedArray,
  length: number,
): RasterTypedArray {
  return allocateTypedArrayLikeBandOrThrow(band, length);
}
