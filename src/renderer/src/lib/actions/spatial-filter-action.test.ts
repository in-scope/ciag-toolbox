import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";

import {
  readSpatialFilterSettings,
  SPATIAL_FILTER_ACTION,
} from "./spatial-filter-action";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "./viewport-action";

// A flat band is the exact high-pass oracle: its only spatial frequency is DC,
// which the high-pass transfer removes entirely, so every filtered pixel
// lands at (numerically) zero while a carried-through band keeps its values.
function makeTwoFlatBandStack(): RasterImage {
  return {
    bandPixels: [new Uint8Array(16).fill(100), new Uint8Array(16).fill(40)],
    width: 4,
    height: 4,
    bandCount: 2,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

// CT-219a: the transform is async (worker-backed in the app; vitest's node
// environment has no Worker, so the inline reusable-grid path runs here).
async function transformRaster(
  parameterValues: Record<string, number | string | boolean>,
): Promise<RasterImage> {
  const result = await SPATIAL_FILTER_ACTION.transformSourceAsync!(
    { kind: "raster", raster: makeTwoFlatBandStack() },
    parameterValues,
  );
  return (result as { raster: RasterImage }).raster;
}

function expectBandIsNumericallyZero(band: ArrayLike<number>): void {
  for (let index = 0; index < band.length; index += 1) {
    expect(Math.abs(band[index] ?? Number.NaN)).toBeLessThan(1e-6);
  }
}

describe("readSpatialFilterSettings", () => {
  it("defaults to a low-pass at cutoff 0.15", () => {
    expect(readSpatialFilterSettings({})).toEqual({ mode: "lowpass", cutoff: 0.15 });
  });

  it("reads each mode's own cutoff field(s)", () => {
    expect(readSpatialFilterSettings({ mode: "lowpass", lowpassCutoff: 0.3 })).toEqual({
      mode: "lowpass",
      cutoff: 0.3,
    });
    expect(readSpatialFilterSettings({ mode: "highpass", highpassCutoff: 0.02 })).toEqual({
      mode: "highpass",
      cutoff: 0.02,
    });
    expect(
      readSpatialFilterSettings({ mode: "bandpass", bandpassLowCutoff: 0.1, bandpassHighCutoff: 0.4 }),
    ).toEqual({ mode: "bandpass", lowCutoff: 0.1, highCutoff: 0.4 });
  });
});

describe("SPATIAL_FILTER_ACTION", () => {
  it("filters every band under the default full-stack scope into a float32 stack", async () => {
    const raster = await transformRaster({ mode: "highpass", highpassCutoff: 0.05 });
    expect(raster.sampleFormat).toBe("float");
    expect(raster.bitsPerSample).toBe(32);
    expect(raster.bandCount).toBe(2);
    expect(raster.width).toBe(4);
    expect(raster.height).toBe(4);
    expectBandIsNumericallyZero(raster.bandPixels[0]!);
    expectBandIsNumericallyZero(raster.bandPixels[1]!);
  });

  it("filters only the entered bands under band-wise scope and carries the rest unchanged", async () => {
    const raster = await transformRaster({
      mode: "highpass",
      highpassCutoff: 0.05,
      scope: "band-wise",
      bandRange: "2",
    });
    expect(Array.from(raster.bandPixels[0]!)).toEqual(Array.from(new Float32Array(16).fill(100)));
    expectBandIsNumericallyZero(raster.bandPixels[1]!);
  });

  it("filters every band when band-wise scope has an empty range (CT-251)", async () => {
    const prepared = SPATIAL_FILTER_ACTION.prepareParameterValuesForApply!(
      { mode: "highpass", highpassCutoff: 0.05, scope: "band-wise", bandRange: "" },
      { ...DEFAULT_VIEWPORT_RENDERING_STATE, selectedBandIndex: 1 },
      "whole-image",
      makeTwoFlatBandStack(),
    );
    const raster = await transformRaster({ ...prepared });
    expectBandIsNumericallyZero(raster.bandPixels[0]!);
    expectBandIsNumericallyZero(raster.bandPixels[1]!);
  });

  it("records the full band range for an empty-field band-wise apply (CT-251)", () => {
    const prepared = SPATIAL_FILTER_ACTION.prepareParameterValuesForApply!(
      { mode: "highpass", highpassCutoff: 0.05, scope: "band-wise", bandRange: "" },
      DEFAULT_VIEWPORT_RENDERING_STATE,
      "whole-image",
      makeTwoFlatBandStack(),
    );
    expect(SPATIAL_FILTER_ACTION.formatAppliedLabel!(prepared)).toBe(
      "Frequency filters (high-pass, cutoff 0.05, band-wise: bands 1-2)",
    );
  });

  it("rejects an invalid band range with a user-facing error", async () => {
    await expect(
      transformRaster({ mode: "lowpass", scope: "band-wise", bandRange: "9" }),
    ).rejects.toThrow(/band/i);
  });

  it("pre-flights an oversized stack with a clear error before any panel is reserved", () => {
    const hugeRaster = { ...makeTwoFlatBandStack(), width: 20000, height: 20000 };
    expect(() =>
      SPATIAL_FILTER_ACTION.assertCanApplyToSource!({ kind: "raster", raster: hugeRaster }, {}),
    ).toThrow(/too large for the frequency filter/);
  });

  it("accepts a normal-size stack in the pre-flight check", () => {
    expect(() =>
      SPATIAL_FILTER_ACTION.assertCanApplyToSource!(
        { kind: "raster", raster: makeTwoFlatBandStack() },
        {},
      ),
    ).not.toThrow();
  });

  it("records mode, cutoff(s), and scope in the applied label for the audit trail", () => {
    expect(SPATIAL_FILTER_ACTION.formatAppliedLabel!({ mode: "lowpass", lowpassCutoff: 0.15 })).toBe(
      "Frequency filters (low-pass, cutoff 0.15, full stack)",
    );
    expect(
      SPATIAL_FILTER_ACTION.formatAppliedLabel!({
        mode: "highpass",
        highpassCutoff: 0.05,
        scope: "band-wise",
        bandRange: "1-2",
      }),
    ).toBe("Frequency filters (high-pass, cutoff 0.05, band-wise: bands 1-2)");
    expect(
      SPATIAL_FILTER_ACTION.formatAppliedLabel!({
        mode: "bandpass",
        bandpassLowCutoff: 0.05,
        bandpassHighCutoff: 0.25,
      }),
    ).toBe("Frequency filters (bandpass 0.05 - 0.25, full stack)");
  });
});

// CT-221 per-band completions plus CT-225 within-band FFT-line fractions: the
// sequence is monotonic 0..1 over FILTERED bands, crossing each band boundary.
describe("SPATIAL_FILTER_ACTION progress (CT-221/CT-225)", () => {
  it("advances monotonically through both filtered bands with within-band fractions", async () => {
    const ticks: number[] = [];
    await SPATIAL_FILTER_ACTION.transformSourceAsync!(
      { kind: "raster", raster: makeTwoFlatBandStack() },
      { mode: "highpass", highpassCutoff: 0.02 },
      (fraction) => ticks.push(fraction),
    );
    expectMonotonicZeroToOne(ticks);
    expect(ticks).toContain(1 / 2);
    expect(ticks.some((tick) => tick > 0 && tick < 1 / 2)).toBe(true);
    expect(ticks.some((tick) => tick > 1 / 2 && tick < 1)).toBe(true);
  });

  it("counts filtered bands only: a single band-wise band spans the whole bar itself", async () => {
    const ticks: number[] = [];
    await SPATIAL_FILTER_ACTION.transformSourceAsync!(
      { kind: "raster", raster: makeTwoFlatBandStack() },
      { mode: "highpass", highpassCutoff: 0.02, scope: "band-wise", bandRange: "1" },
      (fraction) => ticks.push(fraction),
    );
    expectMonotonicZeroToOne(ticks);
    expect(ticks.some((tick) => tick > 0 && tick < 1)).toBe(true);
  });
});

function expectMonotonicZeroToOne(ticks: ReadonlyArray<number>): void {
  expect(ticks.length).toBeGreaterThan(2);
  expect(ticks[ticks.length - 1]).toBe(1);
  for (let i = 1; i < ticks.length; i += 1) {
    expect(ticks[i]!).toBeGreaterThanOrEqual(ticks[i - 1]!);
  }
  for (const tick of ticks) {
    expect(tick).toBeGreaterThanOrEqual(0);
    expect(tick).toBeLessThanOrEqual(1);
  }
}
