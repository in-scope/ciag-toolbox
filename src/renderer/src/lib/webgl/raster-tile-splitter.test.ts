import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import {
  DEFAULT_RASTER_TILE_SIZE,
  splitRasterIntoTiles,
} from "@/lib/webgl/raster-tile-splitter";

describe("splitRasterIntoTiles", () => {
  it("returns one tile that mirrors the source when the raster fits inside the cap", () => {
    const raster = buildSequentialUint16Raster(4, 3);
    const tiles = splitRasterIntoTiles(raster, 8);
    expect(tiles.length).toBe(1);
    const only = tiles[0]!;
    expect(only.x).toBe(0);
    expect(only.y).toBe(0);
    expect(only.width).toBe(4);
    expect(only.height).toBe(3);
    expect(Array.from(only.pixels)).toEqual(Array.from(raster.pixels));
  });

  it("partitions the source into row-major tiles capped at the requested tile size", () => {
    const raster = buildSequentialUint16Raster(5, 3);
    const tiles = splitRasterIntoTiles(raster, 2);
    expect(tiles.map((tile) => `${tile.x},${tile.y}:${tile.width}x${tile.height}`)).toEqual([
      "0,0:2x2",
      "2,0:2x2",
      "4,0:1x2",
      "0,2:2x1",
      "2,2:2x1",
      "4,2:1x1",
    ]);
  });

  it("copies a contiguous row-major slice of the source pixels for each tile", () => {
    const raster = buildSequentialUint16Raster(5, 3);
    const tiles = splitRasterIntoTiles(raster, 2);
    const middleTopRowTile = tiles[1]!;
    expect(Array.from(middleTopRowTile.pixels)).toEqual([2, 3, 7, 8]);
    const cornerTile = tiles[5]!;
    expect(Array.from(cornerTile.pixels)).toEqual([14]);
  });

  it("produces an independent typed array per tile, not a view into the source", () => {
    const raster = buildSequentialUint16Raster(2, 2);
    const tiles = splitRasterIntoTiles(raster, 1);
    (tiles[0]!.pixels as Uint16Array)[0] = 9999;
    expect(raster.pixels[0]).toBe(0);
  });

  it("preserves the source typed array constructor for each tile", () => {
    const raster = buildSequentialUint16Raster(4, 1);
    const tiles = splitRasterIntoTiles(raster, 2);
    for (const tile of tiles) {
      expect(tile.pixels).toBeInstanceOf(Uint16Array);
    }
  });

  it("defaults the cap to 2048", () => {
    expect(DEFAULT_RASTER_TILE_SIZE).toBe(2048);
  });
});

function buildSequentialUint16Raster(width: number, height: number): RasterImage {
  const pixels = new Uint16Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = i;
  return {
    pixels,
    width,
    height,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 1,
  };
}
