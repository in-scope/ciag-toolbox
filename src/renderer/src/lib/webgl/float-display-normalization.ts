import type { RgbChannelExtents } from "@/lib/image/compute-image-channel-extents";
import type { ViewportImageSource } from "@/lib/webgl/texture";

// The display-normalization state handed to the shader: when enabled, the band is
// stretched from `extents` to [0, 1]; when disabled, the shader clamps to the fixed
// [0, 1] window (CT-062 / CT-161).
export interface NormalizationState {
  enabled: boolean;
  extents: RgbChannelExtents;
}

// Resolve the normalization the shader should use, given the user's explicit
// normalized-viewing toggle and whether the source's float data leaves [0, 1].
// An explicit normalized-viewing toggle always wins; otherwise out-of-range
// float data auto-stretches to its own extents (CT-161).
export function resolveEffectiveFloatDisplayNormalization(
  userNormalization: NormalizationState,
  sourceFallsOutsideUnitWindow: boolean,
): NormalizationState {
  if (userNormalization.enabled) return userNormalization;
  if (sourceFallsOutsideUnitWindow) {
    return { enabled: true, extents: userNormalization.extents };
  }
  return userNormalization;
}

// A float raster whose data lies outside [0, 1] would saturate to a flat white
// frame under the fixed [0, 1] default window, so its display window auto-fits
// to the data's own extents (CT-161). Shared by the renderer and by the CT-296
// as-viewed export so both resolve the same effective normalization.
export function floatSourceDataFallsOutsideUnitDisplayWindow(
  source: ViewportImageSource,
  extents: RgbChannelExtents,
): boolean {
  if (source.kind !== "raster" || source.raster.sampleFormat !== "float") return false;
  return anyChannelExtentExceedsUnitWindow(extents);
}

function anyChannelExtentExceedsUnitWindow(extents: RgbChannelExtents): boolean {
  const exceedsBelow = extents.min.some((minValue) => minValue < 0);
  const exceedsAbove = extents.max.some((maxValue) => maxValue > 1);
  return exceedsBelow || exceedsAbove;
}

// The pure mirror of the normalize/clamp block at the end of
// VIEWPORT_FRAGMENT_SHADER_SOURCE (shaders.ts). One display-unit sample in, one
// display-unit sample out: enabled stretches the channel's extents to [0, 1]
// (flat channels divide by 1, and their numerator is 0 too), disabled clamps to
// the fixed [0, 1] window. CT-296: the PNG/JPEG export runs samples through this
// so a saved file carries what the screen showed.
export function mapSampleThroughDisplayNormalization(
  sample: number,
  channelIndex: number,
  normalization: NormalizationState,
): number {
  if (!normalization.enabled) return clampToUnitWindow(sample);
  return stretchSampleBetweenExtents(
    sample,
    normalization.extents.min[channelIndex] ?? 0,
    normalization.extents.max[channelIndex] ?? 1,
  );
}

function stretchSampleBetweenExtents(
  sample: number,
  minimum: number,
  maximum: number,
): number {
  const range = maximum - minimum;
  const safeRange = range > 0 ? range : 1;
  return clampToUnitWindow((sample - minimum) / safeRange);
}

function clampToUnitWindow(value: number): number {
  if (!(value > 0)) return 0;
  if (value > 1) return 1;
  return value;
}

// The GPU converts a [0, 1] fragment output to an 8-bit framebuffer sample by
// round-to-nearest, so the CPU mirror rounds too.
export function quantizeDisplayUnitToByte(value: number): number {
  return Math.round(clampToUnitWindow(value) * 0xff);
}
