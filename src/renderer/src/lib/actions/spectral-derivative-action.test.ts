import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import type { PinnedPixelSpectrum } from "@/lib/image/spectrum-entry";

import {
  readSpectralDerivativeOrder,
  SPECTRAL_DERIVATIVE_ACTION,
} from "./spectral-derivative-action";
import { DEFAULT_VIEWPORT_RENDERING_STATE } from "./viewport-action";

// Mirrors the committed multiband-12bit.tif oracle: three collinear bands whose
// adjacent differences are 700 and 800 at every pixel. CT-285 keeps the source
// band count: the first-order derivative reads [700, 800, 800] (the last band
// takes the one-sided backward difference) and the second-order reads
// [100, 100, 100] (both edges take the one-sided second difference).
function makeThreeBandCollinearStack(): RasterImage {
  return {
    bandPixels: [
      Uint16Array.from([100, 250]),
      Uint16Array.from([800, 950]),
      Uint16Array.from([1600, 1750]),
    ],
    width: 2,
    height: 1,
    bandCount: 3,
    sampleFormat: "uint",
    bitsPerSample: 16,
  };
}

describe("SPECTRAL_DERIVATIVE_ACTION", () => {
  it("defaults to the first order and reads the second from the enum value", () => {
    expect(readSpectralDerivativeOrder({})).toBe(1);
    expect(readSpectralDerivativeOrder({ order: "1" })).toBe(1);
    expect(readSpectralDerivativeOrder({ order: "2" })).toBe(2);
  });

  it("emits a float32 stack of adjacent band differences for the first order", async () => {
    const result = await SPECTRAL_DERIVATIVE_ACTION.transformSourceAsync!(
      { kind: "raster", raster: makeThreeBandCollinearStack() },
      { order: "1" },
    );
    const raster = (result as { raster: RasterImage }).raster;
    expect(raster.sampleFormat).toBe("float");
    expect(raster.bandCount).toBe(3);
    expect(Array.from(raster.bandPixels[0]!)).toEqual([700, 700]);
    expect(Array.from(raster.bandPixels[1]!)).toEqual([800, 800]);
    expect(Array.from(raster.bandPixels[2]!)).toEqual([800, 800]);
  });

  it("emits the difference of differences for the second order", async () => {
    const result = await SPECTRAL_DERIVATIVE_ACTION.transformSourceAsync!(
      { kind: "raster", raster: makeThreeBandCollinearStack() },
      { order: "2" },
    );
    const raster = (result as { raster: RasterImage }).raster;
    expect(raster.bandCount).toBe(3);
    for (const band of raster.bandPixels) {
      expect(Array.from(band)).toEqual([100, 100]);
    }
  });

  it("rejects a stack too small for the chosen order before a panel is reserved", () => {
    const twoBands = {
      ...makeThreeBandCollinearStack(),
      bandPixels: [Uint16Array.from([1, 2]), Uint16Array.from([3, 4])],
      bandCount: 2,
    };
    expect(() =>
      SPECTRAL_DERIVATIVE_ACTION.assertCanApplyToSource!({ kind: "raster", raster: twoBands }, { order: "2" }),
    ).toThrow(/at least 3 bands/);
    expect(() =>
      SPECTRAL_DERIVATIVE_ACTION.assertCanApplyToSource!({ kind: "raster", raster: twoBands }, { order: "1" }),
    ).not.toThrow();
  });

  it("records the chosen order in the applied label for the audit trail", () => {
    expect(SPECTRAL_DERIVATIVE_ACTION.formatAppliedLabel!({ order: "1" })).toBe(
      "Spectral derivative (1st order)",
    );
    expect(SPECTRAL_DERIVATIVE_ACTION.formatAppliedLabel!({ order: "2" })).toBe(
      "Spectral derivative (2nd order)",
    );
  });

  it("resets band-dependent viewer state because the output measures a different quantity", () => {
    const pinnedSpectrum: PinnedPixelSpectrum = {
      kind: "pixel",
      id: "pin-1",
      imagePixelX: 0,
      imagePixelY: 0,
      bandValues: [1, 2, 3],
    };
    const state = {
      ...DEFAULT_VIEWPORT_RENDERING_STATE,
      selectedBandIndex: 2,
      removedBandIndexes: [1],
      isBandSubsetEditModeActive: true,
      pinnedSpectra: [pinnedSpectrum],
    };
    const next = SPECTRAL_DERIVATIVE_ACTION.apply(state, { order: "1" });
    expect(next.selectedBandIndex).toBe(0);
    expect(next.removedBandIndexes).toEqual([]);
    expect(next.isBandSubsetEditModeActive).toBe(false);
    expect(next.pinnedSpectra).toEqual([]);
  });
});

describe("SPECTRAL_DERIVATIVE_ACTION progress (CT-222)", () => {
  it("ticks once per output derivative band", async () => {
    const ticks: number[] = [];
    await SPECTRAL_DERIVATIVE_ACTION.transformSourceAsync!(
      { kind: "raster", raster: makeThreeBandCollinearStack() },
      { order: "1" },
      (fraction) => ticks.push(fraction),
    );
    expect(ticks).toEqual([0, 1 / 3, 2 / 3, 1]);
  });
});
