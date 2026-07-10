import { describe, expect, it } from "vitest";

import type { RasterTypedArray } from "@/lib/image/raster-image";

import { computePercentileCutPoints, type PercentileClipBounds } from "./percentile-clip";
import { computeWholeStackPercentileCutPoints } from "./whole-stack-percentile";

// CT-219c equivalence pin: the concatenation-free cut points must equal
// computePercentileCutPoints over the concatenated stack EXACTLY (toEqual, no
// tolerance), on both the counting-histogram path (small-integer bands) and the
// sorted-band-copy path (float and large-integer bands).

const PERCENTILE_PAIRS: ReadonlyArray<PercentileClipBounds> = [
  { lowerPercentile: 2, upperPercentile: 98 },
  { lowerPercentile: 25, upperPercentile: 75 },
  { lowerPercentile: 0, upperPercentile: 100 },
  { lowerPercentile: 50, upperPercentile: 50 },
  { lowerPercentile: 33.3, upperPercentile: 66.7 },
];

function concatenateBands(bands: ReadonlyArray<RasterTypedArray>): number[] {
  return bands.flatMap((band) => Array.from(band));
}

async function expectCutPointsToMatchTheConcatenatedReference(
  bands: ReadonlyArray<RasterTypedArray>,
): Promise<void> {
  for (const bounds of PERCENTILE_PAIRS) {
    const reference = computePercentileCutPoints(concatenateBands(bands), bounds);
    await expect(computeWholeStackPercentileCutPoints(bands, bounds)).resolves.toEqual(reference);
  }
}

function nextSeed(seed: number): number {
  return (seed * 1103515245 + 12345) % 2147483648;
}

function pseudoRandomBand<T extends RasterTypedArray>(
  target: T,
  seed: number,
  spread: number,
  offset: number,
): T {
  let state = seed;
  for (let index = 0; index < target.length; index += 1) {
    state = nextSeed(state);
    target[index] = (state / 2147483648) * spread + offset;
  }
  return target;
}

describe("computeWholeStackPercentileCutPoints (counting-histogram path)", () => {
  it("matches the concatenated reference on uint16 bands", async () => {
    await expectCutPointsToMatchTheConcatenatedReference([
      pseudoRandomBand(new Uint16Array(500), 3, 65535, 0),
      pseudoRandomBand(new Uint16Array(500), 11, 300, 40000),
      pseudoRandomBand(new Uint16Array(137), 29, 5, 0),
    ]);
  });

  it("matches the concatenated reference on mixed uint8 and int16 bands (negative offsets)", async () => {
    await expectCutPointsToMatchTheConcatenatedReference([
      pseudoRandomBand(new Uint8Array(400), 5, 255, 0),
      pseudoRandomBand(new Int16Array(400), 17, 60000, -30000),
      pseudoRandomBand(new Int8Array(64), 23, 250, -125),
    ]);
  });

  it("matches the concatenated reference on a single uint16 band", async () => {
    await expectCutPointsToMatchTheConcatenatedReference([
      pseudoRandomBand(new Uint16Array(97), 41, 1000, 100),
    ]);
  });
});

describe("computeWholeStackPercentileCutPoints (sorted-band-copy path)", () => {
  it("matches the concatenated reference on float32 bands", async () => {
    await expectCutPointsToMatchTheConcatenatedReference([
      pseudoRandomBand(new Float32Array(700), 7, 2000, -1000),
      pseudoRandomBand(new Float32Array(300), 13, 1, 0),
      pseudoRandomBand(new Float32Array(11), 37, 0.001, 5),
    ]);
  });

  it("matches the concatenated reference on float64, uint32, and int32 bands", async () => {
    await expectCutPointsToMatchTheConcatenatedReference([
      pseudoRandomBand(new Float64Array(250), 43, 1e9, -5e8),
      pseudoRandomBand(new Uint32Array(250), 47, 4_000_000_000, 0),
      pseudoRandomBand(new Int32Array(250), 53, 4_000_000_000, -2_000_000_000),
    ]);
  });

  it("matches the concatenated reference when float and small-integer bands mix", async () => {
    await expectCutPointsToMatchTheConcatenatedReference([
      pseudoRandomBand(new Uint16Array(300), 59, 65535, 0),
      pseudoRandomBand(new Float32Array(300), 61, 65535, 0),
    ]);
  });

  it("matches the concatenated reference when NaN values ride in a float band", async () => {
    const withNaN = pseudoRandomBand(new Float32Array(64), 67, 100, 0);
    withNaN[10] = Number.NaN;
    withNaN[40] = Number.NaN;
    const bands = [withNaN, pseudoRandomBand(new Float32Array(64), 71, 100, 0)];
    for (const bounds of PERCENTILE_PAIRS) {
      const reference = computePercentileCutPoints(concatenateBands(bands), bounds);
      const computed = await computeWholeStackPercentileCutPoints(bands, bounds);
      expect(computed.lowerCutPoint).toEqual(reference.lowerCutPoint);
      if (Number.isNaN(reference.upperCutPoint)) expect(computed.upperCutPoint).toBeNaN();
      else expect(computed.upperCutPoint).toEqual(reference.upperCutPoint);
    }
  });
});

describe("computeWholeStackPercentileCutPoints (contract and progress)", () => {
  it("rejects an empty stack with the user-facing no-pixel-values error", async () => {
    await expect(
      computeWholeStackPercentileCutPoints([], { lowerPercentile: 2, upperPercentile: 98 }),
    ).rejects.toThrow(/no pixel values/i);
    await expect(
      computeWholeStackPercentileCutPoints([new Float32Array(0)], {
        lowerPercentile: 2,
        upperPercentile: 98,
      }),
    ).rejects.toThrow(/no pixel values/i);
  });

  it("rejects invalid bounds with the user-facing percentile errors", async () => {
    await expect(
      computeWholeStackPercentileCutPoints([new Uint16Array([1])], {
        lowerPercentile: 60,
        upperPercentile: 40,
      }),
    ).rejects.toThrow(/upper percentile at or above the lower/i);
  });

  it("surfaces an allocation failure as the in-vocabulary memory error", async () => {
    const impossiblyLargeBand = {
      length: Number.MAX_SAFE_INTEGER,
      constructor: Float64Array,
    } as unknown as RasterTypedArray;
    await expect(
      computeWholeStackPercentileCutPoints([impossiblyLargeBand], {
        lowerPercentile: 2,
        upperPercentile: 98,
      }),
    ).rejects.toThrow(/not enough memory .* Band-wise scope/i);
  });

  it("ticks per band with within-band chunk ticks on the histogram path", async () => {
    const ticks: number[] = [];
    await computeWholeStackPercentileCutPoints(
      [new Uint16Array(10).fill(3), new Uint16Array(10).fill(7)],
      { lowerPercentile: 2, upperPercentile: 98 },
      (fraction) => ticks.push(fraction),
      { histogramValuesPerChunk: 5 },
    );
    expect(ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("ticks once per sorted band copy on the sorted path", async () => {
    const ticks: number[] = [];
    await computeWholeStackPercentileCutPoints(
      [new Float32Array([1, 2]), new Float32Array([3, 4]), new Float32Array([5, 6])],
      { lowerPercentile: 2, upperPercentile: 98 },
      (fraction) => ticks.push(fraction),
    );
    expect(ticks).toEqual([0, 1 / 3, 2 / 3, 1]);
  });

  it("emits no leading zero for single-band work so the spinner is kept until completion", async () => {
    const ticks: number[] = [];
    await computeWholeStackPercentileCutPoints(
      [new Float32Array([1, 2, 3])],
      { lowerPercentile: 2, upperPercentile: 98 },
      (fraction) => ticks.push(fraction),
    );
    expect(ticks[0]).toBeGreaterThan(0);
    expect(ticks[ticks.length - 1]).toBe(1);
  });
});
