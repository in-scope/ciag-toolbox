import { describe, expect, it } from "vitest";

import { applyBlackWhitePointsToRasterBand } from "@/lib/image/apply-black-white-points";
import { applyToneCurveToRasterBand } from "@/lib/image/apply-tone-curve";
import type { RasterImage } from "@/lib/image/raster-image";
import {
  addToneCurveAnchor,
  buildDefaultToneCurveAnchors,
  indexOfToneCurveAnchorByInput,
  isRemovableInteriorAnchorIndex,
  moveToneCurveAnchor,
  removeToneCurveAnchor,
  resolveToneCurveAnchorsOrDefault,
  type ToneCurveValueRanges,
} from "@/lib/image/tone-curve-editor-state";

const RANGES: ToneCurveValueRanges = { inputMin: 0, inputMax: 128, outputMin: 0, outputMax: 255 };

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

describe("buildDefaultToneCurveAnchors", () => {
  it("spans the input range on X and the output range on Y as two endpoints", () => {
    expect(buildDefaultToneCurveAnchors(RANGES)).toEqual([
      { input: 0, output: 0 },
      { input: 128, output: 255 },
    ]);
  });
});

describe("resolveToneCurveAnchorsOrDefault", () => {
  it("returns the default diagonal when no anchors are stored yet", () => {
    expect(resolveToneCurveAnchorsOrDefault(null, RANGES)).toEqual(buildDefaultToneCurveAnchors(RANGES));
  });

  it("keeps stored anchors when at least two are present", () => {
    const anchors = [
      { input: 0, output: 0 },
      { input: 64, output: 200 },
      { input: 128, output: 255 },
    ];
    expect(resolveToneCurveAnchorsOrDefault(anchors, RANGES)).toBe(anchors);
  });
});

describe("addToneCurveAnchor", () => {
  it("inserts a new anchor keeping the list ordered by input", () => {
    const anchors = buildDefaultToneCurveAnchors(RANGES);
    const next = addToneCurveAnchor(anchors, { input: 64, output: 100 }, RANGES);
    expect(next).toEqual([
      { input: 0, output: 0 },
      { input: 64, output: 100 },
      { input: 128, output: 255 },
    ]);
  });

  it("clamps an out-of-range anchor into the value ranges", () => {
    const next = addToneCurveAnchor([], { input: 999, output: -50 }, RANGES);
    expect(next).toEqual([{ input: 128, output: 0 }]);
  });

  it("ignores a new anchor that lands on top of an existing input", () => {
    const anchors = buildDefaultToneCurveAnchors(RANGES);
    expect(addToneCurveAnchor(anchors, { input: 0, output: 200 }, RANGES)).toBe(anchors);
  });
});

describe("moveToneCurveAnchor", () => {
  it("moves an interior anchor while keeping it between its neighbors", () => {
    const anchors = [
      { input: 0, output: 0 },
      { input: 64, output: 100 },
      { input: 128, output: 255 },
    ];
    const moved = moveToneCurveAnchor(anchors, 1, { input: 9999, output: 150 }, RANGES);
    expect(moved[1]!.input).toBeLessThan(128);
    expect(moved[1]!.input).toBeGreaterThan(0);
    expect(moved[1]!.output).toBe(150);
  });

  it("ignores an out-of-bounds index", () => {
    const anchors = buildDefaultToneCurveAnchors(RANGES);
    expect(moveToneCurveAnchor(anchors, 5, { input: 10, output: 10 }, RANGES)).toBe(anchors);
  });
});

describe("removeToneCurveAnchor", () => {
  it("removes an interior anchor", () => {
    const anchors = [
      { input: 0, output: 0 },
      { input: 64, output: 100 },
      { input: 128, output: 255 },
    ];
    expect(removeToneCurveAnchor(anchors, 1)).toEqual([
      { input: 0, output: 0 },
      { input: 128, output: 255 },
    ]);
  });

  it("never removes an endpoint anchor", () => {
    const anchors = buildDefaultToneCurveAnchors(RANGES);
    expect(removeToneCurveAnchor(anchors, 0)).toBe(anchors);
    expect(removeToneCurveAnchor(anchors, 1)).toBe(anchors);
  });
});

describe("anchor index helpers", () => {
  it("finds an anchor index by its input value", () => {
    const anchors = addToneCurveAnchor(buildDefaultToneCurveAnchors(RANGES), { input: 64, output: 100 }, RANGES);
    expect(indexOfToneCurveAnchorByInput(anchors, 64)).toBe(1);
  });

  it("flags only interior anchors as removable", () => {
    const anchors = [
      { input: 0, output: 0 },
      { input: 64, output: 100 },
      { input: 128, output: 255 },
    ];
    expect(isRemovableInteriorAnchorIndex(anchors, 0)).toBe(false);
    expect(isRemovableInteriorAnchorIndex(anchors, 1)).toBe(true);
    expect(isRemovableInteriorAnchorIndex(anchors, 2)).toBe(false);
  });
});

describe("2-anchor default equals the CT-080 linear black/white stretch", () => {
  it("produces identical pixels for the default diagonal and the black/white stretch", () => {
    const raster = makeSingleBandUint8Raster([0, 32, 64, 96, 128, 200, 255]);
    const anchors = buildDefaultToneCurveAnchors(RANGES);
    const viaCurve = applyToneCurveToRasterBand(raster, 0, anchors);
    const viaStretch = applyBlackWhitePointsToRasterBand(raster, 0, { black: 0, white: 128 });
    expect(Array.from(viaCurve.bandPixels[0]!)).toEqual(Array.from(viaStretch.bandPixels[0]!));
  });
});
