import { describe, expect, it } from "vitest";

import {
  canonicalizeViewportRoiCorners,
  clampViewportRoiToImageBounds,
  computeViewportRoiHeightInPixels,
  computeViewportRoiWidthInPixels,
  formatViewportRoiCornerLabel,
  formatViewportRoiSizeLabel,
  isViewportRoiLargerThanMinimumSide,
} from "./viewport-roi";

describe("canonicalizeViewportRoiCorners", () => {
  it("keeps already-canonical corners unchanged", () => {
    const result = canonicalizeViewportRoiCorners({
      imagePixelX0: 10,
      imagePixelY0: 20,
      imagePixelX1: 30,
      imagePixelY1: 40,
    });
    expect(result).toEqual({
      imagePixelX0: 10,
      imagePixelY0: 20,
      imagePixelX1: 30,
      imagePixelY1: 40,
    });
  });

  it("swaps reversed corners so X0 <= X1 and Y0 <= Y1", () => {
    const result = canonicalizeViewportRoiCorners({
      imagePixelX0: 100,
      imagePixelY0: 200,
      imagePixelX1: 50,
      imagePixelY1: 150,
    });
    expect(result).toEqual({
      imagePixelX0: 50,
      imagePixelY0: 150,
      imagePixelX1: 100,
      imagePixelY1: 200,
    });
  });
});

describe("clampViewportRoiToImageBounds", () => {
  it("clamps corners outside the image to the nearest edge", () => {
    const result = clampViewportRoiToImageBounds(
      { imagePixelX0: -5, imagePixelY0: -5, imagePixelX1: 1000, imagePixelY1: 1000 },
      { width: 100, height: 50 },
    );
    expect(result).toEqual({
      imagePixelX0: 0,
      imagePixelY0: 0,
      imagePixelX1: 99,
      imagePixelY1: 49,
    });
  });

  it("rounds fractional corners to integer pixel indices", () => {
    const result = clampViewportRoiToImageBounds(
      { imagePixelX0: 12.4, imagePixelY0: 18.6, imagePixelX1: 50.5, imagePixelY1: 31.2 },
      { width: 100, height: 100 },
    );
    expect(result).toEqual({
      imagePixelX0: 12,
      imagePixelY0: 19,
      imagePixelX1: 51,
      imagePixelY1: 31,
    });
  });
});

describe("isViewportRoiLargerThanMinimumSide", () => {
  it("returns true for a one-pixel ROI", () => {
    expect(
      isViewportRoiLargerThanMinimumSide({
        imagePixelX0: 5,
        imagePixelY0: 5,
        imagePixelX1: 5,
        imagePixelY1: 5,
      }),
    ).toBe(true);
  });
});

describe("formatters", () => {
  it("formats corners with canonical ordering", () => {
    expect(
      formatViewportRoiCornerLabel({
        imagePixelX0: 80,
        imagePixelY0: 90,
        imagePixelX1: 10,
        imagePixelY1: 20,
      }),
    ).toBe("(10, 20) - (80, 90)");
  });

  it("formats the size label using inclusive width/height", () => {
    expect(
      formatViewportRoiSizeLabel({
        imagePixelX0: 0,
        imagePixelY0: 0,
        imagePixelX1: 99,
        imagePixelY1: 49,
      }),
    ).toBe("100 x 50 px");
  });

  it("computes inclusive width and height", () => {
    const roi = { imagePixelX0: 5, imagePixelY0: 10, imagePixelX1: 14, imagePixelY1: 19 };
    expect(computeViewportRoiWidthInPixels(roi)).toBe(10);
    expect(computeViewportRoiHeightInPixels(roi)).toBe(10);
  });
});
