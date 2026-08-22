import { describe, expect, it } from "vitest";

import {
  computeBandHistogramFromBandPixels,
  DEFAULT_BAND_HISTOGRAM_BIN_COUNT,
} from "@/lib/image/compute-band-histogram";
import type { RasterImage } from "@/lib/image/raster-image";

import { computeOtsuBoundsForHistogram } from "./otsu";
import { computeOtsuCutoffsForRasterReportingProgress } from "./otsu-cutoffs";

// Two 2x2 uint8 bands with well-separated clusters. Otsu keeps the first
// maximizing split, so a cluster pair {a, b} with an empty valley yields the
// cutoff a + 1 (the value just above the darker cluster).
function makeTwoBandUint8Raster(): RasterImage {
  return {
    bandPixels: [Uint8Array.from([10, 10, 200, 200]), Uint8Array.from([50, 50, 220, 220])],
    width: 2,
    height: 2,
    bandCount: 2,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

function makeTwoBandFloatRaster(): RasterImage {
  return {
    bandPixels: [Float32Array.from([0, 0.5, 4, 4]), Float32Array.from([-2, -2, 9, 9.5])],
    width: 2,
    height: 2,
    bandCount: 2,
    sampleFormat: "float",
    bitsPerSample: 32,
  };
}

// The pre-CT-219d combined path: one flat copy of every band's values. Kept
// here as the equivalence reference for the accumulate-based combined cutoff.
function concatenateAllBandValues(raster: RasterImage): Float64Array {
  const totalLength = raster.bandPixels.reduce((sum, band) => sum + band.length, 0);
  const combined = new Float64Array(totalLength);
  let offset = 0;
  for (const band of raster.bandPixels) {
    combined.set(band, offset);
    offset += band.length;
  }
  return combined;
}

function computeCombinedBoundsByConcatenating(raster: RasterImage): { lower: number; upper: number } {
  return computeOtsuBoundsForHistogram(
    computeBandHistogramFromBandPixels({
      pixels: concatenateAllBandValues(raster),
      sampleFormat: raster.sampleFormat,
      bitsPerSample: raster.bitsPerSample,
      binCount: DEFAULT_BAND_HISTOGRAM_BIN_COUNT,
    }),
  );
}

describe("computeOtsuCutoffsForRasterReportingProgress", () => {
  it("derives one cutoff per band from each band's own histogram", async () => {
    const cutoffs = await computeOtsuCutoffsForRasterReportingProgress(makeTwoBandUint8Raster());
    expect(cutoffs.perBandBounds).toEqual([
      { lower: 11, upper: 255 },
      { lower: 51, upper: 255 },
    ]);
  });

  it("derives the combined cutoff over all bands' values together", async () => {
    const cutoffs = await computeOtsuCutoffsForRasterReportingProgress(makeTwoBandUint8Raster());
    expect(cutoffs.combinedBounds).toEqual({ lower: 51, upper: 255 });
  });

  it("uses each float band's own value extents for its bounds", async () => {
    const raster: RasterImage = {
      bandPixels: [Float32Array.from([0, 0, 4, 4])],
      width: 2,
      height: 2,
      bandCount: 1,
      sampleFormat: "float",
      bitsPerSample: 32,
    };
    const cutoffs = await computeOtsuCutoffsForRasterReportingProgress(raster);
    const bounds = cutoffs.perBandBounds[0]!;
    expect(bounds.upper).toBe(4);
    expect(bounds.lower).toBeGreaterThan(0);
    expect(bounds.lower).toBeLessThan(4);
  });

  it("matches the concatenated combined cutoff for an integer stack", async () => {
    const raster = makeTwoBandUint8Raster();
    const cutoffs = await computeOtsuCutoffsForRasterReportingProgress(raster);
    expect(cutoffs.combinedBounds).toEqual(computeCombinedBoundsByConcatenating(raster));
  });

  it("matches the concatenated combined cutoff for a float stack with differing band extents", async () => {
    const raster = makeTwoBandFloatRaster();
    const cutoffs = await computeOtsuCutoffsForRasterReportingProgress(raster);
    expect(cutoffs.combinedBounds).toEqual(computeCombinedBoundsByConcatenating(raster));
  });

  it("ticks once per band from 0 to 1 on an integer stack (combined cutoff needs no second sweep)", async () => {
    const fractions: number[] = [];
    await computeOtsuCutoffsForRasterReportingProgress(makeTwoBandUint8Raster(), (fraction) =>
      fractions.push(fraction),
    );
    expect(fractions).toEqual([0, 0.5, 1]);
  });

  it("reports monotonic 0..1 progress across both float sweeps", async () => {
    const fractions: number[] = [];
    await computeOtsuCutoffsForRasterReportingProgress(makeTwoBandFloatRaster(), (fraction) =>
      fractions.push(fraction),
    );
    expect(fractions[0]).toBe(0);
    expect(fractions[fractions.length - 1]).toBe(1);
    expect(fractions.some((fraction) => fraction > 0.5 && fraction < 1)).toBe(true);
    for (let i = 1; i < fractions.length; i += 1) {
      expect(fractions[i]!).toBeGreaterThanOrEqual(fractions[i - 1]!);
    }
  });
});
