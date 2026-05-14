import { describe, expect, it } from "vitest";

import {
  composeTileQuadTransform,
  type QuadTransform,
  type TileImageRect,
} from "@/lib/webgl/tile-quad-transform";

describe("composeTileQuadTransform", () => {
  const identityGlobalTransform: QuadTransform = {
    scale: { x: 1, y: 1 },
    translate: { x: 0, y: 0 },
  };

  it("returns a single full-image tile that matches the global transform", () => {
    const tile: TileImageRect = { imageSpaceX: 0, imageSpaceY: 0, width: 100, height: 100 };
    const composed = composeTileQuadTransform(identityGlobalTransform, tile, {
      width: 100,
      height: 100,
    });
    expect(composed.scale).toEqual({ x: 1, y: 1 });
    expect(composed.translate).toEqual({ x: 0, y: 0 });
  });

  it("places a top-left quarter tile in the top-left of clip space", () => {
    const tile: TileImageRect = { imageSpaceX: 0, imageSpaceY: 0, width: 50, height: 50 };
    const composed = composeTileQuadTransform(identityGlobalTransform, tile, {
      width: 100,
      height: 100,
    });
    expect(composed.scale).toEqual({ x: 0.5, y: 0.5 });
    expect(composed.translate).toEqual({ x: -0.5, y: 0.5 });
  });

  it("places a bottom-right quarter tile in the bottom-right of clip space", () => {
    const tile: TileImageRect = { imageSpaceX: 50, imageSpaceY: 50, width: 50, height: 50 };
    const composed = composeTileQuadTransform(identityGlobalTransform, tile, {
      width: 100,
      height: 100,
    });
    expect(composed.scale).toEqual({ x: 0.5, y: 0.5 });
    expect(composed.translate).toEqual({ x: 0.5, y: -0.5 });
  });

  it("scales and translates the tile through the global transform", () => {
    const global: QuadTransform = {
      scale: { x: 2, y: 0.5 },
      translate: { x: 0.1, y: -0.2 },
    };
    const tile: TileImageRect = { imageSpaceX: 0, imageSpaceY: 0, width: 50, height: 50 };
    const composed = composeTileQuadTransform(global, tile, { width: 100, height: 100 });
    expect(composed.scale.x).toBeCloseTo(1, 6);
    expect(composed.scale.y).toBeCloseTo(0.25, 6);
    expect(composed.translate.x).toBeCloseTo(2 * -0.5 + 0.1, 6);
    expect(composed.translate.y).toBeCloseTo(0.5 * 0.5 - 0.2, 6);
  });

  it("falls back to an identity local transform when image size has zero area", () => {
    const tile: TileImageRect = { imageSpaceX: 0, imageSpaceY: 0, width: 50, height: 50 };
    const composed = composeTileQuadTransform(identityGlobalTransform, tile, {
      width: 0,
      height: 100,
    });
    expect(composed).toEqual(identityGlobalTransform);
  });
});
