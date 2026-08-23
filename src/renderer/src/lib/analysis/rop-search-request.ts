import type { MaskLayer } from "@/lib/masks/mask-layer";
import type { UserScriptRunExtras } from "@/lib/python/run-user-script-chunked";

import { listNonEmptyCategoryValuesInMaskLayer } from "./npc-qualification";
import { buildNpcCategoryMasks, clampNpcBinCount } from "./npc-run-request";
import type { RopObjectiveKind } from "./rop-objective";

// CT-310: assembles the ONE built-in rop_search.py run that loops every
// candidate in Python. The objective travels with it: NPC needs its bin count,
// CNR needs to know WHICH of the uploaded category masks is the text one and
// which the background one (they ride as a list, in painted-category order),
// and a custom objective travels as the script's SOURCE, which the search
// executes per candidate under the same sandbox as any imported tool.

export const DEFAULT_ROP_SEARCH_PROJECTION_COUNT = 10_000;
export const MIN_ROP_SEARCH_PROJECTION_COUNT = 1;

export type RopSearchObjectiveKind = Exclude<RopObjectiveKind, "none">;

export interface RopSearchRunRequest {
  readonly seed: number;
  readonly projectionCount: number;
  readonly objectiveKind: RopSearchObjectiveKind;
  readonly maskLayer: MaskLayer | null;
  readonly npcBinCount: number;
  readonly cnrTextCategoryValue: number | null;
  readonly cnrBackgroundCategoryValue: number | null;
  readonly customObjectiveSource: string | null;
}

// The panel keeps the field as typed text so a half-typed number is not
// rewritten under the cursor; null means "not a usable count yet" and blocks
// the search.
export function parseRopSearchProjectionCountOrNull(countText: string): number | null {
  const trimmed = countText.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed >= MIN_ROP_SEARCH_PROJECTION_COUNT && Number.isSafeInteger(parsed) ? parsed : null;
}

export function buildRopSearchRunExtras(request: RopSearchRunRequest): UserScriptRunExtras {
  return {
    masks: request.maskLayer === null ? [] : buildNpcCategoryMasks(request.maskLayer),
    params: buildRopSearchExecuteParams(request),
  };
}

export function buildRopSearchExecuteParams(
  request: RopSearchRunRequest,
): Record<string, unknown> {
  return {
    seed: request.seed,
    count: Math.max(MIN_ROP_SEARCH_PROJECTION_COUNT, Math.trunc(request.projectionCount)),
    objective: request.objectiveKind,
    ...buildObjectiveParams(request),
  };
}

function buildObjectiveParams(request: RopSearchRunRequest): Record<string, unknown> {
  if (request.objectiveKind === "npc") return { bins: clampNpcBinCount(request.npcBinCount) };
  if (request.objectiveKind === "cnr") return buildCnrMaskIndexParams(request);
  return { objective_source: request.customObjectiveSource ?? "" };
}

function buildCnrMaskIndexParams(request: RopSearchRunRequest): Record<string, unknown> {
  return {
    text_mask_index: findUploadedMaskIndex(request.maskLayer, request.cnrTextCategoryValue),
    background_mask_index: findUploadedMaskIndex(
      request.maskLayer,
      request.cnrBackgroundCategoryValue,
    ),
  };
}

// The uploaded masks are one per PAINTED category, in category order, so a
// category's position in that list is its index in the script's params.
function findUploadedMaskIndex(layer: MaskLayer | null, categoryValue: number | null): number {
  if (layer === null || categoryValue === null) return -1;
  return listNonEmptyCategoryValuesInMaskLayer(layer).indexOf(categoryValue);
}
