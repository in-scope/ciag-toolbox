import { describe, expect, it } from "vitest";

import {
  convertHistogramFractionToValue,
  convertValueToHistogramFraction,
  defaultBlackWhitePointSelectionForRange,
  moveBlackWhitePointMarkerToValue,
  resolveBlackWhitePointSelectionWithinRange,
} from "./black-white-point-selection";

describe("defaultBlackWhitePointSelectionForRange", () => {
  it("spans the full range so the default mapping is identity", () => {
    expect(defaultBlackWhitePointSelectionForRange(0, 255)).toEqual({ black: 0, white: 255 });
  });
});

describe("resolveBlackWhitePointSelectionWithinRange", () => {
  it("falls back to the full range when no selection exists", () => {
    expect(resolveBlackWhitePointSelectionWithinRange(null, 0, 100)).toEqual({ black: 0, white: 100 });
  });

  it("clamps a stored selection that is outside the current band range", () => {
    const resolved = resolveBlackWhitePointSelectionWithinRange({ black: -50, white: 9000 }, 0, 255);
    expect(resolved.black).toBe(0);
    expect(resolved.white).toBe(255);
  });
});

describe("convertHistogramFractionToValue", () => {
  it("maps fraction 0 to min and fraction 1 to max", () => {
    expect(convertHistogramFractionToValue(0, 10, 20)).toBe(10);
    expect(convertHistogramFractionToValue(1, 10, 20)).toBe(20);
    expect(convertHistogramFractionToValue(0.5, 0, 100)).toBe(50);
  });

  it("clamps fractions outside the unit range", () => {
    expect(convertHistogramFractionToValue(-1, 0, 100)).toBe(0);
    expect(convertHistogramFractionToValue(2, 0, 100)).toBe(100);
  });
});

describe("convertValueToHistogramFraction", () => {
  it("maps min to 0 and max to 1", () => {
    expect(convertValueToHistogramFraction(0, 0, 200)).toBe(0);
    expect(convertValueToHistogramFraction(200, 0, 200)).toBe(1);
    expect(convertValueToHistogramFraction(50, 0, 200)).toBe(0.25);
  });

  it("returns 0 for a degenerate range", () => {
    expect(convertValueToHistogramFraction(5, 5, 5)).toBe(0);
  });
});

describe("moveBlackWhitePointMarkerToValue", () => {
  it("moves the black marker but never crosses the white marker", () => {
    const moved = moveBlackWhitePointMarkerToValue({ black: 10, white: 80 }, "black", 200, 0, 255);
    expect(moved.white).toBe(80);
    expect(moved.black).toBeLessThan(80);
  });

  it("moves the white marker but never crosses the black marker", () => {
    const moved = moveBlackWhitePointMarkerToValue({ black: 100, white: 200 }, "white", 0, 0, 255);
    expect(moved.black).toBe(100);
    expect(moved.white).toBeGreaterThan(100);
  });

  it("clamps a dragged marker to the range bounds", () => {
    const moved = moveBlackWhitePointMarkerToValue({ black: 10, white: 200 }, "white", 9000, 0, 255);
    expect(moved.white).toBe(255);
  });
});
