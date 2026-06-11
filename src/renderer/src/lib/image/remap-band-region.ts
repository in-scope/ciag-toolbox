import {
  getRasterBandPixelsOrThrow,
  type RasterImage,
  type RasterTypedArray,
} from "@/lib/image/raster-image";
import {
  clampViewportRoiToImageBounds,
  type ViewportRoi,
} from "@/lib/image/viewport-roi";

export interface RegionRemapOptions {
  readonly region?: ViewportRoi;
}

interface PixelRectangle {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function remapRasterBandWithinRegion(
  raster: RasterImage,
  bandIndex: number,
  options: RegionRemapOptions,
  mapValue: (value: number) => number,
): RasterImage {
  const band = getRasterBandPixelsOrThrow(raster, bandIndex);
  const region = readRegionRectangleIfPresent(raster, options.region);
  const remappedBand = remapBandValuesWithinRegion(band, raster.width, region, mapValue);
  return { ...raster, bandPixels: replaceBandPixelsAtIndex(raster.bandPixels, bandIndex, remappedBand) };
}

function readRegionRectangleIfPresent(
  raster: RasterImage,
  region: ViewportRoi | undefined,
): PixelRectangle | null {
  if (!region) return null;
  return readPixelRectangleFromRoiClampedToRaster(raster, region);
}

function remapBandValuesWithinRegion(
  band: RasterTypedArray,
  rasterWidth: number,
  region: PixelRectangle | null,
  mapValue: (value: number) => number,
): RasterTypedArray {
  const remapped = copyBandPixels(band);
  for (const pixelIndex of listPixelIndexesInRegionOrWholeBand(band.length, rasterWidth, region)) {
    remapped[pixelIndex] = mapValue(band[pixelIndex] ?? 0);
  }
  return remapped;
}

function replaceBandPixelsAtIndex(
  bands: ReadonlyArray<RasterTypedArray>,
  bandIndex: number,
  replacement: RasterTypedArray,
): ReadonlyArray<RasterTypedArray> {
  return bands.map((band, index) => (index === bandIndex ? replacement : band));
}

function copyBandPixels(band: RasterTypedArray): RasterTypedArray {
  const Constructor = band.constructor as new (length: number) => RasterTypedArray;
  const copy = new Constructor(band.length);
  copy.set(band as never);
  return copy;
}

function readPixelRectangleFromRoiClampedToRaster(
  raster: RasterImage,
  roi: ViewportRoi,
): PixelRectangle {
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

function* listPixelIndexesInRegionOrWholeBand(
  bandLength: number,
  rasterWidth: number,
  region: PixelRectangle | null,
): IterableIterator<number> {
  if (!region) {
    for (let pixelIndex = 0; pixelIndex < bandLength; pixelIndex += 1) yield pixelIndex;
    return;
  }
  for (let row = region.y0; row <= region.y1; row += 1) {
    const rowStart = row * rasterWidth;
    for (let column = region.x0; column <= region.x1; column += 1) yield rowStart + column;
  }
}
