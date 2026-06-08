import { describe, expect, it } from "vitest";

import {
  listFourCornerCenters,
  type CanvasRectangle,
} from "./viewport-roi-overlay";

describe("listFourCornerCenters", () => {
  it("returns four corners at the rectangle's extents", () => {
    const corners = listFourCornerCenters(buildRectangle(10, 20, 30, 40));
    expect(corners).toEqual([
      { position: "topLeft", x: 10, y: 20 },
      { position: "topRight", x: 40, y: 20 },
      { position: "bottomLeft", x: 10, y: 60 },
      { position: "bottomRight", x: 40, y: 60 },
    ]);
  });

  it("gives every corner a unique key for a normal rectangle", () => {
    expectFourUniqueCornerKeys(buildRectangle(10, 20, 30, 40));
  });

  // CT-060 regression: while dragging, the rect passes through degenerate shapes
  // (zero width, zero height, or a single point). Coordinate-based keys collided
  // there, causing React to strand stale handle nodes as stray points on the canvas.
  it("gives every corner a unique key for a zero-size point rectangle", () => {
    expectFourUniqueCornerKeys(buildRectangle(50, 50, 0, 0));
  });

  it("gives every corner a unique key for a zero-width rectangle", () => {
    expectFourUniqueCornerKeys(buildRectangle(50, 10, 0, 40));
  });

  it("gives every corner a unique key for a zero-height rectangle", () => {
    expectFourUniqueCornerKeys(buildRectangle(10, 50, 40, 0));
  });
});

function expectFourUniqueCornerKeys(rectangle: CanvasRectangle): void {
  const keys = listFourCornerCenters(rectangle).map((corner) => corner.position);
  expect(new Set(keys).size).toBe(4);
}

function buildRectangle(
  leftPx: number,
  topPx: number,
  widthPx: number,
  heightPx: number,
): CanvasRectangle {
  return { leftPx, topPx, widthPx, heightPx };
}
