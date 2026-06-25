import { describe, expect, it } from "vitest";

import {
  buildMonotoneToneCurve,
  evaluateToneCurveAtInput,
} from "@/lib/image/apply-tone-curve";
import { computeBandHistogramFromRaster } from "@/lib/image/compute-band-histogram";
import { buildDefaultToneCurveAnchors } from "@/lib/image/tone-curve-editor-state";
import type { RasterImage, RasterSampleFormat, RasterTypedArray } from "@/lib/image/raster-image";
import { buildToneCurveValueRanges } from "@/components/histogram-section";

// CT-198: opening the Tone Curve panel must leave a float band looking exactly the same
// until the user moves a node, matching the integer case and GIMP. That requires the
// DEFAULT two-endpoint curve to be a true identity in the data domain: output == input at
// both endpoints, so evaluating it at any band value returns that value. The fix sources
// the float anchor OUTPUT range from the band's own value extents (the same extents the
// INPUT range uses) instead of the fixed {0, 1} window.

function makeSingleBandRaster(
  band: RasterTypedArray,
  sampleFormat: RasterSampleFormat,
  bitsPerSample: number,
): RasterImage {
  return { bandPixels: [band], width: 2, height: 2, bandCount: 1, sampleFormat, bitsPerSample };
}

function buildDefaultCurveForRaster(raster: RasterImage) {
  const histogram = computeBandHistogramFromRaster(raster, 0);
  const ranges = buildToneCurveValueRanges(raster, 0, histogram);
  return buildMonotoneToneCurve(buildDefaultToneCurveAnchors(ranges));
}

describe("the default tone curve is a true identity", () => {
  // A float band whose extents straddle [0, 1] (min < 0, max > 1).
  const FLOAT_BAND = Float32Array.from([-0.05, 0.5855, 1.1, 0.42]);
  const FLOAT_SAMPLE_VALUES = [-0.05, -0.04, 0, 0.42, 0.5855, 1, 1.05, 1.1];

  it("maps every float band value to itself (in-range mid-tones, endpoints, out-of-[0,1])", () => {
    const curve = buildDefaultCurveForRaster(makeSingleBandRaster(FLOAT_BAND, "float", 32));
    for (const value of FLOAT_SAMPLE_VALUES) {
      expect(evaluateToneCurveAtInput(curve, value)).toBeCloseTo(value, 5);
    }
  });

  it("keeps the integer default an identity (its histogram range is the type container)", () => {
    const integerBand = Uint8Array.from([0, 85, 170, 255]);
    const curve = buildDefaultCurveForRaster(makeSingleBandRaster(integerBand, "uint", 8));
    for (const value of [0, 85, 128, 200, 255]) {
      expect(evaluateToneCurveAtInput(curve, value)).toBeCloseTo(value, 5);
    }
  });
});
