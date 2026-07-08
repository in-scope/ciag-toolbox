import { describe, expect, it } from "vitest";

import {
  buildTransformOutputBandMetadata,
  validateTransformedCubeAgainstSource,
} from "./cube-transform-contract";
import {
  SCRIPTING_DOCS_HINT,
  UserScriptReturnContractError,
} from "./user-script-return-contract";

const SOURCE_HEIGHT = 2;
const SOURCE_WIDTH = 3;

function makeBands(bandCount: number, pixelsPerBand = SOURCE_HEIGHT * SOURCE_WIDTH): Float32Array[] {
  return Array.from({ length: bandCount }, (_, index) =>
    new Float32Array(pixelsPerBand).fill(index + 1),
  );
}

describe("validateTransformedCubeAgainstSource", () => {
  it("accepts a cube with the same band count as the source", () => {
    const bands = makeBands(3);
    const result = validateTransformedCubeAgainstSource(
      [3, SOURCE_HEIGHT, SOURCE_WIDTH],
      bands,
      SOURCE_HEIGHT,
      SOURCE_WIDTH,
    );
    expect(result.shape).toEqual([3, SOURCE_HEIGHT, SOURCE_WIDTH]);
    expect(result.bands).toBe(bands);
  });

  it("accepts a reduced band count, down to a single band", () => {
    expect(() =>
      validateTransformedCubeAgainstSource(
        [1, SOURCE_HEIGHT, SOURCE_WIDTH],
        makeBands(1),
        SOURCE_HEIGHT,
        SOURCE_WIDTH,
      ),
    ).not.toThrow();
  });

  it("accepts an expanded band count", () => {
    expect(() =>
      validateTransformedCubeAgainstSource(
        [7, SOURCE_HEIGHT, SOURCE_WIDTH],
        makeBands(7),
        SOURCE_HEIGHT,
        SOURCE_WIDTH,
      ),
    ).not.toThrow();
  });

  it("rejects a cube with zero bands", () => {
    expect(() =>
      validateTransformedCubeAgainstSource([0, SOURCE_HEIGHT, SOURCE_WIDTH], [], SOURCE_HEIGHT, SOURCE_WIDTH),
    ).toThrow(/at least one band/);
  });

  it("rejects a height mismatch with the source", () => {
    expect(() =>
      validateTransformedCubeAgainstSource(
        [2, 5, SOURCE_WIDTH],
        makeBands(2, 5 * SOURCE_WIDTH),
        SOURCE_HEIGHT,
        SOURCE_WIDTH,
      ),
    ).toThrow(/expected 2 x 3, got 5 x 3/);
  });

  it("rejects a width mismatch with the source", () => {
    expect(() =>
      validateTransformedCubeAgainstSource(
        [2, SOURCE_HEIGHT, 4],
        makeBands(2, SOURCE_HEIGHT * 4),
        SOURCE_HEIGHT,
        SOURCE_WIDTH,
      ),
    ).toThrow(UserScriptReturnContractError);
  });

  it("rejects a shape that is not three-dimensional", () => {
    expect(() =>
      validateTransformedCubeAgainstSource([SOURCE_HEIGHT, SOURCE_WIDTH], makeBands(2), SOURCE_HEIGHT, SOURCE_WIDTH),
    ).toThrow(/\(bands, height, width\)/);
  });

  it("rejects a band count that disagrees with the delivered band list", () => {
    expect(() =>
      validateTransformedCubeAgainstSource(
        [3, SOURCE_HEIGHT, SOURCE_WIDTH],
        makeBands(2),
        SOURCE_HEIGHT,
        SOURCE_WIDTH,
      ),
    ).toThrow(/reported 3 bands but delivered 2/);
  });

  it("rejects a band whose pixel count disagrees with the shape", () => {
    const bands = [new Float32Array(6), new Float32Array(5)];
    expect(() =>
      validateTransformedCubeAgainstSource([2, SOURCE_HEIGHT, SOURCE_WIDTH], bands, SOURCE_HEIGHT, SOURCE_WIDTH),
    ).toThrow(/band 2 must have 6 values \(got 5\)/i);
  });

  it("includes the docs hint in rejection messages", () => {
    expect(() =>
      validateTransformedCubeAgainstSource(
        [1, 9, 9],
        makeBands(1, 81),
        SOURCE_HEIGHT,
        SOURCE_WIDTH,
      ),
    ).toThrow(SCRIPTING_DOCS_HINT);
  });
});

describe("buildTransformOutputBandMetadata", () => {
  const sourceMeta = {
    bandCount: 3,
    bandLabels: ["Red", "Green", "Blue"],
    bandWavelengths: [650, 550, 450],
  };

  it("carries wavelengths and band labels through when the band count matches", () => {
    const meta = buildTransformOutputBandMetadata(sourceMeta, 3);
    expect(meta.bandLabels).toEqual(["Red", "Green", "Blue"]);
    expect(meta.bandWavelengths).toEqual([650, 550, 450]);
  });

  it("copies the carried metadata instead of aliasing the source arrays", () => {
    const meta = buildTransformOutputBandMetadata(sourceMeta, 3);
    expect(meta.bandLabels).not.toBe(sourceMeta.bandLabels);
    expect(meta.bandWavelengths).not.toBe(sourceMeta.bandWavelengths);
  });

  it("returns generic metadata (no labels, no wavelengths) when the band count changes", () => {
    expect(buildTransformOutputBandMetadata(sourceMeta, 2)).toEqual({});
    expect(buildTransformOutputBandMetadata(sourceMeta, 7)).toEqual({});
  });

  it("leaves absent source metadata absent on a matching count", () => {
    const meta = buildTransformOutputBandMetadata({ bandCount: 2 }, 2);
    expect(meta.bandLabels).toBeUndefined();
    expect(meta.bandWavelengths).toBeUndefined();
  });
});
