import { describe, expect, it } from "vitest";

import { buildMaskCategoryAtIndex } from "@/lib/masks/mask-layer";
import {
  buildMaskOverlayRgbaBytes,
  convertOpacityPercentToAlpha,
  parseHexColorOrNull,
  resolveMaskOverlayColorOrNull,
} from "@/lib/masks/mask-overlay-image";

const RED = "#ef4444";
const BLUE = "#3b82f6";

const TWO_CATEGORIES = [
  buildMaskCategoryAtIndex(0, "Foreground", RED),
  buildMaskCategoryAtIndex(1, "Background", BLUE),
];

function readPixelBytes(bytes: Uint8ClampedArray, pixel: number): ReadonlyArray<number> {
  return Array.from(bytes.slice(pixel * 4, pixel * 4 + 4));
}

describe("parseHexColorOrNull", () => {
  it("reads the six digit form", () => {
    expect(parseHexColorOrNull(RED)).toEqual({ red: 239, green: 68, blue: 68 });
  });

  it("expands the three digit form", () => {
    expect(parseHexColorOrNull("#0f8")).toEqual({ red: 0, green: 255, blue: 136 });
  });

  it("refuses anything that is not a hex colour", () => {
    expect(parseHexColorOrNull("red")).toBeNull();
    expect(parseHexColorOrNull("#12345")).toBeNull();
    expect(parseHexColorOrNull("")).toBeNull();
  });
});

describe("convertOpacityPercentToAlpha", () => {
  it("maps the percent range onto the 0 to 255 alpha range", () => {
    expect(convertOpacityPercentToAlpha(0)).toBe(0);
    expect(convertOpacityPercentToAlpha(50)).toBe(128);
    expect(convertOpacityPercentToAlpha(100)).toBe(255);
  });

  it("clamps values outside the range", () => {
    expect(convertOpacityPercentToAlpha(-10)).toBe(0);
    expect(convertOpacityPercentToAlpha(140)).toBe(255);
  });
});

describe("resolveMaskOverlayColorOrNull", () => {
  it("maps a category value to that category's colour", () => {
    expect(resolveMaskOverlayColorOrNull(2, TWO_CATEGORIES)).toEqual({
      red: 59,
      green: 130,
      blue: 246,
    });
  });

  it("leaves unlabeled pixels and values without a category uncoloured", () => {
    expect(resolveMaskOverlayColorOrNull(0, TWO_CATEGORIES)).toBeNull();
    expect(resolveMaskOverlayColorOrNull(3, TWO_CATEGORIES)).toBeNull();
  });
});

describe("buildMaskOverlayRgbaBytes", () => {
  it("tints labeled pixels with their category colour at the layer opacity", () => {
    const bytes = buildMaskOverlayRgbaBytes({
      values: new Uint8Array([1, 2, 0, 1]),
      categories: TWO_CATEGORIES,
      opacityPercent: 50,
    });
    expect(readPixelBytes(bytes, 0)).toEqual([239, 68, 68, 128]);
    expect(readPixelBytes(bytes, 1)).toEqual([59, 130, 246, 128]);
    expect(readPixelBytes(bytes, 3)).toEqual([239, 68, 68, 128]);
  });

  it("leaves unlabeled pixels fully transparent so the image shows through", () => {
    const bytes = buildMaskOverlayRgbaBytes({
      values: new Uint8Array([0, 1]),
      categories: TWO_CATEGORIES,
      opacityPercent: 100,
    });
    expect(readPixelBytes(bytes, 0)).toEqual([0, 0, 0, 0]);
    expect(readPixelBytes(bytes, 1)).toEqual([239, 68, 68, 255]);
  });

  it("produces four bytes per mask pixel", () => {
    const bytes = buildMaskOverlayRgbaBytes({
      values: new Uint8Array(16),
      categories: TWO_CATEGORIES,
      opacityPercent: 50,
    });
    expect(bytes).toHaveLength(64);
  });
});
