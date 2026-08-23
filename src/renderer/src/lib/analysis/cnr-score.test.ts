import { describe, expect, it } from "vitest";

import { computeCnrScore } from "./cnr-score";

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
