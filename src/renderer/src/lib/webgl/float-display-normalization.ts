import type { RgbChannelExtents } from "@/lib/image/compute-image-channel-extents";

// The display-normalization state handed to the shader: when enabled, the band is
// stretched from `extents` to [0, 1]; when disabled, the shader clamps to the fixed
// [0, 1] window (CT-062 / CT-161).
export interface NormalizationState {
  enabled: boolean;
  extents: RgbChannelExtents;
}

// CT-193: out-of-range float data auto-stretches on open UNLESS the user pins the
// display to the fixed [0, 1] window. The auto-stretch only kicks in while the user
// keeps the fixed-unit window off; turning it on hands the shader its fixed clamp.
export function autoStretchAppliesToFloatDisplayWindow(
  sourceFallsOutsideUnitWindow: boolean,
  fixedUnitWindowEnabled: boolean,
): boolean {
  return sourceFallsOutsideUnitWindow && !fixedUnitWindowEnabled;
}

// Resolve the normalization the shader should use, given the user's explicit
// normalized-viewing toggle, whether the source's float data leaves [0, 1], and
// whether the user pinned the display to the fixed [0, 1] window. An explicit
// normalized-viewing toggle always wins; otherwise auto-stretch fills the gap only
// while the fixed-unit window is off.
export function resolveEffectiveFloatDisplayNormalization(
  userNormalization: NormalizationState,
  sourceFallsOutsideUnitWindow: boolean,
  fixedUnitWindowEnabled: boolean,
): NormalizationState {
  if (userNormalization.enabled) return userNormalization;
  if (autoStretchAppliesToFloatDisplayWindow(sourceFallsOutsideUnitWindow, fixedUnitWindowEnabled)) {
    return { enabled: true, extents: userNormalization.extents };
  }
  return userNormalization;
}
