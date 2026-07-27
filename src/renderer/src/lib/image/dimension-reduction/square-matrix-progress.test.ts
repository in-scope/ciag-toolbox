import { describe, expect, it } from "vitest";

import { buildSymmetricMatrixInPairChunksReportingProgress } from "./square-matrix-progress";

describe("buildSymmetricMatrixInPairChunksReportingProgress (CT-227 / CT-240)", () => {
  it("fills every entry to match a nested full-square builder of a symmetric function", async () => {
    const entry = (row: number, column: number): number => Math.min(row, column) * 10 + Math.max(row, column);
    const chunked = await buildSymmetricMatrixInPairChunksReportingProgress(3, entry);
    const reference = Array.from({ length: 3 }, (_u, row) =>
      Array.from({ length: 3 }, (_v, column) => entry(row, column)),
    );
    expect(chunked).toEqual(reference);
  });

  it("ticks once per upper-triangle band pair, ending at exactly 1", async () => {
    const ticks: number[] = [];
    await buildSymmetricMatrixInPairChunksReportingProgress(2, () => 0, (fraction) => ticks.push(fraction));
    expect(ticks).toEqual([1 / 3, 2 / 3, 1]);
  });

  it("computes each unordered pair exactly once and mirrors it", async () => {
    const seen: string[] = [];
    const matrix = await buildSymmetricMatrixInPairChunksReportingProgress(4, (row, column) => {
      seen.push(`${row},${column}`);
      return row * 100 + column;
    });
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
    expect(matrix[3]![1]).toBe(matrix[1]![3]);
  });
});
