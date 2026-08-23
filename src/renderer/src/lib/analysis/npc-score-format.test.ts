import { describe, expect, it } from "vitest";

import {
  formatNpcHistoryAppliedLabel,
  formatNpcScoreToSignificantFigures,
} from "./npc-score-format";

describe("formatNpcScoreToSignificantFigures", () => {
  it("keeps four significant figures, trailing zeros included", () => {
    expect(formatNpcScoreToSignificantFigures(0.9999999999999991)).toBe("1.000");
    expect(formatNpcScoreToSignificantFigures(0.25)).toBe("0.2500");
    expect(formatNpcScoreToSignificantFigures(0)).toBe("0.000");
  });

  it("rounds rather than truncates", () => {
    expect(formatNpcScoreToSignificantFigures(0.123456)).toBe("0.1235");
  });

  it("shows a dash rather than NaN when there is no usable score", () => {
    expect(formatNpcScoreToSignificantFigures(Number.NaN)).toBe("-");
    expect(formatNpcScoreToSignificantFigures(Number.POSITIVE_INFINITY)).toBe("-");
  });
});

describe("formatNpcHistoryAppliedLabel", () => {
  it("records the mask layer, the bin count, and the score", () => {
    expect(formatNpcHistoryAppliedLabel("Parchment mask", 255, 0.9999999999999991)).toBe(
      "NPC (Parchment mask, 255 bins): 1.000",
    );
  });
});
