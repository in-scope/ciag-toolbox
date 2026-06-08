import { describe, expect, it } from "vitest";

import {
  BLACK_WHITE_POINTS_ACTION,
  BRIGHTNESS_CONTRAST_ACTION,
  FALSE_COLOR_ACTION,
  INVERT_ACTION,
  NORMALIZE_DATA_ACTION,
  REGISTERED_VIEWPORT_ACTIONS,
  RGB_TO_GRAYSCALE_ACTION,
} from "./registered-actions";
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
      "brightness-contrast",
      "invert",
      "normalize-data",
      "standardize",
      "rgb-to-grayscale",
      "false-color",
    ]);
  });

  it("keeps the data-changing Normalize distinct from the view-only normalize id", () => {
    expect(NORMALIZE_DATA_ACTION.id).toBe("normalize-data");
  });
});

function makeTwoBandUint8Raster(
  bandOne: ReadonlyArray<number>,
  bandTwo: ReadonlyArray<number>,
): RasterImage {
  return {
    bandPixels: [Uint8Array.from(bandOne), Uint8Array.from(bandTwo)],
    width: bandOne.length,
    height: 1,
    bandCount: 2,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

describe("BRIGHTNESS_CONTRAST_ACTION", () => {
  it("brightens only the selected band by a percentage of the data-type range", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 1 };
    const prepared = BRIGHTNESS_CONTRAST_ACTION.prepareParameterValuesForApply!(
      { brightnessPercent: 10, contrastRatio: 1, applyToAllBands: false },
      state,
      "whole-image",
    );
    const result = BRIGHTNESS_CONTRAST_ACTION.transformSource!(
      { kind: "raster", raster: makeTwoBandUint8Raster([0, 100], [0, 100]) },
      prepared,
    );
    const raster = (result as { raster: RasterImage }).raster;
    expect(Array.from(raster.bandPixels[0]!)).toEqual([0, 100]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([26, 126]);
  });

  it("applies to every band when the all-bands flag is set", () => {
    const prepared = BRIGHTNESS_CONTRAST_ACTION.prepareParameterValuesForApply!(
      { brightnessPercent: 0, contrastRatio: 0, applyToAllBands: true },
      DEFAULT_VIEWPORT_RENDERING_STATE,
      "whole-image",
    );
    const result = BRIGHTNESS_CONTRAST_ACTION.transformSource!(
      { kind: "raster", raster: makeTwoBandUint8Raster([0, 100], [40, 60]) },
      prepared,
    );
    const raster = (result as { raster: RasterImage }).raster;
    expect(Array.from(raster.bandPixels[0]!)).toEqual([50, 50]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([50, 50]);
  });

  it("records the slider values and affected bands in the applied label", () => {
    const prepared = BRIGHTNESS_CONTRAST_ACTION.prepareParameterValuesForApply!(
      { brightnessPercent: -20, contrastRatio: 1.5, applyToAllBands: true },
      DEFAULT_VIEWPORT_RENDERING_STATE,
      "whole-image",
    );
    expect(BRIGHTNESS_CONTRAST_ACTION.formatAppliedLabel!(prepared)).toBe(
      "Brightness -20%, contrast 1.50 (all bands)",
    );
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

function makeTwoBandFloatRaster(
  bandOne: ReadonlyArray<number>,
  bandTwo: ReadonlyArray<number>,
): RasterImage {
  return {
    bandPixels: [Float32Array.from(bandOne), Float32Array.from(bandTwo)],
    width: bandOne.length,
    height: 1,
    bandCount: 2,
    sampleFormat: "float",
    bitsPerSample: 32,
  };
}

describe("INVERT_ACTION", () => {
  it("inverts only the selected uint8 band as 255 minus the value", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 1 };
    const prepared = INVERT_ACTION.prepareParameterValuesForApply!(
      { applyToAllBands: false },
      state,
      "whole-image",
    );
    const result = INVERT_ACTION.transformSource!(
      { kind: "raster", raster: makeTwoBandUint8Raster([0, 255], [0, 100]) },
      prepared,
    );
    const raster = (result as { raster: RasterImage }).raster;
    expect(Array.from(raster.bandPixels[0]!)).toEqual([0, 255]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([255, 155]);
  });

  it("inverts every band of a float [0,1] cube when the all-bands flag is set", () => {
    const prepared = INVERT_ACTION.prepareParameterValuesForApply!(
      { applyToAllBands: true },
      DEFAULT_VIEWPORT_RENDERING_STATE,
      "whole-image",
    );
    const result = INVERT_ACTION.transformSource!(
      { kind: "raster", raster: makeTwoBandFloatRaster([0, 0.25], [0.75, 1]) },
      prepared,
    );
    const raster = (result as { raster: RasterImage }).raster;
    expect(Array.from(raster.bandPixels[0]!)).toEqual([1, 0.75]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([0.25, 0]);
  });

  it("rejects an unbounded float raster with a user-readable error", () => {
    const prepared = INVERT_ACTION.prepareParameterValuesForApply!(
      { applyToAllBands: true },
      DEFAULT_VIEWPORT_RENDERING_STATE,
      "whole-image",
    );
    expect(() =>
      INVERT_ACTION.transformSource!(
        { kind: "raster", raster: makeTwoBandFloatRaster([0, 1.5], [0, 0.5]) },
        prepared,
      ),
    ).toThrow(/bounded data range/i);
  });

  it("records the affected bands in the applied label", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 3 };
    const single = INVERT_ACTION.prepareParameterValuesForApply!({ applyToAllBands: false }, state, "whole-image");
    expect(INVERT_ACTION.formatAppliedLabel!(single)).toBe("Invert (band 4)");
    const all = INVERT_ACTION.prepareParameterValuesForApply!({ applyToAllBands: true }, state, "whole-image");
    expect(INVERT_ACTION.formatAppliedLabel!(all)).toBe("Invert (all bands)");
  });
});

describe("NORMALIZE_DATA_ACTION", () => {
  it("normalizes the whole cube by one cube-wide min and max in full-cube scope", () => {
    const prepared = NORMALIZE_DATA_ACTION.prepareParameterValuesForApply!(
      { scope: "full-cube" },
      DEFAULT_VIEWPORT_RENDERING_STATE,
      "whole-image",
    );
    const result = NORMALIZE_DATA_ACTION.transformSource!(
      { kind: "raster", raster: makeTwoBandUint8Raster([0, 100], [100, 200]) },
      prepared,
    );
    const raster = (result as { raster: RasterImage }).raster;
    expect(Array.from(raster.bandPixels[1]!)).toEqual([0.5, 1]);
  });

  it("normalizes only the selected band by its own min and max in band-wise scope", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 1 };
    const prepared = NORMALIZE_DATA_ACTION.prepareParameterValuesForApply!(
      { scope: "band-wise" },
      state,
      "whole-image",
    );
    const result = NORMALIZE_DATA_ACTION.transformSource!(
      { kind: "raster", raster: makeTwoBandUint8Raster([0, 100], [100, 200]) },
      prepared,
    );
    const raster = (result as { raster: RasterImage }).raster;
    expect(Array.from(raster.bandPixels[0]!)).toEqual([0, 100]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([0, 1]);
  });

  it("records the scope and selected band in the applied label", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 2 };
    const fullCube = NORMALIZE_DATA_ACTION.prepareParameterValuesForApply!({ scope: "full-cube" }, state, "whole-image");
    expect(NORMALIZE_DATA_ACTION.formatAppliedLabel!(fullCube)).toBe("Normalize to [0,1] (full cube)");
    const bandWise = NORMALIZE_DATA_ACTION.prepareParameterValuesForApply!({ scope: "band-wise" }, state, "whole-image");
    expect(NORMALIZE_DATA_ACTION.formatAppliedLabel!(bandWise)).toBe("Normalize to [0,1] (band-wise: band 3)");
  });
});

function makeThreeBandUint8Raster(
  bandOne: ReadonlyArray<number>,
  bandTwo: ReadonlyArray<number>,
  bandThree: ReadonlyArray<number>,
): RasterImage {
  return {
    bandPixels: [Uint8Array.from(bandOne), Uint8Array.from(bandTwo), Uint8Array.from(bandThree)],
    width: bandOne.length,
    height: 1,
    bandCount: 3,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

describe("RGB_TO_GRAYSCALE_ACTION", () => {
  it("collapses a 3-band RGB raster to a single band with the default luminance weights", () => {
    const result = RGB_TO_GRAYSCALE_ACTION.transformSource!(
      { kind: "raster", raster: makeThreeBandUint8Raster([100], [200], [50]) },
      { redWeight: 0.299, greenWeight: 0.587, blueWeight: 0.114 },
    );
    const raster = (result as { raster: RasterImage }).raster;
    expect(raster.bandCount).toBe(1);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([Math.round(100 * 0.299 + 200 * 0.587 + 50 * 0.114)]);
  });

  it("rejects a source that is not 3-band RGB with a clear error", () => {
    expect(() =>
      RGB_TO_GRAYSCALE_ACTION.transformSource!(
        { kind: "raster", raster: makeTwoBandUint8Raster([1], [2]) },
        { redWeight: 0.299, greenWeight: 0.587, blueWeight: 0.114 },
      ),
    ).toThrow(/3-band RGB/i);
  });

  it("resets the selected band to the single produced band after applying", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 2 };
    const next = RGB_TO_GRAYSCALE_ACTION.apply(state, { redWeight: 0.299, greenWeight: 0.587, blueWeight: 0.114 });
    expect(next.selectedBandIndex).toBe(0);
  });

  it("records the weights used in the applied label", () => {
    expect(
      RGB_TO_GRAYSCALE_ACTION.formatAppliedLabel!({ redWeight: 0.299, greenWeight: 0.587, blueWeight: 0.114 }),
    ).toBe("RGB to grayscale (R 0.299, G 0.587, B 0.114)");
  });
});

describe("FALSE_COLOR_ACTION", () => {
  it("maps the three chosen bands to the R, G, and B channels, order-sensitive", () => {
    const result = FALSE_COLOR_ACTION.transformSource!(
      { kind: "raster", raster: makeThreeBandUint8Raster([10], [20], [30]) },
      { redBandNumber: 3, greenBandNumber: 1, blueBandNumber: 2 },
    );
    const raster = (result as { raster: RasterImage }).raster;
    expect(raster.bandCount).toBe(3);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([30]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([10]);
    expect(Array.from(raster.bandPixels[2]!)).toEqual([20]);
  });

  it("rejects a band number outside the source's band range", () => {
    expect(() =>
      FALSE_COLOR_ACTION.transformSource!(
        { kind: "raster", raster: makeThreeBandUint8Raster([10], [20], [30]) },
        { redBandNumber: 1, greenBandNumber: 2, blueBandNumber: 4 },
      ),
    ).toThrow(/out of range/i);
  });

  it("resets the selected band after the band count changes", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 7 };
    const next = FALSE_COLOR_ACTION.apply(state, { redBandNumber: 1, greenBandNumber: 2, blueBandNumber: 3 });
    expect(next.selectedBandIndex).toBe(0);
  });

  it("records the three band assignments in the applied label", () => {
    expect(
      FALSE_COLOR_ACTION.formatAppliedLabel!({ redBandNumber: 5, greenBandNumber: 3, blueBandNumber: 8 }),
    ).toBe("False-color (R band 5, G band 3, B band 8)");
  });
});
