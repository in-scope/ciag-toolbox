import { formatRasterBandIdentityText, type RasterImage } from "@/lib/image/raster-image";
import { buildSpectrumXAxisFromRaster } from "@/lib/image/spectrum-axis";
import type { BandRun } from "@/lib/image/spectrum-band-gaps";
import type { SpectrumPlotLine } from "@/lib/image/spectrum-plot-line-set";

// CT-319: NPC, and CT-320's CNR, score every band on its own. Both asides
// present that the same way: one line against the stack's own x axis, and the
// best few bands named and numbered. The selection, the plot input and the
// History row text are pure and shared, so the two panels cannot drift apart.

export const MAX_TOP_SCORING_BAND_ROWS = 5;

export type PerBandScoreFormatter = (score: number) => string;

export interface PerBandScoreRow {
  readonly bandIndex: number;
  readonly bandIdentityText: string;
  readonly score: number;
}

// A band whose score is not finite is not comparable, so it never enters the
// list; CNR produces one whenever a background category has no spread.
export function selectTopScoringBandRows(
  raster: RasterImage,
  scores: ReadonlyArray<number>,
  maxRows: number = MAX_TOP_SCORING_BAND_ROWS,
): ReadonlyArray<PerBandScoreRow> {
  return listFinitelyScoredBandRows(raster, scores)
    .sort(compareByScoreDescendingThenByBandOrder)
    .slice(0, maxRows);
}

function listFinitelyScoredBandRows(
  raster: RasterImage,
  scores: ReadonlyArray<number>,
): PerBandScoreRow[] {
  const rows: PerBandScoreRow[] = [];
  scores.forEach((score, bandIndex) => {
    if (!Number.isFinite(score)) return;
    rows.push(describeScoredBandRow(raster, bandIndex, score));
  });
  return rows;
}

function describeScoredBandRow(
  raster: RasterImage,
  bandIndex: number,
  score: number,
): PerBandScoreRow {
  return {
    bandIndex,
    bandIdentityText: formatRasterBandIdentityText(raster, bandIndex),
    score,
  };
}

function compareByScoreDescendingThenByBandOrder(
  left: PerBandScoreRow,
  right: PerBandScoreRow,
): number {
  if (left.score !== right.score) return right.score - left.score;
  return left.bandIndex - right.bandIndex;
}

export function formatPerBandScoreRowList(
  rows: ReadonlyArray<PerBandScoreRow>,
  formatScore: PerBandScoreFormatter,
): string {
  return rows.map((row) => `${row.bandIdentityText} ${formatScore(row.score)}`).join(", ");
}

export interface PerBandScorePlotInput {
  readonly bandPositions: ReadonlyArray<number>;
  readonly bandRuns: ReadonlyArray<BandRun>;
  readonly tickPositions: ReadonlyArray<number>;
  readonly tickLabels: ReadonlyArray<string>;
  readonly xAxisLabel: string;
  readonly lines: ReadonlyArray<SpectrumPlotLine>;
  readonly hoverBandLabels: ReadonlyArray<string>;
}

const PER_BAND_SCORE_LINE_COLOR_CLASS = "text-primary";

// The x axis is the stack's own: wavelength when every band carries one, band
// number otherwise, with the pixel spectrum's treatment of removed-band gaps.
export function buildPerBandScorePlotInput(
  raster: RasterImage,
  scores: ReadonlyArray<number>,
  lineId: string,
): PerBandScorePlotInput {
  const axis = buildSpectrumXAxisFromRaster(raster);
  return {
    bandPositions: axis.bandPositions,
    bandRuns: axis.bandRuns,
    tickPositions: axis.tickPositions,
    tickLabels: axis.tickLabels,
    xAxisLabel: axis.label,
    lines: [buildPerBandScorePlotLine(lineId, scores)],
    hoverBandLabels: listRasterBandIdentityTexts(raster),
  };
}

function buildPerBandScorePlotLine(
  lineId: string,
  scores: ReadonlyArray<number>,
): SpectrumPlotLine {
  return { id: lineId, colorClass: PER_BAND_SCORE_LINE_COLOR_CLASS, values: scores };
}

function listRasterBandIdentityTexts(raster: RasterImage): ReadonlyArray<string> {
  return Array.from({ length: raster.bandCount }, (_, index) =>
    formatRasterBandIdentityText(raster, index),
  );
}
