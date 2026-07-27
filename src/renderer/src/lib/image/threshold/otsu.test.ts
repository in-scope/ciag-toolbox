import { describe, expect, it } from "vitest";

import type { BandHistogram } from "@/lib/image/compute-band-histogram";

import { computeOtsuBoundsForHistogram, computeOtsuThreshold } from "./otsu";

function makeUint8StyleHistogram(populate: (bins: Uint32Array) => void): BandHistogram {
  const bins = new Uint32Array(256);
  populate(bins);
  const totalSampleCount = bins.reduce((sum, count) => sum + count, 0);
  return { bins, binCount: 256, min: 0, max: 255, binWidth: 1, totalSampleCount, excludedSampleCount: 0 };
}

function makeBimodalHistogram(): BandHistogram {
  return makeUint8StyleHistogram((bins) => {
    for (let value = 40; value <= 54; value += 2) bins[value] = 1;
    for (let value = 200; value <= 214; value += 2) bins[value] = 1;
  });
}

describe("computeOtsuThreshold", () => {
  it("puts the cutoff in the empty valley of a bimodal histogram", () => {
    const cutoff = computeOtsuThreshold(makeBimodalHistogram());
    expect(cutoff).toBeGreaterThan(54);
    expect(cutoff).toBeLessThanOrEqual(200);
  });

  it("keeps the first maximizing split, so the valley cutoff sits just above the dark cluster", () => {
    expect(computeOtsuThreshold(makeBimodalHistogram())).toBe(55);
  });

  it("splits a flat histogram at the middle", () => {
    const histogram: BandHistogram = {
      bins: Uint32Array.from([1, 1, 1, 1]),
      binCount: 4,
      min: 0,
      max: 3,
      binWidth: 1,
      totalSampleCount: 4,
      excludedSampleCount: 0,
    };
    expect(computeOtsuThreshold(histogram)).toBe(2);
  });

  it("falls back to the range midpoint when no split separates two classes", () => {
    const constantBand: BandHistogram = {
      bins: Uint32Array.from([0, 5, 0, 0]),
      binCount: 4,
      min: 0,
      max: 3,
      binWidth: 1,
      totalSampleCount: 5,
      excludedSampleCount: 0,
    };
    expect(computeOtsuThreshold(constantBand)).toBe(1.5);
  });

  it("scales the cutoff by the bin width for wide-range histograms", () => {
    const bins = new Uint32Array(256);
    bins[10] = 4;
    bins[100] = 4;
    const histogram: BandHistogram = {
      bins,
      binCount: 256,
      min: 0,
      max: 65535,
      binWidth: 256,
      totalSampleCount: 8,
      excludedSampleCount: 0,
    };
    expect(computeOtsuThreshold(histogram)).toBe(11 * 256);
  });
});

describe("computeOtsuBoundsForHistogram", () => {
  it("returns the Otsu cutoff as the lower bound and the histogram max as the upper", () => {
    expect(computeOtsuBoundsForHistogram(makeBimodalHistogram())).toEqual({
      lower: 55,
      upper: 255,
    });
  });
});
