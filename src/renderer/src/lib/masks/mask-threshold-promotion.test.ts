import { describe, expect, it } from "vitest";

import type { RasterImage } from "@/lib/image/raster-image";
import type { LoadedReferenceCandidate } from "@/lib/image/reference-token";

import { createMaskLayer } from "./mask-layer";
import {
  filterLoadedReferenceCandidatesQualifyingForMaskPromotion,
  isTwoLevelUint8ThresholdResultRaster,
  promoteThresholdBandToMaskCategory,
} from "./mask-threshold-promotion";

function buildBinaryRaster(values: number[], width = 2, height = 2): RasterImage {
  return {
    bandPixels: [Uint8Array.from(values)],
    width,
    height,
    bandCount: 1,
    sampleFormat: "uint",
    bitsPerSample: 8,
  };
}

function buildCandidate(
  token: string,
  raster: RasterImage,
  label = token,
): LoadedReferenceCandidate {
  return { token, label, raster };
}

describe("isTwoLevelUint8ThresholdResultRaster", () => {
  it("accepts an 8-bit unsigned raster whose bands hold only 0 and 255", () => {
    const raster = buildBinaryRaster([0, 255, 255, 0]);
    expect(isTwoLevelUint8ThresholdResultRaster(raster)).toBe(true);
  });

  it("rejects a raster with a value other than 0 or 255", () => {
    const raster = buildBinaryRaster([0, 255, 128, 0]);
    expect(isTwoLevelUint8ThresholdResultRaster(raster)).toBe(false);
  });

  it("rejects a raster that is not 8-bit", () => {
    const raster = { ...buildBinaryRaster([0, 255, 0, 255]), bitsPerSample: 16 };
    expect(isTwoLevelUint8ThresholdResultRaster(raster)).toBe(false);
  });

  it("rejects a raster whose sample format is not unsigned", () => {
    const raster = { ...buildBinaryRaster([0, 255, 0, 255]), sampleFormat: "float" as const };
    expect(isTwoLevelUint8ThresholdResultRaster(raster)).toBe(false);
  });

  it("rejects when any band fails the check", () => {
    const raster: RasterImage = {
      ...buildBinaryRaster([0, 255, 0, 255]),
      bandPixels: [Uint8Array.from([0, 255, 0, 255]), Uint8Array.from([0, 255, 7, 255])],
      bandCount: 2,
    };
    expect(isTwoLevelUint8ThresholdResultRaster(raster)).toBe(false);
  });
});

describe("filterLoadedReferenceCandidatesQualifyingForMaskPromotion", () => {
  const matchingBinary = buildCandidate("panel::Panel 2", buildBinaryRaster([0, 255, 0, 255]));
  const mismatchedSize = buildCandidate(
    "panel::Panel 3",
    buildBinaryRaster([0, 255, 0, 255, 0, 255], 3, 2),
  );
  const notBinary = buildCandidate(
    "panel::Panel 4",
    { ...buildBinaryRaster([0, 255, 0, 255]), sampleFormat: "uint", bitsPerSample: 16 },
  );

  it("keeps only same-size, two-level 8-bit candidates", () => {
    const result = filterLoadedReferenceCandidatesQualifyingForMaskPromotion(
      [matchingBinary, mismatchedSize, notBinary],
      2,
      2,
    );
    expect(result).toEqual([matchingBinary]);
  });

  it("excludes the given token even when it would otherwise qualify", () => {
    const result = filterLoadedReferenceCandidatesQualifyingForMaskPromotion(
      [matchingBinary],
      2,
      2,
      matchingBinary.token,
    );
    expect(result).toEqual([]);
  });
});

describe("promoteThresholdBandToMaskCategory", () => {
  it("assigns the selected category only to white pixels, leaving black pixels untouched", () => {
    const layer = { ...createMaskLayer("mask-1", "Mask 1", 2, 2), values: Uint8Array.from([2, 0, 0, 2]) };
    const bandPixels = Uint8Array.from([255, 255, 0, 0]);
    const next = promoteThresholdBandToMaskCategory(layer, bandPixels, 1);
    expect(Array.from(next.values)).toEqual([1, 1, 0, 2]);
  });

  it("clamps the category to the layer's actual category count", () => {
    const layer = createMaskLayer("mask-1", "Mask 1", 2, 1);
    const bandPixels = Uint8Array.from([255, 255]);
    const next = promoteThresholdBandToMaskCategory(layer, bandPixels, 99);
    expect(Array.from(next.values)).toEqual([2, 2]);
  });

  it("does not mutate the source layer's values array", () => {
    const original = Uint8Array.from([0, 0]);
    const layer = { ...createMaskLayer("mask-1", "Mask 1", 2, 1), values: original };
    promoteThresholdBandToMaskCategory(layer, Uint8Array.from([255, 255]), 1);
    expect(Array.from(original)).toEqual([0, 0]);
  });
});
