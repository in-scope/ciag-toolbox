import { describe, expect, it } from "vitest";

import {
  BRIGHTNESS_CONTRAST_ACTION,
  CROP_TO_REGION_ACTION,
  FALSE_COLOR_ACTION,
  INVERT_ACTION,
  NORMALIZE_DATA_ACTION,
  REGISTERED_VIEWPORT_ACTIONS,
  RGB_TO_GRAYSCALE_ACTION,
  ROTATE_REFLECT_ACTION,
  SPECTRALON_ACTION,
  TONE_CURVE_ACTION,
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
      "tone-curve",
      "brightness-contrast",
      "invert",
      "normalize-data",
      "standardize",
      "rgb-to-grayscale",
      "false-color",
      "rotate-reflect",
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

describe("TONE_CURVE_ACTION", () => {
  const linearStretchAnchors = [
    { input: 0, output: 0 },
    { input: 128, output: 255 },
  ];

  it("is unavailable until the tone-curve editor has produced anchors", () => {
    expect(TONE_CURVE_ACTION.isAvailableForActiveViewport!(DEFAULT_VIEWPORT_RENDERING_STATE)).toBe(false);
    const withAnchors = { ...DEFAULT_VIEWPORT_RENDERING_STATE, toneCurveAnchors: linearStretchAnchors };
    expect(TONE_CURVE_ACTION.isAvailableForActiveViewport!(withAnchors)).toBe(true);
  });

  it("injects the serialized anchors and selected band index for the audit trail", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 2, toneCurveAnchors: linearStretchAnchors };
    const prepared = TONE_CURVE_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    expect(prepared).toMatchObject({ targetBandIndex: 2, toneCurveAnchorsJson: "[[0,0],[128,255]]" });
  });

  it("applies the 2-anchor curve as a linear black/white stretch on the selected band", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, toneCurveAnchors: linearStretchAnchors };
    const prepared = TONE_CURVE_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    const result = TONE_CURVE_ACTION.transformSource!(
      { kind: "raster", raster: makeSingleBandUint8Raster([0, 64, 128, 255]) },
      prepared,
    );
    expect(result.kind).toBe("raster");
    expect(Array.from((result as { raster: RasterImage }).raster.bandPixels[0]!)).toEqual([0, 128, 255, 255]);
  });

  it("records the anchor count and the per-operation region in the applied label", () => {
    const operationRegion = { imagePixelX0: 1, imagePixelY0: 2, imagePixelX1: 5, imagePixelY1: 6 };
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      operationRegion,
      toneCurveAnchors: linearStretchAnchors,
    };
    const prepared = TONE_CURVE_ACTION.prepareParameterValuesForApply!({}, state, "roi");
    expect(TONE_CURVE_ACTION.formatAppliedLabel!(prepared)).toBe(
      "Tone curve (2 points) in (1, 2) - (5, 6)",
    );
  });

  it("ignores a stale inspection ROI and curves the whole band when scope is whole-image", () => {
    const roi = { imagePixelX0: 1, imagePixelY0: 2, imagePixelX1: 5, imagePixelY1: 6 };
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, roi, toneCurveAnchors: linearStretchAnchors };
    const prepared = TONE_CURVE_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    expect(TONE_CURVE_ACTION.formatAppliedLabel!(prepared)).toBe("Tone curve (2 points)");
  });
});

describe("region-requesting operations (CT-095)", () => {
  const operationRegion = { imagePixelX0: 2, imagePixelY0: 3, imagePixelX1: 7, imagePixelY1: 8 };
  const staleInspectionRoi = { imagePixelX0: 90, imagePixelY0: 90, imagePixelX1: 95, imagePixelY1: 95 };

  it("crop is always available to open: it requests its region in-flow, not from a pre-existing ROI", () => {
    expect(CROP_TO_REGION_ACTION.isAvailableForActiveViewport).toBeUndefined();
    expect(CROP_TO_REGION_ACTION.requiresOperationRegion).toBe(true);
  });

  it("crop reads the per-operation region and ignores a stale inspection ROI", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, roi: staleInspectionRoi, operationRegion };
    const prepared = CROP_TO_REGION_ACTION.prepareParameterValuesForApply!({}, state, "whole-image");
    expect(CROP_TO_REGION_ACTION.formatAppliedLabel!(prepared)).toBe("Crop to (2, 3) - (7, 8)");
  });

  it("crop rejects apply when no per-operation region was selected, even if an inspection ROI exists", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, roi: staleInspectionRoi, operationRegion: null };
    expect(() => CROP_TO_REGION_ACTION.prepareParameterValuesForApply!({}, state, "whole-image")).toThrow(
      /needs a region/,
    );
  });

  it("crop clears the per-operation region and the now-out-of-bounds inspection ROI on the cropped result", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, roi: staleInspectionRoi, operationRegion };
    const after = CROP_TO_REGION_ACTION.apply(state, {});
    expect(after.operationRegion).toBeNull();
    expect(after.roi).toBeNull();
  });

  it("crop keeps the untouched source's inspection ROI when applied to a duplicate", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, roi: staleInspectionRoi, operationRegion };
    const after = CROP_TO_REGION_ACTION.clearConsumedSourceStateAfterApply!(state);
    expect(after.operationRegion).toBeNull();
    expect(after.roi).toEqual(staleInspectionRoi);
  });

  it("spectralon reads its bright-target region from the per-operation region, ignoring the inspection ROI", () => {
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, roi: staleInspectionRoi, operationRegion };
    const prepared = SPECTRALON_ACTION.prepareParameterValuesForApply!({ reflectance: 0.99 }, state, "whole-image");
    expect(SPECTRALON_ACTION.formatAppliedLabel!(prepared)).toContain("(2, 3) - (7, 8)");
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

  it("auto-normalizes unbounded float data then inverts instead of rejecting (CT-097)", () => {
    const prepared = INVERT_ACTION.prepareParameterValuesForApply!(
      { applyToAllBands: true },
      DEFAULT_VIEWPORT_RENDERING_STATE,
      "whole-image",
    );
    const result = INVERT_ACTION.transformSource!(
      { kind: "raster", raster: makeTwoBandFloatRaster([0, 2], [0, 1]) },
      prepared,
    );
    const raster = (result as { raster: RasterImage }).raster;
    // cube-wide max is 2, so normalize divides by 2 then inverts: 1 - value/2.
    expect(Array.from(raster.bandPixels[0]!)).toEqual([1, 0]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([1, 0.5]);
  });

  it("emits the auto-normalized intermediate as a secondary output only when unbounded (CT-097)", () => {
    const prepared = INVERT_ACTION.prepareParameterValuesForApply!(
      { applyToAllBands: true },
      DEFAULT_VIEWPORT_RENDERING_STATE,
      "whole-image",
    );
    const bounded = INVERT_ACTION.transformSourceToSecondaryOutputs!(
      { kind: "raster", raster: makeTwoBandFloatRaster([0, 1], [0, 0.5]) },
      prepared,
    );
    expect(bounded).toHaveLength(0);
    const unbounded = INVERT_ACTION.transformSourceToSecondaryOutputs!(
      { kind: "raster", raster: makeTwoBandFloatRaster([0, 2], [0, 1]) },
      prepared,
    );
    expect(unbounded).toHaveLength(1);
    expect(unbounded[0]!.appliedLabel).toMatch(/normalize/i);
    const normalized = (unbounded[0]!.source as { raster: RasterImage }).raster;
    expect(Array.from(normalized.bandPixels[0]!)).toEqual([0, 1]);
  });

  it("rejects a non-raster source with a user-readable error", () => {
    const prepared = INVERT_ACTION.prepareParameterValuesForApply!(
      { applyToAllBands: true },
      DEFAULT_VIEWPORT_RENDERING_STATE,
      "whole-image",
    );
    expect(() =>
      INVERT_ACTION.transformSource!(
        { kind: "pixels", pixels: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 },
        prepared,
      ),
    ).toThrow(/raster/i);
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
    expect(NORMALIZE_DATA_ACTION.formatAppliedLabel!(fullCube)).toBe("Normalize to [0,1] (full stack)");
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

describe("ROTATE_REFLECT_ACTION", () => {
  it("rotates the whole cube and swaps the reported dimensions for a 90 degree rotation", () => {
    const result = ROTATE_REFLECT_ACTION.transformSource!(
      { kind: "raster", raster: makeThreeBandUint8Raster([1, 2], [3, 4], [5, 6]) },
      { transform: "rotate-90-cw" },
    );
    const raster = (result as { raster: RasterImage }).raster;
    expect([raster.width, raster.height]).toEqual([1, 2]);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([1, 2]);
  });

  it("clears any active region after a geometric transform so the stale ROI is dropped", () => {
    const roi = { imagePixelX0: 1, imagePixelY0: 2, imagePixelX1: 5, imagePixelY1: 6 };
    const state = { ...DEFAULT_VIEWPORT_RENDERING_STATE, roi };
    expect(ROTATE_REFLECT_ACTION.apply(state, { transform: "rotate-90-cw" }).roi).toBeNull();
  });

  it("records the chosen transform in the applied label", () => {
    expect(ROTATE_REFLECT_ACTION.formatAppliedLabel!({ transform: "flip-vertical" })).toBe("Flip vertical");
    expect(ROTATE_REFLECT_ACTION.formatAppliedLabel!({ transform: "rotate-270-cw" })).toBe("Rotate 270 clockwise");
  });
});
