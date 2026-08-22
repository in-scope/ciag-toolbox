import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";

import {
  buildDuplicateBandsParameterValuesFromBandNumbers,
  DUPLICATE_BANDS_ACTION,
} from "./duplicate-bands-action";

function makeRaster(bandFillValues: ReadonlyArray<number>): RasterImage {
  return {
    bandPixels: bandFillValues.map((value) => new Uint16Array([value])),
    width: 1,
    height: 1,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: bandFillValues.length,
  };
}

describe("DUPLICATE_BANDS_ACTION", () => {
  it("appends copies of the requested original band numbers at the end, in order", () => {
    const source = { kind: "raster" as const, raster: makeRaster([10, 20, 30]) };
    const parameterValues = buildDuplicateBandsParameterValuesFromBandNumbers([3, 1]);
    const result = DUPLICATE_BANDS_ACTION.transformSource!(source, parameterValues);
    expect(result.kind).toBe("raster");
    if (result.kind !== "raster") return;
    expect(result.raster.bandCount).toBe(5);
    expect(result.raster.bandPixels.map((band) => band[0])).toEqual([10, 20, 30, 30, 10]);
  });

  it("formats the applied label from the duplicated band numbers, collapsing runs", () => {
    const parameterValues = buildDuplicateBandsParameterValuesFromBandNumbers([1, 3, 4, 5]);
    expect(DUPLICATE_BANDS_ACTION.formatAppliedLabel!(parameterValues)).toBe(
      "Duplicate bands (1,3-5)",
    );
  });

  it("throws a clear error when the parameter is missing", () => {
    const source = { kind: "raster" as const, raster: makeRaster([10]) };
    expect(() => DUPLICATE_BANDS_ACTION.transformSource!(source, {})).toThrow(
      /missing duplicatedBandNumbers/,
    );
  });
});
