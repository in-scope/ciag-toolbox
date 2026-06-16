import { describe, expect, it } from "vitest";

import {
  applyComposedToneCurveToRasterBand,
  applyToneCurveToRasterBand,
  buildDisplayNormalizedToneCurveLookupTable,
  buildMonotoneToneCurve,
  buildToneCurveLookupTable,
  evaluateToneCurveAtInput,
  type ToneCurveAnchor,
} from "./apply-tone-curve";
import { applyBlackWhitePointsToRasterBand } from "./apply-black-white-points";
import type { RasterImage, RasterSampleFormat, RasterTypedArray } from "./raster-image";

function makeSingleBandRaster(
  band: RasterTypedArray,
  width: number,
  height: number,
  sampleFormat: RasterSampleFormat,
  bitsPerSample: number,
): RasterImage {
  return { bandPixels: [band], width, height, bandCount: 1, sampleFormat, bitsPerSample };
}

function makeUint8Raster(values: ReadonlyArray<number>, width: number, height: number): RasterImage {
  return makeSingleBandRaster(Uint8Array.from(values), width, height, "uint", 8);
}

const UINT8_RANGE = { min: 0, max: 255 };

describe("buildMonotoneToneCurve and evaluateToneCurveAtInput", () => {
  it("interpolates exactly through each anchor point", () => {
    const anchors: ToneCurveAnchor[] = [
      { input: 0, output: 0 },
      { input: 100, output: 40 },
      { input: 200, output: 255 },
    ];
    const curve = buildMonotoneToneCurve(anchors);
    for (const anchor of anchors) {
      expect(evaluateToneCurveAtInput(curve, anchor.input)).toBeCloseTo(anchor.output, 6);
    }
  });

  it("clips inputs beyond the first and last anchor to their outputs (endpoint behavior)", () => {
    const curve = buildMonotoneToneCurve([
      { input: 30, output: 0 },
      { input: 90, output: 255 },
    ]);
    expect(evaluateToneCurveAtInput(curve, -10)).toBe(0);
    expect(evaluateToneCurveAtInput(curve, 30)).toBe(0);
    expect(evaluateToneCurveAtInput(curve, 90)).toBe(255);
    expect(evaluateToneCurveAtInput(curve, 1000)).toBe(255);
  });

  it("the 2-anchor case equals a linear black/white stretch", () => {
    const curve = buildMonotoneToneCurve([
      { input: 0, output: 0 },
      { input: 128, output: 255 },
    ]);
    for (const value of [0, 16, 32, 64, 96, 128]) {
      expect(evaluateToneCurveAtInput(curve, value)).toBeCloseTo((value / 128) * 255, 6);
    }
  });

  it("preserves monotonicity for a steep step-shaped anchor set (no overshoot)", () => {
    const curve = buildMonotoneToneCurve([
      { input: 0, output: 0 },
      { input: 10, output: 0 },
      { input: 20, output: 0 },
      { input: 30, output: 255 },
    ]);
    const lookupTable = buildToneCurveLookupTable(curve, { min: 0, max: 30 }, 200);
    assertLookupTableIsMonotoneNonDecreasingWithinRange(lookupTable, UINT8_RANGE);
  });

  it("rejects fewer than two anchors", () => {
    expect(() => buildMonotoneToneCurve([{ input: 0, output: 0 }])).toThrow(/at least two/);
  });

  it("rejects anchors whose inputs are not strictly increasing", () => {
    expect(() =>
      buildMonotoneToneCurve([
        { input: 0, output: 0 },
        { input: 0, output: 255 },
      ]),
    ).toThrow(/strictly increasing/);
  });
});

describe("applyToneCurveToRasterBand", () => {
  it("matches the CT-080 black/white stretch for the equivalent 2-anchor curve", () => {
    const values = [0, 64, 128, 255];
    const blackWhite = applyBlackWhitePointsToRasterBand(makeUint8Raster(values, 4, 1), 0, {
      black: 0,
      white: 128,
    });
    const toneCurve = applyToneCurveToRasterBand(makeUint8Raster(values, 4, 1), 0, [
      { input: 0, output: 0 },
      { input: 128, output: 255 },
    ]);
    expect(Array.from(toneCurve.bandPixels[0]!)).toEqual(Array.from(blackWhite.bandPixels[0]!));
  });

  it("remaps only the pixels inside the region and leaves the rest unchanged", () => {
    const raster = makeUint8Raster([10, 20, 30, 40], 2, 2);
    const result = applyToneCurveToRasterBand(
      raster,
      0,
      [
        { input: 10, output: 0 },
        { input: 40, output: 255 },
      ],
      { region: { imagePixelX0: 0, imagePixelY0: 0, imagePixelX1: 0, imagePixelY1: 0 } },
    );
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 20, 30, 40]);
  });

  it("keeps a float [0,1] band in float and clips out-of-range results to [0,1]", () => {
    const band = Float32Array.from([0, 0.5, 1]);
    const raster = makeSingleBandRaster(band, 3, 1, "float", 32);
    const result = applyToneCurveToRasterBand(raster, 0, [
      { input: 0.25, output: 0 },
      { input: 0.75, output: 1 },
    ]);
    expect(result.bandPixels[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result.bandPixels[0]!)).toEqual([0, 0.5, 1]);
  });

  it("does not mutate the source raster band", () => {
    const raster = makeUint8Raster([0, 128, 255], 3, 1);
    applyToneCurveToRasterBand(raster, 0, [
      { input: 0, output: 0 },
      { input: 64, output: 255 },
    ]);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([0, 128, 255]);
  });
});

describe("applyComposedToneCurveToRasterBand", () => {
  const HALVE_CURVE: ToneCurveAnchor[] = [
    { input: 0, output: 0 },
    { input: 255, output: 128 },
  ];

  it("composes the rgb/Value curve over the per-channel curve: value(channel(v))", () => {
    const raster = makeUint8Raster([200, 100, 0], 3, 1);
    const result = applyComposedToneCurveToRasterBand(raster, 0, HALVE_CURVE, HALVE_CURVE);
    expect(Array.from(result.bandPixels[0]!)).toEqual([50, 25, 0]);
  });

  it("treats a null per-channel curve as identity so the rgb/Value curve still applies", () => {
    const raster = makeUint8Raster([200, 100, 0], 3, 1);
    const result = applyComposedToneCurveToRasterBand(raster, 0, null, HALVE_CURVE);
    expect(Array.from(result.bandPixels[0]!)).toEqual([100, 50, 0]);
  });

  it("treats a null rgb/Value curve as identity so only the per-channel curve applies", () => {
    const raster = makeUint8Raster([200, 100, 0], 3, 1);
    const result = applyComposedToneCurveToRasterBand(raster, 0, HALVE_CURVE, null);
    expect(Array.from(result.bandPixels[0]!)).toEqual([100, 50, 0]);
  });

  it("leaves the band unchanged when both curves are identity", () => {
    const raster = makeUint8Raster([200, 100, 0], 3, 1);
    const result = applyComposedToneCurveToRasterBand(raster, 0, null, null);
    expect(Array.from(result.bandPixels[0]!)).toEqual([200, 100, 0]);
  });

  it("remaps only the pixels inside the region", () => {
    const raster = makeUint8Raster([200, 200, 200, 200], 2, 2);
    const result = applyComposedToneCurveToRasterBand(raster, 0, null, HALVE_CURVE, {
      region: { imagePixelX0: 0, imagePixelY0: 0, imagePixelX1: 0, imagePixelY1: 0 },
    });
    expect(Array.from(result.bandPixels[0]!)).toEqual([100, 200, 200, 200]);
  });
});

describe("buildDisplayNormalizedToneCurveLookupTable", () => {
  const UINT16_RANGE = { min: 0, max: 65535 };

  it("maps an identity curve to an evenly spaced [0,1] ramp (no visible change)", () => {
    const identity = buildMonotoneToneCurve([
      { input: 0, output: 0 },
      { input: 65535, output: 65535 },
    ]);
    const lookupTable = buildDisplayNormalizedToneCurveLookupTable(identity, UINT16_RANGE, 1024);
    expect(lookupTable[0]).toBeCloseTo(0, 6);
    expect(lookupTable[1023]).toBeCloseTo(1, 6);
    for (let index = 0; index < lookupTable.length; index += 1) {
      expect(lookupTable[index]!).toBeCloseTo(index / 1023, 6);
    }
  });

  it("renormalizes a black/white stretch curve into the display unit", () => {
    const stretch = buildMonotoneToneCurve([
      { input: 0, output: 32768 },
      { input: 65535, output: 65535 },
    ]);
    const lookupTable = buildDisplayNormalizedToneCurveLookupTable(stretch, UINT16_RANGE, 1024);
    expect(lookupTable[0]).toBeCloseTo(32768 / 65535, 4);
    expect(lookupTable[1023]).toBeCloseTo(1, 6);
  });

  it("clamps curve outputs that leave the range into [0,1]", () => {
    const flatWhite = buildMonotoneToneCurve([
      { input: 0, output: 65535 },
      { input: 65535, output: 65535 },
    ]);
    const lookupTable = buildDisplayNormalizedToneCurveLookupTable(flatWhite, UINT16_RANGE, 1024);
    for (const entry of lookupTable) {
      expect(entry).toBeCloseTo(1, 6);
    }
  });

  it("returns zeros for a degenerate zero-width range", () => {
    const curve = buildMonotoneToneCurve([
      { input: 0, output: 0 },
      { input: 255, output: 255 },
    ]);
    const lookupTable = buildDisplayNormalizedToneCurveLookupTable(curve, { min: 5, max: 5 }, 8);
    expect(lookupTable).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

function assertLookupTableIsMonotoneNonDecreasingWithinRange(
  lookupTable: ReadonlyArray<number>,
  range: { min: number; max: number },
): void {
  for (let index = 1; index < lookupTable.length; index += 1) {
    expect(lookupTable[index]!).toBeGreaterThanOrEqual(lookupTable[index - 1]! - 1e-9);
    expect(lookupTable[index]!).toBeGreaterThanOrEqual(range.min - 1e-9);
    expect(lookupTable[index]!).toBeLessThanOrEqual(range.max + 1e-9);
  }
}
