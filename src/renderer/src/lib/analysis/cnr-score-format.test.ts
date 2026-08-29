import { describe, expect, it } from "vitest";

import {
  formatCnrHistoryAppliedLabel,
  formatCnrScoreToSignificantFigures,
} from "./cnr-score-format";
import type { PerBandScoreRow } from "./per-band-score-presentation";

function buildRow(bandIndex: number, score: number): PerBandScoreRow {
  return { bandIndex, bandIdentityText: `Band ${bandIndex + 1}`, score };
}

const RUN = {
  maskLayerName: "Parchment mask",
  textCategoryName: "Parchment",
  backgroundCategoryName: "Substrate",
};

describe("formatCnrScoreToSignificantFigures", () => {
  it("keeps trailing zeros so a measured score does not read as a constant", () => {
    expect(formatCnrScoreToSignificantFigures(2)).toBe("2.000");
  });

  it("shows a dash where the score is not a comparable number", () => {
    expect(formatCnrScoreToSignificantFigures(Number.POSITIVE_INFINITY)).toBe("-");
    expect(formatCnrScoreToSignificantFigures(Number.NaN)).toBe("-");
  });
});

describe("formatCnrHistoryAppliedLabel", () => {
  it("names the layer, both categories, and one row", () => {
    expect(formatCnrHistoryAppliedLabel(RUN, [buildRow(0, -10.7331)])).toBe(
      "CNR (Parchment mask, Parchment vs Substrate): Band 1 -10.73",
    );
  });

  it("lists several rows in the order the panel shows them", () => {
    const rows = [buildRow(1, 3.5), buildRow(0, 2.25), buildRow(2, -1)];
    expect(formatCnrHistoryAppliedLabel(RUN, rows)).toBe(
      "CNR (Parchment mask, Parchment vs Substrate): Band 2 3.500, Band 1 2.250, Band 3 -1.000",
    );
  });
});
