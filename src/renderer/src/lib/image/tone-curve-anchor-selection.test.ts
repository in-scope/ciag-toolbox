import { describe, expect, it } from "vitest";

import {
  clampSelectedToneCurveAnchorIndex,
  DEFAULT_SELECTED_TONE_CURVE_ANCHOR_INDEX,
} from "@/lib/image/tone-curve-anchor-selection";

describe("clampSelectedToneCurveAnchorIndex", () => {
  it("keeps an in-range index unchanged", () => {
    expect(clampSelectedToneCurveAnchorIndex(2, 4)).toBe(2);
  });

  it("keeps the last valid index", () => {
    expect(clampSelectedToneCurveAnchorIndex(3, 4)).toBe(3);
  });

  it("falls back to the left endpoint when the index is past the end (e.g. after a reset)", () => {
    expect(clampSelectedToneCurveAnchorIndex(3, 2)).toBe(DEFAULT_SELECTED_TONE_CURVE_ANCHOR_INDEX);
  });

  it("falls back to the left endpoint for a negative index", () => {
    expect(clampSelectedToneCurveAnchorIndex(-1, 4)).toBe(0);
  });

  it("falls back to the left endpoint for a non-integer index", () => {
    expect(clampSelectedToneCurveAnchorIndex(1.5, 4)).toBe(0);
  });

  it("falls back to the left endpoint when there are no anchors yet", () => {
    expect(clampSelectedToneCurveAnchorIndex(0, 0)).toBe(0);
  });
});
