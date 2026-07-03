import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

import {
  THRESHOLD_ACTION,
  THRESHOLD_BAND_RANGE_PARAMETER_ID,
  THRESHOLD_LOWER_BOUND_PARAMETER_ID,
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

function transformedRaster(parameterValues: Record<string, number | string>): RasterImage {
  const output = THRESHOLD_ACTION.transformSource!(makeTwoBandUint8Source(), parameterValues);
  if (output.kind !== "raster") throw new Error("expected a raster output");
  return output.raster;
}

const BOUNDS_PARAMS = {
  [THRESHOLD_LOWER_BOUND_PARAMETER_ID]: 100,
  [THRESHOLD_UPPER_BOUND_PARAMETER_ID]: 130,
};

describe("THRESHOLD_ACTION.transformSource", () => {
  it("band-wise scope yields one binary band per entered band", () => {
    const raster = transformedRaster({
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

  it("full-stack scope combines all bands into a single binary band", () => {
    const raster = transformedRaster({
      ...BOUNDS_PARAMS,
      [THRESHOLD_SCOPE_PARAMETER_ID]: "full-cube",
    });
    expect(raster.bandCount).toBe(1);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([255, 0, 0, 0]);
  });

  it("throws when the bounds parameters are missing", () => {
    expect(() => transformedRaster({ [THRESHOLD_SCOPE_PARAMETER_ID]: "full-cube" })).toThrow(
      "Adjust the bounds first",
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

  it("clears the consumed bounds from the source state after Apply", () => {
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      thresholdBounds: { lower: 1, upper: 2 },
    };
    expect(THRESHOLD_ACTION.clearConsumedSourceStateAfterApply!(state).thresholdBounds).toBeNull();
  });
});
