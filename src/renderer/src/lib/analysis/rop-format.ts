import { formatNpcScoreToSignificantFigures } from "./npc-score-format";

// CT-309: display and History formatting for the ROP panel. Scores share the
// NPC convention (four significant figures, trailing zeros kept) so every
// Stage 6 analysis reads the same way.

export function formatRopScoreToSignificantFigures(score: number): string {
  return formatNpcScoreToSignificantFigures(score);
}

export interface RopKeptLabelInputs {
  readonly seed: number;
  readonly objectiveLabel: string | null;
  readonly score: number | null;
}

// "ROP (seed 20260822)" unscored; "ROP (seed 20260822, CNR: 1.234)" scored.
export function formatRopKeptHistoryLabel(inputs: RopKeptLabelInputs): string {
  if (inputs.objectiveLabel === null || inputs.score === null) {
    return `ROP (seed ${inputs.seed})`;
  }
  const score = formatRopScoreToSignificantFigures(inputs.score);
  return `ROP (seed ${inputs.seed}, ${inputs.objectiveLabel}: ${score})`;
}
