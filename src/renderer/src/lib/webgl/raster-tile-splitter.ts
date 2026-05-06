import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";

export const DEFAULT_RASTER_TILE_SIZE = 2048;

export interface RasterTile {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: RasterTypedArray;
}

export function splitRasterIntoTiles(
  raster: RasterImage,
  maxTileSize: number = DEFAULT_RASTER_TILE_SIZE,
): readonly RasterTile[] {
  const columnCount = countTilesAcrossDimension(raster.width, maxTileSize);
  const rowCount = countTilesAcrossDimension(raster.height, maxTileSize);
  return collectTilesAcrossRowsAndColumns(raster, rowCount, columnCount, maxTileSize);
}

function collectTilesAcrossRowsAndColumns(
  raster: RasterImage,
  rowCount: number,
  columnCount: number,
  maxTileSize: number,
): RasterTile[] {
  const tiles: RasterTile[] = [];
  for (let row = 0; row < rowCount; row++) {
    for (let column = 0; column < columnCount; column++) {
      tiles.push(buildRasterTileAtRowAndColumn(raster, row, column, maxTileSize));
    }
  }
  return tiles;
}

function countTilesAcrossDimension(size: number, maxTileSize: number): number {
  if (size <= 0) return 0;
  return Math.ceil(size / maxTileSize);
}

function buildRasterTileAtRowAndColumn(
  raster: RasterImage,
  row: number,
  column: number,
  maxTileSize: number,
): RasterTile {
  const x = column * maxTileSize;
  const y = row * maxTileSize;
  const width = Math.min(maxTileSize, raster.width - x);
  const height = Math.min(maxTileSize, raster.height - y);
  const pixels = copyRectangleFromRasterPixels(raster, x, y, width, height);
  return { x, y, width, height, pixels };
}

function copyRectangleFromRasterPixels(
  raster: RasterImage,
  x: number,
  y: number,
  width: number,
  height: number,
): RasterTypedArray {
  const tilePixels = allocateMatchingTypedArray(raster.pixels, width * height);
  for (let rowOffset = 0; rowOffset < height; rowOffset++) {
    copyOneSourceRowIntoTilePixels(raster, x, y + rowOffset, width, tilePixels, rowOffset * width);
  }
  return tilePixels;
}

function copyOneSourceRowIntoTilePixels(
  raster: RasterImage,
  startX: number,
  sourceY: number,
  width: number,
  tilePixels: RasterTypedArray,
  destinationOffset: number,
): void {
  const sourceStart = sourceY * raster.width + startX;
  const sourceRow = raster.pixels.subarray(sourceStart, sourceStart + width);
  tilePixels.set(sourceRow as never, destinationOffset);
}

function allocateMatchingTypedArray(
  template: RasterTypedArray,
  length: number,
): RasterTypedArray {
  const Constructor = template.constructor as new (length: number) => RasterTypedArray;
  return new Constructor(length);
}
