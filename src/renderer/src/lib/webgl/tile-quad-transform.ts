import type { ClipPoint, ViewportSize } from "@/lib/webgl/view-transform";

export interface QuadTransform {
  readonly scale: ClipPoint;
  readonly translate: ClipPoint;
}

export interface TileImageRect {
  readonly imageSpaceX: number;
  readonly imageSpaceY: number;
  readonly width: number;
  readonly height: number;
}

export function composeTileQuadTransform(
  globalTransform: QuadTransform,
  tile: TileImageRect,
  imageSize: ViewportSize,
): QuadTransform {
  const tileLocal = computeTileLocalQuadTransform(tile, imageSize);
  return {
    scale: {
      x: globalTransform.scale.x * tileLocal.scale.x,
      y: globalTransform.scale.y * tileLocal.scale.y,
    },
    translate: {
      x: globalTransform.scale.x * tileLocal.translate.x + globalTransform.translate.x,
      y: globalTransform.scale.y * tileLocal.translate.y + globalTransform.translate.y,
    },
  };
}

function computeTileLocalQuadTransform(
  tile: TileImageRect,
  imageSize: ViewportSize,
): QuadTransform {
  if (imageSize.width <= 0 || imageSize.height <= 0) {
    return { scale: { x: 1, y: 1 }, translate: { x: 0, y: 0 } };
  }
  return {
    scale: {
      x: tile.width / imageSize.width,
      y: tile.height / imageSize.height,
    },
    translate: {
      x: -1 + (2 * tile.imageSpaceX + tile.width) / imageSize.width,
      y: 1 - (2 * tile.imageSpaceY + tile.height) / imageSize.height,
    },
  };
}
