import { describe, expect, it } from "vitest";

import type { CubeSampleMatrix } from "@/lib/image/dimension-reduction/cube-samples";

import { projectMeanCentredSamplesOntoComponentVectors } from "./project-samples";

function makeSampleMatrix(bands: ReadonlyArray<ReadonlyArray<number>>): CubeSampleMatrix {
  const bandValues = bands.map((band) => Float64Array.from(band));
  const sampleCount = bands[0]!.length;
  return { bandCount: bands.length, sampleCount, width: sampleCount, height: 1, bandValues };
}

describe("projectMeanCentredSamplesOntoComponentVectors", () => {
  it("mean-centres each sample and projects it onto every kept component vector", () => {
    const samples = makeSampleMatrix([
      [0, 2, 4],
      [0, 0, 0],
    ]);
    const projection = projectMeanCentredSamplesOntoComponentVectors(samples, [2, 0], [[1, 0]], 1);
    expect(Array.from(projection[0]!)).toEqual([-2, 0, 2]);
  });

  // CT-195: a non-finite value reaching the projection (a non-finite source value
  // or fit vector) would render the float display texture as a white/blank panel.
  // Every dimension-reduction transform routes through here, so the guard keeps
  // PCA/MNF/ICA output finite.
  it("replaces a non-finite projected value with zero rather than emitting it", () => {
    const samples = makeSampleMatrix([[0, Number.POSITIVE_INFINITY, 5]]);
    const projection = projectMeanCentredSamplesOntoComponentVectors(samples, [0], [[1]], 1);
    expect(Array.from(projection[0]!)).toEqual([0, 0, 5]);
  });
});
