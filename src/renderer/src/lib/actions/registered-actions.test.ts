import { describe, expect, it } from "vitest";

import { BLACK_WHITE_POINTS_ACTION, REGISTERED_VIEWPORT_ACTIONS } from "./registered-actions";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "./viewport-action";
import type { RasterImage } from "@/lib/image/raster-image";

describe("REGISTERED_VIEWPORT_ACTIONS", () => {
  it("does not register Normalized viewing as an audited operation (it is a view-only display aid)", () => {
    const registeredActionIds = REGISTERED_VIEWPORT_ACTIONS.map((action) => action.id);
    expect(registeredActionIds).not.toContain("normalize");
  });

  it("registers only the data-changing operations that belong in the audit trail", () => {
    const registeredActionIds = REGISTERED_VIEWPORT_ACTIONS.map((action) => action.id);
    expect(registeredActionIds).toEqual([
      "bit-shift",
      "crop-to-region",
      "flat-field",
      "spectralon",
      "black-white-points",
    ]);
  });
});

function makeSingleBandUint8Raster(values: ReadonlyArray<number>): RasterImage {
  return {
    bandPixels: [Uint8Array.from(values)],
    width: values.length,
    height: 1,
    bandCount: 1,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

describe("BLACK_WHITE_POINTS_ACTION", () => {
  it("is unavailable until histogram black/white markers have been positioned", () => {
    expect(BLACK_WHITE_POINTS_ACTION.isAvailableForActiveViewport!(DEFAULT_VIEWPORT_RENDERING_STATE)).toBe(false);
    const withPoints = { ...DEFAULT_VIEWPORT_RENDERING_STATE, blackWhitePoints: { black: 0, white: 128 } };
    expect(BLACK_WHITE_POINTS_ACTION.isAvailableForActiveViewport!(withPoints)).toBe(true);
  });

  it("injects the marker values and selected band index for the audit trail", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 2, blackWhitePoints: { black: 10, white: 200 } };
    const prepared = BLACK_WHITE_POINTS_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    expect(prepared).toMatchObject({ blackPoint: 10, whitePoint: 200, targetBandIndex: 2 });
  });

  it("stretches the selected band when transforming the source", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, blackWhitePoints: { black: 0, white: 128 } };
    const prepared = BLACK_WHITE_POINTS_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    const result = BLACK_WHITE_POINTS_ACTION.transformSource!(
      { kind: "raster", raster: makeSingleBandUint8Raster([0, 64, 128, 255]) },
      prepared,
    );
    expect(result.kind).toBe("raster");
    expect(Array.from((result as { raster: RasterImage }).raster.bandPixels[0]!)).toEqual([0, 128, 255, 255]);
  });

  it("records the two point values and the ROI in the applied label", () => {
    const roi = { imagePixelX0: 1, imagePixelY0: 2, imagePixelX1: 5, imagePixelY1: 6 };
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, roi, blackWhitePoints: { black: 10, white: 200 } };
    const prepared = BLACK_WHITE_POINTS_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    expect(BLACK_WHITE_POINTS_ACTION.formatAppliedLabel!(prepared)).toBe(
      "Stretch contrast [10, 200] in (1, 2) - (5, 6)",
    );
  });
});
