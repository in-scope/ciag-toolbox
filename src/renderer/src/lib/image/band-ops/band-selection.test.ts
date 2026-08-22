import { describe, expect, it } from "vitest";

import {
  flattenBandMatrixToFloat32,
  reduceCubeToSelectedBand,
  reduceCubeToSelectedBandInChunks,
} from "./band-selection";

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

describe("reduceCubeToSelectedBandInChunks", () => {
  // CT-293: the preset now runs at Apply through the chunked path so the busy
  // bar stays determinate and Stop lands at a chunk boundary. The values must
  // not move a bit because of it.
  it("produces exactly the same band as the unchunked reduction", async () => {
    for (const preset of ["average", "variance"] as const) {
      const chunked = await reduceCubeToSelectedBandInChunks(bands, preset);
      expect(chunked).toEqual(reduceCubeToSelectedBand(bands, preset));
    }
  });

  it("reports progress as the sweep completes", async () => {
    const fractions: number[] = [];
    await reduceCubeToSelectedBandInChunks(bands, "average", (fraction) => fractions.push(fraction));
    expect(fractions.at(-1)).toBe(1);
  });

  it("throws instead of returning a band when the apply is stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(reduceCubeToSelectedBandInChunks(bands, "average", undefined, controller.signal))
      .rejects.toThrow();
  });
});

describe("flattenBandMatrixToFloat32", () => {
  it("flattens nested rows row-major into one float32 band", () => {
    const result = flattenBandMatrixToFloat32([[1, 2, 3], [4, 5, 6]], 3, 2);
    expect(result).toBeInstanceOf(Float32Array);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("pads a short row with zeros rather than leaving holes", () => {
    expect(Array.from(flattenBandMatrixToFloat32([[1]], 2, 1))).toEqual([1, 0]);
  });
});
