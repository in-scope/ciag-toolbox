import { describe, expect, it } from "vitest";

import { BAND_WISE_SCOPE_FIELD_DESCRIPTION } from "@/lib/image/parse-band-range";

import { DENOISE_ACTION } from "./denoise-action";
import { PERCENTILE_CLIP_ACTION } from "./percentile-clip-action";
import {
  CLIP_BY_VALUE_ACTION,
  NORMALIZE_DATA_ACTION,
  STANDARDIZE_ACTION,
  type RegisteredViewportAction,
} from "./registered-actions";
import { SPATIAL_FILTER_ACTION } from "./spatial-filter-action";

// CT-287: every band-wise scope field shows the ONE shared description; no
// per-tool wording, no separate "leave the band field empty" remark.
const BAND_WISE_SCOPED_ACTIONS: ReadonlyArray<RegisteredViewportAction> = [
  STANDARDIZE_ACTION,
  PERCENTILE_CLIP_ACTION,
  DENOISE_ACTION,
  SPATIAL_FILTER_ACTION,
  NORMALIZE_DATA_ACTION,
  CLIP_BY_VALUE_ACTION,
];

function findCubeScopeDescription(action: RegisteredViewportAction): string | undefined {
  return action.parameters?.find((parameter) => parameter.kind === "cube-scope")?.description;
}

describe("band-wise scope field description (CT-287)", () => {
  it.each(BAND_WISE_SCOPED_ACTIONS.map((action) => [action.label, action] as const))(
    "%s uses the shared constant",
    (_label, action) => {
      expect(findCubeScopeDescription(action)).toBe(BAND_WISE_SCOPE_FIELD_DESCRIPTION);
    },
  );
});
