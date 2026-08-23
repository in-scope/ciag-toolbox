import { describe, expect, it } from "vitest";

import {
  buildImportedMaskLayerContent,
  describeMaskDimensionMismatchOrNull,
  MASK_TOO_MANY_CATEGORIES_MESSAGE,
} from "@/lib/masks/mask-import";
import type { DecodedMaskPng } from "@/lib/masks/mask-png-decode";
import type { MaskSidecarDocument } from "@/lib/masks/mask-sidecar";

// CT-303: an imported mask becomes a layer only when it covers the stack and
// stays inside the five-category model. Without a sidecar the indexes present
// in the PNG take default names and colours.

function buildDecodedMask(values: ReadonlyArray<number>): DecodedMaskPng {
  return { width: 2, height: values.length / 2, values: Uint8Array.from(values) };
}

const SIDECAR: MaskSidecarDocument = {
  formatVersion: 1,
  name: "Parchment mask",
  width: 2,
  height: 2,
  categories: [
    { index: 1, name: "Parchment", color: "#111111" },
    { index: 2, name: "Substrate", color: "#222222" },
  ],
  opacity: 60,
};

describe("describeMaskDimensionMismatchOrNull", () => {
  it("accepts a mask that covers the stack", () => {
    expect(describeMaskDimensionMismatchOrNull({ width: 4, height: 4 }, 4, 4)).toBeNull();
  });

  it("names both sizes when the mask does not cover the stack", () => {
    expect(describeMaskDimensionMismatchOrNull({ width: 8, height: 8 }, 4, 4)).toBe(
      "This mask is 8 x 8 but the stack is 4 x 4. Import a mask that matches the stack's size.",
    );
  });
});

describe("buildImportedMaskLayerContent", () => {
  it("takes its name, categories, and opacity from the sidecar", () => {
    const content = buildImportedMaskLayerContent({
      fileName: "mask-multiband.png",
      decoded: buildDecodedMask([0, 1, 2, 0]),
      sidecar: SIDECAR,
    });
    expect(content.name).toBe("Parchment mask");
    expect(content.opacityPercent).toBe(60);
    expect(content.categories).toEqual([
      { id: "category-1", name: "Parchment", color: "#111111" },
      { id: "category-2", name: "Substrate", color: "#222222" },
    ]);
  });

  it("names the layer after the file and defaults the categories without a sidecar", () => {
    const content = buildImportedMaskLayerContent({
      fileName: "hand-labelled.png",
      decoded: buildDecodedMask([0, 1, 2, 0]),
      sidecar: null,
    });
    expect(content.name).toBe("hand-labelled");
    expect(content.opacityPercent).toBe(50);
    expect(content.categories.map((category) => category.name)).toEqual([
      "Foreground",
      "Background",
    ]);
    expect(content.categories.map((category) => category.color)).toEqual([
      "#ef4444",
      "#3b82f6",
    ]);
  });

  it("builds one category per index the mask actually paints", () => {
    const content = buildImportedMaskLayerContent({
      fileName: "three.png",
      decoded: buildDecodedMask([0, 3, 1, 0]),
      sidecar: null,
    });
    expect(content.categories).toHaveLength(3);
    expect(content.categories[2]?.name).toBe("Category 3");
  });

  it("keeps one category for a mask that paints nothing", () => {
    const content = buildImportedMaskLayerContent({
      fileName: "empty.png",
      decoded: buildDecodedMask([0, 0, 0, 0]),
      sidecar: null,
    });
    expect(content.categories).toHaveLength(1);
  });

  it("carries the mask's values through unchanged", () => {
    const decoded = buildDecodedMask([0, 1, 2, 0]);
    const content = buildImportedMaskLayerContent({
      fileName: "mask.png",
      decoded,
      sidecar: null,
    });
    expect(Array.from(content.values)).toEqual([0, 1, 2, 0]);
    expect({ width: content.width, height: content.height }).toEqual({ width: 2, height: 2 });
  });

  it("refuses a mask holding a category index above the five-category cap", () => {
    expect(() =>
      buildImportedMaskLayerContent({
        fileName: "too-many.png",
        decoded: buildDecodedMask([0, 6, 1, 0]),
        sidecar: null,
      }),
    ).toThrow(MASK_TOO_MANY_CATEGORIES_MESSAGE);
  });
});
