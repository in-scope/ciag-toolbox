import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";

import { PERCENTILE_CLIP_ACTION, readPercentileClipBounds } from "./percentile-clip-action";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "./viewport-action";

// Band 1 is the ramp 0..15 and band 2 the ramp 100..115, so the two scopes
// produce visibly different cut points: the whole-stack 25/75 pair over the 32
// concatenated values is [7.75, 107.25], while band 1's own 25/75 pair is
// [3.75, 11.25].
function makeTwoBandRampStack(): RasterImage {
  const rampFromBase = (base: number) =>
    Uint16Array.from({ length: 16 }, (_unused, index) => base + index);
  return {
    bandPixels: [rampFromBase(0), rampFromBase(100)],
    width: 4,
    height: 4,
    bandCount: 2,
    sampleFormat: "uint",
    bitsPerSample: 16,
  };
}

async function transformRaster(
  parameterValues: Record<string, number | string | boolean>,
): Promise<RasterImage> {
  const result = await PERCENTILE_CLIP_ACTION.transformSourceAsync!(
    { kind: "raster", raster: makeTwoBandRampStack() },
    parameterValues,
  );
  return (result as { raster: RasterImage }).raster;
}

describe("readPercentileClipBounds", () => {
  it("defaults to the 2..98 percentile window", () => {
    expect(readPercentileClipBounds({})).toEqual({ lowerPercentile: 2, upperPercentile: 98 });
  });

  it("reads the lower and upper percentile parameters", () => {
    expect(readPercentileClipBounds({ lowerPercentile: 10, upperPercentile: 90 })).toEqual({
      lowerPercentile: 10,
      upperPercentile: 90,
    });
  });
});

describe("PERCENTILE_CLIP_ACTION", () => {
  it("clips every band to one whole-stack cut-point pair under the default full-stack scope", async () => {
    const raster = await transformRaster({ lowerPercentile: 25, upperPercentile: 75 });
    expect(raster.sampleFormat).toBe("float");
    expect(raster.bitsPerSample).toBe(32);
    expect(raster.bandCount).toBe(2);
    expect(raster.width).toBe(4);
    expect(raster.height).toBe(4);
    expect(raster.bandPixels[0]![0]).toBeCloseTo(7.75, 5);
    expect(raster.bandPixels[0]![15]).toBe(15);
    expect(raster.bandPixels[1]![0]).toBe(100);
    expect(raster.bandPixels[1]![15]).toBeCloseTo(107.25, 5);
  });

  it("gives each entered band its own cut points under band-wise scope and carries the rest", async () => {
    const raster = await transformRaster({
      lowerPercentile: 25,
      upperPercentile: 75,
      scope: "band-wise",
      bandRange: "1",
    });
    expect(raster.bandPixels[0]![0]).toBeCloseTo(3.75, 5);
    expect(raster.bandPixels[0]![15]).toBeCloseTo(11.25, 5);
    expect(Array.from(raster.bandPixels[1]!)).toEqual(
      Array.from({ length: 16 }, (_unused, index) => 100 + index),
    );
  });

  it("falls back to the viewed band when band-wise scope has no entered range", async () => {
    const prepared = PERCENTILE_CLIP_ACTION.prepareParameterValuesForApply!(
      { lowerPercentile: 25, upperPercentile: 75, scope: "band-wise" },
      { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 1 },
      "whole-image",
    );
    const raster = await transformRaster({ ...prepared });
    expect(Array.from(raster.bandPixels[0]!)).toEqual(
      Array.from({ length: 16 }, (_unused, index) => index),
    );
    expect(raster.bandPixels[1]![0]).toBeCloseTo(103.75, 5);
    expect(raster.bandPixels[1]![15]).toBeCloseTo(111.25, 5);
  });

  it("is a no-op at the 0/100 percentiles", async () => {
    const raster = await transformRaster({ lowerPercentile: 0, upperPercentile: 100 });
    expect(Array.from(raster.bandPixels[0]!)).toEqual(
      Array.from({ length: 16 }, (_unused, index) => index),
    );
  });

  it("rejects an invalid band range with a user-facing error", async () => {
    await expect(transformRaster({ scope: "band-wise", bandRange: "9" })).rejects.toThrow(/band/i);
  });

  it("rejects inverted or out-of-range percentiles with user-facing errors", async () => {
    await expect(transformRaster({ lowerPercentile: 60, upperPercentile: 40 })).rejects.toThrow(
      /upper percentile at or above the lower/i,
    );
    await expect(transformRaster({ lowerPercentile: -5, upperPercentile: 98 })).rejects.toThrow(
      /lower percentile between 0 and 100/i,
    );
  });

  it("records the percentiles and scope in the applied label for the audit trail", () => {
    expect(PERCENTILE_CLIP_ACTION.formatAppliedLabel!({})).toBe(
      "Percentile clip (2 - 98%, full stack)",
    );
    expect(
      PERCENTILE_CLIP_ACTION.formatAppliedLabel!({
        lowerPercentile: 5,
        upperPercentile: 95,
        scope: "band-wise",
        bandRange: "1-2",
      }),
    ).toBe("Percentile clip (5 - 95%, band-wise: bands 1-2)");
  });
});

describe("PERCENTILE_CLIP_ACTION progress (CT-221)", () => {
  it("reports one tick per band under the full-stack scope", async () => {
    const ticks: number[] = [];
    await PERCENTILE_CLIP_ACTION.transformSourceAsync!(
      { kind: "raster", raster: makeTwoBandRampStack() },
      { lowerPercentile: 25, upperPercentile: 75 },
      (fraction) => ticks.push(fraction),
    );
    expect(ticks).toEqual([0, 1 / 2, 1]);
  });

  it("reports one tick per band under the band-wise scope including carried-through bands", async () => {
    const ticks: number[] = [];
    await PERCENTILE_CLIP_ACTION.transformSourceAsync!(
      { kind: "raster", raster: makeTwoBandRampStack() },
      { lowerPercentile: 25, upperPercentile: 75, scope: "band-wise", bandRange: "1" },
      (fraction) => ticks.push(fraction),
    );
    expect(ticks).toEqual([0, 1 / 2, 1]);
  });
});
