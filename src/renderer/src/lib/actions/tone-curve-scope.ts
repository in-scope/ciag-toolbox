import type { ApplyScopeOption } from "./viewport-action";

// CT-192: the tone curve offers three apply scopes. "Full image" is the original
// selected-band behaviour (one curve on the viewed band, full spatial extent);
// "Whole stack" applies the same curve shape to every band, each normalized by its own
// min/max; "Region of interest" limits the selected-band curve to a region. A single-band
// stack drops "Whole stack" (it would coincide with "Full image"), following CT-189.

export const TONE_CURVE_SCOPE_PARAMETER_ID = "toneCurveApplyScope";
export const WHOLE_STACK_TONE_CURVE_SCOPE_VALUE = "whole-stack";

export const TONE_CURVE_FULL_IMAGE_SCOPE_LABEL = "Full image";
export const TONE_CURVE_WHOLE_STACK_SCOPE_LABEL = "Whole stack";
export const TONE_CURVE_REGION_SCOPE_LABEL = "Region of interest";

const FULL_IMAGE_OPTION: ApplyScopeOption = {
  scope: "whole-image",
  label: TONE_CURVE_FULL_IMAGE_SCOPE_LABEL,
};
const WHOLE_STACK_OPTION: ApplyScopeOption = {
  scope: "whole-stack",
  label: TONE_CURVE_WHOLE_STACK_SCOPE_LABEL,
};
const REGION_OPTION: ApplyScopeOption = {
  scope: "roi",
  label: TONE_CURVE_REGION_SCOPE_LABEL,
};

export function resolveToneCurveApplyScopeOptions(
  bandCount: number | null,
): ReadonlyArray<ApplyScopeOption> {
  if (bandCount === 1) return [FULL_IMAGE_OPTION, REGION_OPTION];
  return [FULL_IMAGE_OPTION, WHOLE_STACK_OPTION, REGION_OPTION];
}
