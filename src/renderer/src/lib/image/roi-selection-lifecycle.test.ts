import { describe, expect, it } from "vitest";

import {
  isImagePixelInsideRoi,
  reduceInspectionRoiSelection,
  resolveInspectionRoiAfterPlainClick,
} from "./roi-selection-lifecycle";
import type { ViewportRoi } from "./viewport-roi";

const ROI: ViewportRoi = {
  imagePixelX0: 10,
  imagePixelY0: 20,
  imagePixelX1: 30,
  imagePixelY1: 40,
};

describe("isImagePixelInsideRoi", () => {
  it("treats the corners and interior as inside (inclusive bounds)", () => {
    expect(isImagePixelInsideRoi(ROI, 10, 20)).toBe(true);
    expect(isImagePixelInsideRoi(ROI, 30, 40)).toBe(true);
    expect(isImagePixelInsideRoi(ROI, 20, 30)).toBe(true);
  });

  it("treats pixels beyond any edge as outside", () => {
    expect(isImagePixelInsideRoi(ROI, 9, 30)).toBe(false);
    expect(isImagePixelInsideRoi(ROI, 31, 30)).toBe(false);
    expect(isImagePixelInsideRoi(ROI, 20, 19)).toBe(false);
    expect(isImagePixelInsideRoi(ROI, 20, 41)).toBe(false);
  });

  it("canonicalizes inverted corners before testing", () => {
    const inverted: ViewportRoi = {
      imagePixelX0: 30,
      imagePixelY0: 40,
      imagePixelX1: 10,
      imagePixelY1: 20,
    };
    expect(isImagePixelInsideRoi(inverted, 20, 30)).toBe(true);
  });
});

describe("resolveInspectionRoiAfterPlainClick", () => {
  it("keeps the selection when the click lands inside it", () => {
    expect(resolveInspectionRoiAfterPlainClick(ROI, { x: 20, y: 30 })).toBe(ROI);
  });

  it("clears the selection when the click lands outside it", () => {
    expect(resolveInspectionRoiAfterPlainClick(ROI, { x: 100, y: 100 })).toBeNull();
  });

  it("clears the selection when the click lands off the image (null pixel)", () => {
    expect(resolveInspectionRoiAfterPlainClick(ROI, null)).toBeNull();
  });

  it("is a no-op when there is no selection", () => {
    expect(resolveInspectionRoiAfterPlainClick(null, { x: 20, y: 30 })).toBeNull();
  });
});

describe("reduceInspectionRoiSelection (create, replace, clear)", () => {
  it("creates a canonicalized selection from a commit when none exists", () => {
    const next = reduceInspectionRoiSelection(null, {
      kind: "commit",
      roi: { imagePixelX0: 30, imagePixelY0: 40, imagePixelX1: 10, imagePixelY1: 20 },
    });
    expect(next).toEqual(ROI);
  });

  it("replaces an existing selection with a newly committed one", () => {
    const replacement: ViewportRoi = {
      imagePixelX0: 0,
      imagePixelY0: 0,
      imagePixelX1: 5,
      imagePixelY1: 5,
    };
    expect(reduceInspectionRoiSelection(ROI, { kind: "commit", roi: replacement })).toEqual(
      replacement,
    );
  });

  it("clears the selection when a plain click lands outside it", () => {
    expect(
      reduceInspectionRoiSelection(ROI, {
        kind: "plain-click",
        clickedImagePixel: { x: 100, y: 100 },
      }),
    ).toBeNull();
  });

  it("keeps the selection when a plain click lands inside it", () => {
    expect(
      reduceInspectionRoiSelection(ROI, {
        kind: "plain-click",
        clickedImagePixel: { x: 20, y: 30 },
      }),
    ).toBe(ROI);
  });

  it("clears the selection when the region tool is deactivated", () => {
    expect(reduceInspectionRoiSelection(ROI, { kind: "region-tool-deactivated" })).toBeNull();
  });
});
