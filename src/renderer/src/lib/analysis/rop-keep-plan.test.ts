import { describe, expect, it } from "vitest";

import {
  canKeepTheCandidateOnScreen,
  planRopKeep,
  type RopKeepIntent,
  type RopKeepPlan,
  type RopKeepSituation,
} from "./rop-keep-plan";

const CANDIDATE_PANEL_INDEX = 1;

function situation(
  liveCandidatePanelIndex: number | null,
  bestIsTheLiveCandidate: boolean,
): RopKeepSituation {
  return { liveCandidatePanelIndex, bestIsTheLiveCandidate };
}

// The whole CT-317 decision table, one row per (intent, live pointer, best
// identity) combination the aside can be in.
const DECISION_TABLE: ReadonlyArray<{
  readonly intent: RopKeepIntent;
  readonly situation: RopKeepSituation;
  readonly plan: RopKeepPlan;
}> = [
  {
    intent: "keep-current",
    situation: situation(CANDIDATE_PANEL_INDEX, true),
    plan: { kind: "freezeLiveCandidatePanel", viewportIndex: CANDIDATE_PANEL_INDEX },
  },
  {
    intent: "keep-current",
    situation: situation(CANDIDATE_PANEL_INDEX, false),
    plan: { kind: "freezeLiveCandidatePanel", viewportIndex: CANDIDATE_PANEL_INDEX },
  },
  { intent: "keep-current", situation: situation(null, false), plan: { kind: "disabled" } },
  { intent: "keep-current", situation: situation(null, true), plan: { kind: "disabled" } },
  {
    intent: "keep-best",
    situation: situation(CANDIDATE_PANEL_INDEX, true),
    plan: { kind: "freezeLiveCandidatePanel", viewportIndex: CANDIDATE_PANEL_INDEX },
  },
  {
    intent: "keep-best",
    situation: situation(CANDIDATE_PANEL_INDEX, false),
    plan: { kind: "deliverAsNewFrozenStack" },
  },
  { intent: "keep-best", situation: situation(null, false), plan: { kind: "deliverAsNewFrozenStack" } },
  { intent: "keep-best", situation: situation(null, true), plan: { kind: "deliverAsNewFrozenStack" } },
  {
    intent: "search-winner",
    situation: situation(CANDIDATE_PANEL_INDEX, true),
    plan: {
      kind: "replaceLiveCandidatePanelWithFrozenStack",
      viewportIndex: CANDIDATE_PANEL_INDEX,
    },
  },
  {
    intent: "search-winner",
    situation: situation(CANDIDATE_PANEL_INDEX, false),
    plan: {
      kind: "replaceLiveCandidatePanelWithFrozenStack",
      viewportIndex: CANDIDATE_PANEL_INDEX,
    },
  },
  {
    intent: "search-winner",
    situation: situation(null, false),
    plan: { kind: "deliverAsNewFrozenStack" },
  },
];

describe("planRopKeep", () => {
  for (const row of DECISION_TABLE) {
    const where = row.situation.liveCandidatePanelIndex === null ? "no live panel" : "live panel";
    const best = row.situation.bestIsTheLiveCandidate ? "best is the live candidate" : "best differs";
    it(`plans ${row.plan.kind} for ${row.intent} with ${where}, ${best}`, () => {
      expect(planRopKeep(row.intent, row.situation)).toEqual(row.plan);
    });
  }

  it("keeps in place rather than copying whenever the candidate on screen is the one asked for", () => {
    const plan = planRopKeep("keep-best", situation(CANDIDATE_PANEL_INDEX, true));
    expect(plan).not.toEqual({ kind: "deliverAsNewFrozenStack" });
  });
});

describe("canKeepTheCandidateOnScreen", () => {
  it("is available exactly while a live candidate panel exists", () => {
    expect(canKeepTheCandidateOnScreen(situation(CANDIDATE_PANEL_INDEX, false))).toBe(true);
    expect(canKeepTheCandidateOnScreen(situation(null, false))).toBe(false);
  });
});
