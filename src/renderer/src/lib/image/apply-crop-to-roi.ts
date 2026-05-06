import {
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";
import {
  clampViewportRoiToImageBounds,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";

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

export function readCropRectangleFromRoiClampedToRaster(
  raster: RasterImage,
  roi: ViewportRoi,
): CropRectangleInPixels {
  const clamped = clampViewportRoiToImageBounds(roi, {
    width: raster.width,
    height: raster.height,
  });
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
  const Constructor = band.constructor as new (length: number) => RasterTypedArray;
  return new Constructor(length);
}
