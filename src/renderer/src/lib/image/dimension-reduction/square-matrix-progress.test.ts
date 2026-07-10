import { describe, expect, it } from "vitest";

import { buildSquareMatrixInPairChunksReportingProgress } from "./square-matrix-progress";

describe("buildSquareMatrixInPairChunksReportingProgress (CT-227)", () => {
  it("fills every entry in the same row-major order as a nested builder", async () => {
    const entry = (row: number, column: number): number => row * 10 + column;
    const chunked = await buildSquareMatrixInPairChunksReportingProgress(3, entry);
    const reference = Array.from({ length: 3 }, (_u, row) =>
      Array.from({ length: 3 }, (_v, column) => entry(row, column)),
    );
    expect(chunked).toEqual(reference);
  });

  it("ticks once per band pair, ending at exactly 1", async () => {
    const ticks: number[] = [];
    await buildSquareMatrixInPairChunksReportingProgress(2, () => 0, (fraction) => ticks.push(fraction));
    expect(ticks).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it("computes each entry exactly once", async () => {
    let calls = 0;
    await buildSquareMatrixInPairChunksReportingProgress(4, () => {
      calls += 1;
      return calls;
    });
    expect(calls).toBe(16);
  });
});
