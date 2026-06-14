import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPECTRUM_PLOT_PADDING,
  projectXPositionToPixelX,
  projectYValueToPixelY,
  type SpectrumPlotDimensions,
  type SpectrumPlotValueRange,
  type SpectrumPlotXRange,
} from "@/lib/image/spectrum-plot-geometry";
import {
  findNearestBandIndexForPointerX,
  resolveNearestSpectrumLineAtBand,
} from "@/lib/image/spectrum-plot-hit-test";

const DIMENSIONS: SpectrumPlotDimensions = {
  width: 268,
  height: 160,
  padding: DEFAULT_SPECTRUM_PLOT_PADDING,
};
const X_RANGE: SpectrumPlotXRange = { minPosition: 1, maxPosition: 5 };
const VALUE_RANGE: SpectrumPlotValueRange = { minValue: 0, maxValue: 100 };
const BAND_POSITIONS = [1, 2, 3, 4, 5];

function pixelXForBand(position: number): number {
  return projectXPositionToPixelX(position, X_RANGE, DIMENSIONS);
}

function pixelYForValue(value: number): number {
  return projectYValueToPixelY(value, VALUE_RANGE, DIMENSIONS);
}

describe("findNearestBandIndexForPointerX", () => {
  it("returns the index of the band whose pixel x is closest to the pointer", () => {
    expect(findNearestBandIndexForPointerX(pixelXForBand(3), BAND_POSITIONS, X_RANGE, DIMENSIONS)).toBe(2);
  });

  it("snaps to the first band for a pointer left of the plot", () => {
    expect(findNearestBandIndexForPointerX(-50, BAND_POSITIONS, X_RANGE, DIMENSIONS)).toBe(0);
  });

  it("snaps to the last band for a pointer right of the plot", () => {
    expect(findNearestBandIndexForPointerX(9999, BAND_POSITIONS, X_RANGE, DIMENSIONS)).toBe(4);
  });

  it("resolves a pointer between two bands to the nearer one", () => {
    const betweenBand1And2 = (pixelXForBand(1) + pixelXForBand(2)) / 2 + 1;
    expect(findNearestBandIndexForPointerX(betweenBand1And2, BAND_POSITIONS, X_RANGE, DIMENSIONS)).toBe(1);
  });

  it("returns null when there are no bands", () => {
    expect(findNearestBandIndexForPointerX(100, [], X_RANGE, DIMENSIONS)).toBeNull();
  });
});

describe("resolveNearestSpectrumLineAtBand", () => {
  const pixelLine = { id: "pixel", values: [0, 0, 10, 0, 0] };
  const roiLine = {
    id: "roi",
    values: [0, 0, 90, 0, 0],
    bandStandardDeviations: [1, 1, 5, 1, 1],
  };

  it("resolves to the line whose value pixel y is closest to the pointer", () => {
    const hit = resolveNearestSpectrumLineAtBand([pixelLine, roiLine], 2, pixelYForValue(10), VALUE_RANGE, DIMENSIONS);
    expect(hit?.lineId).toBe("pixel");
    expect(hit?.value).toBe(10);
    expect(hit?.standardDeviation).toBeNull();
  });

  it("reports the standard deviation for an ROI mean line", () => {
    const hit = resolveNearestSpectrumLineAtBand([pixelLine, roiLine], 2, pixelYForValue(90), VALUE_RANGE, DIMENSIONS);
    expect(hit?.lineId).toBe("roi");
    expect(hit?.value).toBe(90);
    expect(hit?.standardDeviation).toBe(5);
  });

  it("skips lines with a non-finite value at the band", () => {
    const sparseLine = { id: "sparse", values: [0, 0, Number.NaN, 0, 0] };
    const hit = resolveNearestSpectrumLineAtBand([sparseLine, pixelLine], 2, pixelYForValue(10), VALUE_RANGE, DIMENSIONS);
    expect(hit?.lineId).toBe("pixel");
  });

  it("returns null when no line has a value at the band", () => {
    const shortLine = { id: "short", values: [1, 2] };
    expect(resolveNearestSpectrumLineAtBand([shortLine], 4, 80, VALUE_RANGE, DIMENSIONS)).toBeNull();
  });
});
