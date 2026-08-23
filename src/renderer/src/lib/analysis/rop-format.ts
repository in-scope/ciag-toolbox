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
  // CT-310: set when the candidate WON a search rather than being a single
  // press, so a kept winner is never labelled as a seed anyone could re-roll.
  readonly searchedProjectionCount?: number | null;
}

// "ROP (seed 20260822)" unscored; "ROP (seed 20260822, CNR: 1.234)" scored;
// "ROP search (50 projections, CNR: 1.234)" for a search winner.
export function formatRopKeptHistoryLabel(inputs: RopKeptLabelInputs): string {
  const searched = describeSearchedProjectionsOrNull(inputs);
  if (searched !== null) return searched;
  if (inputs.objectiveLabel === null || inputs.score === null) {
    return `ROP (seed ${inputs.seed})`;
  }
  const score = formatRopScoreToSignificantFigures(inputs.score);
  return `ROP (seed ${inputs.seed}, ${inputs.objectiveLabel}: ${score})`;
}

// A search winner is never described by its seed: the seed drew the whole
// sequence, not the winning candidate, so re-rolling it would not reproduce
// this stack. An unscored winner (its scoring run was stopped) simply says how
// many projections were searched.
function describeSearchedProjectionsOrNull(inputs: RopKeptLabelInputs): string | null {
  const count = inputs.searchedProjectionCount ?? null;
  if (count === null) return null;
  if (inputs.objectiveLabel === null || inputs.score === null) {
    return `ROP search (${count} projections)`;
  }
  const score = formatRopScoreToSignificantFigures(inputs.score);
  return `ROP search (${count} projections, ${inputs.objectiveLabel}: ${score})`;
}
