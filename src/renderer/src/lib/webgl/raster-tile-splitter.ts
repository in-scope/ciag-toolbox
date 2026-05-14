import type { RasterTypedArray } from "@/lib/image/raster-image";

export const DEFAULT_RASTER_TILE_SIZE = 2048;

export interface RasterTile {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: RasterTypedArray;
}

export interface RasterBandPixelGrid {
  readonly pixels: RasterTypedArray;
  readonly width: number;
  readonly height: number;
}

export function splitRasterBandIntoTiles(
  band: RasterBandPixelGrid,
  maxTileSize: number = DEFAULT_RASTER_TILE_SIZE,
): readonly RasterTile[] {
  const columnCount = countTilesAcrossDimension(band.width, maxTileSize);
  const rowCount = countTilesAcrossDimension(band.height, maxTileSize);
  return collectTilesAcrossRowsAndColumns(band, rowCount, columnCount, maxTileSize);
}

function collectTilesAcrossRowsAndColumns(
  band: RasterBandPixelGrid,
  rowCount: number,
  columnCount: number,
  maxTileSize: number,
): RasterTile[] {
  const tiles: RasterTile[] = [];
  for (let row = 0; row < rowCount; row++) {
    for (let column = 0; column < columnCount; column++) {
      tiles.push(buildRasterTileAtRowAndColumn(band, row, column, maxTileSize));
    }
  }
  return tiles;
}

function countTilesAcrossDimension(size: number, maxTileSize: number): number {
  if (size <= 0) return 0;
  return Math.ceil(size / maxTileSize);
}

function buildRasterTileAtRowAndColumn(
  band: RasterBandPixelGrid,
  row: number,
  column: number,
  maxTileSize: number,
): RasterTile {
  const x = column * maxTileSize;
  const y = row * maxTileSize;
  const width = Math.min(maxTileSize, band.width - x);
  const height = Math.min(maxTileSize, band.height - y);
  const pixels = copyRectangleFromBandPixels(band, x, y, width, height);
  return { x, y, width, height, pixels };
}

function copyRectangleFromBandPixels(
  band: RasterBandPixelGrid,
  x: number,
  y: number,
  width: number,
  height: number,
): RasterTypedArray {
  const tilePixels = allocateMatchingTypedArray(band.pixels, width * height);
  for (let rowOffset = 0; rowOffset < height; rowOffset++) {
    copyOneSourceRowIntoTilePixels(band, x, y + rowOffset, width, tilePixels, rowOffset * width);
  }
  return tilePixels;
}

function copyOneSourceRowIntoTilePixels(
  band: RasterBandPixelGrid,
  startX: number,
  sourceY: number,
  width: number,
  tilePixels: RasterTypedArray,
  destinationOffset: number,
): void {
  const sourceStart = sourceY * band.width + startX;
  const sourceRow = band.pixels.subarray(sourceStart, sourceStart + width);
  tilePixels.set(sourceRow as never, destinationOffset);
}

function allocateMatchingTypedArray(
  template: RasterTypedArray,
  length: number,
): RasterTypedArray {
  const Constructor = template.constructor as new (length: number) => RasterTypedArray;
  return new Constructor(length);
}
