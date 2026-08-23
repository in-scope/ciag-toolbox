// CT-309: the ROP panel's flat-memory candidate model. The panel only ever
// holds TWO candidates - the one on screen and the best-scoring one since the
// panel opened - so pressing "New projection" ten thousand times costs the same
// memory as pressing it once.

export interface RopCandidate {
  readonly seed: number;
  readonly values: Float32Array;
  readonly score: number | null;
  // CT-310: set when this candidate WON a search of that many projections,
  // which is what its History entry says instead of a seed nobody could
  // re-roll into this band.
  readonly searchedProjectionCount?: number | null;
}

// An unscored candidate (objective "None", or a scoring run that was stopped)
// never becomes the best: "best" is defined by the objective's score alone.
export function retainBestScoringRopCandidate(
  best: RopCandidate | null,
  next: RopCandidate,
): RopCandidate | null {
  if (next.score === null) return best;
  if (best === null || best.score === null || next.score > best.score) return next;
  return best;
}

// Switching objectives makes previous scores incomparable: the retained best
// resets and the on-screen candidate keeps its preview but drops its score.
export function dropScoresAfterObjectiveChange(
  current: RopCandidate | null,
): RopCandidate | null {
  if (current === null || current.score === null) return current;
  return { ...current, score: null };
}
