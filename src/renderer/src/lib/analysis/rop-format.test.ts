import { describe, expect, it } from "vitest";

import { formatRopKeptHistoryLabel, formatRopScoreToSignificantFigures } from "./rop-format";

describe("formatRopScoreToSignificantFigures", () => {
  it("keeps four significant figures with trailing zeros, like NPC", () => {
    expect(formatRopScoreToSignificantFigures(1)).toBe("1.000");
    expect(formatRopScoreToSignificantFigures(0.25)).toBe("0.2500");
    expect(formatRopScoreToSignificantFigures(-4.56789)).toBe("-4.568");
  });
});

describe("formatRopKeptHistoryLabel", () => {
  it("names the seed alone for an unscored keep", () => {
    expect(
      formatRopKeptHistoryLabel({ seed: 20260822, objectiveLabel: null, score: null }),
    ).toBe("ROP (seed 20260822)");
  });

  it("names the seed, objective, and score for a scored keep", () => {
    expect(
      formatRopKeptHistoryLabel({ seed: 7, objectiveLabel: "CNR", score: -4 }),
    ).toBe("ROP (seed 7, CNR: -4.000)");
  });

  it("treats a score without an objective label as unscored", () => {
    expect(formatRopKeptHistoryLabel({ seed: 7, objectiveLabel: null, score: 1 })).toBe(
      "ROP (seed 7)",
    );
  });
});
