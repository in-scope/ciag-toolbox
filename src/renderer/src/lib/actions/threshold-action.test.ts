import { describe, expect, it } from "vitest";

import { sumBandHistogramsSharingOneRange } from "@/lib/image/combined-band-histogram";
import { computeBandHistogramFromRaster } from "@/lib/image/compute-band-histogram";
import type { RasterImage } from "@/lib/image/raster-image";
import { computeOtsuBoundsForHistogram, computeOtsuThreshold } from "@/lib/image/threshold/otsu";
import { applyManualThreshold } from "@/lib/image/threshold/threshold";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import {
  MANUAL_THRESHOLD_METHOD,
  OTSU_THRESHOLD_METHOD,
  THRESHOLD_ACTION,
  THRESHOLD_BAND_RANGE_PARAMETER_ID,
  THRESHOLD_LOWER_BOUND_PARAMETER_ID,
  THRESHOLD_METHOD_PARAMETER_ID,
  THRESHOLD_OTSU_SCOPE_PARAMETER_ID,
  THRESHOLD_SCOPE_PARAMETER_ID,
  THRESHOLD_UPPER_BOUND_PARAMETER_ID,
} from "./threshold-action";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "./viewport-action";

function makeTwoBandUint8Raster(): RasterImage {
  return {
    bandPixels: [Uint8Array.from([100, 120, 200, 250]), Uint8Array.from([100, 200, 120, 250])],
    width: 2,
    height: 2,
    bandCount: 2,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

function makeTwoBandUint8Source(): ViewportImageSource {
  return { kind: "raster", raster: makeTwoBandUint8Raster() };
}

async function transformedRaster(
  parameterValues: Record<string, number | string>,
): Promise<RasterImage> {
  const output = await THRESHOLD_ACTION.transformSourceAsync!(makeTwoBandUint8Source(), parameterValues);
  if (output.kind !== "raster") throw new Error("expected a raster output");
  return output.raster;
}

const BOUNDS_PARAMS = {
  [THRESHOLD_LOWER_BOUND_PARAMETER_ID]: 100,
  [THRESHOLD_UPPER_BOUND_PARAMETER_ID]: 130,
};

describe("THRESHOLD_ACTION manual transform", () => {
  it("band-wise scope yields one binary band per entered band", async () => {
    const raster = await transformedRaster({
      ...BOUNDS_PARAMS,
      [THRESHOLD_SCOPE_PARAMETER_ID]: "band-wise",
      [THRESHOLD_BAND_RANGE_PARAMETER_ID]: "1-2",
    });
    expect(raster.bandCount).toBe(2);
    expect(raster.sampleFormat).toBe("uint");
    expect(raster.bitsPerSample).toBe(8);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([255, 255, 0, 0]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([255, 0, 255, 0]);
  });

  // CT-282: full stack never combines bands - the bounds apply uniformly to
  // every band and the output keeps the source band count.
  it("full-stack scope applies the bounds to every band and keeps the band count", async () => {
    const raster = await transformedRaster({
      ...BOUNDS_PARAMS,
      [THRESHOLD_SCOPE_PARAMETER_ID]: "full-cube",
    });
    expect(raster.bandCount).toBe(2);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([255, 255, 0, 0]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([255, 0, 255, 0]);
  });

  it("throws when the bounds parameters are missing", async () => {
    await expect(transformedRaster({ [THRESHOLD_SCOPE_PARAMETER_ID]: "full-cube" })).rejects.toThrow(
      "Adjust the bounds first",
    );
  });
});

// CT-282: the Otsu method derives its cutoffs inside the Apply transform; both
// scopes output a binary stack with the SOURCE band count.
describe("THRESHOLD_ACTION Otsu transform", () => {
  const OTSU_PARAMS = { [THRESHOLD_METHOD_PARAMETER_ID]: OTSU_THRESHOLD_METHOD };

  it("band-wise scope thresholds each band with its own computeOtsuThreshold cutoff", async () => {
    const source = makeTwoBandUint8Raster();
    const raster = await transformedRaster({
      ...OTSU_PARAMS,
      [THRESHOLD_OTSU_SCOPE_PARAMETER_ID]: "band-wise",
    });
    expect(raster.bandCount).toBe(source.bandCount);
    for (let bandIndex = 0; bandIndex < source.bandCount; bandIndex += 1) {
      const histogram = computeBandHistogramFromRaster(source, bandIndex);
      const expected = applyManualThreshold(source.bandPixels[bandIndex]!, {
        lower: computeOtsuThreshold(histogram),
        upper: histogram.max,
      });
      expect(Array.from(raster.bandPixels[bandIndex]!)).toEqual(Array.from(expected));
    }
  });

  it("full-stack scope applies the single combined-histogram cutoff to every band", async () => {
    const source = makeTwoBandUint8Raster();
    const combinedBounds = computeOtsuBoundsForHistogram(
      sumBandHistogramsSharingOneRange([
        computeBandHistogramFromRaster(source, 0),
        computeBandHistogramFromRaster(source, 1),
      ]),
    );
    const raster = await transformedRaster({
      ...OTSU_PARAMS,
      [THRESHOLD_OTSU_SCOPE_PARAMETER_ID]: "full-cube",
    });
    expect(raster.bandCount).toBe(source.bandCount);
    for (let bandIndex = 0; bandIndex < source.bandCount; bandIndex += 1) {
      const expected = applyManualThreshold(source.bandPixels[bandIndex]!, combinedBounds);
      expect(Array.from(raster.bandPixels[bandIndex]!)).toEqual(Array.from(expected));
    }
  });

  it("defaults to the band-wise scope when no Otsu scope is given", async () => {
    const source = makeTwoBandUint8Raster();
    const explicit = await transformedRaster({
      ...OTSU_PARAMS,
      [THRESHOLD_OTSU_SCOPE_PARAMETER_ID]: "band-wise",
    });
    const defaulted = await transformedRaster(OTSU_PARAMS);
    expect(defaulted.bandCount).toBe(source.bandCount);
    expect(defaulted.bandPixels.map((band) => Array.from(band))).toEqual(
      explicit.bandPixels.map((band) => Array.from(band)),
    );
  });
});

describe("THRESHOLD_ACTION.prepareParameterValuesForApply", () => {
  it("injects the live bounds and the selected band from the rendering state", () => {
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      thresholdBounds: { lower: 105, upper: 118 },
      selectedBandIndex: 1,
    };
    const prepared = THRESHOLD_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    expect(prepared[THRESHOLD_LOWER_BOUND_PARAMETER_ID]).toBe(105);
    expect(prepared[THRESHOLD_UPPER_BOUND_PARAMETER_ID]).toBe(118);
  });

  it("throws when no bounds have been set yet", () => {
    expect(() =>
      THRESHOLD_ACTION.prepareParameterValuesForApply!(
        {},
        DEFAULT_VIEWPORT_RENDERING_STATE,
        "whole-image",
      ),
    ).toThrow("Adjust the bounds first");
  });

  // CT-282: the Otsu method has no bounds fields, so Apply must not demand any.
  it("requires no bounds for the Otsu method and injects nothing", () => {
    const raw = { [THRESHOLD_METHOD_PARAMETER_ID]: OTSU_THRESHOLD_METHOD };
    const prepared = THRESHOLD_ACTION.prepareParameterValuesForApply!(
      raw,
      DEFAULT_VIEWPORT_RENDERING_STATE,
      "whole-image",
    );
    expect(prepared).toEqual(raw);
  });
});

describe("THRESHOLD_ACTION applied label", () => {
  it("records the bounds and the band-wise scope", () => {
    const label = THRESHOLD_ACTION.formatAppliedLabel!({
      ...BOUNDS_PARAMS,
      [THRESHOLD_SCOPE_PARAMETER_ID]: "band-wise",
      [THRESHOLD_BAND_RANGE_PARAMETER_ID]: "1-2",
    });
    expect(label).toBe("Threshold [100, 130] (band-wise: bands 1-2)");
  });

  it("records the full-stack scope without any combining wording", () => {
    const label = THRESHOLD_ACTION.formatAppliedLabel!({
      ...BOUNDS_PARAMS,
      [THRESHOLD_SCOPE_PARAMETER_ID]: "full-cube",
    });
    expect(label).toBe("Threshold [100, 130] (full stack)");
  });

  it("records the Otsu method with its band-wise scope", () => {
    const label = THRESHOLD_ACTION.formatAppliedLabel!({
      [THRESHOLD_METHOD_PARAMETER_ID]: OTSU_THRESHOLD_METHOD,
      [THRESHOLD_OTSU_SCOPE_PARAMETER_ID]: "band-wise",
    });
    expect(label).toBe("Threshold Otsu (band-wise)");
  });

  it("records the Otsu method with its full-stack scope", () => {
    const label = THRESHOLD_ACTION.formatAppliedLabel!({
      [THRESHOLD_METHOD_PARAMETER_ID]: OTSU_THRESHOLD_METHOD,
      [THRESHOLD_OTSU_SCOPE_PARAMETER_ID]: "full-cube",
    });
    expect(label).toBe("Threshold Otsu (full stack)");
  });

  it("clears the consumed bounds from the source state after Apply", () => {
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      thresholdBounds: { lower: 1, upper: 2 },
    };
    expect(THRESHOLD_ACTION.clearConsumedSourceStateAfterApply!(state).thresholdBounds).toBeNull();
  });
});

describe("THRESHOLD_ACTION method parameter", () => {
  it("offers Manual and Otsu threshold with Manual as the default", () => {
    const methodSchema = THRESHOLD_ACTION.parameters!.find(
      (schema) => schema.id === THRESHOLD_METHOD_PARAMETER_ID,
    );
    expect(methodSchema).toMatchObject({
      kind: "enum",
      defaultValue: MANUAL_THRESHOLD_METHOD,
      options: [
        { value: MANUAL_THRESHOLD_METHOD, label: "Manual" },
        { value: OTSU_THRESHOLD_METHOD, label: "Otsu threshold" },
      ],
    });
  });
});

describe("THRESHOLD_ACTION progress (CT-222)", () => {
  it("band-wise thresholding ticks once per entered band", async () => {
    const ticks: number[] = [];
    await THRESHOLD_ACTION.transformSourceAsync!(
      makeTwoBandUint8Source(),
      {
        ...BOUNDS_PARAMS,
        [THRESHOLD_SCOPE_PARAMETER_ID]: "band-wise",
        [THRESHOLD_BAND_RANGE_PARAMETER_ID]: "1-2",
      },
      (fraction) => ticks.push(fraction),
    );
    expect(ticks).toEqual([0, 1 / 2, 1]);
  });

  it("full-stack thresholding ticks once per source band", async () => {
    const ticks: number[] = [];
    await THRESHOLD_ACTION.transformSourceAsync!(
      makeTwoBandUint8Source(),
      { ...BOUNDS_PARAMS, [THRESHOLD_SCOPE_PARAMETER_ID]: "full-cube" },
      (fraction) => ticks.push(fraction),
    );
    expect(ticks).toEqual([0, 1 / 2, 1]);
  });

  it("the Otsu method reports monotonic 0..1 progress across derive and threshold", async () => {
    const ticks: number[] = [];
    await THRESHOLD_ACTION.transformSourceAsync!(
      makeTwoBandUint8Source(),
      { [THRESHOLD_METHOD_PARAMETER_ID]: OTSU_THRESHOLD_METHOD },
      (fraction) => ticks.push(fraction),
    );
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(1);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!).toBeGreaterThanOrEqual(ticks[i - 1]!);
    }
  });
});
