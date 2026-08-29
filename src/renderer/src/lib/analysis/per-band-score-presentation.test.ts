import { describe, expect, it } from "vitest";

import {
  buildPerBandScorePlotInput,
  formatPerBandScoreRowList,
  selectTopScoringBandRows,
} from "@/lib/analysis/per-band-score-presentation";
import type { RasterImage } from "@/lib/image/raster-image";

function buildRaster(bandCount: number, overrides: Partial<RasterImage> = {}): RasterImage {
  return {
    bandPixels: Array.from({ length: bandCount }, () => Float32Array.from([0])),
    width: 1,
    height: 1,
    bitsPerSample: 32,
    sampleFormat: "float",
    bandCount,
    ...overrides,
  };
}

function listBandIndexes(rows: ReadonlyArray<{ readonly bandIndex: number }>): number[] {
  return rows.map((row) => row.bandIndex);
}

describe("selectTopScoringBandRows", () => {
  it("keeps at most five rows, best score first", () => {
    const rows = selectTopScoringBandRows(buildRaster(7), [0.1, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4]);
    expect(listBandIndexes(rows)).toEqual([1, 5, 3, 6, 2]);
  });

  it("breaks ties by band order", () => {
    const rows = selectTopScoringBandRows(buildRaster(4), [1, 1, 0.5, 1]);
    expect(listBandIndexes(rows)).toEqual([0, 1, 3, 2]);
  });

  it("lists every band when the stack has fewer than five", () => {
    const rows = selectTopScoringBandRows(buildRaster(3), [0.2, 0.8, 0.5]);
    expect(listBandIndexes(rows)).toEqual([1, 2, 0]);
  });

  it("lists the only band of a single-band stack", () => {
    const rows = selectTopScoringBandRows(buildRaster(1), [0.42]);
    expect(rows).toEqual([{ bandIndex: 0, bandIdentityText: "Band 1", score: 0.42 }]);
  });

  it("names each band the way the band slider does", () => {
    const raster = buildRaster(2, { bandLabels: ["Red", "Green"], bandOriginalNumbers: [3, 4] });
    const rows = selectTopScoringBandRows(raster, [0.1, 0.9]);
    expect(rows.map((row) => row.bandIdentityText)).toEqual(["#4 Green", "#3 Red"]);
  });

  it("never lists a band whose score is not finite", () => {
    const rows = selectTopScoringBandRows(buildRaster(3), [Number.NaN, 0.5, Number.POSITIVE_INFINITY]);
    expect(listBandIndexes(rows)).toEqual([1]);
  });

  it("leaves the scores it was given untouched", () => {
    const scores = [0.1, 0.9, 0.3];
    selectTopScoringBandRows(buildRaster(3), scores);
    expect(scores).toEqual([0.1, 0.9, 0.3]);
  });
});

describe("formatPerBandScoreRowList", () => {
  it("names each row and its score in list order", () => {
    const rows = selectTopScoringBandRows(buildRaster(3), [0.25, 1, 0.5]);
    expect(formatPerBandScoreRowList(rows, (score) => score.toPrecision(4))).toBe(
      "Band 2 1.000, Band 3 0.5000, Band 1 0.2500",
    );
  });

  it("is empty for no rows", () => {
    expect(formatPerBandScoreRowList([], (score) => String(score))).toBe("");
  });
});

describe("buildPerBandScorePlotInput", () => {
  it("plots the scores against wavelength when every band has one", () => {
    const raster = buildRaster(3, { bandWavelengths: [400, 500, 600] });
    const plot = buildPerBandScorePlotInput(raster, [0.1, 0.2, 0.3], "NPC");
    expect(plot.xAxisLabel).toBe("Wavelength (nm)");
    expect(plot.bandPositions).toEqual([400, 500, 600]);
    expect(plot.lines).toEqual([
      { id: "NPC", colorClass: "text-primary", values: [0.1, 0.2, 0.3] },
    ]);
  });

  it("falls back to band number when a wavelength is missing", () => {
    const raster = buildRaster(3, { bandWavelengths: [400, 500] });
    const plot = buildPerBandScorePlotInput(raster, [0.1, 0.2, 0.3], "NPC");
    expect(plot.xAxisLabel).toBe("Band index");
    expect(plot.bandPositions).toEqual([1, 2, 3]);
  });

  it("labels the hover with the same band identity text as the top list", () => {
    const raster = buildRaster(2, { bandLabels: ["Red", "Green"], bandOriginalNumbers: [3, 4] });
    const plot = buildPerBandScorePlotInput(raster, [0.1, 0.2], "CNR");
    expect(plot.hoverBandLabels).toEqual(["#3 Red", "#4 Green"]);
  });
});
