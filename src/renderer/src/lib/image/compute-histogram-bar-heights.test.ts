import { describe, expect, it } from "vitest";

import { computeHistogramBarHeightsInPixels } from "@/lib/image/compute-histogram-bar-heights";

describe("computeHistogramBarHeightsInPixels", () => {
  it("returns all zeros when every bin is empty", () => {
    const heights = computeHistogramBarHeightsInPixels({
      bins: new Uint32Array([0, 0, 0, 0]),
      heightPx: 100,
    });
    expect(heights).toEqual([0, 0, 0, 0]);
  });

  it("scales bar heights so the tallest bin reaches the requested pixel height", () => {
    const heights = computeHistogramBarHeightsInPixels({
      bins: new Uint32Array([0, 5, 10, 2]),
      heightPx: 100,
    });
    expect(heights[2]).toBe(100);
    expect(heights[1]).toBe(50);
    expect(heights[0]).toBe(0);
    expect(heights[3]).toBe(20);
  });

  it("preserves the original bin count when computing bar heights", () => {
    const heights = computeHistogramBarHeightsInPixels({
      bins: new Uint32Array(256),
      heightPx: 120,
    });
    expect(heights.length).toBe(256);
  });
});
