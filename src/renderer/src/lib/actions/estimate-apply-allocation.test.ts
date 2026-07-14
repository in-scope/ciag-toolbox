import { describe, expect, it } from "vitest";

import { DENOISE_ACTION } from "./denoise-action";
import {
  estimateApplyAllocationBytesForAction,
  estimateSourceCloneBytes,
  sumRasterBandBytes,
} from "./estimate-apply-allocation";
import { PERCENTILE_CLIP_ACTION } from "./percentile-clip-action";
import {
  BIT_SHIFT_ACTION,
  CROP_TO_REGION_ACTION,
  FALSE_COLOR_ACTION,
  FLAT_FIELD_ACTION,
  INVERT_ACTION,
  NORMALIZE_DATA_ACTION,
  REFLECT_ACTION,
  ROTATE_ACTION,
  SPECTRALON_ACTION,
  STANDARDIZE_ACTION,
  TONE_CURVE_ACTION,
} from "./registered-actions";
import { SPATIAL_FILTER_ACTION } from "./spatial-filter-action";
import { SPECTRAL_DERIVATIVE_ACTION } from "./spectral-derivative-action";
import { THRESHOLD_ACTION } from "./threshold-action";
import { TONE_CURVE_SCOPE_PARAMETER_ID, WHOLE_STACK_TONE_CURVE_SCOPE_VALUE } from "./tone-curve-scope";
import type { RasterImage } from "@/lib/image/raster-image";
import type { ViewportImageSource } from "@/lib/webgl/texture";

const WIDTH = 4;
const HEIGHT = 3;
const BAND_COUNT = 5;
const PIXELS = WIDTH * HEIGHT;
const UINT16_CUBE_BYTES = PIXELS * BAND_COUNT * 2;
const FLOAT32_CUBE_BYTES = PIXELS * BAND_COUNT * 4;

function uint16Source(): ViewportImageSource {
  const raster: RasterImage = {
    bandPixels: Array.from({ length: BAND_COUNT }, () => new Uint16Array(PIXELS)),
    width: WIDTH,
    height: HEIGHT,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: BAND_COUNT,
  };
  return { kind: "raster", raster };
}

describe("estimateApplyAllocationBytesForAction", () => {
  it("bills the float operations a full float32 cube regardless of scope", () => {
    for (const action of [
      STANDARDIZE_ACTION,
      PERCENTILE_CLIP_ACTION,
      DENOISE_ACTION,
      SPATIAL_FILTER_ACTION,
      SPECTRAL_DERIVATIVE_ACTION,
      FLAT_FIELD_ACTION,
      SPECTRALON_ACTION,
    ]) {
      expect(estimateApplyAllocationBytesForAction(action, uint16Source(), {}), action.id).toBe(
        FLOAT32_CUBE_BYTES,
      );
    }
  });

  it("bills normalize a float32 cube for scaling methods and the source bytes for clip-absolute", () => {
    expect(estimateApplyAllocationBytesForAction(NORMALIZE_DATA_ACTION, uint16Source(), {})).toBe(
      FLOAT32_CUBE_BYTES,
    );
    expect(
      estimateApplyAllocationBytesForAction(NORMALIZE_DATA_ACTION, uint16Source(), {
        method: "clip-absolute",
      }),
    ).toBe(UINT16_CUBE_BYTES);
  });

  it("bills the type-preserving whole-cube operations the source's own bytes", () => {
    for (const action of [BIT_SHIFT_ACTION, ROTATE_ACTION, REFLECT_ACTION]) {
      expect(estimateApplyAllocationBytesForAction(action, uint16Source(), {}), action.id).toBe(
        UINT16_CUBE_BYTES,
      );
    }
  });

  it("bills the tone curve one band unless the whole-stack scope is chosen", () => {
    expect(estimateApplyAllocationBytesForAction(TONE_CURVE_ACTION, uint16Source(), {})).toBe(PIXELS * 2);
    expect(
      estimateApplyAllocationBytesForAction(TONE_CURVE_ACTION, uint16Source(), {
        [TONE_CURVE_SCOPE_PARAMETER_ID]: WHOLE_STACK_TONE_CURVE_SCOPE_VALUE,
      }),
    ).toBe(UINT16_CUBE_BYTES);
  });

  it("bills invert one band unless it applies to all bands", () => {
    expect(estimateApplyAllocationBytesForAction(INVERT_ACTION, uint16Source(), {})).toBe(PIXELS * 2);
    expect(
      estimateApplyAllocationBytesForAction(INVERT_ACTION, uint16Source(), { applyToAllBands: true }),
    ).toBe(UINT16_CUBE_BYTES);
  });

  it("bills threshold one uint8 byte per sample", () => {
    expect(estimateApplyAllocationBytesForAction(THRESHOLD_ACTION, uint16Source(), {})).toBe(
      PIXELS * BAND_COUNT,
    );
  });

  it("bills crop by the committed rectangle and falls back to the whole cube without one", () => {
    const withRegion = estimateApplyAllocationBytesForAction(CROP_TO_REGION_ACTION, uint16Source(), {
      imagePixelX0: 1,
      imagePixelY0: 0,
      imagePixelX1: 2,
      imagePixelY1: 1,
    });
    expect(withRegion).toBe(2 * 2 * BAND_COUNT * 2);
    expect(estimateApplyAllocationBytesForAction(CROP_TO_REGION_ACTION, uint16Source(), {})).toBe(
      UINT16_CUBE_BYTES,
    );
  });

  it("defaults unlisted actions to one float band and non-raster sources to zero", () => {
    expect(estimateApplyAllocationBytesForAction(FALSE_COLOR_ACTION, uint16Source(), {})).toBe(PIXELS * 4);
    const browserSource = { kind: "html-image", image: {} } as unknown as ViewportImageSource;
    expect(estimateApplyAllocationBytesForAction(FALSE_COLOR_ACTION, browserSource, {})).toBe(0);
  });
});

describe("estimateSourceCloneBytes", () => {
  it("bills a raster clone every band's bytes and non-raster sources zero", () => {
    const source = uint16Source();
    expect(estimateSourceCloneBytes(source)).toBe(UINT16_CUBE_BYTES);
    expect(sumRasterBandBytes((source as { raster: RasterImage } & typeof source).raster)).toBe(
      UINT16_CUBE_BYTES,
    );
    const browserSource = { kind: "html-image", image: {} } as unknown as ViewportImageSource;
    expect(estimateSourceCloneBytes(browserSource)).toBe(0);
  });
});
