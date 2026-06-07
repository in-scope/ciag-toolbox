import { describe, expect, it } from "vitest";

import {
  clampToDisplayUnit,
  computeDataTypeUnitMappingForRaster,
  mapRawValueToDisplayUnit,
} from "@/lib/image/data-type-display-range";
import type { RasterImage, RasterSampleFormat } from "@/lib/image/raster-image";

describe("computeDataTypeUnitMappingForRaster", () => {
  it("maps uint8 0..255 across black-to-white", () => {
    const mapping = mappingFor("uint", 8);
    expect(mapRawValueToDisplayUnit(0, mapping)).toBe(0);
    expect(mapRawValueToDisplayUnit(255, mapping)).toBe(1);
    expect(mapRawValueToDisplayUnit(128, mapping)).toBeCloseTo(128 / 255, 6);
  });

  it("maps uint16 0..65535 across black-to-white", () => {
    const mapping = mappingFor("uint", 16);
    expect(mapRawValueToDisplayUnit(0, mapping)).toBe(0);
    expect(mapRawValueToDisplayUnit(65535, mapping)).toBe(1);
  });

  it("keeps 12-bit data in a uint16 container dim until it is bit-shifted", () => {
    const mapping = mappingFor("uint", 16);
    expect(mapRawValueToDisplayUnit(4095, mapping)).toBeLessThan(0.07);
    expect(mapRawValueToDisplayUnit(4095 * 16, mapping)).toBeGreaterThan(0.99);
  });

  it("maps signed int16 by its type range so the midpoint is mid-grey", () => {
    const mapping = mappingFor("int", 16);
    expect(mapRawValueToDisplayUnit(-32768, mapping)).toBe(0);
    expect(mapRawValueToDisplayUnit(32767, mapping)).toBeCloseTo(1, 6);
    expect(mapRawValueToDisplayUnit(0, mapping)).toBeCloseTo(0.5, 4);
  });

  it("maps signed int8 by its type range", () => {
    const mapping = mappingFor("int", 8);
    expect(mapRawValueToDisplayUnit(-128, mapping)).toBe(0);
    expect(mapRawValueToDisplayUnit(127, mapping)).toBeCloseTo(1, 6);
    expect(mapRawValueToDisplayUnit(0, mapping)).toBeCloseTo(128 / 255, 6);
  });

  it("passes float values through and clamps them to [0, 1]", () => {
    const mapping = mappingFor("float", 32);
    expect(mapRawValueToDisplayUnit(0.3, mapping)).toBeCloseTo(0.3, 6);
    expect(mapRawValueToDisplayUnit(1.5, mapping)).toBe(1);
    expect(mapRawValueToDisplayUnit(-0.5, mapping)).toBe(0);
  });
});

describe("clampToDisplayUnit", () => {
  it("clamps below 0 and above 1 and passes in-range values through", () => {
    expect(clampToDisplayUnit(-2)).toBe(0);
    expect(clampToDisplayUnit(2)).toBe(1);
    expect(clampToDisplayUnit(0.42)).toBe(0.42);
  });
});

function mappingFor(sampleFormat: RasterSampleFormat, bitsPerSample: number) {
  return computeDataTypeUnitMappingForRaster(buildRaster(sampleFormat, bitsPerSample));
}

function buildRaster(
  sampleFormat: RasterSampleFormat,
  bitsPerSample: number,
): RasterImage {
  return {
    bandPixels: [new Uint8Array([0])],
    width: 1,
    height: 1,
    bitsPerSample,
    sampleFormat,
    bandCount: 1,
  };
}
