import { formatRopKeptHistoryLabel } from "@/lib/analysis/rop-format";
import { makeFloat32RasterFromBands } from "@/lib/image/make-float-raster";

import { ROP_PANEL_ICON } from "./operation-command-bindings";
import type { RegisteredViewportAction } from "./registered-actions";

// CT-309: committing a kept ROP candidate as a new stack. Like the Subset
// Bands actions, this is NOT in REGISTERED_VIEWPORT_ACTIONS (the ROP panel
// dispatches it directly, never a menu lookup); it exists so the kept stack
// travels the standard duplicate-apply flow - reservation rules, memory
// preflight, busy entry, rendering-state inheritance without masks, and the
// History entry naming ROP, the seed, and the objective score.

export const ROP_KEEP_ACTION_ID = "rop";

export interface RopKeepRequest {
  readonly seed: number;
  readonly values: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly score: number | null;
  readonly objectiveLabel: string | null;
}

export function buildRopKeepAction(request: RopKeepRequest): RegisteredViewportAction {
  return {
    id: ROP_KEEP_ACTION_ID,
    label: "ROP",
    icon: ROP_PANEL_ICON,
    successMessage: "Projection kept",
    appliedLabel: formatRopKeptHistoryLabel(request),
    apply: (renderingState) => renderingState,
    transformSource: () => ({
      kind: "raster",
      raster: buildKeptProjectionRaster(request),
    }),
  };
}

// The kept raster copies the candidate values: the panel retains the candidate
// (it may still be the best-so-far), and a shared buffer would let a later
// buffer-release of the kept panel detach the panel's retained copy too.
function buildKeptProjectionRaster(request: RopKeepRequest) {
  return makeFloat32RasterFromBands({ width: request.width, height: request.height }, [
    request.values.slice(),
  ]);
}
