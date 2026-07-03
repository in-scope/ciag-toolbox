import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";

import {
  computeOtsuCutoffsForRaster,
  parseThresholdOtsuCutoffsFromJson,
  serializeThresholdOtsuCutoffsToJson,
} from "./otsu-cutoffs";

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

describe("computeOtsuCutoffsForRaster", () => {
  it("derives one cutoff per band from each band's own histogram", () => {
    const cutoffs = computeOtsuCutoffsForRaster(makeTwoBandUint8Raster());
    expect(cutoffs.perBandBounds).toEqual([
      { lower: 11, upper: 255 },
      { lower: 51, upper: 255 },
    ]);
  });

  it("derives the combined cutoff over all bands' values together", () => {
    const cutoffs = computeOtsuCutoffsForRaster(makeTwoBandUint8Raster());
    expect(cutoffs.combinedBounds).toEqual({ lower: 51, upper: 255 });
  });

  it("uses each float band's own value extents for its bounds", () => {
    const raster: RasterImage = {
      bandPixels: [Float32Array.from([0, 0, 4, 4])],
      width: 2,
      height: 2,
      bandCount: 1,
      sampleFormat: "float",
      bitsPerSample: 32,
    };
    const cutoffs = computeOtsuCutoffsForRaster(raster);
    const bounds = cutoffs.perBandBounds[0]!;
    expect(bounds.upper).toBe(4);
    expect(bounds.lower).toBeGreaterThan(0);
    expect(bounds.lower).toBeLessThan(4);
  });
});

describe("threshold Otsu cutoff serialization", () => {
  it("round-trips through JSON", () => {
    const cutoffs = computeOtsuCutoffsForRaster(makeTwoBandUint8Raster());
    const roundTripped = parseThresholdOtsuCutoffsFromJson(
      serializeThresholdOtsuCutoffsToJson(cutoffs),
    );
    expect(roundTripped).toEqual(cutoffs);
  });
});
