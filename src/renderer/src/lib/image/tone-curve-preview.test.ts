import { describe, expect, it, vi } from "vitest";

import * as applyToneCurveModule from "./apply-tone-curve";
import type { ToneCurveAnchor } from "./apply-tone-curve";
import type { RasterImage, RasterTypedArray } from "./raster-image";
import { buildToneCurvePreviewLutOrNull } from "./tone-curve-preview";
import { TONE_CURVE_LUT_ENTRY_COUNT } from "@/lib/webgl/tone-curve-lut-texture";

function makeSingleBandUint16Raster(values: ReadonlyArray<number>): RasterImage {
  const band: RasterTypedArray = Uint16Array.from(values);
  return { bandPixels: [band], width: 2, height: 2, bandCount: 1, sampleFormat: "uint", bitsPerSample: 16 };
}

const IDENTITY_UINT16_ANCHORS: ToneCurveAnchor[] = [
  { input: 0, output: 0 },
  { input: 65535, output: 65535 },
];

describe("buildToneCurvePreviewLutOrNull", () => {
  it("returns a display-normalized LUT array, never a RasterImage", () => {
    const lut = buildToneCurvePreviewLutOrNull(
      makeSingleBandUint16Raster([100, 150, 200, 250]),
      0,
      IDENTITY_UINT16_ANCHORS,
    );
    expect(Array.isArray(lut)).toBe(true);
    expect(lut).toHaveLength(TONE_CURVE_LUT_ENTRY_COUNT);
    expect(lut!.every((entry) => typeof entry === "number")).toBe(true);
  });

  it("does NOT call applyToneCurveToRasterBand (no preview raster is baked)", () => {
    const bakeSpy = vi.spyOn(applyToneCurveModule, "applyToneCurveToRasterBand");
    buildToneCurvePreviewLutOrNull(
      makeSingleBandUint16Raster([100, 150, 200, 250]),
      0,
      IDENTITY_UINT16_ANCHORS,
    );
    expect(bakeSpy).not.toHaveBeenCalled();
    bakeSpy.mockRestore();
  });

  it("maps an identity curve to an even ramp from 0 to 1", () => {
    const lut = buildToneCurvePreviewLutOrNull(
      makeSingleBandUint16Raster([100, 150, 200, 250]),
      0,
      IDENTITY_UINT16_ANCHORS,
    );
    expect(lut![0]).toBeCloseTo(0, 6);
    expect(lut![TONE_CURVE_LUT_ENTRY_COUNT - 1]).toBeCloseTo(1, 6);
    expect(lut![Math.floor((TONE_CURVE_LUT_ENTRY_COUNT - 1) / 2)]).toBeCloseTo(0.5, 2);
  });

  it("maps a flat-high curve to an all-ones LUT (display white)", () => {
    const lut = buildToneCurvePreviewLutOrNull(makeSingleBandUint16Raster([100, 150, 200, 250]), 0, [
      { input: 0, output: 65535 },
      { input: 65535, output: 65535 },
    ]);
    expect(lut!.every((entry) => entry > 0.999)).toBe(true);
  });

  it("returns null when there is no raster or fewer than two anchors", () => {
    const raster = makeSingleBandUint16Raster([100, 150, 200, 250]);
    expect(buildToneCurvePreviewLutOrNull(null, 0, IDENTITY_UINT16_ANCHORS)).toBeNull();
    expect(buildToneCurvePreviewLutOrNull(raster, 0, null)).toBeNull();
    expect(buildToneCurvePreviewLutOrNull(raster, 0, [{ input: 0, output: 0 }])).toBeNull();
  });
});
