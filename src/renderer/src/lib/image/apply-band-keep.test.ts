import { describe, expect, it } from "vitest";

import {
  applyBandKeepToRasterImage,
  listKeptBandIndexesFromRemoved,
  listKeptBandOriginalNumbersAfterRemovingBand,
  mapKeptBandNumbersToCurrentPositions,
} from "./apply-band-keep";
import { getRasterBandLabelOrDefault, type RasterImage } from "./raster-image";

describe("applyBandKeepToRasterImage", () => {
  it("keeps only the specified bands and remaps band indexes", () => {
    const raster = createThreeBandUint16Raster();
    const result = applyBandKeepToRasterImage(raster, [0, 2]);
    expect(result.bandCount).toBe(2);
    expect(Array.from(result.bandPixels[0]!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([100, 200, 300, 400]);
  });

  it("preserves width, height, bits per sample, and sample format", () => {
    const raster = createThreeBandUint16Raster();
    const result = applyBandKeepToRasterImage(raster, [1]);
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.bitsPerSample).toBe(16);
    expect(result.sampleFormat).toBe("uint");
  });

  it("preserves the typed-array constructor for each kept band", () => {
    const raster: RasterImage = {
      bandPixels: [
        new Float32Array([1.5, 2.5]),
        new Float32Array([3.5, 4.5]),
      ],
      width: 2,
      height: 1,
      bitsPerSample: 32,
      sampleFormat: "float",
      bandCount: 2,
    };
    const result = applyBandKeepToRasterImage(raster, [1]);
    expect(result.bandPixels[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result.bandPixels[0]!)).toEqual([3.5, 4.5]);
  });

  it("filters band labels and wavelengths in lockstep with kept indexes", () => {
    const raster: RasterImage = {
      ...createThreeBandUint16Raster(),
      bandLabels: ["Red", "Green", "Blue"],
      bandWavelengths: [650, 550, 450],
    };
    const result = applyBandKeepToRasterImage(raster, [0, 2]);
    expect(result.bandLabels).toEqual(["Red", "Blue"]);
    expect(result.bandWavelengths).toEqual([650, 450]);
  });

  it("preserves the original 1-based band numbers of the kept bands", () => {
    const raster = createThreeBandUint16Raster();
    const result = applyBandKeepToRasterImage(raster, [1, 2]);
    expect(result.bandOriginalNumbers).toEqual([2, 3]);
    expect(getRasterBandLabelOrDefault(result, 0)).toBe("Band 2");
    expect(getRasterBandLabelOrDefault(result, 1)).toBe("Band 3");
  });

  it("composes preserved numbers across a second keep", () => {
    const raster = createThreeBandUint16Raster();
    const firstKeep = applyBandKeepToRasterImage(raster, [1, 2]);
    const secondKeep = applyBandKeepToRasterImage(firstKeep, [1]);
    expect(secondKeep.bandOriginalNumbers).toEqual([3]);
    expect(getRasterBandLabelOrDefault(secondKeep, 0)).toBe("Band 3");
  });

  it("sorts and deduplicates the input index list", () => {
    const raster = createThreeBandUint16Raster();
    const result = applyBandKeepToRasterImage(raster, [2, 0, 2]);
    expect(result.bandCount).toBe(2);
    expect(Array.from(result.bandPixels[0]!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([100, 200, 300, 400]);
  });

  it("supports keeping a single band", () => {
    const raster = createThreeBandUint16Raster();
    const result = applyBandKeepToRasterImage(raster, [1]);
    expect(result.bandCount).toBe(1);
    expect(Array.from(result.bandPixels[0]!)).toEqual([10, 20, 30, 40]);
  });

  it("rejects an empty kept-band list", () => {
    const raster = createThreeBandUint16Raster();
    expect(() => applyBandKeepToRasterImage(raster, [])).toThrow(
      "Band keep requires at least one band to keep.",
    );
  });

  it("rejects an out-of-range kept band index", () => {
    const raster = createThreeBandUint16Raster();
    expect(() => applyBandKeepToRasterImage(raster, [0, 5])).toThrow(
      "Band index 5 out of range for raster with 3 bands.",
    );
  });

  it("does not mutate the source raster's band pixel buffers", () => {
    const sourceBand = new Uint16Array([7, 8, 9]);
    const raster: RasterImage = {
      bandPixels: [sourceBand],
      width: 3,
      height: 1,
      bitsPerSample: 16,
      sampleFormat: "uint",
      bandCount: 1,
    };
    applyBandKeepToRasterImage(raster, [0]);
    expect(Array.from(sourceBand)).toEqual([7, 8, 9]);
  });
});

describe("mapKeptBandNumbersToCurrentPositions", () => {
  it("maps original band numbers back to their current positions", () => {
    const subset: RasterImage = {
      ...createThreeBandUint16Raster(),
      bandOriginalNumbers: [2, 4, 7],
    };
    expect(mapKeptBandNumbersToCurrentPositions(subset, [4, 7])).toEqual([1, 2]);
  });

  it("defaults to one-based numbering for an un-subsetted raster", () => {
    const raster = createThreeBandUint16Raster();
    expect(mapKeptBandNumbersToCurrentPositions(raster, [1, 3])).toEqual([0, 2]);
  });

  it("throws when a requested band number is no longer present", () => {
    const raster = createThreeBandUint16Raster();
    expect(() => mapKeptBandNumbersToCurrentPositions(raster, [9])).toThrow(
      "Band 9 is no longer present in this image.",
    );
  });
});

describe("listKeptBandIndexesFromRemoved", () => {
  it("returns all indexes when nothing is removed", () => {
    expect(listKeptBandIndexesFromRemoved(4, [])).toEqual([0, 1, 2, 3]);
  });

  it("omits removed indexes and preserves ascending order", () => {
    expect(listKeptBandIndexesFromRemoved(5, [3, 1])).toEqual([0, 2, 4]);
  });

  it("returns an empty list when every band is removed", () => {
    expect(listKeptBandIndexesFromRemoved(3, [0, 1, 2])).toEqual([]);
  });

  it("ignores out-of-range removed indexes", () => {
    expect(listKeptBandIndexesFromRemoved(3, [5, 1])).toEqual([0, 2]);
  });
});

describe("listKeptBandOriginalNumbersAfterRemovingBand", () => {
  it("lists every original band number except the removed band", () => {
    const raster = createThreeBandUint16Raster();
    expect(listKeptBandOriginalNumbersAfterRemovingBand(raster, 1)).toEqual([1, 3]);
  });

  it("keeps the original numbers of an already-subsetted raster", () => {
    const subset: RasterImage = {
      ...createThreeBandUint16Raster(),
      bandOriginalNumbers: [2, 4, 7],
    };
    expect(listKeptBandOriginalNumbersAfterRemovingBand(subset, 0)).toEqual([4, 7]);
  });

  it("removing a single middle band leaves a non-contiguous kept stack", () => {
    const raster = createThreeBandUint16Raster();
    const keptNumbers = listKeptBandOriginalNumbersAfterRemovingBand(raster, 1);
    const keptPositions = mapKeptBandNumbersToCurrentPositions(raster, keptNumbers);
    const result = applyBandKeepToRasterImage(raster, keptPositions);
    expect(result.bandCount).toBe(2);
    expect(result.bandOriginalNumbers).toEqual([1, 3]);
    expect(Array.from(result.bandPixels[1]!)).toEqual([100, 200, 300, 400]);
  });
});

function createThreeBandUint16Raster(): RasterImage {
  return {
    bandPixels: [
      new Uint16Array([1, 2, 3, 4]),
      new Uint16Array([10, 20, 30, 40]),
      new Uint16Array([100, 200, 300, 400]),
    ],
    width: 2,
    height: 2,
    bitsPerSample: 16,
    sampleFormat: "uint",
    bandCount: 3,
  };
}
