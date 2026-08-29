import { formatRopKeptHistoryLabel } from "@/lib/analysis/rop-format";
import { makeFloat32RasterFromBands } from "@/lib/image/make-float-raster";
import type { RasterImage } from "@/lib/image/raster-image";

import { ROP_PANEL_ICON } from "./operation-command-bindings";
import type { RegisteredViewportAction } from "./registered-actions";

// CT-309: committing a kept ROP candidate as a new stack. Like the Subset
// Bands actions, this is NOT in REGISTERED_VIEWPORT_ACTIONS (the ROP panel
// dispatches it directly, never a menu lookup); it exists so the kept stack
// travels the standard duplicate-apply flow - reservation rules, memory
// preflight, busy entry, rendering-state inheritance without masks, and the
// History entry naming ROP, the seed, and the objective score.
//
// CT-316: a "New projection" press delivers its candidate through the SAME
// action shape (same id, label, icon, History wording, one-band float copy);
// only the toast differs, so "Projection kept" stays reserved for Keep.

export const ROP_KEEP_ACTION_ID = "rop";

export const ROP_KEPT_SUCCESS_MESSAGE = "Projection kept";
export const ROP_CANDIDATE_READY_SUCCESS_MESSAGE = "Projection ready";

export interface RopKeepRequest {
  readonly seed: number;
  readonly values: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly score: number | null;
  readonly objectiveLabel: string | null;
  // CT-310: set when the candidate won a SEARCH of that many projections; the
  // History entry then names the search instead of a seed (see rop-format.ts).
  readonly searchedProjectionCount?: number | null;
}

export function buildRopKeepAction(request: RopKeepRequest): RegisteredViewportAction {
  return buildRopStackAction(request, buildProjectionRasterCopy(request), ROP_KEPT_SUCCESS_MESSAGE);
}

export interface RopCandidateDeliveryAction {
  readonly action: RegisteredViewportAction;
  // The exact raster the action places, so the caller can later recognise the
  // candidate panel by raster identity (CT-316 live-candidate pointer).
  readonly raster: RasterImage;
}

export function buildRopCandidateDeliveryAction(request: RopKeepRequest): RopCandidateDeliveryAction {
  return buildRopStackDelivery(request, ROP_CANDIDATE_READY_SUCCESS_MESSAGE);
}

// CT-317: a search winner is delivered ALREADY FROZEN - the same one-band copy
// and History wording, announced as a kept projection because no later press
// will replace it.
export function buildRopFrozenStackDeliveryAction(request: RopKeepRequest): RopCandidateDeliveryAction {
  return buildRopStackDelivery(request, ROP_KEPT_SUCCESS_MESSAGE);
}

function buildRopStackDelivery(
  request: RopKeepRequest,
  successMessage: string,
): RopCandidateDeliveryAction {
  const raster = buildProjectionRasterCopy(request);
  return { action: buildRopStackAction(request, raster, successMessage), raster };
}

function buildRopStackAction(
  request: RopKeepRequest,
  raster: RasterImage,
  successMessage: string,
): RegisteredViewportAction {
  return {
    id: ROP_KEEP_ACTION_ID,
    label: "ROP",
    icon: ROP_PANEL_ICON,
    successMessage,
    appliedLabel: formatRopKeptHistoryLabel(request),
    apply: (renderingState) => renderingState,
    transformSource: () => ({ kind: "raster", raster }),
  };
}

// The placed raster copies the candidate values: the aside retains the
// candidate (it may still be the best-so-far), and a shared buffer would let a
// later buffer-release of the panel detach the aside's retained copy too.
function buildProjectionRasterCopy(request: RopKeepRequest): RasterImage {
  return makeFloat32RasterFromBands({ width: request.width, height: request.height }, [
    request.values.slice(),
  ]);
}
