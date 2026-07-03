import { describe, expect, it } from "vitest";

import { reduceCubeToSelectedBand } from "./band-selection";

// A tiny 2-pixel, 3-band cube whose per-pixel statistics are hand-computable.
// Pixel 0 bands = [100, 800, 1600]; pixel 1 bands = [0, 30, 60].
const bands = [
  Uint16Array.from([100, 0]),
  Uint16Array.from([800, 30]),
  Uint16Array.from([1600, 60]),
];

describe("reduceCubeToSelectedBand", () => {
  it("averages the bands per pixel for the average preset", () => {
    const result = reduceCubeToSelectedBand(bands, "average");
    expect(result.length).toBe(2);
    expect(result[0]).toBeCloseTo((100 + 800 + 1600) / 3, 3);
    expect(result[1]).toBeCloseTo((0 + 30 + 60) / 3, 3);
  });

  it("computes the population variance per pixel for the variance preset", () => {
    const result = reduceCubeToSelectedBand(bands, "variance");
    const meanPixelOne = (0 + 30 + 60) / 3;
    const expectedPixelOne =
      ((0 - meanPixelOne) ** 2 + (30 - meanPixelOne) ** 2 + (60 - meanPixelOne) ** 2) / 3;
    expect(result[1]).toBeCloseTo(expectedPixelOne, 3);
  });

  it("reports zero variance for a constant spectrum across bands", () => {
    const flat = [Uint8Array.from([50]), Uint8Array.from([50]), Uint8Array.from([50])];
    expect(Array.from(reduceCubeToSelectedBand(flat, "variance"))).toEqual([0]);
  });

  it("returns a float32 band so out-of-integer-range statistics survive", () => {
    const result = reduceCubeToSelectedBand(bands, "average");
    expect(result).toBeInstanceOf(Float32Array);
  });
});
