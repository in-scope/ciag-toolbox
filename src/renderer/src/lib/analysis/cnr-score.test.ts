import { describe, expect, it } from "vitest";

import type { RasterImage, RasterTypedArray } from "@/lib/image/raster-image";

import { computeCnrScore, computeCnrScorePerBand } from "./cnr-score";

// Hand-computed pins: candidate [10, 20, 30, 40], text = pixels 0..1
// (mean 15), background = pixels 2..3 (mean 35, population std 5).
// CNR = (15 - 35) / 5 = -4.

describe("computeCnrScore", () => {
  it("matches the hand-computed (meanText - meanBackground) / stdBackground", () => {
    const score = computeCnrScore({
      candidateValues: Float32Array.from([10, 20, 30, 40]),
      maskValues: Uint8Array.from([1, 1, 2, 2]),
      textCategoryValue: 1,
      backgroundCategoryValue: 2,
    });
    expect(score).toBeCloseTo(-4, 12);
  });

  it("uses the POPULATION standard deviation (ddof = 0, numpy default)", () => {
    // Background [1, 3, 5]: mean 3, population variance (4+0+4)/3 = 8/3.
    // A sample std (ddof=1) would divide by 2 and give 2 instead.
    const score = computeCnrScore({
      candidateValues: Float32Array.from([10, 1, 3, 5]),
      maskValues: Uint8Array.from([1, 2, 2, 2]),
      textCategoryValue: 1,
      backgroundCategoryValue: 2,
    });
    expect(score).toBeCloseTo((10 - 3) / Math.sqrt(8 / 3), 12);
  });

  it("ignores pixels labeled with other categories and unlabeled pixels", () => {
    const score = computeCnrScore({
      candidateValues: Float32Array.from([10, 999, 20, 30, 40, -50]),
      maskValues: Uint8Array.from([1, 3, 1, 2, 2, 0]),
      textCategoryValue: 1,
      backgroundCategoryValue: 2,
    });
    expect(score).toBeCloseTo(-4, 12);
  });

  it("returns Infinity when the background has no variation (numpy divides by zero)", () => {
    const score = computeCnrScore({
      candidateValues: Float32Array.from([10, 5, 5]),
      maskValues: Uint8Array.from([1, 2, 2]),
      textCategoryValue: 1,
      backgroundCategoryValue: 2,
    });
    expect(score).toBe(Number.POSITIVE_INFINITY);
  });

  it("throws when a category has no painted pixels", () => {
    expect(() =>
      computeCnrScore({
        candidateValues: Float32Array.from([1, 2]),
        maskValues: Uint8Array.from([1, 1]),
        textCategoryValue: 1,
        backgroundCategoryValue: 2,
      }),
    ).toThrow("no painted pixels");
  });

  it("throws when the mask does not cover the candidate band", () => {
    expect(() =>
      computeCnrScore({
        candidateValues: Float32Array.from([1, 2, 3]),
        maskValues: Uint8Array.from([1, 2]),
        textCategoryValue: 1,
        backgroundCategoryValue: 2,
      }),
    ).toThrow("does not cover");
  });
});

// CT-320: the same formula applied to every band of a stack. The 2x2 raster
// below has mask [1, 1, 2, 2], so text = pixels 0..1 and background = 2..3.
// Band 1 [10, 20, 30, 40]: (15 - 35) / 5 = -4.
// Band 2 [4, 8, 10, 20]:   (6 - 15) / 5 = -1.8.

function buildTwoByTwoRaster(bands: ReadonlyArray<RasterTypedArray>): RasterImage {
  return {
    bandPixels: bands,
    width: 2,
    height: 2,
    bitsPerSample: 32,
    sampleFormat: "float",
    bandCount: bands.length,
  };
}

const TEXT_THEN_BACKGROUND_MASK = Uint8Array.from([1, 1, 2, 2]);

describe("computeCnrScorePerBand", () => {
  it("scores each band of a float32 stack on its own, in band order", () => {
    const raster = buildTwoByTwoRaster([
      Float32Array.from([10, 20, 30, 40]),
      Float32Array.from([4, 8, 10, 20]),
    ]);
    const scores = computeCnrScorePerBand(raster, TEXT_THEN_BACKGROUND_MASK, 1, 2);
    expect(scores).toHaveLength(2);
    expect(scores[0]).toBeCloseTo(-4, 12);
    expect(scores[1]).toBeCloseTo(-1.8, 12);
  });

  it("reads integer bands too, giving the same numbers as the float32 stack", () => {
    const raster = buildTwoByTwoRaster([
      Uint8Array.from([10, 20, 30, 40]),
      Uint8Array.from([4, 8, 10, 20]),
    ]);
    const scores = computeCnrScorePerBand(raster, TEXT_THEN_BACKGROUND_MASK, 1, 2);
    expect(scores[0]).toBeCloseTo(-4, 12);
    expect(scores[1]).toBeCloseTo(-1.8, 12);
  });

  it("swapping the two categories negates a score whose classes share a spread", () => {
    const raster = buildTwoByTwoRaster([Float32Array.from([10, 20, 30, 40])]);
    expect(computeCnrScorePerBand(raster, TEXT_THEN_BACKGROUND_MASK, 2, 1)[0]).toBeCloseTo(4, 12);
  });

  // A background with no spread divides by zero, so that band alone is not a
  // comparable number; the presentation layer drops it from the top list.
  it("reports a non-finite score for a band whose background has no spread", () => {
    const raster = buildTwoByTwoRaster([
      Float32Array.from([10, 20, 30, 40]),
      Float32Array.from([10, 20, 7, 7]),
    ]);
    const scores = computeCnrScorePerBand(raster, TEXT_THEN_BACKGROUND_MASK, 1, 2);
    expect(scores[0]).toBeCloseTo(-4, 12);
    expect(scores[1]).toBe(Number.POSITIVE_INFINITY);
  });
});
