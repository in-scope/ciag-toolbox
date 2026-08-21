import { describe, expect, it } from "vitest";

import {
  areViewportRoisIdentical,
  classifyRoiBoxHitAtCanvasPoint,
  convertCanvasDeltaToImagePixelDelta,
  cursorStyleForRoiBoxHit,
  moveViewportRoiByPixelOffsetClampedToImage,
  oppositeRoiBoxCorner,
  resizeViewportRoiByDraggingCornerClampedToImage,
  type RoiBoxCanvasRectangle,
} from "./roi-box-editing";
import type { ViewportRoi } from "./viewport-roi";

const IMAGE = { width: 10, height: 8 };

const BOX: ViewportRoi = {
  imagePixelX0: 2,
  imagePixelY0: 3,
  imagePixelX1: 5,
  imagePixelY1: 6,
};

describe("moveViewportRoiByPixelOffsetClampedToImage", () => {
  it("moves the whole box by the offset at fixed size", () => {
    const moved = moveViewportRoiByPixelOffsetClampedToImage(BOX, 2, -1, IMAGE);
    expect(moved).toEqual({
      imagePixelX0: 4,
      imagePixelY0: 2,
      imagePixelX1: 7,
      imagePixelY1: 5,
    });
  });

  it("clamps a drag past the right and bottom edges to the boundary, keeping the size", () => {
    const moved = moveViewportRoiByPixelOffsetClampedToImage(BOX, 100, 100, IMAGE);
    expect(moved).toEqual({
      imagePixelX0: 6,
      imagePixelY0: 4,
      imagePixelX1: 9,
      imagePixelY1: 7,
    });
  });

  it("clamps a drag past the left and top edges to the boundary, keeping the size", () => {
    const moved = moveViewportRoiByPixelOffsetClampedToImage(BOX, -100, -100, IMAGE);
    expect(moved).toEqual({
      imagePixelX0: 0,
      imagePixelY0: 0,
      imagePixelX1: 3,
      imagePixelY1: 3,
    });
  });

  it("rounds fractional offsets to whole pixels", () => {
    const moved = moveViewportRoiByPixelOffsetClampedToImage(BOX, 1.4, 0.6, IMAGE);
    expect(moved.imagePixelX0).toBe(3);
    expect(moved.imagePixelY0).toBe(4);
  });

  it("canonicalizes a swapped-corner input before moving", () => {
    const swapped: ViewportRoi = {
      imagePixelX0: 5,
      imagePixelY0: 6,
      imagePixelX1: 2,
      imagePixelY1: 3,
    };
    expect(moveViewportRoiByPixelOffsetClampedToImage(swapped, 1, 0, IMAGE)).toEqual(
      moveViewportRoiByPixelOffsetClampedToImage(BOX, 1, 0, IMAGE),
    );
  });
});

describe("resizeViewportRoiByDraggingCornerClampedToImage", () => {
  it("resizes by the top-left corner, anchoring the bottom-right", () => {
    const resized = resizeViewportRoiByDraggingCornerClampedToImage(BOX, "topLeft", -1, -2, IMAGE);
    expect(resized).toEqual({
      imagePixelX0: 1,
      imagePixelY0: 1,
      imagePixelX1: 5,
      imagePixelY1: 6,
    });
  });

  it("resizes by the top-right corner, anchoring the bottom-left", () => {
    const resized = resizeViewportRoiByDraggingCornerClampedToImage(BOX, "topRight", 2, -1, IMAGE);
    expect(resized).toEqual({
      imagePixelX0: 2,
      imagePixelY0: 2,
      imagePixelX1: 7,
      imagePixelY1: 6,
    });
  });

  it("resizes by the bottom-left corner, anchoring the top-right", () => {
    const resized = resizeViewportRoiByDraggingCornerClampedToImage(BOX, "bottomLeft", -2, 1, IMAGE);
    expect(resized).toEqual({
      imagePixelX0: 0,
      imagePixelY0: 3,
      imagePixelX1: 5,
      imagePixelY1: 7,
    });
  });

  it("resizes by the bottom-right corner, anchoring the top-left", () => {
    const resized = resizeViewportRoiByDraggingCornerClampedToImage(BOX, "bottomRight", 3, 1, IMAGE);
    expect(resized).toEqual({
      imagePixelX0: 2,
      imagePixelY0: 3,
      imagePixelX1: 8,
      imagePixelY1: 7,
    });
  });

  it("clamps a corner dragged past the image edge to the boundary instead of clearing", () => {
    const resized = resizeViewportRoiByDraggingCornerClampedToImage(
      BOX,
      "bottomRight",
      1000,
      1000,
      IMAGE,
    );
    expect(resized).toEqual({
      imagePixelX0: 2,
      imagePixelY0: 3,
      imagePixelX1: 9,
      imagePixelY1: 7,
    });
  });

  it("never shrinks below 1x1: a corner dragged onto its anchor spans one pixel", () => {
    const resized = resizeViewportRoiByDraggingCornerClampedToImage(BOX, "bottomRight", -3, -3, IMAGE);
    expect(resized).toEqual({
      imagePixelX0: 2,
      imagePixelY0: 3,
      imagePixelX1: 2,
      imagePixelY1: 3,
    });
  });

  it("flips across the anchor into a canonical box when dragged past it", () => {
    const resized = resizeViewportRoiByDraggingCornerClampedToImage(BOX, "bottomRight", -5, -5, IMAGE);
    expect(resized).toEqual({
      imagePixelX0: 0,
      imagePixelY0: 1,
      imagePixelX1: 2,
      imagePixelY1: 3,
    });
  });
});

describe("oppositeRoiBoxCorner", () => {
  it("pairs each corner with its diagonal opposite", () => {
    expect(oppositeRoiBoxCorner("topLeft")).toBe("bottomRight");
    expect(oppositeRoiBoxCorner("topRight")).toBe("bottomLeft");
    expect(oppositeRoiBoxCorner("bottomLeft")).toBe("topRight");
    expect(oppositeRoiBoxCorner("bottomRight")).toBe("topLeft");
  });
});

describe("classifyRoiBoxHitAtCanvasPoint", () => {
  const RECT: RoiBoxCanvasRectangle = { leftPx: 100, topPx: 50, widthPx: 80, heightPx: 40 };

  it("reports a corner within the hit radius", () => {
    expect(classifyRoiBoxHitAtCanvasPoint(103, 53, RECT, 6)).toEqual({
      kind: "corner",
      corner: "topLeft",
    });
    expect(classifyRoiBoxHitAtCanvasPoint(178, 92, RECT, 6)).toEqual({
      kind: "corner",
      corner: "bottomRight",
    });
  });

  it("prefers the corner over the interior when the point is near a corner", () => {
    expect(classifyRoiBoxHitAtCanvasPoint(105, 55, RECT, 6).kind).toBe("corner");
  });

  it("reports inside for a point within the rectangle body", () => {
    expect(classifyRoiBoxHitAtCanvasPoint(140, 70, RECT, 6)).toEqual({ kind: "inside" });
  });

  it("reports outside for a point beyond the rectangle and its handles", () => {
    expect(classifyRoiBoxHitAtCanvasPoint(10, 10, RECT, 6)).toEqual({ kind: "outside" });
    expect(classifyRoiBoxHitAtCanvasPoint(190, 100, RECT, 6)).toEqual({ kind: "outside" });
  });
});

describe("cursorStyleForRoiBoxHit", () => {
  it("uses diagonal resize cursors on corners, move inside, and none outside", () => {
    expect(cursorStyleForRoiBoxHit({ kind: "corner", corner: "topLeft" })).toBe("nwse-resize");
    expect(cursorStyleForRoiBoxHit({ kind: "corner", corner: "bottomRight" })).toBe("nwse-resize");
    expect(cursorStyleForRoiBoxHit({ kind: "corner", corner: "topRight" })).toBe("nesw-resize");
    expect(cursorStyleForRoiBoxHit({ kind: "corner", corner: "bottomLeft" })).toBe("nesw-resize");
    expect(cursorStyleForRoiBoxHit({ kind: "inside" })).toBe("move");
    expect(cursorStyleForRoiBoxHit({ kind: "outside" })).toBe("");
  });
});

describe("convertCanvasDeltaToImagePixelDelta", () => {
  it("divides the canvas delta by the per-pixel scale", () => {
    const delta = convertCanvasDeltaToImagePixelDelta(50, -25, {
      canvasPxPerImagePixelX: 10,
      canvasPxPerImagePixelY: 5,
    });
    expect(delta).toEqual({ offsetXPixels: 5, offsetYPixels: -5 });
  });

  it("returns zero offsets for a degenerate scale", () => {
    const delta = convertCanvasDeltaToImagePixelDelta(50, 50, {
      canvasPxPerImagePixelX: 0,
      canvasPxPerImagePixelY: Number.NaN,
    });
    expect(delta).toEqual({ offsetXPixels: 0, offsetYPixels: 0 });
  });
});

describe("areViewportRoisIdentical", () => {
  it("treats swapped-corner boxes covering the same pixels as identical", () => {
    const swapped: ViewportRoi = {
      imagePixelX0: 5,
      imagePixelY0: 6,
      imagePixelX1: 2,
      imagePixelY1: 3,
    };
    expect(areViewportRoisIdentical(BOX, swapped)).toBe(true);
  });

  it("reports boxes covering different pixels as different", () => {
    expect(areViewportRoisIdentical(BOX, { ...BOX, imagePixelX1: 6 })).toBe(false);
  });
});
