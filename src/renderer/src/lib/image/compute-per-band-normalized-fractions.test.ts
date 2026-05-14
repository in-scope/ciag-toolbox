import { describe, expect, it } from "vitest";

import { computePerBandNormalizedFractionsForReadout } from "./compute-pixel-readout";
import type { SingleBandScalarExtents } from "./compute-image-channel-extents";

const UINT8_EXTENTS: SingleBandScalarExtents = { min: 0, max: 255 };
const UINT16_EXTENTS: SingleBandScalarExtents = { min: 10, max: 65535 };
const INT32_EXTENTS: SingleBandScalarExtents = { min: -1000, max: 1000 };
const FLOAT32_EXTENTS: SingleBandScalarExtents = { min: -1, max: 1 };
const DEGENERATE_EXTENTS: SingleBandScalarExtents = { min: 42, max: 42 };

describe("computePerBandNormalizedFractionsForReadout", () => {
  it("returns null for every band when values is null", () => {
    const fractions = computePerBandNormalizedFractionsForReadout(null, [
      UINT8_EXTENTS,
      UINT8_EXTENTS,
    ]);
    expect(fractions).toEqual([null, null]);
  });

  it("normalizes uint8 band values to [0, 1] proportionally", () => {
    const fractions = computePerBandNormalizedFractionsForReadout(
      [0, 128, 255],
      [UINT8_EXTENTS, UINT8_EXTENTS, UINT8_EXTENTS],
    );
    expect(fractions[0]).toBeCloseTo(0, 6);
    expect(fractions[1]).toBeCloseTo(128 / 255, 6);
    expect(fractions[2]).toBeCloseTo(1, 6);
  });

  it("normalizes uint16 band values with a non-zero min extent", () => {
    const fractions = computePerBandNormalizedFractionsForReadout([10, 32772, 65535], [
      UINT16_EXTENTS,
      UINT16_EXTENTS,
      UINT16_EXTENTS,
    ]);
    expect(fractions[0]).toBeCloseTo(0, 6);
    expect(fractions[1]).toBeCloseTo((32772 - 10) / (65535 - 10), 6);
    expect(fractions[2]).toBeCloseTo(1, 6);
  });

  it("normalizes int32 band values across a signed range", () => {
    const fractions = computePerBandNormalizedFractionsForReadout([-1000, 0, 1000], [
      INT32_EXTENTS,
      INT32_EXTENTS,
      INT32_EXTENTS,
    ]);
    expect(fractions[0]).toBeCloseTo(0, 6);
    expect(fractions[1]).toBeCloseTo(0.5, 6);
    expect(fractions[2]).toBeCloseTo(1, 6);
  });

  it("normalizes float32 band values across a signed range", () => {
    const fractions = computePerBandNormalizedFractionsForReadout(
      [-1, 0.0, 0.25, 1],
      [FLOAT32_EXTENTS, FLOAT32_EXTENTS, FLOAT32_EXTENTS, FLOAT32_EXTENTS],
    );
    expect(fractions[0]).toBeCloseTo(0, 6);
    expect(fractions[1]).toBeCloseTo(0.5, 6);
    expect(fractions[2]).toBeCloseTo(0.625, 6);
    expect(fractions[3]).toBeCloseTo(1, 6);
  });

  it("returns fraction 0 for every band when min equals max (degenerate extents)", () => {
    const fractions = computePerBandNormalizedFractionsForReadout(
      [42, 42, 42],
      [DEGENERATE_EXTENTS, DEGENERATE_EXTENTS, DEGENERATE_EXTENTS],
    );
    expect(fractions).toEqual([0, 0, 0]);
  });

  it("returns null for bands whose value is undefined", () => {
    const fractions = computePerBandNormalizedFractionsForReadout([0, 128], [
      UINT8_EXTENTS,
      UINT8_EXTENTS,
      UINT8_EXTENTS,
    ]);
    expect(fractions[2]).toBeNull();
  });

  it("returns null for bands whose value is non-finite", () => {
    const fractions = computePerBandNormalizedFractionsForReadout(
      [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      [FLOAT32_EXTENTS, FLOAT32_EXTENTS, FLOAT32_EXTENTS],
    );
    expect(fractions).toEqual([null, null, null]);
  });

  it("clamps values outside [min, max] back into the unit range", () => {
    const fractions = computePerBandNormalizedFractionsForReadout([-50, 300], [
      UINT8_EXTENTS,
      UINT8_EXTENTS,
    ]);
    expect(fractions[0]).toBe(0);
    expect(fractions[1]).toBe(1);
  });
});
