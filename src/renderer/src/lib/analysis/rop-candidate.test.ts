import { describe, expect, it } from "vitest";

import {
  dropScoresAfterObjectiveChange,
  retainBestScoringRopCandidate,
  type RopCandidate,
} from "./rop-candidate";

function candidate(seed: number, score: number | null): RopCandidate {
  return { seed, values: Float32Array.from([seed]), score };
}

describe("retainBestScoringRopCandidate", () => {
  it("retains the first scored candidate as the best", () => {
    const next = candidate(1, 0.5);
    expect(retainBestScoringRopCandidate(null, next)).toBe(next);
  });

  it("replaces the best only when the new score is strictly higher", () => {
    const best = candidate(1, 0.5);
    const higher = candidate(2, 0.7);
    const equal = candidate(3, 0.5);
    const lower = candidate(4, 0.3);
    expect(retainBestScoringRopCandidate(best, higher)).toBe(higher);
    expect(retainBestScoringRopCandidate(best, equal)).toBe(best);
    expect(retainBestScoringRopCandidate(best, lower)).toBe(best);
  });

  it("never lets an unscored candidate become or displace the best", () => {
    const best = candidate(1, 0.5);
    expect(retainBestScoringRopCandidate(best, candidate(2, null))).toBe(best);
    expect(retainBestScoringRopCandidate(null, candidate(2, null))).toBeNull();
  });

  it("replaces a best whose own score is null (defensive: it should not exist)", () => {
    const unscoredBest = candidate(1, null);
    const scored = candidate(2, 0.1);
    expect(retainBestScoringRopCandidate(unscoredBest, scored)).toBe(scored);
  });
});

describe("dropScoresAfterObjectiveChange", () => {
  it("keeps the candidate but clears its score", () => {
    const dropped = dropScoresAfterObjectiveChange(candidate(1, 0.5));
    expect(dropped?.seed).toBe(1);
    expect(dropped?.score).toBeNull();
  });

  it("returns unscored candidates and null unchanged by identity", () => {
    const unscored = candidate(1, null);
    expect(dropScoresAfterObjectiveChange(unscored)).toBe(unscored);
    expect(dropScoresAfterObjectiveChange(null)).toBeNull();
  });
});
