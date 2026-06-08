import { describe, expect, it } from "vitest";

import {
  assertFalseColorBandAssignmentInRange,
  buildFalseColorComposite,
  isFalseColorBandAssignmentInRange,
} from "./apply-false-color-composite";
import type { RasterImage } from "@/lib/image/raster-image";

function makeFourBandUint8Raster(): RasterImage {
  return {
    bandPixels: [
      Uint8Array.from([10, 11]),
      Uint8Array.from([20, 21]),
      Uint8Array.from([30, 31]),
      Uint8Array.from([40, 41]),
    ],
    width: 2,
    height: 1,
    bandCount: 4,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

describe("buildFalseColorComposite", () => {
  it("maps the three chosen bands to the R, G, and B channels in order", () => {
    const result = buildFalseColorComposite(makeFourBandUint8Raster(), { r: 3, g: 1, b: 4 });
    expect(result.bandCount).toBe(3);
    expect(Array.from(result.bandPixels[0]!)).toEqual([30, 31]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([10, 11]);
    expect(Array.from(result.bandPixels[2]!)).toEqual([40, 41]);
  });

  it("is order-sensitive: swapping R and B swaps the output channels", () => {
    const forward = buildFalseColorComposite(makeFourBandUint8Raster(), { r: 1, g: 2, b: 3 });
    const swapped = buildFalseColorComposite(makeFourBandUint8Raster(), { r: 3, g: 2, b: 1 });
    expect(Array.from(forward.bandPixels[0]!)).toEqual(Array.from(swapped.bandPixels[2]!));
    expect(Array.from(forward.bandPixels[2]!)).toEqual(Array.from(swapped.bandPixels[0]!));
  });

  it("records the channel assignment in labels and original band numbers", () => {
    const result = buildFalseColorComposite(makeFourBandUint8Raster(), { r: 3, g: 1, b: 4 });
    expect(result.bandLabels).toEqual(["R: band 3", "G: band 1", "B: band 4"]);
    expect(result.bandOriginalNumbers).toEqual([3, 1, 4]);
    expect(result.bandWavelengths).toBeUndefined();
  });

  it("preserves the source data type and dimensions", () => {
    const result = buildFalseColorComposite(makeFourBandUint8Raster(), { r: 1, g: 2, b: 3 });
    expect(result.bandPixels[0]).toBeInstanceOf(Uint8Array);
    expect(result.width).toBe(2);
    expect(result.height).toBe(1);
    expect(result.sampleFormat).toBe("uint");
  });

  it("allows the same band to be assigned to more than one channel", () => {
    const result = buildFalseColorComposite(makeFourBandUint8Raster(), { r: 2, g: 2, b: 2 });
    expect(Array.from(result.bandPixels[0]!)).toEqual([20, 21]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([20, 21]);
    expect(Array.from(result.bandPixels[2]!)).toEqual([20, 21]);
  });

  it("does not mutate the source raster", () => {
    const source = makeFourBandUint8Raster();
    buildFalseColorComposite(source, { r: 1, g: 2, b: 3 });
    expect(source.bandCount).toBe(4);
    expect(Array.from(source.bandPixels[0]!)).toEqual([10, 11]);
  });

  it.each([
    { label: "below 1", assignment: { r: 0, g: 2, b: 3 } },
    { label: "above the band count", assignment: { r: 1, g: 2, b: 5 } },
    { label: "non-integer", assignment: { r: 1.5, g: 2, b: 3 } },
  ])("rejects a band number that is $label", ({ assignment }) => {
    expect(() => buildFalseColorComposite(makeFourBandUint8Raster(), assignment)).toThrow(/out of range/i);
  });
});

describe("isFalseColorBandAssignmentInRange", () => {
  it("returns true only when every channel band is within [1, bandCount]", () => {
    const raster = makeFourBandUint8Raster();
    expect(isFalseColorBandAssignmentInRange(raster, { r: 1, g: 2, b: 4 })).toBe(true);
    expect(isFalseColorBandAssignmentInRange(raster, { r: 1, g: 2, b: 5 })).toBe(false);
    expect(isFalseColorBandAssignmentInRange(raster, { r: 0, g: 2, b: 3 })).toBe(false);
  });
});

describe("assertFalseColorBandAssignmentInRange", () => {
  it("names the offending channel in the error", () => {
    expect(() =>
      assertFalseColorBandAssignmentInRange(makeFourBandUint8Raster(), { r: 1, g: 9, b: 3 }),
    ).toThrow(/Green channel band 9/);
  });
});
