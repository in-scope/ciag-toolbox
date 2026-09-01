import {
  formatPerBandScoreRowList,
  type PerBandScoreRow,
} from "./per-band-score-presentation";

// CT-320: CNR is unbounded (and infinite when the background has no spread), so
// the panel and the History entry show four significant figures with trailing
// zeros KEPT (toPrecision, not a re-parsed number) and a dash where the score is
// not a comparable number.

const CNR_SCORE_SIGNIFICANT_FIGURES = 4;
const UNAVAILABLE_CNR_SCORE_TEXT = "-";

export function formatCnrScoreToSignificantFigures(score: number): string {
  if (!Number.isFinite(score)) return UNAVAILABLE_CNR_SCORE_TEXT;
  return score.toPrecision(CNR_SCORE_SIGNIFICANT_FIGURES);
}

export interface CnrHistoryRun {
  readonly maskLayerName: string;
  readonly textCategoryName: string;
  readonly backgroundCategoryName: string;
}

// The entry names the same rows the panel lists, in the same order, and says
// which category was contrasted against which.
export function formatCnrHistoryAppliedLabel(
  run: CnrHistoryRun,
  topBandRows: ReadonlyArray<PerBandScoreRow>,
): string {
  const rowList = formatPerBandScoreRowList(topBandRows, formatCnrScoreToSignificantFigures);
  const categories = `${run.textCategoryName} vs ${run.backgroundCategoryName}`;
  return `CNR (${run.maskLayerName}, ${categories}): ${rowList}`;
}
