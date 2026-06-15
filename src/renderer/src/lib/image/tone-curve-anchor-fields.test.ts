import { describe, expect, it } from "vitest";

import type { ToneCurveAnchor } from "@/lib/image/apply-tone-curve";
import {
  formatToneCurveFieldValue,
  isToneCurveEndpointIndex,
  moveSelectedAnchorInputTo,
  moveSelectedAnchorOutputTo,
  parseToneCurveFieldValueOrNull,
  toneCurveFieldStepForBand,
} from "@/lib/image/tone-curve-anchor-fields";
import type { ToneCurveValueRanges } from "@/lib/image/tone-curve-editor-state";

const UINT16_RANGES: ToneCurveValueRanges = { inputMin: 0, inputMax: 65535, outputMin: 0, outputMax: 65535 };

function threeAnchors(): ReadonlyArray<ToneCurveAnchor> {
  return [
    { input: 0, output: 0 },
    { input: 30000, output: 30000 },
    { input: 65535, output: 65535 },
  ];
}

describe("toneCurveFieldStepForBand", () => {
  it("steps by 1 for an integer band", () => {
    expect(toneCurveFieldStepForBand(true)).toBe(1);
  });

  it("steps by a small fraction for a float band", () => {
    expect(toneCurveFieldStepForBand(false)).toBeLessThan(1);
  });
});

describe("isToneCurveEndpointIndex", () => {
  it("marks the first and last anchors as endpoints", () => {
    expect(isToneCurveEndpointIndex(0, 3)).toBe(true);
    expect(isToneCurveEndpointIndex(2, 3)).toBe(true);
  });

  it("treats interior anchors as non-endpoints", () => {
    expect(isToneCurveEndpointIndex(1, 3)).toBe(false);
  });
});

describe("formatToneCurveFieldValue", () => {
  it("rounds to an integer for integer bands", () => {
    expect(formatToneCurveFieldValue(1234.6, true)).toBe("1235");
  });

  it("keeps fractional precision for float bands", () => {
    expect(formatToneCurveFieldValue(0.123456, false)).toBe("0.1235");
  });
});

describe("parseToneCurveFieldValueOrNull", () => {
  it("parses a numeric string", () => {
    expect(parseToneCurveFieldValueOrNull("42")).toBe(42);
  });

  it("returns null for non-numeric text", () => {
    expect(parseToneCurveFieldValueOrNull("abc")).toBeNull();
  });
});

describe("moveSelectedAnchorOutputTo", () => {
  it("moves only the selected anchor's output, clamped to the output range", () => {
    const moved = moveSelectedAnchorOutputTo(threeAnchors(), 0, 999999, UINT16_RANGES);
    expect(moved[0]).toEqual({ input: 0, output: 65535 });
  });
});

describe("moveSelectedAnchorInputTo", () => {
  it("keeps an interior anchor below its right neighbour when pushed past it", () => {
    const moved = moveSelectedAnchorInputTo(threeAnchors(), 1, 999999, UINT16_RANGES);
    expect(moved[1]!.input).toBeLessThan(moved[2]!.input);
  });

  it("keeps an interior anchor above its left neighbour when pushed below it", () => {
    const moved = moveSelectedAnchorInputTo(threeAnchors(), 1, -10, UINT16_RANGES);
    expect(moved[1]!.input).toBeGreaterThan(moved[0]!.input);
  });
});
