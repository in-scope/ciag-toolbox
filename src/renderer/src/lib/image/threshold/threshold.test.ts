import { describe, expect, it } from "vitest";

import {
  applyManualThreshold,
  isValueWithinThresholdBounds,
  THRESHOLD_BLACK_LEVEL,
  THRESHOLD_WHITE_LEVEL,
} from "./threshold";

describe("applyManualThreshold", () => {
  it("marks in-range values white and out-of-range values black", () => {
    const band = Uint8Array.from([50, 100, 150, 200]);
    const result = applyManualThreshold(band, { lower: 90, upper: 160 });
    expect(Array.from(result)).toEqual([
      THRESHOLD_BLACK_LEVEL,
      THRESHOLD_WHITE_LEVEL,
      THRESHOLD_WHITE_LEVEL,
      THRESHOLD_BLACK_LEVEL,
    ]);
  });

  it("treats both bounds as inclusive", () => {
    const band = Uint8Array.from([99, 100, 160, 161]);
    const result = applyManualThreshold(band, { lower: 100, upper: 160 });
    expect(Array.from(result)).toEqual([
      THRESHOLD_BLACK_LEVEL,
      THRESHOLD_WHITE_LEVEL,
      THRESHOLD_WHITE_LEVEL,
      THRESHOLD_BLACK_LEVEL,
    ]);
  });

  it("keeps only the exact value white when lower equals upper", () => {
    const band = Uint8Array.from([119, 120, 121]);
    const result = applyManualThreshold(band, { lower: 120, upper: 120 });
    expect(Array.from(result)).toEqual([
      THRESHOLD_BLACK_LEVEL,
      THRESHOLD_WHITE_LEVEL,
      THRESHOLD_BLACK_LEVEL,
    ]);
  });

  it("marks every pixel white for full-range bounds", () => {
    const band = Uint8Array.from([0, 100, 255]);
    const result = applyManualThreshold(band, { lower: 0, upper: 255 });
    expect(Array.from(result)).toEqual([
      THRESHOLD_WHITE_LEVEL,
      THRESHOLD_WHITE_LEVEL,
      THRESHOLD_WHITE_LEVEL,
    ]);
  });

  it("thresholds float bands against fractional bounds", () => {
    const band = Float32Array.from([0.1, 0.5, 0.9]);
    const result = applyManualThreshold(band, { lower: 0.25, upper: 0.75 });
    expect(Array.from(result)).toEqual([
      THRESHOLD_BLACK_LEVEL,
      THRESHOLD_WHITE_LEVEL,
      THRESHOLD_BLACK_LEVEL,
    ]);
  });
});

describe("isValueWithinThresholdBounds", () => {
  it("accepts the bound values themselves", () => {
    expect(isValueWithinThresholdBounds(5, { lower: 5, upper: 10 })).toBe(true);
    expect(isValueWithinThresholdBounds(10, { lower: 5, upper: 10 })).toBe(true);
  });

  it("rejects values outside the bounds", () => {
    expect(isValueWithinThresholdBounds(4.999, { lower: 5, upper: 10 })).toBe(false);
    expect(isValueWithinThresholdBounds(10.001, { lower: 5, upper: 10 })).toBe(false);
  });
});
