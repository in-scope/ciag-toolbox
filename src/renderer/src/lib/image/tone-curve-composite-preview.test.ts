import { describe, expect, it } from "vitest";

import type { ToneCurveAnchor } from "./apply-tone-curve";
import type { RasterImage } from "./raster-image";
import {
  buildCompositeToneCurveValueRanges,
  buildComposedChannelPreviewLutOrNull,
  isCompositeToneCurvePreviewActive,
} from "./tone-curve-composite-preview";
import type { ToneCurveChannelAnchors } from "./tone-curve-channels";
import { TONE_CURVE_LUT_ENTRY_COUNT } from "@/lib/webgl/tone-curve-lut-texture";

const LAST = TONE_CURVE_LUT_ENTRY_COUNT - 1;

function makeRgbCompositeUint8(): RasterImage {
  return {
    bandPixels: [Uint8Array.from([200, 10, 255, 0]), Uint8Array.from([100, 20, 0, 255]), Uint8Array.from([50, 30, 0, 0])],
    width: 2,
    height: 2,
    bandCount: 3,
    sampleFormat: "uint",
    bitsPerSample: 8,
    colorInterpretation: "rgb",
  };
}

function makeScientificUint8(): RasterImage {
  return {
    bandPixels: [Uint8Array.from([200, 10, 255, 0]), Uint8Array.from([100, 20, 0, 255]), Uint8Array.from([50, 30, 0, 0])],
    width: 2,
    height: 2,
    bandCount: 3,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

const IDENTITY_UINT8: ToneCurveAnchor[] = [
  { input: 0, output: 0 },
  { input: 255, output: 255 },
];

const FLAT_BLACK_UINT8: ToneCurveAnchor[] = [
  { input: 0, output: 0 },
  { input: 255, output: 0 },
];

describe("buildCompositeToneCurveValueRanges", () => {
  it("spans the band's data-type range as both input and output", () => {
    expect(buildCompositeToneCurveValueRanges(makeRgbCompositeUint8())).toEqual({
      inputMin: 0,
      inputMax: 255,
      outputMin: 0,
      outputMax: 255,
    });
  });
});

describe("buildComposedChannelPreviewLutOrNull", () => {
  it("composes identity channel and value curves into an even ramp", () => {
    const lut = buildComposedChannelPreviewLutOrNull(makeRgbCompositeUint8(), "red", IDENTITY_UINT8, IDENTITY_UINT8);
    expect(lut).toHaveLength(TONE_CURVE_LUT_ENTRY_COUNT);
    expect(lut![0]).toBeCloseTo(0, 6);
    expect(lut![LAST]).toBeCloseTo(1, 6);
    expect(lut![Math.floor(LAST / 2)]).toBeCloseTo(0.5, 2);
  });

  it("treats a missing/short channel curve as identity", () => {
    const lut = buildComposedChannelPreviewLutOrNull(makeRgbCompositeUint8(), "green", null, undefined);
    expect(lut![LAST]).toBeCloseTo(1, 6);
  });

  it("folds the rgb/Value curve into the channel (a flat-black Value curve blacks the channel out)", () => {
    const lut = buildComposedChannelPreviewLutOrNull(makeRgbCompositeUint8(), "blue", IDENTITY_UINT8, FLAT_BLACK_UINT8);
    expect(lut!.every((entry) => entry < 0.001)).toBe(true);
  });

  it("returns null for a scientific (non-composite) raster", () => {
    expect(buildComposedChannelPreviewLutOrNull(makeScientificUint8(), "red", FLAT_BLACK_UINT8, IDENTITY_UINT8)).toBeNull();
    expect(buildComposedChannelPreviewLutOrNull(null, "red", FLAT_BLACK_UINT8, IDENTITY_UINT8)).toBeNull();
  });
});

describe("isCompositeToneCurvePreviewActive", () => {
  it("is false when every channel is identity (or absent)", () => {
    expect(isCompositeToneCurvePreviewActive(makeRgbCompositeUint8(), {})).toBe(false);
    const allIdentity: ToneCurveChannelAnchors = { rgb: IDENTITY_UINT8, red: IDENTITY_UINT8 };
    expect(isCompositeToneCurvePreviewActive(makeRgbCompositeUint8(), allIdentity)).toBe(false);
  });

  it("is true once any channel holds a non-identity curve", () => {
    expect(isCompositeToneCurvePreviewActive(makeRgbCompositeUint8(), { red: FLAT_BLACK_UINT8 })).toBe(true);
  });

  it("is false for a scientific stack or a null raster", () => {
    expect(isCompositeToneCurvePreviewActive(makeScientificUint8(), { red: FLAT_BLACK_UINT8 })).toBe(false);
    expect(isCompositeToneCurvePreviewActive(null, { red: FLAT_BLACK_UINT8 })).toBe(false);
  });
});
