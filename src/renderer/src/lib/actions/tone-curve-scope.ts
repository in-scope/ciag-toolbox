import type { ApplyScopeOption } from "./viewport-action";

// CT-192 / CT-244: the tone curve offers two apply scopes. "Full image" is the original
// selected-band behaviour (one curve on the viewed band, full spatial extent); "Whole stack"
// applies the same curve shape to every band, each normalized by its own min/max. A
// single-band stack and a true-colour photo drop "Whole stack" (it would coincide with
// "Full image"), leaving one scope, so the control hides entirely (the CT-189 pattern).
// The "Region of interest" scope was removed in CT-244: the preview always showed the
// whole image, so a region-limited Apply could disagree with what the user saw.

export const TONE_CURVE_SCOPE_PARAMETER_ID = "toneCurveApplyScope";
export const WHOLE_STACK_TONE_CURVE_SCOPE_VALUE = "whole-stack";

export const TONE_CURVE_FULL_IMAGE_SCOPE_LABEL = "Full image";
export const TONE_CURVE_WHOLE_STACK_SCOPE_LABEL = "Whole stack";

const FULL_IMAGE_OPTION: ApplyScopeOption = {
  scope: "whole-image",
  label: TONE_CURVE_FULL_IMAGE_SCOPE_LABEL,
};
const WHOLE_STACK_OPTION: ApplyScopeOption = {
  scope: "whole-stack",
  label: TONE_CURVE_WHOLE_STACK_SCOPE_LABEL,
};

export function resolveToneCurveApplyScopeOptions(
  bandCount: number | null,
  isTrueColorComposite: boolean,
): ReadonlyArray<ApplyScopeOption> {
  if (bandCount === 1 || isTrueColorComposite) return [FULL_IMAGE_OPTION];
  return [FULL_IMAGE_OPTION, WHOLE_STACK_OPTION];
}
