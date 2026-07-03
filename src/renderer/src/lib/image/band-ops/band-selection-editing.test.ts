import { describe, expect, it } from "vitest";

import {
  describeBandSelectionFunction,
  describeImportedToolBandSelection,
  flattenBandMatrixToFloat32,
} from "./band-selection-editing";

describe("flattenBandMatrixToFloat32", () => {
  it("flattens nested rows row-major into one float32 band", () => {
    const result = flattenBandMatrixToFloat32([[1, 2, 3], [4, 5, 6]], 3, 2);
    expect(result).toBeInstanceOf(Float32Array);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("describeBandSelectionFunction", () => {
  it("names a preset in Title Case", () => {
    expect(describeBandSelectionFunction({ kind: "preset", preset: "variance" })).toBe("Variance");
  });

  it("uses the custom description verbatim", () => {
    expect(describeBandSelectionFunction({ kind: "custom", token: "t", description: "Formula" })).toBe("Formula");
  });

  it("returns an empty string when nothing is chosen yet", () => {
    expect(describeBandSelectionFunction(null)).toBe("");
  });
});

describe("describeImportedToolBandSelection", () => {
  it("names the imported file", () => {
    expect(describeImportedToolBandSelection("band-tool.py")).toBe("Imported tool: band-tool.py");
  });

  it("falls back to a generic name when none is provided", () => {
    expect(describeImportedToolBandSelection(undefined)).toBe("Imported tool: script");
  });
});
