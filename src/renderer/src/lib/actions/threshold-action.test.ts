import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import {
  serializeThresholdOtsuCutoffsToJson,
  type ThresholdOtsuCutoffs,
} from "@/lib/image/threshold/otsu-cutoffs";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import {
  THRESHOLD_ACTION,
  THRESHOLD_BAND_RANGE_PARAMETER_ID,
  THRESHOLD_LOWER_BOUND_PARAMETER_ID,
  THRESHOLD_OTSU_CUTOFFS_PARAMETER_ID,
  THRESHOLD_SCOPE_PARAMETER_ID,
  THRESHOLD_UPPER_BOUND_PARAMETER_ID,
} from "./threshold-action";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "./viewport-action";

function makeTwoBandUint8Source(): ViewportImageSource {
  const raster: RasterImage = {
    bandPixels: [Uint8Array.from([100, 120, 200, 250]), Uint8Array.from([100, 200, 120, 250])],
    width: 2,
    height: 2,
    bandCount: 2,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
  return { kind: "raster", raster };
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

describe("THRESHOLD_ACTION.transformSource", () => {
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

  it("full-stack scope combines all bands into a single binary band", async () => {
    const raster = await transformedRaster({
      ...BOUNDS_PARAMS,
      [THRESHOLD_SCOPE_PARAMETER_ID]: "full-cube",
    });
    expect(raster.bandCount).toBe(1);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([255, 0, 0, 0]);
  });

  it("throws when the bounds parameters are missing", async () => {
    await expect(transformedRaster({ [THRESHOLD_SCOPE_PARAMETER_ID]: "full-cube" })).rejects.toThrow(
      "Adjust the bounds first",
    );
  });
});

// CT-201: Otsu cutoffs with a distinct cutoff per band plus one over the
// combined data, exercised against the two-band source above.
const OTSU_CUTOFFS: ThresholdOtsuCutoffs = {
  perBandBounds: [
    { lower: 150, upper: 255 },
    { lower: 210, upper: 255 },
  ],
  combinedBounds: { lower: 130, upper: 255 },
};

const OTSU_PARAMS = {
  [THRESHOLD_OTSU_CUTOFFS_PARAMETER_ID]: serializeThresholdOtsuCutoffsToJson(OTSU_CUTOFFS),
};

describe("THRESHOLD_ACTION.transformSource with Otsu cutoffs", () => {
  it("band-wise scope thresholds each band with its own cutoff", async () => {
    const raster = await transformedRaster({
      ...OTSU_PARAMS,
      [THRESHOLD_SCOPE_PARAMETER_ID]: "band-wise",
      [THRESHOLD_BAND_RANGE_PARAMETER_ID]: "1-2",
    });
    expect(raster.bandCount).toBe(2);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([0, 0, 255, 255]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([0, 0, 0, 255]);
  });

  it("full-stack scope applies the single combined cutoff to every band", async () => {
    const raster = await transformedRaster({
      ...OTSU_PARAMS,
      [THRESHOLD_SCOPE_PARAMETER_ID]: "full-cube",
    });
    expect(raster.bandCount).toBe(1);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([0, 0, 0, 255]);
  });
});

describe("THRESHOLD_ACTION.prepareParameterValuesForApply", () => {
  it("injects the serialized Otsu cutoffs when the Auto state is present", () => {
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      thresholdBounds: { lower: 150, upper: 255 },
      thresholdOtsuCutoffs: OTSU_CUTOFFS,
    };
    const prepared = THRESHOLD_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    expect(prepared[THRESHOLD_OTSU_CUTOFFS_PARAMETER_ID]).toBe(
      serializeThresholdOtsuCutoffsToJson(OTSU_CUTOFFS),
    );
  });

  it("omits the Otsu parameter for manually set bounds", () => {
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      thresholdBounds: { lower: 105, upper: 118 },
    };
    const prepared = THRESHOLD_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    expect(prepared[THRESHOLD_OTSU_CUTOFFS_PARAMETER_ID]).toBeUndefined();
  });

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

  it("records the combined full-stack scope", () => {
    const label = THRESHOLD_ACTION.formatAppliedLabel!({
      ...BOUNDS_PARAMS,
      [THRESHOLD_SCOPE_PARAMETER_ID]: "full-cube",
    });
    expect(label).toBe("Threshold [100, 130] (combined: full stack)");
  });

  it("records the Otsu-derived per-band cutoff list for the band-wise scope", () => {
    const label = THRESHOLD_ACTION.formatAppliedLabel!({
      ...OTSU_PARAMS,
      [THRESHOLD_SCOPE_PARAMETER_ID]: "band-wise",
      [THRESHOLD_BAND_RANGE_PARAMETER_ID]: "1-2",
    });
    expect(label).toBe("Threshold Otsu (band-wise cutoffs: band 1: 150, band 2: 210)");
  });

  it("records the single Otsu cutoff for the combined full-stack scope", () => {
    const label = THRESHOLD_ACTION.formatAppliedLabel!({
      ...OTSU_PARAMS,
      [THRESHOLD_SCOPE_PARAMETER_ID]: "full-cube",
    });
    expect(label).toBe("Threshold Otsu (cutoff 130, combined: full stack)");
  });

  it("clears the consumed Otsu cutoffs from the source state after Apply", () => {
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      thresholdBounds: { lower: 150, upper: 255 },
      thresholdOtsuCutoffs: OTSU_CUTOFFS,
    };
    const cleared = THRESHOLD_ACTION.clearConsumedSourceStateAfterApply!(state);
    expect(cleared.thresholdOtsuCutoffs).toBeNull();
  });

  it("clears the consumed bounds from the source state after Apply", () => {
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      thresholdBounds: { lower: 1, upper: 2 },
    };
    expect(THRESHOLD_ACTION.clearConsumedSourceStateAfterApply!(state).thresholdBounds).toBeNull();
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

  it("the combined full-stack output reports a single completion tick", async () => {
    const ticks: number[] = [];
    await THRESHOLD_ACTION.transformSourceAsync!(
      makeTwoBandUint8Source(),
      { ...BOUNDS_PARAMS, [THRESHOLD_SCOPE_PARAMETER_ID]: "full-cube" },
      (fraction) => ticks.push(fraction),
    );
    expect(ticks).toEqual([1]);
  });
});
