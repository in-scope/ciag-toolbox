import { describe, expect, it } from "vitest";

import {
  applyComposedToneCurveToRasterBand,
  applyToneCurveToRasterBand,
  applyToneCurveToWholeStackPerBandMinMax,
  buildDisplayNormalizedToneCurveLookupTable,
  buildMonotoneToneCurve,
  buildToneCurveLookupTable,
  evaluateToneCurveAtInput,
  toneCurveOutputRangeForBand,
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

  it("CT-198: applying the untouched float default identity curve leaves out-of-[0,1] data unchanged", () => {
    const band = Float32Array.from([-0.05, 0.5855, 1.1, 0.42]);
    const raster = makeSingleBandRaster(band, 2, 2, "float", 32);
    const range = toneCurveOutputRangeForBand(raster, 0);
    const result = applyToneCurveToRasterBand(raster, 0, [
      { input: range.min, output: range.min },
      { input: range.max, output: range.max },
    ]);
    expect(Array.from(result.bandPixels[0]!)).toEqual(Array.from(band));
  });

  it("CT-198: float output range is the band value extents; integer keeps the type container", () => {
    const floatRaster = makeSingleBandRaster(Float32Array.from([-0.05, 1.1]), 2, 1, "float", 32);
    expect(toneCurveOutputRangeForBand(floatRaster, 0)).toEqual({ min: Math.fround(-0.05), max: Math.fround(1.1) });
    expect(toneCurveOutputRangeForBand(makeUint8Raster([10, 20], 2, 1), 0)).toEqual({ min: 0, max: 255 });
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

function makeUint16MultiBandRaster(
  bands: ReadonlyArray<ReadonlyArray<number>>,
  width: number,
  height: number,
): RasterImage {
  return {
    bandPixels: bands.map((band) => Uint16Array.from(band)),
    width,
    height,
    bandCount: bands.length,
    sampleFormat: "uint",
    bitsPerSample: 16,
  };
}

function readBandValues(raster: RasterImage, bandIndex: number): number[] {
  return Array.from(raster.bandPixels[bandIndex]!);
}

describe("applyToneCurveToWholeStackPerBandMinMax (CT-192)", () => {
  it("leaves every band unchanged for an identity curve, regardless of per-band range", () => {
    const raster = makeUint16MultiBandRaster([[10, 20, 30, 40], [100, 140, 180, 220]], 2, 2);
    const identityOverSelectedBand: ToneCurveAnchor[] = [
      { input: 10, output: 10 },
      { input: 40, output: 40 },
    ];
    const result = applyToneCurveToWholeStackPerBandMinMax(raster, 0, identityOverSelectedBand);
    expect(readBandValues(result, 0)).toEqual([10, 20, 30, 40]);
    expect(readBandValues(result, 1)).toEqual([100, 140, 180, 220]);
  });

  it("maps each band through the same curve SHAPE normalized by that band's own min/max", () => {
    // Selected band spans [0, 100]; the 2-anchor curve doubles it, so the normalized
    // shape is s(t) = 2t. Band 1 spans [10, 30], so out = bMin + 2t*(bMax-bMin).
    const raster = makeUint16MultiBandRaster([[0, 100], [10, 30]], 1, 2);
    const doublingCurve: ToneCurveAnchor[] = [
      { input: 0, output: 0 },
      { input: 100, output: 200 },
    ];
    const result = applyToneCurveToWholeStackPerBandMinMax(raster, 0, doublingCurve);
    expect(readBandValues(result, 0)).toEqual([0, 200]);
    expect(readBandValues(result, 1)).toEqual([10, 50]);
  });

  it("reduces to the plain Full-image curve on the selected band (single-band coincidence)", () => {
    const raster = makeUint16MultiBandRaster([[40, 90, 140, 190], [500, 700, 900, 1100]], 2, 2);
    const curve: ToneCurveAnchor[] = [
      { input: 40, output: 10 },
      { input: 120, output: 9000 },
      { input: 190, output: 60000 },
    ];
    const wholeStack = applyToneCurveToWholeStackPerBandMinMax(raster, 0, curve);
    const fullImage = applyToneCurveToRasterBand(raster, 0, curve);
    expect(readBandValues(wholeStack, 0)).toEqual(readBandValues(fullImage, 0));
  });

  it("leaves a constant band untouched (no division by a zero range)", () => {
    const raster = makeUint16MultiBandRaster([[0, 100], [700, 700]], 1, 2);
    const doublingCurve: ToneCurveAnchor[] = [
      { input: 0, output: 0 },
      { input: 100, output: 200 },
    ];
    const result = applyToneCurveToWholeStackPerBandMinMax(raster, 0, doublingCurve);
    expect(readBandValues(result, 1)).toEqual([700, 700]);
  });
});
