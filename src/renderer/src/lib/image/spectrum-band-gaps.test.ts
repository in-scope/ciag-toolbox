import { describe, expect, it } from "vitest";

import { listContiguousBandRuns } from "@/lib/image/spectrum-band-gaps";

describe("listContiguousBandRuns", () => {
  it("returns a single run when all kept bands are contiguous", () => {
    expect(listContiguousBandRuns([1, 2, 3, 4])).toEqual([
      { startIndex: 0, endIndexExclusive: 4 },
    ]);
  });

  it("splits into two runs when a middle band is removed", () => {
    expect(listContiguousBandRuns([1, 2, 5, 6])).toEqual([
      { startIndex: 0, endIndexExclusive: 2 },
      { startIndex: 2, endIndexExclusive: 4 },
    ]);
  });

  it("produces a run break for every removed middle band", () => {
    expect(listContiguousBandRuns([1, 3, 5])).toEqual([
      { startIndex: 0, endIndexExclusive: 1 },
      { startIndex: 1, endIndexExclusive: 2 },
      { startIndex: 2, endIndexExclusive: 3 },
    ]);
  });

  it("does not break for leading removed bands (kept run starts mid-cube)", () => {
    expect(listContiguousBandRuns([3, 4, 5])).toEqual([
      { startIndex: 0, endIndexExclusive: 3 },
    ]);
  });

  it("does not break for trailing removed bands", () => {
    expect(listContiguousBandRuns([1, 2, 3])).toEqual([
      { startIndex: 0, endIndexExclusive: 3 },
    ]);
  });

  it("keeps leading and trailing removals as a single run when the middle is intact", () => {
    expect(listContiguousBandRuns([4, 5, 6, 7])).toEqual([
      { startIndex: 0, endIndexExclusive: 4 },
    ]);
  });

  it("returns an empty list for an empty band set", () => {
    expect(listContiguousBandRuns([])).toEqual([]);
  });

  it("returns a single one-band run for a lone kept band", () => {
    expect(listContiguousBandRuns([7])).toEqual([
      { startIndex: 0, endIndexExclusive: 1 },
    ]);
  });
});
