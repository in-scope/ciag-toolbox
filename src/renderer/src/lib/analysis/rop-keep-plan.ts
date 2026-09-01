// CT-317: what Keep, Keep best, and a finished search each DO with the panel
// already on screen. A press delivers its candidate into the candidate panel
// (CT-316), so keeping it costs nothing: the aside simply drops the pointer it
// uses to find that panel again, and the panel becomes an ordinary stack the
// next press will not touch. Only a candidate the live panel does NOT show has
// to be copied somewhere.

export type RopKeepIntent = "keep-current" | "keep-best" | "search-winner";

export interface RopKeepSituation {
  // The candidate panel's index while the aside's pointer still finds it, null
  // once it was closed, replaced, or changed by an in-place apply.
  readonly liveCandidatePanelIndex: number | null;
  // Whether the retained best IS the candidate that panel shows.
  readonly bestIsTheLiveCandidate: boolean;
}

export type RopKeepPlan =
  | { readonly kind: "disabled" }
  | { readonly kind: "freezeLiveCandidatePanel"; readonly viewportIndex: number }
  | { readonly kind: "deliverAsNewFrozenStack" }
  | {
      readonly kind: "replaceLiveCandidatePanelWithFrozenStack";
      readonly viewportIndex: number;
    };

export function planRopKeep(intent: RopKeepIntent, situation: RopKeepSituation): RopKeepPlan {
  const liveIndex = situation.liveCandidatePanelIndex;
  if (liveIndex === null) return planWithoutALiveCandidatePanel(intent);
  if (intent === "search-winner") {
    return { kind: "replaceLiveCandidatePanelWithFrozenStack", viewportIndex: liveIndex };
  }
  if (intent === "keep-current" || situation.bestIsTheLiveCandidate) {
    return { kind: "freezeLiveCandidatePanel", viewportIndex: liveIndex };
  }
  return { kind: "deliverAsNewFrozenStack" };
}

// Keep speaks only about the panel on screen, so it has nothing to do without
// one; Keep best and a search winner still have values worth a stack.
function planWithoutALiveCandidatePanel(intent: RopKeepIntent): RopKeepPlan {
  if (intent === "keep-current") return { kind: "disabled" };
  return { kind: "deliverAsNewFrozenStack" };
}

export function canKeepTheCandidateOnScreen(situation: RopKeepSituation): boolean {
  return planRopKeep("keep-current", situation).kind !== "disabled";
}
