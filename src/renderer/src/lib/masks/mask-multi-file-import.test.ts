import { describe, expect, it } from "vitest";

import { DEFAULT_MASK_CATEGORY_COLORS } from "@/lib/masks/mask-layer";
import {
  combineMaskFilesIntoOneLayer,
  COMBINED_MASK_LAYER_NAME,
  NO_MASK_FILES_MESSAGE,
  TOO_MANY_MASK_FILES_MESSAGE,
  type MaskFileToCombine,
} from "@/lib/masks/mask-multi-file-import";

// CT-328: several per-class masks become one layer. Pick order IS category
// order, a file's stem names its category, and a pixel labeled twice takes the
// LAST file's category.

const WIDTH = 4;
const HEIGHT = 2;

function buildMaskFile(fileName: string, values: ReadonlyArray<number>): MaskFileToCombine {
  return {
    fileName,
    decoded: { width: WIDTH, height: HEIGHT, values: Uint8Array.from(values) },
  };
}

const TOP_ROW = buildMaskFile("text.png", [1, 1, 1, 1, 0, 0, 0, 0]);
const BOTTOM_ROW = buildMaskFile("parchment.png", [0, 0, 0, 0, 255, 255, 255, 255]);

describe("combineMaskFilesIntoOneLayer", () => {
  it("gives each file its own category in pick order", () => {
    const layer = combineMaskFilesIntoOneLayer([TOP_ROW, BOTTOM_ROW]);

    expect(layer.name).toBe(COMBINED_MASK_LAYER_NAME);
    expect(layer.width).toBe(WIDTH);
    expect(layer.height).toBe(HEIGHT);
    expect(Array.from(layer.values)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
  });

  it("names each category after its file and colours them in order", () => {
    const layer = combineMaskFilesIntoOneLayer([TOP_ROW, BOTTOM_ROW]);

    expect(layer.categories.map((category) => category.name)).toEqual(["text", "parchment"]);
    expect(layer.categories.map((category) => category.color)).toEqual([
      DEFAULT_MASK_CATEGORY_COLORS[0],
      DEFAULT_MASK_CATEGORY_COLORS[1],
    ]);
  });

  it("gives an overlapping pixel to the last file that labels it", () => {
    const overlapping = buildMaskFile("both.png", [1, 0, 0, 0, 0, 0, 0, 0]);

    const layer = combineMaskFilesIntoOneLayer([TOP_ROW, overlapping]);

    expect(Array.from(layer.values)).toEqual([2, 1, 1, 1, 0, 0, 0, 0]);
  });

  it("treats any non-zero sample as belonging to that file's category", () => {
    const layer = combineMaskFilesIntoOneLayer([BOTTOM_ROW]);

    expect(Array.from(layer.values)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it("refuses more files than a layer has categories", () => {
    const sixFiles = Array.from({ length: 6 }, (_unused, index) =>
      buildMaskFile(`class-${index}.png`, [0, 0, 0, 0, 0, 0, 0, 0]),
    );

    expect(() => combineMaskFilesIntoOneLayer(sixFiles)).toThrow(TOO_MANY_MASK_FILES_MESSAGE);
  });

  it("refuses an empty selection", () => {
    expect(() => combineMaskFilesIntoOneLayer([])).toThrow(NO_MASK_FILES_MESSAGE);
  });
});
